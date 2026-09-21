// The server end to end: maze store over HTTP, then rooms, a match, combat and
// reconnects over real WebSockets, against a server on a random port.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'maze-test-'));
process.env.DATA_DIR = DATA;
const { server, MAZE } = require('../server.js');
const L = MAZE.Level, T = MAZE.T, W = MAZE.W;

let base, wsBase;
test.before(() => new Promise(res => server.listen(0, '127.0.0.1', () => {
  base = `http://127.0.0.1:${server.address().port}`;
  wsBase = base.replace('http', 'ws') + '/ws';
  res();
})));
test.after(() => { server.close(); fs.rmSync(DATA, { recursive: true, force: true }); });

function corridor() {
  const lv = L.create(12, 5, 'Relay Corridor');
  for (let y = 1; y < 4; y++) for (let x = 1; x < 11; x++) lv.walls[y * 12 + x] = y === 2 ? W.EMPTY : W.STONE;
  L.setThing(lv, 1, 2, T.START);
  L.setThing(lv, 2, 2, T.START2);
  L.setThing(lv, 10, 2, T.FINISH);
  return JSON.parse(L.toJSON(lv));
}

const wait = ms => new Promise(r => setTimeout(r, ms));
function client() {
  return new Promise((res, rej) => {
    const ws = new WebSocket(wsBase);
    ws.inbox = [];
    ws.on('message', d => ws.inbox.push(JSON.parse(d)));
    ws.on('open', () => res(ws));
    ws.on('error', rej);
  });
}
const send = (ws, m) => ws.send(JSON.stringify(m));
async function until(ws, pred, what, timeout = 4000) {
  const f = typeof pred === 'string' ? (m => m.t === pred) : pred;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const i = ws.inbox.findIndex(f);
    if (i >= 0) return ws.inbox.splice(i, 1)[0];
    await wait(15);
  }
  throw new Error('timed out waiting for ' + (what || pred));
}

test('static files are served, and nothing else is', async () => {
  for (const [p, code] of [['/', 200], ['/js/sim.js', 200], ['/css/style.css', 200], ['/server.js', 404], ['/core.js', 404], ['/package.json', 404], ['/data/', 404], ['/health', 200]]) {
    const r = await fetch(base + p);
    assert.equal(r.status, code, p);
  }
});

test('mazes are filed under their hash code and can be fetched back', async () => {
  const maze = corridor();
  const want = L.code(L.fromJSON(maze));
  const post = () => fetch(base + '/m', { method: 'POST', body: JSON.stringify(maze) }).then(r => r.json());
  const a = await post(), b = await post();
  assert.equal(a.code, want);
  assert.equal(b.code, want, 'publishing the same maze again gives the same code');
  const got = await fetch(base + '/m/' + want.toLowerCase()).then(r => r.json());
  assert.equal(got.code, want);
  assert.deepEqual(got.walls, maze.walls);
  assert.equal((await fetch(base + '/m/ZZZZZZ')).status, 404);

  const broken = corridor();
  broken.things = broken.things.map(t => (t === T.FINISH ? 0 : t));
  const r = await fetch(base + '/m', { method: 'POST', body: JSON.stringify(broken) });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /exit/i);
});

