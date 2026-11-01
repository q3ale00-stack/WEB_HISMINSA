// ═══════════════════════════════════════
//  DEFUNCIONES (SINADEF de Ayacucho)
// ═══════════════════════════════════════
// Búsqueda por texto o por periodo, resumen de los resultados, tabla con causa básica y detalle con la cadena de causas.
// La pestaña «Búsqueda avanzada» combina filtros (fecha, persona, causa y lugar) con resumen calculado en el servidor.
// Usa funciones globales de app.js: apiFetch, esc, gv, formatNumber, formatearValor, toast, abrirModal, factGrid, pickKeys,
// exportadores, exportarDocumento, botonesExportarHtml, nombreFallecido, searchSeq, buscarPacienteSimple; de nominal.js: esRolMedico;
// de historial.js: histIcono.

// Estado de la búsqueda simple. La avanzada usa DEFA (más abajo); ambas comparten el render de resultados.
const DEF = { filas: [], sexo: '', descripcion: '', elemento: () => document.getElementById('resDefunciones') };
const DEF_PERIODOS = [['7', 'Últimos 7 días', 7], ['30', 'Último mes', 30], ['90', 'Últimos 3 meses', 90]];

const defIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const defFecha = v => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10).split('-').reverse().join('/') : '');
const defTexto = v => String(v ?? '').trim();
const defSexo = v => {
  const s = defTexto(v).toUpperCase();
  return s.startsWith('F') ? 'F' : s.startsWith('M') ? 'M' : '';
};
const DEF_SEXO_NOMBRE = { F: 'Femenino', M: 'Masculino' };
function defEdad(x) {
  const edad = defTexto(x.EDAD);
  if (!edad) return '';
  const unidad = defTexto(x.TIEMPO_EDAD).toLowerCase();
  return `${edad} ${unidad || 'años'}`;
}
function defHace(v) {
  const f = /^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : '';
  if (!f) return '';
  const [y, m, d] = f.split('-').map(Number);
  const dias = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(y, m - 1, d)) / 86400000);
  if (dias <= 0) return 'hoy';
  if (dias === 1) return 'ayer';
  if (dias < 31) return `hace ${dias} días`;
  const meses = Math.round(dias / 30.4);
  if (meses < 12) return `hace ${meses} ${meses === 1 ? 'mes' : 'meses'}`;
  const anios = Math.round(dias / 365);
  return `hace ${anios} ${anios === 1 ? 'año' : 'años'}`;
}
// Cadena de causas A → F con su código CIE-10 y el tiempo de evolución.
function defCausas(x) {
  return [['A', 'DEBIDO_CAUSA_A', 'CAUSA_A_CIEX', 'TIEMPO'], ['B', 'DEBIDO_CAUSA_B', 'CAUSA_B_CIEX', 'TIEMPO1'], ['C', 'DEBIDO_CAUSA_C', 'CAUSA_C_CIEX', 'TIEMPO2'],
    ['D', 'DEBIDO_CAUSA_D', 'CAUSA_D_CIEX', 'TIEMPO3'], ['E', 'DEBIDO_CAUSA_E', 'CAUSA_E_CIEX', 'TIEMPO4'], ['F', 'DEBIDO_CAUSA_F', 'CAUSA_F_CIEX', 'TIEMPO5']]
    .map(([letra, desc, cie, tiempo]) => ({ letra, descripcion: defTexto(x[desc]), cie: defTexto(x[cie]), tiempo: defTexto(x[tiempo]) }))
    .filter(c => c.descripcion || c.cie);
}
const defLugar = x => [defTexto(x.INSTITUCION) || defTexto(x.TIPO_LUGAR), defTexto(x.DISTRITO), defTexto(x.PROVINCIA)].filter(Boolean).join(' · ');
const defEsSi = v => /^(si|sí|s|1|true)$/i.test(defTexto(v));
const defIniciales = nombre => {
  const p = String(nombre || '').trim().split(/\s+/).filter(Boolean);
  return p.length ? (p[0][0] + (p.length > 1 ? p[p.length - 2][0] : '')).toUpperCase() : '?';
};

// ── Pestañas: «simple» (buscador) y «filtros» (búsqueda avanzada; mismo criterio de rol que Pacientes) ──
function cambiarTabDefunciones(tab, { recordar = true } = {}) {
  if (tab !== 'filtros' || esRolMedico()) tab = 'simple';
  const avanzada = document.getElementById('defTabAvanzada');
  if (avanzada) avanzada.hidden = esRolMedico();
  document.querySelectorAll('[data-def-tab]').forEach(b => {
    const activa = b.dataset.defTab === tab;
    b.classList.toggle('active', activa);
    b.setAttribute('aria-selected', String(activa));
  });
  document.getElementById('defPanelFiltros').hidden = tab !== 'filtros';
  document.getElementById('defPanelSimple').hidden = tab !== 'simple';
  if (recordar) { try { localStorage.setItem('his_def_tab', tab); } catch (_) { /* sin almacenamiento */ } }
  if (tab === 'filtros') iniciarDefuncionesAvanzada();
}

function abrirVistaDefunciones() {
  let tab = 'simple';
  try { tab = localStorage.getItem('his_def_tab') || 'simple'; } catch (_) { /* sin almacenamiento */ }
  cambiarTabDefunciones(tab);
}

// ── Búsqueda simple ──
function periodoDefunciones(dias) {
  const hasta = new Date();
  const desde = new Date();
  desde.setDate(desde.getDate() - (Number(dias) - 1));
  document.getElementById('desdeDefunciones').value = defIso(desde);
  document.getElementById('hastaDefunciones').value = defIso(hasta);
  document.getElementById('qDefunciones').value = '';
  document.getElementById('defRango').open = true;
  document.querySelectorAll('[data-def-periodo]').forEach(b => b.classList.toggle('on', b.dataset.defPeriodo === String(dias)));
  buscarDefunciones();
}

async function buscarDefunciones() {
  const q = gv('qDefunciones');
  const desde = gv('desdeDefunciones');
  const hasta = gv('hastaDefunciones');
  if (!q && !desde && !hasta) { toast('Escribe un documento, certificado o nombre, o elige un periodo.', 'info'); document.getElementById('qDefunciones').focus(); return; }
  if (desde && hasta && desde > hasta) { toast('La fecha «Desde» no puede ser posterior a «Hasta».', 'error'); return; }
  if (q) document.querySelectorAll('[data-def-periodo]').forEach(b => b.classList.remove('on'));
  const params = new URLSearchParams({ modo: 'todos', q });
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);
  const seq = ++searchSeq.defunciones;
  const el = document.getElementById('resDefunciones');
  el.innerHTML = '<div class="def-estado"><span class="ps-spinner" aria-hidden="true"></span>Buscando en el SINADEF…</div>';
  try {
    const filas = await apiFetch(`/busqueda/defunciones?${params}`);
    if (seq !== searchSeq.defunciones) return;
    DEF.filas = filas;
    DEF.sexo = '';
    DEF.descripcion = [q ? `búsqueda «${q}»` : '', desde || hasta ? `${desde ? `del ${defFecha(desde)}` : ''} ${hasta ? `al ${defFecha(hasta)}` : ''}`.trim() : ''].filter(Boolean).join(' · ');
    DEF.filtro = { q, desde, hasta };
    renderDefunciones(DEF);
  } catch (error) {
    if (seq === searchSeq.defunciones) el.innerHTML = `<div class="def-vacio"><h3>No se pudo buscar</h3><p>${esc(error.message || 'Intenta nuevamente.')}</p></div>`;
  }
}

