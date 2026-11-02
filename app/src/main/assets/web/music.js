// Música y sonidos del juego, generados en el momento con Web Audio: no hay archivos de audio,
// no hay derechos de autor de por medio y funciona sin internet.
//
// Cada pantalla tiene su pista en bucle: sala (esperando), pregunta (pensando), resultado (tranqui)
// y final (celebración). Además hay sonidos cortos: inicio de pregunta, respuesta enviada, acierto,
// casi, error, sin respuesta, cuenta regresiva de los últimos 5 segundos y fanfarria del podio.
//
// Uso desde app.js: Sound.setEnabled(bool), Sound.play('pregunta', { after: 'go' }), Sound.sfx('sent'),
// Sound.tick(segundosQueQuedan). Sound.render(...) dibuja una pista sin parlantes (para pruebas).
(function () {
  'use strict';

  var AC = window.AudioContext || window.webkitAudioContext;
  var MUSIC_LEVEL = 0.6;

  function hz(n) { return 440 * Math.pow(2, (n - 69) / 12); }
  function stepDur(bpm) { return 60 / bpm / 4; } // una semicorchea

  // ------------------------------------------------------------------ motor de sonido

  function Engine(ctx) {
    this.ctx = ctx;
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    comp.connect(ctx.destination);

    // Los parlantes de celular no dan graves por debajo de ~110 Hz: quitarlos deja más volumen útil.
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 110;
    hp.Q.value = 0.6;
    hp.connect(comp);
    this.master = ctx.createGain();
    this.master.connect(hp);
    this.music = ctx.createGain();
    this.music.gain.value = MUSIC_LEVEL;
    this.music.connect(this.master);
    this.fx = ctx.createGain();
    this.fx.gain.value = 0.8;
    this.fx.connect(this.master);

    // Eco suave compartido (va a tempo con la pista que suena).
    this.echo = ctx.createGain();
    this.delay = ctx.createDelay(1.0);
    this.delay.delayTime.value = 0.27;
    var fb = ctx.createGain();
    fb.gain.value = 0.3;
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    var wet = ctx.createGain();
    wet.gain.value = 0.25;
    this.echo.connect(this.delay);
    this.delay.connect(lp);
    lp.connect(fb);
    fb.connect(this.delay);
    lp.connect(wet);
    wet.connect(this.master);

    // Ruido blanco (para la batería), con semilla fija: suena igual cada vez.
    var len = ctx.sampleRate;
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    var seed = 7;
    for (var i = 0; i < len; i++) {
      seed = (seed * 16807) % 2147483647;
      data[i] = seed / 1073741823.5 - 1;
    }
    this.noiseBuf = buf;
  }

  Engine.prototype.setEcho = function (seconds) {
    this.delay.delayTime.setValueAtTime(Math.min(0.9, seconds), this.ctx.currentTime);
  };

  // Una nota: oscilador → (filtro) → envolvente. o = { type, f, t, dur, vol, a, d, s, r, cutoff, ... }
  Engine.prototype.voice = function (dest, o) {
    var ctx = this.ctx, t = o.t, peak = o.vol;
    if (!(peak > 0)) return;
    var osc = ctx.createOscillator();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + (o.glide || o.dur));
    if (o.detune) osc.detune.setValueAtTime(o.detune, t);
    var node = osc;
    if (o.cutoff) {
      var flt = ctx.createBiquadFilter();
      flt.type = 'lowpass';
      flt.frequency.setValueAtTime(o.cutoff, t);
      flt.Q.value = o.q || 0.8;
      osc.connect(flt);
      node = flt;
    }
    var g = ctx.createGain();
    var a = o.a || 0.004, sus = o.s == null ? 0.5 : o.s, dec = o.d || 0.12, rel = o.r || 0.05;
    var off = t + Math.max(o.dur, a);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setTargetAtTime(peak * sus, t + a, dec);
    g.gain.setTargetAtTime(0, off, rel);
    node.connect(g);
    g.connect(dest);
    if (o.send) {
      var sg = ctx.createGain();
      sg.gain.value = o.send;
      g.connect(sg);
      sg.connect(this.echo);
    }
    if (o.vib) {
      var lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = o.vibRate || 5.5;
      lg.gain.setValueAtTime(0, t);
      lg.gain.linearRampToValueAtTime(o.vib, t + Math.min(0.3, o.dur));
      lfo.connect(lg);
      lg.connect(osc.detune);
      lfo.start(t);
      lfo.stop(off + rel * 6 + 0.05);
    }
    osc.start(t);
    osc.stop(off + rel * 6 + 0.02);
  };

  Engine.prototype.noise = function (dest, t, dur, vol, type, freq, q) {
    var ctx = this.ctx, src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    var f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q || 0.7;
    var g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(t, (t * 7.919) % 0.8, dur + 0.02);
  };

  // --- instrumentos

  Engine.prototype.bass = function (bus, n, t, dur, v) {
    this.voice(bus, { type: 'triangle', f: hz(n), t: t, dur: dur, vol: 0.34 * v, s: 0.55, d: 0.12, r: 0.04 });
    // Armónicos para que el bajo se oiga en el parlante pequeño del celular.
    this.voice(bus, { type: 'sawtooth', f: hz(n), t: t, dur: dur, vol: 0.13 * v, cutoff: 1100, s: 0.4, d: 0.1, r: 0.04 });
  };
  Engine.prototype.pluck = function (bus, n, t, dur, v, send) {
    this.voice(bus, { type: 'square', f: hz(n), t: t, dur: dur, vol: v, cutoff: 2800, s: 0, d: Math.max(0.05, dur * 0.4), r: 0.03, send: send || 0 });
  };
  Engine.prototype.lead = function (bus, n, t, dur, v) {
    this.voice(bus, { type: 'square', f: hz(n), t: t, dur: dur, vol: v * 0.7, cutoff: 4200, a: 0.01, s: 0.65, d: 0.15, r: 0.06, vib: dur > 0.35 ? 12 : 0, send: 0.35 });
    this.voice(bus, { type: 'triangle', f: hz(n + 12), t: t, dur: dur, vol: v * 0.25, a: 0.01, s: 0.5, d: 0.2, r: 0.06 });
  };
  Engine.prototype.pad = function (bus, n, t, dur, v) {
    this.voice(bus, { type: 'sawtooth', f: hz(n), t: t, dur: dur, vol: v, cutoff: 1100, a: 0.25, s: 0.9, d: 0.4, r: 0.35, detune: -7 });
    this.voice(bus, { type: 'sawtooth', f: hz(n), t: t, dur: dur, vol: v, cutoff: 1100, a: 0.25, s: 0.9, d: 0.4, r: 0.35, detune: 7 });
  };
  Engine.prototype.keys = function (bus, n, t, dur, v) {
    this.voice(bus, { type: 'triangle', f: hz(n), t: t, dur: dur, vol: v, a: 0.006, s: 0.35, d: 0.35, r: 0.15, send: 0.2 });
    this.voice(bus, { type: 'square', f: hz(n + 12), t: t, dur: dur * 0.5, vol: v * 0.22, cutoff: 3000, s: 0, d: 0.14, r: 0.08 });
  };
  Engine.prototype.brass = function (bus, n, t, dur, v, send) {
    this.voice(bus, { type: 'sawtooth', f: hz(n), t: t, dur: dur, vol: v, cutoff: 2300, a: 0.025, s: 0.75, d: 0.15, r: 0.08, send: send || 0.15 });
  };
  Engine.prototype.bell = function (bus, n, t, dur, v) {
    this.voice(bus, { type: 'sine', f: hz(n), t: t, dur: dur, vol: v, a: 0.003, s: 0, d: dur * 0.6 + 0.05, r: 0.2, send: 0.3 });
    this.voice(bus, { type: 'sine', f: hz(n) * 3.01, t: t, dur: dur * 0.4, vol: v * 0.25, a: 0.002, s: 0, d: 0.08, r: 0.1 });
  };
  Engine.prototype.kick = function (bus, t, v) {
    var ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(62, t + 0.09);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.7 * v, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.26);
    o.connect(g);
    g.connect(bus);
    o.start(t);
    o.stop(t + 0.34);
    this.noise(bus, t, 0.025, 0.2 * v, 'bandpass', 1800, 0.7); // golpecito audible en parlantes pequeños
  };
  Engine.prototype.clap = function (bus, t, v) {
    this.noise(bus, t, 0.16, 0.5 * v, 'bandpass', 1300, 0.9);
    this.noise(bus, t + 0.012, 0.12, 0.35 * v, 'bandpass', 2000, 0.9);
  };
  Engine.prototype.hat = function (bus, t, v, open) {
    this.noise(bus, t, open ? 0.18 : 0.04, 0.28 * v, 'highpass', 7500);
  };

  // ------------------------------------------------------------------ pistas
  // Notas MIDI (60 = do central). Melodías: [paso, nota, duración en semicorcheas].

  var BOUNCE = [[0, 0, 3, 1], [3, 0, 1, 0.6], [6, 12, 2, 0.8], [8, 0, 3, 1], [11, 7, 1, 0.6], [14, 12, 2, 0.7]];

  function bounceBass(e, bus, root, t, s) {
    BOUNCE.forEach(function (b) { e.bass(bus, root + b[1], t + b[0] * s, b[2] * s * 0.9, b[3]); });
  }
  function melody(e, bus, notes, t, s, v) {
    notes.forEach(function (m) { e.lead(bus, m[1], t + m[0] * s, m[2] * s * 0.92, v); });
  }

  var TRACKS = {
    // Sala de espera: pop alegre en do mayor (I–vi–IV–V). La melodía va y viene cada 8 compases.
    sala: {
      bpm: 104,
      bars: 8,
      h: [{ r: 48, c: [60, 64, 67] }, { r: 45, c: [60, 64, 69] }, { r: 41, c: [60, 65, 69] }, { r: 43, c: [59, 62, 67] }],
      mel: [
        [[0, 72, 2], [2, 76, 2], [4, 79, 3], [7, 76, 1], [8, 74, 2], [10, 72, 2], [12, 74, 4]],
        [[0, 76, 3], [3, 72, 1], [4, 69, 4], [8, 72, 2], [10, 74, 2], [12, 76, 4]],
        [[0, 77, 2], [2, 76, 2], [4, 74, 2], [6, 72, 2], [8, 69, 4], [12, 72, 4]],
        [[0, 74, 6], [6, 71, 2], [8, 67, 6]],
        [[0, 79, 2], [2, 79, 2], [4, 76, 2], [6, 79, 2], [8, 81, 4], [12, 79, 4]],
        [[0, 76, 4], [4, 72, 2], [6, 76, 2], [8, 74, 8]],
        [[0, 77, 2], [2, 77, 2], [4, 76, 2], [6, 74, 2], [8, 72, 2], [10, 74, 2], [12, 76, 4]],
        [[0, 74, 4], [4, 71, 2], [6, 74, 2], [8, 72, 8]]
      ],
      bar: function (e, bus, i, cycle, t, s) {
        var h = this.h[i % 4], k;
        bounceBass(e, bus, h.r, t, s);
        [2, 6, 10, 14].forEach(function (k) {
          h.c.forEach(function (n) { e.pluck(bus, n, t + k * s, s * 1.3, 0.055, 0.12); });
        });
        e.kick(bus, t, 0.9);
        e.kick(bus, t + 8 * s, 0.75);
        if (i % 2) e.kick(bus, t + 10 * s, 0.4);
        e.clap(bus, t + 4 * s, 0.32);
        e.clap(bus, t + 12 * s, 0.32);
        for (k = 2; k < 16; k += 4) e.hat(bus, t + k * s, 0.6);
        if (cycle % 2 === 0) melody(e, bus, this.mel[i], t, s, 0.15);
        else h.c.forEach(function (n) { e.pad(bus, n, t, 16 * s, 0.022); });
      }
    },

    // Pregunta: pulso de "pensando" en la menor (i–VI–VII–V), arpegio rápido y bombo constante.
    pregunta: {
      bpm: 126,
      bars: 4,
      h: [{ r: 45, a: [57, 60, 64, 69] }, { r: 41, a: [57, 60, 65, 69] }, { r: 43, a: [55, 59, 62, 67] }, { r: 40, a: [56, 59, 64, 68] }],
      arp: [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 2, 3, 2, 1],
      counter: [[[0, 69, 16]], [[0, 69, 8], [8, 72, 8]], [[0, 71, 16]], [[0, 68, 8], [8, 71, 8]]],
      bar: function (e, bus, i, cycle, t, s) {
        var h = this.h[i], arp = this.arp, k;
        for (k = 0; k < 16; k += 2) e.bass(bus, h.r + (k % 4 === 2 ? 12 : 0), t + k * s, s * 1.5, k % 4 === 0 ? 0.9 : 0.6);
        for (k = 0; k < 16; k++) e.pluck(bus, h.a[arp[k]] + 12, t + k * s, s * 0.85, k % 4 === 0 ? 0.078 : 0.056, 0.15);
        h.a.slice(0, 3).forEach(function (n) { e.pad(bus, n, t, 16 * s, 0.018); });
        for (k = 0; k < 16; k += 4) e.kick(bus, t + k * s, 0.85);
        e.clap(bus, t + 4 * s, 0.3);
        e.clap(bus, t + 12 * s, 0.3);
        for (k = 0; k < 16; k++) e.hat(bus, t + k * s, k % 4 === 2 ? 0.7 : 0.35);
        if (i === 3) {
          e.clap(bus, t + 14 * s, 0.18);
          e.clap(bus, t + 15 * s, 0.24);
        }
        if (cycle % 2 === 1) melody(e, bus, this.counter[i], t, s, 0.09);
      }
    },

    // Resultado: groove tranquilo (IV–V–iii–vi) con piano eléctrico, para leer los puntajes.
    resultado: {
      bpm: 92,
      bars: 4,
      h: [{ r: 41, c: [57, 60, 64] }, { r: 43, c: [59, 62, 67] }, { r: 40, c: [55, 59, 64] }, { r: 45, c: [57, 60, 64] }],
      top: [76, 74, 71, 72],
      bar: function (e, bus, i, cycle, t, s) {
        var h = this.h[i], k;
        e.bass(bus, h.r, t, 7 * s, 0.65);
        e.bass(bus, h.r, t + 8 * s, 3.5 * s, 0.5);
        e.bass(bus, h.r + 7, t + 12 * s, 3.5 * s, 0.42);
        h.c.forEach(function (n) {
          e.keys(bus, n, t, 6 * s, 0.062);
          e.keys(bus, n, t + 6 * s, 2 * s, 0.044);
          e.keys(bus, n, t + 10 * s, 5 * s, 0.055);
        });
        e.kick(bus, t, 0.6);
        e.kick(bus, t + 10 * s, 0.4);
        e.clap(bus, t + 8 * s, 0.16);
        for (k = 0; k < 16; k += 2) e.hat(bus, t + k * s, k % 4 === 2 ? 0.4 : 0.22);
        if (cycle % 2 === 1) e.bell(bus, this.top[i], t, 8 * s, 0.06);
      }
    },

    // Podio: celebración con metales y melodía brillante en do mayor.
    final: {
      bpm: 120,
      bars: 8,
      h: [{ r: 48, c: [60, 64, 67] }, { r: 41, c: [60, 65, 69] }, { r: 43, c: [59, 62, 67] }, { r: 48, c: [60, 64, 67] },
        { r: 45, c: [60, 64, 69] }, { r: 41, c: [60, 65, 69] }, { r: 43, c: [59, 62, 67] }, { r: 48, c: [60, 64, 67] }],
      mel: [
        [[0, 72, 2], [2, 76, 2], [4, 79, 4], [8, 84, 6], [14, 79, 2]],
        [[0, 81, 4], [4, 77, 2], [6, 81, 2], [8, 84, 4], [12, 81, 4]],
        [[0, 79, 4], [4, 83, 2], [6, 79, 2], [8, 86, 6], [14, 83, 2]],
        [[0, 84, 8], [8, 79, 4], [12, 76, 4]],
        [[0, 76, 2], [2, 77, 2], [4, 79, 4], [8, 81, 4], [12, 79, 4]],
        [[0, 77, 4], [4, 76, 2], [6, 74, 2], [8, 72, 4], [12, 74, 4]],
        [[0, 74, 2], [2, 76, 2], [4, 77, 2], [6, 79, 2], [8, 83, 4], [12, 86, 4]],
        [[0, 84, 12]]
      ],
      bar: function (e, bus, i, cycle, t, s) {
        var h = this.h[i], k;
        bounceBass(e, bus, h.r, t, s);
        [[0, 2], [3, 1], [6, 2], [10, 2]].forEach(function (st) {
          h.c.forEach(function (n) { e.brass(bus, n, t + st[0] * s, st[1] * s, 0.045); });
        });
        for (k = 0; k < 16; k += 4) e.kick(bus, t + k * s, 0.85);
        e.clap(bus, t + 4 * s, 0.34);
        e.clap(bus, t + 12 * s, 0.34);
        for (k = 2; k < 16; k += 4) e.hat(bus, t + k * s, 0.55, true);
        melody(e, bus, this.mel[i], t, s, 0.14);
      }
    }
  };

  // ------------------------------------------------------------------ sonidos cortos (devuelven su duración)

  var SFX = {
    go: function (e, b, t) {
      e.bell(b, 76, t, 0.12, 0.2);
      e.bell(b, 81, t + 0.1, 0.4, 0.26);
      return 0.5;
    },
    sent: function (e, b, t) {
      e.voice(b, { type: 'sine', f: 660, f2: 990, glide: 0.07, t: t, dur: 0.08, vol: 0.2, s: 0, d: 0.05, r: 0.03 });
      return 0.1;
    },
    correct: function (e, b, t) {
      [72, 76, 79].forEach(function (n, k) { e.pluck(b, n, t + k * 0.08, 0.1, 0.16, 0.2); });
      e.bell(b, 84, t + 0.24, 0.6, 0.26);
      [60, 64, 67].forEach(function (n) { e.keys(b, n, t + 0.24, 0.6, 0.08); });
      return 0.9;
    },
    partial: function (e, b, t) {
      e.bell(b, 79, t, 0.1, 0.18);
      e.bell(b, 76, t + 0.12, 0.1, 0.16);
      e.bell(b, 79, t + 0.24, 0.4, 0.2);
      return 0.7;
    },
    wrong: function (e, b, t) {
      [67, 66, 65].forEach(function (n, k) {
        e.voice(b, { type: 'sawtooth', f: hz(n), t: t + k * 0.3, dur: 0.24, vol: 0.18, cutoff: 1100, a: 0.02, s: 0.8, d: 0.1, r: 0.05 });
      });
      e.voice(b, { type: 'sawtooth', f: hz(64), t: t + 0.9, dur: 0.8, vol: 0.18, cutoff: 1100, a: 0.02, s: 0.85, d: 0.2, r: 0.15, vib: 35, vibRate: 6 });
      return 1.6;
    },
    none: function (e, b, t) {
      e.bell(b, 64, t, 0.15, 0.14);
      e.bell(b, 60, t + 0.18, 0.4, 0.14);
      return 0.6;
    },
    fanfare: function (e, b, t) {
      [0, 0.15, 0.3].forEach(function (d) { e.brass(b, 67, t + d, 0.11, 0.14, 0.1); });
      [60, 64, 67, 72].forEach(function (n) { e.brass(b, n, t + 0.45, 0.75, 0.08, 0.25); });
      e.hat(b, t + 0.45, 1.2, true);
      return 1.35;
    }
  };

  // ------------------------------------------------------------------ reproductor en tiempo real

  var ctx = null, eng = null;
  var enabled = false;
  var want = null;     // pista que corresponde a la pantalla actual
  var cur = null;      // { name, tr, bus, i, cycle, next }
  var timer = null, suspendTimer = null;

  function ensure() {
    if (eng) return true;
    if (!AC) return false;
    try {
      ctx = new AC();
      eng = new Engine(ctx);
    } catch (e) {
      ctx = eng = null;
      return false;
    }
    return true;
  }

  function resume() {
    if (!ctx || !enabled || document.hidden || ctx.state === 'running') return;
    try {
      var p = ctx.resume();
      if (p && p.catch) p.catch(function () { });
    } catch (e) { }
  }

  function startTrack(name, at) {
    var tr = TRACKS[name];
    var bus = ctx.createGain();
    bus.gain.setValueAtTime(0, at);
    bus.gain.linearRampToValueAtTime(1, at + 0.25);
    bus.connect(eng.music);
    eng.setEcho(3 * stepDur(tr.bpm));
    cur = { name: name, tr: tr, bus: bus, i: 0, cycle: 0, next: at };
    pump();
  }

  function stopTrack(fade) {
    if (!cur) return;
    var b = cur.bus, now = ctx.currentTime;
    b.gain.cancelScheduledValues(now);
    b.gain.setValueAtTime(b.gain.value, now);
    b.gain.linearRampToValueAtTime(0, now + (fade || 0.35));
    // Las notas ya programadas siguen, pero en silencio; luego se desconecta todo.
    setTimeout(function () { try { b.disconnect(); } catch (e) { } }, 4000);
    cur = null;
  }

  // Programa los compases que empiezan pronto (un poco por adelantado, para que no haya cortes).
  function pump() {
    if (!cur || !ctx || ctx.state !== 'running') return;
    var now = ctx.currentTime;
    if (cur.next < now - 0.05) cur.next = now + 0.05; // si el teléfono se atrasó, seguimos sin amontonar notas
    while (cur.next < now + 0.3) {
      var s = stepDur(cur.tr.bpm);
      cur.tr.bar(eng, cur.bus, cur.i, cur.cycle, cur.next, s);
      cur.next += 16 * s;
      if (++cur.i >= cur.tr.bars) {
        cur.i = 0;
        cur.cycle++;
      }
    }
  }

  function apply(delay) {
    if (!enabled || !eng) return;
    if (cur && cur.name === want) return;
    stopTrack();
    if (want && TRACKS[want]) startTrack(want, ctx.currentTime + 0.08 + (delay || 0));
  }

  function setEnabled(on) {
    on = !!on;
    if (on === enabled) return;
    enabled = on;
    if (on) {
      if (!ensure()) {
        enabled = false;
        return;
      }
      clearTimeout(suspendTimer);
      resume();
      eng.master.gain.cancelScheduledValues(ctx.currentTime);
      eng.master.gain.setTargetAtTime(1, ctx.currentTime, 0.05);
      if (!timer) timer = setInterval(pump, 60);
      apply();
    } else if (eng) {
      eng.master.gain.cancelScheduledValues(ctx.currentTime);
      eng.master.gain.setTargetAtTime(0, ctx.currentTime, 0.06);
      stopTrack(0.2);
      clearInterval(timer);
      timer = null;
      clearTimeout(suspendTimer);
      suspendTimer = setTimeout(function () {
        if (!enabled && ctx.state === 'running') ctx.suspend();
      }, 500);
    }
  }

  function duck(t, dur) {
    var g = eng.music.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(MUSIC_LEVEL * 0.3, t, 0.03);
    g.setTargetAtTime(MUSIC_LEVEL, t + dur, 0.3);
  }

  function sfx(name) {
    if (!enabled || !eng || !SFX[name]) return 0;
    var t = ctx.currentTime + 0.03;
    var dur = SFX[name](eng, eng.fx, t);
    if (dur > 0.2) duck(t, dur);
    return dur;
  }

  // Cambia a la pista de la pantalla. opts.after: sonido corto que suena antes (p. ej. 'correct').
  function play(name, opts) {
    want = name || null;
    var d = opts && opts.after ? sfx(opts.after) : 0;
    if (!cur || cur.name !== want) apply(d > 0.3 ? d : 0);
  }

  // Cuenta regresiva: un "tic" por segundo en los últimos 5 (más agudo en los últimos 3).
  function tick(sec) {
    if (!enabled || !eng) return;
    var t = ctx.currentTime + 0.01;
    eng.voice(eng.fx, { type: 'sine', f: sec <= 3 ? 1568 : 1175, t: t, dur: 0.05, vol: sec <= 3 ? 0.22 : 0.15, s: 0, d: 0.03, r: 0.02 });
    eng.noise(eng.fx, t, 0.015, 0.08, 'highpass', 4000);
  }

  // Dibuja una pista o un sonido sin reproducirlo ('sala', 'sfx:correct', ...). Para pruebas.
  function render(name, seconds, sampleRate) {
    var OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    var sr = sampleRate || 22050;
    var oc = new OC(1, Math.ceil(sr * seconds), sr);
    var e = new Engine(oc);
    if (name.indexOf('sfx:') === 0) {
      SFX[name.slice(4)](e, e.fx, 0.05);
    } else {
      var tr = TRACKS[name], s = stepDur(tr.bpm), t = 0.05, i = 0, cycle = 0;
      var bus = oc.createGain();
      bus.connect(e.music);
      e.delay.delayTime.value = Math.min(0.9, 3 * s);
      while (t < seconds) {
        tr.bar(e, bus, i, cycle, t, s);
        t += 16 * s;
        if (++i >= tr.bars) {
          i = 0;
          cycle++;
        }
      }
    }
    return oc.startRendering().then(function (buf) { return buf.getChannelData(0); });
  }

  // El navegador puede exigir un toque antes de sonar; en la app no hace falta.
  ['pointerdown', 'touchstart', 'keydown'].forEach(function (ev) { document.addEventListener(ev, resume, true); });
  // Al salir de la app o apagar la pantalla, la música se pausa y luego sigue donde iba.
  document.addEventListener('visibilitychange', function () {
    if (!ctx) return;
    if (document.hidden) {
      if (ctx.state === 'running') ctx.suspend();
    } else {
      resume();
    }
  });

  window.Sound = {
    setEnabled: setEnabled,
    play: play,
    sfx: sfx,
    tick: tick,
    render: render,
    tracks: Object.keys(TRACKS),
    effects: Object.keys(SFX),
    state: function () {
      return { enabled: enabled, want: want, track: cur ? cur.name : null, ctx: ctx ? ctx.state : null };
    }
  };
})();
