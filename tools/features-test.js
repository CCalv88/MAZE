/* The new systems in real browsers: the Monster Maker and its saved library, floors and
 * stairs, levelling, scrolls and spells, dropping items for a friend, and spectating a
 * multi-floor match.   node tools/features-test.js   (screenshots in tools/shots/f-*.png)
 * Set MAZE_URL to run against a deployed server instead of a local one. */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, attach, kill, wait, check } = require('./cdp.js');

const PORT = 3792;

(async () => {
  const LIVE = process.env.MAZE_URL;
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'maze-ft-'));
  let log = '';
  const srv = LIVE ? null : spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: data }), stdio: ['ignore', 'pipe', 'pipe'] });
  if (srv) { srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d); }
  const url = LIVE || `http://127.0.0.1:${PORT}/`;
  const chA = launch(9361), chB = launch(9362);
  let A, B, failed = false;
  try {
    await wait(600);
    A = await attach(9361, 'A');
    B = await attach(9362, 'B');
    await A.send('Page.navigate', { url });
    await A.until('!!(window.MAZE && MAZE.editor && MAZE.monsters)', 'boot');

    console.log('monster maker');
    await A.eval('document.querySelector(".makerBtn").click()');
    await A.until('!document.getElementById("monsterPanel").hidden', 'maker open');
    await A.eval('document.querySelector(\'.bodyBtn[data-body="spider"]\').click()');
    await A.eval('const n = document.getElementById("mkName"); n.value = "Venomfang"; n.dispatchEvent(new Event("input"))');
    await A.eval('const a = document.getElementById("mkAbility"); a.value = "poison"; a.onchange()');
    await A.eval('const s = document.getElementById("mk_hp"); s.value = 90; s.oninput()');
    await wait(400);
    await A.shot('f1-monster-maker');
    await A.eval('document.getElementById("mkSave").click()');
    check(await A.eval('JSON.parse(localStorage.getItem("maze.monsters.v1")).some(m => m.name === "Venomfang" && m.body === "spider" && m.ability === "poison" && m.hp === 90)'), 'Venomfang saved to the library in browser storage');
    await A.eval('document.getElementById("mkRandom").click()');
    await A.eval('document.getElementById("mkSave").click()');
    const saved = await A.eval('MAZE.monsters.library.list().length');
    check(saved === 2, 'a "surprise me" monster saved too');

    // a new session: the library is still there
    await A.send('Page.navigate', { url });
    await A.until('!!(window.MAZE && MAZE.editor && MAZE.monsters)', 'reload');
    check(await A.eval('MAZE.monsters.library.list().length') === 2, 'the library survives a reload (browser storage)');
    check(await A.eval('[...document.querySelectorAll(".swatch.custom")].some(b => /Venomfang/.test(b.textContent))'), 'custom monsters are in the Enemies palette');

    console.log('build a two-floor maze by hand');
    // ground floor: a corridor with scrolls, a potion of mana, and stairs up; upstairs: Venomfang and the exit
    await A.eval(`(function(){
      const L = MAZE.Level, T = MAZE.T, W = MAZE.W, lv = L.create(14, 9, 'Tower Test');
      for (let y = 1; y < 8; y++) for (let x = 1; x < 13; x++) lv.walls[y*14+x] = (y === 4 || (x > 3 && x < 10 && y > 2 && y < 6)) ? W.EMPTY : W.STONE;
      L.setThing(lv, 1, 4, T.START); L.setThing(lv, 2, 4, T.START2);
      L.setThing(lv, 3, 4, T.SCROLL_FIRE); L.setThing(lv, 4, 4, T.SCROLL_WARD); L.setThing(lv, 7, 4, T.SWORD);
      L.setThing(lv, 11, 4, T.STAIRS_UP, 0);
      for (let y = 1; y < 8; y++) for (let x = 1; x < 13; x++) lv.walls[L.idx(lv, x, y, 1)] = (x === 11 || y === 4) ? W.EMPTY : W.BRICK;
      // Venomfang waits in a glass-fronted alcove upstairs: visible, in fireball splash range, but penned in
      const k = L.addMonster(lv, MAZE.monsters.library.list().find(m => m.name === 'Venomfang'));
      lv.walls[L.idx(lv, 5, 3, 1)] = W.GLASS;
      L.setThing(lv, 5, 2, k, 1);
      L.setThing(lv, 1, 4, T.FINISH, 1);
      MAZE.app.loadIntoEditor(lv);
    })()`);
    check(await A.eval('MAZE.editor.level.floors') === 2 && await A.eval('document.querySelectorAll(".floorTab:not(.add):not(.del)").length') === 2, 'stairs up made a second floor with a tab');
    check(await A.eval('MAZE.Level.validate(MAZE.editor.level).ok'), 'the tower is playable');
    await A.eval('MAZE.editor.setFloor(1)');
    await wait(200);
    await A.shot('f2-editor-floor2');
    await A.eval('MAZE.editor.setFloor(0)');

    console.log('solo: scrolls, levels, spells, stairs');
    await A.eval('document.getElementById("btnTest").click()');
    await A.until('!document.getElementById("gameScreen").hidden && MAZE.game.running', 'solo');
    await A.eval('document.querySelector("#clickToPlay .playOnly[data-act=lock]").click()');
    await wait(300);
    const sim = 'MAZE.game.link.sim';
    // Venomfang will come down the stairs to hunt us (as it should); keep the tester alive
    await A.eval(sim + '.player(0).invuln = 1e9');
    // walk east along the corridor, over the scrolls and past the sword
    await A.eval('MAZE.game.player.ang = 0; MAZE.game.keys.w = 1');
    await A.until('MAZE.game.player.x > 4.7', 'walk to the scrolls', 6000);
    await A.eval('MAZE.game.keys.w = 0');
    await wait(200);
    check(await A.eval('MAZE.game.player.scrolls.length') === 2, 'picked up two scrolls (into the bag, not learned)');
    // earn some levels the honest way: pretend a few brutes fell to us
    await A.eval(sim + '.grantXp(' + sim + '.player(0), 500)');
    await wait(200);
    check(await A.eval('MAZE.game.player.level') >= 4, 'XP raised the level (now ' + await A.eval('MAZE.game.player.level') + ')');
    await A.key('KeyC', 'c', 67);
    await A.until('!document.getElementById("charPanel").hidden', 'character sheet opens with C');
    check(await A.eval('MAZE.game.paused'), 'solo pauses while the sheet is open');
    await A.eval('[...document.querySelectorAll(".chScroll")].find(r => /Fireball/.test(r.textContent)).querySelector("button.primary").click()');
    check(await A.eval('MAZE.game.player.spells.includes("fire")'), 'learned Fireball from the sheet');
    check(await A.eval('[...document.querySelectorAll(".chScroll")].find(r => /Ward/.test(r.textContent)).querySelector("button.primary").disabled'), 'Ward is locked until you have 4 points in Mana');
    for (let i = 0; i < 2; i++) await A.key('Digit5', '5', 53);
    await A.key('Digit1', '1', 49);
    check(await A.eval('MAZE.game.player.stats.mag') === 2 && await A.eval('MAZE.game.player.stats.atk') === 1, 'keys 5 and 1 spent points on Mana and Attack');
    await A.shot('f3-character-sheet');
    await A.key('KeyC', 'c', 67);
    await A.until('document.getElementById("charPanel").hidden', 'sheet closes');

    // walk on to the sword, then look at it held, then magic
    await A.eval('MAZE.game.player.ang = 0; MAZE.game.keys.w = 1');
    await A.until('MAZE.game.player.weapons.sword', 'pick up the sword', 6000);
    await A.eval('MAZE.game.keys.w = 0');
    await wait(1800);
    check(await A.eval('MAZE.game.player.weapon') === 'sword', 'the sword comes up when you grab it');
    await A.shot('f4-sword-viewmodel');
    await A.key('Digit4', '4', 52);
    await wait(300);
    check(await A.eval('MAZE.game.player.weapon') === 'magic', '4 raises the magic hand');
    await A.shot('f5-magic-hand');

    // up the stairs (Venomfang may be blocking the corridor by now, so step straight onto them)
    await A.eval(sim + '.player(0).x = 11.5; ' + sim + '.player(0).y = 4.5; MAZE.game.player.x = 11.5; MAZE.game.player.y = 4.5; MAZE.game.player.ang = Math.PI');
    await wait(200);
    check(/stairs up/.test(await A.eval('MAZE.game.prompt')), 'standing on the stairs prompts "E: take the stairs up"');
    await A.shot('f6-stairs');
    await A.key('KeyE', 'e', 69);
    await A.until('MAZE.game.player.f === 1', 'climbed to floor 2');
    check(true, 'E took the stairs to floor 2');
    // stand in front of Venomfang's glass and throw a fireball: the burst reaches through
    await A.until(sim + '.enemies.some(e => e.f === 1)', 'Venomfang is on floor 2', 8000);
    await A.eval(`(function(){ const s = ${sim}.player(0), p = MAZE.game.player; s.x = p.x = 5.5; s.y = p.y = 4.5; p.ang = -Math.PI / 2; })()`);
    await wait(100);
    const hpBefore = await A.eval(sim + '.enemies.find(e => e.f === 1).hp');
    await A.eval('MAZE.game.player.atkCd = 0; MAZE.game.attack()');
    await A.until(`!${sim}.enemies.some(e => e.f === 1) || ${sim}.enemies.find(e => e.f === 1).hp < ${hpBefore}`, 'fireball hits Venomfang', 5000);
    check(true, 'a fireball hit the custom monster upstairs');
    await wait(150);
    await A.shot('f7-fireball');

    console.log('online: drop for a friend, spectate floors');
    await A.eval('MAZE.app.showEditor()');
    await A.eval('document.getElementById("btnOnline").click(); document.getElementById("inpPlayerName").value = "Maker"; document.getElementById("btnCreateRoom").click()');
    await A.until('/^[A-Z]{5}$/.test(document.getElementById("lobbyCode").textContent)', 'room');
    const room = await A.eval('document.getElementById("lobbyCode").textContent');
    await B.send('Page.navigate', { url });
    await B.until('!!(window.MAZE && MAZE.online)', 'B boot');
    await B.eval('localStorage.setItem("maze.name", JSON.stringify("Bob"))');
    await B.send('Page.navigate', { url: url + '?room=' + room });
    await B.until('!document.getElementById("lobbyPanel").hidden', 'B in lobby');
    check(await B.eval('MAZE.monsters.library.list().length') === 0, 'Bob has no monsters of his own');
    await A.eval('document.querySelector(\'.modePick[data-for="role"] [data-role="watch"]\').click()');
    await A.until('document.getElementById("btnStartMatch").textContent === "START & WATCH"', 'spectate on');
    await A.eval('document.getElementById("btnStartMatch").click()');
    await A.until('MAZE.game && MAZE.game.spectator && !document.getElementById("gameScreen").hidden', 'Maker spectating');
    await B.until('MAZE.game && MAZE.game.online && !document.getElementById("gameScreen").hidden', 'Bob playing');
    await B.eval('document.querySelector("#clickToPlay .playOnly[data-act=lock]").click()');
    await A.eval('document.querySelector("#clickToPlay .specOnly[data-act=lock]").click()');
    check(await B.eval('MAZE.game.defs.monsters.some(m => m.name === "Venomfang")'), 'Bob\'s game got Venomfang from the maze itself');
    check(await B.eval('!!MAZE.sprites.get(MAZE.Level.monsterSprite(MAZE.game.defs.monsters[0]))'), 'and drew its sprite');
    await wait(3300);
    // Bob grabs the scrolls, then drops one for someone else
    await B.eval('MAZE.game.player.ang = 0; MAZE.game.keys.w = 1');
    await B.until('MAZE.game.player.scrolls.length >= 1', 'Bob picks up a scroll', 6000);
    await B.eval('MAZE.game.keys.w = 0');
    await B.eval('MAZE.game.link.drop("scroll:" + MAZE.game.player.scrolls[0])');
    await B.until('MAZE.game.items.some(it => it.def.spell)', 'the dropped scroll appears on the floor', 4000);
    check(true, 'Bob dropped a scroll; it lies on the floor for others');
    // Bob heads for the stairs; the spectator switches floors
    await B.eval('MAZE.game.player.ang = 0; MAZE.game.keys.w = 1');
    await B.until('MAZE.game.player.x > 11.2', 'Bob reaches the stairs', 9000);
    await B.eval('MAZE.game.keys.w = 0; MAZE.game.keys.use = 1');
    await wait(150);
    await B.eval('MAZE.game.keys.use = 0');
    await B.until('MAZE.game.player.f === 1', 'Bob climbs', 5000);
    await A.until('MAZE.game.otherMap.get(1) && MAZE.game.otherMap.get(1).f === 1', 'the spectator sees Bob on floor 2', 4000);
    check(await A.eval('MAZE.game.hud._pick && MAZE.game.hud._pick.floors.length') === 2, 'the overhead map has a button per floor');
    await A.eval('MAZE.game.specFloor = 1');
    await wait(400);
    await A.shot('f8-spectate-floor2');
    check(await A.eval('MAZE.game.hud._pick.players.some(p => p.seat === 1)'), 'Bob is drawn on the floor-2 map');
    await A.key('PageDown', 'PageDown', 34);
    check(await A.eval('MAZE.game.specFloor') === 0, 'PgDn shows floor 1');
    await A.eval('MAZE.game.watch(1)');
    await wait(400);
    check(await A.eval('MAZE.game.camera().f') === 1, 'watching Bob puts the camera on his floor');
    await A.shot('f9-spectate-bob-floor2');
    await A.eval('MAZE.net.send({ t: "abort" })');

    const errs = A.errors.concat(B.errors).filter(e => !/pointer ?lock|requestPointerLock|AudioContext/i.test(e));
    check(errs.length === 0, 'no page errors' + (errs.length ? ':\n' + errs.join('\n') : ''));
  } catch (e) {
    failed = true;
    console.log(e.message);
    if (A) console.log(A.errors.join('\n'));
    if (B) console.log(B.errors.join('\n'));
    try { if (A) await A.shot('fail-A'); if (B) await B.shot('fail-B'); } catch (x) { }
    if (log) console.log('--- server log ---\n' + log);
  }
  kill(chA); kill(chB);
  if (srv) srv.kill();
  fs.rmSync(data, { recursive: true, force: true });
  console.log(failed ? 'FEATURES TEST FAILED' : 'FEATURES TEST PASSED');
  process.exit(failed ? 1 : 0);
})();
