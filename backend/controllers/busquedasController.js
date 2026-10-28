// Búsquedas de pacientes, atenciones, defunciones y personal (tomadas del proyecto HIS).
// Solo lectura: cada búsqueda usa parámetros y un tope de filas para no saturar SQL Server.
const { sql, poolPromise, withTransientRetry } = require('../config/db');

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
      const porTerminos = terminos.map((_, index) => `(
        Nombres_Paciente LIKE @t${index}
        OR Apellido_Paterno_Paciente LIKE @t${index}
        OR Apellido_Materno_Paciente LIKE @t${index}
      )`).join(' AND ');
      return request.query(`
        SELECT TOP (${MAX_PACIENTES}) *
        FROM MaestroPaciente
        WHERE Id_Paciente LIKE @q
           OR Numero_Documento_Paciente LIKE @q
           OR Historia_Clinica LIKE @q
           OR Ficha_Familiar LIKE @q
           OR (${porTerminos})
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
          ult.UltimaAtencion, ult.Atenciones
        FROM MaestroPaciente p
        OUTER APPLY (SELECT TOP (1) e.Nombre_Establecimiento FROM MAESTRO_HIS_ESTABLECIMIENTO e WHERE e.Id_Establecimiento = p.Id_Establecimiento) est
        OUTER APPLY (SELECT MAX(n.Fecha_Atencion) AS UltimaAtencion, COUNT(DISTINCT n.Id_Cita) AS Atenciones FROM NProduccion n WHERE n.Id_Paciente = p.Id_Paciente) ult
        CROSS APPLY (SELECT ${coincidencia} AS Palabras) rel
        WHERE ${where}
        ORDER BY rel.Palabras DESC, CASE WHEN ult.UltimaAtencion IS NULL THEN 1 ELSE 0 END, ult.UltimaAtencion DESC, Paciente
      `);
    });
    res.status(200).json(result.recordset);
  } catch (error) {
    responderError(res, error, 'pacientes');
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
      const where = porModo[modo] || `(p.Id_Personal LIKE @q OR p.Numero_Documento_Personal LIKE @q OR ${porNombre})`;
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
          fin.Descripcion_Financiador AS Financiador
        FROM NProduccion n
        LEFT JOIN MaestroPaciente pac ON n.Id_Paciente = pac.Id_Paciente
        LEFT JOIN MaestroPersonal per ON n.Id_Personal = per.Id_Personal
        LEFT JOIN MAESTRO_HIS_PROFESION prof ON per.Id_Profesion = prof.Id_Profesion
        LEFT JOIN MAESTRO_HIS_UPS u ON u.Id_Ups = n.Id_Ups
        LEFT JOIN MAESTRO_HIS_ESTABLECIMIENTO e ON e.Id_Establecimiento = n.Id_Establecimiento
        LEFT JOIN MAESTRO_HIS_FINANCIADOR fin ON fin.Id_Financiador = n.Id_Financiador
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
  atencionesPaciente,
  buscarAtenciones,
  buscarDefunciones,
  buscarPersonal,
  resumenPersonal,
  reporteMensualPersonal,
  reporteMensualPaciente,
  detalleCita
};
