// Controlador de lectura de catálogos HIS y actividad histórica de profesionales.
const { sql, poolPromise, withTransientRetry } = require('../config/db');

// Ejecuta una consulta de catálogo sin parámetros y normaliza la respuesta y los errores HTTP.
const executeQuery = async (query, res) => {
  try {
    const pool = await poolPromise;
    const result = await withTransientRetry(() => pool.request().query(query));
    res.status(200).json(result.recordset);
  } catch (error) {
    console.error('Database query error:', error);
    const transient = ['ESOCKET', 'ECONNRESET', 'ETIMEOUT', 'ENOTOPEN'].includes(error.code);
    res.status(transient ? 503 : 500).json({ message: transient ? 'La conexión con la base de datos sigue interrumpida.' : 'No se pudo consultar el catálogo.', code: error.code || 'DATABASE_ERROR' });
  }
};

// Aplica búsqueda parcial parametrizada y límite de filas a catálogos extensos.
const executeSearchQuery = async (req, res, baseQuery, searchColumns, defaultLimit = 50) => {
  const { q, limit } = req.query;
  const maxRows = Math.min(Math.max(parseInt(limit, 10) || defaultLimit, 1), 200);
  try {
    const pool = await poolPromise;
    let queryStr = baseQuery;
    const searchTerm = q?.trim() || '';
    const terms = searchTerm ? searchTerm.split(/\s+/).filter(Boolean).slice(0, 8) : [];

    // Solo agrega condiciones cuando hay texto de búsqueda; cada palabra debe coincidir en al menos una columna.
    if (terms.length) {
      const termGroups = terms.map((_, tIdx) => {
        const colChecks = searchColumns.map((col) => `${col} LIKE @q_${tIdx}`);
        return `(${colChecks.join(' OR ')})`;
      });
      queryStr += ` AND (${termGroups.join(' AND ')})`;
    }

    // El límite proviene de un entero acotado por el servidor; ordenar por descripción da resultados estables.
    queryStr = `SELECT TOP ${maxRows} * FROM (${queryStr}) AS sub ORDER BY sub.descripcion`;
    const result = await withTransientRetry(() => {
      const request = pool.request();
      terms.forEach((term, tIdx) => request.input(`q_${tIdx}`, sql.NVarChar, `%${term}%`));
      return request.query(queryStr);
    });
    res.status(200).json(result.recordset);
  } catch (error) {
    console.error('Database search query error:', error);
    const transient = ['ESOCKET', 'ECONNRESET', 'ETIMEOUT', 'ENOTOPEN'].includes(error.code);
    res.status(transient ? 503 : 500).json({ message: transient ? 'La conexión con la base de datos sigue interrumpida.' : 'No se pudo completar la búsqueda.', code: error.code || 'DATABASE_ERROR' });
  }
};

// --- ESTABLECIMIENTOS (catálogo grande, con búsqueda) ---
// Busca establecimientos por nombre, código único o distrito y añade sus datos territoriales.
const getEstablecimientos = async (req, res) => {
  await executeSearchQuery(req, res,
    `SELECT Id_Establecimiento as id, Codigo_Unico as codigo, Nombre_Establecimiento as descripcion,
            Departamento as departamento, Provincia as provincia, Distrito as distrito,
            Categoria_Establecimiento as categoria
     FROM MAESTRO_HIS_ESTABLECIMIENTO WHERE 1=1`,
    ['Nombre_Establecimiento', 'Codigo_Unico', 'Distrito'],
    80
  );
};

// --- UPS (catálogo mediano) ---
// Busca unidades prestadoras de servicios por identificador o descripción.
const getUps = async (req, res) => {
  await executeSearchQuery(req, res,
    `SELECT Id_Ups as id, Id_Ups as codigo, Descripcion_Ups as descripcion
     FROM MAESTRO_HIS_UPS WHERE 1=1`,
    ['Id_Ups', 'Descripcion_Ups'],
    100
  );
};

