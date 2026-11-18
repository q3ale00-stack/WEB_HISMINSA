// ═══════════════════════════════════════
//  PACIENTES · BÚSQUEDA POR FILTROS (estilo tablero Power BI de la U.E. Red de Salud Huamanga)
// ═══════════════════════════════════════
// Usa las funciones globales de app.js: apiFetch, esc, formatNumber, toast, verAtencion, dxBadgeHtml,
// exportadores, exportarDocumento, botonesExportarHtml, buscarPacientes.

// Una búsqueda avanzada por vista (Pacientes, Personal y Atenciones), cada una con sus propios filtros.
const nuevoEstadoNominal = (tipo, appId) => ({
  tipo,
  appId,                // contenedor de la vista
  opciones: null,
  valores: {},          // filtros simples: clave → valor (texto)
  etiquetas: {},        // texto mostrado para los filtros elegidos de una sugerencia
  meses: new Set(),
  dias: new Set(),
  pagina: 1,
  tam: 100,
  datos: null,
  seq: 0,
  timer: null,
  iniciado: false,
  abiertas: new Set()   // fechas (AAAA-MM-DD) expandidas; las demás se muestran contraídas
});
const NOM_INSTANCIAS = {
  pacientes: nuevoEstadoNominal('pacientes', 'nominalApp'),
  personal: nuevoEstadoNominal('personal', 'nominalPersonalApp'),
  atenciones: nuevoEstadoNominal('atenciones', 'nominalAtencionesApp')
};
// Instancia en uso: la cambian las pestañas y cada evento de su panel.
let NOM = NOM_INSTANCIAS.pacientes;
const nomBox = () => document.getElementById(NOM.appId);
const nomParte = parte => nomBox()?.querySelector(`[data-nom-parte="${parte}"]`);

const NOM_MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'];
const NOM_DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

// Campos con sugerencias: clave del filtro → [campo de sugerencias, parámetro cuando se elige una sugerencia]
const NOM_SUGERIDOS = {
  paciente: ['paciente', 'paciente'],
  historia: ['historia', 'historia'],
  personal: ['personal', 'personalId'],
  registrador: ['registrador', 'registradorId'],
  codigo: ['codigo', 'codigo']
};

const NOM_ETIQUETAS = {
  disa: 'DISA', red: 'Red', microRed: 'MicroRed', establecimiento: 'Establecimiento', anio: 'Año',
  paciente: 'Paciente', idPaciente: 'ID de paciente', cita: 'ID de cita', historia: 'Historia clínica',
  personal: 'Personal', profesion: 'Profesión', registrador: 'Registrador', grupo: 'Grupo de riesgo', gestante: 'Condición gestante',
  sistema: 'Sistema', ups: 'Servicio (UPS)', turno: 'Turno', edad: 'Edad', tipoEdad: 'Tipo de edad', codigo: 'CIE / CPMS',
  td: 'Tipo Dx', lab: 'Lab', tipoDoc: 'Tipo de documento', lote: 'Lote', pag: 'N.º página', reg: 'N.º registro',
  difRegistro: 'Atención vs. registro', estado: 'Estado del registro'
};

// Nombres sencillos para el médico (sin siglas del HIS).
const NOM_ETIQUETAS_SIMPLES = { paciente: 'Paciente (nombre o DNI)', codigo: 'Diagnóstico (nombre o código)', ups: 'Servicio', td: 'Tipo de diagnóstico', lab: 'Resultado de laboratorio', grupo: 'Grupo de riesgo', gestante: 'Gestante' };
const nomEtiqueta = clave => (accesoRestringido() && NOM_ETIQUETAS_SIMPLES[clave]) || NOM_ETIQUETAS[clave];

const NOM_DIF = [['0', 'Mismo día'], ['1', '1 día después'], ['2-7', '2 a 7 días'], ['8-30', '8 a 30 días'], ['31+', 'Más de 30 días']];
const NOM_ESTADO = [['original', 'Sin modificar'], ['modificado', 'Registro modificado']];
const NOM_TIPO_EDAD = { A: 'Años', M: 'Meses', D: 'Días' };
const NOM_TD = { D: 'D · Definitivo', P: 'P · Presuntivo', R: 'R · Repetido' };
const NOM_TURNO = { M: 'M · Mañana', T: 'T · Tarde', N: 'N · Noche' };

// ── Pestañas de la vista Pacientes ──
// «simple»: buscador. «filtros»: búsqueda avanzada. Un médico «solo sus pacientes» también la usa:
// el servidor limita los resultados a sus pacientes (en Pacientes) o a sus atenciones (en Atenciones y Personal).
const accesoRestringido = () => currentUser?.access === 'restringido';

function cambiarTabPacientes(tab, { recordar = true } = {}) {
  if (tab !== 'filtros') tab = 'simple';
  const avanzada = document.getElementById('pacTabAvanzada');
  if (avanzada) avanzada.hidden = false;
  document.querySelectorAll('[data-pac-tab]').forEach(b => {
    const activa = b.dataset.pacTab === tab;
    b.classList.toggle('active', activa);
    b.setAttribute('aria-selected', String(activa));
  });
  document.getElementById('pacPanelFiltros').hidden = tab !== 'filtros';
  document.getElementById('pacPanelSimple').hidden = tab !== 'simple';
  if (recordar) { try { localStorage.setItem('his_pac_tab', tab); } catch (_) { /* sin almacenamiento */ } }
  if (tab === 'filtros') {
    const st = NOM_INSTANCIAS.pacientes;
    // Ya iniciada: si hay un paciente abierto distinto del filtro, se pone como filtro y se vuelve a buscar.
    if (st.iniciado && st.opciones && pasarPacienteAbierto(st)) {
      NOM = st;
      reflejarPacienteEnPanel(st);
      buscarNominal();
    } else {
      iniciarBusquedaNominal('pacientes');
    }
  } else iniciarPacienteSimple();
}

// ── Paciente abierto → búsqueda avanzada ──
// Si en «Buscar paciente» hay una ficha abierta, al pasar a la búsqueda avanzada ese paciente queda como filtro
// (como si se hubiera elegido de las sugerencias), sin año ni meses para ver toda su historia. Devuelve true si cambió algo.
function pasarPacienteAbierto(st) {
  const p = typeof PS !== 'undefined' ? PS.paciente : null;
  const id = String(p?.Id_Paciente ?? '').trim();
  // Se pasa una sola vez por paciente abierto: si luego se quita el filtro, no vuelve a ponerse solo.
  if (!id || st.pacientePasado === id) return false;
  st.pacientePasado = id;
  if (st.valores.paciente__id && String(st.valores.paciente) === id) return false;
  st.valores.paciente = id;
  st.valores.paciente__id = '1';
  st.etiquetas.paciente = [p.Paciente, p.Documento ? `DNI ${p.Documento}` : ''].filter(Boolean).join(' · ') || id;
  delete st.valores.anio;
  st.meses.clear();
  st.dias.clear();
  return true;
}

