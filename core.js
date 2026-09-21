// Loads the browser's game rules (js/util.js, defs.js, level.js, sim.js) into Node, so
// the server plays by exactly the same code the page runs. They are plain browser
// scripts that hang everything off `window.MAZE`, so they run in a small sandbox whose
// global is its own `window`.
'use strict';
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const FILES = ['util.js', 'defs.js', 'level.js', 'sim.js'];

function loadCore() {
  const ctx = { console };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(__dirname, 'js', f), 'utf8'), ctx, { filename: 'js/' + f });
  return ctx.MAZE;
}

module.exports = { loadCore };
