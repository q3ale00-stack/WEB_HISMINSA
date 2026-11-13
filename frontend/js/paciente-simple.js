// ═══════════════════════════════════════
//  PACIENTES · BÚSQUEDA SIMPLE (pensada para médicos)
// ═══════════════════════════════════════
// Un solo buscador (DNI, nombre o historia clínica), la tarjeta del paciente y su historial en lenguaje sencillo.
// Usa funciones globales de app.js: apiFetch, esc, formatNumber, formatearValor, toast, factGrid,
// reporteMensualHtml, generarReporteMensual, revisarSinadef, registrarExportAtenciones, SEXO, currentUser;
// y de historial.js: histPintar, histFiltrarTexto, histFechaIso, histFechaTexto, histIniciales.

const PS = {
  iniciado: false,
  paciente: null,
  atenciones: [],
  periodo: 'todo',
  texto: '',
  seq: 0,
  sugSeq: 0,
  sugTimer: null,
  sugerencias: [],
  buscando: false,        // hay una búsqueda en pantalla (la lista «Mis pacientes» se oculta)
  mis: { usuario: null, filas: [], total: null, pagina: 0, cargando: false, error: '' }
};

const PS_RECIENTES_CLAVE = 'his_pac_recientes';
const PS_MAX_RECIENTES = 6;
const PS_LISTA_PASO = 20;   // pacientes por página en la lista de resultados
const PS_LISTA_MAX = 100;   // igual a MAX_PACIENTES del backend
const PS_PERIODOS = [
  ['mes', 'Último mes', 1],
  ['seis', 'Últimos 6 meses', 6],
  ['anio', 'Último año', 12],
  ['todo', 'Todo el historial', null]
];

// Edad a partir de la fecha de nacimiento: años; en menores de un año, meses o días.
function psEdad(fechaNacimiento) {
  const f = histFechaIso(fechaNacimiento);
  if (!f) return '';
  const [y, m, d] = f.split('-').map(Number);
  const hoy = new Date();
  let anios = hoy.getFullYear() - y;
  if (hoy.getMonth() + 1 < m || (hoy.getMonth() + 1 === m && hoy.getDate() < d)) anios -= 1;
  if (anios >= 1) return `${anios} ${anios === 1 ? 'año' : 'años'}`;
  const meses = (hoy.getFullYear() - y) * 12 + (hoy.getMonth() + 1 - m) - (hoy.getDate() < d ? 1 : 0);
  if (meses >= 1) return `${meses} ${meses === 1 ? 'mes' : 'meses'}`;
  const dias = Math.max(0, Math.floor((hoy - new Date(y, m - 1, d)) / 86400000));
  return `${dias} ${dias === 1 ? 'día' : 'días'}`;
}

const psSexo = v => SEXO[String(v ?? '').trim()] || '';

// Año y mes de la última atención (para proponerlo en el reporte mensual); sin atenciones, el mes actual.
function psMesUltimaAtencion(p) {
  const f = histFechaIso(p.UltimaAtencion);
  return f ? { anio: Number(f.slice(0, 4)), mes: Number(f.slice(5, 7)) } : null;
}

// ── Pacientes recientes (solo en este navegador) ──
function psLeerRecientes() {
  try { return JSON.parse(localStorage.getItem(PS_RECIENTES_CLAVE) || '[]').filter(r => r && r.id); } catch (_) { return []; }
}
function psGuardarReciente(p) {
  const lista = psLeerRecientes().filter(r => r.id !== p.Id_Paciente);
  lista.unshift({ id: p.Id_Paciente, nombre: p.Paciente, documento: p.Documento, edad: psEdad(p.FechaNacimiento), sexo: psSexo(p.Sexo) });
  try { localStorage.setItem(PS_RECIENTES_CLAVE, JSON.stringify(lista.slice(0, PS_MAX_RECIENTES))); } catch (_) { /* sin almacenamiento */ }
}
function psBorrarRecientes() {
  try { localStorage.removeItem(PS_RECIENTES_CLAVE); } catch (_) { /* sin almacenamiento */ }
  psRenderRecientes();
}

