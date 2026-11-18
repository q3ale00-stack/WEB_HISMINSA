// ═══════════════════════════════════════
//  CONSULTAS
// ═══════════════════════════════════════
// Todo está a la vista: medidas, agrupaciones, periodo y un filtro por cada campo. El formulario de filtros
// viaja como el primer bloque de la consulta y los bloques Y / O adicionales van a continuación. El servidor (POST /consultas/ejecutar)
// valida todo contra sus listas blancas. El detalle por fila usa los modales de app.js, que leen
// currentQueryResult y currentFilteredRows.

const CX_MEDIDAS = [
  { valor: 'pacientesUnicos', nombre: 'Número de pacientes distintos' },
  { valor: 'atenciones', nombre: 'Número de citas atendidas' },
  { valor: 'registros', nombre: 'Diagnósticos y procedimientos registrados' },
  { valor: 'codigosUnicos', nombre: 'Códigos CIE-10 / CPMS distintos' }
];
const CX_MEDIDAS_EXTRA = [
  ['avgEdad', 'Edad promedio (años)'], ['avgHemoglobina', 'Hemoglobina promedio'], ['maxHemoglobina', 'Hemoglobina máxima'],
  ['avgPeso', 'Peso promedio'], ['maxPeso', 'Peso máximo'], ['avgTalla', 'Talla promedio'], ['maxTalla', 'Talla máxima'],
  ['sumLab', 'Suma de valores LAB'], ['avgLab', 'Promedio de valores LAB']
];
const CX_GRUPOS = [
  ['diagnostico', 'Diagnóstico'], ['profesional', 'Profesional'], ['ups', 'Servicio / UPS'], ['establecimiento', 'Establecimiento'],
  ['mes', 'Mes'], ['nombrePaciente', 'Paciente'], ['documento', 'DNI / documento'], ['tipoDiagnostico', 'Tipo de diagnóstico']
];
const CX_GRUPOS_MAS = [
  ['codigoHIS', 'Código CIE-10 / CPMS'], ['dia', 'Día'], ['año', 'Año'], ['sexo', 'Sexo'], ['financiador', 'Financiador'],
  ['departamento', 'Departamento'], ['provincia', 'Provincia'], ['idPaciente', 'ID del paciente']
];
const CX_SUGERENCIAS = [['F32', 'Depresión'], ['F41', 'Ansiedad'], ['D50', 'Anemia'], ['I10', 'Hipertensión'], ['E11', 'Diabetes']];
const CX_CAMPOS = [
  ['codigoHIS', 'Código CIE-10 / CPMS', 'string'], ['diagnostico', 'Diagnóstico', 'string'], ['tipoDiagnostico', 'Tipo de diagnóstico', 'string'],
  ['fechaAtencion', 'Fecha de atención', 'date'], ['establecimiento', 'Establecimiento', 'string'], ['departamento', 'Departamento', 'string'],
  ['provincia', 'Provincia', 'string'], ['ups', 'UPS / servicio', 'string'], ['profesional', 'Profesional', 'string'], ['financiador', 'Financiador', 'string'],
  ['sexo', 'Sexo', 'string'], ['edad', 'Edad', 'number'], ['valorLab', 'Valor LAB', 'number'], ['peso', 'Peso', 'number'], ['talla', 'Talla', 'number'],
  ['hemoglobina', 'Hemoglobina', 'number'], ['documento', 'Documento', 'string'], ['nombrePaciente', 'Nombre del paciente', 'string'],
  ['historiaClinica', 'Historia clínica', 'string'], ['idPaciente', 'ID del paciente', 'string']
];
const CX_OPERADORES = {
  string: [['equals', 'es igual a'], ['not_equals', 'es diferente de'], ['contains', 'contiene'], ['not_contains', 'no contiene'], ['starts_with', 'comienza con'], ['ends_with', 'termina con'], ['in', 'es uno de (separados por coma)']],
  number: [['equals', 'igual a (=)'], ['not_equals', 'diferente de (≠)'], ['gt', 'mayor que (>)'], ['gte', 'mayor o igual (≥)'], ['lt', 'menor que (<)'], ['lte', 'menor o igual (≤)'], ['between', 'entre'], ['in', 'es uno de (separados por coma)']],
  date: [['equals', 'fecha exacta'], ['before', 'antes de'], ['after', 'después de'], ['between', 'entre las fechas'], ['year', 'en el año'], ['month', 'en el mes']]
};
const CX_EDADES = [['0', '11', 'Niños (0-11)'], ['12', '17', 'Adolescentes (12-17)'], ['18', '59', 'Adultos (18-59)'], ['60', '', 'Mayores (60+)']];
const CX_SECCIONES = [
  ['Diagnóstico', ['codigoHIS', 'diagnostico', 'tipoDiagnostico', 'valorLab']],
  ['Paciente', ['nombrePaciente', 'documento', 'historiaClinica', 'idPaciente', 'sexo', 'edad']],
  ['Atención', ['fechaAtencion', 'profesional', 'ups', 'financiador']],
  ['Lugar', ['establecimiento', 'departamento', 'provincia']],
  ['Mediciones', ['peso', 'talla', 'hemoglobina']]
];
const CX_FILTRO_LISTA = { sexo: [['F', 'Mujeres'], ['M', 'Hombres']], tipoDiagnostico: [['D', 'Definitivo'], ['P', 'Presuntivo'], ['R', 'Repetido']] };
const CX_FILTRO_DATALIST = { ups: 'cxListaUps', establecimiento: 'cxListaEstablecimientos' };
const CX_RAPIDAS = [
  { nombre: '¿Cuáles son los diagnósticos más frecuentes?', medida: 'pacientesUnicos', grupos: ['diagnostico'] },
  { nombre: '¿Cuántas citas atendió cada profesional?', medida: 'atenciones', grupos: ['profesional'] },
  { nombre: '¿Cuántas citas hubo en cada servicio?', medida: 'atenciones', grupos: ['ups'] },
  { nombre: '¿Cuántas citas hubo en cada establecimiento?', medida: 'atenciones', grupos: ['establecimiento'] },
  { nombre: '¿Cómo evolucionan las citas mes a mes?', medida: 'atenciones', grupos: ['mes'] },
  // Dos códigos alternativos solo se pueden expresar con un bloque O.
  { nombre: '¿Cuántos pacientes hay con depresión o ansiedad (F32 / F41)?', medida: 'pacientesUnicos', grupos: ['diagnostico', 'profesional'], bloques: [{ scope: 'registro', mode: 'OR', items: [{ field: 'codigoHIS', operator: 'starts_with', value: 'F32' }, { field: 'codigoHIS', operator: 'starts_with', value: 'F41' }] }] }
];
const CX_TEMPORALES = ['mes', 'dia', 'año'];

const CX = {
  medida: 'pacientesUnicos',
  grupos: new Set(['diagnostico']),
  opcionesCargadas: false,
  filas: [],
  columnas: [],
  orden: null,
  ordenAsc: false,
  pagina: 1,
  porPagina: 25,
  graficoVisible: true,
  pestana: null,
  secuencia: 0,
  filtrosTabla: {}
};

const cxEl = id => document.getElementById(id);
const cxNombreMedida = clave => CX_MEDIDAS.find(m => m.valor === clave)?.nombre || CX_MEDIDAS_EXTRA.find(m => m[0] === clave)?.[1] || 'Resultado total';
const cxNombreGrupo = clave => [...CX_GRUPOS, ...CX_GRUPOS_MAS].find(g => g[0] === clave)?.[1] || COLUMN_LABELS[clave] || clave;
const cxTipoCampo = campo => CX_CAMPOS.find(c => c[0] === campo)?.[2] || 'string';
const cxOpciones = (lista, elegido) => lista.map(([v, t]) => `<option value="${esc(v)}"${v === elegido ? ' selected' : ''}>${esc(t)}</option>`).join('');
const cxFechaLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const cxValorCelda = (col, v) => (v === null || v === undefined || v === '' ? '—' : col === 'dia' ? formatIsoDate(v) : currentNumericColumns.includes(col) ? formatNumber(v) : String(v));

