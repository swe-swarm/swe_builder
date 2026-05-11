/**
 * Shared HTTP & Token Utilities
 *
 * Consolidates HTTP request and Azure CLI token acquisition patterns
 * used across island-client.js, direct-line-test.js, add-tool.js,
 * e2e-api-pipeline-test.js, and mcs-lsp.js.
 *
 * Features:
 *   - http + https support (auto-detected from URL)
 *   - Configurable timeout per request
 *   - Content-Length header for request bodies
 *   - Exponential backoff retry on 429 / 5xx / network errors
 *   - Consistent error messages with resource name
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');
const { execSync } = require('child_process');

// --- Defaults ---
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_RETRIES = 3;
const RETRY_BACKOFF_BASE_MS = 1000;

/**
 * Make an HTTP/HTTPS request. Auto-detects protocol from URL.
 *
 * @param {string} method - HTTP method (GET, POST, PUT, PATCH, DELETE)
 * @param {string} url - Full URL
 * @param {object} headers - Request headers (Content-Type defaults to application/json)
 * @param {object|string|null} body - Request body (objects are JSON-stringified)
 * @param {number} [timeout=30000] - Request timeout in ms
 * @returns {Promise<{status: number, headers: object, data: object|string}>}
 */
function httpRequest(method, url, headers, body, timeout = DEFAULT_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const transport = parsed.protocol === 'http:' ? http : https;
        const bodyStr = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
        const options = {
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
            path: parsed.pathname + parsed.search,
            method,
            headers: {
                'Content-Type': 'application/json',
                ...headers,
                ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {})
            }
        };

        const req = transport.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(data || '{}') });
                } catch {
                    resolve({ status: res.statusCode, headers: res.headers, data });
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(timeout, () => {
            req.destroy(new Error('Request timeout'));
        });
        if (bodyStr) req.write(bodyStr);
        req.end();
    });
}

/**
 * HTTP request with exponential backoff retry on 429 / 5xx / network errors.
 *
 * @param {string} method
 * @param {string} url
 * @param {object} headers
 * @param {object|string|null} body
 * @param {number} [retries=3]
 * @param {number} [timeout=30000]
 * @returns {Promise<{status: number, headers: object, data: object|string}>}
 */
async function httpRequestWithRetry(method, url, headers, body, retries = DEFAULT_MAX_RETRIES, timeout = DEFAULT_TIMEOUT_MS) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await httpRequest(method, url, headers, body, timeout);
            if ((res.status === 429 || res.status >= 500) && attempt < retries) {
                const delay = RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt);
                console.error(`  [Retry ${attempt + 1}/${retries}] HTTP ${res.status}, waiting ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }
            return res;
        } catch (err) {
            lastError = err;
            if (attempt < retries) {
                const delay = RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt);
                console.error(`  [Retry ${attempt + 1}/${retries}] ${err.message}, waiting ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }
    throw lastError;
}

// --- Token Cache ---
const _tokenCache = {};
const TOKEN_REFRESH_BUFFER_MS = 120000; // refresh 2 min before expiry

/**
 * Get an Azure CLI access token for a resource, with TTL-aware caching.
 * Returns a cached token if > 2 minutes remain before expiry.
 * Fetches fresh via `az account get-access-token` otherwise.
 *
 * @param {string} resource - Token audience (URL or app ID)
 * @param {string} [tenant] - Optional tenant ID or domain. Use when the target resource
 *   is on a different tenant than the current az login (e.g., Microsoft SharePoint library
 *   while building in a customer tenant).
 * @returns {string} Access token
 */
function getToken(resource, tenant) {
    const cacheKey = tenant ? `${resource}@${tenant}` : resource;
    const cached = _tokenCache[cacheKey];
    if (cached && cached.expiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
        return cached.token;
    }
    const tenantArg = tenant ? ` --tenant ${tenant}` : '';
    try {
        const result = execSync(
            `az account get-access-token --resource ${resource}${tenantArg} -o json`,
            { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
        );
        const parsed = JSON.parse(result);
        _tokenCache[cacheKey] = {
            token: parsed.accessToken,
            expiresAt: new Date(parsed.expiresOn).getTime()
        };
        return parsed.accessToken;
    } catch (err) {
        const tenantHint = tenant ? ` for tenant ${tenant}` : '';
        throw new Error(
            `Failed to get token for ${resource}${tenantHint}. Ensure az CLI is logged in.\n` +
            `Run: az login${tenant ? ` --tenant ${tenant}` : ''}\n` +
            `Error: ${err.stderr || err.message}`
        );
    }
}

/**
 * Clear the in-memory token cache. Use after `az login` to force fresh tokens.
 */
function clearTokenCache() {
    Object.keys(_tokenCache).forEach(k => delete _tokenCache[k]);
}

/**
 * Get the current Azure CLI tenant ID.
 *
 * @returns {string} Tenant ID (GUID)
 */
function getTenantId() {
    try {
        const result = execSync(
            'az account show --query tenantId -o tsv',
            { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
        );
        return result.trim();
    } catch (err) {
        throw new Error(`Failed to get tenant ID from az CLI: ${err.stderr || err.message}`);
    }
}

/**
 * Sleep utility — returns a Promise that resolves after `ms` milliseconds.
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
    httpRequest,
    httpRequestWithRetry,
    getToken,
    clearTokenCache,
    getTenantId,
    sleep,
    DEFAULT_TIMEOUT_MS,
    RETRY_BACKOFF_BASE_MS
};