// ── Pantalla ──
function iniciarPacienteSimple() {
  const box = document.getElementById('pacPanelSimple');
  if (PS.iniciado || !box) return;
  PS.iniciado = true;
  const etiqueta = esModoMedico() ? 'Busca entre tus pacientes: DNI, nombre o historia clínica' : 'DNI, nombre o historia clínica del paciente';
  box.innerHTML = `
    <div class="ps-hero">
      <form class="ps-search" id="psForm" role="search" autocomplete="off">
        <svg class="ps-search-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="psInput" type="search" placeholder="${etiqueta}" aria-label="${etiqueta}"
          role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="psSug" enterkeyhint="search">
        <button type="submit" class="btn btn-primary ps-search-btn">Buscar</button>
        <button type="button" class="btn btn-secondary ps-search-btn ps-limpiar-btn" data-ps-limpiar title="Borrar lo escrito y el resultado">Limpiar</button>
        <ul class="ps-sug" id="psSug" role="listbox" hidden></ul>
      </form>
    </div>
    <div id="psRecientes"></div>
    <div id="psResultado" aria-live="polite"></div>
    <div id="psMisPacientes"></div>`;
  psActivarBuscador();
  psRenderRecientes();
}

// ── «Mis pacientes»: lista de los pacientes que atendió el médico, sin necesidad de buscar ──
async function psCargarMisPacientes({ siguiente = false } = {}) {
  const mis = PS.mis;
  if (mis.usuario !== currentUser?.id) Object.assign(mis, { usuario: currentUser?.id, filas: [], total: null, pagina: 0, error: '' });
  if (mis.cargando || (!siguiente && mis.total !== null)) { psRenderMisPacientes(); return; }
  mis.cargando = true;
  mis.error = '';
  psRenderMisPacientes();
  try {
    const datos = await apiFetch(`/busqueda/mis-pacientes?pagina=${mis.pagina + 1}&tam=${PS_LISTA_PASO}`);
    mis.filas.push(...datos.filas);
    mis.total = datos.total;
    mis.pagina += 1;
    mis.sinPersonal = Boolean(datos.sinPersonal);
  } catch (error) {
    mis.error = error.message || 'No se pudo cargar la lista de tus pacientes.';
  } finally {
    mis.cargando = false;
    psRenderMisPacientes();
  }
}

function psRenderMisPacientes() {
  const box = document.getElementById('psMisPacientes');
  if (!box) return;
  box.hidden = !esModoMedico() || Boolean(PS.paciente) || PS.buscando;
  if (box.hidden) return;
  const { filas, total, cargando, error, sinPersonal } = PS.mis;
  if (sinPersonal) {
    box.innerHTML = '<div class="ps-vacio"><h3>Tu cuenta no está ligada a un profesional del HIS</h3><p>Pide a un administrador que la vincule a tu registro de personal para ver a tus pacientes.</p></div>';
    return;
  }
  if (!filas.length) {
    box.innerHTML = error
      ? `<div class="ps-vacio"><h3>No se pudo cargar la lista</h3><p>${esc(error)}</p></div>`
      : total === 0 ? '<div class="ps-vacio"><h3>Todavía no tienes pacientes atendidos en el HIS</h3></div>'
        : '<div class="ps-estado"><span class="ps-spinner" aria-hidden="true"></span>Cargando tus pacientes…</div>';
    return;
  }
  const quedan = total - filas.length;
  box.innerHTML = `<section class="ps-lista ps-mis-pacientes" aria-label="Mis pacientes">
      <h3>Tus pacientes · ${formatNumber(total)} en total</h3>
      <p class="ps-tip">Del más reciente al más antiguo según tu última atención. Usa el buscador de arriba para encontrar a uno en concreto.</p>
      <ul>${filas.map((p, i) => `<li><button type="button" class="ps-lista-item" data-ps-mio="${i}">${psItemPaciente(p, { mia: true })}<span class="ps-chevron" aria-hidden="true">›</span></button></li>`).join('')}</ul>
      ${quedan > 0 ? `<button type="button" class="btn btn-secondary ps-ver-mas" data-ps-mis-mas${cargando ? ' disabled' : ''}>${cargando ? 'Cargando…' : `Ver ${formatNumber(Math.min(PS_LISTA_PASO, quedan))} más`}</button>` : ''}
      ${error ? `<p class="ps-tip">${esc(error)}</p>` : ''}
    </section>`;
  box.querySelectorAll('[data-ps-mio]').forEach(b => b.addEventListener('click', () => abrirPacienteSimple(PS.mis.filas[Number(b.dataset.psMio)])));
  box.querySelector('[data-ps-mis-mas]')?.addEventListener('click', () => psCargarMisPacientes({ siguiente: true }));
}

