/**
 * Power CAT Copilot Studio Kit Test Runner
 *
 * Runs evaluation tests using the Power CAT Copilot Studio Kit entities in Dataverse.
 * This is the same test framework the MCS team uses for internal validation.
 *
 * The Power CAT Kit provides:
 *   - Dataverse-tracked test runs (cat_copilottestruns)
 *   - Server-side test execution via bound action (cat_RunCopilotTests)
 *   - Test results with latency, match type, and reasoning (cat_copilottestresults)
 *   - Dashboard-ready data in the MCS testing solution
 *
 * Prerequisites:
 *   - Power CAT Copilot Studio Kit solution installed in the environment
 *   - Agent configuration (cat_copilotconfigurations) and test set (cat_copilottestsets) created
 *   - User with read/write access to cat_copilottestrun* entities
 *
 * Usage:
 *   node tools/powercat-test.js run --env <envUrl> --config-id <guid> --set-id <guid>
 *   node tools/powercat-test.js run --env <envUrl> --config-id <guid> --set-id <guid> --name "Sprint 42"
 *   node tools/powercat-test.js results --env <envUrl> --run-id <guid> [--csv <output.csv>]
 *   node tools/powercat-test.js list-configs --env <envUrl>
 *   node tools/powercat-test.js list-sets --env <envUrl> --config-id <guid>
 *
 * Exit codes:
 *   0 = tests passed (success rate >= threshold)
 *   1 = tests failed (success rate < threshold)
 *   2 = fatal error
 */

const fs = require('fs');
const { httpRequest, httpRequestWithRetry, getToken, sleep } = require('./lib/http');

// --- Status Codes (from Power CAT Kit schema) ---
const RUN_STATUS = {
    1: 'Not Run',
    2: 'Running',
    3: 'Complete',
    4: 'Not Available',
    5: 'Pending',
    6: 'Error'
};

const ANALYSIS_STATUS = {
    1: 'Pending',
    2: 'Running',
    3: 'Complete',
    4: 'Error'
};

const RESULT_CODE = {
    1: 'Success',
    2: 'Failed',
    3: 'Unknown',
    4: 'Error',
    5: 'Pending'
};

const TEST_TYPE = {
    1: 'Response Match',
    2: 'Topic Match',
    3: 'Attachments',
    4: 'Generative Answers',
    5: 'Multi-turn',
    6: 'Plan Validation'
};

// --- Configuration ---
const POLL_INTERVAL_MS = 20000; // 20 seconds between status checks
const MAX_POLL_TIME_MS = 600000; // 10 minutes max wait
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateGuid(value, name) {
    if (!value || !GUID_RE.test(value)) {
        console.error(`Error: ${name} must be a valid GUID (got: ${value})`);
        process.exit(2);
    }
    return value;
}

// --- CLI ---
function parseArgs() {
    const args = process.argv.slice(2);
    const config = { threshold: 0.7 };

    if (args.length === 0 || args[0] === '--help') {
        printUsage();
        process.exit(0);
    }

    config.command = args[0];

    for (let i = 1; i < args.length; i++) {
        switch (args[i]) {
            case '--env': config.envUrl = args[++i]; break;
            case '--config-id': config.configId = args[++i]; break;
            case '--set-id': config.setId = args[++i]; break;
            case '--run-id': config.runId = args[++i]; break;
            case '--name': config.runName = args[++i]; break;
            case '--csv': config.csvPath = args[++i]; break;
            case '--json': config.json = true; break;
            case '--threshold': {
                const val = parseFloat(args[++i]);
                config.threshold = Number.isFinite(val) && val >= 0 && val <= 1 ? val : 0.7;
                break;
            }
            case '--brief': config.briefPath = args[++i]; break;
            case '--help': printUsage(); process.exit(0);
        }
    }

    return config;
}

function printUsage() {
    console.log(`Power CAT Copilot Studio Kit Test Runner

Usage: node powercat-test.js <command> [options]

Commands:
  run              Create and execute a test run
  results          Download results for a completed test run
  list-configs     List agent configurations in the environment
  list-sets        List test sets for an agent configuration

Required:
  --env <url>      Dataverse environment URL (e.g., https://org.crm.dynamics.com)

Run options:
  --config-id <id> Agent configuration ID (cat_copilotconfigurationid)
  --set-id <id>    Test set ID (cat_copilottestsetid)
  --name <name>    Test run display name (default: "Eval <timestamp>")
  --threshold <n>  Pass threshold 0.0-1.0 (default: 0.7 = 70%)
  --brief <path>   Write results back to brief.json evalSets

Results options:
  --run-id <id>    Test run ID to download results for
  --csv <path>     Export results to CSV file
  --json           Output raw JSON

Examples:
  node powercat-test.js list-configs --env https://org.crm.dynamics.com
  node powercat-test.js run --env https://org.crm.dynamics.com --config-id abc --set-id def
  node powercat-test.js results --env https://org.crm.dynamics.com --run-id xyz --csv results.csv`);
}

