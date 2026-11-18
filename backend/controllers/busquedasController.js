// Búsquedas de pacientes, atenciones, defunciones y personal (tomadas del proyecto HIS).
// Solo lectura: cada búsqueda usa parámetros y un tope de filas para no saturar SQL Server.
const { sql, poolPromise, withTransientRetry } = require('../config/db');
const alcance = require('./alcance');

const MAX_PACIENTES = 100;
const MAX_PERSONAL = 100;
const MAX_DEFUNCIONES = 300;
const MAX_ATENCIONES = 200;
const MAX_ATENCIONES_FICHA = 1000;
const MAX_TEXTO = 150;

// Descripción del código HIS. El catálogo puede repetir un código; TOP (1) evita duplicar atenciones.
const DESCRIPCION_ITEM = `
  OUTER APPLY (
    SELECT TOP (1) catalogo.Descripcion_Item
    FROM MAESTRO_HIS_CIE_CPMS catalogo
    WHERE catalogo.Codigo_Item = n.Codigo_Item
    ORDER BY CASE WHEN NULLIF(LTRIM(RTRIM(catalogo.Descripcion_Item)), '') IS NULL THEN 1 ELSE 0 END
  ) c`;

const NOMBRE_PACIENTE = `NULLIF(LTRIM(RTRIM(CONCAT(LTRIM(RTRIM(pac.Apellido_Paterno_Paciente)), ' ', LTRIM(RTRIM(pac.Apellido_Materno_Paciente)), ' ', LTRIM(RTRIM(pac.Nombres_Paciente))))), '')`;
const NOMBRE_PERSONAL = `NULLIF(LTRIM(RTRIM(CONCAT(LTRIM(RTRIM(per.Apellido_Paterno_Personal)), ' ', LTRIM(RTRIM(per.Apellido_Materno_Personal)), ' ', LTRIM(RTRIM(per.Nombres_Personal))))), '')`;
const NOMBRE_REGISTRADOR = `NULLIF(LTRIM(RTRIM(CONCAT(LTRIM(RTRIM(reg.Apellido_Paterno_Registrador)), ' ', LTRIM(RTRIM(reg.Apellido_Materno_Registrador)), ' ', LTRIM(RTRIM(reg.Nombres_Registrador))))), '')`;

// Columnas de una atención con los nombres del paciente y del personal, la descripción del código
// y, para los historiales, el DNI y sexo del paciente, la profesión del personal, el financiador y el establecimiento.
// Los catálogos se leen con TOP (1) para no duplicar filas si repiten un código.
const SELECT_ATENCION = `
  n.*,
  ${NOMBRE_PACIENTE} AS Paciente,
  pac.Numero_Documento_Paciente AS DocumentoPaciente,
  pac.Id_Genero AS SexoPaciente,
  ${NOMBRE_PERSONAL} AS Personal,
  c.Descripcion_Item AS DescItem,
  ups.Descripcion_Ups AS Servicio,
  prof.Descripcion_Profesion AS ProfesionPersonal,
  fin.Descripcion_Financiador AS Financiador,
  est.Nombre_Establecimiento AS NombreEstablecimiento
  FROM NProduccion n
  LEFT JOIN MaestroPaciente pac ON n.Id_Paciente = pac.Id_Paciente
  LEFT JOIN MaestroPersonal per ON n.Id_Personal = per.Id_Personal
  ${DESCRIPCION_ITEM}
  OUTER APPLY (SELECT TOP (1) u.Descripcion_Ups FROM MAESTRO_HIS_UPS u WHERE u.Id_Ups = n.Id_Ups) ups
  OUTER APPLY (SELECT TOP (1) p.Descripcion_Profesion FROM MAESTRO_HIS_PROFESION p WHERE p.Id_Profesion = per.Id_Profesion) prof
  OUTER APPLY (SELECT TOP (1) f.Descripcion_Financiador FROM MAESTRO_HIS_FINANCIADOR f WHERE f.Id_Financiador = n.Id_Financiador) fin
  OUTER APPLY (SELECT TOP (1) e.Nombre_Establecimiento FROM MAESTRO_HIS_ESTABLECIMIENTO e WHERE e.Id_Establecimiento = n.Id_Establecimiento) est`;

const SELECT_PERSONAL = `
  p.*,
  prof.Descripcion_Profesion AS Profesion,
  col.Descripcion_Colegio    AS Colegio,
  cond.Descripcion_Condicion AS Condicion,
  est.Nombre_Establecimiento AS Establecimiento
  FROM MaestroPersonal p
  LEFT JOIN MAESTRO_HIS_PROFESION          prof ON p.Id_Profesion = prof.Id_Profesion
  LEFT JOIN MAESTRO_HIS_COLEGIO            col  ON p.Id_Colegio   = col.Id_Colegio
  LEFT JOIN MAESTRO_HIS_CONDICION_CONTRATO cond ON p.Id_Condicion = cond.Id_Condicion
  LEFT JOIN MAESTRO_HIS_ESTABLECIMIENTO    est  ON p.Id_Establecimiento = est.Id_Establecimiento`;

// Lee el texto de búsqueda; devuelve null si falta o es demasiado largo (y ya respondió al cliente).
const leerTexto = (req, res, { obligatorio = true } = {}) => {
  const valor = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (valor.length > MAX_TEXTO) {
    res.status(400).json({ message: `La búsqueda admite hasta ${MAX_TEXTO} caracteres.` });
    return null;
  }
  if (obligatorio && !valor) {
    res.status(400).json({ message: 'Escribe un dato para buscar.' });
    return null;
  }
  return valor;
};

const esFecha = valor => /^\d{4}-\d{2}-\d{2}$/.test(valor) && !Number.isNaN(Date.parse(`${valor}T00:00:00Z`));

// Separa el texto en palabras para buscar nombres en cualquier orden («juan perez» o «perez juan»).
const agregarTerminos = (request, texto) => {
  const terminos = texto.split(/\s+/).filter(Boolean).slice(0, 6);
  terminos.forEach((termino, index) => request.input(`t${index}`, sql.NVarChar(MAX_TEXTO), `%${termino}%`));
  return terminos;
};

// Responde con un mensaje claro cuando falta una tabla o la base no está disponible.
const responderError = (res, error, contexto) => {
  console.error(`Error en búsqueda de ${contexto}:`, error);
  if (error?.number === 208) {
    return res.status(404).json({ message: `La base de datos no tiene la tabla o vista necesaria para buscar ${contexto}.` });
  }
  if (error?.code === 'ETIMEOUT') {
    return res.status(504).json({ message: 'La búsqueda tardó demasiado. Escribe un dato más específico o acota las fechas.' });
  }
  return res.status(500).json({ message: `No se pudo realizar la búsqueda de ${contexto}.` });
};