function psRenderRecientes() {
  const box = document.getElementById('psRecientes');
  if (!box) return;
  // En «Mis pacientes» la lista propia reemplaza a la de recientes.
  if (esModoMedico()) { box.innerHTML = ''; psCargarMisPacientes(); return; }
  const misBox = document.getElementById('psMisPacientes');
  if (misBox) misBox.hidden = true;
  const lista = psLeerRecientes();
  if (!lista.length || PS.paciente) { box.innerHTML = ''; return; }
  box.innerHTML = `<section class="ps-recientes" aria-label="Pacientes recientes">
      <div class="ps-recientes-head"><h3>Pacientes que consultaste hace poco</h3><button type="button" class="ps-link" data-ps-borrar>Borrar lista</button></div>
      <div class="ps-recientes-grid">${lista.map(r => `
        <button type="button" class="ps-reciente" data-ps-abrir="${esc(r.id)}">
          <span class="ps-mini-avatar" aria-hidden="true">${esc(histIniciales(r.nombre))}</span>
          <span class="ps-reciente-text"><strong>${esc(r.nombre || 'Paciente')}</strong><small>${esc([r.documento ? `DNI ${r.documento}` : '', r.edad, r.sexo].filter(Boolean).join(' · '))}</small></span>
        </button>`).join('')}</div>
    </section>`;
  box.querySelector('[data-ps-borrar]').addEventListener('click', psBorrarRecientes);
  box.querySelectorAll('[data-ps-abrir]').forEach(b => b.addEventListener('click', () => abrirPacienteSimplePorId(b.dataset.psAbrir)));
}

// ── Buscador con sugerencias ──
function psActivarBuscador() {
  const form = document.getElementById('psForm');
  const input = document.getElementById('psInput');
  const lista = document.getElementById('psSug');
  form.querySelector('[data-ps-limpiar]').addEventListener('click', () => {
    clearTimeout(PS.sugTimer);
    PS.sugSeq += 1;
    psCerrarSugerencias();
    psCerrarPaciente();
    if (location.hash !== '#pacientes') history.pushState(null, '', '#pacientes');
    input.focus();
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const activo = lista.hidden ? null : lista.querySelector('li.activo');
    if (activo) { psElegir(Number(activo.dataset.i)); return; }
    buscarPacienteSimple(input.value);
  });
  input.addEventListener('input', () => {
    clearTimeout(PS.sugTimer);
    const texto = input.value.trim();
    if (texto.length < 2) { psCerrarSugerencias(); return; }
    PS.sugTimer = setTimeout(() => psCargarSugerencias(texto), 250);
  });
  input.addEventListener('keydown', event => {
    if (lista.hidden) return;
    const items = [...lista.querySelectorAll('li[data-i]')];
    if (!items.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const actual = items.findIndex(li => li.classList.contains('activo'));
      const sig = event.key === 'ArrowDown' ? Math.min(items.length - 1, actual + 1) : Math.max(0, actual - 1);
      items.forEach((li, i) => { li.classList.toggle('activo', i === sig); li.setAttribute('aria-selected', String(i === sig)); });
      items[sig].scrollIntoView({ block: 'nearest' });
    }
    if (event.key === 'Escape') psCerrarSugerencias();
  });
  input.addEventListener('blur', () => setTimeout(psCerrarSugerencias, 150));
  lista.addEventListener('mousedown', event => {
    const li = event.target.closest('li[data-i]');
    if (!li) return;
    event.preventDefault();
    psElegir(Number(li.dataset.i));
  });
}

function psCerrarSugerencias() {
  const lista = document.getElementById('psSug');
  if (!lista) return;
  lista.hidden = true;
  document.getElementById('psInput')?.setAttribute('aria-expanded', 'false');
}