// --- PERSONAL (catálogo grande) ---
// Busca profesionales por apellidos, nombres o documento y devuelve su identificador interno.
const getPersonal = async (req, res) => {
  await executeSearchQuery(req, res,
        `SELECT Id_Personal as id, Numero_Documento_Personal as codigo,
          LTRIM(RTRIM(CONCAT(Apellido_Paterno_Personal, ' ', Apellido_Materno_Personal, ' ', Nombres_Personal))) as descripcion,
            Numero_Documento_Personal as documento
     FROM MaestroPersonal WHERE 1=1`,
    ['Apellido_Paterno_Personal', 'Apellido_Materno_Personal', 'Nombres_Personal', 'Numero_Documento_Personal'],
    60
  );
};

// Construye la ficha de actividad de una persona: datos, resumen, códigos, tendencia y atenciones recientes.
const getActividadPersonal = async (req, res) => {
  const { id } = req.params;
  const { fechaInicio, fechaFin } = req.query;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 300);

  try {
    const pool = await poolPromise;
    // Los SELECT devuelven cinco bloques en orden: profesional, métricas, códigos, meses y detalle HIS.
    const activityQuery = `
        -- Resuelve el ID interno aceptando ID, documento o nombre completo y dando prioridad al ID exacto.
        DECLARE @idPersonal varchar(50);
        SELECT TOP 1 @idPersonal = Id_Personal
        FROM MaestroPersonal
        WHERE Id_Personal = @identificador
           OR Numero_Documento_Personal = @identificador
           OR LTRIM(RTRIM(CONCAT(Apellido_Paterno_Personal, ' ', Apellido_Materno_Personal, ' ', Nombres_Personal))) = @identificador
           OR Nombres_Personal = @identificador
        ORDER BY
          CASE
            WHEN Id_Personal = @identificador THEN 0
            WHEN Numero_Documento_Personal = @identificador THEN 1
            WHEN LTRIM(RTRIM(CONCAT(Apellido_Paterno_Personal, ' ', Apellido_Materno_Personal, ' ', Nombres_Personal))) = @identificador THEN 2
            ELSE 3
          END;

        -- Datos descriptivos del profesional y catálogos vinculados.
        SELECT TOP 1
          p.Id_Personal as id,
          p.Numero_Documento_Personal as documento,
          LTRIM(RTRIM(CONCAT(p.Apellido_Paterno_Personal, ' ', p.Apellido_Materno_Personal, ' ', p.Nombres_Personal))) as nombre,
          pr.Descripcion_Profesion as profesion,
          e.Nombre_Establecimiento as establecimiento
        FROM MaestroPersonal p
        OUTER APPLY (SELECT TOP 1 Descripcion_Profesion FROM MAESTRO_HIS_PROFESION WHERE Id_Profesion = p.Id_Profesion) pr
        OUTER APPLY (SELECT TOP 1 Nombre_Establecimiento FROM MAESTRO_HIS_ESTABLECIMIENTO WHERE Id_Establecimiento = p.Id_Establecimiento) e
        WHERE p.Id_Personal = @idPersonal;

        -- Resumen de actividad dentro del periodo opcionalmente indicado.
        SELECT
          COUNT(*) as totalAtenciones,
          COUNT(DISTINCT np.Id_Paciente) as pacientesAtendidos,
          COUNT(DISTINCT np.Codigo_Item) as codigosDiferentes,
          MAX(np.Fecha_Atencion) as ultimaAtencion
        FROM NProduccion np
        WHERE np.Id_Personal = @idPersonal
          AND (@fechaInicio IS NULL OR np.Fecha_Atencion >= @fechaInicio)
          AND (@fechaFin IS NULL OR np.Fecha_Atencion < DATEADD(DAY, 1, @fechaFin));

        -- Códigos más frecuentes, incluyendo su descripción y cantidad de pacientes distintos.
        SELECT TOP 10
          np.Codigo_Item as codigo,
          c.Descripcion_Item as descripcion,
          COUNT(*) as veces,
          COUNT(DISTINCT np.Id_Paciente) as pacientes
        FROM NProduccion np
        OUTER APPLY (
          SELECT TOP 1 Descripcion_Item
          FROM MAESTRO_HIS_CIE_CPMS
          WHERE Codigo_Item = np.Codigo_Item
          ORDER BY CASE WHEN NULLIF(LTRIM(RTRIM(Descripcion_Item)), '') IS NULL THEN 1 ELSE 0 END, Descripcion_Item
        ) c
        WHERE np.Id_Personal = @idPersonal
          AND NULLIF(LTRIM(RTRIM(np.Codigo_Item)), '') IS NOT NULL
          AND (@fechaInicio IS NULL OR np.Fecha_Atencion >= @fechaInicio)
          AND (@fechaFin IS NULL OR np.Fecha_Atencion < DATEADD(DAY, 1, @fechaFin))
        GROUP BY np.Codigo_Item, c.Descripcion_Item
        ORDER BY veces DESC;

        -- Evolución reciente por mes contando citas únicas.
        SELECT TOP 12
          CONVERT(char(7), np.Fecha_Atencion, 120) as periodo,
          COUNT(DISTINCT np.Id_Cita) as atenciones
        FROM NProduccion np
        WHERE np.Id_Personal = @idPersonal
          AND (@fechaInicio IS NULL OR np.Fecha_Atencion >= @fechaInicio)
          AND (@fechaFin IS NULL OR np.Fecha_Atencion < DATEADD(DAY, 1, @fechaFin))
        GROUP BY YEAR(np.Fecha_Atencion), MONTH(np.Fecha_Atencion), CONVERT(char(7), np.Fecha_Atencion, 120)
        ORDER BY YEAR(np.Fecha_Atencion) DESC, MONTH(np.Fecha_Atencion) DESC;

        -- Detalle de atenciones recientes; el tope se restringe antes de interpolarse en el SQL.
        SELECT TOP ${limit}
          np.Fecha_Atencion as fecha,
          LTRIM(RTRIM(CONCAT(pa.Apellido_Paterno_Paciente, ' ', pa.Apellido_Materno_Paciente, ' ', pa.Nombres_Paciente))) as paciente,
          e.Nombre_Establecimiento as establecimiento,
          u.Descripcion_Ups as ups,
          np.Codigo_Item as codigo,
          c.Descripcion_Item as descripcion,
          np.Tipo_Diagnostico as tipo,
          np.Valor_Lab as laboratorio,
          np.Peso as peso,
          np.Talla as talla,
          np.Hemoglobina as hemoglobina
        FROM NProduccion np
        OUTER APPLY (SELECT TOP 1 Apellido_Paterno_Paciente, Apellido_Materno_Paciente, Nombres_Paciente FROM MaestroPaciente WHERE Id_Paciente = np.Id_Paciente) pa
        OUTER APPLY (SELECT TOP 1 Nombre_Establecimiento FROM MAESTRO_HIS_ESTABLECIMIENTO WHERE Id_Establecimiento = np.Id_Establecimiento) e
        OUTER APPLY (SELECT TOP 1 Descripcion_Ups FROM MAESTRO_HIS_UPS WHERE Id_Ups = np.Id_Ups) u
        OUTER APPLY (SELECT TOP 1 Descripcion_Item FROM MAESTRO_HIS_CIE_CPMS WHERE Codigo_Item = np.Codigo_Item) c
        WHERE np.Id_Personal = @idPersonal
          AND (@fechaInicio IS NULL OR np.Fecha_Atencion >= @fechaInicio)
          AND (@fechaFin IS NULL OR np.Fecha_Atencion < DATEADD(DAY, 1, @fechaFin))
        ORDER BY np.Fecha_Atencion DESC, np.Num_Reg DESC, np.Id_Correlativo_Item;
      `;
    const result = await withTransientRetry(() => pool.request()
      .input('identificador', sql.NVarChar, String(id))
      .input('fechaInicio', sql.Date, fechaInicio || null)
      .input('fechaFin', sql.Date, fechaFin || null)
      .query(activityQuery));

    const personal = result.recordsets[0][0];
    if (!personal) return res.status(404).json({ message: 'No se encontró el profesional.' });
    res.status(200).json({
      personal,
      resumen: result.recordsets[1][0],
      diagnosticos: result.recordsets[2],
      porMes: result.recordsets[3],
      atenciones: result.recordsets[4]
    });
  } catch (error) {
    // Separa cortes transitorios de conexión de errores de consulta permanentes.
    console.error('Error in getActividadPersonal:', error);
    const transient = ['ESOCKET', 'ECONNRESET', 'ETIMEOUT', 'ENOTOPEN'].includes(error.code);
    res.status(transient ? 503 : 500).json({
      message: transient ? 'La conexión con la base de datos se interrumpió. Vuelva a intentar.' : 'No se pudo consultar la actividad del profesional.',
      code: error.code || 'DATABASE_ERROR'
    });
  }
};