function defFiltradas(st = DEF) {
  return st.sexo ? st.filas.filter(x => defSexo(x.SEXO) === st.sexo) : st.filas;
}

// Resumen: el de la búsqueda avanzada llega del servidor (sobre todos los registros); el de la simple se calcula con las filas.
function defResumen(st) {
  if (st.resumen) return st.resumen;
  const todas = st.filas;
  const edades = todas.filter(x => (!defTexto(x.TIEMPO_EDAD) || /^a/i.test(defTexto(x.TIEMPO_EDAD))) && defTexto(x.EDAD) !== '' && Number(x.EDAD) >= 0).map(x => Number(x.EDAD));
  const conteo = new Map();
  todas.forEach(x => { const c = defCausas(x)[0]; if (c?.descripcion) { const k = `${c.cie}|${c.descripcion}`; conteo.set(k, (conteo.get(k) || 0) + 1); } });
  const top = [...conteo.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    total: todas.length,
    mujeres: todas.filter(x => defSexo(x.SEXO) === 'F').length,
    hombres: todas.filter(x => defSexo(x.SEXO) === 'M').length,
    edadPromedio: edades.length ? Math.round(edades.reduce((a, b) => a + b, 0) / edades.length) : null,
    causa: top ? { cie: top[0].split('|')[0], descripcion: top[0].split('|')[1], casos: top[1] } : null
  };
}

// Hora del certificado sin segundos ni fracciones («19:07:00.0000000» → «19:07»).
const defHora = v => { const m = /(\d{1,2}):(\d{2})/.exec(defTexto(v)); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : ''; };
const DEF_AYUDA_CIE = 'Código CIE-10: clasificación internacional de la enfermedad';
const DEF_AYUDA_ATENCIONES = 'Abre las atenciones que esta persona tuvo en los establecimientos de salud (HIS)';

// Ficha de una sola persona: se muestra en lugar de la tabla cuando la búsqueda simple encuentra a una persona.
function defFichaHtml(x, i) {
  const nombre = nombreFallecido(x) || 'Sin nombre';
  const sexo = defSexo(x.SEXO);
  const causas = defCausas(x);
  const directa = causas[0];
  const basica = causas.length > 1 ? causas[causas.length - 1] : null;
  const hora = defHora(x.HORA);
  const cie = c => (c?.cie ? ` <span class="def-cie" title="${DEF_AYUDA_CIE}">${esc(c.cie)}</span>` : '');
  const dato = (titulo, valor, extra = '') => `<div class="def-dato"><dt>${titulo}</dt><dd>${valor ? esc(valor) : '<span class="def-muted">No registrado</span>'}${extra}</dd></div>`;
  return `
    <section class="def-ficha">
      <div class="def-ficha-head">
        <span class="def-avatar grande ${sexo === 'F' ? 'f' : sexo === 'M' ? 'm' : ''}" aria-hidden="true">${esc(defIniciales(nombre))}</span>
        <div>
          <h3>${esc(nombre)}</h3>
          <p>${esc([DEF_SEXO_NOMBRE[sexo], defEdad(x)].filter(Boolean).join(' · '))}${defEsSi(x.MUERTE_VIOLENTA) ? ' <span class="def-tag-violenta">Muerte violenta</span>' : ''}</p>
        </div>
      </div>
      <p class="def-ficha-frase">Falleció el <strong>${esc(defFecha(x.FECHA) || 'fecha no registrada')}</strong>${hora ? ` a las ${esc(hora)}` : ''}${defHace(x.FECHA) ? ` (${esc(defHace(x.FECHA))})` : ''}${defLugar(x) ? `, en ${esc(defLugar(x))}` : ''}.</p>
      <dl class="def-datos">
        ${dato('Documento', [defTexto(x.TIPO_DOC), defTexto(x.DOCUMENTO)].filter(Boolean).join(' '))}
        ${dato('N.º de certificado', defTexto(x.CDEF))}
        ${dato('Causa directa de la muerte', directa?.descripcion, cie(directa))}
        ${dato('Causa de fondo (básica)', basica?.descripcion, cie(basica))}
      </dl>
      <div class="def-ficha-acciones">
        <button type="button" class="btn btn-primary" data-def-ver="${i}">Ver certificado completo</button>
        ${defTexto(x.DOCUMENTO) ? `<button type="button" class="btn btn-secondary" data-def-paciente="${i}" title="${DEF_AYUDA_ATENCIONES}">Ver sus atenciones de salud</button>` : ''}
        <span class="nom-actions-spacer"></span>
        ${botonesExportarHtml('defunciones')}
      </div>
    </section>`;
}

// Mensaje cuando la búsqueda simple no encuentra a nadie, con sugerencias según lo que se escribió.
function defVacioHtml(st) {
  const f = st.filtro || {};
  const apellido = String(f.q || '').split(/\s+/).filter(Boolean).pop();
  return `<div class="def-vacio"><h3>No encontramos a nadie con ${f.q ? `«${esc(f.q)}»` : 'esa búsqueda'}</h3>
    <p>Puede que la persona no tenga un certificado de defunción registrado en Ayacucho, o que el dato esté escrito de otra forma. Prueba esto:</p>
    <ul>
      <li>Revisa que el DNI tenga sus 8 números.</li>
      ${apellido && !/^\d+$/.test(apellido) ? `<li>Escribe solo un apellido, por ejemplo <b>${esc(apellido)}</b>.</li>` : ''}
      ${f.desde || f.hasta ? '<li>Quita las fechas elegidas: la persona pudo fallecer en otro periodo.</li>' : ''}
    </ul></div>`;
}

// ── Lista de resultados: análisis (con 5 o más personas) y una tarjeta por persona ──
// Etapas de vida del MINSA; la edad en meses, días u horas cuenta como menor de un año.
const DEF_ETAPAS = [['Niño', '0 a 11 años', 0, 11], ['Adolescente', '12 a 17', 12, 17], ['Joven', '18 a 29', 18, 29], ['Adulto', '30 a 59', 30, 59], ['Adulto mayor', '60 a más', 60, Infinity]];
function defEdadAnios(x) {
  const edad = defTexto(x.EDAD);
  if (edad === '' || Number.isNaN(Number(edad))) return null;
  const unidad = defTexto(x.TIEMPO_EDAD).toLowerCase();
  return !unidad || unidad.startsWith('a') ? Number(edad) : 0;
}

function defContar(filas, valor) {
  const conteo = new Map();
  filas.forEach(x => { const v = valor(x); if (v) conteo.set(v, (conteo.get(v) || 0) + 1); });
  return [...conteo.entries()].sort((a, b) => b[1] - a[1]);
}

// Lista con barra de fondo proporcional (mismo diseño que los «más frecuentes» del historial de atenciones).
function defTopHtml(titulo, lista, { codigo = () => '', limite = 6, vacio = 'Sin datos registrados.' } = {}) {
  const max = lista[0]?.[1] || 1;
  return `<section class="ps-gen-top-col def-panel"><h4>${titulo}</h4>${lista.length
    ? `<ol>${lista.slice(0, limite).map(([texto, n]) => `<li style="--w:${Math.max(6, Math.round((n / max) * 100))}%">
        <span class="ps-gen-desc" title="${esc(texto)}">${esc(texto)}</span>${codigo(texto) ? `<code>${esc(codigo(texto))}</code>` : ''}<span class="ps-gen-n">${formatNumber(n)}</span>
      </li>`).join('')}</ol>`
    : `<p class="ps-gen-vacio">${vacio}</p>`}</section>`;
}

