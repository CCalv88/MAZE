/* MAZE — top-down level editor. One floor at a time (the tabs above the canvas); stairs
   and ladders placed on a floor make their partner on the floor above. Custom monsters
   from the Monster Maker sit in the Enemies palette alongside the blobs. */
(function () {
  const MAZE = window.MAZE;
  const U = MAZE.util;
  const L = MAZE.Level;
  const W = MAZE.W, T = MAZE.T;

  const TOOLS = [
    { id: "brush", label: "Brush", key: "B" },
    { id: "line", label: "Line", key: "L" },
    { id: "rect", label: "Rect", key: "R" },
    { id: "fill", label: "Fill", key: "F" },
    { id: "eraser", label: "Eraser", key: "X" },
    { id: "pick", label: "Pick", key: "P" }
  ];

  function Editor() {
    this.canvas = document.getElementById("editorCanvas");
    this.ctx = this.canvas.getContext("2d");
    this.tool = "brush";
    this.sel = { layer: "wall", id: W.BRICK };
    this.undoStack = [];
    this.redoStack = [];
    this.cell = 20;
    this.floor = 0;
    this.hover = null;
    this.preview = null;
    this.drag = null;
    this.tileCache = {};
    this.level = L.generate({ cols: 25, rows: 19, name: "First Descent" });
    this.buildPalette();
    this.bind();
  }

  // ------------------------------------------------------------ palette --
  function chipCanvas(src, smooth) {
    const chip = document.createElement("canvas");
    chip.className = "chip";
    chip.width = chip.height = 22;
    const c = chip.getContext("2d");
    c.imageSmoothingEnabled = !!smooth;
    if (src) c.drawImage(src, 0, 0, 22, 22);
    return chip;
  }

  Editor.prototype.buildPalette = function () {
    const toolRow = document.getElementById("toolRow");
    toolRow.innerHTML = "";
    const self = this;
    TOOLS.forEach(function (t) {
      const b = document.createElement("button");
      b.textContent = t.label;
      b.title = t.label + "  (" + t.key + ")";
      b.dataset.tool = t.id;
      b.onclick = function () { self.setTool(t.id); };
      toolRow.appendChild(b);
    });

    const host = document.getElementById("paletteGroups");
    host.innerHTML = "";
    MAZE.CATS.forEach(function (cat) {
      const entries = [];
      if (cat.id === "wall") {
        entries.push({ layer: "wall", id: W.EMPTY, name: "Floor (erase)", def: { mini: "#11151d" } });
        for (const k in MAZE.WALLS) entries.push({ layer: "wall", id: +k, name: MAZE.WALLS[k].name, def: MAZE.WALLS[k] });
      } else {
        for (const k in MAZE.THINGS) {
          const d = MAZE.THINGS[k];
          if (d.cat === cat.id && !d.hidden) entries.push({ layer: "thing", id: +k, name: d.name, def: d });
        }
        // player starts 1-4 first, then the exit
        entries.sort((a, b) => (a.def.seat == null ? 9 : a.def.seat) - (b.def.seat == null ? 9 : b.def.seat));
      }
      if (cat.id === "enemy") {
        for (const m of self.monsterChoices()) entries.push({ layer: "monster", id: m.uid, name: m.name, def: m, custom: true });
      }
      const g = document.createElement("div");
      g.className = "palGroup";
      const h = document.createElement("h4");
      h.textContent = cat.title;
      g.appendChild(h);
      entries.forEach(function (e) {
        const b = document.createElement("button");
        b.className = "swatch" + (e.custom ? " custom" : "");
        b.dataset.layer = e.layer;
        b.dataset.id = e.id;
        let chip;
        if (e.custom) chip = chipCanvas(MAZE.sprites.icon(MAZE.sprites.monster(e.def)), false);
        else if (e.layer === "thing" && MAZE.sprites.icon(e.def.sprite)) chip = chipCanvas(MAZE.sprites.icon(e.def.sprite), true);
        else if (e.layer === "wall" && e.id !== W.EMPTY) chip = chipCanvas(MAZE.textures.get(e.def.tex).canvas, false);
        else { chip = document.createElement("div"); chip.className = "chip"; chip.style.background = e.def.mini; }
        b.appendChild(chip);
        const label = document.createElement("span");
        label.textContent = e.name;
        b.appendChild(label);
        b.onclick = function () { self.select(e.layer, e.id); };
        if (e.custom) b.ondblclick = function () { MAZE.monsters.open(e.def); };
        g.appendChild(b);
      });
      if (cat.id === "enemy") {
        const mk = document.createElement("button");
        mk.className = "makerBtn";
        mk.textContent = "＋ Monster Maker";
        mk.title = "Design your own monster: body, colours, stats and a special ability";
        mk.onclick = function () { MAZE.monsters.open(); };
        g.appendChild(mk);
      }
      host.appendChild(g);
    });
    this.refreshPaletteState();
  };

  // your library, plus any monster the current maze carries that the library lacks
  Editor.prototype.monsterChoices = function () {
    const lib = MAZE.monsters ? MAZE.monsters.library.list() : [];
    for (const m of this.level.monsters || []) if (!lib.some((o) => o.uid === m.uid)) lib.push(m);
    return lib;
  };

  Editor.prototype.refreshPaletteState = function () {
    const self = this;
    document.querySelectorAll("#toolRow button").forEach(function (b) {
      b.classList.toggle("on", b.dataset.tool === self.tool);
    });
    document.querySelectorAll(".swatch").forEach(function (b) {
      b.classList.toggle("on", b.dataset.layer === self.sel.layer && String(b.dataset.id) === String(self.sel.id));
    });
    const info = document.getElementById("selInfo");
    let def;
    if (this.sel.layer === "wall") def = this.sel.id === W.EMPTY ? { name: "Floor", desc: "Open ground. Also erases whatever was here." } : MAZE.WALLS[this.sel.id];
    else if (this.sel.layer === "monster") {
      const m = this.monsterChoices().find((o) => o.uid === this.sel.id);
      if (m) def = { name: m.name, desc: MAZE.MONSTER_BODIES[m.body].name + " · " + m.hp + " health · " + m.dmg + " damage · speed " + m.speed + (m.ability !== "none" ? " · " + MAZE.MONSTER_ABILITIES[m.ability].name : "") + ". Double-click it in the palette to edit." };
    } else def = MAZE.THINGS[this.sel.id];
    if (def) {
      info.innerHTML = "";
      const b = document.createElement("b");
      b.textContent = def.name;
      info.appendChild(b);
      info.appendChild(document.createTextNode(def.desc || ""));
    }
  };

  Editor.prototype.setTool = function (t) { this.tool = t; this.refreshPaletteState(); };
  Editor.prototype.select = function (layer, id) {
    this.sel = { layer: layer, id: id };
    if (this.tool === "eraser" || this.tool === "pick") this.tool = "brush";
    this.refreshPaletteState();
  };

  // --------------------------------------------------------------- undo --
  Editor.prototype.snapshot = function () {
    this.undoStack.push({ level: L.clone(this.level), floor: this.floor });
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack.length = 0;
  };
  Editor.prototype.undo = function () {
    if (!this.undoStack.length) return;
    this.redoStack.push({ level: L.clone(this.level), floor: this.floor });
    const s = this.undoStack.pop();
    this.level = s.level; this.floor = Math.min(s.floor, this.level.floors - 1);
    this.syncInputs(); this.render();
  };
  Editor.prototype.redo = function () {
    if (!this.redoStack.length) return;
    this.undoStack.push({ level: L.clone(this.level), floor: this.floor });
    const s = this.redoStack.pop();
    this.level = s.level; this.floor = Math.min(s.floor, this.level.floors - 1);
    this.syncInputs(); this.render();
  };

  // -------------------------------------------------------------- paint --
  Editor.prototype.paintCell = function (x, y, erase) {
    const lv = this.level, f = this.floor;
    if (!L.inside(lv, x, y)) return;
    const i = L.idx(lv, x, y, f);
    if (x === 0 || y === 0 || x === lv.cols - 1 || y === lv.rows - 1) {
      // the outer ring stays solid, otherwise you can walk out of the world
      if (!erase && this.sel.layer === "wall" && this.sel.id !== W.EMPTY) lv.walls[i] = this.sel.id;
      return;
    }
    if (erase) {
      if (lv.things[i]) L.clearThing(lv, i);
      else lv.walls[i] = W.EMPTY;
      return;
    }
    if (this.sel.layer === "wall") {
      if (this.sel.id !== W.EMPTY && lv.things[i]) L.clearThing(lv, i);
      lv.walls[i] = this.sel.id;
    } else if (this.sel.layer === "monster") {
      const m = this.monsterChoices().find((o) => o.uid === this.sel.id);
      if (!m) return;
      const kind = L.addMonster(lv, m);
      if (!kind) { this.flash("A maze can hold " + MAZE.MAX_CUSTOM + " kinds of custom monster."); return; }
      L.setThing(lv, x, y, kind, f);
    } else {
      const floorsBefore = lv.floors;
      if (!L.setThing(lv, x, y, this.sel.id, f)) {
        if (L.isStair(this.sel.id)) this.flash(this.floor === 0 && L.isDown(this.sel.id) ? "No floor below this one." : "Mazes top out at " + MAZE.MAX_FLOORS + " floors.");
        return;
      }
      if (lv.floors !== floorsBefore) this.flash("Added floor " + lv.floors + " — its way down is waiting there.");
    }
  };

  Editor.prototype.flash = function (text) { if (MAZE.app && MAZE.app.flash) MAZE.app.flash(text); };

  Editor.prototype.cellsFor = function (a, b, tool) {
    const out = [];
    if (tool === "line") {
      let x0 = a.x, y0 = a.y;
      const dx = Math.abs(b.x - x0), sx = x0 < b.x ? 1 : -1;
      const dy = -Math.abs(b.y - y0), sy = y0 < b.y ? 1 : -1;
      let err = dx + dy;
      for (let guard = 0; guard < 5000; guard++) {
        out.push({ x: x0, y: y0 });
        if (x0 === b.x && y0 === b.y) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
    } else if (tool === "rect") {
      const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
      const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++)
          if (y === y0 || y === y1 || x === x0 || x === x1) out.push({ x: x, y: y });
    }
    return out;
  };

  Editor.prototype.flood = function (x, y) {
    const lv = this.level, o = this.floor * L.plane(lv);
    const target = lv.walls[o + y * lv.cols + x];
    const repl = this.sel.layer === "wall" ? this.sel.id : W.EMPTY;
    if (target === repl) return;
    const stack = [[x, y]];
    const seen = new Uint8Array(lv.cols * lv.rows);
    while (stack.length) {
      const c = stack.pop();
      const cx = c[0], cy = c[1];
      if (cx < 1 || cy < 1 || cx >= lv.cols - 1 || cy >= lv.rows - 1) continue;
      const r = cy * lv.cols + cx;
      if (seen[r] || lv.walls[o + r] !== target) continue;
      seen[r] = 1;
      if (repl !== W.EMPTY && lv.things[o + r]) L.clearThing(lv, o + r);
      lv.walls[o + r] = repl;
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
  };

  // ------------------------------------------------------------- floors --
  Editor.prototype.setFloor = function (f) {
    this.floor = U.clamp(f, 0, this.level.floors - 1);
    this.render();
  };

  Editor.prototype.renderFloorTabs = function () {
    const host = document.getElementById("floorTabs");
    const lv = this.level, self = this;
    host.innerHTML = "";
    for (let f = lv.floors - 1; f >= 0; f--) {
      const b = document.createElement("button");
      b.className = "floorTab" + (f === this.floor ? " on" : "");
      const ups = [], downs = [];
      const P = L.plane(lv);
      for (let i = f * P; i < (f + 1) * P; i++) { if (L.isUp(lv.things[i])) ups.push(i); else if (L.isDown(lv.things[i])) downs.push(i); }
      b.textContent = "Floor " + (f + 1);
      b.title = (f === 0 ? "Ground floor" : "Floor " + (f + 1)) + (ups.length ? " · " + ups.length + " way(s) up" : "") + (downs.length ? " · " + downs.length + " way(s) down" : "");
      b.onclick = function () { self.setFloor(f); };
      host.appendChild(b);
    }
    if (lv.floors < MAZE.MAX_FLOORS) {
      const add = document.createElement("button");
      add.className = "floorTab add";
      add.textContent = "＋ Floor";
      add.title = "Add an empty floor on top (then join it with Stairs Up or a Ladder)";
      add.onclick = function () { self.snapshot(); L.addFloor(self.level); self.floor = self.level.floors - 1; self.render(); self.flash("Floor " + self.level.floors + " added. Place Stairs Up on the floor below to reach it."); };
      host.appendChild(add);
    }
    if (lv.floors > 1) {
      const del = document.createElement("button");
      del.className = "floorTab del";
      del.textContent = "Delete floor " + (this.floor + 1);
      del.onclick = function () {
        if (!confirm("Delete floor " + (self.floor + 1) + " and everything on it?")) return;
        self.snapshot();
        L.removeFloor(self.level, self.floor);
        self.floor = Math.min(self.floor, self.level.floors - 1);
        self.render();
      };
      host.appendChild(del);
    }
  };

  // ------------------------------------------------------------- render --
  Editor.prototype.layout = function () {
    const wrap = document.getElementById("canvasWrap");
    const lv = this.level;
    const pad = 36, tabs = 34;
    const cell = U.clamp(
      Math.floor(Math.min((wrap.clientWidth - pad) / lv.cols, (wrap.clientHeight - pad - tabs) / lv.rows)),
      6, 46
    );
    if (cell !== this.cell) { this.cell = cell; this.tileCache = {}; }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.style.width = lv.cols * cell + "px";
    this.canvas.style.height = lv.rows * cell + "px";
    this.canvas.width = Math.round(lv.cols * cell * dpr);
    this.canvas.height = Math.round(lv.rows * cell * dpr);
    this.dpr = dpr;
  };

  Editor.prototype.tileImage = function (texName) {
    const key = texName + "@" + this.cell;
    if (this.tileCache[key]) return this.tileCache[key];
    const c = document.createElement("canvas");
    c.width = c.height = Math.max(4, this.cell);
    const g = c.getContext("2d");
    g.drawImage(MAZE.textures.get(texName).canvas, 0, 0, c.width, c.height);
    this.tileCache[key] = c;
    return c;
  };

  Editor.prototype.render = function () {
    if (this.floor >= this.level.floors) this.floor = this.level.floors - 1;
    this.layout();
    const lv = this.level, cell = this.cell, g = this.ctx, o = this.floor * L.plane(lv);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const w = lv.cols * cell, h = lv.rows * cell;
    g.clearRect(0, 0, w, h);

    // floor
    g.fillStyle = "#11151d";
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < lv.rows; y++)
      for (let x = 0; x < lv.cols; x++)
        if ((x + y) % 2 === 0) {
          g.fillStyle = "#151a24";
          g.fillRect(x * cell, y * cell, cell, cell);
        }

    // the floor below, faintly, so it is easy to line things up across floors
    if (this.floor > 0) {
      const ob = (this.floor - 1) * L.plane(lv);
      g.fillStyle = "rgba(255,255,255,.035)";
      for (let y = 0; y < lv.rows; y++)
        for (let x = 0; x < lv.cols; x++)
          if (lv.walls[ob + y * lv.cols + x]) g.fillRect(x * cell, y * cell, cell, cell);
    }

    // walls
    for (let y = 0; y < lv.rows; y++) {
      for (let x = 0; x < lv.cols; x++) {
        const t = lv.walls[o + y * lv.cols + x];
        if (!t) continue;
        const def = MAZE.WALLS[t];
        const px = x * cell, py = y * cell;
        const tex = t === W.SECRET ? "brick" : def.tex;
        g.drawImage(this.tileImage(tex), px, py);
        if (t === W.SECRET) {
          g.fillStyle = "rgba(192,107,214,.45)";
          g.fillRect(px, py, cell, cell);
          g.strokeStyle = "#e0a6f5";
          g.lineWidth = Math.max(1, cell * .08);
          g.setLineDash([Math.max(2, cell * .18), Math.max(2, cell * .16)]);
          g.strokeRect(px + cell * .12, py + cell * .12, cell * .76, cell * .76);
          g.setLineDash([]);
        } else if (t === W.GLASS) {
          g.fillStyle = "rgba(127,216,255,.28)";
          g.fillRect(px, py, cell, cell);
        }
        g.strokeStyle = "rgba(0,0,0,.35)";
        g.lineWidth = 1;
        g.strokeRect(px + .5, py + .5, cell - 1, cell - 1);
      }
    }

    // grid
    if (cell >= 10) {
      g.strokeStyle = "rgba(255,255,255,.045)";
      g.lineWidth = 1;
      g.beginPath();
      for (let x = 0; x <= lv.cols; x++) { g.moveTo(x * cell + .5, 0); g.lineTo(x * cell + .5, h); }
      for (let y = 0; y <= lv.rows; y++) { g.moveTo(0, y * cell + .5); g.lineTo(w, y * cell + .5); }
      g.stroke();
    }

    // things
    for (let y = 0; y < lv.rows; y++) {
      for (let x = 0; x < lv.cols; x++) {
        const id = lv.things[o + y * lv.cols + x];
        if (!id) continue;
        const px = x * cell, py = y * cell;
        if (id >= MAZE.CUSTOM_BASE) {
          const m = lv.monsters[id - MAZE.CUSTOM_BASE];
          if (!m) continue;
          const icon = MAZE.sprites.icon(MAZE.sprites.monster(m));
          const s = cell * (0.7 + m.size * 0.3);
          g.imageSmoothingEnabled = false;
          g.drawImage(icon, px + (cell - s) / 2, py + (cell - s) / 2, s, s);
          g.imageSmoothingEnabled = true;
          continue;
        }
        const def = MAZE.THINGS[id];
        if (!def) continue;
        if (def.cat === "marker" || def.stair) {
          g.fillStyle = def.mini;
          g.globalAlpha = 0.24;
          g.fillRect(px, py, cell, cell);
          g.globalAlpha = 1;
          g.strokeStyle = def.mini;
          g.lineWidth = Math.max(1.5, cell * .1);
          g.strokeRect(px + 1, py + 1, cell - 2, cell - 2);
        }
        const icon = MAZE.sprites.icon(def.sprite);
        if (icon) {
          const s = cell * (def.cat === "enemy" ? 0.98 : 0.82);
          g.drawImage(icon, px + (cell - s) / 2, py + (cell - s) / 2, s, s);
        }
      }
    }

    // pending line/rect preview
    if (this.preview) {
      g.fillStyle = "rgba(255,180,84,.35)";
      for (const c of this.preview) g.fillRect(c.x * cell, c.y * cell, cell, cell);
    }

    // hover
    if (this.hover && L.inside(lv, this.hover.x, this.hover.y)) {
      g.strokeStyle = "#ffb454";
      g.lineWidth = 2;
      g.strokeRect(this.hover.x * cell + 1, this.hover.y * cell + 1, cell - 2, cell - 2);
    }

    this.renderFloorTabs();
    this.updateInspector();
  };

  // ---------------------------------------------------------- inspector --
  Editor.prototype.updateInspector = function () {
    const v = L.validate(this.level);
    const lv = this.level;
    const stats = document.getElementById("levelStats");
    stats.innerHTML =
      "<span>Size</span><b>" + lv.cols + " x " + lv.rows + (lv.floors > 1 ? " x " + lv.floors + " floors" : "") + "</b>" +
      "<span>Open tiles</span><b>" + v.counts.open + "</b>" +
      "<span>Enemies</span><b>" + v.counts.enemies + (v.counts.custom ? " (" + v.counts.custom + " custom)" : "") + "</b>" +
      "<span>Items</span><b>" + v.counts.items + "</b>" +
      "<span>Scrolls</span><b>" + v.counts.scrolls + "</b>" +
      "<span>Secrets</span><b>" + v.counts.secrets + "</b>" +
      "<span>Doors</span><b>" + v.counts.doors + "</b>" +
      (lv.floors > 1 ? "<span>Stairs</span><b>" + v.counts.stairs + "</b>" : "");

    const box = document.getElementById("validation");
    box.innerHTML = "";
    if (v.ok && !v.warnings.length) {
      const d = document.createElement("div");
      d.className = "ok";
      d.textContent = "Ready to play.";
      box.appendChild(d);
    }
    v.errors.forEach(function (e) {
      const d = document.createElement("div");
      d.className = "err"; d.textContent = "! " + e; box.appendChild(d);
    });
    v.warnings.forEach(function (e) {
      const d = document.createElement("div");
      d.className = "warn"; d.textContent = "- " + e; box.appendChild(d);
    });
    v.info.forEach(function (e) {
      const d = document.createElement("div");
      d.className = "info"; d.textContent = e; box.appendChild(d);
    });
    this.valid = v;
    document.getElementById("btnTest").disabled = !v.ok;
    document.getElementById("btnOnline").disabled = !v.ok;

    // the maze code is a hash of the layout, so it changes with every edit
    const code = L.code(lv);
    if (code !== this._code) {
      this._code = code;
      document.getElementById("mazeCode").textContent = code;
      if (this.onCodeChange) this.onCodeChange(code);
    }
  };

  Editor.prototype.syncInputs = function () {
    document.getElementById("inpCols").value = this.level.cols;
    document.getElementById("inpRows").value = this.level.rows;
    document.getElementById("inpFloors").value = this.level.floors;
    document.getElementById("inpName").value = this.level.name;
  };

  Editor.prototype.refreshLevelList = function () {
    const host = document.getElementById("levelList");
    const all = L.saved();
    const names = Object.keys(all);
    host.innerHTML = "";
    if (!names.length) {
      const d = document.createElement("div");
      d.className = "empty";
      d.textContent = "Nothing saved yet.";
      host.appendChild(d);
      return;
    }
    const self = this;
    names.sort().forEach(function (n) {
      const row = document.createElement("div");
      row.className = "levelRow";
      const b = document.createElement("button");
      b.className = "nm";
      b.textContent = n;
      b.title = "Load " + n;
      b.onclick = function () {
        self.snapshot();
        self.setLevel(L.load(n));
      };
      const del = document.createElement("button");
      del.className = "del";
      del.textContent = "x";
      del.title = "Delete";
      del.onclick = function () {
        if (confirm('Delete "' + n + '"?')) { L.remove(n); self.refreshLevelList(); }
      };
      row.appendChild(b); row.appendChild(del);
      host.appendChild(row);
    });
  };

  // swap in a whole level (loaded, imported, opened by code); its monsters join your library
  Editor.prototype.setLevel = function (lv) {
    this.level = lv;
    this.floor = 0;
    if (MAZE.monsters && lv.monsters && lv.monsters.length && MAZE.monsters.library.adopt(lv.monsters)) this.buildPalette();
    this.syncInputs();
    this.render();
  };

  // --------------------------------------------------------------- bind --
  Editor.prototype.cellFromEvent = function (e) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: Math.floor((e.clientX - r.left) / this.cell),
      y: Math.floor((e.clientY - r.top) / this.cell)
    };
  };

  Editor.prototype.bind = function () {
    const self = this;
    const cv = this.canvas;

    cv.addEventListener("contextmenu", function (e) { e.preventDefault(); });

    cv.addEventListener("mousedown", function (e) {
      const c = self.cellFromEvent(e);
      const erase = e.button === 2 || self.tool === "eraser";
      if (e.altKey || self.tool === "pick") {
        if (L.inside(self.level, c.x, c.y)) {
          const i = L.idx(self.level, c.x, c.y, self.floor), t = self.level.things[i];
          if (t >= MAZE.CUSTOM_BASE && self.level.monsters[t - MAZE.CUSTOM_BASE]) self.select("monster", self.level.monsters[t - MAZE.CUSTOM_BASE].uid);
          else if (t && !MAZE.THINGS[t].hidden) self.select("thing", t);
          else if (t && L.isStair(t)) self.select("thing", MAZE.STAIR_PAIR[t]);
          else self.select("wall", self.level.walls[i]);
        }
        return;
      }
      self.snapshot();
      if (self.tool === "fill" && !erase) {
        if (L.inside(self.level, c.x, c.y)) self.flood(c.x, c.y);
        self.render();
        return;
      }
      if (self.tool === "line" || self.tool === "rect") {
        self.drag = { start: c, erase: erase, shape: true };
        self.preview = [c];
      } else {
        self.drag = { start: c, erase: erase, shape: false, last: c };
        self.paintCell(c.x, c.y, erase);
      }
      self.render();
      e.preventDefault();
    });

    window.addEventListener("mousemove", function (e) {
      if (document.getElementById("editorScreen").hidden) return;
      const c = self.cellFromEvent(e);
      const changed = !self.hover || self.hover.x !== c.x || self.hover.y !== c.y;
      self.hover = c;
      if (self.drag) {
        if (self.drag.shape) {
          self.preview = self.cellsFor(self.drag.start, c, self.tool);
        } else if (changed) {
          // fill the gap between samples so fast drags do not leave holes
          const line = self.cellsFor(self.drag.last, c, "line");
          for (const cc of line) self.paintCell(cc.x, cc.y, self.drag.erase);
          self.drag.last = c;
        }
        self.render();
      } else if (changed) {
        self.render();
      }
    });

    window.addEventListener("mouseup", function () {
      if (self.drag && self.drag.shape && self.preview) {
        for (const c of self.preview) self.paintCell(c.x, c.y, self.drag.erase);
      }
      const was = !!self.drag;
      self.drag = null;
      self.preview = null;
      if (was) self.render();
    });

    cv.addEventListener("wheel", function (e) {
      // cycle through the palette
      const swatches = Array.prototype.slice.call(document.querySelectorAll(".swatch"));
      const idx = swatches.findIndex(function (b) {
        return b.dataset.layer === self.sel.layer && String(b.dataset.id) === String(self.sel.id);
      });
      if (idx < 0) return;
      const next = swatches[(idx + (e.deltaY > 0 ? 1 : -1) + swatches.length) % swatches.length];
      self.select(next.dataset.layer, next.dataset.layer === "monster" ? next.dataset.id : +next.dataset.id);
      e.preventDefault();
    }, { passive: false });

    window.addEventListener("resize", function () {
      if (document.getElementById("editorScreen").hidden) return;
      self.tileCache = {};
      self.render();
    });
  };

  MAZE.Editor = Editor;
})();
