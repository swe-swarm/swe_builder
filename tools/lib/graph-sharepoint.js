/**
 * SharePoint Graph API Helper
 *
 * Small module for interacting with SharePoint document libraries via
 * Microsoft Graph API. Follows the tools/lib/http.js pattern.
 * Zero external dependencies — uses native Node.js https + fs.
 *
 * Auth: az account get-access-token --resource https://graph.microsoft.com
 *
 * Hardcoded defaults for the Builder PMs "Solution & Demo Library" drive.
 * Override via function parameters or environment variables.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { httpRequest, httpRequestWithRetry, getToken } = require('./http');  // getToken shared across all tools

// --- Defaults (Builder PMs team site on Microsoft tenant) ---

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const DEFAULT_DRIVE_ID = 'b!dcvv6tllDU2Q4go3CRonRq0yOTA2PUxPgLthL4NUdZOzSuzIKU0gT4l3NeEVcFRf';
const SITE_WEB_URL = 'https://microsoft.sharepoint-df.com/teams/BuilderPMs/SolutionLibrary';

// Microsoft corporate tenant — the Solution Library lives here, NOT in customer tenants.
// When building agents in a customer tenant, az CLI may be logged into that tenant.
// We explicitly pass the Microsoft tenant to getToken() so library access always works
// regardless of which tenant the user is currently authenticated to for builds.
const MICROSOFT_TENANT_ID = '72f988bf-86f1-41af-91ab-2d7cd011db47';

// --- Auth ---

/**
 * Get a Microsoft Graph access token via Azure CLI, explicitly targeting
 * the Microsoft tenant. This ensures library access works even when the
 * user is az-logged-in to a customer tenant for builds.
 *
 * @returns {string} Access token
 * @throws {Error} If not authenticated to Microsoft tenant — includes fix instructions
 */
function getGraphToken() {
    try {
        return getToken('https://graph.microsoft.com', MICROSOFT_TENANT_ID);
    } catch (err) {
        throw new Error(
            `Cannot access the Solution Library — not authenticated to Microsoft tenant.\n\n` +
            `The Solution Library is on Microsoft SharePoint (${SITE_WEB_URL}).\n` +
            `Your current az login may be targeting a different tenant (e.g., customer build tenant).\n\n` +
            `Fix: Run  az login --tenant ${MICROSOFT_TENANT_ID}\n` +
            `  or: az login  (with your @microsoft.com account)\n\n` +
            `This is separate from your build authentication (PAC CLI / Dataverse).\n` +
            `Original error: ${err.message}`
        );
    }
}

/**
 * Build standard Graph API headers.
 * @param {string} token - Graph access token
 * @returns {object} Headers object
 */
function buildGraphHeaders(token) {
    return {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };
}

// --- Drive Operations ---

/**
 * List children of a folder in a SharePoint drive.
 *
 * @param {string} token - Graph access token
 * @param {string} [folderPath] - Folder path relative to drive root (e.g. "subfolder/child"). Omit for root.
 * @param {string} [driveId] - Drive ID (defaults to Solution & Demo Library)
 * @param {object} [options] - { select, top, orderBy }
 * @returns {Promise<Array>} Array of drive item objects
 */
async function listDriveItems(token, folderPath, driveId, options = {}) {
    const drive = driveId || DEFAULT_DRIVE_ID;
    const select = options.select || 'name,id,size,folder,file,lastModifiedDateTime,webUrl';
    const top = options.top || 200;

    let url;
    if (folderPath) {
        const encoded = folderPath.split('/').map(encodeURIComponent).join('/');
        url = `${GRAPH_BASE}/drives/${drive}/root:/${encoded}:/children?$select=${select}&$top=${top}`;
    } else {
        url = `${GRAPH_BASE}/drives/${drive}/root/children?$select=${select}&$top=${top}`;
    }

    if (options.orderBy) {
        url += `&$orderby=${encodeURIComponent(options.orderBy)}`;
    }

    const headers = buildGraphHeaders(token);
    const items = [];
    let nextLink = url;

    while (nextLink) {
        const res = await httpRequestWithRetry('GET', nextLink, headers, null, 3, 30000);
        if (res.status !== 200) {
            throw new Error(`listDriveItems failed: HTTP ${res.status} — ${JSON.stringify(res.data)}`);
        }
        const data = res.data;
        if (data.value) {
            items.push(...data.value);
        }
        nextLink = data['@odata.nextLink'] || null;
    }

    return items;
}

/**
 * Download a file from a SharePoint drive to a local path.
 * Uses raw https.get to handle binary content + redirect following.
 *
 * @param {string} token - Graph access token
 * @param {string} itemId - Drive item ID
 * @param {string} localPath - Local file path to save to
 * @param {string} [driveId] - Drive ID (defaults to Solution & Demo Library)
 * @returns {Promise<{size: number, path: string}>}
 */
