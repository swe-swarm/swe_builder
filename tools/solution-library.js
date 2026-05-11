/**
 * Solution Library CLI
 *
 * Manages the team's SharePoint "Solution & Demo Library" — list, download,
 * analyze, search, scan, refresh, and upload MCS agent solutions.
 *
 * Knowledge layer: analysis results cached in knowledge/solutions/ (committed).
 * Raw zips downloaded to OS temp dir and cleaned up after analysis.
 *
 * Follows the island-client.js CLI pattern: parseArgs(), command switch,
 * module.exports for programmatic use.
 *
 * Auth: az account get-access-token --resource https://graph.microsoft.com
 *       (delegated, via az login)
 *
 * Usage:
 *   node tools/solution-library.js list [--json]
 *   node tools/solution-library.js download --name "Claims Processing Agent" [--output <dir>]
 *   node tools/solution-library.js search --query "healthcare claims" [--json]
 *   node tools/solution-library.js analyze --name "Claims Processing Agent" [--json]
 *   node tools/solution-library.js scan [--json]
 *   node tools/solution-library.js refresh [--all] [--json]
 *   node tools/solution-library.js upload --project <id> --agent <id> [--name "Display Name"]
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const {
    getGraphToken,
    listDriveItems,
    downloadFile,
    uploadFile,
    createFolder,
    DEFAULT_DRIVE_ID,
    SITE_WEB_URL
} = require('./lib/graph-sharepoint');

const { httpRequest } = require('./lib/http');

// --- Paths ---

const REPO_ROOT = path.resolve(__dirname, '..');
const SOLUTIONS_DIR = path.join(REPO_ROOT, 'knowledge', 'solutions');
const INDEX_PATH = path.join(SOLUTIONS_DIR, 'index.json');
const CACHE_DIR = path.join(SOLUTIONS_DIR, 'cache');

// --- Auth Validation ---

/**
 * Validate that the Graph token has access to the Solution Library.
 * Fails fast with a clear error instead of cryptic 403s mid-operation.
 * @param {string} token - Graph token
 * @returns {Promise<void>}
 */
async function validateLibraryAccess(token) {
    try {
        const url = `https://graph.microsoft.com/v1.0/drives/${DEFAULT_DRIVE_ID}/root?$select=name,id`;
        const res = await httpRequest('GET', url, {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });
        if (res.status === 401 || res.status === 403) {
            throw new Error(
                `Access denied to Solution Library (HTTP ${res.status}).\n` +
                `Your token does not have access to the Builder PMs SharePoint.\n` +
                `Fix: az login --tenant 72f988bf-86f1-41af-91ab-2d7cd011db47`
            );
        }
        if (res.status !== 200) {
            throw new Error(`Unexpected status ${res.status} checking library access: ${JSON.stringify(res.data)}`);
        }
    } catch (err) {
        if (err.message.includes('Access denied') || err.message.includes('Unexpected status')) throw err;
        throw new Error(`Cannot validate library access: ${err.message}`);
    }
}

// --- Index Management ---

/**
 * Load the solution index from disk.
 * @returns {object} Index object with version, lastScanned, lastRefreshed, solutions[]
 */
function loadIndex() {
    try {
        return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
    } catch {
        return { version: 2, lastScanned: null, lastRefreshed: null, solutions: [] };
    }
}

/**
 * Save the solution index to disk.
 * @param {object} index - Index object
 */
function saveIndex(index) {
    if (!fs.existsSync(SOLUTIONS_DIR)) {
        fs.mkdirSync(SOLUTIONS_DIR, { recursive: true });
    }
    fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2) + '\n', 'utf8');
}

/**
 * Load a per-solution cache file.
 * @param {string} solutionId - Solution ID (e.g. "sol-abc123")
 * @returns {object|null}
 */