// --- PROFESIONES ---
// Devuelve el catálogo de profesiones sin búsqueda adicional.
const getProfesiones = async (req, res) => {
  await executeQuery('SELECT Id_Profesion as id, Id_Profesion as codigo, Descripcion_Profesion as descripcion FROM MAESTRO_HIS_PROFESION', res);
};

// --- FINANCIADORES ---
// Devuelve financiadores y sus identificadores de catálogo.
const getFinanciadores = async (req, res) => {
  await executeQuery('SELECT Id_Financiador as id, Id_Financiador as codigo, Descripcion_Financiador as descripcion FROM MAESTRO_HIS_FINANCIADOR', res);
};

// --- CONDICIÓN DE CONTRATO ---
// Devuelve las condiciones contractuales registradas.
const getCondicionesContrato = async (req, res) => {
  await executeQuery('SELECT Id_Condicion as id, Id_Condicion as codigo, Descripcion_Condicion as descripcion FROM MAESTRO_HIS_CONDICION_CONTRATO', res);
};

// --- TIPO DE DOCUMENTO ---
// Devuelve identificadores, abreviaturas y descripciones de tipos documentales.
const getTipoDocumento = async (req, res) => {
  await executeQuery('SELECT Id_Tipo_Documento as id, Abrev_Tipo_Doc as codigo, Descripcion_Tipo_Documento as descripcion FROM MAESTRO_HIS_TIPO_DOC', res);
};

