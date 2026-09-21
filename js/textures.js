/* MAZE — procedurally generated wall/floor textures. No external assets. */
(function () {
  const MAZE = window.MAZE;
  const U = MAZE.util;
  const SIZE = 64;

  const Tex = (MAZE.textures = { size: SIZE, map: {} });

  function make(name, draw, noise) {
    const c = document.createElement("canvas");
    c.width = c.height = SIZE;
    const g = c.getContext("2d");
    draw(g, SIZE);
    const img = g.getImageData(0, 0, SIZE, SIZE);
    const px = new Uint32Array(img.data.buffer);
    if (noise) {
      const rnd = U.rng(name.length * 9176 + 13);
      for (let i = 0; i < px.length; i++) {
        const n = (rnd() - 0.5) * noise;
        const c0 = px[i];
        const r = U.clamp((c0 & 255) + n, 0, 255) | 0;
        const gg = U.clamp(((c0 >> 8) & 255) + n, 0, 255) | 0;
        const b = U.clamp(((c0 >> 16) & 255) + n, 0, 255) | 0;
        px[i] = (255 << 24) | (b << 16) | (gg << 8) | r;
      }
    }
    // re-upload the noisy pixels so the canvas matches the buffer (editor uses the canvas)
    g.putImageData(img, 0, 0);
    Tex.map[name] = { name, data: px.slice(), canvas: c, size: SIZE };
    return Tex.map[name];
  }

  Tex.get = (name) => Tex.map[name] || Tex.map.brick;

  function bricks(g, S, mortar, a, b, rowH, brickW) {
    g.fillStyle = mortar;
    g.fillRect(0, 0, S, S);
    const rnd = U.rng(a.length * 331 + rowH);
    for (let y = 0, row = 0; y < S; y += rowH, row++) {
      const off = row % 2 ? -brickW / 2 : 0;
      for (let x = off; x < S; x += brickW) {
        const t = rnd();
        g.fillStyle = t < 0.5 ? a : b;
        g.fillRect(x + 1, y + 1, brickW - 2, rowH - 2);
        // top highlight + bottom shadow give the blocks some relief
        g.fillStyle = "rgba(255,255,255,.07)";
        g.fillRect(x + 1, y + 1, brickW - 2, 1);
        g.fillStyle = "rgba(0,0,0,.22)";
        g.fillRect(x + 1, y + rowH - 2, brickW - 2, 1);
      }
    }
  }

  MAZE.buildTextures = function () {
    make("brick", (g, S) => {
      bricks(g, S, "#2e2119", "#8c4a32", "#7a3f2a", 16, 32);
    }, 22);

    make("stone", (g, S) => {
      bricks(g, S, "#1d2028", "#6f7684", "#616876", 21, 32);
      g.strokeStyle = "rgba(0,0,0,.25)";
      g.lineWidth = 1;
      const rnd = U.rng(77);
      for (let i = 0; i < 9; i++) { // hairline cracks
        g.beginPath();
        let x = rnd() * S, y = rnd() * S;
        g.moveTo(x, y);
        for (let k = 0; k < 4; k++) { x += (rnd() - 0.5) * 14; y += (rnd() - 0.5) * 14; g.lineTo(x, y); }
        g.stroke();
      }
    }, 20);

    make("moss", (g, S) => {
      bricks(g, S, "#171d18", "#5c6a5a", "#4e5b4c", 21, 32);
      const rnd = U.rng(404);
      for (let i = 0; i < 150; i++) {
        const x = rnd() * S, y = rnd() * S, r = 1 + rnd() * 4;
        g.fillStyle = "rgba(" + (60 + rnd() * 50 | 0) + "," + (110 + rnd() * 70 | 0) + ",60,.5)";
        g.beginPath(); g.arc(x, y, r, 0, U.TAU); g.fill();
      }
    }, 16);

    // "secret" is only used when a level has no other wall style to mimic
    make("secret", (g, S) => { bricks(g, S, "#2e2119", "#8c4a32", "#7a3f2a", 16, 32); }, 22);

    make("door", (g, S) => {
      g.fillStyle = "#3a2612"; g.fillRect(0, 0, S, S);
      for (let x = 2; x < S; x += 13) { // planks
        const grd = g.createLinearGradient(x, 0, x + 11, 0);
        grd.addColorStop(0, "#6b4620"); grd.addColorStop(.5, "#8a5c2c"); grd.addColorStop(1, "#5e3c1b");
        g.fillStyle = grd; g.fillRect(x, 2, 11, S - 4);
      }
      g.fillStyle = "#3c4450"; // iron bands
      g.fillRect(0, 8, S, 7); g.fillRect(0, S - 15, S, 7);
      g.fillStyle = "#59636f";
      g.fillRect(0, 8, S, 2); g.fillRect(0, S - 15, S, 2);
      g.fillStyle = "#2a3038"; // rivets
      for (let x = 5; x < S; x += 11) { g.fillRect(x, 10, 3, 3); g.fillRect(x, S - 13, 3, 3); }
      g.fillStyle = "#ffcf5a"; // keyhole plate
      g.beginPath(); g.arc(S / 2, S / 2 + 2, 6, 0, U.TAU); g.fill();
      g.fillStyle = "#1a1207";
      g.beginPath(); g.arc(S / 2, S / 2, 2.6, 0, U.TAU); g.fill();
      g.fillRect(S / 2 - 1.4, S / 2, 2.8, 6);
    }, 10);

    make("glass", (g, S) => {
      g.fillStyle = "#9fe6ff"; g.fillRect(0, 0, S, S);
      g.strokeStyle = "#5f93a8"; g.lineWidth = 3;
      g.strokeRect(1.5, 1.5, S - 3, S - 3);
      g.beginPath(); g.moveTo(S / 2, 0); g.lineTo(S / 2, S); g.moveTo(0, S / 2); g.lineTo(S, S / 2); g.stroke();
      g.strokeStyle = "rgba(255,255,255,.85)"; g.lineWidth = 2;
      g.beginPath(); g.moveTo(6, 26); g.lineTo(24, 5); g.moveTo(12, 28); g.lineTo(28, 9); g.stroke();
      g.beginPath(); g.moveTo(38, 58); g.lineTo(58, 36); g.stroke();
    }, 0);

    make("floor", (g, S) => {
      g.fillStyle = "#23262e"; g.fillRect(0, 0, S, S);
      const rnd = U.rng(912);
      for (let y = 0; y < S; y += 16) {
        for (let x = 0; x < S; x += 16) {
          const o = (y / 16) % 2 ? 8 : 0;
          const v = 44 + rnd() * 26 | 0;
          g.fillStyle = "rgb(" + v + "," + (v + 3) + "," + (v + 9) + ")";
          g.fillRect(x + o + 1, y + 1, 14, 14);
          g.fillStyle = "rgba(255,255,255,.05)";
          g.fillRect(x + o + 1, y + 1, 14, 1);
        }
      }
    }, 14);

    make("ceil", (g, S) => {
      g.fillStyle = "#14161d"; g.fillRect(0, 0, S, S);
      const rnd = U.rng(555);
      for (let i = 0; i < 90; i++) {
        const v = 22 + rnd() * 22 | 0;
        g.fillStyle = "rgb(" + v + "," + v + "," + (v + 6) + ")";
        g.fillRect(rnd() * S | 0, rnd() * S | 0, 3 + rnd() * 9 | 0, 3 + rnd() * 9 | 0);
      }
    }, 10);

    // warm glow tile laid around the exit portal so you can spot it from afar
    make("floorExit", (g, S) => {
      const grd = g.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
      grd.addColorStop(0, "#6ffce8"); grd.addColorStop(.45, "#1f8c82"); grd.addColorStop(1, "#16323a");
      g.fillStyle = grd; g.fillRect(0, 0, S, S);
    }, 8);

    // ---- floors: the way down is a stairwell cut into the floor ----
    make("floorStairs", (g, S) => {
      g.fillStyle = "#1a1c22"; g.fillRect(0, 0, S, S);
      g.fillStyle = "#4a4f5c"; g.fillRect(0, 0, S, 5); g.fillRect(0, 0, 5, S); g.fillRect(S - 5, 0, 5, S); g.fillRect(0, S - 5, S, 5);
      // steps drop away and darken the further down they go
      for (let k = 0; k < 7; k++) {
        const y = 6 + k * 8, v = 118 - k * 15;
        g.fillStyle = "rgb(" + v + "," + (v - 6) + "," + (v - 18) + ")";
        g.fillRect(6, y, S - 12, 6);
        g.fillStyle = "rgba(0,0,0,.45)"; g.fillRect(6, y + 6, S - 12, 2);
      }
    }, 10);
    make("floorHatch", (g, S) => {
      g.fillStyle = "#3a2612"; g.fillRect(0, 0, S, S);
      g.fillStyle = "#050608"; g.fillRect(9, 9, S - 18, S - 18);
      g.strokeStyle = "#8a5c2c"; g.lineWidth = 4; g.strokeRect(7, 7, S - 14, S - 14);
      g.fillStyle = "#b9884f";                                  // the ladder's top rungs
      g.fillRect(22, 9, 4, S - 18); g.fillRect(S - 26, 9, 4, S - 18);
      for (let y = 14; y < S - 12; y += 10) g.fillRect(22, y, S - 44, 3);
      g.fillStyle = "#59636f";                                  // hinges
      g.fillRect(3, 14, 4, 8); g.fillRect(3, S - 22, 4, 8);
    }, 10);
    // the opening you look up into above stairs and ladders going up
    make("ceilHole", (g, S) => {
      g.fillStyle = "#14161d"; g.fillRect(0, 0, S, S);
      const grd = g.createRadialGradient(S / 2, S / 2, 4, S / 2, S / 2, S * 0.5);
      grd.addColorStop(0, "#3a3326"); grd.addColorStop(.7, "#0b0c10"); grd.addColorStop(1, "#050608");
      g.fillStyle = grd; g.fillRect(6, 6, S - 12, S - 12);
      g.strokeStyle = "#4a4f5c"; g.lineWidth = 5; g.strokeRect(4, 4, S - 8, S - 8);
    }, 8);
  };
})();
