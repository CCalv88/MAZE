/* MAZE — online menus: host or join a room, the lobby, invites, and sharing a maze by
   its code. The server keeps the truth; this file only shows it and sends requests. */
(function () {
  const MAZE = window.MAZE;
  const L = MAZE.Level, T = MAZE.T, W = MAZE.W;
  const $ = (id) => document.getElementById(id);
  const net = () => MAZE.net;

  let hostMode = "coop";
  let room = null;               // latest room / lobby message from the server
  let toastTimer = null;

  function toast(text, ms) {
    const el = $("toast");
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, ms || 2600);
  }
  function say(id, text, bad) {
    const el = $(id);
    el.textContent = text || "";
    el.className = "msg" + (bad ? " bad" : "");
  }
  const pageBase = () => location.origin + location.pathname;

  function playerName() {
    const v = $("inpPlayerName").value.trim().slice(0, 14);
    MAZE.util.store.set("maze.name", v);
    return v || "Adventurer";
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return false; });
    return Promise.resolve(false);
  }

  // -------------------------------------------------------- online panel --
  function openOnline(tab) {
    const lv = MAZE.app.currentLevel();
    $("hostMazeName").textContent = lv.name;
    $("hostMazeCode").textContent = L.code(lv);
    say("onlineMsg", net().available() ? "" : "Online play works on the hosted page (stegopets.com/maze/) or with `node server.js` running. This file was opened straight from disk.", !net().available());
    $("onlinePanel").hidden = false;
    if (tab === "join") $("inpJoinCode").focus();
    else if (!$("inpPlayerName").value) $("inpPlayerName").focus();
  }

  function setMode(mode, where) {
    document.querySelectorAll('.modePick[data-for="' + where + '"] .modeBtn').forEach(function (b) {
      b.classList.toggle("on", b.dataset.mode === mode);
    });
  }

  function createRoom() {
    const lv = MAZE.app.currentLevel();
    const v = L.validate(lv);
    if (!v.ok) return say("onlineMsg", v.errors[0], true);
    say("onlineMsg", "Creating a room…");
    net().create(playerName(), JSON.parse(L.toJSON(lv)), hostMode).catch(function (e) { say("onlineMsg", e.message, true); });
  }

  function joinRoom(code) {
    code = String(code || "").toUpperCase().replace(/[^A-Z]/g, "");
    if (code.length !== 5) return say("onlineMsg", "Room codes are 5 letters.", true);
    say("onlineMsg", "Joining " + code + "…");
    net().join(code, playerName()).catch(function (e) { say("onlineMsg", e.message, true); });
  }

  function openMazeCode(raw, quiet) {
    const code = L.normCode(raw);
    if (!L.isMazeCode(code)) { if (!quiet) say("onlineMsg", "Maze codes are 6 letters and numbers.", true); return; }
    if (!net().available()) { if (!quiet) say("onlineMsg", "Loading shared mazes needs the hosted page.", true); return; }
    net().fetchMaze(code).then(function (o) {
      MAZE.app.loadIntoEditor(L.fromJSON(o));
      $("onlinePanel").hidden = true;
      MAZE.app.flash("Opened " + o.name + " (" + code + ").");
    }).catch(function (e) {
      if (quiet) MAZE.app.flash(e.message); else say("onlineMsg", e.message, true);
    });
  }

  function shareMaze() {
    const lv = MAZE.app.currentLevel();
    const v = L.validate(lv);
    if (!v.ok) return MAZE.app.flash("Fix the maze first: " + v.errors[0]);
    if (!net().available()) return MAZE.app.flash("Sharing needs the hosted page (stegopets.com/maze/).");
    net().publish(L.toJSON(lv)).then(function (r) {
      const link = pageBase() + "?maze=" + r.code;
      return copy(link).then(function (ok) {
        toast(ok ? "Maze " + r.code + " is online. Link copied: " + link : "Maze " + r.code + " is online: " + link, 5000);
      });
    }).catch(function (e) { MAZE.app.flash(e.message); });
  }

  // --------------------------------------------------------------- lobby --
  function mySeat() { return net().S.seat; }
  function amHost() { return !!(room && room.hostSeat === mySeat()); }

  function showLobby() {
    if (!room) return;
    $("onlinePanel").hidden = true;
    $("lobbyPanel").hidden = false;
    renderLobby();
  }

  function renderLobby() {
    if (!room) return;
    document.body.classList.toggle("is-host", amHost());
    $("roomPill").hidden = false;
    $("roomPillCode").textContent = room.code;
    $("lobbyCode").textContent = room.code;
    $("lobbyMazeName").textContent = room.maze.name;
    $("lobbyMazeCode").textContent = room.maze.code;
    setMode(room.mode, "lobby");
    document.querySelectorAll('.modePick[data-for="lobby"] .modeBtn').forEach(function (b) { b.disabled = !amHost() || room.state !== "lobby"; });
    document.querySelectorAll('.modePick[data-for="role"] .modeBtn').forEach(function (b) {
      b.classList.toggle("on", (b.dataset.role === "watch") === !!room.spectate);
      b.disabled = room.state !== "lobby";
    });
    drawPreview($("lobbyPreview"), room.maze.level);

    const level = room.maze.level;
    const starts = MAZE.START_IDS.map(function (id) { return level.things.indexOf(id) >= 0; });
    const host = $("lobbySeats");
    host.innerHTML = "";
    for (let s = 0; s < MAZE.MAX_PLAYERS; s++) {
      const p = room.players.find(function (q) { return q.seat === s; });
      const card = document.createElement("div");
      card.className = "seat" + (p ? "" : " open") + (s === mySeat() ? " me" : "");
      card.style.setProperty("--seat", MAZE.PLAYER_COLORS[s]);
      const top = document.createElement("div");
      top.className = "seatTop";
      top.textContent = "P" + (s + 1);
      if (p && s === room.hostSeat) { const b = document.createElement("span"); b.className = "badge"; b.textContent = "HOST"; top.appendChild(b); }
      if (s === mySeat()) { const b = document.createElement("span"); b.className = "badge you"; b.textContent = "YOU"; top.appendChild(b); }
      const nm = document.createElement("div");
      nm.className = "seatName";
      nm.textContent = p ? p.name : "Open seat";
      const st = document.createElement("div");
      st.className = "seatState";
      const watcher = p && room.spectate && s === room.hostSeat;
      st.textContent = !p ? "Waiting for a player" : !p.online ? "Offline"
        : room.state === "playing" ? (p.watching ? "Spectating" : p.playing ? "In the maze" : "Joins next round")
        : watcher ? "Will spectate" : "Ready";
      if (p && !p.online) st.classList.add("off");
      if (watcher || (p && p.watching)) st.classList.add("watch");
      const sp = document.createElement("div");
      sp.className = "seatSpawn";
      sp.textContent = watcher ? "Watching, not playing" : s === 0 || starts[s] ? "Own start point" : "Starts beside P1";
      card.appendChild(top); card.appendChild(nm); card.appendChild(st); card.appendChild(sp);
      host.appendChild(card);
    }

    const res = $("lobbyResult");
    res.innerHTML = "";
    res.hidden = !room.result;
    if (room.result) {
      const h = document.createElement("div");
      h.className = "kicker";
      h.textContent = "LAST ROUND";
      res.appendChild(h);
      res.appendChild(resultTable(room.result, mySeat()));
    }

    const btn = $("btnStartMatch");
    const playingNow = room.state === "playing";
    const iPlay = playingNow && room.players.some(function (p) { return p.seat === mySeat() && (p.playing || p.watching); });
    btn.disabled = !amHost() || playingNow;
    btn.textContent = playingNow ? (iPlay ? "REJOIN MATCH" : "MATCH IN PROGRESS") : amHost() ? (room.spectate ? "START & WATCH" : "START") : "WAITING FOR HOST";
    if (iPlay) btn.disabled = false;
    const online = room.players.filter(function (p) { return p.online; }).length;
    let status = "";
    if (playingNow && !iPlay) status = "A match is running. You are in the next round.";
    else if (!playingNow && amHost() && room.spectate) status = online < 2 ? "You are spectating: share the room code and wait for at least one player." : (online - 1) + " player" + (online > 2 ? "s" : "") + " ready. You will watch.";
    else if (!playingNow && amHost()) status = online < 2 ? "Share the room code. You can also start on your own." : online + " players ready. Start when everyone is in.";
    else if (!playingNow) status = "Waiting for " + (room.players.find(function (p) { return p.seat === room.hostSeat; }) || { name: "the host" }).name + " to start.";
    say("lobbyStatus", status);
  }

  function drawPreview(cv, level) {
    const g = cv.getContext("2d");
    const cell = Math.max(1, Math.floor(Math.min(cv.width / level.cols, cv.height / level.rows)));
    const ox = (cv.width - cell * level.cols) / 2, oy = (cv.height - cell * level.rows) / 2;
    g.fillStyle = "#070a0f";
    g.fillRect(0, 0, cv.width, cv.height);
    for (let y = 0; y < level.rows; y++)
      for (let x = 0; x < level.cols; x++) {
        const i = y * level.cols + x, w = level.walls[i], t = level.things[i];
        let c = w ? (w === W.DOOR ? "#c99b4a" : w === W.GLASS ? "#4d7f96" : "#4a5364") : "#1b212d";
        if (!w && t && MAZE.THINGS[t] && MAZE.THINGS[t].cat === "marker") c = MAZE.THINGS[t].mini;
        g.fillStyle = c;
        g.fillRect(ox + x * cell, oy + y * cell, cell, cell);
      }
  }

  // a table of everyone's round, used by the end screen and the lobby
  function resultTable(result, me) {
    const versus = result.mode === "versus";
    const rows = result.players.slice().sort(function (a, b) {
      if (versus) {
        if (a.seat === result.winner) return -1;
        if (b.seat === result.winner) return 1;
      }
      return b.stats.score - a.stats.score;
    });
    const t = document.createElement("table");
    const head = ["Player", "Result", "Blobs"].concat(versus ? ["Knockouts"] : []).concat(["Treasure", "Time", "Score"]);
    const tr = document.createElement("tr");
    head.forEach(function (h) { const th = document.createElement("th"); th.textContent = h; tr.appendChild(th); });
    t.appendChild(tr);
    rows.forEach(function (p) {
      const r = document.createElement("tr");
      if (p.seat === me) r.className = "me";
      const outcome = versus ? (p.seat === result.winner ? "Winner" : p.escaped ? "Escaped" : p.away ? "Left" : "Still inside")
        : p.escaped ? "Escaped" : p.away ? "Left" : p.dead ? "Fell" : "Still inside";
      const cells = [p.name, outcome, p.stats.kills].concat(versus ? [p.stats.frags] : []).concat([p.stats.treasure, MAZE.util.fmtTime(p.stats.time || 0), p.stats.score]);
      cells.forEach(function (c, i) {
        const td = document.createElement("td");
        td.textContent = String(c);
        if (i === 0) { td.style.color = MAZE.PLAYER_COLORS[p.seat]; td.style.fontWeight = "800"; }
        r.appendChild(td);
      });
      t.appendChild(r);
    });
    return t;
  }

  function leaveRoom() {
    net().leave();
    room = null;
    document.body.classList.remove("is-online", "is-host");
    $("lobbyPanel").hidden = true;
    $("roomPill").hidden = true;
    if (history.replaceState && /[?&]room=/.test(location.search)) history.replaceState(null, "", location.pathname);
  }

  // ---------------------------------------------------------------- wire --
  function init() {
    $("inpPlayerName").value = MAZE.util.store.get("maze.name", "") || "";

    $("btnOnline").addEventListener("click", function () { if (room) showLobby(); else openOnline(); });
    $("roomPill").addEventListener("click", showLobby);
    document.querySelectorAll("[data-close]").forEach(function (b) {
      b.addEventListener("click", function () { $(b.dataset.close).hidden = true; });
    });
    document.querySelectorAll(".modePick .modeBtn").forEach(function (b) {
      b.addEventListener("click", function () {
        const where = b.parentElement.dataset.for;
        if (where === "role") { if (amHost()) net().send({ t: "spectate", on: b.dataset.role === "watch" }); return; }
        if (where === "host") { hostMode = b.dataset.mode; setMode(hostMode, "host"); }
        else if (amHost()) net().send({ t: "mode", mode: b.dataset.mode });
      });
    });
    $("btnCreateRoom").addEventListener("click", createRoom);
    $("btnJoinRoom").addEventListener("click", function () { joinRoom($("inpJoinCode").value); });
    $("inpJoinCode").addEventListener("keydown", function (e) { if (e.key === "Enter") joinRoom(this.value); });
    $("inpJoinCode").addEventListener("input", function () { this.value = this.value.toUpperCase().replace(/[^A-Z]/g, ""); });
    $("btnOpenMaze").addEventListener("click", function () { openMazeCode($("inpMazeCode").value); });
    $("inpMazeCode").addEventListener("keydown", function (e) { if (e.key === "Enter") openMazeCode(this.value); });
    $("inpMazeCode").addEventListener("input", function () { this.value = this.value.toUpperCase().replace(/[^0-9A-Z]/g, ""); });
    $("btnShareMaze").addEventListener("click", shareMaze);

    $("btnCopyInvite").addEventListener("click", function () {
      if (!room) return;
      const link = pageBase() + "?room=" + room.code;
      copy(link).then(function (ok) { toast(ok ? "Invite link copied: " + link : "Invite link: " + link, 4000); });
    });
    $("btnLobbyUseMaze").addEventListener("click", function () {
      const lv = MAZE.app.currentLevel();
      const v = L.validate(lv);
      if (!v.ok) return say("lobbyStatus", "Your editor's maze is not playable yet: " + v.errors[0], true);
      net().send({ t: "maze", level: JSON.parse(L.toJSON(lv)) });
      toast("Room maze set to " + lv.name + ".");
    });
    $("btnLobbyEdit").addEventListener("click", function () {
      $("lobbyPanel").hidden = true;
      MAZE.app.flash("Room " + room.code + " is still open — click the room button to get back.");
    });
    $("btnStartMatch").addEventListener("click", function () {
      if (!room) return;
      if (room.state === "playing") { net().join(room.code, playerName()); return; }   // asks the server to resend our match
      net().send({ t: "start" });
    });
    $("btnLeaveRoom").addEventListener("click", leaveRoom);

    const N = net();
    N.on("room", function (m) {
      room = m;
      $("onlinePanel").hidden = true;
      if (history.replaceState) history.replaceState(null, "", location.pathname + "?room=" + m.code);
      if ($("gameScreen").hidden) showLobby(); else renderLobby();
    });
    N.on("lobby", function (m) {
      if (!room) return;
      Object.assign(room, m);
      renderLobby();
    });
    N.on("start", function (m) {
      $("lobbyPanel").hidden = true;
      $("onlinePanel").hidden = true;
      MAZE.app.startOnline(m);
    });
    N.on("aborted", function () {
      const g = MAZE.app.game();
      if (g && g.online && !$("gameScreen").hidden) {
        if (document.exitPointerLock) document.exitPointerLock();
        MAZE.app.showEditor();
        showLobby();
        toast("The host ended the match.");
      }
    });
    N.on("error", function (m) {
      if (!$("lobbyPanel").hidden) say("lobbyStatus", m.msg, true);
      else if (!$("onlinePanel").hidden) say("onlineMsg", m.msg, true);
      else toast(m.msg);
      if (!room && /No room|full/.test(m.msg)) net().leave();
    });
    N.on("closed", function () {
      if (room) toast("Connection lost — reconnecting…", 3000);
    });

    // invite links: ?room=ABCDE joins, ?maze=CODE opens a shared maze
    const params = new URLSearchParams(location.search);
    const rc = (params.get("room") || "").toUpperCase().replace(/[^A-Z]/g, "");
    const mc = params.get("maze");
    if (mc) openMazeCode(mc, true);
    if (rc.length === 5 && net().available()) {
      openOnline("join");
      $("inpJoinCode").value = rc;
      if ($("inpPlayerName").value) joinRoom(rc);
      else { say("onlineMsg", "Pick a name, then press Join room to get into " + rc + "."); $("inpPlayerName").focus(); }
    }
  }

  MAZE.online = { init: init, showLobby: showLobby, leaveRoom: leaveRoom, resultTable: resultTable, toast: toast };
})();