// Muestra en el panel ya dibujado el paciente puesto como filtro (texto, año y meses).
function reflejarPacienteEnPanel(st) {
  const box = document.getElementById(st.appId);
  if (!box) return;
  const input = box.querySelector('input[data-nom="paciente"]');
  if (input) input.value = st.etiquetas.paciente || '';
  const anio = box.querySelector('select[data-nom="anio"]');
  if (anio) anio.value = '';
  box.querySelectorAll('[data-mes].on, [data-dia].on').forEach(b => { b.classList.remove('on'); b.setAttribute('aria-pressed', 'false'); });
}

// id: paciente de la URL (#pacientes/123) al recargar o con Atrás/Adelante; '' si la URL no trae paciente.
function abrirVistaPacientes({ id } = {}) {
  if (id) {
    if (String(PS.paciente?.Id_Paciente) === id) cambiarTabPacientes('simple', { recordar: false });
    else abrirPacienteSimplePorId(id);
    return;
  }
  if (id === '' && PS.paciente) psCerrarPaciente();
  let tab = 'simple';
  try { tab = localStorage.getItem('his_pac_tab') || 'simple'; } catch (_) { /* sin almacenamiento */ }
  cambiarTabPacientes(tab);
}

// ── Pestañas de la vista Personal ──
// «simple»: ficha del profesional. «filtros»: atenciones con filtros por personal (mismo criterio de acceso que Pacientes).
function cambiarTabPersonal(tab, { recordar = true } = {}) {
  // «Mi producción» del médico: una sola pestaña (su ficha); los filtros están en «Mis atenciones».
  if (tab !== 'filtros' || accesoRestringido()) tab = 'simple';
  const avanzada = document.getElementById('perTabAvanzada');
  if (avanzada) avanzada.hidden = accesoRestringido();
  document.querySelectorAll('[data-per-tab]').forEach(b => {
    const activa = b.dataset.perTab === tab;
    b.classList.toggle('active', activa);
    b.setAttribute('aria-selected', String(activa));
  });
  document.getElementById('perPanelFiltros').hidden = tab !== 'filtros';
  document.getElementById('perPanelSimple').hidden = tab !== 'simple';
  if (recordar) { try { localStorage.setItem('his_per_tab', tab); } catch (_) { /* sin almacenamiento */ } }
  if (tab === 'filtros') iniciarBusquedaNominal('personal');
  else iniciarPersonalSimple();
}

// id: profesional de la URL (#personal/123) al recargar o con Atrás/Adelante; '' si la URL no trae profesional.
function abrirVistaPersonal({ id } = {}) {
  // «Mis datos»: el médico restringido abre siempre su propia ficha, sin buscador.
  if (accesoRestringido()) {
    const mio = String(currentUser?.personalId || '');
    cambiarTabPersonal('simple', { recordar: false });
    if (!mio) {
      document.getElementById('pfsResultado').innerHTML = '<div class="ps-vacio"><h3>Tu cuenta no está ligada a un profesional del HIS</h3><p>Pide a un administrador que la vincule a tu registro de personal para ver tus datos.</p></div>';
    } else if (String(PFS.personal?.Id_Personal) !== mio) {
      abrirPersonalSimplePorId(mio);
    }
    return;
  }
  if (id) {
    if (String(PFS.personal?.Id_Personal) === id) cambiarTabPersonal('simple', { recordar: false });
    else abrirPersonalSimplePorId(id);
    return;
  }
  if (id === '' && PFS.personal) pfsCerrarPersonal();
  let tab = 'simple';
  try { tab = localStorage.getItem('his_per_tab') || 'simple'; } catch (_) { /* sin almacenamiento */ }
  cambiarTabPersonal(tab);
}

// ── Pestañas de la vista Atenciones ──
// «simple»: buscador por cita, paciente, personal o código. «filtros»: atenciones con todos los filtros del HIS.
function cambiarTabAtenciones(tab, { recordar = true } = {}) {
  // Médico: «Mis atenciones» muestra la lista con un buscador de paciente y «Buscar con filtros» el panel de filtros
  // sobre la misma lista (no la búsqueda avanzada general).
  if (tab !== 'filtros') tab = 'simple';
  const avanzada = document.getElementById('ateTabAvanzada');
  if (avanzada) avanzada.hidden = false;
  document.querySelectorAll('[data-ate-tab]').forEach(b => {
    const activa = b.dataset.ateTab === tab;
    b.classList.toggle('active', activa);
    b.setAttribute('aria-selected', String(activa));
  });
  const medico = accesoRestringido();
  document.getElementById('atePanelFiltros').hidden = medico || tab !== 'filtros';
  document.getElementById('atePanelSimple').hidden = !medico && tab !== 'simple';
  if (recordar) { try { localStorage.setItem('his_ate_tab', tab); } catch (_) { /* sin almacenamiento */ } }
  if (medico) mateCambiarModo(tab);
  else if (tab === 'filtros') iniciarBusquedaNominal('atenciones');
}

function abrirVistaAtenciones() {
  let tab = 'simple';
  try { tab = localStorage.getItem('his_ate_tab') || 'simple'; } catch (_) { /* sin almacenamiento */ }
  cambiarTabAtenciones(tab);
  // «Mis atenciones»: la primera vez se cargan solas todas sus atenciones, de 20 en 20 (el servidor solo da las suyas).
  const resultado = document.getElementById('resAtenciones');
  if (accesoRestringido()) {
    iniciarMisAtenciones().then(() => {
      // El paciente abierto en «Mis pacientes» entra como filtro del panel, sin volver a escribirlo.
      if (pasarPacienteAMisAtenciones() || (resultado && !resultado.innerHTML.trim())) buscarAtenciones();
    });
  }
}

// Desde la tabla avanzada: abre al paciente en la búsqueda simple (por su documento).
function abrirFichaDesdeNominal(dato) {
  if (!dato) return;
  if (!document.getElementById('view-pacientes')?.classList.contains('active')) showView('pacientes');
  buscarPacienteSimple(dato);
}

// ── Inicio y listas ──
async function iniciarBusquedaNominal(tipo = 'pacientes') {
  const st = NOM_INSTANCIAS[tipo];
  NOM = st;
  if (st.iniciado) return;
  st.iniciado = true;
  const box = document.getElementById(st.appId);
  box.innerHTML = '<div class="table-empty">Cargando filtros…</div>';
  try {
    st.opciones = await apiFetch('/nominal/opciones');
  } catch (error) {
    st.iniciado = false;
    box.innerHTML = `<div class="table-empty">${esc(error.message || 'No se pudieron cargar los filtros.')} <button type="button" class="btn btn-secondary btn-sm" onclick="iniciarBusquedaNominal('${tipo}')">Reintentar</button></div>`;
    return;
  }
  NOM = st;
  if (st.opciones.anios?.length) st.valores.anio = String(st.opciones.anios[0]);
  // En Pacientes, el paciente abierto en la búsqueda simple entra como filtro (y quita el año por defecto).
  if (tipo === 'pacientes') pasarPacienteAbierto(st);
  box.innerHTML = htmlPanelNominal();
  activarPanelNominal(box, st);
  actualizarTerritorio();
  buscarNominal();
}

