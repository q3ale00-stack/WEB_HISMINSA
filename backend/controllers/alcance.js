// Alcance de los datos según la cuenta.
// Administradores y médicos con acceso completo ven todo. Un médico con acceso restringido solo ve:
//   · sus propias atenciones (NProduccion.Id_Personal = el Id_Personal de su cuenta), y
//   · la historia completa de los pacientes que ha atendido al menos una vez.
// Todo se aplica en el servidor; el frontend solo oculta lo que no se podría usar.
const { sql, poolPromise, withTransientRetry } = require('../config/db');
const { ACCESO_DENEGADO } = require('./mensajes');

// Valor que no coincide con ningún Id_Personal: una cuenta restringida sin médico asociado no ve datos.
const SIN_PERSONAL = '__sin_personal_asociado__';

const esLimitado = req => req.user?.role === 'doctor' && req.user?.access === 'restringido';
const miPersonal = req => String(req.user?.personalId || '').trim() || SIN_PERSONAL;

// Condición SQL «el médico atendió alguna vez a este paciente». Requiere el parámetro @miPersonal.
const atendioAlPaciente = columnaPaciente =>
  `EXISTS (SELECT 1 FROM NProduccion mio WHERE mio.Id_Paciente = ${columnaPaciente} AND mio.Id_Personal = @miPersonal)`;

// Agrega @miPersonal a la consulta y devuelve « AND <condición>» si la cuenta es restringida, o '' si no.
const filtroPacientes = (req, request, columnaPaciente) => {
  if (!esLimitado(req)) return '';
  request.input('miPersonal', sql.NVarChar(50), miPersonal(req));
  return ` AND ${atendioAlPaciente(columnaPaciente)}`;
};

// Reemplaza cada lectura de NProduccion por sus propias atenciones. Sirve para tableros y fichas que solo
// cuentan o listan atenciones: «FROM NProduccion np» pasa a «FROM (… WHERE Id_Personal = @miPersonal) np».
const soloMisAtenciones = (req, request, consulta) => {
  if (!esLimitado(req)) return consulta;
  request.input('miPersonal', sql.NVarChar(50), miPersonal(req));
  let n = 0;
  const palabrasClave = 'WHERE|GROUP|ORDER|OPTION|INNER|LEFT|RIGHT|FULL|CROSS|OUTER|JOIN|UNION|AS|WITH';
  const patron = new RegExp(`FROM\\s+NProduccion\\b(\\s+(?!(?:${palabrasClave})\\b)([A-Za-z_][A-Za-z0-9_]*))?`, 'gi');
  return consulta.replace(patron,
    (_, _conAlias, alias) => `FROM (SELECT * FROM NProduccion WHERE Id_Personal = @miPersonal) ${alias || `npMio${++n}`}`);
};

// Clave de caché distinta por médico restringido, para no servir a uno lo calculado para otro (o para todos).
const claveCache = (req, clave) => (esLimitado(req) ? `${clave}__pers_${miPersonal(req)}` : clave);

// Todas las negativas muestran el mismo mensaje; el motivo concreto queda solo en el código para quien lo lea.
const negar = res => res.status(403).json({ message: ACCESO_DENEGADO, code: 'ACCESO_DENEGADO' });

// ── Middlewares ──

// Rutas con un paciente en la URL (Id_Paciente o documento): solo si lo atendió alguna vez.
const soloPacientePropio = (obtener = req => req.params.id) => async (req, res, next) => {
  if (!esLimitado(req)) return next();
  const identificador = String(obtener(req) || '').trim().slice(0, 50);
  if (!identificador) return next();
  try {
    const pool = await poolPromise;
    const r = await withTransientRetry(() => pool.request()
      .input('identificador', sql.NVarChar(50), identificador)
      .input('miPersonal', sql.NVarChar(50), miPersonal(req))
      .query(`
        SELECT TOP (1) 1 AS ok
        FROM MaestroPaciente p
        WHERE (p.Id_Paciente = @identificador OR p.Numero_Documento_Paciente = @identificador)
          AND ${atendioAlPaciente('p.Id_Paciente')}`));
    if (!r.recordset.length) return negar(res, 'Solo puedes ver a los pacientes que has atendido.');
    next();
  } catch (error) {
    console.error('Error al comprobar el alcance del paciente:', error);
    res.status(503).json({ message: 'No se pudo comprobar el acceso a este paciente.' });
  }
};

// Detalle de una cita: si la registró él o si es de un paciente suyo.
const soloCitaPropia = async (req, res, next) => {
  if (!esLimitado(req)) return next();
  try {
    const pool = await poolPromise;
    const r = await withTransientRetry(() => pool.request()
      .input('cita', sql.NVarChar(50), String(req.params.id || '').trim().slice(0, 50))
      .input('miPersonal', sql.NVarChar(50), miPersonal(req))
      .query(`
        SELECT TOP (1) 1 AS ok
        FROM NProduccion n
        WHERE n.Id_Cita = @cita
          AND (n.Id_Personal = @miPersonal OR ${atendioAlPaciente('n.Id_Paciente')})`));
    if (!r.recordset.length) return negar(res, 'Solo puedes ver las atenciones de tus pacientes.');
    next();
  } catch (error) {
    console.error('Error al comprobar el alcance de la cita:', error);
    res.status(503).json({ message: 'No se pudo comprobar el acceso a esta atención.' });
  }
};

// Rutas con un profesional en la URL: solo su propia ficha.
const soloPersonalPropio = (req, res, next) => {
  if (!esLimitado(req)) return next();
  if (String(req.params.id || '').trim() !== miPersonal(req)) return negar(res, 'Solo puedes ver tu propia producción.');
  next();
};

// Reportes que ya aceptan ?idPersonal=: se fija al del médico, diga lo que diga la petición.
const forzarMiPersonal = (req, res, next) => {
  if (esLimitado(req)) req.query.idPersonal = miPersonal(req);
  next();
};

// Funciones que un médico restringido no usa (por ejemplo Defunciones del SINADEF).
const bloquearLimitado = (req, res, next) => {
  if (esLimitado(req)) return negar(res, 'Esta sección no está disponible para tu cuenta.');
  next();
};

module.exports = {
  esLimitado,
  miPersonal,
  filtroPacientes,
  soloMisAtenciones,
  claveCache,
  soloPacientePropio,
  soloCitaPropia,
  soloPersonalPropio,
  forzarMiPersonal,
  bloquearLimitado
};