function loadSolutionCache(solutionId) {
    const filePath = path.join(CACHE_DIR, `${solutionId}.json`);
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

/**
 * Save a per-solution cache file.
 * @param {string} solutionId - Solution ID
 * @param {object} data - Analysis data to cache
 */
function saveSolutionCache(solutionId, data) {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    const filePath = path.join(CACHE_DIR, `${solutionId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/**
 * Find a solution in the index by folder name (case-insensitive partial match).
 * @param {object} index
 * @param {string} name
 * @returns {object|null}
 */
function findSolution(index, name) {
    const lower = name.toLowerCase();
    return index.solutions.find(s =>
        s.folderName.toLowerCase() === lower ||
        s.folderName.toLowerCase().includes(lower)
    ) || null;
}

/**
 * Create a temp directory for downloading/extracting solution zips.
 * @returns {string} Temp directory path
 */
function makeTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'mcs-solution-'));
}

/**
 * Clean up a temp directory (best effort).
 * @param {string} dir
 */
function cleanupTempDir(dir) {
    try {
        execSync(`powershell -NoProfile -Command "Remove-Item -Recurse -Force '${dir}'"`, { stdio: 'pipe' });
    } catch { /* best effort */ }
}

// --- List Command ---

/**
 * List all top-level folders in the Solution & Demo Library.
 * @param {string} token - Graph token
 * @returns {Promise<Array>} Array of folder items
 */
async function listSolutions(token) {
    const items = await listDriveItems(token, null, DEFAULT_DRIVE_ID, {
        select: 'name,id,size,folder,file,lastModifiedDateTime,webUrl',
        top: 200
    });

    return items
        .filter(item => item.folder)
        .map(item => ({
            name: item.name,
            id: item.id,
            webUrl: item.webUrl,
            lastModified: item.lastModifiedDateTime,
            childCount: item.folder.childCount
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

// --- Download Command ---

/**
 * Download all files from a solution folder to a local directory.
 * @param {string} token - Graph token
 * @param {string} folderName - Exact or partial folder name
 * @param {string} [outputDir] - Local directory (defaults to OS temp dir)
 * @returns {Promise<{folder: string, folderId: string, files: Array, localDir: string}>}
 */
async function downloadSolution(token, folderName, outputDir) {
    const folders = await listSolutions(token);
    const match = folders.find(f =>
        f.name.toLowerCase() === folderName.toLowerCase() ||
        f.name.toLowerCase().includes(folderName.toLowerCase())
    );

    if (!match) {
        throw new Error(`No folder matching "${folderName}" found. Use 'list' to see available solutions.`);
    }

    const files = await listDriveItems(token, match.name, DEFAULT_DRIVE_ID, {
        select: 'name,id,size,file,lastModifiedDateTime'
    });

    const targetDir = outputDir || makeTempDir();
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    const downloaded = [];
    for (const file of files) {
        if (!file.file) continue;
        const localPath = path.join(targetDir, file.name);
        console.error(`  Downloading: ${file.name} (${formatBytes(file.size)})...`);
        const result = await downloadFile(token, file.id, localPath, DEFAULT_DRIVE_ID);
        downloaded.push({
            name: file.name,
            size: result.size,
            path: result.path,
            type: classifyFileType(file.name)
        });
    }

    return { folder: match.name, folderId: match.id, files: downloaded, localDir: targetDir };
}

// --- Scan Command ---

/**
 * Lightweight scan: compare SharePoint folder listing against index.
 * Returns delta without downloading anything (1 API call).
 *
 * @param {string} token - Graph token
 * @returns {Promise<{total: number, indexed: number, new: Array, updated: Array, removed: Array}>}
 */
async function scanSolutions(token) {
    const folders = await listSolutions(token);
    const index = loadIndex();

    const indexedByFolderId = new Map(index.solutions.map(s => [s.folderId, s]));
    const remoteFolderIds = new Set(folders.map(f => f.id));

    const newSolutions = [];
    const updatedSolutions = [];
    const removedSolutions = [];

    for (const folder of folders) {
        const existing = indexedByFolderId.get(folder.id);
        if (!existing) {
            newSolutions.push({ name: folder.name, id: folder.id, lastModified: folder.lastModified });
        } else if (existing.lastModified && folder.lastModified &&
                   new Date(folder.lastModified) > new Date(existing.lastModified)) {
            updatedSolutions.push({
                name: folder.name, id: folder.id,
                lastModified: folder.lastModified,
                lastAnalyzed: existing.lastAnalyzed
            });
        }
    }

    for (const sol of index.solutions) {
        if (!remoteFolderIds.has(sol.folderId)) {
            removedSolutions.push({ name: sol.folderName, id: sol.folderId });
        }
    }

    // Update lastScanned
    index.lastScanned = new Date().toISOString();
    saveIndex(index);

    return {
        total: folders.length,
        indexed: index.solutions.length,
        new: newSolutions,
        updated: updatedSolutions,
        removed: removedSolutions
    };
}

// --- Analyze Command ---

/**
 * Analyze a solution: list files (metadata only), download ONLY zips to temp,
 * extract, parse, cache result, cleanup. Skips large non-zip files (pptx, docx).
 *
 * @param {string} token - Graph token
 * @param {string} folderName - Solution folder name
 * @returns {Promise<object>} Analysis result
 */
async function analyzeSolution(token, folderName) {
    // Find the folder
    const folders = await listSolutions(token);
    const match = folders.find(f =>
        f.name.toLowerCase() === folderName.toLowerCase() ||
        f.name.toLowerCase().includes(folderName.toLowerCase())
    );
    if (!match) {
        throw new Error(`No folder matching "${folderName}" found. Use 'list' to see available solutions.`);
    }

    // List files — get metadata without downloading
    const remoteFiles = await listDriveItems(token, match.name, DEFAULT_DRIVE_ID, {
        select: 'name,id,size,file,lastModifiedDateTime'
    });

    const fileEntries = remoteFiles
        .filter(f => f.file)
        .map(f => ({ name: f.name, size: f.size, type: classifyFileType(f.name) }));

    // Find zip files to download
    const zipItems = remoteFiles.filter(f => f.file && classifyFileType(f.name) === 'solution');

    if (zipItems.length === 0) {
        const result = {
            folderName: match.name,
            folderId: match.id,
            files: fileEntries,
            error: 'No solution .zip file found in folder',
            solution: null,
            agents: [],
            componentCounts: {},
            connectionReferences: [],
            environmentVariables: []
        };
        updateIndexEntry(result);
        return result;
    }

    // Download ONLY zip files to temp dir
    const tempDir = makeTempDir();
    try {
        const analyses = [];
        for (const zipItem of zipItems) {
            const localPath = path.join(tempDir, zipItem.name);
            console.error(`  Downloading: ${zipItem.name} (${formatBytes(zipItem.size)})...`);
            await downloadFile(token, zipItem.id, localPath, DEFAULT_DRIVE_ID);
            const analysis = await extractAndParseSolution(localPath, tempDir);
            analyses.push(analysis);
        }

        const primary = analyses[0] || {};

        const result = {
            folderName: match.name,
            folderId: match.id,
            analyzedAt: new Date().toISOString(),
            files: fileEntries,
            solution: primary.solution || null,
            agents: primary.agents || [],
            componentCounts: primary.componentCounts || {},
            connectionReferences: primary.connectionReferences || [],
            environmentVariables: primary.environmentVariables || []
        };

        updateIndexEntry(result);
        return result;
    } finally {
        cleanupTempDir(tempDir);
    }
}

/**
 * Extract a solution .zip and parse customizations.xml for metadata.
 */
async function extractAndParseSolution(zipPath, baseDir) {
    const extractDir = path.join(baseDir, '_extracted');

    if (fs.existsSync(extractDir)) {
        execSync(`powershell -NoProfile -Command "Remove-Item -Recurse -Force '${extractDir}'"`, { stdio: 'pipe' });
    }

    try {
        execSync(
            `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force"`,
            { stdio: 'pipe', timeout: 60000 }
        );
    } catch (err) {
        return { error: `Failed to extract zip: ${err.message}`, solution: null, agents: [] };
    }

    const solutionInfo = parseSolutionXml(path.join(extractDir, 'solution.xml'));
    const customizations = parseCustomizationsXml(path.join(extractDir, 'customizations.xml'));

    try {
        execSync(`powershell -NoProfile -Command "Remove-Item -Recurse -Force '${extractDir}'"`, { stdio: 'pipe' });
    } catch { /* best effort cleanup */ }

    return {
        solution: solutionInfo,
        agents: customizations.agents,
        componentCounts: customizations.componentCounts,
        connectionReferences: customizations.connectionReferences,
        environmentVariables: customizations.environmentVariables
    };
}

