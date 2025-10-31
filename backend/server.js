const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const session = require('express-session');
const https = require('https');

function safeReadJson(filePath) {
    if (!fs.existsSync(filePath)) {
        return {};
    }

    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw || '{}');
    } catch (error) {
        console.warn(`Failed to parse configuration file at ${filePath}: ${error.message}`);
        return {};
    }
}

function isPlainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(target, ...sources) {
    const output = Array.isArray(target) ? [...target] : { ...target };

    for (const source of sources) {
        if (!isPlainObject(source) && !Array.isArray(source)) {
            continue;
        }

        const entries = Array.isArray(source) ? source.entries() : Object.entries(source);

        for (const [key, value] of entries) {
            if (Array.isArray(value)) {
                output[key] = [...value];
            } else if (isPlainObject(value)) {
                output[key] = deepMerge(isPlainObject(output[key]) ? output[key] : {}, value);
            } else if (value !== undefined) {
                output[key] = value;
            }
        }
    }

    return output;
}

function buildEnvOverrides() {
    const overrides = {};

    if (process.env.PORT || process.env.PORT_RETRY_LIMIT || process.env.SESSION_SECRET) {
        overrides.server = {
            ...(overrides.server || {}),
            ...(process.env.PORT ? { port: Number(process.env.PORT) } : {}),
            ...(process.env.PORT_RETRY_LIMIT ? { portRetryLimit: Number(process.env.PORT_RETRY_LIMIT) } : {}),
            ...(process.env.SESSION_SECRET ? { sessionSecret: process.env.SESSION_SECRET } : {})
        };
    }

    if (process.env.SESSION_COOKIE_SECURE || process.env.SESSION_COOKIE_MAX_AGE_HOURS) {
        overrides.server = {
            ...(overrides.server || {}),
            session: {
                ...(overrides.server?.session || {}),
                cookie: {
                    ...(overrides.server?.session?.cookie || {}),
                    ...(process.env.SESSION_COOKIE_SECURE ? { secure: process.env.SESSION_COOKIE_SECURE === 'true' } : {}),
                    ...(process.env.SESSION_COOKIE_MAX_AGE_HOURS ? { maxAgeHours: Number(process.env.SESSION_COOKIE_MAX_AGE_HOURS) } : {})
                }
            }
        };
    }

    if (process.env.UPLOAD_DIR || process.env.ALLOWED_EXTENSIONS || process.env.MAX_FILE_SIZE) {
        overrides.uploads = {
            ...(process.env.UPLOAD_DIR ? { directory: process.env.UPLOAD_DIR } : {}),
            ...(process.env.ALLOWED_EXTENSIONS
                ? { allowedExtensions: process.env.ALLOWED_EXTENSIONS.split(',').map(ext => ext.trim()).filter(Boolean) }
                : {}),
            ...(process.env.MAX_FILE_SIZE ? { maxFileSizeMB: Number(process.env.MAX_FILE_SIZE) } : {})
        };
    }

    if (process.env.KEYCLOAK_URL || process.env.KEYCLOAK_REALM || process.env.KEYCLOAK_CLIENT_ID) {
        overrides.keycloak = {
            ...(process.env.KEYCLOAK_URL ? { url: process.env.KEYCLOAK_URL } : {}),
            ...(process.env.KEYCLOAK_REALM ? { realm: process.env.KEYCLOAK_REALM } : {}),
            ...(process.env.KEYCLOAK_CLIENT_ID ? { clientId: process.env.KEYCLOAK_CLIENT_ID } : {})
        };
    }

    if (process.env.BRIDGE_SERVERS) {
        try {
            const parsed = JSON.parse(process.env.BRIDGE_SERVERS);
            if (Array.isArray(parsed)) {
                overrides.bridgeServers = parsed;
            }
        } catch (error) {
            console.warn('Failed to parse BRIDGE_SERVERS environment variable. Expected valid JSON array.');
        }
    }

    return overrides;
}

function loadConfig() {
    const configDir = path.join(__dirname, 'config');
    const defaultConfig = safeReadJson(path.join(configDir, 'default', 'config.json'));
    const localConfig = safeReadJson(path.join(configDir, 'local', 'config.json'));
    const envOverrides = buildEnvOverrides();

    return deepMerge({}, defaultConfig, localConfig, envOverrides);
}

const config = loadConfig();

