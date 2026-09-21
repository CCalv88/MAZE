/* Mouse-look after the character sheet, and after the browser refuses to capture the
 * mouse: you are never left with neither mouse-look nor a way to get it back.
 *   node tools/look-test.js */
'use strict';
const path = require('path');
const { launch, attach, kill, wait, check } = require('./cdp.js');

(async () => {
  const ch = launch(9381);
  let failed = false;
  try {
    const A = await attach(9381, 'A');
    await A.send('Page.navigate', { url: 'file:///' + path.join(__dirname, '..', 'index.html').replace(/\\/g, '/') });
    await A.until('!!(window.MAZE && MAZE.editor)', 'boot');
    await A.eval('document.getElementById("btnTest").click()');
    await A.until('MAZE.game && MAZE.game.running', 'game');
    const btn = await A.eval('(function(){ const b = [...document.querySelectorAll("#clickToPlay [data-act=lock]")].find(b => b.offsetParent).getBoundingClientRect(); return { x: b.x + b.width/2, y: b.y + b.height/2 }; })()');
    await A.click(Math.round(btn.x), Math.round(btn.y));
    await wait(700);
    const state = () => A.eval('({ locked: document.pointerLockElement === document.getElementById("view"), relock: !document.getElementById("relock").hidden, paused: MAZE.game.paused })');
    check((await state()).locked, 'CLICK TO PLAY captures the mouse');
    await A.eval('MAZE.game.link.sim.player(0).invuln = 1e9; MAZE.game.link.sim.grantXp(MAZE.game.link.sim.player(0), 200)');
    await wait(100);

    // spend a point, close the sheet each way a player might, then look around
    for (const how of ['KeyC', 'Escape', 'button']) {
      await A.key('KeyC', 'c', 67);
      await A.until('!document.getElementById("charPanel").hidden', 'sheet open');
      await wait(300);
      await A.key('Digit2', '2', 50);
      if (how === 'button') {
        const r = await A.eval('(function(){ const b = document.querySelector("#charPanel [data-act=closeChar]").getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()');
        await A.click(Math.round(r.x), Math.round(r.y));
      } else await A.key(how, how === 'KeyC' ? 'c' : 'Escape', how === 'KeyC' ? 67 : 27);
      await wait(800);
      const s = await state();
      check(!s.paused, 'game running after closing the sheet with ' + how);
      check(s.locked || s.relock, 'mouse captured, or "click to look around" is up (' + how + ')');
      if (!s.locked) { await A.click(640, 400); await wait(500); }
      const a0 = await A.eval('MAZE.game.player.ang');
      await A.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700, y: 400 });
      await A.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 780, y: 400 });
      await wait(100);
      check((await state()).locked && Math.abs((await A.eval('MAZE.game.player.ang')) - a0) > 0.05, 'looking around works after ' + how);
    }

    // make the browser refuse the next capture, as real Chrome does just after Esc
    await A.eval(`(function(){ const orig = HTMLElement.prototype.requestPointerLock; HTMLElement.prototype.requestPointerLock = function(){ HTMLElement.prototype.requestPointerLock = orig; return Promise.reject(new DOMException("The user has exited the lock before this request was completed.", "SecurityError")); }; })()`);
    await A.key('KeyC', 'c', 67);
    await A.until('!document.getElementById("charPanel").hidden', 'sheet open');
    await wait(400);
    await A.key('Escape', 'Escape', 27);
    await wait(700);
    const refused = await state();
    check(!refused.locked && refused.relock, 'a refused capture shows "click to look around"');
    const c0 = await A.eval('MAZE.game.player.ang');
    await A.click(640, 400);
    await wait(400);
    await A.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700, y: 400 });
    await A.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 790, y: 400 });
    await wait(100);
    const back = await state();
    check(back.locked && !back.relock, 'one click captures the mouse again');
    check(Math.abs((await A.eval('MAZE.game.player.ang')) - c0) > 0.05, 'and looking around works again');
    check(A.errors.length === 0, 'no page errors ' + A.errors.join('; '));
  } catch (e) { failed = true; console.log(e.message); }
  kill(ch);
  console.log(failed ? 'LOOK TEST FAILED' : 'LOOK TEST PASSED');
  process.exit(failed ? 1 : 0);
})();
