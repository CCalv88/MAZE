/* MAZE — shared helpers */
(function () {
  const MAZE = window.MAZE || (window.MAZE = {});
  const U = (MAZE.util = {});

  U.TAU = Math.PI * 2;
  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
  U.dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

  // shortest signed angular difference b - a, wrapped to [-PI, PI]
  U.angDiff = function (a, b) {
    let d = (b - a) % U.TAU;
    if (d > Math.PI) d -= U.TAU;
    if (d < -Math.PI) d += U.TAU;
    return d;
  };

  // deterministic PRNG so "Generate" with a given seed is repeatable
  U.rng = function (seed) {
    let s = (seed >>> 0) || 1;
    const r = function () {
      s |= 0; s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    r.int = (n) => Math.floor(r() * n);
    r.range = (a, b) => a + r() * (b - a);
    r.pick = (arr) => arr[Math.floor(r() * arr.length)];
    r.shuffle = function (arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    };
    r.chance = (p) => r() < p;
    return r;
  };

  U.fmtTime = function (sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const cs = Math.floor((sec * 100) % 100);
    return m + ":" + String(s).padStart(2, "0") + "." + String(cs).padStart(2, "0");
  };

  // localStorage wrappers that never throw (private mode, quota, file:// quirks)
  U.store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; }
      catch (e) { return false; }
    },
    del(key) { try { localStorage.removeItem(key); } catch (e) {} }
  };

  // pixel colour helpers — ImageData is little-endian ABGR in a Uint32 view
  U.rgb = (r, g, b) => (255 << 24) | (b << 16) | (g << 8) | r;
  U.shade = function (c, s) { // s is 0..256 fixed point
    const r = (c & 255) * s >> 8;
    const g = ((c >> 8) & 255) * s >> 8;
    const b = ((c >> 16) & 255) * s >> 8;
    return (255 << 24) | (b << 16) | (g << 8) | r;
  };

  U.download = function (filename, text) {
    const blob = new Blob([text], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  };
})();