global.uploadedFiles = global.uploadedFiles instanceof Map ? global.uploadedFiles : new Map();
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const app = express();
const DEFAULT_PORT = Number(config.server?.port) || 3000;
const PORT_RETRY_LIMIT = Number(config.server?.portRetryLimit) || 5;
const configuredSessionSecret = config.server?.sessionSecret;
const sessionSecret = configuredSessionSecret && configuredSessionSecret.trim().length > 0
    ? configuredSessionSecret.trim()
    : null;

if (!sessionSecret) {
    console.error('Session secret is required. Set `server.sessionSecret` in config or the SESSION_SECRET environment variable.');
    process.exit(1);
}

const sessionCookieSecure = Boolean(config.server?.session?.cookie?.secure);
const sessionCookieMaxAgeHours = Number(config.server?.session?.cookie?.maxAgeHours) || 24;
const sessionCookieMaxAge = sessionCookieMaxAgeHours * 60 * 60 * 1000;

// Session configuration
app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: sessionCookieSecure, // Set to true if using HTTPS
        maxAge: sessionCookieMaxAge
    }
}));

// Keycloak configuration
const KEYCLOAK_CONFIG = {
    url: config.keycloak?.url || 'https://ec2-54-151-161-17.ap-southeast-1.compute.amazonaws.com/ots2/keycloak',
    realm: config.keycloak?.realm || 'PAS',
    clientId: config.keycloak?.clientId || 'authenticator-service'
};