function downloadFile(token, itemId, localPath, driveId) {
    const drive = driveId || DEFAULT_DRIVE_ID;
    const url = `${GRAPH_BASE}/drives/${drive}/items/${itemId}/content`;

    return new Promise((resolve, reject) => {
        const dir = path.dirname(localPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        function followRedirects(requestUrl, depth) {
            if (depth > 5) {
                return reject(new Error('Too many redirects downloading file'));
            }

            const parsed = new URL(requestUrl);
            const options = {
                hostname: parsed.hostname,
                port: parsed.port || 443,
                path: parsed.pathname + parsed.search,
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            };

            https.get(options, (res) => {
                // Follow 301/302/307 redirects (Graph returns 302 to blob storage)
                if ([301, 302, 307].includes(res.statusCode) && res.headers.location) {
                    return followRedirects(res.headers.location, depth + 1);
                }

                if (res.statusCode !== 200) {
                    let body = '';
                    res.on('data', chunk => body += chunk);
                    res.on('end', () => reject(new Error(`Download failed: HTTP ${res.statusCode} — ${body.substring(0, 200)}`)));
                    return;
                }

                const file = fs.createWriteStream(localPath);
                res.pipe(file);
                file.on('finish', () => {
                    file.close();
                    const stats = fs.statSync(localPath);
                    resolve({ size: stats.size, path: localPath });
                });
                file.on('error', (err) => {
                    fs.unlinkSync(localPath);
                    reject(err);
                });
            }).on('error', reject);
        }

        followRedirects(url, 0);
    });
}

/**
 * Upload a file to a SharePoint drive (simple upload, <250MB).
 *
 * @param {string} token - Graph access token
 * @param {string} parentPath - Parent folder path relative to drive root
 * @param {string} fileName - Name for the uploaded file
 * @param {string} localPath - Local file path to upload
 * @param {string} [driveId] - Drive ID (defaults to Solution & Demo Library)
 * @returns {Promise<object>} Created drive item
 */
function uploadFile(token, parentPath, fileName, localPath, driveId) {
    const drive = driveId || DEFAULT_DRIVE_ID;
    const encodedParent = parentPath.split('/').map(encodeURIComponent).join('/');
    const encodedName = encodeURIComponent(fileName);
    const url = `${GRAPH_BASE}/drives/${drive}/root:/${encodedParent}/${encodedName}:/content`;

    return new Promise((resolve, reject) => {
        const fileData = fs.readFileSync(localPath);
        const parsed = new URL(url);

        const options = {
            hostname: parsed.hostname,
            port: 443,
            path: parsed.pathname + parsed.search,
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/octet-stream',
                'Content-Length': fileData.length
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(body));
                    } catch {
                        resolve({ status: res.statusCode, raw: body });
                    }
                } else {
                    reject(new Error(`Upload failed: HTTP ${res.statusCode} — ${body.substring(0, 300)}`));
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(120000, () => req.destroy(new Error('Upload timeout')));
        req.write(fileData);
        req.end();
    });
}

/**
 * Create a folder in a SharePoint drive.
 *
 * @param {string} token - Graph access token
 * @param {string} parentPath - Parent folder path relative to drive root (empty string for root)
 * @param {string} name - Folder name to create
 * @param {string} [driveId] - Drive ID (defaults to Solution & Demo Library)
 * @returns {Promise<object>} Created folder item
 */
async function createFolder(token, parentPath, name, driveId) {
    const drive = driveId || DEFAULT_DRIVE_ID;
    let url;
    if (parentPath) {
        const encodedParent = parentPath.split('/').map(encodeURIComponent).join('/');
        url = `${GRAPH_BASE}/drives/${drive}/root:/${encodedParent}:/children`;
    } else {
        url = `${GRAPH_BASE}/drives/${drive}/root/children`;
    }

    const headers = buildGraphHeaders(token);
    const body = {
        name: name,
        folder: {},
        '@microsoft.graph.conflictBehavior': 'fail'
    };

    const res = await httpRequest('POST', url, headers, body);
    if (res.status === 409) {
        // Folder already exists — fetch and return the real folder metadata
        const folderPath = parentPath ? `${parentPath}/${name}` : name;
        const encodedPath = folderPath.split('/').map(encodeURIComponent).join('/');
        const folderUrl = `${GRAPH_BASE}/drives/${drive}/root:/${encodedPath}`;
        const folderRes = await httpRequest('GET', folderUrl, headers);
        if (folderRes.status === 200) {
            return { ...folderRes.data, alreadyExists: true };
        }
        return { id: null, name, alreadyExists: true };
    }
    if (res.status < 200 || res.status >= 300) {
        throw new Error(`createFolder failed: HTTP ${res.status} — ${JSON.stringify(res.data)}`);
    }
    return res.data;
}

// --- Exports ---

module.exports = {
    getGraphToken,
    buildGraphHeaders,
    listDriveItems,
    downloadFile,
    uploadFile,
    createFolder,
    DEFAULT_DRIVE_ID,
    SITE_WEB_URL,
    GRAPH_BASE
};