function parseSolutionXml(filePath) {
    if (!fs.existsSync(filePath)) return null;

    try {
        const psScript = `
$xml = [xml](Get-Content -Raw '${filePath.replace(/'/g, "''")}')
$sol = $xml.ImportExportXml.SolutionManifest
@{
    uniqueName = $sol.UniqueName
    version = $sol.Version
    managed = [int]$sol.Managed
    publisherName = $sol.Publisher.UniqueName
    displayName = $sol.LocalizedNames.LocalizedName.'#text'
} | ConvertTo-Json
`;
        const psTempFile = path.join(os.tmpdir(), `mcs-sol-${Date.now()}.ps1`);
        fs.writeFileSync(psTempFile, psScript, 'utf8');
        const result = execSync(
            `powershell -NoProfile -ExecutionPolicy Bypass -File "${psTempFile}"`,
            { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15000 }
        );
        try { fs.unlinkSync(psTempFile); } catch { /* ok */ }
        return JSON.parse(result.trim());
    } catch {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const getName = (tag) => {
                const m = content.match(new RegExp(`<${tag}>([^<]+)</${tag}>`));
                return m ? m[1] : null;
            };
            return {
                uniqueName: getName('UniqueName'),
                version: getName('Version'),
                managed: content.includes('<Managed>1</Managed>') ? 1 : 0,
                publisherName: null,
                displayName: null
            };
        } catch {
            return null;
        }
    }
}

function parseCustomizationsXml(filePath) {
    const result = {
        agents: [],
        componentCounts: {},
        connectionReferences: [],
        environmentVariables: []
    };

    if (!fs.existsSync(filePath)) return result;

    try {
        // Write PS script to temp file to avoid escaping issues
        const psScript = `
$xml = [xml](Get-Content -Raw '${filePath.replace(/'/g, "''")}')
$output = @{ agents = @(); componentTypes = @{}; connRefs = @(); envVars = @() }

$entities = $xml.ImportExportXml.Entities.Entity
foreach ($entity in $entities) {
    $name = $entity.Name
    if ($name -eq 'bot') {
        $records = $entity.records.record
        foreach ($rec in $records) {
            $fields = @{}
            foreach ($field in $rec.field) {
                $fields[$field.name] = $field.value
            }
            $output.agents += @{
                name = $fields['name']
                schemaName = $fields['schemaname']
                botId = $rec.id
            }
        }
    }
}

$botCompEntity = $entities | Where-Object { $_.Name -eq 'botcomponent' }
if ($botCompEntity) {
    $records = $botCompEntity.records.record
    foreach ($rec in $records) {
        foreach ($field in $rec.field) {
            if ($field.name -eq 'componenttype') {
                $typeVal = $field.value
                if ($output.componentTypes.ContainsKey($typeVal)) {
                    $output.componentTypes[$typeVal] = $output.componentTypes[$typeVal] + 1
                } else {
                    $output.componentTypes[$typeVal] = 1
                }
            }
        }
    }
}

$connRefEntity = $entities | Where-Object { $_.Name -eq 'connectionreference' }
if ($connRefEntity) {
    foreach ($rec in $connRefEntity.records.record) {
        foreach ($field in $rec.field) {
            if ($field.name -eq 'connectionreferencelogicalname') {
                $output.connRefs += $field.value
            }
        }
    }
}

$envVarEntity = $entities | Where-Object { $_.Name -eq 'environmentvariabledefinition' }
if ($envVarEntity) {
    foreach ($rec in $envVarEntity.records.record) {
        foreach ($field in $rec.field) {
            if ($field.name -eq 'schemaname') {
                $output.envVars += $field.value
            }
        }
    }
}

$output | ConvertTo-Json -Depth 5
`;
        const psTempFile = path.join(os.tmpdir(), `mcs-parse-${Date.now()}.ps1`);
        fs.writeFileSync(psTempFile, psScript, 'utf8');

        const psResult = execSync(
            `powershell -NoProfile -ExecutionPolicy Bypass -File "${psTempFile}"`,
            { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 }
        );

        try { fs.unlinkSync(psTempFile); } catch { /* ok */ }

        const parsed = JSON.parse(psResult.trim());

        const typeMap = {
            '0': 'topics', '1': 'skills', '2': 'triggers', '3': 'variables',
            '4': 'entities', '5': 'dialogs', '6': 'actions', '7': 'knowledge',
            '8': 'customGpt', '9': 'connectedAgents'
        };

        result.agents = Array.isArray(parsed.agents) ? parsed.agents : [parsed.agents].filter(Boolean);

        if (parsed.componentTypes) {
            for (const [code, count] of Object.entries(parsed.componentTypes)) {
                const friendlyName = typeMap[code] || `type_${code}`;
                result.componentCounts[friendlyName] = count;
            }
        }

        result.connectionReferences = Array.isArray(parsed.connRefs) ? parsed.connRefs : [parsed.connRefs].filter(Boolean);
        result.environmentVariables = Array.isArray(parsed.envVars) ? parsed.envVars : [parsed.envVars].filter(Boolean);
    } catch (err) {
        console.error(`  Warning: XML parsing failed — ${err.message}`);
    }

    return result;
}

