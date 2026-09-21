/* MAZE — boot, screen switching, menus. */
(function () {
  const MAZE = window.MAZE;
  const U = MAZE.util;
  const L = MAZE.Level;

  let editor = null;
  let game = null;
  let lastResult = null;

  const $ = (id) => document.getElementById(id);

  function showEditor() {
    if (game) { game.stop(); game.paused = true; }
    $("gameScreen").hidden = true;
    $("editorScreen").hidden = false;
    hidePanels();
    editor.render();
  }

  function hidePanels() {
    $("clickToPlay").hidden = true;
    $("pausePanel").hidden = true;
    $("endPanel").hidden = true;
  }

  // --------------------------------------------------------------- play --
  function startGame(level) {
    $("editorScreen").hidden = true;
    $("gameScreen").hidden = false;
    hidePanels();
    $("clickToPlay").hidden = false;

    if (!game) {
      game = new MAZE.Game($("view"), $("hud"), { onEnd: onEnd });
      MAZE.game = game;
      game.sensitivity = parseFloat($("inpSens").value) || 1;
      game.setQuality(parseFloat($("selQuality").value) || 0.7);
    }
    game.handleResize();
    game.load(level);
    game.paused = true;
    game.start();
  }

  function lockPointer() {
    hidePanels();
    MAZE.audio.init();
    MAZE.audio.startAmbience();
    const v = $("view");
    const p = v.requestPointerLock && v.requestPointerLock();
    if (p && p.catch) p.catch(function () {});
    game.paused = false;
    game.last = performance.now();
  }

  function onEnd(result) {
    lastResult = result;
    if (document.exitPointerLock) document.exitPointerLock();
    const s = result.stats;
    $("endTitle").textContent = result.won ? "ESCAPED" : "YOU DIED";
    $("endTitle").className = result.won ? "" : "dead";
    $("endLead").textContent = result.won
      ? "You found your way out of " + game.level.name + "."
      : "The maze keeps you. " + game.level.name + " wins this round.";

    const rows = [
      ["Time", U.fmtTime(s.time)],
      ["Blobs slain", String(s.kills)],
      ["Treasure", s.treasure + " / " + game.totalTreasure],
      ["Secrets found", String(s.secrets)],
      ["Damage taken", String(Math.round(s.damage))]
    ];
    if (result.won) {
      rows.push(["Time bonus", "+" + s.timeBonus]);
      if (s.allTreasure) rows.push(["All treasure", "+1000"]);
    }
    rows.push(["SCORE", String(Math.round(s.score))]);

    const host = $("endStats");
    host.innerHTML = "";
    rows.forEach(function (r) {
      const a = document.createElement("span");
      a.textContent = r[0];
      const b = document.createElement("b");
      b.textContent = r[1];
      host.appendChild(a); host.appendChild(b);
    });
    $("endPanel").hidden = false;
  }

  function restart() {
    hidePanels();
    game.restart();
    game.paused = true;
    $("clickToPlay").hidden = false;
  }

  // ------------------------------------------------------------ topbar --
  function topbarAction(act) {
    switch (act) {
      case "new":
        editor.snapshot();
        editor.level = L.create(+$("inpCols").value || 25, +$("inpRows").value || 19, $("inpName").value || "Untitled Maze");
        editor.render();
        break;
      case "generate": {
        editor.snapshot();
        const name = $("inpName").value || "Generated Maze";
        editor.level = L.generate({
          cols: +$("inpCols").value || 25,
          rows: +$("inpRows").value || 19,
          name: name
        });
        editor.render();
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
        L.clear(editor.level);
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
    const old = el.textContent;
    el.textContent = text;
    el.style.color = "#ffb454";
    clearTimeout(flash._t);
    flash._t = setTimeout(function () {
      el.textContent = old;
      el.style.color = "";
    }, 1800);
  }

  // ---------------------------------------------------------------- go --
  function boot() {
    MAZE.buildTextures();
    MAZE.buildSprites();

    editor = new MAZE.Editor();
    MAZE.editor = editor;
    editor.syncInputs();
    editor.refreshLevelList();
    editor.render();

    document.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function () {
        const act = b.dataset.act;
        if (act === "lock") { lockPointer(); return; }
        if (act === "restart") { restart(); return; }
        if (act === "quit") { showEditor(); return; }
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
          editor.snapshot();
          editor.level = L.fromJSON(String(fr.result));
          editor.syncInputs();
          editor.render();
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

    document.addEventListener("pointerlockchange", function () {
      if (!game || !game.running) return;
      if (document.pointerLockElement !== $("view")) {
        if (!game.ended) {
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
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