test('a full round: lobby, mode, start, snapshots, combat, cheating, reconnect, abort', async () => {
  const a = await client();
  send(a, { t: 'create', pid: 'pid-a', name: 'Alice', level: corridor(), mode: 'coop' });
  const room = await until(a, 'room');
  assert.match(room.code, /^[A-Z]{5}$/);
  assert.equal(room.seat, 0);
  assert.equal(room.host, true);
  assert.equal(room.maze.code, L.code(L.fromJSON(corridor())));

  const b = await client();
  send(b, { t: 'join', code: room.code.toLowerCase(), pid: 'pid-b', name: 'Bob' });
  const rb = await until(b, 'room');
  assert.equal(rb.seat, 1);
  assert.equal(rb.host, false);
  const lob = await until(a, m => m.t === 'lobby' && m.players.length === 2, 'two in the lobby');
  assert.deepEqual(lob.players.map(p => p.name), ['Alice', 'Bob']);

  // only the host picks the mode
  send(b, { t: 'mode', mode: 'versus' });
  await wait(80);
  send(a, { t: 'mode', mode: 'versus' });
  const lv = await until(b, m => m.t === 'lobby' && m.mode === 'versus', 'versus mode');
  assert.equal(lv.mode, 'versus');

  // bad codes and a full room are refused
  const x = await client();
  send(x, { t: 'join', code: 'QQQQQ', pid: 'pid-x', name: 'X' });
  assert.match((await until(x, 'error')).msg, /No room/);
  const c = await client(), d = await client(), e = await client();
  send(c, { t: 'join', code: room.code, pid: 'pid-c', name: 'Cat' });
  send(d, { t: 'join', code: room.code, pid: 'pid-d', name: 'Dan' });
  await until(c, 'room'); await until(d, 'room');
  send(e, { t: 'join', code: room.code, pid: 'pid-e', name: 'Eve' });
  assert.match((await until(e, 'error')).msg, /full/);
  send(c, { t: 'leave' }); send(d, { t: 'leave' });
  c.close(); d.close(); e.close(); x.close();
  await until(a, m => m.t === 'lobby' && m.players.length === 2, 'back to two');

  // start: everyone playing gets the whole world, then snapshots with their own private state
  send(b, { t: 'start' });
  await wait(80);
  assert.ok(!a.inbox.some(m => m.t === 'start'), 'a guest cannot start the match');
  send(a, { t: 'start' });
  const sa = await until(a, 'start'), sb = await until(b, 'start');
  assert.equal(sa.seat, 0); assert.equal(sb.seat, 1);
  assert.equal(sa.full.mode, 'versus');
  assert.equal(sa.full.players.length, 2);
  assert.equal(sb.names[0], 'Alice');
  const snap = await until(a, 'snap');
  assert.equal(snap.me.hp, 100);
  assert.equal(snap.s.p.length, 2);

  // wait out the spawn shield, then Alice walks up to Bob and punches him
  await wait(2100);
  send(b, { t: 'pos', x: 2.5, y: 2.5, ang: Math.PI, pitch: 0, ep: 1 });
  send(a, { t: 'pos', x: 1.95, y: 2.5, ang: 0, pitch: 0, ep: 1 });
  await wait(60);
  send(a, { t: 'atk' });
  const hit = await until(b, m => m.t === 'snap' && m.ev.some(ev => ev.e === 'hurt' && ev.s === 1), 'the punch');
  assert.equal(hit.ev.find(ev => ev.e === 'hurt').by, 0);
  const after = await until(b, m => m.t === 'snap' && m.me.hp < 100, 'Bob hurt');
  assert.ok(after.me.hp < 100);

  // walking through a wall gets you put back
  send(a, { t: 'pos', x: 1.95, y: 1.5, ang: 0, pitch: 0, ep: 1 });
  const fix = await until(a, 'correct');
  assert.equal(fix.y, 2.5);

  // Bob drops, reconnects on a new socket, and is sent the running match again
  b.terminate();
  await until(a, m => m.t === 'snap' && m.ev.some(ev => ev.e === 'away' && ev.s === 1 && ev.away), 'Bob away');
  const b2 = await client();
  send(b2, { t: 'join', code: room.code, pid: 'pid-b', name: 'Bob' });
  assert.equal((await until(b2, 'room')).seat, 1);
  const again = await until(b2, 'start');
  assert.equal(again.seat, 1);
  assert.ok(again.full.players.find(p => p.seat === 1).hp < 100, 'with the damage he had taken');

  // the host can call the match off, which sends everyone back to the lobby
  send(a, { t: 'abort' });
  await until(b2, 'aborted');
  const back = await until(b2, m => m.t === 'lobby' && m.state === 'lobby', 'lobby again');
  assert.equal(back.state, 'lobby');
  a.close(); b2.close();
});

test('a match ends for everyone when the first player escapes', async () => {
  const a = await client(), b = await client();
  send(a, { t: 'create', pid: 'race-a', name: 'Ann', level: corridor(), mode: 'versus' });
  const room = await until(a, 'room');
  send(b, { t: 'join', code: room.code, pid: 'race-b', name: 'Ben' });
  await until(b, 'room');
  send(a, { t: 'start' });
  await until(a, 'start'); await until(b, 'start');
  // Ben runs for the exit in legal steps
  for (let x = 2.5; x <= 10.5; x += 0.35) {
    send(b, { t: 'pos', x: Math.min(10.5, x), y: 2.5, ang: 0, pitch: 0, ep: 1 });
    await wait(55);
  }
  send(b, { t: 'pos', x: 10.5, y: 2.5, ang: 0, pitch: 0, ep: 1 });
  const end = await until(a, m => m.t === 'snap' && m.ev.some(ev => ev.e === 'end'), 'the end', 6000);
  const result = end.ev.find(ev => ev.e === 'end').result;
  assert.equal(result.winner, 1);
  const lobby = await until(a, m => m.t === 'lobby' && m.state === 'lobby' && m.result, 'lobby with the result');
  assert.equal(lobby.result.winner, 1);
  a.close(); b.close();
});