// --- Refresh Command (Delta Deep-Analysis) ---

/**
 * Delta refresh: scan SharePoint, deep-analyze only new/changed solutions.
 * Like om-cli auto-update — only processes what changed since last refresh.
 *
 * @param {string} token - Graph token
 * @param {boolean} [all=false] - If true, re-analyze ALL solutions (force full refresh)
 * @returns {Promise<{scanned: number, analyzed: string[], skipped: number, removed: string[]}>}
 */
async function refreshSolutions(token, all) {
    const folders = await listSolutions(token);
    const index = loadIndex();

    const indexedByFolderId = new Map(index.solutions.map(s => [s.folderId, s]));
    const remoteFolderIds = new Set(folders.map(f => f.id));

    const analyzed = [];
    let skipped = 0;

    for (const folder of folders) {
        const existing = indexedByFolderId.get(folder.id);

        const isNew = !existing;
        const isUpdated = existing && existing.lastModified && folder.lastModified &&
                          new Date(folder.lastModified) > new Date(existing.lastModified);
        const notAnalyzed = existing && existing.analysisDepth !== 'deep';

        if (all || isNew || isUpdated || notAnalyzed) {
            console.error(`\n${isNew ? 'NEW' : isUpdated ? 'UPDATED' : notAnalyzed ? 'UNANALYZED' : 'FORCE'}: ${folder.name}`);

            try {
                await analyzeSolution(token, folder.name);
                analyzed.push(folder.name);
            } catch (err) {
                console.error(`  Error analyzing ${folder.name}: ${err.message}`);
                // Update basic metadata even on failure — write directly to index
                if (!existing) {
                    const errorIndex = loadIndex();
                    errorIndex.solutions.push({
                        id: generateId(),
                        folderName: folder.name,
                        folderId: folder.id,
                        folderUrl: folder.webUrl,
                        lastModified: folder.lastModified,
                        lastAnalyzed: null,
                        analysisDepth: 'error',
                        solution: null, agents: [], files: [],
                        tags: {}, instructionPatterns: []
                    });
                    saveIndex(errorIndex);
                }
            }
        } else {
            skipped++;
        }
    }

    // Re-read index after all analyses (analyzeSolution saves independently)
    const updatedIndex = loadIndex();

    // Remove entries for deleted SharePoint folders + their cache files
    const removed = [];
    updatedIndex.solutions = updatedIndex.solutions.filter(s => {
        if (!remoteFolderIds.has(s.folderId)) {
            removed.push(s.folderName);
            // Clean up cache file
            const cachePath = path.join(CACHE_DIR, `${s.id}.json`);
            try { fs.unlinkSync(cachePath); } catch { /* ok */ }
            return false;
        }
        return true;
    });

    updatedIndex.lastScanned = new Date().toISOString();
    updatedIndex.lastRefreshed = new Date().toISOString();
    saveIndex(updatedIndex);

    return { scanned: folders.length, analyzed, skipped, removed };
}

// --- Index Entry Management ---

/**
 * Update a single index entry + write per-solution cache file after analysis.
 * @param {object} analysisResult - Output from analyzeSolution()
 */
function updateIndexEntry(analysisResult) {
    const index = loadIndex();
    const existing = index.solutions.find(s => s.folderId === analysisResult.folderId);

    const id = existing ? existing.id : generateId();
    const now = new Date().toISOString();

    const entry = {
        id,
        folderName: analysisResult.folderName,
        folderId: analysisResult.folderId,
        folderUrl: existing ? existing.folderUrl : null,
        lastModified: analysisResult.analyzedAt || now,
        lastAnalyzed: now,
        analysisDepth: analysisResult.error ? 'error' : 'deep',
        solution: analysisResult.solution,
        agents: (analysisResult.agents || []).map(a => ({
            name: a.name,
            schemaName: a.schemaName,
            componentCounts: analysisResult.componentCounts
        })),
        files: analysisResult.files || [],
        tags: existing ? existing.tags : {},
        instructionPatterns: existing ? existing.instructionPatterns : []
    };

    const idx = index.solutions.findIndex(s => s.folderId === analysisResult.folderId);
    if (idx >= 0) {
        index.solutions[idx] = entry;
    } else {
        index.solutions.push(entry);
    }

    index.lastRefreshed = now;
    saveIndex(index);

    // Write per-solution cache file with full analysis details
    saveSolutionCache(id, {
        ...entry,
        componentCounts: analysisResult.componentCounts || {},
        connectionReferences: analysisResult.connectionReferences || [],
        environmentVariables: analysisResult.environmentVariables || [],
        error: analysisResult.error || null
    });
}

