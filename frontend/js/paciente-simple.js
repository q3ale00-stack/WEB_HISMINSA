// ═══════════════════════════════════════
//  PACIENTES · BÚSQUEDA SIMPLE (pensada para médicos)
// ═══════════════════════════════════════
// Un solo buscador (DNI, nombre o historia clínica), la tarjeta del paciente y su historial en lenguaje sencillo.
// Usa funciones globales de app.js: apiFetch, esc, formatNumber, formatearValor, toast, verAtencion, factGrid,
// revisarSinadef, registrarExportAtenciones, botonesExportarHtml, SEXO, TIPOS_DX, currentUser.

const PS = {
  iniciado: false,
  paciente: null,
  atenciones: [],
  periodo: 'todo',
  seq: 0,
  sugSeq: 0,
  sugTimer: null,
  sugerencias: []
};

const PS_RECIENTES_CLAVE = 'his_pac_recientes';
const PS_MAX_RECIENTES = 6;
const PS_MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];
const PS_DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const PS_PERIODOS = [
  ['mes', 'Último mes', 1],
  ['seis', 'Últimos 6 meses', 6],
  ['anio', 'Último año', 12],
  ['todo', 'Todo el historial', null]
];

const psFechaIso = v => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : '');
const psFechaTexto = v => { const f = psFechaIso(v); return f ? f.split('-').reverse().join('/') : ''; };