// Años del selector: desde el año actual hasta 2015, más cualquier año con registros fuera de ese rango.
const NOM_ANIO_INICIAL = 2015;
function aniosNominal() {
  const conDatos = new Set((NOM.opciones?.anios || []).map(Number));
  const actual = new Date().getFullYear();
  const todos = new Set([...conDatos]);
  for (let a = actual; a >= NOM_ANIO_INICIAL; a -= 1) todos.add(a);
  return [...todos].sort((a, b) => b - a).map(a => [a, conDatos.has(a)]);
}

const nomOpt = (valor, texto, actual) => `<option value="${esc(valor)}"${String(actual ?? '') === String(valor) ? ' selected' : ''}>${esc(texto)}</option>`;

function nomSelect(clave, opciones, { todas = 'Todas', ancho = '' } = {}) {
  const actual = NOM.valores[clave] || '';
  return `<label class="nom-field${ancho ? ` nom-${ancho}` : ''}"><span>${esc(nomEtiqueta(clave))}</span>
    <select class="input nom-input" data-nom="${clave}">
      <option value="">${esc(todas)}</option>
      ${opciones.map(([v, t]) => nomOpt(v, t, actual)).join('')}
    </select></label>`;
}

function nomTexto(clave, { placeholder = 'Todas', tipo = 'text', ancho = '' } = {}) {
  const sugerido = NOM_SUGERIDOS[clave];
  return `<label class="nom-field${ancho ? ` nom-${ancho}` : ''}${sugerido ? ' nom-sug' : ''}"><span>${esc(nomEtiqueta(clave))}</span>
    <input class="input nom-input" data-nom="${clave}" type="${tipo}" ${tipo === 'number' ? 'min="0" inputmode="numeric"' : ''} autocomplete="off" placeholder="${esc(placeholder)}" value="${esc(NOM.etiquetas[clave] || NOM.valores[clave] || '')}">
    ${sugerido ? `<ul class="nom-sug-list" role="listbox" hidden></ul>` : ''}</label>`;
}

function htmlPanelNominal() {
  const o = NOM.opciones;
  const meses = NOM_MESES.map((m, i) => `<button type="button" class="nom-chip-btn${NOM.meses.has(i + 1) ? ' on' : ''}" data-mes="${i + 1}" aria-pressed="${NOM.meses.has(i + 1)}" title="${m}">${i + 1}</button>`).join('');
  return `
  <div class="nom-board">
    <div class="nom-band">
      <div class="nom-band-fields">
        <label class="nom-field"><span>DISA</span><select class="input nom-input" data-nom="disa"></select></label>
        <label class="nom-field nom-wide"><span>Establecimiento</span><select class="input nom-input" data-nom="establecimiento"></select></label>
        ${nomSelect('anio', aniosNominal().map(([a, conDatos]) => [String(a), conDatos ? String(a) : `${a} · sin registros`]))}
      </div>
      <div class="nom-band-mes">
        <span class="nom-mini-title">Mes</span>
        <div class="nom-mes-grid" role="group" aria-label="Meses">${meses}</div>
      </div>
    </div>

    <div class="nom-body${NOM.tipo === 'atenciones' ? '' : ' nom-body-pac'}" id="${NOM.appId}-body" data-nom-parte="body">
      ${NOM.tipo === 'atenciones' ? htmlColumnasAtenciones(o) : NOM.tipo === 'personal' ? `
      <section class="nom-col" aria-label="Personal">
        <h4 class="nom-col-title"><span>1</span> Personal</h4>
        <div class="nom-pac-grid">
          ${nomTexto('personal', { placeholder: 'DNI, ID o nombre' })}
          ${nomSelect('profesion', (o.profesiones || []).map(pr => [pr.id, pr.nombre]))}
          ${nomSelect('ups', (o.ups || []).map(u => [u.id, u.nombre || u.id]), { todas: 'Todos' })}
          ${nomTexto('registrador', { placeholder: 'DNI o nombre' })}
        </div>
      </section>` : `
      <section class="nom-col" aria-label="Paciente">
        <h4 class="nom-col-title"><span>1</span> Paciente</h4>
        <div class="nom-pac-grid">
          ${nomTexto('paciente', { placeholder: 'DNI o nombre' })}
          ${nomTexto('idPaciente')}
          ${nomTexto('cita')}
          ${nomTexto('historia', { placeholder: 'N.º de historia' })}
        </div>
      </section>`}
    </div>

    <div class="nom-actions">
      <button type="button" class="btn btn-primary" data-nom-accion="buscar"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg> Buscar</button>
      <button type="button" class="btn nom-btn-reset" data-nom-accion="restablecer">Restablecer</button>
      <button type="button" class="btn btn-secondary" data-nom-accion="plegar" aria-expanded="true" aria-controls="${NOM.appId}-body">Ocultar filtros</button>
      <span class="nom-actions-spacer"></span>
      <span class="nom-export-label">Exportar resultado:</span>
      ${botonesExportarHtml('nominal')}
    </div>
  </div>
  <div class="nom-activos" data-nom-parte="activos" aria-live="polite"></div>
  <div data-nom-parte="resultado" aria-live="polite"></div>`;
}

// Filtros de la vista Atenciones: la atención, el servicio, el paciente y el registro.
function htmlColumnasAtenciones(o) {
  const conTexto = (lista, nombres) => (lista || []).map(v => [v, nombres[v] || v]);
  const mismos = lista => (lista || []).map(v => [v, v]);
  return `
      <section class="nom-col" aria-label="Atención">
        <h4 class="nom-col-title"><span>1</span> Atención</h4>
        ${nomTexto('codigo', { placeholder: 'Código o descripción' })}
        ${nomTexto('cita')}
        <div class="nom-row">
          ${nomSelect('td', conTexto(o.tiposDiagnostico, NOM_TD), { todas: 'Todos' })}
          ${nomSelect('lab', mismos(o.labs), { todas: 'Todos' })}
        </div>
      </section>
      <section class="nom-col" aria-label="Servicio y personal">
        <h4 class="nom-col-title"><span>2</span> ${accesoRestringido() ? 'Servicio' : 'Servicio y personal'}</h4>
        ${nomSelect('ups', (o.ups || []).map(u => [u.id, u.nombre || u.id]), { todas: 'Todos' })}
        <div class="nom-row">
          ${nomSelect('turno', conTexto(o.turnos, NOM_TURNO), { todas: 'Todos' })}
          ${nomSelect('sistema', (o.sistemas || []).map(s => [s.id, s.nombre || s.id]), { todas: 'Todos' })}
        </div>
        ${nomTexto('personal', { placeholder: 'DNI, ID o nombre' })}
        ${nomSelect('profesion', (o.profesiones || []).map(pr => [pr.id, pr.nombre]))}
      </section>
      <section class="nom-col" aria-label="Paciente">
        <h4 class="nom-col-title"><span>3</span> Paciente</h4>
        ${nomTexto('paciente', { placeholder: 'DNI o nombre' })}
        <div class="nom-row">
          ${nomTexto('edad', { tipo: 'number', placeholder: 'Todas' })}
          ${nomSelect('tipoEdad', conTexto(o.tiposEdad, NOM_TIPO_EDAD), { todas: 'Todos' })}
        </div>
        ${nomSelect('grupo', mismos(o.grupos), { todas: 'Todos' })}
        ${nomSelect('gestante', mismos(o.gestante))}
      </section>
      <section class="nom-col" aria-label="Registro">
        <h4 class="nom-col-title"><span>4</span> Registro</h4>
        ${nomTexto('registrador', { placeholder: 'DNI o nombre' })}
        ${nomSelect('difRegistro', NOM_DIF, { todas: 'Todos' })}
        ${nomSelect('estado', NOM_ESTADO, { todas: 'Todos' })}
        <div class="nom-row">
          ${nomTexto('lote', { placeholder: 'Todos' })}
          ${nomTexto('pag', { tipo: 'number', placeholder: 'Todas' })}
        </div>
        ${nomTexto('reg', { tipo: 'number', placeholder: 'Todos' })}
      </section>`;
}