// --- Dataverse Helpers ---

function buildHeaders(token) {
    return {
        'Authorization': `Bearer ${token}`,
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0',
        'Accept': 'application/json',
        'Prefer': 'odata.include-annotations="*"'
    };
}

// --- Commands ---

/**
 * List agent configurations (cat_copilotconfigurations) in the environment.
 */
async function listConfigs(envUrl, headers) {
    const url = `${envUrl}/api/data/v9.2/cat_copilotconfigurations?$select=cat_copilotconfigurationid,cat_name,cat_description,createdon&$orderby=createdon desc`;
    const res = await httpRequestWithRetry('GET', url, headers);
    if (res.status !== 200) throw new Error(`Failed to list configs: HTTP ${res.status}`);
    return res.data.value || [];
}

/**
 * List test sets (cat_copilottestsets) for an agent configuration.
 */
async function listSets(envUrl, headers, configId) {
    const url = `${envUrl}/api/data/v9.2/cat_copilottestsets?$filter=_cat_copilotconfigurationid_value eq '${configId}'&$select=cat_copilottestsetid,cat_name,cat_description,createdon&$orderby=createdon desc`;
    const res = await httpRequestWithRetry('GET', url, headers);
    if (res.status !== 200) throw new Error(`Failed to list test sets: HTTP ${res.status}`);
    return res.data.value || [];
}

/**
 * Create a test run and execute it.
 *
 * Steps:
 * 1. POST to cat_copilottestruns (create the run record)
 * 2. POST bound action cat_RunCopilotTests (trigger execution)
 * 3. Poll cat_copilottestruns for completion
 * 4. Return the final run state
 */
async function createAndRunTests(envUrl, headers, configId, setId, runName) {
    const name = runName || `Eval ${new Date().toISOString().slice(0, 16)}`;

    // Step 1: Create the test run record
    console.log(`Creating test run: "${name}"...`);
    const createRes = await httpRequest('POST',
        `${envUrl}/api/data/v9.2/cat_copilottestruns`,
        { ...headers, 'Content-Type': 'application/json' },
        JSON.stringify({
            cat_name: name,
            'cat_CopilotConfigurationId@odata.bind': `/cat_copilotconfigurations(${configId})`,
            'cat_CopilotTestSetId@odata.bind': `/cat_copilottestsets(${setId})`
        })
    );

    if (createRes.status !== 201 && createRes.status !== 204) {
        throw new Error(`Failed to create test run: HTTP ${createRes.status} ${JSON.stringify(createRes.data)}`);
    }

    // Extract run ID from the response or Location header
    let runId;
    if (createRes.data && createRes.data.cat_copilottestrunid) {
        runId = createRes.data.cat_copilottestrunid;
    } else if (createRes.headers && createRes.headers.location) {
        const match = createRes.headers.location.match(/\(([^)]+)\)/);
        if (match) runId = match[1];
    }

    if (!runId) {
        // Query the most recent run to find it
        const recent = await httpRequest('GET',
            `${envUrl}/api/data/v9.2/cat_copilottestruns?$filter=cat_name eq '${name}'&$orderby=createdon desc&$top=1`,
            headers
        );
        if (recent.data?.value?.[0]) {
            runId = recent.data.value[0].cat_copilottestrunid;
        } else {
            throw new Error('Failed to determine test run ID after creation');
        }
    }

    console.log(`Test run created: ${runId}`);

    // Step 2: Execute the tests via bound action
    console.log('Executing tests...');
    const execRes = await httpRequest('POST',
        `${envUrl}/api/data/v9.2/cat_copilottestruns(${runId})/Microsoft.Dynamics.CRM.cat_RunCopilotTests`,
        { ...headers, 'Content-Type': 'application/json' },
        JSON.stringify({
            CopilotConfigurationId: configId,
            CopilotTestRunId: runId,
            CopilotTestSetId: setId
        })
    );

    if (execRes.status !== 200 && execRes.status !== 204) {
        console.error(`Warning: Execute action returned HTTP ${execRes.status}`);
    }

    // Step 3: Poll for completion
    console.log('Waiting for test execution to complete...');
    const startTime = Date.now();
    let lastStatus = '';

    while (Date.now() - startTime < MAX_POLL_TIME_MS) {
        await sleep(POLL_INTERVAL_MS);

        const statusRes = await httpRequest('GET',
            `${envUrl}/api/data/v9.2/cat_copilottestruns(${runId})?$select=cat_runstatuscode,cat_generatedanswersanalysiscode,cat_successrate`,
            headers
        );

        if (statusRes.status !== 200) {
            console.error(`  Warning: Status poll returned HTTP ${statusRes.status}`);
            continue;
        }

        const run = statusRes.data;
        const runStatus = RUN_STATUS[run.cat_runstatuscode] || `Unknown (${run.cat_runstatuscode})`;
        const analysisStatus = ANALYSIS_STATUS[run.cat_generatedanswersanalysiscode] || '';

        if (runStatus !== lastStatus) {
            const analysis = analysisStatus ? ` | Analysis: ${analysisStatus}` : '';
            console.log(`  Status: ${runStatus}${analysis}`);
            lastStatus = runStatus;
        }

        // Check for completion
        if (run.cat_runstatuscode === 3) { // Complete
            // Wait for analysis to complete too (if running)
            if (run.cat_generatedanswersanalysiscode === 2) continue; // Still analyzing
            const successRate = Number(run.cat_successrate ?? 0);
            console.log(`  Success rate: ${(successRate * 100).toFixed(1)}%`);
            return { runId, successRate, status: 'Complete' };
        }

        if (run.cat_runstatuscode === 6) { // Error
            throw new Error('Test run failed with error status');
        }
    }

    throw new Error(`Test run timed out after ${MAX_POLL_TIME_MS / 1000}s`);
}

