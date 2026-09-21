/* Drives the real page in two headless Chromes against a local server:
 *   solo test run, host a room, join it from an invite link, start a match, see each
 *   other, hit each other in competitive, and check no page error was thrown.
 *   node tools/browser-test.js           (screenshots go to tools/shots/)
 *   MAZE_URL=https://stegopets.com/maze/ node tools/browser-test.js   (the live site instead)
 * Needs Chrome (set CHROME to override the path). */
'use strict';
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 3791;
const SHOTS = path.join(__dirname, 'shots');
const wait = ms => new Promise(r => setTimeout(r, ms));
const getJson = url => new Promise((res, rej) => http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));
const killTree = pid => { try { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { } };

function launch(dbg) {
  const dir = path.join(os.tmpdir(), `maze-chrome-${dbg}-${Date.now()}`);
  return spawn(CHROME, ['--headless=new', '--disable-gpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run',
    '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${dbg}`, `--user-data-dir=${dir}`, '--window-size=1280,800', 'about:blank'], { stdio: 'ignore' });
}
async function page(dbg, label) {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await getJson(`http://127.0.0.1:${dbg}/json`);
      const p = list.find(t => t.type === 'page');
      if (p) return connect(p.webSocketDebuggerUrl, label);
    } catch (e) { }
    await wait(250);
  }
  throw new Error('no devtools page on ' + dbg);
}
function connect(url, label) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url); let id = 0; const pending = {}; const errors = [];
    ws.on('message', d => {
      const m = JSON.parse(d);
      if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; }
      if (m.method === 'Runtime.exceptionThrown') errors.push(label + ': ' + (m.params.exceptionDetails.exception ? m.params.exceptionDetails.exception.description : m.params.exceptionDetails.text));
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(label + ' console: ' + m.params.args.map(a => a.value || a.description).join(' '));
    });
    ws.on('open', () => {
      const send = (method, params = {}) => new Promise(r => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
      const evalJs = async (expr) => {
        const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
        if (r.result && r.result.exceptionDetails) throw new Error(label + ' eval failed: ' + expr.slice(0, 80) + ' :: ' + JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description));
        return r.result && r.result.result ? r.result.result.value : undefined;
      };
      const shot = async (name) => {
        const s = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(s.result.data, 'base64'));
      };
      res({ send, eval: evalJs, shot, errors, close: () => ws.close() });
    });
    ws.on('error', rej);
  });
}
async function until(pg, expr, what, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await pg.eval(expr)) return; await wait(100); }
  throw new Error('timed out: ' + what);
}
const check = (cond, msg) => { if (!cond) throw new Error('FAILED: ' + msg); console.log('  ok  ' + msg); };

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const LIVE = process.env.MAZE_URL;
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'maze-bt-'));
  let srvLog = '';
  const srv = LIVE ? null : spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: data }), stdio: ['ignore', 'pipe', 'pipe'] });
  if (srv) { srv.stdout.on('data', d => srvLog += d); srv.stderr.on('data', d => srvLog += d); }
  const chA = launch(9341), chB = launch(9342);
  let failed = false;
  let A, B;
  try {
    await wait(600);
    A = await page(9341, 'A'); B = await page(9342, 'B');
    for (const pg of [A, B]) {
      await pg.send('Runtime.enable');
      await pg.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    }
    const url = LIVE || `http://127.0.0.1:${PORT}/`;

    console.log('straight from disk (file://)');
    await A.send('Page.navigate', { url: 'file:///' + path.join(__dirname, '..', 'index.html').replace(/\\/g, '/') });
    await until(A, '!!(window.MAZE && MAZE.editor && MAZE.online)', 'file:// boot');
    await A.eval('document.getElementById("btnTest").click()');
    await until(A, '!document.getElementById("gameScreen").hidden && MAZE.game.running', 'file:// solo game');
    await A.eval('document.querySelector("[data-act=lock]").click()');
    await wait(500);
    check(await A.eval('MAZE.game.time > 0.2'), 'solo play works from a double-clicked file');
    await A.eval('MAZE.app.showEditor(); document.getElementById("btnOnline").click()');
    check(/hosted page/.test(await A.eval('document.getElementById("onlineMsg").textContent')), 'online explains it needs the hosted page');

    console.log('editor + solo');
    await A.send('Page.navigate', { url });
    await until(A, '!!(window.MAZE && MAZE.editor && MAZE.online)', 'page boot');
    const code = await A.eval('document.getElementById("mazeCode").textContent');
    check(/^[0-9A-Z]{6}$/.test(code), 'editor shows a maze code: ' + code);
    // a few random mazes have no fair spot for extra starts (players 2-4 then start beside P1), so use a fixed seed
    check(await A.eval('MAZE.Level.findStarts(MAZE.Level.generate({ seed: 4, cols: 25, rows: 19 })).filter(Boolean).length') === 4, 'the generator places extra player starts');
    await A.shot('1-editor');
    await A.eval('document.getElementById("btnTest").click()');
    await until(A, '!document.getElementById("gameScreen").hidden', 'solo game screen');
    await A.eval('document.querySelector("[data-act=lock]").click()');
    await A.eval('MAZE.game.keys.w = 1');
    await wait(900);
    await A.eval('MAZE.game.keys.w = 0');
    check(await A.eval('MAZE.game.enemies.length > 0 && MAZE.game.items.length > 0'), 'solo world has blobs and items');
    check(await A.eval('MAZE.game.time > 0.5'), 'solo game loop is running');
    await A.shot('2-solo');
    await A.eval('document.querySelector("#clickToPlay [data-act=quit], #pausePanel [data-act=quit]").click()');
    await A.eval('document.querySelectorAll("[data-act=quit]").forEach(b => { if (b.offsetParent) b.click(); }); MAZE.app.showEditor()');

    console.log('host a room');
    // a hall with Alice's and Bob's starts a step apart, so they meet without walking
    await A.eval(`(function(){
      const L = MAZE.Level, T = MAZE.T, W = MAZE.W, lv = L.create(16, 7, 'Duel Hall');
      for (let y = 1; y < 6; y++) for (let x = 1; x < 15; x++) lv.walls[y*16+x] = (y === 1 || y === 5) && x % 3 === 0 ? W.MOSS : W.EMPTY;
      L.setThing(lv, 2, 3, T.START); L.setThing(lv, 3, 3, T.START2); L.setThing(lv, 13, 3, T.FINISH);
      L.setThing(lv, 13, 1, T.BLOB); L.setThing(lv, 5, 2, T.SWORD); L.setThing(lv, 6, 4, T.TREASURE);
      MAZE.app.loadIntoEditor(lv);
    })()`);
    check(await A.eval('MAZE.Level.validate(MAZE.editor.level).ok'), 'duel hall is playable');
    await A.eval('document.getElementById("btnOnline").click()');
    await A.eval('document.getElementById("inpPlayerName").value = "Alice"');
    await A.eval('document.querySelector(\'.modePick[data-for="host"] [data-mode="versus"]\').click()');
    await A.eval('document.getElementById("btnCreateRoom").click()');
    await until(A, '!document.getElementById("lobbyPanel").hidden && /^[A-Z]{5}$/.test(document.getElementById("lobbyCode").textContent)', 'lobby with a room code');
    const room = await A.eval('document.getElementById("lobbyCode").textContent');
    check(true, 'room created: ' + room);

    console.log('join from an invite link');
    await B.send('Page.navigate', { url });
    await until(B, '!!(window.MAZE && MAZE.online)', 'B boot');
    await B.eval('localStorage.setItem("maze.name", JSON.stringify("Bob"))');
    await B.send('Page.navigate', { url: url + '?room=' + room });
    await until(B, '!document.getElementById("lobbyPanel").hidden && document.getElementById("lobbyCode").textContent === ' + JSON.stringify(room), 'B in the lobby');
    await until(A, 'document.querySelectorAll("#lobbySeats .seat:not(.open)").length === 2', 'A sees two seats filled');
    check(await A.eval('document.querySelector(\'.modePick[data-for="lobby"] .modeBtn.on\').dataset.mode') === 'versus', 'lobby shows competitive mode');
    check(await B.eval('document.getElementById("btnStartMatch").disabled'), 'guest cannot start');
    await A.shot('3-lobby-host');
    await B.shot('4-lobby-guest');

    console.log('play');
    await A.eval('document.getElementById("btnStartMatch").click()');
    await until(A, '!document.getElementById("gameScreen").hidden && MAZE.game && MAZE.game.online', 'A in the match');
    await until(B, '!document.getElementById("gameScreen").hidden && MAZE.game && MAZE.game.online', 'B in the match');
    for (const pg of [A, B]) await pg.eval('document.querySelector("[data-act=lock]").click()');
    await wait(3300);   // countdown
    check(await A.eval('MAZE.game.others.length === 1 && MAZE.game.others[0].name === "Bob"'), 'A knows about Bob');
    check(await B.eval('MAZE.game.enemies.length > 0'), 'B receives blobs from the server');

    // Bob turns round to face Alice; Alice already faces down the hall at him
    await B.eval('MAZE.game.player.ang = Math.PI');
    await A.eval('MAZE.game.player.ang = 0');
    await wait(600);
    const gap = await A.eval('Math.hypot(MAZE.game.others[0].x - MAZE.game.player.x, MAZE.game.others[0].y - MAZE.game.player.y)');
    check(gap < 1.3, 'Bob stands a step from Alice (' + gap.toFixed(2) + ')');
    await until(A, 'MAZE.game.others[0]._screen != null', 'A can see Bob on screen', 6000);
    check(await A.eval('MAZE.game.others[0].sprite') === 'hero1_front_fist', 'Alice sees Bob from the front, in his colour');
    await A.shot('5-match-alice-sees-bob');

    // Bob backs off a little and looks at Alice from the side, then walks for the sword
    await B.eval('MAZE.game.player.ang = -Math.PI / 2');
    await wait(400);
    check(await A.eval('/hero1_(left|right)_fist/.test(MAZE.game.others[0].sprite)'), 'turning shows Bob side-on');
    await B.eval('MAZE.game.player.ang = Math.PI');
    await B.shot('6-match-bob');

    const hpBefore = await B.eval('MAZE.game.player.hp');
    await A.eval('MAZE.game.player.atkCd = 0; MAZE.game.attack()');
    await until(B, `MAZE.game.player.hp < ${hpBefore}`, 'Alice hurts Bob', 4000);
    check(true, 'competitive punch hurt Bob: ' + hpBefore + ' -> ' + (await B.eval('MAZE.game.player.hp')));

    console.log('ping + end');
    await B.eval('MAZE.game.ping()');
    await until(A, 'MAZE.game.pings.length > 0', 'Alice sees Bob\'s ping');
    check(true, 'pings reach teammates and rivals');
    await A.eval('MAZE.net.send({ t: "abort" })');
    await until(B, '!document.getElementById("lobbyPanel").hidden', 'B back in the lobby after abort');
    check(true, 'host ended the match; guest is back in the lobby');

    console.log('spectate');
    await until(A, '!document.getElementById("lobbyPanel").hidden', 'A back in the lobby');
    await A.eval('document.querySelector(\'.modePick[data-for="role"] [data-role="watch"]\').click()');
    await until(B, '/spectate/.test(document.getElementById("lobbySeats").textContent)', 'Bob sees that Alice will spectate');
    check(await A.eval('document.getElementById("btnStartMatch").textContent') === 'START & WATCH', 'host is set to watch');
    await A.eval('document.getElementById("btnStartMatch").click()');
    await until(A, '!document.getElementById("gameScreen").hidden && MAZE.game.spectator', 'Alice spectating');
    await until(B, '!document.getElementById("gameScreen").hidden && MAZE.game.online && !MAZE.game.spectator', 'Bob playing');
    for (const pg of [A, B]) await pg.eval('document.querySelector("#clickToPlay button.primary:not([hidden])") && [...document.querySelectorAll("#clickToPlay [data-act=lock]")].find(b => b.offsetParent).click()');
    check(await A.eval('MAZE.game.others.length === 1 && !MAZE.game.otherMap.has(0)'), 'Alice has no body in the match; Bob is the only player');
    await wait(3400);
    await B.eval('MAZE.game.player.ang = 0; MAZE.game.keys.w = 1');
    await wait(700);
    await B.eval('MAZE.game.keys.w = 0');
    await wait(400);
    check(await A.eval('MAZE.game.viewMode') === 'map', 'spectating starts on the overhead map');
    const bobOnMap = await A.eval('MAZE.game.hud._pick.players.find(p => p.seat === 1)');
    check(!!bobOnMap, 'Bob is drawn on the overhead map');
    const moved = await A.eval('MAZE.game.otherMap.get(1).x');
    check(moved > 3.6, 'the map follows Bob as he walks (x ' + moved.toFixed(2) + ')');
    await A.shot('7-spectate-overhead');
    await A.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(bobOnMap.x), y: Math.round(bobOnMap.y), button: 'left', clickCount: 1 });
    await A.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(bobOnMap.x), y: Math.round(bobOnMap.y), button: 'left', clickCount: 1 });
    await until(A, 'MAZE.game.viewMode === "pov" && MAZE.game.camera().seat === 1', 'clicking Bob shows his eyes');
    check(true, 'clicking Bob on the map switches to his view');
    await B.eval('MAZE.game.player.ang = Math.PI * 0.9');
    await wait(500);
    check(Math.abs(await A.eval('MAZE.game.camera().ang') - Math.PI * 0.9) < 0.3, 'the spectator camera turns with Bob');
    await A.shot('8-spectate-bob-pov');
    await A.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Tab', key: 'Tab', windowsVirtualKeyCode: 9 });
    await A.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Tab', key: 'Tab', windowsVirtualKeyCode: 9 });
    await until(A, 'MAZE.game.viewMode === "map"', 'Tab back to the overhead map');
    check(true, 'Tab toggles back to the overhead map');
    await A.eval('MAZE.net.send({ t: "abort" })');
    await until(B, '!document.getElementById("lobbyPanel").hidden', 'B back in the lobby');

    const errs = A.errors.concat(B.errors).filter(e => !/pointer ?lock|requestPointerLock|AudioContext/i.test(e));
    check(errs.length === 0, 'no page errors' + (errs.length ? ':\n' + errs.join('\n') : ''));
  } catch (e) {
    failed = true;
    console.log(e.message);
    if (A) console.log(A.errors.join('\n'));
    if (B) console.log(B.errors.join('\n'));
    try { if (A) await A.shot('fail-A'); if (B) await B.shot('fail-B'); } catch (x) { }
    console.log('--- server log ---\n' + srvLog);
  }
  killTree(chA.pid); killTree(chB.pid);
  if (srv) srv.kill();
  fs.rmSync(data, { recursive: true, force: true });
  console.log(failed ? 'BROWSER TEST FAILED' : 'BROWSER TEST PASSED');
  process.exit(failed ? 1 : 0);
})();