// Function to authenticate with Keycloak
async function authenticateWithKeycloak(username, password) {
    try {
        const tokenUrl = `${KEYCLOAK_CONFIG.url}/realms/${KEYCLOAK_CONFIG.realm}/protocol/openid-connect/token`;
        
        const response = await axios.post(tokenUrl, 
            new URLSearchParams({
                username: username,
                password: password,
                client_id: KEYCLOAK_CONFIG.clientId,
                grant_type: 'password'
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                httpsAgent
            }
        );
        
        return {
            success: true,
            accessToken: response.data.access_token,
            refreshToken: response.data.refresh_token,
            userInfo: response.data
        };
    } catch (error) {
        console.error('Keycloak authentication failed:', error.response?.data || error.message);
        return {
            success: false,
            error: error.response?.data?.error_description || 'Authentication failed'
        };
    }
}

// Authentication middleware
function requireAuth(req, res, next) {
    if (req.session && req.session.authenticated) {
        console.log('User authenticated via session:', req.session.username);
        return next();
    }
    
    console.log('User not authenticated');
    // For API routes, return JSON error instead of redirect
    if (req.path.startsWith('/api/') || req.path.startsWith('/upload') || req.path.startsWith('/deploy') || req.path.startsWith('/clear')) {
        return res.status(401).json({ 
            success: false, 
            error: 'Authentication required',
            authenticated: false 
        });
    }
    // For non-API routes, redirect to login
    return res.redirect('/login');
}

// Multiple Bridge servers configuration - can be overridden by configuration files or environment variables
const BRIDGE_SERVERS = Array.isArray(config.bridgeServers) && config.bridgeServers.length > 0
    ? config.bridgeServers
    : [];

// Function to get OAuth token from Keycloak
async function getOAuthToken(server) {
    try {
        const response = await axios.post(server.keycloakUrl, 
            new URLSearchParams({
                username: server.username,
                password: server.password,
                client_id: server.clientId,
                grant_type: 'password',
                client_secret: server.clientSecret
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                httpsAgent
            }
        );
        
        return response.data.access_token;
    } catch (error) {
        console.error('Failed to get OAuth token for', server.name, ':', error.response?.data || error.message);
        console.error('OAuth URL:', server.keycloakUrl);
        console.error('Client ID:', server.clientId);
        throw error;
    }
}

// Function to deploy using OAuth token
async function deployWithOAuth(filePath, server, token) {
    try {
        const FormData = require('form-data');
        const form = new FormData();
        form.append('uploadFile', fs.createReadStream(filePath));

        // Determine the correct deployment path based on the server
        let deploymentPath;
        if (server.host.includes('ec2-18-140-203-30')) {
            // Server 2: uses /ots path
            deploymentPath = '/ots/bridge/bridge/rest/services';
        } else if (server.host.includes('ec2-54-151-161-17')) {
            // Server 3: uses /ots2 path
            deploymentPath = '/ots2/bridge/bridge/rest/services';
        } else {
            // Default for other servers
            deploymentPath = '/bridge/bridge/rest/services';
        }
            
        const response = await axios.post(
            `${server.scheme}://${server.host}:${server.port}${deploymentPath}?overwrite=true&overwritePrefs=false&startup=false&preserveNodeModules=false&npmInstall=false&runScripts=false&stopTimeout=10&allowKill=false`,
            form,
            {
                headers: {
                    ...form.getHeaders(),
                    'Authorization': `Bearer ${token}`,
                    'accept': 'application/json'
                },
                httpsAgent
            }
        );

        return response.data;
    } catch (error) {
        console.error('OAuth deployment failed:', error.response?.data || error.message);
        throw error;
    }
}

// Function to deploy using Basic Auth
async function deployWithBasicAuth(filePath, server) {
    try {
        const FormData = require('form-data');
        const form = new FormData();
        form.append('uploadFile', fs.createReadStream(filePath));

        // Determine the correct deployment path based on the server
        let deploymentPath;
        if (server.host.includes('ec2-18-140-203-30')) {
            // Server 2: uses /ots path
            deploymentPath = '/ots/bridge/bridge/rest/services';
        } else if (server.host.includes('ec2-54-151-161-17')) {
            // Server 3: uses /ots2 path
            deploymentPath = '/ots2/bridge/bridge/rest/services';
        } else {
            // Default for other servers
            deploymentPath = '/bridge/bridge/rest/services';
        }
            
        const response = await axios.post(
            `${server.scheme}://${server.host}:${server.port}${deploymentPath}?overwrite=true&overwritePrefs=false&startup=false&preserveNodeModules=false&npmInstall=false&runScripts=false&stopTimeout=10&allowKill=false`,
            form,
            {
                headers: {
                    ...form.getHeaders(),
                    'accept': 'application/json'
                },
                auth: {
                    username: server.username,
                    password: server.password
                },
                httpsAgent
            }
        );

        return response.data;
    } catch (error) {
        console.error('Basic Auth deployment failed:', error.response?.data || error.message);
        throw error;
    }
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = config.uploads?.directory || 'uploads';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir);
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        const allowedExtensions = Array.isArray(config.uploads?.allowedExtensions) && config.uploads.allowedExtensions.length > 0
            ? config.uploads.allowedExtensions
            : ['.rep'];
        const hasValidExtension = allowedExtensions.some(ext => file.originalname.endsWith(ext));
        if (hasValidExtension) {
            cb(null, true);
        } else {
            cb(new Error(`Only ${allowedExtensions.join(', ')} files are allowed`), false);
        }
    },
    limits: {
        fileSize: (Number(config.uploads?.maxFileSizeMB) || 100) * 1024 * 1024 // Default 100MB limit
    }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve Angular build files - check multiple locations for flexibility
const angularBuildCandidates = [
    path.join(__dirname, 'UI'),
    path.join(__dirname, '../frontend/dist/angular-ui/browser'),
    path.join(__dirname, '../angular-ui/dist/angular-ui/browser')
];
const angularBuildPath = angularBuildCandidates.find(candidate => fs.existsSync(candidate)) || angularBuildCandidates[0];
const rootPath = __dirname;

console.log(`Looking for Angular UI files...`);
console.log(`  - Angular build candidates:`);
angularBuildCandidates.forEach(candidate => {
    console.log(`    * ${candidate} ${fs.existsSync(candidate) ? '(exists)' : '(missing)'}`);
});
console.log(`  - Selected Angular build path: ${angularBuildPath}`);
console.log(`  - Root path: ${rootPath}`);

// Check if we have Angular files in the build directory (for local development)
const angularFiles = ['index.html', 'main-7HLBW2LV.js', 'polyfills-5CFQRCPP.js', 'styles-LBSJOWU2.css'];
const buildFiles = angularFiles.filter(file => fs.existsSync(path.join(angularBuildPath, file)));
const rootFiles = angularFiles.filter(file => fs.existsSync(path.join(rootPath, file)));

console.log(`Found Angular files in build directory: ${buildFiles.join(', ')}`);
console.log(`Found Angular files in root directory: ${rootFiles.join(', ')}`);

if (buildFiles.length > 0) {
    // Local development - serve from Angular build directory
    app.use(express.static(angularBuildPath));
    console.log(`Static files will be served from Angular build directory: ${angularBuildPath}`);
} else if (rootFiles.length > 0) {
    // Bridge deployment - serve from root directory
    app.use(express.static(rootPath));
    console.log(`Static files will be served from root directory: ${rootPath}`);
} else {
    console.log('No Angular files found in either location!');
}

// Serve the main UI at root path
app.get('/', (req, res) => {
    console.log('Root path requested');
    
    // Try Angular build directory first (local development)
    const buildIndexPath = path.join(angularBuildPath, 'index.html');
    const rootIndexPath = path.join(rootPath, 'index.html');
    
    console.log(`Looking for index.html at: ${buildIndexPath}`);
    console.log(`Build index.html exists: ${fs.existsSync(buildIndexPath)}`);
    console.log(`Looking for index.html at: ${rootIndexPath}`);
    console.log(`Root index.html exists: ${fs.existsSync(rootIndexPath)}`);
    
    if (fs.existsSync(buildIndexPath)) {
        console.log(`Serving index.html from Angular build directory: ${buildIndexPath}`);
        return res.sendFile(buildIndexPath);
    } else if (fs.existsSync(rootIndexPath)) {
        console.log(`Serving index.html from root directory: ${rootIndexPath}`);
        return res.sendFile(rootIndexPath);
    } else {
        console.log('index.html not found in either location');
        res.status(404).send(`
            <h2>Angular UI not found</h2>
            <p>Current working directory: ${__dirname}</p>
            <p>Angular build path: ${angularBuildPath}</p>
            <p>Root path: ${rootPath}</p>
            <p>Build directory contents:</p>
            <ul>
                ${fs.existsSync(angularBuildPath) ? fs.readdirSync(angularBuildPath).map(f => `<li>${f}</li>`).join('') : '<li>Directory does not exist</li>'}
            </ul>
            <p>Root directory contents:</p>
            <ul>
                ${fs.readdirSync(__dirname).map(f => `<li>${f}</li>`).join('')}
            </ul>
        `);
    }
});

// Catch-all route moved to the end after all API routes

// Login page is now handled by Angular

// Login API endpoint
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ success: false, error: 'Username and password are required' });
        }
        
        console.log(`Attempting login for user: ${username}`);
        
        const authResult = await authenticateWithKeycloak(username, password);
        
        if (authResult.success) {
            // Store user session
            req.session.authenticated = true;
            req.session.username = username;
            req.session.accessToken = authResult.accessToken;
            
            console.log(`Login successful for user: ${username}`);
            res.json({ success: true, message: 'Login successful' });
        } else {
            console.log(`Login failed for user: ${username} - ${authResult.error}`);
            res.json({ success: false, error: authResult.error });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Logout endpoint
app.post('/api/auth/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
            return res.status(500).json({ success: false, error: 'Logout failed' });
        }
        res.json({ success: true, message: 'Logged out successfully' });
    });
});

