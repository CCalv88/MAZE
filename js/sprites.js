/* MAZE — procedurally drawn sprites. Used as 3D billboards AND editor palette icons. */
(function () {
  const MAZE = window.MAZE;
  const U = MAZE.util;
  const S = (MAZE.sprites = { map: {} });

  function frames(name, w, h, count, draw) {
    const fr = [];
    let first = null;
    for (let i = 0; i < count; i++) {
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const g = c.getContext("2d");
      draw(g, w, h, i, count);
      const data = new Uint32Array(g.getImageData(0, 0, w, h).data.buffer).slice();
      fr.push(data);
      if (!first) first = c;
    }
    S.map[name] = { name, w, h, frames: fr, canvas: first, count };
    return S.map[name];
  }
  const one = (name, w, h, draw) => frames(name, w, h, 1, draw);

  S.get = (n) => S.map[n];
  S.icon = (n) => (S.map[n] ? S.map[n].canvas : null);

  // --- small drawing helpers ---------------------------------------------
  function ellipse(g, x, y, rx, ry, fill) {
    g.fillStyle = fill; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, U.TAU); g.fill();
  }
  function outline(g, lw, col) { g.strokeStyle = col; g.lineWidth = lw; g.stroke(); }

  function blobFactory(name, def) {
    frames(name, 48, 48, 6, (g, w, h, i, n) => {
      const t = i / n * U.TAU;
      const squash = 1 + Math.sin(t) * 0.11;       // bounce
      const stretch = 1 - Math.sin(t) * 0.09;
      const baseY = h - 5 + Math.cos(t) * 2;
      const rx = 17 * squash, ry = 15 * stretch;
      const cy = baseY - ry;

      // drop shadow keeps them planted on the floor
      ellipse(g, w / 2, h - 3, rx * 0.8, 3.2, "rgba(0,0,0,.35)");

      const grd = g.createRadialGradient(w / 2 - rx * .35, cy - ry * .45, 2, w / 2, cy, rx * 1.15);
      grd.addColorStop(0, def.body2); grd.addColorStop(.6, def.body); grd.addColorStop(1, "rgba(0,0,0,.55)");
      g.beginPath();
      // wobbly gel silhouette
      for (let a = 0; a <= U.TAU + .01; a += U.TAU / 28) {
        const wob = 1 + Math.sin(a * 3 + t * 2) * 0.05 + Math.sin(a * 5 - t) * 0.03;
        const px = w / 2 + Math.cos(a) * rx * wob;
        const py = cy + Math.sin(a) * ry * wob;
        a === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
      }
      g.closePath();
      g.fillStyle = grd; g.fill();
      outline(g, 1.5, "rgba(0,0,0,.35)");

      // specular highlight
      ellipse(g, w / 2 - rx * .38, cy - ry * .42, rx * .22, ry * .16, "rgba(255,255,255,.5)");

      // eyes drift a little with the bounce
      const ex = rx * .34, ey = cy - ry * .06, er = rx * .2;
      ellipse(g, w / 2 - ex, ey, er, er * 1.15, "#f3fbf0");
      ellipse(g, w / 2 + ex, ey, er, er * 1.15, "#f3fbf0");
      const look = Math.sin(t) * er * .18;
      ellipse(g, w / 2 - ex + look, ey + 1, er * .5, er * .6, def.eye);
      ellipse(g, w / 2 + ex + look, ey + 1, er * .5, er * .6, def.eye);

      g.strokeStyle = def.eye; g.lineWidth = 1.6;
      g.beginPath(); g.arc(w / 2, cy + ry * .34, rx * .3, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
    });
  }

  MAZE.buildSprites = function () {
    const T = MAZE.T, TH = MAZE.THINGS;

    // ---- markers --------------------------------------------------------
    ["start", "start2", "start3", "start4"].forEach((name, seat) => {
      one(name, 48, 48, (g) => {
        g.fillStyle = MAZE.PLAYER_COLORS[seat];
        g.beginPath(); g.moveTo(24, 4); g.lineTo(40, 26); g.lineTo(29, 26); g.lineTo(29, 36);
        g.lineTo(19, 36); g.lineTo(19, 26); g.lineTo(8, 26); g.closePath(); g.fill();
        outline(g, 2, "rgba(0,0,0,.55)");
        g.fillStyle = "#0b0e14";
        g.beginPath(); g.arc(24, 38, 9, 0, U.TAU); g.fill();
        g.fillStyle = MAZE.PLAYER_COLORS[seat];
        g.font = "800 13px Segoe UI,system-ui,sans-serif";
        g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText(String(seat + 1), 24, 39);
      });
    });

    frames("finish", 48, 64, 6, (g, w, h, i, n) => {
      const t = i / n * U.TAU;
      g.fillStyle = "#4a5160";                       // stone archway
      g.fillRect(4, 8, 8, h - 10); g.fillRect(w - 12, 8, 8, h - 10);
      g.fillRect(4, 4, w - 8, 8);
      g.fillStyle = "#5f6878"; g.fillRect(4, 4, w - 8, 3);

      const cx = w / 2, cy = h / 2 + 4, rx = 13, ry = (h - 26) / 2;
      const grd = g.createRadialGradient(cx, cy, 1, cx, cy, ry);
      grd.addColorStop(0, "#eafffb"); grd.addColorStop(.35, "#4fd6c8");
      grd.addColorStop(.75, "#1d8f97"); grd.addColorStop(1, "#0b3b45");
      ellipse(g, cx, cy, rx, ry, grd);
      g.strokeStyle = "rgba(190,255,248,.75)"; g.lineWidth = 1.4;
      for (let k = 0; k < 3; k++) {                  // swirl
        g.beginPath();
        for (let a = 0; a < 5.4; a += .2) {
          const rr = a / 5.4, ang = a * 1.9 + t + k * 2.1;
          const px = cx + Math.cos(ang) * rx * rr * .88;
          const py = cy + Math.sin(ang) * ry * rr * .88;
          a === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
        }
        g.stroke();
      }
    });

    // ---- weapons --------------------------------------------------------
    one("sword", 48, 48, (g) => {
      g.save(); g.translate(24, 24); g.rotate(-Math.PI / 4); g.translate(-24, -24);
      const grd = g.createLinearGradient(20, 0, 28, 0);
      grd.addColorStop(0, "#f2f6ff"); grd.addColorStop(.5, "#c3ccdd"); grd.addColorStop(1, "#7d8799");
      g.fillStyle = grd;
      g.beginPath(); g.moveTo(24, 3); g.lineTo(28, 10); g.lineTo(28, 32);
      g.lineTo(20, 32); g.lineTo(20, 10); g.closePath(); g.fill();
      outline(g, 1, "#5b6373");
      g.fillStyle = "#c99b4a"; g.fillRect(14, 32, 20, 4);           // crossguard
      g.fillStyle = "#6e4a22"; g.fillRect(22, 36, 4, 8);            // grip
      g.fillStyle = "#ffd34a"; g.beginPath(); g.arc(24, 45, 3, 0, U.TAU); g.fill();
      g.restore();
    });

    one("bow", 48, 48, (g) => {
      g.strokeStyle = "#8a5c2c"; g.lineWidth = 4; g.lineCap = "round";
      g.beginPath(); g.arc(30, 24, 17, Math.PI * .58, Math.PI * 1.42); g.stroke();
      g.strokeStyle = "#c99b4a"; g.lineWidth = 1.4;
      g.beginPath(); g.arc(30, 24, 17, Math.PI * .58, Math.PI * 1.42); g.stroke();
      g.strokeStyle = "#e6ebf5"; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(21, 9.5); g.lineTo(21, 38.5); g.stroke();
      g.strokeStyle = "#b9884f"; g.lineWidth = 2;                   // nocked arrow
      g.beginPath(); g.moveTo(14, 24); g.lineTo(38, 24); g.stroke();
      g.fillStyle = "#d8dde8"; g.beginPath(); g.moveTo(42, 24); g.lineTo(36, 21); g.lineTo(36, 27); g.fill();
    });

    one("shield", 48, 48, (g) => {
      g.beginPath();
      g.moveTo(24, 5); g.lineTo(40, 11); g.lineTo(40, 28);
      g.quadraticCurveTo(40, 40, 24, 45);
      g.quadraticCurveTo(8, 40, 8, 28); g.lineTo(8, 11); g.closePath();
      const grd = g.createLinearGradient(8, 5, 40, 45);
      grd.addColorStop(0, "#b9c8e4"); grd.addColorStop(.5, "#7d8fb2"); grd.addColorStop(1, "#4d5a76");
      g.fillStyle = grd; g.fill(); outline(g, 2, "#333d52");
      g.fillStyle = "#c99b4a";
      g.fillRect(22, 11, 4, 28); g.fillRect(11, 21, 26, 4);         // cross boss
      g.fillStyle = "#ffd34a"; g.beginPath(); g.arc(24, 23, 4, 0, U.TAU); g.fill();
    });

    one("arrows", 48, 48, (g) => {
      for (let i = 0; i < 3; i++) {
        const x = 15 + i * 9, tilt = (i - 1) * 2;
        g.strokeStyle = "#b9884f"; g.lineWidth = 2.2;
        g.beginPath(); g.moveTo(x + tilt, 42); g.lineTo(x - tilt, 10); g.stroke();
        g.fillStyle = "#d8dde8";
        g.beginPath(); g.moveTo(x - tilt, 5); g.lineTo(x - tilt - 4, 13); g.lineTo(x - tilt + 4, 13); g.fill();
        g.fillStyle = "#e05a5a";
        g.beginPath(); g.moveTo(x + tilt, 42); g.lineTo(x + tilt - 5, 36); g.lineTo(x + tilt, 34);
        g.lineTo(x + tilt + 5, 36); g.fill();
      }
    });

    // ---- items ----------------------------------------------------------
    one("potion", 48, 48, (g) => {
      g.fillStyle = "#7d8fb2"; g.fillRect(20, 8, 8, 7);
      g.fillStyle = "#c99b4a"; g.fillRect(19, 5, 10, 5);
      g.beginPath(); g.moveTo(20, 14); g.lineTo(28, 14); g.lineTo(36, 30);
      g.quadraticCurveTo(36, 44, 24, 44); g.quadraticCurveTo(12, 44, 12, 30); g.closePath();
      const grd = g.createLinearGradient(12, 14, 36, 44);
      grd.addColorStop(0, "#ff9ab0"); grd.addColorStop(.45, "#ff4d6d"); grd.addColorStop(1, "#8c1030");
      g.fillStyle = grd; g.fill(); outline(g, 1.6, "#5c0c20");
      g.fillStyle = "rgba(255,255,255,.6)";
      g.beginPath(); g.ellipse(18, 32, 2.5, 5, -0.4, 0, U.TAU); g.fill();
    });

    one("key", 48, 48, (g) => {
      g.save(); g.translate(24, 24); g.rotate(-0.5); g.translate(-24, -24);
      g.strokeStyle = "#ffd34a"; g.lineWidth = 5; g.lineCap = "round";
      g.beginPath(); g.arc(17, 18, 8, 0, U.TAU); g.stroke();
      g.beginPath(); g.moveTo(21, 24); g.lineTo(36, 39); g.stroke();
      g.lineWidth = 4;
      g.beginPath(); g.moveTo(31, 34); g.lineTo(27, 38); g.moveTo(35, 30); g.lineTo(31, 26); g.stroke();
      g.strokeStyle = "#a87c1a"; g.lineWidth = 1;
      g.beginPath(); g.arc(17, 18, 4, 0, U.TAU); g.stroke();
      g.restore();
    });

    one("boots", 48, 48, (g) => {
      for (const dx of [-9, 4]) {
        g.fillStyle = "#6e4a22";
        g.beginPath(); g.moveTo(20 + dx, 14); g.lineTo(28 + dx, 14); g.lineTo(28 + dx, 32);
        g.lineTo(36 + dx, 32); g.lineTo(36 + dx, 40); g.lineTo(20 + dx, 40); g.closePath(); g.fill();
        outline(g, 1.4, "#3a2612");
        g.fillStyle = "#c99b4a"; g.fillRect(20 + dx, 20, 8, 3);
      }
      g.fillStyle = "rgba(138,216,255,.95)";        // speed wings
      for (const s of [-1, 1]) {
        g.beginPath(); g.moveTo(24 + s * 13, 18); g.lineTo(24 + s * 23, 12);
        g.lineTo(24 + s * 20, 22); g.closePath(); g.fill();
      }
    });

    frames("torch", 48, 48, 4, (g, w, h, i, n) => {
      g.fillStyle = "#6e4a22"; g.fillRect(21, 22, 6, 24);
      g.fillStyle = "#3a2612"; g.fillRect(21, 22, 2, 24);
      const f = Math.sin(i / n * U.TAU) * 2;
      const flame = (col, sc) => {
        g.fillStyle = col; g.beginPath();
        g.moveTo(24, 2 + f * sc);
        g.quadraticCurveTo(24 + 9 * sc, 14, 24 + 5 * sc, 22);
        g.quadraticCurveTo(24, 26, 24 - 5 * sc, 22);
        g.quadraticCurveTo(24 - 9 * sc, 14, 24, 2 + f * sc);
        g.fill();
      };
      flame("#ff7a1a", 1); flame("#ffc04a", .62); flame("#fff2b0", .3);
    });

    one("treasure", 48, 48, (g) => {
      g.fillStyle = "#6e4a22"; g.fillRect(8, 22, 32, 18);
      g.fillStyle = "#8a5c2c"; g.fillRect(8, 22, 32, 4);
      g.beginPath(); g.moveTo(8, 22); g.quadraticCurveTo(24, 6, 40, 22); g.closePath();
      g.fillStyle = "#8a5c2c"; g.fill(); outline(g, 1.6, "#3a2612");
      g.strokeStyle = "#c99b4a"; g.lineWidth = 3;
      g.beginPath(); g.moveTo(8, 30); g.lineTo(40, 30); g.stroke();
      g.fillStyle = "#ffd34a"; g.fillRect(21, 26, 6, 9);
      g.fillStyle = "#3a2612"; g.beginPath(); g.arc(24, 31, 1.6, 0, U.TAU); g.fill();
      const rnd = U.rng(3);                          // spilling coins
      for (let i = 0; i < 7; i++) {
        g.fillStyle = i % 2 ? "#ffd34a" : "#ffe98a";
        g.beginPath(); g.arc(11 + rnd() * 26, 38 + rnd() * 5, 2.4, 0, U.TAU); g.fill();
      }
    });

    // ---- enemies --------------------------------------------------------
    blobFactory("blob", TH[T.BLOB]);
    blobFactory("blob_fast", TH[T.BLOB_FAST]);
    blobFactory("blob_tank", TH[T.BLOB_TANK]);

    // ---- projectile -----------------------------------------------------
    one("arrow", 32, 12, (g) => {
      g.strokeStyle = "#b9884f"; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(4, 6); g.lineTo(24, 6); g.stroke();
      g.fillStyle = "#e6ebf5"; g.beginPath(); g.moveTo(31, 6); g.lineTo(22, 1.5); g.lineTo(22, 10.5); g.fill();
      g.fillStyle = "#e05a5a"; g.beginPath(); g.moveTo(2, 6); g.lineTo(8, 1); g.lineTo(9, 6); g.lineTo(8, 11); g.fill();
    });

    // ---- floors -----------------------------------------------------------
    one("stairs_up", 64, 64, (g, w, h) => {
      // a stone flight rising away from you into the opening above
      g.fillStyle = "#2a2d36"; g.fillRect(4, 0, 56, 64);
      for (let k = 0; k < 8; k++) {
        const t = k / 8, y = 60 - k * 7.4, inset = 6 + t * 13, v = 150 - k * 11;
        g.fillStyle = "rgb(" + v + "," + (v - 6) + "," + (v - 20) + ")";
        g.fillRect(inset, y - 5, w - inset * 2, 5);
        g.fillStyle = "rgb(" + (v - 45) + "," + (v - 50) + "," + (v - 60) + ")";
        g.fillRect(inset, y, w - inset * 2, 2.4);
      }
      g.fillStyle = "#0b0c10"; g.fillRect(19, 0, 26, 6);
      g.fillStyle = "#4a4f5c"; g.fillRect(4, 0, 4, 64); g.fillRect(56, 0, 4, 64);      // side walls
    });
    one("ladder_up", 32, 64, (g) => {
      g.fillStyle = "#6e4a22"; g.fillRect(6, 0, 4, 64); g.fillRect(22, 0, 4, 64);
      g.fillStyle = "#3a2612"; g.fillRect(6, 0, 1.5, 64); g.fillRect(22, 0, 1.5, 64);
      g.fillStyle = "#b9884f";
      for (let y = 5; y < 64; y += 8) { g.fillRect(8, y, 16, 3); g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(8, y + 3, 16, 1); g.fillStyle = "#b9884f"; }
    });
    // editor icons for the ways down (in 3D they are cut into the floor)
    one("stairs_down", 48, 48, (g) => {
      g.fillStyle = "#4a4f5c"; g.fillRect(4, 4, 40, 40);
      for (let k = 0; k < 5; k++) { const v = 150 - k * 24; g.fillStyle = "rgb(" + v + "," + (v - 6) + "," + (v - 18) + ")"; g.fillRect(8, 8 + k * 7, 32, 5); }
      g.fillStyle = "#ffd34a"; g.beginPath(); g.moveTo(24, 44); g.lineTo(16, 34); g.lineTo(32, 34); g.fill();
    });
    one("ladder_down", 48, 48, (g) => {
      g.fillStyle = "#3a2612"; g.fillRect(4, 4, 40, 40);
      g.fillStyle = "#050608"; g.fillRect(9, 9, 30, 30);
      g.fillStyle = "#b9884f"; g.fillRect(16, 9, 3, 30); g.fillRect(29, 9, 3, 30);
      for (let y = 13; y < 38; y += 7) g.fillRect(16, y, 16, 2.5);
      g.fillStyle = "#ffd34a"; g.beginPath(); g.moveTo(24, 46); g.lineTo(17, 38); g.lineTo(31, 38); g.fill();
    });

    // ---- magic ------------------------------------------------------------
    for (const id of MAZE.SPELL_ORDER) {
      const sp = MAZE.SPELLS[id];
      one("scroll_" + id, 48, 48, (g) => drawScroll(g, sp.color, id));
    }
    one("mana", 48, 48, (g) => {
      g.fillStyle = "#7d8fb2"; g.fillRect(20, 8, 8, 7);
      g.fillStyle = "#c99b4a"; g.fillRect(19, 5, 10, 5);
      g.beginPath(); g.moveTo(20, 14); g.lineTo(28, 14); g.lineTo(36, 30);
      g.quadraticCurveTo(36, 44, 24, 44); g.quadraticCurveTo(12, 44, 12, 30); g.closePath();
      const grd = g.createLinearGradient(12, 14, 36, 44);
      grd.addColorStop(0, "#b8c8ff"); grd.addColorStop(.45, "#4d6dff"); grd.addColorStop(1, "#1a2480");
      g.fillStyle = grd; g.fill(); outline(g, 1.6, "#0e1450");
      g.fillStyle = "rgba(255,255,255,.6)";
      g.beginPath(); g.ellipse(18, 32, 2.5, 5, -0.4, 0, U.TAU); g.fill();
      g.fillStyle = "#e6f0ff";                                     // sparkle
      for (const [x, y] of [[29, 26], [22, 38], [31, 36]]) { g.fillRect(x - .7, y - 2.5, 1.4, 5); g.fillRect(x - 2.5, y - .7, 5, 1.4); }
    });
    frames("fireball", 24, 24, 3, (g, w, h, i) => {
      const r = 8 + i;
      const grd = g.createRadialGradient(12, 12, 1, 12, 12, r + 3);
      grd.addColorStop(0, "#fff6c8"); grd.addColorStop(.35, "#ffb040"); grd.addColorStop(.7, "#ff4a1a"); grd.addColorStop(1, "rgba(255,40,10,0)");
      g.fillStyle = grd; g.beginPath(); g.arc(12, 12, r + 3, 0, U.TAU); g.fill();
    });
    frames("frostshard", 24, 24, 2, (g, w, h, i) => {
      g.save(); g.translate(12, 12); g.rotate(i * 0.4);
      g.fillStyle = "rgba(143,227,255,.35)"; g.beginPath(); g.arc(0, 0, 10, 0, U.TAU); g.fill();
      g.fillStyle = "#dff7ff"; g.beginPath(); g.moveTo(0, -10); g.lineTo(4, 0); g.lineTo(0, 10); g.lineTo(-4, 0); g.closePath(); g.fill();
      g.fillStyle = "#8fe3ff"; g.beginPath(); g.moveTo(-9, 0); g.lineTo(0, 3); g.lineTo(9, 0); g.lineTo(0, -3); g.closePath(); g.fill();
      g.restore();
    });
    frames("spit", 20, 20, 2, (g, w, h, i) => {
      ellipse(g, 10, 10, 6 + i, 5.5 - i * .5, "#8be04a");
      ellipse(g, 8, 8, 2.2, 1.6, "rgba(255,255,255,.6)");
      g.fillStyle = "#5aa82a"; g.beginPath(); g.arc(15 - i * 2, 14, 2, 0, U.TAU); g.fill();
    });

    // ---- other players --------------------------------------------------
    // hero<seat>_<front|back|left|right>_<fist|sword|bow>: frames stand, step, step, attack
    MAZE.PLAYER_COLORS.forEach((color, seat) => {
      for (const dir of ["front", "back", "left", "right"])
        for (const weapon of ["fist", "sword", "bow"])
          frames("hero" + seat + "_" + dir + "_" + weapon, 40, 64, 4, (g, w, h, i) => drawHero(g, color, dir, weapon, i));
      one("hero" + seat + "_down", 64, 24, (g) => drawDowned(g, color));
    });
  };

  // ----------------------------------------------------------- scrolls --
  function drawScroll(g, color, id) {
    g.save(); g.translate(24, 26); g.rotate(-0.25);
    const paper = g.createLinearGradient(0, -10, 0, 10);
    paper.addColorStop(0, "#f7e8c0"); paper.addColorStop(1, "#d8c08a");
    g.fillStyle = paper; g.fillRect(-15, -9, 30, 18);
    for (const sx of [-17, 17]) {                                  // rolled ends
      const r = g.createLinearGradient(sx - 3, 0, sx + 3, 0);
      r.addColorStop(0, "#b89a5e"); r.addColorStop(.5, "#f2e2b5"); r.addColorStop(1, "#9c7e44");
      g.fillStyle = r; g.fillRect(sx - 3, -11, 6, 22);
    }
    g.strokeStyle = "rgba(90,60,20,.55)"; g.lineWidth = 1;
    for (let y = -5; y <= 5; y += 3.5) { g.beginPath(); g.moveTo(-11, y); g.lineTo(6, y); g.stroke(); }
    g.fillStyle = color;                                           // wax seal with the spell's colour
    g.beginPath(); g.arc(9, 3, 5.5, 0, U.TAU); g.fill();
    g.strokeStyle = "rgba(0,0,0,.35)"; g.stroke();
    g.fillStyle = "rgba(255,255,255,.75)";
    g.font = "bold 7px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText({ fire: "✦", frost: "❄", heal: "+", bolt: "ϟ", blink: "◈", ward: "◆" }[id] || "*", 9, 3.5);
    g.restore();
    // a faint glow so scrolls read as magic from across a room
    g.globalCompositeOperation = "destination-over";
    const glow = g.createRadialGradient(24, 26, 4, 24, 26, 22);
    glow.addColorStop(0, color + "66"); glow.addColorStop(1, color + "00");
    g.fillStyle = glow; g.fillRect(0, 0, 48, 48);
    g.globalCompositeOperation = "source-over";
  }

  // ---------------------------------------------------------- monsters --
  // Custom monsters from the Monster Maker: one of seven bodies drawn in the maker's
  // colours, six frames of animation. Built on demand and cached by look.
  function hexTint(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k)));
    return "rgb(" + f(n >> 16) + "," + f((n >> 8) & 255) + "," + f(n & 255) + ")";
  }

  S.monster = function (m) {
    const name = MAZE.Level.monsterSprite(m);
    if (S.map[name]) return name;
    const draw = BODY[m.body] || BODY.slime;
    frames(name, 64, 64, 6, (g, w, h, i, n) => draw(g, m, (i / n) * U.TAU, i));
    return name;
  };

  const BODY = {
    slime(g, m, t) {
      const squash = 1 + Math.sin(t) * 0.11, stretch = 1 - Math.sin(t) * 0.09;
      const rx = 23 * squash, ry = 20 * stretch, cy = 60 - ry + Math.cos(t) * 2;
      ellipse(g, 32, 61, rx * 0.8, 3.5, "rgba(0,0,0,.35)");
      const grd = g.createRadialGradient(32 - rx * .35, cy - ry * .45, 2, 32, cy, rx * 1.15);
      grd.addColorStop(0, hexTint(m.c1, 0.45)); grd.addColorStop(.6, m.c1); grd.addColorStop(1, hexTint(m.c2, -0.3));
      g.beginPath();
      for (let a = 0; a <= U.TAU + .01; a += U.TAU / 30) {
        const wob = 1 + Math.sin(a * 3 + t * 2) * 0.05 + Math.sin(a * 5 - t) * 0.03;
        const px = 32 + Math.cos(a) * rx * wob, py = cy + Math.sin(a) * ry * wob;
        a === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
      }
      g.closePath(); g.fillStyle = grd; g.fill(); outline(g, 1.5, "rgba(0,0,0,.4)");
      ellipse(g, 32 - rx * .38, cy - ry * .42, rx * .22, ry * .16, "rgba(255,255,255,.5)");
      eyes(g, m, 32, cy - ry * .05, rx * .34, rx * .2, t);
      g.strokeStyle = hexTint(m.c2, -0.5); g.lineWidth = 2;
      g.beginPath(); g.arc(32, cy + ry * .34, rx * .3, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
    },

    spider(g, m, t) {
      ellipse(g, 32, 61, 26, 3.5, "rgba(0,0,0,.35)");
      const body = 38 + Math.sin(t * 2) * 1.2;
      g.strokeStyle = hexTint(m.c2, -0.35); g.lineCap = "round";
      for (let k = 0; k < 4; k++) {                                   // eight legs, walking in pairs
        for (const side of [-1, 1]) {
          const ph = Math.sin(t + k * 1.6 + (side > 0 ? Math.PI : 0));
          const hipX = 32 + side * (5 + k * 2), hipY = body - 2 + k * 2.5;
          const kneeX = 32 + side * (16 + k * 4), kneeY = body - 14 - ph * 3 + k * 2;
          const footX = 32 + side * (22 + k * 3.5 + ph * 2), footY = 60 - Math.max(0, ph) * 3;
          g.lineWidth = 3;
          g.beginPath(); g.moveTo(hipX, hipY); g.lineTo(kneeX, kneeY); g.lineTo(footX, footY); g.stroke();
        }
      }
      const abd = g.createRadialGradient(28, body - 16, 2, 32, body - 12, 18);
      abd.addColorStop(0, hexTint(m.c1, 0.35)); abd.addColorStop(1, hexTint(m.c1, -0.35));
      ellipse(g, 32, body - 12, 17, 13, abd);                        // abdomen behind
      g.fillStyle = hexTint(m.c2, 0.1);                               // markings
      g.beginPath(); g.moveTo(32, body - 22); g.lineTo(36, body - 13); g.lineTo(32, body - 6); g.lineTo(28, body - 13); g.closePath(); g.fill();
      ellipse(g, 32, body + 2, 11, 9, hexTint(m.c1, -0.15));         // head
      for (const [ex, ey, r] of [[-5, -1, 2.4], [5, -1, 2.4], [-2, -4, 1.6], [2, -4, 1.6], [-8, 2, 1.3], [8, 2, 1.3]]) {
        ellipse(g, 32 + ex, body + ey, r, r, m.c3);
        ellipse(g, 32 + ex - r * .3, body + ey - r * .3, r * .35, r * .35, "rgba(255,255,255,.8)");
      }
      g.fillStyle = hexTint(m.c2, -0.5);                              // fangs
      g.beginPath(); g.moveTo(29, body + 8); g.lineTo(30.5, body + 13); g.lineTo(31.5, body + 8); g.fill();
      g.beginPath(); g.moveTo(32.5, body + 8); g.lineTo(33.5, body + 13); g.lineTo(35, body + 8); g.fill();
    },

    goblin(g, m, t) { humanoid(g, m, t, { head: 11, shoulders: 9, height: 0.78, ears: true, weapon: "dagger", hood: false }); },
    orc(g, m, t) { humanoid(g, m, t, { head: 10, shoulders: 15, height: 1, tusks: true, weapon: "axe", bulk: true }); },
    skeleton(g, m, t) { humanoid(g, m, t, { head: 9, shoulders: 10, height: 0.95, bones: true, weapon: "sword" }); },

    bat(g, m, t) {
      ellipse(g, 32, 62, 10, 2, "rgba(0,0,0,.2)");
      const flap = Math.sin(t * 2);
      const cy = 30 + Math.sin(t) * 2;
      for (const side of [-1, 1]) {                                   // membrane wings
        g.fillStyle = hexTint(m.c2, -0.1);
        g.beginPath();
        g.moveTo(32 + side * 5, cy - 2);
        g.lineTo(32 + side * 18, cy - 14 - flap * 10);
        g.lineTo(32 + side * 30, cy - 6 - flap * 14);
        g.lineTo(32 + side * 26, cy + 4 - flap * 6);
        g.lineTo(32 + side * 20, cy + 1 - flap * 4);
        g.lineTo(32 + side * 14, cy + 8 - flap * 2);
        g.lineTo(32 + side * 6, cy + 5);
        g.closePath(); g.fill();
        g.strokeStyle = hexTint(m.c2, -0.5); g.lineWidth = 1.2; g.stroke();
      }
      ellipse(g, 32, cy + 2, 8, 10, m.c1);
      g.fillStyle = m.c1;                                             // ears
      g.beginPath(); g.moveTo(26, cy - 5); g.lineTo(27, cy - 14); g.lineTo(30, cy - 7); g.fill();
      g.beginPath(); g.moveTo(38, cy - 5); g.lineTo(37, cy - 14); g.lineTo(34, cy - 7); g.fill();
      ellipse(g, 29, cy - 1, 2.2, 2.4, m.c3); ellipse(g, 35, cy - 1, 2.2, 2.4, m.c3);
      g.fillStyle = "#fff"; g.fillRect(30, cy + 5, 1.4, 3); g.fillRect(33, cy + 5, 1.4, 3);
    },

    ghost(g, m, t) {
      const cy = 26 + Math.sin(t) * 3;
      ellipse(g, 32, 62, 12, 2.5, "rgba(0,0,0,.18)");
      const grd = g.createLinearGradient(0, cy - 20, 0, 62);
      grd.addColorStop(0, hexTint(m.c1, 0.4)); grd.addColorStop(.6, m.c1); grd.addColorStop(1, hexTint(m.c1, -0.2));
      g.globalAlpha = 0.85;
      g.beginPath();
      g.moveTo(14, cy + 4);
      g.bezierCurveTo(14, cy - 26, 50, cy - 26, 50, cy + 4);
      for (let k = 0; k <= 6; k++) {                                  // ragged, drifting tail
        const x = 50 - k * 6, y = 58 + Math.sin(t * 2 + k * 1.3) * 3 + (k % 2 ? -4 : 0);
        g.lineTo(x, y);
      }
      g.closePath(); g.fillStyle = grd; g.fill();
      g.globalAlpha = 1;
      for (const side of [-1, 1]) {                                   // trailing arms
        g.strokeStyle = hexTint(m.c1, -0.1); g.lineWidth = 4; g.lineCap = "round";
        g.beginPath(); g.moveTo(32 + side * 15, cy + 6); g.quadraticCurveTo(32 + side * 24, cy + 14 + Math.sin(t + side) * 3, 32 + side * 20, cy + 22); g.stroke();
      }
      const glow = g.createRadialGradient(32, cy, 1, 32, cy, 14);
      glow.addColorStop(0, m.c3 + "cc"); glow.addColorStop(1, m.c3 + "00");
      g.fillStyle = glow; g.fillRect(16, cy - 14, 32, 28);
      ellipse(g, 26, cy - 2, 3.4, 4.4, hexTint(m.c2, -0.6)); ellipse(g, 38, cy - 2, 3.4, 4.4, hexTint(m.c2, -0.6));
      ellipse(g, 26, cy - 2, 1.5, 1.8, m.c3); ellipse(g, 38, cy - 2, 1.5, 1.8, m.c3);
      ellipse(g, 32, cy + 8, 3, 4 + Math.sin(t * 2), hexTint(m.c2, -0.6));
    }
  };

  function eyes(g, m, cx, cy, spread, r, t) {
    const look = Math.sin(t) * r * .18;
    for (const s of [-1, 1]) {
      ellipse(g, cx + s * spread, cy, r, r * 1.15, "#f3fbf0");
      ellipse(g, cx + s * spread + look, cy + 1, r * .5, r * .6, m.c3 === "#ffffff" ? "#1a1a22" : m.c3);
    }
  }

  // goblins, orcs and skeletons share a walking body; opts shape it
  function humanoid(g, m, t, o) {
    const H = o.height, step = Math.sin(t), bob = Math.abs(Math.cos(t)) * 1.5;
    const top = 64 - 62 * H;
    const hipY = 64 - 22 * H - bob, neckY = top + o.head * 2 + 2 - bob;
    const skin = m.c1, cloth = m.c2;
    ellipse(g, 32, 61.5, o.shoulders * 1.4, 3, "rgba(0,0,0,.35)");
    // legs
    for (const side of [-1, 1]) {
      const swing = step * side * 4;
      const kx = 32 + side * (o.bulk ? 6 : 4) + swing * 0.5, fx = 32 + side * (o.bulk ? 7 : 4.5) + swing;
      g.strokeStyle = o.bones ? skin : hexTint(cloth, -0.35);
      g.lineWidth = o.bones ? 2.4 : o.bulk ? 6 : 4.2; g.lineCap = "round";
      g.beginPath(); g.moveTo(32 + side * 3, hipY); g.lineTo(kx, hipY + (61 - hipY) * 0.5); g.lineTo(fx, 60); g.stroke();
      if (!o.bones) { g.fillStyle = "#2a1c10"; g.fillRect(fx - 3, 58.5, 6, 3); }
    }
    // torso
    const sw = o.shoulders;
    if (o.bones) {
      g.strokeStyle = skin; g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(32, neckY); g.lineTo(32, hipY); g.stroke();                      // spine
      for (let k = 0; k < 4; k++) {                                                            // ribs
        const y = neckY + 4 + k * 4;
        g.beginPath(); g.ellipse(32, y, sw - k * 1.2, 2.2, 0, Math.PI * 0.05, Math.PI * 0.95); g.stroke();
      }
      g.beginPath(); g.ellipse(32, hipY, 6, 3, 0, 0, U.TAU); g.stroke();                       // pelvis
    } else {
      const tg = g.createLinearGradient(32 - sw, 0, 32 + sw, 0);
      tg.addColorStop(0, hexTint(cloth, -0.35)); tg.addColorStop(.5, cloth); tg.addColorStop(1, hexTint(cloth, -0.35));
      g.fillStyle = tg;
      g.beginPath(); g.moveTo(32 - sw, neckY + 2); g.lineTo(32 + sw, neckY + 2); g.lineTo(32 + sw * .75, hipY + 2); g.lineTo(32 - sw * .75, hipY + 2); g.closePath(); g.fill();
      outline(g, 1, "rgba(0,0,0,.45)");
      g.fillStyle = "#3a2612"; g.fillRect(32 - sw * .78, hipY - 2, sw * 1.56, 3);            // belt
      if (o.bulk) { g.fillStyle = hexTint(cloth, 0.25); g.fillRect(32 - sw - 1, neckY + 1, 6, 5); g.fillRect(32 + sw - 5, neckY + 1, 6, 5); }   // pauldrons
    }
    // arms: the weapon arm lifts and swings
    const armCol = o.bones ? skin : skin;
    const swingA = Math.sin(t) * 0.5;
    g.strokeStyle = armCol; g.lineWidth = o.bones ? 2.2 : o.bulk ? 5.5 : 3.6; g.lineCap = "round";
    g.beginPath(); g.moveTo(32 - sw, neckY + 3); g.lineTo(32 - sw - 3, neckY + 12 - step * 2); g.lineTo(32 - sw - 2, hipY); g.stroke();
    const hx = 32 + sw + 5 + swingA * 3, hy = neckY + 11 - swingA * 6;
    g.beginPath(); g.moveTo(32 + sw, neckY + 3); g.lineTo(hx, hy); g.stroke();
    weapon(g, o.weapon, hx, hy, -0.6 + swingA, m);
    // head
    const hy0 = neckY - o.head;
    if (o.bones) {
      ellipse(g, 32, hy0, o.head * 0.95, o.head, skin);
      g.fillStyle = hexTint(skin, -0.2); g.fillRect(27, hy0 + o.head * 0.55, 10, 4);            // jaw
      g.fillStyle = "#0a0a0e";
      ellipse(g, 28.5, hy0 - 1, 2.8, 3.2, "#0a0a0e"); ellipse(g, 35.5, hy0 - 1, 2.8, 3.2, "#0a0a0e");
      ellipse(g, 28.5, hy0 - 1, 1.1, 1.2, m.c3); ellipse(g, 35.5, hy0 - 1, 1.1, 1.2, m.c3);
      g.fillStyle = "#0a0a0e"; g.beginPath(); g.moveTo(32, hy0 + 2); g.lineTo(30.5, hy0 + 5); g.lineTo(33.5, hy0 + 5); g.fill();
      for (let k = 0; k < 4; k++) g.fillRect(28 + k * 2.3, hy0 + o.head * 0.55, 0.9, 3);
    } else {
      if (o.ears) for (const s of [-1, 1]) {                                                    // goblin ears
        g.fillStyle = skin;
        g.beginPath(); g.moveTo(32 + s * o.head * 0.7, hy0 - 2); g.lineTo(32 + s * (o.head + 9), hy0 - 6); g.lineTo(32 + s * o.head * 0.7, hy0 + 3); g.closePath(); g.fill();
        outline(g, 1, "rgba(0,0,0,.35)");
      }
      const hg = g.createRadialGradient(29, hy0 - 3, 1, 32, hy0, o.head * 1.2);
      hg.addColorStop(0, hexTint(skin, 0.3)); hg.addColorStop(1, hexTint(skin, -0.2));
      ellipse(g, 32, hy0, o.head, o.head * (o.bulk ? 0.9 : 1), hg);
      g.strokeStyle = "rgba(0,0,0,.4)"; g.lineWidth = 1; g.beginPath(); g.ellipse(32, hy0, o.head, o.head * (o.bulk ? 0.9 : 1), 0, 0, U.TAU); g.stroke();
      if (o.bulk) { g.fillStyle = hexTint(skin, -0.35); g.fillRect(24, hy0 - 5, 16, 2.5); }       // heavy brow
      ellipse(g, 28.5, hy0 - 1, 1.9, 1.7, m.c3); ellipse(g, 35.5, hy0 - 1, 1.9, 1.7, m.c3);
      g.fillStyle = "#1a0f08"; g.fillRect(28, hy0 + o.head * 0.45, 8, 1.6);                     // mouth
      if (o.tusks) { g.fillStyle = "#f4efe0"; g.beginPath(); g.moveTo(27.5, hy0 + 5); g.lineTo(28.5, hy0 + 1); g.lineTo(29.8, hy0 + 5); g.fill(); g.beginPath(); g.moveTo(34.2, hy0 + 5); g.lineTo(35.5, hy0 + 1); g.lineTo(36.5, hy0 + 5); g.fill(); }
      if (o.ears) { g.fillStyle = "#fff"; g.fillRect(30, hy0 + o.head * 0.45 + 1.4, 1.2, 1.6); g.fillRect(33, hy0 + o.head * 0.45 + 1.4, 1.2, 1.6); }
    }
  }

  function weapon(g, kind, x, y, ang, m) {
    g.save(); g.translate(x, y); g.rotate(ang);
    if (kind === "axe") {
      g.fillStyle = "#6e4a22"; g.fillRect(-1.5, -20, 3, 26);
      g.fillStyle = "#aab2c0";
      g.beginPath(); g.moveTo(1, -20); g.quadraticCurveTo(12, -17, 11, -8); g.lineTo(1, -11); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(-1, -20); g.quadraticCurveTo(-9, -17, -8, -10); g.lineTo(-1, -12); g.closePath(); g.fill();
      outline(g, .8, "rgba(0,0,0,.5)");
    } else if (kind === "dagger") {
      g.fillStyle = "#6e4a22"; g.fillRect(-1, -2, 2, 5);
      g.fillStyle = "#c99b4a"; g.fillRect(-3, -3, 6, 1.5);
      g.fillStyle = "#d8dde8"; g.beginPath(); g.moveTo(-1.2, -3); g.lineTo(1.2, -3); g.lineTo(0, -12); g.closePath(); g.fill();
    } else {
      g.fillStyle = "#6e4a22"; g.fillRect(-1.2, -2, 2.4, 5);
      g.fillStyle = "#8a6a3a"; g.fillRect(-3.5, -3, 7, 1.8);
      g.fillStyle = hexTint(m.c2 || "#aab2c0", 0.2);
      g.fillRect(-1.3, -19, 2.6, 16);
      g.fillStyle = "rgba(120,70,30,.6)"; g.fillRect(-1.3, -12, 2.6, 3);                          // rust
    }
    g.restore();
  }

  // ------------------------------------------------------------ heroes --
  function tint(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k)));
    return "rgb(" + f(n >> 16) + "," + f((n >> 8) & 255) + "," + f(n & 255) + ")";
  }

  function drawSword(g, x, y, ang, len) {
    g.save(); g.translate(x, y); g.rotate(ang);
    g.fillStyle = "#6e4a22"; g.fillRect(-1.5, -1, 3, 5);                 // grip
    g.fillStyle = "#c99b4a"; g.fillRect(-4, -2.5, 8, 2);                 // guard
    const grd = g.createLinearGradient(-2, 0, 2, 0);
    grd.addColorStop(0, "#f2f6ff"); grd.addColorStop(1, "#8a93a7");
    g.fillStyle = grd;
    g.beginPath(); g.moveTo(-1.8, -2.5); g.lineTo(1.8, -2.5); g.lineTo(1.2, -len); g.lineTo(0, -len - 3); g.lineTo(-1.2, -len); g.closePath(); g.fill();
    g.restore();
  }
  function drawBow(g, x, y, ang, drawn) {
    g.save(); g.translate(x, y); g.rotate(ang);
    g.strokeStyle = "#8a5c2c"; g.lineWidth = 2.4; g.lineCap = "round";
    g.beginPath(); g.arc(0, 0, 11, -1.15, 1.15); g.stroke();
    g.strokeStyle = "#e6ebf5"; g.lineWidth = 0.8;
    const pull = drawn ? -6 : 0;
    g.beginPath(); g.moveTo(Math.cos(-1.15) * 11, Math.sin(-1.15) * 11); g.lineTo(pull, 0); g.lineTo(Math.cos(1.15) * 11, Math.sin(1.15) * 11); g.stroke();
    if (drawn) { g.strokeStyle = "#b9884f"; g.lineWidth = 1.4; g.beginPath(); g.moveTo(pull, 0); g.lineTo(14, 0); g.stroke(); }
    g.restore();
  }

  // A small hooded adventurer in the seat's colour. i: 0 stand, 1/2 walking, 3 attacking.
  function drawHero(g, color, dir, weapon, i) {
    const dark = tint(color, -0.45), light = tint(color, 0.3);
    const skin = "#e0b08a", boot = "#3a2612", cx = 20;
    const side = dir === "left" || dir === "right";
    const flip = dir === "left" ? -1 : 1;
    const step = i === 1 ? 1 : i === 2 ? -1 : 0;
    const attack = i === 3;
    const bobY = step ? -1 : 0;

    ellipse(g, cx, 61, 11, 2.6, "rgba(0,0,0,.35)");

    // legs
    g.fillStyle = dark;
    if (side) {
      const a = step * 4;
      g.save(); g.translate(cx, 45 + bobY);
      for (const s of [a, -a]) {
        g.save(); g.rotate(s * 0.08 * flip);
        g.fillStyle = dark; g.fillRect(-2.5, 0, 5, 12);
        g.fillStyle = boot; g.fillRect(-2.5, 11, 5 + 2 * flip, 4);
        g.restore();
      }
      g.restore();
    } else {
      const lUp = step > 0 ? 2 : 0, rUp = step < 0 ? 2 : 0;
      g.fillRect(13, 45 + bobY, 5, 12 - lUp); g.fillRect(22, 45 + bobY, 5, 12 - rUp);
      g.fillStyle = boot;
      g.fillRect(12.5, 56 - lUp + bobY, 6, 4); g.fillRect(21.5, 56 - rUp + bobY, 6, 4);
    }

    // tunic
    const bw = side ? 7 : 9.5;
    const tg = g.createLinearGradient(cx - bw, 0, cx + bw, 0);
    tg.addColorStop(0, dark); tg.addColorStop(0.45, color); tg.addColorStop(1, dark);
    g.fillStyle = tg;
    g.beginPath();
    g.moveTo(cx - bw + 1.5, 24 + bobY); g.lineTo(cx + bw - 1.5, 24 + bobY);
    g.lineTo(cx + bw + 1.5, 47 + bobY); g.lineTo(cx - bw - 1.5, 47 + bobY); g.closePath(); g.fill();
    outline(g, 1, "rgba(0,0,0,.45)");
    g.fillStyle = "#3a2612"; g.fillRect(cx - bw - 0.5, 39 + bobY, bw * 2 + 1, 2.5);          // belt
    g.fillStyle = "#c99b4a"; g.fillRect(cx - 1.5, 39 + bobY, 3, 2.5);
    if (dir === "back") { g.fillStyle = dark; g.fillRect(cx - bw + 1, 25 + bobY, bw * 2 - 2, 19); }   // cloak

    // arms and whatever they are holding
    const armCol = tint(color, -0.2);
    const hand = (x, y) => { ellipse(g, x, y, 2.2, 2.2, skin); };
    const armTo = (sx, sy, hx, hy) => { g.strokeStyle = armCol; g.lineWidth = 4; g.lineCap = "round"; g.beginPath(); g.moveTo(sx, sy); g.lineTo(hx, hy); g.stroke(); hand(hx, hy); };
    if (side) {
      const sx = cx, sy = 27 + bobY;
      let hx = cx + flip * (attack ? 11 : 5), hy = attack ? 22 + bobY : 38 + bobY + step;
      if (weapon === "sword") { armTo(sx, sy, hx, hy); drawSword(g, hx, hy, attack ? flip * 1.2 : flip * 0.35, 15); }
      else if (weapon === "bow") { hx = cx + flip * 10; hy = 30 + bobY; armTo(sx, sy, hx, hy); drawBow(g, hx, hy, flip > 0 ? 0 : Math.PI, attack); }
      else armTo(sx, sy, hx, hy);
    } else {
      const ls = [cx - bw, 27 + bobY], rs = [cx + bw, 27 + bobY];
      const swingR = attack ? [cx + bw + 3, 17 + bobY] : [cx + bw + 2, 40 + bobY - step];
      armTo(ls[0], ls[1], cx - bw - 2, 40 + bobY + step);
      if (weapon === "sword") {
        if (dir === "back") { drawSword(g, swingR[0], swingR[1], attack ? -0.4 : 0.25, 15); armTo(rs[0], rs[1], swingR[0], swingR[1]); }
        else { armTo(rs[0], rs[1], swingR[0], swingR[1]); drawSword(g, swingR[0], swingR[1], attack ? -0.5 : 0.3, 15); }
      } else if (weapon === "bow") {
        const bx = dir === "back" ? cx + 4 : cx + 5, by = 31 + bobY;
        armTo(rs[0], rs[1], bx, by);
        drawBow(g, bx, by, -Math.PI / 2, attack);
      } else {
        armTo(rs[0], rs[1], attack ? cx + 4 : swingR[0], attack ? 28 + bobY : swingR[1]);
      }
    }

    // head and hood
    const hy = 15 + bobY;
    ellipse(g, cx, hy, 7.5, 8, dir === "back" ? dark : skin);
    g.fillStyle = dark;
    g.beginPath();
    if (dir === "back") g.arc(cx, hy, 8.4, 0, U.TAU);
    else if (side) { g.arc(cx - flip * 1.2, hy - 1, 8.4, Math.PI * (flip > 0 ? 0.62 : -0.6), Math.PI * (flip > 0 ? 2.02 : 0.4)); }
    else g.arc(cx, hy - 1, 8.4, Math.PI * 0.96, Math.PI * 2.04);
    g.fill();
    g.fillStyle = light; g.fillRect(cx - 7, hy - 7 + (dir === "back" ? 0 : 1), 14, 2);           // hood trim
    if (dir === "front") {
      ellipse(g, cx - 2.8, hy + 1, 1.3, 1.6, "#1a1a22");
      ellipse(g, cx + 2.8, hy + 1, 1.3, 1.6, "#1a1a22");
    } else if (side) {
      ellipse(g, cx + flip * 4, hy + 1, 1.2, 1.5, "#1a1a22");
    }
  }

  function drawDowned(g, color) {
    const dark = tint(color, -0.45);
    ellipse(g, 32, 20, 26, 3.5, "rgba(0,0,0,.4)");
    g.fillStyle = dark; g.fillRect(40, 13, 16, 6);                          // legs
    g.fillStyle = "#3a2612"; g.fillRect(55, 12, 4, 7);
    g.fillStyle = color; g.fillRect(18, 10, 24, 10);                        // body
    outline(g, 1, "rgba(0,0,0,.45)");
    ellipse(g, 12, 15, 7, 6.5, "#e0b08a");                                  // head
    g.fillStyle = dark; g.beginPath(); g.arc(12, 14, 7, Math.PI * 0.6, Math.PI * 1.9); g.fill();
    g.strokeStyle = "rgba(255,255,255,.55)"; g.lineWidth = 1;               // stars circling
    for (let k = 0; k < 3; k++) { const a = k * 2.1; g.beginPath(); g.arc(12 + Math.cos(a) * 9, 5 + Math.sin(a) * 2.5, 1.2, 0, U.TAU); g.stroke(); }
  }
})();
