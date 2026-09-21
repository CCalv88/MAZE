/* MAZE — crisp overlay: weapon viewmodel, vitals, minimap, messages, vignettes.
   Drawn on its own full-resolution canvas above the low-res 3D buffer. */
(function () {
  const MAZE = window.MAZE;
  const U = MAZE.util;
  const W = MAZE.W, T = MAZE.T;

  function Hud(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.w = 0; this.h = 0;
  }

  Hud.prototype.resize = function (cssW, cssH) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.w = cssW; this.h = cssH; this.dpr = dpr;
  };

  function bar(g, x, y, w, h, frac, col, bg) {
    g.fillStyle = bg || "rgba(0,0,0,.55)";
    g.fillRect(x, y, w, h);
    g.fillStyle = col;
    g.fillRect(x + 2, y + 2, Math.max(0, (w - 4) * U.clamp(frac, 0, 1)), h - 4);
    g.strokeStyle = "rgba(255,255,255,.18)";
    g.lineWidth = 1;
    g.strokeRect(x + .5, y + .5, w - 1, h - 1);
  }

  // ---------------------------------------------------------- viewmodel --
  Hud.prototype.drawWeapon = function (g, game) {
    const p = game.player;
    if (p.dead || p.escaped) return;
    const w = this.w, h = this.h;
    const scale = Math.min(w, h * 1.6) / 700;
    const sway = p.swayX * 26, swayY = p.swayY * 20 + p.bobView * 26;
    const sw = p.swingT > 0 ? 1 - p.swingT / p.swingDur : 0;   // 0 → 1 across the swing

    g.save();
    g.translate(w * 0.5 + sway, h + swayY);

    // shield comes up on the left when blocking
    if (p.blocking && p.has.shield) {
      const raise = p.blockAmt;
      g.save();
      g.translate(-w * 0.26, -h * 0.05 - raise * h * 0.3);
      g.rotate(-0.25 + (1 - raise) * 0.5);
      const s = MAZE.sprites.icon("shield");
      const size = 300 * scale;
      g.drawImage(s, -size / 2, -size / 2, size, size);
      g.restore();
    }

    const wep = p.weapon;
    if (wep === "sword") {
      const ang = -0.55 + Math.sin(sw * Math.PI) * 2.3;
      const lift = Math.sin(sw * Math.PI) * 90 * scale;
      g.save();
      g.translate(w * 0.22, -h * 0.02 - lift);
      g.rotate(ang);
      const size = 520 * scale;
      g.drawImage(MAZE.sprites.icon("sword"), -size / 2, -size * 0.78, size, size);
      g.restore();
    } else if (wep === "bow") {
      const pull = p.swingT > 0 ? Math.sin(sw * Math.PI) : 0;
      g.save();
      g.translate(0, -h * 0.06 + pull * 14 * scale);
      const size = 430 * scale;
      g.drawImage(MAZE.sprites.icon("bow"), -size / 2, -size * 0.62, size, size);
      g.restore();
    } else {
      // fists — the right one jabs forward on attack
      const punch = Math.sin(sw * Math.PI);
      for (const side of [-1, 1]) {
        const jab = side > 0 ? punch : 0;
        g.save();
        g.translate(side * w * 0.2, -h * 0.02 - jab * h * 0.14);
        g.scale(1 + jab * 0.35, 1 + jab * 0.35);
        const s = 90 * scale;
        g.fillStyle = "#c98b63";
        g.beginPath();
        g.moveTo(-s, s); g.lineTo(-s * .9, -s * .5);
        g.quadraticCurveTo(0, -s * 1.05, s * .9, -s * .5);
        g.lineTo(s, s); g.closePath(); g.fill();
        g.strokeStyle = "#7d4f34"; g.lineWidth = 3 * scale; g.stroke();
        g.strokeStyle = "#8d5b3c"; g.lineWidth = 2.5 * scale;
        for (let k = -1; k <= 1; k++) {
          g.beginPath();
          g.moveTo(k * s * .45, -s * .35); g.lineTo(k * s * .45, s * .2);
          g.stroke();
        }
        g.restore();
      }
    }
    g.restore();
  };

  // ------------------------------------------------------------ minimap --
  Hud.prototype.drawMap = function (g, game, big) {
    const size = big ? Math.min(this.w, this.h) * 0.8 : 176;
    const cell = Math.max(2, Math.floor(size / Math.max(game.cols, game.rows)));
    const mw = cell * game.cols, mh = cell * game.rows;
    const x0 = big ? (this.w - mw) / 2 : this.w - mw - 16;
    const y0 = big ? (this.h - mh) / 2 : 16;

    g.save();
    g.globalAlpha = big ? 0.97 : 0.8;
    g.fillStyle = "#070a0f";
    g.fillRect(x0 - 6, y0 - 6, mw + 12, mh + 12);
    g.strokeStyle = "#2a3142"; g.lineWidth = 1;
    g.strokeRect(x0 - 6.5, y0 - 6.5, mw + 13, mh + 13);

    for (let y = 0; y < game.rows; y++) {
      for (let x = 0; x < game.cols; x++) {
        const i = y * game.cols + x;
        if (!game.seen[i]) continue;
        const t = game.walls[i];
        if (t === W.EMPTY) {
          g.fillStyle = game.seen[i] === 2 ? "#232b3a" : "#171d27";
        } else if (t === W.SECRET && game.secretFound[i]) {
          g.fillStyle = "#8b4fbf";
        } else if (t === W.DOOR) {
          g.fillStyle = "#c99b4a";
        } else if (t === W.GLASS) {
          g.fillStyle = "#4d7f96";
        } else {
          g.fillStyle = "#4a5364";
        }
        g.fillRect(x0 + x * cell, y0 + y * cell, cell, cell);
      }
    }

    // exit, once you have laid eyes on it
    if (game.exit && game.seen[game.exit.cy * game.cols + game.exit.cx]) {
      g.fillStyle = "#4fd6c8";
      g.fillRect(x0 + game.exit.cx * cell, y0 + game.exit.cy * cell, cell, cell);
    }
    // pickups you have already seen
    for (const it of game.items) {
      const i = (it.y | 0) * game.cols + (it.x | 0);
      if (!game.seen[i]) continue;
      g.fillStyle = it.def.mini;
      g.fillRect(x0 + it.x * cell - cell * .2, y0 + it.y * cell - cell * .2, cell * .5, cell * .5);
    }
    // blobs only show when close — no free radar
    const cam = game.camera();
    const sense = game.player.has.torch ? 11 : 7;
    for (const e of game.enemies) {
      if (e.dead) continue;
      if (U.dist(e.x, e.y, cam.x, cam.y) > sense) continue;
      g.fillStyle = e.def.mini;
      g.beginPath();
      g.arc(x0 + e.x * cell, y0 + e.y * cell, Math.max(1.6, cell * .34), 0, U.TAU);
      g.fill();
    }

    // teammates always show; rivals only when they are close, like blobs
    for (const o of game.others) {
      if (!o.visible()) continue;
      if (game.mode === "versus" && U.dist(o.x, o.y, cam.x, cam.y) > sense) continue;
      arrow(g, x0 + o.x * cell, y0 + o.y * cell, o.ang, Math.max(3, cell * .55), o.dead ? "#6a7080" : o.color);
    }

    // pings pulse where someone pointed
    for (const pg of game.pings) {
      const r = Math.max(4, cell * 1.2) * (1 + (1 - (pg.t % 1)) * .6);
      g.strokeStyle = game.colorOf(pg.seat);
      g.globalAlpha = Math.min(1, pg.t);
      g.lineWidth = 2;
      g.beginPath(); g.arc(x0 + pg.x * cell, y0 + pg.y * cell, r, 0, U.TAU); g.stroke();
      g.globalAlpha = big ? 0.97 : 0.8;
    }

    if (!game.player.escaped)
      arrow(g, x0 + game.player.x * cell, y0 + game.player.y * cell, game.player.ang, Math.max(3, cell * .6), MAZE.PLAYER_COLORS[game.seat] || "#ffb454");
    g.restore();
    return { x: x0 - 6, y: y0 - 6, w: mw + 12, h: mh + 12 };
  };

  function arrow(g, px, py, ang, r, col) {
    g.save();
    g.translate(px, py);
    g.rotate(ang);
    g.fillStyle = col;
    g.beginPath(); g.moveTo(r, 0); g.lineTo(-r * .7, r * .7); g.lineTo(-r * .3, 0); g.lineTo(-r * .7, -r * .7);
    g.closePath(); g.fill();
    g.strokeStyle = "rgba(0,0,0,.6)"; g.lineWidth = 1; g.stroke();
    g.restore();
  }

  // --------------------------------------------------------- multiplayer --
  // names over other players' heads, placed where the renderer drew them
  Hud.prototype.drawTags = function (g, game) {
    const w = this.w, h = this.h;
    g.textAlign = "center";
    for (const o of game.others) {
      const s = o._screen;
      if (!s || s.dist > 12) continue;
      const x = s.x * w, y = Math.max(16, s.y * h - 8);
      const a = U.clamp(1.4 - s.dist / 10, 0.35, 1);
      g.globalAlpha = a;
      g.font = "700 12px Segoe UI,system-ui,sans-serif";
      const label = o.dead ? o.name + (game.mode === "coop" ? " — DOWN" : "") : o.name;
      const tw = g.measureText(label).width + 12;
      g.fillStyle = "rgba(0,0,0,.55)";
      g.fillRect(x - tw / 2, y - 24, tw, 17);
      g.fillStyle = o.color;
      g.fillText(label, x, y - 11);
      if (!o.dead) bar(g, x - 24, y - 5, 48, 6, o.hp / MAZE.PLAYER.maxHp, o.hp > 55 ? "#6ee06e" : o.hp > 28 ? "#ffb454" : "#ff5a5a");
      else if (o.revive > 0) bar(g, x - 24, y - 5, 48, 6, o.revive, "#6ee06e");
    }
    g.globalAlpha = 1;
    g.textAlign = "left";
  };

  // pings seen through the walls: a marker at the right bearing, with the distance
  Hud.prototype.drawPings = function (g, game) {
    const cam = game.camera(), w = this.w, h = this.h;
    for (const pg of game.pings) {
      const rel = U.angDiff(cam.ang, Math.atan2(pg.y - cam.y, pg.x - cam.x));
      if (Math.abs(rel) > 1.1) continue;
      const x = w / 2 + (Math.tan(rel) / 0.68) * (w / 2);
      const y = h * 0.42;
      const d = U.dist(cam.x, cam.y, pg.x, pg.y);
      g.globalAlpha = Math.min(1, pg.t);
      g.fillStyle = game.colorOf(pg.seat);
      g.strokeStyle = "rgba(0,0,0,.7)";
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(x, y - 12); g.lineTo(x + 9, y); g.lineTo(x, y + 12); g.lineTo(x - 9, y); g.closePath();
      g.fill(); g.stroke();
      g.textAlign = "center";
      g.font = "700 11px Segoe UI,system-ui,sans-serif";
      g.fillText(Math.round(d) + "m", x, y + 27);
      g.textAlign = "left";
    }
    g.globalAlpha = 1;
  };

  // everyone in the room: colour, name, health, and what they are up to
  Hud.prototype.drawRoster = function (g, game, top) {
    const list = [{ seat: game.seat, name: game.playerName || "You", hp: game.player.hp, dead: game.player.dead, escaped: game.player.escaped, me: true }];
    for (const o of game.others) list.push({ seat: o.seat, name: o.name, hp: o.hp, dead: o.dead, escaped: o.escaped, away: o.away, respawn: o.respawn });
    list.sort((a, b) => a.seat - b.seat);
    const x = this.w - 196, rowH = 22;
    let y = top + 10;
    g.fillStyle = "rgba(7,10,15,.72)";
    g.fillRect(x - 8, y - 6, 188, list.length * rowH + 8);
    for (const r of list) {
      const col = MAZE.PLAYER_COLORS[r.seat];
      g.fillStyle = col;
      g.fillRect(x, y + 3, 10, 10);
      g.font = (r.me ? "800 " : "600 ") + "12px Segoe UI,system-ui,sans-serif";
      g.fillStyle = r.away ? "#6a7080" : "#dfe5f0";
      const nm = r.name.length > 11 ? r.name.slice(0, 10) + "…" : r.name;
      g.fillText(nm, x + 16, y + 12);
      let status = "";
      if (r.away) status = "OFFLINE";
      else if (r.escaped) status = "ESCAPED";
      else if (r.dead) status = game.mode === "coop" ? "DOWN" : "DEAD";
      if (status) {
        g.textAlign = "right";
        g.font = "800 10px Segoe UI,system-ui,sans-serif";
        g.fillStyle = r.escaped ? "#4fd6c8" : r.away ? "#6a7080" : "#ff5a5a";
        g.fillText(status, x + 172, y + 12);
        g.textAlign = "left";
      } else {
        bar(g, x + 104, y + 3, 68, 10, r.hp / MAZE.PLAYER.maxHp, r.hp > 55 ? "#6ee06e" : r.hp > 28 ? "#ffb454" : "#ff5a5a");
      }
      y += rowH;
    }
  };

  // big centred line for countdowns, being down, and spectating
  Hud.prototype.drawBanner = function (g, game) {
    const p = game.player, w = this.w, h = this.h;
    let title = "", sub = "", col = "#ffb454";
    if (game.freeze > 0) {
      title = String(Math.ceil(game.freeze));
      sub = "The blobs are waking up…";
    } else if (p.dead && game.mode !== "solo") {
      title = game.mode === "coop" ? "YOU ARE DOWN" : "YOU DIED";
      col = "#ff5a5a";
      sub = p.respawn > 0 ? "Back at your start in " + Math.ceil(p.respawn) + "…" : "";
      if (game.mode === "coop") sub = "A teammate can revive you (hold E beside you). " + sub;
    } else if (p.escaped && game.mode === "coop") {
      title = "ESCAPED";
      col = "#4fd6c8";
      const o = game.otherMap.get(game.spectate);
      sub = o && o.visible() ? "Watching " + o.name + " — click to switch" : "Waiting for the rest of your team…";
    }
    if (!title) return;
    g.textAlign = "center";
    g.font = "800 44px Segoe UI,system-ui,sans-serif";
    g.lineWidth = 5;
    g.strokeStyle = "rgba(0,0,0,.7)";
    g.strokeText(title, w / 2, h * 0.3);
    g.fillStyle = col;
    g.fillText(title, w / 2, h * 0.3);
    if (sub) {
      g.font = "700 15px Segoe UI,system-ui,sans-serif";
      g.fillStyle = "#dfe5f0";
      g.strokeStyle = "rgba(0,0,0,.7)"; g.lineWidth = 3;
      g.strokeText(sub, w / 2, h * 0.3 + 30);
      g.fillText(sub, w / 2, h * 0.3 + 30);
    }
    g.textAlign = "left";
  };

  // --------------------------------------------------------------- draw --
  Hud.prototype.draw = function (game) {
    const g = this.ctx;
    const w = this.w, h = this.h;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const p = game.player;

    this.drawTags(g, game);
    this.drawWeapon(g, game);

    // --- damage / low health vignette ---
    if (p.hurtFlash > 0) {
      const a = Math.min(0.62, p.hurtFlash * 0.75);
      const grd = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.22, w / 2, h / 2, Math.max(w, h) * 0.62);
      grd.addColorStop(0, "rgba(255,0,0,0)");
      grd.addColorStop(1, "rgba(190,10,10," + a.toFixed(3) + ")");
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
    }
    const hpFrac = p.hp / p.maxHp;
    if (hpFrac < 0.34 && !p.dead) {
      const pulse = 0.18 + Math.sin(game.time * 5) * 0.09;
      const grd = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.6);
      grd.addColorStop(0, "rgba(120,0,0,0)");
      grd.addColorStop(1, "rgba(150,0,0," + (pulse * (1 - hpFrac / 0.34)).toFixed(3) + ")");
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
    }
    // always-on corner darkening sells the torchlight
    const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,.55)");
    g.fillStyle = vg; g.fillRect(0, 0, w, h);

    // --- which way the last hits came from (up = in front, down = behind) ---
    const ringR = Math.min(w, h) * 0.2;
    for (let i = 0; i < p.hitMarks.length; i++) {
      const m = p.hitMarks[i];
      const rel = U.angDiff(p.ang, m.ang);
      g.save();
      g.translate(w / 2, h / 2);
      g.rotate(rel);
      g.globalAlpha = U.clamp(m.t, 0, 1);
      g.fillStyle = "#ff3b3b";
      g.strokeStyle = "rgba(0,0,0,.6)";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(0, -ringR - 22);
      g.lineTo(30, -ringR + 2);
      g.lineTo(0, -ringR - 7);
      g.lineTo(-30, -ringR + 2);
      g.closePath();
      g.fill(); g.stroke();
      g.restore();
    }
    g.globalAlpha = 1;

    // --- crosshair ---
    if (!p.dead && !p.escaped) {
      g.strokeStyle = p.swingT > 0 ? "rgba(255,180,84,.95)" : "rgba(255,255,255,.55)";
      g.lineWidth = 2;
      const c = 4 + (p.swingT > 0 ? 5 : 0);
      g.beginPath();
      g.moveTo(w / 2 - c - 5, h / 2); g.lineTo(w / 2 - c, h / 2);
      g.moveTo(w / 2 + c, h / 2); g.lineTo(w / 2 + c + 5, h / 2);
      g.moveTo(w / 2, h / 2 - c - 5); g.lineTo(w / 2, h / 2 - c);
      g.moveTo(w / 2, h / 2 + c); g.lineTo(w / 2, h / 2 + c + 5);
      g.stroke();
    }

    // --- vitals ---
    const bx = 18, by = h - 62;
    g.font = "700 11px Segoe UI,system-ui,sans-serif";
    g.textBaseline = "alphabetic";
    g.fillStyle = "rgba(255,255,255,.55)";
    g.fillText("HEALTH", bx, by - 6);
    const hpCol = hpFrac > .55 ? "#6ee06e" : hpFrac > .28 ? "#ffb454" : "#ff5a5a";
    bar(g, bx, by, 200, 18, hpFrac, hpCol);
    g.fillStyle = "#fff";
    g.font = "700 12px Segoe UI,system-ui,sans-serif";
    g.fillText(Math.max(0, Math.ceil(p.hp)) + " / " + p.maxHp, bx + 208, by + 14);
    bar(g, bx, by + 23, 200, 8, p.stamina / MAZE.PLAYER.maxStamina, p.winded ? "#8a93a7" : "#4fd6c8");

    // --- weapon + ammo ---
    const wdef = MAZE.WEAPONS[p.weapon];
    g.textAlign = "right";
    g.fillStyle = "rgba(255,255,255,.55)";
    g.font = "700 11px Segoe UI,system-ui,sans-serif";
    g.fillText("WEAPON", w - 18, h - 52);
    g.fillStyle = "#ffb454";
    g.font = "800 20px Segoe UI,system-ui,sans-serif";
    g.fillText(wdef.name.toUpperCase(), w - 18, h - 30);
    if (p.weapon === "bow") {
      g.fillStyle = p.arrows > 0 ? "#dfe5f0" : "#ff5a5a";
      g.font = "700 14px Segoe UI,system-ui,sans-serif";
      g.fillText("ARROWS  " + p.arrows, w - 18, h - 11);
    }
    g.textAlign = "left";

    // --- inventory badges ---
    let ix = bx;
    const badges = [];
    if (p.has.key) badges.push("key");
    if (p.has.shield) badges.push("shield");
    if (p.has.boots) badges.push("boots");
    if (p.has.torch) badges.push("torch");
    for (const b of badges) {
      const icon = MAZE.sprites.icon(b);
      if (icon) {
        g.globalAlpha = .9;
        g.drawImage(icon, ix, h - 128, 34, 34);
        g.globalAlpha = 1;
      }
      ix += 38;
    }

    // --- top status ---
    g.textAlign = "center";
    g.fillStyle = "rgba(0,0,0,.45)";
    g.fillRect(w / 2 - 90, 12, 180, 30);
    g.fillStyle = "#dfe5f0";
    g.font = "700 17px ui-monospace,Consolas,monospace";
    g.fillText(U.fmtTime(game.stats.time), w / 2, 33);
    g.font = "700 12px Segoe UI,system-ui,sans-serif";
    g.fillStyle = "#ffcf5a";
    if (game.totalTreasure) {
      g.fillText("TREASURE " + game.stats.treasure + "/" + game.totalTreasure, w / 2, 58);
    }
    if (game.mode === "versus" || game.mode === "coop") {
      g.fillStyle = game.mode === "versus" ? "#ff6a8a" : "#6ee06e";
      g.font = "800 10px Segoe UI,system-ui,sans-serif";
      g.fillText(game.mode === "versus" ? "COMPETITIVE · FIRST OUT WINS" : "CO-OP · EVERYONE OUT", w / 2, game.totalTreasure ? 74 : 58);
    }
    g.textAlign = "left";

    // --- messages ---
    let my = 26;
    for (let i = 0; i < game.messages.length; i++) {
      const m = game.messages[i];
      const a = U.clamp(m.t / 0.8, 0, 1);
      g.globalAlpha = a;
      g.fillStyle = m.color || "#dfe5f0";
      g.font = "700 14px Segoe UI,system-ui,sans-serif";
      g.fillText(m.text, 18, my);
      my += 21;
      g.globalAlpha = 1;
    }

    // --- interaction prompt ---
    if (game.prompt) {
      g.textAlign = "center";
      g.fillStyle = "rgba(0,0,0,.6)";
      const tw = g.measureText(game.prompt).width + 26;
      g.fillRect(w / 2 - tw / 2, h * 0.62, tw, 30);
      g.fillStyle = "#ffb454";
      g.font = "700 14px Segoe UI,system-ui,sans-serif";
      g.fillText(game.prompt, w / 2, h * 0.62 + 20);
      g.textAlign = "left";
    }

    this.drawPings(g, game);
    this.drawBanner(g, game);
    const box = this.drawMap(g, game, game.bigMap);
    if (game.others.length && !game.bigMap) this.drawRoster(g, game, box.y + box.h);
  };

  MAZE.Hud = Hud;
})();
