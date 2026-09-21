/* MAZE — the Monster Maker and the library of monsters you have made.
   The library lives in this browser's storage, so monsters survive closing the tab.
   Placing a monster copies it into the maze (lv.monsters), so a maze always carries the
   monsters it uses: shared mazes, exports and online rooms bring them along. */
(function () {
  const MAZE = window.MAZE;
  const U = MAZE.util, L = MAZE.Level;
  const KEY = "maze.monsters.v1";
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------ library --
  const Lib = {
    list() { return (U.store.get(KEY, []) || []).map(L.cleanMonster); },
    get(uid) { return Lib.list().find((m) => m.uid === uid) || null; },
    save(m) {
      m = L.cleanMonster(m);
      const all = Lib.list();
      const i = all.findIndex((o) => o.uid === m.uid);
      if (i >= 0) all[i] = m; else all.push(m);
      U.store.set(KEY, all);
      return m;
    },
    remove(uid) { U.store.set(KEY, Lib.list().filter((m) => m.uid !== uid)); },
    // monsters that arrive inside a maze join your library, so you can reuse them
    adopt(monsters) {
      const all = Lib.list();
      let added = 0;
      for (const m of monsters || []) if (!all.some((o) => o.uid === m.uid)) { all.push(L.cleanMonster(m)); added++; }
      if (added) U.store.set(KEY, all);
      return added;
    }
  };

  // --------------------------------------------------------------- maker --
  const PRESETS = {
    slime:    { c1: "#e0506a", c2: "#6a1020", c3: "#ffe14a", size: 0.8, hp: 70, speed: 1.5, dmg: 10, rate: 0.9, ability: "split" },
    spider:   { c1: "#3a3440", c2: "#c0392b", c3: "#ff3030", size: 0.75, hp: 45, speed: 3.0, dmg: 8, rate: 0.7, ability: "poison" },
    goblin:   { c1: "#7cc24a", c2: "#6b4a2a", c3: "#ffd84a", size: 0.7, hp: 40, speed: 2.6, dmg: 9, rate: 0.6, ability: "none" },
    orc:      { c1: "#6f8f4a", c2: "#5a4a6a", c3: "#ff5a2a", size: 1.1, hp: 190, speed: 1.3, dmg: 22, rate: 1.2, ability: "none" },
    skeleton: { c1: "#e8e2d0", c2: "#8a7a5a", c3: "#40e0ff", size: 0.95, hp: 80, speed: 1.8, dmg: 14, rate: 0.9, ability: "regen" },
    bat:      { c1: "#4a3a5a", c2: "#2a1e36", c3: "#ff4040", size: 0.6, hp: 25, speed: 3.6, dmg: 6, rate: 0.6, ability: "leech" },
    ghost:    { c1: "#bfe8ff", c2: "#20304a", c3: "#80ffe0", size: 0.9, hp: 60, speed: 1.6, dmg: 12, rate: 1.0, ability: "ranged" }
  };
  const NAMES = {
    slime: ["Gloop", "Oozeling", "Jellimancer", "Sludgekin"], spider: ["Webwidow", "Skitterfang", "Eightfold", "Lurkweaver"],
    goblin: ["Snikkit", "Gribble", "Knifeknee", "Wartnose"], orc: ["Grukk", "Bonebreaker", "Ironjaw", "Mawgrim"],
    skeleton: ["Rattlebones", "Dustknight", "Old Clatter", "Grinning Jack"], bat: ["Nightflap", "Squeaker", "Vampette", "Duskwing"],
    ghost: ["Wailing Wisp", "The Lingerer", "Moanmist", "Pale Tom"]
  };
  const SLIDERS = [
    { id: "size",  label: "Size",   min: 0.4, max: 1.3, step: 0.05, fmt: (v) => Math.round(v * 100) + "%" },
    { id: "hp",    label: "Health", min: 10,  max: 600, step: 5,    fmt: (v) => String(v) },
    { id: "speed", label: "Speed",  min: 0.4, max: 5,   step: 0.1,  fmt: (v) => v.toFixed(1) + (v > 3.1 ? " (outruns walkers)" : "") },
    { id: "dmg",   label: "Damage", min: 1,   max: 80,  step: 1,    fmt: (v) => String(v) },
    { id: "rate",  label: "Attacks every", min: 0.35, max: 3, step: 0.05, fmt: (v) => v.toFixed(2) + "s" },
    { id: "sight", label: "Sight",  min: 4,   max: 16,  step: 1,    fmt: (v) => v + " tiles" }
  ];

  let cur = null;          // the monster being edited
  let onPlace = null;      // editor callback: select this monster for painting
  let onChange = null;     // editor callback: library changed
  let raf = 0;

  function fresh(body) {
    body = body || "goblin";
    return L.cleanMonster(Object.assign({ uid: "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: NAMES[body][0], body: body, sight: 12 }, PRESETS[body]));
  }

  function randomColor(l0, l1) {
    const h = Math.random() * 360, s = 40 + Math.random() * 50, l = l0 + Math.random() * (l1 - l0);
    const a = s * Math.min(l, 100 - l) / 10000;
    const f = (n) => { const k = (n + h / 30) % 12; const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(c * 255).toString(16).padStart(2, "0"); };
    return "#" + f(0) + f(8) + f(4);
  }

  // "Surprise me": a random body, colours and a stat line that hangs together
  function surprise() {
    const bodies = Object.keys(MAZE.MONSTER_BODIES), body = bodies[Math.floor(Math.random() * bodies.length)];
    const abilities = Object.keys(MAZE.MONSTER_ABILITIES);
    const size = 0.5 + Math.random() * 0.75;
    const tank = Math.random();
    return L.cleanMonster({
      uid: cur ? cur.uid : undefined, name: NAMES[body][Math.floor(Math.random() * NAMES[body].length)], body: body,
      c1: randomColor(35, 70), c2: randomColor(15, 45), c3: randomColor(55, 80), size: size,
      hp: Math.round((25 + tank * 220) * size / 5) * 5, speed: +(4.2 - tank * 2.8 + Math.random() * 0.4).toFixed(1),
      dmg: Math.round(5 + tank * 22 + Math.random() * 6), rate: +(0.5 + tank * 1.1).toFixed(2), sight: 8 + Math.floor(Math.random() * 7),
      ability: Math.random() < 0.35 ? "none" : abilities[1 + Math.floor(Math.random() * (abilities.length - 1))]
    });
  }

  // ------------------------------------------------------------------ UI --
  function buildForm() {
    const bodies = $("mkBodies");
    bodies.innerHTML = "";
    for (const id in MAZE.MONSTER_BODIES) {
      const b = document.createElement("button");
      b.className = "bodyBtn";
      b.dataset.body = id;
      b.title = MAZE.MONSTER_BODIES[id].desc;
      const c = document.createElement("canvas");
      c.width = c.height = 40;
      const look = L.cleanMonster(Object.assign({ body: id }, PRESETS[id]));
      const src = MAZE.sprites.icon(MAZE.sprites.monster(look));
      const g = c.getContext("2d"); g.imageSmoothingEnabled = false; g.drawImage(src, 0, 0, 40, 40);
      b.appendChild(c);
      const s = document.createElement("span"); s.textContent = MAZE.MONSTER_BODIES[id].name; b.appendChild(s);
      b.onclick = function () {
        // switching body keeps your stats but suggests that body's colours
        const keep = { name: cur.name, uid: cur.uid, size: cur.size, hp: cur.hp, speed: cur.speed, dmg: cur.dmg, rate: cur.rate, sight: cur.sight, ability: cur.ability };
        const p = PRESETS[id];
        cur = L.cleanMonster(Object.assign({}, keep, { body: id, c1: p.c1, c2: p.c2, c3: p.c3 }));
        if (Object.values(NAMES).some((list) => list.indexOf(cur.name) >= 0)) cur.name = NAMES[id][0];
        sync();
      };
      bodies.appendChild(b);
    }
    const sl = $("mkSliders");
    sl.innerHTML = "";
    for (const s of SLIDERS) {
      const row = document.createElement("label");
      row.className = "mkSlider";
      const name = document.createElement("span"); name.textContent = s.label;
      const input = document.createElement("input");
      input.type = "range"; input.min = s.min; input.max = s.max; input.step = s.step; input.id = "mk_" + s.id;
      const out = document.createElement("output"); out.id = "mko_" + s.id;
      input.oninput = function () { cur[s.id] = +input.value; cur = L.cleanMonster(cur); sync(true); };
      row.appendChild(name); row.appendChild(input); row.appendChild(out);
      sl.appendChild(row);
    }
    const ab = $("mkAbility");
    ab.innerHTML = "";
    for (const id in MAZE.MONSTER_ABILITIES) {
      const o = document.createElement("option"); o.value = id; o.textContent = MAZE.MONSTER_ABILITIES[id].name; ab.appendChild(o);
    }
    ab.onchange = function () { cur.ability = ab.value; sync(true); };
    $("mkName").oninput = function () { cur.name = this.value; };
    for (const k of ["c1", "c2", "c3"]) $("mk" + k.toUpperCase()).oninput = function () { cur[k] = this.value; cur = L.cleanMonster(cur); sync(true); };
  }

  // push `cur` into every control, and redraw
  function sync(fromControl) {
    document.querySelectorAll("#mkBodies .bodyBtn").forEach((b) => b.classList.toggle("on", b.dataset.body === cur.body));
    if (!fromControl || document.activeElement !== $("mkName")) $("mkName").value = cur.name;
    for (const k of ["c1", "c2", "c3"]) $("mk" + k.toUpperCase()).value = cur[k];
    for (const s of SLIDERS) { $("mk_" + s.id).value = cur[s.id]; $("mko_" + s.id).textContent = s.fmt(cur[s.id]); }
    $("mkAbility").value = cur.ability;
    $("mkAbilityDesc").textContent = MAZE.MONSTER_ABILITIES[cur.ability].desc;
    MAZE.sprites.monster(cur);
    const def = L.monsterDef({ monsters: [cur] }, MAZE.CUSTOM_BASE);
    delete cur._def;
    const stars = Math.max(1, Math.min(5, Math.round(def.xp / 32)));
    $("mkThreat").innerHTML = "";
    const add = (label, value) => { const d = document.createElement("div"); const a = document.createElement("span"); a.textContent = label; const b = document.createElement("b"); b.textContent = value; d.appendChild(a); d.appendChild(b); $("mkThreat").appendChild(d); return b; };
    const danger = add("Danger", "");
    for (let i = 0; i < 5; i++) { const s = document.createElement("i"); s.className = "star" + (i < stars ? " on" : ""); s.textContent = "★"; danger.appendChild(s); }
    add("XP for a kill", String(def.xp));
    add("Hits for a sword", String(Math.ceil(cur.hp / MAZE.WEAPONS.sword.dmg)));
    add("Damage per second", (cur.dmg / cur.rate).toFixed(1));
    renderLibrary();
  }

  // the animated preview: the monster next to an adventurer, to scale
  function preview() {
    const cv = $("mkPreview");
    if (!cv || $("monsterPanel").hidden) { raf = 0; return; }
    const g = cv.getContext("2d"), W = cv.width, H = cv.height;
    g.imageSmoothingEnabled = false;
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0b0e14"); bg.addColorStop(1, "#1b202c");
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const floorY = H - 26, unit = H * 0.78;
    g.fillStyle = "#23262e"; g.fillRect(0, floorY, W, H - floorY);
    g.strokeStyle = "#2f3440"; for (let x = -((performance.now() / 40) % 32); x < W; x += 32) { g.beginPath(); g.moveTo(x, floorY); g.lineTo(x - 30, H); g.stroke(); }
    // the adventurer for scale
    const hero = MAZE.sprites.get("hero0_right_sword");
    const t = performance.now() / 1000;
    if (hero) blit(g, hero, 0, 34, floorY, MAZE.PLAYER.scale * unit);
    const def = L.monsterDef({ monsters: [cur] }, MAZE.CUSTOM_BASE); delete cur._def;
    const sp = MAZE.sprites.get(MAZE.sprites.monster(cur));
    const frame = ((t * (3 + cur.speed)) | 0) % sp.count;
    const hgt = def.scale * unit;
    blit(g, sp, frame, W * 0.62 - hgt / 2, floorY - def.zbase * unit, hgt);
    g.fillStyle = "rgba(255,255,255,.35)"; g.font = "600 11px Segoe UI,system-ui,sans-serif";
    g.fillText("you", 44, floorY + 17);
    raf = requestAnimationFrame(preview);
  }
  const _blitCanvas = document.createElement("canvas");
  function blit(g, sp, frame, x, bottom, height) {
    _blitCanvas.width = sp.w; _blitCanvas.height = sp.h;
    const c = _blitCanvas.getContext("2d");
    const img = c.createImageData(sp.w, sp.h);
    new Uint32Array(img.data.buffer).set(sp.frames[frame % sp.count]);
    c.putImageData(img, 0, 0);
    const w = height * sp.w / sp.h;
    g.drawImage(_blitCanvas, x, bottom - height, w, height);
  }

  function renderLibrary() {
    const host = $("mkLibrary");
    host.innerHTML = "";
    const all = Lib.list();
    if (!all.length) { const d = document.createElement("div"); d.className = "empty"; d.textContent = "Nothing saved yet — make something horrible."; host.appendChild(d); return; }
    for (const m of all) {
      const card = document.createElement("div");
      card.className = "libCard" + (cur && cur.uid === m.uid ? " on" : "");
      const c = document.createElement("canvas"); c.width = c.height = 48;
      const g = c.getContext("2d"); g.imageSmoothingEnabled = false; g.drawImage(MAZE.sprites.icon(MAZE.sprites.monster(m)), 0, 0, 48, 48);
      card.appendChild(c);
      const t = document.createElement("div");
      const b = document.createElement("b"); b.textContent = m.name; t.appendChild(b);
      const s = document.createElement("span"); s.textContent = MAZE.MONSTER_BODIES[m.body].name + " · " + m.hp + " hp" + (m.ability !== "none" ? " · " + MAZE.MONSTER_ABILITIES[m.ability].name : ""); t.appendChild(s);
      card.appendChild(t);
      const edit = document.createElement("button"); edit.textContent = "Edit";
      edit.onclick = function () { cur = L.cleanMonster(m); sync(); };
      const place = document.createElement("button"); place.textContent = "Place"; place.className = "primary";
      place.onclick = function () { close(); if (onPlace) onPlace(m); };
      const del = document.createElement("button"); del.textContent = "✕"; del.className = "del"; del.title = "Delete from your library";
      del.onclick = function () { if (confirm('Delete "' + m.name + '" from your library? Mazes that already use it keep their copy.')) { Lib.remove(m.uid); if (cur && cur.uid === m.uid) cur = fresh(); sync(); if (onChange) onChange(); } };
      card.appendChild(edit); card.appendChild(place); card.appendChild(del);
      host.appendChild(card);
    }
  }

  function open(m) {
    cur = m ? L.cleanMonster(m) : fresh(Object.keys(MAZE.MONSTER_BODIES)[Math.floor(Math.random() * 7)]);
    $("monsterPanel").hidden = false;
    sync();
    if (!raf) raf = requestAnimationFrame(preview);
  }
  function close() { $("monsterPanel").hidden = true; }

  function saveCurrent(thenPlace) {
    cur.name = ($("mkName").value || "").trim() || cur.name;
    cur = Lib.save(cur);
    renderLibrary();
    if (onChange) onChange(cur);
    MAZE.online && MAZE.online.toast && MAZE.online.toast(cur.name + " saved to your monster library.");
    if (thenPlace) { close(); if (onPlace) onPlace(cur); }
  }

  function init(opts) {
    onPlace = opts.onPlace; onChange = opts.onChange;
    buildForm();
    $("mkClose").onclick = close;
    $("mkNew").onclick = function () { cur = fresh(cur ? cur.body : "goblin"); sync(); };
    $("mkRandom").onclick = function () { cur = surprise(); cur.uid = fresh().uid; sync(); };
    $("mkSave").onclick = function () { saveCurrent(false); };
    $("mkSavePlace").onclick = function () { saveCurrent(true); };
    $("monsterPanel").addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  }

  MAZE.monsters = { library: Lib, open: open, close: close, init: init, PRESETS: PRESETS };
})();
