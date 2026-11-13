// ═══════════════════════════════════════
//  PERSONAL · BÚSQUEDA SIMPLE (igual que la de pacientes)
// ═══════════════════════════════════════
// Un solo buscador (DNI, nombre o ID), la tarjeta del profesional y las atenciones que registró.
// Reutiliza el diseño de paciente-simple.js (clases ps-*) con sus propios ids (pfs*) para que ambas vistas convivan.
// Usa funciones globales de app.js: apiFetch, esc, formatNumber, formatearValor, toast, factGrid, nombrePersonal, aniosDesde,
// reporteMensualHtml, generarReporteMensual, registrarExportAtenciones, reporteMensualPreferido;
// de historial.js: histPintar, histFiltrarTexto, histFechaIso, histFechaTexto, histIniciales, histCasoNombre, histContarCitas;
// y de paciente-simple.js: PS_PERIODOS, PS_LISTA_PASO, PS_LISTA_MAX.

const PFS = {
  iniciado: false,
  personal: null,
  atenciones: [],
  periodo: 'todo',
  texto: '',
  seq: 0,
  sugSeq: 0,
  sugTimer: null,
  sugerencias: [],
  total: 0,           // citas reales con el periodo y la búsqueda actuales (las da el servidor)
  resumen: null,
  periodosN: null,    // citas por periodo (del servidor), sin depender de la búsqueda
  pagina: 0,
  cargaSeq: 0,
  cargando: false
};

const PFS_RECIENTES_CLAVE = 'his_per_recientes';
const PFS_MAX_RECIENTES = 6;

const pfsNombre = p => histCasoNombre(nombrePersonal(p), { siglas: false }) || 'Personal sin nombre';
const pfsProfesion = p => (p.Profesion ? histCasoNombre(p.Profesion) : '');
const pfsAnios = n => (n === null ? '' : `${n} ${n === 1 ? 'año' : 'años'}`);

// Año y mes de la última atención (para proponerlo en el reporte mensual).
function pfsMesUltimaAtencion(p) {
  const f = histFechaIso(p.UltimaAtencion);
  return f ? { anio: Number(f.slice(0, 4)), mes: Number(f.slice(5, 7)) } : null;
}

// ── Profesionales recientes (solo en este navegador) ──
function pfsLeerRecientes() {
  try { return JSON.parse(localStorage.getItem(PFS_RECIENTES_CLAVE) || '[]').filter(r => r && r.id); } catch (_) { return []; }
}
function pfsGuardarReciente(p) {
  const lista = pfsLeerRecientes().filter(r => r.id !== String(p.Id_Personal));
  lista.unshift({ id: String(p.Id_Personal), nombre: pfsNombre(p), documento: p.Numero_Documento_Personal, profesion: pfsProfesion(p) });
  try { localStorage.setItem(PFS_RECIENTES_CLAVE, JSON.stringify(lista.slice(0, PFS_MAX_RECIENTES))); } catch (_) { /* sin almacenamiento */ }
}
function pfsBorrarRecientes() {
  try { localStorage.removeItem(PFS_RECIENTES_CLAVE); } catch (_) { /* sin almacenamiento */ }
  pfsRenderRecientes();
}

// ── Pantalla ──
function iniciarPersonalSimple() {
  const box = document.getElementById('perPanelSimple');
  if (PFS.iniciado || !box) return;
  PFS.iniciado = true;
  box.innerHTML = `
    <div class="ps-hero">
      <form class="ps-search" id="pfsForm" role="search" autocomplete="off">
        <svg class="ps-search-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="pfsInput" type="search" placeholder="DNI, nombre o ID del profesional" aria-label="DNI, nombre o ID del profesional"
          role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="pfsSug" enterkeyhint="search">
        <button type="submit" class="btn btn-primary ps-search-btn">Buscar</button>
        <button type="button" class="btn btn-secondary ps-search-btn ps-limpiar-btn" data-pfs-limpiar title="Borrar lo escrito y el resultado">Limpiar</button>
        <ul class="ps-sug" id="pfsSug" role="listbox" hidden></ul>
      </form>
    </div>
    <div id="pfsRecientes"></div>
    <div id="pfsResultado" aria-live="polite"></div>`;
  pfsActivarBuscador();
  pfsRenderRecientes();
}

