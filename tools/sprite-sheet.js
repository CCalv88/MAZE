/* Renders every procedural sprite onto one sheet in headless Chrome, for a visual check.
 *   node tools/sprite-sheet.js      -> tools/shots/sprites.png */
'use strict';
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DBG = 9351;
const wait = ms => new Promise(r => setTimeout(r, ms));
const getJson = url => new Promise((res, rej) => http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));

(async () => {
  fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
  const ch = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${DBG}`, `--user-data-dir=${path.join(os.tmpdir(), 'maze-sheet-' + Date.now())}`, '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
  let page;
  for (let i = 0; i < 80 && !page; i++) { try { page = (await getJson(`http://127.0.0.1:${DBG}/json`)).find(t => t.type === 'page'); } catch (e) { } if (!page) await wait(250); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  let id = 0; const pending = {};
  ws.on('message', d => { const m = JSON.parse(d); if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; } });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + path.join(__dirname, '..', 'index.html').replace(/\\/g, '/') });
  await wait(1500);
  const r = await send('Runtime.evaluate', { returnByValue: true, expression: `(function(){
    const S = MAZE.sprites, L = MAZE.Level;
    const looks = [
      { body: 'slime', c1: '#e0506a', c2: '#6a1020', c3: '#ffe14a' }, { body: 'spider', c1: '#3a3440', c2: '#c0392b', c3: '#ff3030' },
      { body: 'goblin', c1: '#7cc24a', c2: '#6b4a2a', c3: '#ffd84a' }, { body: 'orc', c1: '#6f8f4a', c2: '#5a4a6a', c3: '#ff5a2a' },
      { body: 'skeleton', c1: '#e8e2d0', c2: '#8a7a5a', c3: '#40e0ff' }, { body: 'bat', c1: '#4a3a5a', c2: '#2a1e36', c3: '#ff4040' },
      { body: 'ghost', c1: '#bfe8ff', c2: '#20304a', c3: '#80ffe0' }];
    const names = looks.map(m => S.monster(L.cleanMonster(m)));
    const extra = ['stairs_up','ladder_up','stairs_down','ladder_down','scroll_fire','scroll_frost','scroll_heal','scroll_bolt','scroll_blink','scroll_ward','mana','fireball','frostshard','spit','hero1_front_sword','blob'];
    const cv = document.createElement('canvas'); cv.width = 1400; cv.height = 900;
    const g = cv.getContext('2d'); g.fillStyle = '#1b202c'; g.fillRect(0,0,1400,900); g.imageSmoothingEnabled = false;
    names.forEach((n, k) => { const sp = S.get(n); for (let f = 0; f < sp.count; f++) { const c = document.createElement('canvas'); c.width = sp.w; c.height = sp.h; const d = c.getContext('2d').createImageData(sp.w, sp.h); new Uint32Array(d.data.buffer).set(sp.frames[f]); c.getContext('2d').putImageData(d,0,0); g.drawImage(c, 10 + f * 200, 10 + k * 0, 0, 0); } });
    let y = 10;
    names.forEach((n) => { const sp = S.get(n); for (let f = 0; f < sp.count; f++) { const c = document.createElement('canvas'); c.width = sp.w; c.height = sp.h; const d = c.getContext('2d').createImageData(sp.w, sp.h); new Uint32Array(d.data.buffer).set(sp.frames[f]); c.getContext('2d').putImageData(d,0,0); g.drawImage(c, 10 + f * 100, y, 96, 96); } y += 100; if (y > 700) y = 10; });
    extra.forEach((n, k) => { const c = S.icon(n); if (c) g.drawImage(c, 640 + (k % 8) * 95, 10 + Math.floor(k / 8) * 110, c.width * 1.8, c.height * 1.8); });
    return cv.toDataURL('image/png');
  })()` });
  fs.writeFileSync(path.join(__dirname, 'shots', 'sprites.png'), Buffer.from(r.result.result.value.split(',')[1], 'base64'));
  console.log('wrote tools/shots/sprites.png');
  ws.close();
  spawnSync('taskkill', ['/PID', String(ch.pid), '/T', '/F'], { stdio: 'ignore' });
})();
