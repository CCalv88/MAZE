// MAZE server: the static game, a store of shared mazes, and the room relay at /ws.
//
// Mazes are content addressed: a maze's code is a hash of its layout (Level.code), so
// the same maze always gets the same code. Rooms are 5-letter codes, as in 9-5, Sima and
// White Room. While a room is playing, the server runs the authoritative world (js/sim.js,
// the same file the browser uses for solo play) at 20 ticks a second: clients report
// where they are and what they did, and get back a snapshot of everything else.
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer } = require('ws');
const { loadCore } = require('./core.js');

const MAZE = loadCore();
const L = MAZE.Level;

const PORT = process.env.PORT === undefined ? 3700 : Number(process.env.PORT);
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const MAZE_DIR = path.join(DATA_DIR, 'mazes');
const TICK_MS = 50;
const MAX_MSG = 64 * 1024;
const ROOM_IDLE_MS = 30 * 60 * 1000;      // a room nobody is in closes after half an hour
const MATCH_IDLE_MS = 5 * 60 * 1000;      // a match everyone left ends after five minutes
const MAX_MAZES = 20000;
fs.mkdirSync(MAZE_DIR, { recursive: true });

/* ---------- static files ---------- */
const files = { '/': 'index.html', '/index.html': 'index.html', '/css/style.css': 'css/style.css' };
for (const f of fs.readdirSync(path.join(__dirname, 'js'))) if (f.endsWith('.js')) files['/js/' + f] = 'js/' + f;
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/health') return json(res, 200, { ok: true, rooms: rooms.size, playing: [...rooms.values()].filter(r => r.sim).length, players: clients.size });

  // shared mazes: GET /m/<code> loads one, POST /m publishes one and returns its code
  if (url === '/m' && req.method === 'POST') {
    if (!allowPublish(req)) return json(res, 429, { error: 'Too many mazes shared at once. Try again in a minute.' });
    let body = '', over = false;
    req.on('data', c => { body += c; if (body.length > MAX_MSG) { over = true; req.destroy(); } });
    req.on('end', () => {
      if (over) return;
      try { const m = publish(JSON.parse(body)); json(res, 200, { code: m.code, name: m.level.name }); }
      catch (e) { json(res, 400, { error: e.message }); }
    });
    return;
  }
  const mm = /^\/m\/([0-9A-Za-z]{1,12})$/.exec(url);
  if (mm && (req.method === 'GET' || req.method === 'HEAD')) {
    const m = loadMaze(L.normCode(mm[1]));
    if (!m) return json(res, 404, { error: 'No maze with that code.' });
    return json(res, 200, Object.assign(JSON.parse(L.toJSON(m.level)), { code: m.code }));
  }

  const file = files[url];
  if (!file) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
  fs.readFile(path.join(__dirname, file), (error, data) => {
    if (error) { res.writeHead(500); res.end('Unable to load file'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] + '; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});

/* ---------- maze store ---------- */
const mazeCache = new Map();   // code -> { code, level }

// sharing writes to disk, so each address gets a modest budget per minute
const publishLog = new Map();  // ip -> recent timestamps
function allowPublish(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now(), recent = (publishLog.get(ip) || []).filter(t => now - t < 60000);
  recent.push(now);
  publishLog.set(ip, recent);
  if (publishLog.size > 5000) publishLog.clear();
  return recent.length <= 30;
}

// Clean a submitted maze, check it can be played, and file it under its hash code.
function publish(raw) {
  const lv = L.fromJSON(raw);
  const v = L.validate(lv);
  if (!v.ok) throw new Error(v.errors[0]);
  const canon = L.canonical(lv);
  for (let salt = 0; salt < 8; salt++) {
    const code = L.code(lv, salt);
    const have = loadMaze(code);
    if (have && L.canonical(have.level) !== canon) continue;     // a hash collision: try the next salt
    if (!have) {
      pruneMazes();
      fs.writeFileSync(path.join(MAZE_DIR, code + '.json'), L.toJSON(lv));
    } else if (have.level.name !== lv.name && have.level.name.startsWith('Untitled') && !lv.name.startsWith('Untitled')) {
      have.level.name = lv.name;                                 // a real name beats a placeholder
      fs.writeFileSync(path.join(MAZE_DIR, code + '.json'), L.toJSON(have.level));
    }
    const m = { code, level: have ? have.level : lv };
    mazeCache.set(code, m);
    return m;
  }
  throw new Error('Could not file that maze.');
}

function loadMaze(code) {
  if (!L.isMazeCode(code)) return null;
  if (mazeCache.has(code)) return mazeCache.get(code);
  try {
    const level = L.fromJSON(fs.readFileSync(path.join(MAZE_DIR, code + '.json'), 'utf8'));
    const m = { code, level };
    if (mazeCache.size > 500) mazeCache.delete(mazeCache.keys().next().value);
    mazeCache.set(code, m);
    return m;
  } catch { return null; }
}

// keep the store bounded: past the limit, the least recently written mazes go first
function pruneMazes() {
  let names;
  try { names = fs.readdirSync(MAZE_DIR); } catch { return; }
  if (names.length < MAX_MAZES) return;
  const aged = names.map(n => { try { return { n, t: fs.statSync(path.join(MAZE_DIR, n)).mtimeMs }; } catch { return { n, t: 0 }; } }).sort((a, b) => a.t - b.t);
  for (const { n } of aged.slice(0, names.length - MAX_MAZES + 100)) { try { fs.unlinkSync(path.join(MAZE_DIR, n)); } catch { /* gone already */ } mazeCache.delete(n.replace(/\.json$/, '')); }
}

/* ---------- rooms ---------- */
const rooms = new Map();    // code -> room
const clients = new Map();  // ws -> { code, pid }

function send(ws, msg) { if (ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); }
function newCode() { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; let c = ''; for (let i = 0; i < 5; i++) c += A[Math.floor(Math.random() * A.length)]; return rooms.has(c) ? newCode() : c; }
function members(room) { return [...clients.entries()].filter(([w, m]) => m.code === room.code && w.readyState === 1); }
function socketsFor(room, pid) { return members(room).filter(([, m]) => m.pid === pid).map(([w]) => w); }
function isOnline(room, pid) { return members(room).some(([, m]) => m.pid === pid); }
function broadcast(room, msg) { const s = typeof msg === 'string' ? msg : JSON.stringify(msg); for (const [w] of members(room)) send(w, s); }
function seatOf(room, pid) { return room.seats.findIndex(s => s && s.pid === pid); }
function cleanName(n) { return String(n || '').replace(/[^\w \-'!?.]/g, '').trim().slice(0, 14); }
function cleanMode(m) { return m === 'versus' ? 'versus' : 'coop'; }

function roster(room) {
  return room.seats.map((s, seat) => s && { seat, name: s.name, online: isOnline(room, s.pid), playing: !!(room.sim && room.sim.player(seat)) }).filter(Boolean);
}
// The creator runs the lobby. If they drop off, whoever is next still here can, so a
// room never gets stuck waiting for a host who closed the tab.
function controller(room) {
  if (isOnline(room, room.host)) return room.host;
  const next = room.seats.find(s => s && isOnline(room, s.pid));
  return next ? next.pid : room.host;
}
function hostSeat(room) { return seatOf(room, controller(room)); }
function mazeInfo(room) { return { code: room.maze.code, name: room.maze.level.name, level: JSON.parse(L.toJSON(room.maze.level)) }; }
function lobbyMsg(room) {
  return { t: 'lobby', players: roster(room), mode: room.mode, state: room.sim ? 'playing' : 'lobby', hostSeat: hostSeat(room), maze: mazeInfo(room), result: room.lastResult || null };
}
function roomMsg(room, seat) {
  return Object.assign(lobbyMsg(room), { t: 'room', code: room.code, seat, host: room.seats[seat].pid === controller(room) });
}
function pushLobby(room) { broadcast(room, lobbyMsg(room)); }

function sendStart(room, ws, seat) {
  const names = {};
  room.seats.forEach((s, i) => { if (s) names[i] = s.name; });
  send(ws, { t: 'start', seat, full: room.sim.fullState(), names, round: room.round });
}

function startMatch(room) {
  const sim = new MAZE.Sim(room.maze.level, { mode: room.mode, freeze: 3 });
  room.seats.forEach((s, seat) => { if (s && isOnline(room, s.pid)) sim.addPlayer(seat, s.name); });
  if (!sim.players.some(Boolean)) return false;
  room.sim = sim;
  room.round = (room.round || 0) + 1;
  room.lastTick = Date.now();
  room.lastSeen = Date.now();
  room.lastResult = null;
  for (const [w, m] of members(room)) {
    const seat = seatOf(room, m.pid);
    if (seat >= 0 && sim.player(seat)) sendStart(room, w, seat);
  }
  pushLobby(room);
  console.log(`start ${room.code} round ${room.round} mode ${room.mode} maze ${room.maze.code} players ${sim.players.filter(Boolean).length}`);
  return true;
}

function endMatch(room, result) {
  room.sim = null;
  room.seats = room.seats.map(s => (s && s.left && !isOnline(room, s.pid) ? null : s));   // quitters free their seats
  room.lastResult = result || null;
  room.updated = Date.now();
  pushLobby(room);
}

function handle(ws, msg) {
  const meta = clients.get(ws);
  if (msg.t === 'create') {
    const pid = String(msg.pid || '').slice(0, 40);
    if (!pid) return send(ws, { t: 'error', msg: 'Missing player id.' });
    let maze;
    try { maze = publish(msg.level); } catch (e) { return send(ws, { t: 'error', msg: e.message }); }
    ws.creates = (ws.creates || 0) + 1;
    if (ws.creates > 20) return send(ws, { t: 'error', msg: 'Too many rooms from one connection.' });
    const code = newCode();
    const room = { code, host: pid, mode: cleanMode(msg.mode), maze, seats: [{ pid, name: cleanName(msg.name) || 'Player 1' }, null, null, null], sim: null, round: 0, updated: Date.now() };
    rooms.set(code, room);
    clients.set(ws, { code, pid });
    console.log(`create ${code} maze ${maze.code} clients ${clients.size}`);
    send(ws, roomMsg(room, 0));
    return;
  }
  if (msg.t === 'join') {
    const code = String(msg.code || '').toUpperCase().replace(/[^A-Z]/g, ''), room = rooms.get(code), pid = String(msg.pid || '').slice(0, 40);
    if (!room) return send(ws, { t: 'error', msg: `No room called ${code || '(blank)'}. Room codes are 5 letters.` });
    if (!pid) return send(ws, { t: 'error', msg: 'Missing player id.' });
    let seat = seatOf(room, pid);
    if (seat < 0) {
      seat = room.seats.findIndex(s => !s);
      // a full room can give up the seat of someone who left, but never mid-match
      if (seat < 0) seat = room.seats.findIndex(s => s && !isOnline(room, s.pid) && s.pid !== room.host && !(room.sim && room.sim.player(room.seats.indexOf(s))));
      if (seat < 0) return send(ws, { t: 'error', msg: 'That room is full (4 players).' });
      room.seats[seat] = { pid, name: cleanName(msg.name) || `Player ${seat + 1}` };
    } else {
      if (cleanName(msg.name)) room.seats[seat].name = cleanName(msg.name);
      room.seats[seat].left = false;
    }
    for (const [w, m] of clients) if (w !== ws && m.pid === pid && m.code === code) clients.delete(w);   // an older tab of the same player
    clients.set(ws, { code, pid });
    room.updated = Date.now();
    console.log(`join ${code} seat ${seat} members ${members(room).length}`);
    send(ws, roomMsg(room, seat));
    if (room.sim && room.sim.player(seat)) { room.sim.setAway(seat, false); sendStart(room, ws, seat); }
    pushLobby(room);
    return;
  }
  if (!meta || !rooms.has(meta.code)) return;
  const room = rooms.get(meta.code), seat = seatOf(room, meta.pid);
  if (seat < 0) return;
  const isHost = controller(room) === meta.pid;

  switch (msg.t) {
    case 'hb': return send(ws, { t: 'hb' });
    case 'leave': {
      clients.delete(ws);
      if (!isOnline(room, meta.pid)) {
        if (room.sim && room.sim.player(seat)) { room.sim.setAway(seat, true); room.seats[seat].left = true; }
        else room.seats[seat] = null;                              // gone from the lobby: free the seat
        if (room.host === meta.pid) { const next = room.seats.find(s => s && s.pid !== meta.pid && isOnline(room, s.pid)); if (next) room.host = next.pid; }
      }
      if (!members(room).length && !room.sim) { rooms.delete(room.code); return; }
      pushLobby(room);
      return;
    }
    case 'mode':
      if (!isHost || room.sim) return;
      room.mode = cleanMode(msg.mode);
      return pushLobby(room);
    case 'maze': {
      if (!isHost || room.sim) return;
      try { room.maze = publish(msg.level); } catch (e) { return send(ws, { t: 'error', msg: e.message }); }
      room.lastResult = null;
      return pushLobby(room);
    }
    case 'start':
      if (!isHost || room.sim) return;
      if (!startMatch(room)) send(ws, { t: 'error', msg: 'Nobody is here to play.' });
      return;
    case 'abort':
      if (!isHost || !room.sim) return;
      broadcast(room, { t: 'aborted' });
      return endMatch(room, null);
  }

  const sim = room.sim;
  if (!sim || !sim.player(seat)) return;
  if (msg.t === 'pos') {
    const m = { x: +msg.x, y: +msg.y, ang: +msg.ang, pitch: +msg.pitch, blk: msg.blk ? 1 : 0, use: msg.use ? 1 : 0, w: msg.w | 0, ep: msg.ep | 0 };
    if (!sim.move(seat, m)) { const p = sim.player(seat); send(ws, { t: 'correct', x: p.x, y: p.y, ep: p.epoch }); }
    room.lastSeen = Date.now();
  } else if (msg.t === 'atk') sim.attack(seat);
  else if (msg.t === 'door') sim.openDoor(seat, msg.x | 0, msg.y | 0);
  else if (msg.t === 'ping') sim.ping(seat, +msg.x, +msg.y);
}

// one clock for every match in progress
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    const sim = room.sim;
    if (!sim) continue;
    const dt = Math.min(0.1, (now - room.lastTick) / 1000);
    room.lastTick = now;
    const here = members(room).map(([w, m]) => [w, seatOf(room, m.pid)]).filter(([, s]) => s >= 0 && sim.player(s));
    if (!here.length) {                                       // nobody watching: hold the world still
      if (now - room.lastSeen > MATCH_IDLE_MS) endMatch(room, null);
      continue;
    }
    room.lastSeen = now;
    sim.step(dt);
    const events = sim.drain();
    const common = '{"t":"snap","s":' + JSON.stringify(sim.snapshot()) + ',"ev":' + JSON.stringify(events);
    for (const [w, s] of here) send(w, common + ',"me":' + JSON.stringify(sim.privateState(s)) + '}');
    if (sim.ended) {
      console.log(`end ${room.code} round ${room.round} ${sim.result.outcome} winner ${sim.result.winner}`);
      endMatch(room, sim.result);
    }
  }
}, TICK_MS).unref();

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MSG });
wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;
    try { handle(ws, msg); } catch (e) { console.error('handle', msg.t, e); }
  });
  ws.on('close', () => {
    const meta = clients.get(ws);
    clients.delete(ws);
    if (!meta || !rooms.has(meta.code)) return;
    const room = rooms.get(meta.code), seat = seatOf(room, meta.pid);
    if (seat >= 0 && room.sim && room.sim.player(seat) && !isOnline(room, meta.pid)) room.sim.setAway(seat, true);
    room.updated = Date.now();
    pushLobby(room);
  });
});
setInterval(() => { for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); } }, 30000).unref();
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) if (!members(room).length && now - room.updated > ROOM_IDLE_MS) rooms.delete(room.code);
}, 60 * 1000).unref();

if (require.main === module) server.listen(PORT, HOST, () => console.log(`MAZE: http://${HOST}:${PORT}  (mazes in ${MAZE_DIR})`));
module.exports = { server, wss, rooms, publish, loadMaze, MAZE };