function pfsRenderRecientes() {
  const box = document.getElementById('pfsRecientes');
  if (!box) return;
  const lista = pfsLeerRecientes();
  if (!lista.length || PFS.personal) { box.innerHTML = ''; return; }
  box.innerHTML = `<section class="ps-recientes" aria-label="Profesionales recientes">
      <div class="ps-recientes-head"><h3>Profesionales que consultaste hace poco</h3><button type="button" class="ps-link" data-pfs-borrar>Borrar lista</button></div>
      <div class="ps-recientes-grid">${lista.map(r => `
        <button type="button" class="ps-reciente" data-pfs-abrir="${esc(r.id)}">
          <span class="ps-mini-avatar" aria-hidden="true">${esc(histIniciales(r.nombre))}</span>
          <span class="ps-reciente-text"><strong>${esc(r.nombre || 'Profesional')}</strong><small>${esc([r.documento ? `DNI ${r.documento}` : '', r.profesion].filter(Boolean).join(' · '))}</small></span>
        </button>`).join('')}</div>
    </section>`;
  box.querySelector('[data-pfs-borrar]').addEventListener('click', pfsBorrarRecientes);
  box.querySelectorAll('[data-pfs-abrir]').forEach(b => b.addEventListener('click', () => abrirPersonalSimplePorId(b.dataset.pfsAbrir)));
}

// ── Buscador con sugerencias ──
function pfsActivarBuscador() {
  const form = document.getElementById('pfsForm');
  const input = document.getElementById('pfsInput');
  const lista = document.getElementById('pfsSug');
  form.querySelector('[data-pfs-limpiar]').addEventListener('click', () => {
    clearTimeout(PFS.sugTimer);
    PFS.sugSeq += 1;
    pfsCerrarSugerencias();
    pfsCerrarPersonal();
    if (location.hash !== '#personal') history.pushState(null, '', '#personal');
    input.focus();
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const activo = lista.hidden ? null : lista.querySelector('li.activo');
    if (activo) { pfsElegir(Number(activo.dataset.i)); return; }
    buscarPersonalSimple(input.value);
  });
  input.addEventListener('input', () => {
    clearTimeout(PFS.sugTimer);
    const texto = input.value.trim();
    if (texto.length < 2) { pfsCerrarSugerencias(); return; }
    PFS.sugTimer = setTimeout(() => pfsCargarSugerencias(texto), 250);
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
    if (event.key === 'Escape') pfsCerrarSugerencias();
  });
  input.addEventListener('blur', () => setTimeout(pfsCerrarSugerencias, 150));
  lista.addEventListener('mousedown', event => {
    const li = event.target.closest('li[data-i]');
    if (!li) return;
    event.preventDefault();
    pfsElegir(Number(li.dataset.i));
  });
}

function pfsCerrarSugerencias() {
  const lista = document.getElementById('pfsSug');
  if (!lista) return;
  lista.hidden = true;
  document.getElementById('pfsInput')?.setAttribute('aria-expanded', 'false');
}

function pfsItemPersonal(p) {
  const nombre = pfsNombre(p);
  const datos = [p.Numero_Documento_Personal ? `DNI ${p.Numero_Documento_Personal}` : '', pfsProfesion(p), p.Fecha_Baja ? 'De baja' : '', `ID ${p.Id_Personal}`].filter(Boolean);
  const ultima = histFechaTexto(p.UltimaAtencion);
  return `<span class="ps-mini-avatar" aria-hidden="true">${esc(histIniciales(nombre))}</span>
    <span class="ps-item-text"><strong>${esc(nombre)}</strong><small>${esc(datos.join(' · '))}</small></span>
    <span class="ps-item-ultima">${ultima ? `Última atención<br><b>${esc(ultima)}</b>` : '<em>Sin atenciones</em>'}</span>`;
}

