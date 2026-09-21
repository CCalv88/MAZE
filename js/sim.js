/* MAZE — the authoritative world: blobs, arrows, items, doors, combat, respawns, win rules.
   The same file runs in the browser for solo play and inside server.js for online rooms,
   so both play by exactly the same rules. No DOM and no audio in here: it reports what
   happened as events, and each client decides how that looks and sounds.

   Players move themselves (client side, for responsive controls) and report where they
   are through move(); everything else is decided here. */
(function () {
  const MAZE = window.MAZE;
  const U = MAZE.util, W = MAZE.W, T = MAZE.T, P = MAZE.PLAYER, L = MAZE.Level;
  const WINDUP = 0.4;
  const WEAPON_IDX = { fist: 0, sword: 1, bow: 2 };
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function Sim(level, opts) {
    opts = opts || {};
    this.level = L.clone(level);
    this.mode = MAZE.MODES[opts.mode] ? opts.mode : "solo";
    this.rnd = U.rng(opts.seed == null ? (Math.random() * 1e9) | 0 : opts.seed);
    const lv = this.level;
    this.cols = lv.cols; this.rows = lv.rows;
    this.walls = new Uint8Array(lv.walls);
    this.flow = new Int32Array(lv.cols * lv.rows).fill(-1);
    this._queue = new Int32Array(lv.cols * lv.rows);
    this.flowTimer = 0;
    this.time = 0;
    this.freeze = opts.freeze || 0;          // blobs hold still for the countdown
    this.ended = false;
    this.result = null;
    this.events = [];
    this.nextId = 1;
    this.enemies = [];
    this.items = [];
    this.arrows = [];
    this.players = [];
    this.teamKey = false;
    this.totalTreasure = 0;
    this.exit = null;

    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const i = y * this.cols + x;
        const id = lv.things[i];
        if (!id || this.walls[i] !== W.EMPTY) continue;
        const def = MAZE.THINGS[id];
        if (!def || def.cat === "marker") {
          if (id === T.FINISH) this.exit = { x: x + 0.5, y: y + 0.5, cx: x, cy: y };
          continue;
        }
        if (def.cat === "enemy") this.enemies.push(new SimBlob(this, x + 0.5, y + 0.5, id));
        else {
          this.items.push({ id: this.nextId++, kind: id, x: x + 0.5, y: y + 0.5 });
          if (id === T.TREASURE) this.totalTreasure++;
        }
      }
    }
    this.spawns = L.spawnPoints(lv).map((c) => ({ x: c.x + 0.5, y: c.y + 0.5, ang: this.openAngle(c.x, c.y) }));
  }

  Sim.WEAPON_IDX = WEAPON_IDX;
  Sim.WEAPON_BY_IDX = ["fist", "sword", "bow"];

  // ------------------------------------------------------------ players --
  Sim.prototype.addPlayer = function (seat, name) {
    const sp = this.spawns[seat] || this.spawns[0];
    const p = {
      seat: seat, name: name || "Player " + (seat + 1),
      x: sp.x, y: sp.y, ang: sp.ang, pitch: 0,
      hp: P.maxHp, maxHp: P.maxHp,
      dead: false, escaped: false, away: false, place: 0,
      respawnT: 0, reviveT: 0, reviver: -1, invuln: 0,
      weapon: "fist", weapons: { fist: true },
      has: { key: false, shield: false, boots: false, torch: false },
      arrows: 0, blocking: false, using: false, moving: false,
      atkCd: 0, pending: null, lastMove: this.time, epoch: 1,
      secrets: new Uint8Array(this.cols * this.rows),
      stats: { time: 0, kills: 0, frags: 0, deaths: 0, score: 0, treasure: 0, secrets: 0, damage: 0, doors: 0 }
    };
    this.players[seat] = p;
    return p;
  };

  Sim.prototype.player = function (seat) { return this.players[seat] || null; };
  Sim.prototype.eachPlayer = function (fn) { for (const p of this.players) if (p) fn(p); };
  Sim.prototype.hasKey = function (p) { return p.has.key || (this.mode === "coop" && this.teamKey); };
  // in the maze and able to act (the only players blobs hunt)
  Sim.prototype.active = (p) => p && !p.dead && !p.escaped && !p.away;

  Sim.prototype.setAway = function (seat, away) {
    const p = this.players[seat];
    if (!p || p.away === !!away) return;
    p.away = !!away;
    this.emit({ e: "away", s: seat, away: p.away });
    this.checkEnd();
  };

  // The client says where it is. Anything impossible (through a wall, faster than
  // boots and a sprint allow, or from before a respawn) is refused and the caller
  // tells that client where it really is.
  Sim.prototype.move = function (seat, m) {
    const p = this.players[seat];
    if (!p || p.escaped) return true;
    if (m.ep !== undefined && m.ep !== p.epoch) return true;          // stale, from a previous life
    if (Number.isFinite(m.ang)) p.ang = m.ang;
    if (Number.isFinite(m.pitch)) p.pitch = U.clamp(m.pitch, -0.6, 0.6);
    p.blocking = !!m.blk && p.has.shield && !p.dead;
    p.using = !!m.use && !p.dead;
    const w = Sim.WEAPON_BY_IDX[m.w];
    if (w && p.weapons[w] && p.weapon !== w) { p.weapon = w; p.pending = null; }
    if (p.dead || !Number.isFinite(m.x) || !Number.isFinite(m.y)) return true;
    const elapsed = Math.max(0.05, this.time - p.lastMove);
    const maxStep = P.speed * 1.4 * P.sprintMul * 1.35 * elapsed + 0.6;
    const d = Math.hypot(m.x - p.x, m.y - p.y);
    if (d > maxStep || this.boxBlocked(m.x, m.y, P.radius * 0.6, false)) return false;
    p.moving = d > 0.002;
    p.x = m.x; p.y = m.y;
    p.lastMove = this.time;
    return true;
  };

  Sim.prototype.attack = function (seat) {
    const p = this.players[seat];
    if (!this.active(p) || p.atkCd > 0 || this.ended) return false;
    const w = MAZE.WEAPONS[p.weapon];
    if (w.kind === "ranged") {
      if (p.arrows <= 0) return false;
      p.arrows--;
      p.atkCd = w.cd;
      const dx = Math.cos(p.ang), dy = Math.sin(p.ang);
      this.arrows.push({ id: this.nextId++, owner: seat, x: p.x + dx * 0.4, y: p.y + dy * 0.4, dx: dx, dy: dy, dmg: w.dmg, speed: w.speed, life: 3 });
      this.emit({ e: "shoot", s: seat });
    } else {
      p.atkCd = w.cd;
      p.pending = { t: w.cd * 0.45, weapon: p.weapon };   // damage lands mid-swing
      this.emit({ e: "swing", s: seat, w: WEAPON_IDX[p.weapon] });
    }
    return true;
  };

  // open the door at (tx, ty) if this player is next to it and holds the key
  Sim.prototype.openDoor = function (seat, tx, ty) {
    const p = this.players[seat];
    if (!this.active(p) || this.tileAt(tx, ty) !== W.DOOR) return false;
    if (U.dist(p.x, p.y, tx + 0.5, ty + 0.5) > 1.75) return false;
    if (!this.hasKey(p)) { this.emit({ e: "locked", s: seat }); return false; }
    this.walls[ty * this.cols + tx] = W.EMPTY;
    p.stats.doors++;
    p.stats.score += 150;
    this.emit({ e: "door", s: seat, x: tx, y: ty });
    this.updateFlow();
    return true;
  };

  Sim.prototype.ping = function (seat, x, y) {
    const p = this.players[seat];
    if (!p || p.away || !Number.isFinite(x) || !Number.isFinite(y)) return;
    if ((p._pingT || -9) > this.time - 0.8) return;
    p._pingT = this.time;
    this.emit({ e: "ping", s: seat, x: U.clamp(x, 0, this.cols), y: U.clamp(y, 0, this.rows) });
  };

  // --------------------------------------------------------------- map --
  Sim.prototype.tileAt = function (tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return W.BRICK;
    return this.walls[ty * this.cols + tx];
  };
  Sim.prototype.solidTile = function (tx, ty, forAI) {
    const t = this.tileAt(tx, ty);
    if (t === W.EMPTY) return false;
    if (t === W.SECRET) return !!forAI;
    return true;
  };
  Sim.prototype.solidAt = function (x, y, forAI) { return this.solidTile(Math.floor(x), Math.floor(y), forAI); };
  Sim.prototype.boxBlocked = function (x, y, r, forAI) {
    const x0 = Math.floor(x - r), x1 = Math.floor(x + r), y0 = Math.floor(y - r), y1 = Math.floor(y + r);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++)
        if (this.solidTile(tx, ty, forAI)) return true;
    return false;
  };
  Sim.prototype.moveCircle = function (ent, dx, dy, r, forAI) {
    if (dx && !this.boxBlocked(ent.x + dx, ent.y, r, forAI)) ent.x += dx;
    if (dy && !this.boxBlocked(ent.x, ent.y + dy, r, forAI)) ent.y += dy;
  };
  Sim.prototype.lineOfSight = function (x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
    if (len < 0.001) return true;
    const steps = Math.ceil(len / 0.2), sx = dx / steps, sy = dy / steps;
    let x = x0, y = y0;
    for (let i = 0; i < steps; i++) {
      x += sx; y += sy;
      const t = this.tileAt(Math.floor(x), Math.floor(y));
      if (t !== W.EMPTY && MAZE.WALLS[t] && MAZE.WALLS[t].opaque) return false;
    }
    return true;
  };
  Sim.prototype.openAngle = function (cx, cy) {
    for (const d of [[1, 0], [0, 1], [-1, 0], [0, -1]])
      if (!this.solidTile(cx + d[0], cy + d[1], false)) return Math.atan2(d[1], d[0]);
    return 0;
  };
  Sim.prototype.flowAt = function (x, y) {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return -1;
    return this.flow[y * this.cols + x];
  };

  // BFS out from every player blobs can hunt, over tiles blobs can use; each blob
  // walks downhill to whoever is nearest by path, not by straight line.
  Sim.prototype.updateFlow = function () {
    const flow = this.flow, q = this._queue, cols = this.cols, rows = this.rows;
    flow.fill(-1);
    let head = 0, tail = 0;
    for (const p of this.players) {
      if (!this.active(p)) continue;
      const sx = Math.floor(p.x), sy = Math.floor(p.y);
      if (sx < 0 || sy < 0 || sx >= cols || sy >= rows) continue;
      const s = sy * cols + sx;
      if (flow[s] === 0) continue;
      flow[s] = 0; q[tail++] = s;
    }
    while (head < tail) {
      const cur = q[head++];
      const cx = cur % cols, cy = (cur / cols) | 0, d = flow[cur] + 1;
      for (let k = 0; k < 4; k++) {
        const nx = cx + DIRS[k][0], ny = cy + DIRS[k][1];
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const ni = ny * cols + nx;
        if (flow[ni] !== -1 || this.solidTile(nx, ny, true)) continue;
        flow[ni] = d; q[tail++] = ni;
      }
    }
  };

  Sim.prototype.emit = function (ev) { this.events.push(ev); };
  Sim.prototype.drain = function () { const e = this.events; this.events = []; return e; };

  // -------------------------------------------------------------- step --
  Sim.prototype.step = function (dt) {
    if (this.ended) return;
    this.time += dt;
    if (this.freeze > 0) this.freeze = Math.max(0, this.freeze - dt);

    for (const p of this.players) if (p) this.updatePlayer(p, dt);

    this.flowTimer -= dt;
    if (this.flowTimer <= 0) { this.flowTimer = 0.18; this.updateFlow(); }

    if (!this.freeze) for (const e of this.enemies) if (!e.dead) e.update(dt);
    for (let i = this.enemies.length - 1; i >= 0; i--) if (this.enemies[i].dead) this.enemies.splice(i, 1);

    for (let i = this.arrows.length - 1; i >= 0; i--) {
      this.updateArrow(this.arrows[i], dt);
      if (this.arrows[i].dead) this.arrows.splice(i, 1);
    }

    this.checkPickups(dt);
    this.checkExit();
    this.checkEnd();
  };

  Sim.prototype.updatePlayer = function (p, dt) {
    if (p.away) return;
    if (!p.escaped) p.stats.time += dt;
    if (p.atkCd > 0) p.atkCd -= dt;
    if (p.invuln > 0) p.invuln -= dt;
    if (p.pending) {
      p.pending.t -= dt;
      if (p.pending.t <= 0) {
        const w = p.pending.weapon;
        p.pending = null;
        if (this.active(p)) this.meleeHit(p, w);
      }
    }
    if (p.dead) {
      this.updateRevive(p, dt);
      if (p.respawnT > 0) {
        p.respawnT -= dt;
        if (p.respawnT <= 0) this.respawn(p, true);
      }
      return;
    }
    if (p.escaped) return;
    // secret passages score once per player
    const tx = Math.floor(p.x), ty = Math.floor(p.y), i = ty * this.cols + tx;
    if (this.tileAt(tx, ty) === W.SECRET && !p.secrets[i]) {
      p.secrets[i] = 1;
      p.stats.secrets++;
      p.stats.score += 300;
      this.emit({ e: "secret", s: p.seat, x: tx, y: ty });
    }
  };

  // co-op: a living teammate standing over a fallen one and holding E brings them back
  Sim.prototype.updateRevive = function (p, dt) {
    if (this.mode !== "coop") return;
    let helper = null;
    for (const o of this.players) {
      if (!this.active(o) || o === p || !o.using) continue;
      if (U.dist(o.x, o.y, p.x, p.y) <= P.reviveRange) { helper = o; break; }
    }
    if (!helper) { if (p.reviveT) { p.reviveT = 0; p.reviver = -1; } return; }
    p.reviver = helper.seat;
    p.reviveT += dt;
    if (p.reviveT >= P.reviveTime) {
      this.respawn(p, false);
      p.hp = 40;
      helper.stats.score += 200;
      this.emit({ e: "revive", s: p.seat, by: helper.seat });
    }
  };

  Sim.prototype.respawn = function (p, atStart) {
    if (atStart) {
      const sp = this.spawns[p.seat] || this.spawns[0];
      p.x = sp.x; p.y = sp.y; p.ang = sp.ang;
    }
    p.dead = false;
    p.hp = p.maxHp;
    p.respawnT = 0; p.reviveT = 0; p.reviver = -1;
    p.invuln = P.spawnShield;
    p.epoch++;
    p.lastMove = this.time;
    p.pending = null;
    this.emit({ e: "respawn", s: p.seat, x: p.x, y: p.y, ang: p.ang, ep: p.epoch });
  };

  // ------------------------------------------------------------ combat --
  Sim.prototype.pvp = function () { return this.mode === "versus"; };

  Sim.prototype.meleeHit = function (p, weapon) {
    const w = MAZE.WEAPONS[weapon];
    let hits = 0;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy);
      if (d > w.range + e.radius) continue;
      if (Math.abs(U.angDiff(p.ang, Math.atan2(dy, dx))) > w.arc * 0.5) continue;
      if (!this.lineOfSight(p.x, p.y, e.x, e.y)) continue;
      e.hurt(w.dmg, dx / (d || 1), dy / (d || 1), w.knock, p.seat);
      hits++;
    }
    if (this.pvp()) {
      for (const o of this.players) {
        if (!this.active(o) || o === p) continue;
        const dx = o.x - p.x, dy = o.y - p.y, d = Math.hypot(dx, dy);
        if (d > w.range + P.radius) continue;
        if (Math.abs(U.angDiff(p.ang, Math.atan2(dy, dx))) > w.arc * 0.5) continue;
        if (!this.lineOfSight(p.x, p.y, o.x, o.y)) continue;
        this.damagePlayer(o, w.dmg * P.pvpMul, dx / (d || 1), dy / (d || 1), p.seat, w.knock);
        hits++;
      }
    }
    if (hits) this.emit({ e: "connect", s: p.seat, w: WEAPON_IDX[weapon] });
  };

  // dirX/dirY point from the attacker to the victim
  Sim.prototype.damagePlayer = function (p, dmg, dirX, dirY, by, knock) {
    if (!this.active(p) || p.invuln > 0) return;
    let dealt = dmg, blocked = 0;
    if (p.blocking) {
      // a raised shield only helps against things in front of you
      const front = Math.abs(U.angDiff(p.ang, Math.atan2(-dirY, -dirX))) < 1.1;
      dealt = dmg * (front ? 0.25 : 0.7);
      blocked = front ? 1 : 0;
    }
    p.hp -= dealt;
    p.invuln = 0.18;
    p.stats.damage += dealt;
    const push = (blocked ? 0.06 : 0.14) * (knock ? 0.6 + knock : 1);
    this.emit({ e: "hurt", s: p.seat, by: by == null ? -1 : by, dmg: Math.round(dealt * 10) / 10, dx: dirX, dy: dirY, push: push, blk: blocked, hp: Math.max(0, p.hp) });
    if (p.hp <= 0) this.kill(p, by == null ? -1 : by);
  };

  Sim.prototype.kill = function (p, by) {
    p.hp = 0;
    p.dead = true;
    p.pending = null;
    p.blocking = false;
    p.stats.deaths++;
    const killer = by >= 0 ? this.players[by] : null;
    if (killer && killer !== p) { killer.stats.frags++; killer.stats.score += 400; }
    this.emit({ e: "die", s: p.seat, by: by, x: p.x, y: p.y });
    if (this.mode === "versus") {
      this.dropLoot(p);
      p.respawnT = P.respawnVersus;
    } else if (this.mode === "coop") {
      p.respawnT = P.respawnCoop;
    }
    this.checkEnd();
  };

  // competitive: whatever you were carrying spills where you fell, for whoever gets there first
  Sim.prototype.dropLoot = function (p) {
    const drops = [];
    if (p.has.key) drops.push(T.KEY);
    if (p.weapons.sword) drops.push(T.SWORD);
    if (p.weapons.bow) drops.push(T.BOW);
    if (p.arrows > 0) drops.push(T.ARROWS);
    if (p.has.shield) drops.push(T.SHIELD);
    if (p.has.boots) drops.push(T.BOOTS);
    if (p.has.torch) drops.push(T.TORCH);
    p.weapons = { fist: true }; p.weapon = "fist"; p.arrows = 0;
    p.has = { key: false, shield: false, boots: false, torch: false };
    const cx = Math.floor(p.x) + 0.5, cy = Math.floor(p.y) + 0.5;
    drops.forEach((kind, i) => {
      const a = (i / Math.max(1, drops.length)) * U.TAU + this.rnd() * 0.5;
      const r = drops.length > 1 ? 0.28 : 0;
      const it = { id: this.nextId++, kind: kind, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, grace: 0.8 };
      this.items.push(it);
      this.emit({ e: "drop", id: it.id, k: kind, x: it.x, y: it.y });
    });
  };

  Sim.prototype.updateArrow = function (a, dt) {
    a.life -= dt;
    if (a.life <= 0) { a.dead = true; return; }
    const dist = a.speed * dt, steps = Math.max(1, Math.ceil(dist / 0.1));
    const sx = (a.dx * dist) / steps, sy = (a.dy * dist) / steps;
    for (let s = 0; s < steps; s++) {
      a.x += sx; a.y += sy;
      if (this.solidAt(a.x, a.y, true)) {
        a.x -= sx; a.y -= sy;
        a.dead = true;
        this.emit({ e: "thunk", x: a.x, y: a.y });
        return;
      }
      for (const e of this.enemies) {
        if (e.dead || U.dist2(a.x, a.y, e.x, e.y) >= e.radius * e.radius) continue;
        e.hurt(a.dmg, a.dx, a.dy, MAZE.WEAPONS.bow.knock, a.owner);
        this.emit({ e: "thunk", x: a.x, y: a.y, hit: 1 });
        a.dead = true;
        return;
      }
      if (this.pvp()) {
        for (const o of this.players) {
          if (!this.active(o) || o.seat === a.owner) continue;
          const r = P.radius + 0.06;
          if (U.dist2(a.x, a.y, o.x, o.y) >= r * r) continue;
          this.damagePlayer(o, a.dmg * P.pvpMul, a.dx, a.dy, a.owner, MAZE.WEAPONS.bow.knock);
          this.emit({ e: "thunk", x: a.x, y: a.y, hit: 1 });
          a.dead = true;
          return;
        }
      }
    }
  };

  // ----------------------------------------------------------- pickups --
  Sim.prototype.checkPickups = function (dt) {
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (it.grace > 0) { it.grace -= dt || 0.05; continue; }
      for (const p of this.players) {
        if (!this.active(p) || U.dist2(p.x, p.y, it.x, it.y) > 0.28) continue;
        if (!this.applyPickup(p, it.kind)) continue;
        this.items.splice(i, 1); i--;
        this.emit({ e: "pick", s: p.seat, id: it.id, k: it.kind });
        break;
      }
    }
  };

  Sim.prototype.applyPickup = function (p, kind) {
    const s = p.stats;
    switch (kind) {
      case T.SWORD: p.weapons.sword = true; p.weapon = "sword"; s.score += 100; return true;
      case T.BOW:
        p.weapons.bow = true;
        if (p.arrows === 0) p.arrows = 5;
        if (p.weapon === "fist") p.weapon = "bow";
        s.score += 100; return true;
      case T.SHIELD: p.has.shield = true; s.score += 100; return true;
      case T.ARROWS: p.arrows += 8; return true;
      case T.POTION:
        if (p.hp >= p.maxHp) return false;           // leave it for when you need it
        p.hp = Math.min(p.maxHp, p.hp + 45); return true;
      case T.KEY:
        p.has.key = true;
        if (this.mode === "coop") this.teamKey = true;
        s.score += 150; return true;
      case T.BOOTS: p.has.boots = true; s.score += 150; return true;
      case T.TORCH: p.has.torch = true; s.score += 150; return true;
      case T.TREASURE: s.treasure++; s.score += 250; return true;
    }
    return false;
  };

  // --------------------------------------------------------- exit + end --
  Sim.prototype.checkExit = function () {
    if (!this.exit || this.ended) return;
    for (const p of this.players) {
      if (!this.active(p) || U.dist2(p.x, p.y, this.exit.x, this.exit.y) >= 0.2) continue;
      p.escaped = true;
      p.place = this.players.filter((o) => o && o.escaped).length;
      const s = p.stats;
      s.timeBonus = Math.max(0, Math.round(2000 - s.time * 12));
      s.hpBonus = Math.round(p.hp * 5);
      s.score += s.timeBonus + s.hpBonus;
      if (this.mode === "versus") s.score += 1500;
      this.emit({ e: "escape", s: p.seat, place: p.place });
      if (this.mode !== "coop") { this.finish(p.seat); return; }
    }
  };

  Sim.prototype.checkEnd = function () {
    if (this.ended) return;
    const here = this.players.filter((p) => p && !p.away);
    if (!here.length) return;
    if (this.mode === "solo") {
      if (here.some((p) => p.dead)) this.finish(null);
      return;
    }
    if (this.mode === "coop") {
      const inside = here.filter((p) => !p.escaped);
      if (!inside.length) { this.finish(null); return; }
      // nobody left standing and nobody made it out: the maze wins
      if (inside.every((p) => p.dead) && !here.some((p) => p.escaped)) {
        for (const p of inside) p.respawnT = 0;
        this.finish(null);
        return;
      }
      // the last one standing escaping leaves fallen friends to respawn at the start
    }
  };

  Sim.prototype.finish = function (winner) {
    if (this.ended) return;
    this.ended = true;
    const players = this.players.filter(Boolean);
    let outcome;
    if (this.mode === "versus") outcome = "won";
    else if (players.some((p) => p.escaped)) outcome = "escaped";
    else outcome = this.mode === "solo" ? "dead" : "wiped";
    if (this.mode !== "versus") {
      const all = this.totalTreasure > 0 && players.reduce((n, p) => n + p.stats.treasure, 0) === this.totalTreasure;
      if (all) for (const p of players) if (p.escaped) { p.stats.allTreasure = 1; p.stats.score += 1000; }
    }
    this.result = {
      mode: this.mode, outcome: outcome, winner: winner, time: this.time, totalTreasure: this.totalTreasure,
      players: players.map((p) => ({
        seat: p.seat, name: p.name, escaped: p.escaped, dead: p.dead, away: p.away, place: p.place,
        stats: Object.assign({}, p.stats, { score: Math.round(p.stats.score), damage: Math.round(p.stats.damage) })
      }))
    };
    this.emit({ e: "end", result: this.result });
  };

  // ------------------------------------------------------- state to send --
  // Everything a client needs to build the world on joining or rejoining.
  Sim.prototype.fullState = function () {
    return {
      mode: this.mode, name: this.level.name, cols: this.cols, rows: this.rows,
      walls: Array.from(this.walls), exit: this.exit ? { cx: this.exit.cx, cy: this.exit.cy } : null,
      items: this.items.map((it) => [it.id, it.kind, round2(it.x), round2(it.y)]),
      totalTreasure: this.totalTreasure, time: this.time, freeze: this.freeze,
      players: this.players.filter(Boolean).map((p) => this.publicPlayer(p))
    };
  };

  Sim.prototype.publicPlayer = function (p) {
    return {
      seat: p.seat, name: p.name, x: round2(p.x), y: round2(p.y), ang: round2(p.ang), pitch: round2(p.pitch),
      hp: Math.ceil(p.hp), dead: p.dead, escaped: p.escaped, away: p.away, w: WEAPON_IDX[p.weapon],
      blk: p.blocking ? 1 : 0, mv: p.moving ? 1 : 0, ep: p.epoch, rv: p.reviveT > 0 ? round2(p.reviveT / P.reviveTime) : 0
    };
  };

  // What changes every tick, compact: one array per thing.
  Sim.prototype.snapshot = function () {
    const ps = [], bs = [], as = [];
    for (const p of this.players) {
      if (!p) continue;
      const flags = (p.dead ? 1 : 0) | (p.escaped ? 2 : 0) | (p.blocking ? 4 : 0) | (p.away ? 8 : 0) | (p.moving ? 16 : 0) | (p.invuln > 0.25 ? 32 : 0) |
        (p.has.torch ? 64 : 0) | (p.has.shield ? 128 : 0);
      ps.push([p.seat, round2(p.x), round2(p.y), round2(p.ang), round2(p.pitch), Math.ceil(p.hp), flags, WEAPON_IDX[p.weapon], p.epoch,
        p.reviveT > 0 ? round2(p.reviveT / P.reviveTime) : 0, p.respawnT > 0 ? Math.ceil(p.respawnT) : 0]);
    }
    for (const e of this.enemies) {
      if (e.dead) continue;
      bs.push([e.id, e.kind, round2(e.x), round2(e.y), e.windup > 0 ? round2(1 - e.windup / WINDUP) : 0, round2(e.flash), round2(e.hp / e.maxHp)]);
    }
    for (const a of this.arrows) as.push([a.id, round2(a.x), round2(a.y), round2(a.dx), round2(a.dy), a.speed]);
    return { time: round2(this.time), freeze: round2(this.freeze), p: ps, b: bs, a: as };
  };

  // the parts of a player only that player needs
  Sim.prototype.privateState = function (seat) {
    const p = this.players[seat];
    if (!p) return null;
    return {
      hp: Math.ceil(p.hp), weapons: Object.keys(p.weapons), weapon: p.weapon, arrows: p.arrows,
      has: { key: this.hasKey(p), shield: p.has.shield, boots: p.has.boots, torch: p.has.torch },
      stats: { time: round2(p.stats.time), kills: p.stats.kills, frags: p.stats.frags, deaths: p.stats.deaths, score: Math.round(p.stats.score), treasure: p.stats.treasure, secrets: p.stats.secrets },
      respawn: p.respawnT > 0 ? round2(p.respawnT) : 0, ep: p.epoch
    };
  };

  function round2(v) { return Math.round(v * 100) / 100; }

  // -------------------------------------------------------------- blob --
  function SimBlob(sim, x, y, kind) {
    const def = MAZE.THINGS[kind];
    this.sim = sim;
    this.id = sim.nextId++;
    this.kind = kind;
    this.def = def;
    this.x = x; this.y = y;
    this.radius = def.radius;
    this.hp = def.hp; this.maxHp = def.hp;
    this.speed = def.speed;
    this.dmg = def.dmg;
    this.vx = 0; this.vy = 0;          // knockback velocity
    this.flash = 0;
    this.attackCd = 0;
    this.windup = 0;                   // > 0 while rearing up to bite
    this.growlCd = 2 + sim.rnd() * 6;
    this.dead = false;
    this.alerted = false;
    this.target = -1;
  }

  SimBlob.prototype.hurt = function (dmg, dirX, dirY, knock, by) {
    if (this.dead) return;
    const sim = this.sim;
    this.hp -= dmg;
    this.flash = 0.75;
    this.alerted = true;
    const k = knock || 0.5;
    this.vx += dirX * k * 6;
    this.vy += dirY * k * 6;
    const killer = by >= 0 ? sim.players[by] : null;
    if (this.hp <= 0) {
      this.dead = true;
      if (killer) { killer.stats.kills++; killer.stats.score += this.def.score; }
    }
    sim.emit({ e: "blob", b: this.id, k: this.kind, s: by == null ? -1 : by, x: round2(this.x), y: round2(this.y), dead: this.dead ? 1 : 0 });
  };

  SimBlob.prototype.update = function (dt) {
    const sim = this.sim;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3);
    if (this.attackCd > 0) this.attackCd -= dt;
    this.vx *= Math.pow(0.02, dt);
    this.vy *= Math.pow(0.02, dt);

    // the nearest player it can see wins; otherwise the flow field picks by path length
    let target = null, td = 1e9, seen = false;
    for (const p of sim.players) {
      if (!sim.active(p)) continue;
      const d = Math.hypot(p.x - this.x, p.y - this.y);
      const los = d < 14 && sim.lineOfSight(this.x, this.y, p.x, p.y);
      if ((los && !seen) || ((los || !seen) && d < td)) { target = p; td = d; seen = los; }
    }
    if (!target) { this.windup = 0; return; }
    const ddx = target.x - this.x, ddy = target.y - this.y;
    const d = Math.hypot(ddx, ddy) || 1e-6;
    this.target = target.seat;

    this.growlCd -= dt;
    if (this.growlCd <= 0) {
      this.growlCd = 3 + sim.rnd() * 7;
      if (d < 9) sim.emit({ e: "growl", b: this.id });
    }
    if (!this.alerted && d < 3.5) this.alerted = true;   // close enough to hear you

    let tx = 0, ty = 0;
    if (seen) {
      this.alerted = true;
      tx = ddx / d; ty = ddy / d;
    } else {
      // follow the flow field downhill toward the nearest player
      const cx = this.x | 0, cy = this.y | 0;
      let bestV = sim.flowAt(cx, cy), bx = 0, by = 0;
      for (let i = 0; i < 4; i++) {
        const v = sim.flowAt(cx + DIRS[i][0], cy + DIRS[i][1]);
        if (v >= 0 && (bestV < 0 || v < bestV)) { bestV = v; bx = DIRS[i][0]; by = DIRS[i][1]; }
      }
      if (bx || by) {
        // steer to the centre of the next tile so it does not clip corners
        const ddx2 = cx + bx + 0.5 - this.x, ddy2 = cy + by + 0.5 - this.y;
        const dd = Math.hypot(ddx2, ddy2) || 1e-6;
        tx = ddx2 / dd; ty = ddy2 / dd;
      } else if (this.alerted) {
        tx = ddx / d; ty = ddy / d;
      }
    }

    // Once in biting range, hold position. Pressing on would carry the blob
    // into the camera, where it cannot be seen or hit.
    const minSep = this.radius + P.radius;
    if (d < minSep + 0.06) { tx = 0; ty = 0; }

    // keep blobs from stacking into a single super-blob, and off every player
    let sx = 0, sy = 0;
    for (const o of sim.enemies) {
      if (o === this || o.dead) continue;
      const ox = this.x - o.x, oy = this.y - o.y, od2 = ox * ox + oy * oy, want = this.radius + o.radius;
      if (od2 > 0.0001 && od2 < want * want) {
        const od = Math.sqrt(od2);
        sx += (ox / od) * (1 - od / want);
        sy += (oy / od) * (1 - od / want);
      }
    }
    for (const p of sim.players) {
      if (!sim.active(p)) continue;
      const ox = this.x - p.x, oy = this.y - p.y, od = Math.hypot(ox, oy), want = this.radius + P.radius;
      if (od > 0.0001 && od < want) { sx += (ox / od) * (1 - od / want) * 2; sy += (oy / od) * (1 - od / want) * 2; }
    }

    const sp = this.speed * (this.alerted ? 1 : 0.6);
    const mvx = (tx * sp + sx * 2.2) * dt + this.vx * dt;
    const mvy = (ty * sp + sy * 2.2) * dt + this.vy * dt;
    sim.moveCircle(this, mvx, mvy, this.radius, true);

    // Attack: rear up first so every bite can be seen and heard coming,
    // and whiffs if you back off during the wind-up.
    const reach = minSep + 0.2;
    if (this.windup > 0) {
      this.windup -= dt;
      if (d > reach + 0.15 || !sim.active(target)) {
        this.windup = 0;
      } else if (this.windup <= 0) {
        this.windup = 0;
        this.attackCd = 0.85;
        sim.damagePlayer(target, this.dmg, ddx / d, ddy / d, -1, 0);
      }
    } else if (d < reach && this.attackCd <= 0) {
      this.windup = WINDUP;
      sim.emit({ e: "windup", b: this.id });
    }
  };

  Sim.WINDUP = WINDUP;
  MAZE.Sim = Sim;
})();