// ── Periodo ──
function cxOpcionesPeriodo() {
  const anio = new Date().getFullYear();
  return [[`anio-${anio}`, `Año ${anio}`], [`anio-${anio - 1}`, `Año ${anio - 1}`], ['mes', 'Mes actual'], ['ultimos30', 'Últimos 30 días'], ['todo', 'Todo el historial'], ['rango', 'Rango de fechas…']];
}

function cxPeriodoActual() {
  const v = cxEl('cxPeriodo').value;
  const hoy = new Date();
  if (v.startsWith('anio-')) { const a = v.slice(5); return { start: `${a}-01-01`, end: `${a}-12-31` }; }
  if (v === 'mes') return { start: cxFechaLocal(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), end: cxFechaLocal(new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0)) };
  if (v === 'ultimos30') { const d = new Date(hoy); d.setDate(d.getDate() - 30); return { start: cxFechaLocal(d), end: cxFechaLocal(hoy) }; }
  if (v === 'rango') return { start: cxEl('cxDesde').value || null, end: cxEl('cxHasta').value || null };
  return { start: null, end: null };
}

function cxTextoPeriodo() {
  const v = cxEl('cxPeriodo').value;
  if (v.startsWith('anio-')) return `en el año ${v.slice(5)}`;
  if (v === 'mes') return 'en el mes actual';
  if (v === 'ultimos30') return 'en los últimos 30 días';
  if (v === 'todo') return 'en todo el historial';
  const { start, end } = cxPeriodoActual();
  if (start && end) return `del ${formatIsoDate(start)} al ${formatIsoDate(end)}`;
  if (start) return `desde el ${formatIsoDate(start)}`;
  if (end) return `hasta el ${formatIsoDate(end)}`;
  return 'sin límite de fechas';
}

// ── Formulario de filtros: un campo por cada dato consultable ──
function cxOperadorInicial(campo, tipo) {
  if (CX_FILTRO_LISTA[campo]) return 'equals';
  return tipo === 'string' ? 'contains' : tipo === 'date' ? 'between' : 'equals';
}

function cxFiltroHtml(campo, f = {}) {
  const [, nombre, tipo] = CX_CAMPOS.find(c => c[0] === campo);
  const operador = f.operator || cxOperadorInicial(campo, tipo);
  const tipoInput = tipo === 'date' && !['year', 'month'].includes(operador) ? 'date' : 'text';
  const valor = Array.isArray(f.value) ? f.value.join(', ') : (f.value ?? '');
  const lista = CX_FILTRO_LISTA[campo];
  const entrada = lista && operador !== 'in'
    ? `<select class="select-native cx-f-valor" aria-label="${esc(nombre)}: valor"><option value="">Todos</option>${cxOpciones(lista, valor)}</select>`
    : `<input class="input cx-f-valor" type="${tipoInput}" aria-label="${esc(nombre)}: valor" placeholder="Valor" value="${esc(valor)}"${CX_FILTRO_DATALIST[campo] ? ` list="${CX_FILTRO_DATALIST[campo]}"` : ''} autocomplete="off">`;
  const atajos = campo === 'codigoHIS'
    ? `<div class="cx-sugerencias">${CX_SUGERENCIAS.map(([c, t]) => `<button type="button" class="cx-sugerencia" data-cx-dx="${c}">${esc(t)} (${c})</button>`).join('')}</div>`
    : campo === 'edad'
      ? `<div class="cx-sugerencias">${CX_EDADES.map(([d, h, t]) => `<button type="button" class="cx-sugerencia" data-cx-edad="${d}" data-cx-edad2="${h}">${esc(t)}</button>`).join('')}</div>`
      : '';
  return `<div class="cx-fila cx-filtro">
    <span class="cx-filtro-nombre">${esc(nombre)}</span>
    <input type="hidden" class="cx-f-campo" value="${campo}">
    <select class="select-native cx-f-operador" aria-label="${esc(nombre)}: condición">${cxOpciones(CX_OPERADORES[tipo], operador)}</select>
    ${entrada}
    <input class="input cx-f-valor2" type="${tipoInput}" aria-label="${esc(nombre)}: hasta" placeholder="Hasta" value="${esc(f.value2 ?? '')}"${operador === 'between' ? '' : ' hidden'}>
    ${atajos}
  </div>`;
}

function cxPintarFormulario(items = []) {
  const de = campo => items.find(i => i.field === campo);
  cxEl('cxFormulario').innerHTML = CX_SECCIONES.map(([titulo, campos], i) => `<section class="cx-seccion" id="cxSeccion${i}" role="tabpanel" aria-label="${esc(titulo)}" data-cx-seccion="${i}"${CX.pestana === String(i) ? '' : ' hidden'}><div class="cx-seccion-campos">${campos.map(c => cxFiltroHtml(c, de(c))).join('')}</div></section>`).join('');
}

// ── Pestañas de filtros: solo una abierta; pulsar la abierta la cierra. ──
const cxSeccionDeCampo = campo => String(CX_SECCIONES.findIndex(([, campos]) => campos.includes(campo)));

function cxPintarPestanas(cuentas = {}) {
  const pestanas = [...CX_SECCIONES.map(([titulo], i) => [String(i), titulo, `cxSeccion${i}`]), ['bloques', 'Búsqueda avanzada (Y / O)', 'cxSeccionBloques']];
  cxEl('cxPestanas').innerHTML = pestanas.map(([id, titulo, panel]) => {
    const activa = CX.pestana === id;
    const n = cuentas[id] || 0;
    return `<button type="button" class="cx-pestana${activa ? ' active' : ''}${n ? ' con-filtros' : ''}" role="tab" aria-selected="${activa}" aria-controls="${panel}" data-cx-pestana="${id}">${esc(titulo)}${n ? ` <span class="cx-cuenta">${n}</span>` : ''}<span class="cx-flecha" aria-hidden="true">▾</span></button>`;
  }).join('');
}

function cxMostrarPestana(id) {
  CX.pestana = CX.pestana === id ? null : id;
  cxEl('cxFormulario').querySelectorAll('[data-cx-seccion]').forEach(s => { s.hidden = s.dataset.cxSeccion !== CX.pestana; });
  cxEl('cxSeccionBloques').hidden = CX.pestana !== 'bloques';
  const conFoco = document.activeElement?.dataset?.cxPestana;
  cxActualizarFrase();
  // Las pestañas se redibujan: devuelve el foco a la que se pulsó.
  if (conFoco) cxEl('cxPestanas').querySelector(`[data-cx-pestana="${conFoco}"]`)?.focus();
}

// Texto corto de un filtro para su ficha: «Sexo: Mujeres», «Edad entre 0 y 11».
function cxTextoFiltro(f) {
  const [, nombre, tipo] = CX_CAMPOS.find(c => c[0] === f.field);
  const lista = CX_FILTRO_LISTA[f.field];
  const valor = Array.isArray(f.value) ? f.value.join(', ') : (lista?.find(([v]) => v === f.value)?.[1] || f.value);
  if (lista && f.operator === 'equals') return `${nombre}: ${valor}`;
  const operador = (CX_OPERADORES[tipo].find(([o]) => o === f.operator)?.[1] || f.operator).replace(/ \(.*\)$/, '');
  return `${nombre} ${operador} ${valor}${f.operator === 'between' ? ` y ${f.value2}` : ''}`;
}

function cxLeerFormulario() {
  const items = [...cxEl('cxFormulario').querySelectorAll('.cx-fila')].map(cxLeerFila).filter(cxFilaCompleta);
  return items.length ? { scope: cxEl('cxFormAmbito').value, mode: cxEl('cxFormModo').value, nextMode: cxEl('cxFormSiguiente').value, items } : null;
}

