/**
 * Upstream Repository Change Checker
 *
 * Checks tracked GitHub repos for changes since last check using `gh api`.
 * Designed to run on a 3-day schedule (session start or /mcs-refresh).
 *
 * Usage:
 *   node tools/upstream-check.js                    Check all repos
 *   node tools/upstream-check.js --json             Output JSON report
 *   node tools/upstream-check.js --update           Check + update tracking file
 *   node tools/upstream-check.js --repo <name>      Check specific repo
 *   node tools/upstream-check.js --force            Ignore freshness, check all
 *
 * Requires: gh CLI authenticated (gh auth status)
 *
 * Exit codes:
 *   0 = no changes found (or all fresh)
 *   1 = changes detected (new commits in tracked repos)
 *   2 = error (gh CLI not available, auth failure)
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TRACKING_FILE = path.join(__dirname, '..', 'knowledge', 'upstream-repos.json');
const FRESHNESS_DAYS = 3;

// --- CLI ---

function parseArgs() {
    const args = process.argv.slice(2);
    const config = {};

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--json': config.json = true; break;
            case '--update': config.update = true; break;
            case '--force': config.force = true; break;
            case '--repo': config.filterRepo = args[++i]; break;
            case '--help':
                console.log(`Upstream Repository Change Checker

Usage: node upstream-check.js [options]

Options:
  --json         Output JSON report
  --update       Update tracking file with new check dates and SHAs
  --force        Check all repos regardless of freshness
  --repo <name>  Check a specific repo (e.g., "microsoft/skills-for-copilot-studio")

Checks GitHub repos listed in knowledge/upstream-repos.json for new commits
since the last check date. Run every 3 days or via /mcs-refresh.`);
                process.exit(0);
        }
    }
    return config;
}

// --- GitHub API ---

function ghApiCall(endpoint) {
    try {
        const result = execFileSync('gh', ['api', endpoint, '--cache', '0s'],
            { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 }
        );
        return JSON.parse(result);
    } catch (err) {
        const stderr = err.stderr || '';
        if (stderr.includes('auth login') || stderr.includes('not logged')) {
            throw new Error('gh CLI not authenticated. Run: gh auth login');
        }
        throw new Error(`gh api ${endpoint} failed: ${stderr || err.message}`);
    }
}

function checkGhAvailable() {
    try {
        execFileSync('gh', ['auth', 'status'],
            { stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 }
        );
        return true;
    } catch {
        return false;
    }
}

// --- Check Logic ---

function checkRepo(repo, force) {
    const lastCheckedMs = repo.lastChecked ? new Date(repo.lastChecked).getTime() : NaN;
    const daysSinceCheck = Number.isFinite(lastCheckedMs)
        ? Math.floor((Date.now() - lastCheckedMs) / 86400000)
        : Infinity;

    // Skip if fresh (unless forced)
    if (!force && daysSinceCheck < FRESHNESS_DAYS) {
        return {
            repo: repo.repo,
            status: 'fresh',
            daysSinceCheck,
            message: `Checked ${daysSinceCheck}d ago (threshold: ${FRESHNESS_DAYS}d)`,
            commits: [],
            hasChanges: false
        };
    }

    // Fetch recent commits since last check
    const sinceRaw = repo.lastChecked || repo.integratedDate || '2026-01-01';
    const sinceDate = new Date(sinceRaw);
    const sinceParam = `since=${Number.isFinite(sinceDate.getTime()) ? sinceDate.toISOString() : '2026-01-01T00:00:00Z'}`;

    let commits;
    try {
        commits = ghApiCall(`repos/${repo.repo}/commits?per_page=10&${sinceParam}`);
    } catch (err) {
        return {
            repo: repo.repo,
            status: 'error',
            daysSinceCheck,
            message: err.message,
            commits: [],
            hasChanges: false
        };
    }

    // Filter out the commit we already know about
    const newCommits = repo.lastCommitSha
        ? commits.filter(c => c.sha !== repo.lastCommitSha)
        : commits;

    // Check if any commits touch watched paths
    const watchedCommits = [];
    for (const c of newCommits.slice(0, 5)) {
        const summary = {
            sha: c.sha.substring(0, 7),
            date: c.commit.committer.date,
            message: c.commit.message.split('\n')[0].substring(0, 100),
            author: c.commit.author?.name || c.author?.login || 'unknown'
        };

        // If watchPaths defined, check file paths (requires per-commit API call)
        if (repo.watchPaths && repo.watchPaths.length > 0) {
            try {
                const detail = ghApiCall(`repos/${repo.repo}/commits/${c.sha}`);
                const files = (detail.files || []).map(f => f.filename);
                const matched = files.some(f =>
                    repo.watchPaths.some(wp => f.startsWith(wp))
                );
                summary.matchesWatchPaths = matched;
                if (matched) {
                    summary.changedPaths = files
                        .filter(f => repo.watchPaths.some(wp => f.startsWith(wp)))
                        .slice(0, 5);
                }
            } catch {
                summary.matchesWatchPaths = null; // Couldn't determine
            }
        }

        watchedCommits.push(summary);
    }

    // Only count confirmed watch-path matches (not unknowns) as relevant
    const hasRelevantChanges = watchedCommits.some(c => c.matchesWatchPaths === true);
    const hasUnknownPaths = watchedCommits.some(c => c.matchesWatchPaths === null);

    const pathNote = hasRelevantChanges ? ' in watched paths'
        : hasUnknownPaths ? ' (watch-path check failed for some)' : '';

    return {
        repo: repo.repo,
        status: newCommits.length > 0 ? 'changed' : 'unchanged',
        daysSinceCheck,
        message: newCommits.length > 0
            ? `${newCommits.length} new commit(s)${pathNote}`
            : 'No new commits',
        commits: watchedCommits,
        hasChanges: newCommits.length > 0,
        hasRelevantChanges,
        hasUnknownPaths,
        latestSha: newCommits.length > 0 ? newCommits[0].sha : (repo.lastCommitSha || null)
    };
}

// --- Main ---

function main() {
    const config = parseArgs();

    // Verify gh CLI
    if (!checkGhAvailable()) {
        console.error('Error: gh CLI not available or not authenticated.');
        console.error('Run: gh auth login');
        process.exit(2);
    }

    // Read tracking file
    let tracking;
    try {
        tracking = JSON.parse(fs.readFileSync(TRACKING_FILE, 'utf8'));
    } catch (err) {
        console.error(`Error reading ${TRACKING_FILE}: ${err.message}`);
        process.exit(2);
    }

    // Filter repos if requested
    let repos = tracking.repos;
    if (config.filterRepo) {
        repos = repos.filter(r =>
            r.repo === config.filterRepo || r.repo.endsWith(`/${config.filterRepo}`)
        );
        if (repos.length === 0) {
            console.error(`No tracked repo matching: ${config.filterRepo}`);
            console.error(`Tracked: ${tracking.repos.map(r => r.repo).join(', ')}`);
            process.exit(2);
        }
    }

    // Check each repo
    const results = [];
    let anyChanges = false;

    for (const repo of repos) {
        const result = checkRepo(repo, config.force);
        results.push(result);
        if (result.hasChanges) anyChanges = true;

        if (!config.json) {
            const icon = result.status === 'changed' ? '*' :
                         result.status === 'fresh' ? '-' :
                         result.status === 'error' ? '!' : '=';
            console.log(`  [${icon}] ${repo.repo}: ${result.message}`);

            if (result.commits.length > 0) {
                for (const c of result.commits.slice(0, 3)) {
                    const pathNote = c.matchesWatchPaths === true ? ' [WATCHED]' : '';
                    console.log(`      ${c.sha} ${c.message.substring(0, 70)}${pathNote}`);
                }
                if (result.commits.length > 3) {
                    console.log(`      ... and ${result.commits.length - 3} more`);
                }
            }
        }
    }

    // Update tracking file if requested
    if (config.update) {
        try {
            const today = new Date().toISOString().slice(0, 10);
            for (const result of results) {
                if (result.status === 'error') continue;
                const repoEntry = tracking.repos.find(r => r.repo === result.repo);
                if (repoEntry) {
                    repoEntry.lastChecked = today;
                    if (result.latestSha) repoEntry.lastCommitSha = result.latestSha;
                }
            }
            tracking.lastFullCheck = new Date().toISOString();
            fs.writeFileSync(TRACKING_FILE, JSON.stringify(tracking, null, 2) + '\n');
            if (!config.json) console.log(`\nTracking file updated: ${TRACKING_FILE}`);
        } catch (err) {
            console.error(`Error writing tracking file: ${err.message}`);
            process.exit(2);
        }
    }

    // Output
    if (config.json) {
        console.log(JSON.stringify({
            checkedAt: new Date().toISOString(),
            totalRepos: repos.length,
            changed: results.filter(r => r.hasChanges).length,
            fresh: results.filter(r => r.status === 'fresh').length,
            errors: results.filter(r => r.status === 'error').length,
            results
        }, null, 2));
    } else {
        const changed = results.filter(r => r.hasChanges).length;
        const fresh = results.filter(r => r.status === 'fresh').length;
        const errors = results.filter(r => r.status === 'error').length;

        console.log(`\nSummary: ${repos.length} repos — ${changed} changed, ${fresh} fresh, ${errors} errors`);

        if (anyChanges) {
            console.log('\nAction needed: Review changed repos and integrate relevant updates.');
            console.log('Run /mcs-refresh to also update knowledge cache files.');
        }
    }

    // Exit 0 on successful --update (changes are recorded, not an error).
    // Exit 1 only when changes detected without --update (informational alert).
    // Exit 2 reserved for actual errors.
    process.exit(anyChanges && !config.update ? 1 : 0);
}

module.exports = { checkRepo, checkGhAvailable };

if (require.main === module) {
    main();
}