// Authentication status endpoint
app.get('/api/auth/status', (req, res) => {
    res.json({
        authenticated: !!(req.session && req.session.authenticated),
        username: req.session?.username || null
    });
});

// API endpoint to get bridge servers
app.get('/api/servers', requireAuth, (req, res) => {
    res.json(BRIDGE_SERVERS);
});

// Upload endpoint
app.post('/upload', requireAuth, upload.single('repFile'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No file uploaded' });
        }

        const fileId = Date.now().toString();
        const fileInfo = {
            fileId: fileId,
            originalName: req.file.originalname,
            size: req.file.size,
            filePath: req.file.path
        };

        // Store file info in memory (in production, use a database)
        global.uploadedFiles.set(fileId, fileInfo);

        res.json({ success: true, ...fileInfo });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Deploy endpoint
app.post('/deploy', requireAuth, async (req, res) => {
    try {
        const { fileIds, serverIds } = req.body;
        
        if (!fileIds || fileIds.length === 0) {
            return res.status(400).json({ success: false, error: 'No files selected for deployment' });
        }

        if (!serverIds || serverIds.length === 0) {
            return res.status(400).json({ success: false, error: 'No servers selected for deployment' });
        }

        const deploymentResults = [];
        const successfulDeployments = [];
        const failedDeployments = [];

        for (const fileId of fileIds) {
            const fileInfo = global.uploadedFiles.get(fileId);
            if (!fileInfo) {
                failedDeployments.push({
                    fileName: 'Unknown',
                    server: 'All',
                    error: 'File not found'
                });
                continue;
            }

            for (const serverId of serverIds) {
                const server = BRIDGE_SERVERS[serverId];
                if (!server) {
                    failedDeployments.push({
                        fileName: fileInfo.originalName,
                        server: 'Unknown',
                        error: 'Server not found'
                    });
                    continue;
                }

                try {
                    let result;
                    
                    if (server.authType === 'oauth') {
                        const token = await getOAuthToken(server);
                        result = await deployWithOAuth(fileInfo.filePath, server, token);
                    } else {
                        // Use direct HTTP request for basic auth
                        result = await deployWithBasicAuth(fileInfo.filePath, server);
                    }

                    deploymentResults.push({
                        file: fileInfo.originalName,
                        server: server.name,
                        success: true,
                        result: result
                    });

                    successfulDeployments.push({
                        fileName: fileInfo.originalName,
                        server: server.name,
                        message: 'Deployment successful'
                    });

                } catch (error) {
                    console.error(`Deployment failed for ${fileInfo.originalName} to ${server.name}:`, error.message);
                    
                    failedDeployments.push({
                        fileName: fileInfo.originalName,
                        server: server.name,
                        error: error.message
                    });
                }
            }
        }

        const success = successfulDeployments.length > 0;
        const message = success 
            ? `Successfully deployed ${successfulDeployments.length} deployment(s)`
            : 'No files were successfully deployed';

        res.json({
            success: success,
            message: message,
            successfulDeployments: successfulDeployments,
            failedDeployments: failedDeployments,
            results: deploymentResults
        });

    } catch (error) {
        console.error('Deployment error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Clear uploaded files endpoint
app.post('/clear', (req, res) => {
    try {
        if (global.uploadedFiles) {
            // Delete physical files
            for (const [fileId, fileInfo] of global.uploadedFiles) {
                if (fs.existsSync(fileInfo.filePath)) {
                    fs.unlinkSync(fileInfo.filePath);
                }
            }
            global.uploadedFiles.clear();
        }
        res.json({ success: true, message: 'All files cleared' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Catch-all route to serve Angular app for any route that doesn't match API endpoints
// This MUST be at the very end, after all API routes
app.get('*', (req, res) => {
    console.log(`Catch-all route requested: ${req.path}`);
    
    // Try Angular build directory first (local development)
    const buildIndexPath = path.join(angularBuildPath, 'index.html');
    const rootIndexPath = path.join(rootPath, 'index.html');
    
    if (fs.existsSync(buildIndexPath)) {
        console.log(`Serving index.html for route: ${req.path} from Angular build directory`);
        return res.sendFile(buildIndexPath);
    } else if (fs.existsSync(rootIndexPath)) {
        console.log(`Serving index.html for route: ${req.path} from root directory`);
        return res.sendFile(rootIndexPath);
    } else {
        console.log('index.html not found in either location');
        res.status(404).json({
            error: 'Route not found',
            path: req.path,
            message: 'This is an API-only server. Available endpoints: /api/auth/status, /api/auth/login, /api/auth/logout, /api/servers, /upload, /deploy, /clear, /health'
        });
    }
});

// Start server with automatic port fallback when the default port is in use
function logServerReady(port) {
    console.log(`E2E Bridge Rep File Deployer running on http://localhost:${port}`);
    console.log('Available Bridge Servers:');
    BRIDGE_SERVERS.forEach((server, index) => {
        console.log(`  ${index + 1}. ${server.name} - ${server.scheme}://${server.host}:${server.port}`);
    });
}

function startServer(port, attempt = 0) {
    const server = app.listen(port, () => {
        const activePort = server.address().port;
        logServerReady(activePort);
    });

    server.on('error', (error) => {
        if (error.code === 'EADDRINUSE' && attempt < PORT_RETRY_LIMIT) {
            const nextPort = port + 1;
            console.warn(`Port ${port} is already in use. Retrying with port ${nextPort} (attempt ${attempt + 1}/${PORT_RETRY_LIMIT}).`);
            setTimeout(() => startServer(nextPort, attempt + 1), 100);
        } else if (error.code === 'EADDRINUSE') {
            console.error(`Unable to find a free port after ${PORT_RETRY_LIMIT} attempts. Set the PORT environment variable to an open port.`);
            process.exit(1);
        } else {
            console.error('Failed to start server:', error);
            process.exit(1);
        }
    });
}

startServer(DEFAULT_PORT);