// ── Bloques Y / O ──
function cxFilaHtml(f = {}) {
  const campo = f.field || 'codigoHIS';
  const tipo = cxTipoCampo(campo);
  const operador = f.operator || 'equals';
  const tipoInput = tipo === 'date' && !['year', 'month'].includes(operador) ? 'date' : 'text';
  const valor = Array.isArray(f.value) ? f.value.join(', ') : (f.value ?? '');
  return `<div class="cx-fila">
    <select class="select-native cx-f-campo" aria-label="Campo">${cxOpciones(CX_CAMPOS, campo)}</select>
    <select class="select-native cx-f-operador" aria-label="Condición">${cxOpciones(CX_OPERADORES[tipo], operador)}</select>
    <input class="input cx-f-valor" type="${tipoInput}" placeholder="Valor" aria-label="Valor" value="${esc(valor)}">
    <input class="input cx-f-valor2" type="${tipoInput}" placeholder="Hasta" aria-label="Hasta" value="${esc(f.value2 ?? '')}"${operador === 'between' ? '' : ' hidden'}>
    <button type="button" class="cx-quitar" data-cx-quitar-fila aria-label="Quitar criterio" title="Quitar criterio">×</button>
  </div>`;
}

function cxBloqueHtml(b = {}) {
  const items = b.items?.length ? b.items : [{}];
  return `<div class="cx-bloque">
    <div class="cx-bloque-cabecera">
      <label class="cx-campo"><span>Dónde buscar</span>
        <select class="select-native cx-b-ambito">${cxOpciones([['cita', 'En la misma cita'], ['paciente', 'En el mismo paciente'], ['registro', 'En el mismo diagnóstico / procedimiento']], b.scope || 'cita')}</select>
      </label>
      <label class="cx-campo cx-b-regla"><span>Condición</span>
        <select class="select-native cx-b-modo">${cxOpciones([['AND', 'Todas las condiciones (Y)'], ['OR', 'Cualquiera de estas (O)']], b.mode || 'AND')}</select>
      </label>
      <button type="button" class="cx-quitar" data-cx-quitar-bloque aria-label="Quitar grupo" title="Quitar grupo">×</button>
    </div>
    <div class="cx-b-filas">${items.map(cxFilaHtml).join('')}</div>
    <button type="button" class="cx-mas" data-cx-agregar-fila>+ Agregar condición</button>
    <label class="cx-conector"><span>Con el grupo siguiente:</span>
      <select class="select-native cx-b-siguiente">${cxOpciones([['AND', 'Y además'], ['OR', 'O bien']], b.nextMode || 'AND')}</select>
    </label>
  </div>`;
}

function cxPintarBloques(bloques) {
  cxEl('cxBloques').innerHTML = bloques.map(cxBloqueHtml).join('');
  cxActualizarBloques();
}

// Oculta lo que aún no aplica: la regla con un solo criterio y el conector del último bloque.
function cxActualizarBloques() {
  const bloques = [...cxEl('cxBloques').querySelectorAll('.cx-bloque')];
  bloques.forEach((b, i) => {
    b.querySelector('.cx-b-regla').hidden = b.querySelectorAll('.cx-fila').length < 2;
    b.querySelector('.cx-conector').hidden = i === bloques.length - 1;
  });
  cxEl('cxFormConector').hidden = !bloques.length;
}

function cxLeerFila(fila) {
  const operator = fila.querySelector('.cx-f-operador').value;
  const crudo = fila.querySelector('.cx-f-valor').value.trim();
  const value2 = fila.querySelector('.cx-f-valor2').value.trim();
  return { field: fila.querySelector('.cx-f-campo').value, operator, value: operator === 'in' ? crudo.split(',').map(v => v.trim()).filter(Boolean) : crudo, value2: value2 || null };
}
const cxFilaCompleta = f => (Array.isArray(f.value) ? f.value.length > 0 : f.value !== '') && (f.operator !== 'between' || Boolean(f.value2));

function cxLeerBloques() {
  return [...cxEl('cxBloques').querySelectorAll('.cx-bloque')].map(b => ({
    scope: b.querySelector('.cx-b-ambito').value,
    mode: b.querySelector('.cx-b-modo').value,
    nextMode: b.querySelector('.cx-b-siguiente').value,
    items: [...b.querySelectorAll('.cx-fila')].map(cxLeerFila).filter(cxFilaCompleta)
  })).filter(b => b.items.length);
}

// Un criterio a medias se rechaza: ignorarlo daría una consulta más amplia sin avisar.
function cxHayCriteriosIncompletos() {
  return [...document.querySelectorAll('#cxFormulario .cx-fila, #cxBloques .cx-fila')].some(fila => {
    const f = cxLeerFila(fila);
    return (fila.querySelector('.cx-f-valor').value.trim() || f.value2) && !cxFilaCompleta(f);
  });
}

function cxEventoFila(fila, objetivo) {
  const campo = fila.querySelector('.cx-f-campo');
  const operador = fila.querySelector('.cx-f-operador');
  const tipo = cxTipoCampo(campo.value);
  if (objetivo === campo) {
    operador.innerHTML = cxOpciones(CX_OPERADORES[tipo], operador.value);
    fila.querySelector('.cx-f-valor').value = ''; fila.querySelector('.cx-f-valor2').value = '';
  }
  if (fila.classList.contains('cx-filtro') && CX_FILTRO_LISTA[campo.value] && objetivo === operador) {
    fila.outerHTML = cxFiltroHtml(campo.value, { operator: operador.value });
    return;
  }
  const valor = fila.querySelector('.cx-f-valor');
  const valor2 = fila.querySelector('.cx-f-valor2');
  valor2.hidden = operador.value !== 'between';
  const tipoInput = tipo === 'date' && !['year', 'month'].includes(operador.value) ? 'date' : 'text';
  if (valor.tagName === 'INPUT') valor.type = tipoInput;
  valor2.type = tipoInput;
}

// ── Estado del panel ──
function cxPintarMedida() {
  cxEl('cxMedida').value = CX.medida;
}

function cxPintarGrupos() {
  document.querySelectorAll('#view-consultas [data-cx-grupo]').forEach(b => {
    const activo = CX.grupos.has(b.dataset.cxGrupo);
    b.classList.toggle('active', activo);
    b.setAttribute('aria-pressed', String(activo));
  });
  const nombres = [...CX.grupos].map(cxNombreGrupo);
  cxEl('cxGruposResumen').textContent = nombres.length ? nombres.join(', ') : 'Total general (sin dividir)';
}

function cxActualizarFrase() {
  const grupos = [...CX.grupos].map(cxNombreGrupo).join(', ');
  const formulario = cxLeerFormulario();
  const items = formulario ? formulario.items : [];
  const enBloques = cxLeerBloques().reduce((t, b) => t + b.items.length, 0);
  const total = items.length + enBloques;
  CX.frase = `Mostrando: ${cxNombreMedida(CX.medida).toLowerCase()}${grupos ? `, organizado por ${grupos}` : ', en total general'}, ${cxTextoPeriodo()}${total ? `, con ${total} ${total === 1 ? 'filtro' : 'filtros'}` : ''}.`;
  cxEl('cxFrase').textContent = CX.frase;

  // Cuántos filtros hay en cada pestaña y una ficha por cada uno, para verlos con las pestañas cerradas.
  const cuentas = { bloques: enBloques };
  items.forEach(f => { const s = cxSeccionDeCampo(f.field); cuentas[s] = (cuentas[s] || 0) + 1; });
  cxPintarPestanas(cuentas);
  cxEl('cxChips').innerHTML = [
    ...items.map(f => `<span class="cx-chip"><button type="button" class="cx-chip-texto" data-cx-pestana-ir="${cxSeccionDeCampo(f.field)}" title="Editar">${esc(cxTextoFiltro(f))}</button><button type="button" class="cx-chip-quitar" data-cx-quitar-filtro="${esc(f.field)}" aria-label="Quitar filtro ${esc(cxTextoFiltro(f))}">×</button></span>`),
    enBloques ? `<span class="cx-chip"><button type="button" class="cx-chip-texto" data-cx-pestana-ir="bloques" title="Editar">${enBloques} ${enBloques === 1 ? 'condición' : 'condiciones'} en búsqueda avanzada (Y / O)</button></span>` : ''
  ].join('');
  cxEl('cxActivos').hidden = !total;
  const ambito = { cita: 'en la misma cita', paciente: 'en el mismo paciente', registro: 'en el mismo dx/proc.' }[cxEl('cxFormAmbito').value];
  cxEl('cxReglasResumen').textContent = `${ambito} · ${cxEl('cxFormModo').value === 'OR' ? 'al menos uno' : 'todos'}`;
}