// ── PACIENTES ──
// GET /api/busqueda/pacientes?q= : por ID, documento, historia clínica, ficha familiar o nombre.
const buscarPacientes = async (req, res) => {
  const q = leerTexto(req, res);
  if (q === null) return;
  try {
    const pool = await poolPromise;
    const result = await withTransientRetry(() => {
      const request = pool.request().input('q', sql.NVarChar(MAX_TEXTO + 2), `%${q}%`);
      const terminos = agregarTerminos(request, q);
      const soloMios = alcance.filtroPacientes(req, request, 'MaestroPaciente.Id_Paciente');
      const porTerminos = terminos.map((_, index) => `(
        Nombres_Paciente LIKE @t${index}
        OR Apellido_Paterno_Paciente LIKE @t${index}
        OR Apellido_Materno_Paciente LIKE @t${index}
      )`).join(' AND ');
      return request.query(`
        SELECT TOP (${MAX_PACIENTES}) *
        FROM MaestroPaciente
        WHERE (Id_Paciente LIKE @q
           OR Numero_Documento_Paciente LIKE @q
           OR Historia_Clinica LIKE @q
           OR Ficha_Familiar LIKE @q
           OR (${porTerminos}))${soloMios}
        ORDER BY Apellido_Paterno_Paciente, Apellido_Materno_Paciente, Nombres_Paciente
      `);
    });
    res.status(200).json(result.recordset);
  } catch (error) {
    responderError(res, error, 'pacientes');
  }
};

// GET /api/busqueda/pacientes/sugerencias?q=&limite=  |  ?id=
// Búsqueda simple para médicos: reconoce DNI, historia clínica, Id_Paciente o nombre, y devuelve hasta `limite`
// pacientes (8 por defecto) con su edad, sexo, establecimiento y fecha de la última atención.
// Con nombres, primero van quienes tienen palabras completas iguales a lo escrito («ANA» antes que «ORELLANA»).
const sugerenciasPacientes = async (req, res) => {
  const id = typeof req.query.id === 'string' ? req.query.id.trim().slice(0, 50) : '';
  const q = id ? '' : leerTexto(req, res);
  if (q === null) return;
  if (!id && q.length < 2) return res.status(200).json([]);
  const limite = Math.min(MAX_PACIENTES + 1, Math.max(1, Number.parseInt(req.query.limite, 10) || 8));
  try {
    const pool = await poolPromise;
    const result = await withTransientRetry(() => {
      const request = pool.request();
      let where;
      let coincidencia = '0';
      if (id) {
        request.input('id', sql.NVarChar(50), id);
        where = 'p.Id_Paciente = @id';
      } else if (/^\d+$/.test(q)) {
        // Solo números: DNI, historia clínica o Id_Paciente (empiezan con lo escrito).
        request.input('exacto', sql.NVarChar(MAX_TEXTO), q);
        request.input('inicio', sql.NVarChar(MAX_TEXTO + 1), `${q}%`);
        where = `p.Numero_Documento_Paciente LIKE @inicio OR p.Historia_Clinica = @exacto OR p.Historia_Clinica LIKE @inicio OR p.Id_Paciente = @exacto`;
      } else {
        const terminos = agregarTerminos(request, q);
        request.input('exacto', sql.NVarChar(MAX_TEXTO), q);
        where = `p.Historia_Clinica = @exacto OR (${terminos.map((_, i) => `CONCAT(p.Apellido_Paterno_Paciente, ' ', p.Apellido_Materno_Paciente, ' ', p.Nombres_Paciente) LIKE @t${i}`).join(' AND ')})`;
        // Cuántas palabras escritas coinciden con una palabra completa del nombre.
        terminos.forEach((termino, i) => request.input(`w${i}`, sql.NVarChar(MAX_TEXTO + 4), `% ${termino} %`));
        coincidencia = terminos.map((_, i) => `CASE WHEN CONCAT(' ', p.Apellido_Paterno_Paciente, ' ', p.Apellido_Materno_Paciente, ' ', p.Nombres_Paciente, ' ') LIKE @w${i} THEN 1 ELSE 0 END`).join(' + ');
      }
      return request.query(`
        SELECT TOP (${limite})
          p.Id_Paciente, p.Numero_Documento_Paciente AS Documento, p.Historia_Clinica, p.Ficha_Familiar,
          NULLIF(LTRIM(RTRIM(CONCAT(LTRIM(RTRIM(p.Apellido_Paterno_Paciente)), ' ', LTRIM(RTRIM(p.Apellido_Materno_Paciente)), ' ', LTRIM(RTRIM(p.Nombres_Paciente))))), '') AS Paciente,
          p.Fecha_Nacimiento_Paciente AS FechaNacimiento, p.Id_Genero AS Sexo, p.Domicilio_Declarado, p.Domicilio_Reniec,
          est.Nombre_Establecimiento AS Establecimiento,
          ult.UltimaAtencion, ult.Atenciones,
          COUNT(*) OVER () AS Total -- todos los que coinciden, no solo los devueltos
        FROM MaestroPaciente p
        OUTER APPLY (SELECT TOP (1) e.Nombre_Establecimiento FROM MAESTRO_HIS_ESTABLECIMIENTO e WHERE e.Id_Establecimiento = p.Id_Establecimiento) est
        OUTER APPLY (SELECT MAX(n.Fecha_Atencion) AS UltimaAtencion, COUNT(DISTINCT n.Id_Cita) AS Atenciones FROM NProduccion n WHERE n.Id_Paciente = p.Id_Paciente) ult
        CROSS APPLY (SELECT ${coincidencia} AS Palabras) rel
        WHERE (${where})${alcance.filtroPacientes(req, request, 'p.Id_Paciente')}
        ORDER BY rel.Palabras DESC, CASE WHEN ult.UltimaAtencion IS NULL THEN 1 ELSE 0 END, ult.UltimaAtencion DESC, Paciente
      `);
    });
    res.status(200).json(result.recordset);
  } catch (error) {
    responderError(res, error, 'pacientes');
  }
};