// Análisis de las defunciones mostradas: etapas de vida por sexo, causas, lugar y distritos.
function defAnalisisHtml(filas) {
  const etapas = DEF_ETAPAS.map(([nombre, rango, min, max]) => {
    const grupo = filas.filter(x => { const e = defEdadAnios(x); return e !== null && e >= min && e <= max; });
    return { nombre, rango, f: grupo.filter(x => defSexo(x.SEXO) === 'F').length, m: grupo.filter(x => defSexo(x.SEXO) === 'M').length, total: grupo.length };
  });
  const maxEtapa = Math.max(1, ...etapas.map(e => e.total));
  const sinEdad = filas.filter(x => defEdadAnios(x) === null).length;
  const cies = new Map();
  const causas = defContar(filas, x => { const c = defCausas(x)[0]; if (c?.descripcion) cies.set(c.descripcion, c.cie); return c?.descripcion; });
  const violentas = filas.filter(x => defEsSi(x.MUERTE_VIOLENTA)).length;
  return `<div class="def-analisis">
    <section class="def-panel def-etapas">
      <h4>Edad y sexo <span class="def-leyenda"><i class="f"></i>Mujeres <i class="m"></i>Hombres</span></h4>
      <ul>${etapas.map(e => `<li>
        <span class="def-etapa-nombre"><b>${e.nombre}</b><small>${e.rango}</small></span>
        <span class="def-etapa-barra" title="${esc(`${e.nombre}: ${e.f} mujeres y ${e.m} hombres`)}">
          <span class="f" style="width:${(e.f / maxEtapa) * 100}%"></span><span class="m" style="width:${(e.m / maxEtapa) * 100}%"></span>
        </span>
        <span class="def-etapa-n">${formatNumber(e.total)}</span>
      </li>`).join('')}</ul>
      ${sinEdad ? `<p class="def-nota">${formatNumber(sinEdad)} sin edad registrada.</p>` : ''}
    </section>
    ${defTopHtml('Causas de muerte más frecuentes', causas, { codigo: d => cies.get(d) })}
    ${defTopHtml('Lugar de fallecimiento', defContar(filas, x => defTexto(x.TIPO_LUGAR)), { limite: 5 })}
    ${defTopHtml(`Distritos${violentas ? ` · ${formatNumber(violentas)} muerte(s) violenta(s)` : ''}`, defContar(filas, x => defTexto(x.DISTRITO)), { limite: 5 })}
  </div>`;
}

const defAvatarHtml = (nombre, sexo, clase = '') => `<span class="def-avatar ${clase} ${sexo === 'F' ? 'f' : sexo === 'M' ? 'm' : ''}" aria-hidden="true">${esc(defIniciales(nombre))}</span>`;
const defBotonesHtml = (x, i, { grande = false } = {}) => `
  ${defTexto(x.DOCUMENTO) ? `<button type="button" class="btn btn-secondary ${grande ? 'btn-sm' : 'btn-xs'}" data-def-paciente="${i}" title="${DEF_AYUDA_ATENCIONES}">Atenciones</button>` : ''}
  <button type="button" class="btn btn-primary ${grande ? 'btn-sm' : 'btn-xs'}" data-def-ver="${i}">Ver certificado</button>`;

// Tabla (por defecto): una fila por persona con lo esencial; los demás datos están en «Ver certificado».
// La alternativa «Tarjetas» muestra todo en cada persona. La elección se recuerda en el navegador.
const DEF_VISTA_CLAVE = 'his_def_vista';
function defVista() {
  try { return localStorage.getItem(DEF_VISTA_CLAVE) === 'tarjetas' ? 'tarjetas' : 'tabla'; } catch (_) { return 'tabla'; }
}

function defVistaBotonesHtml() {
  const vista = defVista();
  const boton = (valor, texto) => `<button type="button" class="ht-vista-btn${vista === valor ? ' on' : ''}" data-def-vista="${valor}" aria-pressed="${vista === valor}">${histIcono(valor, 14)}${texto}</button>`;
  return `<div class="ht-vista" role="group" aria-label="Forma de ver las defunciones">${boton('tabla', 'Tabla')}${boton('tarjetas', 'Tarjetas')}</div>`;
}

