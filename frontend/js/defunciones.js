// ═══════════════════════════════════════
//  DEFUNCIONES (SINADEF de Ayacucho)
// ═══════════════════════════════════════
// Búsqueda por texto o por periodo, resumen de los resultados, tabla con causa básica y detalle con la cadena de causas.
// Usa funciones globales de app.js: apiFetch, esc, gv, formatNumber, formatearValor, toast, abrirModal, factGrid, pickKeys,
// exportadores, exportarDocumento, botonesExportarHtml, nombreFallecido, searchSeq, buscarPacienteSimple.

const DEF = { filas: [], sexo: '', descripcion: '' };
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

// ── Búsqueda ──
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
  const params = new URLSearchParams({ modo: gv('modoDefunciones') || 'todos', q });
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
    const modoTexto = document.getElementById('modoDefunciones')?.selectedOptions[0]?.textContent || 'Todos los datos';
    DEF.descripcion = [q ? `«${q}» en ${modoTexto.toLowerCase()}` : '', desde || hasta ? `${desde ? `del ${defFecha(desde)}` : ''} ${hasta ? `al ${defFecha(hasta)}` : ''}`.trim() : ''].filter(Boolean).join(' · ');
    DEF.filtro = { q, modoTexto, desde, hasta };
    renderDefunciones();
  } catch (error) {
    if (seq === searchSeq.defunciones) el.innerHTML = `<div class="def-vacio"><h3>No se pudo buscar</h3><p>${esc(error.message || 'Intenta nuevamente.')}</p></div>`;
  }
}

function defFiltradas() {
  return DEF.sexo ? DEF.filas.filter(x => defSexo(x.SEXO) === DEF.sexo) : DEF.filas;
}

function renderDefunciones() {
  const el = document.getElementById('resDefunciones');
  const todas = DEF.filas;
  if (!todas.length) {
    el.innerHTML = `<div class="def-vacio"><h3>No se encontraron defunciones</h3><p>${esc(DEF.descripcion || '')}</p>
      <ul><li>Revisa que el DNI o el certificado tenga todos sus números.</li><li>Prueba solo con el apellido.</li><li>O consulta un periodo con los botones de arriba.</li></ul></div>`;
    return;
  }
  const filas = defFiltradas();
  const mujeres = todas.filter(x => defSexo(x.SEXO) === 'F').length;
  const hombres = todas.filter(x => defSexo(x.SEXO) === 'M').length;
  const edades = todas.filter(x => (!defTexto(x.TIEMPO_EDAD) || /^a/i.test(defTexto(x.TIEMPO_EDAD))) && defTexto(x.EDAD) !== '' && Number(x.EDAD) >= 0).map(x => Number(x.EDAD));
  const edadProm = edades.length ? Math.round(edades.reduce((a, b) => a + b, 0) / edades.length) : null;
  const conteo = new Map();
  todas.forEach(x => { const c = defCausas(x)[0]; if (c?.descripcion) { const k = `${c.cie}|${c.descripcion}`; conteo.set(k, (conteo.get(k) || 0) + 1); } });
  const top = [...conteo.entries()].sort((a, b) => b[1] - a[1])[0];
  const limite = todas.length >= 300;

  const chip = (valor, texto, n) => `<button type="button" class="def-chip${DEF.sexo === valor ? ' on' : ''}" data-def-sexo="${valor}">${texto}<span>${formatNumber(n)}</span></button>`;
  el.innerHTML = `
    <div class="def-resumen">
      <div class="def-stat"><span>Defunciones</span><strong>${formatNumber(todas.length)}</strong><small>${esc(DEF.descripcion)}${limite ? ' · se muestran las 300 más recientes' : ''}</small></div>
      <div class="def-stat"><span>Mujeres / Hombres</span><strong>${formatNumber(mujeres)} <em>/</em> ${formatNumber(hombres)}</strong><small>${todas.length ? Math.round((mujeres / todas.length) * 100) : 0} % mujeres</small></div>
      <div class="def-stat"><span>Edad promedio</span><strong>${edadProm === null ? '—' : `${edadProm} años`}</strong><small>De quienes tienen la edad en años</small></div>
      <div class="def-stat def-stat-causa"><span>Causa de muerte más frecuente</span><strong title="${esc(top ? top[0].split('|')[1] : '')}">${top ? esc(top[0].split('|')[1]) : '—'}</strong><small>${top ? `${top[0].split('|')[0] ? `${esc(top[0].split('|')[0])} · ` : ''}${formatNumber(top[1])} caso(s)` : ''}</small></div>
    </div>
    <section class="def-card">
      <div class="def-card-head">
        <div class="def-chips" role="group" aria-label="Filtrar por sexo">${chip('', 'Todos', todas.length)}${chip('F', 'Mujeres', mujeres)}${chip('M', 'Hombres', hombres)}</div>
        ${botonesExportarHtml('defunciones')}
      </div>
      <div class="def-table-wrap">
        <table class="def-table">
          <thead><tr><th>Persona</th><th>Documento</th><th>Fallecimiento</th><th>Causa de muerte (A)</th><th>Lugar</th><th><span class="sr-only">Acciones</span></th></tr></thead>
          <tbody>${filas.map(x => {
            const i = DEF.filas.indexOf(x);
            const nombre = nombreFallecido(x) || 'Sin nombre';
            const sexo = defSexo(x.SEXO);
            const causa = defCausas(x)[0];
            const violenta = defEsSi(x.MUERTE_VIOLENTA);
            return `<tr>
              <td><div class="def-persona"><span class="def-avatar ${sexo === 'F' ? 'f' : sexo === 'M' ? 'm' : ''}" aria-hidden="true">${esc(defIniciales(nombre))}</span>
                <span><strong>${esc(nombre)}</strong><small>${esc([DEF_SEXO_NOMBRE[sexo], defEdad(x)].filter(Boolean).join(' · ') || '—')}</small></span></div></td>
              <td><span class="def-doc">${esc(defTexto(x.DOCUMENTO) || '—')}</span><small class="def-muted">${esc(defTexto(x.TIPO_DOC))}${x.CDEF ? ` · Cert. ${esc(x.CDEF)}` : ''}</small></td>
              <td><strong class="def-fecha">${esc(defFecha(x.FECHA) || '—')}</strong><small class="def-muted">${esc([defTexto(x.HORA), defHace(x.FECHA)].filter(Boolean).join(' · '))}</small></td>
              <td class="def-causa">${causa ? `<span class="def-causa-text">${esc(causa.descripcion || 'Sin descripción')}</span>${causa.cie ? `<span class="def-cie">${esc(causa.cie)}</span>` : ''}` : '<span class="def-muted">No registrada</span>'}${violenta ? '<span class="def-tag-violenta">Muerte violenta</span>' : ''}</td>
              <td><span class="def-lugar">${esc(defLugar(x) || '—')}</span></td>
              <td class="def-acciones">
                ${defTexto(x.DOCUMENTO) ? `<button type="button" class="btn btn-secondary btn-xs" data-def-paciente="${i}" title="Abrir su historial de atenciones en el HIS">Historial HIS</button>` : ''}
                <button type="button" class="btn btn-primary btn-xs" data-def-ver="${i}">Ver datos</button>
              </td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>
    </section>`;
  el.querySelectorAll('[data-def-sexo]').forEach(b => b.addEventListener('click', () => { DEF.sexo = b.dataset.defSexo; renderDefunciones(); }));
  el.querySelectorAll('[data-def-ver]').forEach(b => b.addEventListener('click', () => verDefuncion(DEF.filas[Number(b.dataset.defVer)])));
  el.querySelectorAll('[data-def-paciente]').forEach(b => b.addEventListener('click', () => {
    showView('pacientes');
    buscarPacienteSimple(defTexto(DEF.filas[Number(b.dataset.defPaciente)].DOCUMENTO));
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
          <p class="def-modal-sub">Falleció el <strong>${esc(defFecha(x.FECHA) || '—')}</strong>${x.HORA ? ` a las ${esc(x.HORA)}` : ''} · ${esc(defHace(x.FECHA))}</p>
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
      <details class="def-mas"><summary>Ver todos los datos del certificado</summary>${resto}</details>
      ${defTexto(x.DOCUMENTO) ? `<div class="def-modal-actions"><button type="button" class="btn btn-secondary" onclick="cerrarModal(); showView('pacientes'); buscarPacienteSimple('${esc(defTexto(x.DOCUMENTO))}')">Ver su historial de atenciones en el HIS</button></div>` : ''}
    </div>`);
}

