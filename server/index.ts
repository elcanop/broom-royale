import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { MATCH, SPELL_ORDER, type SpellId } from '../shared/config';
import type { ClientMsg, ServerMsg } from '../shared/protocol';
import { Sim } from '../shared/sim';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const DIST_DIR = path.resolve(__dirname, '../dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

const serveFile = (res: http.ServerResponse, filePath: string, cacheControl: string): void => {
  const ext = path.extname(filePath);
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Cache-Control': cacheControl,
  });
  fs.createReadStream(filePath).pipe(res);
};

const httpServer = http.createServer((req, res) => {
  const cleanUrl = (req.url ?? '/').split('?')[0];
  if (cleanUrl === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, clients: clients.size }));
    return;
  }

  // Serve built static assets in production
  const relPath = cleanUrl === '/' ? 'index.html' : cleanUrl.replace(/^\/+/, '');
  const fullPath = path.resolve(DIST_DIR, relPath);
  if (!fullPath.startsWith(DIST_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
    const isImmutable = relPath.startsWith('assets/') && !relPath.endsWith('.jpg');
    serveFile(res, fullPath, isImmutable ? 'public, max-age=31536000, immutable' : 'public, max-age=300');
  } else {
    const indexPath = path.join(DIST_DIR, 'index.html');
    if (!path.extname(relPath) && fs.existsSync(indexPath)) {
      serveFile(res, indexPath, 'no-cache');
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  }
});

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

interface ClientConn {
  ws: WebSocket;
  entityId: number;
  name: string;
  house: number;
  alive: boolean;
}

let sim = new Sim({ botSkill: 0.65 });
const clients = new Map<WebSocket, ClientConn>();

const send = (ws: WebSocket, msg: ServerMsg): void => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
};

const broadcast = (msg: ServerMsg): void => {
  const raw = JSON.stringify(msg);
  for (const c of clients.values()) {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(raw);
  }
};

const startNewOnlineMatch = (): void => {
  sim = new Sim({ botSkill: 0.65 });
  for (const c of clients.values()) {
    const ent = sim.addEntity(c.name, false, c.house);
    c.entityId = ent.id;
  }
  sim.fillWithBots(MATCH.maxPlayers);
  sim.start();

  const ents = sim.info();
  const loot = sim.lootInfo();
  for (const c of clients.values()) {
    send(c.ws, { t: 'match', seed: sim.seed, you: c.entityId, ents, loot });
  }
};

wss.on('connection', (ws) => {
  const conn: ClientConn = { ws, entityId: -1, name: 'Mago', house: 0, alive: true };
  clients.set(ws, conn);
  ws.on('pong', () => {
    conn.alive = true;
  });

  ws.on('message', (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(raw)) as ClientMsg;
    } catch {
      return;
    }

    if (msg.t === 'hello') {
      conn.name = String(msg.name || 'Mago').slice(0, 18);
      conn.house = Math.max(0, Math.min(3, Number(msg.house) || 0));
      const ent = sim.addEntity(conn.name, false, conn.house);
      conn.entityId = ent.id;
      send(ws, { t: 'welcome', id: ent.id });
    } else if (msg.t === 'start') {
      if (sim.phase === 'lobby' || sim.phase === 'ended') {
        startNewOnlineMatch();
      } else {
        // Join mid-match or restart if only bots were playing
        startNewOnlineMatch();
      }
    } else if (msg.t === 'state') {
      if (conn.entityId > 0 && Array.isArray(msg.p) && Array.isArray(msg.v)) {
        sim.setHumanState(
          conn.entityId,
          { x: Number(msg.p[0]) || 0, y: Number(msg.p[1]) || 0, z: Number(msg.p[2]) || 0 },
          { x: Number(msg.v[0]) || 0, y: Number(msg.v[1]) || 0, z: Number(msg.v[2]) || 0 },
          Number(msg.yaw) || 0,
          Number(msg.pitch) || 0,
          Number(msg.roll) || 0,
          Boolean(msg.shield),
          Boolean(msg.boost),
        );
      }
    } else if (msg.t === 'cast') {
      if (
        conn.entityId > 0 &&
        SPELL_ORDER.includes(msg.spell as SpellId) &&
        Array.isArray(msg.o) &&
        Array.isArray(msg.d)
      ) {
        sim.requestCast(
          conn.entityId,
          msg.spell,
          { x: Number(msg.o[0]) || 0, y: Number(msg.o[1]) || 0, z: Number(msg.o[2]) || 0 },
          { x: Number(msg.d[0]) || 0, y: Number(msg.d[1]) || 0, z: Number(msg.d[2]) || 0 },
        );
      }
    } else if (msg.t === 'crash') {
      if (conn.entityId > 0) sim.applyCrash(conn.entityId, Number(msg.dmg) || 0);
    }
  });

  ws.on('close', () => {
    if (conn.entityId > 0) sim.removeEntity(conn.entityId);
    clients.delete(ws);
  });
});

// Simulation loop at 30 Hz
let snapTick = 0;
setInterval(() => {
  if (clients.size === 0) return;
  sim.step(1 / MATCH.tickRate);
  const events = sim.drainEvents();
  if (events.length) broadcast({ t: 'ev', list: events });

  snapTick++;
  if (snapTick % 2 === 0) {
    const ents = sim.pack();
    const alive = sim.aliveCount();
    for (const c of clients.values()) {
      send(c.ws, {
        t: 'snap',
        time: sim.time,
        phase: sim.phase,
        cd: sim.countdown,
        ents,
        you: sim.you(c.entityId),
        alive,
      });
    }
  }
}, 1000 / MATCH.tickRate);

// Keepalive ping every 25s so cloud proxies (Render/Cloudflare/Railway) keep /ws open
setInterval(() => {
  for (const [ws, conn] of clients) {
    if (!conn.alive) {
      ws.terminate();
      clients.delete(ws);
      continue;
    }
    conn.alive = false;
    ws.ping();
  }
}, 25_000);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[Broom Royale Server] Listening on http://0.0.0.0:${PORT} (ws://0.0.0.0:${PORT}/ws)`);
});

