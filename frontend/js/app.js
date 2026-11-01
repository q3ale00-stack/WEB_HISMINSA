// Usa la URL previamente configurada; si no existe, apunta a la API local.
const API_BASE = localStorage.getItem("his_api_url") || "/api";
let apiUrl = API_BASE;
let currentUser = null;

// ═══════════════════════════════════════
//  UTILIDADES
// ═══════════════════════════════════════
// Escapa valores antes de incorporarlos a fragmentos HTML generados dinámicamente.
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m])); }
// Lee y recorta el valor de un campo; devuelve texto vacío cuando no existe o no tiene contenido.
function gv(id) { return document.getElementById(id)?.value?.trim() || ''; }
// Asigna un valor a un campo si está presente y normaliza los valores nulos a texto vacío.
function sv(id, v) { const el = document.getElementById(id); if (el) el.value = v ?? ''; }
// Añade una notificación efímera y la retira después de su animación.
function toast(msg, type = 'info') {
  const c = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast-item ${type}`;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(40px)'; setTimeout(() => el.remove(), 300); }, 3500);
}

// Muestra un aviso persistente en el área global y lo oculta al cabo de unos segundos.
function showAlert(msg, type = 'info') {
  const el = document.getElementById('globalAlert');
  el.textContent = msg; el.className = `alert show alert-${type}`;
  setTimeout(() => el.className = 'alert', 5000);
}

// Centraliza las llamadas JSON, convierte respuestas HTTP fallidas en errores legibles y reintenta ante 503 transitorios
async function apiFetch(path, opts = {}, retries = 2) {
  const url = apiUrl.replace(/\/$/, '') + path;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
        ...opts
      });
      if (!res.ok) {
        // Reintento automático para errores 503 / 502 transitorios antes de fallar
        if ((res.status === 503 || res.status === 502 || res.status === 504) && attempt < retries) {
          await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
          continue;
        }
        const data = await res.json().catch(() => ({}));
        const error = new Error(data.message || data.error || `HTTP ${res.status}`);
        error.status = res.status;
        if (res.status === 401 && currentUser && path !== '/auth/logout') {
          returnToLogin();
          const loginStatus = document.getElementById('loginStatus');
          loginStatus.textContent = 'Tu sesión venció. Inicia sesión nuevamente.';
          loginStatus.hidden = false;
        }
        throw error;
      }
      return await res.json();
    } catch (err) {
      if (attempt < retries && (err.status === 503 || err.status === 502 || err.name === 'TypeError')) {
        await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
}

// ═══════════════════════════════════════
//  NAVEGACIÓN
// ═══════════════════════════════════════
// Metadatos usados por la barra superior al cambiar entre las vistas del sistema.
const viewMeta = {
  inicio: { title: 'Inicio', sub: 'Hospital Regional de Ayacucho «Miguel A. Mariscal Llerena»' },
  consultas: { title: 'Consultas y análisis', sub: 'Cuenta pacientes, citas y registros HIS, y organízalos como necesites' },
  pacientes: { title: 'Pacientes', sub: '' },
  atenciones: { title: 'Atenciones', sub: 'Registros de NProduccion por cita, paciente, personal, código o fecha' },
  defunciones: { title: 'Defunciones', sub: 'Personas fallecidas en Ayacucho según el certificado de defunción (SINADEF)' },
  personal: { title: 'Personal', sub: 'Ficha de cada profesional de MaestroPersonal y sus atenciones' },
  catalogos: { title: 'Catálogos', sub: 'Tablas maestras del HIS: diagnósticos, procedimientos, establecimientos, UPS y más' },
  reportes: { title: 'Producción asistencial', sub: 'Indicadores por año, mes, tratamiento, establecimiento y servicio' },
  indicadores: { title: 'Indicadores de Desempeño', sub: 'Seguimiento y medición mensual de indicadores HIS MINSA' },
  config: { title: 'Configuración', sub: 'Estado del sistema, usuarios, seguridad y conexión' },
  perfil: { title: 'Mi perfil', sub: 'Información de tu cuenta y opciones de acceso' },
  importar: { title: 'Importar datos', sub: 'Importación de archivos planos CSV a la base HIS' }
};

// Partes de la URL: #pacientes/123 → ['pacientes', '123'].
function partesUrl() {
  try { return location.hash.slice(1).split('/').map(decodeURIComponent); } catch { return ['']; }
}

// Vista indicada en la URL (#consultas); 'inicio' si no existe o el usuario no tiene acceso.
function vistaDesdeUrl() {
  const view = partesUrl()[0];
  if (!view || !document.getElementById('view-' + view)) return 'inicio';
  if (view === 'importar' && currentUser?.role !== 'admin') return 'inicio';
  return view;
}

// Activa la vista y navegación elegidas, actualiza su encabezado y carga sus datos iniciales.
// La vista queda en la URL para que recargar la página o el botón Atrás vuelvan a ella.
function showView(view, { desdeUrl = false } = {}) {
  if (!desdeUrl && partesUrl()[0] !== view) history.pushState(null, '', '#' + view);
  // La vista nueva entra desde el lado hacia el que se avanza en el menú (ver «Cambio de vista» en css/vidrio.css).
  const ordenMenu = [...document.querySelectorAll('.appnav .nav-btn')].map(b => b.dataset.view);
  const posAnterior = ordenMenu.indexOf(document.querySelector('.view.active')?.id.replace('view-', ''));
  const posNueva = ordenMenu.indexOf(view);
  document.documentElement.dataset.vistaDir = posAnterior >= 0 && posNueva >= 0 && posNueva < posAnterior ? 'atras' : 'adelante';
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const el = document.getElementById('view-' + view);
  if (el) el.classList.add('active');
  const btn = document.querySelector(`.nav-btn[data-view="${view}"]`);
  if (btn) btn.classList.add('active');
  toggleSidebar(false);
  const m = viewMeta[view] || {};
  document.querySelector('.page-head').hidden = view === 'inicio';
  document.getElementById('pageTitle').textContent = m.title || view;
  document.getElementById('pageSubtitle').textContent = m.sub || '';
  if (view === 'reportes') abrirVistaProduccion();
  if (view === 'indicadores') abrirVistaIndicadores();
  if (view === 'consultas') abrirVistaConsultas();
  if (view === 'inicio') cargarInicio();
  if (view === 'pacientes') abrirVistaPacientes(desdeUrl ? { id: partesUrl()[1] || '' } : {});
  if (view === 'personal') abrirVistaPersonal(desdeUrl ? { id: partesUrl()[1] || '' } : {});
  if (view === 'atenciones') abrirVistaAtenciones();
  if (view === 'defunciones') abrirVistaDefunciones();
  if (view === 'catalogos') cargarCatalogos();
  if (view === 'perfil') renderUserProfile();
  if (view === 'importar') initImportView();
  if (view === 'config') abrirConfiguracion();
}

// Alterna la barra lateral, especialmente para la navegación en pantallas pequeñas.
function toggleSidebar(abrir) {
  const nav = document.getElementById('sidebar');
  const abierto = nav.classList.toggle('open', abrir);
  document.getElementById('appMenuToggle')?.setAttribute('aria-expanded', String(abierto));
}

// Menú del usuario (arriba a la derecha): Mi perfil, Importar datos, Configuración y Cerrar sesión.
function abrirMenuUsuario(abrir) {
  const panel = document.getElementById('userMenuPanel');
  const boton = document.getElementById('userMenuBtn');
  if (!panel || !boton) return;
  const mostrar = abrir ?? panel.hidden;
  panel.hidden = !mostrar;
  boton.setAttribute('aria-expanded', String(mostrar));
}

function setupMenuUsuario() {
  const menu = document.getElementById('userMenu');
  if (!menu) return;
  document.getElementById('userMenuBtn').addEventListener('click', event => { event.stopPropagation(); abrirMenuUsuario(); });
  menu.querySelectorAll('.nav-btn').forEach(b => b.addEventListener('click', () => abrirMenuUsuario(false)));
  document.getElementById('menuLogout').addEventListener('click', () => { abrirMenuUsuario(false); logout(); });
  document.addEventListener('click', event => { if (!menu.contains(event.target)) abrirMenuUsuario(false); });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (!document.getElementById('userMenuPanel').hidden) { abrirMenuUsuario(false); document.getElementById('userMenuBtn').focus(); }
    if (document.getElementById('sidebar').classList.contains('open')) toggleSidebar(false);
  });
}

// Nombre, iniciales y rol del usuario en el encabezado.
function mostrarUsuarioEnEncabezado(user) {
  const nombre = user?.fullName || '—';
  const rol = !user ? 'Usuario' : user.role === 'admin' ? 'Administrador' : 'Médico';
  const partes = String(user?.fullName || '').trim().split(/\s+/).filter(Boolean);
  const iniciales = partes.length ? (partes[0][0] + (partes[1]?.[0] || '')).toUpperCase() : '?';
  document.getElementById('usuarioActual').textContent = nombre;
  document.getElementById('usuarioRol').textContent = rol;
  document.getElementById('usuarioMenuNombre').textContent = nombre;
  document.getElementById('usuarioMenuRol').textContent = rol;
  document.getElementById('userAvatar').textContent = iniciales;
}

// ═══════════════════════════════════════
//  INICIALIZACIÓN
// ═══════════════════════════════════════
// Prepara la aplicación principal una sola vez después de que el usuario sale de la pantalla inicial.
let mainAppInitialized = false;
async function initializeMainApp() {
  if (mainAppInitialized) {
    showView('inicio');
    return;
  }
  mainAppInitialized = true;

  document.getElementById('apiUrlInput').value = apiUrl;
  await probarAPI(true);
  if (partesUrl()[0] !== vistaDesdeUrl()) history.replaceState(null, '', '#' + vistaDesdeUrl());
  showView(vistaDesdeUrl(), { desdeUrl: true });
  window.addEventListener('popstate', () => {
    if (currentUser) showView(vistaDesdeUrl(), { desdeUrl: true });
  });
}

const enterApplication = async user => {
  currentUser = user;
  mostrarUsuarioEnEncabezado(user);
  cargarControlInactividad();
  // La importación de datos solo está disponible para administradores.
  document.getElementById('navImportar').hidden = user.role !== 'admin';
  document.querySelector('.login-page').hidden = true;
  document.querySelector('.app').hidden = false;
  await initializeMainApp();
};

const returnToLogin = () => {
  currentUser = null;
  stopImportPolling();
  document.getElementById('navImportar').hidden = true;
  document.querySelector('.app').hidden = true;
  document.querySelector('.login-page').hidden = false;
  document.getElementById('loginPassword').value = '';
  mostrarUsuarioEnEncabezado(null);
  detenerControlInactividad();
  abrirMenuUsuario(false);
};

const profileFields = [
  ['Nombre completo', 'fullName'],
  ['Tipo de cuenta', 'role'],
  ['Usuario', 'username'],
  ['DNI', 'dni'],
  ['Correo electrónico', 'email'],
  ['Teléfono', 'phone'],
  ['Profesión', 'profession'],
  ['Especialidad', 'specialty'],
  ['N.º de colegiatura (CMP)', 'cmp'],
  ['Establecimiento', 'establishment'],
  ['ID del personal HIS', 'personalId'],
  ['Cuenta creada', 'createdAt']
];

function renderUserProfile() {
  if (!currentUser) return;
  const roleName = currentUser.role === 'admin' ? 'Administrador' : 'Médico';
  document.getElementById('profileDetails').innerHTML = profileFields.map(([label, key]) => {
    let value = key === 'role' ? roleName : currentUser[key];
    if (key === 'createdAt' && value) value = new Date(value).toLocaleString('es-PE');
    return `<div class="profile-item"><dt>${esc(label)}</dt><dd>${esc(value || 'No registrado')}</dd></div>`;
  }).join('');
  document.getElementById('adminUserFormCard').hidden = currentUser.role !== 'admin';
}

const fillPersonnelProfile = () => {
  const selectedId = document.getElementById('personMatch').value;
  const person = personnelMatches.find(item => String(item.personalId) === selectedId);
  document.getElementById('newUserFullName').value = person?.fullName || '';
  document.getElementById('newUserDni').value = person?.dni || '';
  document.getElementById('newUserProfession').value = person?.profession || '';
  document.getElementById('newUserCmp').value = person?.cmp || '';
  document.getElementById('newUserEstablishment').value = person?.establishment || '';
};

let personnelMatches = [];
let personnelSearchTimer;
let personnelSearchSequence = 0;

function updateNewUserRoleFields() {
  const isDoctor = document.getElementById('newUserRole').value === 'doctor';
  document.getElementById('personSearchField').hidden = !isDoctor;
  document.getElementById('newUserSpecialty').required = isDoctor;
  document.getElementById('specialtyRequired').hidden = !isDoctor;
  ['newUserFullName', 'newUserDni', 'newUserProfession', 'newUserCmp', 'newUserEstablishment'].forEach(id => {
    const field = document.getElementById(id);
    field.readOnly = isDoctor || ['newUserProfession', 'newUserCmp', 'newUserEstablishment'].includes(id);
    if (!isDoctor && (id === 'newUserProfession' || id === 'newUserEstablishment')) {
      field.value = id === 'newUserProfession' ? 'Administración' : 'Hospital Miguel A. Mariscal Llerena';
    }
  });
  if (!isDoctor) {
    personnelSearchSequence += 1;
    document.getElementById('personSearch').value = '';
    document.getElementById('personMatch').innerHTML = '<option value="">No aplica para administradores</option>';
    personnelMatches = [];
  }
}

async function searchPersonnelForAccount(term, sequence) {
  const select = document.getElementById('personMatch');
  personnelMatches = [];
  select.innerHTML = '<option value="">Buscando personal...</option>';
  try {
    const results = await apiFetch(`/auth/personal?q=${encodeURIComponent(term)}`);
    if (sequence !== personnelSearchSequence) return;
    personnelMatches = results;
    select.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = results.length ? 'Selecciona un médico del catálogo' : 'No se encontraron coincidencias';
    select.appendChild(placeholder);
    results.forEach(person => {
      const option = document.createElement('option');
      option.value = String(person.personalId);
      option.textContent = `${person.fullName} — DNI ${person.dni || 'no registrado'}${person.profession ? ` · ${person.profession}` : ''}`;
      select.appendChild(option);
    });
  } catch (error) {
    if (sequence !== personnelSearchSequence) return;
    select.innerHTML = '<option value="">No se pudo consultar el catálogo de personal</option>';
    toast(error.message, 'error');
  }
}

async function submitNewUser(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.getElementById('createUserStatus');
  const submit = document.getElementById('createUserSubmit');
  const data = new FormData(form);
  const role = data.get('role');
  const personId = document.getElementById('personMatch').value;
  if (role === 'doctor' && !personId) {
    status.textContent = 'Busca y selecciona al médico en el catálogo HIS.';
    status.hidden = false;
    return;
  }

  const payload = Object.fromEntries(data.entries());
  payload.personalId = personId;
  submit.disabled = true;
  status.hidden = true;
  try {
    await apiFetch('/auth/users', { method: 'POST', body: JSON.stringify(payload) });
    toast('La cuenta fue creada correctamente.', 'success');
    form.reset();
    updateNewUserRoleFields();
  } catch (error) {
    status.textContent = error.message;
    status.hidden = false;
  } finally {
    submit.disabled = false;
  }
}

async function logout() {
  const button = document.getElementById('logoutButton');
  button.disabled = true;
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
    returnToLogin();
  } catch (error) {
    if (error.status === 401) {
      returnToLogin();
    } else {
      showAlert(error.message, 'error');
    }
  } finally {
    button.disabled = false;
  }
}

// Conecta los controles y restaura la sesión segura, si todavía está vigente.
alCargarVistas(async () => {
  const usernameInput = document.getElementById('loginUsername');
  const rememberUser = document.getElementById('rememberUser');
  const loginStatus = document.getElementById('loginStatus');
  const rememberedUsernameKey = 'his_remembered_username';

  try {
    const rememberedUsername = localStorage.getItem(rememberedUsernameKey);
    if (rememberedUsername) {
      usernameInput.value = rememberedUsername;
      rememberUser.checked = true;
    }
  } catch (error) {
    loginStatus.textContent = 'No se pudo recuperar el usuario guardado en este navegador.';
    loginStatus.hidden = false;
  }

  document.getElementById('loginForm').addEventListener('submit', event => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('[type="submit"]');
    const passwordInput = document.getElementById('loginPassword');
    submit.disabled = true;
    loginStatus.hidden = true;

    apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: usernameInput.value.trim(), password: passwordInput.value })
    }).then(async result => {
      try {
        if (rememberUser.checked) {
          localStorage.setItem(rememberedUsernameKey, usernameInput.value.trim());
        } else {
          localStorage.removeItem(rememberedUsernameKey);
        }
      } catch (error) {
        toast('No se pudo guardar la preferencia de usuario en este navegador.', 'error');
      }
      passwordInput.value = '';
      await enterApplication(result.user);
    }).catch(error => {
      loginStatus.textContent = error.message;
      loginStatus.hidden = false;
    }).finally(() => {
      submit.disabled = false;
    });
  });

  document.querySelectorAll('.nav-btn').forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.view)));
  setupMenuUsuario();
  document.getElementById('logoutButton').addEventListener('click', logout);
  document.getElementById('newUserRole').addEventListener('change', updateNewUserRoleFields);
  document.getElementById('personMatch').addEventListener('change', fillPersonnelProfile);
  document.getElementById('personSearch').addEventListener('input', event => {
    clearTimeout(personnelSearchTimer);
    const term = event.target.value.trim();
    const sequence = ++personnelSearchSequence;
    document.getElementById('newUserFullName').value = '';
    document.getElementById('newUserDni').value = '';
    document.getElementById('newUserProfession').value = '';
    document.getElementById('newUserCmp').value = '';
    document.getElementById('newUserEstablishment').value = '';
    if (term.length < 2) {
      document.getElementById('personMatch').innerHTML = '<option value="">Escribe para buscar y selecciona un médico</option>';
      personnelMatches = [];
      return;
    }
    document.getElementById('personMatch').innerHTML = '<option value="">Buscando personal...</option>';
    personnelSearchTimer = setTimeout(() => searchPersonnelForAccount(term, sequence), 250);
  });
  document.getElementById('createUserForm').addEventListener('submit', submitNewUser);
  updateNewUserRoleFields();
  setupImportView();

  try {
    const result = await apiFetch('/auth/session');
    if (result.user) await enterApplication(result.user);
  } catch (error) {
    loginStatus.textContent = error.message;
    loginStatus.hidden = false;
  }
});

// ═══════════════════════════════════════
//  CONEXIÓN CON LA API
// ═══════════════════════════════════════
// Consulta metadatos para reflejar el estado de la API y notifica el resultado si se solicita.
async function probarAPI(silent = false) {
  try {
    await apiFetch('/consultas/metadata');
    const badge = document.getElementById('apiState');
    badge.textContent = 'API conectada';
    badge.className = 'topbar-badge connected';
    if (!silent) toast('Conexión exitosa con la API', 'success');
  } catch (e) {
    const badge = document.getElementById('apiState');
    badge.textContent = 'API desconectada';
    badge.className = 'topbar-badge disconnected';
    if (!silent) toast('No se pudo conectar a la API', 'error');
  }
}

// Persiste la URL configurada en el navegador y comprueba la nueva conexión.
function guardarConfig() {
  apiUrl = gv('apiUrlInput') || API_BASE;
  localStorage.setItem('his_api_url', apiUrl);
  toast('Configuración guardada', 'success');
  probarAPI();
}

// ═══════════════════════════════════════
//  CONSULTAS: datos y modales compartidos (la vista está en js/consultas.js)
// ═══════════════════════════════════════
// Resultado vigente: js/consultas.js lo escribe y los modales de detalle lo leen.
let currentQueryResult = null;
let currentFilteredRows = [];
const currentNumericColumns = ['total', 'registros', 'pacientes', 'atenciones'];
let currentModalCode = '';

const COLUMN_LABELS = {
  idPaciente: 'ID del paciente',
  documento: 'Documento del paciente',
  nombrePaciente: 'Nombre del paciente',
  establecimiento: 'Establecimiento',
  departamento: 'Departamento',
  provincia: 'Provincia',
  profesional: 'Profesional',
  mes: 'Mes',
  dia: 'Día',
  año: 'Año',
  codigoHIS: 'Código HIS',
  diagnostico: 'Diagnóstico',
  tipoDiagnostico: 'Tipo de diagnóstico HIS',
  financiador: 'Financiador',
  sexo: 'Sexo',
  ups: 'UPS',
  edad: 'Edad',
  peso: 'Peso',
  talla: 'Talla',
  hemoglobina: 'Hemoglobina',
  valorLab: 'Valor LAB',
  historiaClinica: 'Historia clínica',
  total: 'Resultado total',
  registros: 'Registros HIS',
  pacientes: 'Pacientes únicos',
  atenciones: 'Citas únicas'
};

function escJs(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Abre la historia clínica completa del paciente desde la tabla de resultados
async function abrirFichaPacienteDesdeResultados(idOrDoc, fullName, event) {
  if (event) event.stopPropagation();
  if (!idOrDoc) return;
  toast('Cargando historia clínica del paciente...', 'info');

  try {
    const res = await apiFetch(`/pacientes?q=${encodeURIComponent(idOrDoc)}`);
    const list = Array.isArray(res.data) ? res.data : [];
    const found = list.find(p => String(p.id) === String(idOrDoc) || String(p.numeroDocumento) === String(idOrDoc)) || list[0];

    showView('pacientes');
    if (found) {
      verDashboardPaciente(found);
    } else {
      verDashboardPaciente({
        id: idOrDoc,
        numeroDocumento: idOrDoc,
        nombres: fullName || idOrDoc,
        apellidoPaterno: '',
        apellidoMaterno: ''
      });
    }
  } catch (error) {
    showAlert('No se pudo abrir la historia clínica del paciente.', 'error');
  }
}

// Abre la actividad y detalle clínico de un código HIS
async function abrirModalActividadCodigo(codigoHIS, descripcion, event) {
  if (event) event.stopPropagation();
  currentModalCode = codigoHIS;
  const modal = document.getElementById('modalCodigoActividad');
  const badge = document.getElementById('modalCodigoBadge');
  const desc = document.getElementById('modalCodigoDesc');
  const body = document.getElementById('modalCodigoBody');
  if (!modal || !body) return;

  badge.textContent = codigoHIS;
  desc.textContent = descripcion || 'Consultando catálogo...';
  body.innerHTML = '<div class="table-empty"><span class="spinner-sm"></span> Consultando actividad en NProducción...</div>';
  modal.classList.add('show');

  try {
    const data = await apiFetch(`/consultas/codigo/${encodeURIComponent(codigoHIS)}/actividad`);
    const info = data.info || {};
    const resumen = data.resumen || {};
    const profesionales = data.profesionales || [];
    const establecimientos = data.establecimientos || [];
    const atenciones = data.atenciones || [];
    const porMes = data.porMes || [];

    if (info.codigo) {
      currentModalCode = info.codigo;
      badge.textContent = info.codigo;
    }
    desc.textContent = info.descripcion || descripcion || 'Sin descripción en catálogo';

    body.innerHTML = `
      <div class="code-stat-strip">
        <div class="code-stat-box">
          <span>Registros HIS</span>
          <strong>${formatNumber(resumen.totalRegistros || 0)}</strong>
        </div>
        <div class="code-stat-box">
          <span>Citas únicas</span>
          <strong>${formatNumber(resumen.citasUnicas || 0)}</strong>
        </div>
        <div class="code-stat-box">
          <span>Pacientes únicos</span>
          <strong>${formatNumber(resumen.pacientesUnicos || 0)}</strong>
        </div>
        <div class="code-stat-box">
          <span>Personal médico</span>
          <strong>${formatNumber(resumen.personalDistinto || 0)}</strong>
        </div>
        <div class="code-stat-box">
          <span>Rango fechas</span>
          <strong style="font-size:14px; margin-top:6px;">${resumen.primeraAtencion ? fechaDashboard(resumen.primeraAtencion) : '—'} al ${resumen.ultimaAtencion ? fechaDashboard(resumen.ultimaAtencion) : '—'}</strong>
        </div>
      </div>

      <div class="code-tabs-nav">
        <button type="button" class="code-tab-nav-btn active" onclick="cambiarTabCodigoModal('atenciones', event)">
          Atenciones recientes (${atenciones.length})
        </button>
        <button type="button" class="code-tab-nav-btn" onclick="cambiarTabCodigoModal('medicos', event)">
          Médicos frecuentes (${profesionales.length})
        </button>
        <button type="button" class="code-tab-nav-btn" onclick="cambiarTabCodigoModal('establecimientos', event)">
          Establecimientos (${establecimientos.length})
        </button>
        <button type="button" class="code-tab-nav-btn" onclick="cambiarTabCodigoModal('meses', event)">
          Evolución mensual (${porMes.length})
        </button>
      </div>

      <div id="codeTabPane-atenciones" class="code-tab-panel active">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Cita ID</th>
                <th>Paciente</th>
                <th>Profesional</th>
                <th>Establecimiento</th>
                <th>UPS</th>
                <th style="text-align:center;">Tipo Dx</th>
                <th style="text-align:center;">Valor LAB</th>
                <th style="text-align:center;">Historia</th>
              </tr>
            </thead>
            <tbody>
              ${atenciones.length ? atenciones.map(at => {
                const td = (at.tipoDiagnostico || '').toUpperCase().trim();
                const tipoLabel = td === 'D' ? 'Definitivo' : td === 'P' ? 'Presuntivo' : td === 'R' ? 'Repetido' : (td || '-');
                const tipoClass = td === 'D' ? 'badge-definitivo' : td === 'P' ? 'badge-presuntivo' : td === 'R' ? 'badge-repetido' : 'badge-neutral';
                const fullName = at.nombrePaciente || 'Sin nombre registrado';
                return `<tr>
                  <td>${esc(fechaDashboard(at.fechaAtencion))}</td>
                  <td class="font-mono text-xs">${esc(at.idCita || '-')}</td>
                  <td>
                    <button type="button" class="btn-cell-link patient-cell-btn" onclick="cerrarModalCodigoActividad(); abrirFichaPacienteDesdeResultados('${escJs(at.idPaciente || at.documentoPaciente)}', '${escJs(fullName)}', event)">
                      ${esc(fullName)} (${esc(at.documentoPaciente || at.idPaciente || '-')}) ↗
                    </button>
                  </td>
                  <td>
                    <button type="button" class="btn-cell-link personal-cell-btn" onclick="cerrarModalCodigoActividad(); abrirPersonalDesdeResultados('${escJs(at.nombrePersonal)}', event)">
                      ${esc(at.nombrePersonal || 'No registrado')} ↗
                    </button>
                  </td>
                  <td>${esc(at.nombreEstablecimiento || '-')}</td>
                  <td><span class="service-chip">${esc(at.descripcionUps || '-')}</span></td>
                  <td style="text-align:center;"><span class="badge ${tipoClass}">${esc(tipoLabel)}</span></td>
                  <td style="text-align:center;">${at.valorLab ? `<span class="lab-pill">${esc(at.valorLab)}</span>` : '-'}</td>
                  <td style="text-align:center;">
                    <button type="button" class="btn btn-primary btn-sm" onclick="cerrarModalCodigoActividad(); abrirFichaPacienteDesdeResultados('${escJs(at.idPaciente || at.documentoPaciente)}', '${escJs(fullName)}', event)">
                      Ver historia
                    </button>
                  </td>
                </tr>`;
              }).join('') : '<tr><td colspan="9" class="table-empty">No se registraron atenciones recientes con este código.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div id="codeTabPane-medicos" class="code-tab-panel">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Profesional</th>
                <th>Documento</th>
                <th style="text-align:right;">Registros HIS</th>
                <th style="text-align:right;">Citas</th>
                <th style="text-align:right;">Pacientes</th>
                <th style="text-align:center;">Acción</th>
              </tr>
            </thead>
            <tbody>
              ${profesionales.length ? profesionales.map(p => `<tr>
                <td><strong>${esc(p.nombre || 'No registrado')}</strong></td>
                <td>${esc(p.documento || '-')}</td>
                <td style="text-align:right;">${formatNumber(p.registros)}</td>
                <td style="text-align:right;">${formatNumber(p.atenciones)}</td>
                <td style="text-align:right;">${formatNumber(p.pacientes)}</td>
                <td style="text-align:center;">
                  <button type="button" class="btn btn-secondary btn-sm" onclick="cerrarModalCodigoActividad(); abrirPersonalDesdeResultados('${escJs(p.nombre)}', event)">
                    Ver actividad
                  </button>
                </td>
              </tr>`).join('') : '<tr><td colspan="6" class="table-empty">Sin registros de profesionales para este código.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div id="codeTabPane-establecimientos" class="code-tab-panel">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Establecimiento</th>
                <th>Departamento</th>
                <th>Provincia</th>
                <th style="text-align:right;">Registros HIS</th>
                <th style="text-align:right;">Citas atendidas</th>
              </tr>
            </thead>
            <tbody>
              ${establecimientos.length ? establecimientos.map(e => `<tr>
                <td><strong>${esc(e.nombre || '-')}</strong></td>
                <td>${esc(e.departamento || '-')}</td>
                <td>${esc(e.provincia || '-')}</td>
                <td style="text-align:right;">${formatNumber(e.registros)}</td>
                <td style="text-align:right;">${formatNumber(e.atenciones)}</td>
              </tr>`).join('') : '<tr><td colspan="5" class="table-empty">Sin registros de establecimientos.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div id="codeTabPane-meses" class="code-tab-panel">
        <div class="insight-list">
          ${renderBarrasHtml(porMes, 'periodo', 'registros')}
        </div>
      </div>
    `;
  } catch (error) {
    body.innerHTML = `<div class="table-empty">${esc(error.message || 'No se pudo obtener la información de este código.')}</div>`;
  }
}

function cambiarTabCodigoModal(tabName, event) {
  document.querySelectorAll('.code-tab-nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.code-tab-panel').forEach(p => p.classList.remove('active'));
  event.currentTarget.classList.add('active');
  document.getElementById(`codeTabPane-${tabName}`)?.classList.add('active');
}

function cerrarModalCodigoActividad() {
  document.getElementById('modalCodigoActividad')?.classList.remove('show');
}

function agregarCodigoAFiltrosActuales() {
  if (!currentModalCode) return;
  cerrarModalCodigoActividad();
  cxFiltrarPorCodigo(currentModalCode);
  toast(`Código ${currentModalCode} añadido a los filtros`, 'success');
}

function renderBarrasHtml(rows = [], labelField, valueField) {
  if (!rows || !rows.length) return '<div class="table-empty">No hay datos para mostrar.</div>';
  const max = Math.max(...rows.map(row => Number(row[valueField]) || 0), 1);
  return rows.map(row => {
    const value = Number(row[valueField]) || 0;
    const label = textoDashboard(row[labelField]);
    return `<div class="insight-item"><div class="insight-label"><span>${esc(label)}</span><strong>${value.toLocaleString('es-PE')}</strong></div><div class="insight-track"><span style="width:${Math.max(3, value / max * 100)}%"></span></div></div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════════════════
//  MODAL: DESGLOSE ASISTENCIAL DE CITAS Y REGISTROS CLÍNICOS
//  Gestiona las 3 pestañas: Citas Médicas (Visitas), Registros Clínicos HIS y Resumen Diagnóstico
// ═══════════════════════════════════════════════════════════════════════════
let currentModalAtenciones = [];
let currentModalActiveTab = 'citas';

// Cambia entre las pestañas del modal (citas, registros o resumen diagnóstico)
function cambiarTabDetalleAtenciones(tabName) {
  currentModalActiveTab = tabName;
  document.querySelectorAll('.modal-subtab-btn').forEach(btn => btn.classList.remove('active'));
  if (tabName === 'citas') document.getElementById('modalTabBtnCitas')?.classList.add('active');
  if (tabName === 'registros') document.getElementById('modalTabBtnRegistros')?.classList.add('active');
  if (tabName === 'resumen') document.getElementById('modalTabBtnResumen')?.classList.add('active');
  renderModalDetalleAtencionesTab();
}

// Renderiza el contenido de la pestaña activa en el modal de atenciones
function renderModalDetalleAtencionesTab() {
  const body = document.getElementById('modalAtencionesBody');
  if (!body) return;

  const atenciones = currentModalAtenciones;
  if (!atenciones.length) {
    body.innerHTML = '<div class="table-empty">No se encontraron registros asistenciales para este grupo.</div>';
    return;
  }

  // ──── PESTAÑA 1: CITAS MÉDICAS (VISITAS Y CONSULTAS AGRUPADAS) ────
  if (currentModalActiveTab === 'citas') {
    const citasList = [];
    const citasMap = new Map();
    atenciones.forEach(at => {
      const key = at.idCita ? `cita_${at.idCita}` : `${at.fechaAtencion}_${at.idPaciente}_${at.nombrePersonal}`;
      if (!citasMap.has(key)) {
        const item = {
          idCita: at.idCita,
          fecha: at.fechaAtencion,
          idPaciente: at.idPaciente,
          documentoPaciente: at.documentoPaciente,
          nombrePaciente: at.nombrePaciente,
          nombrePersonal: at.nombrePersonal,
          establecimiento: at.nombreEstablecimiento,
          ups: at.descripcionUps,
          financiador: at.financiador,
          edad: at.edadRegistro,
          tipoEdad: at.tipoEdad,
          items: []
        };
        citasMap.set(key, item);
        citasList.push(item);
      }
      citasMap.get(key).items.push(at);
    });

    document.getElementById('modalBadgeCountCitas').textContent = citasList.length;

    body.innerHTML = `
      <div style="margin-bottom:14px; display:flex; justify-content:space-between; align-items:center;">
        <span class="text-sm font-bold" style="color:var(--c-primary);">${citasList.length} Citas / Visitas médicas registradas (en ${atenciones.length} registros HIS)</span>
      </div>
      <div class="citas-grid">
        ${citasList.map(cita => {
          const fullName = cita.nombrePaciente || 'Sin nombre registrado';
          return `
            <div class="cita-card">
              <div class="cita-card-header">
                <div class="cita-header-left">
                  <span class="cita-date-badge">${esc(fechaDashboard(cita.fecha))}</span>
                  ${cita.idCita ? `<span class="cita-id-pill">Cita #${esc(cita.idCita)}</span>` : ''}
                  <span class="badge badge-neutral">${cita.items.length} diagnósticos/procedimientos</span>
                </div>
                <div class="actions">
                  <button type="button" class="btn btn-primary btn-xs" onclick="cerrarModalDetalleAtenciones(); abrirFichaPacienteDesdeResultados('${esc(cita.idPaciente || cita.documentoPaciente)}', '${esc(fullName)}', event)">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
                    Historia Clínica
                  </button>
                </div>
              </div>
              <div class="cita-card-body">
                <div class="cita-info-row">
                  <div class="cita-info-item">
                    <strong>Paciente:</strong>
                    <button type="button" class="btn-cell-link patient-cell-btn" onclick="cerrarModalDetalleAtenciones(); abrirFichaPacienteDesdeResultados('${esc(cita.idPaciente || cita.documentoPaciente)}', '${esc(fullName)}', event)">
                      ${esc(fullName)} (${esc(cita.documentoPaciente || cita.idPaciente || '-')}) ↗
                    </button>
                  </div>
                  <div class="cita-info-item">
                    <strong>Médico:</strong>
                    <button type="button" class="btn-cell-link personal-cell-btn" onclick="cerrarModalDetalleAtenciones(); abrirPersonalDesdeResultados('${escJs(cita.nombrePersonal)}', event)">
                      ${esc(cita.nombrePersonal || 'No registrado')} ↗
                    </button>
                  </div>
                  <div class="cita-info-item">
                    <strong>Lugar:</strong>
                    <span>${esc(cita.establecimiento || '-')}</span>
                  </div>
                  <div class="cita-info-item">
                    <strong>Servicio:</strong>
                    <span class="service-chip">${esc(cita.ups || '-')}</span>
                  </div>
                  ${cita.financiador ? `<div class="cita-info-item"><strong>Financiador:</strong> <span>${esc(cita.financiador)}</span></div>` : ''}
                </div>
                <div class="cita-dx-section">
                  <div class="cita-dx-title">Diagnósticos y Procedimientos atendidos en esta cita:</div>
                  <div class="cita-dx-chips">
                    ${cita.items.map(it => {
                      const td = (it.tipoDiagnostico || '').toUpperCase().trim();
                      const tipoLabel = td === 'D' ? 'Definitivo' : td === 'P' ? 'Presuntivo' : td === 'R' ? 'Repetido' : (td || '-');
                      const tipoClass = td === 'D' ? 'badge-definitivo' : td === 'P' ? 'badge-presuntivo' : td === 'R' ? 'badge-repetido' : 'badge-neutral';
                      return `
                        <div class="cita-dx-item" title="Haga clic en el código para ver estadísticas">
                          <span class="dx-tipo-tag ${tipoClass}">${esc(tipoLabel)}</span>
                          <span class="code-badge font-bold" style="cursor:pointer;" onclick="cerrarModalDetalleAtenciones(); abrirModalActividadCodigo('${escJs(it.codigoItem)}', '${escJs(it.descripcionItem || '')}', event)">
                            ${esc(it.codigoItem || '-')} ↗
                          </span>
                          <span>${esc(it.descripcionItem || '-')}</span>
                          ${it.valorLab ? `<span class="lab-pill">Lab: ${esc(it.valorLab)}</span>` : ''}
                        </div>
                      `;
                    }).join('')}
                  </div>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
    return;
  }

  // ──── PESTAÑA 2: REGISTROS CLÍNICOS HIS (LÍNEAS DE PRODUCCIÓN DETALLADAS) ────
  if (currentModalActiveTab === 'registros') {
    document.getElementById('modalBadgeCountRegistros').textContent = atenciones.length;

    body.innerHTML = `
      <div style="margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
        <span class="text-sm font-bold" style="color:var(--c-primary);">${atenciones.length} registros clínicos individuales</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Cita ID</th>
              <th>Paciente</th>
              <th>Profesional</th>
              <th>Establecimiento</th>
              <th>UPS</th>
              <th>Código & Diagnóstico</th>
              <th style="text-align:center;">Tipo Dx</th>
              <th style="text-align:center;">Valor LAB</th>
              <th style="text-align:center;">Edad / Vitals</th>
              <th style="text-align:center;">Historia</th>
            </tr>
          </thead>
          <tbody>
            ${atenciones.map(at => {
              const td = (at.tipoDiagnostico || '').toUpperCase().trim();
              const tipoLabel = td === 'D' ? 'Definitivo' : td === 'P' ? 'Presuntivo' : td === 'R' ? 'Repetido' : (td || '-');
              const tipoClass = td === 'D' ? 'badge-definitivo' : td === 'P' ? 'badge-presuntivo' : td === 'R' ? 'badge-repetido' : 'badge-neutral';
              const fullName = at.nombrePaciente || 'Sin nombre registrado';
              const vitals = [
                at.peso ? `${at.peso}kg` : '',
                at.talla ? `${at.talla}cm` : '',
                at.hemoglobina ? `Hb:${at.hemoglobina}` : ''
              ].filter(Boolean).join(' · ');

              return `<tr>
                <td>${esc(fechaDashboard(at.fechaAtencion))}</td>
                <td class="font-mono text-xs">${esc(at.idCita || '-')}</td>
                <td>
                  <button type="button" class="btn-cell-link patient-cell-btn" onclick="cerrarModalDetalleAtenciones(); abrirFichaPacienteDesdeResultados('${escJs(at.idPaciente || at.documentoPaciente)}', '${escJs(fullName)}', event)">
                    ${esc(fullName)} (${esc(at.documentoPaciente || at.idPaciente || '-')}) ↗
                  </button>
                </td>
                <td>
                  <button type="button" class="btn-cell-link personal-cell-btn" onclick="cerrarModalDetalleAtenciones(); abrirPersonalDesdeResultados('${escJs(at.nombrePersonal)}', event)">
                    ${esc(at.nombrePersonal || 'No registrado')} ↗
                  </button>
                </td>
                <td>${esc(at.nombreEstablecimiento || '-')}</td>
                <td><span class="service-chip">${esc(at.descripcionUps || '-')}</span></td>
                <td>
                  <div class="dx-cell">
                    <span class="code-badge font-bold" style="cursor:pointer;" onclick="cerrarModalDetalleAtenciones(); abrirModalActividadCodigo('${escJs(at.codigoItem)}', '${escJs(at.descripcionItem || '')}', event)">${esc(at.codigoItem || '-')} ↗</span>
                    <span class="dx-desc">${esc(at.descripcionItem || '-')}</span>
                  </div>
                </td>
                <td style="text-align:center;"><span class="badge ${tipoClass}">${esc(tipoLabel)}</span></td>
                <td style="text-align:center;">${at.valorLab ? `<span class="lab-pill">${esc(at.valorLab)}</span>` : '-'}</td>
                <td style="text-align:center; font-size:11.5px; color:var(--c-text-muted);">
                  ${at.edadRegistro ? `${at.edadRegistro}${at.tipoEdad || 'A'}` : ''}
                  ${vitals ? `<br><span>${esc(vitals)}</span>` : ''}
                </td>
                <td style="text-align:center;">
                  <button type="button" class="btn btn-primary btn-xs" onclick="cerrarModalDetalleAtenciones(); abrirFichaPacienteDesdeResultados('${escJs(at.idPaciente || at.documentoPaciente)}', '${escJs(fullName)}', event)">
                    Ver historia
                  </button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
    return;
  }

  // ──── PESTAÑA 3: RESUMEN DIAGNÓSTICO (FRECUENCIA DE CÓDIGOS) ────
  if (currentModalActiveTab === 'resumen') {
    const dxMap = new Map();
    atenciones.forEach(at => {
      const c = at.codigoItem || 'SIN_CODIGO';
      if (!dxMap.has(c)) {
        dxMap.set(c, {
          codigo: c,
          descripcion: at.descripcionItem || 'Sin descripción',
          tipoItem: at.descripcionTipoItem || '',
          registros: 0,
          pacientes: new Set()
        });
      }
      const entry = dxMap.get(c);
      entry.registros++;
      if (at.idPaciente) entry.pacientes.add(at.idPaciente);
    });

    const dxList = Array.from(dxMap.values()).sort((a, b) => b.registros - a.registros);
    document.getElementById('modalBadgeCountDx').textContent = dxList.length;

    body.innerHTML = `
      <div style="margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
        <span class="text-sm font-bold" style="color:var(--c-primary);">${dxList.length} Códigos diagnósticos o actividades distintas encontradas</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th style="width:50px;">#</th>
              <th>Código HIS</th>
              <th>Descripción</th>
              <th style="text-align:right;">Registros</th>
              <th style="text-align:right;">Pacientes</th>
              <th style="text-align:center;">Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${dxList.map((dx, idx) => `
              <tr>
                <td>${idx + 1}</td>
                <td><span class="code-badge font-bold">${esc(dx.codigo)}</span></td>
                <td><strong>${esc(dx.descripcion)}</strong> ${dx.tipoItem ? `<br><small class="text-muted">${esc(dx.tipoItem)}</small>` : ''}</td>
                <td style="text-align:right; font-weight:700;">${formatNumber(dx.registros)}</td>
                <td style="text-align:right;">${formatNumber(dx.pacientes.size)}</td>
                <td style="text-align:center;">
                  <button type="button" class="btn btn-secondary btn-xs" onclick="cerrarModalDetalleAtenciones(); abrirModalActividadCodigo('${escJs(dx.codigo)}', '${escJs(dx.descripcion)}', event)">
                    Actividad del Código
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
}

// Abre el modal detallado con la pestaña indicada ('citas', 'registros' o 'resumen')
async function abrirModalDetalleAtencionesFila(rowIndex, initialTab = 'citas', event) {
  if (event) event.stopPropagation();
  const row = currentFilteredRows[rowIndex];
  if (!row) return;

  currentModalActiveTab = initialTab;
  const modal = document.getElementById('modalDetalleAtenciones');
  const subtitle = document.getElementById('modalAtencionesSubtitle');
  const body = document.getElementById('modalAtencionesBody');
  if (!modal || !body) return;

  // Activa visualmente el botón de la subpestaña seleccionada
  document.querySelectorAll('.modal-subtab-btn').forEach(btn => btn.classList.remove('active'));
  if (initialTab === 'citas') document.getElementById('modalTabBtnCitas')?.classList.add('active');
  if (initialTab === 'registros') document.getElementById('modalTabBtnRegistros')?.classList.add('active');
  if (initialTab === 'resumen') document.getElementById('modalTabBtnResumen')?.classList.add('active');

  const filterKeys = Object.keys(row).filter(k => !currentNumericColumns.includes(k));
  const filterDesc = filterKeys.length
    ? filterKeys.map(k => `${COLUMN_LABELS[k] || k}: ${row[k] || 'Sin dato'}`).join(' · ')
    : 'Totalidad de resultados agrupados';

  subtitle.textContent = filterDesc;
  body.innerHTML = '<div class="table-empty"><span class="spinner-sm"></span> Consultando atenciones específicas en producción...</div>';
  modal.classList.add('show');

  try {
    const payload = {
      rowFilter: row,
      period: currentQueryResult?.period || {},
      limit: 150
    };

    const res = await apiFetch('/consultas/detalle-atenciones', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    currentModalAtenciones = Array.isArray(res.atenciones) ? res.atenciones : [];
    
    // Calcula los conteos de las subpestañas
    const citasListSet = new Set(currentModalAtenciones.map(a => a.idCita || `${a.fechaAtencion}_${a.idPaciente}`));
    const dxListSet = new Set(currentModalAtenciones.map(a => a.codigoItem).filter(Boolean));
    
    document.getElementById('modalBadgeCountCitas').textContent = citasListSet.size;
    document.getElementById('modalBadgeCountRegistros').textContent = currentModalAtenciones.length;
    document.getElementById('modalBadgeCountDx').textContent = dxListSet.size;

    renderModalDetalleAtencionesTab();
  } catch (error) {
    body.innerHTML = `<div class="table-empty">${esc(error.message || 'No se pudo obtener el desglose de atenciones.')}</div>`;
  }
}

// Cierra el diálogo modal de atenciones
function cerrarModalDetalleAtenciones() {
  document.getElementById('modalDetalleAtenciones')?.classList.remove('show');
}

// Abre el dashboard de personal buscando primero por nombre si no se dispone de objeto completo
async function abrirPersonalDesdeResultados(nombrePersonal, event) {
  if (event) event.stopPropagation();
  if (!nombrePersonal || nombrePersonal === 'No registrado') return;
  toast(`Buscando profesional: ${nombrePersonal}...`, 'info');

  try {
    const data = await apiFetch(`/maestros/personal?q=${encodeURIComponent(nombrePersonal)}`);
    if (Array.isArray(data) && data.length) {
      abrirActividadPersonal(data[0]);
    } else {
      abrirActividadPersonal({
        nombre: nombrePersonal,
        descripcion: nombrePersonal,
        codigo: '',
        documento: ''
      });
    }
  } catch (error) {
    showAlert('No se pudo abrir la actividad del profesional.', 'error');
  }
}

// Formatea cantidades con separadores locales y normaliza valores ausentes o no numéricos.
function formatNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString('es-PE') : '0';
}

// ═══════════════════════════════════════

// ═══════════════════════════════════════
//  PUENTES ENTRE CONSULTAS / PRODUCCIÓN Y LAS VISTAS DE ESTE PROYECTO
// ═══════════════════════════════════════
// Utilidades de texto y fecha que usan las búsquedas, los catálogos y los reportes.
function normalizeText(value) {
  return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
function lcFirst(text) {
  const value = String(text || '');
  return value.charAt(0).toLowerCase() + value.slice(1);
}
function formatIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value || '');
}

// Desde los resultados de Consultas: abre la ficha del paciente en la vista Pacientes.
function verDashboardPaciente(paciente) {
  const dato = paciente?.numeroDocumento || paciente?.id || '';
  showView('pacientes');
  if (dato) buscarPacienteSimple(String(dato));
}

// Desde Consultas o Producción: abre la ficha del profesional en la vista Personal.
function abrirActividadPersonal(personal) {
  const id = personal?.id ?? personal?.Id_Personal;
  if (id !== undefined && id !== null && String(id).trim() !== '') { abrirFichaPersonal(id); return; }
  const dato = personal?.documento || personal?.nombre || personal?.descripcion || '';
  showView('personal');
  if (dato) buscarPersonalSimple(String(dato));
}
function abrirFichaPersonalDesdeReporte(personal) {
  abrirActividadPersonal(personal);
}

// Ficha de un código HIS desde Producción: usa la ventana de actividad del código de Consultas.
function abrirFichaDirectaCodigo(codigo, descripcion) {
  abrirModalActividadCodigo(codigo, descripcion);
}

// Sustituye valores vacíos de la respuesta por un texto común para la interfaz.
function textoDashboard(value) {
  return value === null || value === undefined || String(value).trim() === '' ? 'No hay datos' : String(value);
}

// Normaliza fechas del tablero al formato corto mostrado en las tablas.
function fechaDashboard(value) {
  const text = textoDashboard(value);
  return text === 'No hay datos' ? text : text.slice(0, 10);
}

// Filas de personal, diagnósticos y establecimientos del último reporte de producción (con ordenamiento reactivo)
let reportePersonalRows = [];
let reporteDiagnosticosRows = [];
let reporteEstablecimientosRows = [];
let totalCitasReporteActual = 0;
let reporteData = null;

let sortStateProd = {
  diag: { col: '', dir: 'asc' },
  pers: { col: '', dir: 'asc' },
  estab: { col: '', dir: 'asc' }
};

// Convierte series con etiqueta y cantidad en barras proporcionales reutilizables.
function renderBarras(targetId, rows = [], labelField, valueField, detailField = null) {
  const target = document.getElementById(targetId);
  if (!rows.length) { target.innerHTML = '<div class="table-empty">No hay datos para mostrar.</div>'; return; }
  const max = Math.max(...rows.map(row => Number(row[valueField]) || 0), 1);
  target.innerHTML = rows.map(row => {
    const value = Number(row[valueField]) || 0;
    const label = detailField ? `${textoDashboard(row[detailField])} · ${textoDashboard(row[labelField])}` : textoDashboard(row[labelField]);
    return `<div class="insight-item"><div class="insight-label"><span>${esc(label)}</span><strong>${value.toLocaleString('es-PE')}</strong></div><div class="insight-track"><span style="width:${Math.max(3, value / max * 100)}%"></span></div></div>`;
  }).join('');
}

//  PRODUCCIÓN ASISTENCIAL DINÁMICA (CON FILTROS INTERACTIVOS Y MÉTRICAS)
// ═══════════════════════════════════════════════════════════════════════════

let filtrosProduccionCargados = false;
let diagAutocompleteInitialized = false;
let diagDebounceTimer = null;
let currentDiagItems = [];
let activeDiagIndex = -1;

function setupDiagnosticoAutocomplete() {
  const input = document.getElementById('prodFiltroTratamiento');
  const hiddenCodigo = document.getElementById('prodFiltroTratamientoCodigo');
  const dropdown = document.getElementById('prodDiagDropdown');
  const chip = document.getElementById('prodDiagSelectedChip');
  const clearBtn = document.getElementById('prodTratamientoClearBtn');
  const hint = document.getElementById('prodDiagHint');
  if (!input || !dropdown) return;
  if (diagAutocompleteInitialized) return;
  diagAutocompleteInitialized = true;

  const renderDropdownItems = (items, titulo = 'Resultados coincidentes') => {
    currentDiagItems = items || [];
    activeDiagIndex = -1;
    if (!currentDiagItems.length) {
      dropdown.innerHTML = `<div class="prod-diag-empty">No se encontraron diagnósticos o procedimientos.</div>`;
      dropdown.style.display = 'block';
      return;
    }
    let html = `<div class="prod-diag-header">${esc(titulo)} (${currentDiagItems.length})</div>`;
    html += currentDiagItems.map((item, idx) => {
      const cod = item.codigo || item.id || '';
      const desc = item.descripcion || cod;
      const tipoLabel = item.tipo === 'CX' ? 'CIE-10' : (item.tipo === 'CP' || item.tipo === 'EX' ? 'CPMS' : (item.tipo || 'CIE'));
      return `
        <div class="prod-diag-item" data-index="${idx}" onclick="window.seleccionarDiagnosticoIndex(${idx})">
          <div class="prod-diag-item-top">
            <span class="prod-diag-code">${esc(cod)}</span>
            <span class="prod-diag-type">${esc(tipoLabel)}</span>
          </div>
          <div class="prod-diag-desc" title="${esc(desc)}">${esc(desc)}</div>
        </div>
      `;
    }).join('');
    dropdown.innerHTML = html;
    dropdown.style.display = 'block';
  };

  const mostrarFrecuentes = () => {
    const diagReporte = reporteData?.data?.diagnosticos || [];
    if (diagReporte.length > 0) {
      const frecuentes = diagReporte.slice(0, 10).map(d => ({
        id: d.codigo,
        codigo: d.codigo,
        descripcion: d.descripcion,
        tipo: d.tipo || 'CIE'
      }));
      renderDropdownItems(frecuentes, 'Diagnósticos frecuentes en el hospital');
      return;
    }
    dropdown.innerHTML = `<div class="prod-diag-loading">Cargando catálogo...</div>`;
    dropdown.style.display = 'block';
    apiFetch('/maestros/cie10?q=A').then(res => {
      renderDropdownItems((res || []).slice(0, 10), 'Diagnósticos principales (CIE-10)');
    }).catch(() => {
      dropdown.style.display = 'none';
    });
  };

  window.seleccionarDiagnosticoIndex = (idx) => {
    const item = currentDiagItems[idx];
    if (item) seleccionarDiagnosticoItem(item);
  };

  input.addEventListener('focus', () => {
    const q = input.value.trim();
    if (!q) {
      mostrarFrecuentes();
    } else {
      buscarEnCatalogo(q);
    }
  });

  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (clearBtn) clearBtn.style.display = q ? 'inline-flex' : 'none';
    clearTimeout(diagDebounceTimer);
    if (!q) {
      hiddenCodigo.value = '';
      if (chip) { chip.style.display = 'none'; chip.innerHTML = ''; }
      if (hint) hint.textContent = 'Buscar o seleccionar';
      mostrarFrecuentes();
      return;
    }
    dropdown.innerHTML = `<div class="prod-diag-loading">Buscando «${esc(q)}»...</div>`;
    dropdown.style.display = 'block';
    diagDebounceTimer = setTimeout(() => {
      buscarEnCatalogo(q);
    }, 220);
  });

  const buscarEnCatalogo = async (query) => {
    try {
      const items = await apiFetch(`/maestros/items?q=${encodeURIComponent(query)}`);
      renderDropdownItems(items.slice(0, 20), `Coincidencias para «${query}»`);
    } catch {
      dropdown.innerHTML = `<div class="prod-diag-empty">No se pudo buscar en el catálogo.</div>`;
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const items = dropdown.querySelectorAll('.prod-diag-item');
      if (items.length) {
        activeDiagIndex = (activeDiagIndex + 1) % items.length;
        items.forEach((it, i) => it.classList.toggle('is-active', i === activeDiagIndex));
        items[activeDiagIndex]?.scrollIntoView({ block: 'nearest' });
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const items = dropdown.querySelectorAll('.prod-diag-item');
      if (items.length) {
        activeDiagIndex = (activeDiagIndex - 1 + items.length) % items.length;
        items.forEach((it, i) => it.classList.toggle('is-active', i === activeDiagIndex));
        items[activeDiagIndex]?.scrollIntoView({ block: 'nearest' });
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeDiagIndex >= 0 && currentDiagItems[activeDiagIndex]) {
        seleccionarDiagnosticoItem(currentDiagItems[activeDiagIndex]);
      } else {
        dropdown.style.display = 'none';
        aplicarFiltrosProduccion();
      }
    } else if (e.key === 'Escape') {
      dropdown.style.display = 'none';
    }
  });

  document.addEventListener('click', (e) => {
    if (!document.getElementById('prodTratamientoContainer')?.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });
}

function seleccionarDiagnosticoItem(item) {
  if (!item) return;
  const input = document.getElementById('prodFiltroTratamiento');
  const hiddenCodigo = document.getElementById('prodFiltroTratamientoCodigo');
  const chip = document.getElementById('prodDiagSelectedChip');
  const clearBtn = document.getElementById('prodTratamientoClearBtn');
  const hint = document.getElementById('prodDiagHint');
  const dropdown = document.getElementById('prodDiagDropdown');

  const cod = item.codigo || item.id || '';
  const desc = item.descripcion || cod;
  if (hiddenCodigo) hiddenCodigo.value = cod;
  if (input) input.value = cod;

  if (chip) {
    chip.innerHTML = `
      <div class="prod-chip-body">
        <span class="prod-chip-code">${esc(cod)}</span>
        <span class="prod-chip-desc" title="${esc(desc)}">${esc(desc)}</span>
      </div>
      <button type="button" class="prod-chip-remove" onclick="limpiarFiltroTratamiento()" title="Quitar selección">✕</button>
    `;
    chip.style.display = 'flex';
  }
  if (clearBtn) clearBtn.style.display = 'inline-flex';
  if (hint) hint.textContent = 'Seleccionado';
  if (dropdown) dropdown.style.display = 'none';
  cargarReportes();
}

function limpiarFiltroTratamientoUI() {
  const input = document.getElementById('prodFiltroTratamiento');
  const hiddenCodigo = document.getElementById('prodFiltroTratamientoCodigo');
  const chip = document.getElementById('prodDiagSelectedChip');
  const clearBtn = document.getElementById('prodTratamientoClearBtn');
  const hint = document.getElementById('prodDiagHint');
  const dropdown = document.getElementById('prodDiagDropdown');
  if (input) input.value = '';
  if (hiddenCodigo) hiddenCodigo.value = '';
  if (chip) { chip.style.display = 'none'; chip.innerHTML = ''; }
  if (clearBtn) clearBtn.style.display = 'none';
  if (hint) hint.textContent = 'Buscar o seleccionar';
  if (dropdown) dropdown.style.display = 'none';
}

function limpiarFiltroTratamiento() {
  limpiarFiltroTratamientoUI();
  cargarReportes();
}

// Inicializa las listas desplegables de filtros de producción desde la API
async function inicializarFiltrosProduccion() {
  setupDiagnosticoAutocomplete();
  if (filtrosProduccionCargados) return;
  try {
    const data = await apiFetch('/atenciones/filtros-produccion');
    filtrosProduccionCargados = true;

    const anioSelect = document.getElementById('prodFiltroAnio');
    if (anioSelect && data.anios?.length) {
      const current = anioSelect.value || '2026';
      anioSelect.innerHTML = `<option value="">Todos los años</option>` +
        data.anios.map(a => `<option value="${esc(a)}" ${a === current ? 'selected' : ''}>${esc(a)}</option>`).join('');
    }

    const estSelect = document.getElementById('prodFiltroEstablecimiento');
    if (estSelect && data.establecimientos?.length) {
      estSelect.innerHTML = `<option value="">Todos los establecimientos</option>` +
        data.establecimientos.map(e => `<option value="${esc(e.id)}">${esc(e.nombre)}</option>`).join('');
    }

    const upsSelect = document.getElementById('prodFiltroUps');
    if (upsSelect && data.servicios?.length) {
      upsSelect.innerHTML = `<option value="">Todos los servicios</option>` +
        data.servicios.map(u => `<option value="${esc(u.id)}">${esc(u.descripcion)}</option>`).join('');
    }
  } catch (err) {
    console.warn('No se pudieron precargar opciones de filtros de producción:', err);
  }
}

async function aplicarFiltrosProduccion() {
  cargarReportes();
}

async function cargarReportes() {
  const metrics = document.getElementById('reporteMetricas');
  if (!metrics) return;

  const anio = gv('prodFiltroAnio');
  const mes = gv('prodFiltroMes');
  const tratamiento = gv('prodFiltroTratamientoCodigo') || gv('prodFiltroTratamiento');
  const establecimiento = gv('prodFiltroEstablecimiento');
  const ups = gv('prodFiltroUps');
  const fechaInicio = gv('reporteDesde');
  const fechaFin = gv('reporteHasta');

  if (fechaInicio && fechaFin && fechaInicio > fechaFin) {
    metrics.innerHTML = '<div class="table-empty">La fecha de inicio no puede ser posterior a la fecha de fin.</div>';
    return;
  }

  const params = new URLSearchParams();
  if (anio) params.set('anio', anio);
  if (mes) params.set('mes', mes);
  if (tratamiento) params.set('codigoItem', tratamiento);
  if (establecimiento) params.set('idEstablecimiento', establecimiento);
  if (ups) params.set('idUps', ups);
  if (fechaInicio) params.set('fechaInicio', fechaInicio);
  if (fechaFin) params.set('fechaFin', fechaFin);

  actualizarBarraFiltrosActivos({ anio, mes, tratamiento, establecimiento, ups, fechaInicio, fechaFin });
  if (typeof cerrarApartadoCitasDia === 'function') cerrarApartadoCitasDia();

  const cacheKey = params.toString();
  const cachedEntry = window._reportClientCache?.get(cacheKey);

  const diagTbody = document.querySelector('#reporteDiagnosticosTabla tbody');
  const persTbody = document.querySelector('#reportePersonalTabla tbody');
  const mesesEl = document.getElementById('reporteMeses');
  const estabEl = document.getElementById('reporteEstablecimientos');
  const donutEl = document.getElementById('reporteDonutEstablecimientos');
  const lollipopEl = document.getElementById('reporteLollipopTratamientos');
  const matrizTable = document.getElementById('reporteMatrizEstablecimientos');

  if (cachedEntry && (Date.now() - cachedEntry.time < 90000)) {
    // Usar caché de cliente inmediata sin parpadeo de carga
  } else {
    metrics.innerHTML = '<div class="table-empty"><span class="spinner-sm"></span> Calculando producción asistencial...</div>';
    if (diagTbody) diagTbody.innerHTML = '<tr><td colspan="7" class="table-empty"><span class="spinner-sm"></span> Consultando datos de producción...</td></tr>';
    if (persTbody) persTbody.innerHTML = '<tr><td colspan="8" class="table-empty"><span class="spinner-sm"></span> Consultando actividad de profesionales...</td></tr>';
    if (mesesEl) mesesEl.innerHTML = '<div class="table-empty"><span class="spinner-sm"></span> Calculando tendencia...</div>';
    if (estabEl) estabEl.innerHTML = '<div class="table-empty"><span class="spinner-sm"></span> Calculando establecimientos...</div>';
    if (donutEl) donutEl.innerHTML = '<div class="table-empty"><span class="spinner-sm"></span> Calculando distribución...</div>';
    if (lollipopEl) lollipopEl.innerHTML = '<div class="table-empty"><span class="spinner-sm"></span> Consultando tratamientos...</div>';
    if (matrizTable) {
      const tb = matrizTable.querySelector('tbody');
      if (tb) tb.innerHTML = '<tr><td colspan="5" class="table-empty"><span class="spinner-sm"></span> Calculando matriz...</td></tr>';
    }
  }

  try {
    let data;
    if (cachedEntry && (Date.now() - cachedEntry.time < 90000)) {
      data = cachedEntry.data;
    } else {
      data = await apiFetch(`/atenciones/reportes?${params}`);
      if (!window._reportClientCache) window._reportClientCache = new Map();
      window._reportClientCache.set(cacheKey, { data, time: Date.now() });
    }
    reporteData = { data, filtros: { anio, mes, tratamiento, establecimiento, ups } };
    const summary = data.resumen || {};
    const totalRegistros = summary.totalRegistros ?? summary.registros ?? 0;
    const totalCitas = summary.citasAtendidas ?? summary.atenciones ?? 0;
    const esDiario = Boolean(data.filtrosAplicados?.esDiario);

    const anioNum = parseInt(anio, 10) || (data.porMes?.[0] ? parseInt(data.porMes[0].periodo.slice(0, 4), 10) : new Date().getFullYear());
    const mesNum = parseInt(mes, 10) || (data.porMes?.[0] ? parseInt(data.porMes[0].periodo.slice(5, 7), 10) : new Date().getMonth() + 1);
    const totalDiasEnMes = new Date(anioNum, mesNum, 0).getDate();
    const mesesNombres = {
      1: 'Enero', 2: 'Febrero', 3: 'Marzo', 4: 'Abril', 5: 'Mayo', 6: 'Junio',
      7: 'Julio', 8: 'Agosto', 9: 'Septiembre', 10: 'Octubre', 11: 'Noviembre', 12: 'Diciembre'
    };
    const nombreMes = mesesNombres[mesNum] || `Mes ${mesNum}`;

    const tendenciaTitle = document.getElementById('reporteTendenciaTitle');
    const tendenciaSub = document.getElementById('reporteTendenciaSub');
    if (tendenciaTitle) {
      tendenciaTitle.textContent = esDiario
        ? `Evolución diaria de citas — ${nombreMes} ${anioNum} (${totalDiasEnMes} días)`
        : `Evolución mensual de citas atendidas ${anio ? `(${anio})` : ''}`;
    }
    if (tendenciaSub) {
      tendenciaSub.textContent = esDiario
        ? `Citas atendidas por cada día del mes (del 1 al ${totalDiasEnMes} de ${nombreMes.toLowerCase()})`
        : 'Haga clic en una barra para ver el desglose diario de ese mes';
    }

    const bTrat = document.getElementById('prodBadgeTratamientos');
    if (bTrat) bTrat.textContent = (data.diagnosticos || []).length;
    const bPers = document.getElementById('prodBadgePersonal');
    if (bPers) bPers.textContent = (data.personal || []).length;
    const btnVolver = document.getElementById('btnVolverMensualWrap');
    if (btnVolver) {
      btnVolver.style.display = esDiario ? 'block' : 'none';
      const btnTxt = btnVolver.querySelector('button');
      if (btnTxt) btnTxt.textContent = `← Ver año completo (${anioNum})`;
    }

    const estabCount = summary.establecimientosActivos || (data.establecimientos || []).length;
    const codigosCount = summary.codigosRegistrados || (data.diagnosticos || []).length;

    metrics.innerHTML = `
      <div class="prod-kpi-card">
        <div class="prod-kpi-top">
          <div class="prod-kpi-icon-wrap icon-purple">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </div>
          <div class="prod-kpi-title">Citas Atendidas</div>
        </div>
        <div class="prod-kpi-num">${esc(formatNumber(totalCitas))}</div>
        <div class="prod-kpi-pill-foot foot-purple">Atenciones registradas</div>
      </div>

      <div class="prod-kpi-card">
        <div class="prod-kpi-top">
          <div class="prod-kpi-icon-wrap icon-blue">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          </div>
          <div class="prod-kpi-title">Registros HIS</div>
        </div>
        <div class="prod-kpi-num">${esc(formatNumber(totalRegistros))}</div>
        <div class="prod-kpi-pill-foot foot-blue">Prestaciones clínicas</div>
      </div>

      <div class="prod-kpi-card">
        <div class="prod-kpi-top">
          <div class="prod-kpi-icon-wrap icon-magenta">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </div>
          <div class="prod-kpi-title">Pacientes Atendidos</div>
        </div>
        <div class="prod-kpi-num">${esc(formatNumber(summary.pacientesAtendidos || 0))}</div>
        <div class="prod-kpi-pill-foot foot-magenta">Pacientes únicos (DNI)</div>
      </div>

      <div class="prod-kpi-card">
        <div class="prod-kpi-top">
          <div class="prod-kpi-icon-wrap icon-teal">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </div>
          <div class="prod-kpi-title">Personal de Salud</div>
        </div>
        <div class="prod-kpi-num">${esc(formatNumber(summary.personalActivo || 0))}</div>
        <div class="prod-kpi-pill-foot foot-teal">Profesionales en actividad</div>
      </div>

      <div class="prod-kpi-card">
        <div class="prod-kpi-top">
          <div class="prod-kpi-icon-wrap icon-purple">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          </div>
          <div class="prod-kpi-title">Establecimientos</div>
        </div>
        <div class="prod-kpi-num">${esc(formatNumber(estabCount))}</div>
        <div class="prod-kpi-pill-foot foot-purple">Red hospitalaria</div>
      </div>

      <div class="prod-kpi-card">
        <div class="prod-kpi-top">
          <div class="prod-kpi-icon-wrap icon-blue">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
          </div>
          <div class="prod-kpi-title">Códigos Únicos</div>
        </div>
        <div class="prod-kpi-num">${esc(formatNumber(codigosCount))}</div>
        <div class="prod-kpi-pill-foot foot-blue">CPMS y CIE-10</div>
      </div>
    `;

    const updatedEl = document.getElementById('prodLastUpdated');
    if (updatedEl) {
      const now = new Date();
      updatedEl.textContent = now.toLocaleDateString('es-PE', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
      });
    }

    const indPeriodo = document.getElementById('prodIndPeriodo');
    if (indPeriodo) {
      const mesesNom = {
        '1': 'Enero', '2': 'Febrero', '3': 'Marzo', '4': 'Abril', '5': 'Mayo', '6': 'Junio',
        '7': 'Julio', '8': 'Agosto', '9': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre'
      };
      indPeriodo.textContent = anio ? (mes ? `${mesesNom[mes] || mes} ${anio}` : `Año ${anio}`) : 'Todos';
    }

    renderDonutEstablecimientos('reporteDonutEstablecimientos', data.establecimientos || [], totalCitas);
    renderLollipopTratamientos('reporteLollipopTratamientos', data.diagnosticos || []);
    renderBarrasVerticalesMeses('reporteMeses', data.porMes || [], 'periodo', 'atenciones', esDiario, anioNum, mesNum);

    reporteDiagnosticosRows = [...(data.diagnosticos || [])];
    reportePersonalRows = [...(data.personal || [])];
    reporteEstablecimientosRows = [...(data.establecimientos || [])];
    totalCitasReporteActual = totalCitas;

    aplicarOrdenEstablecimientosYRender();
    renderBarrasProduccionClickable('reporteEstablecimientos', data.establecimientos || [], 'nombre', 'atenciones', false, 'estab');
    aplicarOrdenDiagnosticosYRender();
    aplicarOrdenPersonalYRender();
  } catch (error) {
    const msg = esc(error.message || 'No se pudo consultar la producción.');
    const retryBtn = `<div style="margin-top:10px;"><button type="button" class="prod-btn-primary" onclick="cargarReportes()" style="display:inline-flex; width:auto; padding:6px 16px; font-size:12px;">Reintentar consulta</button></div>`;
    metrics.innerHTML = `<div class="table-empty">${msg}${retryBtn}</div>`;
    if (diagTbody) diagTbody.innerHTML = `<tr><td colspan="7" class="table-empty">${msg}</td></tr>`;
    if (persTbody) persTbody.innerHTML = `<tr><td colspan="8" class="table-empty">${msg}</td></tr>`;
    if (mesesEl) mesesEl.innerHTML = `<div class="table-empty">${msg}</div>`;
    if (estabEl) estabEl.innerHTML = `<div class="table-empty">${msg}</div>`;
    if (donutEl) donutEl.innerHTML = `<div class="table-empty">${msg}</div>`;
    if (lollipopEl) lollipopEl.innerHTML = `<div class="table-empty">${msg}</div>`;
    if (matrizTable) {
      const tb = matrizTable.querySelector('tbody');
      if (tb) tb.innerHTML = `<tr><td colspan="5" class="table-empty">${msg}</td></tr>`;
    }
  }
}

function renderBarrasProduccionClickable(targetId, items, labelKey, valueKey, esDiario = false, clickType = 'periodo') {
  const container = document.getElementById(targetId);
  if (!container) return;
  if (!items || !items.length) {
    container.innerHTML = '<div class="table-empty">No hay datos suficientes para graficar.</div>';
    return;
  }

  const max = Math.max(...items.map(i => Number(i[valueKey]) || 0), 1);
  const mesesNombres = {
    '01': 'Enero', '02': 'Febrero', '03': 'Marzo', '04': 'Abril', '05': 'Mayo', '06': 'Junio',
    '07': 'Julio', '08': 'Agosto', '09': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre'
  };

  container.innerHTML = items.map(item => {
    const val = Number(item[valueKey]) || 0;
    const rawLabel = String(item[labelKey] || '');
    let displayLabel = rawLabel;

    if (!esDiario && /^\d{4}-\d{2}$/.test(rawLabel)) {
      const parts = rawLabel.split('-');
      displayLabel = `${mesesNombres[parts[1]] || parts[1]} ${parts[0]}`;
    }

    const pct = Math.round((val / max) * 100);
    const clickAttr = clickType === 'estab' && item.id
      ? `onclick="aplicarFiltroRapidoProd('estab', '${esc(item.id)}')"`
      : (!esDiario && rawLabel.includes('-') ? `onclick="filtrarPorMesGrafico('${esc(rawLabel)}')"` : '');

    return `
      <div class="insight-item" ${clickAttr} style="cursor:pointer;" title="Clic para filtrar por ${esc(displayLabel)}">
        <div class="insight-label-wrap">
          <span class="insight-label">${esc(displayLabel)}</span>
          <span class="insight-value">${formatNumber(val)} citas</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${pct}%;"></div>
        </div>
      </div>`;
  }).join('');
}

function filtrarPorMesGrafico(periodoStr) {
  if (!periodoStr || !periodoStr.includes('-')) return;
  const parts = periodoStr.split('-');
  const anio = parts[0];
  const mesNum = String(parseInt(parts[1], 10));

  const anioSelect = document.getElementById('prodFiltroAnio');
  if (anioSelect) anioSelect.value = anio;
  const mesSelect = document.getElementById('prodFiltroMes');
  if (mesSelect) mesSelect.value = mesNum;

  toast(`Filtrando producción por el mes ${periodoStr}`, 'info');
  cargarReportes();
}

function renderDonutEstablecimientos(containerId, establecimientos, totalCitas) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!establecimientos || !establecimientos.length) {
    container.innerHTML = '<div class="table-empty">Sin datos de establecimientos para graficar.</div>';
    return;
  }

  const colors = ['#6b2470', '#b25aa0', '#3b82f6', '#f59e0b', '#10b981', '#64748b'];
  const top = establecimientos.slice(0, 5);
  const total = totalCitas || top.reduce((acc, curr) => acc + (Number(curr.atenciones) || 0), 0) || 1;

  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  const circles = top.map((item, idx) => {
    const val = Number(item.atenciones) || 0;
    const pct = val / total;
    const dashLength = pct * circumference;
    const currentOffset = offset;
    offset += dashLength;
    const color = colors[idx % colors.length];

    return `<circle cx="50" cy="50" r="${radius}" fill="transparent" stroke="${color}" stroke-width="15" stroke-dasharray="${dashLength.toFixed(2)} ${(circumference - dashLength).toFixed(2)}" stroke-dashoffset="${(-currentOffset).toFixed(2)}" style="cursor:pointer; transition:stroke-width 0.2s;" onmouseenter="this.setAttribute('stroke-width', '18')" onmouseleave="this.setAttribute('stroke-width', '15')" onclick="aplicarFiltroRapidoProd('estab', '${esc(item.id)}')"><title>${esc(item.nombre)}: ${formatNumber(val)} citas (${Math.round(pct * 100)}%)</title></circle>`;
  }).join('');

  const legend = top.map((item, idx) => {
    const val = Number(item.atenciones) || 0;
    const pct = Math.round((val / total) * 100);
    const color = colors[idx % colors.length];
    return `
      <div class="prod-donut-legend-item" onclick="aplicarFiltroRapidoProd('estab', '${esc(item.id)}')" title="Clic para filtrar por ${esc(item.nombre)}">
        <span class="donut-legend-dot" style="background:${color};"></span>
        <span class="donut-legend-name">${esc(item.nombre)}</span>
        <span class="donut-legend-pct">${pct}%</span>
      </div>`;
  }).join('');

  container.innerHTML = `
    <div class="prod-donut-wrapper">
      <div class="prod-donut-svg-box">
        <svg viewBox="0 0 100 100">
          ${circles}
        </svg>
        <div class="prod-donut-center-text">
          <div class="donut-center-num">${formatNumber(total)}</div>
          <div class="donut-center-label">Citas</div>
        </div>
      </div>
      <div class="prod-donut-legend">
        ${legend}
      </div>
    </div>`;
}

