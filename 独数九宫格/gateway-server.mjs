import http from 'http';
import crypto from 'crypto';

const port = parseInt(process.env.GATEWAY_PORT || process.env.PORT || '8790', 10);
const GATEWAY_SECRET = process.env.AIM2M_GATEWAY_SECRET || 'AIM2M_GATEWAY_SECRET_V1';
const KEYGEN_CORE_SALT = 'AIM2M_GOD_MODE_99';
const QUOTE_TTL_MS = 15 * 60 * 1000;
const TOKEN_TTL_SECONDS = 60 * 60;
const quotes = new Map();
const activeTokens = new Map();

function json(res, statusCode, payload, extraHeaders = {}){
    const body = JSON.stringify(payload, null, 2);
    res.writeHead(statusCode, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type, authorization',
        ...extraHeaders
    });
    res.end(body);
}

function authMiddleware(req, res, pathname){
    // 检查是否是受保护的路由（/api/ 开头）
    if(!pathname.startsWith('/api/')){
        return { authorized: true };
    }
    
    // 从请求头获取 Authorization
    const authHeader = req.headers['authorization'] || '';
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    
    if(!match || !match[1]){
        json(res, 401, { error: 'Invalid or missing Token' });
        return { authorized: false };
    }
    
    const token = match[1].trim();
    
    // 简单验证：token 非空即有效（后续可升级为完整验证）
    if(!token){
        json(res, 401, { error: 'Invalid or missing Token' });
        return { authorized: false };
    }
    
    // 验证 token 是否在活跃列表中
    const tokenData = activeTokens.get(token);
    if(!tokenData){
        json(res, 401, { error: 'Invalid or missing Token' });
        return { authorized: false };
    }
    
    // 检查 token 是否过期
    if(tokenData.exp && tokenData.exp < Math.floor(Date.now() / 1000)){
        json(res, 401, { error: 'Invalid or missing Token' });
        return { authorized: false };
    }
    
    return { authorized: true, tokenData };
}

function readBody(req){
    return new Promise((resolve, reject)=>{
        let data = '';
        req.on('data', (chunk)=>{
            data += chunk;
            if(data.length > 256 * 1024){
                reject(new Error('BODY_TOO_LARGE'));
                req.destroy();
            }
        });
        req.on('end', ()=> resolve(data));
        req.on('error', reject);
    });
}

function base64url(input){
    return Buffer.from(input).toString('base64url');
}

function toHex8(n){
    return Math.abs(n).toString(16).toUpperCase().padStart(8, '0');
}

function computeKeygenCode(identity){
    let hash = 0;
    const str = String(identity || '').trim() + KEYGEN_CORE_SALT;
    for(let i = 0; i < str.length; i++){
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    const rawKey = toHex8(hash);
    return `AIM2M-${rawKey.slice(0,4)}-${rawKey.slice(4,8)}-OFFLINE`;
}

function normalizeCode(code){
    return String(code || '').trim().toUpperCase();
}

function verifyHumanVoucher(identity, code){
    const id = String(identity || '').trim();
    const voucher = normalizeCode(code);
    if(!id || !/^AIM2M-[0-9A-F]{4}-[0-9A-F]{4}-OFFLINE$/.test(voucher)){
        return { ok: false, reason: 'INVALID_VOUCHER' };
    }
    const expected = computeKeygenCode(id);
    return { ok: expected === voucher, expected };
}

function signPayload(payload){
    return crypto.createHmac('sha256', GATEWAY_SECRET)
        .update(JSON.stringify(payload))
        .digest('base64url');
}

function issueToken(kind, subject, scope, ttlSeconds, extra = {}){
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        kind,
        sub: subject,
        scope,
        iat: now,
        exp: now + ttlSeconds,
        ...extra
    };
    const encoded = base64url(JSON.stringify(payload));
    const signature = signPayload(payload);
    return `${encoded}.${signature}`;
}

function verifyToken(token, expectedKind){
    const raw = String(token || '').trim();
    const parts = raw.split('.');
    if(parts.length !== 2) return { ok: false, reason: 'TOKEN_FORMAT' };
    try{
        const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
        const expectedSig = signPayload(payload);
        if(parts[1] !== expectedSig) return { ok: false, reason: 'TOKEN_SIG' };
        if(expectedKind && payload.kind !== expectedKind) return { ok: false, reason: 'TOKEN_KIND' };
        if(payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return { ok: false, reason: 'TOKEN_EXPIRED' };
        return { ok: true, payload };
    }catch{
        return { ok: false, reason: 'TOKEN_PARSE' };
    }
}

function createQuote(agentId){
    const quoteId = `quote_${crypto.randomBytes(6).toString('hex')}`;
    const quote = {
        quote_id: quoteId,
        amount: '0.001',
        asset: 'USDT',
        network: 'BASE',
        agent_id: String(agentId || 'unknown'),
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + QUOTE_TTL_MS).toISOString()
    };
    quotes.set(quoteId, quote);
    return quote;
}

function getQuote(quoteId){
    const quote = quotes.get(String(quoteId || ''));
    if(!quote) return null;
    if(new Date(quote.expires_at).getTime() < Date.now()){
        quotes.delete(quote.quote_id);
        return null;
    }
    return quote;
}

function buildReceiptProof(quote, agentId){
    return crypto.createHash('sha256')
        .update(`${quote.quote_id}|${quote.amount}|${quote.asset}|${agentId}|PAID`)
        .digest('hex');
}