// GET /api/busqueda/mis-pacientes?pagina=1&tam=20
// Lista de «Mis pacientes»: los que atendió el profesional de la cuenta, del más reciente al más antiguo según su
// última atención. Mismas columnas que las sugerencias, pero UltimaAtencion y Atenciones son las suyas con ese paciente.
const misPacientes = async (req, res) => {
  const personalId = String(req.user?.personalId || '').trim();
  if (!personalId) return res.status(200).json({ total: 0, filas: [], sinPersonal: true });
  const tam = Math.min(100, Math.max(1, Number.parseInt(req.query.tam, 10) || 20));
  const pagina = Math.min(10000, Math.max(1, Number.parseInt(req.query.pagina, 10) || 1));
  try {
    const pool = await poolPromise;
    const result = await withTransientRetry(() => pool.request()
      .input('miPersonal', sql.NVarChar(50), personalId)
      .input('offset', sql.Int, (pagina - 1) * tam)
      .input('tam', sql.Int, tam)
      .query(`
        WITH mios AS (
          SELECT n.Id_Paciente, MAX(n.Fecha_Atencion) AS UltimaAtencion, COUNT(DISTINCT n.Id_Cita) AS Atenciones
          FROM NProduccion n
          WHERE n.Id_Personal = @miPersonal AND n.Id_Paciente IS NOT NULL
          GROUP BY n.Id_Paciente
        )
        SELECT
          p.Id_Paciente, p.Numero_Documento_Paciente AS Documento, p.Historia_Clinica, p.Ficha_Familiar,
          ${NOMBRE_PACIENTE.replace(/pac\./g, 'p.')} AS Paciente,
          p.Fecha_Nacimiento_Paciente AS FechaNacimiento, p.Id_Genero AS Sexo, p.Domicilio_Declarado, p.Domicilio_Reniec,
          est.Nombre_Establecimiento AS Establecimiento,
          m.UltimaAtencion, m.Atenciones,
          COUNT(*) OVER () AS Total
        FROM mios m
        INNER JOIN MaestroPaciente p ON p.Id_Paciente = m.Id_Paciente
        OUTER APPLY (SELECT TOP (1) e.Nombre_Establecimiento FROM MAESTRO_HIS_ESTABLECIMIENTO e WHERE e.Id_Establecimiento = p.Id_Establecimiento) est
        ORDER BY m.UltimaAtencion DESC, Paciente
        OFFSET @offset ROWS FETCH NEXT @tam ROWS ONLY
      `));
    const filas = result.recordset;
    res.status(200).json({ total: Number(filas[0]?.Total || 0), pagina, tam, filas: filas.map(({ Total, ...f }) => f) });
  } catch (error) {
    responderError(res, error, 'tus pacientes');
  }
};

// GET /api/busqueda/pacientes/:id/atenciones : atenciones del paciente, de la más reciente a la más antigua.
const atencionesPaciente = async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await withTransientRetry(() => pool.request()
      .input('id', sql.NVarChar(50), String(req.params.id).slice(0, 50))
      .query(`
        SELECT TOP (${MAX_ATENCIONES_FICHA}) ${SELECT_ATENCION}
        WHERE n.Id_Paciente = @id
        ORDER BY n.Fecha_Atencion DESC, n.Id_Cita
      `));
    res.status(200).json(result.recordset);
  } catch (error) {
    responderError(res, error, 'atenciones');
  }
};

// ── ATENCIONES ──
// GET /api/busqueda/atenciones?modo=todos|cita|paciente|personal|codigo&q=&desde=&hasta=
// GET /api/busqueda/atenciones?personal=ID : atenciones de un profesional (desde la ficha de personal).
const buscarAtenciones = async (req, res) => {
  const q = leerTexto(req, res, { obligatorio: false });
  if (q === null) return;
  const modo = typeof req.query.modo === 'string' ? req.query.modo : 'todos';
  const desde = typeof req.query.desde === 'string' ? req.query.desde : '';
  const hasta = typeof req.query.hasta === 'string' ? req.query.hasta : '';
  const personal = typeof req.query.personal === 'string' ? req.query.personal.trim().slice(0, 50) : '';
  if ((desde && !esFecha(desde)) || (hasta && !esFecha(hasta))) {
    return res.status(400).json({ message: 'Las fechas deben tener el formato AAAA-MM-DD.' });
  }
  if (desde && hasta && desde > hasta) {
    return res.status(400).json({ message: 'La fecha «Desde» no puede ser posterior a «Hasta».' });
  }
  if (!q && !desde && !hasta && !personal) {
    return res.status(400).json({ message: 'Indica un dato o un rango de fechas.' });
  }

  try {
    const pool = await poolPromise;
    const result = await withTransientRetry(() => {
      const request = pool.request();
      const condiciones = [];
      let tope = MAX_ATENCIONES;
      // Un médico restringido solo ve las atenciones que él registró.
      if (alcance.esLimitado(req)) {
        request.input('miPersonal', sql.NVarChar(50), alcance.miPersonal(req));
        condiciones.push('n.Id_Personal = @miPersonal');
      }
      if (personal) {
        request.input('personal', sql.NVarChar(50), personal);
        condiciones.push('n.Id_Personal = @personal');
        tope = MAX_ATENCIONES_FICHA;
      }
      if (q) {
        request.input('q', sql.NVarChar(MAX_TEXTO + 2), `%${q}%`);
        const porModo = {
          cita: 'n.Id_Cita LIKE @q',
          paciente: 'n.Id_Paciente LIKE @q',
          personal: 'n.Id_Personal LIKE @q',
          codigo: 'n.Codigo_Item LIKE @q'
        };
        condiciones.push(porModo[modo] || '(n.Id_Cita LIKE @q OR n.Id_Paciente LIKE @q OR n.Id_Personal LIKE @q OR n.Codigo_Item LIKE @q)');
      }
      if (desde) {
        request.input('desde', sql.Date, desde);
        condiciones.push('n.Fecha_Atencion >= @desde');
      }
      if (hasta) {
        request.input('hasta', sql.Date, hasta);
        condiciones.push('n.Fecha_Atencion < DATEADD(DAY, 1, @hasta)');
      }
      return request.query(`
        SELECT TOP (${tope}) ${SELECT_ATENCION}
        WHERE ${condiciones.join(' AND ')}
        ORDER BY n.Fecha_Atencion DESC, n.Id_Cita
      `);
    });
    res.status(200).json(result.recordset);
  } catch (error) {
    responderError(res, error, 'atenciones');
  }
};

