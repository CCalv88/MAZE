// The world rules, run in Node through the same loader the server uses.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore } = require('../core.js');

const MAZE = loadCore();
const L = MAZE.Level, T = MAZE.T, W = MAZE.W, P = MAZE.PLAYER;

// a 12x5 box with one long corridor along y = 2: starts at x = 1 and 2, exit at x = 10
function corridor(extra) {
  const lv = L.create(12, 5, 'Corridor');
  for (let y = 1; y < 4; y++) for (let x = 1; x < 11; x++) lv.walls[y * 12 + x] = y === 2 ? W.EMPTY : W.STONE;
  L.setThing(lv, 1, 2, T.START);
  L.setThing(lv, 2, 2, T.START2);
  L.setThing(lv, 10, 2, T.FINISH);
  if (extra) extra(lv);
  return lv;
}
const steps = (sim, secs) => { for (let t = 0; t < secs; t += 0.05) sim.step(0.05); };
const place = (sim, seat, x, y, ang) => { const p = sim.player(seat); p.x = x; p.y = y; if (ang !== undefined) p.ang = ang; p.lastMove = sim.time; };
const events = (sim, e) => sim.drain().filter(ev => ev.e === e);

test('maze codes are a hash of the layout, not the name', () => {
  const a = corridor(), b = corridor();
  b.name = 'Something else';
  assert.equal(L.code(a), L.code(b));
  assert.match(L.code(a), /^[0-9A-HJKMNP-TV-Z]{6}$/);
  assert.ok(L.isMazeCode(L.code(a)));
  b.walls[2 * 12 + 5] = W.BRICK;
  assert.notEqual(L.code(a), L.code(b), 'any edit changes the code');
  assert.notEqual(L.code(a), L.code(a, 1), 'a salt gives a different code');
  assert.equal(L.normCode(' k7q-2x o'), 'K7Q2X0');
});

test('loading a file cleans unknown ids, repeated unique markers and the border', () => {
  const raw = JSON.parse(L.toJSON(corridor()));
  raw.walls[2 * 12 + 4] = 99;                  // no such wall
  raw.things[2 * 12 + 5] = 250;                // no such thing
  raw.things[2 * 12 + 6] = T.START;            // a second player 1 start
  raw.walls[0] = W.SECRET;                     // a walk-through wall in the border
  raw.name = '<script>x</script>';
  const lv = L.fromJSON(raw);
  assert.equal(lv.walls[2 * 12 + 4], W.EMPTY);
  assert.equal(lv.things[2 * 12 + 5], 0);
  assert.equal(lv.things.filter(t => t === T.START).length, 1);
  assert.equal(lv.walls[0], W.BRICK);
  assert.ok(!/[<>]/.test(lv.name));
  assert.throws(() => L.fromJSON({ cols: 500, rows: 9, walls: [], things: [] }));
});

test('generated mazes give every seat a start that can reach the exit', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const lv = L.generate({ seed, cols: 25, rows: 19 });
    const v = L.validate(lv);
    assert.ok(v.ok, `seed ${seed}: ${v.errors.join('; ')}`);
    const spawns = L.spawnPoints(lv);
    assert.equal(new Set(spawns.map(c => c.x + ',' + c.y)).size, 4, `seed ${seed}: four different spawn cells`);
    for (const c of spawns) assert.equal(lv.walls[c.y * lv.cols + c.x], W.EMPTY);
  }
});

test('missing starts fall back to open cells beside player 1', () => {
  const lv = corridor(l => { l.things[2 * 12 + 2] = 0; });
  // (objects from the sandbox have its own prototypes, so compare plain copies)
  const spawns = JSON.parse(JSON.stringify(L.spawnPoints(lv)));
  assert.deepEqual(spawns[0], { x: 1, y: 2 });
  assert.deepEqual(spawns.slice(1).map(c => c.x), [2, 3, 4]);
});