function cxLimpiarFiltros() {
  cxPintarFormulario();
  cxEl('cxFormAmbito').value = 'cita';
  cxEl('cxFormModo').value = 'AND';
  cxEl('cxFormSiguiente').value = 'AND';
}

function cxRestablecer() {
  CX.medida = 'pacientesUnicos';
  CX.grupos = new Set(['diagnostico']);
  cxPintarMedida();
  cxPintarGrupos();
  cxEl('cxPeriodo').selectedIndex = 0;
  cxEl('cxFechas').hidden = true;
  sv('cxDesde', ''); sv('cxHasta', '');
  cxLimpiarFiltros();
  cxPintarBloques([]);
  cxActualizarFrase();
}

// ── Ejecutar ──
function cxArmarConsulta() {
  const formulario = cxLeerFormulario();
  const filterGroups = [...(formulario ? [formulario] : []), ...cxLeerBloques()];
  return { measure: CX.medida, groupBy: [...CX.grupos], filters: filterGroups.flatMap(g => g.items), filterGroups, logicMode: 'AND', period: cxPeriodoActual() };
}

async function cxConsultar() {
  if (cxHayCriteriosIncompletos()) { showAlert('Completa o quita los criterios a medias antes de consultar.', 'warn'); return; }
  const consulta = cxArmarConsulta();
  const secuencia = ++CX.secuencia;
  const boton = cxEl('cxConsultar');
  boton.disabled = true;
  boton.textContent = 'Consultando…';
  cxEl('globalAlert').className = 'alert';
  try {
    const datos = await apiFetch('/consultas/ejecutar', { method: 'POST', body: JSON.stringify(consulta) });
    if (secuencia !== CX.secuencia) return;
    // El servidor no devuelve el periodo; el detalle por fila lo necesita.
    datos.period = consulta.period;
    datos.frase = CX.frase;
    cxPintarResultados(datos);
    cxEl('cxResultados').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    if (secuencia === CX.secuencia) showAlert(error.message || 'No se pudo ejecutar la consulta.', 'error');
  } finally {
    if (secuencia === CX.secuencia) { boton.disabled = false; boton.textContent = 'Consultar'; }
  }
}

// ── Resultados ──
function cxPintarResultados(datos) {
  currentQueryResult = datos;
  cxEl('cxResultados').hidden = false;
  cxEl('cxFraseResultado').textContent = datos.frase || '';
  CX.filas = Array.isArray(datos.rows) ? datos.rows : [];
  currentFilteredRows = [...CX.filas];
  const s = datos.summary || {};
  cxEl('cxTotalEtiqueta').textContent = cxNombreMedida(datos.measure);
  cxEl('cxTotal').textContent = s.total === null || s.total === undefined ? '—' : formatNumber(s.total);
  cxEl('cxPacientes').textContent = formatNumber(s.pacientes);
  cxEl('cxCitas').textContent = formatNumber(s.atenciones);
  cxEl('cxRegistros').textContent = formatNumber(s.registros);
  cxEl('cxFilas').textContent = formatNumber(s.rows);
  // La medida elegida ya está en la cifra principal: no se repite.
  cxEl('cxResPacientes').hidden = datos.measure === 'pacientesUnicos';
  cxEl('cxResCitas').hidden = datos.measure === 'atenciones';
  cxEl('cxResRegistros').hidden = datos.measure === 'registros';
  cxEl('cxInsignia').textContent = `solo las primeras ${formatNumber(datos.rowLimit)}`;
  cxEl('cxInsignia').hidden = !datos.truncated;
  cxEl('cxBuscar').value = '';
  CX.filtrosTabla = {};
  if (datos.truncated) showAlert(`Se muestran los primeros ${formatNumber(datos.rowLimit)} grupos. Acota los filtros para ver el resto.`, 'info');

  const duplicada = { pacientesUnicos: 'pacientes', atenciones: 'atenciones', registros: 'registros' }[datos.measure];
  CX.columnas = CX.filas.length ? Object.keys(CX.filas[0]).filter(c => c !== duplicada) : [];
  // Lo cronológico se lee en orden de fechas; lo demás, de mayor a menor.
  const temporal = datos.groupBy?.length === 1 && CX_TEMPORALES.includes(datos.groupBy[0]);
  CX.orden = temporal ? datos.groupBy[0] : 'total';
  CX.ordenAsc = temporal;
  CX.pagina = 1;
  cxActualizarEstadoBuscador();
  cxOrdenar();
  cxPintarGrafico(datos);
}

function cxOrdenar() {
  const col = CX.orden;
  if (col) {
    const numerica = currentNumericColumns.includes(col);
    const signo = CX.ordenAsc ? 1 : -1;
    currentFilteredRows.sort((a, b) => {
      const x = a[col], y = b[col];
      // Lo vacío va siempre al final, sea cual sea la dirección.
      if (x === null || x === undefined) return y === null || y === undefined ? 0 : 1;
      if (y === null || y === undefined) return -1;
      return signo * (numerica ? Number(x) - Number(y) : String(x).localeCompare(String(y), 'es', { numeric: true, sensitivity: 'base' }));
    });
  }
  cxPintarTabla();
}

function cxCeldaHtml(col, fila, i) {
  const v = fila[col];
  const texto = esc(cxValorCelda(col, v));
  if (v === null || v === undefined || v === '') return `<td>${texto}</td>`;
  if (['idPaciente', 'documento', 'nombrePaciente'].includes(col)) return `<td><button type="button" class="cx-enlace" data-cx-abrir="paciente" data-i="${i}" title="Abrir la historia de este paciente">${texto}</button></td>`;
  if (['codigoHIS', 'diagnostico'].includes(col)) return `<td><button type="button" class="cx-enlace" data-cx-abrir="codigo" data-i="${i}" title="Ver la actividad de este código">${texto}</button></td>`;
  if (col === 'profesional') return `<td><button type="button" class="cx-enlace" data-cx-abrir="profesional" data-i="${i}" title="Abrir la ficha de este profesional">${texto}</button></td>`;
  if (col === 'atenciones') return `<td class="cx-num"><button type="button" class="cx-enlace" data-cx-abrir="citas" data-i="${i}" title="Ver las citas de esta fila">${texto}</button></td>`;
  if (col === 'registros') return `<td class="cx-num"><button type="button" class="cx-enlace" data-cx-abrir="registros" data-i="${i}" title="Ver los registros de esta fila">${texto}</button></td>`;
  return `<td class="${currentNumericColumns.includes(col) ? 'cx-num' : ''}">${texto}</td>`;
}