// ── ATENCIONES PAGINADAS POR CITA ──
// GET /api/busqueda/atenciones/citas?personal=&texto=&desde=&hasta=&pagina=1&tam=20&resumen=1&periodos=1
// Pagina por citas completas (nunca corta una cita a la mitad) y devuelve los totales reales calculados en el servidor:
//   totalCitas · filas (todas las anotaciones de las citas de la página) · resumen (si resumen=1) · periodos (si periodos=1).
// «texto» busca en la cita, el código y su descripción, el servicio, el DNI, el nombre y el ID del paciente.
// Un médico restringido solo ve sus propias atenciones.
const TAM_CITAS = 20;
const MAX_TAM_CITAS = 100;
const citasPaginadas = async (req, res) => {
  const texto = leerTexto({ query: { q: req.query.texto } }, res, { obligatorio: false });
  if (texto === null) return;
  const desde = typeof req.query.desde === 'string' ? req.query.desde : '';
  const hasta = typeof req.query.hasta === 'string' ? req.query.hasta : '';
  const personal = typeof req.query.personal === 'string' ? req.query.personal.trim().slice(0, 50) : '';
  if ((desde && !esFecha(desde)) || (hasta && !esFecha(hasta))) return res.status(400).json({ message: 'Las fechas deben tener el formato AAAA-MM-DD.' });
  if (desde && hasta && desde > hasta) return res.status(400).json({ message: 'La fecha «Desde» no puede ser posterior a «Hasta».' });
  // Filtros del panel («Mis atenciones»): una cita entra si alguna de sus filas cumple.
  const filtros = [];
  const paramsFiltros = [];
  const entero = (v, min, max) => { const n = Number(v); return v !== undefined && v !== '' && Number.isInteger(n) && n >= min && n <= max ? n : null; };
  const anio = entero(req.query.anio, 1990, 2100);
  if (anio !== null) { filtros.push('YEAR(n.Fecha_Atencion) = @fAnio'); paramsFiltros.push(['fAnio', sql.Int, anio]); }
  const meses = [...new Set(String(req.query.meses || '').split(',').map(m => entero(m.trim(), 1, 12)).filter(m => m !== null))];
  if (meses.length) filtros.push(`MONTH(n.Fecha_Atencion) IN (${meses.join(',')})`);
  const idPaciente = typeof req.query.idPaciente === 'string' ? req.query.idPaciente.trim().slice(0, 50) : '';
  if (idPaciente) { filtros.push('n.Id_Paciente = @fPac'); paramsFiltros.push(['fPac', sql.NVarChar(50), idPaciente]); }
  const ups = typeof req.query.ups === 'string' ? req.query.ups.trim().slice(0, 50) : '';
  if (ups) { filtros.push('n.Id_Ups = @fUps'); paramsFiltros.push(['fUps', sql.NVarChar(50), ups]); }
  const codigo = typeof req.query.codigo === 'string' ? req.query.codigo.trim().slice(0, MAX_TEXTO) : '';
  if (codigo) {
    filtros.push(`(n.Codigo_Item LIKE @fCodIni OR EXISTS (SELECT 1 FROM MAESTRO_HIS_CIE_CPMS k WHERE k.Codigo_Item = n.Codigo_Item AND k.Descripcion_Item LIKE @fCodTxt))`);
    paramsFiltros.push(['fCodIni', sql.NVarChar(MAX_TEXTO + 1), `${codigo}%`], ['fCodTxt', sql.NVarChar(MAX_TEXTO + 2), `%${codigo}%`]);
  }
  const td = String(req.query.td || '').trim().toUpperCase();
  if (['D', 'P', 'R'].includes(td)) { filtros.push('UPPER(LTRIM(RTRIM(n.Tipo_Diagnostico))) = @fTd'); paramsFiltros.push(['fTd', sql.NVarChar(2), td]); }
  const sexo = String(req.query.sexo || '').trim().toUpperCase();
  if (['F', 'M'].includes(sexo)) { filtros.push('EXISTS (SELECT 1 FROM MaestroPaciente ps WHERE ps.Id_Paciente = n.Id_Paciente AND ps.Id_Genero = @fSexo)'); paramsFiltros.push(['fSexo', sql.NVarChar(2), sexo]); }
  // Edad en años al momento de la atención (los menores de un año cuentan como 0).
  const edadMin = entero(req.query.edadMin, 0, 150);
  const edadMax = entero(req.query.edadMax, 0, 150);
  const EDAD = "(CASE WHEN UPPER(LTRIM(RTRIM(n.Tipo_Edad))) = 'A' THEN TRY_CAST(n.Edad_Reg AS int) ELSE 0 END)";
  if (edadMin !== null) { filtros.push(`${EDAD} >= @fEdadMin`); paramsFiltros.push(['fEdadMin', sql.Int, edadMin]); }
  if (edadMax !== null) { filtros.push(`${EDAD} <= @fEdadMax`); paramsFiltros.push(['fEdadMax', sql.Int, edadMax]); }
  const conOpciones = req.query.opciones === '1';

  if (!texto && !desde && !hasta && !personal && !filtros.length && !alcance.esLimitado(req)) return res.status(400).json({ message: 'Indica un dato o un rango de fechas.' });
  const tam = Math.min(MAX_TAM_CITAS, Math.max(1, Number.parseInt(req.query.tam, 10) || TAM_CITAS));
  const pagina = Math.min(100000, Math.max(1, Number.parseInt(req.query.pagina, 10) || 1));
  const conResumen = req.query.resumen === '1';
  const conPeriodos = req.query.periodos === '1';

  try {
    const pool = await poolPromise;
    const result = await withTransientRetry(() => {
      const request = pool.request()
        .input('offset', sql.Int, (pagina - 1) * tam)
        .input('tam', sql.Int, tam);
      paramsFiltros.forEach(([nombre, tipo, valor]) => request.input(nombre, tipo, valor));
      const filtroPanel = filtros.length ? ` AND ${filtros.join(' AND ')}` : '';
      // Condición base (quién): se aplica a las citas, a sus filas y a los periodos.
      const base = ['n.Id_Cita IS NOT NULL'];
      if (alcance.esLimitado(req)) {
        request.input('miPersonal', sql.NVarChar(50), alcance.miPersonal(req));
        base.push('n.Id_Personal = @miPersonal');
      }
      if (personal) { request.input('personal', sql.NVarChar(50), personal); base.push('n.Id_Personal = @personal'); }
      // Fechas (cuándo): no se aplican a los conteos por periodo, que tienen sus propias fechas.
      const fechas = [];
      if (desde) { request.input('desde', sql.Date, desde); fechas.push('n.Fecha_Atencion >= @desde'); }
      if (hasta) { request.input('hasta', sql.Date, hasta); fechas.push('n.Fecha_Atencion < DATEADD(DAY, 1, @hasta)'); }
      const filtroFilas = [...base, ...fechas].join(' AND ');
      // Texto: una cita entra si alguna de sus filas coincide; luego se muestran todas sus filas.
      let unionesTexto = '';
      let filtroTexto = '';
      if (texto) {
        request.input('texto', sql.NVarChar(MAX_TEXTO + 2), `%${texto}%`);
        unionesTexto = `
          LEFT JOIN MaestroPaciente pac ON pac.Id_Paciente = n.Id_Paciente
          OUTER APPLY (SELECT TOP (1) cat.Descripcion_Item FROM MAESTRO_HIS_CIE_CPMS cat WHERE cat.Codigo_Item = n.Codigo_Item) c
          OUTER APPLY (SELECT TOP (1) u.Descripcion_Ups FROM MAESTRO_HIS_UPS u WHERE u.Id_Ups = n.Id_Ups) ups`;
        filtroTexto = ` AND (n.Id_Cita LIKE @texto OR n.Codigo_Item LIKE @texto OR c.Descripcion_Item LIKE @texto
          OR ups.Descripcion_Ups LIKE @texto OR n.Id_Paciente LIKE @texto OR pac.Numero_Documento_Paciente LIKE @texto
          OR CONCAT(pac.Apellido_Paterno_Paciente, ' ', pac.Apellido_Materno_Paciente, ' ', pac.Nombres_Paciente) LIKE @texto
          ${alcance.esLimitado(req) || personal ? '' : 'OR n.Id_Personal LIKE @texto'})`;
      }

      const resumenSql = !conResumen ? '' : `
        SELECT n.Id_Cita, n.Id_Paciente, n.Id_Personal, n.Id_Ups, n.Id_Financiador, n.Id_Condicion_Servicio, n.Codigo_Item, n.Fecha_Atencion
        INTO #r FROM NProduccion n INNER JOIN #c ON #c.Id_Cita = n.Id_Cita WHERE ${filtroFilas};

        SELECT COUNT(DISTINCT Id_Paciente) AS pacientes, COUNT(DISTINCT Id_Personal) AS profesionales,
          COUNT(DISTINCT CASE WHEN UPPER(LTRIM(RTRIM(Id_Condicion_Servicio))) = 'N' THEN Id_Cita END) AS nuevos,
          MIN(Fecha_Atencion) AS primera, MAX(Fecha_Atencion) AS ultima
        FROM #r;

        SELECT TOP (12) COALESCE(MAX(u.Descripcion_Ups), 'Atención') AS nombre, COUNT(DISTINCT r.Id_Cita) AS n
        FROM #r r LEFT JOIN MAESTRO_HIS_UPS u ON u.Id_Ups = r.Id_Ups
        GROUP BY r.Id_Ups ORDER BY n DESC;

        SELECT TOP (1) MAX(f.Descripcion_Financiador) AS nombre, COUNT(DISTINCT r.Id_Cita) AS n
        FROM #r r INNER JOIN MAESTRO_HIS_FINANCIADOR f ON f.Id_Financiador = r.Id_Financiador
        GROUP BY r.Id_Financiador ORDER BY n DESC;

        SELECT TOP (1) MAX(${NOMBRE_PACIENTE}) AS nombre, COUNT(DISTINCT r.Id_Cita) AS n
        FROM #r r INNER JOIN MaestroPaciente pac ON pac.Id_Paciente = r.Id_Paciente
        GROUP BY r.Id_Paciente ORDER BY n DESC;

        SELECT TOP (1) MAX(${NOMBRE_PERSONAL}) AS nombre, COUNT(DISTINCT r.Id_Cita) AS n
        FROM #r r INNER JOIN MaestroPersonal per ON per.Id_Personal = r.Id_Personal
        GROUP BY r.Id_Personal ORDER BY n DESC;

        -- Más frecuentes: cada código cuenta una vez por cita. Los procedimientos empiezan con un número.
        ;WITH k AS (
          SELECT LTRIM(RTRIM(r.Codigo_Item)) AS cod, COUNT(DISTINCT r.Id_Cita) AS n,
            CASE WHEN LTRIM(r.Codigo_Item) LIKE '[0-9]%' THEN 1 ELSE 0 END AS esProc
          FROM #r r WHERE NULLIF(LTRIM(RTRIM(r.Codigo_Item)), '') IS NOT NULL
          GROUP BY LTRIM(RTRIM(r.Codigo_Item)), CASE WHEN LTRIM(r.Codigo_Item) LIKE '[0-9]%' THEN 1 ELSE 0 END
        ), o AS (SELECT k.*, ROW_NUMBER() OVER (PARTITION BY k.esProc ORDER BY k.n DESC, k.cod) AS orden FROM k)
        SELECT o.cod, o.n, o.esProc, d.Descripcion_Item AS descr
        FROM o OUTER APPLY (SELECT TOP (1) cat.Descripcion_Item FROM MAESTRO_HIS_CIE_CPMS cat WHERE cat.Codigo_Item = o.cod) d
        WHERE o.orden <= 6 ORDER BY o.esProc, o.n DESC;`;

      const periodosSql = !conPeriodos ? '' : `
        DECLARE @hoy date = CAST(GETDATE() AS date);
        SELECT
          SUM(CASE WHEN f >= DATEADD(MONTH, -1, @hoy) THEN 1 ELSE 0 END) AS mes,
          SUM(CASE WHEN f >= DATEADD(MONTH, -6, @hoy) THEN 1 ELSE 0 END) AS seis,
          SUM(CASE WHEN f >= DATEADD(MONTH, -12, @hoy) THEN 1 ELSE 0 END) AS anio,
          COUNT(*) AS todo
        FROM (SELECT MAX(n.Fecha_Atencion) AS f FROM NProduccion n WHERE ${base.join(' AND ')} GROUP BY n.Id_Cita) x;`;

      // Valores de las listas del panel, solo con lo que hay dentro del alcance (años y servicios con atenciones).
      const opcionesSql = !conOpciones ? '' : `
        SELECT DISTINCT YEAR(n.Fecha_Atencion) AS anio FROM NProduccion n WHERE ${base.join(' AND ')} AND n.Fecha_Atencion IS NOT NULL ORDER BY anio DESC;
        SELECT n.Id_Ups AS id, MAX(u.Descripcion_Ups) AS nombre, COUNT(DISTINCT n.Id_Cita) AS n
        FROM NProduccion n LEFT JOIN MAESTRO_HIS_UPS u ON u.Id_Ups = n.Id_Ups
        WHERE ${base.join(' AND ')} AND n.Id_Ups IS NOT NULL
        GROUP BY n.Id_Ups ORDER BY n DESC;`;

      return request.query(`
        SELECT n.Id_Cita, MAX(n.Fecha_Atencion) AS f
        INTO #c
        FROM NProduccion n ${unionesTexto}
        WHERE ${filtroFilas}${filtroTexto}${filtroPanel}
        GROUP BY n.Id_Cita;

        SELECT COUNT_BIG(*) AS totalCitas FROM #c;

        ;WITH pagina AS (SELECT Id_Cita FROM #c ORDER BY f DESC, Id_Cita OFFSET @offset ROWS FETCH NEXT @tam ROWS ONLY)
        SELECT ${SELECT_ATENCION}
        WHERE n.Id_Cita IN (SELECT Id_Cita FROM pagina) AND ${filtroFilas}
        ORDER BY n.Fecha_Atencion DESC, n.Id_Cita;
        ${resumenSql}
        ${periodosSql}
        ${opcionesSql}
      `);
    });

    const sets = result.recordsets;
    const respuesta = { totalCitas: Number(sets[0][0].totalCitas), pagina, tam, filas: sets[1] };
    let i = 2;
    if (conResumen) {
      const [g, servicios, fin, pac, per, frecuentes] = sets.slice(i, i + 6);
      i += 6;
      const lista = proc => frecuentes.filter(f => f.esProc === proc).map(f => ({ cod: f.cod, desc: f.descr, n: Number(f.n) }));
      respuesta.resumen = {
        pacientes: Number(g[0]?.pacientes || 0),
        profesionales: Number(g[0]?.profesionales || 0),
        nuevos: Number(g[0]?.nuevos || 0),
        primera: g[0]?.primera || null,
        ultima: g[0]?.ultima || null,
        servicios: servicios.map(s => ({ nombre: s.nombre, n: Number(s.n) })),
        financiador: fin[0] ? { nombre: fin[0].nombre, n: Number(fin[0].n) } : null,
        pacienteFrecuente: pac[0] ? { nombre: pac[0].nombre, n: Number(pac[0].n) } : null,
        profesionalFrecuente: per[0] ? { nombre: per[0].nombre, n: Number(per[0].n) } : null,
        diagnosticos: lista(0),
        procedimientos: lista(1)
      };
    }
    if (conPeriodos) {
      const p = sets[i][0] || {};
      respuesta.periodos = { mes: Number(p.mes || 0), seis: Number(p.seis || 0), anio: Number(p.anio || 0), todo: Number(p.todo || 0) };
      i += 1;
    }
    if (conOpciones) {
      respuesta.opciones = {
        anios: sets[i].map(r => Number(r.anio)),
        servicios: sets[i + 1].map(s => ({ id: String(s.id), nombre: s.nombre || String(s.id), n: Number(s.n) }))
      };
    }
    res.status(200).json(respuesta);
  } catch (error) {
    responderError(res, error, 'atenciones');
  }
};