// ── Territorio en cascada: DISA → Red → MicroRed → Establecimiento ──
function actualizarTerritorio() {
  const box = nomBox();
  const est = NOM.opciones.establecimientos || [];
  const disa = NOM.valores.disa || '';
  const unicos = lista => [...new Set(lista.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'es'));
  const llenar = (clave, valores, actual) => {
    const sel = box.querySelector(`[data-nom="${clave}"]`);
    if (sel) sel.innerHTML = `<option value="">Todas</option>${valores.map(([v, t]) => nomOpt(v, t, actual)).join('')}`;
  };
  llenar('disa', unicos(est.map(e => e.disa)).map(v => [v, v]), disa);
  const porDisa = est.filter(e => !disa || e.disa === disa);
  if (NOM.valores.establecimiento && !porDisa.some(e => String(e.id) === NOM.valores.establecimiento)) delete NOM.valores.establecimiento;
  llenar('establecimiento', porDisa.map(e => [String(e.id), e.nombre || `Establecimiento ${e.id}`]), NOM.valores.establecimiento);
}

// ── Eventos del panel ──
function activarPanelNominal(box, st) {
  // Cada evento del panel trabaja sobre su propia instancia.
  ['change', 'click', 'keydown', 'input', 'mousedown', 'focusout'].forEach(tipo => box.addEventListener(tipo, () => { NOM = st; }, true));

  box.addEventListener('change', event => {
    const tam = event.target.closest('select[data-nom-tam]');
    if (tam) { NOM.tam = Number(tam.value); buscarNominal(); return; }
    const el = event.target.closest('select[data-nom]');
    if (!el) return;
    const clave = el.dataset.nom;
    if (el.value) NOM.valores[clave] = el.value; else delete NOM.valores[clave];
    if (clave === 'disa') { delete NOM.valores.red; delete NOM.valores.microRed; }
    if (clave === 'red') delete NOM.valores.microRed;
    if (clave === 'disa') actualizarTerritorio();
    programarBusqueda();
  });

  box.addEventListener('click', event => {
    const mes = event.target.closest('[data-mes]');
    const dia = event.target.closest('[data-dia]');
    if (mes || dia) {
      const set = mes ? NOM.meses : NOM.dias;
      const n = Number((mes || dia).dataset[mes ? 'mes' : 'dia']);
      if (set.has(n)) set.delete(n); else set.add(n);
      (mes || dia).classList.toggle('on', set.has(n));
      (mes || dia).setAttribute('aria-pressed', String(set.has(n)));
      programarBusqueda();
      return;
    }
    const accion = event.target.closest('[data-nom-accion]')?.dataset.nomAccion;
    if (accion === 'buscar') { leerTextos(box); buscarNominal(); }
    if (accion === 'restablecer') restablecerNominal();
    if (accion === 'plegar') {
      const body = nomParte('body');
      const boton = event.target.closest('[data-nom-accion]');
      body.hidden = !body.hidden;
      boton.textContent = body.hidden ? 'Mostrar filtros' : 'Ocultar filtros';
      boton.setAttribute('aria-expanded', String(!body.hidden));
    }
    const quitar = event.target.closest('[data-quitar]');
    if (quitar) quitarFiltroNominal(quitar.dataset.quitar);
    const pagina = event.target.closest('[data-nom-pagina]');
    if (pagina && !pagina.disabled) { NOM.pagina = Number(pagina.dataset.nomPagina); buscarNominal({ mantenerPagina: true }); }
    // Toda la franja de la fecha expande o contrae, salvo si el clic terminó de seleccionar texto para copiarlo.
    const franja = event.target.closest('[data-sep]');
    if (franja) {
      if (!String(window.getSelection())) plegarFechaNominal(franja.dataset.sep, NOM.abiertas.has(franja.dataset.sep));
      return;
    }
    const arbol = event.target.closest('[data-nom-arbol]');
    if (arbol) {
      nomParte('resultado').querySelectorAll('[data-sep]').forEach(tr => plegarFechaNominal(tr.dataset.sep, arbol.dataset.nomArbol === 'contraer'));
      return;
    }
    const ver = event.target.closest('[data-nom-ver]');
    if (ver) verAtencion(NOM.datos.filas[Number(ver.dataset.nomVer)]);
    const ficha = event.target.closest('[data-nom-ficha]');
    if (ficha) abrirFichaDesdeNominal(ficha.dataset.nomFicha);
    const profesional = event.target.closest('[data-nom-personal]');
    if (profesional) abrirFichaPersonal(profesional.dataset.nomPersonal);
  });

  box.addEventListener('keydown', event => {
    const input = event.target.closest('input[data-nom]');
    if (!input) return;
    const lista = input.parentElement.querySelector('.nom-sug-list');
    if (lista && !lista.hidden && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      const items = [...lista.querySelectorAll('li')];
      const actual = items.findIndex(li => li.classList.contains('activo'));
      const siguiente = event.key === 'ArrowDown' ? Math.min(items.length - 1, actual + 1) : Math.max(0, actual - 1);
      items.forEach((li, i) => li.classList.toggle('activo', i === siguiente));
      return;
    }
    if (event.key === 'Escape' && lista) { lista.hidden = true; return; }
    if (event.key === 'Enter') {
      event.preventDefault();
      const activo = lista && !lista.hidden ? lista.querySelector('li.activo') : null;
      if (activo) { elegirSugerencia(input, activo); return; }
      if (lista) lista.hidden = true;
      leerTextos(box);
      buscarNominal();
    }
  });

  let sugTimer = null;
  box.addEventListener('input', event => {
    const input = event.target.closest('input[data-nom]');
    if (!input) return;
    const clave = input.dataset.nom;
    delete NOM.etiquetas[clave];
    if (NOM_SUGERIDOS[clave]) {
      delete NOM.valores[`${clave}__id`];
      clearTimeout(sugTimer);
      sugTimer = setTimeout(() => cargarSugerencias(input), 250);
    }
    input.closest('.nom-field').classList.toggle('pendiente', input.value.trim() !== (NOM.valores[clave] || ''));
  });

  box.addEventListener('mousedown', event => {
    const li = event.target.closest('.nom-sug-list li');
    if (!li) return;
    event.preventDefault();
    elegirSugerencia(li.closest('.nom-field').querySelector('input'), li);
  });

  box.addEventListener('focusout', event => {
    const lista = event.target.closest?.('.nom-field')?.querySelector('.nom-sug-list');
    if (lista) setTimeout(() => { lista.hidden = true; }, 120);
  });
}

