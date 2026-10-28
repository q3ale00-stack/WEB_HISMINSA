// ═══════════════════════════════════════
//  HISTORIAL DE ATENCIONES (compartido)
// ═══════════════════════════════════════
// Resumen plegable (indicadores y lo más frecuente) seguido de las atenciones en tabla (por defecto) o en tarjetas.
// La usan el historial del paciente (paciente-simple.js), la ficha del personal, la ficha avanzada del paciente y la búsqueda de atenciones.
// El contexto (ctx.contexto) decide a quién se muestra en cada atención:
//   'paciente' → al profesional que atendió · 'personal' → al paciente atendido · 'busqueda' → a ambos.
// Usa funciones globales de app.js: esc, formatNumber, verAtencion, registrarExportAtenciones, botonesExportarHtml, SEXO, TIPOS_DX, TURNOS, MESES_NOMBRE.

const HIST_MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];
const HIST_DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

const histFechaIso = v => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : '');
const histFechaTexto = v => { const f = histFechaIso(v); return f ? f.split('-').reverse().join('/') : ''; };

function histIniciales(nombre) {
  const partes = String(nombre || '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '?';
  return (partes[0][0] + (partes.length > 2 ? partes[2][0] : partes[1]?.[0] || '')).toUpperCase();
}

const histContarCitas = filas => new Set(filas.map((r, i) => String(r.Id_Cita ?? `__${i}`))).size;

const histNormalizar = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Atenciones que contienen el texto buscado; de cada atención que coincide se muestran todos sus ítems.
function histFiltrarTexto(filas, texto) {
  const q = histNormalizar(texto);
  if (!q) return filas;
  const coincide = r => [r.DescItem, r.Codigo_Item, r.Servicio, r.Personal, r.Paciente, r.DocumentoPaciente, r.Id_Cita].some(v => histNormalizar(v).includes(q));
  const citas = new Set(filas.filter(r => r.Id_Cita && coincide(r)).map(r => String(r.Id_Cita)));
  return filas.filter(r => (r.Id_Cita ? citas.has(String(r.Id_Cita)) : coincide(r)));
}

// Nombres sin mayúsculas sostenidas. En servicios y financiadores las siglas cortas (UCI, VIH, SIS) se mantienen;
// en nombres de personas no (ANA → Ana), salvo las que llevan puntos.
const HIST_CONECTORES = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'o', 'a', 'al', 'en', 'con', 'por', 'para']);
function histCasoNombre(texto, { siglas = true } = {}) {
  return String(texto ?? '').trim().split(/\s+/).map((w, i) => {
    const min = w.toLocaleLowerCase('es');
    if (i > 0 && HIST_CONECTORES.has(min)) return min;
    if ((w.includes('.') || (siglas && w.length <= 3)) && w === w.toLocaleUpperCase('es')) return w;
    return min.charAt(0).toLocaleUpperCase('es') + min.slice(1);
  }).join(' ');
}

// Orden dentro de una atención: definitivos, presuntivos, repetidos, otros y al final los procedimientos.
const HIST_ORDEN_ITEM = { D: 0, P: 1, R: 2 };
const histOrdenItem = x => (/^\d/.test(String(x.Codigo_Item ?? '').trim()) ? 4 : HIST_ORDEN_ITEM[String(x.Tipo_Diagnostico ?? '').trim().toUpperCase()] ?? 3);

const histTituloMes = clave => (clave ? `${MESES_NOMBRE[Number(clave.slice(5, 7)) - 1]} ${clave.slice(0, 4)}` : 'Sin fecha');
const histEsProcedimiento = x => /^\d/.test(String(x.Codigo_Item ?? '').trim());
const histPlural = (n, uno, varios) => `${formatNumber(n)} ${n === 1 ? uno : varios}`;