// ── DEFUNCIONES ──
// GET /api/busqueda/defunciones?modo=todos|documento|n|cdef|nombre&q=
const buscarDefunciones = async (req, res) => {
  // El texto es opcional cuando se indica un rango de fechas (por ejemplo «último mes»).
  const desde = typeof req.query.desde === 'string' ? req.query.desde : '';
  const hasta = typeof req.query.hasta === 'string' ? req.query.hasta : '';
  if ((desde && !esFecha(desde)) || (hasta && !esFecha(hasta))) {
    return res.status(400).json({ message: 'Las fechas deben tener el formato AAAA-MM-DD.' });
  }
  if (desde && hasta && desde > hasta) {
    return res.status(400).json({ message: 'La fecha «Desde» no puede ser posterior a «Hasta».' });
  }
  const q = leerTexto(req, res, { obligatorio: !desde && !hasta });
  if (q === null) return;
  const modo = typeof req.query.modo === 'string' ? req.query.modo : 'todos';
  try {
    const pool = await poolPromise;
    const result = await withTransientRetry(() => {
      const request = pool.request();
      const condiciones = [];
      if (q) {
        request.input('q', sql.NVarChar(MAX_TEXTO + 2), `%${q}%`);
        const terminos = agregarTerminos(request, q);
        const porNombre = `(${terminos.map((_, index) => `(
          NOMBRES LIKE @t${index} OR PRIMER_APELLIDO LIKE @t${index} OR SEGUNDO_APELLIDO LIKE @t${index}
        )`).join(' AND ')})`;
        const porModo = {
          documento: 'DOCUMENTO LIKE @q',
          n: 'N LIKE @q',
          cdef: 'CDEF LIKE @q',
          nombre: porNombre
        };
        condiciones.push(porModo[modo] || `(DOCUMENTO LIKE @q OR N LIKE @q OR CDEF LIKE @q OR ${porNombre})`);
      }
      if (desde) { request.input('desde', sql.Date, desde); condiciones.push('FECHA >= @desde'); }
      if (hasta) { request.input('hasta', sql.Date, hasta); condiciones.push('FECHA < DATEADD(day, 1, @hasta)'); }
      return request.query(`
        SELECT TOP (${MAX_DEFUNCIONES}) *
        FROM V_SINADEF_AYACUCHO_DOMFALLECIDO
        WHERE ${condiciones.join(' AND ')}
        ORDER BY FECHA DESC
      `);
    });
    res.status(200).json(result.recordset);
  } catch (error) {
    responderError(res, error, 'defunciones');
  }
};