// --- Search Command ---

/**
 * Search the solution index + cache files for matching solutions.
 * @param {string} query - Search query
 * @returns {Array} Matching solutions with relevance scores
 */
function searchIndex(query) {
    const index = loadIndex();
    const terms = query.toLowerCase().split(/\s+/);

    return index.solutions
        .map(sol => {
            let score = 0;
            const searchable = [
                sol.folderName,
                sol.solution ? sol.solution.uniqueName : '',
                sol.solution ? sol.solution.displayName : '',
                ...sol.agents.map(a => a.name || ''),
                ...sol.agents.map(a => a.schemaName || ''),
                ...(sol.tags.industry || []),
                ...(sol.tags.capabilities || []),
                ...(sol.tags.tools || []),
                ...(sol.tags.knowledgeTypes || []),
                sol.tags.architectureType || '',
                ...(sol.instructionPatterns || [])
            ].map(s => (s || '').toLowerCase());

            for (const term of terms) {
                for (const field of searchable) {
                    if (field.includes(term)) {
                        score++;
                    }
                }
            }

            return { ...sol, _score: score };
        })
        .filter(sol => sol._score > 0)
        .sort((a, b) => b._score - a._score);
}

// --- Upload Command ---

async function uploadSolution(token, projectId, agentId, displayName) {
    const agentDir = path.join(REPO_ROOT, 'Build-Guides', projectId, 'agents', agentId);
    const briefPath = path.join(agentDir, 'brief.json');

    if (!fs.existsSync(briefPath)) {
        throw new Error(`No brief.json found at ${briefPath}`);
    }

    const brief = JSON.parse(fs.readFileSync(briefPath, 'utf8'));
    const agentName = brief.agent ? brief.agent.displayName : agentId;
    const folderName = displayName || `${agentName} - ${projectId}`;

    const solutionName = brief.buildStatus ? brief.buildStatus.solutionName : null;
    let zipPath = null;

    if (solutionName) {
        const exportDir = path.join(agentDir, '_export');
        if (!fs.existsSync(exportDir)) {
            fs.mkdirSync(exportDir, { recursive: true });
        }
        zipPath = path.join(exportDir, `${solutionName}.zip`);

        console.error(`Exporting solution "${solutionName}"...`);
        try {
            execSync(
                `pac solution export --name "${solutionName}" --path "${zipPath}" --managed --overwrite`,
                { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 120000 }
            );
        } catch (err) {
            console.error(`  Warning: pac solution export failed — ${err.message}`);
            zipPath = null;
        }
    }

    console.error(`Creating folder: ${folderName}`);
    await createFolder(token, '', folderName);

    const uploaded = [];

    if (zipPath && fs.existsSync(zipPath)) {
        console.error(`Uploading solution zip...`);
        const result = await uploadFile(token, folderName, path.basename(zipPath), zipPath);
        uploaded.push({ name: path.basename(zipPath), type: 'solution', result });
    }

    const reportPath = path.join(agentDir, 'build-report.md');
    if (fs.existsSync(reportPath)) {
        console.error(`Uploading build report...`);
        const result = await uploadFile(token, folderName, 'build-report.md', reportPath);
        uploaded.push({ name: 'build-report.md', type: 'report', result });
    }

    console.error(`Uploading brief.json...`);
    const briefResult = await uploadFile(token, folderName, 'brief.json', briefPath);
    uploaded.push({ name: 'brief.json', type: 'brief', result: briefResult });

    // Generate and upload design-spec.md (human-readable spec card)
    const specContent = generateDesignSpec(brief);
    const specPath = path.join(agentDir, 'design-spec.md');
    fs.writeFileSync(specPath, specContent, 'utf8');
    console.error(`Uploading design-spec.md...`);
    const specResult = await uploadFile(token, folderName, 'design-spec.md', specPath);
    uploaded.push({ name: 'design-spec.md', type: 'spec', result: specResult });

    // Auto-index: scan SharePoint for the new folder, update local index
    let indexed = false;
    try {
        const folders = await listSolutions(token);
        const match = folders.find(f => f.name === folderName);
        if (match) {
            const index = loadIndex();
            const existing = index.solutions.find(s => s.folderId === match.id);
            if (existing) {
                existing.lastModified = match.lastModified;
                existing.lastAnalyzed = new Date().toISOString();
                existing.analysisDepth = 'uploaded';
                existing.files = uploaded.map(u => ({ name: u.name, type: u.type }));
            } else {
                index.solutions.push({
                    id: generateId(),
                    folderName,
                    folderId: match.id,
                    folderUrl: match.webUrl || null,
                    lastModified: match.lastModified,
                    lastAnalyzed: new Date().toISOString(),
                    analysisDepth: 'uploaded',
                    solution: { displayName: agentName },
                    agents: [{ name: agentName, schemaName: null }],
                    files: uploaded.map(u => ({ name: u.name, type: u.type })),
                    tags: {},
                    instructionPatterns: []
                });
            }
            index.lastScanned = new Date().toISOString();
            saveIndex(index);
            indexed = true;
            console.error(`Indexed in knowledge/solutions/index.json`);
        }
    } catch (err) {
        console.error(`  Warning: auto-index failed — ${err.message}`);
    }

    return { folder: folderName, uploaded, indexed };
}

// --- Design Spec Generation ---

/**
 * Generate a human-readable design spec markdown from a brief.json object.
 * This is the "spec card" other team members see when browsing the SharePoint library.
 *
 * @param {object} brief - Parsed brief.json object
 * @returns {string} Markdown string
 */
