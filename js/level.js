/* MAZE — level model, procedural generator, validator, maze codes, save/load.

   A level is a stack of `floors` grids of cols x rows. walls and things are flat arrays
   holding every floor one after another, so cell i on floor f is f * cols * rows + y * cols + x.
   A single-floor level is exactly the old format. Stairs and ladders come in pairs: a way up
   on floor f and a way down in the same cell on floor f + 1.
   Custom monsters travel inside the level (lv.monsters) and are placed as ids CUSTOM_BASE + n. */
(function () {
  const MAZE = window.MAZE;
  const U = MAZE.util;
  const W = MAZE.W, T = MAZE.T;
  const L = (MAZE.Level = {});
  const STORE_KEY = "maze.levels.v1";
  const PAIR = MAZE.STAIR_PAIR, DIR = MAZE.STAIR_DIR;

  L.create = function (cols, rows, name, floors) {
    cols = U.clamp(cols | 0, 8, 64); rows = U.clamp(rows | 0, 8, 64);
    floors = U.clamp((floors | 0) || 1, 1, MAZE.MAX_FLOORS);
    const lv = {
      name: name || "Untitled Maze",
      cols, rows, floors,
      walls: new Uint8Array(cols * rows * floors),
      things: new Uint8Array(cols * rows * floors),
      monsters: []
    };
    L.border(lv);
    return lv;
  };

  L.plane = (lv) => lv.cols * lv.rows;
  L.idx = (lv, x, y, f) => (f || 0) * lv.cols * lv.rows + y * lv.cols + x;
  L.inside = (lv, x, y) => x >= 0 && y >= 0 && x < lv.cols && y < lv.rows;
  L.wallAt = (lv, x, y, f) => (L.inside(lv, x, y) ? lv.walls[L.idx(lv, x, y, f)] : W.BRICK);
  L.thingAt = (lv, x, y, f) => (L.inside(lv, x, y) ? lv.things[L.idx(lv, x, y, f)] : 0);
  L.isStair = (id) => !!DIR[id];
  L.isUp = (id) => DIR[id] === 1;
  L.isDown = (id) => DIR[id] === -1;

  L.clone = function (lv) {
    return {
      name: lv.name, cols: lv.cols, rows: lv.rows, floors: lv.floors || 1,
      walls: new Uint8Array(lv.walls), things: new Uint8Array(lv.things),
      monsters: (lv.monsters || []).map((m) => Object.assign({}, m))
    };
  };

  L.border = function (lv, type, onlyFloor) {
    type = type || W.BRICK;
    const P = L.plane(lv);
    for (let f = 0; f < lv.floors; f++) {
      if (onlyFloor != null && f !== onlyFloor) continue;
      const o = f * P;
      for (let x = 0; x < lv.cols; x++) {
        lv.walls[o + x] = type; lv.walls[o + (lv.rows - 1) * lv.cols + x] = type;
        lv.things[o + x] = 0; lv.things[o + (lv.rows - 1) * lv.cols + x] = 0;
      }
      for (let y = 0; y < lv.rows; y++) {
        lv.walls[o + y * lv.cols] = type; lv.walls[o + y * lv.cols + lv.cols - 1] = type;
        lv.things[o + y * lv.cols] = 0; lv.things[o + y * lv.cols + lv.cols - 1] = 0;
      }
    }
  };

  L.clear = function (lv, onlyFloor) {
    const P = L.plane(lv);
    for (let f = 0; f < lv.floors; f++) {
      if (onlyFloor != null && f !== onlyFloor) continue;
      for (let i = f * P; i < (f + 1) * P; i++) { if (L.isStair(lv.things[i])) L.clearThing(lv, i); lv.walls[i] = 0; lv.things[i] = 0; }
    }
    L.border(lv, W.BRICK, onlyFloor);
  };

  L.resize = function (lv, cols, rows) {
    cols = U.clamp(cols | 0, 8, 64); rows = U.clamp(rows | 0, 8, 64);
    const out = L.create(cols, rows, lv.name, lv.floors);
    out.walls.fill(0);
    out.monsters = (lv.monsters || []).map((m) => Object.assign({}, m));
    for (let f = 0; f < lv.floors; f++)
      for (let y = 0; y < Math.min(rows, lv.rows); y++)
        for (let x = 0; x < Math.min(cols, lv.cols); x++) {
          out.walls[L.idx(out, x, y, f)] = lv.walls[L.idx(lv, x, y, f)];
          out.things[L.idx(out, x, y, f)] = lv.things[L.idx(lv, x, y, f)];
        }
    L.border(out);
    L.fixStairs(out);
    return out;
  };

  // ------------------------------------------------------------ floors --
  // a new top floor: an empty room inside a solid border
  L.addFloor = function (lv) {
    if (lv.floors >= MAZE.MAX_FLOORS) return false;
    const P = L.plane(lv);
    const walls = new Uint8Array(P * (lv.floors + 1)), things = new Uint8Array(P * (lv.floors + 1));
    walls.set(lv.walls); things.set(lv.things);
    lv.walls = walls; lv.things = things; lv.floors++;
    L.border(lv, W.BRICK, lv.floors - 1);
    return true;
  };

  L.removeFloor = function (lv, f) {
    if (lv.floors <= 1 || f < 0 || f >= lv.floors) return false;
    const P = L.plane(lv);
    const keep = (a) => { const out = new Uint8Array(P * (lv.floors - 1)); out.set(a.subarray(0, f * P)); out.set(a.subarray((f + 1) * P), f * P); return out; };
    lv.walls = keep(lv.walls); lv.things = keep(lv.things); lv.floors--;
    L.fixStairs(lv);
    return true;
  };

  // drop any way up or down whose partner is missing (after deleting a floor, or from a bad file)
  L.fixStairs = function (lv) {
    const P = L.plane(lv);
    for (let i = 0; i < lv.things.length; i++) {
      const t = lv.things[i];
      if (!L.isStair(t)) continue;
      const j = i + DIR[t] * P;
      if (j < 0 || j >= lv.things.length || lv.things[j] !== PAIR[t]) lv.things[i] = 0;
    }
  };

  // remove whatever is in cell i; a stair takes its partner with it
  L.clearThing = function (lv, i) {
    const t = lv.things[i];
    lv.things[i] = 0;
    if (L.isStair(t)) {
      const j = i + DIR[t] * L.plane(lv);
      if (j >= 0 && j < lv.things.length && lv.things[j] === PAIR[t]) lv.things[j] = 0;
    }
  };

  // things flagged `unique` (starts, exit) may only exist once across every floor.
  // A way up or down also places its partner, adding a floor on top if it has to.
  L.setThing = function (lv, x, y, id, f) {
    f = f || 0;
    if (!L.inside(lv, x, y) || f >= lv.floors) return false;
    const P = L.plane(lv), i = L.idx(lv, x, y, f);
    if (L.isStair(id)) {
      const tf = f + DIR[id];
      if (tf < 0) return false;
      if (tf >= lv.floors && !L.addFloor(lv)) return false;
      const j = i + DIR[id] * P;
      if (lv.things[j]) L.clearThing(lv, j);
      lv.things[j] = PAIR[id];
      lv.walls[j] = W.EMPTY;
    }
    const def = MAZE.THINGS[id];
    if (def && def.unique) {
      for (let k = 0; k < lv.things.length; k++) if (lv.things[k] === id) lv.things[k] = 0;
    }
    if (lv.things[i] && lv.things[i] !== id) L.clearThing(lv, i);
    lv.things[i] = id;
    if (id) lv.walls[i] = W.EMPTY;   // nothing can live inside a wall
    return true;
  };

  // cell of a thing as { x, y, f }
  L.cellOf = function (lv, i) {
    const P = L.plane(lv), f = (i / P) | 0, r = i - f * P;
    return { x: r % lv.cols, y: (r / lv.cols) | 0, f: f };
  };
  L.findThing = function (lv, id) {
    const i = lv.things.indexOf(id);
    return i < 0 ? null : L.cellOf(lv, i);
  };

  // the four start markers, by seat; null where the builder left one out
  L.findStarts = function (lv) {
    return MAZE.START_IDS.map(function (id) {
      const i = lv.things.indexOf(id);
      return i >= 0 && lv.walls[i] === W.EMPTY ? L.cellOf(lv, i) : null;
    });
  };

  // One spawn cell per seat. Seats without their own marker get the nearest open
  // cells around player 1's start, so nobody spawns inside anybody else.
  L.spawnPoints = function (lv) {
    const starts = L.findStarts(lv);
    const p1 = starts[0] || { x: 1, y: 1, f: 0 };
    const out = starts.slice();
    out[0] = p1;
    const taken = new Set(out.filter(Boolean).map((c) => L.idx(lv, c.x, c.y, c.f)));
    const dist = L.bfs(lv, p1.x, p1.y, { secret: false, door: false, stairs: false }, p1.f);
    const order = [];
    for (let i = 0; i < dist.length; i++) if (dist[i] > 0 && !taken.has(i) && !L.isStair(lv.things[i])) order.push(i);
    order.sort((a, b) => dist[a] - dist[b] || a - b);
    let k = 0;
    for (let s = 1; s < out.length; s++) {
      if (out[s]) continue;
      const i = order[k++];
      out[s] = i == null ? { x: p1.x, y: p1.y, f: p1.f } : L.cellOf(lv, i);
    }
    return out;
  };

  // ---------------------------------------------------------------- BFS --
  // Across every floor: four neighbours on the same floor, plus the partner cell of a
  // stair. opts.secret / opts.door decide whether those tiles count as passable,
  // opts.stairs === false keeps the search on one floor.
  L.bfs = function (lv, sx, sy, opts, sf) {
    opts = opts || {};
    const P = L.plane(lv), cols = lv.cols, rows = lv.rows;
    const n = P * lv.floors;
    const dist = new Int32Array(n).fill(-1);
    if (!L.inside(lv, sx, sy)) return dist;
    const pass = (t) =>
      t === W.EMPTY ||
      (t === W.SECRET && opts.secret !== false) ||
      (t === W.DOOR && opts.door !== false);
    const q = new Int32Array(n);
    let head = 0, tail = 0;
    const s = L.idx(lv, sx, sy, sf);
    if (!pass(lv.walls[s])) return dist;
    dist[s] = 0; q[tail++] = s;
    const visit = (ni, d) => { if (dist[ni] === -1 && pass(lv.walls[ni])) { dist[ni] = d; q[tail++] = ni; } };
    while (head < tail) {
      const cur = q[head++];
      const f = (cur / P) | 0, r = cur - f * P, cx = r % cols, cy = (r / cols) | 0, d = dist[cur] + 1;
      if (cx + 1 < cols) visit(cur + 1, d);
      if (cx > 0) visit(cur - 1, d);
      if (cy + 1 < rows) visit(cur + cols, d);
      if (cy > 0) visit(cur - cols, d);
      const t = lv.things[cur];
      if (opts.stairs !== false && DIR[t]) {
        const j = cur + DIR[t] * P;
        if (j >= 0 && j < n && lv.things[j] === PAIR[t]) visit(j, d);
      }
    }
    return dist;
  };

  // --------------------------------------------------------- generator --
  // Carve one floor: a recursive backtracker on the odd cells, a few rooms, some loops
  // knocked through, and patches of an accent wall style.
  function carveFloor(lv, f, rnd, opts) {
    const cols = lv.cols, rows = lv.rows, o = f * L.plane(lv);
    const styles = [W.BRICK, W.STONE, W.MOSS];
    const base = f === 0 && opts.style ? opts.style : rnd.pick(styles);
    const accent = rnd.pick(styles.filter((s) => s !== base));
    const I = (x, y) => o + y * cols + x;
    const open = (x, y) => { lv.walls[I(x, y)] = W.EMPTY; };
    for (let i = o; i < o + L.plane(lv); i++) lv.walls[i] = base;

    const stack = [[1, 1]];
    open(1, 1);
    const dirs = [[2, 0], [-2, 0], [0, 2], [0, -2]];
    while (stack.length) {
      const top = stack[stack.length - 1];
      const x = top[0], y = top[1];
      const cand = [];
      for (const d of dirs) {
        const nx = x + d[0], ny = y + d[1];
        if (nx > 0 && ny > 0 && nx < cols - 1 && ny < rows - 1 && lv.walls[I(nx, ny)] !== W.EMPTY)
          cand.push([nx, ny, x + d[0] / 2, y + d[1] / 2]);
      }
      if (!cand.length) { stack.pop(); continue; }
      const c = rnd.pick(cand);
      open(c[2], c[3]); open(c[0], c[1]);
      stack.push([c[0], c[1]]);
    }
    // an even-sized grid leaves the last row/column walled off — stitch it in
    if ((cols - 1) % 2 === 1) for (let y = 1; y < rows - 1; y += 2) if (rnd.chance(.6)) open(cols - 2, y);
    if ((rows - 1) % 2 === 1) for (let x = 1; x < cols - 1; x += 2) if (rnd.chance(.6)) open(x, rows - 2);

    const roomCount = opts.rooms == null ? 1 + rnd.int(3) : opts.rooms;
    for (let r = 0; r < roomCount; r++) {
      const rw = 3 + rnd.int(3), rh = 3 + rnd.int(3);
      const rx = 1 + rnd.int(Math.max(1, cols - rw - 2));
      const ry = 1 + rnd.int(Math.max(1, rows - rh - 2));
      for (let y = ry; y < Math.min(rows - 1, ry + rh); y++)
        for (let x = rx; x < Math.min(cols - 1, rx + rw); x++) open(x, y);
    }
    // a perfect maze is miserable to flee through
    const loopChance = opts.loops == null ? 0.09 : opts.loops;
    for (let y = 1; y < rows - 1; y++)
      for (let x = 1; x < cols - 1; x++) {
        if (lv.walls[I(x, y)] === W.EMPTY) continue;
        const h = lv.walls[I(x - 1, y)] === W.EMPTY && lv.walls[I(x + 1, y)] === W.EMPTY;
        const v = lv.walls[I(x, y - 1)] === W.EMPTY && lv.walls[I(x, y + 1)] === W.EMPTY;
        if ((h || v) && rnd.chance(loopChance)) open(x, y);
      }
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        if (lv.walls[I(x, y)] !== base) continue;
        const n = Math.sin(x * 0.35 + f) * Math.cos(y * 0.42) + Math.sin((x + y) * 0.21);
        if (n > 0.75) lv.walls[I(x, y)] = accent;
      }
    L.border(lv, base, f);
  }

  L.generate = function (opts) {
    opts = opts || {};
    const rnd = U.rng(opts.seed == null ? (Math.random() * 1e9) | 0 : opts.seed);
    const cols = U.clamp(opts.cols || 25, 9, 64);
    const rows = U.clamp(opts.rows || 19, 9, 64);
    const F = U.clamp(opts.floors || 1, 1, MAZE.MAX_FLOORS);
    const lv = L.create(cols, rows, opts.name || "Generated Maze", F);
    const P = L.plane(lv);
    const diff = opts.difficulty == null ? 1 : opts.difficulty;
    for (let f = 0; f < F; f++) carveFloor(lv, f, rnd, opts);

    // --- floors are joined by a way up placed far from where you arrived on each one.
    //     Odd cells are always open (the backtracker visits every one of them). ---
    let arrive = { x: 1, y: 1 };
    for (let f = 0; f < F - 1; f++) {
      const d = L.bfs(lv, arrive.x, arrive.y, { stairs: false, secret: false }, f);
      const cand = [];
      for (let y = 1; y < rows - 1; y += 2)
        for (let x = 1; x < cols - 1; x += 2) {
          const i = L.idx(lv, x, y, f);
          if (d[i] > 0 && !lv.things[i] && !lv.things[i + P]) cand.push({ x, y, d: d[i] });
        }
      cand.sort((a, b) => b.d - a.d);
      const pick = cand[rnd.int(Math.max(1, Math.ceil(cand.length * 0.15)))] || { x: cols - 2 - ((cols - 1) % 2), y: rows - 2 - ((rows - 1) % 2) };
      L.setThing(lv, pick.x, pick.y, rnd.chance(0.65) ? T.STAIRS_UP : T.LADDER_UP, f);
      arrive = pick;
    }

    // --- start + exit: the exit goes to the farthest reachable cell on the top floor ---
    L.setThing(lv, 1, 1, T.START, 0);
    const dist = L.bfs(lv, 1, 1);
    let best = -1, bi = L.idx(lv, 1, 1, 0);
    for (let i = (F - 1) * P; i < F * P; i++) if (dist[i] > best && !lv.things[i]) { best = dist[i]; bi = i; }
    const exit = L.cellOf(lv, bi);
    L.setThing(lv, exit.x, exit.y, T.FINISH, exit.f);

    const openCells = [];
    for (let i = 0; i < lv.walls.length; i++) {
      const c = L.cellOf(lv, i);
      if (c.x < 1 || c.y < 1 || c.x >= cols - 1 || c.y >= rows - 1) continue;
      if (lv.walls[i] === W.EMPTY && !lv.things[i] && dist[i] > 0) openCells.push(i);
    }

    // --- secret walls, but only where they open a genuine shortcut ---
    const secretTarget = opts.secrets == null ? (1 + rnd.int(3)) * F : opts.secrets;
    const secretCand = [];
    for (let f = 0; f < F; f++)
      for (let y = 1; y < rows - 1; y++)
        for (let x = 1; x < cols - 1; x++) {
          const i = L.idx(lv, x, y, f);
          if (lv.walls[i] === W.EMPTY) continue;
          for (const pr of [[i - 1, i + 1], [i - cols, i + cols]]) {
            const a = pr[0], b = pr[1];
            if (lv.walls[a] !== W.EMPTY || lv.walls[b] !== W.EMPTY || dist[a] < 0 || dist[b] < 0) continue;
            const gain = Math.abs(dist[a] - dist[b]);
            if (gain > 9) secretCand.push({ i, gain });
          }
        }
    secretCand.sort((p, q) => q.gain - p.gain);
    for (let k = 0; k < Math.min(secretTarget, secretCand.length); k++) lv.walls[secretCand[k].i] = W.SECRET;

    // --- locked door on the critical path, key stashed on the near side ---
    if (opts.door !== false && best > 14) {
      const path = [];
      let cur = bi, guard = 0;
      const start = L.idx(lv, 1, 1, 0);
      while (cur !== start && guard++ < 20000) {
        path.push(cur);
        let nxt = -1;
        L.neighbors(lv, cur, function (j) { if (nxt < 0 && dist[j] >= 0 && dist[j] === dist[cur] - 1) nxt = j; });
        if (nxt < 0) break;
        cur = nxt;
      }
      const corridor = path.filter(function (i, k) {
        if (k < 3 || k > path.length - 4 || lv.things[i]) return false;
        let openN = 0;
        for (const j of [i - 1, i + 1, i - cols, i + cols]) if (lv.walls[j] === W.EMPTY) openN++;
        return openN === 2;
      });
      if (corridor.length) {
        const spot = corridor[Math.floor(corridor.length * 0.35)];
        lv.walls[spot] = W.DOOR;
        const reach = L.bfs(lv, 1, 1, { door: false });
        const keySpots = openCells.filter((i) => reach[i] > 4 && !lv.things[i]);
        if (keySpots.length) {
          keySpots.sort((a, b) => reach[b] - reach[a]);
          const c = L.cellOf(lv, keySpots[rnd.int(Math.max(1, Math.floor(keySpots.length * 0.3)))]);
          L.setThing(lv, c.x, c.y, T.KEY, c.f);
        } else {
          lv.walls[spot] = W.EMPTY;   // nowhere fair for the key: drop the door
        }
      }
    }

    // --- starts for players 2-4: on player 1's floor and side of the door, about as
    //     far from the exit as player 1, and spread apart so a race starts fair ---
    if (opts.players !== false) {
      const fromExit = L.bfs(lv, exit.x, exit.y, { secret: false, door: true }, exit.f);
      const reachP1 = L.bfs(lv, 1, 1, { secret: false, door: false });
      const target = fromExit[L.idx(lv, 1, 1, 0)];
      const chosen = [[1, 1]];
      const cand = openCells.filter((i) => {
        return i < P && !lv.things[i] && reachP1[i] > 6 && fromExit[i] > 0 && Math.abs(fromExit[i] - target) <= Math.max(2, Math.floor(target * 0.1));
      }).map((i) => [i % cols, (i / cols) | 0]);
      for (let s = 1; s < 4 && cand.length; s++) {
        let bestC = null, bestD = -1;
        for (const c of cand) {
          let m = 1e9;
          for (const o of chosen) m = Math.min(m, Math.abs(c[0] - o[0]) + Math.abs(c[1] - o[1]));
          if (m > bestD) { bestD = m; bestC = c; }
        }
        if (!bestC || bestD < 3) break;
        chosen.push(bestC);
        L.setThing(lv, bestC[0], bestC[1], MAZE.START_IDS[s], 0);
        cand.splice(cand.indexOf(bestC), 1);
      }
    }
    const nearStart = new Int32Array(P * F).fill(1 << 29);
    for (const s of L.findStarts(lv)) {
      if (!s) continue;
      const d = L.bfs(lv, s.x, s.y, {}, s.f);
      for (let i = 0; i < d.length; i++) if (d[i] >= 0 && d[i] < nearStart[i]) nearStart[i] = d[i];
    }

    // --- items, weapons and magic ---
    const free = rnd.shuffle(openCells.filter((i) => !lv.things[i] && dist[i] > 3));
    let fi = 0;
    const put = (id) => { while (fi < free.length && lv.things[free[fi]]) fi++; const i = free[fi++]; if (i != null) { const c = L.cellOf(lv, i); L.setThing(lv, c.x, c.y, id, c.f); } };
    const area = (cols * rows * F) / 100;

    put(T.SWORD);
    if (rnd.chance(.8)) { put(T.BOW); put(T.ARROWS); if (rnd.chance(.6)) put(T.ARROWS); }
    if (rnd.chance(.7)) put(T.SHIELD);
    if (rnd.chance(.75)) put(T.TORCH);
    if (rnd.chance(.5)) put(T.BOOTS);
    for (let i = 0; i < 1 + Math.round(area * 0.35); i++) put(T.POTION);
    for (let i = 0; i < 3 + Math.round(area * 0.7); i++) put(T.TREASURE);
    if (opts.magic !== false) {
      // a couple of easy scrolls always, stronger ones rarer
      const pool = [T.SCROLL_FIRE, T.SCROLL_FROST, T.SCROLL_HEAL, T.SCROLL_FIRE, T.SCROLL_HEAL, T.SCROLL_BOLT, T.SCROLL_BLINK, T.SCROLL_WARD];
      const n = 2 + Math.round(area * 0.25) + rnd.int(2);
      for (let i = 0; i < n; i++) put(i < 2 ? pool[rnd.int(3)] : rnd.pick(pool));
      for (let i = 0; i < 1 + Math.round(area * 0.2); i++) put(T.MANA);
    }

    // --- enemies, kept well away from every spawn point ---
    const spawnSafe = free.filter((i) => nearStart[i] > 8 && !lv.things[i]);
    const enemyCount = opts.enemies == null ? Math.round((2 + area * 0.9) * diff) : opts.enemies;
    for (let k = 0; k < Math.min(enemyCount, spawnSafe.length); k++) {
      const c = L.cellOf(lv, spawnSafe[k]), roll = rnd();
      L.setThing(lv, c.x, c.y, roll < 0.6 ? T.BLOB : roll < 0.85 ? T.BLOB_FAST : T.BLOB_TANK, c.f);
    }
    return lv;
  };

  // calls fn(j) for every cell you can step to from cell i (same floor, or through a stair)
  L.neighbors = function (lv, i, fn) {
    const P = L.plane(lv), cols = lv.cols, f = (i / P) | 0, r = i - f * P, x = r % cols, y = (r / cols) | 0;
    if (x + 1 < cols) fn(i + 1);
    if (x > 0) fn(i - 1);
    if (y + 1 < lv.rows) fn(i + cols);
    if (y > 0) fn(i - cols);
    const t = lv.things[i];
    if (DIR[t]) { const j = i + DIR[t] * P; if (j >= 0 && j < lv.things.length && lv.things[j] === PAIR[t]) fn(j); }
  };

  // --------------------------------------------------------- validation --
  L.validate = function (lv) {
    const errors = [], warnings = [], info = [];
    const start = L.findThing(lv, T.START);
    const finish = L.findThing(lv, T.FINISH);
    if (!start) errors.push("No player 1 start — place one.");
    if (!finish) errors.push("No exit portal — place one.");

    const counts = { enemies: 0, items: 0, secrets: 0, treasure: 0, open: 0, doors: 0, keys: 0, bow: 0, arrows: 0, scrolls: 0, stairs: 0, custom: 0, floors: lv.floors };
    for (let i = 0; i < lv.walls.length; i++) {
      if (lv.walls[i] === W.EMPTY) counts.open++;
      if (lv.walls[i] === W.SECRET) counts.secrets++;
      if (lv.walls[i] === W.DOOR) counts.doors++;
      const t = lv.things[i];
      if (t >= MAZE.CUSTOM_BASE) { counts.enemies++; counts.custom++; continue; }
      const def = MAZE.THINGS[t];
      if (!def) continue;
      if (def.cat === "enemy") counts.enemies++;
      else if (def.cat === "item" || def.cat === "weapon" || def.cat === "magic") counts.items++;
      if (def.spell) counts.scrolls++;
      if (L.isUp(t)) counts.stairs++;
      if (t === T.TREASURE) counts.treasure++;
      if (t === T.KEY) counts.keys++;
      if (t === T.BOW) counts.bow++;
      if (t === T.ARROWS) counts.arrows++;
    }

    if (start && finish) {
      const viaSecret = L.bfs(lv, start.x, start.y, { secret: true, door: true }, start.f);
      const strict = L.bfs(lv, start.x, start.y, { secret: false, door: true }, start.f);
      const fi = L.idx(lv, finish.x, finish.y, finish.f);
      if (viaSecret[fi] < 0) errors.push("The exit cannot be reached from the start" + (lv.floors > 1 ? " (check the stairs)." : "."));
      else if (strict[fi] < 0) warnings.push("The only route to the exit runs through a secret wall.");
      if (counts.doors && !counts.keys) warnings.push("There is a locked door but no key.");
      let buried = 0;
      for (let i = 0; i < lv.things.length; i++)
        if (lv.things[i] && lv.walls[i] !== W.EMPTY) buried++;
      if (buried) warnings.push(buried + " object(s) sit inside walls and will be ignored.");
      if (lv.floors > 1) {
        const P = L.plane(lv);
        for (let f = 0; f < lv.floors; f++) {
          let reach = false;
          for (let i = f * P; i < (f + 1) * P && !reach; i++) if (viaSecret[i] >= 0) reach = true;
          if (!reach) warnings.push("Floor " + (f + 1) + " cannot be reached — add stairs or a ladder.");
        }
      }

      // extra player starts: each has to be able to get out, and a race should be fair.
      // Fairness is judged on the route everyone can see; secrets are a bonus for whoever finds them.
      const starts = L.findStarts(lv);
      const fromExit = L.bfs(lv, finish.x, finish.y, { secret: true, door: true }, finish.f);
      const honest = L.bfs(lv, finish.x, finish.y, { secret: false, door: true }, finish.f);
      const steps = [];
      counts.starts = 0;
      starts.forEach(function (s, seat) {
        if (!s) return;
        counts.starts++;
        const i = L.idx(lv, s.x, s.y, s.f);
        if (fromExit[i] < 0) errors.push("Player " + (seat + 1) + " cannot reach the exit from their start.");
        else steps.push({ seat: seat, d: honest[i] >= 0 ? honest[i] : fromExit[i] });
      });
      if (counts.starts > 1 && steps.length > 1) {
        info.push("Steps to the exit: " + steps.map((s) => "P" + (s.seat + 1) + " " + s.d).join(", "));
        const lo = Math.min.apply(null, steps.map((s) => s.d)), hi = Math.max.apply(null, steps.map((s) => s.d));
        if (hi - lo > Math.max(4, lo * 0.25)) warnings.push("Starts are uneven for a race: " + lo + " vs " + hi + " steps to the exit.");
      } else {
        info.push("Online, players 2-4 start beside player 1 unless you place their starts.");
      }
    }
    if (counts.bow && !counts.arrows) warnings.push("A bow with no arrows is just a stick.");
    if (counts.arrows && !counts.bow) warnings.push("There are arrows but no bow.");
    if (!counts.enemies) warnings.push("No enemies — this will be a quiet stroll.");

    return { errors, warnings, info, counts, ok: errors.length === 0 };
  };

  // ---------------------------------------------------- custom monsters --
  const HEX = /^#[0-9a-fA-F]{6}$/;
  const num = (v, lo, hi, dflt) => { v = +v; return Number.isFinite(v) ? U.clamp(v, lo, hi) : dflt; };

  // Whatever a monster file or the network says, only sane values get through.
  L.cleanMonster = function (m) {
    m = m || {};
    const out = {
      uid: String(m.uid || "").replace(/[^\w-]/g, "").slice(0, 24) || "m" + Math.random().toString(36).slice(2, 10),
      name: String(m.name || "Monster").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 20) || "Monster",
      body: MAZE.MONSTER_BODIES[m.body] ? m.body : "slime",
      c1: HEX.test(m.c1) ? m.c1.toLowerCase() : "#6ee06e",
      c2: HEX.test(m.c2) ? m.c2.toLowerCase() : "#2f6b2f",
      c3: HEX.test(m.c3) ? m.c3.toLowerCase() : "#ffffff",
      size: Math.round(num(m.size, 0.4, 1.3, 0.8) * 100) / 100,
      hp: Math.round(num(m.hp, 10, 600, 60)),
      speed: Math.round(num(m.speed, 0.4, 5, 1.6) * 100) / 100,
      dmg: Math.round(num(m.dmg, 1, 80, 10)),
      rate: Math.round(num(m.rate, 0.35, 3, 0.9) * 100) / 100,
      sight: Math.round(num(m.sight, 4, 16, 12)),
      ability: MAZE.MONSTER_ABILITIES[m.ability] ? m.ability : "none"
    };
    return out;
  };

  // how much XP a monster is worth: tougher, faster, nastier monsters teach you more
  L.monsterXp = function (m) {
    const bonus = { none: 0, ranged: 18, poison: 12, regen: 14, split: 16, explode: 10, leech: 12 }[m.ability] || 0;
    return Math.round(8 + m.hp * 0.22 + m.dmg * 1.4 / Math.max(0.35, m.rate) * 0.8 + m.speed * 7 + bonus);
  };
  L.monsterSprite = (m) => "mon_" + m.body + "_" + m.c1.slice(1) + m.c2.slice(1) + m.c3.slice(1);

  // The definition the engine uses for a monster id, built-in or custom.
  L.monsterDef = function (lv, kind) {
    if (kind < MAZE.CUSTOM_BASE) return MAZE.THINGS[kind] || null;
    const m = lv && lv.monsters && lv.monsters[kind - MAZE.CUSTOM_BASE];
    if (!m) return null;
    if (m._def) return m._def;
    const xp = L.monsterXp(m);
    const def = {
      name: m.name, cat: "enemy", custom: true, sprite: L.monsterSprite(m), mini: m.c1, body: m.c1, body2: m.c2, eye: m.c3,
      shape: m.body, scale: m.body === "bat" ? 0.28 + m.size * 0.32 : 0.3 + m.size * 0.6, zbase: m.body === "bat" ? 0.38 : m.body === "ghost" ? 0.06 : 0,
      hp: m.hp, speed: m.speed, dmg: m.dmg, radius: 0.15 + m.size * 0.23, score: xp * 3, mass: m.size * m.size * 2.5,
      xp: xp, rate: m.rate, sight: m.sight, ability: m.ability
    };
    Object.defineProperty(m, "_def", { value: def, enumerable: false, configurable: true, writable: true });
    return def;
  };

  // put a monster from the library into the level (or refresh its copy); returns its thing id
  L.addMonster = function (lv, m) {
    m = L.cleanMonster(m);
    lv.monsters = lv.monsters || [];
    const at = lv.monsters.findIndex((o) => o.uid === m.uid);
    if (at >= 0) { lv.monsters[at] = m; return MAZE.CUSTOM_BASE + at; }
    if (lv.monsters.length >= MAZE.MAX_CUSTOM) return 0;
    lv.monsters.push(m);
    return MAZE.CUSTOM_BASE + lv.monsters.length - 1;
  };

  // forget monsters nothing in the level uses, and renumber the rest
  L.compactMonsters = function (lv) {
    const ms = lv.monsters || [];
    if (!ms.length) return lv;
    const used = new Set();
    for (let i = 0; i < lv.things.length; i++) if (lv.things[i] >= MAZE.CUSTOM_BASE) used.add(lv.things[i] - MAZE.CUSTOM_BASE);
    const map = {}, keep = [];
    ms.forEach((m, k) => { if (used.has(k)) { map[k] = keep.length; keep.push(m); } });
    for (let i = 0; i < lv.things.length; i++) {
      const t = lv.things[i];
      if (t >= MAZE.CUSTOM_BASE) lv.things[i] = map[t - MAZE.CUSTOM_BASE] == null ? 0 : MAZE.CUSTOM_BASE + map[t - MAZE.CUSTOM_BASE];
    }
    lv.monsters = keep;
    return lv;
  };

  // --------------------------------------------------------- maze codes --
  // A maze's code is a hash of its layout (size, floors, walls, things and custom
  // monsters; not its name), so the same maze always has the same code and any edit
  // gives it a new one. Single-floor mazes without custom monsters hash exactly as
  // before floors existed, so old codes still work.
  const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";   // Crockford base32: no I, L, O, U
  L.CODE_LENGTH = 6;
  const MON_KEYS = ["uid", "name", "body", "c1", "c2", "c3", "size", "hp", "speed", "dmg", "rate", "sight", "ability"];
  L.canonical = function (lv) {
    const c = L.compactMonsters(L.clone(lv));
    let s = c.cols + "x" + c.rows + ":";
    for (let i = 0; i < c.walls.length; i++) s += String.fromCharCode(48 + c.walls[i]);
    s += ":";
    for (let i = 0; i < c.things.length; i++) s += String.fromCharCode(48 + c.things[i]);
    if (c.floors > 1) s += ":F" + c.floors;
    if (c.monsters.length) s += ":M" + JSON.stringify(c.monsters.map((m) => MON_KEYS.map((k) => m[k])));
    return s;
  };
  // cyrb53: a fast 53-bit string hash with good avalanche, fine for content addressing
  L.hash53 = function (str, seed) {
    let h1 = 0xdeadbeef ^ (seed || 0), h2 = 0x41c6ce57 ^ (seed || 0);
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  };
  // salt only changes if two different mazes ever collide on the server
  L.code = function (lv, salt) {
    let h = L.hash53(L.canonical(lv) + (salt ? "#" + salt : ""));
    let out = "";
    for (let i = 0; i < L.CODE_LENGTH; i++) { out += CODE_ALPHABET[h % 32]; h = Math.floor(h / 32); }
    return out;
  };
  L.normCode = (s) => String(s || "").toUpperCase().replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0").replace(/[IL]/g, "1").replace(/U/g, "V");
  L.isMazeCode = (s) => new RegExp("^[" + CODE_ALPHABET + "]{" + L.CODE_LENGTH + "}$").test(s);

  // ------------------------------------------------------------ storage --
  L.toJSON = function (lv) {
    const c = L.compactMonsters(L.clone(lv));
    const o = { format: "maze.level", version: 3, name: c.name, cols: c.cols, rows: c.rows, floors: c.floors, walls: Array.from(c.walls), things: Array.from(c.things) };
    if (c.monsters.length) o.monsters = c.monsters.map((m) => { const out = {}; MON_KEYS.forEach((k) => { out[k] = m[k]; }); return out; });
    return JSON.stringify(o);
  };

  // Anything unknown becomes floor / nothing, so a hand-edited or hostile file can
  // never put an id the engine does not understand into the grid.
  L.fromJSON = function (text) {
    const o = typeof text === "string" ? JSON.parse(text) : text;
    if (!o || !o.cols || !o.rows || !o.walls || !o.things) throw new Error("Not a MAZE level file.");
    const name = String(o.name || "Imported Maze").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40) || "Imported Maze";
    const floors = o.floors == null ? 1 : +o.floors;
    const lv = L.create(+o.cols, +o.rows, name, floors);
    if (lv.cols !== +o.cols || lv.rows !== +o.rows || lv.floors !== floors) throw new Error("Maze size out of range.");
    lv.monsters = Array.isArray(o.monsters) ? o.monsters.slice(0, MAZE.MAX_CUSTOM).map(L.cleanMonster) : [];
    const n = lv.walls.length, P = L.plane(lv);
    const seen = {};
    for (let i = 0; i < n; i++) {
      const w = +o.walls[i] || 0, t = +o.things[i] || 0;
      lv.walls[i] = w === W.EMPTY || MAZE.WALLS[w] ? w : W.EMPTY;
      let id = MAZE.THINGS[t] || (t >= MAZE.CUSTOM_BASE && t < MAZE.CUSTOM_BASE + lv.monsters.length) ? t : 0;
      if (id && MAZE.THINGS[id] && MAZE.THINGS[id].unique) { if (seen[id]) id = 0; seen[id] = 1; }
      lv.things[i] = id;
    }
    L.border(lv, W.BRICK);
    // keep whatever border style the file used, as long as it is a solid wall
    for (let i = 0; i < n; i++) {
      const r = i % P, x = r % lv.cols, y = (r / lv.cols) | 0;
      if (x && y && x < lv.cols - 1 && y < lv.rows - 1) continue;
      const w = +o.walls[i];
      if (MAZE.WALLS[w] && MAZE.WALLS[w].solid && w !== W.DOOR) lv.walls[i] = w;
    }
    L.fixStairs(lv);
    return lv;
  };

  L.saved = () => U.store.get(STORE_KEY, {});
  L.save = function (lv) {
    const all = L.saved();
    all[lv.name] = JSON.parse(L.toJSON(lv));
    return U.store.set(STORE_KEY, all);
  };
  L.load = function (name) {
    const all = L.saved();
    return all[name] ? L.fromJSON(all[name]) : null;
  };
  L.remove = function (name) {
    const all = L.saved();
    delete all[name];
    U.store.set(STORE_KEY, all);
  };
})();