// mia: en «Mis pacientes» la fecha y el número de citas son los del médico con ese paciente.
function psItemPaciente(p, { mia = false } = {}) {
  const datos = [p.Documento ? `DNI ${p.Documento}` : '', psEdad(p.FechaNacimiento), psSexo(p.Sexo), p.Historia_Clinica ? `H.C. ${p.Historia_Clinica}` : ''].filter(Boolean);
  const ultima = histFechaTexto(p.UltimaAtencion);
  const etiqueta = mia ? `Tu última atención${p.Atenciones > 1 ? ` · ${formatNumber(p.Atenciones)} citas` : ''}` : 'Última atención';
  return `<span class="ps-mini-avatar" aria-hidden="true">${esc(histIniciales(p.Paciente))}</span>
    <span class="ps-item-text"><strong>${esc(p.Paciente || 'Sin nombre')}</strong><small>${esc(datos.join(' · '))}</small></span>
    <span class="ps-item-ultima">${ultima ? `${esc(etiqueta)}<br><b>${esc(ultima)}</b>` : '<em>Sin atenciones</em>'}</span>`;
}

async function psCargarSugerencias(texto) {
  const seq = ++PS.sugSeq;
  const lista = document.getElementById('psSug');
  try {
    const filas = await apiFetch(`/busqueda/pacientes/sugerencias?q=${encodeURIComponent(texto)}`);
    if (seq !== PS.sugSeq || document.getElementById('psInput').value.trim() !== texto) return;
    PS.sugerencias = filas;
    lista.innerHTML = filas.length
      ? filas.map((p, i) => `<li role="option" data-i="${i}" aria-selected="false">${psItemPaciente(p)}</li>`).join('')
      : '<li class="ps-sug-vacio">No hay pacientes con ese dato. Revisa que esté bien escrito.</li>';
    lista.hidden = false;
    document.getElementById('psInput').setAttribute('aria-expanded', 'true');
  } catch (_) {
    psCerrarSugerencias();
  }
}

function psElegir(i) {
  const p = PS.sugerencias[i];
  if (!p) return;
  clearTimeout(PS.sugTimer);
  PS.sugSeq += 1;
  psCerrarSugerencias();
  document.getElementById('psInput').value = p.Paciente || p.Documento || '';
  abrirPacienteSimple(p);
}

// Busca con lo escrito: si hay un solo paciente lo abre; si hay varios, los muestra para elegir.
// «Ver más» repite la búsqueda con un límite mayor, sin borrar la lista mientras carga.
async function buscarPacienteSimple(texto, { limite = PS_LISTA_PASO } = {}) {
  const verMas = limite > PS_LISTA_PASO;
  iniciarPacienteSimple();
  cambiarTabPacientes('simple', { recordar: false });
  const valor = String(texto || '').trim();
  const input = document.getElementById('psInput');
  input.value = valor;
  if (valor.length < 2) { toast('Escribe al menos 2 letras o números del paciente.', 'info'); input.focus(); return; }
  // Se cancelan las sugerencias pendientes para que no se abran encima del resultado.
  clearTimeout(PS.sugTimer);
  PS.sugSeq += 1;
  psCerrarSugerencias();
  const seq = ++PS.seq;
  PS.paciente = null;
  PS.buscando = true;
  document.getElementById('pacPanelSimple')?.classList.remove('ps-con-paciente');
  psRenderRecientes();
  const res = document.getElementById('psResultado');
  const botonMas = verMas ? res.querySelector('[data-ps-mas]') : null;
  if (botonMas) { botonMas.disabled = true; botonMas.textContent = 'Cargando…'; }
  else res.innerHTML = '<div class="ps-estado"><span class="ps-spinner" aria-hidden="true"></span>Buscando al paciente…</div>';
  try {
    // Se pide uno más del límite para saber si quedan pacientes por mostrar.
    const recibidas = await apiFetch(`/busqueda/pacientes/sugerencias?q=${encodeURIComponent(valor)}&limite=${limite + 1}`);
    if (seq !== PS.seq) return;
    const hayMas = recibidas.length > limite;
    const filas = recibidas.slice(0, limite);
    PS.sugerencias = filas;
    if (filas.length === 1) { abrirPacienteSimple(filas[0]); return; }
    if (!filas.length) {
      res.innerHTML = `<div class="ps-vacio"><h3>No encontramos a ningún paciente${esModoMedico() ? ' tuyo' : ''} con «${esc(valor)}»</h3>
        <ul>${esModoMedico() ? '<li>Solo aparecen los pacientes que has atendido.</li>' : ''}<li>Revisa que el DNI tenga todos sus números.</li><li>Prueba solo con el apellido y el primer nombre.</li><li>Si tienes el número de historia clínica, búscalo con él.</li></ul></div>`;
      return;
    }
    const puedeVerMas = hayMas && limite < PS_LISTA_MAX;
    res.innerHTML = `<section class="ps-lista"><h3>${hayMas ? `Mostramos ${filas.length} de muchos pacientes` : `Encontramos ${filas.length} pacientes`}. Elige uno:</h3>
      <ul>${filas.map((p, i) => `<li><button type="button" class="ps-lista-item" data-ps-i="${i}">${psItemPaciente(p)}<span class="ps-chevron" aria-hidden="true">›</span></button></li>`).join('')}</ul>
      ${puedeVerMas ? `<button type="button" class="btn btn-secondary ps-ver-mas" data-ps-mas>Ver ${PS_LISTA_PASO} más</button>` : ''}
      ${hayMas ? `<p class="ps-tip">Si no aparece, escribe también el apellido${limite >= PS_LISTA_MAX ? ' o usa la Búsqueda avanzada' : ''}.</p>` : ''}</section>`;
    res.querySelectorAll('[data-ps-i]').forEach(b => b.addEventListener('click', () => abrirPacienteSimple(PS.sugerencias[Number(b.dataset.psI)])));
    res.querySelector('[data-ps-mas]')?.addEventListener('click', () => buscarPacienteSimple(valor, { limite: Math.min(PS_LISTA_MAX, limite + PS_LISTA_PASO) }));
  } catch (error) {
    if (seq !== PS.seq) return;
    if (botonMas?.isConnected) { botonMas.disabled = false; botonMas.textContent = `Ver ${PS_LISTA_PASO} más`; toast(error.message || 'No se pudieron cargar más pacientes.', 'error'); }
    else res.innerHTML = `<div class="ps-vacio"><h3>No se pudo buscar</h3><p>${esc(error.message || 'Intenta nuevamente.')}</p></div>`;
  }
}

