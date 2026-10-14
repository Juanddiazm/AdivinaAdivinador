// Íconos de línea de la interfaz (24×24, trazo con currentColor) y el logo de la app.
// Los usan home.html y app.js: window.icon('crown') devuelve el <svg> como texto.
(function () {
  'use strict';
  var P = {
    crown: '<path d="M3 8l4 4 5-7 5 7 4-4-2 11H5z"/>',
    login: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    back: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    arrow: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
    wifi: '<path d="M2 9a14 14 0 0 1 20 0"/><path d="M5 12.5a10 10 0 0 1 14 0"/><path d="M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1"/>',
    pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    bulb: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    x: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    flame: '<path d="M12 22c4 0 7-3 7-7 0-5-5-7-5-12-3 2-6 6-6 10-1-1-2-2-2-4-1 2-1 4-1 6 0 4 3 7 7 7z"/>',
    up: '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>',
    trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4"/><path d="M17 6h3a3 3 0 0 1-3 4"/><path d="M12 14v3"/><path d="M8 21h8"/><path d="M9 17h6v4H9z"/>',
    skip: '<path d="M5 4l10 8-10 8z"/><path d="M19 5v14"/>',
    stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14"/><path d="M12 17.5v.01"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
    // categorías
    paises: '<path d="M4 21V4"/><path d="M4 4h13l-2 4 2 4H4"/>',
    capitales: '<path d="M3 21h18"/><path d="M5 21V10"/><path d="M19 21V10"/><path d="M9 21V10"/><path d="M15 21V10"/><path d="M2 10l10-6 10 6z"/>',
    marcas: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    lugares: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    peliculas: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M8 4l-2 5"/><path d="M14 4l-2 5"/>',
    series: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 3l4 4 4-4"/>',
    animales: '<circle cx="6.5" cy="9" r="2"/><circle cx="10" cy="5" r="2"/><circle cx="14" cy="5" r="2"/><circle cx="17.5" cy="9" r="2"/><path d="M12 11c-3 0-6 4-6 6.5 0 2 2 3.5 6 1.8 4 1.7 6 .2 6-1.8 0-2.5-3-6.5-6-6.5z"/>',
    comidas: '<path d="M7 3v8"/><path d="M4 3v5a3 3 0 0 0 6 0V3"/><path d="M7 11v10"/><path d="M17 3c-2 2-3 5-3 8h3v10"/>',
    revueltas: '<path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/>',
    personajes: '<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/>',
    refranes: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8"/><path d="M8 13h5"/>',
    deportes: '<circle cx="12" cy="12" r="9"/><path d="M12 3a14 14 0 0 1 0 18"/><path d="M12 3a14 14 0 0 0 0 18"/><path d="M3 12h18"/>',
    custom: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'
  };
  // Figuras rellenas de las opciones (▲ ◆ ● ■), distinguibles sin depender del color.
  var SHAPES = [
    '<path d="M12 3l9 17H3z"/>',
    '<path d="M12 2l10 10-10 10L2 12z"/>',
    '<circle cx="12" cy="12" r="10"/>',
    '<rect x="3" y="3" width="18" height="18" rx="2"/>'
  ];
  var BUBBLE = 'M38 22H70A16 16 0 0 1 86 38V56A16 16 0 0 1 70 72H52L34 88L37 72A16 16 0 0 1 22 56V38A16 16 0 0 1 38 22Z';

  window.icon = function (name, cls) {
    var p = P[name] || P.help;
    return '<svg class="ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
  };
  window.hasIcon = function (name) { return !!P[name]; };
  window.shape = function (i, cls) {
    return '<svg class="' + (cls || 'sh') + '" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' + SHAPES[i % 4] + '</svg>';
  };
  // Logo: globo amarillo con "?" sobre violeta. big = con sombra y destello.
  window.logoMark = function (cls, big) {
    return '<svg class="mark ' + (cls || '') + '" viewBox="0 0 108 108" role="img" aria-label="Adivina Adivinador">' +
      '<rect width="108" height="108" rx="26" fill="#5B3DF5"/>' +
      (big ? '<path transform="translate(3 4)" d="' + BUBBLE + '" fill="#1A1433"/>' : '') +
      '<path d="' + BUBBLE + '" fill="#FFC233" stroke="#1A1433" stroke-width="' + (big ? 4 : 6) + '" stroke-linejoin="round"/>' +
      '<text x="54" y="63" text-anchor="middle" font-family="Bricolage, sans-serif" font-weight="800" font-size="40" fill="#1A1433">?</text>' +
      (big ? '<path d="M90 12l2.4 5.6L98 20l-5.6 2.4L90 28l-2.4-5.6L82 20l5.6-2.4z" fill="#fff"/>' : '') +
      '</svg>';
  };
})();
