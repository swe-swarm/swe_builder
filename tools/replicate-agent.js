/**
 * Cross-Environment Agent Replication
 *
 * Clones an MCS agent from one environment to another via Dataverse + LSP.
 * Copies instructions, model config, topics, and knowledge sources.
 * Actions/tools are reported but NOT copied (connection refs differ per env).
 *
 * Flow: Read source → Create bot → Clone empty target → Copy source files → Push
 *
 * Usage:
 *   node tools/replicate-agent.js \
 *     --source-workspace "Build-Guides/CAT/agents/Briefing/workspace/Daily Briefing" \
 *     --target-env-id "887dbd81-..." \
 *     --target-dataverse-url "https://org.crm.dynamics.com" \
 *     --target-gateway-url "https://powervamg.us-il104.gateway.prod.island.powerapps.com/" \
 *     --agent-name "Daily Briefing"
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { httpRequest, getToken, sleep } = require('./lib/http');
const lsp = require('./mcs-lsp');

// --- Arg Parsing ---

function parseArgs() {
    const args = process.argv.slice(2);
    const config = {};

    if (args.length === 0 || args.includes('--help')) {
        printUsage();
        process.exit(0);
    }

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--source-workspace': config.sourceWorkspace = args[++i]; break;
            case '--target-env-id': config.targetEnvId = args[++i]; break;
            case '--target-dataverse-url': config.targetDataverseUrl = args[++i]; break;
            case '--target-gateway-url': config.targetGatewayUrl = args[++i]; break;
            case '--agent-name': config.agentName = args[++i]; break;
            case '--schema-prefix': config.schemaPrefix = args[++i]; break;
            case '--clone-dir': config.cloneDir = args[++i]; break;
        }
    }

    return config;
}

function printUsage() {
    console.log(`Cross-Environment Agent Replication

Usage: node tools/replicate-agent.js [options]

Required:
  --source-workspace <path>     Source agent workspace (contains agent.mcs.yml)
  --target-env-id <guid>        Target environment ID
  --target-dataverse-url <url>  Target Dataverse URL (e.g. https://org.crm.dynamics.com)
  --target-gateway-url <url>    Target Island Gateway URL
  --agent-name <name>           Display name for the replicated agent

Optional:
  --schema-prefix <prefix>      Schema name prefix (default: cr509)
  --clone-dir <path>            Directory for target clone (default: ./Clone)
  --help                        Show this help

Flow:
  1. Read source workspace (instructions, topics, knowledge, actions)
  2. Create new bot in target environment via Dataverse API
  3. Clone empty target bot via LSP (creates correct conn.json)
  4. Copy source files into cloned workspace (agent.mcs.yml, topics, knowledge)
  5. Push to target via LSP
  6. Report: what was replicated, what needs manual setup

Example:
  node tools/replicate-agent.js \\
    --source-workspace "Build-Guides/CAT/agents/Briefing/workspace/Daily Briefing" \\
    --target-env-id "887dbd81-..." \\
    --target-dataverse-url "https://org.crm.dynamics.com" \\
    --target-gateway-url "https://powervamg.us-il104.gateway.prod.island.powerapps.com/" \\
    --agent-name "Daily Briefing"`);
}

// --- Helpers ---

function listYmlFiles(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter(f => f.endsWith('.mcs.yml'))
        .map(f => path.join(dir, f));
}


const DV_HEADERS = (token) => ({
    Authorization: `Bearer ${token}`,
    'OData-MaxVersion': '4.0',
    'OData-Version': '4.0'
});

// --- Step 1: Read source workspace ---

function readSource(sourcePath) {
    const agentYml = path.join(sourcePath, 'agent.mcs.yml');
    if (!fs.existsSync(agentYml)) {
        throw new Error(`Source workspace missing agent.mcs.yml: ${sourcePath}`);
    }

    return {
        agentYml,
        topics: listYmlFiles(path.join(sourcePath, 'topics')),
        knowledge: listYmlFiles(path.join(sourcePath, 'knowledge')),
        actions: listYmlFiles(path.join(sourcePath, 'actions'))
    };
}

// --- Step 2: Create bot in target Dataverse + PvaProvision ---

async function createBot(dvUrl, token, agentName, schemaPrefix) {
    const sanitized = agentName.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    const schemaName = `${schemaPrefix}_${sanitized}_${Date.now().toString(36)}`;

    console.log(`  Creating bot "${agentName}" (schema: ${schemaName})...`);

    const body = {
        name: agentName,
        schemaname: schemaName,
        language: 1033,
        runtimeprovider: 0,
        authenticationmode: 0,
        accesscontrolpolicy: 0,
        configuration: JSON.stringify({
            aISettings: { model: { modelNameHint: 'gpt-4o' } },
            settings: { GenerativeActionsEnabled: true }
        })
    };

    const res = await httpRequest('POST', `${dvUrl}/api/data/v9.2/bots`,
        DV_HEADERS(token), body);

    if (res.status !== 201 && res.status !== 204) {
        throw new Error(`Bot creation failed (HTTP ${res.status}): ${JSON.stringify(res.data)}`);
    }

    // Extract bot ID from OData-EntityId header
    const entityIdHeader = res.headers['odata-entityid'] || '';
    const match = entityIdHeader.match(/bots\(([0-9a-f-]+)\)/i);
    if (!match) throw new Error(`Could not extract bot ID from response: ${entityIdHeader}`);
    const botId = match[1];
    console.log(`  Bot created: ${botId}`);

    // PvaProvision
    console.log('  Provisioning bot...');
    const provRes = await httpRequest('POST',
        `${dvUrl}/api/data/v9.2/bots(${botId})/Microsoft.Dynamics.CRM.PvaProvision`,
        DV_HEADERS(token), {});

    if (provRes.status !== 200 && provRes.status !== 204) {
        throw new Error(`PvaProvision failed (HTTP ${provRes.status}): ${JSON.stringify(provRes.data)}`);
    }

    // Poll for provisioned status (statuscode 1 = Provisioned, 3 = Provisioning)
    console.log('  Waiting for provisioning...');
    for (let i = 0; i < 20; i++) {
        await sleep(3000);
        const statusRes = await httpRequest('GET',
            `${dvUrl}/api/data/v9.2/bots(${botId})?$select=statuscode`,
            DV_HEADERS(token), null);

        if (statusRes.data?.statuscode === 1) {
            console.log('  Bot provisioned successfully.');
            return { botId, schemaName };
        }
    }

    throw new Error('Bot provisioning timed out after 60s');
}

// --- Step 3: Clone target bot via LSP ---

async function cloneTarget(cloneDir, botId, agentName, connInfo) {
    console.log('  Cloning target bot workspace...');

    const result = await lsp.clone(cloneDir, {
        agentId: botId,
        displayName: agentName,
        ...connInfo
    });

    console.log(`  Clone complete: ${result.fileCount} files at ${result.agentPath}`);
    return result.agentPath;
}

// --- Step 4: Copy source files to target workspace ---

function copySourceFiles(source, targetWorkspace) {
    let copied = 0;

    // agent.mcs.yml (instructions, model, capabilities)
    fs.copyFileSync(source.agentYml, path.join(targetWorkspace, 'agent.mcs.yml'));
    copied++;

    // Topics
    const targetTopics = path.join(targetWorkspace, 'topics');
    fs.mkdirSync(targetTopics, { recursive: true });
    for (const f of source.topics) {
        fs.copyFileSync(f, path.join(targetTopics, path.basename(f)));
        copied++;
    }

    // Knowledge
    const targetKnowledge = path.join(targetWorkspace, 'knowledge');
    fs.mkdirSync(targetKnowledge, { recursive: true });
    for (const f of source.knowledge) {
        fs.copyFileSync(f, path.join(targetKnowledge, path.basename(f)));
        copied++;
    }

    console.log(`  Copied ${copied} files (agent + ${source.topics.length} topics + ${source.knowledge.length} knowledge)`);
    return copied;
}

// --- Step 7: Report ---

function printReport(agentName, source, botId, schemaName, targetWorkspace) {
    console.log('\n' + '='.repeat(60));
    console.log('REPLICATION REPORT');
    console.log('='.repeat(60));
    console.log(`\nAgent: ${agentName}`);
    console.log(`Target Bot ID: ${botId}`);
    console.log(`Target Schema: ${schemaName}`);
    console.log(`Target Workspace: ${targetWorkspace}`);

    console.log('\n--- Replicated ---');
    console.log('  Instructions + Model: agent.mcs.yml');
    console.log(`  Topics: ${source.topics.length} file(s)`);
    for (const t of source.topics) console.log(`    - ${path.basename(t)}`);
    console.log(`  Knowledge: ${source.knowledge.length} file(s)`);
    for (const k of source.knowledge) console.log(`    - ${path.basename(k)}`);

    if (source.actions.length > 0) {
        console.log('\n--- Needs Manual Setup (tools/actions) ---');
        console.log('  Actions NOT copied (connection refs differ per environment).');
        console.log('  Re-add these tools in the target environment:');
        for (const a of source.actions) console.log(`    - ${path.basename(a)}`);
    }

    console.log('\n--- Verify Manually ---');
    console.log('  [ ] Model selection matches source');
    console.log('  [ ] Authentication settings correct for target env');
    console.log('  [ ] Publish the agent in target environment');
    if (source.actions.length > 0) {
        console.log('  [ ] Re-configure tools/connectors listed above');
    }
    console.log('='.repeat(60));
}

// --- Main ---

async function main() {
    const config = parseArgs();

    // Validate required args
    for (const [flag, key] of [
        ['--source-workspace', 'sourceWorkspace'],
        ['--target-env-id', 'targetEnvId'],
        ['--target-dataverse-url', 'targetDataverseUrl'],
        ['--target-gateway-url', 'targetGatewayUrl'],
        ['--agent-name', 'agentName']
    ]) {
        if (!config[key]) {
            console.error(`Error: ${flag} is required.`);
            process.exit(2);
        }
    }

    const sourcePath = path.resolve(config.sourceWorkspace);
    const dvUrl = config.targetDataverseUrl.replace(/\/$/, '');
    const schemaPrefix = config.schemaPrefix || 'cr509';
    const cloneDir = path.resolve(config.cloneDir || './Clone');

    // Get Azure CLI context
    let tenantId, accountEmail;
    try {
        tenantId = execSync('az account show --query tenantId -o tsv',
            { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        accountEmail = execSync('az account show --query user.name -o tsv',
            { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
        console.error('Error: az CLI not logged in. Run: az login');
        process.exit(2);
    }

    console.log(`\nReplicating "${config.agentName}" to ${dvUrl}`);
    console.log(`  Account: ${accountEmail} | Tenant: ${tenantId}\n`);

    // Step 1: Read source
    console.log('Step 1/5: Reading source workspace...');
    const source = readSource(sourcePath);
    console.log(`  Found: agent.mcs.yml, ${source.topics.length} topics, ${source.knowledge.length} knowledge, ${source.actions.length} actions`);

    // Step 2: Create bot
    console.log('\nStep 2/5: Creating bot in target environment...');
    const dvToken = getToken(dvUrl);
    const { botId, schemaName } = await createBot(dvUrl, dvToken, config.agentName, schemaPrefix);

    // Step 3: Clone target bot
    console.log('\nStep 3/5: Cloning target bot workspace...');
    const connInfo = {
        environmentId: config.targetEnvId,
        dataverseUrl: dvUrl + '/',
        gatewayUrl: config.targetGatewayUrl,
        accountEmail,
        tenantId
    };
    const targetWorkspace = await cloneTarget(cloneDir, botId, config.agentName, connInfo);

    // Step 4: Copy source files
    console.log('\nStep 4/5: Copying source files to target...');
    copySourceFiles(source, targetWorkspace);

    // Step 5: Push
    console.log('\nStep 5/5: Pushing to target environment...');
    await lsp.push(targetWorkspace);

    // Report
    printReport(config.agentName, source, botId, schemaName, targetWorkspace);
}

main().catch(err => {
    console.error(`\nFatal: ${err.message}`);
    if (process.env.MCS_LSP_VERBOSE === '1' && err.stack) console.error(err.stack);
    process.exit(1);
});