// --- PAÍSES (catálogo grande) ---
// Permite buscar países por descripción o identificador.
const getPaises = async (req, res) => {
  await executeSearchQuery(req, res,
    `SELECT Id_Pais as id, Id_Pais as codigo, Descripcion_Pais as descripcion
     FROM MAESTRO_HIS_PAIS WHERE 1=1`,
    ['Descripcion_Pais', 'Id_Pais'],
    50
  );
};

// --- ETNIAS ---
// Devuelve las etnias disponibles en el catálogo.
const getEtnias = async (req, res) => {
  await executeQuery('SELECT Id_Etnia as id, Id_Etnia as codigo, Descripcion_Etnia as descripcion FROM MAESTRO_HIS_ETNIA', res);
};

// --- CENTROS POBLADOS (catálogo grande, con búsqueda) ---
// Busca centros poblados por nombre o código de catálogo.
const getCentrosPoblados = async (req, res) => {
  await executeSearchQuery(req, res,
    `SELECT Id_Centro_Poblado as id, Id_Codigo_Centro_Poblado as codigo, Descripcion_Centro_Poblado as descripcion
     FROM MAESTRO_HIS_CENTRO_POBLADO WHERE 1=1`,
    ['Descripcion_Centro_Poblado', 'Id_Codigo_Centro_Poblado'],
    50
  );
};

// --- INSTITUCIONES EDUCATIVAS (catálogo grande) ---
// Busca instituciones educativas por descripción o código modular.
const getInstitucionesEducativas = async (req, res) => {
  await executeSearchQuery(req, res,
    `SELECT Id_Institucion_Edu as id, Codigo_Modular as codigo, Descripcion_Institucion_Edu as descripcion
     FROM MAESTRO_HIS_INSTITUCION_EDUCATIVA WHERE 1=1`,
    ['Descripcion_Institucion_Edu', 'Codigo_Modular'],
    50
  );
};

// --- COLEGIOS ---
// Devuelve el catálogo de colegios.
const getColegios = async (req, res) => {
  await executeQuery('SELECT Id_Colegio as id, Id_Colegio as codigo, Descripcion_Colegio as descripcion FROM MAESTRO_HIS_COLEGIO', res);
};

