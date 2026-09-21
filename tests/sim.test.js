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
  assert.deepEqual(spawns[0], { x: 1, y: 2, f: 0 });
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
  assert.equal(sim.player(0).score.frags, 1);
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

// ------------------------------------------------------------------ floors --
// two corridors, one above the other, joined by stairs at x = 5
function tower(extra) {
  const lv = corridor();
  L.addFloor(lv);
  for (let x = 1; x < 11; x++) lv.walls[L.idx(lv, x, 2, 1)] = W.EMPTY;
  for (let y = 1; y < 7; y++) for (let x = 1; x < 11; x++) if (y !== 2) lv.walls[L.idx(lv, x, y, 1)] = W.STONE;
  // the exit moves upstairs
  lv.things[L.idx(lv, 10, 2, 0)] = 0;
  L.setThing(lv, 10, 2, T.FINISH, 1);
  L.setThing(lv, 5, 2, T.STAIRS_UP, 0);
  if (extra) extra(lv);
  return lv;
}

test('stairs come in pairs, add floors when needed, and vanish together', () => {
  const lv = corridor();
  assert.equal(lv.floors, 1);
  assert.ok(L.setThing(lv, 5, 2, T.LADDER_UP, 0));
  assert.equal(lv.floors, 2, 'a ladder on the top floor adds a floor above');
  assert.equal(L.thingAt(lv, 5, 2, 1), T.LADDER_DOWN);
  assert.equal(L.wallAt(lv, 5, 2, 1), W.EMPTY, 'the arrival cell is opened up');
  L.clearThing(lv, L.idx(lv, 5, 2, 0));
  assert.equal(L.thingAt(lv, 5, 2, 1), 0, 'removing one end removes the other');
  assert.ok(!L.setThing(lv, 3, 2, T.STAIRS_DOWN, 0), 'no way down from the ground floor');
  // a broken pair from a file is cleaned up
  const raw = JSON.parse(L.toJSON(tower()));
  raw.things[L.idx(lv, 5, 2, 1)] = 0;
  const back = L.fromJSON(raw);
  assert.equal(L.thingAt(back, 5, 2, 0), 0);
});

test('the route to the exit can run up the stairs, and validation knows it', () => {
  const lv = tower();
  const v = L.validate(lv);
  assert.ok(v.ok, v.errors.join('; '));
  assert.equal(v.counts.floors, 2);
  lv.things[L.idx(lv, 5, 2, 0)] = 0; lv.things[L.idx(lv, 5, 2, 1)] = 0;
  const v2 = L.validate(lv);
  assert.ok(v2.errors.some(e => /exit cannot be reached/.test(e)));
});

test('one floor keeps its old maze code; floors and monsters change it', () => {
  const lv = corridor();
  const before = L.code(lv);
  const again = L.fromJSON(JSON.parse(L.toJSON(lv)));
  assert.equal(L.code(again), before, 'save and load keeps the code');
  const up = tower();
  assert.notEqual(L.code(up), before);
  const withMonster = corridor();
  const k = L.addMonster(withMonster, { uid: 'gob1', name: 'Gob', body: 'goblin', hp: 50 });
  L.setThing(withMonster, 7, 2, k, 0);
  assert.notEqual(L.code(withMonster), before);
  // an unused monster does not count
  const unused = corridor();
  L.addMonster(unused, { uid: 'ghost', body: 'ghost' });
  assert.equal(L.code(unused), before);
});

test('players climb with E on the stairs, and moves from the old floor are ignored', () => {
  const sim = new MAZE.Sim(tower(), { mode: 'solo' });
  sim.addPlayer(0, 'A');
  assert.equal(sim.climb(0), false, 'not on the stairs yet');
  place(sim, 0, 5.5, 2.5);
  assert.equal(sim.climb(0), true);
  const p = sim.player(0);
  assert.equal(p.f, 1);
  assert.equal(p.epoch, 2);
  const ev = sim.drain().find(e => e.e === 'climb');
  assert.equal(ev.up, 1);
  assert.equal(sim.move(0, { x: 6.5, y: 2.5, f: 0, ep: 2 }), true);
  assert.equal(p.x, 5.5, 'a move reported from the floor below is stale');
  // up here the exit is reachable
  place(sim, 0, 10.5, 2.5);
  sim.step(0.05);
  assert.ok(sim.ended);
});

test('monsters follow you up and down the stairs', () => {
  const lv = tower(l => { L.setThing(l, 8, 2, T.BLOB_FAST, 0); });
  const sim = new MAZE.Sim(lv, { mode: 'coop' });
  sim.addPlayer(0, 'A');
  place(sim, 0, 5.5, 2.5);
  sim.climb(0);
  place(sim, 0, 9.5, 2.5);
  sim.player(0).invuln = 99;
  const blob = sim.enemies[0];
  assert.equal(blob.f, 0);
  steps(sim, 6);
  assert.equal(blob.f, 1, 'the blob took the stairs');
  assert.ok(Math.abs(blob.x - 9.5) < 1.2, 'and caught up');
});