function cxPintarTabla() {
  const thead = cxEl('cxTabla').querySelector('thead');
  const tbody = cxEl('cxTabla').querySelector('tbody');
  const paginacion = cxEl('cxPaginacion');
  if (!CX.columnas.length) {
    thead.innerHTML = '';
    tbody.innerHTML = `<tr><td class="table-empty">${currentQueryResult ? 'No se encontró información con esos filtros.' : 'Todavía no hay resultados.'}</td></tr>`;
    paginacion.hidden = true;
    return;
  }
  thead.innerHTML = `<tr>${CX.columnas.map(col => {
    const activa = CX.orden === col;
    return `<th data-no-sort class="${currentNumericColumns.includes(col) ? 'cx-num' : ''}" aria-sort="${activa ? (CX.ordenAsc ? 'ascending' : 'descending') : 'none'}"><button type="button" class="cx-th" data-cx-orden="${esc(col)}">${esc(col === 'total' ? cxNombreMedida(currentQueryResult.measure) : COLUMN_LABELS[col] || col)}<span aria-hidden="true">${activa ? (CX.ordenAsc ? '▲' : '▼') : '↕'}</span></button></th>`;
  }).join('')}<th data-no-sort><span class="sr-only">Detalle</span></th></tr>`;

  const total = currentFilteredRows.length;
  if (!total) {
    tbody.innerHTML = `<tr><td class="table-empty" colspan="${CX.columnas.length + 1}">Ninguna fila coincide con la búsqueda.</td></tr>`;
    paginacion.hidden = true;
    return;
  }
  const tam = CX.porPagina === -1 ? total : CX.porPagina;
  const paginas = Math.max(1, Math.ceil(total / tam));
  CX.pagina = Math.min(Math.max(1, CX.pagina), paginas);
  const desde = (CX.pagina - 1) * tam;
  const hasta = Math.min(desde + tam, total);
  tbody.innerHTML = currentFilteredRows.slice(desde, hasta).map((fila, n) => {
    const i = desde + n;
    return `<tr>${CX.columnas.map(c => cxCeldaHtml(c, fila, i)).join('')}<td class="cx-acc"><button type="button" class="btn btn-secondary btn-xs" data-cx-abrir="citas" data-i="${i}">Ver citas</button></td></tr>`;
  }).join('');
  paginacion.hidden = false;
  paginacion.innerHTML = `<span>${formatNumber(desde + 1)}–${formatNumber(hasta)} de ${formatNumber(total)}</span>
    <div><button type="button" class="btn btn-secondary btn-sm" data-cx-pagina="${CX.pagina - 1}"${CX.pagina <= 1 ? ' disabled' : ''}>Anterior</button>
    <span>Página ${formatNumber(CX.pagina)} de ${formatNumber(paginas)}</span>
    <button type="button" class="btn btn-secondary btn-sm" data-cx-pagina="${CX.pagina + 1}"${CX.pagina >= paginas ? ' disabled' : ''}>Siguiente</button></div>`;
}

// Explorador analítico y filtros interactivos: aporta resúmenes por dimensión, concentración e indicadores en lugar de repetir la tabla.
function cxEtiquetaFaceta(campo, valorCrudo) {
  if (valorCrudo === '__EMPTY__') return 'Sin dato';
  if (campo === 'tipoDiagnostico') {
    const mapa = { D: 'D · Definitivo', P: 'P · Presuntivo', R: 'R · Repetido' };
    return mapa[valorCrudo] || valorCrudo;
  }
  return cxValorCelda(campo, valorCrudo);
}

function cxActualizarEstadoBuscador() {
  const q = cxEl('cxBuscar').value.trim();
  const activos = Object.entries(CX.filtrosTabla);
  const hayFiltro = Boolean(q || activos.length);
  const estado = cxEl('cxBuscarEstado');
  const limpiar = cxEl('cxLimpiarTabla');
  const chips = cxEl('cxFiltrosTabla');
  if (estado) {
    estado.hidden = !hayFiltro;
    estado.textContent = hayFiltro ? `${formatNumber(currentFilteredRows.length)} de ${formatNumber(CX.filas.length)} filas` : '';
  }
  if (limpiar) limpiar.hidden = !hayFiltro;
  if (chips) {
    chips.hidden = !activos.length;
    chips.innerHTML = activos.map(([campo, val]) => `<span class="cx-chip"><span>${esc(cxNombreGrupo(campo))}: <strong>${esc(cxEtiquetaFaceta(campo, val))}</strong></span><button type="button" class="cx-chip-quitar" data-cx-quitar-faceta="${esc(campo)}" aria-label="Quitar filtro">×</button></span>`).join('');
  }
}

function cxAplicarFiltrosTabla() {
  const terminos = cxEl('cxBuscar').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const facetas = Object.entries(CX.filtrosTabla);
  currentFilteredRows = CX.filas.filter(fila => {
    for (const [campo, val] of facetas) {
      const crudo = fila[campo];
      const norm = crudo === null || crudo === undefined || crudo === '' ? '__EMPTY__' : String(crudo);
      if (norm !== val) return false;
    }
    if (terminos.length) {
      const textoFila = Object.values(fila).filter(v => v !== null && v !== undefined).map(v => String(v).toLowerCase()).join(' ');
      if (!terminos.every(t => textoFila.includes(t))) return false;
    }
    return true;
  });
  CX.pagina = 1;
  cxActualizarEstadoBuscador();
  cxOrdenar();
  if (currentQueryResult) cxPintarGrafico(currentQueryResult);
}

function cxToggleFiltroTabla(campo, valor) {
  if (CX.filtrosTabla[campo] === valor) delete CX.filtrosTabla[campo];
  else CX.filtrosTabla[campo] = valor;
  cxAplicarFiltrosTabla();
}

