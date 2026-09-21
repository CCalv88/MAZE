/* MAZE — software raycasting renderer.
   Textured walls via DDA, cast floor/ceiling, depth-sorted billboards, particles.
   Everything is written into one Uint32 pixel buffer, then blitted once per frame. */
(function () {
  const MAZE = window.MAZE;
  const U = MAZE.util;
  const W = MAZE.W;
  const TEX = 64, TEXMASK = 63;
  const FOV = 0.68;
  const MAX_LAYERS = 5;          // transparent walls stacked in one column

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.ctx.imageSmoothingEnabled = false;
    this.quality = 0.7;
    this.autoScale = 1;            // adaptive, driven by measured frame cost
    this.frameMs = 8;
    this._tick = 0;
    this.W = 0; this.H = 0;
    // reused per column so the hot loop never allocates
    this.hd = new Float64Array(MAX_LAYERS);
    this.ht = new Int32Array(MAX_LAYERS);
    this.hx = new Int32Array(MAX_LAYERS);
    this.hs = new Int32Array(MAX_LAYERS);
    this.hf = new Int32Array(MAX_LAYERS);
    this.resize(canvas.clientWidth || 960, canvas.clientHeight || 540);
  }

  // Software rendering is fill-rate bound, so cap total pixels regardless of
  // window size and let `autoScale` trim further on slower machines.
  const MAX_PIXELS = 620000;

  Renderer.prototype.resize = function (cssW, cssH, quality) {
    if (quality) this.quality = quality;
    if (cssW) { this.cssW = cssW; this.cssH = cssH; }
    const s = this.quality * this.autoScale;
    let w = Math.max(160, Math.round((this.cssW || cssW) * s));
    let h = Math.max(120, Math.round((this.cssH || cssH) * s));
    if (w * h > MAX_PIXELS) {
      const k = Math.sqrt(MAX_PIXELS / (w * h));
      w = Math.max(160, Math.floor(w * k));
      h = Math.max(120, Math.floor(h * k));
    }
    if (w === this.W && h === this.H) return;
    this.W = w; this.H = h;
    this.canvas.width = w; this.canvas.height = h;
    this.ctx.imageSmoothingEnabled = false;
    this.img = this.ctx.createImageData(w, h);
    this.buf = new Uint32Array(this.img.data.buffer);
    this.zbuf = new Float32Array(w);
    this.spriteZ = new Float32Array(w);
  };

  // Nudge the internal resolution toward a ~60fps budget. Called once a frame
  // with how long the last render took.
  Renderer.prototype.adapt = function (ms) {
    this.frameMs = this.frameMs * 0.88 + ms * 0.12;
    if (++this._tick < 45) return;
    this._tick = 0;
    const before = this.autoScale;
    if (this.frameMs > 19 && this.autoScale > 0.42) this.autoScale = Math.max(0.42, this.autoScale * 0.85);
    else if (this.frameMs < 8 && this.autoScale < 1) this.autoScale = Math.min(1, this.autoScale * 1.10);
    if (Math.abs(before - this.autoScale) > 0.01) {
      this.resize();
      this.frameMs = 12;
    }
  };

  // linear falloff with a soft knee, returned as 0..256 fixed point
  Renderer.prototype.shade = function (dist) {
    let l = 1 - dist / this.lightDist;
    if (l <= 0) return this.ambient;
    l = l * l * (3 - 2 * l);
    return (this.ambient + l * (256 - this.ambient)) | 0;
  };

  Renderer.prototype.render = function (game) {
    const Wd = this.W, Hd = this.H, buf = this.buf, zbuf = this.zbuf;
    const p = game.camera();
    const cols = game.cols, rows = game.rows, walls = game.walls;

    const dirX = Math.cos(p.ang), dirY = Math.sin(p.ang);
    const planeX = -dirY * FOV, planeY = dirX * FOV;
    const posX = p.x, posY = p.y;
    const horizon = Hd * 0.5 + p.pitch * Hd + p.bob * Hd;

    this.lightDist = game.light.dist;
    this.ambient = game.light.ambient * 256;

    // ---------------------------------------------------------- floor ---
    const floorTex = MAZE.textures.get("floor").data;
    const ceilTex = MAZE.textures.get("ceil").data;
    const exitTex = MAZE.textures.get("floorExit").data;
    const rdx0 = dirX - planeX, rdy0 = dirY - planeY;
    const rdx1 = dirX + planeX, rdy1 = dirY + planeY;
    const ex = game.exit ? game.exit.cx : -99, ey = game.exit ? game.exit.cy : -99;

    for (let y = 0; y < Hd; y++) {
      const isFloor = y > horizon;
      let pp = y - horizon;
      if (pp === 0) pp = 0.001;
      const rowDist = (0.5 * Hd) / Math.abs(pp);
      const sh = this.shade(rowDist);
      const row = y * Wd;
      if (sh <= this.ambient + 1 || rowDist > this.lightDist) {
        const dark = U.shade(isFloor ? 0x00262626 : 0x00181818, this.ambient);
        buf.fill(dark, row, row + Wd);
        continue;
      }
      const stepX = (rowDist * (rdx1 - rdx0)) / Wd;
      const stepY = (rowDist * (rdy1 - rdy0)) / Wd;
      let fx = posX + rowDist * rdx0;
      let fy = posY + rowDist * rdy0;
      const tex = isFloor ? floorTex : ceilTex;
      for (let x = 0; x < Wd; x++) {
        const cellX = Math.floor(fx), cellY = Math.floor(fy);
        const tx = ((fx - cellX) * TEX) & TEXMASK;
        const ty = ((fy - cellY) * TEX) & TEXMASK;
        const src = isFloor && cellX === ex && cellY === ey ? exitTex : tex;
        buf[row + x] = U.shade(src[(ty << 6) + tx], sh);
        fx += stepX; fy += stepY;
      }
    }

    // ---------------------------------------------------------- walls ---
    const hd = this.hd, ht = this.ht, hx = this.hx, hs = this.hs, hf = this.hf;
    for (let x = 0; x < Wd; x++) {
      const camX = (2 * x) / Wd - 1;
      const rayX = dirX + planeX * camX;
      const rayY = dirY + planeY * camX;
      let mapX = Math.floor(posX), mapY = Math.floor(posY);
      const ddX = rayX === 0 ? 1e30 : Math.abs(1 / rayX);
      const ddY = rayY === 0 ? 1e30 : Math.abs(1 / rayY);
      let stepX, stepY, sideX, sideY;
      if (rayX < 0) { stepX = -1; sideX = (posX - mapX) * ddX; }
      else { stepX = 1; sideX = (mapX + 1 - posX) * ddX; }
      if (rayY < 0) { stepY = -1; sideY = (posY - mapY) * ddY; }
      else { stepY = 1; sideY = (mapY + 1 - posY) * ddY; }

      let n = 0, side = 0, guard = 0;
      while (n < MAX_LAYERS && guard++ < 512) {
        if (sideX < sideY) { sideX += ddX; mapX += stepX; side = 0; }
        else { sideY += ddY; mapY += stepY; side = 1; }
        if (mapX < 0 || mapY < 0 || mapX >= cols || mapY >= rows) break;
        const tile = walls[mapY * cols + mapX];
        if (tile === W.EMPTY) continue;
        const def = MAZE.WALLS[tile];
        const dist = side === 0 ? sideX - ddX : sideY - ddY;
        if (dist > this.lightDist + 2 && def.opaque) { hd[n] = dist; ht[n] = tile; hx[n] = 0; hs[n] = side; hf[n] = 0; n++; break; }
        let wallHit = side === 0 ? posY + dist * rayY : posX + dist * rayX;
        wallHit -= Math.floor(wallHit);
        let texX = (wallHit * TEX) | 0;
        if ((side === 0 && rayX > 0) || (side === 1 && rayY < 0)) texX = TEX - texX - 1;
        hd[n] = dist; ht[n] = tile; hx[n] = texX; hs[n] = side;
        hf[n] = tile === W.SECRET && game.secretFound[mapY * cols + mapX] ? 1 : 0;
        n++;
        if (def.opaque) break;
      }

      zbuf[x] = n ? hd[n - 1] : 1e30;
      this.spriteZ[x] = 1e30;

      // far to near so transparent layers composite correctly
      for (let i = n - 1; i >= 0; i--) {
        const tile = ht[i], def = MAZE.WALLS[tile];
        const dist = hd[i] < 0.02 ? 0.02 : hd[i];
        const lineH = Hd / dist;
        const top = horizon - lineH * 0.5;
        let y0 = Math.ceil(top), y1 = Math.ceil(top + lineH);
        if (y1 <= 0 || y0 >= Hd) continue;
        let sh = this.shade(dist);
        if (hs[i] === 1) sh = (sh * 184) >> 8;                 // fake directional light
        const texName = tile === W.SECRET ? game.secretTex : def.tex;
        const tex = MAZE.textures.get(texName).data;
        const texStep = TEX / lineH;
        let texPos = (y0 - top) * texStep;
        if (y0 < 0) { texPos = (0 - top) * texStep; y0 = 0; }
        if (y1 > Hd) y1 = Hd;
        const col = hx[i] & TEXMASK;
        const transparent = !def.opaque;
        const found = hf[i];
        for (let y = y0; y < y1; y++) {
          const ty = texPos & TEXMASK;
          texPos += texStep;
          let c = tex[((ty | 0) << 6) + col];
          c = U.shade(c, sh);
          if (found) {                                          // discovered secret: violet sheen
            const r = (c & 255), g = (c >> 8) & 255, b = (c >> 16) & 255;
            c = (255 << 24) | (Math.min(255, b + 46) << 16) | (g << 8) | Math.min(255, r + 22);
          }
          const di = y * Wd + x;
          if (transparent) {
            const bgc = buf[di];
            const r = ((c & 255) * 150 + (bgc & 255) * 106) >> 8;
            const g = (((c >> 8) & 255) * 150 + ((bgc >> 8) & 255) * 106) >> 8;
            const b = (((c >> 16) & 255) * 150 + ((bgc >> 16) & 255) * 106) >> 8;
            buf[di] = (255 << 24) | (b << 16) | (g << 8) | r;
          } else {
            buf[di] = c;
          }
        }
      }
    }

    // -------------------------------------------------------- sprites ---
    const list = game.renderables();
    const invDet = 1 / (planeX * dirY - dirX * planeY);
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const dx = e.x - posX, dy = e.y - posY;
      e._ty = invDet * (-planeY * dx + planeX * dy);
    }
    list.sort((a, b) => b._ty - a._ty);

    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const ty = e._ty;
      if (ty < 0.12) continue;
      const dx = e.x - posX, dy = e.y - posY;
      const tx = invDet * (dirY * dx - dirX * dy);
      const sp = MAZE.sprites.get(e.sprite);
      if (!sp) continue;
      const data = sp.frames[e.frame % sp.count];
      const sw = sp.w, shh = sp.h;

      const screenX = (Wd * 0.5) * (1 + tx / ty);
      const sprH = (e.scale * Hd) / ty;
      const sprW = sprH * (sw / shh);
      const bottom = horizon + (0.5 - e.zbase) * Hd / ty;
      const top = bottom - sprH;

      let x0 = Math.ceil(screenX - sprW * 0.5), x1 = Math.ceil(screenX + sprW * 0.5);
      if (x1 <= 0 || x0 >= Wd) continue;
      let y0 = Math.ceil(top), y1 = Math.ceil(bottom);
      if (y1 <= 0 || y0 >= Hd) continue;
      if (e.tag) {
        // where a name tag goes, as fractions of the view, if a wall is not in the way
        const cx = U.clamp(screenX | 0, 0, Wd - 1);
        e._screen = ty < zbuf[cx] ? { x: screenX / Wd, y: top / Hd, dist: ty } : null;
      }
      const clipY0 = y0 < 0 ? 0 : y0, clipY1 = y1 > Hd ? Hd : y1;
      const baseShade = this.shade(ty);
      const flash = e.flash || 0;

      for (let x = x0 < 0 ? 0 : x0; x < (x1 > Wd ? Wd : x1); x++) {
        if (ty >= zbuf[x]) continue;
        if (ty < this.spriteZ[x]) this.spriteZ[x] = ty;
        const texX = (((x - (screenX - sprW * 0.5)) * sw) / sprW) | 0;
        if (texX < 0 || texX >= sw) continue;
        for (let y = clipY0; y < clipY1; y++) {
          const texY = (((y - top) * shh) / sprH) | 0;
          if (texY < 0 || texY >= shh) continue;
          const c = data[texY * sw + texX];
          if ((c >>> 24) < 128) continue;
          let out = U.shade(c, baseShade);
          if (flash) {
            const r = (out & 255), g = (out >> 8) & 255, b = (out >> 16) & 255;
            const f = flash;
            const rr = (r + (255 - r) * f) | 0, gg = (g + (255 - g) * f) | 0, bb = (b + (255 - b) * f) | 0;
            out = (255 << 24) | (bb << 16) | (gg << 8) | rr;
          }
          buf[y * Wd + x] = out;
        }
      }
    }

    // ------------------------------------------------------ particles ---
    const parts = game.particles;
    for (let i = 0; i < parts.length; i++) {
      const pa = parts[i];
      const dx = pa.x - posX, dy = pa.y - posY;
      const ty = invDet * (-planeY * dx + planeX * dy);
      if (ty < 0.15) continue;
      const tx = invDet * (dirY * dx - dirX * dy);
      const sx = (Wd * 0.5) * (1 + tx / ty);
      const sy = horizon + (0.5 - pa.z) * Hd / ty;
      const size = Math.max(1, (pa.size * Hd) / ty);
      const life = pa.life / pa.maxLife;
      const sh = Math.min(256, this.shade(ty) + 60) * (life > 1 ? 1 : life) | 0;
      const c = U.shade(pa.color, sh);
      const hx0 = Math.max(0, (sx - size * 0.5) | 0), hx1 = Math.min(Wd, (sx + size * 0.5 + 1) | 0);
      const hy0 = Math.max(0, (sy - size * 0.5) | 0), hy1 = Math.min(Hd, (sy + size * 0.5 + 1) | 0);
      for (let x = hx0; x < hx1; x++) {
        if (ty >= zbuf[x]) continue;
        for (let y = hy0; y < hy1; y++) buf[y * Wd + x] = c;
      }
    }

    this.ctx.putImageData(this.img, 0, 0);
  };

  MAZE.Renderer = Renderer;
})();