async function cargarSugerencias(input) {
  const clave = input.dataset.nom;
  const lista = input.parentElement.querySelector('.nom-sug-list');
  const texto = input.value.trim();
  if (texto.length < 2) { lista.hidden = true; return; }
  try {
    let filas = await apiFetch(`/nominal/sugerencias?campo=${encodeURIComponent(NOM_SUGERIDOS[clave][0])}&q=${encodeURIComponent(texto)}&vista=${encodeURIComponent(NOM.tipo)}`);
    if (input.value.trim() !== texto) return;
    if (!filas.length) { lista.innerHTML = '<li class="vacio" aria-disabled="true">Sin coincidencias · pulsa Enter para buscar el texto</li>'; lista.hidden = false; return; }
    // Si el maestro repite un paciente, se muestra una sola vez por Id.
    const vistos = new Set();
    filas = filas.filter(f => { const k = String(f.id); if (vistos.has(k)) return false; vistos.add(k); return true; });
    lista.innerHTML = filas.map(f => {
      const etiqueta = [f.documento && f.documento !== f.nombre ? f.documento : null, f.nombre].filter(Boolean).join(' · ');
      return `<li role="option" data-id="${esc(f.id)}" data-etiqueta="${esc(etiqueta)}"><strong>${esc(f.documento || f.id)}</strong><span>${esc(f.nombre || '')}${f.detalle ? ` <em>${esc(f.detalle)}</em>` : ''}</span></li>`;
    }).join('');
    lista.hidden = false;
  } catch (_) {
    lista.hidden = true;
  }
}

function elegirSugerencia(input, li) {
  if (!li || li.classList.contains('vacio')) return;
  const clave = input.dataset.nom;
  NOM.valores[clave] = li.dataset.id;
  NOM.valores[`${clave}__id`] = '1';
  NOM.etiquetas[clave] = li.dataset.etiqueta;
  input.value = li.dataset.etiqueta;
  input.closest('.nom-field').classList.remove('pendiente');
  li.parentElement.hidden = true;
  buscarNominal();
}

// Copia a los filtros lo escrito en los cuadros de texto (los elegidos de una sugerencia se conservan).
function leerTextos(box) {
  box.querySelectorAll('input[data-nom]').forEach(input => {
    const clave = input.dataset.nom;
    const valor = input.value.trim();
    input.closest('.nom-field').classList.remove('pendiente');
    if (NOM.etiquetas[clave] && valor === NOM.etiquetas[clave]) return;
    delete NOM.etiquetas[clave];
    delete NOM.valores[`${clave}__id`];
    if (valor) NOM.valores[clave] = valor; else delete NOM.valores[clave];
  });
}

function programarBusqueda() {
  const st = NOM;
  clearTimeout(st.timer);
  st.timer = setTimeout(() => { NOM = st; leerTextos(nomBox()); buscarNominal(); }, 450);
}

function restablecerNominal() {
  NOM.valores = {};
  NOM.etiquetas = {};
  NOM.meses.clear();
  NOM.dias.clear();
  if (NOM.opciones.anios?.length) NOM.valores.anio = String(NOM.opciones.anios[0]);
  const box = nomBox();
  const plegado = nomParte('body')?.hidden;
  box.innerHTML = htmlPanelNominal();
  actualizarTerritorio();
  if (plegado) box.querySelector('[data-nom-accion="plegar"]').click();
  buscarNominal();
}

function quitarFiltroNominal(clave) {
  if (clave === 'meses') NOM.meses.clear();
  else if (clave === 'dias') NOM.dias.clear();
  else {
    delete NOM.valores[clave];
    delete NOM.valores[`${clave}__id`];
    delete NOM.etiquetas[clave];
    if (clave === 'disa') { delete NOM.valores.red; delete NOM.valores.microRed; }
    if (clave === 'red') delete NOM.valores.microRed;
  }
  const box = nomBox();
  const plegado = nomParte('body')?.hidden;
  box.innerHTML = htmlPanelNominal();
  actualizarTerritorio();
  if (plegado) box.querySelector('[data-nom-accion="plegar"]').click();
  buscarNominal();
}

// Parámetros de la consulta a partir de los filtros elegidos.
function parametrosNominal() {
  const params = new URLSearchParams();
  Object.entries(NOM.valores).forEach(([clave, valor]) => {
    if (clave.endsWith('__id') || valor === '') return;
    const sugerido = NOM_SUGERIDOS[clave];
    if (sugerido && NOM.valores[`${clave}__id`] && sugerido[1] !== clave) {
      params.set(sugerido[1], valor);
      params.set(clave, NOM.etiquetas[clave] || valor);
    } else {
      params.set(clave, valor);
    }
  });
  if (NOM.meses.size) params.set('meses', [...NOM.meses].sort((a, b) => a - b).join(','));
  if (NOM.dias.size) params.set('dias', [...NOM.dias].sort((a, b) => a - b).join(','));
  return params;
}

// Filtros aplicados como etiquetas con «×» para quitarlos uno a uno.
function textoFiltroNominal(clave, valor) {
  const o = NOM.opciones || {};
  if (clave === 'establecimiento') return (o.establecimientos || []).find(e => String(e.id) === valor)?.nombre || valor;
  if (clave === 'ups') return (o.ups || []).find(u => u.id === valor)?.nombre || valor;
  if (clave === 'sistema') return (o.sistemas || []).find(s => s.id === valor)?.nombre || valor;
  if (clave === 'profesion') return (o.profesiones || []).find(pr => pr.id === valor)?.nombre || valor;
  if (clave === 'difRegistro') return NOM_DIF.find(d => d[0] === valor)?.[1] || valor;
  if (clave === 'estado') return NOM_ESTADO.find(d => d[0] === valor)?.[1] || valor;
  if (clave === 'td') return NOM_TD[valor] || valor;
  if (clave === 'turno') return NOM_TURNO[valor] || valor;
  if (clave === 'tipoEdad') return NOM_TIPO_EDAD[valor] || valor;
  return NOM.etiquetas[clave] || valor;
}

function filtrosActivosNominal() {
  const lista = Object.entries(NOM.valores)
    .filter(([clave, valor]) => !clave.endsWith('__id') && valor !== '')
    .map(([clave, valor]) => [clave, NOM_ETIQUETAS[clave] || clave, textoFiltroNominal(clave, valor)]);
  if (NOM.meses.size) lista.push(['meses', 'Mes', [...NOM.meses].sort((a, b) => a - b).map(m => NOM_MESES[m - 1]).join(', ')]);
  if (NOM.dias.size) lista.push(['dias', 'Día', [...NOM.dias].sort((a, b) => a - b).join(', ')]);
  return lista;
}

