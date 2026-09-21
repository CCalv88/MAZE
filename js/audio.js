/* MAZE — all sound is synthesised at runtime with WebAudio. No audio files. */
(function () {
  const MAZE = window.MAZE;
  const A = (MAZE.audio = { ctx: null, master: null, muted: false, ambience: null });

  A.init = function () {
    if (!A.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      A.ctx = new AC();
      A.master = A.ctx.createGain();
      A.master.gain.value = 0.5;
      A.master.connect(A.ctx.destination);
    }
    if (A.ctx.state === "suspended") A.ctx.resume();
    return true;
  };

  function noiseBuffer(dur) {
    const ctx = A.ctx;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // one-shot oscillator with an optional pitch slide
  function tone(o) {
    if (!A.ctx || A.muted) return;
    const ctx = A.ctx, t0 = ctx.currentTime + (o.delay || 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type || "square";
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t0 + o.dur);
    const peak = o.gain == null ? 0.2 : o.gain;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + (o.attack || 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(g); g.connect(A.master);
    osc.start(t0); osc.stop(t0 + o.dur + 0.02);
  }

  // one-shot band-passed noise burst
  function noise(o) {
    if (!A.ctx || A.muted) return;
    const ctx = A.ctx, t0 = ctx.currentTime + (o.delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(o.dur);
    const f = ctx.createBiquadFilter();
    f.type = o.filter || "bandpass";
    f.frequency.setValueAtTime(o.freq || 900, t0);
    if (o.to) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + o.dur);
    f.Q.value = o.q == null ? 1.2 : o.q;
    const g = ctx.createGain();
    const peak = o.gain == null ? 0.2 : o.gain;
    g.gain.setValueAtTime(peak, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    src.connect(f); f.connect(g); g.connect(A.master);
    src.start(t0); src.stop(t0 + o.dur + 0.02);
  }

  const SFX = {
    step()      { noise({ dur: 0.09, freq: 420, to: 190, q: 1.1, gain: 0.07 }); },
    swing()     { noise({ dur: 0.18, freq: 1500, to: 320, q: 0.8, gain: 0.16 }); },
    swordHit()  { noise({ dur: 0.1, freq: 2400, to: 700, q: 2, gain: 0.2 });
                  tone({ freq: 240, to: 90, dur: 0.14, type: "square", gain: 0.16 }); },
    punch()     { tone({ freq: 170, to: 70, dur: 0.11, type: "sine", gain: 0.18 }); },
    bow()       { tone({ freq: 620, to: 180, dur: 0.16, type: "triangle", gain: 0.16 });
                  noise({ dur: 0.12, freq: 1800, to: 500, gain: 0.08 }); },
    arrowHit()  { noise({ dur: 0.07, freq: 3000, to: 900, q: 3, gain: 0.14 }); },
    thud()      { tone({ freq: 120, to: 50, dur: 0.12, type: "sine", gain: 0.14 }); },
    hurtBlob()  { tone({ freq: 330, to: 120, dur: 0.16, type: "sawtooth", gain: 0.13 }); },
    dieBlob()   { tone({ freq: 260, to: 45, dur: 0.42, type: "sawtooth", gain: 0.18 });
                  noise({ dur: 0.38, freq: 900, to: 120, q: 0.6, gain: 0.16 }); },
    growl()     { tone({ freq: 90 + Math.random() * 40, to: 55, dur: 0.5, type: "sawtooth", gain: 0.05 }); },
    windup()    { tone({ freq: 130, to: 340, dur: 0.34, type: "sawtooth", gain: 0.09 }); },
    hurt()      { tone({ freq: 210, to: 80, dur: 0.28, type: "square", gain: 0.2 });
                  noise({ dur: 0.22, freq: 600, to: 150, gain: 0.14 }); },
    block()     { noise({ dur: 0.13, freq: 3200, to: 1400, q: 4, gain: 0.2 });
                  tone({ freq: 880, to: 620, dur: 0.12, type: "triangle", gain: 0.1 }); },
    pickup()    { tone({ freq: 660, dur: 0.09, type: "triangle", gain: 0.16 });
                  tone({ freq: 990, dur: 0.14, type: "triangle", gain: 0.14, delay: 0.07 }); },
    potion()    { [523, 659, 784, 1047].forEach((f, i) =>
                    tone({ freq: f, dur: 0.16, type: "sine", gain: 0.13, delay: i * 0.055 })); },
    weapon()    { tone({ freq: 440, to: 880, dur: 0.14, type: "square", gain: 0.12 }); },
    noAmmo()    { tone({ freq: 200, to: 150, dur: 0.09, type: "square", gain: 0.1 }); },
    door()      { tone({ freq: 90, to: 60, dur: 0.4, type: "sine", gain: 0.2 });
                  noise({ dur: 0.55, freq: 380, to: 160, q: 3, gain: 0.12 }); },
    locked()    { tone({ freq: 150, to: 130, dur: 0.1, type: "square", gain: 0.14 });
                  tone({ freq: 140, to: 120, dur: 0.1, type: "square", gain: 0.12, delay: 0.12 }); },
    secret()    { [784, 1047, 1319, 1568].forEach((f, i) =>
                    tone({ freq: f, dur: 0.3, type: "sine", gain: 0.1, delay: i * 0.07 })); },
    win()       { [523, 659, 784, 1047, 1319].forEach((f, i) =>
                    tone({ freq: f, dur: 0.5, type: "triangle", gain: 0.18, delay: i * 0.13 })); },
    lose()      { [392, 330, 262, 196].forEach((f, i) =>
                    tone({ freq: f, dur: 0.6, type: "sawtooth", gain: 0.16, delay: i * 0.18 })); }
  };

  A.play = function (name) {
    if (!A.ctx || A.muted) return;
    const fn = SFX[name];
    if (fn) { try { fn(); } catch (e) { /* audio must never break the game loop */ } }
  };

  // low dungeon drone, started when a run begins
  A.startAmbience = function () {
    if (!A.ctx || A.ambience) return;
    try {
      const ctx = A.ctx;
      const g = ctx.createGain();
      g.gain.value = 0.0;
      g.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 2);
      const o1 = ctx.createOscillator(); o1.type = "sine"; o1.frequency.value = 52;
      const o2 = ctx.createOscillator(); o2.type = "sine"; o2.frequency.value = 78.4;
      const lfo = ctx.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 0.07;
      const lg = ctx.createGain(); lg.gain.value = 6;
      lfo.connect(lg); lg.connect(o2.frequency);
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(4); src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 220;
      const ng = ctx.createGain(); ng.gain.value = 0.035;
      src.connect(f); f.connect(ng); ng.connect(g);
      o1.connect(g); o2.connect(g); g.connect(A.master);
      o1.start(); o2.start(); lfo.start(); src.start();
      A.ambience = { nodes: [o1, o2, lfo, src], gain: g };
    } catch (e) { A.ambience = null; }
  };

  A.stopAmbience = function () {
    if (!A.ambience) return;
    try {
      const t = A.ctx.currentTime;
      A.ambience.gain.gain.cancelScheduledValues(t);
      A.ambience.gain.gain.setValueAtTime(A.ambience.gain.gain.value, t);
      A.ambience.gain.gain.linearRampToValueAtTime(0.0001, t + 0.4);
      A.ambience.nodes.forEach((n) => { try { n.stop(t + 0.5); } catch (e) {} });
    } catch (e) {}
    A.ambience = null;
  };
})();
