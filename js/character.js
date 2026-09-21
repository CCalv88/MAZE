/* MAZE — the character sheet (C in game): spend stat points, learn scrolls, pick a spell,
   and drop things for teammates. It only asks; the world (MAZE.Sim, here or on the
   server) decides, and the sheet redraws from whatever comes back. */
(function () {
  const MAZE = window.MAZE;
  const $ = (id) => document.getElementById(id);
  let game = null;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function iconEl(name) {
    const src = MAZE.sprites.icon(name);
    const c = document.createElement("canvas");
    c.width = c.height = 32; c.className = "chIcon";
    if (src) { const g = c.getContext("2d"); g.imageSmoothingEnabled = false; g.drawImage(src, 0, 0, 32, 32); }
    return c;
  }

  // what a stat's points currently do for you
  function effect(id, n) {
    switch (id) {
      case "atk": return "+" + (n * 10) + "% damage";
      case "spd": return "+" + (n * 5) + "% speed";
      case "def": return "-" + Math.min(60, n * 7) + "% damage taken";
      case "vit": return (MAZE.PLAYER.maxHp + 15 * n) + " max health";
      case "mag": return (MAZE.PLAYER.baseMana + 20 * n) + " mana · +" + (n * 8) + "% spell power";
    }
    return "";
  }

  // everything the sheet might send, applied at once in solo play (the world is paused)
  function act(fn) {
    fn(game.link);
    for (const b of game.link.flush()) game.applyBatch(b);
    render();
  }

  function render() {
    if (!game || $("charPanel").hidden) return;
    const p = game.player;
    $("chLevel").textContent = p.level;
    const frac = p.level >= MAZE.MAX_LEVEL ? 1 : p.xp / p.xpNext;
    $("chXp").style.width = Math.round(frac * 100) + "%";
    $("chXpText").textContent = p.level >= MAZE.MAX_LEVEL ? "Maximum level" : p.xp + " / " + p.xpNext + " XP to level " + (p.level + 1);
    $("chPoints").textContent = p.points ? p.points + " point" + (p.points > 1 ? "s" : "") + " to spend" : "";

    // stats
    const box = $("chStats");
    box.innerHTML = "";
    MAZE.STATS.forEach(function (s, k) {
      const n = p.stats[s.id] || 0;
      const row = el("div", "chStat");
      row.style.setProperty("--c", s.color);
      const name = el("div", "chStatName");
      name.appendChild(el("b", null, s.name));
      name.appendChild(el("span", null, s.desc));
      const pips = el("div", "chPips");
      for (let i = 0; i < 15; i++) pips.appendChild(el("i", i < n ? "on" : ""));
      const val = el("div", "chStatVal", effect(s.id, n));
      const plus = el("button", "chPlus", "+");
      plus.title = "Spend a point on " + s.name + " (" + (k + 1) + ")";
      plus.disabled = !p.points || n >= 15;
      plus.onclick = function () { act(function (link) { link.allocate(s.id); }); };
      row.appendChild(el("kbd", null, String(k + 1)));
      row.appendChild(name); row.appendChild(pips); row.appendChild(val); row.appendChild(plus);
      box.appendChild(row);
    });

    // spellbook
    const book = $("chSpells");
    book.innerHTML = "";
    if (!p.spells.length) book.appendChild(el("div", "chEmpty", "No spells yet. Find a scroll and learn it here."));
    p.spells.forEach(function (id) {
      const sp = MAZE.SPELLS[id];
      const row = el("button", "chSpell" + (p.spell === id ? " on" : ""));
      row.style.setProperty("--c", sp.color);
      row.appendChild(iconEl("scroll_" + id));
      const t = el("div");
      t.appendChild(el("b", null, sp.name));
      t.appendChild(el("span", null, sp.cost + " mana · " + sp.desc));
      row.appendChild(t);
      row.title = "Make " + sp.name + " your spell (R cycles in game)";
      row.onclick = function () { p.spell = id; p.weapon = "magic"; render(); };
      book.appendChild(row);
    });

    // scrolls in the bag
    const bag = $("chScrolls");
    bag.innerHTML = "";
    if (!p.scrolls.length) bag.appendChild(el("div", "chEmpty", "No unread scrolls."));
    p.scrolls.forEach(function (id) {
      const sp = MAZE.SPELLS[id];
      const need = MAZE.TIER_NEEDS[sp.tier], known = p.spells.indexOf(id) >= 0, ready = (p.stats.mag || 0) >= need;
      const row = el("div", "chScroll");
      row.style.setProperty("--c", sp.color);
      row.appendChild(iconEl("scroll_" + id));
      const t = el("div");
      t.appendChild(el("b", null, sp.name + "  ·  tier " + sp.tier));
      t.appendChild(el("span", null, known ? "You already know this one — give it to a friend." : ready ? sp.desc : "Needs " + need + " points in Mana (you have " + (p.stats.mag || 0) + ")."));
      row.appendChild(t);
      const learn = el("button", "primary", "Learn");
      learn.disabled = known || !ready;
      learn.onclick = function () { act(function (link) { link.learn(id); }); };
      const drop = el("button", null, "Drop");
      drop.title = "Leave it on the floor in front of you";
      drop.onclick = function () { act(function (link) { link.drop("scroll:" + id); }); };
      row.appendChild(learn); row.appendChild(drop);
      bag.appendChild(row);
    });

    // everything else you carry
    const items = $("chItems");
    items.innerHTML = "";
    const carry = [];
    if (p.weapons.sword) carry.push(["sword", "sword", "Sword"]);
    if (p.weapons.bow) carry.push(["bow", "bow", "Bow"]);
    if (p.arrows > 0) carry.push(["arrows", "arrows", "Arrows ×" + p.arrows + " (drops 8)"]);
    if (p.has.shield) carry.push(["shield", "shield", "Shield"]);
    if (p.has.boots) carry.push(["boots", "boots", "Swift Boots"]);
    if (p.has.torch) carry.push(["torch", "torch", "Torch"]);
    if (p.has.ownKey && game.mode !== "coop") carry.push(["key", "key", "Key"]);
    if (!carry.length) items.appendChild(el("div", "chEmpty", "Just your fists."));
    carry.forEach(function (c) {
      const row = el("div", "chItem");
      row.appendChild(iconEl(c[1]));
      row.appendChild(el("b", null, c[2]));
      const drop = el("button", null, "Drop");
      drop.onclick = function () { act(function (link) { link.drop(c[0]); }); };
      row.appendChild(drop);
      items.appendChild(row);
    });
    $("chHint").textContent = game.online ? "The game keeps going while this is open." : "The game is paused while this is open.";
  }

  function open(g) {
    game = g;
    if (!game || game.spectator || game.player.escaped) return false;
    game.charOpen = true;
    game.paused = true;
    for (const k in game.keys) game.keys[k] = 0;
    $("charPanel").hidden = false;
    render();
    return true;
  }
  function close() {
    if (!game) return;
    game.charOpen = false;
    $("charPanel").hidden = true;
  }
  function isOpen() { return !$("charPanel").hidden; }

  // Registered before the game's own key handler, and it swallows the keys it uses:
  // otherwise the C that closes the sheet would reach the game and open it again.
  window.addEventListener("keydown", function (e) {
    if (!game || !isOpen()) return;
    if (/^Digit[1-5]$/.test(e.code)) {
      const s = MAZE.STATS[+e.code.slice(5) - 1];
      if (s && game.player.points > 0) act(function (link) { link.allocate(s.id); });
    } else if (e.code === "KeyC" || e.code === "KeyI" || e.code === "Escape") {
      if (MAZE.character.onClose) MAZE.character.onClose();
    } else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  });

  MAZE.character = { open: open, close: close, render: render, isOpen: isOpen, onClose: null };
})();
