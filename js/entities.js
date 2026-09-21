/* MAZE — what the client draws: views of the blobs, arrows, pickups and other players the
   simulation reports, plus purely cosmetic particles. Online, positions arrive about
   twenty times a second, so each moving view keeps a short buffer and is drawn slightly
   in the past, smoothly between two known points. */
(function () {
  const MAZE = window.MAZE;
  const U = MAZE.util;

  // ----------------------------------------------------------- motion ---
  const INTERP_MS = 110;

  function Motion() { this.q = []; }
  Motion.prototype.push = function (now, x, y, ang) {
    const q = this.q, last = q[q.length - 1];
    // a jump (respawn, correction) should snap, not glide across the map
    if (last && (now - last.t > 1000 || Math.hypot(x - last.x, y - last.y) > 1.5)) q.length = 0;
    q.push({ t: now, x: x, y: y, ang: ang || 0 });
    if (q.length > 10) q.shift();
  };
  Motion.prototype.sample = function (now, out) {
    const q = this.q;
    if (!q.length) return false;
    const t = now - INTERP_MS;
    while (q.length > 2 && q[1].t <= t) q.shift();
    const a = q[0], b = q[1];
    if (!b || t <= a.t) { out.x = a.x; out.y = a.y; out.ang = a.ang; return true; }
    const span = b.t - a.t;
    const k = span <= 0 ? 1 : Math.min(1.25, (t - a.t) / span);   // a little extrapolation hides a late packet
    out.x = a.x + (b.x - a.x) * k;
    out.y = a.y + (b.y - a.y) * k;
    out.ang = a.ang + U.angDiff(a.ang, b.ang) * Math.min(1, k);
    return true;
  };

  // ------------------------------------------------------------- blob ---
  function BlobView(id, kind) {
    const def = MAZE.THINGS[kind];
    this.id = id;
    this.kind = kind;
    this.def = def;
    this.sprite = def.sprite;
    this.baseScale = def.scale;
    this.scale = def.scale;
    this.zbase = def.zbase;
    this.radius = def.radius;
    this.x = 0; this.y = 0;
    this.flash = 0;
    this.anim = Math.random() * 6;
    this.frame = 0;
    this.dead = false;
    this.motion = new Motion();
  }
  BlobView.prototype.apply = function (row, now, smooth) {
    // row: [id, kind, x, y, windup 0..1, flash, hpFrac]
    if (smooth) this.motion.push(now, row[2], row[3], 0);
    else { this.x = row[2]; this.y = row[3]; }
    const wu = row[4];
    this.scale = this.baseScale * (1 + wu * wu * 0.22);
    this.flash = row[5];
    this.hpFrac = row[6];
  };
  BlobView.prototype.update = function (dt, now, smooth) {
    this.anim += dt * (3 + this.def.speed);
    this.frame = (this.anim | 0) % 6;
    if (smooth) this.motion.sample(now, this);
  };

  // ------------------------------------------------------------ arrow ---
  // Arrows fly straight, so instead of drawing them late they are carried forward
  // from the last report: the one on screen is where the real one is now.
  function ArrowView(id) {
    this.id = id;
    this.sprite = "arrow";
    this.frame = 0;
    this.scale = 0.12;
    this.zbase = 0.47;
    this.flash = 0;
    this.x = 0; this.y = 0;
  }
  ArrowView.prototype.apply = function (row, now) {
    // row: [id, x, y, dx, dy, speed]
    this.bx = row[1]; this.by = row[2]; this.dx = row[3]; this.dy = row[4]; this.speed = row[5]; this.at = now;
    this.x = this.bx; this.y = this.by;
  };
  ArrowView.prototype.update = function (dt, now, smooth, game) {
    if (!smooth) return;
    const t = Math.min(0.25, (now - this.at) / 1000);
    const nx = this.bx + this.dx * this.speed * t, ny = this.by + this.dy * this.speed * t;
    if (!game.solidAt(nx, ny, true)) { this.x = nx; this.y = ny; }
  };

  // ----------------------------------------------------------- pickup ---
  function PickupView(id, kind, x, y) {
    const def = MAZE.THINGS[kind];
    this.id = id;
    this.kind = kind;
    this.def = def;
    this.x = x; this.y = y;
    this.sprite = def.sprite;
    this.scale = def.scale;
    this.baseZ = def.zbase;
    this.zbase = def.zbase;
    this.frame = 0;
    this.flash = 0;
    this.t = Math.random() * 6;
  }
  PickupView.prototype.update = function (dt) {
    this.t += dt;
    this.zbase = this.baseZ + Math.sin(this.t * 2) * 0.035;
    const sp = MAZE.sprites.get(this.sprite);
    if (sp && sp.count > 1) this.frame = ((this.t * 9) | 0) % sp.count;
  };

  // ----------------------------------------------------------- player ---
  // Another player, seen from the outside. The sprite is picked each frame from the
  // angle between where they face and where the camera is.
  function PlayerView(seat, name) {
    this.seat = seat;
    this.name = name || "Player " + (seat + 1);
    this.color = MAZE.PLAYER_COLORS[seat] || "#ffffff";
    this.x = 0; this.y = 0; this.ang = 0; this.pitch = 0;
    this.hp = MAZE.PLAYER.maxHp;
    this.dead = false; this.escaped = false; this.away = false;
    this.blocking = false; this.moving = false; this.shielded = false;
    this.weapon = "fist";
    this.swingT = 0;
    this.flash = 0;
    this.walk = 0;
    this.revive = 0;
    this.respawn = 0;
    this.sprite = "hero0_front_fist";
    this.frame = 0;
    this.scale = MAZE.PLAYER.scale;
    this.zbase = 0;
    this.tag = true;
    this.motion = new Motion();
    this._lx = 0; this._ly = 0;
  }
  PlayerView.prototype.apply = function (row, now, smooth) {
    // row: [seat, x, y, ang, pitch, hp, flags, weaponIdx, epoch, revive, respawn]
    if (smooth) this.motion.push(now, row[1], row[2], row[3]);
    else { this.x = row[1]; this.y = row[2]; this.ang = row[3]; }
    this.pitch = row[4];
    if (row[5] < this.hp && !(row[6] & 1)) this.flash = 0.8;
    this.hp = row[5];
    const f = row[6];
    this.dead = !!(f & 1); this.escaped = !!(f & 2); this.blocking = !!(f & 4);
    this.away = !!(f & 8); this.moving = !!(f & 16); this.shielded = !!(f & 32);
    this.weapon = MAZE.Sim.WEAPON_BY_IDX[row[7]] || "fist";
    this.revive = row[9] || 0;
    this.respawn = row[10] || 0;
  };
  PlayerView.prototype.update = function (dt, now, smooth) {
    if (smooth) this.motion.sample(now, this);
    const moved = Math.hypot(this.x - this._lx, this.y - this._ly);
    this._lx = this.x; this._ly = this.y;
    if (moved > 0.001 && moved < 1) this.walk += moved * 2.4;
    if (this.swingT > 0) this.swingT = Math.max(0, this.swingT - dt);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3);
  };
  PlayerView.prototype.visible = function () { return !this.escaped && !this.away; };
  // choose the directional frame for a viewer standing at (cx, cy)
  PlayerView.prototype.face = function (cx, cy) {
    if (this.dead) {
      this.sprite = "hero" + this.seat + "_down";
      this.frame = 0;
      this.scale = 0.26;
      return;
    }
    const toViewer = Math.atan2(cy - this.y, cx - this.x);
    const rel = U.angDiff(this.ang, toViewer);
    const a = Math.abs(rel);
    const dir = a < Math.PI * 0.25 ? "front" : a > Math.PI * 0.75 ? "back" : rel > 0 ? "right" : "left";
    this.sprite = "hero" + this.seat + "_" + dir + "_" + this.weapon;
    this.scale = MAZE.PLAYER.scale;
    this.frame = this.swingT > 0 ? 3 : this.moving ? 1 + ((this.walk | 0) & 1) : 0;
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

  MAZE.Motion = Motion;
  MAZE.BlobView = BlobView;
  MAZE.ArrowView = ArrowView;
  MAZE.PickupView = PickupView;
  MAZE.PlayerView = PlayerView;
  MAZE.Particle = Particle;
})();