function renderActivosNominal() {
  const box = nomParte('activos');
  const lista = filtrosActivosNominal();
  box.innerHTML = lista.length
    ? `<span class="nom-activos-title">Filtros aplicados</span>${lista.map(([clave, etiqueta, valor]) => `<span class="nom-pill"><span>${esc(etiqueta)}:</span> <strong>${esc(valor)}</strong><button type="button" data-quitar="${esc(clave)}" aria-label="Quitar filtro ${esc(etiqueta)}" title="Quitar">×</button></span>`).join('')}`
    : '<span class="nom-activos-title">Sin filtros: elige al menos uno para buscar</span>';
}

// ── Búsqueda ──
async function buscarNominal({ mantenerPagina = false } = {}) {
  const st = NOM;
  clearTimeout(st.timer);
  if (!mantenerPagina) { st.pagina = 1; st.abiertas.clear(); }
  renderActivosNominal();
  const params = parametrosNominal();
  const res = nomParte('resultado');
  if (![...params.keys()].length) {
    st.datos = null;
    res.innerHTML = '<div class="table-empty">Elige al menos un filtro (por ejemplo el año o un mes) para ver los registros.</div>';
    return;
  }
  params.set('pagina', String(st.pagina));
  params.set('tam', String(st.tam));
  // Para un médico «solo sus pacientes», el servidor limita según la vista: Pacientes → sus pacientes; otras → sus atenciones.
  params.set('vista', st.tipo);
  const seq = ++st.seq;
  res.classList.add('nom-cargando');
  if (!st.datos) res.innerHTML = '<div class="table-empty">Buscando registros…</div>';
  try {
    const datos = await apiFetch(`/nominal?${params}`);
    if (seq !== st.seq) return;
    st.datos = datos;
    NOM = st;
    res.innerHTML = htmlResultadoNominal(datos);
    // Si se buscó a una persona y los resultados son de un solo paciente, sus datos aparecen solos arriba.
    const buscaPersona = ['paciente', 'idPaciente', 'historia', 'cita'].some(c => st.valores[c]);
    const todasEnPagina = Number(datos.total || 0) <= (datos.filas || []).length;
    const unico = psPacienteUnico(datos.filas);
    // Elegido de las sugerencias: «paciente» guarda el Id_Paciente y «paciente__id» lo marca.
    const idElegido = st.valores.paciente__id ? st.valores.paciente : '';
    const id = buscaPersona ? (idElegido || (unico && (todasEnPagina || st.valores.idPaciente || st.valores.historia || st.valores.cita) ? unico : '')) : '';
    if (id) {
      res.insertAdjacentHTML('afterbegin', '<div class="pac-mini-slot"></div>');
      psMostrarMiniFicha(res.querySelector('.pac-mini-slot'), id);
    }
  } catch (error) {
    if (seq !== st.seq) return;
    st.datos = null;
    res.innerHTML = `<div class="table-empty">${esc(error.message || 'No se pudo buscar.')}</div>`;
  } finally {
    if (seq === st.seq) res.classList.remove('nom-cargando');
  }
}

const nomFecha = v => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10).split('-').reverse().join('/') : '');
const nomVacio = '<span class="nom-nd">—</span>';
const nomTxt = v => (v === null || v === undefined || String(v).trim() === '' ? nomVacio : esc(String(v).trim()));
const nomUnir = (partes, sep = ' | ') => {
  const limpias = partes.map(p => (p === null || p === undefined ? '' : String(p).trim()));
  return limpias.some(Boolean) ? limpias.join(sep) : '';
};

function nomEdadActual(r) {
  const partes = [[r.Anio_Actual_Paciente, 'a'], [r.Mes_Actual_Paciente, 'm'], [r.Dia_Actual_Paciente, 'd']].filter(([v]) => v !== null && v !== undefined && v !== '');
  return partes.length ? partes.map(([v, u]) => `${v}${u}`).join(' ') : '';
}

function nomDifHtml(dias) {
  if (dias === null || dias === undefined) return nomVacio;
  const n = Number(dias);
  const clase = n <= 1 ? 'ok' : n <= 7 ? 'medio' : 'tarde';
  return `<span class="nom-dif nom-dif-${clase}" title="${n} día(s) entre la atención y su registro">${n}</span>`;
}

const NOM_COLUMNAS = [
  ['Fecha', 'nom-sticky nom-c-fecha', r => esc(nomFecha(r.Fecha_Atencion))],
  ['Cita', 'nom-sticky nom-c-cita mono', (r, i) => (r.Id_Cita ? `<button type="button" class="nom-link" data-nom-ver="${i}" title="Ver el detalle de esta atención">${esc(r.Id_Cita)}</button>` : nomVacio)],
  ['IPRESS', 'nom-c-ipress', r => nomTxt(r.Ipress || r.Renipress)],
  ['Sistema', '', r => nomTxt(r.Sistema || r.Id_AplicacionOrigen)],
  ['Lote | Pág | Reg', 'mono nowrap', r => nomTxt(nomUnir([r.Lote, r.Num_Pag, r.Num_Reg]))],
  ['Servicio UPS', 'nom-c-ups', r => nomTxt(r.ServicioUps || r.Id_Ups)],
  ['Documento', 'mono', r => (r.Documento ? `<button type="button" class="nom-link" data-nom-ficha="${esc(r.Documento)}" title="Abrir la ficha de este paciente">${esc(r.Documento)}</button>` : nomVacio)],
  ['Tipo doc.', 'nowrap', r => nomTxt(nomUnir([r.IdTipoDocumento, r.TipoDocumento]))],
  ['Paciente', 'nom-c-nombre', r => nomTxt(r.Paciente)],
  ['Edad', 'nowrap', r => nomTxt(r.Edad_Reg !== null && r.Edad_Reg !== undefined ? `${r.Edad_Reg}-${r.Tipo_Edad || ''}` : '')],
  ['Edad actual', 'nowrap', r => nomTxt(nomEdadActual(r))],
  ['Descripción del ítem', 'nom-c-item', r => `<div class="nom-item">${dxBadgeHtml(String(r.Tipo_Diagnostico || '').trim())}<span class="code-badge">${esc(r.Codigo_Item || '—')}</span>${r.Valor_Lab ? `<span class="ate-lab">LAB ${esc(r.Valor_Lab)}</span>` : ''}<span class="nom-item-desc" title="${esc(r.DescItem || '')}">${esc(r.DescItem || 'Sin descripción')}</span></div>`],
  ['Peso | Talla | PAb | Hb', 'mono nowrap', r => nomTxt(nomUnir([r.Peso, r.Talla, r.Perimetro_Abdominal, r.Hemoglobina]))],
  ['Turno', 'center', r => nomTxt(r.Id_Turno)],
  ['Personal', 'nom-c-persona', r => (r.Personal || r.DocumentoPersonal ? `<span title="${esc([r.DocumentoPersonal, r.Personal, r.Profesion].filter(Boolean).join(' - '))}">${r.Id_Personal ? `<button type="button" class="nom-link" data-nom-personal="${esc(r.Id_Personal)}" title="Abrir la ficha de este profesional"><strong>${esc(r.Personal || r.DocumentoPersonal)}</strong></button>` : `<strong>${esc(r.Personal || r.DocumentoPersonal)}</strong>`}${r.Profesion ? ` <small>${esc(r.Profesion)}</small>` : ''}</span>` : nomTxt(r.Id_Personal))],
  ['Registrador', 'nom-c-persona', r => (r.Registrador ? `<span title="${esc([r.DocumentoRegistrador || r.Id_Registrador, r.Registrador].filter(Boolean).join(' - '))}"><strong>${esc(r.Registrador)}</strong></span>` : nomTxt(r.Id_Registrador))],
  ['Id_Paciente', 'mono', r => nomTxt(r.Id_Paciente)],
  ['Fecha registro', 'nowrap', r => nomTxt(nomFecha(r.Fecha_Registro))],
  ['Atenc. → registro', 'center', r => nomDifHtml(r.DiasRegistro)],
  ['Fecha modificación', 'nowrap', r => nomTxt(nomFecha(r.Fecha_Modificacion))],
  ['Estado', 'nowrap', r => (r.Fecha_Modificacion ? '<span class="nom-estado mod">Modificado</span>' : '<span class="nom-estado">Original</span>')]
];

