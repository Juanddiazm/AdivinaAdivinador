(function () {
  'use strict';

  var app = document.getElementById('app');
  var inApp = !!window.AndroidBridge;
  var hash = parseHash();
  var pid = store('aa_pid') || '';
  var st = null;          // último estado recibido
  var lastV = -1;         // versión ya pintada
  var screenKey = '';     // qué pantalla está construida
  var deadline = 0;       // fin de la ronda en el reloj local
  var pollTimer = null;
  var failCount = 0;
  var cfg = null;         // ajustes locales del anfitrión
  var settingsTimer = null;
  var prevRanks = {};     // posiciones antes de esta ronda (para la flecha de "subió")
  var lastRanks = {};

  var TOLERANCE = [
    { v: 0, name: 'Estricto', desc: 'Solo se perdona un error de dedo en palabras largas.' },
    { v: 1, name: 'Normal', desc: '«Olombia» o «Colonbia» por Colombia se llevan buena parte de los puntos.' },
    { v: 2, name: 'Generoso', desc: 'Casi todo lo que se parezca suma algo. Ideal para niños.' }
  ];
  var MODES = [
    { v: 'write', name: 'Escribir', icon: 'pencil', desc: 'Cada uno escribe la respuesta. Con errores de ortografía se gana una parte.' },
    { v: 'choice', name: 'Opciones', icon: 'grid', desc: 'Se elige entre 4 opciones. Más rápido y fácil, ideal para niños.' }
  ];
  var ROUNDS = [5, 10, 15, 20, 30];
  var SECONDS = [10, 15, 20, 25, 30, 45, 60];
  var AVATAR_COLORS = ['#5B3DF5', '#138A55', '#D63A4E', '#2463EB', '#8A4B00', '#0E7490', '#A21CAF', '#1A1433'];
  var STAR = '<svg class="ic s" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/></svg>';

  // ------------------------------------------------------------------ utilidades

  function $(sel) { return document.querySelector(sel); }

  function store(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
    } catch (e) { return null; }
  }

  function parseHash() {
    var o = {};
    location.hash.replace(/^#/, '').split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) o[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
    });
    return o;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function api(path, body) {
    var opts = { cache: 'no-store' };
    if (body) {
      body.pid = pid;
      opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    }
    return fetch('/api/' + path, opts).then(function (r) { return r.json(); });
  }

  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'show';
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { t.className = ''; }, 2600);
  }

  function colorFor(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 9973;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
  }

  function avatar(p, extraClass, check) {
    var letter = (Array.from(p.name)[0] || '?').toUpperCase();
    return '<span class="avatar' + (extraClass ? ' ' + extraClass : '') + '" style="background:' + colorFor(p.name) + '">' + esc(letter) +
      (check ? '<span class="chk">' + icon('check') + '</span>' : '') + '</span>';
  }

  function catIcon(id, emoji) { return window.hasIcon(id) ? icon(id) : esc(emoji || ''); }
  function accClass(acc) { return acc >= 1 ? 'full' : acc > 0 ? 'part' : 'none'; }
  function accColor(acc) { return acc >= 1 ? 'var(--green)' : acc > 0 ? 'var(--sun)' : 'var(--coral)'; }
  function pct(acc) { return Math.round(acc * 100) + '%'; }
  function modeOf(mode) { return mode === 'choice' ? MODES[1] : MODES[0]; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  function vibrate(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { } }

  // ------------------------------------------------------------------ arranque y sondeo

  function boot() {
    var first = pid ? api('state?pid=' + encodeURIComponent(pid)) : Promise.resolve({ error: 'unknown' });
    first.then(function (s) {
      if (!s.error) { onState(s); schedulePoll(); return; }
      forget();
      if (hash.name) join(hash.name, hash.host); else renderJoin();
    }).catch(function () {
      setOffline(true);
      setTimeout(boot, 1500);
    });
  }

  function forget() { pid = ''; store('aa_pid', null); }

  function join(name, hostKey) {
    api('join', { name: name, hostKey: hostKey || '' }).then(function (r) {
      if (r.error) { renderJoin(r.error); return; }
      pid = r.pid;
      store('aa_pid', pid);
      store('aa_name', r.name);
      if (history.replaceState) history.replaceState(null, '', location.pathname);
      poll();
    }).catch(function () { renderJoin('No se pudo conectar con el anfitrión.'); });
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(poll, 700);
  }

  function poll() {
    clearTimeout(pollTimer);
    if (!pid) return;
    api('state?pid=' + encodeURIComponent(pid)).then(function (s) {
      failCount = 0;
      setOffline(false);
      if (s.error === 'unknown') {
        forget();
        screenKey = '';
        renderJoin('Ya no estás en la partida (saliste o el anfitrión te sacó). Puedes volver a entrar.');
        return;
      }
      onState(s);
      schedulePoll();
    }).catch(function () {
      failCount++;
      if (failCount > 2) setOffline(true);
      schedulePoll();
    });
  }

  function setOffline(on) {
    var o = $('#offline');
    if (on === !o.hidden) return;
    o.hidden = !on;
    if (on) {
      o.innerHTML = 'Se perdió la conexión con el anfitrión. Reintentando…' +
        (inApp ? ' <button class="pill-btn" id="offHome">Ir al inicio</button>' : '');
      var b = $('#offHome');
      if (b) b.onclick = function () { window.AndroidBridge.goHome(); };
    }
  }

  function onState(s) {
    var prevIdx = st && st.round ? st.round.index : null;
    var prevPhase = st ? st.phase : null;
    st = s;
    if (s.phase === 'question' && s.round) {
      var d = Date.now() + s.round.remainingMs;
      if (s.round.index !== prevIdx || prevPhase !== 'question' || Math.abs(d - deadline) > 900) deadline = d;
    }
    var key = [s.phase, s.round ? s.round.index : '', s.you.answered ? 1 : 0, s.you.host ? 1 : 0].join('|');
    if (key !== screenKey) {
      screenKey = key;
      lastV = -1;
      build(s);
      if (s.phase === 'question' && !s.you.answered && prevIdx !== s.round.index) vibrate(60);
      if (s.phase === 'final' && prevPhase !== 'final') confetti();
    }
    if (s.v !== lastV) {
      lastV = s.v;
      update(s);
    }
    syncClueImage(s);
  }

  // La imagen de la pista (fotos y logos). Los logos pixelados se aclaran por etapas: se precarga
  // la siguiente y se cambia solo cuando ya bajó, para que no parpadee.
  function clueImage(r, extra) {
    if (!r.image) return '';
    return '<img class="clue-img' + (extra || '') + (r.pixelated ? ' pix' : '') + '" id="clueImg" alt="Imagen de la pista" src="' +
      esc(r.image) + '" data-src="' + esc(r.image) + '">' +
      (r.prompt ? '<div class="caption">' + esc(r.prompt) + '</div>' : '');
  }

  function syncClueImage(s) {
    var img = $('#clueImg');
    var r = s.round;
    if (!img || !r || !r.image || img.getAttribute('data-src') === r.image) return;
    var want = r.image, pixelated = r.pixelated;
    img.setAttribute('data-src', want);
    var next = new Image();
    next.onload = function () {
      if (img.getAttribute('data-src') !== want) return;
      img.src = want;
      img.classList.toggle('pix', !!pixelated);
    };
    // Si falla (Wi-Fi débil), se vuelve a intentar en la siguiente consulta del estado.
    next.onerror = function () {
      if (img.getAttribute('data-src') === want) img.setAttribute('data-src', '');
    };
    next.src = want;
  }

  // ------------------------------------------------------------------ pantallas

  function build(s) {
    window.scrollTo(0, 0);
    document.body.classList.toggle('final', s.phase === 'final');
    if (s.phase === 'lobby') buildLobby(s);
    else if (s.phase === 'question') buildQuestion(s);
    else if (s.phase === 'reveal') buildReveal(s);
    else buildFinal(s);
    var lb = $('#leaveBtn');
    if (lb) lb.onclick = leave;
  }

  function update(s) {
    if (s.phase === 'lobby') updateLobby(s);
    else if (s.phase === 'question') updateQuestion(s);
    else if (s.phase === 'reveal') updateReveal(s);
    else updateFinal(s);
  }

  function leave() {
    if (inApp && st && st.you.host) { window.AndroidBridge.leave(); return; }
    if (!confirm('¿Salir de la partida?')) return;
    api('leave', {}).catch(function () { }).then(function () {
      forget();
      clearTimeout(pollTimer);
      if (inApp) window.AndroidBridge.goHome();
      else { screenKey = ''; renderJoin(); }
    });
  }

  function scorePill(s) {
    return '<span class="pill score" id="myScore">' + STAR + fmt(s.you.score) + '</span>';
  }

  function plainBar(title) {
    return '<header class="top">' + logoMark() + '<span class="grow title">' + esc(title) + '</span>' +
      '<button class="pill-btn" id="leaveBtn">Salir</button></header>';
  }

  function roundBar(s) {
    var r = s.round;
    return '<header class="top"><span class="pill">' + r.index + ' / ' + r.total + '</span>' +
      '<span class="grow">' + catIcon(r.catId, r.catIcon) + esc(r.catName) + '</span>' + scorePill(s) + '</header>';
  }

  // ---- Unirse (navegador)

  function renderJoin(msg) {
    screenKey = 'join';
    document.body.classList.remove('final');
    var saved = store('aa_name') || hash.name || '';
    app.innerHTML =
      '<div class="screen center">' +
      '<div class="brand">' + logoMark('pop-in', true) + '<div><h1>Adivina<br>Adivinador</h1><p>Aunque lo escribas mal, algo te llevas.</p></div></div>' +
      '<form id="joinForm" class="card"><label for="name">Tu nombre</label>' +
      '<input id="name" maxlength="16" autocomplete="off" placeholder="¿Cómo te llamas?" value="' + esc(saved) + '">' +
      '<button class="btn">' + icon('login', 'l') + 'Entrar a la partida</button></form>' +
      '<div class="err">' + esc(msg || '') + '</div>' +
      (inApp ? '<button class="link" id="homeBtn">Volver al inicio</button>' : '') +
      '</div>';
    $('#joinForm').onsubmit = function (e) {
      e.preventDefault();
      var n = $('#name').value.trim();
      if (!n) { $('#name').classList.add('shake'); setTimeout(function () { $('#name').classList.remove('shake'); }, 400); return; }
      join(n, hash.host);
    };
    var hb = $('#homeBtn');
    if (hb) hb.onclick = function () { window.AndroidBridge.goHome(); };
  }

  // ---- Sala de espera

  function buildLobby(s) {
    var host = s.you.host;
    var html = '<div class="screen">' + plainBar(host ? 'Tu partida' : 'Sala de espera') +
      '<section class="card ' + (host ? 'dark ticket' : '') + '" id="joinBox"></section>' +
      '<section class="stack"><h2>Jugadores <span id="pcount" style="color:var(--violet)"></span></h2><div class="plist" id="plist"></div></section>';
    if (host) {
      cfg = {
        categories: s.settings.categories.slice(),
        rounds: s.settings.rounds,
        seconds: s.settings.seconds,
        tolerance: s.settings.tolerance,
        hints: s.settings.hints,
        mode: s.settings.mode || 'write',
        custom: s.settings.custom || ''
      };
      html +=
        '<section class="card">' +
        '<div class="setting"><span class="eyebrow">Modo de juego</span><div class="seg" id="optMode"></div><p class="muted" id="modeDesc"></p></div>' +
        '<div class="setting"><div class="row-head"><span class="eyebrow" id="catTitle">Categorías</span><button class="link" id="allCats" style="padding:4px;min-height:32px">Todas</button></div>' +
        '<div class="cat-grid" id="cats"></div></div>' +
        '<div class="steppers"><div class="setting"><span class="eyebrow">Preguntas</span><div class="stepper" id="stRounds"></div></div>' +
        '<div class="setting"><span class="eyebrow">Segundos</span><div class="stepper" id="stSeconds"></div></div></div>' +
        '<div class="setting" id="tolSetting"><span class="eyebrow">Exigencia con la ortografía</span><div class="seg" id="optTol"></div><p class="muted" id="tolDesc"></p></div>' +
        '<button class="switch-row" id="optHints" style="border:0;background:none;padding:0;font:inherit;text-align:left">' +
        '<span class="txt"><b id="hintsLabel"></b><span class="muted" id="hintsDesc"></span></span><span class="switch" id="hintsSwitch"></span></button>' +
        '</section>' +
        '<details class="card dashed" id="customBox"><summary>' + icon('pencil') + 'Tu propia categoría</summary>' +
        '<p class="muted" style="margin:0">Una pregunta por línea: <b>pista = respuesta / otra forma de escribirla</b></p>' +
        '<textarea id="custom" placeholder="El ratón más famoso de Disney = Mickey / Mickey Mouse&#10;La mascota de la casa = Firulais"></textarea>' +
        '<div class="muted" id="customInfo"></div></details>' +
        '<div class="sticky-bottom"><div><button class="btn stack" id="startBtn">¡Empezar!<span class="sub" id="startSub"></span></button></div></div>';
    } else {
      html += '<section class="card"><h2>Así se jugará</h2><div id="summary" class="stack"></div></section>' +
        '<div class="waiting"><span class="spin"></span>Esperando a que el anfitrión empiece</div>';
    }
    app.innerHTML = html + '</div>';
    if (!host) return;

    var catsEl = $('#cats');
    var all = s.categories.concat([{ id: 'custom', name: 'Personalizada', icon: '', count: s.settings.customCount }]);
    catsEl.innerHTML = all.map(function (c) {
      return '<button class="cat" data-id="' + esc(c.id) + '">' + catIcon(c.id, c.icon) +
        '<span><span class="nm">' + esc(c.name) + '</span><span class="ct" data-count="' + esc(c.id) + '">' + plural(c.count, 'pregunta', 'preguntas') + '</span></span></button>';
    }).join('');
    catsEl.onclick = function (e) {
      var b = e.target.closest('.cat');
      if (!b) return;
      var id = b.getAttribute('data-id');
      var i = cfg.categories.indexOf(id);
      if (i >= 0) cfg.categories.splice(i, 1);
      else {
        cfg.categories.push(id);
        if (id === 'custom' && !cfg.custom.trim()) $('#customBox').open = true;
      }
      paintSettings();
      sendSettings();
    };
    $('#allCats').onclick = function () {
      var ids = s.categories.map(function (c) { return c.id; });
      if (cfg.custom.trim()) ids.push('custom');
      cfg.categories = cfg.categories.length >= ids.length ? [] : ids;
      paintSettings(); sendSettings();
    };

    segGroup('#optMode', MODES.map(function (m) { return m.v; }), function (v) { return icon(modeOf(v).icon, 's') + esc(modeOf(v).name); }, 'mode');
    segGroup('#optTol', TOLERANCE.map(function (t) { return t.v; }), function (v) { return esc(TOLERANCE[v].name); }, 'tolerance');
    stepper('#stRounds', ROUNDS, 'rounds', 'preguntas');
    stepper('#stSeconds', SECONDS, 'seconds', 'segundos');
    $('#optHints').onclick = function () { cfg.hints = !cfg.hints; paintSettings(); sendSettings(); };

    var ta = $('#custom');
    ta.value = cfg.custom;
    if (cfg.categories.indexOf('custom') >= 0 && !cfg.custom.trim()) $('#customBox').open = true;
    ta.oninput = function () {
      cfg.custom = ta.value;
      if (cfg.custom.trim() && cfg.categories.indexOf('custom') < 0) cfg.categories.push('custom');
      paintSettings();
      clearTimeout(settingsTimer);
      settingsTimer = setTimeout(sendSettings, 500);
    };

    $('#startBtn').onclick = function () {
      clearTimeout(settingsTimer);
      var b = this;
      b.disabled = true;
      api('settings', { settings: cfg }).then(function () { return api('start', {}); }).then(function (r) {
        b.disabled = false;
        if (r.error) toast(r.error); else poll();
      }).catch(function () { b.disabled = false; toast('No se pudo empezar'); });
    };
    paintSettings();
  }

  function segGroup(sel, values, label, key) {
    var el = $(sel);
    el.innerHTML = values.map(function (v, i) {
      return '<button data-i="' + i + '">' + label(v) + '</button>';
    }).join('');
    el.onclick = function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      cfg[key] = values[+b.getAttribute('data-i')];
      paintSettings();
      sendSettings();
    };
    el._values = values;
    el._key = key;
  }

  function stepper(sel, values, key, what) {
    var el = $(sel);
    el.innerHTML = '<button aria-label="Menos ' + what + '" data-d="-1">−</button><output aria-live="polite"></output><button aria-label="Más ' + what + '" data-d="1">+</button>';
    el.onclick = function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      var i = values.indexOf(cfg[key]);
      if (i < 0) i = 0;
      i = Math.max(0, Math.min(values.length - 1, i + (+b.getAttribute('data-d'))));
      cfg[key] = values[i];
      paintSettings();
      sendSettings();
    };
    el._values = values;
    el._key = key;
  }

  function paintSettings() {
    if (!cfg) return;
    document.querySelectorAll('#cats .cat').forEach(function (b) {
      b.classList.toggle('on', cfg.categories.indexOf(b.getAttribute('data-id')) >= 0);
    });
    ['#optMode', '#optTol'].forEach(function (sel) {
      var el = $(sel);
      if (!el) return;
      el.querySelectorAll('button').forEach(function (b) {
        b.classList.toggle('on', el._values[+b.getAttribute('data-i')] === cfg[el._key]);
      });
    });
    ['#stRounds', '#stSeconds'].forEach(function (sel) {
      var el = $(sel);
      if (!el) return;
      var i = el._values.indexOf(cfg[el._key]);
      el.querySelector('output').textContent = cfg[el._key];
      el.querySelector('[data-d="-1"]').disabled = i <= 0;
      el.querySelector('[data-d="1"]').disabled = i >= el._values.length - 1;
    });
    var choice = cfg.mode === 'choice';
    $('#modeDesc').textContent = modeOf(cfg.mode).desc;
    $('#tolDesc').textContent = TOLERANCE[cfg.tolerance].desc;
    $('#tolSetting').hidden = choice; // con opciones no hay ortografía que calificar
    $('#hintsLabel').textContent = choice ? 'Ayuda 50/50 a mitad de tiempo' : 'Pista a mitad de tiempo';
    $('#hintsDesc').textContent = choice ? 'Quita dos opciones incorrectas.' : 'Muestra la primera letra y cuántas letras tiene.';
    $('#hintsSwitch').classList.toggle('on', !!cfg.hints);
    $('#optHints').setAttribute('aria-pressed', cfg.hints ? 'true' : 'false');
    var n = cfg.categories.length;
    $('#catTitle').textContent = 'Categorías · ' + n;
    var totalCats = document.querySelectorAll('#cats .cat').length;
    $('#allCats').textContent = n >= totalCats - (cfg.custom.trim() ? 0 : 1) ? 'Ninguna' : 'Todas';
    $('#startSub').textContent = modeOf(cfg.mode).name + ' · ' + cfg.rounds + ' preguntas · ' + cfg.seconds + ' s · ' +
      plural(n, 'categoría', 'categorías');
  }

  function sendSettings() {
    clearTimeout(settingsTimer);
    api('settings', { settings: cfg }).then(function (r) { if (r.error) toast(r.error); }).catch(function () { });
  }

  function updateLobby(s) {
    var jb = $('#joinBox');
    if (s.you.host) {
      jb.innerHTML = '<span class="eyebrow">' + icon('wifi', 's') + 'Para unirse</span>' +
        (s.joinUrls.length
          ? s.joinUrls.map(function (u) { return '<div class="addr">' + esc(u.replace('http://', '')) + '</div>'; }).join('') +
            '<p class="muted" style="margin:0">Mismo Wi-Fi (o tu punto de acceso). Abren la app y tocan <b style="color:#fff">Unirme</b>, o escriben esta dirección en el navegador.</p>'
          : '<p style="margin:0;font-weight:700">No encontramos tu dirección en la red. Conéctate a un Wi-Fi o activa tu punto de acceso (hotspot).</p>');
    } else {
      jb.innerHTML = '<h2>¡Estás dentro, ' + esc(s.you.name) + '!</h2><p class="muted" style="margin:0">Cuando el anfitrión empiece, verás la primera pista.</p>';
    }

    $('#pcount').textContent = s.players.length;
    var pl = $('#plist');
    pl.innerHTML = s.players.map(function (p) {
      return '<span class="player' + (p.connected ? '' : ' off') + '">' + avatar(p) + esc(p.name) +
        (p.host ? icon('crown', 's') : '') + (p.id === s.you.id ? ' (tú)' : '') +
        (s.you.host && !p.host ? '<button class="x" data-kick="' + esc(p.id) + '" aria-label="Sacar a ' + esc(p.name) + '">' + icon('x', 's') + '</button>' : '') + '</span>';
    }).join('');
    pl.onclick = function (e) {
      var b = e.target.closest('[data-kick]');
      if (!b) return;
      if (confirm('¿Sacar a este jugador?')) api('kick', { target: b.getAttribute('data-kick') }).then(poll);
    };

    if (s.you.host) {
      var n = s.settings.customCount;
      $('#customInfo').textContent = n ? plural(n, 'pregunta lista', 'preguntas listas') : 'Aún no hay preguntas personalizadas.';
      var cc = document.querySelector('[data-count="custom"]');
      if (cc) cc.textContent = plural(n, 'pregunta', 'preguntas');
    } else {
      var names = {};
      (s.categories || []).forEach(function (c) { names[c.id] = c; });
      names.custom = { id: 'custom', name: 'Personalizada' };
      var cats = s.settings.categories.map(function (id) { return names[id] || { id: id, name: id }; });
      var choice = s.settings.mode === 'choice';
      $('#summary').innerHTML =
        '<div class="cat-grid">' + (cats.length ? cats.map(function (c) {
          return '<span class="cat on">' + catIcon(c.id, c.icon) + '<span class="nm">' + esc(c.name) + '</span></span>';
        }).join('') : '<span class="muted">Sin categorías aún</span>') + '</div>' +
        '<p class="muted" style="margin:0">Modo <b>' + esc(modeOf(s.settings.mode).name) + '</b> · ' + s.settings.rounds + ' preguntas · ' +
        s.settings.seconds + ' s cada una' +
        (choice ? (s.settings.hints ? ' · con ayuda 50/50' : '')
          : ' · ortografía ' + TOLERANCE[s.settings.tolerance].name.toLowerCase() + (s.settings.hints ? ' · con pistas' : '')) + '</p>';
    }
  }

  // ---- Pregunta

  function buildQuestion(s) {
    var r = s.round;
    var html = '<div class="screen">' + roundBar(s) +
      '<div class="timer-row"><div class="timer" id="timer"><div class="bar" id="tbar"></div></div><div class="tnum" id="tnum" aria-live="off"></div></div>' +
      '<section class="card prompt-card"><div class="ask">' + esc(r.ask) + '</div>' +
      (r.image ? clueImage(r, s.you.answered ? ' still' : '') :
        '<div class="prompt t-' + esc(r.type) + (s.you.answered ? ' still' : '') + '">' + esc(r.prompt) + '</div>') +
      '<div class="hint" id="hint"></div></section>';
    if (r.options && !s.you.answered) {
      html += '<div class="options" id="opts">' + r.options.map(function (o, i) {
        return '<button class="opt o' + (i % 4) + '" data-i="' + i + '">' + shape(i) + '<span>' + esc(o) + '</span></button>';
      }).join('') + '</div>';
    } else if (s.you.answered) {
      html += '<div class="card sent"><span class="ok">' + icon('check') + '</span><div><div class="muted">' +
        (r.options ? 'Elegiste' : 'Enviaste') + '</div><b>«' + esc(s.you.answer) + '»</b><div class="muted">Los puntos se ven cuando termine la ronda.</div></div></div>';
    } else {
      html += '<form class="answer" id="ansForm"><input id="ans" maxlength="80" autocomplete="off" autocorrect="off" ' +
        'autocapitalize="sentences" spellcheck="false" enterkeyhint="send" placeholder="Escribe tu respuesta…" aria-label="Tu respuesta">' +
        '<button class="btn" aria-label="Enviar respuesta">' + icon('arrow', 'l') + '</button></form>' +
        '<p class="muted" style="margin:-6px 0 0">Tildes y mayúsculas no importan. Si te equivocas en una letra, igual sumas.</p>';
    }
    html += '<div class="progress-row"><div class="stackav" id="plist"></div><span id="answeredInfo"></span></div>';
    if (s.you.host) {
      html += '<div class="host-tools"><button class="link" id="skipBtn">Cerrar la ronda</button>' +
        '<button class="link" id="endBtn">Terminar partida</button></div>';
    }
    app.innerHTML = html + '</div>';

    var form = $('#ansForm');
    if (form) {
      var input = $('#ans');
      setTimeout(function () { try { input.focus(); } catch (e) { } }, 50);
      form.onsubmit = function (e) {
        e.preventDefault();
        var text = input.value.trim();
        if (!text) { input.classList.add('shake'); setTimeout(function () { input.classList.remove('shake'); }, 400); return; }
        form.querySelector('button').disabled = true;
        api('answer', { text: text }).then(function (res) {
          if (res.error) { toast(res.error); form.querySelector('button').disabled = false; }
          poll();
        }).catch(function () { form.querySelector('button').disabled = false; toast('No se pudo enviar, intenta otra vez'); });
      };
    }
    var opts = $('#opts');
    if (opts) {
      opts.onclick = function (e) {
        var b = e.target.closest('.opt');
        if (!b || b.disabled || opts.classList.contains('busy')) return;
        opts.classList.add('busy');
        b.classList.add('picked');
        api('answer', { choice: +b.getAttribute('data-i') }).then(function (res) {
          if (res.error) { toast(res.error); opts.classList.remove('busy'); b.classList.remove('picked'); }
          poll();
        }).catch(function () { opts.classList.remove('busy'); b.classList.remove('picked'); toast('No se pudo enviar, intenta otra vez'); });
      };
    }
    hostButtons();
    tickTimer();
  }

  function hostButtons() {
    var sk = $('#skipBtn');
    if (sk) sk.onclick = function () { api('next', {}).then(poll); };
    var en = $('#endBtn');
    if (en) en.onclick = function () { if (confirm('¿Terminar la partida y ver el podio?')) api('end', {}).then(poll); };
  }

  function updateQuestion(s) {
    var r = s.round;
    var hint = $('#hint');
    hint.classList.toggle('plain', !!r.options);
    if (r.options) {
      var removed = r.removed || [];
      hint.innerHTML = removed.length ? icon('bulb', 's') + 'Ayuda 50/50: quitamos ' + plural(removed.length, 'opción', 'opciones') : '';
      removed.forEach(function (i) {
        var b = document.querySelector('.opt[data-i="' + i + '"]');
        if (b) { b.disabled = true; b.classList.add('gone'); }
      });
    } else {
      hint.innerHTML = r.hint ? icon('bulb') + esc(r.hint) : '';
    }
    $('#answeredInfo').textContent = r.answeredCount + ' de ' + r.playerCount + ' ya respondieron';
    $('#plist').innerHTML = s.players.map(function (p) {
      return avatar(p, (p.answered ? '' : 'pending') + (p.connected ? '' : ' off'), p.answered);
    }).join('');
    $('#myScore').innerHTML = STAR + fmt(s.you.score);
  }

  function tickTimer() {
    if (!st || st.phase !== 'question') return;
    var bar = $('#tbar'), num = $('#tnum'), timer = $('#timer');
    if (!bar) return;
    var rem = Math.max(0, deadline - Date.now());
    bar.style.width = (100 * rem / st.round.durationMs) + '%';
    timer.classList.toggle('low', rem < 5000);
    if (rem > 0) { num.textContent = Math.ceil(rem / 1000); return; }
    num.innerHTML = icon('clock');
    var form = $('#ansForm');
    if (form && !form.classList.contains('closed')) {
      form.classList.add('closed');
      form.querySelector('input').disabled = true;
      form.querySelector('button').disabled = true;
    }
    var opts = $('#opts');
    if (opts && !opts.classList.contains('closed')) {
      opts.classList.add('closed');
      opts.querySelectorAll('.opt').forEach(function (b) { b.disabled = true; });
    }
  }
  setInterval(tickTimer, 100);

  // ---- Resultado de la ronda

  function buildReveal(s) {
    var r = s.round, rv = s.reveal;
    prevRanks = lastRanks;
    var html = '<div class="screen">' + roundBar(s) +
      '<section class="card dark answer-card"><div class="clue">' +
      (r.image ? clueImage(r, ' small') : '<div class="prompt small t-' + esc(r.type) + '">' + esc(r.prompt) + '</div>') + '</div>' +
      '<div><div class="eyebrow">La respuesta era</div><div class="big-answer">' + esc(rv.answer) + '</div></div></section>' +
      '<section class="card you-card" id="youCard"></section>' +
      (rv.picks ? '<section class="card"><h2>Opciones</h2><div class="rows" id="optResults"></div></section>' : '') +
      '<section class="card"><h2>' + (rv.picks ? 'Lo que eligió cada uno' : 'Lo que escribió cada uno') + '</h2><div class="rows" id="results"></div></section>' +
      '<section class="stack"><h2>Posiciones</h2><div class="board" id="board"></div></section>';
    if (s.you.host) {
      html += '<div class="host-tools"><button class="link" id="endBtn">Terminar partida</button></div>' +
        '<div class="sticky-bottom"><div><button class="btn" id="nextBtn">' +
        (rv.last ? icon('trophy', 'l') + 'Ver el podio' : 'Siguiente pregunta' + icon('arrow', 'l')) + '</button></div></div>';
    } else {
      html += '<div class="waiting"><span class="spin"></span>El anfitrión pasará a la siguiente</div>';
    }
    app.innerHTML = html + '</div>';
    var nb = $('#nextBtn');
    if (nb) nb.onclick = function () { nb.disabled = true; api('next', {}).then(poll); };
    hostButtons();

    var mine = null;
    rv.results.forEach(function (x) { if (x.id === s.you.id) mine = x; });
    if (mine) vibrate(mine.accuracy >= 1 ? [40, 60, 40] : 120);
  }

  function updateReveal(s) {
    var rv = s.reveal;
    var choice = !!rv.picks;
    var mine = null;
    rv.results.forEach(function (x) { if (x.id === s.you.id) mine = x; });
    var yc = $('#youCard');
    if (mine) {
      var c = accClass(mine.accuracy);
      var ring = choice || mine.accuracy === 0 || mine.accuracy >= 1
        ? icon(mine.accuracy >= 1 ? 'check' : 'x', 'l') : pct(mine.accuracy);
      yc.className = 'card you-card acc-' + c;
      yc.innerHTML = '<div class="ring">' + ring + '</div><div class="info"><div class="lbl">' + esc(mine.label) + '</div>' +
        (mine.text ? '<div class="muted">' + (choice ? 'Elegiste' : 'Escribiste') + ' «' + esc(mine.text) + '»</div>' : '<div class="muted">No alcanzaste a responder</div>') +
        ((mine.first || mine.streak >= 3) ? '<div class="extra">' +
          (mine.first ? '<span class="badge b-hot">' + icon('bolt', 's') + 'Primero · +100</span>' : '') +
          (mine.streak >= 3 ? '<span class="badge b-hot">' + icon('flame', 's') + 'Racha de ' + mine.streak + '</span>' : '') + '</div>' : '') +
        '</div><span class="pts">+' + fmt(mine.points) + '</span>';
    } else {
      yc.hidden = true;
    }

    var or = $('#optResults');
    if (or && choice) {
      var total = rv.picks.reduce(function (a, b) { return a + b; }, 0) || 1;
      or.innerHTML = s.round.options.map(function (o, i) {
        var good = i === rv.correct;
        return '<div class="row opt-row' + (good ? ' good' : '') + '"><span class="sh-badge o' + (i % 4) + '">' + shape(i, '') + '</span>' +
          '<div class="info"><div class="nm">' + esc(o) + (good ? icon('check', 's') : '') + (i === s.you.choice ? ' <span class="muted">(tú)</span>' : '') + '</div>' +
          '<div class="meter"><i style="width:' + Math.round(100 * rv.picks[i] / total) + '%;background:' + (good ? 'var(--green)' : 'var(--faint)') + '"></i></div></div>' +
          '<div class="pts' + (rv.picks[i] ? '' : ' zero') + '">' + rv.picks[i] + '</div></div>';
      }).join('');
    }

    $('#results').innerHTML = rv.results.map(function (x) {
      var c = accClass(x.accuracy);
      var badge = c === 'part' ? 'Casi · ' + pct(x.accuracy) : x.label;
      return '<div class="row">' + avatar(x) + '<div class="info"><div class="nm">' + esc(x.name) + (x.id === s.you.id ? ' (tú)' : '') +
        '<span class="badge b-' + c + '">' + esc(badge) + '</span>' +
        (x.first ? '<span class="badge b-hot">' + icon('bolt', 's') + '</span>' : '') +
        (x.streak >= 3 ? '<span class="badge b-hot">' + icon('flame', 's') + x.streak + '</span>' : '') + '</div>' +
        '<div class="txt">' + (x.text ? '«' + esc(x.text) + '»' : 'Sin respuesta') + '</div>' +
        '<div class="meter"><i style="width:' + pct(x.accuracy) + ';background:' + accColor(x.accuracy) + '"></i></div></div>' +
        '<div class="pts' + (x.points ? '' : ' zero') + '">+' + fmt(x.points) + '</div></div>';
    }).join('');

    var ranks = {};
    $('#board').innerHTML = s.players.map(function (p, i) {
      ranks[p.id] = i + 1;
      var up = prevRanks[p.id] && prevRanks[p.id] > i + 1;
      return '<div class="line' + (p.id === s.you.id ? ' me' : '') + '"><span class="rank">' + (i + 1) + '</span>' + avatar(p) +
        '<span class="nm">' + esc(p.name) + (p.id === s.you.id ? ' (tú)' : '') + (up ? ' ' + icon('up', 's') : '') + '</span>' +
        (p.gained ? '<span class="gain">+' + fmt(p.gained) + '</span>' : '') +
        '<span class="sc">' + fmt(p.score) + '</span></div>';
    }).join('');
    lastRanks = ranks;
    $('#myScore').innerHTML = STAR + fmt(s.you.score);
  }

  // ---- Podio

  function buildFinal(s) {
    lastRanks = {};
    var html = '<div class="screen">' +
      '<header class="top"><span class="grow title">Fin del juego</span><button class="pill-btn" id="leaveBtn">Salir</button></header>' +
      '<div class="final-head"><svg class="pop-in" width="64" height="64" viewBox="0 0 24 24" fill="#FFC233" stroke="#1A1433" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4" fill="none"/><path d="M17 6h3a3 3 0 0 1-3 4" fill="none"/><path d="M10 14h4v3h-4z"/><path d="M8 20h8v-3H8z"/></svg>' +
      '<h1 id="winner"></h1><p id="winnerSub"></p></div>' +
      '<div class="podium" id="podium"></div>' +
      '<section class="card final-list" id="board"></section>';
    if (s.you.host) {
      html += '<div class="sticky-bottom"><div><button class="btn sun" id="againBtn">' + icon('back', 'l') + 'Jugar otra vez</button></div></div>';
    } else {
      html += '<div class="waiting">El anfitrión puede empezar otra partida</div>';
    }
    app.innerHTML = html + '</div>';
    var ab = $('#againBtn');
    if (ab) ab.onclick = function () { api('lobby', {}).then(poll); };
  }

  function updateFinal(s) {
    var top = s.players.slice(0, 3);
    var w = top[0];
    var tie = w && top[1] && top[1].score === w.score;
    $('#winner').textContent = !w ? '¡Fin!' : tie ? '¡Empate!' : (w.id === s.you.id ? '¡Ganaste!' : '¡Ganó ' + w.name + '!');
    $('#winnerSub').textContent = w ? plural(w.exact, 'respuesta exacta', 'respuestas exactas') + ' · ' + fmt(w.score) + ' puntos' : '';
    $('#podium').innerHTML = [1, 0, 2].map(function (i) {
      var p = top[i];
      if (!p) return '<div class="pod"></div>';
      return '<div class="pod p' + (i + 1) + '">' + (i === 0 ? icon('crown', 'l') : '') + avatar(p) +
        '<span class="nm">' + esc(p.name) + (p.id === s.you.id ? ' (tú)' : '') + '</span>' +
        '<div class="block"><b>' + (i + 1) + '</b><span>' + fmt(p.score) + '</span></div></div>';
    }).join('');
    var crown = document.querySelector('.pod.p1 .ic');
    if (crown) crown.style.color = '#FFC233';
    $('#board').innerHTML = s.players.slice(3).map(function (p, i) {
      return '<div class="line"><span class="rank">' + (i + 4) + '</span>' + avatar(p) +
        '<span class="nm">' + esc(p.name) + (p.id === s.you.id ? ' (tú)' : '') + '</span><span class="sc">' + fmt(p.score) + '</span></div>';
    }).join('');
  }

  function confetti() {
    var box = document.createElement('div');
    box.className = 'confetti';
    var colors = ['#FFC233', '#FFFFFF', '#D63A4E', '#2463EB', '#138A55'];
    for (var i = 0; i < 70; i++) {
      var c = document.createElement('i');
      c.style.left = Math.random() * 100 + '%';
      c.style.background = colors[i % colors.length];
      c.style.animationDuration = (2.2 + Math.random() * 2.5) + 's';
      c.style.animationDelay = Math.random() * 0.8 + 's';
      box.appendChild(c);
    }
    document.body.appendChild(box);
    setTimeout(function () { box.remove(); }, 6000);
  }

  boot();
})();