test('validation catches a player start walled off from the exit', () => {
  const lv = corridor(l => { l.walls[2 * 12 + 3] = W.BRICK; });
  const v = L.validate(lv);
  assert.ok(!v.ok);
  assert.ok(v.errors.some(e => /reach the exit/.test(e)));
});

test('solo: reaching the exit ends the run as an escape', () => {
  const sim = new MAZE.Sim(corridor(), { mode: 'solo' });
  sim.addPlayer(0, 'Solo');
  place(sim, 0, 10.5, 2.5);
  sim.step(0.05);
  const end = events(sim, 'end')[0];
  assert.ok(end, 'the run ended');
  assert.equal(end.result.outcome, 'escaped');
  assert.ok(end.result.players[0].stats.timeBonus > 0);
});

test('movement through walls or faster than possible is refused', () => {
  const sim = new MAZE.Sim(corridor(), { mode: 'coop' });
  sim.addPlayer(0, 'A');
  sim.step(0.05);
  assert.equal(sim.move(0, { x: 1.5, y: 1.5, ang: 0, ep: 1 }), false, 'into a wall');
  assert.equal(sim.move(0, { x: 9.5, y: 2.5, ang: 0, ep: 1 }), false, 'teleport down the corridor');
  assert.equal(sim.move(0, { x: 1.7, y: 2.5, ang: 0, ep: 1 }), true, 'a normal step');
  assert.equal(sim.player(0).x, 1.7);
  assert.equal(sim.move(0, { x: 9.5, y: 2.5, ang: 0, ep: 0 }), true, 'a stale epoch is ignored, not refused');
  assert.equal(sim.player(0).x, 1.7);
});

test('competitive: weapons hurt players, dropped loot, respawn at your own start', () => {
  const lv = corridor(l => { L.setThing(l, 6, 2, T.SWORD); });
  const sim = new MAZE.Sim(lv, { mode: 'versus' });
  sim.addPlayer(0, 'A'); sim.addPlayer(1, 'B');
  sim.player(1).invuln = 0;
  place(sim, 1, 6.5, 2.5);
  sim.step(0.05);
  assert.ok(sim.player(1).weapons.sword, 'B picked up the sword');
  events(sim, 'x');
  place(sim, 0, 5.8, 2.5, 0); place(sim, 1, 6.4, 2.5, Math.PI);
  sim.player(0).invuln = 0;
  assert.ok(sim.attack(0));
  steps(sim, 0.3);
  const hurt = events(sim, 'hurt')[0];
  assert.ok(hurt, 'the punch landed');
  assert.equal(hurt.s, 1);
  assert.equal(hurt.by, 0);
  assert.equal(sim.player(1).hp, P.maxHp - MAZE.WEAPONS.fist.dmg * P.pvpMul);

  // finish B off: the sword falls where B stood, and B comes back at their start with fists
  sim.player(1).hp = 1;
  steps(sim, 0.4);
  sim.attack(0);
  steps(sim, 0.3);
  const all = sim.drain();
  assert.ok(all.some(e => e.e === 'die' && e.s === 1 && e.by === 0));
  const drop = all.find(e => e.e === 'drop');
  assert.equal(drop && drop.k, T.SWORD);
  assert.equal(sim.player(0).stats.frags, 1);
  assert.ok(!sim.player(1).weapons.sword);
  steps(sim, P.respawnVersus + 0.2);
  const b = sim.player(1);
  assert.ok(!b.dead);
  assert.equal(b.x, 2.5);
  assert.equal(b.hp, P.maxHp);
  assert.equal(b.epoch, 2);

  // first one out wins
  sim.drain();
  place(sim, 1, 10.5, 2.5);
  sim.step(0.05);
  const end = events(sim, 'end')[0];
  assert.equal(end.result.winner, 1);
  assert.equal(end.result.outcome, 'won');
});