function buildPaywallResponse(agentId, quote){
    return {
        version: 'x402-handshake-v1',
        status: 'payment-required',
        route: 'x402-paywall',
        paywall: {
            http_status: 402,
            required_scheme: 'x402',
            quote_id: quote.quote_id,
            amount: quote.amount,
            asset: quote.asset,
            network: quote.network,
            expires_at: quote.expires_at,
            pay_to: '0x86524871F310c8Cf70b824c9e96Fe235f16CbF38',
            memo: `AIM2M_AGENT_${String(agentId || 'unknown')}`
        },
        dev_receipt_example: {
            scheme: 'x402',
            quote_id: quote.quote_id,
            payer: 'local-agent',
            proof: buildReceiptProof(quote, agentId)
        }
    };
}

function verifyReceipt(receipt, agentId){
    if(!receipt || receipt.scheme !== 'x402' || !receipt.quote_id || !receipt.proof){
        return { ok: false, reason: 'RECEIPT_FORMAT' };
    }
    const quote = getQuote(receipt.quote_id);
    if(!quote) return { ok: false, reason: 'QUOTE_NOT_FOUND' };
    const expected = buildReceiptProof(quote, agentId);
    if(String(receipt.proof) !== expected){
        return { ok: false, reason: 'RECEIPT_PROOF' };
    }
    return { ok: true, quote };
}

function normalizeJsonRequest(body){
    return body && typeof body === 'object' ? body : {};
}

function buildHandshakeResponse(status, route, extra = {}){
    return {
        version: 'x402-handshake-v1',
        status,
        route,
        ...extra
    };
}

const server = http.createServer(async (req, res) => {
    try{
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        if(req.method === 'OPTIONS'){
            res.writeHead(204, {
                'access-control-allow-origin': '*',
                'access-control-allow-methods': 'GET,POST,OPTIONS',
                'access-control-allow-headers': 'content-type, authorization'
            });
            res.end();
            return;
        }

        if(req.method === 'GET' && url.pathname === '/health'){
            json(res, 200, {
                status: 'ok',
                service: 'aim2m-real-gateway',
                port,
                quotes: quotes.size
            });
            return;
        }

        if(req.method === 'POST' && url.pathname === '/paywall'){
            const payload = normalizeJsonRequest(JSON.parse(await readBody(req) || '{}'));
            const agentId = payload.agent && payload.agent.id ? payload.agent.id : 'unknown-agent';
            const quote = createQuote(agentId);
            json(res, 402, buildPaywallResponse(agentId, quote));
            return;
        }

        if(req.method === 'POST' && url.pathname === '/handshake'){
            const payload = normalizeJsonRequest(JSON.parse(await readBody(req) || '{}'));
            const agentId = payload.agent && payload.agent.id ? String(payload.agent.id) : 'unknown-agent';
            const presentedToken = payload.auth && payload.auth.presented_token;

            if(presentedToken && presentedToken.kind === 'human' && presentedToken.value){
                const verifiedHuman = verifyToken(presentedToken.value, 'human');
                if(verifiedHuman.ok){
                    json(res, 200, buildHandshakeResponse('routed-human', 'human-chat', {
                        issued_token: null,
                        gateway: { verified_subject: verifiedHuman.payload.sub, token_kind: 'human' },
                        errors: []
                    }));
                    return;
                }
            }

            if(presentedToken && presentedToken.kind === 'agent' && presentedToken.value){
                const verifiedAgent = verifyToken(presentedToken.value, 'agent');
                if(verifiedAgent.ok){
                    json(res, 200, buildHandshakeResponse('accepted', 'agent-handshake', {
                        issued_token: null,
                        gateway: { verified_subject: verifiedAgent.payload.sub, token_kind: 'agent' },
                        errors: []
                    }));
                    return;
                }
            }

            const human = payload.human || {};
            if(human.identity && human.voucher_code){
                const voucherCheck = verifyHumanVoucher(human.identity, human.voucher_code);
                if(voucherCheck.ok){
                    const token = issueToken('human', String(human.identity).trim(), 'human-chat', TOKEN_TTL_SECONDS, {
                        identity_type: human.identity_type || 'local'
                    });
                    const payload = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
                    activeTokens.set(token, payload);
                    json(res, 200, buildHandshakeResponse('routed-human', 'human-chat', {
                        issued_token: { kind: 'human', value: token, expires_in: TOKEN_TTL_SECONDS },
                        gateway: { verified_subject: String(human.identity).trim(), token_kind: 'human' },
                        errors: []
                    }));
                    return;
                }
            }

            const receiptCheck = verifyReceipt(payload.payment && payload.payment.receipt, agentId);
            if(receiptCheck.ok){
                const token = issueToken('agent', agentId, 'agent-handshake', TOKEN_TTL_SECONDS, {
                    quote_id: receiptCheck.quote.quote_id
                });
                const payload = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
                activeTokens.set(token, payload);
                json(res, 200, buildHandshakeResponse('accepted', 'agent-handshake', {
                    issued_token: { kind: 'agent', value: token, expires_in: TOKEN_TTL_SECONDS },
                    gateway: { verified_subject: agentId, token_kind: 'agent' },
                    errors: []
                }));
                return;
            }

            const quote = createQuote(agentId);
            json(res, 402, buildPaywallResponse(agentId, quote));
            return;
        }

        // 受保护的 /api/ 路由认证检查
        const authCheck = authMiddleware(req, res, url.pathname);
        if(!authCheck.authorized){
            return;
        }

        if(req.method === 'GET' && url.pathname === '/api/test'){
            json(res, 200, {
                status: 'success',
                message: 'Protected API route accessed successfully',
                token_info: authCheck.tokenData
            });
            return;
        }

        json(res, 404, { status: 'not-found', path: url.pathname });
    }catch(error){
        json(res, 500, {
            status: 'error',
            message: error && error.message ? error.message : 'UNKNOWN_GATEWAY_ERROR'
        });
    }
});

server.listen(port, '0.0.0.0', () => {
    process.stdout.write(`gateway listening ${port}\n`);
});
