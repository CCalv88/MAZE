/* MAZE — boot, screen switching, menus. */
(function () {
  const MAZE = window.MAZE;
  const U = MAZE.util;
  const L = MAZE.Level;

  let editor = null;
  let game = null;
  let soloLevel = null;          // the maze a solo run started from, for "try again"

  const $ = (id) => document.getElementById(id);

  function showEditor() {
    if (game) { game.stop(); game.paused = true; }
    $("gameScreen").hidden = true;
    $("editorScreen").hidden = false;
    hidePanels();
    editor.render();
  }

  function hidePanels() {
    $("relock").hidden = true;
    $("clickToPlay").hidden = true;
    $("pausePanel").hidden = true;
    $("endPanel").hidden = true;
  }

  function ensureGame() {
    if (!game) {
      game = new MAZE.Game($("view"), $("hud"), {
        onEnd: onEnd,
        onMenu: function () { if (!game.ended) { game.paused = true; $("pausePanel").hidden = false; } },
        onChar: openChar,
        onRelock: requestLock,
        onMe: function () { MAZE.character.render(); }
      });
      MAZE.game = game;
      game.sensitivity = parseFloat($("inpSens").value) || 1;
      game.setQuality(parseFloat($("selQuality").value) || 0.7);
    }
    return game;
  }

  function enterGame(full, seat, link, lead) {
    $("editorScreen").hidden = true;
    $("gameScreen").hidden = false;
    hidePanels();
    $("readyLead").textContent = lead;
    $("clickToPlay").hidden = false;
    const g = ensureGame();
    g.stop();
    g.handleResize();
    g.load(full, seat, link);
    g.paused = true;
    g.start();
  }

  // --------------------------------------------------------------- play --
  // Solo: the whole world runs right here in the tab.
  function startGame(level) {
    soloLevel = L.clone(level);
    document.body.classList.remove("is-online", "is-spectator");
    const sim = new MAZE.Sim(level, { mode: "solo" });
    sim.addPlayer(0, "You");
    enterGame(sim.fullState(), 0, new MAZE.LocalLink(sim, 0), "Find the exit. Do not get eaten.");
  }

  // Online: the server runs the world; msg is its "start" message.
  function startOnline(msg) {
    document.body.classList.add("is-online");
    document.body.classList.toggle("is-spectator", !!msg.spectator);
    const mode = MAZE.MODES[msg.full.mode];
    const lead = msg.spectator
      ? "You are watching your maze. See everyone from above, or through any player's eyes."
      : msg.full.mode === "versus"
        ? "Competitive — first one out wins. Watch your back."
        : "Co-op — everyone has to get out. Stick together.";
    enterGame(msg.full, msg.seat, new MAZE.NetLink(MAZE.net, msg.seat, msg.spectator), lead);
    game.playerName = (msg.names && msg.names[msg.seat]) || "You";
    game.opts.names = msg.names || {};
    if (mode) document.title = "MAZE · " + mode.name;
  }

  function lockPointer() {
    hidePanels();
    MAZE.audio.init();
    MAZE.audio.startAmbience();
    // spectators keep the mouse, to click players on the overhead map
    if (!game.spectator) requestLock();
    game.paused = false;
    game.last = performance.now();
  }

  // Browsers can refuse to capture the mouse: from an Esc keypress, or for about a
  // second after it was last released. Mouse-look only works while it is captured, so
  // if the request fails, say so and let a click try again.
  function requestLock() {
    const v = $("view");
    $("relock").hidden = true;
    try {
      const p = v.requestPointerLock && v.requestPointerLock();
      if (p && p.catch) p.catch(showRelock);
    } catch (e) { showRelock(); }
    clearTimeout(requestLock._t);
    requestLock._t = setTimeout(function () { if (document.pointerLockElement !== v) showRelock(); }, 500);
  }
  function showRelock() {
    if (!game || !game.running || game.ended || game.spectator || game.charOpen) return;
    if (document.pointerLockElement === $("view")) return;
    if (!$("pausePanel").hidden || !$("clickToPlay").hidden || !$("endPanel").hidden) return;
    $("relock").hidden = false;
  }

  // the character sheet takes the mouse; closing it hands the mouse back to the game
  function openChar() {
    if (!game || game.ended) return;
    if (!MAZE.character.open(game)) return;
    if (document.exitPointerLock) document.exitPointerLock();
  }
  function closeChar() {
    if (!MAZE.character.isOpen()) return;
    MAZE.character.close();
    if (game && !game.ended) lockPointer();
  }

  function statRows(host, rows) {
    host.innerHTML = "";
    rows.forEach(function (r) {
      const a = document.createElement("span");
      a.textContent = r[0];
      const b = document.createElement("b");
      b.textContent = r[1];
      host.appendChild(a); host.appendChild(b);
    });
  }

  function onEnd(result, g) {
    MAZE.character.close();
    if (document.exitPointerLock) document.exitPointerLock();
    document.title = "MAZE";
    const me = result.players.find((p) => p.seat === g.seat) || result.players[0];
    const title = $("endTitle"), lead = $("endLead");
    $("endStats").innerHTML = "";
    $("endTable").innerHTML = "";

    if (result.mode === "solo") {
      const s = me.stats, won = result.outcome === "escaped";
      title.textContent = won ? "ESCAPED" : "YOU DIED";
      title.className = won ? "" : "dead";
      lead.textContent = won
        ? "You found your way out of " + g.level.name + "."
        : "The maze keeps you. " + g.level.name + " wins this round.";
      const rows = [
        ["Time", U.fmtTime(s.time)],
        ["Level reached", String(s.level || 1)],
        ["Monsters slain", String(s.kills)],
        ["Treasure", s.treasure + " / " + result.totalTreasure],
        ["Secrets found", String(s.secrets)],
        ["Damage taken", String(Math.round(s.damage))]
      ];
      if (won) {
        rows.push(["Time bonus", "+" + (s.timeBonus || 0)]);
        if (s.allTreasure) rows.push(["All treasure", "+1000"]);
      }
      rows.push(["SCORE", String(Math.round(s.score))]);
      statRows($("endStats"), rows);
    } else {
      if (result.mode === "versus") {
        const winner = result.players.find((p) => p.seat === result.winner);
        const iWon = result.winner === g.seat;
        title.textContent = iWon ? "YOU WIN" : winner ? (winner.name + " WINS").toUpperCase() : "MATCH OVER";
        title.className = iWon || g.spectator ? "" : "dead";
        lead.textContent = iWon ? "First one out of " + g.level.name + ". Nobody could stop you."
          : winner ? winner.name + " got out of " + g.level.name + " first." : "Nobody made it out.";
      } else {
        const out = result.players.filter((p) => p.escaped).length;
        const all = out === result.players.filter((p) => !p.away).length;
        title.textContent = result.outcome === "escaped" ? (all ? "TEAM ESCAPED" : "ESCAPED") : "WIPED OUT";
        title.className = result.outcome === "escaped" ? "" : "dead";
        lead.textContent = result.outcome === "escaped"
          ? (all ? "Everyone made it out of " + g.level.name + "." : out + " of you made it out of " + g.level.name + ".")
          : "The whole party fell. " + g.level.name + " wins this round.";
      }
      $("endTable").appendChild(MAZE.online.resultTable(result, g.seat));
    }
    $("endPanel").hidden = false;
  }

  function restart() {
    if (!soloLevel) return;
    startGame(soloLevel);
  }

  // ------------------------------------------------------------ topbar --
  function topbarAction(act) {
    switch (act) {
      case "new":
        editor.snapshot();
        editor.setLevel(L.create(+$("inpCols").value || 25, +$("inpRows").value || 19, $("inpName").value || "Untitled Maze", +$("inpFloors").value || 1));
        break;
      case "generate": {
        editor.snapshot();
        const name = $("inpName").value || "Generated Maze";
        editor.setLevel(L.generate({
          cols: +$("inpCols").value || 25,
          rows: +$("inpRows").value || 19,
          floors: U.clamp(+$("inpFloors").value || 1, 1, MAZE.MAX_FLOORS),
          name: name
        }));
        break;
      }
      case "resize":
        editor.snapshot();
        editor.level = L.resize(editor.level, +$("inpCols").value, +$("inpRows").value);
        editor.syncInputs();
        editor.render();
        break;
      case "clear":
        editor.snapshot();
        L.clear(editor.level, editor.floor);   // just the floor you are looking at
        editor.render();
        break;
      case "undo": editor.undo(); break;
      case "redo": editor.redo(); break;
      case "save": {
        editor.level.name = ($("inpName").value || "Untitled Maze").trim();
        if (L.save(editor.level)) {
          editor.refreshLevelList();
          flash("Saved.");
        } else {
          flash("Could not save — browser storage is unavailable.");
        }
        break;
      }
      case "export":
        editor.level.name = ($("inpName").value || "Untitled Maze").trim();
        U.download(editor.level.name.replace(/[^\w\-]+/g, "_") + ".maze.json", L.toJSON(editor.level));
        break;
      case "import":
        $("fileInput").click();
        break;
    }
  }

  function flash(text) {
    const el = $("editorHint");
    if (flash._old == null) flash._old = el.textContent;
    el.textContent = text;
    el.style.color = "#ffb454";
    clearTimeout(flash._t);
    flash._t = setTimeout(function () {
      el.textContent = flash._old;
      flash._old = null;
      el.style.color = "";
    }, 2400);
  }

  function loadIntoEditor(level) {
    editor.snapshot();
    editor.setLevel(level);
  }

  // ---------------------------------------------------------------- go --
  function boot() {
    MAZE.buildTextures();
    MAZE.buildSprites();

    // the Monster Maker hands finished monsters to the editor to place
    MAZE.monsters.init({
      onPlace: function (m) {
        editor.buildPalette();
        editor.select("monster", m.uid);
        flash("Painting " + m.name + " — click the maze to place it.");
      },
      onChange: function (m) {
        // an edited monster that the current maze already uses is updated in the maze too
        if (m && (editor.level.monsters || []).some((o) => o.uid === m.uid)) L.addMonster(editor.level, m);
        editor.buildPalette();
        editor.render();
      }
    });
    MAZE.character.onClose = closeChar;

    editor = new MAZE.Editor();
    MAZE.editor = editor;
    editor.syncInputs();
    editor.refreshLevelList();
    editor.render();

    MAZE.app = {
      editor: editor, flash: flash, showEditor: showEditor, startOnline: startOnline, loadIntoEditor: loadIntoEditor,
      game: function () { return game; },
      currentLevel: function () { editor.level.name = ($("inpName").value || "Untitled Maze").trim(); return editor.level; }
    };

    document.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function () {
        const act = b.dataset.act;
        if (act === "lock") { lockPointer(); return; }
        if (act === "restart") { restart(); return; }
        if (act === "quit") { showEditor(); return; }
        if (act === "toLobby") { showEditor(); MAZE.online.showLobby(); return; }
        if (act === "leaveMatch") { showEditor(); MAZE.online.leaveRoom(); return; }
        if (act === "abort") { MAZE.net.send({ t: "abort" }); return; }
        if (act === "closeChar") { closeChar(); return; }
        topbarAction(act);
      });
    });

    $("btnTest").addEventListener("click", function () {
      editor.level.name = ($("inpName").value || "Untitled Maze").trim();
      const v = L.validate(editor.level);
      if (!v.ok) { flash(v.errors[0]); return; }
      startGame(editor.level);
    });

    $("inpName").addEventListener("change", function () {
      editor.level.name = this.value.trim() || "Untitled Maze";
    });

    $("fileInput").addEventListener("change", function (e) {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const fr = new FileReader();
      fr.onload = function () {
        try {
          loadIntoEditor(L.fromJSON(String(fr.result)));
          flash("Imported " + editor.level.name);
        } catch (err) {
          flash("That file is not a MAZE level.");
        }
      };
      fr.readAsText(f);
      e.target.value = "";
    });

    $("selQuality").addEventListener("change", function () {
      if (game) game.setQuality(parseFloat(this.value));
    });
    $("inpSens").addEventListener("input", function () {
      if (game) game.sensitivity = parseFloat(this.value);
    });

    $("relock").addEventListener("mousedown", function (e) { e.preventDefault(); requestLock(); });
    document.addEventListener("pointerlockerror", showRelock);
    document.addEventListener("pointerlockchange", function () {
      if (!game || !game.running) return;
      if (document.pointerLockElement === $("view")) { $("relock").hidden = true; return; }
      if (document.pointerLockElement !== $("view")) {
        if (!game.ended && !game.charOpen && !game.spectator) {
          $("relock").hidden = true;             // the pause menu has its own RESUME
          game.paused = true;
          for (const k in game.keys) game.keys[k] = 0;
          $("pausePanel").hidden = false;
        }
      }
    });

    window.addEventListener("resize", function () {
      if (game && game.running) game.handleResize();
    });

    // editor keyboard shortcuts
    window.addEventListener("keydown", function (e) {
      if (!$("gameScreen").hidden) return;
      if (document.querySelector("#editorScreen .overlay:not([hidden])")) return;
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "select" || tag === "textarea") return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.code === "KeyZ") { editor.undo(); e.preventDefault(); return; }
      if (ctrl && (e.code === "KeyY" || (e.code === "KeyZ" && e.shiftKey))) { editor.redo(); e.preventDefault(); return; }
      if (ctrl && e.code === "KeyS") { topbarAction("save"); e.preventDefault(); return; }
      const map = { KeyB: "brush", KeyL: "line", KeyR: "rect", KeyF: "fill", KeyX: "eraser", KeyP: "pick" };
      if (map[e.code]) { editor.setTool(map[e.code]); return; }
      const wallKeys = { Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4, Digit5: 5, Digit6: 6, Digit0: 0 };
      if (e.code in wallKeys) { editor.select("wall", wallKeys[e.code]); return; }
      if (e.code === "Enter") { $("btnTest").click(); }
    });

    MAZE.online.init();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