/**
 * Download test results for a completed run.
 * Pages through cat_copilottestresults with OData $skip.
 */
async function downloadResults(envUrl, headers, runId) {
    const results = [];
    let nextUrl = `${envUrl}/api/data/v9.2/cat_copilottestresults?$filter=_cat_copilottestrunid_value eq '${runId}'&$select=cat_testutterance,cat_expectedresponse,cat_response,cat_latencyms,cat_resultcode,cat_testtypecode,cat_resultreason&$top=50&$orderby=createdon asc`;

    while (nextUrl) {
        const res = await httpRequestWithRetry('GET', nextUrl, headers);
        if (res.status !== 200) throw new Error(`Failed to download results: HTTP ${res.status}`);

        const rows = res.data.value || [];
        results.push(...rows.map(r => ({
            utterance: r.cat_testutterance || '',
            expected: r.cat_expectedresponse || '',
            actual: r.cat_response || '',
            latencyMs: r.cat_latencyms || 0,
            result: RESULT_CODE[r.cat_resultcode] || 'Unknown',
            resultCode: r.cat_resultcode,
            testType: TEST_TYPE[r.cat_testtypecode] || 'Unknown',
            reason: r.cat_resultreason || ''
        })));

        // Follow server-driven paging via @odata.nextLink
        nextUrl = res.data['@odata.nextLink'] || null;
    }

    return results;
}

/**
 * Export results to CSV format.
 */
function exportCSV(results, filePath) {
    const header = 'Utterance,Expected,Actual,Result,Test Type,Latency (ms),Reason';
    const rows = results.map(r =>
        [r.utterance, r.expected, r.actual, r.result, r.testType, r.latencyMs, r.reason]
            .map(v => `"${String(v).replace(/"/g, '""')}"`)
            .join(',')
    );
    fs.writeFileSync(filePath, [header, ...rows].join('\n'));
}

// --- Main ---