// Médico «solo sus pacientes»: tabla sin columnas técnicas y con nombres sencillos.
const NOM_COLUMNAS_TECNICAS = new Set(['IPRESS', 'Sistema', 'Lote | Pág | Reg', 'Tipo doc.', 'Registrador', 'Id_Paciente', 'Edad actual',
  'Fecha registro', 'Atenc. → registro', 'Fecha modificación', 'Estado']);
const NOM_TITULOS_SIMPLES = { 'Servicio UPS': 'Servicio', Documento: 'DNI', 'Descripción del ítem': 'Diagnóstico o procedimiento', 'Peso | Talla | PAb | Hb': 'Peso | Talla | Abdomen | Hb', Personal: 'Atendido por' };
const nomColumnas = () => (accesoRestringido()
  ? NOM_COLUMNAS.filter(([titulo]) => !NOM_COLUMNAS_TECNICAS.has(titulo)).map(([titulo, ...resto]) => [NOM_TITULOS_SIMPLES[titulo] || titulo, ...resto])
  : NOM_COLUMNAS);

const nomPlural = (n, uno, varios) => `${formatNumber(n)} ${n === 1 ? uno : varios}`;

function htmlResultadoNominal(datos) {
  const { filas, total, resumen, pagina, tam } = datos;
  if (!filas.length) return '<div class="table-empty">No hay registros con esos filtros. Prueba quitando alguno.</div>';
  const paginas = Math.max(1, Math.ceil(total / tam));
  const desde = (pagina - 1) * tam + 1;
  const hasta = desde + filas.length - 1;
  let fechaPrevia = null;
  const cuerpo = filas.map((r, i) => {
    const fecha = String(r.Fecha_Atencion || '').slice(0, 10);
    let separador = '';
    if (fecha !== fechaPrevia) {
      fechaPrevia = fecha;
      const delDia = filas.filter(x => String(x.Fecha_Atencion || '').slice(0, 10) === fecha);
      const enDia = delDia.length;
      const citasDia = new Set(delDia.map(x => String(x.Id_Cita ?? ''))).size;
      const [y, m, d] = fecha.split('-').map(Number);
      const nombreDia = y ? NOM_DIAS_SEMANA[new Date(y, m - 1, d).getDay()] : 'Sin fecha';
      const abierta = NOM.abiertas.has(fecha);
      separador = `<tr class="nom-sep${abierta ? '' : ' plegada'}" data-sep="${esc(fecha)}"><td colspan="${nomColumnas().length + 1}"><span class="nom-sep-in"><button type="button" class="nom-toggle" data-nom-toggle="${esc(fecha)}" aria-expanded="${abierta}" title="${abierta ? 'Contraer' : 'Expandir'} los registros de este día">${abierta ? '−' : '+'}</button><span class="nom-sep-fecha">${esc(nombreDia)} ${esc(nomFecha(fecha))}</span><small title="Cada diagnóstico o procedimiento de una atención es un registro HIS">${nomPlural(citasDia, 'atención', 'atenciones')} · ${nomPlural(enDia, 'registro', 'registros')}</small></span></td></tr>`;
    }
    return `${separador}<tr data-f="${esc(fecha)}"${NOM.abiertas.has(fecha) ? '' : ' hidden'}>${nomColumnas().map(([, clase, celda]) => `<td class="${clase}">${celda(r, i)}</td>`).join('')}<td class="nom-c-acc"><button type="button" class="btn btn-secondary btn-xs" data-nom-ver="${i}">Ver</button></td></tr>`;
  }).join('');
  const boton = (p, texto, deshabilitado) => `<button type="button" class="btn btn-secondary btn-sm" data-nom-pagina="${p}"${deshabilitado ? ' disabled' : ''}>${texto}</button>`;
  return `
    <div class="nom-tree-bar">
      <span class="nom-tree-icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg></span>
      <span class="nom-tree-text"><strong>Registros agrupados por fecha de atención</strong>${resumen?.atenciones !== undefined ? `<small class="nom-tree-total" title="Cada diagnóstico o procedimiento de una atención es un registro HIS"><b>${nomPlural(resumen.atenciones, 'atención', 'atenciones')}</b> (citas) · ${nomPlural(total, 'registro HIS', 'registros HIS')}</small>` : ''}</span>
      <button type="button" class="nom-tree-btn" data-nom-arbol="expandir"><b>+</b> Expandir todo</button>
      <button type="button" class="nom-tree-btn" data-nom-arbol="contraer"><b>−</b> Contraer todo</button>
    </div>
    <div class="nom-table-wrap">
      <table class="nom-table">
        <thead><tr>${nomColumnas().map(([titulo, clase]) => `<th class="${clase.includes('sticky') ? clase : ''}">${esc(titulo)}</th>`).join('')}<th><span class="sr-only">Detalle</span></th></tr></thead>
        <tbody>${cuerpo}</tbody>
      </table>
    </div>
    <div class="nom-pager">
      <label class="nom-tam">Filas por página
        <select class="input" data-nom-tam>${[50, 100, 200].map(n => `<option value="${n}"${n === tam ? ' selected' : ''}>${n}</option>`).join('')}</select>
      </label>
      <span class="nom-actions-spacer"></span>
      ${boton(1, '« Primera', pagina <= 1)}
      ${boton(pagina - 1, '‹ Anterior', pagina <= 1)}
      <span class="nom-pag-info">Registros ${formatNumber(desde)}–${formatNumber(hasta)} de ${formatNumber(total)} · Página ${formatNumber(pagina)} de ${formatNumber(paginas)}</span>
      ${boton(pagina + 1, 'Siguiente ›', pagina >= paginas)}
      ${boton(paginas, 'Última »', pagina >= paginas)}
    </div>`;
}