function renderLollipopTratamientos(containerId, diagnosticos) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!diagnosticos || !diagnosticos.length) {
    container.innerHTML = '<div class="table-empty">Sin tratamientos registrados para este filtro.</div>';
    return;
  }

  const top = diagnosticos.slice(0, 6);
  const maxVal = Math.max(...top.map(d => Number(d.atenciones) || 0), 1);

  container.innerHTML = top.map((item) => {
    const val = Number(item.atenciones) || 0;
    const pct = Math.max(8, Math.round((val / maxVal) * 82));
    const label = item.descripcion ? (item.descripcion.length > 24 ? item.descripcion.substring(0, 22) + '...' : item.descripcion) : item.codigo;

    return `
      <div class="lollipop-item" onclick="aplicarFiltroRapidoProd('codigo', '${esc(item.codigo)}')" title="${esc(item.codigo)} - ${esc(item.descripcion)}: ${formatNumber(val)} citas (Clic para filtrar)">
        <span class="lollipop-name">${esc(label)}</span>
        <div class="lollipop-track-wrap">
          <div class="lollipop-bar" style="width:${pct}%;"></div>
          <div class="lollipop-head"></div>
        </div>
        <span class="lollipop-val">${formatNumber(val)}</span>
      </div>`;
  }).join('');
}

