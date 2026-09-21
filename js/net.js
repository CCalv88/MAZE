/* MAZE — room code client: one WebSocket to ./ws on the same origin, the same protocol
   shape as 9-5, Sima and White Room. Create or join with a persistent player id, then
   typed JSON messages. Reconnects and rejoins the room by itself. */
(function () {
  const MAZE = window.MAZE;
  const PID = (function () {
    try {
      let p = localStorage.getItem("maze-pid");
      if (!p) { p = Math.random().toString(36).slice(2, 12); localStorage.setItem("maze-pid", p); }
      return p;
    } catch (e) { return Math.random().toString(36).slice(2, 12); }
  })();

  const S = { ws: null, code: null, seat: null, host: false, room: null, online: false, name: "", reconnectTimer: null, handlers: {}, lastError: "" };

  // online play needs the hosted page (or `node server.js` locally), not a double-clicked file
  const available = () => location.protocol === "http:" || location.protocol === "https:";
  const base = () => location.pathname.replace(/[^/]*$/, "");
  const wsUrl = () => (location.protocol === "https:" ? "wss://" : "ws://") + location.host + base() + "ws";

  function on(type, fn) {
    (S.handlers[type] = S.handlers[type] || []).push(fn);
    return function () { const l = S.handlers[type]; const i = l ? l.indexOf(fn) : -1; if (i >= 0) l.splice(i, 1); };
  }
  function emit(m) {
    for (const fn of (S.handlers[m.t] || []).slice()) { try { fn(m); } catch (e) { console.error("handler", m.t, e); } }
  }
  function send(m) {
    if (!S.ws || S.ws.readyState !== 1) return false;
    if (m.t === "pos" && S.ws.bufferedAmount > 16384) return false;
    S.ws.send(JSON.stringify(m));
    return true;
  }
  function connect() {
    return new Promise(function (resolve, reject) {
      if (!available()) return reject(new Error("Online play needs the hosted page."));
      if (S.ws && S.ws.readyState === 1) return resolve();
      let ws;
      try { ws = new WebSocket(wsUrl()); } catch (e) { return reject(e); }
      S.ws = ws;
      ws.onopen = function () { S.online = true; resolve(); };
      ws.onerror = function () { reject(new Error("Could not reach the MAZE server.")); };
      ws.onmessage = function (e) {
        let m; try { m = JSON.parse(e.data); } catch (err) { return; }
        if (!m || typeof m.t !== "string") return;
        if (m.t === "room") { S.code = m.code; S.seat = m.seat; S.host = m.host; S.room = m; }
        else if (m.t === "lobby" && S.room) { Object.assign(S.room, m, { t: "room" }); S.host = m.hostSeat === S.seat; }
        else if (m.t === "error") S.lastError = m.msg;
        emit(m);
      };
      ws.onclose = function () {
        if (S.ws !== ws) return;
        S.ws = null; S.online = false;
        emit({ t: "closed" });
        if (S.code) S.reconnectTimer = setTimeout(rejoin, 2000);
      };
    });
  }
  function rejoin() {
    if (!S.code) return;
    connect().then(function () { send({ t: "join", code: S.code, pid: PID, name: S.name }); })
      .catch(function () { S.reconnectTimer = setTimeout(rejoin, 3000); });
  }
  function create(name, level, mode) {
    S.name = name;
    return connect().then(function () { send({ t: "create", pid: PID, name: name, level: level, mode: mode }); });
  }
  function join(code, name) {
    S.name = name;
    return connect().then(function () { send({ t: "join", code: code, pid: PID, name: name }); });
  }
  function leave() {
    clearTimeout(S.reconnectTimer);
    if (S.ws) { try { send({ t: "leave" }); S.ws.onclose = null; S.ws.close(); } catch (e) { /* already gone */ } }
    S.ws = null; S.code = null; S.seat = null; S.host = false; S.room = null; S.online = false;
  }
  setInterval(function () { send({ t: "hb" }); }, 25000);

  // publish a maze without starting a room, so its code can be shared; returns { code }
  function publish(levelJSON) {
    return fetch(base() + "m", { method: "POST", headers: { "Content-Type": "application/json" }, body: levelJSON })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "Could not share the maze."); return j; }); });
  }
  function fetchMaze(code) {
    return fetch(base() + "m/" + encodeURIComponent(code))
      .then(function (r) { if (!r.ok) throw new Error(r.status === 404 ? "No maze has the code " + code + "." : "Could not load that maze."); return r.json(); });
  }

  MAZE.net = { S: S, PID: PID, on: on, send: send, connect: connect, create: create, join: join, leave: leave, publish: publish, fetchMaze: fetchMaze, available: available, wsUrl: wsUrl };
})();