function cxPintarGrafico(datos) {
  const caja = cxEl('cxGrafico');
  const grupos = datos.groupBy || [];
  const filas = CX.filas.filter(f => f.total !== null && f.total !== undefined);
  if (!filas.length) { caja.innerHTML = '<div class="table-empty">No hay datos para analizar.</div>'; return; }
  if (!grupos.length) { caja.innerHTML = '<div class="table-empty">Elige «Ver resultados por» para desglosar y explorar la distribución.</div>'; return; }
  const medida = cxNombreMedida(datos.measure);
  const esPromedio = datos.measure.startsWith('avg') || datos.measure.startsWith('max');

  // 1) Serie temporal (mes, día, año): indicadores de tendencia + columnas clicables.
  if (grupos.length === 1 && CX_TEMPORALES.includes(grupos[0])) {
    const campo = grupos[0];
    const serie = [...filas].sort((a, b) => String(a[campo]).localeCompare(String(b[campo]), 'es', { numeric: true })).slice(-24);
    const max = Math.max(...serie.map(f => Number(f.total)), 1);
    const alto = serie.reduce((m, f, i) => (Number(f.total) > Number(serie[m].total) ? i : m), 0);
    const promedio = serie.reduce((s, f) => s + Number(f.total), 0) / serie.length;
    const ultimo = serie[serie.length - 1];
    const etq = f => cxValorCelda(campo, f[campo]);
    caja.innerHTML = `
      <div class="cx-insights">
        <div class="cx-insight-card"><span class="cx-insight-etq">Periodos analizados</span><strong class="cx-insight-val">${formatNumber(filas.length)}</strong><span class="cx-insight-sub">Mostrando últimos ${serie.length}</span></div>
        <div class="cx-insight-card"><span class="cx-insight-etq">Pico máximo</span><strong class="cx-insight-val">${esc(formatNumber(serie[alto].total))}</strong><span class="cx-insight-sub">${esc(etq(serie[alto]))}</span></div>
        <div class="cx-insight-card"><span class="cx-insight-etq">Promedio por periodo</span><strong class="cx-insight-val">${esc(formatNumber(Math.round(promedio * 10) / 10))}</strong><span class="cx-insight-sub">${esc(medida)}</span></div>
        <div class="cx-insight-card"><span class="cx-insight-etq">Último periodo (${esc(etq(ultimo))})</span><strong class="cx-insight-val">${esc(formatNumber(ultimo.total))}</strong><span class="cx-insight-sub">Haz clic en una barra para filtrar</span></div>
      </div>
      <h4 class="cx-graf-titulo">Evolución de ${esc(medida.toLowerCase())} por ${esc(cxNombreGrupo(campo).toLowerCase())}</h4>
      <div class="cx-columnas">${serie.map((f, i) => {
        const valRaw = f[campo] === null || f[campo] === undefined || f[campo] === '' ? '__EMPTY__' : String(f[campo]);
        const activa = CX.filtrosTabla[campo] === valRaw;
        return `<button type="button" class="cx-col${activa ? ' active' : ''}" data-cx-faceta="${esc(campo)}" data-cx-valor="${esc(valRaw)}" title="${esc(`${etq(f)}: ${formatNumber(f.total)} (clic para filtrar)`)}" style="border:0;background:transparent;font:inherit;">
          <span class="cx-col-valor">${i === alto || i === serie.length - 1 ? esc(formatNumber(f.total)) : ''}</span>
          <span class="cx-col-barra"><i style="height:${Math.max(1, Number(f.total) / max * 100)}%"></i></span>
          <span class="cx-col-etq">${esc(etq(f))}</span></button>`;
      }).join('')}</div>`;
    return;
  }

  // 2) Múltiples dimensiones: desglose independiente por cada dimensión (facetas clicables para filtrar la tabla).
  if (grupos.length > 1) {
    const dimensiones = grupos.slice(0, 4);
    const usarRegistros = esPromedio || datos.measure === 'pacientesUnicos' || datos.measure === 'codigosUnicos';
    const metricaCol = usarRegistros && filas[0].atenciones !== undefined ? 'atenciones' : 'total';
    const etiquetaMetrica = metricaCol === 'atenciones' ? 'citas' : medida.toLowerCase();

    const tarjetas = dimensiones.map(campo => {
      const mapa = new Map();
      let sumaTotal = 0;
      filas.forEach(f => {
        const valRaw = f[campo] === null || f[campo] === undefined || f[campo] === '' ? '__EMPTY__' : String(f[campo]);
        const peso = Number(f[metricaCol]) || 0;
        sumaTotal += peso;
        mapa.set(valRaw, (mapa.get(valRaw) || 0) + peso);
      });
      const ordenados = [...mapa.entries()].sort((a, b) => b[1] - a[1]);
      const top = ordenados.slice(0, 6);
      const maxVal = Math.max(...top.map(([, v]) => v), 1);
      return `<div class="cx-faceta-card">
        <h5 class="cx-faceta-titulo">${esc(cxNombreGrupo(campo))} <span>${formatNumber(ordenados.length)} distintos</span></h5>
        <div class="cx-faceta-lista">
          ${top.map(([valRaw, suma]) => {
            const pct = sumaTotal > 0 ? Math.round((suma / sumaTotal) * 1000) / 10 : 0;
            const activa = CX.filtrosTabla[campo] === valRaw;
            return `<button type="button" class="cx-faceta-item${activa ? ' active' : ''}" data-cx-faceta="${esc(campo)}" data-cx-valor="${esc(valRaw)}" title="Clic para filtrar la tabla por ${esc(cxEtiquetaFaceta(campo, valRaw))}">
              <span class="cx-faceta-nombre">${esc(cxEtiquetaFaceta(campo, valRaw))}</span>
              <span class="cx-faceta-num"><strong>${esc(formatNumber(suma))}</strong> (${pct}%)</span>
              <span class="cx-faceta-pista"><i style="width:${Math.max(2, (suma / maxVal) * 100)}%"></i></span>
            </button>`;
          }).join('')}
        </div>
      </div>`;
    }).join('');

    caja.innerHTML = `
      <div class="cx-facetas-cabecera">
        <h4 class="cx-graf-titulo">Resumen interactivo por dimensión (${esc(etiquetaMetrica)})</h4>
        <span class="cx-facetas-ayuda">Haz clic en cualquier elemento para filtrar la tabla de abajo</span>
      </div>
      <div class="cx-facetas">${tarjetas}</div>`;
    return;
  }

  // 3) Una sola dimensión no temporal: indicadores de concentración + distribución clicable con porcentaje.
  const campo = grupos[0];
  const ordenados = [...filas].sort((a, b) => Number(b.total) - Number(a.total));
  const sumaFilas = ordenados.reduce((s, f) => s + Number(f.total), 0);
  const top5Suma = ordenados.slice(0, 5).reduce((s, f) => s + Number(f.total), 0);
  const concTop5 = sumaFilas > 0 ? Math.round((top5Suma / sumaFilas) * 1000) / 10 : 0;
  const promedio = sumaFilas / ordenados.length;
  const s = datos.summary || {};
  const ratioClinico = s.atenciones && s.pacientes
    ? `${(Number(s.atenciones) / Number(s.pacientes)).toFixed(2)} citas/paciente`
    : (s.registros && s.atenciones ? `${(Number(s.registros) / Number(s.atenciones)).toFixed(2)} ítems/cita` : '—');
  const mayores = ordenados.slice(0, 8);
  const max = Math.max(...mayores.map(f => Number(f.total)), 1);

  caja.innerHTML = `
    <div class="cx-insights">
      <div class="cx-insight-card"><span class="cx-insight-etq">Categorías encontradas</span><strong class="cx-insight-val">${formatNumber(ordenados.length)}</strong><span class="cx-insight-sub">${esc(cxNombreGrupo(campo))}</span></div>
      <div class="cx-insight-card"><span class="cx-insight-etq">Concentración Top 5</span><strong class="cx-insight-val">${esPromedio ? '—' : `${concTop5}%`}</strong><span class="cx-insight-sub">${esPromedio ? 'No aplica a promedios' : 'Peso de los 5 mayores'}</span></div>
      <div class="cx-insight-card"><span class="cx-insight-etq">Promedio por categoría</span><strong class="cx-insight-val">${esc(formatNumber(Math.round(promedio * 10) / 10))}</strong><span class="cx-insight-sub">${esc(medida)}</span></div>
      <div class="cx-insight-card"><span class="cx-insight-etq">Intensidad clínica</span><strong class="cx-insight-val">${esc(ratioClinico)}</strong><span class="cx-insight-sub">${s.registros && s.atenciones ? `${(Number(s.registros) / Number(s.atenciones)).toFixed(1)} dx/proc. por cita` : 'Promedio general'}</span></div>
    </div>
    <div class="cx-facetas-cabecera">
      <h4 class="cx-graf-titulo">${esc(medida)}: los ${mayores.length} mayores (clic para filtrar)</h4>
    </div>
    <div class="cx-barras">${mayores.map(f => {
      const valRaw = f[campo] === null || f[campo] === undefined || f[campo] === '' ? '__EMPTY__' : String(f[campo]);
      const etq = cxEtiquetaFaceta(campo, valRaw);
      const pct = !esPromedio && sumaFilas > 0 ? ` · ${Math.round((Number(f.total) / sumaFilas) * 1000) / 10}%` : '';
      const activa = CX.filtrosTabla[campo] === valRaw;
      return `<button type="button" class="cx-barra${activa ? ' active' : ''}" data-cx-faceta="${esc(campo)}" data-cx-valor="${esc(valRaw)}" title="${esc(`${etq}: ${formatNumber(f.total)}${pct} (clic para filtrar)`)}">
        <span class="cx-barra-etq">${esc(etq)}</span>
        <span class="cx-barra-pista"><i style="width:${Math.max(0.5, Number(f.total) / max * 100)}%"></i></span>
        <strong>${esc(formatNumber(f.total))}${esc(pct)}</strong></button>`;
    }).join('')}</div>`;
}

function cxAbrirDesdeTabla(boton, evento) {
  const i = Number(boton.dataset.i);
  const fila = currentFilteredRows[i];
  if (!fila) return;
  const accion = boton.dataset.cxAbrir;
  if (accion === 'paciente') abrirFichaPacienteDesdeResultados(fila.idPaciente || fila.documento || fila.nombrePaciente, fila.nombrePaciente || '', evento);
  else if (accion === 'codigo') abrirModalActividadCodigo(fila.codigoHIS || fila.diagnostico, fila.diagnostico || '', evento);
  else if (accion === 'profesional') abrirPersonalDesdeResultados(fila.profesional, evento);
  else abrirModalDetalleAtencionesFila(i, accion, evento);
}

// ── Guardadas (mismo almacén que las versiones anteriores, para no perder las ya guardadas) ──
function cxLeerGuardadas() {
  try {
    const lista = JSON.parse(localStorage.getItem('his_saved_queries') || '[]');
    return Array.isArray(lista) ? lista : [];
  } catch { return []; }
}
function cxEscribirGuardadas(lista) {
  try { localStorage.setItem('his_saved_queries', JSON.stringify(lista)); return true; } catch { return false; }
}

function cxGuardar() {
  if (cxHayCriteriosIncompletos()) { showAlert('Completa o quita los criterios a medias antes de guardar.', 'warn'); return; }
  const lista = cxLeerGuardadas();
  const nombre = window.prompt('Nombre de la consulta:', `Consulta ${lista.length + 1}`);
  if (nombre === null) return;
  const label = nombre.trim().slice(0, 100);
  if (!label) { showAlert('Escribe un nombre para guardar la consulta.', 'warn'); return; }
  lista.push({
    id: `query-${Date.now()}`, label,
    payload: { ...cxArmarConsulta(), savedAt: new Date().toISOString() },
    panel: { formulario: Boolean(cxLeerFormulario()), periodo: cxEl('cxPeriodo').value }
  });
  toast(cxEscribirGuardadas(lista) ? `Consulta «${label}» guardada en este navegador` : 'No se pudo guardar en este navegador', 'success');
}