// ── PERSONAL ──
// GET /api/busqueda/personal?modo=todo|id|documento|nombre&q=
const buscarPersonal = async (req, res) => {
  const q = leerTexto(req, res);
  if (q === null) return;
  const modo = typeof req.query.modo === 'string' ? req.query.modo : 'todo';
  try {
    const pool = await poolPromise;
    const result = await withTransientRetry(() => {
      const request = pool.request().input('q', sql.NVarChar(MAX_TEXTO + 2), `%${q}%`);
      const terminos = agregarTerminos(request, q);
      const porNombre = `(${terminos.map((_, index) => `(
        p.Nombres_Personal LIKE @t${index}
        OR p.Apellido_Paterno_Personal LIKE @t${index}
        OR p.Apellido_Materno_Personal LIKE @t${index}
      )`).join(' AND ')})`;
      const porModo = {
        id: 'p.Id_Personal LIKE @q',
        documento: 'p.Numero_Documento_Personal LIKE @q',
        nombre: porNombre
      };
      let where = porModo[modo] || `(p.Id_Personal LIKE @q OR p.Numero_Documento_Personal LIKE @q OR ${porNombre})`;
      // Un médico restringido solo encuentra su propia ficha.
      if (alcance.esLimitado(req)) {
        request.input('miPersonal', sql.NVarChar(50), alcance.miPersonal(req));
        where = `(${where}) AND p.Id_Personal = @miPersonal`;
      }
      return request.query(`
        SELECT TOP (${MAX_PERSONAL}) ${SELECT_PERSONAL}
        WHERE ${where}
        ORDER BY p.Apellido_Paterno_Personal, p.Apellido_Materno_Personal, p.Nombres_Personal
      `);
    });
    res.status(200).json(result.recordset);
  } catch (error) {
    responderError(res, error, 'personal');
  }
};

