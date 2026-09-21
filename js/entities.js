/* MAZE — blobs, arrows, pickups, particles. */
(function () {
  const MAZE = window.MAZE;
  const U = MAZE.util;

  // ------------------------------------------------------------- blob ---
  function Blob(game, x, y, thingId) {
    const def = MAZE.THINGS[thingId];
    this.game = game;
    this.kind = thingId;
    this.def = def;
    this.x = x; this.y = y;
    this.sprite = def.sprite;
    this.scale = def.scale;
    this.zbase = def.zbase;
    this.radius = def.radius;
    this.hp = def.hp; this.maxHp = def.hp;
    this.speed = def.speed;
    this.dmg = def.dmg;
    this.vx = 0; this.vy = 0;          // knockback velocity
    this.anim = Math.random() * 6;
    this.frame = 0;
    this.flash = 0;
    this.attackCd = 0;
    this.windup = 0;                   // > 0 while rearing up to bite
    this.baseScale = def.scale;
    this.growlCd = 2 + Math.random() * 6;
    this.dead = false;
    this.alerted = false;
  }

  Blob.prototype.hurt = function (dmg, dirX, dirY, knock) {
    if (this.dead) return;
    this.hp -= dmg;
    this.flash = 0.75;
    this.alerted = true;
    const k = knock || 0.5;
    this.vx += dirX * k * 6;
    this.vy += dirY * k * 6;
    const g = this.game;
    g.splat(this.x, this.y, this.zbase + this.scale * 0.5, this.def.body, 9);
    if (this.hp <= 0) {
      this.dead = true;
      g.splat(this.x, this.y, this.zbase + this.scale * 0.4, this.def.body2, 26, 3.2);
      g.stats.kills++;
      g.stats.score += this.def.score;
      MAZE.audio.play("dieBlob");
      g.message("Blob splattered  +" + this.def.score);
    } else {
      MAZE.audio.play("hurtBlob");
    }
  };

  Blob.prototype.update = function (dt) {
    const g = this.game, p = g.player;
    this.anim += dt * (3 + this.speed);
    this.frame = (this.anim | 0) % 6;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3);
    if (this.attackCd > 0) this.attackCd -= dt;

    const ddx = p.x - this.x, ddy = p.y - this.y;
    const d = Math.hypot(ddx, ddy) || 1e-6;

    // knockback decays fast
    this.vx *= Math.pow(0.02, dt);
    this.vy *= Math.pow(0.02, dt);

    // occasional growl when it is close enough to be a problem
    this.growlCd -= dt;
    if (this.growlCd <= 0) {
      this.growlCd = 3 + Math.random() * 7;
      if (d < 9) MAZE.audio.play("growl");
    }

    if (!this.alerted && d < 3.5) this.alerted = true;   // close enough to hear you

    let tx = 0, ty = 0;
    const los = d < 14 && g.lineOfSight(this.x, this.y, p.x, p.y);
    if (los) {
      this.alerted = true;
      tx = ddx / d; ty = ddy / d;
    } else {
      // follow the flow field downhill toward the player
      const cx = this.x | 0, cy = this.y | 0;
      const cur = g.flowAt(cx, cy);
      let bestV = cur, bx = 0, by = 0;
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (let i = 0; i < dirs.length; i++) {
        const nx = cx + dirs[i][0], ny = cy + dirs[i][1];
        const v = g.flowAt(nx, ny);
        if (v >= 0 && (bestV < 0 || v < bestV)) { bestV = v; bx = dirs[i][0]; by = dirs[i][1]; }
      }
      if (bx || by) {
        // steer to the centre of the next tile so it does not clip corners
        const cxc = cx + bx + 0.5, cyc = cy + by + 0.5;
        const ddx2 = cxc - this.x, ddy2 = cyc - this.y;
        const dd = Math.hypot(ddx2, ddy2) || 1e-6;
        tx = ddx2 / dd; ty = ddy2 / dd;
      } else if (this.alerted) {
        tx = ddx / d; ty = ddy / d;
      }
    }

    // Once in biting range, hold position. Pressing on would carry the blob
    // into the camera, where it cannot be seen or hit.
    const minSep = this.radius + MAZE.PLAYER.radius;
    if (d < minSep + 0.06) { tx = 0; ty = 0; }

    // keep blobs from stacking into a single super-blob
    let sx = 0, sy = 0;
    const others = g.enemies;
    for (let i = 0; i < others.length; i++) {
      const o = others[i];
      if (o === this || o.dead) continue;
      const ox = this.x - o.x, oy = this.y - o.y;
      const od2 = ox * ox + oy * oy;
      const want = this.radius + o.radius;
      if (od2 > 0.0001 && od2 < want * want) {
        const od = Math.sqrt(od2);
        sx += (ox / od) * (1 - od / want);
        sy += (oy / od) * (1 - od / want);
      }
    }

    const sp = this.speed * (this.alerted ? 1 : 0.6);
    const mvx = (tx * sp + sx * 2.2) * dt + this.vx * dt;
    const mvy = (ty * sp + sy * 2.2) * dt + this.vy * dt;
    g.moveCircle(this, mvx, mvy, this.radius, true);

    // Attack: rear up first so every bite can be seen and heard coming,
    // and whiffs if you back off during the wind-up.
    const reach = minSep + 0.2;
    if (this.windup > 0) {
      this.windup -= dt;
      if (d > reach + 0.15 || p.dead) {
        this.windup = 0;
      } else if (this.windup <= 0) {
        this.windup = 0;
        this.attackCd = 0.85;
        g.damagePlayer(this.dmg, ddx / d, ddy / d);
      }
    } else if (d < reach && this.attackCd <= 0 && !p.dead) {
      this.windup = WINDUP;
      MAZE.audio.play("windup");
    }
    const wu = this.windup > 0 ? 1 - this.windup / WINDUP : 0;
    this.scale = this.baseScale * (1 + wu * wu * 0.22);
  };
  const WINDUP = 0.4;

  // ------------------------------------------------------------ arrow ---
  function Arrow(game, x, y, dx, dy, dmg, speed) {
    this.game = game;
    this.x = x; this.y = y;
    this.dx = dx; this.dy = dy;
    this.dmg = dmg;
    this.speed = speed;
    this.life = 3;
    this.dead = false;
    this.sprite = "arrow";
    this.frame = 0;
    this.scale = 0.12;
    this.zbase = 0.47;
    this.flash = 0;
  }

  Arrow.prototype.update = function (dt) {
    const g = this.game;
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }
    const steps = 4;
    const sx = (this.dx * this.speed * dt) / steps;
    const sy = (this.dy * this.speed * dt) / steps;
    for (let s = 0; s < steps; s++) {
      this.x += sx; this.y += sy;
      if (g.solidAt(this.x, this.y, true)) {
        this.x -= sx; this.y -= sy;
        this.dead = true;
        g.splat(this.x, this.y, this.zbase, 0xff8fb4c8, 6, 1.4);
        MAZE.audio.play("arrowHit");
        return;
      }
      for (let i = 0; i < g.enemies.length; i++) {
        const e = g.enemies[i];
        if (e.dead) continue;
        if (U.dist2(this.x, this.y, e.x, e.y) < e.radius * e.radius) {
          e.hurt(this.dmg, this.dx, this.dy, MAZE.WEAPONS.bow.knock);
          MAZE.audio.play("arrowHit");
          this.dead = true;
          return;
        }
      }
    }
  };

  // ----------------------------------------------------------- pickup ---
  function Pickup(game, x, y, thingId) {
    const def = MAZE.THINGS[thingId];
    this.game = game;
    this.kind = thingId;
    this.def = def;
    this.x = x; this.y = y;
    this.sprite = def.sprite;
    this.scale = def.scale;
    this.baseZ = def.zbase;
    this.zbase = def.zbase;
    this.frame = 0;
    this.flash = 0;
    this.dead = false;
    this.t = Math.random() * 6;
  }

  Pickup.prototype.update = function (dt) {
    this.t += dt;
    this.zbase = this.baseZ + Math.sin(this.t * 2) * 0.035;
    const sp = MAZE.sprites.get(this.sprite);
    if (sp && sp.count > 1) this.frame = ((this.t * 9) | 0) % sp.count;
  };

  // -------------------------------------------------------- particles ---
  function Particle(x, y, z, vx, vy, vz, life, size, color) {
    this.x = x; this.y = y; this.z = z;
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.life = life; this.maxLife = life;
    this.size = size; this.color = color;
  }

  Particle.prototype.update = function (dt, game) {
    this.life -= dt;
    this.vz -= 4.5 * dt;
    const nx = this.x + this.vx * dt;
    const ny = this.y + this.vy * dt;
    if (!game.solidAt(nx, this.y, true)) this.x = nx; else this.vx *= -0.4;
    if (!game.solidAt(this.x, ny, true)) this.y = ny; else this.vy *= -0.4;
    this.z += this.vz * dt;
    if (this.z < 0.02) { this.z = 0.02; this.vz *= -0.35; this.vx *= 0.7; this.vy *= 0.7; }
  };

  MAZE.Blob = Blob;
  MAZE.Arrow = Arrow;
  MAZE.Pickup = Pickup;
  MAZE.Particle = Particle;
})();