async function abrirPacienteSimplePorId(id) {
  iniciarPacienteSimple();
  cambiarTabPacientes('simple', { recordar: false });
  const res = document.getElementById('psResultado');
  res.innerHTML = '<div class="ps-estado"><span class="ps-spinner" aria-hidden="true"></span>Abriendo al paciente…</div>';
  try {
    const filas = await apiFetch(`/busqueda/pacientes/sugerencias?id=${encodeURIComponent(id)}`);
    if (filas[0]) abrirPacienteSimple(filas[0]);
    else res.innerHTML = '<div class="ps-vacio"><h3>Ya no se encontró a este paciente</h3></div>';
  } catch (error) {
    res.innerHTML = `<div class="ps-vacio"><h3>No se pudo abrir al paciente</h3><p>${esc(error.message || '')}</p></div>`;
  }
}

// Cierra la ficha y vuelve al buscador con los pacientes recientes.
function psCerrarPaciente() {
  PS.seq += 1;
  PS.paciente = null;
  PS.buscando = false;
  document.getElementById('pacPanelSimple')?.classList.remove('ps-con-paciente');
  const res = document.getElementById('psResultado');
  if (res) res.innerHTML = '';
  psRenderRecientes();
  const input = document.getElementById('psInput');
  if (input) input.value = '';
}