// ------------------------------------------------------------- levelling --
test('kills give XP, levels give points, points make you stronger', () => {
  const lv = corridor(l => { for (const x of [4, 5, 6, 7]) L.setThing(l, x, 2, T.BLOB_TANK, 0); });
  const sim = new MAZE.Sim(lv, { mode: 'solo' });
  const p = sim.addPlayer(0, 'A');
  for (const e of sim.enemies) e.hurt(9999, 1, 0, 0, 0);
  assert.ok(p.level >= 3, 'four brutes are worth a few levels (got ' + p.level + ')');
  assert.equal(p.points, p.level - 1);
  assert.ok(sim.drain().some(e => e.e === 'levelup'));
  const hp0 = MAZE.Sim.maxHp(p);
  assert.ok(sim.allocate(0, 'vit'));
  assert.equal(MAZE.Sim.maxHp(p), hp0 + 15);
  assert.ok(sim.allocate(0, 'def'));
  assert.ok(!sim.allocate(0, 'luck'), 'no such stat');
  // defense softens hits
  p.invuln = 0;
  const before = p.hp;
  sim.damagePlayer(p, 20, 1, 0, -1, 0);
  assert.ok(Math.abs(before - p.hp - 20 * 0.93) < 0.01);
  // attack makes swords bite harder
  const hurt = [];
  p.stats.atk = 5;
  const lv2 = corridor(l => { L.setThing(l, 3, 2, T.BLOB_TANK, 0); });
  const s2 = new MAZE.Sim(lv2, { mode: 'solo' });
  const q = s2.addPlayer(0, 'B'); q.stats.atk = 5;
  place(s2, 0, 2.5, 2.5, 0);
  s2.attack(0); steps(s2, 0.3);
  assert.equal(Math.round(s2.enemies[0].maxHp - s2.enemies[0].hp), Math.round(MAZE.WEAPONS.fist.dmg * 1.5));
});

// ----------------------------------------------------------------- magic --
test('scrolls are learned from the bag; strong ones need points in Mana', () => {
  const lv = corridor(l => { L.setThing(l, 3, 2, T.SCROLL_FIRE, 0); L.setThing(l, 4, 2, T.SCROLL_WARD, 0); });
  const sim = new MAZE.Sim(lv, { mode: 'solo' });
  const p = sim.addPlayer(0, 'A');
  place(sim, 0, 3.5, 2.5); sim.step(0.05);
  place(sim, 0, 4.5, 2.5); sim.step(0.05);
  assert.deepEqual([...p.scrolls], ['fire', 'ward']);
  assert.equal(p.spells.length, 0, 'picking up is not learning');
  assert.ok(sim.learn(0, 'fire'));
  assert.equal(p.spell, 'fire');
  assert.ok(!sim.learn(0, 'ward'));
  assert.equal(sim.drain().find(e => e.e === 'nolearn').need, 4);
  p.points = 4;
  for (let i = 0; i < 4; i++) sim.allocate(0, 'mag');
  assert.ok(sim.learn(0, 'ward'), 'with 4 in Mana, ward can be learned');
  assert.ok(sim.privateState(0).weapons.includes('magic'));
});

test('spells: fireball bursts, frost slows, heal mends, blink jumps, mana runs out', () => {
  const lv = corridor(l => { L.setThing(l, 6, 2, T.BLOB_TANK, 0); L.setThing(l, 7, 2, T.BLOB_TANK, 0); });
  const sim = new MAZE.Sim(lv, { mode: 'solo', freeze: 99 });
  const p = sim.addPlayer(0, 'A');
  // a serious mage: 15 points in Mana gives 330 mana to spend
  p.spells = ['fire', 'frost', 'heal', 'blink', 'bolt']; p.weapon = 'magic'; p.stats.mag = 15; p.mana = MAZE.Sim.maxMana(p);
  place(sim, 0, 3.5, 2.5, 0);
  p.spell = 'fire'; sim.attack(0); steps(sim, 0.6);
  const [a, b] = sim.enemies;
  assert.ok(a.hp < a.maxHp && b.hp < b.maxHp, 'the burst caught both brutes');
  p.atkCd = 0; p.spell = 'frost'; sim.attack(0); steps(sim, 0.4);
  assert.ok(sim.enemies[0].slow > 0, 'frost slows');
  p.hp = 30; p.atkCd = 0; p.spell = 'heal'; sim.attack(0);
  assert.ok(p.hp > 60);
  p.atkCd = 0; p.spell = 'bolt'; const hpBefore = sim.enemies.map(e => e.hp); sim.attack(0);
  const bolt = sim.drain().find(e => e.e === 'bolt');
  assert.ok(bolt.pts.length >= 3, 'lightning jumped between targets');
  assert.ok(sim.enemies.every((e, i) => e.hp < hpBefore[i]));
  p.atkCd = 0; p.spell = 'blink'; const ep = p.epoch; sim.attack(0);
  assert.ok(p.x > 3.5 + 1.2 || p.x < 6.5, 'blinked forward');
  assert.equal(p.epoch, ep + 1);
  p.mana = 1; p.atkCd = 0; p.spell = 'fire';
  assert.equal(sim.attack(0), false);
  assert.ok(sim.drain().some(e => e.e === 'nomana'));
});