function renderBarrasVerticalesMeses(containerId, items, labelKey, valueKey, esDiario = false, anioNum = null, mesNum = null) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.classList.toggle('is-daily', Boolean(esDiario));

  const mesesCortos = {
    '01': 'Ene', '02': 'Feb', '03': 'Mar', '04': 'Abr', '05': 'May', '06': 'Jun',
    '07': 'Jul', '08': 'Ago', '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dic'
  };

  const mesesNombres = {
    1: 'Enero', 2: 'Febrero', 3: 'Marzo', 4: 'Abril', 5: 'Mayo', 6: 'Junio',
    7: 'Julio', 8: 'Agosto', 9: 'Septiembre', 10: 'Octubre', 11: 'Noviembre', 12: 'Diciembre'
  };

  if (esDiario) {
    // ═════════════════════════════════════════════════════════
    // MODO DIARIO: Exactamente los días del mes (28, 29, 30 o 31)
    // ═════════════════════════════════════════════════════════
    const currentYear = anioNum || (items?.[0] ? parseInt(String(items[0][labelKey]).slice(0, 4), 10) : new Date().getFullYear());
    const currentMonth = mesNum || (items?.[0] ? parseInt(String(items[0][labelKey]).slice(5, 7), 10) : new Date().getMonth() + 1);

    // Días exactos del mes (considera años bisiestos en febrero: 28 o 29)
    const totalDiasEnMes = new Date(currentYear, currentMonth, 0).getDate();
    const nombreMes = mesesNombres[currentMonth] || `Mes ${currentMonth}`;

    // Mapear los datos de la consulta SQL por número de día
    const mapPorDia = new Map();
    (items || []).forEach(item => {
      const raw = String(item[labelKey] || '');
      let dia = null;
      if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
        dia = parseInt(raw.split('-')[2], 10);
      } else if (/^\d{1,2}$/.test(raw)) {
        dia = parseInt(raw, 10);
      }
      if (dia !== null && !isNaN(dia)) {
        mapPorDia.set(dia, {
          val: Number(item[valueKey]) || 0,
          rawPeriodo: raw
        });
      }
    });

    // Calcular el valor máximo para la escala del gráfico
    const todosLosValores = [];
    for (let d = 1; d <= totalDiasEnMes; d++) {
      todosLosValores.push(mapPorDia.get(d)?.val || 0);
    }
    const maxVal = Math.max(...todosLosValores, 1);

    const barrasHtml = [];
    for (let dia = 1; dia <= totalDiasEnMes; dia++) {
      const diaPad = String(dia).padStart(2, '0');
      const mesPad = String(currentMonth).padStart(2, '0');
      const fechaIso = `${currentYear}-${mesPad}-${diaPad}`;
      const entry = mapPorDia.get(dia);
      const val = entry ? entry.val : 0;
      const isZero = val === 0;
      const isPeak = val > 0 && val === maxVal;

      // Porcentaje de altura visual: 3% si es cero, hasta 85% para el pico
      const heightPct = isZero ? 3 : Math.max(10, Math.round((val / maxVal) * 85));

      // Número compacto para evitar que se amontone en 31 días
      let compactVal = '';
      if (val >= 1000) {
        compactVal = (val / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
      } else if (val > 0) {
        compactVal = String(val);
      }

      const tooltip = isZero
        ? `Día ${diaPad} de ${nombreMes} (${fechaIso}): Sin atenciones registradas`
        : `Día ${diaPad} de ${nombreMes} (${fechaIso}): ${formatNumber(val)} citas atendidas${isPeak ? ' ★ Día con mayor demanda del mes' : ''}. Clic para ver atenciones.`;

      barrasHtml.push(`
        <div class="vbar-col ${isPeak ? 'is-peak' : ''} ${isZero ? 'is-zero' : ''}"
             onclick="verDetalleDiaProd('${fechaIso}', ${val})"
             title="${esc(tooltip)}">
          <span class="vbar-val">${compactVal}</span>
          <div class="vbar-body ${isPeak ? 'active-bar' : ''}" style="height:${heightPct}%;"></div>
          <span class="vbar-label">${diaPad}</span>
        </div>
      `);
    }

    container.innerHTML = barrasHtml.join('');
    return;
  }

  // ═════════════════════════════════════════════════════════
  // MODO ANUAL: Los 12 meses cronológicos de Enero a Diciembre
  // ═════════════════════════════════════════════════════════
  const targetYear = anioNum || (items?.[0] ? parseInt(String(items[0][labelKey]).slice(0, 4), 10) : new Date().getFullYear());
  const mapPorMes = new Map();

  (items || []).forEach(item => {
    const raw = String(item[labelKey] || '');
    let m = null;
    if (/^\d{4}-\d{2}/.test(raw)) {
      m = raw.split('-')[1];
    } else if (/^\d{1,2}$/.test(raw)) {
      m = raw.padStart(2, '0');
    }
    if (m) {
      mapPorMes.set(m, {
        val: Number(item[valueKey]) || 0,
        rawPeriodo: raw.includes('-') ? raw : `${targetYear}-${m}`
      });
    }
  });

  const mesesKeys = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  const maxVal = Math.max(...Array.from(mapPorMes.values()).map(x => x.val), 1);

  container.innerHTML = mesesKeys.map(m => {
    const entry = mapPorMes.get(m);
    const val = entry ? entry.val : 0;
    const rawPeriodo = entry ? entry.rawPeriodo : `${targetYear}-${m}`;
    const heightPct = val === 0 ? 3 : Math.max(12, Math.round((val / maxVal) * 82));
    const isPeak = val > 0 && val === maxVal;
    const isZero = val === 0;
    const nombreMes = mesesNombres[parseInt(m, 10)];

    return `
      <div class="vbar-col ${isPeak ? 'is-peak' : ''} ${isZero ? 'is-zero' : ''}"
           onclick="filtrarPorMesGrafico('${esc(rawPeriodo)}')"
           title="${nombreMes} ${targetYear}: ${formatNumber(val)} citas atendidas${isPeak ? ' ★ Mes con mayor producción' : ''} (Clic para ver desglose por días)">
        <span class="vbar-val">${val > 0 ? formatNumber(val) : ''}</span>
        <div class="vbar-body ${isPeak ? 'active-bar' : ''}" style="height:${heightPct}%;"></div>
        <span class="vbar-label">${mesesCortos[m]}</span>
      </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════════════════
// APARTADO NOMINAL DE CITAS DEL DÍA SELECCIONADO
// ═══════════════════════════════════════════════════════════════════════════

let estadoDiaDetalle = {
  fechaIso: null,
  data: null,
  citasOriginales: [],
  citasFiltradas: [],
  pagina: 1,
  pageSize: 25,
  modoVista: 'cards',
  filtroTexto: '',
  filtroServicio: '',
  filtroTipoDx: '',
  cargando: false
};

function marcarBarraDiaSeleccionada(fechaIso) {
  const container = document.getElementById('reporteMeses');
  if (!container) return;
  const cols = container.querySelectorAll('.vbar-col');
  cols.forEach(col => {
    col.classList.remove('is-selected');
    const onclickStr = col.getAttribute('onclick') || '';
    if (onclickStr.includes(fechaIso)) {
      col.classList.add('is-selected');
    }
  });
}

function verDetalleDiaProd(fechaIso, val) {
  if (!fechaIso) return;
  const partes = fechaIso.split('-');
  const diaFmt = `${partes[2]}/${partes[1]}/${partes[0]}`;
  if (!val || val === 0) {
    if (typeof toast === 'function') {
      toast(`El día ${diaFmt} no registra citas asistenciales.`, 'info');
    }
    return;
  }

  // 1. Resaltar visualmente la barra en el gráfico
  marcarBarraDiaSeleccionada(fechaIso);

  // 2. Abrir y cargar el apartado de citas de ese día
  abrirApartadoCitasDia(fechaIso);
}
window.verDetalleDiaProd = verDetalleDiaProd;

async function abrirApartadoCitasDia(fechaIso) {
  const sec = document.getElementById('apartadoCitasDia');
  if (!sec) return;

  sec.style.display = 'block';

  // Desplazamiento suave al apartado
  setTimeout(() => {
    sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 50);

  const partes = fechaIso.split('-');
  const anio = parseInt(partes[0], 10);
  const mes = parseInt(partes[1], 10);
  const dia = parseInt(partes[2], 10);
  const fechaObj = new Date(anio, mes - 1, dia);

  const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const mesesNombres = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const nombreDiaSemana = diasSemana[fechaObj.getDay()];
  const nombreMes = mesesNombres[mes - 1];

  const fechaFmtLarga = `${nombreDiaSemana}, ${dia} de ${nombreMes} de ${anio}`;
  const fechaFmtCorta = `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${anio}`;

  const badgeFecha = document.getElementById('diaDetalleFechaBadge');
  if (badgeFecha) badgeFecha.textContent = fechaFmtLarga;

  const countBadge = document.getElementById('diaDetalleCountBadge');
  if (countBadge) countBadge.textContent = 'Consultando...';

  const titleEl = document.getElementById('diaDetalleTitle');
  if (titleEl) titleEl.textContent = `Citas Médicas del Día — ${fechaFmtLarga}`;

  const subEl = document.getElementById('diaDetalleSub');
  if (subEl) subEl.textContent = `Desglose nominal de cada cita atendida el ${fechaFmtCorta}. Puede buscar pacientes, médicos, diagnósticos o filtrar por servicio.`;

  const kpisEl = document.getElementById('diaDetalleKpis');
  if (kpisEl) {
    kpisEl.innerHTML = `<div class="table-empty"><span class="spinner-sm"></span> Obteniendo métricas del día...</div>`;
  }

  const contentEl = document.getElementById('diaCitasContent');
  if (contentEl) {
    contentEl.innerHTML = `<div class="table-empty"><span class="spinner-sm"></span> Cargando citas médicas atendidas el ${fechaFmtLarga}...</div>`;
  }

  const summaryEl = document.getElementById('diaResultSummary');
  if (summaryEl) summaryEl.textContent = 'Cargando información asistencial...';

  // Limpiar inputs de filtro del día
  const searchInput = document.getElementById('diaSearchInput');
  if (searchInput) searchInput.value = '';
  const searchClear = document.getElementById('diaSearchClear');
  if (searchClear) searchClear.style.display = 'none';

  const filtroTipoDx = document.getElementById('diaFiltroTipoDx');
  if (filtroTipoDx) filtroTipoDx.value = '';

  estadoDiaDetalle.fechaIso = fechaIso;
  estadoDiaDetalle.pagina = 1;
  estadoDiaDetalle.filtroTexto = '';
  estadoDiaDetalle.filtroServicio = '';
  estadoDiaDetalle.filtroTipoDx = '';
  estadoDiaDetalle.cargando = true;

  try {
    const params = new URLSearchParams({ fecha: fechaIso });

    const estabVal = (document.getElementById('prodFiltroEstablecimiento')?.value || '').trim();
    if (estabVal) params.set('idEstablecimiento', estabVal);

    const upsVal = (document.getElementById('prodFiltroUps')?.value || '').trim();
    if (upsVal) params.set('idUps', upsVal);

    const diagVal = (document.getElementById('prodFiltroTratamientoCodigo')?.value || '').trim();
    if (diagVal) params.set('codigoItem', diagVal);

    const res = await apiFetch(`/atenciones/citas-dia?${params.toString()}`);
    estadoDiaDetalle.data = res;
    estadoDiaDetalle.citasOriginales = res.citas || [];
    estadoDiaDetalle.citasFiltradas = [...(res.citas || [])];
    estadoDiaDetalle.cargando = false;

    if (countBadge) countBadge.textContent = `${formatNumber(res.totalCitas || 0)} citas`;

    // Renderizar KPIs del día
    renderKpisDiaDetalle(res);

    // Llenar selector de servicios
    const servicioSel = document.getElementById('diaFiltroServicio');
    if (servicioSel) {
      let optHtml = '<option value="">Todos los servicios (UPS)</option>';
      (res.servicios || []).forEach(s => {
        optHtml += `<option value="${esc(s.id)}">${esc(s.nombre)}</option>`;
      });
      servicioSel.innerHTML = optHtml;
      servicioSel.value = '';
    }

    // Renderizar listado de citas
    filtrarCitasDiaLocal();

  } catch (err) {
    estadoDiaDetalle.cargando = false;
    if (countBadge) countBadge.textContent = 'Error';
    if (contentEl) {
      contentEl.innerHTML = `<div class="table-empty" style="color:var(--c-danger);">
        Error al cargar citas del día: ${esc(err.message || 'Error de conexión')}
      </div>`;
    }
  }
}
window.abrirApartadoCitasDia = abrirApartadoCitasDia;

function renderKpisDiaDetalle(res) {
  const kpisEl = document.getElementById('diaDetalleKpis');
  if (!kpisEl) return;

  kpisEl.innerHTML = `
    <div class="prod-dia-kpi-card card-purple">
      <div class="dia-kpi-top">
        <span class="dia-kpi-label">Citas Atendidas</span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      </div>
      <div class="dia-kpi-value">${esc(formatNumber(res.totalCitas || 0))}</div>
      <div class="dia-kpi-foot">Consultas y visitas del día</div>
    </div>

    <div class="prod-dia-kpi-card card-magenta">
      <div class="dia-kpi-top">
        <span class="dia-kpi-label">Pacientes Únicos</span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
      </div>
      <div class="dia-kpi-value">${esc(formatNumber(res.totalPacientes || 0))}</div>
      <div class="dia-kpi-foot">Pacientes atendidos</div>
    </div>

    <div class="prod-dia-kpi-card card-teal">
      <div class="dia-kpi-top">
        <span class="dia-kpi-label">Personal de Salud</span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      </div>
      <div class="dia-kpi-value">${esc(formatNumber(res.totalPersonal || 0))}</div>
      <div class="dia-kpi-foot">Médicos y profesionales activos</div>
    </div>

    <div class="prod-dia-kpi-card card-blue">
      <div class="dia-kpi-top">
        <span class="dia-kpi-label">Registros HIS</span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      </div>
      <div class="dia-kpi-value">${esc(formatNumber(res.totalRegistros || 0))}</div>
      <div class="dia-kpi-foot">${esc(formatNumber(res.totalCodigos || 0))} códigos CIE/CPMS</div>
    </div>
  `;
}

function filtrarCitasDiaLocal() {
  const searchInput = document.getElementById('diaSearchInput');
  const searchClear = document.getElementById('diaSearchClear');
  const q = (searchInput?.value || '').toLowerCase().trim();
  if (searchClear) searchClear.style.display = q ? 'inline-block' : 'none';

  const servicioVal = (document.getElementById('diaFiltroServicio')?.value || '').trim();
  const tipoDxVal = (document.getElementById('diaFiltroTipoDx')?.value || '').toUpperCase().trim();

  estadoDiaDetalle.filtroTexto = q;
  estadoDiaDetalle.filtroServicio = servicioVal;
  estadoDiaDetalle.filtroTipoDx = tipoDxVal;
  estadoDiaDetalle.pagina = 1;

  const todas = estadoDiaDetalle.citasOriginales || [];

  estadoDiaDetalle.citasFiltradas = todas.filter(cita => {
    // Filtro por servicio
    if (servicioVal && String(cita.idUps) !== servicioVal) {
      return false;
    }

    // Filtro por tipo de diagnóstico (D, P, R)
    if (tipoDxVal) {
      const tieneTipo = (cita.items || []).some(it => (it.tipoDiagnostico || '').toUpperCase().trim() === tipoDxVal);
      if (!tieneTipo) return false;
    }

    // Filtro de búsqueda textual
    if (q) {
      const matchPac = (cita.nombrePaciente || '').toLowerCase().includes(q) ||
                       (cita.documentoPaciente || '').toLowerCase().includes(q) ||
                       (cita.historiaClinica || '').toLowerCase().includes(q) ||
                       String(cita.idCita || '').includes(q);
      const matchDoc = (cita.nombrePersonal || '').toLowerCase().includes(q) ||
                       (cita.profesion || '').toLowerCase().includes(q) ||
                       (cita.documentoPersonal || '').toLowerCase().includes(q);
      const matchServ = (cita.servicio || '').toLowerCase().includes(q) ||
                        (cita.establecimiento || '').toLowerCase().includes(q);
      const matchDx = (cita.items || []).some(it =>
        (it.codigo || '').toLowerCase().includes(q) ||
        (it.descripcion || '').toLowerCase().includes(q)
      );

      if (!matchPac && !matchDoc && !matchServ && !matchDx) {
        return false;
      }
    }

    return true;
  });

  renderCitasDiaContenido();
}
window.filtrarCitasDiaLocal = filtrarCitasDiaLocal;

function limpiarBusquedaCitasDia() {
  const searchInput = document.getElementById('diaSearchInput');
  if (searchInput) {
    searchInput.value = '';
    searchInput.focus();
  }
  filtrarCitasDiaLocal();
}
window.limpiarBusquedaCitasDia = limpiarBusquedaCitasDia;

function cambiarModoVistaDia(modo) {
  estadoDiaDetalle.modoVista = modo;
  document.getElementById('btnDiaModoCards')?.classList.toggle('active', modo === 'cards');
  document.getElementById('btnDiaModoTabla')?.classList.toggle('active', modo === 'tabla');
  renderCitasDiaContenido();
}
window.cambiarModoVistaDia = cambiarModoVistaDia;

function cambiarPageSizeDia(val) {
  estadoDiaDetalle.pageSize = val === 'all' ? 999999 : parseInt(val, 10) || 25;
  estadoDiaDetalle.pagina = 1;
  renderCitasDiaContenido();
}
window.cambiarPageSizeDia = cambiarPageSizeDia;

function irAPaginaDia(pageNum) {
  estadoDiaDetalle.pagina = pageNum;
  renderCitasDiaContenido();
  document.getElementById('diaCitasContent')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
window.irAPaginaDia = irAPaginaDia;

function renderCitasDiaContenido() {
  const contentEl = document.getElementById('diaCitasContent');
  const summaryEl = document.getElementById('diaResultSummary');
  const pagEl = document.getElementById('diaPagination');
  if (!contentEl) return;

  const total = estadoDiaDetalle.citasFiltradas.length;
  const totalOrig = estadoDiaDetalle.citasOriginales.length;
  const pageSize = estadoDiaDetalle.pageSize;
  const page = estadoDiaDetalle.pagina;

  if (total === 0) {
    if (summaryEl) summaryEl.textContent = '0 citas encontradas';
    if (pagEl) pagEl.style.display = 'none';
    contentEl.innerHTML = `
      <div class="table-empty">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="margin:0 auto 10px; opacity:0.6;"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
        <p style="font-weight:600; font-size:15px; margin-bottom:4px;">No se encontraron citas médicas</p>
        <p style="color:var(--c-muted); font-size:13px;">Pruebe ajustando el texto de búsqueda o los filtros de servicio y diagnóstico.</p>
      </div>
    `;
    return;
  }

  const totalPages = Math.ceil(total / pageSize);
  const startIdx = (page - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, total);
  const citasPagina = estadoDiaDetalle.citasFiltradas.slice(startIdx, endIdx);

  if (summaryEl) {
    summaryEl.textContent = totalOrig === total
      ? `Mostrando citas ${formatNumber(startIdx + 1)} - ${formatNumber(endIdx)} de ${formatNumber(total)} citas médicas atendidas`
      : `Mostrando ${formatNumber(startIdx + 1)} - ${formatNumber(endIdx)} de ${formatNumber(total)} citas filtradas (de un total de ${formatNumber(totalOrig)})`;
  }

  if (estadoDiaDetalle.modoVista === 'tabla') {
    contentEl.innerHTML = renderTablaCitasDia(citasPagina);
  } else {
    contentEl.innerHTML = renderCardsCitasDia(citasPagina);
  }

  renderPaginacionDia(totalPages, page);
}

function renderCardsCitasDia(citas) {
  return `
    <div class="citas-grid">
      ${citas.map(cita => {
        const fullName = cita.nombrePaciente || 'Sin nombre registrado';
        const docPac = cita.documentoPaciente || cita.idPaciente || '-';
        const docMed = cita.documentoPersonal || '-';
        const turnoDesc = cita.turno === 'M' ? 'Mañana' : cita.turno === 'T' ? 'Tarde' : cita.turno === 'N' ? 'Noche' : (cita.turno || 'Sin turno');
        const edadLabel = cita.edad !== null && cita.edad !== undefined ? `${cita.edad} ${cita.tipoEdad === 'M' ? 'meses' : cita.tipoEdad === 'D' ? 'días' : 'años'}` : '-';
        const generoLabel = cita.genero === 'M' ? 'Masculino' : cita.genero === 'F' ? 'Femenino' : (cita.genero || '');

        return `
          <div class="cita-card">
            <div class="cita-card-header">
              <div class="cita-header-left">
                ${cita.idCita ? `<span class="cita-id-pill">Cita #${esc(cita.idCita)}</span>` : ''}
                <span class="cita-date-badge">${esc(cita.fecha)}</span>
                <span class="badge badge-turn" title="Turno de atención">Turno ${esc(turnoDesc)}</span>
                <span class="badge badge-neutral">${cita.items.length} prestación${cita.items.length !== 1 ? 'es' : ''}</span>
              </div>
              <div class="actions">
                <button type="button" class="btn btn-primary btn-xs" onclick="abrirFichaPacienteDesdeResultados('${escJs(cita.idPaciente || cita.documentoPaciente)}', '${escJs(fullName)}', event)" title="Ver Historia Clínica del Paciente">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
                  Historia Clínica
                </button>
              </div>
            </div>

            <div class="cita-card-body">
              <div class="cita-info-row">
                <div class="cita-info-item">
                  <strong>Paciente:</strong>
                  <button type="button" class="btn-cell-link patient-cell-btn" onclick="abrirFichaPacienteDesdeResultados('${escJs(cita.idPaciente || cita.documentoPaciente)}', '${escJs(fullName)}', event)" title="Ver ficha del paciente">
                    ${esc(fullName)} (DNI: ${esc(docPac)})${cita.historiaClinica ? ` · HC: ${esc(cita.historiaClinica)}` : ''} ↗
                  </button>
                  <span class="cita-patient-meta">(${esc(edadLabel)}${generoLabel ? ` · ${esc(generoLabel)}` : ''})</span>
                </div>

                <div class="cita-info-item">
                  <strong>Médico / Profesional:</strong>
                  <button type="button" class="btn-cell-link personal-cell-btn" onclick="abrirPersonalDesdeResultados('${escJs(cita.nombrePersonal)}', event)" title="Ver ficha y producción del profesional">
                    ${esc(cita.nombrePersonal || 'No registrado')} ↗
                  </button>
                  <span class="cita-medico-prof">(${esc(cita.profesion || 'Personal de salud')}${docMed !== '-' ? ` · DNI ${esc(docMed)}` : ''})</span>
                </div>

                <div class="cita-info-item">
                  <strong>Servicio (UPS):</strong>
                  <span class="service-chip">${esc(cita.servicio || '-')}</span>
                </div>

                <div class="cita-info-item">
                  <strong>Establecimiento:</strong>
                  <span>${esc(cita.establecimiento || 'Hospital Regional de Ayacucho')}</span>
                </div>

                ${cita.financiador ? `
                  <div class="cita-info-item">
                    <strong>Financiador:</strong>
                    <span class="fin-chip">${esc(cita.financiador)}</span>
                  </div>
                ` : ''}
              </div>

              <div class="cita-dx-section">
                <div class="cita-dx-title">Diagnósticos y Procedimientos atendidos en esta cita:</div>
                <div class="cita-dx-chips">
                  ${cita.items.map(it => {
                    const td = (it.tipoDiagnostico || '').toUpperCase().trim();
                    const tipoLabel = td === 'D' ? 'Definitivo' : td === 'P' ? 'Presuntivo' : td === 'R' ? 'Repetido' : (td || '-');
                    const tipoClass = td === 'D' ? 'badge-definitivo' : td === 'P' ? 'badge-presuntivo' : td === 'R' ? 'badge-repetido' : 'badge-neutral';
                    return `
                      <div class="cita-dx-item" title="Haga clic en el código para ver estadísticas hospitalarias">
                        <span class="dx-tipo-tag ${tipoClass}">${esc(tipoLabel)}</span>
                        <span class="code-badge font-bold" style="cursor:pointer;" onclick="abrirModalActividadCodigo('${escJs(it.codigo)}', '${escJs(it.descripcion || '')}', event)">
                          ${esc(it.codigo || '-')} ↗
                        </span>
                        <span class="cita-dx-desc">${esc(it.descripcion || '-')}</span>
                        ${it.valorLab ? `<span class="lab-pill">Lab: ${esc(it.valorLab)}</span>` : ''}
                      </div>
                    `;
                  }).join('')}
                </div>
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderTablaCitasDia(citas) {
  return `
    <div class="table-wrap">
      <table class="prod-clean-table sortable-table">
        <thead>
          <tr>
            <th style="min-width: 90px;">Cita / Turno</th>
            <th style="min-width: 220px;">Paciente</th>
            <th style="min-width: 200px;">Profesional de Salud</th>
            <th style="min-width: 150px;">Servicio (UPS)</th>
            <th style="min-width: 260px;">Diagnósticos / Procedimientos</th>
            <th style="min-width: 110px; text-align: right;">Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${citas.map(cita => {
            const fullName = cita.nombrePaciente || 'Sin nombre registrado';
            const docPac = cita.documentoPaciente || cita.idPaciente || '-';
            const turnoDesc = cita.turno === 'M' ? 'Mañana' : cita.turno === 'T' ? 'Tarde' : cita.turno === 'N' ? 'Noche' : (cita.turno || '-');
            const edadLabel = cita.edad !== null && cita.edad !== undefined ? `${cita.edad} ${cita.tipoEdad === 'M' ? 'm' : 'a'}` : '';

            return `
              <tr>
                <td>
                  <strong>#${esc(cita.idCita || '-')}</strong>
                  <div class="table-sub-text">Turno ${esc(turnoDesc)}</div>
                </td>
                <td>
                  <button type="button" class="btn-cell-link patient-cell-btn" onclick="abrirFichaPacienteDesdeResultados('${escJs(cita.idPaciente || cita.documentoPaciente)}', '${escJs(fullName)}', event)">
                    ${esc(fullName)} ↗
                  </button>
                  <div class="table-sub-text">DNI: ${esc(docPac)} ${edadLabel ? `· ${esc(edadLabel)}` : ''}</div>
                </td>
                <td>
                  <button type="button" class="btn-cell-link personal-cell-btn" onclick="abrirPersonalDesdeResultados('${escJs(cita.nombrePersonal)}', event)">
                    ${esc(cita.nombrePersonal || 'No registrado')} ↗
                  </button>
                  <div class="table-sub-text">${esc(cita.profesion || '-')}</div>
                </td>
                <td>
                  <span class="service-chip">${esc(cita.servicio || '-')}</span>
                  <div class="table-sub-text">${esc(cita.financiador || '')}</div>
                </td>
                <td>
                  <div class="table-dx-list">
                    ${cita.items.map(it => {
                      const td = (it.tipoDiagnostico || '').toUpperCase().trim();
                      const tipoLabel = td === 'D' ? 'D' : td === 'P' ? 'P' : td === 'R' ? 'R' : td;
                      const tipoClass = td === 'D' ? 'badge-definitivo' : td === 'P' ? 'badge-presuntivo' : td === 'R' ? 'badge-repetido' : 'badge-neutral';
                      return `
                        <div class="table-dx-row">
                          <span class="dx-tipo-tag ${tipoClass}" title="${td === 'D' ? 'Definitivo' : td === 'P' ? 'Presuntivo' : 'Repetido'}">${esc(tipoLabel)}</span>
                          <span class="code-badge font-bold" style="cursor:pointer;" onclick="abrirModalActividadCodigo('${escJs(it.codigo)}', '${escJs(it.descripcion || '')}', event)">
                            ${esc(it.codigo || '-')}
                          </span>
                          <span class="table-dx-desc" title="${esc(it.descripcion || '')}">${esc(it.descripcion || '-')}</span>
                          ${it.valorLab ? `<span class="lab-pill">Lab: ${esc(it.valorLab)}</span>` : ''}
                        </div>
                      `;
                    }).join('')}
                  </div>
                </td>
                <td style="text-align: right;">
                  <button type="button" class="btn btn-secondary btn-xs" onclick="abrirFichaPacienteDesdeResultados('${escJs(cita.idPaciente || cita.documentoPaciente)}', '${escJs(fullName)}', event)" title="Ver historia clínica del paciente">
                    Historia
                  </button>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderPaginacionDia(totalPages, currentPage) {
  const pagEl = document.getElementById('diaPagination');
  if (!pagEl) return;

  if (totalPages <= 1) {
    pagEl.style.display = 'none';
    return;
  }

  pagEl.style.display = 'flex';

  let html = `
    <button type="button" class="prod-pag-btn" onclick="irAPaginaDia(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''} title="Página anterior">
      ← Anterior
    </button>
  `;

  const delta = 2;
  const range = [];
  for (let i = Math.max(2, currentPage - delta); i <= Math.min(totalPages - 1, currentPage + delta); i++) {
    range.push(i);
  }

  if (currentPage - delta > 2) {
    range.unshift('...');
  }
  range.unshift(1);

  if (currentPage + delta < totalPages - 1) {
    range.push('...');
  }
  if (totalPages > 1) {
    range.push(totalPages);
  }

  range.forEach(p => {
    if (p === '...') {
      html += `<span class="prod-pag-ellipsis">...</span>`;
    } else {
      const isActive = p === currentPage;
      html += `
        <button type="button" class="prod-pag-btn ${isActive ? 'active' : ''}" onclick="irAPaginaDia(${p})">
          ${p}
        </button>
      `;
    }
  });

  html += `
    <button type="button" class="prod-pag-btn" onclick="irAPaginaDia(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''} title="Página siguiente">
      Siguiente →
    </button>
  `;

  pagEl.innerHTML = html;
}

function cerrarApartadoCitasDia() {
  const sec = document.getElementById('apartadoCitasDia');
  if (sec) sec.style.display = 'none';
  const container = document.getElementById('reporteMeses');
  if (container) {
    container.querySelectorAll('.vbar-col.is-selected').forEach(c => c.classList.remove('is-selected'));
  }
}
window.cerrarApartadoCitasDia = cerrarApartadoCitasDia;

function volverAlGraficoProd() {
  const graf = document.getElementById('reporteTendenciaTitle') || document.getElementById('reporteMeses');
  if (graf) {
    graf.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}
window.volverAlGraficoProd = volverAlGraficoProd;

async function exportarCitasDia(formato) {
  const citas = estadoDiaDetalle.citasFiltradas || [];
  const fecha = estadoDiaDetalle.fechaIso || 'dia';

  if (!citas.length) {
    if (typeof toast === 'function') toast('No hay citas en este día para exportar.', 'info');
    return;
  }

  const filas = [];
  citas.forEach(c => {
    const codigos = (c.items || []).map(i => i.codigo).filter(Boolean).join(', ');
    const descripciones = (c.items || []).map(i => `${i.codigo} (${i.tipoLabel || ''}): ${i.descripcion}`).join('; ');
    filas.push([
      c.idCita || '',
      c.fecha || fecha,
      c.turno === 'M' ? 'Mañana' : c.turno === 'T' ? 'Tarde' : c.turno === 'N' ? 'Noche' : (c.turno || ''),
      c.nombrePaciente || '',
      c.documentoPaciente || '',
      c.historiaClinica || '',
      c.edad !== null && c.edad !== undefined ? `${c.edad} ${c.tipoEdad || 'A'}` : '',
      c.genero || '',
      c.nombrePersonal || '',
      c.profesion || '',
      c.servicio || '',
      c.establecimiento || '',
      c.financiador || '',
      codigos,
      descripciones
    ]);
  });

  const columnas = [
    { titulo: 'N° Cita', tipo: 'numero' },
    { titulo: 'Fecha', tipo: 'fecha' },
    { titulo: 'Turno' },
    { titulo: 'Paciente' },
    { titulo: 'DNI / Doc' },
    { titulo: 'Historia Clínica' },
    { titulo: 'Edad' },
    { titulo: 'Género' },
    { titulo: 'Médico / Personal' },
    { titulo: 'Profesión' },
    { titulo: 'Servicio (UPS)' },
    { titulo: 'Establecimiento' },
    { titulo: 'Financiador' },
    { titulo: 'Códigos CIE/CPMS', tipo: 'codigo' },
    { titulo: 'Diagnósticos y Procedimientos' }
  ];

  const doc = {
    titulo: `Citas Médicas del Día — ${fecha}`,
    subtitulo: `Hospital Regional de Ayacucho · ${formatNumber(citas.length)} citas atendidas`,
    archivo: `citas-${fecha}`,
    datos: [
      ['Fecha', fecha],
      ['Total de citas', formatNumber(citas.length)],
      ['Establecimiento', citas[0]?.establecimiento || 'Hospital Regional de Ayacucho']
    ],
    metricas: [
      { etiqueta: 'Citas Atendidas', valor: citas.length },
      { etiqueta: 'Pacientes Únicos', valor: new Set(citas.map(c => c.idPaciente).filter(Boolean)).size },
      { etiqueta: 'Personal de Salud', valor: new Set(citas.map(c => c.idPersonal).filter(Boolean)).size }
    ],
    secciones: [
      {
        titulo: `Listado de citas del día (${fecha})`,
        hoja: 'Citas del Día',
        columnas,
        filas
      }
    ]
  };

  try {
    if (typeof exportarDocumento === 'function') {
      await exportarDocumento(formato, doc);
      return;
    }

    if (formato === 'pdf' && typeof generarPdf === 'function') {
      await generarPdf(doc);
      if (typeof toast === 'function') toast('Reporte PDF descargado.', 'success');
      return;
    }

    if (typeof generarExcel === 'function') {
      await generarExcel(doc);
      if (typeof toast === 'function') toast('Reporte Excel descargado.', 'success');
      return;
    }

    // Fallback CSV en caso de no cargar librería
    let csv = '\uFEFF';
    csv += columnas.map(c => `"${c.titulo}"`).join(',') + '\r\n';
    filas.forEach(f => {
      csv += f.map(cell => `"${String(cell || '').replace(/"/g, '""')}"`).join(',') + '\r\n';
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `citas-${fecha}.csv`;
    link.click();
    if (typeof toast === 'function') toast('Archivo CSV descargado.', 'success');
  } catch (e) {
    console.error('Error al exportar citas del día:', e);
    if (typeof toast === 'function') toast('No se pudo generar la descarga: ' + e.message, 'error');
  }
}
window.exportarCitasDia = exportarCitasDia;


function renderMatrizEstablecimientos(tableId, establecimientos, totalCitas) {
  const table = document.getElementById(tableId);
  if (!table) return;
  const tbody = table.querySelector('tbody');
  const tfoot = table.querySelector('tfoot');
  if (!tbody) return;

  if (!establecimientos || !establecimientos.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="table-empty">Sin datos de establecimientos registrados.</td></tr>';
    if (tfoot) tfoot.innerHTML = '';
    return;
  }

  const top = establecimientos.slice(0, 7);
  const grandTotal = totalCitas || establecimientos.reduce((acc, e) => acc + (Number(e.atenciones) || 0), 0) || 1;

  tbody.innerHTML = top.map(e => {
    const atenc = Number(e.atenciones) || 0;
    const reg = Number(e.registros) || 0;
    const pac = Number(e.pacientes) || 0;
    const pct = Math.round((atenc / grandTotal) * 100);

    return `
      <tr style="cursor:pointer;" onclick="aplicarFiltroRapidoProd('estab', '${esc(e.id)}')" title="Clic para filtrar por ${esc(e.nombre)}">
        <td class="estab-cell" title="${esc(e.nombre)}">${esc(e.nombre)}</td>
        <td style="text-align:right;">${formatNumber(reg)}</td>
        <td style="text-align:right;"><strong>${formatNumber(atenc)}</strong></td>
        <td style="text-align:right;">${formatNumber(pac)}</td>
        <td style="text-align:right;"><span class="estab-pill">${pct}%</span></td>
      </tr>`;
  }).join('');

  if (tfoot) {
    const totalReg = establecimientos.reduce((acc, e) => acc + (Number(e.registros) || 0), 0);
    const totalPac = establecimientos.reduce((acc, e) => acc + (Number(e.pacientes) || 0), 0);
    tfoot.innerHTML = `
      <tr>
        <td><strong>Total General</strong></td>
        <td style="text-align:right;">${formatNumber(totalReg)}</td>
        <td style="text-align:right;"><strong>${formatNumber(grandTotal)}</strong></td>
        <td style="text-align:right;">${formatNumber(totalPac)}</td>
        <td style="text-align:right;"><span class="estab-pill">100%</span></td>
      </tr>`;
  }
}

function actualizarBarraFiltrosActivos(f) {
  const bar = document.getElementById('prodFiltrosActivosBar');
  if (!bar) return;

  const mesesNombres = {
    '1': 'Enero', '2': 'Febrero', '3': 'Marzo', '4': 'Abril', '5': 'Mayo', '6': 'Junio',
    '7': 'Julio', '8': 'Agosto', '9': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre'
  };

  const pills = [];
  if (f.anio) pills.push({ label: `Año: ${f.anio}`, clear: () => sv('prodFiltroAnio', '') });
  if (f.mes) pills.push({ label: `Mes: ${mesesNombres[f.mes] || f.mes}`, clear: () => sv('prodFiltroMes', '') });
  if (f.tratamiento) pills.push({ label: `Tratamiento/Dx: ${f.tratamiento}`, clear: () => limpiarFiltroTratamiento() });
  if (f.establecimiento) {
    const estSelect = document.getElementById('prodFiltroEstablecimiento');
    const txt = estSelect?.selectedOptions[0]?.text || f.establecimiento;
    pills.push({ label: `Centro: ${txt}`, clear: () => sv('prodFiltroEstablecimiento', '') });
  }
  if (f.ups) {
    const upsSelect = document.getElementById('prodFiltroUps');
    const txt = upsSelect?.selectedOptions[0]?.text || f.ups;
    pills.push({ label: `Servicio: ${txt}`, clear: () => sv('prodFiltroUps', '') });
  }
  if (f.fechaInicio || f.fechaFin) {
    pills.push({ label: `Periodo: ${f.fechaInicio || '...'} a ${f.fechaFin || '...'}`, clear: () => { sv('reporteDesde', ''); sv('reporteHasta', ''); } });
  }

  if (!pills.length) {
    bar.style.display = 'none';
    bar.innerHTML = '';
    return;
  }

  bar.style.display = 'flex';
  bar.innerHTML = `<span style="font-size:12px; font-weight:700; color:var(--c-text-muted);">Filtros activos:</span>` +
    pills.map((p, idx) => `
      <span class="prod-pill">
        <span>${esc(p.label)}</span>
        <button type="button" class="prod-pill-remove" onclick="removerFiltroActivo(${idx})" title="Quitar filtro">✕</button>
      </span>
    `).join('') +
    `<button type="button" class="btn btn-ghost btn-xs" onclick="limpiarFiltrosProduccion()" style="margin-left:auto;">Restablecer todo</button>`;

  window._activePillsList = pills;
}

function removerFiltroActivo(idx) {
  if (window._activePillsList && window._activePillsList[idx]) {
    window._activePillsList[idx].clear();
    cargarReportes();
  }
}

function limpiarFiltrosProduccion() {
  sv('prodFiltroAnio', '2026');
  sv('prodFiltroMes', '');
  limpiarFiltroTratamientoUI();
  sv('prodFiltroEstablecimiento', '');
  sv('prodFiltroUps', '');
  sv('reporteDesde', '');
  sv('reporteHasta', '');
  cargarReportes();
}

function aplicarFiltroRapidoProd(tipo, val) {
  if (tipo === 'mes') {
    sv('prodFiltroMes', val);
    cargarReportes();
  } else if (tipo === 'codigo') {
    const match = (reporteData?.data?.diagnosticos || []).find(d => d.codigo === val);
    seleccionarDiagnosticoItem({
      id: val,
      codigo: val,
      descripcion: match ? match.descripcion : val,
      tipo: match ? match.tipo : 'CIE'
    });
  } else if (tipo === 'estab') {
    sv('prodFiltroEstablecimiento', val);
    cargarReportes();
  }
}

function cambiarTabProduccion(tabId) {
  const tabs = ['tendencia', 'tratamientos', 'personal'];
  tabs.forEach(t => {
    const btn = document.getElementById(`tabBtnProd${t.charAt(0).toUpperCase() + t.slice(1)}`);
    const panel = document.getElementById(`prodPanel-${t}`);
    if (btn) btn.classList.toggle('active', t === tabId);
    if (panel) {
      panel.classList.toggle('active', t === tabId);
      panel.style.display = (t === tabId) ? 'block' : 'none';
    }
  });
}

function filtrarTablaTratamientosLocal(q) {
  const term = (q || '').trim().toLowerCase();
  const rows = document.querySelectorAll('#reporteDiagnosticosTabla tbody tr');
  rows.forEach(r => {
    if (!term) { r.style.display = ''; return; }
    r.style.display = r.textContent.toLowerCase().includes(term) ? '' : 'none';
  });
}

function filtrarTablaPersonalLocal(q) {
  const term = (q || '').trim().toLowerCase();
  const rows = document.querySelectorAll('#reportePersonalTabla tbody tr');
  rows.forEach(r => {
    if (!term) { r.style.display = ''; return; }
    r.style.display = r.textContent.toLowerCase().includes(term) ? '' : 'none';
  });
}

function ordenarTablaProdDiagnosticos(col) {
  if (sortStateProd.diag.col === col) {
    sortStateProd.diag.dir = sortStateProd.diag.dir === 'asc' ? 'desc' : 'asc';
  } else {
    sortStateProd.diag.col = col;
    sortStateProd.diag.dir = 'asc';
  }
  aplicarOrdenDiagnosticosYRender();
}

function aplicarOrdenDiagnosticosYRender() {
  const { col, dir } = sortStateProd.diag;
  if (col && reporteDiagnosticosRows.length) {
    const isAsc = dir === 'asc';
    const isNum = ['registros', 'atenciones', 'pacientes'].includes(col);
    reporteDiagnosticosRows.sort((a, b) => {
      const valA = a[col] ?? (isNum ? -Infinity : '');
      const valB = b[col] ?? (isNum ? -Infinity : '');
      if (isNum) {
        return isAsc ? Number(valA) - Number(valB) : Number(valB) - Number(valA);
      }
      return isAsc
        ? String(valA).localeCompare(String(valB), 'es', { numeric: true, sensitivity: 'base' })
        : String(valB).localeCompare(String(valA), 'es', { numeric: true, sensitivity: 'base' });
    });
  }
  ['codigo', 'descripcion', 'tipo', 'registros', 'atenciones', 'pacientes'].forEach(c => {
    const ind = document.getElementById(`sortInd-diag-${c}`);
    const th = ind?.closest('th');
    if (ind) {
      if (c === col) {
        ind.textContent = dir === 'asc' ? '▲' : '▼';
        th?.classList.add('is-sorted');
        th?.setAttribute('title', `Ordenado de ${dir === 'asc' ? 'menor a mayor' : 'mayor a menor'}. Clic para cambiar.`);
      } else {
        ind.textContent = '↕';
        th?.classList.remove('is-sorted');
        th?.setAttribute('title', 'Clic para ordenar de menor a mayor');
      }
    }
  });
  renderTablaDiagnosticosHtml();
}

function renderTablaDiagnosticosHtml() {
  const diagTbody = document.querySelector('#reporteDiagnosticosTabla tbody');
  if (!diagTbody) return;
  if (!reporteDiagnosticosRows.length) {
    diagTbody.innerHTML = '<tr><td colspan="7" class="table-empty">Sin registros de tratamientos o diagnósticos para este filtro.</td></tr>';
    return;
  }
  diagTbody.innerHTML = reporteDiagnosticosRows.map((row) => {
    const tipoBadge = row.tipo === 'CP' || row.tipo === 'EX'
      ? `<span class="service-chip" style="background:#e0f2fe; color:#0369a1;">Tratamiento / CPMS</span>`
      : `<span class="service-chip" style="background:#fef3c7; color:#92400e;">CIE-10 Dx</span>`;

    return `
      <tr>
        <td><span class="code-badge font-bold">${esc(row.codigo)}</span></td>
        <td style="font-weight:600; color:var(--c-text);">${esc(row.descripcion)}</td>
        <td>${tipoBadge}</td>
        <td style="text-align:right;">${formatNumber(row.registros)}</td>
        <td style="text-align:right;"><b>${formatNumber(row.atenciones)}</b></td>
        <td style="text-align:right;">${formatNumber(row.pacientes)}</td>
        <td style="text-align:right;">
          <div style="display:flex; gap:6px; justify-content:flex-end;">
            <button type="button" class="btn btn-secondary btn-xs" onclick="aplicarFiltroRapidoProd('codigo', '${esc(row.codigo)}')" title="Filtrar producción por este tratamiento">
              Filtrar
            </button>
            <button type="button" class="btn btn-ghost btn-xs" onclick="abrirFichaDirectaCodigo('${esc(row.codigo)}', '${esc(row.descripcion)}', '${row.tipo}')" title="Ver ficha técnica completa">
              Detalle
            </button>
          </div>
        </td>
      </tr>`;
  }).join('');

  const q = document.getElementById('buscarEnTablaTratamientos')?.value;
  if (q) filtrarTablaTratamientosLocal(q);
}

function ordenarTablaProdPersonal(col) {
  if (sortStateProd.pers.col === col) {
    sortStateProd.pers.dir = sortStateProd.pers.dir === 'asc' ? 'desc' : 'asc';
  } else {
    sortStateProd.pers.col = col;
    sortStateProd.pers.dir = 'asc';
  }
  aplicarOrdenPersonalYRender();
}

function aplicarOrdenPersonalYRender() {
  const { col, dir } = sortStateProd.pers;
  if (col && reportePersonalRows.length) {
    const isAsc = dir === 'asc';
    const isNum = ['registros', 'atenciones', 'pacientes'].includes(col);
    const isDate = col === 'ultimaAtencion';
    reportePersonalRows.sort((a, b) => {
      let valA = a[col];
      let valB = b[col];
      if (isNum) {
        valA = Number(valA || 0);
        valB = Number(valB || 0);
        return isAsc ? valA - valB : valB - valA;
      }
      if (isDate) {
        const timeA = valA ? new Date(valA).getTime() : 0;
        const timeB = valB ? new Date(valB).getTime() : 0;
        return isAsc ? timeA - timeB : timeB - timeA;
      }
      valA = String(valA || '');
      valB = String(valB || '');
      return isAsc
        ? valA.localeCompare(valB, 'es', { numeric: true, sensitivity: 'base' })
        : valB.localeCompare(valA, 'es', { numeric: true, sensitivity: 'base' });
    });
  }
  ['nombre', 'documento', 'profesion', 'registros', 'atenciones', 'pacientes', 'ultimaAtencion'].forEach(c => {
    const ind = document.getElementById(`sortInd-pers-${c}`);
    const th = ind?.closest('th');
    if (ind) {
      if (c === col) {
        ind.textContent = dir === 'asc' ? '▲' : '▼';
        th?.classList.add('is-sorted');
        th?.setAttribute('title', `Ordenado de ${dir === 'asc' ? 'menor a mayor' : 'mayor a menor'}. Clic para cambiar.`);
      } else {
        ind.textContent = '↕';
        th?.classList.remove('is-sorted');
        th?.setAttribute('title', 'Clic para ordenar de menor a mayor');
      }
    }
  });
  renderTablaPersonalHtml();
}

function renderTablaPersonalHtml() {
  const persTbody = document.querySelector('#reportePersonalTabla tbody');
  if (!persTbody) return;
  if (!reportePersonalRows.length) {
    persTbody.innerHTML = '<tr><td colspan="8" class="table-empty">Sin registros de profesionales para este filtro.</td></tr>';
    return;
  }
  persTbody.innerHTML = reportePersonalRows.map((row) => `
    <tr>
      <td style="font-weight:600;">${esc(row.nombre)}</td>
      <td><span class="code-badge">${esc(row.documento || '—')}</span></td>
      <td><span class="service-chip">${esc(row.profesion || 'Personal de Salud')}</span></td>
      <td style="text-align:right;">${formatNumber(row.registros)}</td>
      <td style="text-align:right;"><b>${formatNumber(row.atenciones)}</b></td>
      <td style="text-align:right;">${formatNumber(row.pacientes)}</td>
      <td>${esc(row.ultimaAtencion ? formatIsoDate(row.ultimaAtencion) : "—")}</td>
      <td style="text-align:right;">
        <div style="display:flex; gap:6px; justify-content:flex-end;">
          <button class="btn btn-secondary btn-xs" onclick="abrirFichaPersonal('${esc(row.id)}')" title="Ver la ficha del profesional">Ver ficha</button>
          <button class="btn btn-secondary btn-xs" onclick="abrirFichaPersonal('${esc(row.id)}', { reporte: true })" title="Reporte mensual de producción del profesional">Reporte mensual</button>
        </div>
      </td>
    </tr>`).join('');

  const q = document.getElementById('buscarEnTablaPersonal')?.value;
  if (q) filtrarTablaPersonalLocal(q);
}

function ordenarTablaProdEstablecimientos(col) {
  if (sortStateProd.estab.col === col) {
    sortStateProd.estab.dir = sortStateProd.estab.dir === 'asc' ? 'desc' : 'asc';
  } else {
    sortStateProd.estab.col = col;
    sortStateProd.estab.dir = 'asc';
  }
  aplicarOrdenEstablecimientosYRender();
}

function aplicarOrdenEstablecimientosYRender() {
  const { col, dir } = sortStateProd.estab;
  if (col && reporteEstablecimientosRows.length) {
    const isAsc = dir === 'asc';
    const grandTotal = totalCitasReporteActual || reporteEstablecimientosRows.reduce((acc, e) => acc + (Number(e.atenciones) || 0), 0) || 1;
    reporteEstablecimientosRows.sort((a, b) => {
      if (col === 'nombre') {
        const strA = String(a.nombre || '');
        const strB = String(b.nombre || '');
        return isAsc ? strA.localeCompare(strB, 'es', { numeric: true }) : strB.localeCompare(strA, 'es', { numeric: true });
      }
      if (col === 'pct') {
        const valA = ((Number(a.atenciones) || 0) / grandTotal) * 100;
        const valB = ((Number(b.atenciones) || 0) / grandTotal) * 100;
        return isAsc ? valA - valB : valB - valA;
      }
      const numA = Number(a[col] || 0);
      const numB = Number(b[col] || 0);
      return isAsc ? numA - numB : numB - numA;
    });
  }
  ['nombre', 'registros', 'atenciones', 'pacientes', 'pct'].forEach(c => {
    const ind = document.getElementById(`sortInd-estab-${c}`);
    const th = ind?.closest('th');
    if (ind) {
      if (c === col) {
        ind.textContent = dir === 'asc' ? '▲' : '▼';
        th?.classList.add('is-sorted');
        th?.setAttribute('title', `Ordenado de ${dir === 'asc' ? 'menor a mayor' : 'mayor a menor'}. Clic para cambiar.`);
      } else {
        ind.textContent = '↕';
        th?.classList.remove('is-sorted');
        th?.setAttribute('title', 'Clic para ordenar de menor a mayor');
      }
    }
  });
  renderMatrizEstablecimientos('reporteMatrizEstablecimientos', reporteEstablecimientosRows, totalCitasReporteActual);
}

const MESES_PROD = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
async function exportarProduccion(formato, boton) {
  if (!reporteData?.data) { showAlert('Espera a que se calcule la producción antes de exportar.', 'info'); return; }
  const { data, filtros = {} } = reporteData;
  const s = data.resumen || {};
  const texto = id => document.getElementById(id)?.selectedOptions?.[0]?.text || '';
  const esDiario = Boolean(data.filtrosAplicados?.esDiario);
  const num = { tipo: 'numero' };
  const tipoItem = t => (t === 'CP' || t === 'EX' ? 'CPMS' : t === 'CX' ? 'CIE-10' : t || '');
  await exportarDocumento(formato, {
    titulo: 'Reporte de producción asistencial',
    datos: [
      ['Año', filtros.anio || 'Todos'],
      ['Mes', filtros.mes ? MESES_PROD[Number(filtros.mes) - 1] : 'Todo el año'],
      ['Establecimiento', filtros.establecimiento ? texto('prodFiltroEstablecimiento') : 'Todos'],
      ['Servicio (UPS)', filtros.ups ? texto('prodFiltroUps') : 'Todos'],
      ['Tratamiento / diagnóstico', filtros.tratamiento || 'Todos'],
      ['Primera atención', s.primeraAtencion ? formatIsoDate(s.primeraAtencion) : null],
      ['Última atención', s.ultimaAtencion ? formatIsoDate(s.ultimaAtencion) : null],
      ['Códigos registrados', s.codigosRegistrados != null ? formatNumber(s.codigosRegistrados) : null]
    ],
    archivo: 'produccion-asistencial',
    metricas: [
      { etiqueta: 'Citas atendidas', valor: s.citasAtendidas ?? s.atenciones },
      { etiqueta: 'Registros HIS', valor: s.totalRegistros ?? s.registros },
      { etiqueta: 'Pacientes atendidos', valor: s.pacientesAtendidos },
      { etiqueta: 'Personal de salud activo', valor: s.personalActivo },
      { etiqueta: 'Establecimientos activos', valor: s.establecimientosActivos }
    ],
    secciones: [
      { titulo: esDiario ? 'Citas por día' : 'Citas por mes', hoja: esDiario ? 'Por día' : 'Por mes', columnas: [{ titulo: esDiario ? 'Día' : 'Mes', tipo: esDiario ? 'fecha' : 'texto' }, { titulo: 'Registros HIS', ...num }, { titulo: 'Citas atendidas', ...num }, { titulo: 'Pacientes', ...num }],
        filas: (data.porMes || []).map(r => [r.periodo, r.registros, r.atenciones, r.pacientes]) },
      { titulo: 'Producción por establecimiento', hoja: 'Por establecimiento', columnas: [{ titulo: 'Establecimiento' }, { titulo: 'Categoría' }, { titulo: 'Departamento' }, { titulo: 'Provincia' }, { titulo: 'Registros HIS', ...num }, { titulo: 'Citas', ...num }, { titulo: 'Pacientes', ...num }],
        filas: (data.establecimientos || []).map(r => [r.nombre, r.categoria, r.departamento, r.provincia, r.registros, r.atenciones, r.pacientes]) },
      { titulo: 'Tratamientos, procedimientos y diagnósticos', hoja: 'Tratamientos', columnas: [{ titulo: 'Código', tipo: 'codigo' }, { titulo: 'Descripción' }, { titulo: 'Tipo' }, { titulo: 'Registros HIS', ...num }, { titulo: 'Citas', ...num }, { titulo: 'Pacientes', ...num }],
        filas: (data.diagnosticos || []).map(r => [r.codigo, r.descripcion, tipoItem(r.tipo), r.registros, r.atenciones, r.pacientes]) },
      { titulo: 'Producción por personal de salud', hoja: 'Por personal', columnas: [{ titulo: 'Profesional' }, { titulo: 'Documento' }, { titulo: 'Profesión' }, { titulo: 'Registros HIS', ...num }, { titulo: 'Citas', ...num }, { titulo: 'Pacientes', ...num }, { titulo: 'Última atención', tipo: 'fecha' }],
        filas: (data.personal || []).map(r => [r.nombre, r.documento, r.profesion, r.registros, r.atenciones, r.pacientes, r.ultimaAtencion]) }
    ]
  }, boton);
}

// ═══════════════════════════════════════
//  BÚSQUEDAS: PACIENTES, ATENCIONES, DEFUNCIONES Y PERSONAL
// ═══════════════════════════════════════
// Tomadas del proyecto HIS: lista de coincidencias, ficha con los datos del maestro y atenciones
// agrupadas por fecha; cada atención o defunción abre todos sus datos en la ventana modal.

// Nombres legibles de las columnas; las que no estén aquí se muestran a partir de su nombre.
const FIELD_LABELS = {
  Id_Paciente: 'ID paciente', Id_Tipo_Documento_Paciente: 'Tipo de documento', Numero_Documento_Paciente: 'Documento',
  Apellido_Paterno_Paciente: 'Apellido paterno', Apellido_Materno_Paciente: 'Apellido materno', Nombres_Paciente: 'Nombres',
  Fecha_Nacimiento_Paciente: 'Fecha de nacimiento', Id_Genero: 'Sexo', Id_Etnia: 'Etnia',
  Historia_Clinica: 'Historia clínica', Ficha_Familiar: 'Ficha familiar', Ubigeo_Nacimiento: 'Ubigeo de nacimiento',
  Ubigeo_Reniec: 'Ubigeo RENIEC', Domicilio_Reniec: 'Domicilio RENIEC', Ubigeo_Declarado: 'Ubigeo declarado',
  Domicilio_Declarado: 'Domicilio declarado', Referencia_Domicilio: 'Referencia del domicilio', Id_Pais: 'País',
  Id_Establecimiento: 'Establecimiento', Fecha_Alta: 'Fecha de alta', Fecha_Modificacion: 'Fecha de modificación',
  Id_Personal: 'ID personal', Id_Tipo_Documento_Personal: 'Tipo de documento', Numero_Documento_Personal: 'Documento',
  Apellido_Paterno_Personal: 'Apellido paterno', Apellido_Materno_Personal: 'Apellido materno', Nombres_Personal: 'Nombres',
  Fecha_Nacimiento_Personal: 'Fecha de nacimiento', Id_Condicion: 'Código de condición', Condicion: 'Condición de contrato',
  Id_Profesion: 'Código de profesión', Profesion: 'Profesión', Id_Colegio: 'Código de colegio', Colegio: 'Colegio profesional',
  Numero_Colegiatura: 'N.º de colegiatura', Establecimiento: 'Establecimiento', Fecha_Baja: 'Fecha de baja',
  Id_Cita: 'Cita', Fecha_Atencion: 'Fecha de atención', Anio: 'Año', Mes: 'Mes', Dia: 'Día', Lote: 'Lote',
  Num_Pag: 'Página', Num_Reg: 'Registro', Id_Ups: 'UPS', Id_Registrador: 'ID registrador', Id_Financiador: 'Financiador',
  Id_Condicion_Establecimiento: 'Condición en el establecimiento', Id_Condicion_Servicio: 'Condición en el servicio',
  Edad_Reg: 'Edad registrada', Tipo_Edad: 'Tipo de edad', Anio_Actual_Paciente: 'Edad actual (años)',
  Mes_Actual_Paciente: 'Edad actual (meses)', Dia_Actual_Paciente: 'Edad actual (días)', Id_Turno: 'Turno',
  Codigo_Item: 'Código HIS', DescItem: 'Descripción del código', Tipo_Diagnostico: 'Tipo de diagnóstico', Valor_Lab: 'Valor LAB',
  Id_Correlativo: 'Correlativo del ítem', Id_Correlativo_Lab: 'Correlativo LAB', Peso: 'Peso', Talla: 'Talla',
  Hemoglobina: 'Hemoglobina', Perimetro_Abdominal: 'Perímetro abdominal', Perimetro_Cefalico: 'Perímetro cefálico',
  Id_Otra_Condicion: 'Otra condición', Id_Centro_Poblado: 'Centro poblado', Fecha_Ultima_Regla: 'Fecha de última regla',
  Fecha_Solicitud_Hb: 'Fecha de solicitud Hb', Fecha_Resultado_Hb: 'Fecha de resultado Hb', Fecha_Registro: 'Fecha de registro',
  gruporiesgo_desc: 'Grupo de riesgo', condicion_gestante: 'Condición de gestante', peso_pregestacional: 'Peso pregestacional',
  Id_Dosis: 'Dosis', renipress: 'RENIPRESS', Id_Institucion_Edu: 'Institución educativa', Id_AplicacionOrigen: 'Aplicación de origen',
  Alerta: 'Alerta', Paciente: 'Paciente', Personal: 'Personal',
  N: 'N', TIPO_CDEF: 'Tipo de certificado', CDEF: 'Certificado', ESTADO: 'Estado', TIPO_SEGURO: 'Tipo de seguro',
  PRIMER_APELLIDO: 'Primer apellido', SEGUNDO_APELLIDO: 'Segundo apellido', NOMBRES: 'Nombres', TIPO_DOC: 'Tipo de documento',
  DOCUMENTO: 'Documento', SEXO: 'Sexo', ETNIA: 'Etnia', EDAD: 'Edad', TIEMPO_EDAD: 'Unidad de edad', ESTADO_CIVIL: 'Estado civil',
  NIVEL_DE_INSTRUCCION: 'Nivel de instrucción', OCUPACION: 'Ocupación', FECHA: 'Fecha de fallecimiento', ANIO: 'Año', MES: 'Mes',
  HORA: 'Hora', TIPO_LUGAR: 'Tipo de lugar', CODIGO_LUGAR_UBIGEO: 'Ubigeo del lugar', INSTITUCION: 'Institución', DISA: 'DISA',
  DEPARTAMENTO: 'Departamento', PROVINCIA: 'Provincia', DISTRITO: 'Distrito', DESCRIPCION_DE_LUGAR: 'Descripción del lugar',
  DIRECCION_DE_LUGAR: 'Dirección del lugar', MUERTE_VIOLENTA: 'Muerte violenta', NECROPSIA: 'Necropsia',
  MUERTE_DURANTE: 'Muerte durante', EDAD_GESTACIONAL: 'Edad gestacional', CONTROL_PRENATAL: 'Control prenatal',
  TIEMPO_DE_HOSPITALIZACION: 'Tiempo de hospitalización', FECHA_REGISTRO: 'Fecha de registro', DNI_CODIGO_USUARIO: 'Usuario que registró',
  DEBIDO_CAUSA_A: 'Causa A', CAUSA_A_CIEX: 'CIE-10 causa A', DEBIDO_CAUSA_B: 'Causa B', CAUSA_B_CIEX: 'CIE-10 causa B',
  DEBIDO_CAUSA_C: 'Causa C', CAUSA_C_CIEX: 'CIE-10 causa C', DEBIDO_CAUSA_D: 'Causa D', CAUSA_D_CIEX: 'CIE-10 causa D',
  DEBIDO_CAUSA_E: 'Causa E', CAUSA_E_CIEX: 'CIE-10 causa E', DEBIDO_CAUSA_F: 'Causa F', CAUSA_F_CIEX: 'CIE-10 causa F',
  TIEMPO: 'Tiempo causa A', TIEMPO1: 'Tiempo causa B', TIEMPO2: 'Tiempo causa C', TIEMPO3: 'Tiempo causa D',
  TIEMPO4: 'Tiempo causa E', TIEMPO5: 'Tiempo causa F'
};
const FIELD_LABELS_CI = Object.fromEntries(Object.entries(FIELD_LABELS).map(([key, label]) => [key.toLowerCase(), label]));

function fieldLabel(key) {
  const known = FIELD_LABELS[key] || FIELD_LABELS_CI[String(key).toLowerCase()];
  if (known) return known;
  const text = String(key).replace(/^Id_/i, '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// SQL Server entrega las fechas como texto ISO en UTC: se muestran tal como están guardadas (dd/mm/aaaa y hora si la tiene).
function formatearValor(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?Z?$/.exec(String(value));
  if (!match) return String(value).trim();
  const [, y, m, d, hh, mm, ss] = match;
  const fecha = `${d}/${m}/${y}`;
  return hh === '00' && mm === '00' && (!ss || ss === '00') ? fecha : `${fecha} ${hh}:${mm}`;
}

function valorHtml(value) {
  const text = formatearValor(value);
  return text === null ? '<span class="fact-empty">Sin dato</span>' : esc(text);
}

// Cuadrícula de datos (etiqueta arriba, valor abajo); solo incluye los campos que existen en el registro.
function factGrid(row, fields, { onlyPresent = false } = {}) {
  const keys = fields.filter(field => field in row && (!onlyPresent || formatearValor(row[field]) !== null));
  if (!keys.length) return '';
  return `<dl class="fact-grid">${keys.map(key => `<div><dt>${esc(fieldLabel(key))}</dt><dd>${valorHtml(row[key])}</dd></div>`).join('')}</dl>`;
}

// Busca una columna sin distinguir mayúsculas (los nombres de NProduccion varían entre bases).
function pickKeys(row, names) {
  const byLower = new Map(Object.keys(row).map(key => [key.toLowerCase(), key]));
  return names.map(name => byLower.get(name.toLowerCase())).filter(Boolean);
}

function abrirModal(titulo, html, { wide = true, full = false } = {}) {
  document.getElementById('modalTitle').textContent = titulo;
  document.getElementById('modalBody').innerHTML = html;
  document.querySelector('#modal .modal-box').classList.toggle('modal-wide', wide);
  document.querySelector('#modal .modal-box').classList.toggle('modal-full', full);
  document.getElementById('modal').classList.toggle('modal-overlay-full', full);
  document.getElementById('modal').classList.add('show');
}

function estadoBusqueda(target, mensaje, tipo = 'info') {
  document.getElementById(target).innerHTML = `<div class="card search-state search-state-${tipo}">${esc(mensaje)}</div>`;
}

const nombrePaciente = x => [x.Apellido_Paterno_Paciente, x.Apellido_Materno_Paciente, x.Nombres_Paciente].map(v => String(v ?? '').trim()).filter(Boolean).join(' ');
const nombrePersonal = x => [x.Apellido_Paterno_Personal, x.Apellido_Materno_Personal, x.Nombres_Personal].map(v => String(v ?? '').trim()).filter(Boolean).join(' ');
const nombreFallecido = x => [x.NOMBRES, x.PRIMER_APELLIDO, x.SEGUNDO_APELLIDO].map(v => String(v ?? '').trim()).filter(Boolean).join(' ');
const SEXO = { M: 'Masculino', F: 'Femenino', 1: 'Masculino', 2: 'Femenino' };

// Resultados de la última búsqueda de cada vista, para volver de la ficha a la lista.
const busquedaState = { pacientes: [], personal: [] };
const searchSeq = { pacientes: 0, atenciones: 0, defunciones: 0, personal: 0, ficha: 0 };

// Lista compacta de coincidencias; al elegir una se abre su ficha en el mismo lugar.
function renderListaCoincidencias(tipo, rows) {
  const target = tipo === 'pacientes' ? 'resPacientes' : 'resPersonal';
  const el = document.getElementById(target);
  if (!rows.length) {
    estadoBusqueda(target, tipo === 'pacientes' ? 'No se encontraron pacientes con ese dato.' : 'No se encontró personal con ese dato.');
    return;
  }
  const items = rows.map((x, index) => {
    const isPac = tipo === 'pacientes';
    const nombre = (isPac ? nombrePaciente(x) : nombrePersonal(x)) || (isPac ? 'Paciente sin nombre' : 'Personal sin nombre');
    const meta = isPac
      ? [`ID ${x.Id_Paciente ?? '—'}`, `Documento ${x.Numero_Documento_Paciente || '—'}`, x.Historia_Clinica ? `H.C. ${x.Historia_Clinica}` : null]
      : [`ID ${x.Id_Personal ?? '—'}`, `Documento ${x.Numero_Documento_Personal || '—'}`, x.Profesion || null];
    return `<li><button type="button" class="result-item" data-index="${index}">
      <span class="result-avatar" aria-hidden="true">${esc(nombre.charAt(0) || '?')}</span>
      <span class="result-text"><span class="result-name">${esc(nombre)}</span><span class="result-meta">${meta.filter(Boolean).map(esc).join(' · ')}</span></span>
      <svg class="result-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
    </button></li>`;
  }).join('');
  const limite = tipo === 'pacientes' ? 100 : 100;
  el.innerHTML = `<div class="card result-card">
    <div class="card-header"><div><div class="card-title">${tipo === 'pacientes' ? 'Pacientes encontrados' : 'Resultados de personal'}</div>
    <div class="card-subtitle">${formatNumber(rows.length)} registro(s)${rows.length >= limite ? ` · se muestran los primeros ${limite}; escribe un dato más específico` : ''}</div></div></div>
    <ul class="result-list">${items}</ul></div>`;
  el.querySelectorAll('.result-item').forEach(button => button.addEventListener('click', () => {
    const row = rows[Number(button.dataset.index)];
    if (tipo === 'pacientes') renderFichaPaciente(row, rows.length > 1);
    else abrirPersonalSimplePorId(String(row.Id_Personal));
  }));
}

// Exportadores de las listas visibles: cada vista registra qué exportar y los botones [data-export] lo usan.
const exportadores = {};
document.addEventListener('click', (event) => {
  const boton = event.target.closest('[data-export]');
  if (!boton) return;
  const exportar = exportadores[boton.dataset.export];
  if (exportar) exportar(boton.dataset.formato, boton, { ...(boton.dataset.fecha ? { fecha: boton.dataset.fecha } : {}), ...(boton.dataset.cita ? { cita: boton.dataset.cita } : {}) });
});

const fechaAtencionDe = r => (/^\d{4}-\d{2}-\d{2}/.test(String(r.Fecha_Atencion || '')) ? String(r.Fecha_Atencion).slice(0, 10) : '');
const fechaCorta = iso => iso.split('-').reverse().join('/');

// Filtra las atenciones por un día (filtro.fecha) o por un rango (filtro.desde / filtro.hasta), en formato AAAA-MM-DD.
function filtrarAtencionesPorFecha(rows, { fecha = '', desde = '', hasta = '' } = {}) {
  if (fecha) return rows.filter(r => fechaAtencionDe(r) === fecha);
  if (!desde && !hasta) return rows;
  return rows.filter(r => { const f = fechaAtencionDe(r); return f && (!desde || f >= desde) && (!hasta || f <= hasta); });
}
function describirFiltroFecha({ fecha = '', desde = '', hasta = '' } = {}) {
  if (fecha) return `Fecha de atención: ${fechaCorta(fecha)}.`;
  if (desde && hasta) return `Periodo: del ${fechaCorta(desde)} al ${fechaCorta(hasta)}.`;
  if (desde) return `Periodo: desde el ${fechaCorta(desde)}.`;
  if (hasta) return `Periodo: hasta el ${fechaCorta(hasta)}.`;
  return '';
}

// Registra la exportación de una lista de atenciones; acepta un filtro de fecha o rango en el momento de exportar.
// «filtroBase» devuelve el rango elegido en pantalla (para la ficha), que se aplica cuando no se pide un día concreto.
exportadores.produccion = (formato, boton) => exportarProduccion(formato, boton);

// Tabla con el diseño del reporte del personal (F40 morado): FECHA y CITA combinadas hacia abajo, un renglón por código.
const COLUMNAS_ATENCION_F40 = [
  { titulo: 'FECHA', alinear: 'center', ancho: 12 }, { titulo: 'CITA', alinear: 'center', ancho: 13 }, { titulo: 'SERVICIO (UPS)', ancho: 22 },
  { titulo: 'TURNO', alinear: 'center', ancho: 7 }, { titulo: 'CÓDIGO HIS', alinear: 'center', ancho: 11 }, { titulo: 'DESCRIPCIÓN', ancho: 46 },
  { titulo: 'TIPO DX', alinear: 'center', ancho: 8 }, { titulo: 'VALOR LAB', alinear: 'center', ancho: 9 }, { titulo: 'PACIENTE', ancho: 26 }, { titulo: 'ATENDIÓ', ancho: 28 }
];
function filasAtencionF40(filas) {
  let fechaAnterior = null;
  let citaAnterior = null;
  return filas.map(r => {
    const fecha = fechaAtencionDe(r) ? fechaCorta(fechaAtencionDe(r)) : 'Sin fecha';
    const cita = String(r.Id_Cita ?? r.Cita ?? '');
    const nuevaFecha = fecha !== fechaAnterior;
    const nuevaCita = nuevaFecha || cita !== citaAnterior;
    fechaAnterior = fecha;
    citaAnterior = cita;
    return [nuevaFecha ? fecha : '', nuevaCita ? cita || '-' : '', nuevaCita ? [r.Id_Ups, r.Servicio].filter(Boolean).join(' - ') || '-' : '',
      nuevaCita ? String(r.Id_Turno ?? '').toUpperCase() || '-' : '', r.Codigo_Item, r.DescItem, r.Tipo_Diagnostico, r.Valor_Lab,
      nuevaCita ? r.Paciente || r.Id_Paciente || '-' : '', nuevaCita ? r.Personal || r.Id_Personal || '-' : ''];
  });
}

function registrarExportAtenciones(clave, rows, titulo, datos, archivo, filtroBase = () => ({})) {
  exportadores[clave] = (formato, boton, filtro = {}) => {
    const aplicado = filtro.fecha ? filtro : filtroBase();
    const filas = filtrarAtencionesPorFecha(rows, aplicado);
    const citas = new Set(filas.map(r => String(r.Id_Cita ?? r.Cita ?? ''))).size;
    const sufijo = aplicado.fecha || [aplicado.desde, aplicado.hasta].filter(Boolean).join('-al-');
    return exportarDocumento(formato, {
      titulo,
      datos: [
        ...datos,
        aplicado.fecha ? ['Fecha de atención', fechaCorta(aplicado.fecha)] : null,
        aplicado.desde ? ['Desde', fechaCorta(aplicado.desde)] : null,
        aplicado.hasta ? ['Hasta', fechaCorta(aplicado.hasta)] : null,
        ['Atenciones (citas)', formatNumber(citas)],
        ['Registros (códigos)', formatNumber(filas.length)]
      ].filter(Boolean),
      orientacion: 'landscape',
      archivo: sufijo ? `${archivo}-${sufijo}` : archivo,
      secciones: [{ titulo: 'Atenciones', estilo: 'f40', combinar: [0, 1, 2, 3, 8, 9], ocultarConteo: true, columnas: COLUMNAS_ATENCION_F40, filas: filasAtencionF40(filas) }]
    }, boton);
  };
}

// Reporte de una atención (cita) con el diseño del reporte del personal: recuadro con los datos de la atención,
// del paciente y del profesional, y tablas moradas con los diagnósticos/actividades y las mediciones.
const TURNOS = { M: 'Mañana', T: 'Tarde', N: 'Noche' };
const TIPOS_EDAD = { A: 'años', M: 'meses', D: 'días' };
const TIPOS_DX = { D: 'Definitivo', P: 'Presuntivo', R: 'Repetido' };
exportadores.cita = async (formato, boton, { cita } = {}) => {
  if (!cita) return;
  let rows;
  const etiqueta = boton.innerHTML;
  boton.disabled = true;
  try {
    rows = await apiFetch(`/busqueda/citas/${encodeURIComponent(cita)}`);
  } catch (error) {
    showAlert(error.message || 'No se pudo consultar la atención.', 'error');
    return;
  } finally {
    boton.disabled = false;
    boton.innerHTML = etiqueta;
  }
  const r = rows[0] || {};
  const pick = (...keys) => { for (const k of keys) { const key = pickKeys(r, [k])[0]; if (key && r[key] !== null && r[key] !== '') return r[key]; } return null; };
  const edad = pick('Edad_Reg') !== null ? `${pick('Edad_Reg')} ${TIPOS_EDAD[String(pick('Tipo_Edad') || '').toUpperCase()] || pick('Tipo_Edad') || ''}`.trim() : null;
  const renipress = pick('renipress');
  const establecimiento = [renipress ? String(renipress).padStart(8, '0') : null, r.NombreEstablecimiento || pick('Id_Establecimiento')].filter(Boolean).join(' - ');
  const turno = String(pick('Id_Turno') || '').toUpperCase();
  const mediciones = ['Peso', 'Talla', 'Hemoglobina', 'Perimetro_Abdominal', 'Perimetro_Cefalico', 'peso_pregestacional', 'Fecha_Ultima_Regla', 'Fecha_Solicitud_Hb', 'Fecha_Resultado_Hb', 'gruporiesgo_desc', 'condicion_gestante']
    .map(nombre => {
      const fila = rows.find(x => { const k = pickKeys(x, [nombre])[0]; return k && x[k] !== null && String(x[k]).trim() !== ''; });
      if (!fila) return null;
      return [fieldLabel(nombre), fila[pickKeys(fila, [nombre])[0]]];
    }).filter(Boolean);
  const secciones = [{
    titulo: 'Diagnósticos y actividades registrados',
    hoja: 'Diagnósticos',
    estilo: 'f40',
    columnas: [{ titulo: 'N.º', ancho: 6, alinear: 'center' }, { titulo: 'CÓDIGO HIS', ancho: 13, alinear: 'center' }, { titulo: 'DESCRIPCIÓN', ancho: 60 }, { titulo: 'TIPO DX', ancho: 14, alinear: 'center' }, { titulo: 'VALOR LAB', ancho: 12, alinear: 'center' }],
    filas: rows.map((x, i) => [i + 1, x[pickKeys(x, ['Codigo_Item'])[0]], x.DescItem, TIPOS_DX[String(x[pickKeys(x, ['Tipo_Diagnostico'])[0]] || '').toUpperCase()] || x[pickKeys(x, ['Tipo_Diagnostico'])[0]], x[pickKeys(x, ['Valor_Lab'])[0]]])
  }];
  if (mediciones.length) {
    secciones.push({ titulo: 'Mediciones y datos clínicos', hoja: 'Mediciones', estilo: 'f40', columnas: [{ titulo: 'DATO', ancho: 30 }, { titulo: 'VALOR', ancho: 30, alinear: 'center' }], filas: mediciones });
  }
  return exportarDocumento(formato, {
    titulo: 'Reporte de atención',
    archivo: `atencion-cita-${cita}`,
    orientacion: 'portrait',
    datosColumnas: [
      [['Fecha de atención', formatearValor(pick('Fecha_Atencion'))], ['Cita', cita], ['Turno', TURNOS[turno] || turno], ['Establecimiento', establecimiento],
        ['Servicio (UPS)', [pick('Id_Ups'), r.Servicio].filter(Boolean).join(' - ')], ['Financiador', r.Financiador || pick('Id_Financiador')], ['Lote / página / registro', [pick('Lote'), pick('Num_Pag'), pick('Num_Reg')].map(v => v ?? '-').join(' / ')]],
      [['Paciente', r.Paciente], ['Documento', r.DocumentoPaciente], ['ID paciente', pick('Id_Paciente')], ['Historia clínica', r.HistoriaClinica],
        ['Sexo', SEXO[String(r.SexoPaciente ?? '').trim()] || r.SexoPaciente], ['Edad', edad], ['Fecha de nacimiento', formatearValor(r.FechaNacimientoPaciente)]],
      [['Personal de salud', r.Personal], ['DNI', r.DocumentoPersonal], ['Profesión', r.ProfesionPersonal], ['Colegiatura', r.ColegiaturaPersonal]]
    ],
    secciones
  }, boton);
};

// ── Pacientes ──
async function buscarPacientes() {
  const q = gv('qPacientes');
  if (!q) { toast('Escribe un DNI, ID, historia clínica o nombre.', 'info'); document.getElementById('qPacientes').focus(); return; }
  const seq = ++searchSeq.pacientes;
  estadoBusqueda('resPacientes', 'Buscando pacientes…');
  try {
    const rows = await apiFetch(`/busqueda/pacientes?q=${encodeURIComponent(q)}`);
    if (seq !== searchSeq.pacientes) return;
    busquedaState.pacientes = rows;
    if (rows.length === 1) renderFichaPaciente(rows[0], false);
    else renderListaCoincidencias('pacientes', rows);
  } catch (error) {
    if (seq === searchSeq.pacientes) estadoBusqueda('resPacientes', error.message || 'No se pudo buscar.', 'error');
  }
}

function renderFichaPaciente(x, conVolver) {
  const el = document.getElementById('resPacientes');
  const nombre = nombrePaciente(x) || 'Paciente';
  const sexo = SEXO[String(x.Id_Genero ?? '').trim()] || null;
  el.innerHTML = `<div class="card ficha">
    ${conVolver ? '<button type="button" class="btn btn-ghost btn-sm ficha-back" data-back>← Volver a los resultados</button>' : ''}
    <div class="ficha-head">
      <div class="ficha-avatar" aria-hidden="true">${esc(nombre.charAt(0))}</div>
      <div class="ficha-id">
        <div class="ficha-eyebrow">Ficha del paciente</div>
        <h3>${esc(nombre)}</h3>
        <div class="ficha-meta"><span>ID ${esc(x.Id_Paciente ?? '—')}</span><span>Documento ${esc(x.Numero_Documento_Paciente || '—')}</span>${sexo ? `<span>${sexo}</span>` : ''}${x.Historia_Clinica ? `<span>H.C. ${esc(x.Historia_Clinica)}</span>` : ''}</div>
      </div>
      <span class="ficha-pill">Registro encontrado</span>
    </div>
    <div id="fichaSinadef"></div>
    <h4 class="ficha-section">Datos personales</h4>
    ${factGrid(x, ['Id_Paciente', 'Id_Tipo_Documento_Paciente', 'Numero_Documento_Paciente', 'Apellido_Paterno_Paciente', 'Apellido_Materno_Paciente', 'Nombres_Paciente', 'Fecha_Nacimiento_Paciente', 'Id_Genero', 'Id_Etnia'])}
    <h4 class="ficha-section">Historia y ubicación</h4>
    ${factGrid(x, ['Historia_Clinica', 'Ficha_Familiar', 'Ubigeo_Nacimiento', 'Ubigeo_Reniec', 'Domicilio_Reniec', 'Ubigeo_Declarado', 'Domicilio_Declarado', 'Referencia_Domicilio', 'Id_Pais', 'Id_Establecimiento', 'Fecha_Alta', 'Fecha_Modificacion'])}
    <div class="ficha-actions"><button type="button" class="btn btn-primary" data-atenciones>Ver atenciones</button></div>
    <div class="ficha-atenciones" id="fichaPacienteAtenciones"></div>
  </div>`;
  el.querySelector('[data-back]')?.addEventListener('click', () => renderListaCoincidencias('pacientes', busquedaState.pacientes));
  el.querySelector('[data-atenciones]').addEventListener('click', event => cargarAtencionesFicha(event.currentTarget, `/busqueda/pacientes/${encodeURIComponent(x.Id_Paciente)}/atenciones`, 'fichaPacienteAtenciones', 'paciente',
    'Reporte de atenciones del paciente', [
      ['Paciente', nombre], ['Documento', x.Numero_Documento_Paciente], ['ID paciente', x.Id_Paciente],
      ['Historia clínica', x.Historia_Clinica], ['Fecha de nacimiento', formatearValor(x.Fecha_Nacimiento_Paciente)], ['Sexo', sexo]
    ]));
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  revisarSinadef(x.Numero_Documento_Paciente);
}

// Si el documento figura en el SINADEF, la ficha lo avisa.
async function revisarSinadef(documento) {
  const box = document.getElementById('fichaSinadef');
  if (!box || !documento || !String(documento).trim()) return;
  try {
    const result = await apiFetch(`/pacientes/sinadef?documento=${encodeURIComponent(String(documento).trim())}`);
    const datos = result?.datos;
    if (!result?.fallecido || !datos) return;
    if (!document.body.contains(box)) return;
    const fecha = formatearValor(datos?.fechaFallecimiento);
    box.innerHTML = `<div class="ficha-alert"><strong>Registrado como fallecido en el SINADEF</strong>${fecha ? ` el ${esc(fecha)}` : ''}${datos?.causaA ? `. Causa: ${esc(datos.causaA)}` : ''}.</div>`;
  } catch {
    // Si la vista del SINADEF no está disponible, la ficha se muestra sin el aviso.
  }
}

// ── Personal ──
// El buscador y la ficha del profesional están en js/personal-simple.js (mismo diseño que la ficha del paciente).

// Años completos desde una fecha (edad o antigüedad); null si la fecha no es válida.
function aniosDesde(valor) {
  const f = /^\d{4}-\d{2}-\d{2}/.test(String(valor || '')) ? String(valor).slice(0, 10) : '';
  if (!f) return null;
  const [y, m, d] = f.split('-').map(Number);
  const hoy = new Date();
  let anios = hoy.getFullYear() - y;
  if (hoy.getMonth() + 1 < m || (hoy.getMonth() + 1 === m && hoy.getDate() < d)) anios -= 1;
  return anios >= 0 ? anios : null;
}

// Abre la vista Personal con la ficha de un profesional (desde el reporte de Producción).
// Con «reporte», genera el reporte mensual del último mes del periodo elegido en Producción.
async function abrirFichaPersonal(id, { reporte = false } = {}) {
  if (id === null || id === undefined || String(id).trim() === '') return;
  if (reporte) {
    const f = reporteData?.filtros || {};
    if (f.anio && f.mes) {
      reporteMensualPreferido = { anio: Number(f.anio), mes: Number(f.mes) };
    } else {
      const ref = parseLocalDate(reporteData?.data?.resumen?.ultimaAtencion || new Date().toISOString());
      reporteMensualPreferido = { anio: ref.getFullYear(), mes: ref.getMonth() + 1 };
    }
  }
  showView('personal');
  await abrirPersonalSimplePorId(String(id));
  if (reporte && document.getElementById('rmGenerar')) {
    document.getElementById('reporteMensual').scrollIntoView({ behavior: 'smooth', block: 'start' });
    generarReporteMensual(document.getElementById('rmGenerar').dataset.id);
  }
}

// ── Reporte mensual de producción del personal ──
// Modelo del hospital sin Nuevos/Continuadores ni SOP/URPA: por servicio, actividad y turno, día por día, con total.
const MESES_NOMBRE = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const ACTIVIDADES_REPORTE = [
  { clave: 'atenciones', titulo: 'ATENCIONES' },
  { clave: 'atencionesConProc', titulo: 'ATEN. CON PROC.' },
  { clave: 'procedimientos', titulo: 'PROCEDIMIENTOS (CPMS)' }
];
const NOTAS_REPORTE = [
  'Atenciones: citas sin ningún procedimiento CPMS registrado.',
  'Aten. con proc.: citas en las que se registró al menos un procedimiento CPMS.',
  'Procedimientos (CPMS): número de códigos CPMS registrados (catálogo MAESTRO_HIS_CIE_CPMS, tipo CP o EX).',
  'Turnos: M = mañana, T = tarde. Cada cita se cuenta una sola vez por día y turno.'
];
let reporteMensualPreferido = null;

// El mismo reporte sirve para el personal (lo que atendió) y para el paciente (lo que recibió).
// Cada tipo usa sus propios ids para que ambos puedan estar en la página a la vez.
const RM_TIPOS = {
  personal: {
    pre: 'rm', seccion: 'reporteMensual', titulo: 'Reporte mensual de producción', idDe: x => x.Id_Personal, ruta: 'personal',
    cargando: 'Calculando la producción del mes…', vacio: 'No hay atenciones registradas por este profesional en el mes elegido.',
    exportTitulo: 'Reporte de producción del personal de salud', archivo: 'produccion-personal', exportador: 'reporteMensual'
  },
  paciente: {
    pre: 'rmp', seccion: 'reporteMensualPaciente', titulo: 'Reporte mensual de atenciones', idDe: x => x.Id_Paciente, ruta: 'pacientes',
    cargando: 'Calculando las atenciones del mes…', vacio: 'Este paciente no tiene atenciones registradas en el mes elegido.',
    exportTitulo: 'Reporte mensual de atenciones del paciente', archivo: 'atenciones-paciente', exportador: 'reporteMensualPaciente'
  }
};
const tipoReporteMensual = data => (data.paciente ? 'paciente' : 'personal');

function reporteMensualHtml(x, tipo = 'personal', preferido = null) {
  const cfg = RM_TIPOS[tipo];
  const hoy = new Date();
  const pref = preferido || (tipo === 'personal' && reporteMensualPreferido) || { anio: hoy.getFullYear(), mes: hoy.getMonth() + 1 };
  const anios = Array.from({ length: 6 }, (_, i) => hoy.getFullYear() - i);
  return `<section class="monthly-report" id="${cfg.seccion}">
    <h4 class="ficha-section">${cfg.titulo}</h4>
    <div class="monthly-controls">
      <label class="label">Año<select class="input" id="${cfg.pre}Anio">${anios.map(a => `<option value="${a}"${a === pref.anio ? ' selected' : ''}>${a}</option>`).join('')}</select></label>
      <label class="label">Mes<select class="input" id="${cfg.pre}Mes">${MESES_NOMBRE.map((m, i) => `<option value="${i + 1}"${i + 1 === pref.mes ? ' selected' : ''}>${m}</option>`).join('')}</select></label>
      <button type="button" class="btn btn-primary" id="${cfg.pre}Generar" data-id="${esc(cfg.idDe(x))}">Generar reporte</button>
      <button type="button" class="btn btn-secondary" id="${cfg.pre}Limpiar" data-anio="${pref.anio}" data-mes="${pref.mes}" onclick="limpiarReporteMensual('${tipo}')" title="Borra el reporte generado y vuelve al año y mes iniciales">Limpiar</button>
    </div>
    <div id="${cfg.pre}Resultado"></div>
  </section>`;
}

// Quita el reporte generado y deja el año y mes con que se abrió la ficha.
function limpiarReporteMensual(tipo = 'personal') {
  const cfg = RM_TIPOS[tipo];
  const boton = document.getElementById(`${cfg.pre}Limpiar`);
  if (!boton) return;
  sv(`${cfg.pre}Anio`, boton.dataset.anio);
  sv(`${cfg.pre}Mes`, boton.dataset.mes);
  if (tipo === 'personal') reporteMensualPreferido = null;
  delete exportadores[cfg.exportador];
  document.getElementById(`${cfg.pre}Resultado`).innerHTML = '';
}

async function generarReporteMensual(id, tipo = 'personal') {
  const cfg = RM_TIPOS[tipo];
  const target = document.getElementById(`${cfg.pre}Resultado`);
  const anio = Number(gv(`${cfg.pre}Anio`));
  const mes = Number(gv(`${cfg.pre}Mes`));
  if (tipo === 'personal') reporteMensualPreferido = { anio, mes };
  target.innerHTML = `<div class="table-empty">${cfg.cargando}</div>`;
  try {
    const data = await apiFetch(`/busqueda/${cfg.ruta}/${encodeURIComponent(id)}/reporte-mensual?anio=${anio}&mes=${mes}`);
    renderReporteMensual(data);
  } catch (error) {
    target.innerHTML = `<div class="search-state search-state-error">${esc(error.message || 'No se pudo calcular el reporte.')}</div>`;
  }
}

// Convierte las filas del servidor en bloques Servicio → Actividad → Turno con los valores de cada día.
function armarReporteMensual(data) {
  const dias = data.diasMes;
  const turnosOrden = ['M', 'T'];
  data.filas.forEach(f => { const t = f.turno || '—'; if (!turnosOrden.includes(t)) turnosOrden.push(t); });
  const servicios = new Map();
  data.filas.forEach(f => {
    const key = f.ups ?? '';
    if (!servicios.has(key)) servicios.set(key, { ups: f.ups, upss: f.upss || '', nombre: f.servicio || (f.ups ? `UPS ${f.ups}` : 'Sin servicio'), celdas: {} });
    const s = servicios.get(key);
    ACTIVIDADES_REPORTE.forEach(a => {
      const id = `${a.clave}|${f.turno || '—'}`;
      s.celdas[id] = s.celdas[id] || Array(dias).fill(0);
      s.celdas[id][f.dia - 1] += f[a.clave];
    });
  });
  const bloques = [...servicios.values()].sort((a, b) => a.upss.localeCompare(b.upss, 'es') || a.nombre.localeCompare(b.nombre, 'es')).map(s => ({
    upss: s.upss,
    servicio: s.nombre,
    ups: s.ups,
    actividades: ACTIVIDADES_REPORTE.map(a => ({
      titulo: a.titulo,
      turnos: turnosOrden.map(t => {
        const valores = s.celdas[`${a.clave}|${t}`] || Array(dias).fill(0);
        return { turno: t, valores, total: valores.reduce((x, y) => x + y, 0) };
      })
    }))
  }));
  const totales = ACTIVIDADES_REPORTE.map((a, i) => {
    const valores = Array(dias).fill(0);
    bloques.forEach(b => b.actividades[i].turnos.forEach(t => t.valores.forEach((v, d) => { valores[d] += v; })));
    return { titulo: a.titulo, valores, total: valores.reduce((x, y) => x + y, 0) };
  });
  // Filas planas como en el modelo F40: UPSS | SERVICIO | ACTIVIDADES | TURNO | días | TOTAL.
  // UPSS y SERVICIO se escriben solo en la primera fila de su grupo (luego se combinan hacia abajo).
  const filas = [];
  let upssAnterior = null;
  bloques.forEach(b => {
    let primeraDelServicio = true;
    b.actividades.forEach(a => a.turnos.forEach(t => {
      const nuevaUpss = primeraDelServicio && (upssAnterior === null || b.upss !== upssAnterior || b.upss === '');
      filas.push({ upss: nuevaUpss ? (b.upss || '-') : '', servicio: primeraDelServicio ? b.servicio : '', actividad: a.titulo, turno: t.turno, valores: t.valores, total: t.total });
      upssAnterior = b.upss;
      primeraDelServicio = false;
    }));
  });
  totales.forEach((t, i) => filas.push({ upss: i === 0 ? 'TOTAL DEL MES' : '', servicio: '', actividad: t.titulo, turno: '', valores: t.valores, total: t.total, esTotal: true }));
  return { dias, bloques, totales, filas };
}

// Cantidad de filas que abarca cada valor de UPSS o SERVICIO (para combinar celdas hacia abajo).
// Un valor nuevo en una columna anterior corta la combinación de las columnas siguientes.
function spansReporte(filas, claves) {
  const spans = filas.map(() => ({}));
  claves.forEach((clave, k) => {
    let inicio = -1;
    filas.forEach((fila, r) => {
      const corta = claves.slice(0, k).some(prev => fila[prev] !== '');
      if (fila[clave] !== '') { inicio = r; spans[r][clave] = 1; return; }
      if (corta) inicio = -1;
      if (inicio >= 0) { spans[inicio][clave] += 1; spans[r][clave] = 0; }
    });
  });
  return spans;
}

function encabezadoReporteMensual(data) {
  if (data.paciente) {
    const p = data.paciente;
    const nombre = [p.Apellido_Paterno_Paciente, p.Apellido_Materno_Paciente, p.Nombres_Paciente].map(v => String(v ?? '').trim()).filter(Boolean).join(' ');
    const servicios = [...new Set(data.filas.map(f => f.servicio).filter(Boolean))];
    const est = data.establecimiento;
    return {
      nombre,
      datos: [
        ['Año', data.anio], ['Mes', MESES_NOMBRE[data.mes - 1].toUpperCase()],
        ['Establecimiento', est ? `${est.renipress ? `${String(est.renipress).padStart(8, '0')} - ` : ''}${est.nombre || est.id}` : null],
        ['Paciente', nombre], ['DNI', p.Numero_Documento_Paciente], ['Historia clínica', p.Historia_Clinica],
        ['Fecha de nacimiento', p.Fecha_Nacimiento_Paciente ? formatIsoDate(String(p.Fecha_Nacimiento_Paciente).slice(0, 10)) : null],
        ['Sexo', SEXO[String(p.Id_Genero ?? '').trim()] || p.Id_Genero], ['Servicios', servicios.join(', ')]
      ]
    };
  }
  const p = data.personal || {};
  const nombre = [p.Apellido_Paterno_Personal, p.Apellido_Materno_Personal, p.Nombres_Personal].filter(Boolean).join(' ');
  const servicios = [...new Set(data.filas.map(f => f.servicio).filter(Boolean))];
  const est = data.establecimiento;
  return {
    nombre,
    // Mismo orden del modelo F40: año, mes y establecimiento; luego el profesional; luego especialidad y colegiatura.
    datos: [
      ['Año', data.anio], ['Mes', MESES_NOMBRE[data.mes - 1].toUpperCase()],
      ['Establecimiento', est ? `${est.renipress ? `${String(est.renipress).padStart(8, '0')} - ` : ''}${est.nombre || est.id}` : null],
      ['Condición', p.Condicion],
      ['DNI', p.Numero_Documento_Personal], ['Personal de salud', nombre], ['Profesión', p.Profesion],
      ['Especialidad', servicios.join(', ')], ['CMP / colegiatura', p.Numero_Colegiatura], ['Colegio', p.Colegio]
    ]
  };
}

function renderReporteMensual(data) {
  const cfg = RM_TIPOS[tipoReporteMensual(data)];
  const target = document.getElementById(`${cfg.pre}Resultado`);
  const { dias, totales, filas } = armarReporteMensual(data);
  const head = encabezadoReporteMensual(data);
  const spans = spansReporte(filas, ['upss', 'servicio']);
  const domingo = d => new Date(Date.UTC(data.anio, data.mes - 1, d)).getUTCDay() === 0;
  const celdas = vals => vals.map((v, i) => `<td class="rm-num${domingo(i + 1) ? ' rm-sun' : ''}">${v || '<span class="rm-zero">-</span>'}</td>`).join('');
  const encabezadoDias = Array.from({ length: dias }, (_, i) => `<th class="rm-num${domingo(i + 1) ? ' rm-sun' : ''}">${i + 1}</th>`).join('');
  const cuerpo = filas.map((f, r) => {
    const sp = spans[r];
    const upss = sp.upss ? `<th class="rm-upss" rowspan="${sp.upss}"${f.esTotal ? ' colspan="2"' : ''}>${esc(f.upss)}</th>` : '';
    const servicio = !f.esTotal && sp.servicio ? `<th class="rm-serv" rowspan="${sp.servicio}">${esc(f.servicio)}</th>` : '';
    const inicioGrupo = (!f.esTotal && sp.servicio) || (f.esTotal && sp.upss);
    return `<tr class="${f.esTotal ? 'rm-grand' : ''}${inicioGrupo ? ' rm-group-start' : ''}">${upss}${servicio}<td class="rm-act">${esc(f.actividad)}</td><td class="rm-turno">${esc(f.turno || '')}</td>${celdas(f.valores)}<td class="rm-num rm-total">${f.total}</td></tr>`;
  }).join('');

  exportadores[cfg.exportador] = (formato, boton) => exportarReporteMensual(formato, boton, data);
  target.innerHTML = `
    <dl class="rm-head">${head.datos.filter(([, v]) => v).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    ${data.filas.length ? `<div class="result-toolbar"><p class="result-summary">Atenciones: ${formatNumber(totales[0].total)} · Aten. con proc.: ${formatNumber(totales[1].total)} · Procedimientos CPMS: ${formatNumber(totales[2].total)}</p>${botonesExportarHtml(cfg.exportador)}</div>
    <div class="table-wrap rm-wrap"><table class="rm-table">
      <thead><tr><th>UPSS</th><th>SERVICIO</th><th>ACTIVIDADES</th><th>TURNO</th>${encabezadoDias}<th class="rm-num">TOTAL</th></tr></thead>
      <tbody>${cuerpo}</tbody>
    </table></div>
    <ul class="rm-notes">${NOTAS_REPORTE.map(n => `<li>${esc(n)}</li>`).join('')}</ul>`
    : `<div class="table-empty">${cfg.vacio}</div>`}`;
}

function exportarReporteMensual(formato, boton, data) {
  const cfg = RM_TIPOS[tipoReporteMensual(data)];
  const { dias, filas } = armarReporteMensual(data);
  const head = encabezadoReporteMensual(data);
  return exportarDocumento(formato, {
    titulo: cfg.exportTitulo,
    datos: head.datos,
    archivo: `${cfg.archivo}-${data.anio}-${String(data.mes).padStart(2, '0')}-${head.nombre}`,
    orientacion: 'landscape',
    notas: NOTAS_REPORTE,
    secciones: [{
      titulo: `${MESES_NOMBRE[data.mes - 1]} ${data.anio}`,
      hoja: `${MESES_NOMBRE[data.mes - 1]} ${data.anio}`,
      estilo: 'f40',
      combinar: [0, 1],
      resaltarTotal: true,
      totalDesde: filas.findIndex(f => f.esTotal),
      ocultarConteo: true,
      columnas: [{ titulo: 'UPSS', ancho: 16, alinear: 'center' }, { titulo: 'SERVICIO', ancho: 18, alinear: 'center' }, { titulo: 'ACTIVIDADES', ancho: 24 }, { titulo: 'TURNO', ancho: 7, alinear: 'center' },
        ...Array.from({ length: dias }, (_, i) => ({ titulo: String(i + 1), tipo: 'numero', ancho: 4.5, alinear: 'center' })), { titulo: 'TOTAL', tipo: 'numero', ancho: 8, alinear: 'center' }],
      filas: filas.map(f => [f.upss, f.servicio, f.actividad, f.turno, ...f.valores.map(v => v || '-'), f.total])
    }]
  }, boton);
}

// ── Atenciones ──
// Atenciones cargadas en cada ficha y el rango de fechas elegido para verlas y exportarlas.
const fichaAtenciones = {};

function renderAtencionesFicha(target) {
  const estado = fichaAtenciones[target];
  const box = document.getElementById(target);
  if (!estado || !box) return;
  const { rows, contexto, desde, hasta } = estado;
  if (!rows.length) { box.innerHTML = '<div class="table-empty">No hay atenciones registradas.</div>'; return; }
  const filtradas = filtrarAtencionesPorFecha(rows, { desde, hasta });
  const fechas = rows.map(fechaAtencionDe).filter(Boolean).sort();
  const filtroActivo = desde || hasta;
  // En la ficha del personal no hay filtro de fechas: para eso está su búsqueda avanzada.
  const conFiltroFecha = contexto !== 'personal';
  // Arriba, el filtro de fechas (en la ficha del paciente); debajo, el historial compartido con su búsqueda y exportación.
  box.innerHTML = `${conFiltroFecha ? `<div class="ficha-filter ate-toolbar">
      <div class="ate-tool-group">
        <span class="ate-tool-title">Filtrar por fecha</span>
        <div class="ate-tool-row">
          <label class="label">Desde<input class="input" type="date" data-ff="desde" value="${esc(desde)}" min="${fechas[0] || ''}" max="${fechas[fechas.length - 1] || ''}"></label>
          <label class="label">Hasta<input class="input" type="date" data-ff="hasta" value="${esc(hasta)}" min="${fechas[0] || ''}" max="${fechas[fechas.length - 1] || ''}"></label>
          <button type="button" class="btn btn-primary btn-sm" data-ff="aplicar">Aplicar</button>
          ${filtroActivo ? '<button type="button" class="btn btn-secondary btn-sm" data-ff="quitar">Ver todas</button>' : ''}
        </div>
      </div>
    </div>` : ''}
    ${filtroActivo ? `<p class="result-summary">${esc(describirFiltroFecha({ desde, hasta }))} ${formatNumber(filtradas.length)} de ${formatNumber(rows.length)} registro(s).</p>` : ''}
    ${filtradas.length ? `<div id="${target}Hist"></div>` : '<div class="table-empty">No hay atenciones en ese periodo.</div>'}`;
  if (filtradas.length) {
    histMontar(`${target}Hist`, filtradas, {
      contexto,
      avisoHtml: rows.length >= 1000 ? '<p class="ps-tip">Se muestran las 1 000 anotaciones más recientes.</p>' : '',
      exportar: { clave: target, titulo: estado.titulo, datos: estado.datos, archivo: estado.archivo, filtroBase: () => ({ desde: estado.desde, hasta: estado.hasta }) }
    });
  }
  box.querySelector('[data-ff="aplicar"]')?.addEventListener('click', () => {
    const nuevoDesde = box.querySelector('[data-ff="desde"]').value;
    const nuevoHasta = box.querySelector('[data-ff="hasta"]').value;
    if (nuevoDesde && nuevoHasta && nuevoDesde > nuevoHasta) { toast('La fecha «Desde» no puede ser posterior a «Hasta».', 'error'); return; }
    Object.assign(estado, { desde: nuevoDesde, hasta: nuevoHasta });
    renderAtencionesFicha(target);
  });
  box.querySelector('[data-ff="quitar"]')?.addEventListener('click', () => {
    Object.assign(estado, { desde: '', hasta: '' });
    renderAtencionesFicha(target);
  });
}

async function cargarAtencionesFicha(button, path, target, contexto, titulo = 'Atenciones', datos = []) {
  const seq = ++searchSeq.ficha;
  button.disabled = true;
  document.getElementById(target).innerHTML = '<div class="table-empty">Cargando atenciones…</div>';
  try {
    const rows = await apiFetch(path);
    if (seq !== searchSeq.ficha) return;
    fichaAtenciones[target] = { rows, contexto, desde: '', hasta: '', titulo, datos, archivo: contexto === 'paciente' ? 'atenciones-paciente' : 'atenciones-personal' };
    renderAtencionesFicha(target);
    button.textContent = 'Actualizar atenciones';
    button.classList.replace('btn-primary', 'btn-secondary');
  } catch (error) {
    document.getElementById(target).innerHTML = `<div class="table-empty">${esc(error.message || 'No se pudieron consultar las atenciones.')}</div>`;
  } finally {
    button.disabled = false;
  }
}

async function buscarAtenciones() {
  const q = gv('qAtenciones');
  const desde = gv('desdeAtenciones');
  const hasta = gv('hastaAtenciones');
  if (!q && !desde && !hasta) { toast('Escribe un dato o elige un rango de fechas.', 'info'); document.getElementById('qAtenciones').focus(); return; }
  if (desde && hasta && desde > hasta) { toast('La fecha «Desde» no puede ser posterior a «Hasta».', 'error'); return; }
  const params = new URLSearchParams({ modo: 'todos', q });
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);
  const seq = ++searchSeq.atenciones;
  estadoBusqueda('resAtenciones', 'Buscando atenciones…');
  try {
    const rows = await apiFetch(`/busqueda/atenciones?${params}`);
    if (seq !== searchSeq.atenciones) return;
    const el = document.getElementById('resAtenciones');
    if (!rows.length) { estadoBusqueda('resAtenciones', 'No se encontraron atenciones con esos datos.'); return; }
    el.innerHTML = `<p class="result-summary">${formatNumber(rows.length)} registro(s)${rows.length >= 200 ? ' · se muestran los 200 más recientes; acota con fechas o un dato más específico' : ''}</p><div id="resAtencionesHist"></div>`;
    histMontar('resAtencionesHist', rows, {
      contexto: 'busqueda',
      exportar: {
        clave: 'atenciones', titulo: 'Reporte de atenciones', archivo: 'atenciones',
        datos: [['Búsqueda', q], ['Desde', desde ? formatIsoDate(desde) : null], ['Hasta', hasta ? formatIsoDate(hasta) : null], rows.length >= 200 ? ['Nota', 'Se incluyen las 200 atenciones más recientes'] : null].filter(Boolean)
      }
    });
  } catch (error) {
    if (seq === searchSeq.atenciones) estadoBusqueda('resAtenciones', error.message || 'No se pudo buscar.', 'error');
  }
}

// Insignia del tipo de diagnóstico (la usa la búsqueda nominal).
const DX_TIPOS = { D: ['Definitivo', 'dx-d'], P: ['Presuntivo', 'dx-p'], R: ['Repetido', 'dx-r'] };
function dxBadgeHtml(dx) {
  if (!dx) return '<span class="ate-dx ate-dx-vacio">—</span>';
  const [nombre, clase] = DX_TIPOS[dx.toUpperCase()] || [dx, 'dx-r'];
  return `<span class="ate-dx ${clase}" title="Tipo de diagnóstico: ${esc(nombre)}">${esc(dx)}</span>`;
}

// El detalle de una atención (verAtencion) está en js/atencion-detalle.js.

// ── Defunciones: ver js/defunciones.js ──

// Formularios: Enter o «Buscar» envían; «Limpiar» borra el texto, las fechas y los resultados.
function setupBusquedas() {
  const forms = {
    formPacientes: [buscarPacientes, 'resPacientes'],
    formAtenciones: [buscarAtenciones, 'resAtenciones'],
    formDefunciones: [buscarDefunciones, 'resDefunciones']
  };
  Object.entries(forms).forEach(([formId, [buscar, resultId]]) => {
    const form = document.getElementById(formId);
    if (!form) return;
    form.addEventListener('submit', event => { event.preventDefault(); buscar(); });
    form.addEventListener('reset', () => {
      document.getElementById(resultId).innerHTML = '';
      setTimeout(() => form.querySelector('input[type="search"]').focus(), 0);
    });
  });
}

// ── Catálogos (tablas maestras del HIS) ──
// Tarjetas con cada catálogo y su número de registros; al abrir uno se muestran hasta 500 filas y se puede buscar.
const catalogoState = { lista: [], actual: null, datos: null, seq: 0 };

function iconoCatalogo(tabla) {
  const t = tabla.toUpperCase();
  const paths = t.includes('CIE') ? '<path d="M9 12h6m-6 4h6M7 3h7l5 5v11a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2z"/>'
    : t.includes('ESTABLECIMIENTO') ? '<path d="M4 21V5a2 2 0 012-2h12a2 2 0 012 2v16M2 21h20M10 7h4M12 5v4M9 21v-5h6v5"/>'
    : t.includes('UPS') ? '<path d="M4 12h4l2-6 4 12 2-6h4"/>'
    : t.includes('LAB') ? '<path d="M9 3h6M10 3v6l-5 9a2 2 0 001.8 3h10.4a2 2 0 001.8-3l-5-9V3"/>'
    : t.includes('UBIGEO') || t.includes('CENTRO_POBLADO') || t.includes('PAIS') ? '<path d="M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>'
    : t.includes('PROFESION') || t.includes('COLEGIO') || t.includes('INSTITUCION') ? '<path d="M3 9l9-5 9 5-9 5-9-5zM7 11.5V16c0 1.5 2.2 3 5 3s5-1.5 5-3v-4.5"/>'
    : t.includes('REGISTRADOR') || t.includes('TIPO_DOC') ? '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="12" r="2.5"/><path d="M14 10h4M14 14h4"/>'
    : '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3"/>';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">${paths}</svg>`;
}

async function cargarCatalogos() {
  const grid = document.getElementById('catalogGrid');
  if (catalogoState.lista.length) { renderTarjetasCatalogos(); return; }
  try {
    catalogoState.lista = await apiFetch('/catalogos');
    renderTarjetasCatalogos();
  } catch (error) {
    grid.innerHTML = `<div class="card search-state search-state-error">${esc(error.message || 'No se pudo consultar la lista de catálogos.')}</div>`;
  }
}

function renderTarjetasCatalogos() {
  const grid = document.getElementById('catalogGrid');
  const filtro = normalizeText(gv('filtroCatalogos'));
  const lista = catalogoState.lista.filter(item => !filtro || normalizeText(`${item.titulo} ${item.descripcion} ${item.tabla}`).includes(filtro));
  if (!lista.length) { grid.innerHTML = '<div class="card search-state">Ningún catálogo coincide con el filtro.</div>'; return; }
  grid.innerHTML = lista.map(item => {
    const falta = item.registros === null || item.registros === undefined;
    return `<button type="button" class="catalog-card${falta ? ' is-missing' : ''}" data-tabla="${esc(item.tabla)}">
      <span class="catalog-card-icon">${iconoCatalogo(item.tabla)}</span>
      <span class="catalog-card-body">
        <span class="catalog-card-title">${esc(item.titulo)}</span>
        <span class="catalog-card-text">${esc(item.descripcion)}</span>
        <span class="catalog-card-foot"><span class="catalog-card-table">${esc(item.tabla)}</span><span class="catalog-card-count">${falta ? 'No existe en la base' : `${formatNumber(item.registros)} registros`}</span></span>
      </span>
    </button>`;
  }).join('');
  grid.querySelectorAll('.catalog-card').forEach(card => card.addEventListener('click', () => abrirCatalogo(card.dataset.tabla)));
}

function abrirCatalogo(tabla) {
  const item = catalogoState.lista.find(c => c.tabla === tabla);
  if (!item) return;
  catalogoState.actual = item;
  document.getElementById('catTabla').textContent = item.tabla;
  document.getElementById('catTitulo').textContent = item.titulo;
  document.getElementById('catDescripcion').textContent = item.descripcion;
  sv('qCatalogo', '');
  document.getElementById('catalogosLista').hidden = true;
  document.getElementById('catalogoDetalle').hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  consultarCatalogo();
}

function cerrarCatalogo() {
  catalogoState.actual = null;
  catalogoState.datos = null;
  document.getElementById('catalogoDetalle').hidden = true;
  document.getElementById('catalogosLista').hidden = false;
}

async function consultarCatalogo() {
  const item = catalogoState.actual;
  if (!item) return;
  const target = document.getElementById('catResultado');
  const q = gv('qCatalogo');
  const seq = ++catalogoState.seq;
  target.innerHTML = '<div class="table-empty">Consultando registros…</div>';
  try {
    const data = await apiFetch(`/catalogos/${encodeURIComponent(item.tabla)}?q=${encodeURIComponent(q)}`);
    if (seq !== catalogoState.seq) return;
    catalogoState.datos = data;
    if (!data.filas.length) {
      target.innerHTML = `<div class="table-empty">${q ? 'No hay registros que coincidan con la búsqueda.' : 'El catálogo no tiene registros.'}</div>`;
      return;
    }
    const resumen = data.total > data.filas.length
      ? `Se muestran ${formatNumber(data.filas.length)} de ${formatNumber(data.total)} registros${q ? ' que coinciden' : ''}. Escribe un dato para encontrar los demás.`
      : `${formatNumber(data.total)} registro(s)${q ? ' que coinciden' : ''}.`;
    target.innerHTML = `<p class="result-summary">${resumen}</p>
      <div class="table-wrap catalog-table"><table><thead><tr>${data.columnas.map(col => `<th>${esc(fieldLabel(col))}</th>`).join('')}</tr></thead>
      <tbody>${data.filas.map(fila => `<tr>${data.columnas.map(col => `<td>${valorHtml(fila[col])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  } catch (error) {
    if (seq === catalogoState.seq) target.innerHTML = `<div class="search-state search-state-error">${esc(error.message || 'No se pudo consultar el catálogo.')}</div>`;
  }
}

// Exporta el catálogo abierto (las filas mostradas, hasta 500) con la plantilla del hospital.
exportadores.catalogo = (formato, boton) => {
  const data = catalogoState.datos;
  if (!data?.filas?.length) { toast('No hay registros para exportar.', 'info'); return; }
  const q = gv('qCatalogo');
  const registros = data.total > data.filas.length ? `${formatNumber(data.filas.length)} de ${formatNumber(data.total)}` : formatNumber(data.total);
  const tipo = col => (/fecha/i.test(col) ? 'fecha' : /^codigo|^id_/i.test(col) ? 'codigo' : 'texto');
  return exportarDocumento(formato, {
    titulo: `Catálogo de ${lcFirst(data.titulo)}`,
    datos: [['Catálogo', data.titulo], ['Tabla', data.tabla], ['Búsqueda', q || 'Todos los registros'], ['Registros', registros]],
    archivo: `catalogo-${data.tabla}`,
    secciones: [{ titulo: data.titulo, columnas: data.columnas.map(col => ({ titulo: fieldLabel(col), tipo: tipo(col) })), filas: data.filas.map(fila => data.columnas.map(col => fila[col])) }]
  }, boton);
};

function setupCatalogos() {
  document.getElementById('filtroCatalogos')?.addEventListener('input', renderTarjetasCatalogos);
  document.getElementById('limpiarFiltroCatalogos')?.addEventListener('click', () => { sv('filtroCatalogos', ''); renderTarjetasCatalogos(); });
  document.getElementById('volverCatalogos')?.addEventListener('click', cerrarCatalogo);
  const form = document.getElementById('formCatalogo');
  form?.addEventListener('submit', event => { event.preventDefault(); consultarCatalogo(); });
  form?.addEventListener('reset', () => setTimeout(consultarCatalogo, 0));
}

// ═══════════════════════════════════════
//  VENTANA MODAL
// ═══════════════════════════════════════
// Oculta el diálogo compartido; el contenido se repone al abrir el siguiente detalle.
function cerrarModal() { document.getElementById('modal').classList.remove('show'); }

// ═══════════════════════════════════════
//  IMPORTACIÓN DE ARCHIVOS PLANOS
// ═══════════════════════════════════════
// Sigue el formulario de la aplicación de escritorio HIS: una fila por archivo (Paciente, Personal,
// Registrador, Nominal) con su modo. Sube los CSV al servidor, inicia la importación y sigue su progreso.
const IMPORT_ROWS = {
  paciente: { name: 'Paciente', label: 'Paciente', table: 'MaestroPaciente' },
  personal: { name: 'Personal', label: 'Personal', table: 'MaestroPersonal' },
  registrador: { name: 'Registrador', label: 'Registrador', table: 'MaestroRegistrador' },
  nominal: { name: 'Nominal', label: 'Nominal', table: 'NProduccion' }
};
const IMPORT_MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const importState = {
  files: { paciente: [], personal: [], registrador: [], nominal: [] },
  busy: false,
  pollTimer: null,
  watchedJobId: null
};

// Expresa tamaños de archivo en KB, MB o GB.
function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1048576) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1073741824) return `${(value / 1048576).toFixed(1)} MB`;
  return `${(value / 1073741824).toFixed(2)} GB`;
}

// Expresa una duración en minutos y segundos.
function formatDuration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes} min ${seconds % 60} s` : `${seconds} s`;
}

// Modo elegido en una fila: «acumular» o «reemplazar» (en Nominal, «reemplazar» lleva el año).
function getImportMode(row) {
  const value = gv('impModo' + IMPORT_ROWS[row].name) || 'actualizar';
  if (row === 'nominal' && value.startsWith('reemplazar-')) return { modo: 'reemplazar', anio: Number(value.split('-')[1]) };
  if (row === 'nominal' && value === 'actualizar') return { modo: 'actualizar', anio: null };
  return { modo: ['reemplazar', 'acumular', 'actualizar'].includes(value) ? value : 'actualizar', anio: null };
}

// Prepara selectores y eventos de la vista; se ejecuta una sola vez al cargar la página.
function setupImportView() {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, index) => currentYear - index);
  // Maestros: las mismas opciones que Nominal; «Actualizar y acumular» es la predeterminada.
  ['Paciente', 'Personal', 'Registrador'].forEach(name => {
    document.getElementById('impModo' + name).innerHTML = '<option value="actualizar">Actualizar y acumular</option><option value="acumular">Acumular</option><option value="reemplazar">Reemplazar</option>';
  });
  document.getElementById('impModoNominal').innerHTML = '<option value="actualizar">Actualizar y acumular</option><option value="acumular">Acumular</option>'
    + years.map(year => `<option value="reemplazar-${year}">Reemplazar ${year}</option>`).join('');
  document.getElementById('impAnioResumen').innerHTML = years.map(year => `<option value="${year}">${year}</option>`).join('');

  // El botón «…» y el recuadro del nombre abren el selector de archivos de su fila.
  document.querySelectorAll('#view-importar [data-browse]').forEach(button => {
    button.addEventListener('click', () => document.getElementById(button.dataset.browse).click());
  });
  Object.keys(IMPORT_ROWS).forEach(row => {
    const name = IMPORT_ROWS[row].name;
    document.getElementById('impPath' + name).addEventListener('click', () => {
      if (!importState.busy) document.getElementById('impFile' + name).click();
    });
    document.getElementById('impFile' + name).addEventListener('change', event => {
      importState.files[row] = Array.from(event.target.files || []);
      renderImportRow(row);
      updateImportControls();
    });
    document.getElementById('impModo' + name).addEventListener('change', () => {
      document.getElementById('impConfirm').checked = false;
      if (row === 'nominal') {
        const { anio } = getImportMode('nominal');
        if (anio) {
          document.getElementById('impAnioResumen').value = String(anio);
          loadImportSummary();
        }
      }
      updateImportControls();
    });
  });
  document.getElementById('impConfirm').addEventListener('change', updateImportControls);
  document.getElementById('impAnioResumen').addEventListener('change', loadImportSummary);
  document.getElementById('impBtnImportar').addEventListener('click', startImportFromForm);
  document.getElementById('impBtnSalir').addEventListener('click', () => showView('consultas'));
  updateImportControls();
}

// Al abrir la vista, actualiza los totales y recupera una importación en curso o la última realizada.
function initImportView() {
  loadImportSummary();
  refreshImportStatus();
}

// Muestra en la fila el archivo elegido (o la cantidad de archivos, en Nominal).
function renderImportRow(row) {
  const name = IMPORT_ROWS[row].name;
  const files = importState.files[row];
  const path = document.getElementById('impPath' + name);
  const total = files.reduce((sum, file) => sum + file.size, 0);
  path.dataset.empty = files.length ? 'false' : 'true';
  path.textContent = !files.length
    ? 'Ningún archivo seleccionado'
    : files.length === 1
      ? `${files[0].name} · ${formatBytes(files[0].size)}`
      : `${files.length} archivos · ${formatBytes(total)}`;
  path.title = files.map(file => file.name).join('\n');
  path.closest('.import-row').classList.toggle('has-file', files.length > 0);

  if (row === 'nominal') {
    const list = document.getElementById('impNominalList');
    list.hidden = files.length < 2;
    list.innerHTML = files.map(file => `<li><span>${esc(file.name)}</span><span>${formatBytes(file.size)}</span></li>`).join('')
      + `<li class="import-file-total"><span>Total</span><span>${formatBytes(total)}</span></li>`;
  }
}

// Describe qué hará cada fila con archivo, pide confirmación si algo se reemplaza y habilita «Importar».
function updateImportControls() {
  const busy = importState.busy;
  const plan = [];
  const replacements = [];
  Object.entries(IMPORT_ROWS).forEach(([row, info]) => {
    const { modo, anio } = getImportMode(row);
    document.getElementById('impModo' + info.name).classList.toggle('replace', modo === 'reemplazar');
    const files = importState.files[row];
    if (!files.length) return;
    let text;
    if (row === 'nominal') {
      const count = `${files.length} archivo${files.length === 1 ? '' : 's'}`;
      text = modo === 'reemplazar'
        ? `borra toda la producción ${anio} de ${info.table} y la carga de nuevo desde ${count}.`
        : modo === 'actualizar'
          ? `las atenciones (Id_Cita) de ${count} que ya estén en ${info.table} se reemplazan por la versión del archivo y las nuevas se agregan. Lo demás no cambia.`
          : `agrega los registros de ${count} a ${info.table} sin borrar nada. Si un mes ya estaba cargado, quedará duplicado.`;
      if (modo === 'reemplazar') replacements.push(`la producción ${anio}`);
    } else {
      text = {
        reemplazar: `vacía ${info.table} y lo carga completo desde ${files[0].name}.`,
        actualizar: `los registros que ya están en ${info.table} se actualizan con la versión del archivo y los nuevos se agregan, sin duplicados.`,
        acumular: `solo agrega a ${info.table} los registros nuevos; los que ya existen no se modifican.`
      }[modo];
      if (modo === 'reemplazar') replacements.push(`todo ${info.table}`);
    }
    const modeName = { reemplazar: 'Reemplazar', actualizar: 'Actualizar y acumular', acumular: 'Acumular' }[modo];
    plan.push(`<li class="${modo === 'reemplazar' ? 'replace' : ''}"><strong>${esc(info.label)} · ${modeName}:</strong> ${esc(text)}</li>`);
  });

  document.getElementById('impPlan').hidden = !plan.length;
  document.getElementById('impPlanList').innerHTML = plan.join('');
  const confirmBox = document.getElementById('impConfirmBox');
  const confirm = document.getElementById('impConfirm');
  confirmBox.hidden = !replacements.length;
  if (!replacements.length) confirm.checked = false;
  document.getElementById('impConfirmText').textContent = `Entiendo que se borrará ${replacements.join(' y ')} antes de cargar los archivos.`;

  document.getElementById('impBtnImportar').disabled = busy || !plan.length || (replacements.length > 0 && !confirm.checked);
  document.querySelectorAll('#view-importar .import-panel input, #view-importar .import-panel select, #view-importar .import-browse').forEach(control => { control.disabled = busy; });
  document.getElementById('impBtnSalir').disabled = false;
}

// Vacía las filas y vuelve todos los modos a «Acumular» después de una importación exitosa,
// para que un «Reemplazar» no se repita por descuido.
function clearImportFiles() {
  Object.keys(IMPORT_ROWS).forEach(row => {
    importState.files[row] = [];
    document.getElementById('impFile' + IMPORT_ROWS[row].name).value = '';
    document.getElementById('impModo' + IMPORT_ROWS[row].name).value = 'actualizar';
    renderImportRow(row);
  });
  document.getElementById('impConfirm').checked = false;
  updateImportControls();
}

// Consulta los totales de cada tabla y la producción del año elegido por mes.
async function loadImportSummary() {
  const year = gv('impAnioResumen') || String(new Date().getFullYear());
  const showTotal = (id, value) => {
    document.getElementById(id).textContent = value === null ? 'Sin tabla' : formatNumber(value);
  };
  document.getElementById('impKpiAnio').textContent = year;
  try {
    const data = await apiFetch(`/importacion/resumen?anio=${encodeURIComponent(year)}`);
    if (gv('impAnioResumen') !== String(data.nominal.anio)) return;
    showTotal('impTotalPaciente', data.maestros.MaestroPaciente);
    showTotal('impTotalPersonal', data.maestros.MaestroPersonal);
    showTotal('impTotalRegistrador', data.maestros.MaestroRegistrador);
    showTotal('impTotalNominal', data.nominal.total);
    const body = document.querySelector('#impMesesTabla tbody');
    body.innerHTML = data.nominal.meses.length
      ? data.nominal.meses.map(row => `<tr><td>${esc(IMPORT_MONTHS[row.mes - 1] || 'Sin mes')}</td><td>${formatNumber(row.total)}</td></tr>`).join('')
        + `<tr><td><strong>Total</strong></td><td><strong>${formatNumber(data.nominal.total)}</strong></td></tr>`
      : `<tr><td colspan="2" class="table-empty">No hay producción registrada para ${esc(year)}.</td></tr>`;
  } catch (error) {
    document.querySelector('#impMesesTabla tbody').innerHTML = `<tr><td colspan="2" class="table-empty">${esc(error.message)}</td></tr>`;
  }
}

// Sube un archivo como cuerpo binario e informa el avance; fetch no permite medir la subida, por eso se usa XMLHttpRequest.
function uploadImportFile(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${apiUrl.replace(/\/$/, '')}/importacion/archivos?nombre=${encodeURIComponent(file.name)}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(event.loaded); };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* respuesta sin JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
      if (xhr.status === 401 && currentUser) {
        returnToLogin();
        const loginStatus = document.getElementById('loginStatus');
        loginStatus.textContent = 'Tu sesión venció. Inicia sesión nuevamente.';
        loginStatus.hidden = false;
      }
      reject(new Error(data.message || `No se pudo subir ${file.name} (HTTP ${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error(`Se perdió la conexión con el servidor al subir ${file.name}.`));
    xhr.send(file);
  });
}

// Pinta el panel de progreso a partir de un estado parcial (subida) o de un trabajo del servidor.
function setImportStatus({ badge, badgeClass, meta = '', phase, percent = null, progressText = '', rowsText = '', alert = null, log = null }) {
  document.getElementById('impStatusCard').hidden = false;
  const badgeEl = document.getElementById('impStatusBadge');
  badgeEl.textContent = badge;
  badgeEl.className = `import-badge ${badgeClass}`;
  document.getElementById('impStatusMeta').textContent = meta;
  document.getElementById('impPhase').textContent = phase;
  const progress = document.getElementById('impProgress');
  progress.classList.toggle('indeterminate', percent === null);
  if (percent === null) progress.removeAttribute('aria-valuenow');
  else progress.setAttribute('aria-valuenow', String(Math.round(percent)));
  document.getElementById('impProgressBar').style.width = percent === null ? '' : `${Math.min(100, Math.max(0, percent))}%`;
  document.getElementById('impProgressText').textContent = progressText;
  document.getElementById('impRowsText').textContent = rowsText;
  const alertEl = document.getElementById('impResultAlert');
  alertEl.className = alert ? `alert show alert-${alert.type}` : 'alert';
  alertEl.textContent = alert ? alert.text : '';
  if (log) {
    const logEl = document.getElementById('impLog');
    logEl.innerHTML = log.map(entry => `<li class="${esc(entry.nivel)}"><time>${esc(new Date(entry.hora).toLocaleTimeString('es-PE'))}</time><span>${esc(entry.mensaje)}</span></li>`).join('');
    logEl.scrollTop = logEl.scrollHeight;
  }
}

// Resume en una frase el resultado de cada tabla importada.
function describeImportResult(item) {
  if (item.tipo === 'nominal' && item.modo === 'actualizar') {
    return `Producción nominal actualizada: ${formatNumber(item.citasActualizadas)} atenciones reemplazadas y ${formatNumber(item.citasNuevas)} nuevas (${formatNumber(item.cargados)} registros cargados, ${formatNumber(item.eliminados)} registros anteriores retirados).`;
  }
  if (item.tipo === 'nominal') {
    return item.modo === 'reemplazar'
      ? `Producción ${item.anio}: se eliminaron ${formatNumber(item.eliminados)} registros y se cargaron ${formatNumber(item.cargados)}.`
      : `Producción nominal: se agregaron ${formatNumber(item.cargados)} registros.`;
  }
  if (item.modo === 'reemplazar') return `${item.etiqueta}: reemplazado con ${formatNumber(item.insertados)} registros.`;
  if (item.modo === 'acumular') return `${item.etiqueta}: ${formatNumber(item.agregados)} nuevos agregados; ${formatNumber(item.omitidos)} ya existían y no se modificaron (total ${formatNumber(item.totalTabla)}).`;
  return `${item.etiqueta}: ${formatNumber(item.agregados)} nuevos y ${formatNumber(item.actualizados)} actualizados (total ${formatNumber(item.totalTabla)}).`;
}

// Traduce el trabajo devuelto por la API al panel de progreso.
function renderImportJob(job) {
  const running = job.estado === 'en_proceso';
  const started = new Date(job.inicio);
  const elapsed = (job.fin ? new Date(job.fin) : new Date()) - started;
  const reading = job.bytesTotal ? job.bytesProcesados / job.bytesTotal * 100 : 0;
  let alert = null;
  if (job.estado === 'completado') alert = { type: 'ok', text: job.resultados.map(describeImportResult).join(' ') };
  else if (job.estado === 'error') alert = { type: 'error', text: job.error };
  setImportStatus({
    badge: running ? 'En proceso' : job.estado === 'completado' ? 'Completada' : 'Con error',
    badgeClass: running ? 'running' : job.estado === 'completado' ? 'done' : 'failed',
    meta: `${job.descripcion} · iniciada por ${job.usuario} el ${started.toLocaleString('es-PE')} · ${running ? 'en curso hace' : 'duración'} ${formatDuration(elapsed)}`,
    phase: job.fase,
    percent: running && (reading <= 0 || reading >= 100) ? null : (running ? reading : 100),
    progressText: job.bytesTotal ? `${formatBytes(job.bytesProcesados)} de ${formatBytes(job.bytesTotal)} leídos` : '',
    rowsText: `${formatNumber(job.filasInsertadas)} registros cargados`,
    alert,
    log: job.log
  });
}

function stopImportPolling() {
  clearTimeout(importState.pollTimer);
  importState.pollTimer = null;
}

// Consulta el estado en el servidor; mientras la importación siga en curso, vuelve a consultar cada 1,5 s.
async function refreshImportStatus() {
  stopImportPolling();
  if (!currentUser || currentUser.role !== 'admin') return;
  let job;
  try {
    ({ trabajo: job } = await apiFetch('/importacion/estado'));
  } catch (error) {
    if (importState.busy && currentUser) importState.pollTimer = setTimeout(refreshImportStatus, 4000);
    return;
  }
  if (!job) return;
  renderImportJob(job);

  if (job.estado === 'en_proceso') {
    importState.busy = true;
    importState.watchedJobId = job.id;
    updateImportControls();
    importState.pollTimer = setTimeout(refreshImportStatus, 1500);
    return;
  }

  if (importState.watchedJobId === job.id) {
    importState.watchedJobId = null;
    if (job.estado === 'completado') {
      toast('Importación completada', 'success');
      clearImportFiles();
    } else {
      toast('La importación no se completó', 'error');
    }
    loadImportSummary();
  }
  importState.busy = false;
  updateImportControls();
}

// Botón «Importar»: sube los archivos de todas las filas y, cuando están en el servidor, inicia la importación.
async function startImportFromForm() {
  const rows = Object.keys(IMPORT_ROWS).filter(row => importState.files[row].length);
  if (!rows.length) return;
  const confirmed = document.getElementById('impConfirm').checked;
  const encoding = gv('impEncoding');
  const queue = rows.flatMap(row => importState.files[row].map(file => ({ row, file })));

  importState.busy = true;
  updateImportControls();
  stopImportPolling();
  const totalBytes = queue.reduce((sum, item) => sum + item.file.size, 0) || 1;
  const uploaded = [];
  let sentBefore = 0;
  const uploadStatus = (phase, sent) => setImportStatus({
    badge: 'Subiendo', badgeClass: 'running', meta: 'Subiendo los archivos al servidor', phase,
    percent: sent / totalBytes * 100,
    progressText: `${formatBytes(sent)} de ${formatBytes(totalBytes)} subidos`,
    rowsText: `${uploaded.length} de ${queue.length} archivo${queue.length === 1 ? '' : 's'}`,
    log: []
  });

  try {
    for (const item of queue) {
      uploadStatus(`Subiendo ${item.file.name}`, sentBefore);
      const result = await uploadImportFile(item.file, loaded => uploadStatus(`Subiendo ${item.file.name}`, sentBefore + loaded));
      uploaded.push({ row: item.row, id: result.id });
      sentBefore += item.file.size;
    }

    const archivos = {};
    for (const row of rows) {
      const ids = uploaded.filter(item => item.row === row).map(item => item.id);
      const { modo, anio } = getImportMode(row);
      archivos[row] = row === 'nominal' ? { ids, modo, anio } : { id: ids[0], modo };
    }
    const job = await apiFetch('/importacion/ejecutar', {
      method: 'POST',
      body: JSON.stringify({ archivos, codificacion: encoding, confirmacion: confirmed })
    });
    importState.watchedJobId = job.id;
    renderImportJob(job);
    importState.pollTimer = setTimeout(refreshImportStatus, 1000);
  } catch (error) {
    uploaded.forEach(item => apiFetch(`/importacion/archivos/${encodeURIComponent(item.id)}`, { method: 'DELETE' }).catch(() => {}));
    importState.busy = false;
    updateImportControls();
    if (!currentUser) return;
    setImportStatus({ badge: 'Con error', badgeClass: 'failed', meta: 'La importación no se inició', phase: 'No se modificó la base de datos', percent: 0, alert: { type: 'error', text: error.message }, log: [] });
    toast(error.message, 'error');
  }
}


// ═══════════════════════════════════════
//  INICIO
// ═══════════════════════════════════════
// Convierte «AAAA-MM-DD…» en una fecha local. new Date('2026-10-16') se interpreta en UTC y en Perú mostraría el día anterior.
function parseLocalDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date(value);
}

const HOME_MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const HOME_MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// Meses con citas, el mes elegido en el gráfico y la fecha de la última atención registrada.
let homeMonths = [];
let homeSelectedIdx = -1;
let homeUltimaAtencionFecha = '';

// Buscador de pacientes y accesos directos
function setupHomeView() {
  const form = document.getElementById('homeSearchForm');
  if (form && !form.dataset.bound) {
    form.dataset.bound = 'true';
    form.addEventListener('submit', event => {
      event.preventDefault();
      const texto = gv('homeSearchInput');
      showView('pacientes');
      if (texto) buscarPacienteSimple(texto);
    });
  }

  const btnReset = document.getElementById('homeBtnResetMes');
  if (btnReset && !btnReset.dataset.bound) {
    btnReset.dataset.bound = 'true';
    btnReset.addEventListener('click', () => {
      if (homeMonths.length) {
        selectHomeMonth(homeMonths.length - 1);
      }
    });
  }

  document.getElementById('homeBtnVerProduccion')?.addEventListener('click', event => {
    irAProduccionMes(event.currentTarget.dataset.anio, event.currentTarget.dataset.mes);
  });

  // Los enlaces (#pacientes) también se pueden abrir en otra pestaña; aquí se navega sin recargar.
  document.querySelectorAll('#view-inicio [data-go]').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      showView(button.dataset.go);
    });
  });
}

// Saludo, cifras generales y citas por mes (mismos datos del resumen analítico del dashboard)
async function cargarInicio() {
  const hour = new Date().getHours();
  const firstName = String(currentUser?.fullName || currentUser?.username || '').trim().split(/\s+/)[0] || '';
  const greeting = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
  const greetEl = document.getElementById('homeGreeting');
  if (greetEl) {
    greetEl.textContent = firstName ? `${greeting}, ${firstName}` : greeting;
  }

  const impLink = document.getElementById('homeImportar');
  if (impLink) {
    impLink.hidden = currentUser?.role !== 'admin';
  }

  try {
    const data = await apiFetch('/consultas/dashboard');
    const resumen = data.resumen || {};
    homeUltimaAtencionFecha = resumen.ultimaAtencion || '';

    const elPac = document.getElementById('homePacientes');
    if (elPac) elPac.textContent = formatNumber(resumen.pacientesRegistrados || 0);

    const elAte = document.getElementById('homeAtenciones');
    if (elAte) elAte.textContent = formatNumber(resumen.atenciones || 0);

    // Citas por mes ordenadas cronológicamente
    homeMonths = (Array.isArray(data.evolucion) ? data.evolucion : [])
      .filter(row => /^\d{4}-\d{2}$/.test(String(row.label || '')))
      .sort((x, y) => String(x.label).localeCompare(String(y.label)))
      .map(row => ({ label: row.label, value: Number(row.value) || 0 }));

    homeSelectedIdx = homeMonths.length - 1;

    // Actualiza freshness
    const elFresh = document.getElementById('homeFreshness');
    if (resumen.ultimaAtencion) {
      const last = parseLocalDate(resumen.ultimaAtencion);
      if (elFresh) {
        elFresh.textContent = `Datos actualizados hasta el ${last.getDate()} de ${HOME_MONTHS_LONG[last.getMonth()]} de ${last.getFullYear()}`;
      }
    } else {
      if (elFresh) {
        elFresh.textContent = 'Todavía no hay producción registrada. Usa «Importar datos» para cargarla.';
      }
    }

    renderHomeResumenMes(homeMonths, homeSelectedIdx);
    renderHomeChart(homeMonths, homeSelectedIdx);
  } catch (error) {
    const elFresh = document.getElementById('homeFreshness');
    if (elFresh) {
      elFresh.textContent = 'No se pudieron consultar los datos. Revisa la conexión con la API en Configuración.';
    }
    const chartEl = document.getElementById('homeChart');
    if (chartEl) {
      chartEl.innerHTML = `<div class="table-empty">${esc(error.message || 'Error de conexión')}</div>`;
    }
  }
}

// Cambia el mes seleccionado de forma reactiva y actualiza la tarjeta superior y el gráfico
function selectHomeMonth(index) {
  if (!homeMonths.length || index < 0 || index >= homeMonths.length) return;
  homeSelectedIdx = index;
  renderHomeResumenMes(homeMonths, homeSelectedIdx);

  // Actualiza clases y atributos en las barras existentes sin recargar todo el DOM
  const barCols = document.querySelectorAll('#homeChart .home-bar-col');
  barCols.forEach((col, idx) => {
    const isSelected = idx === homeSelectedIdx;
    const isLast = idx === homeMonths.length - 1;
    col.classList.toggle('is-selected', isSelected);
    col.setAttribute('aria-pressed', String(isSelected));
    const valEl = col.querySelector('.home-bar-value');
    if (valEl) {
      valEl.textContent = isSelected || isLast ? formatNumber(homeMonths[idx].value) : '';
    }
  });

  // Actualiza la nota y el badge de estado del gráfico
  const selected = homeMonths[homeSelectedIdx];
  const [anio, mes] = selected.label.split('-').map(Number);
  const isLast = homeSelectedIdx === homeMonths.length - 1;
  const noteEl = document.getElementById('homeChartNote');
  const badgeEl = document.getElementById('homeChartBadge');

  if (noteEl) {
    noteEl.textContent = isLast
      ? 'Últimos meses con registros en NProduccion · Haz clic en cualquier barra para seleccionarla'
      : `Mostrando cifras de ${HOME_MONTHS_LONG[mes - 1]} ${anio}. Haz clic en otro mes para comparar.`;
  }

  if (badgeEl) {
    badgeEl.style.display = 'inline-flex';
    badgeEl.textContent = `${HOME_MONTHS[mes - 1].toUpperCase()} ${anio}: ${formatNumber(selected.value)} citas`;
  }
}

function renderHomeResumenMes(meses, selectedIdx = -1) {
  if (!meses.length) return;
  const idx = selectedIdx >= 0 && selectedIdx < meses.length ? selectedIdx : meses.length - 1;
  const selected = meses[idx];
  const isLast = idx === meses.length - 1;

  const trend = document.getElementById('homeMesTrend');
  const spark = document.getElementById('homeSpark');
  const elMes = document.getElementById('homeMes');
  const elMesLabel = document.getElementById('homeMesLabel');
  const btnProduccion = document.getElementById('homeBtnVerProduccion');
  const btnReset = document.getElementById('homeBtnResetMes');

  if (!selected) {
    if (elMes) elMes.textContent = '—';
    if (trend) trend.textContent = '';
    if (spark) spark.innerHTML = '';
    return;
  }

  const [anio, mes] = selected.label.split('-').map(Number);
  if (elMes) elMes.textContent = formatNumber(selected.value);

  const hoy = new Date();
  const enCurso = anio === hoy.getFullYear() && mes === hoy.getMonth() + 1;
  const anterior = meses[idx - 1];
  const mesLargo = HOME_MONTHS_LONG[mes - 1];
  if (elMesLabel) elMesLabel.textContent = `Citas atendidas · ${mesLargo} ${anio}`;

  // Un mes en curso todavía no se puede comparar con uno completo: se indica sin porcentaje.
  if (trend) {
    trend.className = 'hh-trend';
    trend.title = '';
    if (enCurso) {
      trend.textContent = 'Mes en curso';
      trend.classList.add('en-curso');
    } else if (anterior && anterior.value) {
      const cambio = Math.round(((selected.value - anterior.value) / anterior.value) * 100);
      const mesAnterior = HOME_MONTHS_LONG[Number(anterior.label.slice(5)) - 1];
      trend.textContent = `${cambio > 0 ? '▲' : cambio < 0 ? '▼' : '='} ${Math.abs(cambio)} % vs. ${mesAnterior}`;
      trend.title = `${formatNumber(anterior.value)} citas en ${mesAnterior}`;
      trend.classList.add(cambio > 0 ? 'sube' : cambio < 0 ? 'baja' : 'igual');
    } else {
      trend.textContent = 'Primer mes registrado';
    }
  }

  // Pie: hasta qué día hay datos del mes elegido.
  const pie = document.getElementById('homeFootWrap');
  if (pie) {
    const ultimoDia = new Date(anio, mes, 0).getDate();
    const ultima = isLast && homeUltimaAtencionFecha ? parseLocalDate(homeUltimaAtencionFecha) : null;
    pie.innerHTML = ultima
      ? `Última atención registrada: <b>${esc(ultima.toLocaleDateString('es-PE'))}</b>`
      : `Mes completo · <b>del 1 al ${ultimoDia} de ${esc(mesLargo)}</b>`;
  }

  // Actualiza el botón de acceso directo a Producción con los filtros de año y mes seleccionados
  if (btnProduccion) {
    btnProduccion.dataset.anio = anio;
    btnProduccion.dataset.mes = mes;
    btnProduccion.title = `Ver análisis detallado de producción de ${mesLargo} ${anio}`;
    const txt = btnProduccion.querySelector('span');
    if (txt) txt.textContent = `Ver producción de ${HOME_MONTHS[mes - 1]} ${anio}`;
  }

  if (btnReset) {
    btnReset.hidden = isLast;
  }

  if (spark) renderHomeSpark(spark, meses, idx);
}

// Minigráfico de 8 meses alrededor del elegido. La línea es SVG estirado al ancho; los puntos y los meses
// son HTML para que se vean redondos. El mes en curso no entra en la escala para no aplanar la línea.
function renderHomeSpark(spark, meses, idx) {
  const desde = Math.max(0, Math.min(meses.length - 8, idx - 4));
  const tramo = meses.slice(desde, desde + 8);
  if (tramo.length < 2) { spark.innerHTML = ''; return; }
  const hoy = new Date();
  const mesActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
  const cerrados = tramo.filter(m => m.label !== mesActual);
  const escala = (cerrados.length ? cerrados : tramo).map(m => m.value);
  const max = Math.max(...escala, 1);
  const min = Math.min(...escala);
  const rango = Math.max(max - min, max * 0.04, 1);
  // x e y en porcentaje del área del gráfico (y = 0 arriba); los extremos dejan margen para los puntos.
  const pts = tramo.map((m, i) => ({
    ...m,
    x: 5 + (i * 90) / (tramo.length - 1),
    y: Math.min(96, Math.max(8, 86 - ((m.value - min) / rango) * 74)),
    enCurso: m.label === mesActual
  }));
  const linea = lista => lista.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
  const completos = pts.filter(p => !p.enCurso);
  const ultimoCompleto = completos[completos.length - 1];
  const enCurso = pts.find(p => p.enCurso);
  spark.innerHTML = `
    <div class="hh-spark-plot">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="hhSparkFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#f2c4e3" stop-opacity=".38"/><stop offset="1" stop-color="#f2c4e3" stop-opacity="0"/></linearGradient></defs>
        ${completos.length > 1 ? `<path d="${linea(completos)} L${ultimoCompleto.x.toFixed(2)} 100 L${completos[0].x.toFixed(2)} 100 Z" fill="url(#hhSparkFill)"/>
        <path d="${linea(completos)}" fill="none" stroke="#f2c4e3" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>` : ''}
        ${enCurso && ultimoCompleto ? `<path d="${linea([ultimoCompleto, enCurso])}" fill="none" stroke="#f2c4e3" stroke-width="2" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>` : ''}
      </svg>
      ${pts.map((p, i) => `<button type="button" class="hh-spark-pt${desde + i === idx ? ' is-sel' : ''}${p.enCurso ? ' en-curso' : ''}" style="left:${p.x}%;top:${p.y}%" data-i="${desde + i}" tabindex="-1" aria-hidden="true" title="${esc(`${HOME_MONTHS_LONG[Number(p.label.slice(5)) - 1]} ${p.label.slice(0, 4)}: ${formatNumber(p.value)} citas`)}"></button>`).join('')}
    </div>
    <div class="hh-spark-meses" aria-hidden="true">${pts.map((p, i) => `<span class="${desde + i === idx ? 'is-sel' : ''}" style="left:${p.x}%">${esc(HOME_MONTHS[Number(p.label.slice(5)) - 1])}</span>`).join('')}</div>`;
  spark.querySelectorAll('.hh-spark-pt').forEach(b => b.addEventListener('click', () => selectHomeMonth(Number(b.dataset.i))));
}

// Barras interactivas: al hacer clic en cualquiera se selecciona y actualiza la tarjeta superior
function renderHomeChart(rows, selectedIdx = -1) {
  const target = document.getElementById('homeChart');
  if (!target) return;

  const months = rows
    .map(row => ({ label: String(row.label || ''), value: Number(row.value) || 0 }))
    .filter(row => /^\d{4}-\d{2}$/.test(row.label))
    .sort((a, b) => a.label.localeCompare(b.label));

  if (!months.length) {
    target.innerHTML = '<div class="table-empty">Aún no hay citas registradas.</div>';
    return;
  }

  const activeIdx = selectedIdx >= 0 && selectedIdx < months.length ? selectedIdx : months.length - 1;
  const max = Math.max(...months.map(row => row.value), 1);
  const describe = row => {
    const [year, month] = row.label.split('-').map(Number);
    return { short: HOME_MONTHS[month - 1], long: `${HOME_MONTHS_LONG[month - 1]} ${year}`, year, month };
  };

  const summary = months.map(row => `${describe(row).long}: ${formatNumber(row.value)}`).join('; ');
  const selectedMonthInfo = describe(months[activeIdx]);
  const isLastSelected = activeIdx === months.length - 1;

  const noteEl = document.getElementById('homeChartNote');
  if (noteEl) {
    noteEl.textContent = isLastSelected
      ? 'Últimos meses con registros en NProduccion · Haz clic en cualquier barra para seleccionarla'
      : `Mostrando cifras de ${selectedMonthInfo.long}. Haz clic en otro mes para comparar.`;
  }

  const badgeEl = document.getElementById('homeChartBadge');
  if (badgeEl) {
    badgeEl.style.display = 'inline-flex';
    badgeEl.textContent = `${selectedMonthInfo.short.toUpperCase()} ${selectedMonthInfo.year}: ${formatNumber(months[activeIdx].value)} citas`;
  }

  target.innerHTML = `<div class="home-bars" role="region" aria-label="Citas atendidas por mes. ${esc(summary)}">${months.map((row, index) => {
    const names = describe(row);
    const isSelected = index === activeIdx;
    const isLast = index === months.length - 1;
    const isVisibleValue = isSelected || isLast;
    return `<div class="home-bar-col${isSelected ? ' is-selected' : ''}${isLast ? ' is-last' : ''}"
      tabindex="0"
      role="button"
      aria-label="Seleccionar ${names.long}, ${formatNumber(row.value)} citas"
      aria-pressed="${isSelected ? 'true' : 'false'}"
      data-index="${index}"
      data-tip="${esc(`${names.long}: ${formatNumber(row.value)} citas (clic para seleccionar)`)}">
      <span class="home-bar-track" style="--alto:${Math.max(3, (row.value / max) * 100)}%">
        <span class="home-bar-value">${isVisibleValue ? formatNumber(row.value) : ''}</span>
        <span class="home-bar"></span>
      </span>
      <span class="home-bar-label">${esc(names.short)}</span>
    </div>`;
  }).join('')}</div>`;

  // Asigna eventos de clic, teclado y doble clic a cada barra
  target.querySelectorAll('.home-bar-col').forEach(col => {
    const idx = Number(col.dataset.index);
    col.addEventListener('click', () => {
      selectHomeMonth(idx);
    });
    col.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectHomeMonth(idx);
      }
    });
    col.addEventListener('dblclick', () => {
      const row = months[idx];
      if (row) {
        const [y, m] = row.label.split('-').map(Number);
        irAProduccionMes(y, m);
      }
    });
  });
}

// Año y mes que Producción debe aplicar al abrirse (desde Inicio). Se aplican antes de la primera
// carga para no pedir dos reportes a la vez.
let produccionPendiente = null;
function irAProduccionMes(anio, mes) {
  if (!anio || !mes) { showView('reportes'); return; }
  produccionPendiente = { anio: String(anio), mes: String(mes) };
  showView('reportes');
}
async function abrirVistaProduccion() {
  const pendiente = produccionPendiente;
  produccionPendiente = null;
  if (!pendiente) { inicializarFiltrosProduccion(); cargarReportes(); return; }
  await inicializarFiltrosProduccion();
  sv('prodFiltroAnio', pendiente.anio);
  sv('prodFiltroMes', pendiente.mes);
  cargarReportes();
}

// ═══════════════════════════════════════
//  ORDENAMIENTO UNIVERSAL DE TABLAS (DE MENOR A MAYOR AL TOCAR TÍTULOS)
// ═══════════════════════════════════════
function initUniversalTableSorting() {
  document.addEventListener('click', (e) => {
    const th = e.target.closest('th');
    if (!th) return;
    const table = th.closest('table');
    if (!table) return;

    // Si tiene un handler propio en línea (ej. ordenarTablaProdDiagnosticos) o no es ordenable, no intervenir
    if (th.hasAttribute('onclick') || th.dataset.noSort === 'true' || th.hasAttribute('data-no-sort')) return;

    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    const rows = Array.from(tbody.querySelectorAll('tr')).filter(tr => !tr.querySelector('.table-empty'));
    if (rows.length <= 1) return;

    const thList = Array.from(th.parentNode.children);
    const colIndex = thList.indexOf(th);
    if (colIndex < 0) return;

    // Primer clic: siempre de menor a mayor ('asc')
    const currentDir = th.dataset.sortDir === 'asc' ? 'desc' : 'asc';
    th.dataset.sortDir = currentDir;
    const isAsc = currentDir === 'asc';

    // Limpiar otros encabezados de la fila
    thList.forEach(otherTh => {
      if (otherTh !== th) {
        delete otherTh.dataset.sortDir;
        otherTh.classList.remove('is-sorted');
        const arrow = otherTh.querySelector('.th-sort-indicator, .th-sort-arrow');
        if (arrow) arrow.textContent = '↕';
      }
    });

    th.classList.add('is-sorted', 'sortable-th');
    let arrow = th.querySelector('.th-sort-indicator, .th-sort-arrow');
    if (!arrow) {
      arrow = document.createElement('span');
      arrow.className = 'th-sort-indicator';
      th.appendChild(arrow);
    }
    arrow.textContent = isAsc ? '▲' : '▼';
    th.title = `Ordenado de ${isAsc ? 'menor a mayor' : 'mayor a menor'}. Clic para cambiar.`;

    rows.sort((rowA, rowB) => {
      const cellA = (rowA.children[colIndex]?.textContent || '').trim();
      const cellB = (rowB.children[colIndex]?.textContent || '').trim();

      // Limpieza de formato numérico (comas, porcentajes, etc.)
      const numA = Number(cellA.replace(/[,%\s]/g, ''));
      const numB = Number(cellB.replace(/[,%\s]/g, ''));
      const isNum = cellA !== '' && cellB !== '' && !isNaN(numA) && !isNaN(numB) && !/^\d{4}-\d{2}/.test(cellA);

      if (isNum) {
        return isAsc ? numA - numB : numB - numA;
      }

      // Fechas (YYYY-MM-DD o DD/MM/YYYY)
      const dateA = /^\d{2}\/\d{2}\/\d{4}/.test(cellA)
        ? Date.parse(cellA.split('/').reverse().join('-'))
        : Date.parse(cellA);
      const dateB = /^\d{2}\/\d{2}\/\d{4}/.test(cellB)
        ? Date.parse(cellB.split('/').reverse().join('-'))
        : Date.parse(cellB);

      if (!isNaN(dateA) && !isNaN(dateB)) {
        return isAsc ? dateA - dateB : dateB - dateA;
      }

      return isAsc
        ? cellA.localeCompare(cellB, 'es', { numeric: true, sensitivity: 'base' })
        : cellB.localeCompare(cellA, 'es', { numeric: true, sensitivity: 'base' });
    });

    rows.forEach(r => tbody.appendChild(r));
  });
}

alCargarVistas(setupHomeView);
alCargarVistas(setupBusquedas);
alCargarVistas(setupCatalogos);
alCargarVistas(initUniversalTableSorting);
