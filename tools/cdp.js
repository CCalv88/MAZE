/* Tiny Chrome DevTools helper for the browser tests: launch headless Chrome, attach to
 * its page, evaluate, click, press keys, screenshot, and collect page errors. */
'use strict';
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOTS = path.join(__dirname, 'shots');
const wait = ms => new Promise(r => setTimeout(r, ms));
const getJson = url => new Promise((res, rej) => http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));

function launch(dbg, profile) {
  const dir = profile || path.join(os.tmpdir(), `maze-chrome-${dbg}-${Date.now()}`);
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run',
    '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${dbg}`, `--user-data-dir=${dir}`, '--window-size=1280,800', 'about:blank'], { stdio: 'ignore' });
  proc.profile = dir;
  return proc;
}
const kill = proc => { try { spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { } };

async function attach(dbg, label) {
  for (let i = 0; i < 80; i++) {
    try {
      const p = (await getJson(`http://127.0.0.1:${dbg}/json`)).find(t => t.type === 'page');
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
    ws.on('open', async () => {
      const send = (method, params = {}) => new Promise(r => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
      const pg = {
        send, errors,
        async eval(expr) {
          const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
          if (r.result && r.result.exceptionDetails) throw new Error(label + ' eval failed: ' + expr.slice(0, 90) + ' :: ' + JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description));
          return r.result && r.result.result ? r.result.result.value : undefined;
        },
        async shot(name) {
          fs.mkdirSync(SHOTS, { recursive: true });
          const s = await send('Page.captureScreenshot', { format: 'png' });
          fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(s.result.data, 'base64'));
        },
        async key(code, key, vk) {
          await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: key || code, windowsVirtualKeyCode: vk || 0 });
          await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: key || code, windowsVirtualKeyCode: vk || 0 });
        },
        async click(x, y) {
          await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
          await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
        },
        async until(expr, what, timeout = 8000) {
          const start = Date.now();
          while (Date.now() - start < timeout) { if (await pg.eval(expr)) return; await wait(100); }
          throw new Error('timed out: ' + what);
        },
        close: () => ws.close()
      };
      await send('Runtime.enable');
      // headless pages have no focus, and browsers only capture the mouse for a focused page
      await send('Emulation.setFocusEmulationEnabled', { enabled: true });
      await send('Page.bringToFront');
      await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      res(pg);
    });
    ws.on('error', rej);
  });
}

const check = (cond, msg) => { if (!cond) throw new Error('FAILED: ' + msg); console.log('  ok  ' + msg); };

module.exports = { launch, attach, kill, wait, check, SHOTS };