function generateDesignSpec(brief) {
    const lines = [];
    const agentName = brief.agent ? brief.agent.displayName || brief.agent.name : 'Unknown Agent';
    const desc = brief.agent ? brief.agent.description : '';

    lines.push(`# Design Spec: ${agentName}`);
    lines.push('');
    if (desc) lines.push(`> ${desc}`);
    lines.push('');
    lines.push(`**Generated:** ${new Date().toISOString().substring(0, 10)}`);
    lines.push('');

    // Capabilities (MVP table)
    const caps = (brief.capabilities || []).filter(c => c.phase === 'mvp');
    if (caps.length > 0) {
        lines.push('## Capabilities (MVP)');
        lines.push('');
        lines.push('| Capability | Type | Description |');
        lines.push('|------------|------|-------------|');
        for (const c of caps) {
            const implType = c.implementationType || '—';
            const cdesc = (c.description || '').substring(0, 80).replace(/\|/g, '/');
            lines.push(`| ${c.name} | ${implType} | ${cdesc} |`);
        }
        lines.push('');
    }

    // Integrations
    const integrations = (brief.integrations || []).filter(i => i.phase === 'mvp');
    if (integrations.length > 0) {
        lines.push('## Integrations');
        lines.push('');
        lines.push('| Tool | Type | Purpose |');
        lines.push('|------|------|---------|');
        for (const i of integrations) {
            const purpose = (i.purpose || '').substring(0, 60).replace(/\|/g, '/');
            lines.push(`| ${i.name} | ${i.type || '—'} | ${purpose} |`);
        }
        lines.push('');
    }

    // Architecture
    if (brief.architecture) {
        lines.push('## Architecture');
        lines.push('');
        lines.push(`- **Type:** ${brief.architecture.type || 'single-agent'}`);
        if (brief.architecture.solutionType) lines.push(`- **Solution Type:** ${brief.architecture.solutionType}`);
        if (brief.agent && brief.agent.recommendedModel) lines.push(`- **Model:** ${brief.agent.recommendedModel}`);
        if (brief.architecture.reason) lines.push(`- **Rationale:** ${brief.architecture.reason}`);
        lines.push('');
    }

    // Boundaries
    if (brief.boundaries) {
        const refuse = brief.boundaries.refuse || [];
        const decline = brief.boundaries.decline || [];
        if (refuse.length > 0 || decline.length > 0) {
            lines.push('## Boundaries');
            lines.push('');
            if (refuse.length > 0) {
                lines.push('**Hard boundaries (refuse):**');
                for (const b of refuse) lines.push(`- ${typeof b === 'string' ? b : b.topic || b}`);
            }
            if (decline.length > 0) {
                lines.push('**Soft boundaries (decline):**');
                for (const b of decline) lines.push(`- ${typeof b === 'string' ? b : b.topic || b}`);
            }
            lines.push('');
        }
    }

    // Knowledge sources
    const knowledge = (brief.knowledge || []).filter(k => k.phase === 'mvp');
    if (knowledge.length > 0) {
        lines.push('## Knowledge Sources');
        lines.push('');
        for (const k of knowledge) {
            lines.push(`- **${k.name}** (${k.type || 'unknown'}) — ${k.purpose || ''}`);
        }
        lines.push('');
    }

    // Eval summary
    const evalSets = brief.evalSets || [];
    if (evalSets.length > 0) {
        lines.push('## Eval Summary');
        lines.push('');
        lines.push('| Set | Tests | Threshold | Pass Rate |');
        lines.push('|-----|-------|-----------|-----------|');
        for (const es of evalSets) {
            const tests = es.tests || [];
            const total = tests.length;
            const passed = tests.filter(t => t.lastResult && t.lastResult.passed).length;
            const tested = tests.filter(t => t.lastResult).length;
            const rate = tested > 0 ? `${Math.round(passed / tested * 100)}%` : 'not run';
            lines.push(`| ${es.name} | ${total} | ${es.passThreshold || '—'}% | ${rate} |`);
        }
        lines.push('');
    }

    lines.push('---');
    lines.push('*Generated by MCS Agent Builder*');
    return lines.join('\n');
}

// --- Utility Functions ---

function classifyFileType(name) {
    const ext = path.extname(name).toLowerCase();
    if (ext === '.zip') return 'solution';
    if (ext === '.pptx' || ext === '.ppt') return 'presentation';
    if (ext === '.docx' || ext === '.doc') return 'document';
    if (ext === '.pdf') return 'pdf';
    if (ext === '.md') return 'markdown';
    if (ext === '.json') return 'json';
    if (['.png', '.jpg', '.jpeg', '.gif'].includes(ext)) return 'image';
    return 'other';
}