// ── Exportación (respeta el filtro de sexo) ──
exportadores.defunciones = (formato, boton) => {
  const filas = defFiltradas();
  const f = DEF.filtro || {};
  return exportarDocumento(formato, {
    titulo: 'Reporte de defunciones (SINADEF)',
    datos: [['Búsqueda', f.q], ['Buscar en', f.q ? f.modoTexto : null], ['Desde', f.desde ? defFecha(f.desde) : null], ['Hasta', f.hasta ? defFecha(f.hasta) : null],
      ['Sexo', DEF.sexo ? DEF_SEXO_NOMBRE[DEF.sexo] : null], ['Registros', formatNumber(filas.length)], DEF.filas.length >= 300 ? ['Nota', 'Se incluyen las 300 más recientes'] : null].filter(Boolean),
    archivo: 'defunciones',
    orientacion: 'landscape',
    secciones: [{ titulo: 'Defunciones', columnas: [
      { titulo: 'Persona' }, { titulo: 'Documento' }, { titulo: 'Fecha de fallecimiento', tipo: 'fecha' }, { titulo: 'Certificado' },
      { titulo: 'Edad' }, { titulo: 'Sexo' }, { titulo: 'Causa A' }, { titulo: 'CIE-10 A', tipo: 'codigo' }, { titulo: 'Institución' }, { titulo: 'Distrito' }
    ], filas: filas.map(x => [nombreFallecido(x), x.DOCUMENTO, x.FECHA, x.CDEF, defEdad(x), x.SEXO, x.DEBIDO_CAUSA_A, x.CAUSA_A_CIEX, x.INSTITUCION, x.DISTRITO]) }]
  }, boton);
};

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-def-periodo]').forEach(b => b.addEventListener('click', () => periodoDefunciones(b.dataset.defPeriodo)));
  document.getElementById('formDefunciones')?.addEventListener('reset', () => {
    DEF.filas = [];
    document.querySelectorAll('[data-def-periodo]').forEach(b => b.classList.remove('on'));
  });
});
