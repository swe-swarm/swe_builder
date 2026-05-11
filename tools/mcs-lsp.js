/**
 * MCS Language Server Wrapper
 *
 * Wraps the Copilot Studio VS Code extension's LanguageServerHost.exe to provide
 * headless push/pull/preview of MCS agent components (topics, instructions, etc.)
 * via JSON-RPC over stdio.
 *
 * The LSP uses YamlPassThroughSerializationContext — it accepts .mcs.yml files
 * directly, matching the exact code path of the official GA extension.
 *
 * Zero external dependencies — uses native Node.js child_process, fs, path.
 *
 * Auth: az account get-access-token (Dataverse + Power Platform tokens)
 *
 * Usage:
 *   node tools/mcs-lsp.js push --workspace "C:\Copilot 2\Clone\Daily Briefing"
 *   node tools/mcs-lsp.js pull --workspace "C:\Copilot 2\Clone\Daily Briefing"
 *   node tools/mcs-lsp.js preview --workspace "C:\Copilot 2\Clone\Daily Briefing"
 *   node tools/mcs-lsp.js info --workspace "C:\Copilot 2\Clone\Daily Briefing"
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
const { getToken: getAzToken, httpRequest, sleep } = require('./lib/http');

// --- Configuration ---
const LSP_STARTUP_TIMEOUT_MS = 15000;
const LSP_REQUEST_TIMEOUT_MS = 60000;
const VERBOSE = process.env.MCS_LSP_VERBOSE === '1';

// --- LSP Binary Discovery ---

/**
 * Find the LanguageServerHost.exe from the VS Code Copilot Studio extension.
 * Scans ~/.vscode/extensions/ for ms-copilotstudio.vscode-copilotstudio-{version}-win32-x64
 * and picks the latest version.
 */
function findLspBinary() {
    const extensionsDir = path.join(os.homedir(), '.vscode', 'extensions');
    if (!fs.existsSync(extensionsDir)) {
        throw new Error(
            'VS Code extensions directory not found.\n' +
            'Install the Copilot Studio extension: ms-copilotstudio.vscode-copilotstudio'
        );
    }

    const entries = fs.readdirSync(extensionsDir)
        .filter(d => d.startsWith('ms-copilotstudio.vscode-copilotstudio-') && d.includes('win32-x64'))
        .sort()
        .reverse(); // Latest version first

    if (entries.length === 0) {
        throw new Error(
            'Copilot Studio VS Code extension not found.\n' +
            'Install it: code --install-extension ms-copilotstudio.vscode-copilotstudio'
        );
    }

    const lspPath = path.join(extensionsDir, entries[0], 'lspOut', 'LanguageServerHost.exe');
    if (!fs.existsSync(lspPath)) {
        throw new Error(
            `LanguageServerHost.exe not found at: ${lspPath}\n` +
            `Extension found: ${entries[0]} but lspOut directory is missing.`
        );
    }

    if (VERBOSE) console.error(`[mcs-lsp] Using LSP binary: ${lspPath}`);
    return lspPath;
}

// --- LSP Transport (JSON-RPC over stdio or named pipe with Content-Length framing) ---

/**
 * Default named pipe path for the Copilot Studio LSP.
 * The VS Code extension uses this pipe when running the LSP server.
 * connect() will automatically use this pipe name by default.
 */
const DEFAULT_PIPE_NAME = '\\\\.\\pipe\\copilot-studio-lsp';

class LspClient {
    constructor(lspPath) {
        this._lspPath = lspPath;
        this._process = null;
        this._socket = null;     // Named pipe socket (alternative to process stdio)
        this._transport = null;  // 'stdio' or 'pipe'
        this._nextId = 1;
        this._pending = new Map(); // id → { resolve, reject, timer }
        this._buffer = Buffer.alloc(0);
        this._started = false;
    }

    /**
     * Spawn the LSP process and begin listening for messages via stdio.
     */
    start() {
        this._transport = 'stdio';
        this._process = spawn(this._lspPath, ['--stdio'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
            env: {
                ...process.env,
                // Suppress .NET console logging that pollutes stdout alongside JSON-RPC messages
                Logging__LogLevel__Default: 'None',
                Logging__Console__LogLevel__Default: 'None'
            }
        });

        this._process.stdout.on('data', (chunk) => this._onData(chunk));

        this._process.stderr.on('data', (chunk) => {
            const text = chunk.toString();
            if (VERBOSE) console.error(`[mcs-lsp stderr] ${text.trimEnd()}`);
        });

        this._process.on('error', (err) => {
            console.error(`[mcs-lsp] Process error: ${err.message}`);
            this._rejectAll(err);
        });

        this._process.on('exit', (code, signal) => {
            if (VERBOSE) console.error(`[mcs-lsp] Process exited: code=${code} signal=${signal}`);
            this._rejectAll(new Error(`LSP process exited unexpectedly (code=${code})`));
        });

        this._started = true;
    }