function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let val = bytes;
    while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
    return `${val.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function generateId() {
    return 'sol-' + Math.random().toString(36).substring(2, 8);
}

/**
 * Get freshness status of the solution index.
 * @returns {{lastScanned: string|null, lastRefreshed: string|null, daysSinceScanned: number|null, daysSinceRefreshed: number|null, status: string}}
 */
function getFreshness() {
    const index = loadIndex();
    const now = Date.now();

    const daysSince = (dateStr) => dateStr ? Math.floor((now - new Date(dateStr).getTime()) / 86400000) : null;

    const daysSinceScanned = daysSince(index.lastScanned);
    const daysSinceRefreshed = daysSince(index.lastRefreshed);

    let status = 'unknown';
    if (daysSinceScanned === null) {
        status = 'never-scanned';
    } else if (daysSinceScanned <= 7) {
        status = 'fresh';
    } else if (daysSinceScanned <= 30) {
        status = 'stale';
    } else {
        status = 'expired';
    }

    return {
        lastScanned: index.lastScanned,
        lastRefreshed: index.lastRefreshed,
        solutionCount: index.solutions.length,
        analyzedCount: index.solutions.filter(s => s.analysisDepth === 'deep').length,
        daysSinceScanned,
        daysSinceRefreshed,
        status
    };
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
            case '--name': config.name = args[++i]; break;
            case '--query': config.query = args[++i]; break;
            case '--output': config.output = args[++i]; break;
            case '--project': config.project = args[++i]; break;
            case '--agent': config.agent = args[++i]; break;
            case '--json': config.json = true; break;
            case '--all': config.all = true; break;
            case '--help': printUsage(); process.exit(0);
        }
    }

    return config;
}

function printUsage() {
    console.log(`Solution Library CLI — Manage team SharePoint solution library

Usage: node tools/solution-library.js <command> [options]

Commands:
  list                       List all solution folders in SharePoint
  download --name <name>     Download a solution folder locally
  search --query <text>      Search the local solution index
  analyze --name <name>      Download + extract + parse a single solution
  scan                       Lightweight delta check (1 API call, no downloads)
  refresh [--all]            Delta deep-analyze new/changed solutions
  freshness                  Show index freshness status
  upload --project <id> --agent <id>  Export + upload solution to SharePoint

Options:
  --name <name>       Solution folder name (exact or partial match)
  --query <text>      Search query (matches names, tags, patterns)
  --output <dir>      Output directory for downloads
  --project <id>      Project ID for upload
  --agent <id>        Agent ID for upload
  --json              Output raw JSON
  --all               Force full re-analyze (refresh command)

