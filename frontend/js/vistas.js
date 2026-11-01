// ═══════════════════════════════════════
//  VISTAS (frontend/vistas/*.html)
// ═══════════════════════════════════════
// Cada vista vive en su propio archivo; index.html solo deja un hueco <div data-vista="nombre">.
// Al abrir la página se descargan todas en paralelo y se colocan en su hueco. Recién entonces
// corre lo que necesita encontrarlas: el código de inicio se registra con alCargarVistas(fn)
// en lugar de DOMContentLoaded. Se carga antes que los demás scripts.

const VISTAS_VERSION = '20261030-todo-1';

const vistasListas = new Promise((resolve, reject) => {
  const cargar = async () => {
    const huecos = [...document.querySelectorAll('[data-vista]')];
    try {
      const textos = await Promise.all(huecos.map(async hueco => {
        const r = await fetch(`vistas/${hueco.dataset.vista}.html?v=${VISTAS_VERSION}`);
        if (!r.ok) throw new Error(`No se pudo cargar la vista «${hueco.dataset.vista}» (HTTP ${r.status}).`);
        return r.text();
      }));
      huecos.forEach((hueco, i) => { hueco.outerHTML = textos[i]; });
      resolve();
    } catch (error) {
      document.body.insertAdjacentHTML('afterbegin', `<div role="alert" style="margin:16px;padding:14px 18px;border-radius:12px;background:#fde7ea;color:#8a2236;font:600 14px/1.4 Inter,system-ui,sans-serif">
        No se pudo abrir la aplicación: ${String(error.message).replace(/[<>&]/g, '')} Recarga la página o revisa la conexión con el servidor.</div>`);
      reject(error);
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', cargar);
  else cargar();
});

// Ejecuta fn cuando las vistas ya están en la página, en el mismo orden en que se registró.
function alCargarVistas(fn) {
  vistasListas.then(fn, () => { /* el aviso ya se mostró */ });
}
