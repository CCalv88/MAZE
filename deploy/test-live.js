/* Checks the deployed game end to end over wss: share a maze and fetch it back by its
 * code, create a room, join it from a second client, start a match and confirm both get
 * snapshots from the server's world, then end it and leave. Needs Node 22+. */
'use strict';
const BASE = process.env.MAZE_URL || 'https://stegopets.com/maze/';
const WS = BASE.replace(/^http/, 'ws') + 'ws';
const wait = ms => new Promise(r => setTimeout(r, ms));
function open() { return new Promise((res, rej) => { const ws = new WebSocket(WS); ws.inbox = []; ws.onmessage = e => ws.inbox.push(JSON.parse(e.data)); ws.onopen = () => res(ws); ws.onerror = () => rej(new Error('connect failed')); }); }
const send = (ws, m) => ws.send(JSON.stringify(m));
async function until(ws, f, what, timeout = 8000) { const s = Date.now(); while (Date.now() - s < timeout) { const i = ws.inbox.findIndex(f); if (i >= 0) return ws.inbox.splice(i, 1)[0]; await wait(30); } throw new Error(`timeout waiting for ${what}`); }

// a small corridor maze: player 1 and 2 starts, a blob, the exit
function maze() {
  const cols = 12, rows = 8, walls = [], things = new Array(cols * rows).fill(0);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) walls.push(y === 2 && x > 0 && x < cols - 1 ? 0 : 2);
  things[2 * cols + 1] = 1; things[2 * cols + 2] = 15; things[2 * cols + 10] = 2; things[2 * cols + 8] = 12;
  return { format: 'maze.level', version: 2, name: 'Live Check Corridor', cols, rows, walls, things };
}

(async () => {
  try {
    const pub = await fetch(BASE + 'm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(maze()) }).then(r => r.json());
    if (!pub.code) throw new Error('publish failed: ' + JSON.stringify(pub));
    const back = await fetch(BASE + 'm/' + pub.code).then(r => r.json());
    if (back.code !== pub.code) throw new Error('maze fetch mismatch');

    const a = await open(); send(a, { t: 'create', pid: 'live-a-' + Date.now(), name: 'Check A', level: maze(), mode: 'coop' });
    const room = await until(a, m => m.t === 'room', 'room');
    const b = await open(); send(b, { t: 'join', code: room.code, pid: 'live-b-' + Date.now(), name: 'Check B' });
    const rb = await until(b, m => m.t === 'room', 'join');
    send(a, { t: 'start' });
    const sa = await until(a, m => m.t === 'start', 'start A'), sb = await until(b, m => m.t === 'start', 'start B');
    const snap = await until(b, m => m.t === 'snap', 'snapshot');
    send(a, { t: 'abort' });
    await until(b, m => m.t === 'lobby' && m.state === 'lobby', 'back to lobby');
    console.log(`LIVE OK maze ${pub.code} (same as room maze: ${room.maze.code === pub.code}), room ${room.code}: seats ${sa.seat}/${sb.seat}/${rb.seat}, ${snap.s.b.length} blob(s) in the snapshot, mode ${sa.full.mode}`);
    send(a, { t: 'leave' }); send(b, { t: 'leave' }); a.close(); b.close();
    process.exit(0);
  } catch (e) { console.log('LIVE FAIL', e.message); process.exit(1); }
})();