// Contrae o expande los registros de una fecha sin volver a consultar (al buscar, todas empiezan contraídas).
function plegarFechaNominal(fecha, plegar) {
  if (plegar) NOM.abiertas.delete(fecha); else NOM.abiertas.add(fecha);
  const res = nomParte('resultado');
  const sep =[...res.querySelectorAll('[data-sep]')].find(tr => tr.dataset.sep === fecha);
  if (!sep) return;
  sep.classList.toggle('plegada', plegar);
  const boton = sep.querySelector('.nom-toggle');
  boton.textContent = plegar ? '+' : '−';
  boton.setAttribute('aria-expanded', String(!plegar));
  boton.title = `${plegar ? 'Expandir' : 'Contraer'} los registros de este día`;
  res.querySelectorAll('tr[data-f]').forEach(tr => { if (tr.dataset.f === fecha) tr.hidden = plegar; });
}

// ── Exportación (hasta 5000 filas con los filtros actuales) ──
exportadores.nominal = async (formato, boton) => {
  const st = Object.values(NOM_INSTANCIAS).find(i => i.appId === boton.closest('.nominal-app')?.id) || NOM;
  NOM = st;
  const params = parametrosNominal();
  const filtros = filtrosActivosNominal().map(([, etiqueta, valor]) => [etiqueta, valor]);
  const total = st.datos?.total;
  const dePersonal = st.tipo === 'personal';
  const deAtenciones = st.tipo === 'atenciones';
  if (![...params.keys()].length) { toast('Elige al menos un filtro antes de exportar.', 'info'); return; }
  params.set('exportar', '1');
  params.set('vista', st.tipo);
  const texto = boton.innerHTML;
  boton.disabled = true;
  boton.textContent = 'Preparando…';
  let datos;
  try {
    datos = await apiFetch(`/nominal?${params}`);
  } catch (error) {
    toast(error.message || 'No se pudo preparar la exportación.', 'error');
    return;
  } finally {
    boton.disabled = false;
    boton.innerHTML = texto;
  }
  if (!datos.filas.length) { toast('No hay registros para exportar con esos filtros.', 'info'); return; }
  const recortado = datos.filas.length >= (datos.limiteExportar || 5000);
  exportarDocumento(formato, {
    titulo: dePersonal ? 'Atenciones HIS por personal' : deAtenciones ? 'Búsqueda con filtros de atenciones HIS' : 'Búsqueda nominal de atenciones HIS',
    datos: [...filtros, ['Registros exportados', formatNumber(datos.filas.length) + (total ? ` de ${formatNumber(total)}` : '')]],
    archivo: dePersonal ? 'busqueda-personal-his' : deAtenciones ? 'busqueda-atenciones-his' : 'busqueda-nominal-his',
    orientacion: 'landscape',
    notas: recortado ? ['Se exportan los primeros 5 000 registros; acota los filtros para obtener el resto.'] : undefined,
    secciones: [formato === 'pdf' ? {
      // En PDF se agrupan columnas para que la tabla quepa en una hoja horizontal.
      titulo: 'Registros HIS',
      columnas: [
        { titulo: 'Fecha', tipo: 'fecha' }, { titulo: 'Cita', tipo: 'codigo' }, { titulo: 'IPRESS' }, { titulo: 'Servicio UPS' },
        { titulo: 'Documento', tipo: 'codigo' }, { titulo: 'Paciente' }, { titulo: 'Edad' }, { titulo: 'Ítem (Dx · código · Lab)', tipo: 'codigo' },
        { titulo: 'Descripción' }, { titulo: 'Turno', alinear: 'center' }, { titulo: 'Personal' }, { titulo: 'Registrador' },
        { titulo: 'Días aten.→reg.', tipo: 'numero' }, { titulo: 'Estado' }
      ],
      filas: datos.filas.map(r => [
        r.Fecha_Atencion, r.Id_Cita, r.Ipress || r.Renipress, r.ServicioUps || r.Id_Ups, r.Documento, r.Paciente,
        r.Edad_Reg !== null && r.Edad_Reg !== undefined ? `${r.Edad_Reg}-${r.Tipo_Edad || ''}` : '',
        [r.Tipo_Diagnostico, r.Codigo_Item, r.Valor_Lab ? `LAB ${r.Valor_Lab}` : ''].filter(Boolean).join(' · '),
        r.DescItem, r.Id_Turno, r.Personal || r.DocumentoPersonal, r.Registrador || r.Id_Registrador, r.DiasRegistro,
        r.Fecha_Modificacion ? 'Modificado' : 'Original'
      ])
    } : {
      titulo: 'Registros HIS',
      hoja: 'Registros',
      columnas: [
        { titulo: 'Fecha', tipo: 'fecha' }, { titulo: 'Cita', tipo: 'codigo' }, { titulo: 'IPRESS', ancho: 30 }, { titulo: 'Sistema' },
        { titulo: 'Lote|Pág|Reg' }, { titulo: 'Servicio UPS', ancho: 24 }, { titulo: 'Documento', tipo: 'codigo' }, { titulo: 'Tipo doc.' }, { titulo: 'Paciente', ancho: 30 },
        { titulo: 'Edad' }, { titulo: 'Dx' }, { titulo: 'Código', tipo: 'codigo' }, { titulo: 'Lab' }, { titulo: 'Descripción', ancho: 40 },
        { titulo: 'Peso|Talla|PAb|Hb' }, { titulo: 'Turno' }, { titulo: 'Personal', ancho: 34 }, { titulo: 'Profesión', ancho: 22 }, { titulo: 'Registrador', ancho: 30 },
        { titulo: 'Id_Paciente', tipo: 'codigo' }, { titulo: 'Fecha registro', tipo: 'fecha' }, { titulo: 'Días aten.→reg.', tipo: 'numero' },
        { titulo: 'Fecha modificación', tipo: 'fecha' }, { titulo: 'Estado' }
      ],
      filas: datos.filas.map(r => [
        r.Fecha_Atencion, r.Id_Cita, r.Ipress || r.Renipress, r.Sistema || r.Id_AplicacionOrigen, nomUnir([r.Lote, r.Num_Pag, r.Num_Reg]),
        r.ServicioUps || r.Id_Ups, r.Documento, nomUnir([r.IdTipoDocumento, r.TipoDocumento]), r.Paciente,
        r.Edad_Reg !== null && r.Edad_Reg !== undefined ? `${r.Edad_Reg}-${r.Tipo_Edad || ''}` : '',
        r.Tipo_Diagnostico, r.Codigo_Item, r.Valor_Lab, r.DescItem, nomUnir([r.Peso, r.Talla, r.Perimetro_Abdominal, r.Hemoglobina]),
        r.Id_Turno, [r.DocumentoPersonal, r.Personal].filter(Boolean).join(' - '), r.Profesion, [r.DocumentoRegistrador, r.Registrador].filter(Boolean).join(' - '),
        r.Id_Paciente, r.Fecha_Registro, r.DiasRegistro, r.Fecha_Modificacion, r.Fecha_Modificacion ? 'Modificado' : 'Original'
      ])
    }]
  }, boton);
};