// Condición del paciente en el establecimiento y en el servicio (N, C, R del HIS).
const HIST_CONDICION = { N: 'Nuevo', C: 'Continuador', R: 'Reingreso' };
const HIST_EDAD = { A: ['año', 'años'], M: ['mes', 'meses'], D: ['día', 'días'] };
const HIST_ICONO = {
  turno: '<path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="9"/>',
  edad: '<circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/>',
  grupo: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
  financiador: '<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z"/>',
  condicion: '<path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"/><path d="M18 3v4h-4M6 21v-4h4"/>',
  lugar: '<path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  imprimir: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>',
  buscar: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  tabla: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>',
  tarjetas: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/>'
};
const histIcono = (nombre, tam = 13) => `<svg width="${tam}" height="${tam}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${HIST_ICONO[nombre]}</svg>`;

// Tono fijo para cada servicio: el mismo servicio siempre tiene el mismo color.
function histTonoServicio(nombre) {
  let h = 0;
  for (const ch of String(nombre || '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

// Una entrada por atención (cita), de la más reciente a la más antigua.
function histAgruparCitas(filas) {
  const porCita = new Map();
  filas.forEach((r, i) => {
    const clave = r.Id_Cita ? String(r.Id_Cita) : `__${i}`;
    if (!porCita.has(clave)) porCita.set(clave, []);
    porCita.get(clave).push(r);
  });
  return [...porCita.values()].sort((a, b) => histFechaIso(b[0].Fecha_Atencion).localeCompare(histFechaIso(a[0].Fecha_Atencion)));
}

// Datos de contexto de una atención (iguales en todas las filas de la misma cita).
function histDatosCita(r, ctx = {}) {
  const turno = String(r.Id_Turno ?? '').trim().toUpperCase();
  const tipoEdad = String(r.Tipo_Edad ?? '').trim().toUpperCase();
  const edadN = r.Edad_Reg === null || r.Edad_Reg === undefined || String(r.Edad_Reg).trim() === '' ? null : Number(r.Edad_Reg);
  const condEst = HIST_CONDICION[String(r.Id_Condicion_Establecimiento ?? '').trim().toUpperCase()] || '';
  const condServ = HIST_CONDICION[String(r.Id_Condicion_Servicio ?? '').trim().toUpperCase()] || '';
  const establecimiento = r.NombreEstablecimiento ? histCasoNombre(r.NombreEstablecimiento) : '';
  const idPaciente = String(r.Id_Paciente ?? '').trim();
  return {
    servicio: r.Servicio ? histCasoNombre(r.Servicio) : 'Atención',
    turno: TURNOS[turno] || '',
    edad: edadN !== null && !Number.isNaN(edadN) ? `${edadN} ${(HIST_EDAD[tipoEdad] || ['', ''])[edadN === 1 ? 0 : 1]}`.trim() : '',
    financiador: r.Financiador ? histCasoNombre(r.Financiador) : '',
    condEst,
    condServ,
    // El establecimiento solo se muestra cuando es distinto al de referencia (el del paciente, si se conoce).
    otroEstablecimiento: establecimiento && histNormalizar(establecimiento) !== histNormalizar(ctx.establecimiento) ? establecimiento : '',
    personal: r.Personal ? histCasoNombre(r.Personal, { siglas: false }) : '',
    profesion: r.ProfesionPersonal ? histCasoNombre(r.ProfesionPersonal) : '',
    idPaciente,
    paciente: r.Paciente ? histCasoNombre(r.Paciente, { siglas: false }) : idPaciente ? `Paciente ${idPaciente}` : '',
    docPaciente: String(r.DocumentoPaciente ?? '').trim(),
    sexoPaciente: SEXO[String(r.SexoPaciente ?? '').trim()] || ''
  };
}

// En la ficha del personal el establecimiento casi siempre es el mismo; solo se ven los datos que cambian.
function histChipsCita(dc, { conTurno = true } = {}) {
  const chip = (icono, texto, titulo) => `<span class="ps-chip" title="${esc(titulo)}">${histIcono(icono, 12)}${esc(texto)}</span>`;
  const cond = dc.condServ || dc.condEst;
  return [
    conTurno && dc.turno ? chip('turno', dc.turno, 'Turno') : '',
    dc.edad ? chip('edad', dc.edad, 'Edad del paciente en la atención') : '',
    dc.financiador ? chip('financiador', dc.financiador, 'Financiador') : '',
    cond ? `<span class="ps-chip ps-chip-cond ps-chip-${cond.toLowerCase()}" title="${esc(`En el establecimiento: ${dc.condEst || '—'} · En el servicio: ${dc.condServ || '—'}`)}">${histIcono('condicion', 12)}${esc(cond)}${dc.condServ ? ' en el servicio' : ''}</span>` : '',
    dc.otroEstablecimiento ? chip('lugar', dc.otroEstablecimiento, 'Establecimiento') : ''
  ].filter(Boolean).join('');
}

const histBotonImprimir = (cita, conTexto) => (cita ? `<button type="button" class="btn btn-secondary btn-sm${conTexto ? '' : ' ps-btn-icono'}" data-export="cita" data-cita="${esc(cita)}" data-formato="pdf" title="Imprimir esta atención" aria-label="Imprimir esta atención">${histIcono('imprimir', 14)}${conTexto ? ' Imprimir' : ''}</button>` : '');

// Personas de la atención según el contexto: quién atendió, a quién se atendió, o ambos.
function histPersonas(dc, ctx) {
  const lista = [];
  const datosPaciente = [dc.docPaciente ? `DNI ${dc.docPaciente}` : '', dc.sexoPaciente].filter(Boolean).join(' · ');
  if (ctx.contexto !== 'paciente' && dc.paciente) lista.push({ etiqueta: 'Paciente', nombre: dc.paciente, detalle: datosPaciente, clase: 'pac' });
  if (ctx.contexto !== 'personal' && dc.personal) lista.push({ etiqueta: 'Atendido por', nombre: dc.personal, detalle: dc.profesion, clase: 'prof' });
  return lista;
}

// Línea de tiempo con una tarjeta por atención.
function histTimelineHtml(entradas, ctx) {
  // Se agrupan por mes y, dentro del mes, por día: varias atenciones del mismo día comparten la fecha.
  const meses = [];
  entradas.forEach((registros, i) => {
    const f = histFechaIso(registros[0].Fecha_Atencion);
    let mes = meses[meses.length - 1];
    if (!mes || mes.clave !== f.slice(0, 7)) { mes = { clave: f.slice(0, 7), dias: [], total: 0 }; meses.push(mes); }
    let dia = mes.dias[mes.dias.length - 1];
    if (!dia || dia.fecha !== f) { dia = { fecha: f, citas: [] }; mes.dias.push(dia); }
    dia.citas.push(i);
    mes.total += 1;
  });
  return `<ol class="ps-timeline">${meses.map(m => `
      <li class="ps-mes"><span class="ps-mes-eje" aria-hidden="true"><span></span></span><h4>${histTituloMes(m.clave)}</h4><span class="ps-mes-n">${histPlural(m.total, 'atención', 'atenciones')}</span></li>
      ${m.dias.map(d => `<li class="ps-ev">
        <div class="ps-ev-fecha">${histFechaHtml(d.fecha)}</div>
        <div class="ps-ev-citas">${d.citas.map(i => histCitaHtml(entradas[i], i, ctx)).join('')}</div>
      </li>`).join('')}`).join('')}</ol>`;
}

// Códigos más frecuentes: cada código cuenta una vez por atención.
function histMasFrecuentes(entradas, filtro) {
  const conteo = new Map();
  entradas.forEach(registros => {
    const vistos = new Set();
    registros.filter(filtro).forEach(x => {
      const cod = String(x.Codigo_Item ?? '').trim();
      if (!cod || vistos.has(cod)) return;
      vistos.add(cod);
      const e = conteo.get(cod) || { cod, desc: x.DescItem, n: 0 };
      e.n += 1;
      conteo.set(cod, e);
    });
  });
  return [...conteo.values()].sort((a, b) => b.n - a.n || a.cod.localeCompare(b.cod));
}

// Cuántas atenciones hay por cada valor (servicio, profesional, financiador…), de mayor a menor.
function histContarPor(datos, campo) {
  const conteo = new Map();
  datos.forEach(dc => { if (dc[campo]) conteo.set(dc[campo], (conteo.get(dc[campo]) || 0) + 1); });
  return [...conteo.entries()].sort((a, b) => b[1] - a[1]);
}

// Resumen plegable encima de la línea de tiempo: indicadores, atenciones por servicio y lo más frecuente.
// Se recuerda si quedó abierto o cerrado.
const HIST_RESUMEN_CLAVE = 'his_hist_resumen';
function histResumenAbierto() {
  try { return localStorage.getItem(HIST_RESUMEN_CLAVE) === 'abierto'; } catch (_) { return false; }
}

function histResumenHtml(entradas, ctx) {
  const datos = entradas.map(([r]) => histDatosCita(r, ctx));
  const total = entradas.length;
  const servicios = histContarPor(datos, 'servicio');
  const profesionales = histContarPor(datos, 'personal');
  const pacientes = histContarPor(datos, 'paciente');
  const financiadores = histContarPor(datos, 'financiador');
  const nuevos = datos.filter(dc => dc.condServ === 'Nuevo').length;
  const fechas = entradas.map(([r]) => histFechaIso(r.Fecha_Atencion)).filter(Boolean);
  const periodo = fechas.length ? (fechas[0] === fechas[fechas.length - 1] ? histFechaTexto(fechas[0]) : `${histFechaTexto(fechas[fechas.length - 1])} – ${histFechaTexto(fechas[0])}`) : '—';
  const pct = n => `${Math.round((n / total) * 100)}%`;

  const kpi = (icono, titulo, valor, detalle = '') => `<div class="ps-gen-kpi">
      <span class="ps-gen-kpi-ico">${histIcono(icono, 16)}</span>
      <div><span>${titulo}</span><b>${valor}</b>${detalle ? `<small title="${detalle}">${detalle}</small>` : ''}</div>
    </div>`;
  const masFrecuente = lista => (lista[0] ? `Más frecuente: ${esc(lista[0][0])} (${lista[0][1]})` : '');

  // Barra apilada con la proporción de atenciones de cada servicio.
  const distribucion = servicios.length > 1 ? `<section class="ps-gen-dist">
      <h4>Atenciones por servicio</h4>
      <div class="ps-gen-barra" role="img" aria-label="${esc(servicios.map(([s, n]) => `${s}: ${n}`).join(', '))}">
        ${servicios.map(([s, n]) => `<span style="--svc-h:${histTonoServicio(s)};flex-grow:${n}" title="${esc(`${s}: ${n} (${pct(n)})`)}"></span>`).join('')}
      </div>
      <ul class="ps-gen-leyenda">${servicios.map(([s, n]) => `<li style="--svc-h:${histTonoServicio(s)}"><i aria-hidden="true"></i>${esc(s)} <b>${formatNumber(n)}</b></li>`).join('')}</ul>
    </section>` : '';

  const [finTop, finN] = financiadores[0] || [];
  return `<details class="ps-resumen" data-hist-resumen${histResumenAbierto() ? ' open' : ''}>
    <summary><span>Resumen</span><small>${histPlural(total, 'atención', 'atenciones')} · ${esc(periodo)}</small></summary>
    <div class="ps-gen">
      <div class="ps-gen-kpis">
        ${kpi('condicion', 'Atenciones', formatNumber(total), nuevos ? `${histPlural(nuevos, 'nueva', 'nuevas')} en su servicio` : '')}
        ${kpi('lugar', 'Servicios', formatNumber(servicios.length), esc(servicios.slice(0, 2).map(([s, n]) => `${s} (${n})`).join(' · ')))}
        ${ctx.contexto !== 'paciente' ? kpi('grupo', 'Pacientes', formatNumber(pacientes.length), masFrecuente(pacientes)) : ''}
        ${ctx.contexto !== 'personal' ? kpi('edad', 'Profesionales', formatNumber(profesionales.length), masFrecuente(profesionales)) : ''}
        ${kpi('financiador', 'Financiador', finTop ? esc(finTop) : '—', finTop ? `${pct(finN)} de las atenciones` : '')}
        ${kpi('turno', 'Periodo', esc(periodo), fechas.length ? `Última: ${esc(histFechaTexto(fechas[0]))}` : '')}
      </div>
      ${distribucion}
      ${ctx.frecuentesEn ? '' : histFrecuentesHtml(entradas)}
    </div>
  </details>`;
}

// Diagnósticos y procedimientos más frecuentes (parte del resumen; con ctx.frecuentesEn se pintan aparte).
function histFrecuentesHtml(entradas) {
  const topLista = (titulo, lista, vacio) => {
    const max = lista[0]?.n || 1;
    return `<section class="ps-gen-top-col"><h4>${titulo}</h4>${lista.length
      ? `<ol>${lista.slice(0, 6).map(e => `<li style="--w:${Math.max(6, Math.round((e.n / max) * 100))}%">
          <span class="ps-gen-desc" title="${esc(e.desc || '')}">${esc(e.desc || 'Sin descripción')}</span><code>${esc(e.cod)}</code><span class="ps-gen-n" title="Atenciones">${formatNumber(e.n)}</span>
        </li>`).join('')}</ol>`
      : `<p class="ps-gen-vacio">${vacio}</p>`}</section>`;
  };
  return `<div class="ps-gen-top">
    ${topLista('Diagnósticos más frecuentes', histMasFrecuentes(entradas, x => !histEsProcedimiento(x)), 'Sin diagnósticos registrados.')}
    ${topLista('Procedimientos más frecuentes', histMasFrecuentes(entradas, histEsProcedimiento), 'Sin procedimientos registrados.')}
  </div>`;
}

function histFechaHtml(f) {
  if (!f) return '<span class="ps-ev-dia">?</span><span class="ps-ev-mes">Sin fecha</span>';
  const [y, m, d] = f.split('-').map(Number);
  return `<span class="ps-ev-dia">${d}</span><span class="ps-ev-mes">${HIST_MESES[m - 1]} ${y}</span><span class="ps-ev-semana">${HIST_DIAS[new Date(y, m - 1, d).getDay()]}</span>`;
}

function histCitaHtml(registros, indice, ctx) {
  const r = registros[0];
  const dc = histDatosCita(r, ctx);
  const items = [...registros].sort((a, b) => histOrdenItem(a) - histOrdenItem(b)).map(x => {
    const codigo = String(x.Codigo_Item ?? '').trim();
    const tipo = String(x.Tipo_Diagnostico ?? '').trim().toUpperCase();
    const etiqueta = histEsProcedimiento(x) ? ['Procedimiento', 'proc'] : TIPOS_DX[tipo] ? [TIPOS_DX[tipo], `dx-${tipo.toLowerCase()}`] : null;
    const lab = String(x.Valor_Lab ?? '').trim();
    return `<li>
      ${etiqueta ? `<span class="ps-tag ps-tag-${etiqueta[1]}">${etiqueta[0]}</span>` : ''}
      <span class="ps-item-desc">${esc(x.DescItem || 'Sin descripción')}</span>
      <span class="ps-item-cod">${esc(codigo)}${lab ? ` · valor ${esc(lab)}` : ''}</span>
    </li>`;
  }).join('');
  const medida = (titulo, valor, unidad = '') => (valor ? `<span class="ps-medida"><small>${titulo}</small><b>${esc(valor)}${unidad ? ` ${unidad}` : ''}</b></span>` : '');
  const medidas = [
    medida('Peso', r.Peso, 'kg'), medida('Talla', r.Talla, 'cm'), medida('Hemoglobina', r.Hemoglobina),
    medida('Perímetro abdominal', r.Perimetro_Abdominal, 'cm'), medida('Perímetro cefálico', r.Perimetro_Cefalico, 'cm')
  ].join('');
  const chips = histChipsCita(dc);
  const personas = histPersonas(dc, ctx);
  return `<div class="ps-ev-card" style="--svc-h:${histTonoServicio(dc.servicio)}">
      <div class="ps-ev-head">
        <div class="ps-ev-titulo">
          <h4><i class="ps-svc-dot" aria-hidden="true"></i>${esc(dc.servicio)}</h4>
          ${chips ? `<div class="ps-chips">${chips}</div>` : ''}
        </div>
        <div class="ps-ev-acciones">
          ${histBotonImprimir(r.Id_Cita, true)}
          <button type="button" class="btn btn-secondary btn-sm" data-ps-ver="${indice}:0">Ver detalle</button>
        </div>
      </div>
      ${personas.length ? `<div class="ps-ev-personas">${personas.map(p => `<div class="ps-ev-prof ps-ev-prof-${p.clase}">
        <span class="ps-ev-avatar" aria-hidden="true">${esc(histIniciales(p.nombre))}</span>
        <span><small>${p.etiqueta}</small><strong>${esc(p.nombre)}</strong>${p.detalle ? `<em>${esc(p.detalle)}</em>` : ''}</span>
      </div>`).join('')}</div>` : ''}
      <ul class="ps-items">${items}</ul>
      ${medidas ? `<div class="ps-medidas">${medidas}</div>` : ''}
    </div>`;
}

// ── Vista en tabla (por defecto): una fila por atención con fecha, personas, servicio y códigos ──
// La alternativa «Tarjetas» es la línea de tiempo de arriba. La elección se recuerda para todos los historiales.
const HIST_VISTA_CLAVE = 'his_hist_vista';
function histVista() {
  try { return localStorage.getItem(HIST_VISTA_CLAVE) === 'tarjetas' ? 'tarjetas' : 'tabla'; } catch (_) { return 'tabla'; }
}

// Códigos de la atención: letra del tipo (D, P, R o Pr de procedimiento), código, descripción y valor de laboratorio.
function histItemsTablaHtml(registros) {
  return [...registros].sort((a, b) => histOrdenItem(a) - histOrdenItem(b)).map(x => {
    const codigo = String(x.Codigo_Item ?? '').trim();
    const tipo = String(x.Tipo_Diagnostico ?? '').trim().toUpperCase();
    const [letra, clase, titulo] = histEsProcedimiento(x) ? ['Pr', 'proc', 'Procedimiento']
      : TIPOS_DX[tipo] ? [tipo, `dx-${tipo.toLowerCase()}`, `Diagnóstico ${TIPOS_DX[tipo].toLowerCase()}`] : ['·', 'nd', 'Sin tipo de diagnóstico'];
    const desc = x.DescItem || 'Sin descripción';
    const lab = String(x.Valor_Lab ?? '').trim();
    return `<li>
      <span class="ht-tipo ht-tipo-${clase}" title="${titulo}">${letra}</span>
      <code class="ht-cod">${esc(codigo || '—')}</code>
      <span class="ht-desc" title="${esc(desc)}">${esc(desc)}</span>
      ${lab ? `<span class="ht-lab" title="Valor de laboratorio">Lab ${esc(lab)}</span>` : ''}
    </li>`;
  }).join('');
}

// En la ficha del paciente no se repite la columna «Paciente», ni «Profesional» en la del personal.
function histTablaHtml(entradas, ctx) {
  const conPaciente = ctx.contexto !== 'paciente';
  const conPersonal = ctx.contexto !== 'personal';
  const filas = entradas.map((registros, i) => {
    const r = registros[0];
    const dc = histDatosCita(r, ctx);
    const f = histFechaIso(r.Fecha_Atencion);
    const [y, m, d] = f ? f.split('-').map(Number) : [];
    const detalleFecha = [f ? HIST_DIAS[new Date(y, m - 1, d).getDay()] : '', dc.turno, conPaciente ? '' : dc.edad].filter(Boolean).join(' · ');
    const idPersonal = String(r.Id_Personal ?? '').trim();
    const cond = dc.condServ || dc.condEst;
    const detalleServicio = [dc.financiador, cond ? `${cond}${dc.condServ ? ' en el servicio' : ''}` : '', dc.otroEstablecimiento].filter(Boolean).join(' · ');
    const persona = (id, dato, nombre, vacio, detalle) => `<td>
        ${id && nombre ? `<button type="button" class="ht-link" ${dato}="${esc(id)}">${esc(nombre)}</button>` : `<span class="ht-nombre">${esc(nombre || vacio)}</span>`}
        ${detalle ? `<small>${esc(detalle)}</small>` : ''}
      </td>`;
    return `<tr>
      <td class="ht-fecha"><strong>${f ? esc(histFechaTexto(f)) : 'Sin fecha'}</strong>${detalleFecha ? `<small>${esc(detalleFecha)}</small>` : ''}${r.Id_Cita ? `<small class="ht-cita">Cita ${esc(r.Id_Cita)}</small>` : ''}</td>
      ${conPaciente ? persona(dc.idPaciente, 'data-ht-paciente', dc.paciente, 'Paciente no registrado', [dc.docPaciente ? `DNI ${dc.docPaciente}` : '', dc.edad].filter(Boolean).join(' · ')) : ''}
      ${conPersonal ? persona(idPersonal, 'data-ht-personal', dc.personal, 'No registrado', dc.profesion) : ''}
      <td><span class="ht-svc" style="--svc-h:${histTonoServicio(dc.servicio)}">${esc(dc.servicio)}</span>${detalleServicio ? `<small>${esc(detalleServicio)}</small>` : ''}</td>
      <td><ul class="ht-items">${histItemsTablaHtml(registros)}</ul></td>
      <td class="ht-acciones">
        <button type="button" class="btn btn-secondary btn-xs" data-ps-ver="${i}:0" title="Ver el detalle de esta atención">Ver</button>
        ${histBotonImprimir(r.Id_Cita, false)}
      </td>
    </tr>`;
  }).join('');
  return `<div class="ht-wrap"><table class="ht-tabla">
    <thead><tr>
      <th data-no-sort>Fecha</th>
      ${conPaciente ? '<th data-no-sort>Paciente</th>' : ''}
      ${conPersonal ? '<th data-no-sort>Profesional</th>' : ''}
      <th data-no-sort>Servicio</th>
      <th data-no-sort>Diagnósticos y procedimientos</th>
      <th data-no-sort><span class="sr-only">Acciones</span></th>
    </tr></thead>
    <tbody>${filas}</tbody>
  </table></div>`;
}

// Pinta el resumen y las atenciones (tabla o tarjetas) en «box» y conecta los botones con el detalle y las fichas.
// El resumen solo aparece con dos atenciones o más; con ctx.resumenEn se pinta en ese elemento (columna derecha de la ficha del paciente)
// y con ctx.frecuentesEn sus diagnósticos y procedimientos frecuentes van aparte, visibles solo mientras el resumen está abierto.
function histPintar(box, filas, ctx, avisoHtml = '') {
  const entradas = histAgruparCitas(filas);
  const vista = histVista();
  const boton = (valor, texto) => `<button type="button" class="ht-vista-btn${vista === valor ? ' on' : ''}" data-ht-vista="${valor}" aria-pressed="${vista === valor}">${histIcono(valor, 14)}${texto}</button>`;
  const barra = `<div class="ht-barra">
      <span class="ht-total">${histPlural(entradas.length, 'atención', 'atenciones')}</span>
      <div class="ht-vista" role="group" aria-label="Forma de ver las atenciones">${boton('tabla', 'Tabla')}${boton('tarjetas', 'Tarjetas')}</div>
    </div>`;
  const resumenHtml = entradas.length > 1 ? histResumenHtml(entradas, ctx) : '';
  if (ctx.resumenEn) ctx.resumenEn.innerHTML = resumenHtml;
  if (ctx.frecuentesEn) {
    ctx.frecuentesEn.innerHTML = resumenHtml ? histFrecuentesHtml(entradas) : '';
    ctx.frecuentesEn.hidden = !resumenHtml || !histResumenAbierto();
  }
  box.innerHTML = avisoHtml + (ctx.resumenEn ? '' : resumenHtml) + barra
    + (vista === 'tabla' ? histTablaHtml(entradas, ctx) : histTimelineHtml(entradas, ctx));
  (ctx.resumenEn || box).querySelector('[data-hist-resumen]')?.addEventListener('toggle', event => {
    try { localStorage.setItem(HIST_RESUMEN_CLAVE, event.target.open ? 'abierto' : 'cerrado'); } catch (_) { /* sin almacenamiento */ }
    if (ctx.frecuentesEn) ctx.frecuentesEn.hidden = !event.target.open;
  });
  box.querySelectorAll('[data-ht-vista]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.htVista === vista) return;
    try { localStorage.setItem(HIST_VISTA_CLAVE, b.dataset.htVista); } catch (_) { /* sin almacenamiento */ }
    histPintar(box, filas, ctx, avisoHtml);
  }));
  box.querySelectorAll('[data-ps-ver]').forEach(b => b.addEventListener('click', () => {
    const [ci, ri] = b.dataset.psVer.split(':').map(Number);
    verAtencion(entradas[ci][ri]);
  }));
  box.querySelectorAll('[data-ht-paciente]').forEach(b => b.addEventListener('click', () => {
    showView('pacientes');
    abrirPacienteSimplePorId(b.dataset.htPaciente);
  }));
  box.querySelectorAll('[data-ht-personal]').forEach(b => b.addEventListener('click', () => abrirFichaPersonal(b.dataset.htPersonal)));
}

// ── Historial montado en un contenedor (ficha del personal, ficha avanzada del paciente y búsqueda de atenciones) ──
// Barra con un buscador dentro de las atenciones y la exportación; debajo, el resumen y la línea de tiempo.
// exportar: { clave, titulo, datos, archivo, filtroBase } se registra de nuevo con lo que queda tras la búsqueda.
const HIST = {};

function histMontar(targetId, rows, { contexto = 'busqueda', establecimiento = '', exportar = null, avisoHtml = '' } = {}) {
  const box = document.getElementById(targetId);
  if (!box) return;
  const estado = { rows, ctx: { contexto, establecimiento }, exportar, avisoHtml, texto: '' };
  HIST[targetId] = estado;
  box.innerHTML = `<div class="hist-barra">
      <label class="ps-buscar-hist">${histIcono('buscar', 15)}
        <input type="search" class="input" data-hist-buscar placeholder="Buscar ${contexto === 'paciente' ? 'diagnóstico, código, servicio o profesional' : 'paciente, DNI, diagnóstico, código o servicio'}" aria-label="Buscar en estas atenciones">
      </label>
      ${exportar ? `<div class="hist-exportar">${botonesExportarHtml(exportar.clave)}</div>` : ''}
    </div>
    <div class="hist-cuerpo" data-hist-cuerpo></div>`;
  let timer = null;
  box.querySelector('[data-hist-buscar]').addEventListener('input', event => {
    clearTimeout(timer);
    timer = setTimeout(() => { estado.texto = event.target.value.trim(); histPintarMontado(targetId); }, 200);
  });
  histPintarMontado(targetId);
}

function histPintarMontado(targetId) {
  const estado = HIST[targetId];
  const box = document.getElementById(targetId);
  if (!estado || !box) return;
  const cuerpo = box.querySelector('[data-hist-cuerpo]');
  const filas = histFiltrarTexto(estado.rows, estado.texto);
  const ex = estado.exportar;
  if (ex) registrarExportAtenciones(ex.clave, filas, ex.titulo, [...(ex.datos || []), ...(estado.texto ? [['Búsqueda', estado.texto]] : [])], ex.archivo, ex.filtroBase);
  if (!estado.rows.length) { cuerpo.innerHTML = '<div class="ps-vacio"><h3>No hay atenciones registradas</h3></div>'; return; }
  if (!filas.length) {
    cuerpo.innerHTML = `<div class="ps-vacio"><h3>Ninguna atención coincide con «${esc(estado.texto)}»</h3><button type="button" class="btn btn-secondary" data-hist-quitar>Quitar búsqueda</button></div>`;
    cuerpo.querySelector('[data-hist-quitar]').addEventListener('click', () => {
      estado.texto = '';
      box.querySelector('[data-hist-buscar]').value = '';
      histPintarMontado(targetId);
    });
    return;
  }
  histPintar(cuerpo, filas, estado.ctx, estado.avisoHtml);
}