async function main() {
    const config = parseArgs();

    if (!config.envUrl) {
        console.error('Error: --env <url> is required');
        process.exit(2);
    }

    const envUrl = config.envUrl.replace(/\/$/, '');
    const token = getToken(envUrl);
    const headers = buildHeaders(token);

    try {
        switch (config.command) {
            case 'list-configs': {
                const configs = await listConfigs(envUrl, headers);
                if (config.json) {
                    console.log(JSON.stringify(configs, null, 2));
                } else {
                    console.log(`Agent Configurations (${configs.length}):\n`);
                    for (const c of configs) {
                        console.log(`  ${c.cat_name}`);
                        console.log(`    ID: ${c.cat_copilotconfigurationid}`);
                        if (c.cat_description) console.log(`    ${c.cat_description}`);
                    }
                }
                break;
            }

            case 'list-sets': {
                if (!config.configId) {
                    console.error('Error: --config-id required for list-sets');
                    process.exit(2);
                }
                validateGuid(config.configId, '--config-id');
                const sets = await listSets(envUrl, headers, config.configId);
                if (config.json) {
                    console.log(JSON.stringify(sets, null, 2));
                } else {
                    console.log(`Test Sets (${sets.length}):\n`);
                    for (const s of sets) {
                        console.log(`  ${s.cat_name}`);
                        console.log(`    ID: ${s.cat_copilottestsetid}`);
                        if (s.cat_description) console.log(`    ${s.cat_description}`);
                    }
                }
                break;
            }

            case 'run': {
                if (!config.configId || !config.setId) {
                    console.error('Error: --config-id and --set-id are required for run');
                    process.exit(2);
                }
                validateGuid(config.configId, '--config-id');
                validateGuid(config.setId, '--set-id');

                const runResult = await createAndRunTests(envUrl, headers, config.configId, config.setId, config.runName);
                console.log(`\nTest run complete: ${runResult.runId}`);
                console.log(`Success rate: ${(runResult.successRate * 100).toFixed(1)}%`);

                // Download results
                const results = await downloadResults(envUrl, headers, runResult.runId);
                const passed = results.filter(r => r.resultCode === 1).length;
                const failed = results.filter(r => r.resultCode === 2).length;

                console.log(`\n${'='.repeat(60)}`);
                console.log(`RESULTS: ${passed}/${results.length} passed (${(runResult.successRate * 100).toFixed(1)}%)`);
                console.log(`${'='.repeat(60)}`);

                if (failed > 0) {
                    console.log(`\nFailed tests:`);
                    results.filter(r => r.resultCode === 2).forEach((r, idx) => {
                        console.log(`\n  ${idx + 1}. "${r.utterance.substring(0, 80)}"`);
                        console.log(`     Expected: ${r.expected.substring(0, 100)}`);
                        console.log(`     Actual:   ${r.actual.substring(0, 100)}`);
                        console.log(`     Type: ${r.testType} | Latency: ${r.latencyMs}ms`);
                        if (r.reason) console.log(`     Reason: ${r.reason}`);
                    });
                }

                // Export CSV if requested
                if (config.csvPath) {
                    exportCSV(results, config.csvPath);
                    console.log(`\nCSV exported: ${config.csvPath}`);
                }

                // Write to brief.json if requested
                if (config.briefPath) {
                    try {
                        const brief = JSON.parse(fs.readFileSync(config.briefPath, 'utf8'));
                        if (brief.evalSets) {
                            // Add Power CAT run metadata
                            if (!brief.powerCatRuns) brief.powerCatRuns = [];
                            brief.powerCatRuns.push({
                                runId: runResult.runId,
                                timestamp: new Date().toISOString(),
                                successRate: runResult.successRate,
                                total: results.length,
                                passed,
                                failed
                            });
                            fs.writeFileSync(config.briefPath, JSON.stringify(brief, null, 2));
                            console.log(`\nResults written to brief.json (powerCatRuns[])`);
                        }
                    } catch (err) {
                        console.error(`Warning: Failed to update brief.json: ${err.message}`);
                    }
                }

                // Exit with appropriate code
                process.exit(runResult.successRate >= config.threshold ? 0 : 1);
                break;
            }

            case 'results': {
                if (!config.runId) {
                    console.error('Error: --run-id required for results');
                    process.exit(2);
                }
                validateGuid(config.runId, '--run-id');

                const results = await downloadResults(envUrl, headers, config.runId);

                if (config.json) {
                    console.log(JSON.stringify(results, null, 2));
                } else {
                    const passed = results.filter(r => r.resultCode === 1).length;
                    console.log(`Results (${results.length} tests, ${passed} passed):\n`);
                    for (const r of results) {
                        const status = r.result === 'Success' ? 'PASS' : 'FAIL';
                        console.log(`  [${status}] "${r.utterance.substring(0, 60)}" (${r.latencyMs}ms)`);
                    }
                }

                if (config.csvPath) {
                    exportCSV(results, config.csvPath);
                    console.log(`\nCSV exported: ${config.csvPath}`);
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
        process.exit(2);
    }
}

module.exports = { createAndRunTests, downloadResults, listConfigs, listSets, exportCSV };

if (require.main === module) {
    main().catch(err => {
        console.error('Fatal:', err.message);
        process.exit(2);
    });
}
