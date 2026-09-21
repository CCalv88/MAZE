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
    one("start", 48, 48, (g) => {
      g.fillStyle = "#6ee06e";
      g.beginPath(); g.moveTo(24, 8); g.lineTo(38, 30); g.lineTo(28, 30); g.lineTo(28, 42);
      g.lineTo(20, 42); g.lineTo(20, 30); g.lineTo(10, 30); g.closePath(); g.fill();
      outline(g, 2, "#2f6b2f");
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
  };
})();