test('players can drop items for each other', () => {
  const lv = corridor(l => { L.setThing(l, 3, 2, T.SCROLL_HEAL, 0); });
  const sim = new MAZE.Sim(lv, { mode: 'coop' });
  const a = sim.addPlayer(0, 'Fighter'), b = sim.addPlayer(1, 'Mage');
  place(sim, 0, 3.5, 2.5, 0); place(sim, 1, 8.5, 2.5);
  sim.step(0.05);
  assert.deepEqual([...a.scrolls], ['heal']);
  a.weapons.sword = true; a.weapon = 'sword';
  assert.ok(sim.drop(0, 'scroll:heal'));
  assert.ok(sim.drop(0, 'sword'));
  assert.equal(a.weapon, 'fist');
  assert.ok(!sim.drop(0, 'scroll:heal'), 'nothing left to drop');
  steps(sim, 0.2);
  assert.equal(a.scrolls.length, 0, 'you do not pick your own drop straight back up');
  place(sim, 1, 4.1, 2.5);
  sim.step(0.05);
  assert.deepEqual([...b.scrolls], ['heal']);
  assert.ok(b.weapons.sword);
});

// ------------------------------------------------------- custom monsters --
test('monster maker values are clamped and turned into a working monster', () => {
  const m = L.cleanMonster({ name: '<b>Big</b>', body: 'dragon', hp: 99999, speed: -3, dmg: 'lots', c1: 'red', ability: 'nuke' });
  assert.equal(m.body, 'slime');
  assert.equal(m.hp, 600);
  assert.equal(m.speed, 0.4);
  assert.equal(m.dmg, 10);
  assert.equal(m.c1, '#6ee06e');
  assert.equal(m.ability, 'none');
  assert.ok(!/[<>]/.test(m.name));
  const lv = corridor();
  const k = L.addMonster(lv, { uid: 'orc1', name: 'Grukk', body: 'orc', hp: 200, dmg: 25, speed: 1.4, size: 1.1 });
  assert.equal(k, MAZE.CUSTOM_BASE);
  assert.equal(L.addMonster(lv, { uid: 'orc1', name: 'Grukk II', body: 'orc' }), k, 'same uid updates in place');
  L.setThing(lv, 7, 2, k, 0);
  const back = L.fromJSON(JSON.parse(L.toJSON(lv)));
  assert.equal(back.monsters[0].name, 'Grukk II');
  const sim = new MAZE.Sim(back, { mode: 'solo' });
  assert.equal(sim.enemies.length, 1);
  assert.equal(sim.enemies[0].def.name, 'Grukk II');
  assert.ok(sim.enemies[0].def.xp > 30);
});

function arena(monster) {
  const lv = corridor();
  const k = L.addMonster(lv, Object.assign({ uid: 'x', name: 'X', hp: 40, dmg: 10, speed: 2, size: 0.8 }, monster));
  L.setThing(lv, 6, 2, k, 0);
  const sim = new MAZE.Sim(lv, { mode: 'solo' });
  const p = sim.addPlayer(0, 'A');
  p.invuln = 0;
  return { sim, p, m: sim.enemies[0] };
}

test('abilities: split, explode, poison, spit, leech, regen', () => {
  let { sim, p, m } = arena({ ability: 'split' });
  m.hurt(999, 1, 0, 0, 0);
  sim.step(0.05);
  assert.equal(sim.enemies.length, 2, 'split into two');
  assert.ok(sim.enemies.every(e => e.child && e.maxHp === 20));
  sim.enemies[0].hurt(999, 1, 0, 0, 0); sim.step(0.05);
  assert.equal(sim.enemies.length, 1, 'children do not split again');

  ({ sim, p, m } = arena({ ability: 'explode', dmg: 30 }));
  place(sim, 0, 5.2, 2.5); steps(sim, 1.5);
  assert.ok(sim.enemies.length === 0 && p.hp < 70, 'it blew up in your face');

  ({ sim, p, m } = arena({ ability: 'poison', dmg: 5 }));
  place(sim, 0, 5.2, 2.5); steps(sim, 1.2);
  assert.ok(p.poison > 0);

  ({ sim, p, m } = arena({ ability: 'ranged', dmg: 10 }));
  place(sim, 0, 1.5, 2.5); steps(sim, 4);
  assert.ok(p.hp < 100, 'spit hit from range');

  ({ sim, p, m } = arena({ ability: 'leech', dmg: 20 }));
  m.hp = 10; place(sim, 0, 5.2, 2.5); steps(sim, 1.2);
  assert.ok(m.hp > 10, 'biting healed it');

  ({ sim, p, m } = arena({ ability: 'regen' }));
  m.hp = 10; place(sim, 0, 1.5, 2.5); p.invuln = 99; sim.freeze = 0; steps(sim, 2);
  assert.ok(m.hp > 11);
});