// GET /api/busqueda/personal/sugerencias?q=texto[&limite=n] | ?id=Id_Personal
// Igual que las sugerencias de pacientes: ficha del profesional con su última atención y número de citas.
// Solo números: ID o DNI (empiezan con lo escrito); con letras, todas las palabras deben estar en el nombre.
const sugerenciasPersonal = async (req, res) => {
  const id = typeof req.query.id === 'string' ? req.query.id.trim().slice(0, 50) : '';
  const q = id ? '' : leerTexto(req, res);
  if (q === null) return;
  if (!id && q.length < 2) return res.status(200).json([]);
  const limite = Math.min(MAX_PERSONAL + 1, Math.max(1, Number.parseInt(req.query.limite, 10) || 8));
  try {
    const pool = await poolPromise;
    const result = await withTransientRetry(() => {
      const request = pool.request();
      let where;
      let coincidencia = '0';
      if (id) {
        request.input('id', sql.NVarChar(50), id);
        where = 'p.Id_Personal = @id';
      } else if (/^\d+$/.test(q)) {
        request.input('inicio', sql.NVarChar(MAX_TEXTO + 1), `${q}%`);
        where = 'p.Numero_Documento_Personal LIKE @inicio OR p.Id_Personal LIKE @inicio';
      } else {
        const terminos = agregarTerminos(request, q);
        where = terminos.map((_, i) => `CONCAT(p.Apellido_Paterno_Personal, ' ', p.Apellido_Materno_Personal, ' ', p.Nombres_Personal) LIKE @t${i}`).join(' AND ');
        terminos.forEach((termino, i) => request.input(`w${i}`, sql.NVarChar(MAX_TEXTO + 4), `% ${termino} %`));
        coincidencia = terminos.map((_, i) => `CASE WHEN CONCAT(' ', p.Apellido_Paterno_Personal, ' ', p.Apellido_Materno_Personal, ' ', p.Nombres_Personal, ' ') LIKE @w${i} THEN 1 ELSE 0 END`).join(' + ');
      }
      return request.query(`
        SELECT TOP (${limite}) x.*, ult.UltimaAtencion, ult.Atenciones,
          COUNT(*) OVER () AS Total -- todos los que coinciden, no solo los devueltos
        FROM (
          SELECT ${coincidencia} AS Palabras, ${SELECT_PERSONAL}
          WHERE ${where}
        ) x
        OUTER APPLY (SELECT MAX(n.Fecha_Atencion) AS UltimaAtencion, COUNT(DISTINCT n.Id_Cita) AS Atenciones FROM NProduccion n WHERE n.Id_Personal = x.Id_Personal) ult
        ORDER BY x.Palabras DESC, CASE WHEN ult.UltimaAtencion IS NULL THEN 1 ELSE 0 END, ult.UltimaAtencion DESC,
          x.Apellido_Paterno_Personal, x.Apellido_Materno_Personal, x.Nombres_Personal
      `);
    });
    res.status(200).json(result.recordset);
  } catch (error) {
    responderError(res, error, 'personal');
  }
};

// GET /api/busqueda/personal/resumen : totales de las tarjetas de la vista Personal.
const resumenPersonal = async (req, res) => {
  const tablas = {
    personal: 'MaestroPersonal',
    profesiones: 'MAESTRO_HIS_PROFESION',
    colegios: 'MAESTRO_HIS_COLEGIO',
    condicionesContrato: 'MAESTRO_HIS_CONDICION_CONTRATO'
  };
  try {
    const pool = await poolPromise;
    // Se comprueba cada tabla antes de contarla: si falta una, su tarjeta muestra «—» y las demás funcionan.
    const totales = {};
    for (const [clave, tabla] of Object.entries(tablas)) {
      const existe = await pool.request().input('t', sql.NVarChar(200), `dbo.${tabla}`)
        .query(`SELECT OBJECT_ID(@t) AS id`);
      if (!existe.recordset[0].id) { totales[clave] = null; continue; }
      const conteo = await pool.request().query(`SELECT COUNT_BIG(*) AS total FROM dbo.${tabla}`);
      totales[clave] = Number(conteo.recordset[0].total);
    }
    res.status(200).json(totales);
  } catch (error) {
    responderError(res, error, 'personal');
  }
};


// ── REPORTE MENSUAL DEL PERSONAL ──
// Modelo «Reporte de producción del personal asistencial»: por servicio (UPS), actividad y turno, día por día del mes.
// Un código es CPMS si en MAESTRO_HIS_CIE_CPMS su Fg_Tipo es CP o EX (igual que el catálogo CPMS de la aplicación).
// Atenciones = citas sin ningún CPMS; Aten. con proc. = citas con al menos un CPMS; Procedimientos CPMS = códigos CPMS registrados.
const TIPOS_CPMS = "('CP', 'EX')";

// Mismo reporte para el personal (lo que atendió) y para el paciente (lo que recibió): solo cambian el filtro y la ficha.
const REPORTE_MENSUAL = {
  personal: {
    columna: 'n.Id_Personal',
    ficha: `SELECT TOP (1) ${SELECT_PERSONAL} WHERE p.Id_Personal = @id;`,
    nombre: 'personal'
  },
  paciente: {
    columna: 'n.Id_Paciente',
    ficha: 'SELECT TOP (1) p.* FROM MaestroPaciente p WHERE p.Id_Paciente = @id;',
    nombre: 'paciente'
  }
};

