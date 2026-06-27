import http from 'http';
import { WebSocketServer } from 'ws';

const port = parseInt(process.env.PORT || '8787', 10);
const MAX_ROOM_PEERS = 8;
const MAX_MESSAGE_BYTES = 16 * 1024;
const RATE_LIMIT_WINDOW_MS = 10 * 1000;
const MAX_MESSAGES_PER_WINDOW = 120;
const ROOM_RE = /^\d{2}$/;
const PEER_RE = /^[A-Za-z0-9_-]{6,64}$/;

const server = http.createServer((req, res) => {
    res.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store'
    });
    res.end('AIM2M signaling server');
});

const wss = new WebSocketServer({ server, maxPayload: MAX_MESSAGE_BYTES });

const rooms = new Map();

function getRoom(room){
    if(!rooms.has(room)) rooms.set(room, new Map());
    return rooms.get(room);
}

function send(ws, obj){
    if(ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify(obj));
}

function isValidRoom(room){
    return ROOM_RE.test(room);
}

function isValidPeerId(peerId){
    return PEER_RE.test(peerId);
}

function broadcast(room, obj, exceptPeerId){
    const r = rooms.get(room);
    if(!r) return;
    for(const [pid, sock] of r.entries()){
        if(exceptPeerId && pid === exceptPeerId) continue;
        send(sock, obj);
    }
}

wss.on('connection', (socket) => {
    socket.peerId = null;
    socket.room = null;
    socket.isAlive = true;
    socket.messageCount = 0;
    socket.windowStartedAt = Date.now();

    socket.on('pong', () => {
        socket.isAlive = true;
    });

    socket.on('message', (buf) => {
        const now = Date.now();
        if(now - socket.windowStartedAt >= RATE_LIMIT_WINDOW_MS){
            socket.windowStartedAt = now;
            socket.messageCount = 0;
        }
        socket.messageCount += 1;
        if(socket.messageCount > MAX_MESSAGES_PER_WINDOW){
            socket.close(1008, 'rate-limit');
            return;
        }
        const payloadBytes = Buffer.isBuffer(buf) ? buf.byteLength : Buffer.byteLength(String(buf));
        if(payloadBytes > MAX_MESSAGE_BYTES){
            socket.close(1009, 'too-large');
            return;
        }
        let msg = null;
        try{
            msg = JSON.parse(String(buf));
        }catch{
            return;
        }
        if(!msg || typeof msg.type !== 'string') return;

        if(msg.type === 'join'){
            const room = String(msg.room || '').padStart(2,'0');
            const peerId = String(msg.peerId || '');
            if(!isValidRoom(room) || !isValidPeerId(peerId)) return;

            const r = getRoom(room);
            if(r.size >= MAX_ROOM_PEERS && !r.has(peerId)){
                send(socket, { type:'error', code:'ROOM_FULL' });
                return;
            }
            if(r.has(peerId) && r.get(peerId) !== socket){
                try{
                    r.get(peerId).close(1008, 'peer-replaced');
                }catch{}
            }
            socket.peerId = peerId;
            socket.room = room;
            r.set(peerId, socket);

            const peers = Array.from(r.keys()).filter(p => p !== peerId);
            send(socket, { type:'peers', room, peers });
            broadcast(room, { type:'peer-joined', room, peerId }, peerId);
            return;
        }

        if(msg.type === 'signal'){
            const room = String(msg.room || '').padStart(2,'0');
            const from = String(msg.from || '');
            const to = msg.to ? String(msg.to) : null;
            if(!isValidRoom(room) || !isValidPeerId(from) || (to && !isValidPeerId(to)) || msg.data == null) return;
            if(typeof msg.data !== 'object' && typeof msg.data !== 'string') return;
            if(socket.room !== room || socket.peerId !== from) return;
            const r = rooms.get(room);
            if(!r) return;
            if(to && r.has(to)){
                send(r.get(to), { type:'signal', room, from, to, data: msg.data });
            }else{
                broadcast(room, { type:'signal', room, from, to: null, data: msg.data }, from);
            }
            return;
        }
    });

    socket.on('close', () => {
        const room = socket.room;
        const peerId = socket.peerId;
        if(room && peerId){
            const r = rooms.get(room);
            if(r){
                r.delete(peerId);
                broadcast(room, { type:'peer-left', room, peerId }, peerId);
                if(r.size === 0) rooms.delete(room);
            }
        }
    });
});

const heartbeat = setInterval(() => {
    for(const socket of wss.clients){
        if(socket.isAlive === false){
            try{ socket.terminate(); }catch{}
            continue;
        }
        socket.isAlive = false;
        try{ socket.ping(); }catch{}
    }
}, 15000);

wss.on('close', () => clearInterval(heartbeat));

server.listen(port, () => {
    process.stdout.write(`listening ${port}\n`);
});
