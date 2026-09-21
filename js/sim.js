/* MAZE — the authoritative world: monsters, projectiles, items, doors, floors, combat,
   levelling, magic, respawns and win rules.
   The same file runs in the browser for solo play and inside server.js for online rooms,
   so both play by exactly the same rules. No DOM and no audio in here: it reports what
   happened as events, and each client decides how that looks and sounds.

   Players move themselves (client side, for responsive controls) and report where they
   are through move(); everything else is decided here. Every body has a floor, f. */
(function () {
  const MAZE = window.MAZE;
  const U = MAZE.util, W = MAZE.W, T = MAZE.T, P = MAZE.PLAYER, L = MAZE.Level;
  const WINDUP = 0.4;
  const WEAPON_IDX = { fist: 0, sword: 1, bow: 2, magic: 3 };
  const SHOT_KIND = { arrow: 0, fire: 1, frost: 2, spit: 3 };
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const STAT_IDS = MAZE.STATS.map((s) => s.id);

  function Sim(level, opts) {
    opts = opts || {};
    this.level = L.clone(level);
    this.mode = MAZE.MODES[opts.mode] ? opts.mode : "solo";
    this.rnd = U.rng(opts.seed == null ? (Math.random() * 1e9) | 0 : opts.seed);
    const lv = this.level;
    this.cols = lv.cols; this.rows = lv.rows; this.floors = lv.floors || 1;
    this.plane = lv.cols * lv.rows;
    this.walls = new Uint8Array(lv.walls);
    this.stairs = new Uint8Array(lv.things.length);
    for (let i = 0; i < lv.things.length; i++) if (L.isStair(lv.things[i])) this.stairs[i] = lv.things[i];
    this.flow = new Int32Array(this.plane * this.floors).fill(-1);
    this._queue = new Int32Array(this.plane * this.floors);
    this.flowTimer = 0;
    this.time = 0;
    this.freeze = opts.freeze || 0;          // monsters hold still for the countdown
    this.ended = false;
    this.result = null;
    this.events = [];
    this.nextId = 1;
    this.enemies = [];
    this.items = [];
    this.shots = [];
    this.players = [];
    this.teamKey = false;
    this.totalTreasure = 0;
    this.exit = null;

    for (let i = 0; i < lv.things.length; i++) {
      const id = lv.things[i];
      if (!id || this.walls[i] !== W.EMPTY) continue;
      const c = L.cellOf(lv, i), x = c.x + 0.5, y = c.y + 0.5;
      if (id === T.FINISH) { this.exit = { x, y, cx: c.x, cy: c.y, f: c.f }; continue; }
      if (id >= MAZE.CUSTOM_BASE) { const d = this.def(id); if (d) this.enemies.push(new SimBlob(this, x, y, c.f, id)); continue; }
      const def = MAZE.THINGS[id];
      if (!def || def.cat === "marker" || def.cat === "floor") continue;
      if (def.cat === "enemy") this.enemies.push(new SimBlob(this, x, y, c.f, id));
      else {
        this.items.push({ id: this.nextId++, kind: id, x, y, f: c.f });
        if (id === T.TREASURE) this.totalTreasure++;
      }
    }
    this.spawns = L.spawnPoints(lv).map((c) => ({ x: c.x + 0.5, y: c.y + 0.5, f: c.f || 0, ang: this.openAngle(c.x, c.y, c.f || 0) }));
  }

  Sim.WEAPON_IDX = WEAPON_IDX;
  Sim.WEAPON_BY_IDX = ["fist", "sword", "bow", "magic"];
  Sim.SHOT_BY_IDX = ["arrow", "fire", "frost", "spit"];
  Sim.prototype.def = function (kind) { return L.monsterDef(this.level, kind); };

  // ------------------------------------------------------------ players --
  Sim.prototype.addPlayer = function (seat, name) {
    const sp = this.spawns[seat] || this.spawns[0];
    const p = {
      seat: seat, name: name || "Player " + (seat + 1),
      x: sp.x, y: sp.y, f: sp.f, ang: sp.ang, pitch: 0,
      hp: P.maxHp, mana: P.baseMana,
      dead: false, escaped: false, away: false, place: 0,
      respawnT: 0, reviveT: 0, reviver: -1, invuln: 0,
      weapon: "fist", weapons: { fist: true },
      has: { key: false, shield: false, boots: false, torch: false },
      arrows: 0, blocking: false, using: false, moving: false,
      atkCd: 0, climbCd: 0, pending: null, lastMove: this.time, epoch: 1,
      // stats: points spent levelling up; score: the round's tally for the results table
      level: 1, xp: 0, points: 0, stats: { atk: 0, spd: 0, def: 0, vit: 0, mag: 0 },
      spells: [], spell: null, scrolls: [],
      poison: 0, slow: 0, ward: 0,
      secrets: new Uint8Array(this.plane * this.floors),
      score: { time: 0, kills: 0, frags: 0, deaths: 0, score: 0, treasure: 0, secrets: 0, damage: 0, doors: 0 }
    };
    this.players[seat] = p;
    return p;
  };

  // what a player's stats come to
  Sim.maxHp = (p) => P.maxHp + 15 * p.stats.vit;
  Sim.maxMana = (p) => P.baseMana + 20 * p.stats.mag;
  Sim.speedMul = (p) => (p.has.boots ? 1.4 : 1) * (1 + 0.05 * p.stats.spd) * (p.slow > 0 ? 0.6 : 1);
  Sim.dmgMul = (p) => 1 + 0.1 * p.stats.atk;
  Sim.defMul = (p) => 1 - Math.min(0.6, 0.07 * p.stats.def);
  Sim.spellMul = (p) => 1 + 0.08 * p.stats.mag;

  Sim.prototype.player = function (seat) { return this.players[seat] || null; };
  Sim.prototype.eachPlayer = function (fn) { for (const p of this.players) if (p) fn(p); };
  Sim.prototype.hasKey = function (p) { return p.has.key || (this.mode === "coop" && this.teamKey); };
  // in the maze and able to act (the only players monsters hunt)
  Sim.prototype.active = (p) => p && !p.dead && !p.escaped && !p.away;

  Sim.prototype.setAway = function (seat, away) {
    const p = this.players[seat];
    if (!p || p.away === !!away) return;
    p.away = !!away;
    this.emit({ e: "away", s: seat, away: p.away });
    this.checkEnd();
  };

  // The client says where it is. Anything impossible (through a wall, faster than its
  // speed allows, on the wrong floor, or from before a respawn) is refused, and the
  // caller tells that client where it really is.
  Sim.prototype.move = function (seat, m) {
    const p = this.players[seat];
    if (!p || p.escaped) return true;
    if (m.ep !== undefined && m.ep !== p.epoch) return true;          // stale, from a previous life
    if (m.f !== undefined && m.f !== p.f) return true;                // stale, from before climbing
    if (Number.isFinite(m.ang)) p.ang = m.ang;
    if (Number.isFinite(m.pitch)) p.pitch = U.clamp(m.pitch, -0.6, 0.6);
    p.blocking = !!m.blk && p.has.shield && !p.dead;
    p.using = !!m.use && !p.dead;
    const w = Sim.WEAPON_BY_IDX[m.w];
    if (w && this.owns(p, w) && p.weapon !== w) { p.weapon = w; p.pending = null; }
    if (typeof m.sp === "string" && p.spells.indexOf(m.sp) >= 0) p.spell = m.sp;
    if (p.dead || !Number.isFinite(m.x) || !Number.isFinite(m.y)) return true;
    const elapsed = Math.max(0.05, this.time - p.lastMove);
    const fast = Math.max(Sim.speedMul(p), (p.has.boots ? 1.4 : 1) * (1 + 0.05 * p.stats.spd));
    const maxStep = P.speed * fast * P.sprintMul * 1.35 * elapsed + 0.6;
    const d = Math.hypot(m.x - p.x, m.y - p.y);
    if (d > maxStep || this.boxBlocked(m.x, m.y, P.radius * 0.6, false, p.f)) return false;
    p.moving = d > 0.002;
    p.x = m.x; p.y = m.y;
    p.lastMove = this.time;
    return true;
  };

  Sim.prototype.owns = function (p, w) { return w === "magic" ? p.spells.length > 0 : !!p.weapons[w]; };

  Sim.prototype.attack = function (seat) {
    const p = this.players[seat];
    if (!this.active(p) || p.atkCd > 0 || this.ended) return false;
    const w = MAZE.WEAPONS[p.weapon];
    if (w.kind === "magic") return this.cast(p);
    if (w.kind === "ranged") {
      if (p.arrows <= 0) return false;
      p.arrows--;
      p.atkCd = w.cd;
      this.shoot(p, "arrow", w.dmg * Sim.dmgMul(p), w.speed, { knock: w.knock });
      this.emit({ e: "shoot", s: seat });
    } else {
      p.atkCd = w.cd;
      p.pending = { t: w.cd * 0.45, weapon: p.weapon };   // damage lands mid-swing
      this.emit({ e: "swing", s: seat, w: WEAPON_IDX[p.weapon] });
    }
    return true;
  };

  Sim.prototype.shoot = function (p, kind, dmg, speed, extra) {
    const dx = Math.cos(p.ang), dy = Math.sin(p.ang);
    const s = Object.assign({ id: this.nextId++, kind: kind, owner: p.seat, x: p.x + dx * 0.4, y: p.y + dy * 0.4, f: p.f, dx: dx, dy: dy, dmg: dmg, speed: speed, life: 3 }, extra || {});
    this.shots.push(s);
    return s;
  };

  // ------------------------------------------------------------- magic --
  Sim.prototype.cast = function (p) {
    const sp = MAZE.SPELLS[p.spell];
    if (!sp || p.spells.indexOf(sp.id) < 0) return false;
    if (p.mana < sp.cost) { this.emit({ e: "nomana", s: p.seat }); return false; }
    const pow = Sim.spellMul(p);
    p.atkCd = MAZE.WEAPONS.magic.cd;
    p.mana -= sp.cost;
    this.emit({ e: "cast", s: p.seat, sp: sp.id, f: p.f });
    if (sp.id === "fire") this.shoot(p, "fire", 36 * pow, 9, { splash: 1.25 });
    else if (sp.id === "frost") this.shoot(p, "frost", 20 * pow, 13, { chill: 3 });
    else if (sp.id === "heal") {
      const amt = 32 + 6 * p.stats.mag;
      p.hp = Math.min(Sim.maxHp(p), p.hp + amt);
      p.poison = 0;
      const healed = [p.seat];
      if (this.mode === "coop") for (const o of this.players) {
        if (!this.active(o) || o === p || o.f !== p.f || U.dist(o.x, o.y, p.x, p.y) > 3) continue;
        o.hp = Math.min(Sim.maxHp(o), o.hp + amt * 0.6);
        o.poison = 0;
        healed.push(o.seat);
      }
      this.emit({ e: "heal", s: p.seat, who: healed, f: p.f });
    } else if (sp.id === "bolt") this.chainLightning(p, 30 * pow);
    else if (sp.id === "blink") this.blink(p);
    else if (sp.id === "ward") { p.ward = 6; this.emit({ e: "ward", s: p.seat, f: p.f }); }
    return true;
  };

  // instant lightning down the line of sight, then jumping to up to two more nearby foes
  Sim.prototype.chainLightning = function (p, dmg) {
    const pts = [[round2(p.x), round2(p.y)]];
    const hit = new Set();
    const foes = () => {
      const out = [];
      for (const e of this.enemies) if (!e.dead && e.f === p.f) out.push(e);
      if (this.pvp()) for (const o of this.players) if (this.active(o) && o !== p && o.f === p.f) out.push(o);
      return out;
    };
    // first target: nearest body close to the aim line
    const dx = Math.cos(p.ang), dy = Math.sin(p.ang);
    let first = null, fd = 1e9, x = p.x, y = p.y;
    for (let s = 0; s < 55; s++) {
      x += dx * 0.18; y += dy * 0.18;
      if (this.solidAt(x, y, true, p.f)) break;
      for (const t of foes()) {
        const r = (t.radius || P.radius) + 0.25;
        if (U.dist2(x, y, t.x, t.y) < r * r) { const d = U.dist(p.x, p.y, t.x, t.y); if (d < fd) { fd = d; first = t; } }
      }
      if (first) break;
    }
    if (!first) { pts.push([round2(x), round2(y)]); this.emit({ e: "bolt", s: p.seat, pts: pts, f: p.f }); return; }
    let cur = first, power = dmg;
    for (let jump = 0; jump < 3 && cur; jump++) {
      hit.add(cur);
      pts.push([round2(cur.x), round2(cur.y)]);
      this.strike(p, cur, power, cur.x - p.x, cur.y - p.y, 0.3);
      power *= 0.75;
      let next = null, nd = 3.6;
      for (const t of foes()) {
        if (hit.has(t) || t.dead) continue;
        const d = U.dist(cur.x, cur.y, t.x, t.y);
        if (d < nd && this.lineOfSight(cur.x, cur.y, t.x, t.y, p.f)) { nd = d; next = t; }
      }
      cur = next;
    }
    this.emit({ e: "bolt", s: p.seat, pts: pts, f: p.f });
  };

  // hurt a monster or a player on behalf of player p
  Sim.prototype.strike = function (p, target, dmg, dx, dy, knock, extra) {
    const d = Math.hypot(dx, dy) || 1;
    if (target instanceof SimBlob) { target.hurt(dmg, dx / d, dy / d, knock, p.seat); if (extra && extra.chill && !target.dead) target.slow = extra.chill; }
    else { this.damagePlayer(target, dmg * P.pvpMul, dx / d, dy / d, p.seat, knock); if (extra && extra.chill) target.slow = extra.chill; }
  };

  Sim.prototype.blink = function (p) {
    const dx = Math.cos(p.ang), dy = Math.sin(p.ang), fx = p.x, fy = p.y;
    let x = p.x, y = p.y;
    for (let s = 0; s < 45; s++) {
      const nx = x + dx * 0.1, ny = y + dy * 0.1;
      if (this.boxBlocked(nx, ny, P.radius, false, p.f)) break;
      x = nx; y = ny;
    }
    p.x = x; p.y = y;
    p.epoch++;
    p.lastMove = this.time;
    this.emit({ e: "blink", s: p.seat, x: round2(x), y: round2(y), fx: round2(fx), fy: round2(fy), f: p.f, ep: p.epoch });
  };

  // learn a scroll you carry; the stronger ones need points in Mana first
  Sim.prototype.learn = function (seat, spell) {
    const p = this.players[seat], sp = MAZE.SPELLS[spell];
    if (!p || !sp || p.dead) return false;
    const at = p.scrolls.indexOf(spell);
    if (at < 0) return false;
    if (p.spells.indexOf(spell) >= 0) { this.emit({ e: "nolearn", s: seat, sp: spell, why: "known" }); return false; }
    const need = MAZE.TIER_NEEDS[sp.tier];
    if (p.stats.mag < need) { this.emit({ e: "nolearn", s: seat, sp: spell, why: "mana", need: need }); return false; }
    p.scrolls.splice(at, 1);
    p.spells.push(spell);
    p.spells.sort((a, b) => MAZE.SPELL_ORDER.indexOf(a) - MAZE.SPELL_ORDER.indexOf(b));
    if (!p.spell) p.spell = spell;
    p.score.score += 50 * sp.tier;
    this.emit({ e: "learn", s: seat, sp: spell });
    return true;
  };

  // spend a stat point
  Sim.prototype.allocate = function (seat, stat) {
    const p = this.players[seat];
    if (!p || p.points <= 0 || STAT_IDS.indexOf(stat) < 0 || p.stats[stat] >= 15) return false;
    p.points--;
    p.stats[stat]++;
    if (stat === "vit") p.hp += 15;
    if (stat === "mag") p.mana += 20;
    this.emit({ e: "stat", s: seat, k: stat, v: p.stats[stat] });
    return true;
  };

  // Put something you carry on the floor in front of you, for someone else to take.
  // what: "scroll:<spell>", "sword", "bow", "arrows", "shield", "boots", "torch" or "key".
  Sim.prototype.drop = function (seat, what) {
    const p = this.players[seat];
    if (!this.active(p) || typeof what !== "string") return false;
    let kind = 0, amount = 0;
    if (what.indexOf("scroll:") === 0) {
      const sp = what.slice(7), at = p.scrolls.indexOf(sp);
      if (at < 0 || !MAZE.SPELLS[sp]) return false;
      p.scrolls.splice(at, 1);
      kind = MAZE.SPELLS[sp].scroll;
    } else if (what === "sword" || what === "bow") {
      if (!p.weapons[what]) return false;
      delete p.weapons[what];
      if (p.weapon === what) p.weapon = "fist";
      kind = what === "sword" ? T.SWORD : T.BOW;
    } else if (what === "arrows") {
      if (p.arrows <= 0) return false;
      amount = Math.min(8, p.arrows);
      p.arrows -= amount;
      kind = T.ARROWS;
    } else if (what === "shield" || what === "boots" || what === "torch") {
      if (!p.has[what]) return false;
      p.has[what] = false;
      if (what === "shield") p.blocking = false;
      kind = what === "shield" ? T.SHIELD : what === "boots" ? T.BOOTS : T.TORCH;
    } else if (what === "key") {
      if (!p.has.key || this.mode === "coop") return false;    // in co-op the key already works for everyone
      p.has.key = false;
      kind = T.KEY;
    } else return false;
    // in front of you if there is room, otherwise at your feet
    let x = p.x + Math.cos(p.ang) * 0.6, y = p.y + Math.sin(p.ang) * 0.6;
    if (this.solidAt(x, y, false, p.f)) { x = p.x; y = p.y; }
    const it = { id: this.nextId++, kind: kind, x: x, y: y, f: p.f, keepFrom: seat, keepT: 1.5 };
    if (amount) it.amount = amount;
    this.items.push(it);
    this.emit({ e: "drop", id: it.id, k: kind, x: round2(x), y: round2(y), f: p.f, s: seat });
    return true;
  };

  // go up or down the stairs or ladder you are standing on
  Sim.prototype.climb = function (seat) {
    const p = this.players[seat];
    if (!this.active(p) || p.climbCd > 0) return false;
    const cx = Math.floor(p.x), cy = Math.floor(p.y), i = p.f * this.plane + cy * this.cols + cx;
    const t = this.stairs[i];
    if (!t || U.dist(p.x, p.y, cx + 0.5, cy + 0.5) > 0.55) return false;
    const nf = p.f + MAZE.STAIR_DIR[t];
    if (nf < 0 || nf >= this.floors) return false;
    p.f = nf; p.x = cx + 0.5; p.y = cy + 0.5;
    p.climbCd = 0.5;
    p.epoch++;
    p.lastMove = this.time;
    this.emit({ e: "climb", s: seat, f: nf, x: p.x, y: p.y, ep: p.epoch, up: MAZE.STAIR_DIR[t] > 0 ? 1 : 0, ladder: t === T.LADDER_UP || t === T.LADDER_DOWN ? 1 : 0 });
    this.updateFlow();
    return true;
  };

  // open the door at (tx, ty) on your floor if you are next to it and hold the key
  Sim.prototype.openDoor = function (seat, tx, ty) {
    const p = this.players[seat];
    if (!this.active(p) || this.tileAt(tx, ty, p.f) !== W.DOOR) return false;
    if (U.dist(p.x, p.y, tx + 0.5, ty + 0.5) > 1.75) return false;
    if (!this.hasKey(p)) { this.emit({ e: "locked", s: seat }); return false; }
    this.walls[p.f * this.plane + ty * this.cols + tx] = W.EMPTY;
    p.score.doors++;
    p.score.score += 150;
    this.emit({ e: "door", s: seat, x: tx, y: ty, f: p.f });
    this.updateFlow();
    return true;
  };

  Sim.prototype.ping = function (seat, x, y) {
    const p = this.players[seat];
    if (!p || p.away || !Number.isFinite(x) || !Number.isFinite(y)) return;
    if ((p._pingT || -9) > this.time - 0.8) return;
    p._pingT = this.time;
    this.emit({ e: "ping", s: seat, x: U.clamp(x, 0, this.cols), y: U.clamp(y, 0, this.rows), f: p.f });
  };

  // --------------------------------------------------------------- map --
  Sim.prototype.tileAt = function (tx, ty, f) {
    if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return W.BRICK;
    return this.walls[(f || 0) * this.plane + ty * this.cols + tx];
  };
  Sim.prototype.solidTile = function (tx, ty, forAI, f) {
    const t = this.tileAt(tx, ty, f);
    if (t === W.EMPTY) return false;
    if (t === W.SECRET) return !!forAI;
    return true;
  };
  Sim.prototype.solidAt = function (x, y, forAI, f) { return this.solidTile(Math.floor(x), Math.floor(y), forAI, f); };
  Sim.prototype.boxBlocked = function (x, y, r, forAI, f) {
    const x0 = Math.floor(x - r), x1 = Math.floor(x + r), y0 = Math.floor(y - r), y1 = Math.floor(y + r);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++)
        if (this.solidTile(tx, ty, forAI, f)) return true;
    return false;
  };
  Sim.prototype.moveCircle = function (ent, dx, dy, r, forAI) {
    if (dx && !this.boxBlocked(ent.x + dx, ent.y, r, forAI, ent.f)) ent.x += dx;
    if (dy && !this.boxBlocked(ent.x, ent.y + dy, r, forAI, ent.f)) ent.y += dy;
  };
  Sim.prototype.lineOfSight = function (x0, y0, x1, y1, f) {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
    if (len < 0.001) return true;
    const steps = Math.ceil(len / 0.2), sx = dx / steps, sy = dy / steps;
    let x = x0, y = y0;
    for (let i = 0; i < steps; i++) {
      x += sx; y += sy;
      const t = this.tileAt(Math.floor(x), Math.floor(y), f);
      if (t !== W.EMPTY && MAZE.WALLS[t] && MAZE.WALLS[t].opaque) return false;
    }
    return true;
  };
  Sim.prototype.openAngle = function (cx, cy, f) {
    for (const d of [[1, 0], [0, 1], [-1, 0], [0, -1]])
      if (!this.solidTile(cx + d[0], cy + d[1], false, f)) return Math.atan2(d[1], d[0]);
    return 0;
  };
  Sim.prototype.flowAt = function (i) { return i < 0 || i >= this.flow.length ? -1 : this.flow[i]; };
  // the cell reached by taking the stairs in cell i, or -1
  Sim.prototype.stairLink = function (i) {
    const t = this.stairs[i];
    if (!t) return -1;
    const j = i + MAZE.STAIR_DIR[t] * this.plane;
    return j >= 0 && j < this.stairs.length && this.stairs[j] === MAZE.STAIR_PAIR[t] ? j : -1;
  };

  // BFS out from every player monsters can hunt, over tiles monsters can use, across
  // floors by the stairs: each monster walks downhill to whoever is nearest by path.
  Sim.prototype.updateFlow = function () {
    const flow = this.flow, q = this._queue, cols = this.cols, rows = this.rows, plane = this.plane;
    flow.fill(-1);
    let head = 0, tail = 0;
    for (const p of this.players) {
      if (!this.active(p)) continue;
      const sx = Math.floor(p.x), sy = Math.floor(p.y);
      if (sx < 0 || sy < 0 || sx >= cols || sy >= rows) continue;
      const s = p.f * plane + sy * cols + sx;
      if (flow[s] === 0) continue;
      flow[s] = 0; q[tail++] = s;
    }
    const visit = (ni, d) => {
      if (flow[ni] !== -1) return;
      const t = this.walls[ni];
      if (t !== W.EMPTY) return;          // monsters cannot use doors or secret walls
      flow[ni] = d; q[tail++] = ni;
    };
    while (head < tail) {
      const cur = q[head++];
      const r = cur % plane, cx = r % cols, cy = (r / cols) | 0, d = flow[cur] + 1;
      if (cx + 1 < cols) visit(cur + 1, d);
      if (cx > 0) visit(cur - 1, d);
      if (cy + 1 < rows) visit(cur + cols, d);
      if (cy > 0) visit(cur - cols, d);
      const j = this.stairLink(cur);
      if (j >= 0) visit(j, d);
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

    if (!this.freeze) for (let i = 0; i < this.enemies.length; i++) if (!this.enemies[i].dead) this.enemies[i].update(dt);
    for (let i = this.enemies.length - 1; i >= 0; i--) if (this.enemies[i].dead) this.enemies.splice(i, 1);

    for (let i = this.shots.length - 1; i >= 0; i--) {
      this.updateShot(this.shots[i], dt);
      if (this.shots[i].dead) this.shots.splice(i, 1);
    }

    this.checkPickups(dt);
    this.checkExit();
    this.checkEnd();
  };

  Sim.prototype.updatePlayer = function (p, dt) {
    if (p.away) return;
    if (!p.escaped) p.score.time += dt;
    if (p.atkCd > 0) p.atkCd -= dt;
    if (p.climbCd > 0) p.climbCd -= dt;
    if (p.invuln > 0) p.invuln -= dt;
    if (p.ward > 0) p.ward = Math.max(0, p.ward - dt);
    if (p.slow > 0) p.slow = Math.max(0, p.slow - dt);
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
    p.mana = Math.min(Sim.maxMana(p), p.mana + (1.4 + 0.45 * p.stats.mag) * dt);
    if (p.poison > 0) {
      p.poison = Math.max(0, p.poison - dt);
      p.hp -= 3 * dt;
      p.score.damage += 3 * dt;
      if (p.hp <= 0) { this.kill(p, -1); return; }
    }
    // secret passages score once per player
    const tx = Math.floor(p.x), ty = Math.floor(p.y), i = p.f * this.plane + ty * this.cols + tx;
    if (this.tileAt(tx, ty, p.f) === W.SECRET && !p.secrets[i]) {
      p.secrets[i] = 1;
      p.score.secrets++;
      p.score.score += 300;
      this.grantXp(p, 20);
      this.emit({ e: "secret", s: p.seat, x: tx, y: ty, f: p.f });
    }
  };

  // co-op: a living teammate standing over a fallen one and holding E brings them back
  Sim.prototype.updateRevive = function (p, dt) {
    if (this.mode !== "coop") return;
    let helper = null;
    for (const o of this.players) {
      if (!this.active(o) || o === p || !o.using || o.f !== p.f) continue;
      if (U.dist(o.x, o.y, p.x, p.y) <= P.reviveRange) { helper = o; break; }
    }
    if (!helper) { if (p.reviveT) { p.reviveT = 0; p.reviver = -1; } return; }
    p.reviver = helper.seat;
    p.reviveT += dt;
    if (p.reviveT >= P.reviveTime) {
      this.respawn(p, false);
      p.hp = 40;
      helper.score.score += 200;
      this.grantXp(helper, 25);
      this.emit({ e: "revive", s: p.seat, by: helper.seat });
    }
  };

  Sim.prototype.respawn = function (p, atStart) {
    if (atStart) {
      const sp = this.spawns[p.seat] || this.spawns[0];
      p.x = sp.x; p.y = sp.y; p.f = sp.f; p.ang = sp.ang;
    }
    p.dead = false;
    p.hp = Sim.maxHp(p);
    p.poison = 0; p.slow = 0;
    p.respawnT = 0; p.reviveT = 0; p.reviver = -1;
    p.invuln = P.spawnShield;
    p.epoch++;
    p.lastMove = this.time;
    p.pending = null;
    this.emit({ e: "respawn", s: p.seat, x: p.x, y: p.y, f: p.f, ang: p.ang, ep: p.epoch });
  };

  // ---------------------------------------------------------- levelling --
  Sim.prototype.grantXp = function (p, amount) {
    if (!p || p.level >= MAZE.MAX_LEVEL) return;
    p.xp += Math.round(amount);
    while (p.level < MAZE.MAX_LEVEL && p.xp >= MAZE.xpFor(p.level)) {
      p.xp -= MAZE.xpFor(p.level);
      p.level++;
      p.points++;
      p.hp = Math.min(Sim.maxHp(p), p.hp + Sim.maxHp(p) * 0.3);   // a second wind
      p.mana = Math.min(Sim.maxMana(p), p.mana + Sim.maxMana(p) * 0.3);
      this.emit({ e: "levelup", s: p.seat, lv: p.level });
    }
    if (p.level >= MAZE.MAX_LEVEL) p.xp = 0;
  };

  // ------------------------------------------------------------ combat --
  Sim.prototype.pvp = function () { return this.mode === "versus"; };

  Sim.prototype.meleeHit = function (p, weapon) {
    const w = MAZE.WEAPONS[weapon];
    const dmg = w.dmg * Sim.dmgMul(p);
    let hits = 0;
    for (const e of this.enemies) {
      if (e.dead || e.f !== p.f) continue;
      const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy);
      if (d > w.range + e.radius) continue;
      if (Math.abs(U.angDiff(p.ang, Math.atan2(dy, dx))) > w.arc * 0.5) continue;
      if (!this.lineOfSight(p.x, p.y, e.x, e.y, p.f)) continue;
      e.hurt(dmg, dx / (d || 1), dy / (d || 1), w.knock, p.seat);
      hits++;
    }
    if (this.pvp()) {
      for (const o of this.players) {
        if (!this.active(o) || o === p || o.f !== p.f) continue;
        const dx = o.x - p.x, dy = o.y - p.y, d = Math.hypot(dx, dy);
        if (d > w.range + P.radius) continue;
        if (Math.abs(U.angDiff(p.ang, Math.atan2(dy, dx))) > w.arc * 0.5) continue;
        if (!this.lineOfSight(p.x, p.y, o.x, o.y, p.f)) continue;
        this.damagePlayer(o, dmg * P.pvpMul, dx / (d || 1), dy / (d || 1), p.seat, w.knock);
        hits++;
      }
    }
    if (hits) this.emit({ e: "connect", s: p.seat, w: WEAPON_IDX[weapon] });
  };

  // dirX/dirY point from the attacker to the victim
  Sim.prototype.damagePlayer = function (p, dmg, dirX, dirY, by, knock) {
    if (!this.active(p) || p.invuln > 0) return 0;
    let dealt = dmg * Sim.defMul(p), blocked = 0;
    if (p.ward > 0) dealt *= 0.5;
    if (p.blocking) {
      // a raised shield only helps against things in front of you
      const front = Math.abs(U.angDiff(p.ang, Math.atan2(-dirY, -dirX))) < 1.1;
      dealt *= front ? 0.25 : 0.7;
      blocked = front ? 1 : 0;
    }
    p.hp -= dealt;
    p.invuln = 0.18;
    p.score.damage += dealt;
    const push = (blocked ? 0.06 : 0.14) * (knock ? 0.6 + knock : 1);
    this.emit({ e: "hurt", s: p.seat, by: by == null ? -1 : by, dmg: Math.round(dealt * 10) / 10, dx: dirX, dy: dirY, push: push, blk: blocked, ward: p.ward > 0 ? 1 : 0, hp: Math.max(0, p.hp) });
    if (p.hp <= 0) this.kill(p, by == null ? -1 : by);
    return dealt;
  };

  Sim.prototype.kill = function (p, by) {
    p.hp = 0;
    p.dead = true;
    p.pending = null;
    p.blocking = false;
    p.poison = 0;
    p.score.deaths++;
    const killer = by >= 0 ? this.players[by] : null;
    if (killer && killer !== p) { killer.score.frags++; killer.score.score += 400; this.grantXp(killer, 50 + 15 * p.level); }
    this.emit({ e: "die", s: p.seat, by: by, x: p.x, y: p.y, f: p.f });
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
    for (const sp of p.scrolls) drops.push(MAZE.SPELLS[sp].scroll);
    p.weapons = { fist: true }; p.weapon = "fist"; p.arrows = 0; p.scrolls = [];
    p.has = { key: false, shield: false, boots: false, torch: false };
    const cx = Math.floor(p.x) + 0.5, cy = Math.floor(p.y) + 0.5;
    drops.forEach((kind, i) => {
      const a = (i / Math.max(1, drops.length)) * U.TAU + this.rnd() * 0.5;
      const r = drops.length > 1 ? 0.28 : 0;
      const it = { id: this.nextId++, kind: kind, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, f: p.f, grace: 0.8 };
      this.items.push(it);
      this.emit({ e: "drop", id: it.id, k: kind, x: round2(it.x), y: round2(it.y), f: it.f });
    });
  };

  // arrows, fireballs, frost shards and monster spit
  Sim.prototype.updateShot = function (a, dt) {
    a.life -= dt;
    if (a.life <= 0) { a.dead = true; return; }
    const dist = a.speed * dt, steps = Math.max(1, Math.ceil(dist / 0.1));
    const sx = (a.dx * dist) / steps, sy = (a.dy * dist) / steps;
    const owner = a.owner >= 0 ? this.players[a.owner] : null;
    for (let s = 0; s < steps; s++) {
      a.x += sx; a.y += sy;
      if (this.solidAt(a.x, a.y, true, a.f)) {
        a.x -= sx; a.y -= sy;
        return this.shotHit(a, null, owner);
      }
      if (a.owner >= 0) {
        for (const e of this.enemies) {
          if (e.dead || e.f !== a.f || U.dist2(a.x, a.y, e.x, e.y) >= e.radius * e.radius) continue;
          return this.shotHit(a, e, owner);
        }
      }
      if (a.owner < 0 || this.pvp()) {
        for (const o of this.players) {
          if (!this.active(o) || o.seat === a.owner || o.f !== a.f) continue;
          const r = P.radius + 0.06;
          if (U.dist2(a.x, a.y, o.x, o.y) >= r * r) continue;
          return this.shotHit(a, o, owner);
        }
      }
    }
  };

  Sim.prototype.shotHit = function (a, target, owner) {
    a.dead = true;
    if (target) {
      if (a.owner < 0) this.damagePlayer(target, a.dmg, a.dx, a.dy, -1, 0.2);
      else if (owner) this.strike(owner, target, a.dmg, a.dx, a.dy, a.knock || 0.3, { chill: a.chill });
    }
    // fire bursts: everything close takes half
    if (a.splash && owner) {
      for (const e of this.enemies) {
        if (e.dead || e === target || e.f !== a.f) continue;
        const d = U.dist(a.x, a.y, e.x, e.y);
        if (d < a.splash + e.radius) e.hurt(a.dmg * 0.5, (e.x - a.x) / (d || 1), (e.y - a.y) / (d || 1), 0.5, owner.seat);
      }
      if (this.pvp()) for (const o of this.players) {
        if (!this.active(o) || o === target || o === owner || o.f !== a.f) continue;
        if (U.dist(a.x, a.y, o.x, o.y) < a.splash) this.damagePlayer(o, a.dmg * 0.5 * P.pvpMul, o.x - a.x, o.y - a.y, owner.seat, 0.4);
      }
    }
    this.emit({ e: "thunk", x: round2(a.x), y: round2(a.y), f: a.f, k: SHOT_KIND[a.kind], hit: target ? 1 : 0 });
  };

  // ----------------------------------------------------------- pickups --
  Sim.prototype.checkPickups = function (dt) {
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (it.grace > 0) { it.grace -= dt || 0.05; continue; }
      if (it.keepT > 0) it.keepT -= dt || 0.05;
      for (const p of this.players) {
        if (!this.active(p) || p.f !== it.f || U.dist2(p.x, p.y, it.x, it.y) > 0.28) continue;
        if (it.keepT > 0 && it.keepFrom === p.seat) continue;   // you just put it down
        if (!this.applyPickup(p, it)) continue;
        this.items.splice(i, 1); i--;
        this.emit({ e: "pick", s: p.seat, id: it.id, k: it.kind });
        break;
      }
    }
  };

  Sim.prototype.applyPickup = function (p, it) {
    const s = p.score, kind = it.kind, def = MAZE.THINGS[kind];
    if (def && def.spell) {
      if (p.scrolls.length >= 12) return false;
      p.scrolls.push(def.spell);
      s.score += 50;
      return true;
    }
    switch (kind) {
      case T.SWORD: p.weapons.sword = true; p.weapon = "sword"; s.score += 100; return true;
      case T.BOW:
        p.weapons.bow = true;
        if (p.arrows === 0) p.arrows = 5;
        if (p.weapon === "fist") p.weapon = "bow";
        s.score += 100; return true;
      case T.SHIELD: p.has.shield = true; s.score += 100; return true;
      case T.ARROWS: p.arrows += it.amount || 8; return true;
      case T.POTION:
        if (p.hp >= Sim.maxHp(p)) return false;           // leave it for when you need it
        p.hp = Math.min(Sim.maxHp(p), p.hp + 45); p.poison = 0; return true;
      case T.MANA:
        if (p.mana >= Sim.maxMana(p)) return false;
        p.mana = Math.min(Sim.maxMana(p), p.mana + 40); return true;
      case T.KEY:
        p.has.key = true;
        if (this.mode === "coop") this.teamKey = true;
        s.score += 150; return true;
      case T.BOOTS: p.has.boots = true; s.score += 150; return true;
      case T.TORCH: p.has.torch = true; s.score += 150; return true;
      case T.TREASURE: s.treasure++; s.score += 250; this.grantXp(p, 8); return true;
    }
    return false;
  };

  // --------------------------------------------------------- exit + end --
  Sim.prototype.checkExit = function () {
    if (!this.exit || this.ended) return;
    for (const p of this.players) {
      if (!this.active(p) || p.f !== this.exit.f || U.dist2(p.x, p.y, this.exit.x, this.exit.y) >= 0.2) continue;
      p.escaped = true;
      p.place = this.players.filter((o) => o && o.escaped).length;
      const s = p.score;
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
      const all = this.totalTreasure > 0 && players.reduce((n, p) => n + p.score.treasure, 0) === this.totalTreasure;
      if (all) for (const p of players) if (p.escaped) { p.score.allTreasure = 1; p.score.score += 1000; }
    }
    this.result = {
      mode: this.mode, outcome: outcome, winner: winner, time: this.time, totalTreasure: this.totalTreasure,
      players: players.map((p) => ({
        seat: p.seat, name: p.name, escaped: p.escaped, dead: p.dead, away: p.away, place: p.place, level: p.level,
        stats: Object.assign({}, p.score, { score: Math.round(p.score.score), damage: Math.round(p.score.damage), level: p.level })
      }))
    };
    this.emit({ e: "end", result: this.result });
  };

  // ------------------------------------------------------- state to send --
  // Everything a client needs to build the world on joining or rejoining.
  Sim.prototype.fullState = function () {
    const stairs = [];
    for (let i = 0; i < this.stairs.length; i++) if (this.stairs[i]) stairs.push([i, this.stairs[i]]);
    return {
      mode: this.mode, name: this.level.name, cols: this.cols, rows: this.rows, floors: this.floors,
      walls: Array.from(this.walls), stairs: stairs, monsters: (this.level.monsters || []).map((m) => Object.assign({}, m)),
      exit: this.exit ? { cx: this.exit.cx, cy: this.exit.cy, f: this.exit.f } : null,
      items: this.items.map((it) => [it.id, it.kind, round2(it.x), round2(it.y), it.f]),
      totalTreasure: this.totalTreasure, time: this.time, freeze: this.freeze,
      players: this.players.filter(Boolean).map((p) => this.publicPlayer(p))
    };
  };

  Sim.prototype.publicPlayer = function (p) {
    return {
      seat: p.seat, name: p.name, x: round2(p.x), y: round2(p.y), f: p.f, ang: round2(p.ang), pitch: round2(p.pitch),
      hp: Math.ceil(p.hp), maxHp: Sim.maxHp(p), level: p.level, dead: p.dead, escaped: p.escaped, away: p.away, w: WEAPON_IDX[p.weapon],
      blk: p.blocking ? 1 : 0, mv: p.moving ? 1 : 0, ep: p.epoch, rv: p.reviveT > 0 ? round2(p.reviveT / P.reviveTime) : 0
    };
  };

  // What changes every tick, compact: one array per thing.
  Sim.prototype.snapshot = function () {
    const ps = [], bs = [], as = [];
    for (const p of this.players) {
      if (!p) continue;
      const flags = (p.dead ? 1 : 0) | (p.escaped ? 2 : 0) | (p.blocking ? 4 : 0) | (p.away ? 8 : 0) | (p.moving ? 16 : 0) | (p.invuln > 0.25 ? 32 : 0) |
        (p.has.torch ? 64 : 0) | (p.has.shield ? 128 : 0) | (p.ward > 0 ? 256 : 0) | (p.poison > 0 ? 512 : 0) | (p.slow > 0 ? 1024 : 0);
      ps.push([p.seat, round2(p.x), round2(p.y), round2(p.ang), round2(p.pitch), Math.ceil(p.hp), flags, WEAPON_IDX[p.weapon], p.epoch,
        p.reviveT > 0 ? round2(p.reviveT / P.reviveTime) : 0, p.respawnT > 0 ? Math.ceil(p.respawnT) : 0, p.f, p.level, Sim.maxHp(p)]);
    }
    for (const e of this.enemies) {
      if (e.dead) continue;
      bs.push([e.id, e.kind, round2(e.x), round2(e.y), e.windup > 0 ? round2(1 - e.windup / WINDUP) : 0, round2(e.flash), round2(e.hp / e.maxHp), e.f, e.sizeMul, e.slow > 0 ? 1 : 0]);
    }
    for (const a of this.shots) as.push([a.id, round2(a.x), round2(a.y), round2(a.dx), round2(a.dy), a.speed, a.f, SHOT_KIND[a.kind]]);
    return { time: round2(this.time), freeze: round2(this.freeze), p: ps, b: bs, a: as };
  };

  // the parts of a player only that player needs
  Sim.prototype.privateState = function (seat) {
    const p = this.players[seat];
    if (!p) return null;
    return {
      hp: Math.ceil(p.hp), maxHp: Sim.maxHp(p), mana: Math.floor(p.mana), maxMana: Sim.maxMana(p),
      weapons: Object.keys(p.weapons).concat(p.spells.length ? ["magic"] : []), weapon: p.weapon, arrows: p.arrows,
      has: { key: this.hasKey(p), ownKey: p.has.key, shield: p.has.shield, boots: p.has.boots, torch: p.has.torch },
      level: p.level, xp: p.xp, xpNext: MAZE.xpFor(p.level), points: p.points, stats: Object.assign({}, p.stats),
      spells: p.spells.slice(), spell: p.spell, scrolls: p.scrolls.slice(),
      poison: round2(p.poison), slow: round2(p.slow), ward: round2(p.ward), speed: round2(Sim.speedMul(p)),
      tally: { time: round2(p.score.time), kills: p.score.kills, frags: p.score.frags, deaths: p.score.deaths, score: Math.round(p.score.score), treasure: p.score.treasure, secrets: p.score.secrets },
      respawn: p.respawnT > 0 ? round2(p.respawnT) : 0, ep: p.epoch, f: p.f
    };
  };

  function round2(v) { return Math.round(v * 100) / 100; }

  // ----------------------------------------------------------- monster --
  // Blobs and every custom monster: the same hunter, with the monster's own numbers
  // and at most one special ability.
  function SimBlob(sim, x, y, f, kind, child) {
    const def = sim.def(kind);
    this.sim = sim;
    this.id = sim.nextId++;
    this.kind = kind;
    this.def = def;
    this.x = x; this.y = y; this.f = f;
    this.sizeMul = child ? 0.7 : 1;
    this.child = !!child;
    this.radius = def.radius * this.sizeMul;
    this.maxHp = child ? Math.max(5, Math.round(def.hp / 2)) : def.hp;
    this.hp = this.maxHp;
    this.speed = def.speed * (child ? 1.15 : 1);
    this.dmg = child ? def.dmg * 0.6 : def.dmg;
    this.vx = 0; this.vy = 0;          // knockback velocity
    this.flash = 0;
    this.attackCd = 0;
    this.spitCd = 1.5 + sim.rnd() * 2;
    this.windup = 0;                   // > 0 while rearing up to bite
    this.slow = 0;
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
    const k = (knock || 0.5) / Math.max(0.5, Math.sqrt(this.def.mass || 1));
    this.vx += dirX * k * 6;
    this.vy += dirY * k * 6;
    const killer = by >= 0 ? sim.players[by] : null;
    if (this.hp <= 0) {
      this.dead = true;
      if (killer) {
        killer.score.kills++;
        killer.score.score += Math.round(this.def.score * (this.child ? 0.5 : 1));
        const xp = (this.def.xp || 20) * (this.child ? 0.4 : 1);
        sim.grantXp(killer, xp);
        // co-op: the rest of the team learns a little from it too
        if (sim.mode === "coop") for (const o of sim.players) if (o && o !== killer && !o.away) sim.grantXp(o, xp * 0.25);
      }
      if (this.def.ability === "split" && !this.child) this.splitApart();
    }
    sim.emit({ e: "blob", b: this.id, k: this.kind, s: by == null ? -1 : by, x: round2(this.x), y: round2(this.y), f: this.f, dead: this.dead ? 1 : 0 });
  };

  SimBlob.prototype.splitApart = function () {
    const sim = this.sim;
    for (const side of [-1, 1]) {
      const c = new SimBlob(sim, this.x, this.y, this.f, this.kind, true);
      sim.moveCircle(c, side * 0.25, side * 0.12, c.radius, true);
      c.alerted = true;
      c.flash = 0.4;
      sim.enemies.push(c);
    }
    sim.emit({ e: "split", x: round2(this.x), y: round2(this.y), f: this.f, k: this.kind });
  };

  SimBlob.prototype.update = function (dt) {
    const sim = this.sim, def = this.def;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3);
    if (this.attackCd > 0) this.attackCd -= dt;
    if (this.spitCd > 0) this.spitCd -= dt;
    if (this.slow > 0) this.slow = Math.max(0, this.slow - dt);
    if (def.ability === "regen" && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.03 * dt);
    this.vx *= Math.pow(0.02, dt);
    this.vy *= Math.pow(0.02, dt);

    // the nearest player on this floor it can see wins; otherwise the flow field decides
    let target = null, td = 1e9, seen = false;
    const sight = def.sight || 14;
    for (const p of sim.players) {
      if (!sim.active(p) || p.f !== this.f) continue;
      const d = Math.hypot(p.x - this.x, p.y - this.y);
      const los = d < sight && sim.lineOfSight(this.x, this.y, p.x, p.y, this.f);
      if ((los && !seen) || ((los || !seen) && d < td)) { target = p; td = d; seen = los; }
    }
    const cx = this.x | 0, cy = this.y | 0, ci = this.f * sim.plane + cy * sim.cols + cx;
    let tx = 0, ty = 0;
    const d = target ? Math.hypot(target.x - this.x, target.y - this.y) || 1e-6 : 1e9;
    const ddx = target ? target.x - this.x : 0, ddy = target ? target.y - this.y : 0;
    if (target) {
      this.target = target.seat;
      this.growlCd -= dt;
      if (this.growlCd <= 0) {
        this.growlCd = 3 + sim.rnd() * 7;
        if (d < 9) sim.emit({ e: "growl", b: this.id });
      }
      if (!this.alerted && d < 3.5) this.alerted = true;   // close enough to hear you
    }

    if (seen) {
      this.alerted = true;
      tx = ddx / d; ty = ddy / d;
    } else {
      // follow the flow field downhill toward the nearest player, up or down stairs if need be
      let bestV = sim.flowAt(ci), bi = -1;
      for (let k = 0; k < 4; k++) {
        const nx = cx + DIRS[k][0], ny = cy + DIRS[k][1];
        if (nx < 0 || ny < 0 || nx >= sim.cols || ny >= sim.rows) continue;
        const ni = this.f * sim.plane + ny * sim.cols + nx, v = sim.flowAt(ni);
        if (v >= 0 && (bestV < 0 || v < bestV)) { bestV = v; bi = ni; }
      }
      const up = sim.stairLink(ci);
      if (up >= 0) {
        const v = sim.flowAt(up);
        if (v >= 0 && (bestV < 0 || v < bestV)) { bestV = v; bi = up; }
      }
      if (bi >= 0 && bi === up) {
        // on the stairs: walk to the middle, then take them
        const ddx2 = cx + 0.5 - this.x, ddy2 = cy + 0.5 - this.y, dd = Math.hypot(ddx2, ddy2);
        if (dd < 0.2) {
          this.f = (up / sim.plane) | 0;
          this.alerted = true;
          sim.emit({ e: "mclimb", b: this.id, f: this.f });
          return;
        }
        tx = ddx2 / (dd || 1); ty = ddy2 / (dd || 1);
        this.alerted = true;
      } else if (bi >= 0) {
        // steer to the centre of the next tile so it does not clip corners
        const r = bi % sim.plane, nx = r % sim.cols, ny = (r / sim.cols) | 0;
        const ddx2 = nx + 0.5 - this.x, ddy2 = ny + 0.5 - this.y;
        const dd = Math.hypot(ddx2, ddy2) || 1e-6;
        tx = ddx2 / dd; ty = ddy2 / dd;
      } else if (this.alerted && target) {
        tx = ddx / d; ty = ddy / d;
      }
    }

    // spitters keep their distance and lob globs when they can see you
    if (def.ability === "ranged" && seen && target) {
      if (d < 2.4) { tx = -tx * 0.6; ty = -ty * 0.6; }
      if (this.spitCd <= 0 && d < sight && d > 1.2) {
        this.spitCd = 2.2 + sim.rnd();
        const ux = ddx / d, uy = ddy / d;
        sim.shots.push({ id: sim.nextId++, kind: "spit", owner: -1, x: this.x + ux * (this.radius + 0.1), y: this.y + uy * (this.radius + 0.1), f: this.f, dx: ux, dy: uy, dmg: this.dmg * 0.7, speed: 7, life: 2.5 });
        sim.emit({ e: "spit", b: this.id });
      }
    }

    // Once in biting range, hold position. Pressing on would carry the monster
    // into the camera, where it cannot be seen or hit.
    const minSep = this.radius + P.radius;
    if (target && d < minSep + 0.06) { tx = 0; ty = 0; }

    // keep monsters from stacking up, and off every player
    let sx = 0, sy = 0;
    for (const o of sim.enemies) {
      if (o === this || o.dead || o.f !== this.f) continue;
      const ox = this.x - o.x, oy = this.y - o.y, od2 = ox * ox + oy * oy, want = this.radius + o.radius;
      if (od2 > 0.0001 && od2 < want * want) {
        const od = Math.sqrt(od2);
        sx += (ox / od) * (1 - od / want);
        sy += (oy / od) * (1 - od / want);
      }
    }
    for (const p of sim.players) {
      if (!sim.active(p) || p.f !== this.f) continue;
      const ox = this.x - p.x, oy = this.y - p.y, od = Math.hypot(ox, oy), want = this.radius + P.radius;
      if (od > 0.0001 && od < want) { sx += (ox / od) * (1 - od / want) * 2; sy += (oy / od) * (1 - od / want) * 2; }
    }

    const sp = this.speed * (this.alerted ? 1 : 0.6) * (this.slow > 0 ? 0.45 : 1) * (def.ability === "explode" && seen ? 1.35 : 1);
    const mvx = (tx * sp + sx * 2.2) * dt + this.vx * dt;
    const mvy = (ty * sp + sy * 2.2) * dt + this.vy * dt;
    sim.moveCircle(this, mvx, mvy, this.radius, true);
    if (!target) { this.windup = 0; return; }

    // Attack: rear up first so every bite can be seen and heard coming,
    // and whiffs if you back off during the wind-up.
    const reach = minSep + 0.2;
    if (this.windup > 0) {
      this.windup -= dt;
      if (d > reach + 0.15 || !sim.active(target)) {
        this.windup = 0;
      } else if (this.windup <= 0) {
        this.windup = 0;
        this.attackCd = def.rate || 0.85;
        this.bite(target, ddx / d, ddy / d);
      }
    } else if (d < reach && this.attackCd <= 0) {
      this.windup = WINDUP;
      sim.emit({ e: "windup", b: this.id });
    }
  };

  SimBlob.prototype.bite = function (target, ux, uy) {
    const sim = this.sim, ab = this.def.ability;
    if (ab === "explode") {
      // kamikaze: everyone close on this floor gets caught in the blast
      this.dead = true;
      for (const p of sim.players) {
        if (!sim.active(p) || p.f !== this.f) continue;
        const d = U.dist(p.x, p.y, this.x, this.y);
        if (d < 1.7) sim.damagePlayer(p, this.dmg * (1.6 - d * 0.4), (p.x - this.x) / (d || 1), (p.y - this.y) / (d || 1), -1, 0.9);
      }
      sim.emit({ e: "blob", b: this.id, k: this.kind, s: -1, x: round2(this.x), y: round2(this.y), f: this.f, dead: 1, boom: 1 });
      return;
    }
    const dealt = sim.damagePlayer(target, this.dmg, ux, uy, -1, 0);
    if (ab === "poison" && dealt > 0) target.poison = Math.max(target.poison, 4);
    if (ab === "leech" && dealt > 0) this.hp = Math.min(this.maxHp, this.hp + dealt * 0.7);
  };

  Sim.WINDUP = WINDUP;
  Sim.SimBlob = SimBlob;
  MAZE.Sim = Sim;
})();
