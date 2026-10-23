// Configuración del sistema (solo administradores): estado del servidor y la base de datos, caché,
// usuarios (activar, rol, contraseña, sesiones), registro de accesos y seguridad de la sesión.
const { sql, poolPromise, withTransientRetry } = require('../config/db');
const cache = require('../config/cache');
const ajustes = require('../config/ajustes');
const { hashPassword } = require('./authController');

// Índices que crea backend/create_performance_indexes.js (tabla → nombres).
const INDICES_RENDIMIENTO = [
  ['NProduccion', 'IX_NProduccion_Fecha'],
  ['NProduccion', 'IX_NProduccion_Anio_Mes'],
  ['NProduccion', 'IX_NProduccion_Personal'],
  ['NProduccion', 'IX_NProduccion_Establecimiento'],
  ['NProduccion', 'IX_NProduccion_Codigo_Item'],
  ['MaestroPaciente', 'IX_MaestroPaciente_Doc_Nom']
];
const TABLAS_PRINCIPALES = [
  ['NProduccion', 'Producción nominal (atenciones)'],
  ['MaestroPaciente', 'Pacientes'],
  ['MaestroPersonal', 'Personal'],
  ['MaestroRegistrador', 'Registradores'],
  ['MAESTRO_HIS_CIE_CPMS', 'Catálogo CIE-10 / CPMS'],
  ['MAESTRO_HIS_ESTABLECIMIENTO', 'Establecimientos']
];
const INACTIVIDAD_PERMITIDA = [0, 10, 15, 30, 60, 120];
const AJUSTES_SESION = 'sesion';

// GET /api/admin/estado
async function estado(req, res) {
  const inicio = Date.now();
  try {
    const pool = await poolPromise;
    const ping = await withTransientRetry(() => pool.request().query(`
      SELECT @@SERVERNAME AS servidor, DB_NAME() AS baseDatos,
             CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(50)) AS version,
             CAST(SERVERPROPERTY('Edition') AS nvarchar(100)) AS edicion,
             SYSDATETIME() AS horaServidor`));
    const latenciaMs = Date.now() - inicio;
    const tablas = await pool.request().query(`
      SELECT t.name AS tabla, SUM(p.rows) AS filas
      FROM sys.tables t JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
      WHERE SCHEMA_NAME(t.schema_id) = 'dbo' AND t.name IN (${TABLAS_PRINCIPALES.map(([t]) => `'${t}'`).join(', ')})
      GROUP BY t.name;
      SELECT OBJECT_NAME(i.object_id) AS tabla, i.name AS indice
      FROM sys.indexes i
      WHERE i.name IN (${INDICES_RENDIMIENTO.map(([, n]) => `'${n}'`).join(', ')});`);
    const filas = new Map(tablas.recordsets[0].map(r => [String(r.tabla).toLowerCase(), Number(r.filas)]));
    const existentes = new Set(tablas.recordsets[1].map(r => String(r.indice)));

    let ultimaAtencion = null;
    if (filas.has('nproduccion')) {
      const ult = await pool.request().query('SELECT MAX(Fecha_Atencion) AS ultima FROM NProduccion');
      ultimaAtencion = ult.recordset[0]?.ultima || null;
    }
    const usuarios = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.HisUsuarios WHERE IsActive = 1) AS activos,
        (SELECT COUNT(*) FROM dbo.HisUsuarios) AS total,
        (SELECT COUNT(DISTINCT IdUsuario) FROM dbo.HisSesiones WHERE ExpiresAt > SYSUTCDATETIME()) AS conectados`);

    res.status(200).json({
      conexion: { ...ping.recordset[0], latenciaMs },
      tablas: TABLAS_PRINCIPALES.map(([tabla, titulo]) => ({ tabla, titulo, filas: filas.has(tabla.toLowerCase()) ? filas.get(tabla.toLowerCase()) : null })),
      ultimaAtencion,
      ultimaImportacion: await ajustes.leer('ultimaImportacion', null),
      indices: INDICES_RENDIMIENTO.map(([tabla, nombre]) => ({ tabla, nombre, existe: existentes.has(nombre) })),
      usuarios: usuarios.recordset[0],
      servidorApp: { node: process.version, activoDesde: new Date(Date.now() - process.uptime() * 1000).toISOString(), memoriaMb: Math.round(process.memoryUsage().rss / 1048576) },
      cache: { entradas: cache.cache?.size ?? null }
    });
  } catch (error) {
    console.error('Error al leer el estado del sistema:', error);
    res.status(500).json({ message: 'No se pudo leer el estado del sistema.', latenciaMs: Date.now() - inicio });
  }
}

// POST /api/admin/cache/limpiar
function limpiarCache(req, res) {
  const antes = cache.cache?.size ?? null;
  cache.clear();
  res.status(200).json({ message: 'Caché limpiada. Las listas y tableros se recalcularán en la próxima consulta.', entradas: antes });
}

// GET /api/admin/usuarios
async function listarUsuarios(req, res) {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT u.IdUsuario, u.Username, u.FullName, u.Role, u.Dni, u.Email, u.Phone, u.Profession, u.IsActive, u.CreatedAt,
             (SELECT MAX(a.Fecha) FROM dbo.HisAccesos a WHERE a.IdUsuario = u.IdUsuario AND a.Exito = 1) AS UltimoAcceso,
             (SELECT COUNT(*) FROM dbo.HisSesiones s WHERE s.IdUsuario = u.IdUsuario AND s.ExpiresAt > SYSUTCDATETIME()) AS SesionesActivas
      FROM dbo.HisUsuarios u
      ORDER BY u.IsActive DESC, u.FullName`);
    res.status(200).json(result.recordset.map(u => ({
      id: u.IdUsuario, usuario: u.Username, nombre: u.FullName, rol: u.Role, dni: u.Dni, email: u.Email, telefono: u.Phone,
      profesion: u.Profession, activo: Boolean(u.IsActive), creado: u.CreatedAt, ultimoAcceso: u.UltimoAcceso,
      sesionesActivas: Number(u.SesionesActivas || 0), esUstedMismo: u.IdUsuario === req.user.id
    })));
  } catch (error) {
    console.error('Error al listar usuarios:', error);
    res.status(500).json({ message: 'No se pudo cargar la lista de usuarios.' });
  }
}

