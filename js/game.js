/* MAZE — first person test mode: player, combat, AI driving, doors, secrets, scoring. */
(function () {
  const MAZE = window.MAZE;
  const U = MAZE.util;
  const W = MAZE.W, T = MAZE.T;
  const P = MAZE.PLAYER;

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
  Game.prototype.load = function (level) {
    this.level = MAZE.Level.clone(level);
    const lv = this.level;
    this.cols = lv.cols; this.rows = lv.rows;
    this.walls = new Uint8Array(lv.walls);
    this.secretFound = new Uint8Array(lv.cols * lv.rows);
    this.seen = new Uint8Array(lv.cols * lv.rows);
    this.flow = new Int32Array(lv.cols * lv.rows).fill(-1);
    this.flowTimer = 0;
    this.time = 0;
    this.messages.length = 0;
    this.particles.length = 0;
    this.enemies = [];
    this.items = [];
    this.arrows = [];
    this.prompt = "";
    this.ended = false;
    this.bigMap = false;

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

    this.stats = { time: 0, kills: 0, score: 0, treasure: 0, secrets: 0, damage: 0 };
    this.totalTreasure = 0;

    // spawn things
    let start = null;
    this.exit = null;
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const i = y * this.cols + x;
        const id = lv.things[i];
        if (!id || this.walls[i] !== W.EMPTY) continue;
        const def = MAZE.THINGS[id];
        const cx = x + 0.5, cy = y + 0.5;
        if (id === T.START) start = { x: cx, y: cy, cx: x, cy: y };
        else if (id === T.FINISH) this.exit = { x: cx, y: cy, cx: x, cy: y, sprite: "finish", frame: 0, scale: def.scale, zbase: def.zbase, t: 0, def: def };
        else if (def.cat === "enemy") this.enemies.push(new MAZE.Blob(this, cx, cy, id));
        else {
          this.items.push(new MAZE.Pickup(this, cx, cy, id));
          if (id === T.TREASURE) this.totalTreasure++;
        }
      }
    }
    if (!start) start = { x: 1.5, y: 1.5, cx: 1, cy: 1 };

    // face whichever way is open
    let ang = 0;
    const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    for (const d of dirs) {
      if (!this.solidTile(start.cx + d[0], start.cy + d[1], false)) {
        ang = Math.atan2(d[1], d[0]);
        break;
      }
    }

    this.player = {
      x: start.x, y: start.y, ang: ang, pitch: 0,
      hp: P.maxHp, maxHp: P.maxHp,
      stamina: P.maxStamina, winded: false,
      weapon: "fist", weapons: { fist: true },
      has: { key: false, shield: false, boots: false, torch: false },
      arrows: 0,
      swingT: 0, swingDur: 0.3, swingHit: true, atkCd: 0,
      blocking: false, blockAmt: 0,
      hurtFlash: 0, invuln: 0, dead: false,
      bob: 0, bobView: 0, bobPhase: 0, swayX: 0, swayY: 0,
      stepDist: 0, moving: false, lookSway: 0,
      hitMarks: []          // recent hits, for the directional indicator
    };

    this.light = { dist: 8, ambient: 0.075 };
    this.markSeen(start.cx, start.cy, 2);
    this.message("Find the exit portal.", "#4fd6c8");
    if (this.totalTreasure) this.message(this.totalTreasure + " treasure hidden in here.", "#ffcf5a");
    this.updateFlow();
    return this;
  };

  Game.prototype.restart = function () {
    this.load(this.level);
    this.ended = false;
  };

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

  Game.prototype.lineOfSight = function (x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 0.001) return true;
    const steps = Math.ceil(len / 0.2);
    const sx = dx / steps, sy = dy / steps;
    let x = x0, y = y0;
    for (let i = 0; i < steps; i++) {
      x += sx; y += sy;
      const t = this.tileAt(Math.floor(x), Math.floor(y));
      if (t !== W.EMPTY && MAZE.WALLS[t] && MAZE.WALLS[t].opaque) return false;
    }
    return true;
  };

  Game.prototype.flowAt = function (x, y) {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return -1;
    return this.flow[y * this.cols + x];
  };

  // BFS out from the player over tiles blobs can actually use
  Game.prototype.updateFlow = function () {
    const n = this.cols * this.rows;
    const flow = this.flow;
    flow.fill(-1);
    const sx = Math.floor(this.player.x), sy = Math.floor(this.player.y);
    if (sx < 0 || sy < 0 || sx >= this.cols || sy >= this.rows) return;
    if (!this._queue || this._queue.length !== n) this._queue = new Int32Array(n);
    const q = this._queue;
    let head = 0, tail = 0;
    const s = sy * this.cols + sx;
    flow[s] = 0; q[tail++] = s;
    while (head < tail) {
      const cur = q[head++];
      const cx = cur % this.cols, cy = (cur / this.cols) | 0;
      const d = flow[cur] + 1;
      for (let k = 0; k < 4; k++) {
        const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const ny = cy + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= this.cols || ny >= this.rows) continue;
        const ni = ny * this.cols + nx;
        if (flow[ni] !== -1 || this.solidTile(nx, ny, true)) continue;
        flow[ni] = d; q[tail++] = ni;
      }
    }
  };

  // ------------------------------------------------------- presentation --
  Game.prototype.message = function (text, color) {
    this.messages.unshift({ text: text, t: 3.2, color: color });
    if (this.messages.length > 4) this.messages.pop();
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
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return U.rgb(r, g, b);
  }

  Game.prototype.markSeen = function (tx, ty, level) {
    if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return;
    const i = ty * this.cols + tx;
    if (this.seen[i] < level) this.seen[i] = level;
  };

  // walk a fan of rays and remember what they touch, for the minimap
  Game.prototype.updateVisibility = function () {
    const p = this.player;
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

  Game.prototype.renderables = function () {
    const list = this._renderList;
    list.length = 0;
    for (let i = 0; i < this.items.length; i++) if (!this.items[i].dead) list.push(this.items[i]);
    for (let i = 0; i < this.enemies.length; i++) if (!this.enemies[i].dead) list.push(this.enemies[i]);
    for (let i = 0; i < this.arrows.length; i++) if (!this.arrows[i].dead) list.push(this.arrows[i]);
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
      if (!self.paused && !self.ended) self.update(dt);
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
    this.stats.time += dt;
    const p = this.player;

    for (let i = this.messages.length - 1; i >= 0; i--) {
      this.messages[i].t -= dt;
      if (this.messages[i].t <= 0) this.messages.splice(i, 1);
    }

    this.updatePlayer(dt);

    this.flowTimer -= dt;
    if (this.flowTimer <= 0) { this.flowTimer = 0.18; this.updateFlow(); }

    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e.dead) e.update(dt);
    }
    for (let i = this.enemies.length - 1; i >= 0; i--)
      if (this.enemies[i].dead && this.enemies[i].flash <= 0) this.enemies.splice(i, 1);

    for (let i = this.arrows.length - 1; i >= 0; i--) {
      this.arrows[i].update(dt);
      if (this.arrows[i].dead) this.arrows.splice(i, 1);
    }
    for (let i = 0; i < this.items.length; i++) this.items[i].update(dt);
    for (let i = this.particles.length - 1; i >= 0; i--) {
      this.particles[i].update(dt, this);
      if (this.particles[i].life <= 0) this.particles.splice(i, 1);
    }
    if (this.exit) {
      this.exit.t += dt;
      this.exit.frame = ((this.exit.t * 10) | 0) % 6;
    }

    this.updateVisibility();

    // torchlight flicker
    const base = p.has.torch ? 14.5 : 8;
    const flick = p.has.torch ? 1 + Math.sin(this.time * 11) * 0.025 + Math.sin(this.time * 4.3) * 0.02 : 1;
    this.light.dist = base * flick;

    this.separateBodies();
    this.checkPickups();
    this.checkExit();
  };

  // ------------------------------------------------------------ player --
  Game.prototype.updatePlayer = function (dt) {
    const p = this.player;
    if (p.dead) return;
    const k = this.keys;

    if (p.hurtFlash > 0) p.hurtFlash = Math.max(0, p.hurtFlash - dt * 1.8);
    if (p.invuln > 0) p.invuln -= dt;
    for (let i = p.hitMarks.length - 1; i >= 0; i--) {
      p.hitMarks[i].t -= dt * 0.9;
      if (p.hitMarks[i].t <= 0) p.hitMarks.splice(i, 1);
    }
    if (p.atkCd > 0) p.atkCd -= dt;

    // swing timing — damage lands mid-swing
    if (p.swingT > 0) {
      p.swingT -= dt;
      if (!p.swingHit && p.swingT <= p.swingDur * 0.55) {
        p.swingHit = true;
        this.meleeHit();
      }
      if (p.swingT < 0) p.swingT = 0;
    }

    p.blocking = !!(k.block && p.has.shield && !p.dead);
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
    // walls and blobs both stop you; per axis so you slide around either
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

    this.checkSecret();
    this.updatePrompt();
  };

  Game.prototype.checkSecret = function () {
    const p = this.player;
    const tx = Math.floor(p.x), ty = Math.floor(p.y);
    const i = ty * this.cols + tx;
    if (this.tileAt(tx, ty) === W.SECRET && !this.secretFound[i]) {
      this.secretFound[i] = 1;
      this.stats.secrets++;
      this.stats.score += 300;
      MAZE.audio.play("secret");
      this.message("Secret passage found!  +300", "#c06bd6");
      this.splat(tx + 0.5, ty + 0.5, 0.5, "#c06bd6", 22, 2.6);
    }
  };

  // door in front of you → prompt, and E (or a bump) unlocks it
  Game.prototype.updatePrompt = function () {
    const p = this.player;
    this.prompt = "";
    const fx = p.x + Math.cos(p.ang) * 0.75;
    const fy = p.y + Math.sin(p.ang) * 0.75;
    const tx = Math.floor(fx), ty = Math.floor(fy);
    if (this.tileAt(tx, ty) === W.DOOR) {
      if (p.has.key) {
        this.prompt = "Press E to unlock the door";
        if (this.keys.use) this.openDoor(tx, ty);
      } else {
        this.prompt = "Locked — you need the key";
        if (this.keys.use && !this._lockedNag) {
          this._lockedNag = true;
          MAZE.audio.play("locked");
          this.message("It will not budge without the key.", "#ffb454");
        }
      }
    }
    if (!this.keys.use) this._lockedNag = false;
  };

  Game.prototype.openDoor = function (tx, ty) {
    this.walls[ty * this.cols + tx] = W.EMPTY;
    MAZE.audio.play("door");
    this.message("The door swings open.", "#c99b4a");
    this.splat(tx + 0.5, ty + 0.5, 0.5, "#c99b4a", 16, 1.8);
    this.stats.score += 150;
    this.updateFlow();
  };

  // ------------------------------------------------------------ combat --
  Game.prototype.attack = function () {
    const p = this.player;
    if (p.dead || p.atkCd > 0 || p.swingT > 0) return;
    const w = MAZE.WEAPONS[p.weapon];
    if (w.kind === "ranged") {
      if (p.arrows <= 0) {
        MAZE.audio.play("noAmmo");
        this.message("Out of arrows.", "#ff5a5a");
        return;
      }
      p.arrows--;
      p.swingT = p.swingDur = w.cd;
      p.swingHit = true;
      p.atkCd = w.cd;
      const dx = Math.cos(p.ang), dy = Math.sin(p.ang);
      this.arrows.push(new MAZE.Arrow(this, p.x + dx * 0.4, p.y + dy * 0.4, dx, dy, w.dmg, w.speed));
      MAZE.audio.play("bow");
      p.lookSway = -0.05;
    } else {
      p.swingT = p.swingDur = w.cd;
      p.swingHit = false;
      p.atkCd = w.cd;
      MAZE.audio.play("swing");
    }
  };

  Game.prototype.meleeHit = function () {
    const p = this.player;
    const w = MAZE.WEAPONS[p.weapon];
    let hits = 0;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.dead) continue;
      const dx = e.x - p.x, dy = e.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > w.range + e.radius) continue;
      const toAng = Math.atan2(dy, dx);
      if (Math.abs(U.angDiff(p.ang, toAng)) > w.arc * 0.5) continue;
      if (!this.lineOfSight(p.x, p.y, e.x, e.y)) continue;
      e.hurt(w.dmg, dx / (d || 1), dy / (d || 1), w.knock);
      hits++;
    }
    if (hits) {
      MAZE.audio.play(p.weapon === "sword" ? "swordHit" : "punch");
      p.lookSway = 0.04;
    }
  };

  Game.prototype.damagePlayer = function (dmg, dirX, dirY) {
    const p = this.player;
    if (p.dead || p.invuln > 0) return;
    let dealt = dmg;
    if (p.blocking) {
      // a raised shield only helps against things in front of you
      const toAng = Math.atan2(dirY, dirX);
      const front = Math.abs(U.angDiff(p.ang, toAng)) < 1.1;
      if (front) {
        dealt = dmg * 0.25;
        MAZE.audio.play("block");
      } else {
        dealt = dmg * 0.7;
        MAZE.audio.play("hurt");
      }
    } else {
      MAZE.audio.play("hurt");
    }
    p.hp -= dealt;
    p.hurtFlash = Math.min(1.4, p.hurtFlash + dealt / 30);
    p.invuln = 0.18;
    p.hitMarks.push({ ang: Math.atan2(-dirY, -dirX), t: 1 });   // where the hit came from
    if (p.hitMarks.length > 6) p.hitMarks.shift();
    this.stats.damage += dealt;
    // shove the player back a little
    const push = p.blocking ? 0.06 : 0.14;
    this.moveCircle(p, dirX * push, dirY * push, P.radius, false);
    if (p.hp <= 0) { p.hp = 0; this.die(); }
  };

  Game.prototype.die = function () {
    const p = this.player;
    p.dead = true;
    this.ended = true;
    MAZE.audio.play("lose");
    MAZE.audio.stopAmbience();
    this.splat(p.x, p.y, 0.4, "#ff5a5a", 30, 2.4);
    if (this.opts.onEnd) this.opts.onEnd({ won: false, stats: this.stats, game: this });
  };

  // Would moving the player from (ox,oy) to (nx,ny) push into a blob?
  // Moves that increase the gap are always allowed, so you can back out.
  Game.prototype.bodyBlocks = function (ox, oy, nx, ny) {
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.dead) continue;
      const min = e.radius + P.radius;
      const nd2 = (e.x - nx) * (e.x - nx) + (e.y - ny) * (e.y - ny);
      if (nd2 >= min * min) continue;
      const od2 = (e.x - ox) * (e.x - ox) + (e.y - oy) * (e.y - oy);
      if (nd2 < od2) return true;
    }
    return false;
  };

  // Blobs and the player are solid to each other. The overlap is split by
  // mass, and whatever a wall stops one body from taking, the other takes.
  const PLAYER_MASS = 1.2;
  Game.prototype.separateBodies = function () {
    const p = this.player;
    if (p.dead) return;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.dead) continue;
      const min = e.radius + P.radius;
      const dx = e.x - p.x, dy = e.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d >= min) continue;
      let nx, ny;
      if (d < 1e-4) { nx = Math.cos(p.ang); ny = Math.sin(p.ang); }   // dead centre: pop it out in front
      else { nx = dx / d; ny = dy / d; }
      const overlap = min - d;
      const share = PLAYER_MASS / (PLAYER_MASS + (e.def.mass || 1));
      const bx = e.x, by = e.y;
      this.moveCircle(e, nx * overlap * share, ny * overlap * share, e.radius, true);
      const blobMoved = (e.x - bx) * nx + (e.y - by) * ny;
      const rest = overlap - blobMoved;
      if (rest > 0) this.moveCircle(p, -nx * rest, -ny * rest, P.radius, false);
    }
  };

  // ----------------------------------------------------------- pickups --
  Game.prototype.checkPickups = function () {
    const p = this.player;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (it.dead) continue;
      if (U.dist2(p.x, p.y, it.x, it.y) > 0.28) continue;
      if (this.applyPickup(it.kind)) {
        it.dead = true;
        this.splat(it.x, it.y, it.baseZ + 0.15, it.def.mini, 12, 1.5);
        this.items.splice(i, 1);
        i--;
      }
    }
  };

  Game.prototype.applyPickup = function (kind) {
    const p = this.player;
    switch (kind) {
      case T.SWORD:
        p.weapons.sword = true; p.weapon = "sword";
        MAZE.audio.play("weapon"); this.message("Sword acquired — press 2", "#d8dde8");
        this.stats.score += 100; return true;
      case T.BOW:
        p.weapons.bow = true;
        if (p.arrows === 0) p.arrows = 5;
        if (p.weapon === "fist") p.weapon = "bow";
        MAZE.audio.play("weapon"); this.message("Bow acquired — press 3", "#c89a5a");
        this.stats.score += 100; return true;
      case T.SHIELD:
        p.has.shield = true;
        MAZE.audio.play("weapon"); this.message("Shield acquired — hold right-click", "#9fb4d8");
        this.stats.score += 100; return true;
      case T.ARROWS:
        p.arrows += 8;
        MAZE.audio.play("pickup"); this.message("+8 arrows", "#b9884f"); return true;
      case T.POTION:
        if (p.hp >= p.maxHp) return false;           // leave it for when you need it
        p.hp = Math.min(p.maxHp, p.hp + 45);
        MAZE.audio.play("potion"); this.message("+45 health", "#ff5a7a"); return true;
      case T.KEY:
        p.has.key = true;
        MAZE.audio.play("pickup"); this.message("Key acquired.", "#ffd34a");
        this.stats.score += 150; return true;
      case T.BOOTS:
        p.has.boots = true;
        MAZE.audio.play("pickup"); this.message("Swift boots — you feel lighter.", "#8ad8ff");
        this.stats.score += 150; return true;
      case T.TORCH:
        p.has.torch = true;
        MAZE.audio.play("pickup"); this.message("Torch lit — you can see much further.", "#ffa030");
        this.stats.score += 150; return true;
      case T.TREASURE:
        this.stats.treasure++; this.stats.score += 250;
        MAZE.audio.play("pickup");
        this.message("Treasure  " + this.stats.treasure + "/" + this.totalTreasure + "  +250", "#ffcf5a");
        return true;
    }
    return false;
  };

  Game.prototype.checkExit = function () {
    if (!this.exit || this.ended) return;
    const p = this.player;
    if (U.dist2(p.x, p.y, this.exit.x, this.exit.y) < 0.2) this.win();
  };

  Game.prototype.win = function () {
    this.ended = true;
    const s = this.stats;
    s.timeBonus = Math.max(0, Math.round(2000 - s.time * 12));
    s.allTreasure = this.totalTreasure > 0 && s.treasure === this.totalTreasure;
    s.score += s.timeBonus + (s.allTreasure ? 1000 : 0) + Math.round(this.player.hp * 5);
    MAZE.audio.play("win");
    MAZE.audio.stopAmbience();
    if (this.opts.onEnd) this.opts.onEnd({ won: true, stats: s, game: this });
  };

  // ------------------------------------------------------------- input --
  Game.prototype.setWeapon = function (name) {
    const p = this.player;
    if (!p.weapons[name] || p.weapon === name) return;
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
      const s = self.sensitivity * 0.0022;
      self.player.ang += e.movementX * s;
      self.player.pitch = U.clamp(self.player.pitch - e.movementY * s * 0.6, -0.42, 0.42);
      self.player.lookSway = U.clamp((self.player.lookSway || 0) - e.movementX * 0.0006, -0.12, 0.12);
    };
    this._onDown = function (e) {
      if (self.paused || self.ended) return;
      if (e.button === 0) self.attack();
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