// --- CIE-10 (catálogo muy grande, búsqueda obligatoria) ---
// Busca códigos diagnósticos CIE en el catálogo compartido, limitando el tipo a CX.
const getCie10 = async (req, res) => {
  await executeSearchQuery(req, res,
    `SELECT Codigo_Item as id, Codigo_Item as codigo, Descripcion_Item as descripcion,
            Fg_Tipo as tipo, Descripcion_Tipo_Item as tipoItem
     FROM MAESTRO_HIS_CIE_CPMS WHERE Fg_Tipo = 'CX'`,
    ['Codigo_Item', 'Descripcion_Item'],
    40
  );
};

// --- CPMS (catálogo muy grande, búsqueda obligatoria) ---
// Busca procedimientos y exámenes CPMS, excluyendo los códigos tipo CX.
const getCpms = async (req, res) => {
  await executeSearchQuery(req, res,
    `SELECT Codigo_Item as id, Codigo_Item as codigo, Descripcion_Item as descripcion,
            Fg_Tipo as tipo, Descripcion_Tipo_Item as tipoItem
     FROM MAESTRO_HIS_CIE_CPMS WHERE Fg_Tipo IN ('CP', 'EX')`,
    ['Codigo_Item', 'Descripcion_Item'],
    40
  );
};

// --- ÍTEMS HIS (CIE-10 + CPMS) ---
// Busca en todo el catálogo de códigos HIS para el autocompletado del constructor de consultas.
const getItemsHis = async (req, res) => {
  await executeSearchQuery(req, res,
    `SELECT Codigo_Item as id, Codigo_Item as codigo, Descripcion_Item as descripcion,
            Fg_Tipo as tipo
     FROM MAESTRO_HIS_CIE_CPMS WHERE 1=1`,
    ['Codigo_Item', 'Descripcion_Item'],
    20
  );
};

// --- LABORATORIO ---
// Busca valores de laboratorio por código o descripción.
const getLaboratorio = async (req, res) => {
  await executeSearchQuery(req, res,
    `SELECT Codigo_Lab as id, Valor_Lab as codigo, Descripcion_Lab as descripcion
     FROM MAESTRO_HIS_LAB WHERE 1=1`,
    ['Codigo_Lab', 'Descripcion_Lab'],
    80
  );
};

// --- DOSIS ---
// Devuelve las dosis disponibles en el catálogo HIS.
const getDosis = async (req, res) => {
  await executeQuery('SELECT id_dosis as id, id_dosis as codigo, desc_dosis as descripcion FROM MAESTRO_HIS_DOSIS', res);
};

// --- ACTIVIDADES HIS ---
// Lista actividades activas (o sin estado explícito) y permite su búsqueda.
const getActividades = async (req, res) => {
  await executeSearchQuery(req, res,
    `SELECT Id_Actividad_His as id, Id_Actividad_His as codigo, Descripcion_Actividad_His as descripcion
     FROM MAESTRO_HIS_ACTIVIDAD_HIS WHERE Fg_Estado = 1 OR Fg_Estado IS NULL`,
    ['Id_Actividad_His', 'Descripcion_Actividad_His'],
    50
  );
};

// --- GRUPO DE RIESGO LAB ---
// Devuelve los grupos de riesgo asociados a códigos de laboratorio.
const getGrupoRiesgo = async (req, res) => {
  await executeQuery('SELECT Id_GrupoRiesgo as id, Lab_Codigo as codigo, Descripcion_GrupoRiesgo as descripcion FROM MAESTRO_HIS_GRUPORIESGO_LAB', res);
};

// --- OTRA CONDICIÓN ---
// Devuelve las otras condiciones codificadas para registros HIS.
const getOtraCondicion = async (req, res) => {
  await executeQuery('SELECT Id_Otra_Condicion as id, Id_Otra_Condicion as codigo, Descripcion_Otra_Condicion as descripcion FROM MAESTRO_HIS_OTRA_CONDICION', res);
};

module.exports = {
  getEstablecimientos,
  getUps,
  getPersonal,
  getActividadPersonal,
  getProfesiones,
  getFinanciadores,
  getCondicionesContrato,
  getTipoDocumento,
  getPaises,
  getEtnias,
  getCentrosPoblados,
  getInstitucionesEducativas,
  getColegios,
  getCie10,
  getCpms,
  getItemsHis,
  getLaboratorio,
  getDosis,
  getActividades,
  getGrupoRiesgo,
  getOtraCondicion
};