const idDe = req => {
  const id = Number.parseInt(req.params.id, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};

// PATCH /api/admin/usuarios/:id  { activo?: boolean, rol?: 'admin'|'doctor' }
async function actualizarUsuario(req, res) {
  const id = idDe(req);
  if (!id) return res.status(400).json({ message: 'Usuario no válido.' });
  const { activo, rol } = req.body || {};
  if (activo === undefined && rol === undefined) return res.status(400).json({ message: 'No se indicó ningún cambio.' });
  if (rol !== undefined && !['admin', 'doctor'].includes(rol)) return res.status(400).json({ message: 'Rol no válido.' });
  if (activo !== undefined && typeof activo !== 'boolean') return res.status(400).json({ message: 'Estado no válido.' });
  if (id === req.user.id && (activo === false || rol === 'doctor')) {
    return res.status(400).json({ message: 'No puedes desactivar ni quitarte el rol de administrador a ti mismo.' });
  }
  try {
    const pool = await poolPromise;
    // Siempre debe quedar al menos un administrador activo.
    if (activo === false || rol === 'doctor') {
      const admins = await pool.request().input('id', sql.Int, id)
        .query(`SELECT COUNT(*) AS otros FROM dbo.HisUsuarios WHERE Role = N'admin' AND IsActive = 1 AND IdUsuario <> @id`);
      const esAdmin = await pool.request().input('id', sql.Int, id).query(`SELECT Role FROM dbo.HisUsuarios WHERE IdUsuario = @id`);
      if (esAdmin.recordset[0]?.Role === 'admin' && admins.recordset[0].otros === 0) {
        return res.status(400).json({ message: 'Debe quedar al menos un administrador activo.' });
      }
    }
    const request = pool.request().input('id', sql.Int, id);
    const sets = [];
    if (activo !== undefined) { request.input('activo', sql.Bit, activo ? 1 : 0); sets.push('IsActive = @activo'); }
    if (rol !== undefined) { request.input('rol', sql.NVarChar(20), rol); sets.push('Role = @rol'); }
    const result = await request.query(`UPDATE dbo.HisUsuarios SET ${sets.join(', ')} WHERE IdUsuario = @id;
      ${activo === false ? 'DELETE FROM dbo.HisSesiones WHERE IdUsuario = @id;' : ''}`);
    if (!result.rowsAffected[0]) return res.status(404).json({ message: 'El usuario no existe.' });
    res.status(200).json({ message: 'Usuario actualizado.' });
  } catch (error) {
    console.error('Error al actualizar usuario:', error);
    res.status(500).json({ message: 'No se pudo actualizar el usuario.' });
  }
}

// POST /api/admin/usuarios/:id/password  { password }
async function restablecerPassword(req, res) {
  const id = idDe(req);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!id) return res.status(400).json({ message: 'Usuario no válido.' });
  if (password.length < 10 || password.length > 128) return res.status(400).json({ message: 'La contraseña debe tener entre 10 y 128 caracteres.' });
  try {
    const pool = await poolPromise;
    const hash = await hashPassword(password);
    const result = await pool.request().input('id', sql.Int, id).input('hash', sql.NVarChar(255), hash).query(`
      UPDATE dbo.HisUsuarios SET PasswordHash = @hash WHERE IdUsuario = @id;
      DELETE FROM dbo.HisSesiones WHERE IdUsuario = @id;`);
    if (!result.rowsAffected[0]) return res.status(404).json({ message: 'El usuario no existe.' });
    res.status(200).json({ message: 'Contraseña restablecida. El usuario deberá iniciar sesión de nuevo.' });
  } catch (error) {
    console.error('Error al restablecer contraseña:', error);
    res.status(500).json({ message: 'No se pudo restablecer la contraseña.' });
  }
}

