// Reflejo de luz que sigue al cursor sobre las tarjetas que se pueden pulsar (ver «Efectos» en css/vidrio.css).
// Solo guarda la posición del mouse en --mx / --my; el brillo lo dibuja el CSS.
(function () {
  const TARJETAS = '.home-link, .catalog-card, .ps-reciente';
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const el = e.target.closest && e.target.closest(TARJETAS);
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    el.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }, { passive: true });
})();