// La causa básica es la última de la cadena del certificado; la directa, la primera.
function defTablaHtml(filas, st) {
  const cie = c => (c?.cie ? `<code class="ht-cod" title="${DEF_AYUDA_CIE}">${esc(c.cie)}</code>` : '');
  return `<div class="ht-wrap"><table class="ht-tabla def-tabla">
    <thead><tr>
      <th data-no-sort>Fallecido</th>
      <th data-no-sort>Fecha</th>
      <th data-no-sort>Causa básica</th>
      <th data-no-sort>Lugar</th>
      <th data-no-sort><span class="sr-only">Acciones</span></th>
    </tr></thead>
    <tbody>${filas.map(x => {
      const i = st.filas.indexOf(x);
      const nombre = nombreFallecido(x) || 'Sin nombre';
      const sexo = defSexo(x.SEXO);
      const causas = defCausas(x);
      const basica = causas[causas.length - 1];
      const directa = causas.length > 1 ? causas[0] : null;
      const documento = [defTexto(x.TIPO_DOC), defTexto(x.DOCUMENTO)].filter(Boolean).join(' ');
      return `<tr>
        <td><div class="def-tabla-persona">${defAvatarHtml(nombre, sexo, 'chico')}<div>
          <span class="ht-nombre">${esc(nombre)}</span>
          <small>${esc([documento, DEF_SEXO_NOMBRE[sexo], defEdad(x)].filter(Boolean).join(' · ') || '—')}</small>
          ${defEsSi(x.MUERTE_VIOLENTA) ? '<span class="def-tag-violenta">Muerte violenta</span>' : ''}
        </div></div></td>
        <td class="ht-fecha"><strong>${esc(defFecha(x.FECHA) || '—')}</strong><small>${esc([defHora(x.HORA), defHace(x.FECHA)].filter(Boolean).join(' · '))}</small></td>
        <td>${basica ? `<div class="def-tabla-causa">${cie(basica)}<span class="ht-desc" title="${esc(basica.descripcion || '')}">${esc(basica.descripcion || 'Sin descripción')}</span></div>
          ${directa ? `<small title="${esc(directa.descripcion || '')}">Causa directa: ${esc(directa.descripcion || directa.cie)}</small>` : ''}` : '<span class="def-muted">Sin causas registradas</span>'}</td>
        <td><span class="def-tabla-lugar">${esc(defLugar(x) || 'No registrado')}</span></td>
        <td class="ht-acciones">${defBotonesHtml(x, i)}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

// Una tarjeta por persona con sus datos sociales, la cadena de causas y el lugar.
function defTarjetasHtml(filas, st) {
  return `<div class="def-tarjetas">${filas.map(x => {
    const i = st.filas.indexOf(x);
    const nombre = nombreFallecido(x) || 'Sin nombre';
    const sexo = defSexo(x.SEXO);
    const causas = defCausas(x);
    const hora = defHora(x.HORA);
    const chips = [
      ['Documento', [defTexto(x.TIPO_DOC), defTexto(x.DOCUMENTO)].filter(Boolean).join(' ')],
      ['Certificado', defTexto(x.CDEF)],
      ['Seguro', defTexto(x.TIPO_SEGURO)],
      ['Estado civil', defTexto(x.ESTADO_CIVIL)],
      ['Instrucción', defTexto(x.NIVEL_DE_INSTRUCCION)],
      ['Ocupación', defTexto(x.OCUPACION)],
      ['Necropsia', defEsSi(x.NECROPSIA) ? 'Sí' : '']
    ].filter(([, v]) => v);
    return `<article class="def-tarjeta${sexo === 'F' ? ' f' : sexo === 'M' ? ' m' : ''}">
      <header class="def-tarjeta-head">
        ${defAvatarHtml(nombre, sexo)}
        <div class="def-tarjeta-id">
          <h4>${esc(nombre)}</h4>
          <p>${esc([DEF_SEXO_NOMBRE[sexo], defEdad(x)].filter(Boolean).join(' · ') || '—')}${defEsSi(x.MUERTE_VIOLENTA) ? ' <span class="def-tag-violenta">Muerte violenta</span>' : ''}</p>
        </div>
        <div class="def-tarjeta-fecha"><b>${esc(defFecha(x.FECHA) || '—')}</b><small>${esc([hora, defHace(x.FECHA)].filter(Boolean).join(' · '))}</small></div>
      </header>
      ${chips.length ? `<dl class="def-tarjeta-datos">${chips.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
      ${causas.length ? `<ol class="def-cadena def-cadena-mini">${causas.map((c, n) => `<li><span class="def-letra">${c.letra}</span>
        <div><strong>${esc(c.descripcion || 'Sin descripción')}</strong><small>${[c.cie ? `CIE-10 ${esc(c.cie)}` : '', c.tiempo ? esc(c.tiempo) : '', n === 0 ? 'Causa directa' : n === causas.length - 1 ? 'Causa básica' : ''].filter(Boolean).join(' · ')}</small></div></li>`).join('')}</ol>`
        : '<p class="def-muted">Sin causas registradas.</p>'}
      <footer class="def-tarjeta-pie">
        <span class="def-lugar">${histIcono('lugar', 13)} ${esc(defLugar(x) || 'Lugar no registrado')}</span>
        <span class="def-tarjeta-acciones">${defBotonesHtml(x, i, { grande: true })}</span>
      </footer>
    </article>`;
  }).join('')}</div>`;
}

// st: estado de la búsqueda (DEF o DEFA). En la avanzada el filtro por sexo está en el tablero y no se muestran los chips.
function renderDefunciones(st = DEF) {
  const el = st.elemento();
  const avanzada = st === DEFA;
  if (!st.filas.length) {
    el.innerHTML = avanzada
      ? `<div class="def-vacio"><h3>No hay defunciones con esos filtros</h3><p>Prueba quitando alguno.</p>
        ${DEFA.valores.anio || DEFA.valores.desde || DEFA.valores.hasta || DEFA.meses.size ? '<button type="button" class="btn btn-secondary btn-sm" data-defa-sinfechas>Buscar en todos los años (sin año, mes ni fechas)</button>' : ''}</div>`
      : defVacioHtml(st);
    return;
  }
  const filas = avanzada ? st.filas : defFiltradas(st);
  const r = defResumen(st);
  const limite = !avanzada && st.filas.length >= 300;
  const notaTotal = avanzada ? 'Con los filtros aplicados' : `${esc(st.descripcion)}${limite ? ' · se muestran las 300 más recientes' : ''}`;
  // Los indicadores solo aportan con varios resultados (un periodo o la búsqueda avanzada), no al buscar a una persona.
  const conResumen = avanzada || r.total >= 5;
  const titulo = avanzada ? '' : `<p class="def-encontrados">Encontramos <strong>${r.total === 1 ? '1 persona' : `${formatNumber(r.total)} personas`}</strong>${st.descripcion ? ` · ${esc(st.descripcion)}` : ''}${limite ? ' · se muestran las 300 más recientes' : ''}${r.total > 1 && r.total < 5 ? '. Pulsa «Ver certificado» en la persona que buscas.' : ''}</p>`;

  const chip = (valor, texto, n) => `<button type="button" class="def-chip${st.sexo === valor ? ' on' : ''}" data-def-sexo="${valor}">${texto}<span>${formatNumber(n)}</span></button>`;
  el.innerHTML = `
    ${titulo}
    ${conResumen ? `<div class="def-resumen">
      <div class="def-stat"><span>Defunciones</span><strong>${formatNumber(r.total)}</strong><small>${notaTotal}</small></div>
      <div class="def-stat"><span>Mujeres / Hombres</span><strong>${formatNumber(r.mujeres)} <em>/</em> ${formatNumber(r.hombres)}</strong><small>${r.total ? Math.round((r.mujeres / r.total) * 100) : 0} % mujeres</small></div>
      <div class="def-stat"><span>Edad promedio</span><strong>${r.edadPromedio === null ? '—' : `${r.edadPromedio} años`}</strong><small>De quienes tienen la edad en años</small></div>
      <div class="def-stat def-stat-causa"><span>Causa de muerte más frecuente</span><strong title="${esc(r.causa?.descripcion || '')}">${r.causa ? esc(r.causa.descripcion) : '—'}</strong><small>${r.causa ? `${r.causa.cie ? `${esc(r.causa.cie)} · ` : ''}${formatNumber(r.causa.casos)} caso(s)` : ''}</small></div>
    </div>` : ''}
    ${!avanzada && st.filas.length === 1 ? defFichaHtml(st.filas[0], 0) : `
    ${!avanzada && filas.length >= 5 ? defAnalisisHtml(filas) : ''}
    <section class="def-card">
      <div class="def-card-head">
        ${avanzada ? `<span class="def-muted">${esc(defRangoTexto(st))}</span>` : conResumen ? `<div class="def-chips" role="group" aria-label="Filtrar por sexo">${chip('', 'Todos', r.total)}${chip('F', 'Mujeres', r.mujeres)}${chip('M', 'Hombres', r.hombres)}</div>` : '<span></span>'}
        <div class="def-card-tools">${defVistaBotonesHtml()}${botonesExportarHtml(avanzada ? 'defuncionesAvanzada' : 'defunciones')}</div>
      </div>
      ${defVista() === 'tabla' ? defTablaHtml(filas, st) : defTarjetasHtml(filas, st)}
    </section>`}
    ${avanzada ? defPaginador(st) : ''}`;
  el.querySelectorAll('[data-def-sexo]').forEach(b => b.addEventListener('click', () => { st.sexo = b.dataset.defSexo; renderDefunciones(st); }));
  el.querySelectorAll('[data-def-vista]').forEach(b => b.addEventListener('click', () => {
    try { localStorage.setItem(DEF_VISTA_CLAVE, b.dataset.defVista); } catch (_) { /* sin almacenamiento */ }
    renderDefunciones(st);
  }));
  el.querySelectorAll('[data-def-ver]').forEach(b => b.addEventListener('click', () => verDefuncion(st.filas[Number(b.dataset.defVer)])));
  el.querySelectorAll('[data-def-paciente]').forEach(b => b.addEventListener('click', () => {
    showView('pacientes');
    buscarPacienteSimple(defTexto(st.filas[Number(b.dataset.defPaciente)].DOCUMENTO));
  }));
}

// ── Detalle ──
function verDefuncion(x) {
  const nombre = nombreFallecido(x) || 'Defunción';
  const sexo = defSexo(x.SEXO);
  const causas = defCausas(x);
  const dato = (titulo, valor) => `<div class="def-dato"><dt>${titulo}</dt><dd>${valor ? esc(valor) : '<span class="def-muted">—</span>'}</dd></div>`;
  const resto = [
    ['Persona', ['N', 'TIPO_CDEF', 'CDEF', 'ESTADO', 'TIPO_SEGURO', 'PRIMER_APELLIDO', 'SEGUNDO_APELLIDO', 'NOMBRES', 'TIPO_DOC', 'DOCUMENTO', 'SEXO', 'ETNIA', 'EDAD', 'TIEMPO_EDAD', 'ESTADO_CIVIL', 'NIVEL_DE_INSTRUCCION', 'OCUPACION']],
    ['Lugar y registro', ['TIPO_LUGAR', 'CODIGO_LUGAR_UBIGEO', 'PAIS', 'INSTITUCION', 'DISA', 'DEPARTAMENTO', 'PROVINCIA', 'DISTRITO', 'DESCRIPCION_DE_LUGAR', 'DIRECCION_DE_LUGAR', 'MUERTE_VIOLENTA', 'NECROPSIA', 'MUERTE_DURANTE', 'EDAD_GESTACIONAL', 'CONTROL_PRENATAL', 'TIEMPO_DE_HOSPITALIZACION', 'FECHA_REGISTRO', 'DNI_CODIGO_USUARIO']]
  ].map(([titulo, campos]) => { const g = factGrid(x, pickKeys(x, campos)); return g ? `<h4 class="ficha-section">${titulo}</h4>${g}` : ''; }).join('');
  abrirModal(nombre, `
    <div class="def-modal">
      <div class="def-modal-head">
        <span class="def-avatar grande ${sexo === 'F' ? 'f' : sexo === 'M' ? 'm' : ''}" aria-hidden="true">${esc(defIniciales(nombre))}</span>
        <div>
          <div class="def-tags">${[DEF_SEXO_NOMBRE[sexo], defEdad(x), defTexto(x.ESTADO_CIVIL)].filter(Boolean).map(t => `<span>${esc(t)}</span>`).join('')}${defEsSi(x.MUERTE_VIOLENTA) ? '<span class="violenta">Muerte violenta</span>' : ''}</div>
          <p class="def-modal-sub">Falleció el <strong>${esc(defFecha(x.FECHA) || '—')}</strong>${defHora(x.HORA) ? ` a las ${esc(defHora(x.HORA))}` : ''} · ${esc(defHace(x.FECHA))}</p>
        </div>
      </div>
      <dl class="def-datos">
        ${dato('Documento', [defTexto(x.TIPO_DOC), defTexto(x.DOCUMENTO)].filter(Boolean).join(' '))}
        ${dato('Certificado', defTexto(x.CDEF))}
        ${dato('Seguro', defTexto(x.TIPO_SEGURO))}
        ${dato('Lugar', defLugar(x))}
      </dl>
      <h4 class="def-h4">Cadena de causas</h4>
      ${causas.length ? `<ol class="def-cadena">${causas.map((c, i) => `
        <li><span class="def-letra">${c.letra}</span>
          <div><strong>${esc(c.descripcion || 'Sin descripción')}</strong>
          <small>${[c.cie ? `CIE-10 ${esc(c.cie)}` : '', c.tiempo ? `Tiempo: ${esc(c.tiempo)}` : '', i === 0 ? 'Causa directa' : i === causas.length - 1 && causas.length > 1 ? 'Causa básica' : ''].filter(Boolean).join(' · ')}</small></div></li>`).join('')}</ol>`
        : '<p class="def-muted">No hay causas registradas.</p>'}
      <details class="def-mas"><summary>Ver todos los datos del certificado (estado civil, ocupación, dirección…)</summary>${resto}</details>
      ${defTexto(x.DOCUMENTO) ? `<div class="def-modal-actions"><button type="button" class="btn btn-secondary" onclick="cerrarModal(); showView('pacientes'); buscarPacienteSimple('${esc(defTexto(x.DOCUMENTO))}')">Ver sus atenciones de salud</button></div>` : ''}
    </div>`);
}

// ── Exportación ──
const DEF_COLUMNAS_EXPORTAR = [
  { titulo: 'Persona' }, { titulo: 'Documento' }, { titulo: 'Fecha de fallecimiento', tipo: 'fecha' }, { titulo: 'Certificado' },
  { titulo: 'Edad' }, { titulo: 'Sexo' }, { titulo: 'Causa A' }, { titulo: 'CIE-10 A', tipo: 'codigo' }, { titulo: 'Institución' }, { titulo: 'Distrito' }
];
const defFilaExportar = x => [nombreFallecido(x), x.DOCUMENTO, x.FECHA, x.CDEF, defEdad(x), x.SEXO, x.DEBIDO_CAUSA_A, x.CAUSA_A_CIEX, x.INSTITUCION, x.DISTRITO];

// Búsqueda simple: respeta el filtro de sexo.
exportadores.defunciones = (formato, boton) => {
  const filas = defFiltradas();
  const f = DEF.filtro || {};
  return exportarDocumento(formato, {
    titulo: 'Reporte de defunciones (SINADEF)',
    datos: [['Búsqueda', f.q], ['Desde', f.desde ? defFecha(f.desde) : null], ['Hasta', f.hasta ? defFecha(f.hasta) : null],
      ['Sexo', DEF.sexo ? DEF_SEXO_NOMBRE[DEF.sexo] : null], ['Registros', formatNumber(filas.length)], DEF.filas.length >= 300 ? ['Nota', 'Se incluyen las 300 más recientes'] : null].filter(Boolean),
    archivo: 'defunciones',
    orientacion: 'landscape',
    secciones: [{ titulo: 'Defunciones', columnas: DEF_COLUMNAS_EXPORTAR, filas: filas.map(defFilaExportar) }]
  }, boton);
};

// Búsqueda avanzada: vuelve a consultar con los filtros actuales (hasta 5000 registros).
exportadores.defuncionesAvanzada = async (formato, boton) => {
  const params = defaParametros();
  if (![...params.keys()].length) { toast('Elige al menos un filtro antes de exportar.', 'info'); return; }
  params.set('exportar', '1');
  const texto = boton.innerHTML;
  boton.disabled = true;
  boton.textContent = 'Preparando…';
  let datos;
  try {
    datos = await apiFetch(`/busqueda/defunciones/avanzada?${params}`);
  } catch (error) {
    toast(error.message || 'No se pudo preparar la exportación.', 'error');
    return;
  } finally {
    boton.disabled = false;
    boton.innerHTML = texto;
  }
  if (!datos.filas.length) { toast('No hay defunciones para exportar con esos filtros.', 'info'); return; }
  const recortado = datos.filas.length >= (datos.limiteExportar || 5000);
  return exportarDocumento(formato, {
    titulo: 'Reporte de defunciones (SINADEF) · búsqueda avanzada',
    datos: [...defaActivos().map(([, etiqueta, valor]) => [etiqueta, valor]),
      ['Registros exportados', formatNumber(datos.filas.length) + (DEFA.total ? ` de ${formatNumber(DEFA.total)}` : '')]],
    archivo: 'defunciones-avanzada',
    orientacion: 'landscape',
    notas: recortado ? ['Se exportan los primeros 5 000 registros; acota los filtros para obtener el resto.'] : undefined,
    secciones: [{ titulo: 'Defunciones', columnas: DEF_COLUMNAS_EXPORTAR, filas: datos.filas.map(defFilaExportar) }]
  }, boton);
};

// ═══ Búsqueda avanzada ═══
// Reutiliza el aspecto del tablero de filtros de Pacientes (clases nom-*).
const DEFA = {
  opciones: null,
  valores: {},        // clave → valor (texto)
  meses: new Set(),
  pagina: 1,
  tam: 100,
  filas: [],
  resumen: null,
  total: 0,
  seq: 0,
  timer: null,
  sugTimer: null,
  iniciado: false,
  anioAuto: false,    // el año lo puso el sistema al abrir: se quita al buscar una persona concreta
  elemento: () => document.querySelector('#defAvanzadaApp [data-defa="resultado"]')
};
const DEFA_ETIQUETAS = {
  anio: 'Año', provincia: 'Provincia', distrito: 'Distrito', persona: 'Persona', sexo: 'Sexo', edadMin: 'Edad desde', edadMax: 'Edad hasta',
  estadoCivil: 'Estado civil', instruccion: 'Nivel de instrucción', seguro: 'Seguro', cie: 'CIE-10', causa: 'Causa (texto)',
  soloCausaA: 'Buscar la causa', violenta: 'Muerte violenta', tipoLugar: 'Tipo de lugar', institucion: 'Institución', desde: 'Desde', hasta: 'Hasta'
};
const DEFA_MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'];
const defaBox = () => document.getElementById('defAvanzadaApp');

async function iniciarDefuncionesAvanzada() {
  if (DEFA.iniciado) return;
  DEFA.iniciado = true;
  const box = defaBox();
  box.innerHTML = '<div class="table-empty">Cargando filtros…</div>';
  try {
    DEFA.opciones = await apiFetch('/busqueda/defunciones/opciones');
  } catch (error) {
    DEFA.iniciado = false;
    box.innerHTML = `<div class="table-empty">${esc(error.message || 'No se pudieron cargar los filtros.')} <button type="button" class="btn btn-secondary btn-sm" onclick="iniciarDefuncionesAvanzada()">Reintentar</button></div>`;
    return;
  }
  defaAnioPorDefecto();
  box.innerHTML = defaHtmlPanel();
  activarDefuncionesAvanzada(box);
  buscarDefuncionesAvanzada();
}

const defaOpt = (valor, texto, actual) => `<option value="${esc(valor)}"${String(actual ?? '') === String(valor) ? ' selected' : ''}>${esc(texto)}</option>`;

function defaSelect(clave, opciones, { todas = 'Todas', clase = '' } = {}) {
  return `<label class="nom-field${clase ? ` ${clase}` : ''}"><span>${esc(DEFA_ETIQUETAS[clave])}</span>
    <select class="input nom-input" data-defa-campo="${clave}">
      <option value="">${esc(todas)}</option>
      ${opciones.map(([v, t]) => defaOpt(v, t, DEFA.valores[clave])).join('')}
    </select></label>`;
}

// «Persona» muestra una lista de coincidencias mientras se escribe (ver defaSugerencias).
function defaTexto(clave, { placeholder = '', tipo = 'text', clase = '', extra = '' } = {}) {
  const conSugerencias = clave === 'persona';
  return `<label class="nom-field${clase ? ` ${clase}` : ''}${conSugerencias ? ' nom-sug' : ''}"><span>${esc(DEFA_ETIQUETAS[clave])}</span>
    <input class="input nom-input" data-defa-campo="${clave}" type="${tipo}" ${extra} autocomplete="off" placeholder="${esc(placeholder)}" value="${esc(DEFA.valores[clave] || '')}">
    ${conSugerencias ? '<ul class="nom-sug-list" role="listbox" data-defa-sug hidden></ul>' : ''}</label>`;
}

// Lista de personas que coinciden con lo escrito en «Persona». Al elegir una se busca por su DNI (o certificado).
async function defaSugerencias(input) {
  const lista = input.parentElement.querySelector('[data-defa-sug]');
  const texto = input.value.trim();
  if (!lista) return;
  if (texto.length < 2) { lista.hidden = true; return; }
  try {
    const filas = await apiFetch(`/busqueda/defunciones/sugerencias?q=${encodeURIComponent(texto)}`);
    if (input.value.trim() !== texto) return;
    lista.innerHTML = filas.length
      ? filas.map(x => {
        const clave = defTexto(x.DOCUMENTO) || defTexto(x.CDEF);
        const detalle = [DEF_SEXO_NOMBRE[defSexo(x.SEXO)], defEdad(x), defFecha(x.FECHA) ? `falleció el ${defFecha(x.FECHA)}` : ''].filter(Boolean).join(' · ');
        return `<li role="option" data-valor="${esc(clave)}"><strong>${esc(defTexto(x.DOCUMENTO) ? `DNI ${x.DOCUMENTO}` : `Certificado ${defTexto(x.CDEF) || '—'}`)}</strong><span>${esc(nombreFallecido(x) || 'Sin nombre')}${detalle ? ` <em>${esc(detalle)}</em>` : ''}</span></li>`;
      }).join('')
      : '<li class="vacio" aria-disabled="true">Sin coincidencias · revisa cómo está escrito o pulsa Enter para buscar el texto</li>';
    lista.hidden = false;
  } catch (_) {
    lista.hidden = true;
  }
}

function defaElegirSugerencia(input, li) {
  if (!li || li.classList.contains('vacio') || !li.dataset.valor) return;
  input.value = li.dataset.valor;
  li.parentElement.hidden = true;
  defaLeerTextos();
  buscarDefuncionesAvanzada();
}

const defaLista = clave => (DEFA.opciones.listas?.[clave] || []).map(v => [v, v]);

function defaDistritos() {
  const prov = DEFA.valores.provincia || '';
  const pares = DEFA.opciones.distritos || [];
  if (!pares.length) return defaLista('distrito');
  return [...new Set(pares.filter(p => !prov || p.provincia === prov).map(p => p.distrito))].map(d => [d, d]);
}

function defaHtmlPanel() {
  const o = DEFA.opciones;
  const meses = DEFA_MESES.map((m, i) => `<button type="button" class="nom-chip-btn${DEFA.meses.has(i + 1) ? ' on' : ''}" data-defa-mes="${i + 1}" aria-pressed="${DEFA.meses.has(i + 1)}" title="${m}">${i + 1}</button>`).join('');
  return `
  <div class="nom-board">
    <div class="nom-band">
      <div class="nom-band-fields def-band-fields">
        ${defaSelect('anio', (o.anios || []).map(a => [String(a), String(a)]), { todas: 'Todos' })}
        ${defaSelect('provincia', defaLista('provincia'))}
        <span data-defa-parte="distrito">${defaSelect('distrito', defaDistritos(), { todas: 'Todos' })}</span>
      </div>
      <div class="nom-band-mes">
        <span class="nom-mini-title">Mes</span>
        <div class="nom-mes-grid" role="group" aria-label="Meses">${meses}</div>
      </div>
    </div>

    <div class="nom-body def-adv-body" id="defAvanzadaBody" data-defa-parte="body">
      <section class="nom-col" aria-label="Persona">
        <h4 class="nom-col-title"><span>1</span> Persona</h4>
        <div class="def-adv-grid">
          ${defaTexto('persona', { placeholder: 'DNI, certificado o nombre', clase: 'def-span2' })}
          ${defaSelect('sexo', [['F', 'Femenino'], ['M', 'Masculino']], { todas: 'Todos' })}
          ${defaSelect('seguro', defaLista('seguro'), { todas: 'Todos' })}
          ${defaTexto('edadMin', { tipo: 'number', placeholder: '0', extra: 'min="0" max="130" inputmode="numeric"' })}
          ${defaTexto('edadMax', { tipo: 'number', placeholder: '130', extra: 'min="0" max="130" inputmode="numeric"' })}
          ${defaSelect('estadoCivil', defaLista('estadoCivil'), { todas: 'Todos' })}
          ${defaSelect('instruccion', defaLista('instruccion'), { todas: 'Todos' })}
        </div>
      </section>
      <section class="nom-col" aria-label="Causa de muerte">
        <h4 class="nom-col-title"><span>2</span> Causa de muerte</h4>
        <div class="def-adv-grid">
          ${o.causas !== false ? defaTexto('cie', { placeholder: 'Ej.: J18 o I21.9' }) : ''}
          ${o.violenta ? defaSelect('violenta', [['si', 'Sí'], ['no', 'No']], { todas: 'Todas' }) : ''}
          ${defaTexto('causa', { placeholder: 'Ej.: neumonía, infarto', clase: 'def-span2' })}
          ${defaSelect('soloCausaA', [['1', 'Solo en la causa A (directa)']], { todas: 'En toda la cadena (A–F)', clase: 'def-span2' })}
        </div>
      </section>
      <section class="nom-col" aria-label="Lugar y fechas">
        <h4 class="nom-col-title"><span>3</span> Lugar y fechas</h4>
        <div class="def-adv-grid">
          ${defaSelect('tipoLugar', defaLista('tipoLugar'), { todas: 'Todos', clase: 'def-span2' })}
          ${defaSelect('institucion', defaLista('institucion'), { clase: 'def-span2' })}
          ${defaTexto('desde', { tipo: 'date' })}
          ${defaTexto('hasta', { tipo: 'date' })}
        </div>
      </section>
    </div>

    <div class="nom-actions">
      <button type="button" class="btn btn-primary" data-defa-accion="buscar"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg> Buscar</button>
      <button type="button" class="btn nom-btn-reset" data-defa-accion="restablecer">Restablecer</button>
      <button type="button" class="btn btn-secondary" data-defa-accion="plegar" aria-expanded="true" aria-controls="defAvanzadaBody">Ocultar filtros</button>
    </div>
  </div>
  <div class="nom-activos" data-defa-parte="activos" aria-live="polite"></div>
  <div data-defa="resultado" aria-live="polite"></div>`;
}

function activarDefuncionesAvanzada(box) {
  box.addEventListener('change', event => {
    const tam = event.target.closest('select[data-defa-tam]');
    if (tam) { DEFA.tam = Number(tam.value); buscarDefuncionesAvanzada(); return; }
    const sel = event.target.closest('select[data-defa-campo], input[type="date"][data-defa-campo]');
    if (!sel) return;
    const clave = sel.dataset.defaCampo;
    if (sel.value) DEFA.valores[clave] = sel.value; else delete DEFA.valores[clave];
    if (clave === 'anio') DEFA.anioAuto = false;
    if (clave === 'provincia') {
      if (DEFA.valores.distrito && !defaDistritos().some(([d]) => d === DEFA.valores.distrito)) delete DEFA.valores.distrito;
      box.querySelector('[data-defa-parte="distrito"]').innerHTML = defaSelect('distrito', defaDistritos(), { todas: 'Todos' });
    }
    defaProgramar();
  });

  box.addEventListener('click', event => {
    const mes = event.target.closest('[data-defa-mes]');
    if (mes) {
      const n = Number(mes.dataset.defaMes);
      if (DEFA.meses.has(n)) DEFA.meses.delete(n); else DEFA.meses.add(n);
      mes.classList.toggle('on', DEFA.meses.has(n));
      mes.setAttribute('aria-pressed', String(DEFA.meses.has(n)));
      defaProgramar();
      return;
    }
    const accion = event.target.closest('[data-defa-accion]')?.dataset.defaAccion;
    if (accion === 'buscar') { defaLeerTextos(); buscarDefuncionesAvanzada(); }
    if (accion === 'restablecer') defaRepintar({ restablecer: true });
    if (accion === 'plegar') {
      const body = box.querySelector('[data-defa-parte="body"]');
      const boton = event.target.closest('[data-defa-accion]');
      body.hidden = !body.hidden;
      boton.textContent = body.hidden ? 'Mostrar filtros' : 'Ocultar filtros';
      boton.setAttribute('aria-expanded', String(!body.hidden));
    }
    const quitar = event.target.closest('[data-defa-quitar]');
    if (quitar) {
      const clave = quitar.dataset.defaQuitar;
      if (clave === 'meses') DEFA.meses.clear(); else delete DEFA.valores[clave];
      if (clave === 'provincia') delete DEFA.valores.distrito;
      defaRepintar();
    }
    if (event.target.closest('[data-defa-sinfechas]')) {
      ['anio', 'desde', 'hasta'].forEach(clave => delete DEFA.valores[clave]);
      DEFA.meses.clear();
      DEFA.anioAuto = false;
      defaRepintar();
      return;
    }
    const pagina = event.target.closest('[data-defa-pagina]');
    if (pagina && !pagina.disabled) { DEFA.pagina = Number(pagina.dataset.defaPagina); buscarDefuncionesAvanzada({ mantenerPagina: true }); }
  });

  box.addEventListener('keydown', event => {
    const input = event.target.closest('input[data-defa-campo]');
    if (input && event.key === 'Enter') { event.preventDefault(); defaLeerTextos(); buscarDefuncionesAvanzada(); }
  });
  box.addEventListener('input', event => {
    const input = event.target.closest('input[data-defa-campo]:not([type="date"])');
    if (!input) return;
    input.closest('.nom-field').classList.toggle('pendiente', input.value.trim() !== (DEFA.valores[input.dataset.defaCampo] || ''));
    if (input.dataset.defaCampo === 'persona') {
      clearTimeout(DEFA.sugTimer);
      DEFA.sugTimer = setTimeout(() => defaSugerencias(input), 250);
    }
  });

  // Sugerencias de «Persona»: se elige con el mouse; la lista se cierra al salir del campo o al pulsar Enter o Escape.
  box.addEventListener('mousedown', event => {
    const li = event.target.closest('[data-defa-sug] li');
    if (!li) return;
    event.preventDefault();
    defaElegirSugerencia(li.closest('.nom-field').querySelector('input'), li);
  });
  box.addEventListener('focusout', event => {
    const lista = event.target.closest?.('.nom-field')?.querySelector('[data-defa-sug]');
    if (lista) setTimeout(() => { lista.hidden = true; }, 120);
  });
  box.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== 'Escape') return;
    const lista = event.target.closest?.('.nom-field')?.querySelector('[data-defa-sug]');
    if (lista) { clearTimeout(DEFA.sugTimer); lista.hidden = true; }
  });
}

function defaAnioPorDefecto() {
  if (!DEFA.opciones.anios?.length) return;
  DEFA.valores.anio = String(DEFA.opciones.anios[0]);
  DEFA.anioAuto = true;
}

// Copia a los filtros lo escrito en los cuadros de texto y números.
// Al escribir una persona se quita el año puesto por defecto: puede haber fallecido en cualquier año.
function defaLeerTextos() {
  const box = defaBox();
  box.querySelectorAll('input[data-defa-campo]:not([type="date"])').forEach(input => {
    const clave = input.dataset.defaCampo;
    const valor = input.value.trim();
    input.closest('.nom-field').classList.remove('pendiente');
    if (clave === 'persona' && valor && valor !== DEFA.valores.persona && DEFA.anioAuto) {
      delete DEFA.valores.anio;
      DEFA.anioAuto = false;
      const anio = box.querySelector('select[data-defa-campo="anio"]');
      if (anio) anio.value = '';
    }
    if (valor) DEFA.valores[clave] = valor; else delete DEFA.valores[clave];
  });
}

function defaProgramar() {
  clearTimeout(DEFA.timer);
  DEFA.timer = setTimeout(() => { defaLeerTextos(); buscarDefuncionesAvanzada(); }, 450);
}

// Vuelve a dibujar el tablero (tras quitar un filtro o restablecer) conservando si estaba plegado.
function defaRepintar({ restablecer = false } = {}) {
  if (restablecer) {
    DEFA.valores = {};
    DEFA.meses.clear();
    defaAnioPorDefecto();
  }
  const box = defaBox();
  const plegado = box.querySelector('[data-defa-parte="body"]')?.hidden;
  box.innerHTML = defaHtmlPanel();
  if (plegado) box.querySelector('[data-defa-accion="plegar"]').click();
  buscarDefuncionesAvanzada();
}

function defaParametros() {
  const params = new URLSearchParams();
  Object.entries(DEFA.valores).forEach(([clave, valor]) => { if (valor !== '') params.set(clave, valor); });
  if (DEFA.meses.size) params.set('meses', [...DEFA.meses].sort((a, b) => a - b).join(','));
  return params;
}

function defaTextoValor(clave, valor) {
  if (clave === 'sexo') return DEF_SEXO_NOMBRE[valor] || valor;
  if (clave === 'violenta') return valor === 'si' ? 'Sí' : 'No';
  if (clave === 'soloCausaA') return 'Solo en la causa A';
  if (clave === 'desde' || clave === 'hasta') return defFecha(valor);
  if (clave === 'edadMin' || clave === 'edadMax') return `${valor} años`;
  return valor;
}

function defaActivos() {
  const lista = Object.entries(DEFA.valores).filter(([, v]) => v !== '')
    .map(([clave, valor]) => [clave, DEFA_ETIQUETAS[clave] || clave, defaTextoValor(clave, valor)]);
  if (DEFA.meses.size) lista.push(['meses', 'Mes', [...DEFA.meses].sort((a, b) => a - b).map(m => DEFA_MESES[m - 1]).join(', ')]);
  return lista;
}

function defaRenderActivos() {
  const box = defaBox().querySelector('[data-defa-parte="activos"]');
  const lista = defaActivos();
  box.innerHTML = lista.length
    ? `<span class="nom-activos-title">Filtros aplicados</span>${lista.map(([clave, etiqueta, valor]) => `<span class="nom-pill"><span>${esc(etiqueta)}:</span> <strong>${esc(valor)}</strong><button type="button" data-defa-quitar="${esc(clave)}" aria-label="Quitar filtro ${esc(etiqueta)}" title="Quitar">×</button></span>`).join('')}`
    : '<span class="nom-activos-title">Sin filtros: elige al menos uno para buscar</span>';
}

async function buscarDefuncionesAvanzada({ mantenerPagina = false } = {}) {
  clearTimeout(DEFA.timer);
  if (!mantenerPagina) DEFA.pagina = 1;
  defaRenderActivos();
  const params = defaParametros();
  const res = DEFA.elemento();
  if (DEFA.valores.edadMin && DEFA.valores.edadMax && Number(DEFA.valores.edadMin) > Number(DEFA.valores.edadMax)) {
    res.innerHTML = '<div class="table-empty">«Edad desde» no puede ser mayor que «Edad hasta».</div>';
    return;
  }
  if (![...params.keys()].length) {
    DEFA.filas = [];
    res.innerHTML = '<div class="table-empty">Elige al menos un filtro (por ejemplo el año o un mes) para ver las defunciones.</div>';
    return;
  }
  params.set('pagina', String(DEFA.pagina));
  params.set('tam', String(DEFA.tam));
  const seq = ++DEFA.seq;
  res.classList.add('nom-cargando');
  if (!DEFA.filas.length) res.innerHTML = '<div class="def-estado"><span class="ps-spinner" aria-hidden="true"></span>Buscando en el SINADEF…</div>';
  try {
    const datos = await apiFetch(`/busqueda/defunciones/avanzada?${params}`);
    if (seq !== DEFA.seq) return;
    DEFA.filas = datos.filas;
    DEFA.resumen = datos.resumen;
    DEFA.total = datos.total || 0;
    DEFA.pagina = datos.pagina;
    DEFA.tam = datos.tam;
    renderDefunciones(DEFA);
  } catch (error) {
    if (seq !== DEFA.seq) return;
    DEFA.filas = [];
    res.innerHTML = `<div class="def-vacio"><h3>No se pudo buscar</h3><p>${esc(error.message || 'Intenta nuevamente.')}</p></div>`;
  } finally {
    if (seq === DEFA.seq) res.classList.remove('nom-cargando');
  }
}

function defRangoTexto(st) {
  const desde = (st.pagina - 1) * st.tam + 1;
  return `Registros ${formatNumber(desde)}–${formatNumber(desde + st.filas.length - 1)} de ${formatNumber(st.total)}, del más reciente al más antiguo`;
}

function defPaginador(st) {
  const paginas = Math.max(1, Math.ceil(st.total / st.tam));
  const boton = (p, texto, deshabilitado) => `<button type="button" class="btn btn-secondary btn-sm" data-defa-pagina="${p}"${deshabilitado ? ' disabled' : ''}>${texto}</button>`;
  return `
    <div class="nom-pager">
      <label class="nom-tam">Filas por página
        <select class="input" data-defa-tam>${[50, 100, 200].map(n => `<option value="${n}"${n === st.tam ? ' selected' : ''}>${n}</option>`).join('')}</select>
      </label>
      <span class="nom-actions-spacer"></span>
      ${boton(1, '« Primera', st.pagina <= 1)}
      ${boton(st.pagina - 1, '‹ Anterior', st.pagina <= 1)}
      <span class="nom-pag-info">Página ${formatNumber(st.pagina)} de ${formatNumber(paginas)}</span>
      ${boton(st.pagina + 1, 'Siguiente ›', st.pagina >= paginas)}
      ${boton(paginas, 'Última »', st.pagina >= paginas)}
    </div>`;
}

alCargarVistas(() => {
  document.querySelectorAll('[data-def-periodo]').forEach(b => b.addEventListener('click', () => periodoDefunciones(b.dataset.defPeriodo)));
  const ayudaInicial = document.getElementById('resDefunciones')?.innerHTML || '';
  document.getElementById('formDefunciones')?.addEventListener('reset', () => {
    DEF.filas = [];
    document.getElementById('resDefunciones').innerHTML = ayudaInicial;
    document.querySelectorAll('[data-def-periodo]').forEach(b => b.classList.remove('on'));
  });
});
