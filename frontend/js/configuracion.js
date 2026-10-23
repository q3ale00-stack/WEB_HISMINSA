// ═══════════════════════════════════════
//  CONFIGURACIÓN: estado del sistema, usuarios y accesos, seguridad de la sesión y conexión
// ═══════════════════════════════════════
// Usa funciones globales de app.js: apiFetch, esc, formatNumber, toast, abrirModal, cerrarModal, showView, logout, currentUser.

const CFG = { tab: 'estado', usuarios: [], limiteAccesos: 50 };
const CFG_INACTIVIDAD = [[0, 'Nunca'], [10, '10 minutos'], [15, '15 minutos'], [30, '30 minutos'], [60, '1 hora'], [120, '2 horas']];
const cfgEsAdmin = () => currentUser?.role === 'admin';

const cfgFechaHora = v => {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const cfgFecha = v => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10).split('-').reverse().join('/') : '');
function cfgHace(v) {
  if (!v) return '';
  const ms = Date.now() - new Date(v).getTime();
  if (Number.isNaN(ms)) return '';
  const min = Math.round(ms / 60000);
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'hace 1 día' : `hace ${d} días`;
}
const cfgIniciales = nombre => {
  const p = String(nombre || '').trim().split(/\s+/).filter(Boolean);
  return p.length ? (p[0][0] + (p[1]?.[0] || '')).toUpperCase() : '?';
};
const cfgIcono = d => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const CFG_ICONOS = {
  bd: cfgIcono('<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/>'),
  calendario: cfgIcono('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  importar: cfgIcono('<path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v11m0 0l-4-4m4 4l4-4"/>'),
  usuarios: cfgIcono('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0113 0"/><path d="M16 4.6a3.5 3.5 0 010 6.8M18 14.2a6.5 6.5 0 013.5 5.8"/>'),
  rayo: cfgIcono('<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>'),
  servidor: cfgIcono('<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>')
};

// ── Pestañas ──
function abrirConfiguracion() {
  document.querySelectorAll('#view-config .cfg-admin').forEach(el => { el.hidden = !cfgEsAdmin(); });
  if (!cfgEsAdmin() && CFG.tab !== 'conexion') CFG.tab = 'conexion';
  cambiarTabConfig(CFG.tab);
}

function cambiarTabConfig(tab) {
  if (!cfgEsAdmin()) tab = 'conexion';
  CFG.tab = tab;
  document.querySelectorAll('[data-cfg-tab]').forEach(b => {
    const activa = b.dataset.cfgTab === tab;
    b.classList.toggle('active', activa);
    b.setAttribute('aria-selected', String(activa));
  });
  document.querySelectorAll('[data-cfg-panel]').forEach(p => { p.hidden = p.dataset.cfgPanel !== tab; });
  if (tab === 'estado') cargarEstadoSistema();
  if (tab === 'usuarios') cargarUsuariosYAccesos();
  if (tab === 'seguridad') cargarAjustesSeguridad();
}

const cfgCargando = texto => `<div class="cfg-loading"><span class="ps-spinner" aria-hidden="true"></span>${esc(texto)}</div>`;
const cfgError = (texto, reintentar) => `<div class="cfg-error"><strong>${esc(texto)}</strong><button type="button" class="btn btn-secondary btn-sm" onclick="${reintentar}">Reintentar</button></div>`;

// ── Estado del sistema ──
async function cargarEstadoSistema() {
  const box = document.getElementById('cfgEstado');
  if (!box.dataset.cargado) box.innerHTML = cfgCargando('Revisando el sistema…');
  try {
    const e = await apiFetch('/admin/estado');
    box.dataset.cargado = '1';
    box.innerHTML = htmlEstadoSistema(e);
  } catch (error) {
    box.innerHTML = cfgError(error.message || 'No se pudo revisar el sistema.', 'cargarEstadoSistema()');
  }
}

function htmlEstadoSistema(e) {
  const lat = e.conexion.latenciaMs;
  const latClase = lat < 150 ? 'ok' : lat < 600 ? 'medio' : 'lento';
  const latTexto = lat < 150 ? 'Respuesta rápida' : lat < 600 ? 'Respuesta aceptable' : 'Respuesta lenta';
  const ultima = e.ultimaAtencion;
  const imp = e.ultimaImportacion;
  const indicesOk = e.indices.filter(i => i.existe).length;
  const maxFilas = Math.max(1, ...e.tablas.map(t => t.filas || 0));
  const tile = (icono, titulo, valor, detalle, clase = '') => `
    <article class="cfg-tile ${clase}">
      <span class="cfg-tile-icon">${icono}</span>
      <div class="cfg-tile-body"><span class="cfg-tile-title">${titulo}</span><strong class="cfg-tile-value">${valor}</strong><span class="cfg-tile-detail">${detalle}</span></div>
    </article>`;
  return `
    <div class="cfg-head">
      <div><h3>Estado del sistema</h3><p>Revisado ${esc(cfgFechaHora(new Date()))}</p></div>
      <div class="cfg-head-actions">
        <button type="button" class="btn btn-secondary" onclick="cargarEstadoSistema()">Actualizar</button>
        <button type="button" class="btn btn-primary" onclick="limpiarCacheSistema(this)">Limpiar caché</button>
      </div>
    </div>
    <div class="cfg-tiles">
      ${tile(CFG_ICONOS.bd, 'Base de datos', `<span class="cfg-dot ${latClase}"></span>Conectada`, `${esc(latTexto)} · ${formatNumber(lat)} ms<br>${esc(e.conexion.baseDatos || '')} en ${esc(e.conexion.servidor || '')}`)}
      ${tile(CFG_ICONOS.calendario, 'Última atención cargada', ultima ? esc(cfgFecha(ultima)) : 'Sin datos', ultima ? `Registrada ${esc(cfgHace(ultima))}` : 'NProduccion no tiene atenciones')}
      ${tile(CFG_ICONOS.importar, 'Última importación', imp ? esc(cfgFechaHora(imp.fecha)) : 'Sin registro', imp ? `${esc(imp.usuario || '')}${imp.detalle?.length ? ` · ${esc(imp.detalle.join(', '))}` : ''}` : 'Se mostrará después de la próxima importación')}
      ${tile(CFG_ICONOS.usuarios, 'Usuarios', `${formatNumber(e.usuarios.activos)} activos`, `${formatNumber(e.usuarios.total)} en total · ${formatNumber(e.usuarios.conectados)} con sesión abierta`)}
    </div>
    <div class="cfg-grid-2">
      <section class="cfg-card">
        <h4>Datos en la base</h4>
        <ul class="cfg-bars">${e.tablas.map(t => `
          <li><div class="cfg-bar-text"><span>${esc(t.titulo)}<small>${esc(t.tabla)}</small></span><strong>${t.filas === null ? '<em>No existe</em>' : formatNumber(t.filas)}</strong></div>
          <div class="cfg-bar-track"><div class="cfg-bar-fill" style="width:${t.filas ? Math.max(2, Math.round((t.filas / maxFilas) * 100)) : 0}%"></div></div></li>`).join('')}
        </ul>
      </section>
      <section class="cfg-card">
        <h4>Rendimiento</h4>
        <div class="cfg-indices-head ${indicesOk === e.indices.length ? 'ok' : 'falta'}">
          <span class="cfg-tile-icon">${CFG_ICONOS.rayo}</span>
          <div><strong>${indicesOk} de ${e.indices.length} índices de búsqueda activos</strong>
          <span>${indicesOk === e.indices.length ? 'Las búsquedas usan todos los índices.' : 'Faltan índices: las búsquedas y reportes pueden ir más lentos.'}</span></div>
        </div>
        <ul class="cfg-indices">${e.indices.map(i => `<li class="${i.existe ? 'ok' : 'falta'}"><span class="cfg-check" aria-hidden="true">${i.existe ? '✓' : '!'}</span><code>${esc(i.nombre)}</code><small>${esc(i.tabla)}</small></li>`).join('')}</ul>
        ${indicesOk === e.indices.length ? '' : `<p class="cfg-nota">Para crearlos, ejecuta una sola vez en la carpeta del proyecto, fuera del horario de atención:<br><code>node backend/create_performance_indexes.js</code></p>`}
        <h4 class="cfg-sub">Servidor de la aplicación</h4>
        <dl class="cfg-dl">
          <div><dt>SQL Server</dt><dd>${esc(e.conexion.version || '—')} ${e.conexion.edicion ? `<small>${esc(e.conexion.edicion)}</small>` : ''}</dd></div>
          <div><dt>Node.js</dt><dd>${esc(e.servidorApp.node)}</dd></div>
          <div><dt>Encendido desde</dt><dd>${esc(cfgFechaHora(e.servidorApp.activoDesde))}</dd></div>
          <div><dt>Memoria usada</dt><dd>${formatNumber(e.servidorApp.memoriaMb)} MB</dd></div>
          <div><dt>Consultas en caché</dt><dd>${e.cache.entradas === null ? '—' : formatNumber(e.cache.entradas)}</dd></div>
        </dl>
      </section>
    </div>`;
}

async function limpiarCacheSistema(boton) {
  boton.disabled = true;
  try {
    const r = await apiFetch('/admin/cache/limpiar', { method: 'POST' });
    toast(r.message || 'Caché limpiada.', 'success');
    cargarEstadoSistema();
  } catch (error) {
    toast(error.message || 'No se pudo limpiar la caché.', 'error');
  } finally {
    boton.disabled = false;
  }
}

// ── Usuarios y accesos ──
async function cargarUsuariosYAccesos() {
  const box = document.getElementById('cfgUsuarios');
  if (!box.dataset.cargado) box.innerHTML = cfgCargando('Cargando usuarios…');
  try {
    const [usuarios, accesos] = await Promise.all([apiFetch('/admin/usuarios'), apiFetch(`/admin/accesos?limite=${CFG.limiteAccesos}`)]);
    CFG.usuarios = usuarios;
    box.dataset.cargado = '1';
    box.innerHTML = htmlUsuarios(usuarios) + htmlAccesos(accesos);
  } catch (error) {
    box.innerHTML = cfgError(error.message || 'No se pudieron cargar los usuarios.', 'cargarUsuariosYAccesos()');
  }
}

function htmlUsuarios(lista) {
  const activos = lista.filter(u => u.activo).length;
  const filas = lista.map((u, i) => `
    <tr class="${u.activo ? '' : 'cfg-inactivo'}">
      <td><div class="cfg-user"><span class="cfg-avatar ${u.rol === 'admin' ? 'admin' : ''}">${esc(cfgIniciales(u.nombre))}</span>
        <span><strong>${esc(u.nombre)}${u.esUstedMismo ? ' <em class="cfg-tu">Tú</em>' : ''}</strong><small>@${esc(u.usuario)} · ${esc(u.email || '')}</small></span></div></td>
      <td><select class="input cfg-rol" data-cfg-rol="${i}" ${u.esUstedMismo ? 'disabled title="No puedes cambiar tu propio rol"' : ''} aria-label="Rol de ${esc(u.nombre)}">
        <option value="admin"${u.rol === 'admin' ? ' selected' : ''}>Administrador</option>
        <option value="doctor"${u.rol === 'doctor' ? ' selected' : ''}>Médico</option></select></td>
      <td><label class="cfg-switch" title="${u.esUstedMismo ? 'No puedes desactivar tu propia cuenta' : u.activo ? 'Desactivar' : 'Activar'}">
        <input type="checkbox" data-cfg-activo="${i}" ${u.activo ? 'checked' : ''} ${u.esUstedMismo ? 'disabled' : ''}><span class="cfg-switch-ui" aria-hidden="true"></span>
        <span class="cfg-switch-text">${u.activo ? 'Activo' : 'Inactivo'}</span></label></td>
      <td>${u.ultimoAcceso ? `${esc(cfgFechaHora(u.ultimoAcceso))}<small class="cfg-muted">${esc(cfgHace(u.ultimoAcceso))}</small>` : '<span class="cfg-muted">Nunca</span>'}</td>
      <td class="cfg-center">${u.sesionesActivas ? `<span class="cfg-pill on">${u.sesionesActivas}</span>` : '<span class="cfg-pill">0</span>'}</td>
      <td><div class="cfg-acciones">
        <button type="button" class="btn btn-secondary btn-xs" data-cfg-pass="${i}">Restablecer contraseña</button>
        <button type="button" class="btn btn-secondary btn-xs" data-cfg-cerrar="${i}" ${u.sesionesActivas ? '' : 'disabled'}>Cerrar sesiones</button>
      </div></td>
    </tr>`).join('');
  return `
    <div class="cfg-head">
      <div><h3>Usuarios del sistema</h3><p>${formatNumber(lista.length)} usuarios · ${formatNumber(activos)} activos</p></div>
      <div class="cfg-head-actions">
        <button type="button" class="btn btn-secondary" onclick="cargarUsuariosYAccesos()">Actualizar</button>
        <button type="button" class="btn btn-primary" onclick="irACrearUsuario()">+ Crear usuario</button>
      </div>
    </div>
    <div class="cfg-table-wrap">
      <table class="cfg-table">
        <thead><tr><th>Usuario</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th class="cfg-center">Sesiones abiertas</th><th>Acciones</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;
}

function htmlAccesos({ accesos, resumen }) {
  return `
    <div class="cfg-head cfg-head-sep">
      <div><h3>Registro de accesos</h3><p>Inicios de sesión correctos y fallidos, del más reciente al más antiguo</p></div>
      <div class="cfg-head-actions">
        <span class="cfg-stat ok"><strong>${formatNumber(resumen.correctos24h)}</strong> ingresos (24 h)</span>
        <span class="cfg-stat ${resumen.fallidos24h ? 'mal' : ''}"><strong>${formatNumber(resumen.fallidos24h)}</strong> intentos fallidos (24 h)</span>
      </div>
    </div>
    ${accesos.length ? `<div class="cfg-table-wrap">
      <table class="cfg-table cfg-table-accesos">
        <thead><tr><th>Fecha y hora</th><th>Usuario</th><th>Equipo (IP)</th><th>Resultado</th></tr></thead>
        <tbody>${accesos.map(a => `<tr>
          <td>${esc(cfgFechaHora(a.fecha))}<small class="cfg-muted">${esc(cfgHace(a.fecha))}</small></td>
          <td><strong>${esc(a.nombre || a.usuario)}</strong>${a.nombre ? `<small class="cfg-muted">@${esc(a.usuario)}</small>` : ''}</td>
          <td><code>${esc(String(a.ip || '').replace(/^::ffff:/, '') || '—')}</code></td>
          <td>${a.exito ? '<span class="cfg-badge ok">Ingresó</span>' : `<span class="cfg-badge mal">Fallido</span><small class="cfg-muted">${esc(a.detalle || '')}</small>`}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
    ${accesos.length >= CFG.limiteAccesos && CFG.limiteAccesos < 200 ? '<button type="button" class="btn btn-secondary cfg-mas" onclick="CFG.limiteAccesos = Math.min(200, CFG.limiteAccesos * 2); cargarUsuariosYAccesos();">Ver más accesos</button>' : ''}`
    : '<div class="cfg-vacio">Todavía no hay accesos registrados. Aparecerán desde el próximo inicio de sesión.</div>'}`;
}

function irACrearUsuario() {
  showView('perfil');
  setTimeout(() => document.getElementById('adminUserFormCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
}

async function cfgActualizarUsuario(u, cambios, exito) {
  try {
    await apiFetch(`/admin/usuarios/${u.id}`, { method: 'PATCH', body: JSON.stringify(cambios) });
    toast(exito, 'success');
  } catch (error) {
    toast(error.message || 'No se pudo actualizar el usuario.', 'error');
  }
  cargarUsuariosYAccesos();
}

function cfgModalPassword(u) {
  abrirModal(`Restablecer contraseña · ${u.nombre}`, `
    <form class="cfg-pass-form" id="cfgPassForm" autocomplete="off">
      <p>Escribe la nueva contraseña para <strong>@${esc(u.usuario)}</strong>. Se cerrarán todas sus sesiones abiertas y deberá ingresar con la nueva contraseña.</p>
      <label class="label">Nueva contraseña<input class="input" type="password" id="cfgPass1" minlength="10" maxlength="128" required autocomplete="new-password"></label>
      <label class="label">Repite la contraseña<input class="input" type="password" id="cfgPass2" minlength="10" maxlength="128" required autocomplete="new-password"></label>
      <p class="cfg-muted">Mínimo 10 caracteres. Combina letras, números y algún símbolo.</p>
      <div class="cfg-modal-actions"><button type="button" class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button><button type="submit" class="btn btn-primary">Guardar contraseña</button></div>
    </form>`, { wide: false });
  const form = document.getElementById('cfgPassForm');
  document.getElementById('cfgPass1').focus();
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const p1 = document.getElementById('cfgPass1').value;
    const p2 = document.getElementById('cfgPass2').value;
    if (p1.length < 10) { toast('La contraseña debe tener al menos 10 caracteres.', 'error'); return; }
    if (p1 !== p2) { toast('Las dos contraseñas no coinciden.', 'error'); return; }
    const boton = form.querySelector('[type=submit]');
    boton.disabled = true;
    try {
      const r = await apiFetch(`/admin/usuarios/${u.id}/password`, { method: 'POST', body: JSON.stringify({ password: p1 }) });
      cerrarModal();
      toast(r.message || 'Contraseña restablecida.', 'success');
      cargarUsuariosYAccesos();
    } catch (error) {
      toast(error.message || 'No se pudo restablecer la contraseña.', 'error');
    } finally {
      boton.disabled = false;
    }
  });
}

function activarPanelUsuarios() {
  const box = document.getElementById('cfgUsuarios');
  box.addEventListener('change', event => {
    const rol = event.target.closest('[data-cfg-rol]');
    if (rol) {
      const u = CFG.usuarios[Number(rol.dataset.cfgRol)];
      cfgActualizarUsuario(u, { rol: rol.value }, `${u.nombre} ahora es ${rol.value === 'admin' ? 'Administrador' : 'Médico'}.`);
    }
    const activo = event.target.closest('[data-cfg-activo]');
    if (activo) {
      const u = CFG.usuarios[Number(activo.dataset.cfgActivo)];
      cfgActualizarUsuario(u, { activo: activo.checked }, activo.checked ? `Se activó la cuenta de ${u.nombre}.` : `Se desactivó la cuenta de ${u.nombre} y se cerraron sus sesiones.`);
    }
  });
  box.addEventListener('click', async event => {
    const pass = event.target.closest('[data-cfg-pass]');
    if (pass) cfgModalPassword(CFG.usuarios[Number(pass.dataset.cfgPass)]);
    const cerrar = event.target.closest('[data-cfg-cerrar]');
    if (cerrar) {
      const u = CFG.usuarios[Number(cerrar.dataset.cfgCerrar)];
      cerrar.disabled = true;
      try {
        const r = await apiFetch(`/admin/usuarios/${u.id}/cerrar-sesiones`, { method: 'POST' });
        toast(r.message, 'success');
      } catch (error) {
        toast(error.message || 'No se pudieron cerrar las sesiones.', 'error');
      }
      cargarUsuariosYAccesos();
    }
  });
}

// ── Seguridad de la sesión ──
async function cargarAjustesSeguridad() {
  const box = document.getElementById('cfgSeguridad');
  box.innerHTML = cfgCargando('Cargando ajustes…');
  try {
    const { sesion } = await apiFetch('/admin/ajustes');
    box.innerHTML = `
      <div class="cfg-head"><div><h3>Seguridad de la sesión</h3><p>Se aplica a todos los usuarios del sistema</p></div></div>
      <section class="cfg-card">
        <h4>Cerrar la sesión por inactividad</h4>
        <p class="cfg-muted">Si nadie usa el sistema durante este tiempo, la sesión se cierra sola. Es útil en computadoras compartidas de consultorios y admisión. Un minuto antes aparece un aviso para seguir trabajando.</p>
        <div class="cfg-opciones" role="radiogroup" aria-label="Tiempo de inactividad">
          ${CFG_INACTIVIDAD.map(([min, texto]) => `<label class="cfg-opcion"><input type="radio" name="cfgInactividad" value="${min}"${Number(sesion.inactividadMin) === min ? ' checked' : ''}><span>${texto}${min === 30 ? '<small>Recomendado</small>' : ''}</span></label>`).join('')}
        </div>
        <div class="cfg-modal-actions"><button type="button" class="btn btn-primary" onclick="guardarAjustesSeguridad(this)">Guardar</button></div>
        <p class="cfg-nota">Además, cada sesión dura como máximo 12 horas; después hay que volver a ingresar.</p>
      </section>`;
  } catch (error) {
    box.innerHTML = cfgError(error.message || 'No se pudieron cargar los ajustes.', 'cargarAjustesSeguridad()');
  }
}

async function guardarAjustesSeguridad(boton) {
  const elegido = document.querySelector('input[name="cfgInactividad"]:checked');
  if (!elegido) return;
  boton.disabled = true;
  try {
    const r = await apiFetch('/admin/ajustes', { method: 'PUT', body: JSON.stringify({ inactividadMin: Number(elegido.value) }) });
    toast('Ajustes guardados. Se aplican desde el próximo ingreso de cada usuario.', 'success');
    iniciarControlInactividad(r.sesion.inactividadMin);
  } catch (error) {
    toast(error.message || 'No se pudieron guardar los ajustes.', 'error');
  } finally {
    boton.disabled = false;
  }
}

// ── Cierre de sesión por inactividad (para todos los usuarios) ──
const INACT = { minutos: 0, timer: null, aviso: null, ultimo: 0 };

function iniciarControlInactividad(minutos) {
  INACT.minutos = Number(minutos) || 0;
  reiniciarInactividad(true);
}

function detenerControlInactividad() {
  clearTimeout(INACT.timer);
  clearTimeout(INACT.aviso);
  INACT.minutos = 0;
  document.getElementById('inactividadAviso')?.remove();
}

function reiniciarInactividad(forzar = false) {
  if (!INACT.minutos || !currentUser) return;
  const ahora = Date.now();
  if (!forzar && ahora - INACT.ultimo < 15000) return; // como máximo cada 15 s
  INACT.ultimo = ahora;
  clearTimeout(INACT.timer);
  clearTimeout(INACT.aviso);
  document.getElementById('inactividadAviso')?.remove();
  const total = INACT.minutos * 60000;
  INACT.aviso = setTimeout(mostrarAvisoInactividad, Math.max(0, total - 60000));
  INACT.timer = setTimeout(async () => {
    document.getElementById('inactividadAviso')?.remove();
    if (!currentUser) return;
    await logout();
    const estado = document.getElementById('loginStatus');
    if (estado) { estado.textContent = 'Se cerró tu sesión por inactividad. Ingresa nuevamente.'; estado.hidden = false; }
  }, total);
}

function mostrarAvisoInactividad() {
  if (!currentUser || document.getElementById('inactividadAviso')) return;
  const aviso = document.createElement('div');
  aviso.id = 'inactividadAviso';
  aviso.className = 'inact-aviso';
  aviso.setAttribute('role', 'alertdialog');
  aviso.innerHTML = `<strong>¿Sigues ahí?</strong><span>Tu sesión se cerrará en 1 minuto por inactividad.</span><button type="button" class="btn btn-primary btn-sm">Seguir trabajando</button>`;
  aviso.querySelector('button').addEventListener('click', () => reiniciarInactividad(true));
  document.body.appendChild(aviso);
}

['click', 'keydown', 'mousemove', 'scroll', 'touchstart'].forEach(ev => document.addEventListener(ev, () => {
  if (document.getElementById('inactividadAviso')) return; // con el aviso abierto, solo el botón lo cierra
  reiniciarInactividad();
}, { passive: true }));

async function cargarControlInactividad() {
  try {
    const { inactividadMin } = await apiFetch('/auth/ajustes-sesion');
    iniciarControlInactividad(inactividadMin);
  } catch (_) {
    detenerControlInactividad();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('cfgUsuarios')) activarPanelUsuarios();
});

// ── Aspecto: claro, oscuro o automático (preferencia de cada navegador) ──
const TEMA_CLAVE = 'his_tema';
const temaOscuroDelEquipo = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function leerTema() {
  try { return localStorage.getItem(TEMA_CLAVE) || 'auto'; } catch (_) { return 'auto'; }
}

function aplicarTema(tema = leerTema()) {
  const oscuro = tema === 'oscuro' || (tema === 'auto' && temaOscuroDelEquipo?.matches);
  document.documentElement.setAttribute('data-theme', oscuro ? 'dark' : 'light');
  document.querySelectorAll('[data-tema]').forEach(b => {
    const activo = b.dataset.tema === tema;
    b.classList.toggle('on', activo);
    b.setAttribute('aria-checked', String(activo));
  });
}

function elegirTema(tema) {
  try { localStorage.setItem(TEMA_CLAVE, tema); } catch (_) { /* sin almacenamiento: se aplica solo en esta visita */ }
  aplicarTema(tema);
}

temaOscuroDelEquipo?.addEventListener?.('change', () => { if (leerTema() === 'auto') aplicarTema('auto'); });
document.addEventListener('DOMContentLoaded', () => {
  aplicarTema();
  document.querySelectorAll('[data-tema]').forEach(b => b.addEventListener('click', event => { event.stopPropagation(); elegirTema(b.dataset.tema); }));
});
