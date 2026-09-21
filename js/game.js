/* MAZE — first person play: your own movement, the camera, and turning what the world
   simulation reports into sights, sounds and messages.

   The world itself (blobs, items, doors, damage, who wins) lives in MAZE.Sim, reached
   through a link: LocalLink runs the sim in this tab for solo play, NetLink talks to the
   server for online rooms. Either way this file reads the same snapshots and events. */
(function () {
  const MAZE = window.MAZE;
  const U = MAZE.util;
  const W = MAZE.W, T = MAZE.T;
  const P = MAZE.PLAYER;

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
      out.push({ correct: { x: p.x, y: p.y, ep: p.epoch } });
    }
    this.sim.step(dt);
    out.push({ ev: this.sim.drain(), snap: this.sim.snapshot(), me: this.sim.privateState(this.seat) });
    return out;
  };
  LocalLink.prototype.attack = function () { this.sim.attack(this.seat); };
  LocalLink.prototype.openDoor = function (tx, ty) { this.sim.openDoor(this.seat, tx, ty); };
  LocalLink.prototype.ping = function (x, y) { this.sim.ping(this.seat, x, y); };
  LocalLink.prototype.close = function () {};

  // Online: send where we are twenty times a second, collect whatever the server sent.
  function NetLink(net, seat) {
    this.net = net;
    this.seat = seat;
    this.smooth = true;
    this.online = true;
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
    if (!i) return;
    this.net.send({ t: "pos", x: r3(i.x), y: r3(i.y), ang: r3(i.ang), pitch: r3(i.pitch), blk: i.blk, use: i.use, w: i.w, ep: i.ep });
  };
  // the server resolves a swing with the facing it last heard, so bring it up to date first
  NetLink.prototype.attack = function () { this.sendPos(); this.net.send({ t: "atk" }); };
  NetLink.prototype.openDoor = function (tx, ty) { this.sendPos(); this.net.send({ t: "door", x: tx, y: ty }); };
  NetLink.prototype.ping = function (x, y) { this.net.send({ t: "ping", x: r3(x), y: r3(y) }); };
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
    this.level = { name: full.name };
    this.cols = full.cols; this.rows = full.rows;
    this.walls = Uint8Array.from(full.walls);
    this.secretFound = new Uint8Array(this.cols * this.rows);
    this.seen = new Uint8Array(this.cols * this.rows);
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

    for (const it of full.items) this.addItem(it[0], it[1], it[2], it[3]);
    const fin = MAZE.THINGS[T.FINISH];
    this.exit = full.exit ? { x: full.exit.cx + 0.5, y: full.exit.cy + 0.5, cx: full.exit.cx, cy: full.exit.cy, sprite: "finish", frame: 0, scale: fin.scale, zbase: fin.zbase, t: 0, flash: 0 } : null;

    let me = null;
    for (const pl of full.players) {
      if (pl.seat === seat) { me = pl; continue; }
      const v = new MAZE.PlayerView(pl.seat, pl.name);
      v.apply([pl.seat, pl.x, pl.y, pl.ang, pl.pitch, pl.hp, (pl.dead ? 1 : 0) | (pl.escaped ? 2 : 0) | (pl.away ? 8 : 0), pl.w, pl.ep, 0, 0], performance.now(), false);
      this.others.push(v);
      this.otherMap.set(pl.seat, v);
    }
    me = me || { x: 1.5, y: 1.5, ang: 0, hp: P.maxHp, ep: 1 };

    this.player = {
      x: me.x, y: me.y, ang: me.ang, pitch: 0,
      hp: me.hp, maxHp: P.maxHp,
      stamina: P.maxStamina, winded: false,
      weapon: "fist", weapons: { fist: true },
      has: { key: false, shield: false, boots: false, torch: false },
      arrows: 0,
      swingT: 0, swingDur: 0.3, atkCd: 0,
      blocking: false, blockAmt: 0,
      hurtFlash: 0, dead: !!me.dead, escaped: !!me.escaped, epoch: me.ep || 1, respawn: 0,
      bob: 0, bobView: 0, bobPhase: 0, swayX: 0, swayY: 0,
      stepDist: 0, moving: false, lookSway: 0, deadTilt: 0,
      hitMarks: []          // recent hits, for the directional indicator
    };
    if (this.player.escaped) this.nextSpectate(1);

    this.light = { dist: 8, ambient: 0.075 };
    this.markSeen(Math.floor(this.player.x), Math.floor(this.player.y), 2);
    this.message("Find the exit portal.", "#4fd6c8");
    if (this.mode === "versus") this.message("Competitive: first one out wins. Weapons hurt players.", "#ff6a8a");
    else if (this.mode === "coop") this.message("Co-op: everyone gets out. Hold E over a fallen friend to revive.", "#6ee06e");
    if (this.totalTreasure) this.message(this.totalTreasure + " treasure hidden in here.", "#ffcf5a");
    return this;
  };

  Game.prototype.addItem = function (id, kind, x, y) {
    if (!MAZE.THINGS[kind] || this.itemMap.has(id)) return;
    const v = new MAZE.PickupView(id, kind, x, y);
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
  Game.prototype.tileAt = function (tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return W.BRICK;
    return this.walls[ty * this.cols + tx];
  };

  // forAI: secret walls block blobs but not the player
  Game.prototype.solidTile = function (tx, ty, forAI) {
    const t = this.tileAt(tx, ty);
    if (t === W.EMPTY) return false;
    if (t === W.SECRET) return !!forAI;
    return true;
  };

  Game.prototype.solidAt = function (x, y, forAI) {
    return this.solidTile(Math.floor(x), Math.floor(y), forAI);
  };

  Game.prototype.boxBlocked = function (x, y, r, forAI) {
    const x0 = Math.floor(x - r), x1 = Math.floor(x + r);
    const y0 = Math.floor(y - r), y1 = Math.floor(y + r);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++)
        if (this.solidTile(tx, ty, forAI)) return true;
    return false;
  };

  // axis-separated so you slide along walls instead of sticking
  Game.prototype.moveCircle = function (ent, dx, dy, r, forAI) {
    if (dx && !this.boxBlocked(ent.x + dx, ent.y, r, forAI)) ent.x += dx;
    if (dy && !this.boxBlocked(ent.x, ent.y + dy, r, forAI)) ent.y += dy;
  };

  // ------------------------------------------------------- presentation --
  Game.prototype.message = function (text, color) {
    this.messages.unshift({ text: text, t: 3.2, color: color });
    if (this.messages.length > 5) this.messages.pop();
  };

  Game.prototype.splat = function (x, y, z, color, count, power) {
    const col = typeof color === "string" ? hexToABGR(color) : color;
    const pw = power || 2.2;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * U.TAU;
      const sp = Math.random() * pw;
      this.particles.push(new MAZE.Particle(
        x, y, z,
        Math.cos(a) * sp, Math.sin(a) * sp, Math.random() * 2.4,
        0.5 + Math.random() * 0.7, 0.035 + Math.random() * 0.045, col
      ));
    }
    if (this.particles.length > 400) this.particles.splice(0, this.particles.length - 400);
  };

  function hexToABGR(hex) {
    const h = hex.replace("#", "");
    return U.rgb(parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16));
  }

  // play a sound that happened at (x, y): quieter with distance, silent far away
  Game.prototype.soundAt = function (name, x, y, range) {
    const c = this.camera();
    const d = U.dist(c.x, c.y, x, y);
    const r = range || 12;
    if (d > r) return;
    MAZE.audio.play(name, Math.max(0.15, 1 - d / r));
  };

  Game.prototype.markSeen = function (tx, ty, level) {
    if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return;
    const i = ty * this.cols + tx;
    if (this.seen[i] < level) this.seen[i] = level;
  };

  // walk a fan of rays and remember what they touch, for the minimap
  Game.prototype.updateVisibility = function () {
    const p = this.camera();
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
        this.markSeen(tx, ty, 1);
        const t = this.walls[ty * this.cols + tx];
        if (t !== W.EMPTY && MAZE.WALLS[t] && MAZE.WALLS[t].opaque) break;
      }
    }
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        this.markSeen(Math.floor(p.x) + dx, Math.floor(p.y) + dy, 2);
  };

  // Where the eye is. Normally your own head; after escaping in co-op you watch a
  // teammate who is still inside.
  Game.prototype.camera = function () {
    const p = this.player;
    if (p.escaped && this.spectate >= 0) {
      const o = this.otherMap.get(this.spectate);
      if (o && o.visible()) {
        const c = this._cam || (this._cam = {});
        c.x = o.x; c.y = o.y; c.ang = o.ang; c.pitch = o.pitch * 0.5; c.bob = 0; c.seat = o.seat;
        return c;
      }
    }
    const c = this._me || (this._me = {});
    c.x = p.x; c.y = p.y; c.ang = p.ang; c.bob = p.bob; c.seat = this.seat;
    c.pitch = p.dead ? p.pitch - p.deadTilt : p.pitch;
    return c;
  };

  Game.prototype.nextSpectate = function (dir) {
    const live = this.others.filter((o) => o.visible()).map((o) => o.seat).sort();
    if (!live.length) { this.spectate = -1; return; }
    const i = live.indexOf(this.spectate);
    this.spectate = live[(i + (dir || 1) + live.length) % live.length];
  };

  Game.prototype.renderables = function () {
    const list = this._renderList;
    const cam = this.camera();
    list.length = 0;
    for (let i = 0; i < this.items.length; i++) list.push(this.items[i]);
    for (let i = 0; i < this.enemies.length; i++) list.push(this.enemies[i]);
    for (let i = 0; i < this.arrows.length; i++) list.push(this.arrows[i]);
    for (let i = 0; i < this.others.length; i++) {
      const o = this.others[i];
      o._screen = null;
      if (!o.visible() || o.seat === cam.seat) continue;
      o.face(cam.x, cam.y);
      list.push(o);
    }
    if (this.exit) list.push(this.exit);
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
      const t0 = performance.now();
      self.renderer.render(self);
      self.renderer.adapt(performance.now() - t0);
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
    if (p.escaped && (this.spectate < 0 || !this.otherMap.get(this.spectate) || !this.otherMap.get(this.spectate).visible())) this.nextSpectate(1);

    this.separateBodies();
    this.updateVisibility();

    // torchlight flicker
    const base = p.has.torch ? 14.5 : 8;
    const flick = p.has.torch ? 1 + Math.sin(this.time * 11) * 0.025 + Math.sin(this.time * 4.3) * 0.02 : 1;
    this.light.dist = base * flick;
  };

  Game.prototype.inputState = function () {
    const p = this.player, k = this.keys;
    return {
      x: p.x, y: p.y, ang: p.ang, pitch: p.pitch, ep: p.epoch,
      blk: p.blocking ? 1 : 0, use: k.use && !this.paused ? 1 : 0, w: MAZE.Sim.WEAPON_IDX[p.weapon]
    };
  };

  // ------------------------------------------------------ world updates --
  Game.prototype.applyBatch = function (b) {
    if (b.correct) {
      const p = this.player;
      if (b.correct.ep === p.epoch) { p.x = b.correct.x; p.y = b.correct.y; }
    }
    if (b.ev) for (let i = 0; i < b.ev.length; i++) { this.onEvent(b.ev[i]); if (this.ended) return; }
    if (b.snap) this.applySnap(b.snap);
    if (b.me) this.applyMe(b.me);
  };

  Game.prototype.applySnap = function (s) {
    const now = performance.now(), smooth = this.link.smooth;
    this.freeze = s.freeze || 0;

    const live = this._live || (this._live = new Set());
    live.clear();
    for (const row of s.b) {
      live.add(row[0]);
      let v = this.blobMap.get(row[0]);
      if (!v) {
        v = new MAZE.BlobView(row[0], row[1]);
        v.x = row[2]; v.y = row[3];
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
      if (!v) { v = new MAZE.ArrowView(row[0]); this.arrowMap.set(row[0], v); this.arrows.push(v); }
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

  // the private half of our own state: health, what we carry, our score
  Game.prototype.applyMe = function (me) {
    const p = this.player;
    p.hp = me.hp;
    p.arrows = me.arrows;
    p.has = me.has;
    p.respawn = me.respawn;
    const owned = { fist: true };
    for (const w of me.weapons) owned[w] = true;
    p.weapons = owned;
    if (!owned[p.weapon]) p.weapon = me.weapon && owned[me.weapon] ? me.weapon : "fist";
    this.stats = me.stats;
  };

  const PICK_TEXT = {};
  PICK_TEXT[T.SWORD] = ["Sword acquired — press 2", "#d8dde8", "weapon"];
  PICK_TEXT[T.BOW] = ["Bow acquired — press 3", "#c89a5a", "weapon"];
  PICK_TEXT[T.SHIELD] = ["Shield acquired — hold right-click", "#9fb4d8", "weapon"];
  PICK_TEXT[T.ARROWS] = ["+8 arrows", "#b9884f", "pickup"];
  PICK_TEXT[T.POTION] = ["+45 health", "#ff5a7a", "potion"];
  PICK_TEXT[T.KEY] = ["Key acquired.", "#ffd34a", "pickup"];
  PICK_TEXT[T.BOOTS] = ["Swift boots — you feel lighter.", "#8ad8ff", "pickup"];
  PICK_TEXT[T.TORCH] = ["Torch lit — you can see much further.", "#ffa030", "pickup"];

  Game.prototype.onEvent = function (ev) {
    const p = this.player, me = this.seat;
    const other = ev.s !== undefined && ev.s !== me ? this.otherMap.get(ev.s) : null;
    switch (ev.e) {
      case "swing":
        if (other) { other.swingT = 0.3; this.soundAt("swing", other.x, other.y, 9); }
        break;
      case "shoot":
        if (other) { other.swingT = 0.3; this.soundAt("bow", other.x, other.y, 12); }
        break;
      case "connect":
        if (ev.s === me) { MAZE.audio.play(ev.w === 1 ? "swordHit" : "punch"); p.lookSway = 0.04; }
        else if (other) this.soundAt(ev.w === 1 ? "swordHit" : "punch", other.x, other.y, 10);
        break;
      case "blob": {
        const def = MAZE.THINGS[ev.k] || MAZE.THINGS[T.BLOB];
        const v = this.blobMap.get(ev.b);
        const bx = v ? v.x : ev.x, by = v ? v.y : ev.y;
        this.splat(bx, by, def.zbase + def.scale * 0.5, def.body, 9);
        if (ev.dead) {
          this.splat(bx, by, def.zbase + def.scale * 0.4, def.body2, 26, 3.2);
          this.soundAt("dieBlob", bx, by, 16);
          if (ev.s === me) this.message("Blob splattered  +" + def.score);
          if (v) { this.blobMap.delete(ev.b); this.enemies.splice(this.enemies.indexOf(v), 1); }
        } else {
          if (v) v.flash = 0.75;
          this.soundAt("hurtBlob", bx, by, 14);
        }
        break;
      }
      case "hurt":
        if (ev.s === me) this.hurtMe(ev);
        else if (other) {
          other.flash = 0.8;
          this.splat(other.x, other.y, 0.45, "#ff5a5a", 7, 1.6);
          this.soundAt(ev.blk ? "block" : "hurt", other.x, other.y, 10);
        }
        break;
      case "die": {
        this.splat(ev.x, ev.y, 0.4, "#ff5a5a", 30, 2.4);
        if (ev.s === me) {
          p.dead = true;
          p.swingT = 0;
          if (this.mode === "solo") break;
          MAZE.audio.play("lose");
          if (ev.by >= 0 && ev.by !== me) this.message(this.nameOf(ev.by) + " struck you down.", "#ff5a5a");
          else this.message("The blobs got you.", "#ff5a5a");
          if (this.mode === "coop") this.message("Hold on — a teammate can revive you.", "#6ee06e");
        } else {
          if (ev.by === me) { this.message("You defeated " + this.nameOf(ev.s) + "  +400", "#ffb454"); MAZE.audio.play("secret"); }
          else if (ev.by >= 0) this.message(this.nameOf(ev.by) + " defeated " + this.nameOf(ev.s) + ".", "#ff9a9a");
          else this.message(this.nameOf(ev.s) + (this.mode === "coop" ? " is down! Hold E beside them to revive." : " was eaten by blobs."), this.mode === "coop" ? "#ff9a9a" : "#dfe5f0");
          if (other) this.soundAt("hurt", other.x, other.y, 14);
        }
        break;
      }
      case "respawn":
        if (ev.s === me) {
          p.x = ev.x; p.y = ev.y; p.ang = ev.ang; p.pitch = 0; p.deadTilt = 0;
          p.dead = false; p.epoch = ev.ep; p.hp = P.maxHp; p.hurtFlash = 0; p.hitMarks.length = 0;
          MAZE.audio.play("potion");
          this.message("Back on your feet.", "#6ee06e");
        } else if (other) {
          other.motion.q.length = 0;
          other.x = ev.x; other.y = ev.y; other.ang = ev.ang;
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
        if (it) this.splat(it.x, it.y, it.baseZ + 0.15, def.mini, 12, 1.5);
        if (ev.s === me) this.pickedUp(ev.k);
        else if (ev.k === T.KEY) this.message(this.nameOf(ev.s) + (this.mode === "coop" ? " found the key — it works for all of you." : " has the key."), "#ffd34a");
        else if (it) this.soundAt("pickup", it.x, it.y, 8);
        break;
      }
      case "drop":
        this.addItem(ev.id, ev.k, ev.x, ev.y);
        break;
      case "door": {
        this.walls[ev.y * this.cols + ev.x] = W.EMPTY;
        this.soundAt("door", ev.x + 0.5, ev.y + 0.5, 30);
        this.splat(ev.x + 0.5, ev.y + 0.5, 0.5, "#c99b4a", 16, 1.8);
        this.message(ev.s === me ? "The door swings open." : this.nameOf(ev.s) + " unlocked a door.", "#c99b4a");
        break;
      }
      case "locked":
        if (ev.s === me) { MAZE.audio.play("locked"); this.message("It will not budge without the key.", "#ffb454"); }
        break;
      case "secret":
        if (ev.s === me) {
          this.secretFound[ev.y * this.cols + ev.x] = 1;
          MAZE.audio.play("secret");
          this.message("Secret passage found!  +300", "#c06bd6");
          this.splat(ev.x + 0.5, ev.y + 0.5, 0.5, "#c06bd6", 22, 2.6);
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
      case "thunk":
        this.splat(ev.x, ev.y, 0.47, ev.hit ? 0xff5a5aff : 0xff8fb4c8, 6, 1.4);
        this.soundAt("arrowHit", ev.x, ev.y, 10);
        break;
      case "growl": {
        const v = this.blobMap.get(ev.b);
        if (v) this.soundAt("growl", v.x, v.y, 9);
        break;
      }
      case "windup": {
        const v = this.blobMap.get(ev.b);
        if (v) this.soundAt("windup", v.x, v.y, 7);
        break;
      }
      case "ping":
        this.pings.push({ x: ev.x, y: ev.y, seat: ev.s, t: 5 });
        if (ev.s !== me) this.message(this.nameOf(ev.s) + ": over here!", this.colorOf(ev.s));
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
    if (r.mode === "versus") return r.winner === this.seat;
    return r.outcome === "escaped";
  };

  Game.prototype.pickedUp = function (kind) {
    const p = this.player;
    if (kind === T.TREASURE) {
      MAZE.audio.play("pickup");
      this.message("Treasure  +250", "#ffcf5a");
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
    MAZE.audio.play(ev.blk ? "block" : "hurt");
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
    for (let i = p.hitMarks.length - 1; i >= 0; i--) {
      p.hitMarks[i].t -= dt * 0.9;
      if (p.hitMarks[i].t <= 0) p.hitMarks.splice(i, 1);
    }
    if (p.atkCd > 0) p.atkCd -= dt;
    if (p.swingT > 0) p.swingT = Math.max(0, p.swingT - dt);

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

    let speed = P.speed;
    if (p.has.boots) speed *= 1.4;
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
    // walls, blobs and other players all stop you; per axis so you slide around them
    if (dx && !this.boxBlocked(p.x + dx, p.y, P.radius, false) && !this.bodyBlocks(p.x, p.y, p.x + dx, p.y)) p.x += dx;
    if (dy && !this.boxBlocked(p.x, p.y + dy, P.radius, false) && !this.bodyBlocks(p.x, p.y, p.x, p.y + dy)) p.y += dy;
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

  // what is in front of you: a door to unlock, or a fallen teammate to revive
  Game.prototype.updatePrompt = function (k) {
    const p = this.player;
    this.prompt = "";
    if (this.mode === "coop") {
      for (const o of this.others) {
        if (!o.dead || !o.visible() || U.dist(o.x, o.y, p.x, p.y) > P.reviveRange) continue;
        this.prompt = o.revive > 0 ? "Reviving " + o.name + "…  " + Math.round(o.revive * 100) + "%" : "Hold E to revive " + o.name;
        return;
      }
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
    if (w.kind === "ranged") {
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

  // mark the spot you are looking at for everyone (F or middle click)
  Game.prototype.ping = function () {
    const c = this.camera();
    const dx = Math.cos(c.ang), dy = Math.sin(c.ang);
    let x = c.x, y = c.y;
    for (let s = 0; s < 60; s++) {
      const nx = x + dx * 0.2, ny = y + dy * 0.2;
      if (this.solidAt(nx, ny, true)) break;
      x = nx; y = ny;
    }
    this.link.ping(x, y);
  };

  // Would moving the player from (ox,oy) to (nx,ny) push into a blob or another player?
  // Moves that increase the gap are always allowed, so you can back out.
  Game.prototype.bodyBlocks = function (ox, oy, nx, ny) {
    const bodies = this._bodies();
    for (let i = 0; i < bodies.length; i++) {
      const e = bodies[i];
      const min = e.radius + P.radius;
      const nd2 = (e.x - nx) * (e.x - nx) + (e.y - ny) * (e.y - ny);
      if (nd2 >= min * min) continue;
      const od2 = (e.x - ox) * (e.x - ox) + (e.y - oy) * (e.y - oy);
      if (nd2 < od2) return true;
    }
    return false;
  };

  Game.prototype._bodies = function () {
    const out = this._bodyList || (this._bodyList = []);
    out.length = 0;
    for (let i = 0; i < this.enemies.length; i++) out.push(this.enemies[i]);
    for (let i = 0; i < this.others.length; i++) {
      const o = this.others[i];
      if (o.visible() && !o.dead) { o.radius = P.radius; out.push(o); }
    }
    return out;
  };

  // If a blob or player ends up overlapping you (they moved into you), step aside.
  Game.prototype.separateBodies = function () {
    const p = this.player;
    if (p.dead || p.escaped) return;
    const bodies = this._bodies();
    for (let i = 0; i < bodies.length; i++) {
      const e = bodies[i];
      const min = e.radius + P.radius;
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
      const c = e.code;
      if (c === "KeyW" || c === "ArrowUp") k.w = 1;
      else if (c === "KeyS" || c === "ArrowDown") k.s = 1;
      else if (c === "KeyA") k.a = 1;
      else if (c === "KeyD") k.d = 1;
      else if (c === "ArrowLeft") k.turnL = 1;
      else if (c === "ArrowRight") k.turnR = 1;
      else if (c === "ShiftLeft" || c === "ShiftRight") k.sprint = 1;
      else if (c === "KeyE" || c === "Space") k.use = 1;
      else if (c === "Digit1") self.setWeapon("fist");
      else if (c === "Digit2") self.setWeapon("sword");
      else if (c === "Digit3") self.setWeapon("bow");
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
      if (self.player.escaped) { if (e.button === 0 || e.button === 2) self.nextSpectate(e.button === 0 ? 1 : -1); return; }
      if (e.button === 0) self.attack();
      if (e.button === 1 && self.online) { self.ping(); e.preventDefault(); }
      if (e.button === 2) k.block = 1;
    };
    this._onUp = function (e) { if (e.button === 2) k.block = 0; };
    this._onWheel = function (e) {
      if (self.paused || self.ended) return;
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
