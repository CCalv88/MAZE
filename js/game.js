/* MAZE — first person play: your own movement, the camera, and turning what the world
   simulation reports into sights, sounds and messages.

   The world itself (monsters, items, doors, floors, damage, levels, spells, who wins)
   lives in MAZE.Sim, reached through a link: LocalLink runs the sim in this tab for solo
   play, NetLink talks to the server for online rooms. Either way this file reads the same
   snapshots and events. Everything with a position also has a floor, f. */
(function () {
  const MAZE = window.MAZE;
  const U = MAZE.util;
  const W = MAZE.W, T = MAZE.T;
  const P = MAZE.PLAYER;
  const L = MAZE.Level;

  // ------------------------------------------------------------- links --
  function LocalLink(sim, seat) {
    this.sim = sim;
    this.seat = seat;
    this.smooth = false;
    this.online = false;
  }
  LocalLink.prototype.tick = function (dt, input) {
    const out = [];
    if (!this.sim.move(this.seat, input)) {
      const p = this.sim.player(this.seat);
      out.push({ correct: { x: p.x, y: p.y, f: p.f, ep: p.epoch } });
    }
    this.sim.step(dt);
    out.push({ ev: this.sim.drain(), snap: this.sim.snapshot(), me: this.sim.privateState(this.seat) });
    return out;
  };
  LocalLink.prototype.attack = function () { this.sim.attack(this.seat); };
  LocalLink.prototype.openDoor = function (tx, ty) { this.sim.openDoor(this.seat, tx, ty); };
  LocalLink.prototype.ping = function (x, y) { this.sim.ping(this.seat, x, y); };
  LocalLink.prototype.climb = function () { this.sim.climb(this.seat); };
  LocalLink.prototype.allocate = function (k) { this.sim.allocate(this.seat, k); };
  LocalLink.prototype.learn = function (sp) { this.sim.learn(this.seat, sp); };
  LocalLink.prototype.drop = function (what) { this.sim.drop(this.seat, what); };
  // a solo run is paused while the character sheet is open, so apply its changes at once
  LocalLink.prototype.flush = function () { return [{ ev: this.sim.drain(), me: this.sim.privateState(this.seat) }]; };
  LocalLink.prototype.close = function () {};

  // Online: send where we are twenty times a second, collect whatever the server sent.
  // spectator: the host watching the match; it has no body, so it never sends moves
  function NetLink(net, seat, spectator) {
    this.net = net;
    this.seat = seat;
    this.smooth = true;
    this.online = true;
    this.spectator = !!spectator;
    this.inbox = [];
    this.sendT = 0;
    this.last = null;
    const self = this;
    this._off = [
      net.on("snap", function (m) { self.inbox.push({ ev: m.ev, snap: m.s, me: m.me }); }),
      net.on("correct", function (m) { self.inbox.push({ correct: m }); })
    ];
  }
  NetLink.prototype.tick = function (dt, input) {
    this.last = input;
    this.sendT -= dt;
    if (this.sendT <= 0) { this.sendT = 0.05; this.sendPos(); }
    const out = this.inbox;
    this.inbox = [];
    return out;
  };
  NetLink.prototype.sendPos = function () {
    const i = this.last;
    if (!i || this.spectator) return;
    this.net.send({ t: "pos", x: r3(i.x), y: r3(i.y), ang: r3(i.ang), pitch: r3(i.pitch), blk: i.blk, use: i.use, w: i.w, ep: i.ep, f: i.f, sp: i.sp || undefined });
  };
  // the server resolves a swing with the facing it last heard, so bring it up to date first
  NetLink.prototype.attack = function () { this.sendPos(); this.net.send({ t: "atk" }); };
  NetLink.prototype.openDoor = function (tx, ty) { this.sendPos(); this.net.send({ t: "door", x: tx, y: ty }); };
  NetLink.prototype.ping = function (x, y) { this.net.send({ t: "ping", x: r3(x), y: r3(y) }); };
  NetLink.prototype.climb = function () { this.sendPos(); this.net.send({ t: "climb" }); };
  NetLink.prototype.allocate = function (k) { this.net.send({ t: "stat", k: k }); };
  NetLink.prototype.learn = function (sp) { this.net.send({ t: "learn", sp: sp }); };
  NetLink.prototype.drop = function (what) { this.sendPos(); this.net.send({ t: "drop", what: what }); };
  NetLink.prototype.flush = function () { return []; };
  NetLink.prototype.close = function () { this._off.forEach(function (off) { off(); }); };
  function r3(v) { return Math.round(v * 1000) / 1000; }

  MAZE.LocalLink = LocalLink;
  MAZE.NetLink = NetLink;

  // -------------------------------------------------------------- game --
  function Game(viewCanvas, hudCanvas, opts) {
    this.view = viewCanvas;
    this.renderer = new MAZE.Renderer(viewCanvas);
    this.hud = new MAZE.Hud(hudCanvas);
    this.opts = opts || {};
    this.running = false;
    this.paused = true;
    this.keys = Object.create(null);
    this.sensitivity = 1;
    this.bigMap = false;
    this.messages = [];
    this.particles = [];
    this._renderList = [];
    this._bound = false;
    this.handleResize();
  }

  // ------------------------------------------------------------- setup --
  // full: MAZE.Sim#fullState(), seat: which player is us, link: Local or Net
  Game.prototype.load = function (full, seat, link) {
    if (this.link && this.link !== link) this.link.close();
    this.link = link;
    this.seat = seat;
    this.mode = full.mode;
    this.online = !!link.online;
    this.spectator = !!link.spectator;
    this.viewMode = "map";          // spectators: "map" (overhead) or "pov" (a player's eyes)
    this.specFloor = 0;             // spectators: which floor the overhead map shows
    this.matchTime = full.time || 0;
    this.level = { name: full.name };
    this.cols = full.cols; this.rows = full.rows; this.floors = full.floors || 1;
    this.plane = this.cols * this.rows;
    this.walls = Uint8Array.from(full.walls);
    this.stairs = new Uint8Array(this.walls.length);
    for (const s of full.stairs || []) this.stairs[s[0]] = s[1];
    this.secretFound = new Uint8Array(this.walls.length);
    this.seen = new Uint8Array(this.walls.length);
    this.time = 0;
    this.freeze = full.freeze || 0;
    this.messages.length = 0;
    this.particles.length = 0;
    this.enemies = [];
    this.blobMap = new Map();
    this.arrows = [];
    this.arrowMap = new Map();
    this.items = [];
    this.itemMap = new Map();
    this.others = [];
    this.otherMap = new Map();
    this.pings = [];
    this.prompt = "";
    this.ended = false;
    this.bigMap = false;
    this.spectate = -1;
    this.totalTreasure = full.totalTreasure || 0;
    this.stats = { time: 0, kills: 0, frags: 0, deaths: 0, score: 0, treasure: 0, secrets: 0 };

    // custom monsters travel with the level; draw their sprites now
    this.defs = { monsters: (full.monsters || []).map(L.cleanMonster) };
    for (const m of this.defs.monsters) MAZE.sprites.monster(m);

    // secret walls mimic whichever style dominates the level
    const tally = {};
    for (let i = 0; i < this.walls.length; i++) {
      const t = this.walls[i];
      if (t && t !== W.SECRET && MAZE.WALLS[t] && MAZE.WALLS[t].opaque && t !== W.DOOR && t !== W.GLASS)
        tally[t] = (tally[t] || 0) + 1;
    }
    let bestT = W.BRICK, bestN = -1;
    for (const k in tally) if (tally[k] > bestN) { bestN = tally[k]; bestT = +k; }
    this.secretTex = MAZE.WALLS[bestT].tex;

    for (const it of full.items) this.addItem(it[0], it[1], it[2], it[3], it[4]);
    const fin = MAZE.THINGS[T.FINISH];
    this.exit = full.exit ? { x: full.exit.cx + 0.5, y: full.exit.cy + 0.5, cx: full.exit.cx, cy: full.exit.cy, f: full.exit.f || 0, sprite: "finish", frame: 0, scale: fin.scale, zbase: fin.zbase, t: 0, flash: 0 } : null;
    this.buildFloorMarks();

    let me = null;
    for (const pl of full.players) {
      if (pl.seat === seat) { me = pl; continue; }
      const v = new MAZE.PlayerView(pl.seat, pl.name);
      v.apply([pl.seat, pl.x, pl.y, pl.ang, pl.pitch, pl.hp, (pl.dead ? 1 : 0) | (pl.escaped ? 2 : 0) | (pl.away ? 8 : 0), pl.w, pl.ep, 0, 0, pl.f || 0, pl.level || 1, pl.maxHp || P.maxHp], performance.now(), false);
      this.others.push(v);
      this.otherMap.set(pl.seat, v);
    }
    // a spectator has no body: treat them as already out of the maze, watching
    if (this.spectator) me = { x: full.cols / 2, y: full.rows / 2, f: 0, ang: 0, hp: P.maxHp, ep: 1, escaped: true };
    me = me || { x: 1.5, y: 1.5, f: 0, ang: 0, hp: P.maxHp, ep: 1 };

    this.player = {
      x: me.x, y: me.y, f: me.f || 0, ang: me.ang, pitch: 0,
      hp: me.hp, maxHp: me.maxHp || P.maxHp, mana: P.baseMana, maxMana: P.baseMana,
      stamina: P.maxStamina, winded: false,
      weapon: "fist", weapons: { fist: true },
      has: { key: false, shield: false, boots: false, torch: false },
      arrows: 0,
      level: me.level || 1, xp: 0, xpNext: MAZE.xpFor(1), points: 0, stats: { atk: 0, spd: 0, def: 0, vit: 0, mag: 0 },
      spells: [], spell: null, scrolls: [], poison: 0, slow: 0, ward: 0, speed: 1,
      swingT: 0, swingDur: 0.3, atkCd: 0, castT: 0,
      blocking: false, blockAmt: 0,
      hurtFlash: 0, dead: !!me.dead, escaped: !!me.escaped, epoch: me.ep || 1, respawn: 0,
      bob: 0, bobView: 0, bobPhase: 0, swayX: 0, swayY: 0,
      stepDist: 0, moving: false, lookSway: 0, deadTilt: 0,
      hitMarks: []          // recent hits, for the directional indicator
    };
    if (this.player.escaped) this.nextSpectate(1);

    this.light = { dist: 8, ambient: 0.075 };
    if (this.spectator) {
      this.seen.fill(2);            // the maze's maker knows every corner of it
      this.message("Spectating. Tab: overhead / player view · 1-4 or click: pick a player" + (this.floors > 1 ? " · PgUp/PgDn: floor" : "") + ".", "#4fd6c8");
      return this;
    }
    this.markSeen(Math.floor(this.player.x), Math.floor(this.player.y), 2, this.player.f);
    this.message("Find the exit portal" + (this.floors > 1 ? " — it may be on another floor." : "."), "#4fd6c8");
    if (this.mode === "versus") this.message("Competitive: first one out wins. Weapons hurt players.", "#ff6a8a");
    else if (this.mode === "coop") this.message("Co-op: everyone gets out. Hold E over a fallen friend to revive.", "#6ee06e");
    if (this.totalTreasure) this.message(this.totalTreasure + " treasure hidden in here.", "#ffcf5a");
    return this;
  };

  // What the floor and ceiling look like per cell: the exit glow, stairwells and hatches
  // cut into the floor, and openings in the ceiling above every way up.
  Game.prototype.buildFloorMarks = function () {
    this.marks = []; this.ceilMarks = []; this.stairProps = [];
    for (let f = 0; f < this.floors; f++) { this.marks.push(new Uint8Array(this.plane)); this.ceilMarks.push(new Uint8Array(this.plane)); }
    if (this.exit) this.marks[this.exit.f][this.exit.cy * this.cols + this.exit.cx] = 1;
    for (let i = 0; i < this.stairs.length; i++) {
      const t = this.stairs[i];
      if (!t) continue;
      const f = (i / this.plane) | 0, r = i - f * this.plane;
      if (t === T.STAIRS_DOWN) this.marks[f][r] = 2;
      else if (t === T.LADDER_DOWN) this.marks[f][r] = 3;
      else {
        this.ceilMarks[f][r] = 1;
        const x = r % this.cols + 0.5, y = ((r / this.cols) | 0) + 0.5;
        this.stairProps.push({ x, y, f, sprite: t === T.STAIRS_UP ? "stairs_up" : "ladder_up", frame: 0, scale: 1.0, zbase: 0, flash: 0, stair: true });
      }
    }
  };

  Game.prototype.monsterDef = function (kind) { return L.monsterDef(this.defs, kind) || MAZE.THINGS[T.BLOB]; };

  Game.prototype.addItem = function (id, kind, x, y, f) {
    if (!MAZE.THINGS[kind] || this.itemMap.has(id)) return;
    const v = new MAZE.PickupView(id, kind, x, y, f);
    this.items.push(v);
    this.itemMap.set(id, v);
  };
  Game.prototype.removeItem = function (id) {
    const v = this.itemMap.get(id);
    if (!v) return null;
    this.itemMap.delete(id);
    this.items.splice(this.items.indexOf(v), 1);
    return v;
  };
  Game.prototype.nameOf = function (seat) {
    if (seat === this.seat) return "You";
    const o = this.otherMap.get(seat);
    return o ? o.name : "Player " + (seat + 1);
  };
  Game.prototype.colorOf = (seat) => MAZE.PLAYER_COLORS[seat] || "#dfe5f0";

  // --------------------------------------------------------- map tests --
  // f defaults to your own floor
  Game.prototype.floorWalls = function (f) { return this.walls.subarray(f * this.plane, (f + 1) * this.plane); };
  Game.prototype.tileAt = function (tx, ty, f) {
    if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return W.BRICK;
    return this.walls[(f == null ? this.player.f : f) * this.plane + ty * this.cols + tx];
  };
  Game.prototype.stairAt = function (tx, ty, f) {
    if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return 0;
    return this.stairs[(f == null ? this.player.f : f) * this.plane + ty * this.cols + tx];
  };

  // forAI: secret walls block monsters but not the player
  Game.prototype.solidTile = function (tx, ty, forAI, f) {
    const t = this.tileAt(tx, ty, f);
    if (t === W.EMPTY) return false;
    if (t === W.SECRET) return !!forAI;
    return true;
  };

  Game.prototype.solidAt = function (x, y, forAI, f) {
    return this.solidTile(Math.floor(x), Math.floor(y), forAI, f);
  };

  Game.prototype.boxBlocked = function (x, y, r, forAI, f) {
    const x0 = Math.floor(x - r), x1 = Math.floor(x + r);
    const y0 = Math.floor(y - r), y1 = Math.floor(y + r);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++)
        if (this.solidTile(tx, ty, forAI, f)) return true;
    return false;
  };

  // axis-separated so you slide along walls instead of sticking
  Game.prototype.moveCircle = function (ent, dx, dy, r, forAI) {
    if (dx && !this.boxBlocked(ent.x + dx, ent.y, r, forAI, ent.f)) ent.x += dx;
    if (dy && !this.boxBlocked(ent.x, ent.y + dy, r, forAI, ent.f)) ent.y += dy;
  };

  // ------------------------------------------------------- presentation --
  Game.prototype.message = function (text, color) {
    this.messages.unshift({ text: text, t: 3.2, color: color });
    if (this.messages.length > 5) this.messages.pop();
  };

  // f: which floor it happens on (the camera's by default); float: magic sparks that drift
  Game.prototype.splat = function (x, y, z, color, count, power, f, float) {
    const col = typeof color === "string" ? hexToABGR(color) : color;
    const pw = power || 2.2;
    const floor = f == null ? this.camera().f : f;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * U.TAU;
      const sp = Math.random() * pw;
      this.particles.push(new MAZE.Particle(
        x, y, z,
        Math.cos(a) * sp, Math.sin(a) * sp, float ? (Math.random() - 0.3) * 0.8 : Math.random() * 2.4,
        float ? 0.3 + Math.random() * 0.35 : 0.5 + Math.random() * 0.7, 0.035 + Math.random() * 0.045, col, floor, float
      ));
    }
    if (this.particles.length > 600) this.particles.splice(0, this.particles.length - 600);
  };

  // sparks rising in a ring around someone, so effects on yourself are visible without
  // filling the camera
  Game.prototype.ring = function (x, y, color, count, f) {
    const col = hexToABGR(color);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * U.TAU + Math.random() * 0.3, r = 0.55 + Math.random() * 0.25;
      this.particles.push(new MAZE.Particle(x + Math.cos(a) * r, y + Math.sin(a) * r, 0.05 + Math.random() * 0.3,
        Math.cos(a) * 0.15, Math.sin(a) * 0.15, 0.9 + Math.random() * 0.6, 0.7 + Math.random() * 0.5, 0.03 + Math.random() * 0.03, col, f, true));
    }
  };

  // a line of sparks, for lightning and blinks
  Game.prototype.streak = function (x0, y0, x1, y1, z, color, f, density) {
    const len = U.dist(x0, y0, x1, y1), n = Math.max(2, Math.ceil(len / (density || 0.12)));
    for (let i = 0; i <= n; i++) {
      const t = i / n, j = (Math.random() - 0.5) * 0.12;
      this.splat(x0 + (x1 - x0) * t + j, y0 + (y1 - y0) * t - j, z + (Math.random() - 0.5) * 0.12, color, 1, 0.25, f, true);
    }
  };

  function hexToABGR(hex) {
    const h = hex.replace("#", "");
    return U.rgb(parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16));
  }

  // play a sound that happened at (x, y) on floor f: quieter with distance, muffled through floors
  Game.prototype.soundAt = function (name, x, y, range, f) {
    const c = this.camera();
    const d = U.dist(c.x, c.y, x, y) + (f != null && f !== c.f ? 8 : 0);
    const r = range || 12;
    if (d > r) return;
    MAZE.audio.play(name, Math.max(0.15, 1 - d / r));
  };

  Game.prototype.markSeen = function (tx, ty, level, f) {
    if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return;
    const i = f * this.plane + ty * this.cols + tx;
    if (this.seen[i] < level) this.seen[i] = level;
  };

  // walk a fan of rays and remember what they touch, for the minimap
  Game.prototype.updateVisibility = function () {
    const p = this.camera(), f = p.f, o = f * this.plane;
    const rays = 48;
    const range = this.light.dist;
    for (let r = 0; r < rays; r++) {
      const a = p.ang + (r / (rays - 1) - 0.5) * 1.35;
      const dx = Math.cos(a), dy = Math.sin(a);
      let x = p.x, y = p.y;
      for (let s = 0; s < range * 5; s++) {
        x += dx * 0.2; y += dy * 0.2;
        const tx = Math.floor(x), ty = Math.floor(y);
        if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) break;
        this.markSeen(tx, ty, 1, f);
        const t = this.walls[o + ty * this.cols + tx];
        if (t !== W.EMPTY && MAZE.WALLS[t] && MAZE.WALLS[t].opaque) break;
      }
    }
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        this.markSeen(Math.floor(p.x) + dx, Math.floor(p.y) + dy, 2, f);
  };

  // Where the eye is. Normally your own head; after escaping in co-op, or when
  // spectating, you watch another player.
  Game.prototype.camera = function () {
    const p = this.player;
    if ((p.escaped || this.spectator) && this.spectate >= 0) {
      const o = this.otherMap.get(this.spectate);
      if (o && o.visible()) {
        const c = this._cam || (this._cam = {});
        c.x = o.x; c.y = o.y; c.f = o.f || 0; c.ang = o.ang; c.pitch = o.pitch * 0.5; c.bob = 0; c.seat = o.seat;
        return c;
      }
    }
    const c = this._me || (this._me = {});
    c.x = p.x; c.y = p.y; c.f = p.f; c.ang = p.ang; c.bob = p.bob; c.seat = this.seat;
    c.pitch = p.dead ? p.pitch - p.deadTilt : p.pitch;
    return c;
  };

  Game.prototype.nextSpectate = function (dir) {
    const live = this.others.filter((o) => o.visible()).map((o) => o.seat).sort();
    if (!live.length) { this.spectate = -1; return; }
    const i = live.indexOf(this.spectate);
    this.spectate = live[(i + (dir || 1) + live.length) % live.length];
    const o = this.otherMap.get(this.spectate);
    if (o && this.spectator) this.specFloor = o.f || 0;
  };

  // spectator: look through this player's eyes
  Game.prototype.watch = function (seat) {
    const o = this.otherMap.get(seat);
    if (!o || !o.visible()) return false;
    this.spectate = seat;
    this.viewMode = "pov";
    this.specFloor = o.f || 0;
    return true;
  };

  // What the HUD shows as "you": yourself, or when spectating, the player being watched
  // (only what everyone can see of them: health, weapon, torch, shield, level).
  Game.prototype.viewPlayer = function () {
    if (!this.spectator) return this.player;
    const o = this.otherMap.get(this.spectate);
    const v = this._view || (this._view = { stamina: P.maxStamina, winded: false, arrows: 0, swingDur: 0.3, bob: 0, bobView: 0, swayX: 0, swayY: 0.2, hitMarks: [], has: {}, weapons: {}, spells: [], stats: {}, castT: 0 });
    if (!o) { v.hp = 0; v.maxHp = P.maxHp; v.dead = true; v.escaped = true; v.name = ""; return v; }
    v.hp = o.hp; v.maxHp = o.maxHp || P.maxHp; v.dead = o.dead; v.escaped = o.escaped; v.name = o.name; v.seat = o.seat; v.level = o.level || 1;
    v.weapon = o.weapon; v.swingT = o.swingT; v.castT = o.weapon === "magic" ? o.swingT : 0; v.blocking = o.blocking; v.blockAmt = o.blocking ? 1 : 0;
    v.hurtFlash = o.flash * 0.5; v.ang = o.ang; v.f = o.f; v.ward = o.ward ? 1 : 0; v.poison = o.poisoned ? 1 : 0; v.spell = o.spellShown || null;
    v.has.torch = o.torch; v.has.shield = o.hasShield; v.has.key = false; v.has.boots = false;
    return v;
  };

  Game.prototype.renderables = function () {
    const list = this._renderList;
    const cam = this.camera(), f = cam.f;
    list.length = 0;
    for (let i = 0; i < this.items.length; i++) if (this.items[i].f === f) list.push(this.items[i]);
    for (let i = 0; i < this.enemies.length; i++) if (this.enemies[i].f === f) list.push(this.enemies[i]);
    for (let i = 0; i < this.arrows.length; i++) if (this.arrows[i].f === f) list.push(this.arrows[i]);
    for (let i = 0; i < this.stairProps.length; i++) if (this.stairProps[i].f === f) list.push(this.stairProps[i]);
    for (let i = 0; i < this.others.length; i++) {
      const o = this.others[i];
      o._screen = null;
      if (!o.visible() || o.seat === cam.seat || (o.f || 0) !== f) continue;
      o.face(cam.x, cam.y);
      list.push(o);
    }
    if (this.exit && this.exit.f === f) list.push(this.exit);
    return list;
  };

  // -------------------------------------------------------------- loop --
  Game.prototype.start = function () {
    if (this.running) return;
    this.running = true;
    this.bind();
    this.last = performance.now();
    const self = this;
    this._frame = function (ts) {
      if (!self.running) return;
      const dt = Math.min(0.05, (ts - self.last) / 1000);
      self.last = ts;
      // online the world does not wait for you, so keep listening while paused
      if (!self.ended && (!self.paused || self.online)) self.update(dt);
      // the overhead map is all HUD, so the 3D view can rest while it is up
      if (!(self.spectator && self.viewMode === "map")) {
        const t0 = performance.now();
        self.renderer.render(self);
        self.renderer.adapt(performance.now() - t0);
      }
      self.hud.draw(self);
      requestAnimationFrame(self._frame);
    };
    requestAnimationFrame(this._frame);
  };

  Game.prototype.stop = function () {
    this.running = false;
    this.unbind();
    MAZE.audio.stopAmbience();
  };

  Game.prototype.update = function (dt) {
    this.time += dt;
    const p = this.player;

    for (let i = this.messages.length - 1; i >= 0; i--) {
      this.messages[i].t -= dt;
      if (this.messages[i].t <= 0) this.messages.splice(i, 1);
    }
    for (let i = this.pings.length - 1; i >= 0; i--) {
      this.pings[i].t -= dt;
      if (this.pings[i].t <= 0) this.pings.splice(i, 1);
    }

    this.updatePlayer(dt);

    const batches = this.link.tick(dt, this.inputState());
    for (let i = 0; i < batches.length; i++) this.applyBatch(batches[i]);
    if (this.ended) return;

    const now = performance.now(), smooth = this.link.smooth;
    for (let i = 0; i < this.enemies.length; i++) this.enemies[i].update(dt, now, smooth);
    for (let i = 0; i < this.arrows.length; i++) this.arrows[i].update(dt, now, smooth, this);
    for (let i = 0; i < this.others.length; i++) this.others[i].update(dt, now, smooth);
    for (let i = 0; i < this.items.length; i++) this.items[i].update(dt);
    for (let i = this.particles.length - 1; i >= 0; i--) {
      this.particles[i].update(dt, this);
      if (this.particles[i].life <= 0) this.particles.splice(i, 1);
    }
    if (this.exit) {
      this.exit.t += dt;
      this.exit.frame = ((this.exit.t * 10) | 0) % 6;
    }
    if ((p.escaped || this.spectator) && (this.spectate < 0 || !this.otherMap.get(this.spectate) || !this.otherMap.get(this.spectate).visible())) {
      this.nextSpectate(1);
      if (this.spectate < 0 && this.spectator) this.viewMode = "map";   // nobody left inside to watch
    }
    // a warded player shimmers blue
    for (const o of this.others) if (o.ward && o.visible() && Math.random() < dt * 8) this.splat(o.x, o.y, 0.3 + Math.random() * 0.4, "#5aa8ff", 1, 0.5, o.f, true);
    if (p.ward > 0 && !this.spectator && Math.random() < dt * 5) this.splat(p.x + Math.cos(p.ang) * 0.6, p.y + Math.sin(p.ang) * 0.6, 0.35, "#5aa8ff", 1, 0.4, p.f, true);

    this.separateBodies();
    if (!this.spectator) this.updateVisibility();

    // torchlight flicker, for whoever's eyes we are looking through
    const torch = this.viewPlayer().has.torch;
    const base = torch ? 14.5 : 8;
    const flick = torch ? 1 + Math.sin(this.time * 11) * 0.025 + Math.sin(this.time * 4.3) * 0.02 : 1;
    this.light.dist = base * flick;
  };

  Game.prototype.inputState = function () {
    const p = this.player, k = this.keys;
    return {
      x: p.x, y: p.y, f: p.f, ang: p.ang, pitch: p.pitch, ep: p.epoch,
      blk: p.blocking ? 1 : 0, use: k.use && !this.paused ? 1 : 0, w: MAZE.Sim.WEAPON_IDX[p.weapon], sp: p.spell
    };
  };

  // ------------------------------------------------------ world updates --
  Game.prototype.applyBatch = function (b) {
    if (b.correct) {
      const p = this.player;
      if (b.correct.ep === p.epoch) { p.x = b.correct.x; p.y = b.correct.y; if (b.correct.f != null) p.f = b.correct.f; }
    }
    if (b.ev) for (let i = 0; i < b.ev.length; i++) { this.onEvent(b.ev[i]); if (this.ended) return; }
    if (b.snap) this.applySnap(b.snap);
    if (b.me) this.applyMe(b.me);
  };

  Game.prototype.applySnap = function (s) {
    const now = performance.now(), smooth = this.link.smooth;
    this.freeze = s.freeze || 0;
    this.matchTime = s.time || this.matchTime;

    const live = this._live || (this._live = new Set());
    live.clear();
    for (const row of s.b) {
      live.add(row[0]);
      let v = this.blobMap.get(row[0]);
      if (!v) {
        v = new MAZE.BlobView(row[0], row[1], this.monsterDef(row[1]));
        v.x = row[2]; v.y = row[3]; v.f = row[7];
        this.blobMap.set(row[0], v);
        this.enemies.push(v);
      }
      v.apply(row, now, smooth);
    }
    if (this.blobMap.size !== live.size) {
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];
        if (!live.has(e.id)) { this.blobMap.delete(e.id); this.enemies.splice(i, 1); }
      }
    }

    live.clear();
    for (const row of s.a) {
      live.add(row[0]);
      let v = this.arrowMap.get(row[0]);
      if (!v) { v = new MAZE.ArrowView(row[0], row[7]); this.arrowMap.set(row[0], v); this.arrows.push(v); }
      v.apply(row, now);
    }
    if (this.arrowMap.size !== live.size) {
      for (let i = this.arrows.length - 1; i >= 0; i--) {
        const a = this.arrows[i];
        if (!live.has(a.id)) { this.arrowMap.delete(a.id); this.arrows.splice(i, 1); }
      }
    }

    for (const row of s.p) {
      const seat = row[0];
      if (seat === this.seat) {
        const p = this.player, f = row[6];
        p.dead = !!(f & 1);
        p.escaped = !!(f & 2);
        p.shielded = !!(f & 32);
        continue;
      }
      let v = this.otherMap.get(seat);
      if (!v) {
        v = new MAZE.PlayerView(seat, (this.opts.names && this.opts.names[seat]) || null);
        this.otherMap.set(seat, v);
        this.others.push(v);
      }
      v.apply(row, now, smooth);
    }
  };

  // the private half of our own state: health, mana, level, what we carry, our score
  Game.prototype.applyMe = function (me) {
    const p = this.player;
    p.hp = me.hp; p.maxHp = me.maxHp;
    p.mana = me.mana; p.maxMana = me.maxMana;
    p.arrows = me.arrows;
    p.has = me.has;
    p.respawn = me.respawn;
    p.level = me.level; p.xp = me.xp; p.xpNext = me.xpNext; p.points = me.points; p.stats = me.stats;
    p.spells = me.spells; p.scrolls = me.scrolls; p.poison = me.poison; p.slow = me.slow; p.ward = me.ward; p.speed = me.speed || 1;
    if (!p.spell || p.spells.indexOf(p.spell) < 0) p.spell = me.spell || p.spells[0] || null;
    const owned = { fist: true };
    for (const w of me.weapons) owned[w] = true;
    p.weapons = owned;
    if (!owned[p.weapon]) p.weapon = me.weapon && owned[me.weapon] ? me.weapon : "fist";
    this.stats = me.tally;
    if (this.opts.onMe) this.opts.onMe(this);
  };

  const PICK_TEXT = {};
  PICK_TEXT[T.SWORD] = ["Sword acquired — press 2", "#d8dde8", "weapon"];
  PICK_TEXT[T.BOW] = ["Bow acquired — press 3", "#c89a5a", "weapon"];
  PICK_TEXT[T.SHIELD] = ["Shield acquired — hold right-click", "#9fb4d8", "weapon"];
  PICK_TEXT[T.ARROWS] = ["Arrows", "#b9884f", "pickup"];
  PICK_TEXT[T.POTION] = ["+45 health", "#ff5a7a", "potion"];
  PICK_TEXT[T.MANA] = ["+40 mana", "#5a7aff", "potion"];
  PICK_TEXT[T.KEY] = ["Key acquired.", "#ffd34a", "pickup"];
  PICK_TEXT[T.BOOTS] = ["Swift boots — you feel lighter.", "#8ad8ff", "pickup"];
  PICK_TEXT[T.TORCH] = ["Torch lit — you can see much further.", "#ffa030", "pickup"];

  Game.prototype.onEvent = function (ev) {
    const p = this.player, me = this.seat;
    const other = ev.s !== undefined && ev.s !== me ? this.otherMap.get(ev.s) : null;
    switch (ev.e) {
      case "swing":
        if (other) { other.swingT = 0.3; this.soundAt("swing", other.x, other.y, 9, other.f); }
        break;
      case "shoot":
        if (other) { other.swingT = 0.3; this.soundAt("bow", other.x, other.y, 12, other.f); }
        break;
      case "connect":
        if (ev.s === me) { MAZE.audio.play(ev.w === 1 ? "swordHit" : "punch"); p.lookSway = 0.04; }
        else if (other) this.soundAt(ev.w === 1 ? "swordHit" : "punch", other.x, other.y, 10, other.f);
        break;
      case "blob": {
        const def = this.monsterDef(ev.k);
        const v = this.blobMap.get(ev.b);
        const bx = v ? v.x : ev.x, by = v ? v.y : ev.y, scale = def.scale * (v ? v.sizeMul || 1 : 1);
        this.splat(bx, by, def.zbase + scale * 0.5, def.body, 9, 2.2, ev.f);
        if (ev.dead) {
          if (ev.boom) {
            this.splat(bx, by, 0.4, "#ffb040", 40, 4, ev.f, true);
            this.splat(bx, by, 0.3, "#ff4a1a", 30, 3.4, ev.f);
            this.soundAt("boom", bx, by, 20, ev.f);
          }
          this.splat(bx, by, def.zbase + scale * 0.4, def.body2, 26, 3.2, ev.f);
          this.soundAt("dieBlob", bx, by, 16, ev.f);
          if (ev.s === me) this.message((def.custom ? def.name : "Blob") + " defeated  +" + def.xp + " XP", "#dfe5f0");
          if (v) { this.blobMap.delete(ev.b); this.enemies.splice(this.enemies.indexOf(v), 1); }
        } else {
          if (v) v.flash = 0.75;
          this.soundAt("hurtBlob", bx, by, 14, ev.f);
        }
        break;
      }
      case "split": {
        const def = this.monsterDef(ev.k);
        this.splat(ev.x, ev.y, 0.3, def.body, 20, 2.6, ev.f);
        if (ev.f === this.camera().f && U.dist(ev.x, ev.y, p.x, p.y) < 8) this.message(def.name + " split in two!", "#ffb454");
        break;
      }
      case "spit": {
        const v = this.blobMap.get(ev.b);
        if (v) this.soundAt("spit", v.x, v.y, 12, v.f);
        break;
      }
      case "mclimb": {
        const v = this.blobMap.get(ev.b);
        if (v && ev.f === p.f && !this.spectator) this.message("Something is coming up the stairs…", "#ff9a9a");
        break;
      }
      case "hurt":
        if (ev.s === me) this.hurtMe(ev);
        else if (other) {
          other.flash = 0.8;
          this.splat(other.x, other.y, 0.45, ev.ward ? "#5aa8ff" : "#ff5a5a", 7, 1.6, other.f);
          this.soundAt(ev.blk ? "block" : "hurt", other.x, other.y, 10, other.f);
        }
        break;
      case "die": {
        this.splat(ev.x, ev.y, 0.4, "#ff5a5a", 30, 2.4, ev.f);
        if (ev.s === me) {
          p.dead = true;
          p.swingT = 0;
          if (this.mode === "solo") break;
          MAZE.audio.play("lose");
          if (ev.by >= 0 && ev.by !== me) this.message(this.nameOf(ev.by) + " struck you down.", "#ff5a5a");
          else this.message("The monsters got you.", "#ff5a5a");
          if (this.mode === "coop") this.message("Hold on — a teammate can revive you.", "#6ee06e");
        } else {
          if (ev.by === me) { this.message("You defeated " + this.nameOf(ev.s) + "  +400", "#ffb454"); MAZE.audio.play("secret"); }
          else if (ev.by >= 0) this.message(this.nameOf(ev.by) + " defeated " + this.nameOf(ev.s) + ".", "#ff9a9a");
          else this.message(this.nameOf(ev.s) + (this.mode === "coop" ? " is down! Hold E beside them to revive." : " was eaten by monsters."), this.mode === "coop" ? "#ff9a9a" : "#dfe5f0");
          if (other) this.soundAt("hurt", other.x, other.y, 14, other.f);
        }
        break;
      }
      case "respawn":
        if (ev.s === me) {
          p.x = ev.x; p.y = ev.y; p.f = ev.f || 0; p.ang = ev.ang; p.pitch = 0; p.deadTilt = 0;
          p.dead = false; p.epoch = ev.ep; p.hurtFlash = 0; p.hitMarks.length = 0;
          MAZE.audio.play("potion");
          this.message("Back on your feet.", "#6ee06e");
        } else if (other) {
          other.motion.q.length = 0;
          other.x = ev.x; other.y = ev.y; other.f = ev.f || 0; other.ang = ev.ang;
        }
        break;
      case "revive":
        if (ev.s === me) this.message(this.nameOf(ev.by) + " pulled you back up!", "#6ee06e");
        else if (ev.by === me) { this.message("You revived " + this.nameOf(ev.s) + "  +200", "#6ee06e"); MAZE.audio.play("potion"); }
        else this.message(this.nameOf(ev.by) + " revived " + this.nameOf(ev.s) + ".", "#6ee06e");
        break;
      case "pick": {
        const it = this.removeItem(ev.id);
        const def = MAZE.THINGS[ev.k];
        if (it) this.splat(it.x, it.y, it.baseZ + 0.15, def.mini, 12, 1.5, it.f);
        if (ev.s === me) this.pickedUp(ev.k);
        else if (ev.k === T.KEY) this.message(this.nameOf(ev.s) + (this.mode === "coop" ? " found the key — it works for all of you." : " has the key."), "#ffd34a");
        else if (it) this.soundAt("pickup", it.x, it.y, 8, it.f);
        break;
      }
      case "drop":
        this.addItem(ev.id, ev.k, ev.x, ev.y, ev.f);
        if (ev.s === me) { MAZE.audio.play("drop"); this.message("Dropped " + MAZE.THINGS[ev.k].name.replace(/^Scroll: /, "the scroll of ") + ".", "#dfe5f0"); }
        else if (ev.s >= 0) {
          this.soundAt("drop", ev.x, ev.y, 8, ev.f);
          if (this.mode === "coop") this.message(this.nameOf(ev.s) + " left you " + MAZE.THINGS[ev.k].name.replace(/^Scroll: /, "a scroll of ") + ".", this.colorOf(ev.s));
        }
        break;
      case "door": {
        this.walls[(ev.f || 0) * this.plane + ev.y * this.cols + ev.x] = W.EMPTY;
        this.wallRev = (this.wallRev || 0) + 1;       // the overhead map redraws its walls
        this.soundAt("door", ev.x + 0.5, ev.y + 0.5, 30, ev.f);
        this.splat(ev.x + 0.5, ev.y + 0.5, 0.5, "#c99b4a", 16, 1.8, ev.f);
        this.message(ev.s === me ? "The door swings open." : this.nameOf(ev.s) + " unlocked a door.", "#c99b4a");
        break;
      }
      case "locked":
        if (ev.s === me) { MAZE.audio.play("locked"); this.message("It will not budge without the key.", "#ffb454"); }
        break;
      case "secret":
        if (ev.s === me) {
          this.secretFound[(ev.f || 0) * this.plane + ev.y * this.cols + ev.x] = 1;
          MAZE.audio.play("secret");
          this.message("Secret passage found!  +300", "#c06bd6");
          this.splat(ev.x + 0.5, ev.y + 0.5, 0.5, "#c06bd6", 22, 2.6, ev.f);
        }
        break;
      case "climb":
        if (ev.s === me) {
          p.f = ev.f; p.x = ev.x; p.y = ev.y; p.epoch = ev.ep;
          MAZE.audio.play(ev.ladder ? "ladder" : "stairs");
          this.message((ev.up ? "Up to floor " : "Down to floor ") + (ev.f + 1) + " of " + this.floors + ".", "#d6c7a1");
          this.markSeen(Math.floor(p.x), Math.floor(p.y), 2, p.f);
        } else if (other) {
          other.motion.q.length = 0;
          other.f = ev.f; other.x = ev.x; other.y = ev.y;
          if (this.spectator && this.spectate === ev.s) this.specFloor = ev.f;
          if (ev.f === this.camera().f) this.soundAt(ev.ladder ? "ladder" : "stairs", ev.x, ev.y, 8, ev.f);
        }
        break;
      case "escape":
        if (ev.s === me) {
          p.escaped = true;
          if (this.mode === "coop") {
            MAZE.audio.play("win");
            this.message("You escaped! Watching your team — click to switch.", "#4fd6c8");
            this.nextSpectate(1);
          }
        } else {
          this.message(this.nameOf(ev.s) + " escaped!", "#4fd6c8");
          if (this.spectate === ev.s) this.nextSpectate(1);
        }
        break;
      case "thunk": {
        const col = [ev.hit ? 0xff5a5aff : 0xff8fb4c8, 0xff1a6aff, 0xffffe0a0, 0xff4ae08b][ev.k || 0];
        this.splat(ev.x, ev.y, 0.42, col, ev.k === 1 ? 26 : 8, ev.k === 1 ? 3 : 1.4, ev.f, ev.k === 1 || ev.k === 2);
        this.soundAt(ev.k === 1 ? "boom" : ev.k === 2 ? "frost" : "arrowHit", ev.x, ev.y, ev.k === 1 ? 16 : 10, ev.f);
        break;
      }
      case "growl": {
        const v = this.blobMap.get(ev.b);
        if (v) this.soundAt("growl", v.x, v.y, 9, v.f);
        break;
      }
      case "windup": {
        const v = this.blobMap.get(ev.b);
        if (v) this.soundAt("windup", v.x, v.y, 7, v.f);
        break;
      }
      // ---- magic ----
      case "cast": {
        const sp = MAZE.SPELLS[ev.sp];
        if (ev.s === me) p.spellFlash = 0.35;
        else if (other) { other.swingT = 0.35; other.spellShown = ev.sp; this.soundAt("cast", other.x, other.y, 12, other.f); if (sp) this.splat(other.x, other.y, 0.5, sp.color, 10, 0.8, other.f, true); }
        break;
      }
      case "heal":
        for (const s of ev.who) {
          const o = s === me ? p : this.otherMap.get(s);
          if (o) this.ring(o.x, o.y, "#6ee06e", 22, ev.f);
          if (s === me) { MAZE.audio.play("heal"); if (ev.s !== me) this.message(this.nameOf(ev.s) + " healed you.", "#6ee06e"); }
        }
        break;
      case "ward": {
        const o = ev.s === me ? p : other;
        if (o) this.ring(o.x, o.y, "#5aa8ff", 26, ev.f);
        if (ev.s === me) { MAZE.audio.play("ward"); this.message("Ward up — damage halved for 6 seconds.", "#5aa8ff"); }
        break;
      }
      case "bolt": {
        for (let k = 1; k < ev.pts.length; k++) {
          const a = ev.pts[k - 1], b = ev.pts[k];
          this.streak(a[0], a[1], b[0], b[1], 0.45, k % 2 ? "#e8e0ff" : "#c9b8ff", ev.f, 0.09);
        }
        this.boltFlash = 0.18;
        this.soundAt("zap", ev.pts[0][0], ev.pts[0][1], 16, ev.f);
        break;
      }
      case "blink":
        this.streak(ev.fx, ev.fy, ev.x, ev.y, 0.5, "#c06bd6", ev.f, 0.1);
        this.splat(ev.x, ev.y, 0.5, "#e0a6f5", 18, 1.4, ev.f, true);
        if (ev.s === me) { p.x = ev.x; p.y = ev.y; p.epoch = ev.ep; MAZE.audio.play("blink"); }
        else if (other) { other.motion.q.length = 0; other.x = ev.x; other.y = ev.y; this.soundAt("blink", ev.x, ev.y, 12, ev.f); }
        break;
      case "nomana":
        if (ev.s === me) { MAZE.audio.play("noAmmo"); this.message("Not enough mana.", "#5a7aff"); }
        break;
      case "learn":
        if (ev.s === me) {
          const sp = MAZE.SPELLS[ev.sp];
          MAZE.audio.play("learn");
          this.message("You learned " + sp.name + "! Press 4 for magic, R to switch spells.", sp.color);
          if (!p.spell) p.spell = ev.sp;
        } else if (this.mode === "coop") this.message(this.nameOf(ev.s) + " learned " + MAZE.SPELLS[ev.sp].name + ".", "#b07cff");
        break;
      case "nolearn":
        if (ev.s === me) {
          MAZE.audio.play("locked");
          this.message(ev.why === "mana" ? "Too advanced: you need " + ev.need + " points in Mana to learn " + MAZE.SPELLS[ev.sp].name + "." : "You already know " + MAZE.SPELLS[ev.sp].name + ".", "#b07cff");
        }
        break;
      case "levelup":
        if (ev.s === me) {
          MAZE.audio.play("levelup");
          this.levelFlash = 1.6;
          this.message("LEVEL " + ev.lv + "!  Press C to spend your stat point.", "#ffd34a");
          this.ring(p.x, p.y, "#ffd34a", 30, p.f);
        } else if (other) {
          this.ring(other.x, other.y, "#ffd34a", 24, other.f);
          this.message(this.nameOf(ev.s) + " reached level " + ev.lv + ".", "#ffd34a");
        }
        break;
      case "stat":
        if (ev.s === me) MAZE.audio.play("weapon");
        break;
      case "ping":
        this.pings.push({ x: ev.x, y: ev.y, f: ev.f || 0, seat: ev.s, t: 5 });
        if (ev.s !== me) this.message(this.nameOf(ev.s) + ": over here!" + (this.floors > 1 ? " (floor " + ((ev.f || 0) + 1) + ")" : ""), this.colorOf(ev.s));
        MAZE.audio.play("ping");
        break;
      case "away":
        if (ev.s !== me) this.message(this.nameOf(ev.s) + (ev.away ? " lost connection." : " is back."), "#8a93a7");
        break;
      case "end":
        this.ended = true;
        MAZE.audio.stopAmbience();
        MAZE.audio.play(this.iWon(ev.result) ? "win" : "lose");
        if (this.opts.onEnd) this.opts.onEnd(ev.result, this);
        break;
    }
  };

  Game.prototype.iWon = function (r) {
    if (this.spectator) return r.outcome !== "wiped";
    if (r.mode === "versus") return r.winner === this.seat;
    return r.outcome === "escaped";
  };

  Game.prototype.pickedUp = function (kind) {
    const p = this.player, def = MAZE.THINGS[kind];
    if (kind === T.TREASURE) {
      MAZE.audio.play("pickup");
      this.message("Treasure  +250", "#ffcf5a");
      return;
    }
    if (def && def.spell) {
      const sp = MAZE.SPELLS[def.spell];
      MAZE.audio.play("scroll");
      this.message("Scroll of " + sp.name + " — press C to learn it.", sp.color);
      return;
    }
    // mirror the sim's auto-equip so the weapon comes up without waiting a round trip
    if (kind === T.SWORD) { p.weapons.sword = true; p.weapon = "sword"; }
    if (kind === T.BOW) { p.weapons.bow = true; if (p.weapon === "fist") p.weapon = "bow"; }
    const t = PICK_TEXT[kind];
    if (t) { MAZE.audio.play(t[2]); this.message(t[0], t[1]); }
  };

  Game.prototype.hurtMe = function (ev) {
    const p = this.player;
    MAZE.audio.play(ev.blk ? "block" : ev.ward ? "ward" : "hurt");
    p.hp = ev.hp;
    p.hurtFlash = Math.min(1.4, p.hurtFlash + ev.dmg / 30);
    p.hitMarks.push({ ang: Math.atan2(-ev.dy, -ev.dx), t: 1 });   // where the hit came from
    if (p.hitMarks.length > 6) p.hitMarks.shift();
    this.moveCircle(p, ev.dx * ev.push, ev.dy * ev.push, P.radius, false);
  };

  // ------------------------------------------------------------ player --
  Game.prototype.updatePlayer = function (dt) {
    const p = this.player;
    const k = this.paused ? {} : this.keys;

    if (p.hurtFlash > 0) p.hurtFlash = Math.max(0, p.hurtFlash - dt * 1.8);
    if (this.levelFlash > 0) this.levelFlash = Math.max(0, this.levelFlash - dt);
    if (this.boltFlash > 0) this.boltFlash = Math.max(0, this.boltFlash - dt);
    if (p.spellFlash > 0) p.spellFlash = Math.max(0, p.spellFlash - dt);
    for (let i = p.hitMarks.length - 1; i >= 0; i--) {
      p.hitMarks[i].t -= dt * 0.9;
      if (p.hitMarks[i].t <= 0) p.hitMarks.splice(i, 1);
    }
    if (p.atkCd > 0) p.atkCd -= dt;
    if (p.swingT > 0) p.swingT = Math.max(0, p.swingT - dt);
    if (p.castT > 0) p.castT = Math.max(0, p.castT - dt);

    if (p.dead) {
      p.deadTilt = Math.min(0.35, p.deadTilt + dt * 0.6);
      p.blocking = false;
      p.blockAmt = 0;
      this.prompt = "";
      return;
    }
    if (p.escaped) { p.blocking = false; this.prompt = ""; return; }

    p.blocking = !!(k.block && p.has.shield);
    p.blockAmt = U.lerp(p.blockAmt, p.blocking ? 1 : 0, Math.min(1, dt * 12));

    let fwd = (k.w ? 1 : 0) - (k.s ? 1 : 0);
    let str = (k.d ? 1 : 0) - (k.a ? 1 : 0);
    const mag = Math.hypot(fwd, str);
    if (mag > 1) { fwd /= mag; str /= mag; }

    // boots, Speed points and being chilled all come from the sim as one multiplier
    let speed = P.speed * (p.speed || 1);
    if (p.blocking) speed *= P.blockMul;

    const wantSprint = k.sprint && mag > 0 && !p.blocking && !p.winded;
    if (wantSprint && p.stamina > 0) {
      speed *= P.sprintMul;
      p.stamina -= P.staminaDrain * dt;
      if (p.stamina <= 0) { p.stamina = 0; p.winded = true; }
    } else {
      p.stamina = Math.min(P.maxStamina, p.stamina + P.staminaRegen * dt);
      if (p.winded && p.stamina > 38) p.winded = false;
    }

    if (k.turnL) p.ang -= 2.6 * dt;
    if (k.turnR) p.ang += 2.6 * dt;

    const dirX = Math.cos(p.ang), dirY = Math.sin(p.ang);
    const dx = (dirX * fwd - dirY * str) * speed * dt;
    const dy = (dirY * fwd + dirX * str) * speed * dt;

    const beforeX = p.x, beforeY = p.y;
    // walls, monsters and other players all stop you; per axis so you slide around them
    if (dx && !this.boxBlocked(p.x + dx, p.y, P.radius, false, p.f) && !this.bodyBlocks(p.x, p.y, p.x + dx, p.y)) p.x += dx;
    if (dy && !this.boxBlocked(p.x, p.y + dy, P.radius, false, p.f) && !this.bodyBlocks(p.x, p.y, p.x, p.y + dy)) p.y += dy;
    const moved = U.dist(beforeX, beforeY, p.x, p.y);
    p.moving = moved > 0.0005;

    // head bob + weapon sway
    if (p.moving) {
      p.bobPhase += moved * (wantSprint ? 9 : 7);
      p.stepDist += moved;
      if (p.stepDist > (wantSprint ? 1.05 : 1.45)) { p.stepDist = 0; MAZE.audio.play("step"); }
    } else {
      p.bobPhase += dt * 1.6;
    }
    const amp = p.moving ? (wantSprint ? 0.016 : 0.010) : 0.0035;
    p.bob = Math.sin(p.bobPhase) * amp;
    p.bobView = Math.sin(p.bobPhase) * (p.moving ? 0.02 : 0.006);
    p.swayX = U.lerp(p.swayX, Math.sin(p.bobPhase * 0.5) * (p.moving ? 0.5 : 0.15) + p.lookSway * 3, Math.min(1, dt * 6));
    p.swayY = U.lerp(p.swayY, p.moving ? 0.35 : 0, Math.min(1, dt * 6));
    p.lookSway = (p.lookSway || 0) * Math.pow(0.001, dt);

    this.updatePrompt(k);
  };

  // what is in front of you: stairs to take, a door to unlock, or a fallen teammate to revive
  Game.prototype.updatePrompt = function (held) {
    const p = this.player;
    this.prompt = "";
    // a tap shorter than a frame still counts: keydown latches it until we read it here
    const k = { use: held.use || this._useTap };
    this._useTap = false;
    if (this.mode === "coop") {
      for (const o of this.others) {
        if (!o.dead || !o.visible() || o.f !== p.f || U.dist(o.x, o.y, p.x, p.y) > P.reviveRange) continue;
        this.prompt = o.revive > 0 ? "Reviving " + o.name + "…  " + Math.round(o.revive * 100) + "%" : "Hold E to revive " + o.name;
        return;
      }
    }
    const cx = Math.floor(p.x), cy = Math.floor(p.y), st = this.stairAt(cx, cy);
    if (st && U.dist(p.x, p.y, cx + 0.5, cy + 0.5) < 0.55) {
      const up = MAZE.STAIR_DIR[st] > 0, ladder = st === T.LADDER_UP || st === T.LADDER_DOWN;
      this.prompt = "E: " + (ladder ? "climb " : "take the stairs ") + (up ? "up" : "down") + " to floor " + (p.f + (up ? 2 : 0)) + " of " + this.floors;
      if (k.use && !this._usePressed) { this._usePressed = true; this.link.climb(); }
      if (!k.use) this._usePressed = false;
      return;
    }
    const fx = p.x + Math.cos(p.ang) * 0.75;
    const fy = p.y + Math.sin(p.ang) * 0.75;
    const tx = Math.floor(fx), ty = Math.floor(fy);
    if (this.tileAt(tx, ty) === W.DOOR) {
      if (p.has.key) {
        this.prompt = "Press E to unlock the door";
        if (k.use && !this._usePressed) { this._usePressed = true; this.link.openDoor(tx, ty); }
      } else {
        this.prompt = "Locked — you need the key";
        if (k.use && !this._usePressed) {
          this._usePressed = true;
          MAZE.audio.play("locked");
          this.message("It will not budge without the key.", "#ffb454");
        }
      }
    }
    if (!k.use) this._usePressed = false;
  };

  // ------------------------------------------------------------ combat --
  // The swing and its sound happen here at once; whether it lands is the sim's call.
  Game.prototype.attack = function () {
    const p = this.player;
    if (p.dead || p.escaped || p.atkCd > 0 || p.swingT > 0) return;
    const w = MAZE.WEAPONS[p.weapon];
    if (w.kind === "magic") {
      const sp = MAZE.SPELLS[p.spell];
      if (!sp) return;
      if (p.mana < sp.cost) { MAZE.audio.play("noAmmo"); this.message("Not enough mana for " + sp.name + ".", "#5a7aff"); p.atkCd = 0.3; return; }
      MAZE.audio.play(sp.id === "fire" ? "fire" : sp.id === "frost" ? "frost" : "cast");
      p.castT = 0.4;
      p.lookSway = -0.03;
    } else if (w.kind === "ranged") {
      if (p.arrows <= 0) {
        MAZE.audio.play("noAmmo");
        this.message("Out of arrows.", "#ff5a5a");
        return;
      }
      p.arrows--;
      MAZE.audio.play("bow");
      p.lookSway = -0.05;
    } else {
      MAZE.audio.play("swing");
    }
    p.swingT = p.swingDur = w.cd;
    p.atkCd = w.cd;
    this.link.attack();
  };

  Game.prototype.cycleSpell = function (dir) {
    const p = this.player;
    if (!p.spells.length) { this.message("You know no spells yet — find a scroll and learn it (C).", "#b07cff"); return; }
    const i = p.spells.indexOf(p.spell);
    p.spell = p.spells[(i + (dir || 1) + p.spells.length) % p.spells.length];
    if (p.weapon !== "magic") this.setWeapon("magic");
    const sp = MAZE.SPELLS[p.spell];
    this.message(sp.name + "  ·  " + sp.cost + " mana", sp.color);
    MAZE.audio.play("weapon");
  };

  // mark the spot you are looking at for everyone (F or middle click)
  Game.prototype.ping = function () {
    const c = this.camera();
    const dx = Math.cos(c.ang), dy = Math.sin(c.ang);
    let x = c.x, y = c.y;
    for (let s = 0; s < 60; s++) {
      const nx = x + dx * 0.2, ny = y + dy * 0.2;
      if (this.solidAt(nx, ny, true, c.f)) break;
      x = nx; y = ny;
    }
    this.link.ping(x, y);
  };

  // Would moving the player from (ox,oy) to (nx,ny) push into a monster or another player?
  // Moves that increase the gap are always allowed, so you can back out.
  Game.prototype.bodyBlocks = function (ox, oy, nx, ny) {
    const bodies = this._bodies();
    for (let i = 0; i < bodies.length; i++) {
      const e = bodies[i];
      const min = e.radius * (e.sizeMul || 1) + P.radius;
      const nd2 = (e.x - nx) * (e.x - nx) + (e.y - ny) * (e.y - ny);
      if (nd2 >= min * min) continue;
      const od2 = (e.x - ox) * (e.x - ox) + (e.y - oy) * (e.y - oy);
      if (nd2 < od2) return true;
    }
    return false;
  };

  Game.prototype._bodies = function () {
    const out = this._bodyList || (this._bodyList = []);
    const f = this.player.f;
    out.length = 0;
    for (let i = 0; i < this.enemies.length; i++) if (this.enemies[i].f === f) out.push(this.enemies[i]);
    for (let i = 0; i < this.others.length; i++) {
      const o = this.others[i];
      if (o.visible() && !o.dead && o.f === f) { o.radius = P.radius; out.push(o); }
    }
    return out;
  };

  // If a monster or player ends up overlapping you (they moved into you), step aside.
  Game.prototype.separateBodies = function () {
    const p = this.player;
    if (p.dead || p.escaped) return;
    const bodies = this._bodies();
    for (let i = 0; i < bodies.length; i++) {
      const e = bodies[i];
      const min = e.radius * (e.sizeMul || 1) + P.radius;
      const dx = p.x - e.x, dy = p.y - e.y;
      const d = Math.hypot(dx, dy);
      if (d >= min) continue;
      let nx, ny;
      if (d < 1e-4) { nx = -Math.cos(p.ang); ny = -Math.sin(p.ang); }
      else { nx = dx / d; ny = dy / d; }
      const push = Math.min(0.08, (min - d) * 0.5);
      this.moveCircle(p, nx * push, ny * push, P.radius, false);
    }
  };

  // ------------------------------------------------------------- input --
  Game.prototype.toggleView = function () {
    if (this.viewMode === "map") {
      if (this.spectate < 0) this.nextSpectate(1);
      if (this.spectate >= 0) { this.viewMode = "pov"; const o = this.otherMap.get(this.spectate); if (o) this.specFloor = o.f || 0; }
    } else this.viewMode = "map";
  };

  // spectators: step the overhead map up or down a floor
  Game.prototype.specFloorStep = function (d) {
    this.specFloor = U.clamp(this.specFloor + d, 0, this.floors - 1);
    this.viewMode = "map";
  };

  Game.prototype.setWeapon = function (name) {
    const p = this.player;
    if (!p.weapons[name] || p.weapon === name || p.dead) return;
    p.weapon = name;
    p.swingT = 0; p.atkCd = 0.12;
    MAZE.audio.play("weapon");
  };

  Game.prototype.cycleWeapon = function (dir) {
    const p = this.player;
    const owned = MAZE.WEAPON_ORDER.filter((n) => p.weapons[n]);
    if (owned.length < 2) return;
    let i = owned.indexOf(p.weapon);
    i = (i + dir + owned.length) % owned.length;
    this.setWeapon(owned[i]);
  };

  Game.prototype.bind = function () {
    if (this._bound) return;
    this._bound = true;
    const self = this;
    const k = this.keys;

    this._onKeyDown = function (e) {
      if (!self.running) return;
      if (self.charOpen) return;                                   // the character sheet has the keyboard
      const c = e.code;
      if (self.spectator) {
        if (c === "Tab" || c === "KeyM" || c === "Space") self.toggleView();
        else if (/^Digit[1-4]$/.test(c)) { if (!self.watch(+c.slice(5) - 1)) self.message("Player " + c.slice(5) + " is not in the maze.", "#8a93a7"); }
        else if (c === "ArrowRight" || c === "KeyD" || c === "KeyE") { self.nextSpectate(1); if (self.spectate >= 0) self.viewMode = "pov"; }
        else if (c === "ArrowLeft" || c === "KeyA" || c === "KeyQ") { self.nextSpectate(-1); if (self.spectate >= 0) self.viewMode = "pov"; }
        else if (c === "PageUp" || c === "ArrowUp" || c === "KeyW") self.specFloorStep(1);
        else if (c === "PageDown" || c === "ArrowDown" || c === "KeyS") self.specFloorStep(-1);
        else if (c === "Escape") { if (self.opts.onMenu) self.opts.onMenu(); }
        else return;
        e.preventDefault();
        return;
      }
      if (c === "KeyW" || c === "ArrowUp") k.w = 1;
      else if (c === "KeyS" || c === "ArrowDown") k.s = 1;
      else if (c === "KeyA") k.a = 1;
      else if (c === "KeyD") k.d = 1;
      else if (c === "ArrowLeft") k.turnL = 1;
      else if (c === "ArrowRight") k.turnR = 1;
      else if (c === "ShiftLeft" || c === "ShiftRight") k.sprint = 1;
      else if (c === "KeyE" || c === "Space") { k.use = 1; if (!e.repeat) self._useTap = true; }
      else if (c === "Digit1") self.setWeapon("fist");
      else if (c === "Digit2") self.setWeapon("sword");
      else if (c === "Digit3") self.setWeapon("bow");
      else if (c === "Digit4") { if (self.player.weapons.magic) self.setWeapon("magic"); else self.message("No spells yet — find a scroll and learn it (C).", "#b07cff"); }
      else if (c === "KeyR") { if (!e.repeat) self.cycleSpell(e.shiftKey ? -1 : 1); }
      else if (c === "KeyC" || c === "KeyI") { if (!e.repeat && self.opts.onChar && !self.player.escaped) self.opts.onChar(); }
      else if (c === "KeyQ") self.cycleWeapon(-1);
      else if (c === "KeyF") { if (!e.repeat && !self.paused && self.online) self.ping(); }
      else if (c === "Tab") { self.bigMap = !self.bigMap; }
      else if (c === "KeyM") { self.bigMap = !self.bigMap; }
      else return;
      e.preventDefault();
    };
    this._onKeyUp = function (e) {
      const c = e.code;
      if (c === "KeyW" || c === "ArrowUp") k.w = 0;
      else if (c === "KeyS" || c === "ArrowDown") k.s = 0;
      else if (c === "KeyA") k.a = 0;
      else if (c === "KeyD") k.d = 0;
      else if (c === "ArrowLeft") k.turnL = 0;
      else if (c === "ArrowRight") k.turnR = 0;
      else if (c === "ShiftLeft" || c === "ShiftRight") k.sprint = 0;
      else if (c === "KeyE" || c === "Space") k.use = 0;
    };
    this._onMove = function (e) {
      if (self.paused || self.ended || document.pointerLockElement !== self.view) return;
      const p = self.player;
      if (p.escaped) return;
      const s = self.sensitivity * 0.0022;
      p.ang += e.movementX * s;
      p.pitch = U.clamp(p.pitch - e.movementY * s * 0.6, -0.42, 0.42);
      p.lookSway = U.clamp((p.lookSway || 0) - e.movementX * 0.0006, -0.12, 0.12);
    };
    this._onDown = function (e) {
      if (self.paused || self.ended) return;
      if (self.spectator) {
        if (self.viewMode === "map") {
          const hit = self.hud.pickAt(e.offsetX, e.offsetY);
          if (hit && hit.floor != null) self.specFloor = hit.floor;
          else if (hit && hit.seat >= 0) self.watch(hit.seat);
        } else if (e.button === 0 || e.button === 2) self.nextSpectate(e.button === 0 ? 1 : -1);
        return;
      }
      if (self.player.escaped) { if (e.button === 0 || e.button === 2) self.nextSpectate(e.button === 0 ? 1 : -1); return; }
      // a click on the view while the mouse is free takes it back for looking, not a swing
      if (document.pointerLockElement !== self.view && self.opts.onRelock) { self.opts.onRelock(); e.preventDefault(); return; }
      if (e.button === 0) self.attack();
      if (e.button === 1 && self.online) { self.ping(); e.preventDefault(); }
      if (e.button === 2) k.block = 1;
    };
    this._onUp = function (e) { if (e.button === 2) k.block = 0; };
    this._onWheel = function (e) {
      if (self.paused || self.ended) return;
      if (self.spectator) {
        if (self.viewMode === "pov") self.nextSpectate(e.deltaY > 0 ? 1 : -1);
        else if (self.floors > 1) self.specFloorStep(e.deltaY > 0 ? -1 : 1);
        e.preventDefault(); return;
      }
      self.cycleWeapon(e.deltaY > 0 ? 1 : -1);
      e.preventDefault();
    };
    this._onCtx = function (e) { e.preventDefault(); };
    this._onBlur = function () {
      for (const key in k) k[key] = 0;
    };

    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);
    window.addEventListener("blur", this._onBlur);
    document.addEventListener("mousemove", this._onMove);
    this.view.addEventListener("mousedown", this._onDown);
    window.addEventListener("mouseup", this._onUp);
    this.view.addEventListener("wheel", this._onWheel, { passive: false });
    this.view.addEventListener("contextmenu", this._onCtx);
  };

  Game.prototype.unbind = function () {
    if (!this._bound) return;
    this._bound = false;
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
    window.removeEventListener("blur", this._onBlur);
    document.removeEventListener("mousemove", this._onMove);
    this.view.removeEventListener("mousedown", this._onDown);
    window.removeEventListener("mouseup", this._onUp);
    this.view.removeEventListener("wheel", this._onWheel);
    this.view.removeEventListener("contextmenu", this._onCtx);
  };

  Game.prototype.handleResize = function () {
    const r = this.view.getBoundingClientRect();
    const w = Math.max(160, r.width | 0), h = Math.max(120, r.height | 0);
    this.renderer.resize(w, h);
    this.hud.resize(w, h);
  };

  Game.prototype.setQuality = function (q) {
    const r = this.view.getBoundingClientRect();
    this.renderer.autoScale = 1;               // let the adaptive scaler start over
    this.renderer.frameMs = 10;
    this.renderer.resize(Math.max(160, r.width | 0), Math.max(120, r.height | 0), q);
  };

  MAZE.Game = Game;
})();