function cxCargarGuardada(item) {
  const p = item.payload || {};
  const legado = { ID_pasciente: 'idPaciente' };
  const medida = p.measure === 'personasUnicas' ? 'pacientesUnicos' : (p.measure || 'pacientesUnicos');
  cxRestablecer();
  CX.medida = medida;
  CX.grupos = new Set((Array.isArray(p.groupBy) ? p.groupBy : []).map(g => legado[g] || g));
  cxPintarMedida();
  cxPintarGrupos();
  const panel = item.panel;
  const opcionPeriodo = panel && [...cxEl('cxPeriodo').options].some(o => o.value === panel.periodo) ? panel.periodo : null;
  cxEl('cxPeriodo').value = opcionPeriodo && opcionPeriodo !== 'rango' ? opcionPeriodo : (p.period?.start || p.period?.end ? 'rango' : 'todo');
  cxEl('cxFechas').hidden = cxEl('cxPeriodo').value !== 'rango';
  sv('cxDesde', p.period?.start || '');
  sv('cxHasta', p.period?.end || '');
  const grupos = Array.isArray(p.filterGroups) && p.filterGroups.length ? p.filterGroups : (Array.isArray(p.filters) && p.filters.length ? [{ mode: p.logicMode || 'AND', items: p.filters, scope: 'cita' }] : []);
  const bloques = grupos.map(g => ({ ...g, nextMode: g.nextMode || p.logicMode || 'AND', items: (g.items || []).map(f => ({ ...f, field: legado[f.field] || f.field })) }));
  // Solo las guardadas con este panel traen el formulario como primer bloque; las anteriores se abren como bloques.
  if (panel?.formulario && bloques.length) {
    const [form, ...resto] = bloques;
    cxPintarFormulario(form.items);
    cxEl('cxFormAmbito').value = form.scope || 'cita';
    cxEl('cxFormModo').value = form.mode || 'AND';
    cxEl('cxFormSiguiente').value = form.nextMode || 'AND';
    cxPintarBloques(resto);
  } else {
    cxPintarBloques(bloques);
  }
  cxActualizarFrase();
  cerrarModal();
  toast(`Consulta «${item.label}» cargada. Pulsa «Consultar» para ejecutarla.`, 'info');
}

function cxAbrirGuardadas() {
  const lista = cxLeerGuardadas();
  abrirModal('Consultas guardadas', lista.length
    ? `<ul class="cx-guardadas">${lista.map(q => `<li><span>${esc(q.label || 'Consulta')}</span><span><button type="button" class="btn btn-primary btn-sm" data-cx-cargar="${esc(q.id)}">Cargar</button> <button type="button" class="btn btn-ghost btn-sm" data-cx-borrar="${esc(q.id)}">Eliminar</button></span></li>`).join('')}</ul>`
    : '<div class="table-empty">Todavía no hay consultas guardadas en este navegador.</div>', { wide: false });
  document.querySelector('.cx-guardadas')?.addEventListener('click', e => {
    const cargar = e.target.closest('[data-cx-cargar]');
    if (cargar) { const item = lista.find(q => q.id === cargar.dataset.cxCargar); if (item) cxCargarGuardada(item); return; }
    const borrar = e.target.closest('[data-cx-borrar]');
    if (borrar) { cxEscribirGuardadas(lista.filter(q => q.id !== borrar.dataset.cxBorrar)); cxAbrirGuardadas(); }
  });
}

// ── Exportar: respeta el buscador y el orden de la tabla ──
function cxExportar(formato, boton) {
  const r = currentQueryResult;
  if (!r || !CX.columnas.length) { showAlert('Ejecuta una consulta antes de exportar.', 'info'); return; }
  const medida = cxNombreMedida(r.measure);
  const s = r.summary || {};
  return exportarDocumento(formato, {
    titulo: 'Reporte de consulta de producción HIS',
    archivo: 'consulta-produccion',
    datos: [
      ['Consulta', r.frase || null],
      ['Qué se calcula', medida], ['Organizado por', (r.groupBy || []).map(cxNombreGrupo).join(', ') || 'Total general'],
      ['Desde', r.period?.start ? formatIsoDate(r.period.start) : 'Todos los registros'], ['Hasta', r.period?.end ? formatIsoDate(r.period.end) : null],
      ['Buscar en la tabla', gv('cxBuscar') || null], ['Filas', formatNumber(currentFilteredRows.length)]
    ],
    metricas: [
      { etiqueta: medida, valor: s.total },
      r.measure === 'registros' ? null : { etiqueta: 'Ítems clínicos (dx/proc.)', valor: s.registros },
      r.measure === 'atenciones' ? null : { etiqueta: 'Citas atendidas', valor: s.atenciones },
      r.measure === 'pacientesUnicos' ? null : { etiqueta: 'Pacientes distintos', valor: s.pacientes }
    ].filter(m => m && m.valor !== null && m.valor !== undefined),
    secciones: [{
      titulo: 'Resultado',
      columnas: CX.columnas.map(c => ({ titulo: c === 'total' ? medida : COLUMN_LABELS[c] || c, tipo: currentNumericColumns.includes(c) ? 'numero' : c === 'dia' ? 'fecha' : c === 'codigoHIS' ? 'codigo' : 'texto' })),
      filas: currentFilteredRows.map(f => CX.columnas.map(c => f[c]))
    }]
  }, boton);
}

// ── Puntos de entrada desde app.js ──
async function abrirVistaConsultas() {
  cxActualizarFrase();
  try {
    const { resumen = {} } = await apiFetch('/consultas/dashboard');
    cxEl('dashboardPacientes').textContent = formatNumber(resumen.pacientesRegistrados);
    cxEl('dashboardAtenciones').textContent = formatNumber(resumen.atenciones);
    cxEl('dashboardEstablecimientos').textContent = formatNumber(resumen.establecimientos);
    cxEl('dashboardUltimaAtencion').textContent = resumen.ultimaAtencion ? formatIsoDate(resumen.ultimaAtencion) : '—';
  } catch (error) { console.warn('No se pudo cargar el resumen de Consultas:', error); }
  if (CX.opcionesCargadas) return;
  try {
    const datos = await apiFetch('/atenciones/filtros-produccion');
    CX.opcionesCargadas = true;
    const llenar = (id, valores) => { cxEl(id).innerHTML = valores.filter(Boolean).map(v => `<option value="${esc(v)}"></option>`).join(''); };
    llenar('cxListaEstablecimientos', (datos.establecimientos || []).map(e => e.nombre));
    llenar('cxListaUps', (datos.servicios || []).map(u => u.descripcion));
  } catch (error) { console.warn('No se pudieron cargar las opciones de Consultas:', error); }
}