async function pfsCargarSugerencias(texto) {
  const seq = ++PFS.sugSeq;
  const lista = document.getElementById('pfsSug');
  try {
    const filas = await apiFetch(`/busqueda/personal/sugerencias?q=${encodeURIComponent(texto)}`);
    if (seq !== PFS.sugSeq || document.getElementById('pfsInput').value.trim() !== texto) return;
    PFS.sugerencias = filas;
    lista.innerHTML = filas.length
      ? filas.map((p, i) => `<li role="option" data-i="${i}" aria-selected="false">${pfsItemPersonal(p)}</li>`).join('')
      : '<li class="ps-sug-vacio">No hay profesionales con ese dato. Revisa que esté bien escrito.</li>';
    lista.hidden = false;
    document.getElementById('pfsInput').setAttribute('aria-expanded', 'true');
  } catch (_) {
    pfsCerrarSugerencias();
  }
}

function pfsElegir(i) {
  const p = PFS.sugerencias[i];
  if (!p) return;
  clearTimeout(PFS.sugTimer);
  PFS.sugSeq += 1;
  pfsCerrarSugerencias();
  document.getElementById('pfsInput').value = pfsNombre(p);
  abrirPersonalSimple(p);
}

// Busca con lo escrito: si hay un solo profesional lo abre; si hay varios, los muestra para elegir.
async function buscarPersonalSimple(texto, { limite = PS_LISTA_PASO } = {}) {
  const verMas = limite > PS_LISTA_PASO;
  iniciarPersonalSimple();
  cambiarTabPersonal('simple', { recordar: false });
  const valor = String(texto || '').trim();
  const input = document.getElementById('pfsInput');
  input.value = valor;
  if (valor.length < 2) { toast('Escribe al menos 2 letras o números del profesional.', 'info'); input.focus(); return; }
  clearTimeout(PFS.sugTimer);
  PFS.sugSeq += 1;
  pfsCerrarSugerencias();
  const seq = ++PFS.seq;
  PFS.personal = null;
  document.getElementById('perPanelSimple')?.classList.remove('ps-con-paciente');
  pfsRenderRecientes();
  const res = document.getElementById('pfsResultado');
  const botonMas = verMas ? res.querySelector('[data-pfs-mas]') : null;
  if (botonMas) { botonMas.disabled = true; botonMas.textContent = 'Cargando…'; }
  else res.innerHTML = '<div class="ps-estado"><span class="ps-spinner" aria-hidden="true"></span>Buscando al profesional…</div>';
  try {
    // Se pide uno más del límite para saber si quedan profesionales por mostrar.
    const recibidas = await apiFetch(`/busqueda/personal/sugerencias?q=${encodeURIComponent(valor)}&limite=${limite + 1}`);
    if (seq !== PFS.seq) return;
    const hayMas = recibidas.length > limite;
    const filas = recibidas.slice(0, limite);
    PFS.sugerencias = filas;
    if (filas.length === 1) { abrirPersonalSimple(filas[0]); return; }
    if (!filas.length) {
      res.innerHTML = `<div class="ps-vacio"><h3>No encontramos a ningún profesional con «${esc(valor)}»</h3>
        <ul><li>Revisa que el DNI tenga todos sus números.</li><li>Prueba solo con el apellido y el primer nombre.</li><li>Si tienes el ID de personal del HIS, búscalo con él.</li></ul></div>`;
      return;
    }
    const puedeVerMas = hayMas && limite < PS_LISTA_MAX;
    res.innerHTML = `<section class="ps-lista"><h3>${hayMas ? `Mostramos ${filas.length} de muchos profesionales` : `Encontramos ${filas.length} profesionales`}. Elige uno:</h3>
      <ul>${filas.map((p, i) => `<li><button type="button" class="ps-lista-item" data-pfs-i="${i}">${pfsItemPersonal(p)}<span class="ps-chevron" aria-hidden="true">›</span></button></li>`).join('')}</ul>
      ${puedeVerMas ? `<button type="button" class="btn btn-secondary ps-ver-mas" data-pfs-mas>Ver ${PS_LISTA_PASO} más</button>` : ''}
      ${hayMas ? `<p class="ps-tip">Si no aparece, escribe también el apellido${limite >= PS_LISTA_MAX ? ' o usa la Búsqueda avanzada' : ''}.</p>` : ''}</section>`;
    res.querySelectorAll('[data-pfs-i]').forEach(b => b.addEventListener('click', () => abrirPersonalSimple(PFS.sugerencias[Number(b.dataset.pfsI)])));
    res.querySelector('[data-pfs-mas]')?.addEventListener('click', () => buscarPersonalSimple(valor, { limite: Math.min(PS_LISTA_MAX, limite + PS_LISTA_PASO) }));
  } catch (error) {
    if (seq !== PFS.seq) return;
    if (botonMas?.isConnected) { botonMas.disabled = false; botonMas.textContent = `Ver ${PS_LISTA_PASO} más`; toast(error.message || 'No se pudieron cargar más profesionales.', 'error'); }
    else res.innerHTML = `<div class="ps-vacio"><h3>No se pudo buscar</h3><p>${esc(error.message || 'Intenta nuevamente.')}</p></div>`;
  }
}