Examples:
  node tools/solution-library.js list
  node tools/solution-library.js scan
  node tools/solution-library.js refresh
  node tools/solution-library.js refresh --all
  node tools/solution-library.js analyze --name "Claims Processing"
  node tools/solution-library.js search --query "healthcare"
  node tools/solution-library.js upload --project MyProject --agent claims-agent`);
}

async function main() {
    const config = parseArgs();

    try {
        // Commands that need SharePoint access — get token + validate once
        const spCommands = ['list', 'download', 'analyze', 'scan', 'refresh', 'upload'];
        let token;
        if (spCommands.includes(config.command)) {
            token = getGraphToken();
            await validateLibraryAccess(token);
        }

        switch (config.command) {
            case 'list': {
                const folders = await listSolutions(token);

                if (config.json) {
                    console.log(JSON.stringify(folders, null, 2));
                } else {
                    console.log(`Solution Library (${folders.length} solutions)\n`);
                    console.log('  Name                                         Modified              Items');
                    console.log('  ' + '-'.repeat(75));
                    for (const f of folders) {
                        const date = f.lastModified ? f.lastModified.substring(0, 10) : 'unknown';
                        const name = f.name.substring(0, 44).padEnd(44);
                        console.log(`  ${name} ${date}     ${f.childCount || '?'}`);
                    }
                    console.log(`\n  Source: ${SITE_WEB_URL}`);
                }
                break;
            }

            case 'download': {
                if (!config.name) {
                    console.error('Error: --name is required for download');
                    process.exit(2);
                }

                console.error(`Downloading solution: ${config.name}`);
                const result = await downloadSolution(token, config.name, config.output);

                if (config.json) {
                    console.log(JSON.stringify(result, null, 2));
                } else {
                    console.log(`Downloaded: ${result.folder}`);
                    console.log(`Location: ${result.localDir}`);
                    console.log(`Files: ${result.files.length}`);
                    for (const f of result.files) {
                        console.log(`  ${f.name} (${formatBytes(f.size)}) [${f.type}]`);
                    }
                }
                break;
            }

            case 'search': {
                if (!config.query) {
                    console.error('Error: --query is required for search');
                    process.exit(2);
                }
                const results = searchIndex(config.query);

                if (config.json) {
                    console.log(JSON.stringify(results, null, 2));
                } else {
                    if (results.length === 0) {
                        console.log(`No solutions matching "${config.query}" found in index.`);
                        console.log('Run "refresh" command first to build the index.');
                    } else {
                        console.log(`Search results for "${config.query}" (${results.length} matches)\n`);
                        for (const sol of results) {
                            const agents = sol.agents.map(a => a.name || a.schemaName).join(', ') || 'unknown';
                            const tags = [...(sol.tags.industry || []), ...(sol.tags.capabilities || [])].join(', ');
                            console.log(`  ${sol.folderName} (score: ${sol._score})`);
                            if (sol.solution) console.log(`    Solution: ${sol.solution.uniqueName} v${sol.solution.version}`);
                            console.log(`    Agents: ${agents}`);
                            if (tags) console.log(`    Tags: ${tags}`);
                            console.log('');
                        }
                    }
                }
                break;
            }

            case 'analyze': {
                if (!config.name) {
                    console.error('Error: --name is required for analyze');
                    process.exit(2);
                }

                console.error(`Analyzing solution: ${config.name}`);
                const result = await analyzeSolution(token, config.name);

                if (config.json) {
                    console.log(JSON.stringify(result, null, 2));
                } else {
                    console.log(`\nAnalysis: ${result.folderName}\n`);
                    if (result.solution) {
                        console.log(`Solution: ${result.solution.uniqueName || result.solution.displayName}`);
                        console.log(`Version: ${result.solution.version}`);
                        console.log(`Managed: ${result.solution.managed ? 'Yes' : 'No'}`);
                        if (result.solution.publisherName) console.log(`Publisher: ${result.solution.publisherName}`);
                    }
                    if (result.agents.length > 0) {
                        console.log(`\nAgents (${result.agents.length}):`);
                        for (const a of result.agents) {
                            console.log(`  ${a.name || 'unnamed'} (${a.schemaName || 'no schema'})`);
                        }
                    }
                    if (Object.keys(result.componentCounts).length > 0) {
                        console.log('\nComponents:');
                        for (const [type, count] of Object.entries(result.componentCounts)) {
                            console.log(`  ${type}: ${count}`);
                        }
                    }
                    if (result.connectionReferences.length > 0) {
                        console.log(`\nConnection References: ${result.connectionReferences.join(', ')}`);
                    }
                    if (result.environmentVariables.length > 0) {
                        console.log(`\nEnvironment Variables: ${result.environmentVariables.join(', ')}`);
                    }
                    console.log(`\nFiles: ${result.files.length}`);
                    console.log(`Cached to: knowledge/solutions/cache/`);
                }
                break;
            }

            case 'scan': {

                console.error('Scanning SharePoint for changes...');
                const result = await scanSolutions(token);

                if (config.json) {
                    console.log(JSON.stringify(result, null, 2));
                } else {
                    console.log(`Solution Library Scan\n`);
                    console.log(`  SharePoint: ${result.total} folders`);
                    console.log(`  Indexed:    ${result.indexed} solutions\n`);
                    if (result.new.length > 0) {
                        console.log(`  NEW (${result.new.length}):`);
                        for (const s of result.new) console.log(`    + ${s.name} (${s.lastModified.substring(0, 10)})`);
                    }
                    if (result.updated.length > 0) {
                        console.log(`  UPDATED (${result.updated.length}):`);
                        for (const s of result.updated) console.log(`    ~ ${s.name} (modified ${s.lastModified.substring(0, 10)})`);
                    }
                    if (result.removed.length > 0) {
                        console.log(`  REMOVED (${result.removed.length}):`);
                        for (const s of result.removed) console.log(`    - ${s.name}`);
                    }
                    if (result.new.length === 0 && result.updated.length === 0 && result.removed.length === 0) {
                        console.log('  No changes detected.');
                    } else {
                        console.log(`\n  Run "refresh" to deep-analyze changes.`);
                    }
                }
                break;
            }

            case 'refresh': {

                console.error(`Refreshing solution index${config.all ? ' (full re-analyze)' : ' (delta)'}...`);
                const result = await refreshSolutions(token, config.all);

                if (config.json) {
                    console.log(JSON.stringify(result, null, 2));
                } else {
                    console.log(`Solution Library Refresh\n`);
                    console.log(`  Scanned: ${result.scanned} folders`);
                    console.log(`  Analyzed: ${result.analyzed.length} solutions`);
                    console.log(`  Skipped (unchanged): ${result.skipped}`);
                    if (result.removed.length > 0) {
                        console.log(`  Removed: ${result.removed.length}`);
                    }
                    if (result.analyzed.length > 0) {
                        console.log(`\n  Analyzed:`);
                        for (const name of result.analyzed) console.log(`    ${name}`);
                    }
                    console.log(`\n  Index: ${INDEX_PATH}`);
                    console.log(`  Cache: ${CACHE_DIR}`);
                }
                break;
            }

            case 'freshness': {
                const info = getFreshness();

                if (config.json) {
                    console.log(JSON.stringify(info, null, 2));
                } else {
                    console.log(`Solution Library Freshness\n`);
                    console.log(`  Solutions: ${info.solutionCount} indexed, ${info.analyzedCount} deep-analyzed`);
                    console.log(`  Last scanned: ${info.lastScanned || 'never'} (${info.daysSinceScanned !== null ? info.daysSinceScanned + ' days ago' : 'n/a'})`);
                    console.log(`  Last refreshed: ${info.lastRefreshed || 'never'} (${info.daysSinceRefreshed !== null ? info.daysSinceRefreshed + ' days ago' : 'n/a'})`);
                    console.log(`  Status: ${info.status}`);
                }
                break;
            }

            case 'upload': {
                if (!config.project || !config.agent) {
                    console.error('Error: --project and --agent are required for upload');
                    process.exit(2);
                }

                console.error(`Uploading solution for ${config.project}/${config.agent}...`);
                const result = await uploadSolution(token, config.project, config.agent, config.name);

                if (config.json) {
                    console.log(JSON.stringify(result, null, 2));
                } else {
                    console.log(`\nUploaded to: ${result.folder}`);
                    console.log(`Files uploaded: ${result.uploaded.length}`);
                    for (const u of result.uploaded) {
                        console.log(`  ${u.name} [${u.type}]`);
                    }
                    console.log(`Indexed: ${result.indexed ? 'yes' : 'no'}`);
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
        process.exit(1);
    }
}

// --- Module Exports (for programmatic use) ---

module.exports = {
    loadIndex,
    saveIndex,
    loadSolutionCache,
    saveSolutionCache,
    findSolution,
    listSolutions,
    downloadSolution,
    scanSolutions,
    analyzeSolution,
    refreshSolutions,
    searchIndex,
    uploadSolution,
    updateIndexEntry,
    generateDesignSpec,
    getFreshness,
    INDEX_PATH,
    CACHE_DIR
};

// Run CLI if invoked directly
if (require.main === module) {
    main().catch(err => {
        console.error('Fatal:', err.message);
        process.exit(2);
    });
}