// ── Tarjeta e historial ──
async function abrirPacienteSimple(p) {
  const seq = ++PS.seq;
  // La ficha queda en la URL (#pacientes/Id_Paciente) para volver a ella al recargar.
  const destino = `#pacientes/${encodeURIComponent(p.Id_Paciente ?? '')}`;
  const enPacientes = document.getElementById('view-pacientes')?.classList.contains('active');
  if (p.Id_Paciente != null && enPacientes && location.hash !== destino) history.pushState(null, '', destino);
  PS.paciente = p;
  PS.atenciones = [];
  PS.periodo = 'todo';
  PS.texto = '';
  document.getElementById('pacPanelSimple')?.classList.add('ps-con-paciente');
  psGuardarReciente(p);
  psRenderRecientes();
  const res = document.getElementById('psResultado');
  const edad = psEdad(p.FechaNacimiento);
  const sexo = psSexo(p.Sexo);
  const dato = (titulo, valor) => `<div class="ps-dato"><dt>${titulo}</dt><dd>${valor ? esc(valor) : '<span class="ps-nd">No registrado</span>'}</dd></div>`;
  res.innerHTML = `
    <div class="ps-ficha-grid">
    <div class="ps-ficha-izq">
    <article class="ps-card">
      <div class="ps-card-top">
        <span class="ps-avatar" aria-hidden="true">${esc(histIniciales(p.Paciente))}</span>
        <div class="ps-card-id">
          <h2>${esc(p.Paciente || 'Paciente sin nombre')}</h2>
          <div class="ps-tags">${edad ? `<span>${esc(edad)}</span>` : ''}${sexo ? `<span>${esc(sexo)}</span>` : ''}${p.FechaNacimiento ? `<span>Nació el ${esc(histFechaTexto(p.FechaNacimiento))}</span>` : ''}</div>
        </div>
        <div class="ps-card-actions">
          <button type="button" class="btn btn-secondary" data-ps-nuevo>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg> Buscar otro paciente</button>
        </div>
      </div>
      <div id="fichaSinadef"></div>
      <dl class="ps-datos">
        ${dato('DNI', p.Documento)}
        ${dato('Historia clínica', p.Historia_Clinica)}
        ${dato('Establecimiento', p.Establecimiento)}
        ${dato('Última atención', histFechaTexto(p.UltimaAtencion))}
        ${dato('Atenciones registradas', p.Atenciones ? formatNumber(p.Atenciones) : '0')}
      </dl>
      <details class="ps-mas" id="psMas"><summary>Ver todos los datos del paciente</summary><div class="ps-mas-body">Cargando…</div></details>
    </article>
    <section class="ps-card ps-frecuentes" id="psFrecuentes" aria-label="Diagnósticos y procedimientos más frecuentes" hidden></section>
    </div>
    <aside class="ps-ficha-lado" aria-label="Reporte y resumen">
      <div class="ps-card ps-reporte">${reporteMensualHtml(p, 'paciente', psMesUltimaAtencion(p))}</div>
      <div id="psResumen"></div>
    </aside>
    </div>
    <div class="ps-reporte-ancho" id="psReporteAncho"></div>
    <section class="ps-historial" aria-label="Historial de atenciones">
      <div class="ps-historial-head">
        <h3>Historial de atenciones</h3>
        <div class="ps-historial-acciones" id="psAccionesHistorial"></div>
      </div>
      <div class="ps-filtros">
        <div class="ps-periodos" role="group" aria-label="Periodo del historial" id="psPeriodos"></div>
        <label class="ps-buscar-hist">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input type="search" class="input" id="psBuscarHist" placeholder="Buscar diagnóstico, código, servicio o profesional" aria-label="Buscar en el historial">
        </label>
      </div>
      <div id="psTimeline"><div class="ps-estado"><span class="ps-spinner" aria-hidden="true"></span>Cargando el historial…</div></div>
    </section>`;
  res.querySelector('[data-ps-nuevo]').addEventListener('click', () => {
    psCerrarPaciente();
    if (location.hash !== '#pacientes') history.pushState(null, '', '#pacientes');
    document.getElementById('psInput').focus();
    document.getElementById('pacPanelSimple').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  res.querySelector('#psMas').addEventListener('toggle', event => { if (event.target.open) psCargarMasDatos(p); }, { once: true });
  res.querySelector('#rmpGenerar').addEventListener('click', event => generarReporteMensual(event.currentTarget.dataset.id, 'paciente'));
  // El reporte generado (tabla día por día) es ancho: se muestra debajo de las dos columnas.
  res.querySelector('#psReporteAncho').append(res.querySelector('#rmpResultado'));
  let buscarTimer = null;
  res.querySelector('#psBuscarHist').addEventListener('input', event => {
    clearTimeout(buscarTimer);
    buscarTimer = setTimeout(() => { PS.texto = event.target.value.trim(); if (PS.atenciones.length) psRenderHistorial(); }, 200);
  });
  res.scrollIntoView({ behavior: 'smooth', block: 'start' });
  revisarSinadef(p.Documento);
  try {
    const filas = await apiFetch(`/busqueda/pacientes/${encodeURIComponent(p.Id_Paciente)}/atenciones`);
    if (seq !== PS.seq) return;
    PS.atenciones = filas;
    psRenderHistorial();
  } catch (error) {
    if (seq === PS.seq) document.getElementById('psTimeline').innerHTML = `<div class="ps-vacio"><h3>No se pudo cargar el historial</h3><p>${esc(error.message || '')}</p></div>`;
  }
}

async function psCargarMasDatos(p) {
  const body = document.querySelector('#psMas .ps-mas-body');
  try {
    const filas = await apiFetch(`/busqueda/pacientes?q=${encodeURIComponent(p.Id_Paciente)}`);
    const x = filas.find(f => String(f.Id_Paciente) === String(p.Id_Paciente)) || filas[0];
    if (!x) { body.textContent = 'No se encontraron más datos.'; return; }
    body.innerHTML = factGrid(x, ['Id_Paciente', 'Id_Tipo_Documento_Paciente', 'Numero_Documento_Paciente', 'Fecha_Nacimiento_Paciente', 'Id_Genero', 'Id_Etnia',
      'Historia_Clinica', 'Ficha_Familiar', 'Domicilio_Reniec', 'Domicilio_Declarado', 'Referencia_Domicilio', 'Ubigeo_Reniec', 'Ubigeo_Declarado', 'Id_Pais', 'Id_Establecimiento', 'Fecha_Alta']);
  } catch (error) {
    body.textContent = error.message || 'No se pudieron cargar los datos.';
  }
}

// Atenciones dentro del periodo elegido (contado desde hoy).
function psFiltrarPeriodo(clave) {
  const meses = PS_PERIODOS.find(p => p[0] === clave)?.[2];
  if (!meses) return PS.atenciones;
  const desde = new Date();
  desde.setMonth(desde.getMonth() - meses);
  const limite = `${desde.getFullYear()}-${String(desde.getMonth() + 1).padStart(2, '0')}-${String(desde.getDate()).padStart(2, '0')}`;
  return PS.atenciones.filter(r => histFechaIso(r.Fecha_Atencion) >= limite);
}

function psRenderHistorial() {
  const p = PS.paciente;
  const resumen = document.getElementById('psResumen');
  const frecuentes = document.getElementById('psFrecuentes');
  if (resumen) resumen.innerHTML = '';
  if (frecuentes) frecuentes.hidden = true;
  const periodos = document.getElementById('psPeriodos');
  periodos.innerHTML = PS_PERIODOS.map(([clave, texto]) => {
    const n = histContarCitas(psFiltrarPeriodo(clave));
    return `<button type="button" class="ps-periodo${PS.periodo === clave ? ' on' : ''}" data-periodo="${clave}" aria-pressed="${PS.periodo === clave}">${texto}<span>${formatNumber(n)}</span></button>`;
  }).join('');
  periodos.querySelectorAll('[data-periodo]').forEach(b => b.addEventListener('click', () => { PS.periodo = b.dataset.periodo; psRenderHistorial(); }));

  const enPeriodo = psFiltrarPeriodo(PS.periodo);
  const filas = histFiltrarTexto(enPeriodo, PS.texto);
  const periodoTexto = PS_PERIODOS.find(x => x[0] === PS.periodo)[1];
  registrarExportAtenciones('psHistorial', filas, 'Historial de atenciones del paciente', [
    ['Paciente', p.Paciente], ['DNI', p.Documento], ['Historia clínica', p.Historia_Clinica],
    ['Edad', psEdad(p.FechaNacimiento)], ['Sexo', psSexo(p.Sexo)], ['Periodo', periodoTexto],
    ...(PS.texto ? [['Búsqueda', PS.texto]] : [])
  ], 'historial-paciente');
  document.getElementById('psAccionesHistorial').innerHTML = filas.length
    ? `<button type="button" class="btn btn-primary ps-imprimir" data-export="psHistorial" data-formato="pdf">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/></svg>
        Imprimir historial</button>
       <button type="button" class="btn btn-secondary" data-export="psHistorial" data-formato="excel">Excel</button>`
    : '';

  const timeline = document.getElementById('psTimeline');
  if (!PS.atenciones.length) { timeline.innerHTML = '<div class="ps-vacio"><h3>Este paciente no tiene atenciones registradas</h3></div>'; return; }
  if (!enPeriodo.length) {
    timeline.innerHTML = `<div class="ps-vacio"><h3>No tiene atenciones en «${esc(periodoTexto.toLowerCase())}»</h3><button type="button" class="btn btn-secondary" data-periodo-todo>Ver todo el historial</button></div>`;
    timeline.querySelector('[data-periodo-todo]').addEventListener('click', () => { PS.periodo = 'todo'; psRenderHistorial(); });
    return;
  }
  if (!filas.length) {
    timeline.innerHTML = `<div class="ps-vacio"><h3>Ninguna atención coincide con «${esc(PS.texto)}»</h3><button type="button" class="btn btn-secondary" data-quitar-busqueda>Quitar búsqueda</button></div>`;
    timeline.querySelector('[data-quitar-busqueda]').addEventListener('click', () => { PS.texto = ''; document.getElementById('psBuscarHist').value = ''; psRenderHistorial(); });
    return;
  }
  const limite = 1000;
  const aviso = PS.atenciones.length >= limite ? `<p class="ps-tip">Se muestran las ${formatNumber(limite)} anotaciones más recientes del paciente.</p>` : '';
  histPintar(timeline, filas, { contexto: 'paciente', establecimiento: p.Establecimiento, resumenEn: resumen, frecuentesEn: frecuentes }, aviso);
}


// ── Ficha resumida automática ──
// Cuando una búsqueda (avanzada o «Mis atenciones») corresponde a una sola persona, se muestran sus datos encima
// de los resultados sin que haya que abrir la ficha. Los datos se piden una vez por paciente.
const PS_MINI = new Map();

async function psDatosPaciente(id) {
  const clave = String(id);
  if (!PS_MINI.has(clave)) {
    PS_MINI.set(clave, apiFetch(`/busqueda/pacientes/sugerencias?id=${encodeURIComponent(clave)}`)
      .then(filas => filas[0] || null)
      .catch(error => { PS_MINI.delete(clave); throw error; }));
  }
  return PS_MINI.get(clave);
}

function psMiniFichaHtml(p) {
  const dato = (titulo, valor) => (valor ? `<div><dt>${esc(titulo)}</dt><dd>${esc(valor)}</dd></div>` : '');
  const ultima = histFechaTexto(p.UltimaAtencion);
  return `<article class="pac-mini-ficha" aria-label="Datos del paciente">
      <span class="ps-avatar" aria-hidden="true">${esc(histIniciales(p.Paciente))}</span>
      <div class="pac-mini-cuerpo">
        <h3>${esc(p.Paciente || 'Paciente sin nombre')}</h3>
        <dl>
          ${dato('DNI', p.Documento)}${dato('Edad', psEdad(p.FechaNacimiento))}${dato('Sexo', psSexo(p.Sexo))}
          ${dato('Historia clínica', p.Historia_Clinica)}${dato('Establecimiento', p.Establecimiento ? histCasoNombre(p.Establecimiento) : '')}
          ${dato('Última atención', ultima)}${dato('Atenciones', p.Atenciones ? formatNumber(p.Atenciones) : '')}
          ${dato('Domicilio', p.Domicilio_Declarado || p.Domicilio_Reniec)}
        </dl>
      </div>
      <button type="button" class="btn btn-primary btn-sm" data-mini-abrir="${esc(p.Id_Paciente)}">Ver historia completa</button>
    </article>`;
}

// Pinta la ficha del paciente «id» en «caja» (o la vacía si no hay id). Ignora respuestas que llegan tarde.
async function psMostrarMiniFicha(caja, id) {
  if (!caja) return;
  const turno = String(Date.now() + Math.random());
  caja.dataset.turno = turno;
  if (!id) { caja.innerHTML = ''; return; }
  try {
    const p = await psDatosPaciente(id);
    if (caja.dataset.turno !== turno) return;
    caja.innerHTML = p ? psMiniFichaHtml(p) : '';
    caja.querySelector('[data-mini-abrir]')?.addEventListener('click', event => {
      showView('pacientes');
      abrirPacienteSimplePorId(event.currentTarget.dataset.miniAbrir);
    });
  } catch (_) {
    if (caja.dataset.turno === turno) caja.innerHTML = '';
  }
}

// Id del único paciente de unas filas, o '' si hay varios o ninguno.
function psPacienteUnico(filas) {
  const ids = new Set((filas || []).map(r => String(r.Id_Paciente ?? '').trim()).filter(Boolean));
  return ids.size === 1 ? [...ids][0] : '';
}