test('co-op: no friendly fire, a shared key, revives, and everyone has to get out', () => {
  const lv = corridor(l => { L.setThing(l, 4, 2, T.KEY); });
  const sim = new MAZE.Sim(lv, { mode: 'coop' });
  sim.addPlayer(0, 'A'); sim.addPlayer(1, 'B');
  place(sim, 0, 5.8, 2.5, 0); place(sim, 1, 6.4, 2.5);
  sim.player(1).invuln = 0;
  sim.attack(0);
  steps(sim, 0.3);
  assert.equal(sim.player(1).hp, P.maxHp, 'teammates cannot hurt each other');

  place(sim, 0, 4.5, 2.5);
  sim.step(0.05);
  assert.ok(sim.privateState(1).has.key, 'the key works for the whole team');

  // B goes down; A stands over them holding E and brings them back
  sim.kill(sim.player(1), -1);
  assert.ok(sim.player(1).dead);
  assert.ok(!sim.ended, 'one down is not a wipe');
  place(sim, 0, 6.0, 2.5);
  sim.move(0, { x: 6.0, y: 2.5, ang: 0, use: 1, ep: sim.player(0).epoch });
  steps(sim, P.reviveTime + 0.2);
  assert.ok(!sim.player(1).dead, 'revived');
  assert.equal(sim.player(1).hp, 40);
  assert.ok(sim.drain().some(e => e.e === 'revive' && e.by === 0));

  // one out is not enough; both out ends it
  place(sim, 0, 10.5, 2.5);
  sim.step(0.05);
  assert.ok(sim.player(0).escaped);
  assert.ok(!sim.ended);
  place(sim, 1, 10.5, 2.5);
  sim.step(0.05);
  assert.ok(sim.ended);
  assert.equal(sim.result.outcome, 'escaped');
});

test('co-op: everyone down with nobody out is a wipe', () => {
  const sim = new MAZE.Sim(corridor(), { mode: 'coop' });
  sim.addPlayer(0, 'A'); sim.addPlayer(1, 'B');
  sim.kill(sim.player(0), -1);
  assert.ok(!sim.ended);
  sim.kill(sim.player(1), -1);
  assert.ok(sim.ended);
  assert.equal(sim.result.outcome, 'wiped');
});

test('blobs hunt whichever player is nearest, and bite', () => {
  const lv = corridor(l => { L.setThing(l, 8, 2, T.BLOB); });
  const sim = new MAZE.Sim(lv, { mode: 'coop' });
  sim.addPlayer(0, 'Far'); sim.addPlayer(1, 'Near');
  place(sim, 0, 1.5, 2.5); place(sim, 1, 6.5, 2.5);
  sim.player(1).invuln = 0;
  steps(sim, 3);
  const bites = sim.drain().filter(e => e.e === 'hurt');
  assert.ok(bites.length > 0, 'it bit someone');
  assert.ok(bites.every(e => e.s === 1), 'only the nearer player');
  assert.ok(sim.player(1).hp < P.maxHp);
});

test('a player who disconnects is not hunted and does not hold up the end', () => {
  const sim = new MAZE.Sim(corridor(), { mode: 'coop' });
  sim.addPlayer(0, 'A'); sim.addPlayer(1, 'B');
  sim.setAway(1, true);
  place(sim, 0, 10.5, 2.5);
  sim.step(0.05);
  assert.ok(sim.ended, 'the one player still here escaping finishes co-op');
});

test('snapshots and full state survive JSON', () => {
  const sim = new MAZE.Sim(L.generate({ seed: 7 }), { mode: 'versus' });
  for (let s = 0; s < 4; s++) sim.addPlayer(s, 'P' + s);
  steps(sim, 1);
  const snap = JSON.parse(JSON.stringify(sim.snapshot()));
  assert.equal(snap.p.length, 4);
  assert.ok(snap.b.length > 0);
  const full = JSON.parse(JSON.stringify(sim.fullState()));
  assert.equal(full.walls.length, full.cols * full.rows);
  assert.equal(full.players.length, 4);
  assert.ok(sim.privateState(2).weapons.includes('fist'));
});