function psIniciales(nombre) {
  const partes = String(nombre || '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '?';
  return (partes[0][0] + (partes.length > 2 ? partes[2][0] : partes[1]?.[0] || '')).toUpperCase();
}

// Edad a partir de la fecha de nacimiento: años; en menores de un año, meses o días.
function psEdad(fechaNacimiento) {
  const f = psFechaIso(fechaNacimiento);
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
  box.innerHTML = `
    <div class="ps-hero">
      <form class="ps-search" id="psForm" role="search" autocomplete="off">
        <svg class="ps-search-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="psInput" type="search" placeholder="DNI, nombre o historia clínica del paciente" aria-label="DNI, nombre o historia clínica del paciente"
          role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="psSug" enterkeyhint="search">
        <button type="submit" class="btn btn-primary ps-search-btn">Buscar</button>
        <ul class="ps-sug" id="psSug" role="listbox" hidden></ul>
      </form>
    </div>
    <div id="psRecientes"></div>
    <div id="psResultado" aria-live="polite"></div>`;
  psActivarBuscador();
  psRenderRecientes();
}

function psRenderRecientes() {
  const box = document.getElementById('psRecientes');
  if (!box) return;
  const lista = psLeerRecientes();
  if (!lista.length || PS.paciente) { box.innerHTML = ''; return; }
  box.innerHTML = `<section class="ps-recientes" aria-label="Pacientes recientes">
      <div class="ps-recientes-head"><h3>Pacientes que consultaste hace poco</h3><button type="button" class="ps-link" data-ps-borrar>Borrar lista</button></div>
      <div class="ps-recientes-grid">${lista.map(r => `
        <button type="button" class="ps-reciente" data-ps-abrir="${esc(r.id)}">
          <span class="ps-mini-avatar" aria-hidden="true">${esc(psIniciales(r.nombre))}</span>
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

function psItemPaciente(p) {
  const datos = [p.Documento ? `DNI ${p.Documento}` : '', psEdad(p.FechaNacimiento), psSexo(p.Sexo), p.Historia_Clinica ? `H.C. ${p.Historia_Clinica}` : ''].filter(Boolean);
  const ultima = psFechaTexto(p.UltimaAtencion);
  return `<span class="ps-mini-avatar" aria-hidden="true">${esc(psIniciales(p.Paciente))}</span>
    <span class="ps-item-text"><strong>${esc(p.Paciente || 'Sin nombre')}</strong><small>${esc(datos.join(' · '))}</small></span>
    <span class="ps-item-ultima">${ultima ? `Última atención<br><b>${esc(ultima)}</b>` : '<em>Sin atenciones</em>'}</span>`;
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
async function buscarPacienteSimple(texto) {
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
  document.getElementById('pacPanelSimple')?.classList.remove('ps-con-paciente');
  psRenderRecientes();
  const res = document.getElementById('psResultado');
  res.innerHTML = '<div class="ps-estado"><span class="ps-spinner" aria-hidden="true"></span>Buscando al paciente…</div>';
  try {
    const filas = await apiFetch(`/busqueda/pacientes/sugerencias?q=${encodeURIComponent(valor)}`);
    if (seq !== PS.seq) return;
    PS.sugerencias = filas;
    if (filas.length === 1) { abrirPacienteSimple(filas[0]); return; }
    if (!filas.length) {
      res.innerHTML = `<div class="ps-vacio"><h3>No encontramos a ningún paciente con «${esc(valor)}»</h3>
        <ul><li>Revisa que el DNI tenga todos sus números.</li><li>Prueba solo con el apellido y el primer nombre.</li><li>Si tienes el número de historia clínica, búscalo con él.</li></ul></div>`;
      return;
    }
    res.innerHTML = `<section class="ps-lista"><h3>Encontramos ${filas.length}${filas.length >= 8 ? ' o más' : ''} pacientes. Elige uno:</h3>
      <ul>${filas.map((p, i) => `<li><button type="button" class="ps-lista-item" data-ps-i="${i}">${psItemPaciente(p)}<span class="ps-chevron" aria-hidden="true">›</span></button></li>`).join('')}</ul>
      ${filas.length >= 8 ? '<p class="ps-tip">Si no aparece, escribe también el segundo apellido o el nombre.</p>' : ''}</section>`;
    res.querySelectorAll('[data-ps-i]').forEach(b => b.addEventListener('click', () => abrirPacienteSimple(PS.sugerencias[Number(b.dataset.psI)])));
  } catch (error) {
    if (seq === PS.seq) res.innerHTML = `<div class="ps-vacio"><h3>No se pudo buscar</h3><p>${esc(error.message || 'Intenta nuevamente.')}</p></div>`;
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

// ── Tarjeta e historial ──
async function abrirPacienteSimple(p) {
  const seq = ++PS.seq;
  PS.paciente = p;
  PS.atenciones = [];
  PS.periodo = 'todo';
  document.getElementById('pacPanelSimple')?.classList.add('ps-con-paciente');
  psGuardarReciente(p);
  psRenderRecientes();
  const res = document.getElementById('psResultado');
  const edad = psEdad(p.FechaNacimiento);
  const sexo = psSexo(p.Sexo);
  const dato = (titulo, valor) => `<div class="ps-dato"><dt>${titulo}</dt><dd>${valor ? esc(valor) : '<span class="ps-nd">No registrado</span>'}</dd></div>`;
  res.innerHTML = `
    <article class="ps-card">
      <div class="ps-card-top">
        <span class="ps-avatar" aria-hidden="true">${esc(psIniciales(p.Paciente))}</span>
        <div class="ps-card-id">
          <h2>${esc(p.Paciente || 'Paciente sin nombre')}</h2>
          <div class="ps-tags">${edad ? `<span>${esc(edad)}</span>` : ''}${sexo ? `<span>${esc(sexo)}</span>` : ''}${p.FechaNacimiento ? `<span>Nació el ${esc(psFechaTexto(p.FechaNacimiento))}</span>` : ''}</div>
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
        ${dato('Última atención', psFechaTexto(p.UltimaAtencion))}
        ${dato('Atenciones registradas', p.Atenciones ? formatNumber(p.Atenciones) : '0')}
      </dl>
      <details class="ps-mas" id="psMas"><summary>Ver todos los datos del paciente</summary><div class="ps-mas-body">Cargando…</div></details>
    </article>
    <section class="ps-historial" aria-label="Historial de atenciones">
      <div class="ps-historial-head">
        <h3>Historial de atenciones</h3>
        <div class="ps-historial-acciones" id="psAccionesHistorial"></div>
      </div>
      <div class="ps-periodos" role="group" aria-label="Periodo del historial" id="psPeriodos"></div>
      <div id="psTimeline"><div class="ps-estado"><span class="ps-spinner" aria-hidden="true"></span>Cargando el historial…</div></div>
    </section>`;
  res.querySelector('[data-ps-nuevo]').addEventListener('click', () => {
    PS.paciente = null;
    document.getElementById('pacPanelSimple')?.classList.remove('ps-con-paciente');
    res.innerHTML = '';
    psRenderRecientes();
    const input = document.getElementById('psInput');
    input.value = '';
    input.focus();
    document.getElementById('pacPanelSimple').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  res.querySelector('#psMas').addEventListener('toggle', event => { if (event.target.open) psCargarMasDatos(p); }, { once: true });
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
  return PS.atenciones.filter(r => psFechaIso(r.Fecha_Atencion) >= limite);
}

const psContarCitas = filas => new Set(filas.map((r, i) => String(r.Id_Cita ?? `__${i}`))).size;

function psRenderHistorial() {
  const p = PS.paciente;
  const periodos = document.getElementById('psPeriodos');
  periodos.innerHTML = PS_PERIODOS.map(([clave, texto]) => {
    const n = psContarCitas(psFiltrarPeriodo(clave));
    return `<button type="button" class="ps-periodo${PS.periodo === clave ? ' on' : ''}" data-periodo="${clave}" aria-pressed="${PS.periodo === clave}">${texto}<span>${formatNumber(n)}</span></button>`;
  }).join('');
  periodos.querySelectorAll('[data-periodo]').forEach(b => b.addEventListener('click', () => { PS.periodo = b.dataset.periodo; psRenderHistorial(); }));

  const filas = psFiltrarPeriodo(PS.periodo);
  const periodoTexto = PS_PERIODOS.find(x => x[0] === PS.periodo)[1];
  registrarExportAtenciones('psHistorial', filas, 'Historial de atenciones del paciente', [
    ['Paciente', p.Paciente], ['DNI', p.Documento], ['Historia clínica', p.Historia_Clinica],
    ['Edad', psEdad(p.FechaNacimiento)], ['Sexo', psSexo(p.Sexo)], ['Periodo', periodoTexto]
  ], 'historial-paciente');
  document.getElementById('psAccionesHistorial').innerHTML = filas.length
    ? `<button type="button" class="btn btn-primary ps-imprimir" data-export="psHistorial" data-formato="pdf">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/></svg>
        Imprimir historial</button>
       <button type="button" class="btn btn-secondary" data-export="psHistorial" data-formato="excel">Excel</button>`
    : '';

  const timeline = document.getElementById('psTimeline');
  if (!PS.atenciones.length) { timeline.innerHTML = '<div class="ps-vacio"><h3>Este paciente no tiene atenciones registradas</h3></div>'; return; }
  if (!filas.length) {
    timeline.innerHTML = `<div class="ps-vacio"><h3>No tiene atenciones en «${esc(periodoTexto.toLowerCase())}»</h3><button type="button" class="btn btn-secondary" data-periodo-todo>Ver todo el historial</button></div>`;
    timeline.querySelector('[data-periodo-todo]').addEventListener('click', () => { PS.periodo = 'todo'; psRenderHistorial(); });
    return;
  }
  // Una entrada por atención (cita), de la más reciente a la más antigua.
  const porCita = new Map();
  filas.forEach((r, i) => {
    const clave = r.Id_Cita ? String(r.Id_Cita) : `__${i}`;
    if (!porCita.has(clave)) porCita.set(clave, []);
    porCita.get(clave).push(r);
  });
  const entradas = [...porCita.values()].sort((a, b) => psFechaIso(b[0].Fecha_Atencion).localeCompare(psFechaIso(a[0].Fecha_Atencion)));
  const limite = 1000;
  timeline.innerHTML = `${PS.atenciones.length >= limite ? `<p class="ps-tip">Se muestran las ${formatNumber(limite)} anotaciones más recientes del paciente.</p>` : ''}
    <ol class="ps-timeline">${entradas.map(psEntradaHtml).join('')}</ol>`;
  timeline.querySelectorAll('[data-ps-ver]').forEach(b => b.addEventListener('click', () => {
    const [ci, ri] = b.dataset.psVer.split(':').map(Number);
    verAtencion(entradas[ci][ri]);
  }));
}

function psEntradaHtml(registros, indice) {
  const r = registros[0];
  const f = psFechaIso(r.Fecha_Atencion);
  let fecha = '<span class="ps-ev-dia">?</span><span class="ps-ev-mes">Sin fecha</span>';
  if (f) {
    const [y, m, d] = f.split('-').map(Number);
    fecha = `<span class="ps-ev-dia">${d}</span><span class="ps-ev-mes">${PS_MESES[m - 1]} ${y}</span><span class="ps-ev-semana">${PS_DIAS[new Date(y, m - 1, d).getDay()]}</span>`;
  }
  const items = registros.map(x => {
    const codigo = String(x.Codigo_Item ?? '').trim();
    const esProcedimiento = /^\d/.test(codigo);
    const tipo = String(x.Tipo_Diagnostico ?? '').trim().toUpperCase();
    const etiqueta = esProcedimiento ? ['Procedimiento', 'proc'] : TIPOS_DX[tipo] ? [TIPOS_DX[tipo], `dx-${tipo.toLowerCase()}`] : null;
    const lab = String(x.Valor_Lab ?? '').trim();
    return `<li>
      ${etiqueta ? `<span class="ps-tag ps-tag-${etiqueta[1]}">${etiqueta[0]}</span>` : ''}
      <span class="ps-item-desc">${esc(x.DescItem || 'Sin descripción')}</span>
      <span class="ps-item-cod">${esc(codigo)}${lab ? ` · valor ${esc(lab)}` : ''}</span>
    </li>`;
  }).join('');
  const medidas = [
    r.Peso ? `Peso <b>${esc(r.Peso)} kg</b>` : '', r.Talla ? `Talla <b>${esc(r.Talla)} cm</b>` : '',
    r.Hemoglobina ? `Hemoglobina <b>${esc(r.Hemoglobina)}</b>` : '', r.Perimetro_Abdominal ? `Perímetro abdominal <b>${esc(r.Perimetro_Abdominal)} cm</b>` : '',
    r.Perimetro_Cefalico ? `Perímetro cefálico <b>${esc(r.Perimetro_Cefalico)} cm</b>` : ''
  ].filter(Boolean);
  const cita = r.Id_Cita;
  return `<li class="ps-ev">
    <div class="ps-ev-fecha">${fecha}</div>
    <div class="ps-ev-card">
      <div class="ps-ev-head">
        <div>
          <h4>${esc(r.Servicio || 'Atención')}</h4>
          ${r.Personal ? `<p class="ps-ev-quien">Atendido por <strong>${esc(r.Personal)}</strong></p>` : ''}
        </div>
        <div class="ps-ev-acciones">
          ${cita ? `<button type="button" class="btn btn-secondary btn-sm" data-export="cita" data-cita="${esc(cita)}" data-formato="pdf" title="Imprimir esta atención">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/></svg> Imprimir</button>` : ''}
          <button type="button" class="btn btn-secondary btn-sm" data-ps-ver="${indice}:0">Ver detalle</button>
        </div>
      </div>
      <p class="ps-ev-sub">Diagnósticos y procedimientos</p>
      <ul class="ps-items">${items}</ul>
      ${medidas.length ? `<p class="ps-medidas">${medidas.join('<span aria-hidden="true">·</span>')}</p>` : ''}
    </div>
  </li>`;
}