// Abre la ficha por su ID (recientes, URL #personal/ID, Producción y Consultas). Termina cuando la ficha ya está dibujada;
// las atenciones siguen cargándose después.
async function abrirPersonalSimplePorId(id) {
  iniciarPersonalSimple();
  cambiarTabPersonal('simple', { recordar: false });
  const seq = ++PFS.seq;
  const res = document.getElementById('pfsResultado');
  res.innerHTML = '<div class="ps-estado"><span class="ps-spinner" aria-hidden="true"></span>Abriendo al profesional…</div>';
  try {
    const filas = await apiFetch(`/busqueda/personal/sugerencias?id=${encodeURIComponent(id)}`);
    if (seq !== PFS.seq) return;
    if (filas[0]) abrirPersonalSimple(filas[0]);
    else res.innerHTML = '<div class="ps-vacio"><h3>Ya no se encontró a este profesional</h3></div>';
  } catch (error) {
    if (seq === PFS.seq) res.innerHTML = `<div class="ps-vacio"><h3>No se pudo abrir al profesional</h3><p>${esc(error.message || '')}</p></div>`;
  }
}

// Cierra la ficha y vuelve al buscador con los profesionales recientes.
function pfsCerrarPersonal() {
  PFS.seq += 1;
  PFS.personal = null;
  document.getElementById('perPanelSimple')?.classList.remove('ps-con-paciente');
  const res = document.getElementById('pfsResultado');
  if (res) res.innerHTML = '';
  pfsRenderRecientes();
  const input = document.getElementById('pfsInput');
  if (input) input.value = '';
}

