import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const port = parseInt(process.env.PORT || '8000', 10);
const root = process.cwd();

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml'
};

function buildHeaders(mime, nonce){
    const csp = [
        "default-src 'self'",
        "connect-src 'self' http: https: ws: wss:",
        "img-src 'self' data:",
        "style-src 'self' 'unsafe-inline'",
        nonce ? `script-src 'self' 'nonce-${nonce}'` : "script-src 'self'",
        "script-src-attr 'none'",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'self'",
        "form-action 'self'"
    ].join('; ');
    return {
        'content-type': mime,
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'SAMEORIGIN',
        'referrer-policy': 'no-referrer',
        'cache-control': 'no-store',
        'permissions-policy': 'camera=(), microphone=(), geolocation=()',
        'content-security-policy': csp
    };
}

function createNonce(){
    return crypto.randomBytes(16).toString('base64');
}

function injectNonceIntoHtml(html, nonce){
    return String(html || '').replace(/<script\b(?![^>]*\bnonce=)/gi, `<script nonce="${nonce}"`);
}

function safePath(p){
    const full = path.resolve(root, '.' + p);
    const rel = path.relative(root, full);
    if(rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return full;
}

const server = http.createServer((req, res) => {
    try{
        if(req.method !== 'GET' && req.method !== 'HEAD'){
            res.writeHead(405, buildHeaders('text/plain; charset=utf-8'));
            if(req.method !== 'HEAD') res.end('method not allowed');
            else res.end();
            return;
        }
        const url = new URL(req.url || '/', 'http://localhost');
        const reqPath = decodeURIComponent(url.pathname);
        const rel = reqPath === '/' ? '/register.html' : reqPath;
        const full = safePath(rel);
        if(!full){
            res.writeHead(403, buildHeaders('text/plain; charset=utf-8'));
            res.end('forbidden');
            return;
        }
        let stat = null;
        try{
            stat = fs.statSync(full);
        }catch{
            res.writeHead(404, buildHeaders('text/plain; charset=utf-8'));
            res.end('not found');
            return;
        }
        if(stat.isDirectory()){
            const nonce = createNonce();
            res.writeHead(302, {
                ...buildHeaders('text/plain; charset=utf-8', nonce),
                location: rel.replace(/\/+$/,'') + '/index.html',
                'content-length': '0'
            });
            res.end();
            return;
        }
        const ext = path.extname(full).toLowerCase();
        const mime = MIME[ext] || 'application/octet-stream';
        const nonce = createNonce();
        if(ext === '.html'){
            const html = fs.readFileSync(full, 'utf8');
            const body = injectNonceIntoHtml(html, nonce);
            const headers = buildHeaders(mime, nonce);
            headers['content-length'] = Buffer.byteLength(body);
            res.writeHead(200, headers);
            if(req.method === 'HEAD'){
                res.end();
                return;
            }
            res.end(body);
            return;
        }
        res.writeHead(200, buildHeaders(mime, nonce));
        if(req.method === 'HEAD'){
            res.end();
            return;
        }
        fs.createReadStream(full).pipe(res);
    }catch{
        res.writeHead(500, buildHeaders('text/plain; charset=utf-8'));
        res.end('error');
    }
});

server.listen(port, '0.0.0.0', () => {
    process.stdout.write(`static http server on ${port}\n`);
});
