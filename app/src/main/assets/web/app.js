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

  var TOLERANCE = [
    { v: 0, name: 'Estricto', desc: 'Solo se perdona un error de dedo en palabras largas.' },
    { v: 1, name: 'Normal', desc: '"Olombia" o "Colonbia" por Colombia se llevan buena parte de los puntos.' },
    { v: 2, name: 'Generoso', desc: 'Casi todo lo que se parezca suma algo. Ideal para niños.' }
  ];

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

  function hue(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    return h;
  }

  function avatar(p, check) {
    var letter = (Array.from(p.name)[0] || '?').toUpperCase();
    return '<span class="avatar" style="background:hsl(' + hue(p.name) + ',65%,48%)">' + esc(letter) +
      (check ? '<span class="chk">✓</span>' : '') + '</span>';
  }

  function accClass(acc) { return acc >= 1 ? 'full' : acc > 0 ? 'part' : 'none'; }
  function accColor(acc) { return acc >= 1 ? 'var(--ok)' : acc > 0 ? 'var(--mid)' : 'var(--bad)'; }
  function pct(acc) { return Math.round(acc * 100) + '%'; }

  function plural(n) { return n + (n === 1 ? ' pregunta' : ' preguntas'); }

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
      o.innerHTML = '📡 Se perdió la conexión con el anfitrión. Reintentando…' +
        (inApp ? ' <button class="chip" id="offHome">Ir al inicio</button>' : '');
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
    return '<img class="clue-img' + (extra || '') + (r.pixelated ? ' pix' : '') + '" id="clueImg" alt="" src="' +
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

  function topBar(s, extra) {
    return '<header class="top">' + (extra || '<div class="brand grow">🔮 Adivina Adivinador</div>') +
      '<div class="pill score" id="myScore">⭐ ' + s.you.score + '</div>' +
      '<button class="link" id="leaveBtn">Salir</button></header>';
  }

  function roundBar(s) {
    var r = s.round;
    return '<div class="pill">' + r.index + '/' + r.total + '</div>' +
      '<div class="pill grow" style="overflow:hidden;text-overflow:ellipsis">' + esc(r.catIcon + ' ' + r.catName) + '</div>';
  }

  // ---- Unirse (navegador)

  function renderJoin(msg) {
    screenKey = 'join';
    var saved = store('aa_name') || hash.name || '';
    app.innerHTML =
      '<div class="screen center">' +
      '<div class="logo bounce">🔮</div><h1>Adivina<br>Adivinador</h1>' +
      '<p class="muted">Escribe tu nombre para entrar a la partida</p>' +
      '<form id="joinForm" class="stack"><input id="name" maxlength="16" autocomplete="off" placeholder="Tu nombre" value="' + esc(saved) + '">' +
      '<button class="btn big">Entrar 🎮</button></form>' +
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
    var html = '<div class="screen">' + topBar(s) +
      '<section class="card" id="joinBox"></section>' +
      '<section class="card"><h3>Jugadores <span class="muted" id="pcount"></span></h3><div class="plist" id="plist"></div></section>';
    if (host) {
      cfg = {
        categories: s.settings.categories.slice(),
        rounds: s.settings.rounds,
        seconds: s.settings.seconds,
        tolerance: s.settings.tolerance,
        hints: s.settings.hints,
        custom: s.settings.custom || ''
      };
      html +=
        '<section class="card"><h3>Categorías</h3>' +
        '<div class="chips" style="margin-bottom:10px"><button class="chip" id="allCats">Todas</button><button class="chip" id="noCats">Ninguna</button></div>' +
        '<div class="cat-grid" id="cats"></div></section>' +
        '<section class="card"><h3>Ajustes</h3>' +
        '<div class="setting"><label>Preguntas</label><div class="chips" id="optRounds"></div></div>' +
        '<div class="setting"><label>Segundos por pregunta</label><div class="chips" id="optSeconds"></div></div>' +
        '<div class="setting"><label>¿Qué tan exigentes con la ortografía?</label><div class="chips" id="optTol"></div><div class="muted" id="tolDesc"></div></div>' +
        '<div class="setting"><label>Pista a mitad de tiempo</label><div class="chips" id="optHints"></div><div class="muted">Muestra la primera letra y cuántas letras tiene.</div></div>' +
        '</section>' +
        '<section class="card"><h3>✍️ Tu propia categoría</h3>' +
        '<p class="muted" style="margin-top:0">Una pregunta por línea: <b>pista = respuesta / otra forma de escribirla</b></p>' +
        '<textarea id="custom" placeholder="🐭 El ratón más famoso de Disney = Mickey / Mickey Mouse&#10;La mascota de la casa = Firulais"></textarea>' +
        '<div class="muted" id="customInfo" style="margin-top:6px"></div></section>' +
        '<div class="sticky-bottom"><div><button class="btn big" id="startBtn">¡Empezar partida! 🚀</button></div></div>';
    } else {
      html += '<section class="card"><h3>Así se jugará</h3><div id="summary"></div></section>' +
        '<div class="waiting">⏳ Esperando a que el anfitrión empiece<span class="dots"></span></div>';
    }
    app.innerHTML = html + '</div>';
    if (!host) return;

    var catsEl = $('#cats');
    var all = s.categories.concat([{ id: 'custom', name: 'Personalizada', icon: '✍️', count: s.settings.customCount }]);
    catsEl.innerHTML = all.map(function (c) {
      return '<button class="cat" data-id="' + esc(c.id) + '"><span class="ic">' + esc(c.icon) + '</span>' +
        '<span class="nm">' + esc(c.name) + '</span><span class="ct" data-count="' + esc(c.id) + '">' + plural(c.count) + '</span></button>';
    }).join('');
    catsEl.onclick = function (e) {
      var b = e.target.closest('.cat');
      if (!b) return;
      var id = b.getAttribute('data-id');
      var i = cfg.categories.indexOf(id);
      if (i >= 0) cfg.categories.splice(i, 1); else cfg.categories.push(id);
      paintSettings();
      sendSettings();
    };
    $('#allCats').onclick = function () {
      cfg.categories = s.categories.map(function (c) { return c.id; });
      if (cfg.custom.trim()) cfg.categories.push('custom');
      paintSettings(); sendSettings();
    };
    $('#noCats').onclick = function () { cfg.categories = []; paintSettings(); sendSettings(); };

    chipGroup('#optRounds', [5, 10, 15, 20, 30], function (v) { return v; }, 'rounds');
    chipGroup('#optSeconds', [10, 15, 20, 25, 30, 45, 60], function (v) { return v + ' s'; }, 'seconds');
    chipGroup('#optTol', TOLERANCE.map(function (t) { return t.v; }), function (v) { return TOLERANCE[v].name; }, 'tolerance');
    chipGroup('#optHints', [true, false], function (v) { return v ? 'Sí' : 'No'; }, 'hints');

    var ta = $('#custom');
    ta.value = cfg.custom;
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

  function chipGroup(sel, values, label, key) {
    var el = $(sel);
    el.innerHTML = values.map(function (v, i) {
      return '<button class="chip" data-i="' + i + '">' + esc(label(v)) + '</button>';
    }).join('');
    el.onclick = function (e) {
      var b = e.target.closest('.chip');
      if (!b) return;
      cfg[key] = values[+b.getAttribute('data-i')];
      paintSettings();
      sendSettings();
    };
    el.setAttribute('data-key', key);
    el._values = values;
  }

  function paintSettings() {
    if (!cfg) return;
    document.querySelectorAll('#cats .cat').forEach(function (b) {
      b.classList.toggle('on', cfg.categories.indexOf(b.getAttribute('data-id')) >= 0);
    });
    ['#optRounds', '#optSeconds', '#optTol', '#optHints'].forEach(function (sel) {
      var el = $(sel);
      if (!el) return;
      var key = el.getAttribute('data-key');
      el.querySelectorAll('.chip').forEach(function (b) {
        b.classList.toggle('on', el._values[+b.getAttribute('data-i')] === cfg[key]);
      });
    });
    var td = $('#tolDesc');
    if (td) td.textContent = TOLERANCE[cfg.tolerance].desc;
  }

  function sendSettings() {
    clearTimeout(settingsTimer);
    api('settings', { settings: cfg }).then(function (r) { if (r.error) toast(r.error); }).catch(function () { });
  }

  function updateLobby(s) {
    var jb = $('#joinBox');
    if (s.you.host) {
      jb.innerHTML = '<h3>📲 Invita a tus amigos</h3>' +
        (s.joinUrls.length
          ? '<div class="muted">Conéctense al mismo Wi-Fi que tú (o a tu punto de acceso). Luego abren la app y tocan <b>Unirme</b>, o escriben en el navegador:</div>' +
            '<div class="join-urls">' + s.joinUrls.map(function (u) { return '<div class="join-url">' + esc(u.replace('http://', '')) + '</div>'; }).join('') + '</div>'
          : '<div class="err">No encontramos tu dirección en la red. Conéctate a un Wi-Fi o activa tu punto de acceso (hotspot).</div>');
    } else {
      jb.innerHTML = '<h3>¡Estás dentro, ' + esc(s.you.name) + '! ✅</h3><div class="muted">Cuando el anfitrión empiece, verás la primera pista.</div>';
    }

    $('#pcount').textContent = '(' + s.players.length + ')';
    var pl = $('#plist');
    pl.innerHTML = s.players.map(function (p) {
      return '<span class="player' + (p.connected ? '' : ' off') + '">' + avatar(p) + esc(p.name) +
        (p.host ? ' 👑' : '') + (p.id === s.you.id ? ' (tú)' : '') +
        (s.you.host && !p.host ? '<button class="x" data-kick="' + esc(p.id) + '" title="Sacar">✕</button>' : '') + '</span>';
    }).join('');
    pl.onclick = function (e) {
      var b = e.target.closest('[data-kick]');
      if (!b) return;
      if (confirm('¿Sacar a este jugador?')) api('kick', { target: b.getAttribute('data-kick') }).then(poll);
    };

    if (s.you.host) {
      var ci = $('#customInfo');
      var n = s.settings.customCount;
      ci.textContent = n ? n + (n === 1 ? ' pregunta lista' : ' preguntas listas') : 'Aún no hay preguntas personalizadas.';
      var cc = document.querySelector('[data-count="custom"]');
      if (cc) cc.textContent = plural(n);
    } else {
      var names = {};
      (s.categories || []).forEach(function (c) { names[c.id] = c.icon + ' ' + c.name; });
      names.custom = '✍️ Personalizada';
      var cats = s.settings.categories.map(function (id) { return names[id] || id; });
      $('#summary').innerHTML =
        '<div class="chips" style="margin-bottom:10px">' + (cats.length ? cats.map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('') : '<span class="muted">Sin categorías aún</span>') + '</div>' +
        '<div class="muted">' + s.settings.rounds + ' preguntas · ' + s.settings.seconds + ' s cada una · ortografía: ' +
        TOLERANCE[s.settings.tolerance].name.toLowerCase() + (s.settings.hints ? ' · con pistas' : '') + '</div>';
    }
  }

  // ---- Pregunta

  function buildQuestion(s) {
    var r = s.round;
    var html = '<div class="screen">' + topBar(s, roundBar(s)) +
      '<div><div class="timer" id="timer"><div class="bar" id="tbar"></div></div><div class="tnum" id="tnum"></div></div>' +
      '<div class="card prompt-card"><div class="ask">' + esc(r.ask) + '</div>' +
      (r.image ? clueImage(r, s.you.answered ? ' still' : '') :
        '<div class="prompt t-' + esc(r.type) + (s.you.answered ? ' still' : '') + '">' + esc(r.prompt) + '</div>') +
      '<div class="hint" id="hint"></div></div>';
    if (!s.you.answered) {
      html += '<form class="answer" id="ansForm"><input id="ans" maxlength="80" autocomplete="off" autocorrect="off" ' +
        'autocapitalize="sentences" spellcheck="false" enterkeyhint="send" placeholder="Escribe tu respuesta…">' +
        '<button class="btn">Enviar</button></form>';
    } else {
      html += '<div class="card sent">✅ Enviaste: <b>«' + esc(s.you.answer) + '»</b><div class="muted">Los puntos se ven cuando termine la ronda.</div></div>';
    }
    html += '<div class="progress-txt" id="answeredInfo"></div><div class="plist mini" id="plist"></div>';
    if (s.you.host) {
      html += '<div class="host-tools"><button class="link" id="skipBtn">Cerrar la ronda ⏭</button>' +
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
    $('#hint').textContent = r.hint ? '💡 ' + r.hint : '';
    $('#answeredInfo').textContent = r.answeredCount + ' de ' + r.playerCount + ' ya respondieron';
    $('#plist').innerHTML = s.players.map(function (p) {
      return '<span class="player' + (p.connected ? '' : ' off') + '" title="' + esc(p.name) + '">' + avatar(p, p.answered) + '</span>';
    }).join('');
    $('#myScore').textContent = '⭐ ' + s.you.score;
  }

  function tickTimer() {
    if (!st || st.phase !== 'question') return;
    var bar = $('#tbar'), num = $('#tnum'), timer = $('#timer');
    if (!bar) return;
    var rem = Math.max(0, deadline - Date.now());
    bar.style.width = (100 * rem / st.round.durationMs) + '%';
    num.textContent = Math.ceil(rem / 1000);
    timer.classList.toggle('low', rem < 5000);
    if (rem === 0) {
      var form = $('#ansForm');
      if (form && !form.classList.contains('closed')) {
        form.classList.add('closed');
        form.querySelector('input').disabled = true;
        form.querySelector('button').disabled = true;
        num.textContent = '⏰';
      }
    }
  }
  setInterval(tickTimer, 100);

  // ---- Resultado de la ronda

  function buildReveal(s) {
    var r = s.round, rv = s.reveal;
    var html = '<div class="screen">' + topBar(s, roundBar(s)) +
      '<div class="card answer-card"><div class="muted">La respuesta era</div><div class="big-answer">' + esc(rv.answer) + '</div>' +
      (r.image ? clueImage(r, ' small') : '<div class="prompt small t-' + esc(r.type) + '">' + esc(r.prompt) + '</div>') + '</div>' +
      '<div class="card you-card" id="youCard"></div>' +
      '<section class="card"><h3>Lo que escribió cada uno</h3><div class="rows" id="results"></div></section>' +
      '<section class="card"><h3>Tabla de posiciones</h3><div class="rows" id="board"></div></section>';
    if (s.you.host) {
      html += '<div class="sticky-bottom"><div><button class="btn big" id="nextBtn">' +
        (rv.last ? 'Ver el podio 🏆' : 'Siguiente pregunta ➜') + '</button></div></div>' +
        '<div class="host-tools"><button class="link" id="endBtn">Terminar partida</button></div>';
    } else {
      html += '<div class="waiting">⏳ El anfitrión pasará a la siguiente<span class="dots"></span></div>';
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
    var mine = null;
    rv.results.forEach(function (x) { if (x.id === s.you.id) mine = x; });
    var yc = $('#youCard');
    if (mine) {
      yc.className = 'card you-card acc-' + accClass(mine.accuracy);
      yc.innerHTML = '<div class="lbl">' + esc(mine.label) + (mine.accuracy > 0 && mine.accuracy < 1 ? ' (' + pct(mine.accuracy) + ')' : '') + '</div>' +
        '<div class="pts">+' + mine.points + '</div>' +
        (mine.text ? '<div class="muted">Escribiste «' + esc(mine.text) + '»</div>' : '') +
        (mine.first ? '<div class="gain">⚡ ¡Fuiste el primero en acertar! +100</div>' : '') +
        (mine.streak >= 3 ? '<div class="gain">🔥 Racha de ' + mine.streak + '</div>' : '');
    } else {
      yc.style.display = 'none';
    }

    $('#results').innerHTML = rv.results.map(function (x) {
      return '<div class="row">' + avatar(x) + '<div class="info"><div class="nm">' + esc(x.name) +
        '<span class="badge b-' + accClass(x.accuracy) + '">' + esc(x.label) + '</span>' +
        (x.first ? ' ⚡' : '') + (x.streak >= 3 ? ' 🔥' + x.streak : '') + '</div>' +
        '<div class="txt">' + (x.text ? '«' + esc(x.text) + '»' : '—') + '</div>' +
        '<div class="meter"><i style="width:' + pct(x.accuracy) + ';background:' + accColor(x.accuracy) + '"></i></div></div>' +
        '<div class="pts' + (x.points ? '' : ' zero') + '">+' + x.points + '</div></div>';
    }).join('');

    $('#board').innerHTML = s.players.map(function (p, i) {
      return '<div class="row"><div class="rank">' + (i + 1) + '</div>' + avatar(p) +
        '<div class="info"><div class="nm">' + esc(p.name) + (p.id === s.you.id ? ' (tú)' : '') + '</div></div>' +
        (p.gained ? '<span class="gain">+' + p.gained + '</span>' : '') +
        '<div class="pts">' + p.score + '</div></div>';
    }).join('');
    $('#myScore').textContent = '⭐ ' + s.you.score;
  }

  // ---- Podio

  function buildFinal(s) {
    var html = '<div class="screen">' + topBar(s) +
      '<div class="card" style="text-align:center"><div class="logo">🏆</div><h1 style="font-size:28px">¡Fin del juego!</h1>' +
      '<div class="podium" id="podium"></div></div>' +
      '<section class="card"><h3>Clasificación final</h3><div class="rows" id="board"></div></section>';
    if (s.you.host) {
      html += '<div class="sticky-bottom"><div><button class="btn big" id="againBtn">Jugar otra vez 🔁</button></div></div>';
    } else {
      html += '<div class="waiting">El anfitrión puede empezar otra partida<span class="dots"></span></div>';
    }
    app.innerHTML = html + '</div>';
    var ab = $('#againBtn');
    if (ab) ab.onclick = function () { api('lobby', {}).then(poll); };
  }

  function updateFinal(s) {
    var top = s.players.slice(0, 3);
    var order = [1, 0, 2];
    var medals = ['🥇', '🥈', '🥉'];
    $('#podium').innerHTML = order.map(function (i) {
      var p = top[i];
      if (!p) return '<div class="pod"></div>';
      return '<div class="pod p' + (i + 1) + '">' + avatar(p) + '<div class="nm">' + esc(p.name) + '</div>' +
        '<div class="sc">' + p.score + ' pts</div><div class="block">' + medals[i] + '</div></div>';
    }).join('');
    $('#board').innerHTML = s.players.map(function (p, i) {
      return '<div class="row"><div class="rank">' + (i + 1) + '</div>' + avatar(p) +
        '<div class="info"><div class="nm">' + esc(p.name) + (p.id === s.you.id ? ' (tú)' : '') + '</div>' +
        '<div class="txt">' + p.exact + (p.exact === 1 ? ' respuesta exacta' : ' respuestas exactas') + '</div></div>' +
        '<div class="pts">' + p.score + '</div></div>';
    }).join('');
    $('#myScore').textContent = '⭐ ' + s.you.score;
  }

  function confetti() {
    var box = document.createElement('div');
    box.className = 'confetti';
    var colors = ['#ffcc33', '#ff5c8a', '#4dc9ff', '#3ddc97', '#b44bff'];
    for (var i = 0; i < 80; i++) {
      var c = document.createElement('i');
      c.style.left = Math.random() * 100 + '%';
      c.style.background = colors[i % colors.length];
      c.style.animationDuration = (2 + Math.random() * 2.5) + 's';
      c.style.animationDelay = Math.random() * 0.8 + 's';
      box.appendChild(c);
    }
    document.body.appendChild(box);
    setTimeout(function () { box.remove(); }, 6000);
  }

  boot();
})();