// ── Tarjeta y atenciones ──
function abrirPersonalSimple(p) {
  const seq = ++PFS.seq;
  // La ficha queda en la URL (#personal/Id_Personal) para volver a ella al recargar.
  const destino = `#personal/${encodeURIComponent(p.Id_Personal ?? '')}`;
  const enPersonal = document.getElementById('view-personal')?.classList.contains('active');
  if (p.Id_Personal != null && enPersonal && location.hash !== destino) history.pushState(null, '', destino);
  PFS.personal = p;
  PFS.atenciones = [];
  PFS.periodo = 'todo';
  PFS.texto = '';
  PFS.total = 0;
  PFS.resumen = null;
  PFS.periodosN = null;
  PFS.pagina = 0;
  document.getElementById('perPanelSimple')?.classList.add('ps-con-paciente');
  pfsGuardarReciente(p);
  pfsRenderRecientes();
  const res = document.getElementById('pfsResultado');
  const nombre = pfsNombre(p);
  const profesion = pfsProfesion(p);
  const edad = pfsAnios(aniosDesde(p.Fecha_Nacimiento_Personal));
  const antiguedad = aniosDesde(p.Fecha_Alta);
  const dato = (titulo, valor) => `<div class="ps-dato"><dt>${titulo}</dt><dd>${valor ? esc(valor) : '<span class="ps-nd">No registrado</span>'}</dd></div>`;
  res.innerHTML = `
    <div class="ps-ficha-grid">
    <div class="ps-ficha-izq">
    <article class="ps-card">
      <div class="ps-card-top">
        <span class="ps-avatar" aria-hidden="true">${esc(histIniciales(nombre))}</span>
        <div class="ps-card-id">
          <h2>${esc(nombre)}</h2>
          <div class="ps-tags">${profesion ? `<span>${esc(profesion)}</span>` : ''}${edad ? `<span>${esc(edad)}</span>` : ''}<span>${p.Fecha_Baja ? `De baja desde ${esc(formatearValor(p.Fecha_Baja))}` : 'Activo'}</span></div>
        </div>
        <div class="ps-card-actions">
          <button type="button" class="btn btn-secondary" data-pfs-nuevo>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg> Buscar otro profesional</button>
        </div>
      </div>
      <dl class="ps-datos">
        ${dato('DNI', p.Numero_Documento_Personal)}
        ${dato('ID de personal', p.Id_Personal)}
        ${dato('Colegiatura', p.Numero_Colegiatura ? `${p.Numero_Colegiatura}${p.Colegio ? ` · ${histCasoNombre(p.Colegio)}` : ''}` : '')}
        ${dato('Condición', p.Condicion ? histCasoNombre(p.Condicion) : '')}
        ${dato('Establecimiento', p.Establecimiento ? histCasoNombre(p.Establecimiento) : '')}
        ${dato('En el registro desde', p.Fecha_Alta ? `${formatearValor(p.Fecha_Alta)}${antiguedad === null ? '' : ` (${pfsAnios(antiguedad)})`}` : '')}
        ${dato('Última atención', histFechaTexto(p.UltimaAtencion))}
        ${dato('Atenciones registradas', p.Atenciones ? formatNumber(p.Atenciones) : '0')}
      </dl>
      <details class="ps-mas"><summary>Ver todos los datos del profesional</summary><div class="ps-mas-body">
        ${factGrid(p, ['Id_Personal', 'Id_Tipo_Documento_Personal', 'Numero_Documento_Personal', 'Apellido_Paterno_Personal', 'Apellido_Materno_Personal', 'Nombres_Personal',
          'Fecha_Nacimiento_Personal', 'Profesion', 'Colegio', 'Numero_Colegiatura', 'Condicion', 'Establecimiento', 'Fecha_Alta', 'Fecha_Baja'])}
      </div></details>
    </article>
    <section class="ps-card ps-frecuentes" id="pfsFrecuentes" aria-label="Diagnósticos y procedimientos más frecuentes" hidden></section>
    </div>
    <aside class="ps-ficha-lado" aria-label="Reporte y resumen">
      <div class="ps-card ps-reporte">${reporteMensualHtml(p, 'personal', reporteMensualPreferido || pfsMesUltimaAtencion(p))}</div>
      <div id="pfsResumen"></div>
    </aside>
    </div>
    <div class="ps-reporte-ancho" id="pfsReporteAncho"></div>
    <section class="ps-historial" aria-label="Atenciones registradas">
      <div class="ps-historial-head">
        <h3>Atenciones registradas</h3>
        <div class="ps-historial-acciones" id="pfsAccionesHistorial"></div>
      </div>
      <div class="ps-filtros">
        <div class="ps-periodos" role="group" aria-label="Periodo de las atenciones" id="pfsPeriodos"></div>
        <label class="ps-buscar-hist">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input type="search" class="input" id="pfsBuscarHist" placeholder="Buscar paciente, DNI, diagnóstico, código o servicio" aria-label="Buscar en las atenciones">
        </label>
      </div>
      <div id="pfsTimeline"><div class="ps-estado"><span class="ps-spinner" aria-hidden="true"></span>Cargando las atenciones…</div></div>
    </section>`;
  res.querySelector('[data-pfs-nuevo]').addEventListener('click', () => {
    pfsCerrarPersonal();
    if (location.hash !== '#personal') history.pushState(null, '', '#personal');
    document.getElementById('pfsInput').focus();
    document.getElementById('perPanelSimple').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  res.querySelector('#rmGenerar').addEventListener('click', event => generarReporteMensual(event.currentTarget.dataset.id));
  // El reporte generado (tabla día por día) es ancho: se muestra debajo de las dos columnas.
  res.querySelector('#pfsReporteAncho').append(res.querySelector('#rmResultado'));
  let buscarTimer = null;
  res.querySelector('#pfsBuscarHist').addEventListener('input', event => {
    clearTimeout(buscarTimer);
    buscarTimer = setTimeout(() => { PFS.texto = event.target.value.trim(); pfsRecargar(); }, 350);
  });
  res.scrollIntoView({ behavior: 'smooth', block: 'start' });
  pfsCargarAtenciones(p, seq);
}

// Atenciones del profesional, paginadas por cita en el servidor: el total, los periodos y el resumen son los reales
// (antes se calculaban con las primeras 1 000 anotaciones y salían cortos). La búsqueda también la hace el servidor.
const PFS_PASO = 20;

function pfsDesdePeriodo(clave) {
  const meses = PS_PERIODOS.find(p => p[0] === clave)?.[2];
  if (!meses) return '';
  const d = new Date();
  d.setMonth(d.getMonth() - meses);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function pfsCargarAtenciones(p, seq, { siguiente = false } = {}) {
  const carga = ++PFS.cargaSeq;
  const pagina = siguiente ? PFS.pagina + 1 : 1;
  const params = new URLSearchParams({ personal: String(p.Id_Personal ?? ''), pagina: String(pagina), tam: String(PFS_PASO) });
  const desde = pfsDesdePeriodo(PFS.periodo);
  if (desde) params.set('desde', desde);
  if (PFS.texto) params.set('texto', PFS.texto);
  if (!siguiente) params.set('resumen', '1');
  if (!PFS.periodosN) params.set('periodos', '1');
  PFS.cargando = true;
  if (!siguiente && PFS.atenciones.length) document.getElementById('pfsTimeline')?.classList.add('nom-cargando');
  try {
    const datos = await apiFetch(`/busqueda/atenciones/citas?${params}`);
    if (seq !== PFS.seq || carga !== PFS.cargaSeq) return;
    PFS.atenciones = siguiente ? [...PFS.atenciones, ...datos.filas] : datos.filas;
    PFS.total = datos.totalCitas;
    PFS.pagina = pagina;
    if (datos.resumen) PFS.resumen = datos.resumen;
    if (datos.periodos) PFS.periodosN = datos.periodos;
    PFS.cargando = false;
    pfsRenderHistorial();
  } catch (error) {
    if (seq !== PFS.seq || carga !== PFS.cargaSeq) return;
    PFS.cargando = false;
    if (siguiente) { toast(error.message || 'No se pudieron cargar más atenciones.', 'error'); pfsRenderHistorial(); return; }
    document.getElementById('pfsTimeline').innerHTML = `<div class="ps-vacio"><h3>No se pudieron cargar las atenciones</h3><p>${esc(error.message || '')}</p></div>`;
  } finally {
    document.getElementById('pfsTimeline')?.classList.remove('nom-cargando');
  }
}

// Cambiar de periodo o de búsqueda vuelve a pedir la primera página.
function pfsRecargar() {
  if (PFS.personal) pfsCargarAtenciones(PFS.personal, PFS.seq);
}

function pfsRenderHistorial() {
  const p = PFS.personal;
  const resumen = document.getElementById('pfsResumen');
  const frecuentes = document.getElementById('pfsFrecuentes');
  if (resumen) resumen.innerHTML = '';
  if (frecuentes) frecuentes.hidden = true;
  const periodos = document.getElementById('pfsPeriodos');
  periodos.innerHTML = PS_PERIODOS.map(([clave, texto]) => {
    const n = PFS.periodosN?.[clave];
    return `<button type="button" class="ps-periodo${PFS.periodo === clave ? ' on' : ''}" data-periodo="${clave}" aria-pressed="${PFS.periodo === clave}">${texto}<span>${n === undefined ? '…' : formatNumber(n)}</span></button>`;
  }).join('');
  periodos.querySelectorAll('[data-periodo]').forEach(b => b.addEventListener('click', () => {
    if (PFS.periodo === b.dataset.periodo) return;
    PFS.periodo = b.dataset.periodo;
    pfsRecargar();
  }));

  const filas = PFS.atenciones;
  const periodoTexto = PS_PERIODOS.find(x => x[0] === PFS.periodo)[1];
  const cargadas = histContarCitas(filas);
  registrarExportAtenciones('pfsHistorial', filas, 'Reporte de atenciones del personal de salud', [
    ['Personal de salud', nombrePersonal(p)], ['DNI', p.Numero_Documento_Personal], ['ID personal', p.Id_Personal],
    ['Profesión', p.Profesion], ['Colegiatura', p.Numero_Colegiatura], ['Establecimiento', p.Establecimiento], ['Periodo', periodoTexto],
    ...(PFS.texto ? [['Búsqueda', PFS.texto]] : []),
    ...(cargadas < PFS.total ? [['Nota', `Incluye las ${formatNumber(cargadas)} atenciones cargadas de ${formatNumber(PFS.total)}. Pulsa «Ver más» para incluir más.`]] : [])
  ], 'atenciones-personal');
  document.getElementById('pfsAccionesHistorial').innerHTML = filas.length
    ? `<button type="button" class="btn btn-primary ps-imprimir" data-export="pfsHistorial" data-formato="pdf">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/></svg>
        Imprimir atenciones</button>
       <button type="button" class="btn btn-secondary" data-export="pfsHistorial" data-formato="excel">Excel</button>`
    : '';

  const timeline = document.getElementById('pfsTimeline');
  if (!filas.length) {
    if (PFS.texto) {
      timeline.innerHTML = `<div class="ps-vacio"><h3>Ninguna atención coincide con «${esc(PFS.texto)}»</h3><button type="button" class="btn btn-secondary" data-quitar-busqueda>Quitar búsqueda</button></div>`;
      timeline.querySelector('[data-quitar-busqueda]').addEventListener('click', () => { PFS.texto = ''; document.getElementById('pfsBuscarHist').value = ''; pfsRecargar(); });
    } else if (PFS.periodo !== 'todo') {
      timeline.innerHTML = `<div class="ps-vacio"><h3>No tiene atenciones en «${esc(periodoTexto.toLowerCase())}»</h3><button type="button" class="btn btn-secondary" data-periodo-todo>Ver todas las atenciones</button></div>`;
      timeline.querySelector('[data-periodo-todo]').addEventListener('click', () => { PFS.periodo = 'todo'; pfsRecargar(); });
    } else {
      timeline.innerHTML = '<div class="ps-vacio"><h3>Este profesional no tiene atenciones registradas</h3></div>';
    }
    return;
  }
  histPintar(timeline, filas, {
    contexto: 'personal', establecimiento: p.Establecimiento, resumenEn: resumen, frecuentesEn: frecuentes,
    servidor: { total: PFS.total, resumen: PFS.resumen, paso: PFS_PASO, onMas: () => pfsCargarAtenciones(p, PFS.seq, { siguiente: true }) }
  });
}