// «Filtrar por este código» del detalle de un código: lo pone en el filtro de código HIS.
function cxFiltrarPorCodigo(codigo) {
  showView('consultas');
  const seccion = cxSeccionDeCampo('codigoHIS');
  if (CX.pestana !== seccion) cxMostrarPestana(seccion);
  const fila = cxEl('cxFormulario').querySelector('.cx-f-campo[value="codigoHIS"]').closest('.cx-fila');
  fila.querySelector('.cx-f-operador').value = 'equals';
  fila.querySelector('.cx-f-valor').value = codigo;
  cxActualizarFrase();
  fila.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cxAplicarRapida(r) {
  cxRestablecer();
  CX.medida = r.medida;
  CX.grupos = new Set(r.grupos);
  cxPintarMedida();
  cxPintarGrupos();
  if (r.bloques) cxPintarBloques(r.bloques);
  cxActualizarFrase();
  cxConsultar();
}

alCargarVistas(() => {
  if (!cxEl('cxPanel')) return;
  const opcion = (atributo, v, t) => `<button type="button" class="cx-opcion" ${atributo}="${esc(v)}">${esc(t)}</button>`;
  cxEl('cxRapidas').innerHTML = CX_RAPIDAS.map((r, i) => `<button type="button" class="cx-rapida" data-cx-rapida="${i}">${esc(r.nombre)}</button>`).join('');
  cxEl('cxMedida').innerHTML = `<optgroup label="Contar pacientes, citas o diagnósticos">${cxOpciones(CX_MEDIDAS.map(m => [m.valor, m.nombre]))}</optgroup><optgroup label="Calcular promedios, máximos o sumas">${cxOpciones(CX_MEDIDAS_EXTRA)}</optgroup>`;
  cxEl('cxGrupos').innerHTML = [...CX_GRUPOS, ...CX_GRUPOS_MAS].map(([v, t]) => opcion('data-cx-grupo', v, t)).join('');
  cxEl('cxPeriodo').innerHTML = cxOpciones(cxOpcionesPeriodo());
  cxPintarMedida();
  cxPintarGrupos();
  cxPintarFormulario();
  cxPintarBloques([]);
  cxActualizarFrase();

  // Las consultas rápidas van en una línea sin barra: la rueda del ratón las desplaza de lado.
  cxEl('cxRapidas').addEventListener('wheel', e => {
    const caja = e.currentTarget;
    if (caja.scrollWidth <= caja.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    caja.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false });

  // Los desplegables se cierran al pulsar fuera de ellos o con Escape.
  const cerrarDesplegables = fuera => document.querySelectorAll('#view-consultas details.cx-desplegable[open]').forEach(d => { if (!fuera || !d.contains(fuera)) d.open = false; });
  document.addEventListener('click', e => cerrarDesplegables(e.target));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarDesplegables(null); });

  const vista = cxEl('view-consultas');
  vista.addEventListener('input', e => {
    if (e.target.id === 'cxBuscar') {
      cxAplicarFiltrosTabla();
      return;
    }
    if (cxEl('cxPanel').contains(e.target)) cxActualizarFrase();
  });
  vista.addEventListener('change', e => {
    const t = e.target;
    const fila = t.closest('.cx-fila');
    if (fila) cxEventoFila(fila, t);
    if (t.id === 'cxMedida') CX.medida = t.value;
    if (t.id === 'cxPeriodo') cxEl('cxFechas').hidden = t.value !== 'rango';
    if (t.id === 'cxPorPagina') { CX.porPagina = t.value === 'all' ? -1 : Number(t.value); CX.pagina = 1; cxPintarTabla(); }
    if (cxEl('cxPanel').contains(t)) cxActualizarFrase();
  });
  vista.addEventListener('click', e => {
    const t = e.target;
    const rapida = t.closest('[data-cx-rapida]');
    if (rapida) { cxAplicarRapida(CX_RAPIDAS[Number(rapida.dataset.cxRapida)]); return; }
    const pestana = t.closest('[data-cx-pestana]');
    if (pestana) { cxMostrarPestana(pestana.dataset.cxPestana); return; }
    const ir = t.closest('[data-cx-pestana-ir]');
    if (ir) { if (CX.pestana !== ir.dataset.cxPestanaIr) cxMostrarPestana(ir.dataset.cxPestanaIr); return; }
    const quitarFiltro = t.closest('[data-cx-quitar-filtro]');
    if (quitarFiltro) {
      const campo = quitarFiltro.dataset.cxQuitarFiltro;
      cxEl('cxFormulario').querySelector(`.cx-f-campo[value="${campo}"]`).closest('.cx-fila').outerHTML = cxFiltroHtml(campo);
      cxActualizarFrase();
      return;
    }
    const grupo = t.closest('[data-cx-grupo]');
    if (grupo) {
      const g = grupo.dataset.cxGrupo;
      if (CX.grupos.has(g)) CX.grupos.delete(g); else CX.grupos.add(g);
      cxPintarGrupos(); cxActualizarFrase();
      return;
    }
    const dx = t.closest('[data-cx-dx]');
    if (dx) {
      const f = dx.closest('.cx-fila');
      f.querySelector('.cx-f-operador').value = 'starts_with';
      f.querySelector('.cx-f-valor').value = dx.dataset.cxDx;
      cxActualizarFrase();
      return;
    }
    const edad = t.closest('[data-cx-edad]');
    if (edad) {
      const f = edad.closest('.cx-fila');
      const hasta = edad.dataset.cxEdad2;
      f.querySelector('.cx-f-operador').value = hasta ? 'between' : 'gte';
      f.querySelector('.cx-f-valor').value = edad.dataset.cxEdad;
      f.querySelector('.cx-f-valor2').value = hasta;
      f.querySelector('.cx-f-valor2').hidden = !hasta;
      cxActualizarFrase();
      return;
    }
    if (t.closest('[data-cx-agregar-fila]')) {
      t.closest('.cx-bloque').querySelector('.cx-b-filas').insertAdjacentHTML('beforeend', cxFilaHtml());
      cxActualizarBloques();
      return;
    }
    if (t.closest('[data-cx-quitar-fila]')) {
      const bloque = t.closest('.cx-bloque');
      t.closest('.cx-fila').remove();
      if (!bloque.querySelector('.cx-fila')) bloque.remove();
      cxActualizarBloques(); cxActualizarFrase();
      return;
    }
    if (t.closest('[data-cx-quitar-bloque]')) {
      t.closest('.cx-bloque').remove();
      cxActualizarBloques(); cxActualizarFrase();
      return;
    }
    const orden = t.closest('[data-cx-orden]');
    if (orden) {
      const col = orden.dataset.cxOrden;
      CX.ordenAsc = CX.orden === col ? !CX.ordenAsc : !currentNumericColumns.includes(col);
      CX.orden = col;
      cxOrdenar();
      return;
    }
    const pagina = t.closest('[data-cx-pagina]');
    if (pagina && !pagina.disabled) { CX.pagina = Number(pagina.dataset.cxPagina); cxPintarTabla(); return; }
    const abrir = t.closest('[data-cx-abrir]');
    if (abrir) { cxAbrirDesdeTabla(abrir, e); return; }
    const faceta = t.closest('[data-cx-faceta]');
    if (faceta) { cxToggleFiltroTabla(faceta.dataset.cxFaceta, faceta.dataset.cxValor); return; }
    const quitarFaceta = t.closest('[data-cx-quitar-faceta]');
    if (quitarFaceta) { delete CX.filtrosTabla[quitarFaceta.dataset.cxQuitarFaceta]; cxAplicarFiltrosTabla(); }
  });

  cxEl('cxLimpiarTabla')?.addEventListener('click', () => { cxEl('cxBuscar').value = ''; CX.filtrosTabla = {}; cxAplicarFiltrosTabla(); });

  cxEl('cxAgregarBloque').addEventListener('click', () => { cxEl('cxBloques').insertAdjacentHTML('beforeend', cxBloqueHtml()); cxActualizarBloques(); });
  cxEl('cxLimpiarFiltros').addEventListener('click', () => { cxLimpiarFiltros(); cxActualizarFrase(); });
  cxEl('cxConsultar').addEventListener('click', cxConsultar);
  cxEl('cxRestablecer').addEventListener('click', cxRestablecer);
  cxEl('cxGuardar').addEventListener('click', cxGuardar);
  cxEl('cxGuardadas').addEventListener('click', cxAbrirGuardadas);
  cxEl('cxExcel').addEventListener('click', e => cxExportar('excel', e.currentTarget));
  cxEl('cxPdf').addEventListener('click', e => cxExportar('pdf', e.currentTarget));
  cxEl('cxToggleGrafico').addEventListener('click', e => {
    CX.graficoVisible = !CX.graficoVisible;
    cxEl('cxGrafico').hidden = !CX.graficoVisible;
    e.currentTarget.textContent = CX.graficoVisible ? 'Ocultar gráfico' : 'Mostrar gráfico';
    e.currentTarget.setAttribute('aria-expanded', String(CX.graficoVisible));
  });
});