    /**
     * Connect to an existing LSP server via Windows named pipe.
     * Use this when VS Code Copilot Studio extension is already running.
     *
     * @param {string} [pipeName] - Named pipe path (default: \\.\pipe\copilot-studio-lsp)
     * @param {number} [timeoutMs=5000] - Connection timeout in ms
     * @returns {Promise<void>} Resolves when connected
     */
    connect(pipeName, timeoutMs = 5000) {
        const net = require('net');
        const pipe = pipeName || DEFAULT_PIPE_NAME;
        this._transport = 'pipe';

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Named pipe connection timeout (${timeoutMs}ms): ${pipe}`));
            }, timeoutMs);

            this._socket = net.connect(pipe, () => {
                clearTimeout(timer);
                if (VERBOSE) console.error(`[mcs-lsp] Connected to named pipe: ${pipe}`);
                this._started = true;
                resolve();
            });

            this._socket.on('data', (chunk) => this._onData(chunk));

            this._socket.on('error', (err) => {
                clearTimeout(timer);
                if (!this._started) {
                    reject(new Error(`Named pipe connection failed: ${err.message}. Is the LSP running? Pipe: ${pipe}`));
                } else {
                    console.error(`[mcs-lsp] Pipe error: ${err.message}`);
                    this._rejectAll(err);
                }
            });

            this._socket.on('close', () => {
                if (VERBOSE) console.error('[mcs-lsp] Named pipe closed');
                this._rejectAll(new Error('Named pipe connection closed'));
            });
        });
    }

    /**
     * Spawn the LSP process with a named pipe (server pattern).
     *
     * This is the pattern used by the official skills-for-copilot-studio scripts:
     * 1. Create a net.createServer() on a unique pipe path
     * 2. Spawn the LSP binary with --pipe=<path> (NOT --stdio)
     * 3. The LSP connects back to our pipe server
     *
     * Advantages over stdio:
     * - Clean JSON-RPC channel (no .NET log noise on stdout)
     * - Process stdout/stderr available for diagnostics without polluting protocol
     *
     * @param {number} [timeoutMs=15000] - Max time to wait for LSP to connect
     * @returns {Promise<void>} Resolves when LSP connects to the pipe
     */
    startWithPipe(timeoutMs = LSP_STARTUP_TIMEOUT_MS) {
        const net = require('net');
        const crypto = require('crypto');
        const sessionId = crypto.randomUUID();
        const pipePath = os.platform() === 'win32'
            ? `\\\\.\\pipe\\mcs-lsp-${sessionId}`
            : path.join(os.tmpdir(), `mcs-lsp-${sessionId}.sock`);

        this._transport = 'pipe';

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`LSP did not connect to pipe within ${timeoutMs}ms`));
            }, timeoutMs);

            // Create pipe server and wait for LSP to connect
            this._pipeServer = net.createServer((socket) => {
                clearTimeout(timer);
                this._socket = socket;
                this._started = true;

                socket.on('data', (chunk) => this._onData(chunk));
                socket.on('error', (err) => {
                    console.error(`[mcs-lsp] Pipe socket error: ${err.message}`);
                    this._rejectAll(err);
                });
                socket.on('close', () => {
                    if (VERBOSE) console.error('[mcs-lsp] Pipe socket closed');
                    this._rejectAll(new Error('Named pipe connection closed'));
                });

                if (VERBOSE) console.error(`[mcs-lsp] LSP connected via pipe: ${pipePath}`);
                resolve();
            });

            this._pipeServer.listen(pipePath, () => {
                if (VERBOSE) console.error(`[mcs-lsp] Pipe server listening: ${pipePath}`);

                // Spawn LSP with --pipe= instead of --stdio
                this._process = spawn(this._lspPath, [
                    `--pipe=${pipePath}`,
                    `--sessionid=${sessionId}`,
                    '--enabletelemetry=false'
                ], {
                    stdio: ['ignore', 'pipe', 'pipe'],
                    windowsHide: true,
                    env: {
                        ...process.env,
                        Logging__LogLevel__Default: 'None',
                        Logging__Console__LogLevel__Default: 'None'
                    }
                });

                this._process.stderr.on('data', (chunk) => {
                    if (VERBOSE) console.error(`[mcs-lsp stderr] ${chunk.toString().trimEnd()}`);
                });

                this._process.on('error', (err) => {
                    clearTimeout(timer);
                    reject(new Error(`LSP process error: ${err.message}`));
                });

                this._process.on('exit', (code) => {
                    if (!this._started) {
                        clearTimeout(timer);
                        reject(new Error(`LSP process exited before connecting (code=${code})`));
                    }
                });
            });

            this._pipeServer.on('error', (err) => {
                clearTimeout(timer);
                reject(new Error(`Failed to create pipe server: ${err.message}`));
            });
        });
    }

    /**
     * Send a JSON-RPC request and wait for the response.
     */
    send(method, params) {
        if (!this._started) throw new Error('LSP client not started');

        const id = this._nextId++;
        const message = {
            jsonrpc: '2.0',
            id,
            method,
            params: params || {}
        };

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this._pending.delete(id);
                reject(new Error(`LSP request timeout (${LSP_REQUEST_TIMEOUT_MS}ms): ${method}`));
            }, LSP_REQUEST_TIMEOUT_MS);

            this._pending.set(id, { resolve, reject, timer });
            this._write(message);
        });
    }

    /**
     * Send a JSON-RPC notification (no response expected).
     */
    notify(method, params) {
        if (!this._started) throw new Error('LSP client not started');

        const message = {
            jsonrpc: '2.0',
            method,
            params: params || {}
        };

        this._write(message);
    }

    /**
     * Gracefully shut down the LSP process or disconnect the named pipe.
     */
    async shutdown() {
        if (!this._started) return;

        // Named pipe transport
        if (this._transport === 'pipe') {
            // If we spawned the process (startWithPipe), send shutdown and kill
            if (this._process) {
                try {
                    await this.send('shutdown', null);
                    this.notify('exit', null);
                } catch { /* process may have already exited */ }
            }

            if (this._socket) {
                try { this._socket.end(); } catch { /* already closed */ }
                this._socket = null;
            }
            if (this._pipeServer) {
                try { this._pipeServer.close(); } catch { /* already closed */ }
                this._pipeServer = null;
            }
            if (this._process && this._process.exitCode === null) {
                this._process.kill('SIGTERM');
            }
            this._started = false;
            return;
        }

        // Stdio transport — shut down the spawned process
        if (!this._process || this._process.exitCode !== null) return;

        try {
            await this.send('shutdown', null);
            this.notify('exit', null);
        } catch {
            // Process may have already exited
        }

        // Give it a moment to exit cleanly
        await new Promise((resolve) => {
            const timer = setTimeout(() => {
                if (this._process && this._process.exitCode === null) {
                    this._process.kill('SIGTERM');
                }
                resolve();
            }, 3000);

            if (this._process) {
                this._process.once('exit', () => {
                    clearTimeout(timer);
                    resolve();
                });
            } else {
                clearTimeout(timer);
                resolve();
            }
        });
    }

    /**
     * Write a JSON-RPC message with Content-Length header.
     * Routes to stdio or named pipe depending on transport.
     */
    _write(message) {
        const body = JSON.stringify(message);
        const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
        if (VERBOSE) console.error(`[mcs-lsp →] ${message.method} (id=${message.id || 'notification'}) [${this._transport}]`);

        if (this._transport === 'pipe' && this._socket) {
            this._socket.write(header + body);
        } else if (this._process && this._process.stdin) {
            this._process.stdin.write(header + body);
        }
    }

    /**
     * Handle incoming data from stdout. Parse Content-Length framed messages.
     * The LSP may emit non-framed log lines (e.g., "info: Microsoft...") on stdout
     * before sending proper Content-Length framed JSON-RPC messages.
     * We skip all data until we find a Content-Length header.
     */
    _onData(chunk) {
        this._buffer = Buffer.concat([this._buffer, chunk]);

        while (this._buffer.length > 0) {
            // Find where "Content-Length:" starts in the buffer
            const bufStr = this._buffer.toString('utf8');
            const clIndex = bufStr.indexOf('Content-Length:');

            if (clIndex === -1) {
                // No Content-Length found — this is all non-framed log output.
                // Keep it in the buffer in case it's a partial "Content-Leng" at the end.
                if (this._buffer.length > 20) {
                    // Discard everything except the last 20 bytes (could be partial header)
                    const keep = this._buffer.slice(-20);
                    if (VERBOSE && this._buffer.length > 20) {
                        const discarded = this._buffer.slice(0, -20).toString('utf8').trim();
                        if (discarded) console.error(`[mcs-lsp skip] ${discarded.substring(0, 200)}`);
                    }
                    this._buffer = keep;
                }
                break;
            }

            // Discard anything before the Content-Length header (non-framed log lines)
            if (clIndex > 0) {
                if (VERBOSE) {
                    const skipped = bufStr.substring(0, clIndex).trim();
                    if (skipped) console.error(`[mcs-lsp skip] ${skipped.substring(0, 200)}`);
                }
                this._buffer = this._buffer.slice(clIndex);
            }

            // Look for the header-body separator
            const headerEnd = this._buffer.indexOf('\r\n\r\n');
            if (headerEnd === -1) break; // Incomplete header, wait for more data

            const headerStr = this._buffer.slice(0, headerEnd).toString('utf8');
            const match = headerStr.match(/Content-Length:\s*(\d+)/i);
            if (!match) {
                // Malformed header — skip past the separator and try again
                this._buffer = this._buffer.slice(headerEnd + 4);
                continue;
            }

            const contentLength = parseInt(match[1], 10);
            const messageStart = headerEnd + 4; // past \r\n\r\n
            const messageEnd = messageStart + contentLength;

            if (this._buffer.length < messageEnd) break; // Wait for more data

            const body = this._buffer.slice(messageStart, messageEnd).toString('utf8');
            this._buffer = this._buffer.slice(messageEnd);

            try {
                const msg = JSON.parse(body);
                this._onMessage(msg);
            } catch (err) {
                if (VERBOSE) console.error(`[mcs-lsp] Failed to parse JSON-RPC message: ${err.message}`);
            }
        }
    }

    /**
     * Handle a parsed JSON-RPC message.
     */
    _onMessage(msg) {
        // Response to a request we sent
        if (msg.id !== undefined && this._pending.has(msg.id)) {
            const { resolve, reject, timer } = this._pending.get(msg.id);
            this._pending.delete(msg.id);
            clearTimeout(timer);

            if (msg.error) {
                reject(new Error(`LSP error ${msg.error.code}: ${msg.error.message}`));
            } else {
                resolve(msg.result);
            }
            return;
        }

        // Server-initiated notification or request
        if (msg.method) {
            if (VERBOSE) console.error(`[mcs-lsp ←] notification: ${msg.method}`);

            // Handle server-to-client requests that need a response
            if (msg.id !== undefined) {
                // Respond with empty result to avoid blocking the server
                this._write({ jsonrpc: '2.0', id: msg.id, result: null });
            }
        }
    }

    /**
     * Reject all pending requests (on process exit/error).
     */
    _rejectAll(err) {
        for (const [id, { reject, timer }] of this._pending) {
            clearTimeout(timer);
            reject(err);
        }
        this._pending.clear();
    }
}

// --- Connection Info ---

/**
 * Read conn.json from a workspace's .mcs directory.
 */
function readConnJson(workspacePath) {
    const connPath = path.join(workspacePath, '.mcs', 'conn.json');
    if (!fs.existsSync(connPath)) {
        throw new Error(
            `No .mcs/conn.json found in workspace: ${workspacePath}\n` +
            'This workspace was not cloned via the Copilot Studio VS Code extension.\n' +
            'Clone an agent first using the extension, then use this tool to push/pull.'
        );
    }
    return JSON.parse(fs.readFileSync(connPath, 'utf8'));
}

/**
 * Get Dataverse and Power Platform access tokens via az CLI.
 */
function getTokens(connJson) {
    const dvUrl = connJson.DataverseEndpoint.replace(/\/$/, '');

    const dataverseToken = getAzToken(dvUrl);
    // PVA/Copilot Studio gateway expects audience = PVA app ID, not api.powerplatform.com
    const copilotStudioToken = getAzToken('96ff4394-9197-43aa-b393-6a41652e21f8');

    return { dataverseToken, copilotStudioToken };
}

// getAzToken imported from ./lib/http

/**
 * Build the SyncAgentRequest from conn.json + tokens.
 * This matches the shape from DataverseRequest.cs, EnvironmentInfo.cs, CloneAgentRequest.cs.
 */
function buildSyncRequest(workspacePath, connJson, tokens) {
    // Convert workspace path to file URI
    const fileUri = pathToFileURL(workspacePath).href;

    return {
        workspaceUri: fileUri,
        environmentInfo: {
            environmentId: connJson.EnvironmentId,
            dataverseUrl: connJson.DataverseEndpoint,
            displayName: '',
            agentManagementUrl: connJson.AgentManagementEndpoint
        },
        solutionVersions: connJson.SolutionVersions || {
            solutionVersions: {},
            copilotStudioSolutionVersion: ''
        },
        accountInfo: connJson.AccountInfo || {},
        dataverseAccessToken: tokens.dataverseToken,
        copilotStudioAccessToken: tokens.copilotStudioToken
    };
}

// --- LSP Lifecycle ---

/**
 * Send the LSP initialize request + initialized notification.
 */
async function initializeLsp(client, workspacePath) {
    const fileUri = pathToFileURL(workspacePath).href;

    const initResult = await client.send('initialize', {
        processId: process.pid,
        capabilities: {
            textDocument: {
                synchronization: { dynamicRegistration: false, willSave: false, didSave: false },
                completion: { dynamicRegistration: false }
            },
            workspace: {
                workspaceFolders: true
            }
        },
        rootUri: fileUri,
        workspaceFolders: [{ uri: fileUri, name: path.basename(workspacePath) }]
    });

    if (VERBOSE) console.error('[mcs-lsp] Initialize response received');

    // Send initialized notification
    client.notify('initialized', {});

    // Small delay for server to finish startup processing
    await sleep(500);

    return initResult;
}

/**
 * Open all .mcs.yml files in the workspace via textDocument/didOpen notifications.
 * The LSP needs to know about files before it can push them.
 */
async function openWorkspaceFiles(client, workspacePath) {
    const files = findMcsYmlFiles(workspacePath);
    if (VERBOSE) console.error(`[mcs-lsp] Opening ${files.length} .mcs.yml files`);

    for (const filePath of files) {
        const content = fs.readFileSync(filePath, 'utf8');
        const fileUri = pathToFileURL(filePath).href;

        client.notify('textDocument/didOpen', {
            textDocument: {
                uri: fileUri,
                languageId: 'yaml',
                version: 1,
                text: content
            }
        });
    }

    // Give the LSP a moment to process all didOpen notifications
    if (files.length > 0) await sleep(300);

    return files;
}

/**
 * Find all .mcs.yml files in a workspace directory (recursive).
 */
function findMcsYmlFiles(dir) {
    const results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== '.mcs' && entry.name !== 'node_modules') {
            results.push(...findMcsYmlFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.mcs.yml')) {
            results.push(fullPath);
        }
    }

    return results;
}

// --- Topic Comment Header Cleanup (bm-026) ---

/**
 * Strip # Name: and # Description: comment headers from DialogComponent (topic)
 * data fields in Dataverse. LSP push writes the full file content (including comments)
 * to the data field, but MCS visual editor expects data to start with "kind: AdaptiveDialog".
 *
 * Only patches topics that actually have comment headers (starts with #).
 * GptComponents (type 15) are NOT affected — they can have comment headers.
 *
 * @param {string} workspacePath - Path to agent workspace (with .mcs/conn.json)
 * @returns {number} Count of topics patched
 */
async function stripTopicCommentHeaders(workspacePath) {
    const connJson = readConnJson(workspacePath);
    const dvUrl = connJson.DataverseEndpoint.replace(/\/$/, '');
    const agentId = connJson.AgentId;
    const token = getAzToken(dvUrl);

    // Find all DialogComponents (type 9) for this agent that have # comment headers
    const fetchXml = `<fetch top="50"><entity name="botcomponent"><attribute name="botcomponentid"/><attribute name="name"/><attribute name="data"/><filter><condition attribute="parentbotid" operator="eq" value="${agentId}"/><condition attribute="componenttype" operator="eq" value="9"/></filter></entity></fetch>`;

    const searchRes = await httpRequest('GET',
        `${dvUrl}/api/data/v9.2/botcomponents?fetchXml=${encodeURIComponent(fetchXml)}`,
        { 'Authorization': `Bearer ${token}` }, null
    );

    if (searchRes.status !== 200 || !searchRes.data.value) return 0;

    let patchCount = 0;
    for (const comp of searchRes.data.value) {
        const data = comp.data || '';
        if (!data.startsWith('#')) continue; // No comment headers — skip

        // Strip leading # lines
        const lines = data.split('\n');
        let startIdx = 0;
        while (startIdx < lines.length && lines[startIdx].startsWith('#')) {
            startIdx++;
        }
        const cleanData = lines.slice(startIdx).join('\n');

        const patchRes = await httpRequest('PATCH',
            `${dvUrl}/api/data/v9.2/botcomponents(${comp.botcomponentid})`,
            { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'If-Match': '*' },
            JSON.stringify({ data: cleanData })
        );

        if (patchRes.status === 204 || patchRes.status === 200) {
            patchCount++;
        }
    }

    return patchCount;
}

// --- Metadata Patch (comment headers not synced by LSP) ---

/**
 * Patch agent metadata (name + description) in Dataverse after LSP push.
 *
 * LSP push does NOT sync:
 *   1. Comment headers (lines 1-2 of agent.mcs.yml) → stored in GptComponent `data` field
 *   2. The `botcomponent.description` column → the ACTUAL field MCS UI reads for agent description
 *
 * This function reads from the local agent.mcs.yml and patches BOTH locations.
 * The ObjectModel schema (AgentDefinition.description) confirms `description` is a
 * first-class property on the botcomponent entity, separate from the YAML `data` field.
 *
 * @param {string} workspacePath - Path to agent workspace (with .mcs/conn.json)
 * @returns {object|null} Patch result or null if skipped
 */
async function patchMetadata(workspacePath) {
    // 1. Read local agent.mcs.yml
    const agentYmlPath = path.join(workspacePath, 'agent.mcs.yml');
    if (!fs.existsSync(agentYmlPath)) return null;

    const localContent = fs.readFileSync(agentYmlPath, 'utf8');
    const localLines = localContent.split('\n');
    const localLine1 = localLines[0] || '';
    const localLine2 = localLines[1] || '';

    // Extract name and description from two possible formats:
    // Format A (comment): "# Name: X" / "# description text"
    // Format B (mcs.metadata block): "mcs.metadata:" / "  componentName: X" / "  description: Y"
    let localName = '';
    let localDesc = '';

    const nameMatch = localLine1.match(/^#\s*Name:\s*(.+)/);
    const descMatch = localLine2.match(/^#\s*(.+)/);
    if (nameMatch) {
        localName = nameMatch[1].trim();
        localDesc = descMatch ? descMatch[1].trim() : '';
    }

    // Fallback: parse mcs.metadata block (Format B — after LSP pull on newer agents)
    if (!localName || localName === 'default') {
        const compNameMatch = localContent.match(/mcs\.metadata:\s*\n\s+componentName:\s*(.+)/);
        const compDescMatch = localContent.match(/mcs\.metadata:\s*\n\s+componentName:[^\n]*\n\s+description:\s*(.+)/);
        if (compNameMatch) localName = compNameMatch[1].trim();
        if (compDescMatch) localDesc = compDescMatch[1].trim();
    }

    // Skip if still defaults (nothing useful to patch)
    if (!localName || localName === 'default') {
        console.error('[mcs-lsp] Skipping metadata patch — still default values');
        return null;
    }

    // 2. Get conn.json for Dataverse URL + agent ID
    const connJson = readConnJson(workspacePath);
    const dvUrl = connJson.DataverseEndpoint.replace(/\/$/, '');
    const agentId = connJson.AgentId;
    const token = getAzToken(dvUrl);

    // 3. Find GptComponent (componenttype=15) for this agent
    // FetchXML uses logical name "parentbotid" (not OData "_parentbotid_value")
    const fetchXml = `<fetch top="1"><entity name="botcomponent"><attribute name="botcomponentid"/><attribute name="data"/><attribute name="description"/><attribute name="name"/><filter><condition attribute="parentbotid" operator="eq" value="${agentId}"/><condition attribute="componenttype" operator="eq" value="15"/></filter></entity></fetch>`;

    const searchRes = await httpRequest('GET',
        `${dvUrl}/api/data/v9.2/botcomponents?fetchXml=${encodeURIComponent(fetchXml)}`,
        { 'Authorization': `Bearer ${token}` },
        null
    );

    if (searchRes.status !== 200 || !searchRes.data.value || searchRes.data.value.length === 0) {
        console.error('[mcs-lsp] No GptComponent found for metadata patch — skipping');
        return null;
    }

    const gptComponent = searchRes.data.value[0];
    const gptId = gptComponent.botcomponentid;
    const remoteData = gptComponent.data || '';
    const remoteDesc = gptComponent.description || '';
    const remoteName = gptComponent.name || '';

    // 4. Build patch payload — only include fields that changed
    const patchBody = {};
    let changes = [];

    // 4a. Check botcomponent.description column (what MCS UI actually displays)
    if (localDesc && remoteDesc !== localDesc) {
        patchBody.description = localDesc;
        changes.push(`description: "${remoteDesc}" → "${localDesc}"`);
    }

    // 4b. Check botcomponent.name column
    if (localName && remoteName !== localName) {
        patchBody.name = localName;
        changes.push(`name: "${remoteName}" → "${localName}"`);
    }

    // 4c. Check comment headers in data field (lines 1-2)
    const remoteLines = remoteData.split('\n');
    const remoteLine1 = remoteLines[0] || '';
    const remoteLine2 = remoteLines[1] || '';
    if (remoteLine1 !== localLine1 || remoteLine2 !== localLine2) {
        remoteLines[0] = localLine1;
        remoteLines[1] = localLine2;
        patchBody.data = remoteLines.join('\n');
        changes.push('data comment headers');
    }

    if (changes.length === 0) {
        console.error('[mcs-lsp] Metadata already matches — no patch needed');
        return { patched: false, gptComponentId: gptId };
    }

    // 5. PATCH all changed fields in one request
    const patchRes = await httpRequest('PATCH',
        `${dvUrl}/api/data/v9.2/botcomponents(${gptId})`,
        {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'If-Match': '*'
        },
        JSON.stringify(patchBody)
    );

    if (patchRes.status === 204 || patchRes.status === 200) {
        console.error(`[mcs-lsp] Metadata patched: ${changes.join(', ')}`);
        return { patched: true, gptComponentId: gptId, name: localName, description: localDesc, changes };
    } else {
        console.error(`[mcs-lsp] Metadata patch failed: HTTP ${patchRes.status} ${JSON.stringify(patchRes.data)}`);
        return { patched: false, error: patchRes.data, gptComponentId: gptId };
    }
}

/**
 * Verify GptComponent body content was synced after push. PATCH fallback if missing.
 *
 * The LSP's syncPush sometimes reports "0 changes" on newly created agents,
 * leaving the GptComponent data field empty despite local modifications.
 * This function verifies the body was actually synced and patches it if not.
 *
 * IMPORTANT: Must query full entity (no $select) because $select=data returns
 * empty for JSON-type columns in Dataverse (same quirk as synchronizationstatus).
 */
async function verifyAndPatchBody(workspacePath) {
    const agentYmlPath = path.join(workspacePath, 'agent.mcs.yml');
    if (!fs.existsSync(agentYmlPath)) return null;

    const localContent = fs.readFileSync(agentYmlPath, 'utf8');

    // Skip if local file is minimal (just kind header, no instructions)
    if (!localContent.includes('instructions:')) return null;

    const connJson = readConnJson(workspacePath);
    const dvUrl = connJson.DataverseEndpoint.replace(/\/$/, '');
    const agentId = connJson.AgentId;
    const token = getAzToken(dvUrl);

    // Find GptComponent via FetchXML (use parentbotid, NOT _parentbotid_value)
    const fetchXml = `<fetch top="1"><entity name="botcomponent"><attribute name="botcomponentid"/><filter><condition attribute="parentbotid" operator="eq" value="${agentId}"/><condition attribute="componenttype" operator="eq" value="15"/></filter></entity></fetch>`;

    const searchRes = await httpRequest('GET',
        `${dvUrl}/api/data/v9.2/botcomponents?fetchXml=${encodeURIComponent(fetchXml)}`,
        { 'Authorization': `Bearer ${token}` },
        null
    );

    if (searchRes.status !== 200 || !searchRes.data.value || searchRes.data.value.length === 0) {
        console.error('[mcs-lsp] No GptComponent found for body verification — skipping');
        return null;
    }

    const gptId = searchRes.data.value[0].botcomponentid;

    // Query FULL entity (no $select — $select=data returns empty for JSON columns)
    const fullRes = await httpRequest('GET',
        `${dvUrl}/api/data/v9.2/botcomponents(${gptId})`,
        { 'Authorization': `Bearer ${token}` },
        null
    );

    if (fullRes.status !== 200) {
        console.error(`[mcs-lsp] Failed to read GptComponent: HTTP ${fullRes.status}`);
        return null;
    }

    const remoteData = fullRes.data.data || '';

    // Check if remote body has instruction content
    const localHasInstructions = localContent.includes('instructions:');
    const remoteHasInstructions = remoteData.includes('instructions:');

    if (localHasInstructions && !remoteHasInstructions) {
        console.error('[mcs-lsp] GptComponent body missing after push — patching via Dataverse fallback...');

        const patchRes = await httpRequest('PATCH',
            `${dvUrl}/api/data/v9.2/botcomponents(${gptId})`,
            {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'If-Match': '*'
            },
            JSON.stringify({ data: localContent })
        );

        if (patchRes.status === 204 || patchRes.status === 200) {
            console.error('[mcs-lsp] Body content patched successfully via Dataverse fallback');
            return { patched: true, gptComponentId: gptId, reason: 'LSP push did not sync body content' };
        } else {
            console.error(`[mcs-lsp] Body patch failed: HTTP ${patchRes.status}`);
            return { patched: false, error: patchRes.data, gptComponentId: gptId };
        }
    }

    return { patched: false, gptComponentId: gptId, reason: 'Body content already present' };
}

// --- Commands ---

/**
 * Push local changes to MCS (local → remote).
 * After LSP push, automatically patches agent metadata (name + description)
 * via Dataverse API since LSP does not sync comment headers.
 * Then verifies body content was synced, with Dataverse PATCH fallback.
 */
async function push(workspacePath, options = {}) {
    const connJson = readConnJson(workspacePath);
    const tokens = getTokens(connJson);
    const syncRequest = buildSyncRequest(workspacePath, connJson, tokens);

    const lspPath = options.lspPath || findLspBinary();
    const client = new LspClient(lspPath);

    let result;
    try {
        // Connect via named pipe or spawn new process
        if (options.pipe === true) {
            await client.startWithPipe();
        } else if (typeof options.pipe === 'string') {
            await client.connect(options.pipe);
        } else {
            client.start();
        }
        await initializeLsp(client, workspacePath);
        await openWorkspaceFiles(client, workspacePath);

        console.error('[mcs-lsp] Pushing local changes to MCS...');
        result = await client.send('powerplatformls/syncPush', syncRequest);

        if (result && result.code && result.code !== 0 && result.code !== 200) {
            throw new Error(`Push failed: ${result.message || JSON.stringify(result)}`);
        }

        console.error('[mcs-lsp] Push completed successfully.');
    } finally {
        await client.shutdown();
    }

    // Patch metadata (name + description) — LSP push skips comment headers
    try {
        const metadataResult = await patchMetadata(workspacePath);
        if (metadataResult) {
            result.metadataPatch = metadataResult;
        }
    } catch (err) {
        console.error(`[mcs-lsp] Metadata patch error (non-fatal): ${err.message}`);
        result.metadataPatch = { patched: false, error: err.message };
    }

    // Verify body content was synced, PATCH fallback if missing (Fix #3: LSP 0-change bug)
    try {
        const bodyResult = await verifyAndPatchBody(workspacePath);
        if (bodyResult) {
            result.bodyPatch = bodyResult;
        }
    } catch (err) {
        console.error(`[mcs-lsp] Body verification error (non-fatal): ${err.message}`);
        result.bodyPatch = { patched: false, error: err.message };
    }

    // Strip comment headers from DialogComponent (topic) data fields.
    // LSP push writes the full file content (including # Name: / # Description: comments)
    // to the data field. MCS visual editor can't render topics with comment headers —
    // it expects data to start with "kind: AdaptiveDialog". (bm-026)
    // NOTE: This is defense-in-depth. Primary topic creation should use Gateway API
    // BotComponentInsert (island-client.js createTopic) which avoids this issue entirely.
    try {
        const stripped = await stripTopicCommentHeaders(workspacePath);
        if (stripped > 0) {
            console.error(`[mcs-lsp] Stripped comment headers from ${stripped} topic(s)`);
            result.topicHeaderStrip = { count: stripped };
        }
    } catch (err) {
        console.error(`[mcs-lsp] Topic header strip error (non-fatal): ${err.message}`);
    }

    return result;
}

/**
 * Pull remote changes from MCS (remote → local).
 */
async function pull(workspacePath, options = {}) {
    const connJson = readConnJson(workspacePath);
    const tokens = getTokens(connJson);
    const syncRequest = buildSyncRequest(workspacePath, connJson, tokens);

    const lspPath = options.lspPath || findLspBinary();
    const client = new LspClient(lspPath);

    try {
        if (options.pipe === true) {
            await client.startWithPipe();
        } else if (typeof options.pipe === 'string') {
            await client.connect(options.pipe);
        } else {
            client.start();
        }
        await initializeLsp(client, workspacePath);
        await openWorkspaceFiles(client, workspacePath);

        console.error('[mcs-lsp] Pulling remote changes from MCS...');
        const result = await client.send('powerplatformls/syncPull', syncRequest);

        if (result && result.code && result.code !== 0 && result.code !== 200) {
            throw new Error(`Pull failed: ${result.message || JSON.stringify(result)}`);
        }

        console.error('[mcs-lsp] Pull completed successfully.');

        // Post-pull cleanup: strip BOMs from settings.mcs.yml and remove Signin.mcs.yml
        postPullCleanup(workspacePath);

        return result;
    } finally {
        await client.shutdown();
    }
}

/**
 * Preview remote changes without applying them.
 */
async function preview(workspacePath, options = {}) {
    const connJson = readConnJson(workspacePath);
    const tokens = getTokens(connJson);
    const syncRequest = buildSyncRequest(workspacePath, connJson, tokens);

    const lspPath = options.lspPath || findLspBinary();
    const client = new LspClient(lspPath);

    try {
        if (options.pipe === true) {
            await client.startWithPipe();
        } else if (typeof options.pipe === 'string') {
            await client.connect(options.pipe);
        } else {
            client.start();
        }
        await initializeLsp(client, workspacePath);
        await openWorkspaceFiles(client, workspacePath);

        console.error('[mcs-lsp] Checking for remote changes...');
        const result = await client.send('powerplatformls/getRemoteChanges', syncRequest);

        return result;
    } finally {
        await client.shutdown();
    }
}

/**
 * Get workspace/agent details from the LSP.
 */
async function info(workspacePath, options = {}) {
    const connJson = readConnJson(workspacePath);
    const fileUri = pathToFileURL(workspacePath).href;

    const lspPath = options.lspPath || findLspBinary();
    const client = new LspClient(lspPath);

    try {
        if (options.pipe === true) {
            await client.startWithPipe();
        } else if (typeof options.pipe === 'string') {
            await client.connect(options.pipe);
        } else {
            client.start();
        }
        await initializeLsp(client, workspacePath);

        console.error('[mcs-lsp] Getting workspace details...');
        const result = await client.send('powerplatformls/getWorkspaceDetails', {
            workspaceUri: fileUri
        });

        return { connJson, workspaceDetails: result };
    } finally {
        await client.shutdown();
    }
}

/**
 * Clone an MCS agent to a local workspace using the LSP's native cloneAgent method.
 * This uses the exact same code path as the VS Code extension's Clone operation —
 * the LSP handles fetching components, converting to YAML, and writing all files.
 *
 * @param {string} workspacePath - Parent directory for the clone (agent subfolder created inside)
 * @param {object} connInfo - Connection info: agentId, displayName, environmentId, dataverseUrl, gatewayUrl, accountEmail, tenantId
 * @param {object} options - { lspPath, accountId, clusterCategory, solutionVersions }
 */
async function clone(workspacePath, connInfo, options = {}) {
    // Validate required fields
    const required = ['agentId', 'environmentId', 'dataverseUrl', 'gatewayUrl', 'accountEmail', 'tenantId'];
    for (const field of required) {
        if (!connInfo[field]) throw new Error(`Missing required field for clone: ${field}`);
    }

    // Create parent directory
    fs.mkdirSync(workspacePath, { recursive: true });

    // Get tokens
    const dvToken = getAzToken(connInfo.dataverseUrl.replace(/\/$/, ''));
    const csToken = getAzToken('96ff4394-9197-43aa-b393-6a41652e21f8');

    // Use the account ID from config, options, or fall back to tenantId
    const accountId = options.accountId || connInfo.accountId ||
        connInfo.tenantId;

    const lspPath = options.lspPath || findLspBinary();
    const client = new LspClient(lspPath);

    try {
        client.start();

        // Initialize LSP with the parent directory as workspace root
        const fileUri = pathToFileURL(workspacePath).href;
        await client.send('initialize', {
            processId: process.pid,
            capabilities: {
                textDocument: { synchronization: { dynamicRegistration: false } },
                workspace: { workspaceFolders: true }
            },
            rootUri: fileUri,
            workspaceFolders: [{ uri: fileUri, name: path.basename(workspacePath) }]
        });
        client.notify('initialized', {});
        await sleep(500);

        console.error(`[mcs-lsp] Cloning agent ${connInfo.agentId} (${connInfo.displayName || 'unnamed'})...`);

        // Call the native cloneAgent method — same as VS Code extension
        const result = await client.send('powerplatformls/cloneAgent', {
            agentInfo: {
                displayName: connInfo.displayName || 'Agent',
                agentId: connInfo.agentId
            },
            assets: {
                cloneAgent: true,
                cloneTopics: true,
                cloneActions: true,
                cloneKnowledge: true,
                clonePlugins: true,
                cloneConnectors: true,
                cloneFlows: true
            },
            rootFolder: pathToFileURL(workspacePath).href,
            environmentInfo: {
                environmentId: connInfo.environmentId,
                dataverseUrl: connInfo.dataverseUrl.replace(/\/?$/, '/'),
                displayName: '',
                agentManagementUrl: connInfo.gatewayUrl.replace(/\/?$/, '/')
            },
            solutionVersions: options.solutionVersions || {
                solutionVersions: {
                    msft_AIPlatformExtensionsComponents: '1.0.0.204',
                    msdyn_RelevanceSearch: '1.0.0.577'
                },
                copilotStudioSolutionVersion: '2026.2.2.19034852'
            },
            accountInfo: {
                accountId,
                tenantId: connInfo.tenantId,
                accountEmail: connInfo.accountEmail,
                clusterCategory: options.clusterCategory || 5
            },
            dataverseAccessToken: dvToken,
            copilotStudioAccessToken: csToken
        });

        if (result && result.code && result.code !== 0 && result.code !== 200) {
            throw new Error(`Clone failed: ${result.message || JSON.stringify(result)}`);
        }

        // The LSP creates a subfolder named after the agent
        const agentFolder = result.agentFolderName || connInfo.displayName || 'Agent';
        const agentPath = path.join(workspacePath, agentFolder);

        // Post-clone cleanup (same fixes as post-pull)
        if (fs.existsSync(agentPath)) {
            postPullCleanup(agentPath);
        }

        // Re-count after cleanup
        const finalFiles = fs.existsSync(agentPath) ? findMcsYmlFiles(agentPath) : [];
        console.error(`[mcs-lsp] Clone complete: ${finalFiles.length} .mcs.yml files in "${agentFolder}"`);

        return { agentFolderName: agentFolder, agentPath, fileCount: finalFiles.length, result };
    } finally {
        await client.shutdown();
    }
}

/**
 * Load connection info from session-config.json for a given account/environment.
 * Returns { accountEmail, tenantId, environmentId, dataverseUrl, gatewayUrl, accountId, clusterCategory }
 */
function loadConnInfoFromConfig(accountLabel, envName) {
    const configPaths = [
        path.join(process.cwd(), 'tools', 'session-config.json'),
        path.join(__dirname, 'session-config.json')
    ];

    for (const configPath of configPaths) {
        try {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (!config.accounts) continue;

            for (const account of config.accounts) {
                const matchAccount = !accountLabel ||
                    account.label === accountLabel ||
                    account.id === accountLabel ||
                    account.tenant === accountLabel;
                if (!matchAccount) continue;

                for (const env of account.environments || []) {
                    const matchEnv = !envName ||
                        env.name === envName ||
                        env.environmentId === envName;
                    if (!matchEnv) continue;

                    // Get tenant ID from az CLI if not derivable
                    let tenantId;
                    try {
                        tenantId = execSync(
                            'az account show --query tenantId -o tsv',
                            { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
                        ).trim();
                    } catch {
                        tenantId = account.id; // fallback
                    }

                    return {
                        accountEmail: account.label,
                        tenantId,
                        environmentId: env.environmentId,
                        dataverseUrl: env.dataverseUrl,
                        gatewayUrl: env.gatewayUrl || null,
                        accountId: account.id,
                        clusterCategory: 5
                    };
                }
            }
        } catch { /* config not found */ }
    }
    return null;
}

// --- Post-Pull Cleanup ---

/**
 * Fix known issues in files written by the LSP during pull/clone:
 * 1. Strip UTF-8 BOMs from settings.mcs.yml (causes schema name errors on push)
 * 2. Remove Signin.mcs.yml if it has a trailing space in the display name
 *    (system topic "Sign in " generates invalid Dataverse schema names)
 * 3. Remove default Lesson template topics (Lesson1, Lesson2, Lesson3)
 *    (MCS creates these sample topics with every new agent — store hours, locator, ordering)
 */
function postPullCleanup(workspacePath) {
    let fixes = 0;

    // Strip BOMs from settings.mcs.yml
    const settingsPath = path.join(workspacePath, 'settings.mcs.yml');
    if (fs.existsSync(settingsPath)) {
        const data = fs.readFileSync(settingsPath);
        const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
        let clean = data;
        let bomCount = 0;
        let idx;
        while ((idx = clean.indexOf(BOM)) !== -1) {
            clean = Buffer.concat([clean.slice(0, idx), clean.slice(idx + 3)]);
            bomCount++;
        }
        if (bomCount > 0) {
            fs.writeFileSync(settingsPath, clean);
            if (VERBOSE) console.error(`[mcs-lsp] Stripped ${bomCount} BOM(s) from settings.mcs.yml`);
            fixes++;
        }
    }

    // Remove Signin.mcs.yml if display name has trailing space
    const signinPath = path.join(workspacePath, 'topics', 'Signin.mcs.yml');
    if (fs.existsSync(signinPath)) {
        const content = fs.readFileSync(signinPath, 'utf8');
        if (content.includes('# Name: Sign in ') || content.match(/# Name:.*\s\n/)) {
            fs.unlinkSync(signinPath);
            if (VERBOSE) console.error('[mcs-lsp] Removed Signin.mcs.yml (trailing space in display name)');
            fixes++;
        }
    }

    // Remove MCS default Lesson template topics (Lesson1, Lesson2, Lesson3)
    // These are sample topics MCS creates with every new agent and should be cleaned up
    const topicsDir = path.join(workspacePath, 'topics');
    if (fs.existsSync(topicsDir)) {
        const lessonPattern = /^Lesson\d+\.mcs\.yml$/i;
        try {
            const topicFiles = fs.readdirSync(topicsDir);
            for (const file of topicFiles) {
                if (lessonPattern.test(file)) {
                    fs.unlinkSync(path.join(topicsDir, file));
                    if (VERBOSE) console.error(`[mcs-lsp] Removed default template topic: ${file}`);
                    fixes++;
                }
            }
        } catch { /* topics dir read error — non-fatal */ }
    }

    if (fixes > 0 && !VERBOSE) {
        console.error(`[mcs-lsp] Post-pull cleanup: ${fixes} fix(es) applied`);
    }
}




// --- CLI ---

function parseArgs() {
    const args = process.argv.slice(2);
    const config = {};

    if (args.length === 0 || args[0] === '--help') {
        printUsage();
        process.exit(0);
    }

    config.command = args[0];

    for (let i = 1; i < args.length; i++) {
        switch (args[i]) {
            case '--workspace': config.workspace = args[++i]; break;
            case '--lsp-path': config.lspPath = args[++i]; break;
            case '--pipe': config.pipe = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true; break;
            case '--json': config.json = true; break;
            // Clone-specific args
            case '--agent-id': config.agentId = args[++i]; break;
            case '--agent-name': config.agentName = args[++i]; break;
            case '--env-id': config.envId = args[++i]; break;
            case '--dataverse-url': config.dataverseUrl = args[++i]; break;
            case '--gateway-url': config.gatewayUrl = args[++i]; break;
            case '--account': config.account = args[++i]; break;
            case '--env-name': config.envName = args[++i]; break;
            case '--help': printUsage(); process.exit(0);
        }
    }

    return config;
}

function printUsage() {
    console.log(`MCS Language Server Wrapper — headless push/pull/clone for Copilot Studio agents

Usage: node mcs-lsp.js <command> --workspace <path> [options]

Commands:
  push       Push local .mcs.yml files to MCS (local → remote)
  pull       Pull remote agent state to local .mcs.yml files (remote → local)
  preview    Preview remote changes without applying them
  info       Show workspace and agent connection details
  clone      Clone an MCS agent to a new local workspace

Required:
  --workspace <path>   Path to workspace (existing for push/pull/preview/info, new for clone)

Clone-specific (required for clone):
  --agent-id <guid>    MCS agent ID (CDS bot ID)
  --env-id <id>        Environment ID
  --dataverse-url <url> Dataverse endpoint URL
  --gateway-url <url>  Island gateway URL

Clone-specific (optional — auto-resolved from session-config.json):
  --account <label>    Account label/ID (matches session-config.json)
  --env-name <name>    Environment name (matches session-config.json)

Optional:
  --lsp-path <path>    Override path to LanguageServerHost.exe
  --pipe [path]        Use named pipe transport instead of stdio. Two modes:
                       (no path) Spawn LSP with a new pipe (clean channel, no log noise)
                       (path)    Connect to an existing pipe (e.g., VS Code's running LSP)
  --json               Output raw JSON results
  --help               Show this help

Environment:
  MCS_LSP_VERBOSE=1    Enable verbose LSP protocol logging to stderr

Prerequisites:
  1. Copilot Studio VS Code extension installed (ms-copilotstudio.vscode-copilotstudio)
  2. az CLI logged in (az login) for token acquisition

Examples:
  # Clone with explicit params
  node tools/mcs-lsp.js clone --workspace "./Clone/MyAgent" --agent-id "2ae13d0e-..." --env-id "f9a0cae4-..." --dataverse-url "https://org.crm.dynamics.com" --gateway-url "https://powervamg.us-il301.gateway.prod.island.powerapps.com"

  # Clone using session-config.json defaults
  node tools/mcs-lsp.js clone --workspace "./Clone/MyAgent" --agent-id "2ae13d0e-..." --account "admin@M365CPI15209943.onmicrosoft.com" --env-name "dktest"

  # Push/pull/preview/info
  node tools/mcs-lsp.js push --workspace "./Clone/MyAgent"
  node tools/mcs-lsp.js pull --workspace "./Clone/MyAgent"
  node tools/mcs-lsp.js preview --workspace "./Clone/MyAgent"
  node tools/mcs-lsp.js info --workspace "./Clone/MyAgent"`);
}

async function main() {
    const config = parseArgs();

    if (!config.workspace) {
        console.error('Error: --workspace is required.');
        process.exit(2);
    }

    // Resolve workspace path
    const workspace = path.resolve(config.workspace);

    // For clone, workspace doesn't need to exist yet. For other commands, it does.
    if (config.command !== 'clone' && !fs.existsSync(workspace)) {
        console.error(`Error: Workspace not found: ${workspace}`);
        process.exit(2);
    }

    const options = {};
    if (config.lspPath) options.lspPath = config.lspPath;
    if (config.pipe) options.pipe = config.pipe;

    try {
        switch (config.command) {
            case 'push': {
                const result = await push(workspace, options);
                if (config.json) {
                    console.log(JSON.stringify(result, null, 2));
                } else {
                    if (result && result.localChanges) {
                        console.log(`Push result: ${result.localChanges.length} local changes synced`);
                    } else {
                        console.log('Push completed.');
                    }
                }
                break;
            }

            case 'pull': {
                const result = await pull(workspace, options);
                if (config.json) {
                    console.log(JSON.stringify(result, null, 2));
                } else {
                    console.log('Pull completed. Local files updated from remote.');
                }
                break;
            }

            case 'preview': {
                const result = await preview(workspace, options);
                if (config.json) {
                    console.log(JSON.stringify(result, null, 2));
                } else {
                    if (result && result.localChanges && result.localChanges.length > 0) {
                        console.log(`Remote changes detected: ${result.localChanges.length} file(s)`);
                        for (const change of result.localChanges) {
                            console.log(`  ${change.changeType || 'modified'}: ${change.path || change.uri || JSON.stringify(change)}`);
                        }
                    } else {
                        console.log('No remote changes detected. Local workspace is up to date.');
                    }
                }
                break;
            }

            case 'info': {
                const result = await info(workspace, options);
                if (config.json) {
                    console.log(JSON.stringify(result, null, 2));
                } else {
                    const conn = result.connJson;
                    console.log('Workspace Info:');
                    console.log(`  Agent ID:       ${conn.AgentId}`);
                    console.log(`  Environment:    ${conn.EnvironmentId}`);
                    console.log(`  Dataverse:      ${conn.DataverseEndpoint}`);
                    console.log(`  Gateway:        ${conn.AgentManagementEndpoint}`);
                    console.log(`  Account:        ${conn.AccountInfo?.AccountEmail || 'unknown'}`);
                    console.log(`  Tenant:         ${conn.AccountInfo?.TenantId || 'unknown'}`);
                    console.log(`  MCS Version:    ${conn.SolutionVersions?.CopilotStudioSolutionVersion || 'unknown'}`);
                    const files = findMcsYmlFiles(workspace);
                    console.log(`  Local files:    ${files.length} .mcs.yml files`);
                    if (result.workspaceDetails) {
                        console.log(`\nLSP Workspace Details:`);
                        console.log(JSON.stringify(result.workspaceDetails, null, 2));
                    }
                }
                break;
            }

            case 'clone': {
                // Resolve connection info — from explicit args or session-config.json
                let connInfo;

                if (config.agentId && config.envId && config.dataverseUrl && config.gatewayUrl) {
                    // All explicit — get tenant/account from az CLI
                    let tenantId;
                    try {
                        tenantId = execSync('az account show --query tenantId -o tsv',
                            { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
                    } catch {
                        console.error('Error: Could not get tenant ID from az CLI. Run: az login');
                        process.exit(2);
                    }
                    let accountEmail;
                    try {
                        accountEmail = execSync('az account show --query user.name -o tsv',
                            { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
                    } catch {
                        accountEmail = 'unknown';
                    }
                    connInfo = {
                        agentId: config.agentId,
                        displayName: config.agentName || 'Agent',
                        environmentId: config.envId,
                        dataverseUrl: config.dataverseUrl,
                        gatewayUrl: config.gatewayUrl,
                        accountEmail,
                        tenantId
                    };
                } else if (config.agentId && (config.account || config.envName)) {
                    // Resolve from session-config.json
                    const resolved = loadConnInfoFromConfig(config.account, config.envName);
                    if (!resolved) {
                        console.error('Error: Could not find matching account/environment in session-config.json');
                        console.error('Provide explicit --env-id, --dataverse-url, and --gateway-url instead.');
                        process.exit(2);
                    }
                    if (!resolved.gatewayUrl) {
                        console.error('Error: No gateway URL in session-config.json for this environment.');
                        console.error('Provide --gateway-url explicitly.');
                        process.exit(2);
                    }
                    connInfo = { ...resolved, agentId: config.agentId, displayName: config.agentName || 'Agent' };
                } else {
                    console.error('Error: clone requires --agent-id plus either:');
                    console.error('  (a) --env-id, --dataverse-url, --gateway-url (explicit)');
                    console.error('  (b) --account and/or --env-name (resolve from session-config.json)');
                    process.exit(2);
                }

                const cloneResult = await clone(workspace, connInfo, options);
                if (config.json) {
                    console.log(JSON.stringify(cloneResult, null, 2));
                } else {
                    console.log(`Clone complete: ${cloneResult.fileCount} files in ${cloneResult.agentPath}`);
                }
                break;
            }

            default:
                console.error(`Unknown command: ${config.command}`);
                printUsage();
                process.exit(2);
        }
    } catch (err) {
        console.error(`\nError: ${err.message}`);
        if (VERBOSE && err.stack) console.error(err.stack);
        process.exit(1);
    }
}

// --- Module Exports (for programmatic use) ---
module.exports = {
    LspClient,
    findLspBinary,
    readConnJson,
    getTokens,
    buildSyncRequest,
    push,
    pull,
    preview,
    info,
    clone,
    patchMetadata,
    loadConnInfoFromConfig,
    findMcsYmlFiles
};

// Run CLI if invoked directly
if (require.main === module) {
    main().catch(err => {
        console.error('Fatal:', err.message);
        process.exit(2);
    });
}