// GET /api/busqueda/personal/:id/reporte-mensual?anio=2026&mes=1
// GET /api/busqueda/pacientes/:id/reporte-mensual?anio=2026&mes=1
const reporteMensual = tipo => async (req, res) => {
  const cfg = REPORTE_MENSUAL[tipo];
  const id = String(req.params.id || '').trim().slice(0, 50);
  const anio = Number(req.query.anio);
  const mes = Number(req.query.mes);
  const anioActual = new Date().getFullYear();
  if (!id) return res.status(400).json({ message: `Falta el ID del ${cfg.nombre}.` });
  if (!Number.isInteger(anio) || anio < 2000 || anio > anioActual + 1 || !Number.isInteger(mes) || mes < 1 || mes > 12) {
    return res.status(400).json({ message: 'Elige un año y un mes válidos.' });
  }
  const inicio = `${anio}-${String(mes).padStart(2, '0')}-01`;
  const fin = mes === 12 ? `${anio + 1}-01-01` : `${anio}-${String(mes + 1).padStart(2, '0')}-01`;

  try {
    const pool = await poolPromise;
    // La UPSS (Consulta externa, Centro quirúrgico…) se toma de MAESTRO_HIS_UPS si esa tabla tiene una columna con «UPSS» en el nombre.
    const colUpss = await withTransientRetry(() => pool.request().query(`
      SELECT TOP (1) name FROM sys.columns
      WHERE object_id = OBJECT_ID(N'dbo.MAESTRO_HIS_UPS') AND name LIKE N'%UPSS%'
      ORDER BY CASE WHEN name LIKE N'Desc%' OR name LIKE N'Nombre%' THEN 0 ELSE 1 END, column_id
    `));
    const upssCol = colUpss.recordset[0]?.name;
    const upssSql = upssCol ? `MAX(CONVERT(nvarchar(200), u.[${String(upssCol).replace(/]/g, ']]')}]))` : 'CAST(NULL AS nvarchar(200))';
    const result = await withTransientRetry(() => pool.request()
      .input('id', sql.NVarChar(50), id)
      .input('inicio', sql.Date, inicio)
      .input('fin', sql.Date, fin)
      .query(`
        ${cfg.ficha}

        -- Cada cita se clasifica una vez según tenga o no algún código CPMS.
        WITH citas AS (
          SELECT
            n.Id_Cita,
            n.Id_Ups,
            DAY(n.Fecha_Atencion) AS dia,
            UPPER(LTRIM(RTRIM(ISNULL(n.Id_Turno, '')))) AS turno,
            MAX(CASE WHEN k.Fg_Tipo IN ${TIPOS_CPMS} THEN 1 ELSE 0 END) AS tieneCpms,
            SUM(CASE WHEN k.Fg_Tipo IN ${TIPOS_CPMS} THEN 1 ELSE 0 END) AS cpms
          FROM NProduccion n
          OUTER APPLY (
            SELECT TOP (1) catalogo.Fg_Tipo
            FROM MAESTRO_HIS_CIE_CPMS catalogo
            WHERE catalogo.Codigo_Item = n.Codigo_Item
          ) k
          WHERE ${cfg.columna} = @id AND n.Fecha_Atencion >= @inicio AND n.Fecha_Atencion < @fin
          GROUP BY n.Id_Cita, n.Id_Ups, DAY(n.Fecha_Atencion), UPPER(LTRIM(RTRIM(ISNULL(n.Id_Turno, ''))))
        )
        SELECT
          c.Id_Ups AS ups,
          ${upssSql} AS upss,
          MAX(u.Descripcion_Ups) AS servicio,
          c.dia,
          c.turno,
          SUM(CASE WHEN c.tieneCpms = 0 THEN 1 ELSE 0 END) AS atenciones,
          SUM(c.tieneCpms) AS atencionesConProc,
          SUM(c.cpms) AS procedimientos
        FROM citas c
        LEFT JOIN MAESTRO_HIS_UPS u ON u.Id_Ups = c.Id_Ups
        GROUP BY c.Id_Ups, c.dia, c.turno
        ORDER BY MAX(u.Descripcion_Ups), c.Id_Ups, c.dia;

        -- Establecimiento con más atenciones en el mes.
        SELECT TOP (1) n.Id_Establecimiento AS id, MAX(e.Nombre_Establecimiento) AS nombre, MAX(n.renipress) AS renipress, COUNT(DISTINCT n.Id_Cita) AS citas
        FROM NProduccion n
        LEFT JOIN MAESTRO_HIS_ESTABLECIMIENTO e ON e.Id_Establecimiento = n.Id_Establecimiento
        WHERE ${cfg.columna} = @id AND n.Fecha_Atencion >= @inicio AND n.Fecha_Atencion < @fin
        GROUP BY n.Id_Establecimiento
        ORDER BY citas DESC;
      `));
    const [ficha, filas, establecimiento] = result.recordsets;
    if (!ficha.length) return res.status(404).json({ message: `No se encontró ese ${cfg.nombre}.` });
    res.status(200).json({
      anio,
      mes,
      diasMes: new Date(Date.UTC(anio, mes, 0)).getUTCDate(),
      [tipo]: ficha[0],
      establecimiento: establecimiento[0] || null,
      filas: filas.map(f => ({
        ups: f.ups,
        upss: f.upss || null,
        servicio: f.servicio,
        dia: Number(f.dia),
        turno: f.turno || '',
        atenciones: Number(f.atenciones),
        atencionesConProc: Number(f.atencionesConProc),
        procedimientos: Number(f.procedimientos)
      }))
    });
  } catch (error) {
    responderError(res, error, cfg.nombre);
  }
};
const reporteMensualPersonal = reporteMensual('personal');
const reporteMensualPaciente = reporteMensual('paciente');

// ── REPORTE DE UNA ATENCIÓN (CITA) ──
// GET /api/busqueda/citas/:id : todos los códigos registrados en la cita, con los datos del paciente, del personal,
// del servicio, del establecimiento y del financiador para el recuadro del reporte.
const detalleCita = async (req, res) => {
  const id = String(req.params.id || '').trim().slice(0, 50);
  if (!id) return res.status(400).json({ message: 'Falta el número de cita.' });
  try {
    const pool = await poolPromise;
    const result = await withTransientRetry(() => pool.request()
      .input('id', sql.NVarChar(50), id)
      .query(`
        SELECT TOP (300)
          n.*,
          c.Descripcion_Item AS DescItem,
          ${NOMBRE_PACIENTE} AS Paciente,
          pac.Numero_Documento_Paciente AS DocumentoPaciente,
          pac.Historia_Clinica AS HistoriaClinica,
          pac.Id_Genero AS SexoPaciente,
          pac.Fecha_Nacimiento_Paciente AS FechaNacimientoPaciente,
          ${NOMBRE_PERSONAL} AS Personal,
          per.Numero_Documento_Personal AS DocumentoPersonal,
          per.Numero_Colegiatura AS ColegiaturaPersonal,
          prof.Descripcion_Profesion AS ProfesionPersonal,
          u.Descripcion_Ups AS Servicio,
          e.Nombre_Establecimiento AS NombreEstablecimiento,
          fin.Descripcion_Financiador AS Financiador,
          ${NOMBRE_REGISTRADOR} AS Registrador
        FROM NProduccion n
        LEFT JOIN MaestroPaciente pac ON n.Id_Paciente = pac.Id_Paciente
        LEFT JOIN MaestroPersonal per ON n.Id_Personal = per.Id_Personal
        LEFT JOIN MAESTRO_HIS_PROFESION prof ON per.Id_Profesion = prof.Id_Profesion
        LEFT JOIN MAESTRO_HIS_UPS u ON u.Id_Ups = n.Id_Ups
        LEFT JOIN MAESTRO_HIS_ESTABLECIMIENTO e ON e.Id_Establecimiento = n.Id_Establecimiento
        LEFT JOIN MAESTRO_HIS_FINANCIADOR fin ON fin.Id_Financiador = n.Id_Financiador
        LEFT JOIN MaestroRegistrador reg ON reg.Id_Registrador = n.Id_Registrador
        ${DESCRIPCION_ITEM}
        WHERE n.Id_Cita = @id
        ORDER BY n.Fecha_Atencion, n.Codigo_Item
      `));
    if (!result.recordset.length) return res.status(404).json({ message: 'No se encontró esa cita.' });
    res.status(200).json(result.recordset);
  } catch (error) {
    responderError(res, error, 'la atención');
  }
};

module.exports = {
  buscarPacientes,
  sugerenciasPacientes,
  misPacientes,
  atencionesPaciente,
  buscarAtenciones,
  citasPaginadas,
  buscarDefunciones,
  buscarPersonal,
  sugerenciasPersonal,
  resumenPersonal,
  reporteMensualPersonal,
  reporteMensualPaciente,
  detalleCita
};