// POST /api/admin/usuarios/:id/cerrar-sesiones
async function cerrarSesiones(req, res) {
  const id = idDe(req);
  if (!id) return res.status(400).json({ message: 'Usuario no válido.' });
  try {
    const pool = await poolPromise;
    const request = pool.request().input('id', sql.Int, id);
    // Si es el propio administrador, se conserva la sesión con la que está trabajando.
    let extra = '';
    if (id === req.user.id && req.sessionTokenHash) { request.input('actual', sql.Char(64), req.sessionTokenHash); extra = ' AND TokenHash <> @actual'; }
    const result = await request.query(`DELETE FROM dbo.HisSesiones WHERE IdUsuario = @id${extra}`);
    res.status(200).json({ message: `Se cerraron ${result.rowsAffected[0]} sesión(es).` });
  } catch (error) {
    console.error('Error al cerrar sesiones:', error);
    res.status(500).json({ message: 'No se pudieron cerrar las sesiones.' });
  }
}

// GET /api/admin/accesos?limite=50
async function accesos(req, res) {
  const limite = Math.min(200, Math.max(10, Number.parseInt(req.query.limite, 10) || 50));
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT TOP (${limite}) a.Fecha, a.Username, a.Ip, a.Exito, a.Detalle, u.FullName
      FROM dbo.HisAccesos a LEFT JOIN dbo.HisUsuarios u ON u.IdUsuario = a.IdUsuario
      ORDER BY a.Fecha DESC, a.IdAcceso DESC;
      SELECT
        SUM(CASE WHEN Exito = 1 AND Fecha >= DATEADD(day, -1, SYSUTCDATETIME()) THEN 1 ELSE 0 END) AS correctos24h,
        SUM(CASE WHEN Exito = 0 AND Fecha >= DATEADD(day, -1, SYSUTCDATETIME()) THEN 1 ELSE 0 END) AS fallidos24h
      FROM dbo.HisAccesos;`);
    res.status(200).json({
      accesos: result.recordsets[0].map(a => ({ fecha: a.Fecha, usuario: a.Username, nombre: a.FullName, ip: a.Ip, exito: Boolean(a.Exito), detalle: a.Detalle })),
      resumen: { correctos24h: Number(result.recordsets[1][0]?.correctos24h || 0), fallidos24h: Number(result.recordsets[1][0]?.fallidos24h || 0) }
    });
  } catch (error) {
    console.error('Error al leer accesos:', error);
    res.status(500).json({ message: 'No se pudo cargar el registro de accesos.' });
  }
}

// GET /api/admin/ajustes  ·  PUT /api/admin/ajustes { inactividadMin }
async function leerAjustes(req, res) {
  try {
    res.status(200).json({ sesion: await ajustes.leer(AJUSTES_SESION, { inactividadMin: 30 }) });
  } catch (error) {
    console.error('Error al leer ajustes:', error);
    res.status(500).json({ message: 'No se pudieron leer los ajustes.' });
  }
}

async function guardarAjustes(req, res) {
  const inactividadMin = Number(req.body?.inactividadMin);
  if (!INACTIVIDAD_PERMITIDA.includes(inactividadMin)) return res.status(400).json({ message: 'Tiempo de inactividad no válido.' });
  try {
    await ajustes.guardar(AJUSTES_SESION, { inactividadMin }, req.user.fullName);
    res.status(200).json({ message: 'Ajustes guardados.', sesion: { inactividadMin } });
  } catch (error) {
    console.error('Error al guardar ajustes:', error);
    res.status(500).json({ message: 'No se pudieron guardar los ajustes.' });
  }
}

// GET /api/auth/ajustes-sesion (cualquier usuario con sesión): tiempo de inactividad para cerrar la sesión.
async function ajustesSesionPublicos(req, res) {
  try {
    res.status(200).json(await ajustes.leer(AJUSTES_SESION, { inactividadMin: 30 }));
  } catch (_) {
    res.status(200).json({ inactividadMin: 30 });
  }
}

module.exports = { estado, limpiarCache, listarUsuarios, actualizarUsuario, restablecerPassword, cerrarSesiones, accesos, leerAjustes, guardarAjustes, ajustesSesionPublicos };
