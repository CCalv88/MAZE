/* MAZE — level model, procedural generator, validator, save/load. */
(function () {
  const MAZE = window.MAZE;
  const U = MAZE.util;
  const W = MAZE.W, T = MAZE.T;
  const L = (MAZE.Level = {});
  const STORE_KEY = "maze.levels.v1";

  L.create = function (cols, rows, name) {
    cols = U.clamp(cols | 0, 8, 64); rows = U.clamp(rows | 0, 8, 64);
    const lv = {
      name: name || "Untitled Maze",
      cols, rows,
      walls: new Uint8Array(cols * rows),
      things: new Uint8Array(cols * rows)
    };
    L.border(lv);
    return lv;
  };

  L.idx = (lv, x, y) => y * lv.cols + x;
  L.inside = (lv, x, y) => x >= 0 && y >= 0 && x < lv.cols && y < lv.rows;
  L.wallAt = (lv, x, y) => (L.inside(lv, x, y) ? lv.walls[y * lv.cols + x] : W.BRICK);
  L.thingAt = (lv, x, y) => (L.inside(lv, x, y) ? lv.things[y * lv.cols + x] : 0);

  L.clone = function (lv) {
    return {
      name: lv.name, cols: lv.cols, rows: lv.rows,
      walls: new Uint8Array(lv.walls), things: new Uint8Array(lv.things)
    };
  };

  L.border = function (lv, type) {
    type = type || W.BRICK;
    for (let x = 0; x < lv.cols; x++) {
      lv.walls[x] = type; lv.walls[(lv.rows - 1) * lv.cols + x] = type;
      lv.things[x] = 0; lv.things[(lv.rows - 1) * lv.cols + x] = 0;
    }
    for (let y = 0; y < lv.rows; y++) {
      lv.walls[y * lv.cols] = type; lv.walls[y * lv.cols + lv.cols - 1] = type;
      lv.things[y * lv.cols] = 0; lv.things[y * lv.cols + lv.cols - 1] = 0;
    }
  };

  L.clear = function (lv) {
    lv.walls.fill(0); lv.things.fill(0);
    L.border(lv);
  };

  L.resize = function (lv, cols, rows) {
    cols = U.clamp(cols | 0, 8, 64); rows = U.clamp(rows | 0, 8, 64);
    const out = L.create(cols, rows, lv.name);
    out.walls.fill(0);
    for (let y = 0; y < Math.min(rows, lv.rows); y++)
      for (let x = 0; x < Math.min(cols, lv.cols); x++) {
        out.walls[y * cols + x] = lv.walls[y * lv.cols + x];
        out.things[y * cols + x] = lv.things[y * lv.cols + x];
      }
    L.border(out);
    return out;
  };

  // things flagged `unique` (start, exit) may only exist once
  L.setThing = function (lv, x, y, id) {
    if (!L.inside(lv, x, y)) return;
    const def = MAZE.THINGS[id];
    if (def && def.unique) {
      for (let i = 0; i < lv.things.length; i++) if (lv.things[i] === id) lv.things[i] = 0;
    }
    lv.things[y * lv.cols + x] = id;
    if (id) lv.walls[y * lv.cols + x] = W.EMPTY;   // nothing can live inside a wall
  };

  L.findThing = function (lv, id) {
    for (let y = 0; y < lv.rows; y++)
      for (let x = 0; x < lv.cols; x++)
        if (lv.things[y * lv.cols + x] === id) return { x, y };
    return null;
  };

  // the four start markers, by seat; null where the builder left one out
  L.findStarts = function (lv) {
    return MAZE.START_IDS.map(function (id) {
      const c = L.findThing(lv, id);
      return c && lv.walls[c.y * lv.cols + c.x] === W.EMPTY ? c : null;
    });
  };

  // One spawn cell per seat. Seats without their own marker get the nearest open
  // cells around player 1's start, so nobody spawns inside anybody else.
  L.spawnPoints = function (lv) {
    const starts = L.findStarts(lv);
    const p1 = starts[0] || { x: 1, y: 1 };
    const out = starts.slice();
    out[0] = p1;
    const taken = new Set(out.filter(Boolean).map((c) => c.y * lv.cols + c.x));
    const dist = L.bfs(lv, p1.x, p1.y, { secret: false, door: false });
    const order = [];
    for (let i = 0; i < dist.length; i++) if (dist[i] > 0 && !taken.has(i)) order.push(i);
    order.sort((a, b) => dist[a] - dist[b] || a - b);
    let k = 0;
    for (let s = 1; s < out.length; s++) {
      if (out[s]) continue;
      const i = order[k++];
      out[s] = i == null ? { x: p1.x, y: p1.y } : { x: i % lv.cols, y: (i / lv.cols) | 0 };
    }
    return out;
  };

  // ---------------------------------------------------------------- BFS --
  // opts.secret / opts.door decide whether those tiles count as passable.
  L.bfs = function (lv, sx, sy, opts) {
    opts = opts || {};
    const n = lv.cols * lv.rows;
    const dist = new Int32Array(n).fill(-1);
    if (!L.inside(lv, sx, sy)) return dist;
    const pass = (t) =>
      t === W.EMPTY ||
      (t === W.SECRET && opts.secret !== false) ||
      (t === W.DOOR && opts.door !== false);
    const q = new Int32Array(n);
    let head = 0, tail = 0;
    const s = sy * lv.cols + sx;
    if (!pass(lv.walls[s])) return dist;
    dist[s] = 0; q[tail++] = s;
    while (head < tail) {
      const cur = q[head++];
      const cx = cur % lv.cols, cy = (cur / lv.cols) | 0, d = dist[cur];
      for (let k = 0; k < 4; k++) {
        const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const ny = cy + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= lv.cols || ny >= lv.rows) continue;
        const ni = ny * lv.cols + nx;
        if (dist[ni] !== -1 || !pass(lv.walls[ni])) continue;
        dist[ni] = d + 1; q[tail++] = ni;
      }
    }
    return dist;
  };

  // --------------------------------------------------------- generator --
  L.generate = function (opts) {
    opts = opts || {};
    const rnd = U.rng(opts.seed == null ? (Math.random() * 1e9) | 0 : opts.seed);
    const cols = U.clamp(opts.cols || 25, 9, 64);
    const rows = U.clamp(opts.rows || 19, 9, 64);
    const lv = L.create(cols, rows, opts.name || "Generated Maze");
    const diff = opts.difficulty == null ? 1 : opts.difficulty;

    const styles = [W.BRICK, W.STONE, W.MOSS];
    const base = opts.style || rnd.pick(styles);
    const accent = rnd.pick(styles.filter((s) => s !== base));
    lv.walls.fill(base);

    const I = (x, y) => y * cols + x;
    const open = (x, y) => { lv.walls[I(x, y)] = W.EMPTY; };

    // --- recursive backtracker on odd cells ---
    const stack = [];
    open(1, 1);
    stack.push([1, 1]);
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

    // --- carve a few rooms so it is not wall-to-wall corridor ---
    const roomCount = opts.rooms == null ? 1 + rnd.int(3) : opts.rooms;
    for (let r = 0; r < roomCount; r++) {
      const rw = 3 + rnd.int(3), rh = 3 + rnd.int(3);
      const rx = 1 + rnd.int(Math.max(1, cols - rw - 2));
      const ry = 1 + rnd.int(Math.max(1, rows - rh - 2));
      for (let y = ry; y < Math.min(rows - 1, ry + rh); y++)
        for (let x = rx; x < Math.min(cols - 1, rx + rw); x++) open(x, y);
    }

    // --- knock out extra walls for loops (a perfect maze is miserable to flee through) ---
    const loopChance = opts.loops == null ? 0.09 : opts.loops;
    for (let y = 1; y < rows - 1; y++)
      for (let x = 1; x < cols - 1; x++) {
        if (lv.walls[I(x, y)] === W.EMPTY) continue;
        const h = lv.walls[I(x - 1, y)] === W.EMPTY && lv.walls[I(x + 1, y)] === W.EMPTY;
        const v = lv.walls[I(x, y - 1)] === W.EMPTY && lv.walls[I(x, y + 1)] === W.EMPTY;
        if ((h || v) && rnd.chance(loopChance)) open(x, y);
      }

    // --- cosmetic patches of the accent wall style ---
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        if (lv.walls[I(x, y)] !== base) continue;
        const n = Math.sin(x * 0.35) * Math.cos(y * 0.42) + Math.sin((x + y) * 0.21);
        if (n > 0.75) lv.walls[I(x, y)] = accent;
      }

    // --- start + exit: the exit goes to the farthest reachable cell ---
    L.setThing(lv, 1, 1, T.START);
    const dist = L.bfs(lv, 1, 1);
    let best = -1, bx = 1, by = 1;
    for (let y = 1; y < rows - 1; y++)
      for (let x = 1; x < cols - 1; x++) {
        const d = dist[I(x, y)];
        if (d > best) { best = d; bx = x; by = y; }
      }
    L.setThing(lv, bx, by, T.FINISH);

    const openCells = [];
    for (let y = 1; y < rows - 1; y++)
      for (let x = 1; x < cols - 1; x++)
        if (lv.walls[I(x, y)] === W.EMPTY && !lv.things[I(x, y)] && dist[I(x, y)] > 0)
          openCells.push([x, y]);

    // --- secret walls, but only where they open a genuine shortcut ---
    const secretTarget = opts.secrets == null ? 1 + rnd.int(3) : opts.secrets;
    const secretCand = [];
    for (let y = 1; y < rows - 1; y++)
      for (let x = 1; x < cols - 1; x++) {
        if (lv.walls[I(x, y)] === W.EMPTY) continue;
        const pairs = [[I(x - 1, y), I(x + 1, y)], [I(x, y - 1), I(x, y + 1)]];
        for (const pr of pairs) {
          const a = pr[0], b = pr[1];
          if (lv.walls[a] !== W.EMPTY || lv.walls[b] !== W.EMPTY) continue;
          if (dist[a] < 0 || dist[b] < 0) continue;
          const gain = Math.abs(dist[a] - dist[b]);
          if (gain > 9) secretCand.push({ x: x, y: y, gain: gain });
        }
      }
    secretCand.sort((p, q) => q.gain - p.gain);
    for (let i = 0; i < Math.min(secretTarget, secretCand.length); i++) {
      const c = secretCand[i];
      lv.walls[I(c.x, c.y)] = W.SECRET;
    }

    // --- locked door on the critical path, key stashed on the near side ---
    if (opts.door !== false && best > 14) {
      const path = [];
      let px = bx, py = by, guard = 0;
      while (!(px === 1 && py === 1) && guard++ < 6000) {
        path.push([px, py]);
        let nxt = null;
        for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = px + d[0], ny = py + d[1];
          if (!L.inside(lv, nx, ny)) continue;
          if (dist[I(nx, ny)] >= 0 && dist[I(nx, ny)] === dist[I(px, py)] - 1) { nxt = [nx, ny]; break; }
        }
        if (!nxt) break;
        px = nxt[0]; py = nxt[1];
      }
      const corridor = path.filter(function (c, i) {
        if (i < 3 || i > path.length - 4) return false;
        if (lv.things[I(c[0], c[1])]) return false;
        let openN = 0;
        for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]])
          if (L.wallAt(lv, c[0] + d[0], c[1] + d[1]) === W.EMPTY) openN++;
        return openN === 2;
      });
      if (corridor.length) {
        const spot = corridor[Math.floor(corridor.length * 0.35)];
        lv.walls[I(spot[0], spot[1])] = W.DOOR;
        const reach = L.bfs(lv, 1, 1, { door: false });
        const keySpots = openCells.filter((c) => reach[I(c[0], c[1])] > 4 && !lv.things[I(c[0], c[1])]);
        if (keySpots.length) {
          keySpots.sort((a, b) => reach[I(b[0], b[1])] - reach[I(a[0], a[1])]);
          const pick = keySpots[rnd.int(Math.max(1, Math.floor(keySpots.length * 0.3)))];
          L.setThing(lv, pick[0], pick[1], T.KEY);
        } else {
          lv.walls[I(spot[0], spot[1])] = W.EMPTY;   // nowhere fair for the key: drop the door
        }
      }
    }

    // --- starts for players 2-4: on player 1's side of the door, about as far from
    //     the exit as player 1, and spread apart so a race starts fair ---
    if (opts.players !== false) {
      const fromExit = L.bfs(lv, bx, by, { secret: false, door: true });
      const reachP1 = L.bfs(lv, 1, 1, { secret: false, door: false });
      const target = fromExit[I(1, 1)];
      const chosen = [[1, 1]];
      const cand = openCells.filter((c) => {
        const i = I(c[0], c[1]);
        // tighter than the validator's "uneven" warning, so a generated race never trips it
        return !lv.things[i] && reachP1[i] > 6 && fromExit[i] > 0 && Math.abs(fromExit[i] - target) <= Math.max(2, Math.floor(target * 0.1));
      });
      for (let s = 1; s < 4 && cand.length; s++) {
        let bestC = null, bestD = -1;
        for (const c of cand) {
          let m = 1e9;
          for (const o of chosen) m = Math.min(m, Math.abs(c[0] - o[0]) + Math.abs(c[1] - o[1]));
          if (m > bestD) { bestD = m; bestC = c; }
        }
        if (!bestC || bestD < 3) break;
        chosen.push(bestC);
        L.setThing(lv, bestC[0], bestC[1], MAZE.START_IDS[s]);
        cand.splice(cand.indexOf(bestC), 1);
      }
    }
    const nearStart = (function () {
      const best = new Int32Array(cols * rows).fill(1 << 29);
      for (const s of L.findStarts(lv)) {
        if (!s) continue;
        const d = L.bfs(lv, s.x, s.y);
        for (let i = 0; i < d.length; i++) if (d[i] >= 0 && d[i] < best[i]) best[i] = d[i];
      }
      return best;
    })();

    // --- items ---
    const free = rnd.shuffle(openCells.filter((c) => !lv.things[I(c[0], c[1])] && dist[I(c[0], c[1])] > 3));
    let fi = 0;
    const put = (id) => { const c = free[fi++]; if (c) L.setThing(lv, c[0], c[1], id); };
    const area = (cols * rows) / 100;

    put(T.SWORD);
    if (rnd.chance(.8)) { put(T.BOW); put(T.ARROWS); if (rnd.chance(.6)) put(T.ARROWS); }
    if (rnd.chance(.7)) put(T.SHIELD);
    if (rnd.chance(.75)) put(T.TORCH);
    if (rnd.chance(.5)) put(T.BOOTS);
    for (let i = 0; i < 1 + Math.round(area * 0.35); i++) put(T.POTION);
    for (let i = 0; i < 3 + Math.round(area * 0.7); i++) put(T.TREASURE);

    // --- enemies, kept well away from every spawn point ---
    const spawnSafe = free.filter((c) => nearStart[I(c[0], c[1])] > 8 && !lv.things[I(c[0], c[1])]);
    const enemyCount = opts.enemies == null ? Math.round((2 + area * 0.9) * diff) : opts.enemies;
    for (let i = 0; i < Math.min(enemyCount, spawnSafe.length); i++) {
      const c = spawnSafe[i], roll = rnd();
      L.setThing(lv, c[0], c[1], roll < 0.6 ? T.BLOB : roll < 0.85 ? T.BLOB_FAST : T.BLOB_TANK);
    }

    L.border(lv, base);
    return lv;
  };

  // --------------------------------------------------------- validation --
  L.validate = function (lv) {
    const errors = [], warnings = [], info = [];
    const start = L.findThing(lv, T.START);
    const finish = L.findThing(lv, T.FINISH);
    if (!start) errors.push("No player 1 start — place one.");
    if (!finish) errors.push("No exit portal — place one.");

    const counts = { enemies: 0, items: 0, secrets: 0, treasure: 0, open: 0, doors: 0, keys: 0, bow: 0, arrows: 0 };
    for (let i = 0; i < lv.walls.length; i++) {
      if (lv.walls[i] === W.EMPTY) counts.open++;
      if (lv.walls[i] === W.SECRET) counts.secrets++;
      if (lv.walls[i] === W.DOOR) counts.doors++;
      const t = lv.things[i];
      const def = MAZE.THINGS[t];
      if (!def) continue;
      if (def.cat === "enemy") counts.enemies++;
      else if (def.cat === "item" || def.cat === "weapon") counts.items++;
      if (t === T.TREASURE) counts.treasure++;
      if (t === T.KEY) counts.keys++;
      if (t === T.BOW) counts.bow++;
      if (t === T.ARROWS) counts.arrows++;
    }

    if (start && finish) {
      const viaSecret = L.bfs(lv, start.x, start.y, { secret: true, door: true });
      const strict = L.bfs(lv, start.x, start.y, { secret: false, door: true });
      const fi = finish.y * lv.cols + finish.x;
      if (viaSecret[fi] < 0) errors.push("The exit cannot be reached from the start.");
      else if (strict[fi] < 0) warnings.push("The only route to the exit runs through a secret wall.");
      if (counts.doors && !counts.keys) warnings.push("There is a locked door but no key.");
      let buried = 0;
      for (let i = 0; i < lv.things.length; i++)
        if (lv.things[i] && lv.walls[i] !== W.EMPTY) buried++;
      if (buried) warnings.push(buried + " object(s) sit inside walls and will be ignored.");

      // extra player starts: each has to be able to get out, and a race should be fair
      // fairness is judged on the route everyone can see; secrets are a bonus for whoever finds them
      const starts = L.findStarts(lv);
      const fromExit = L.bfs(lv, finish.x, finish.y, { secret: true, door: true });
      const honest = L.bfs(lv, finish.x, finish.y, { secret: false, door: true });
      const steps = [];
      counts.starts = 0;
      starts.forEach(function (s, seat) {
        if (!s) return;
        counts.starts++;
        const i = s.y * lv.cols + s.x;
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

  // --------------------------------------------------------- maze codes --
  // A maze's code is a hash of its layout (size, walls, things; not its name), so
  // the same maze always has the same code and any edit gives it a new one.
  const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";   // Crockford base32: no I, L, O, U
  L.CODE_LENGTH = 6;
  L.canonical = function (lv) {
    let s = lv.cols + "x" + lv.rows + ":";
    for (let i = 0; i < lv.walls.length; i++) s += String.fromCharCode(48 + lv.walls[i]);
    s += ":";
    for (let i = 0; i < lv.things.length; i++) s += String.fromCharCode(48 + lv.things[i]);
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
    return JSON.stringify({
      format: "maze.level", version: 2, name: lv.name, cols: lv.cols, rows: lv.rows,
      walls: Array.from(lv.walls), things: Array.from(lv.things)
    });
  };

  // Anything unknown becomes floor / nothing, so a hand-edited or hostile file can
  // never put an id the engine does not understand into the grid.
  L.fromJSON = function (text) {
    const o = typeof text === "string" ? JSON.parse(text) : text;
    if (!o || !o.cols || !o.rows || !o.walls || !o.things) throw new Error("Not a MAZE level file.");
    const name = String(o.name || "Imported Maze").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40) || "Imported Maze";
    const lv = L.create(+o.cols, +o.rows, name);
    if (lv.cols !== +o.cols || lv.rows !== +o.rows) throw new Error("Maze size out of range.");
    const n = lv.cols * lv.rows;
    const seen = {};
    for (let i = 0; i < n; i++) {
      const w = +o.walls[i] || 0, t = +o.things[i] || 0;
      lv.walls[i] = w === W.EMPTY || MAZE.WALLS[w] ? w : W.EMPTY;
      let id = MAZE.THINGS[t] ? t : 0;
      if (id && MAZE.THINGS[id].unique) { if (seen[id]) id = 0; seen[id] = 1; }
      lv.things[i] = id;
    }
    L.border(lv, W.BRICK);
    // keep whatever border style the file used, as long as it is a solid wall
    for (let i = 0; i < n; i++) {
      const x = i % lv.cols, y = (i / lv.cols) | 0;
      if (x && y && x < lv.cols - 1 && y < lv.rows - 1) continue;
      const w = +o.walls[i];
      if (MAZE.WALLS[w] && MAZE.WALLS[w].solid && w !== W.DOOR) lv.walls[i] = w;
    }
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
