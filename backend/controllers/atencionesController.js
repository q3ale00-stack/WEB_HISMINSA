// Controlador de reportes de producción: valida filtros y consulta agregados sin modificar datos HIS.
const { sql, poolPromise, withTransientRetry } = require('../config/db');

// Valida filtros de fecha antes de enviarlos a SQL Server. Si no se especifican, el reporte no limita el periodo.
const parseReportDate = (value, label) => {
  if (value === undefined || value === null || value === '') return null;

  // El formato estricto evita conversiones ambiguas según idioma o configuración regional del servidor.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const error = new Error(`La ${label} no es válida.`);
    error.code = 'INVALID_REPORT_DATE';
    throw error;
  }

  // JavaScript normaliza algunas fechas imposibles; comparar el texto original detecta esos cambios.
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (value.startsWith('0000') || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    const error = new Error(`La ${label} no es válida.`);
    error.code = 'INVALID_REPORT_DATE';
    throw error;
  }
  return value;
};

const cache = require('../config/cache');

// Controlador de solo lectura para indicadores agregados de producción asistencial.
const getReportes = async (req, res) => {
  try {
    // Lee y valida filtros HTTP
    const fechaInicio = parseReportDate(req.query.fechaInicio, 'fecha de inicio');
    const fechaFin = parseReportDate(req.query.fechaFin, 'fecha de fin');
    if (fechaInicio && fechaFin && fechaInicio > fechaFin) {
      return res.status(400).json({ message: 'La fecha de inicio no puede ser posterior a la fecha de fin.' });
    }

    const anio = req.query.anio ? String(req.query.anio).trim() : null;
    const mes = req.query.mes ? String(req.query.mes).trim() : null;
    const codigoItem = req.query.codigoItem ? String(req.query.codigoItem).trim() : null;
    const idEstablecimiento = req.query.idEstablecimiento ? String(req.query.idEstablecimiento).trim() : null;
    const idUps = req.query.idUps ? String(req.query.idUps).trim() : null;
    const idPersonal = req.query.idPersonal ? String(req.query.idPersonal).trim() : null;
    const tipoDiagnostico = req.query.tipoDiagnostico ? String(req.query.tipoDiagnostico).trim() : null;

    // Clave de caché para evitar recalcular consultas idénticas
    const cacheKey = `rep_${fechaInicio}_${fechaFin}_${anio}_${mes}_${codigoItem}_${idEstablecimiento}_${idUps}_${idPersonal}_${tipoDiagnostico}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.status(200).json(cached);

    const pool = await poolPromise;

    // Si se pasa un código o texto (ej. "cancer"), buscamos códigos equivalentes en el catálogo
    let matchedCodesStr = null;
    if (codigoItem) {
      try {
        const codeRes = await pool.request()
          .input('cItem', sql.NVarChar(120), codigoItem)
          .input('cItemLike', sql.NVarChar(120), `%${codigoItem}%`)
          .query(`
            SELECT TOP 200 Codigo_Item 
            FROM MAESTRO_HIS_CIE_CPMS 
            WHERE Codigo_Item = @cItem 
               OR Codigo_Item LIKE @cItemLike 
               OR Descripcion_Item LIKE @cItemLike
          `);
        const codes = (codeRes.recordset || []).map(r => r.Codigo_Item).filter(Boolean);
        if (codes.length > 0) {
          matchedCodesStr = codes.join('|');
        }
      } catch (e) {
        console.warn('Advertencia buscando coincidencias de código:', e.message);
      }
    }

    // Cláusula WHERE común parametrizada
    const whereConditions = [
      '(@fechaInicio IS NULL OR np.Fecha_Atencion >= @fechaInicio)',
      '(@fechaFin IS NULL OR np.Fecha_Atencion < DATEADD(DAY, 1, @fechaFin))',
      '(@anio IS NULL OR np.Anio = @anio)',
      '(@mes IS NULL OR np.Mes = @mes)',
      matchedCodesStr
        ? '(@codigoItem IS NULL OR np.Codigo_Item = @codigoItem OR np.Codigo_Item IN (SELECT value FROM STRING_SPLIT(@matchedCodes, \'|\')))'
        : '(@codigoItem IS NULL OR np.Codigo_Item = @codigoItem)',
      '(@idEstablecimiento IS NULL OR np.Id_Establecimiento = @idEstablecimiento)',
      '(@idUps IS NULL OR np.Id_Ups = @idUps)',
      '(@idPersonal IS NULL OR np.Id_Personal = @idPersonal)',
      '(@tipoDiagnostico IS NULL OR np.Tipo_Diagnostico = @tipoDiagnostico)'
    ];
    const whereSql = whereConditions.join(' AND ');

    // Si se especifica un mes puntual, agrupamos la tendencia por DÍA; de lo contrario, por MES
    const temporalGroupBySql = mes
      ? `SELECT TOP 31
           CONVERT(varchar(10), np.Fecha_Atencion, 120) as periodo,
           COUNT_BIG(*) as registros,
           COUNT(DISTINCT np.Id_Cita) as atenciones,
           COUNT(DISTINCT np.Id_Paciente) as pacientes
         FROM NProduccion np
         WHERE ${whereSql}
         GROUP BY CONVERT(varchar(10), np.Fecha_Atencion, 120)
         ORDER BY periodo ASC;`
      : `SELECT TOP 24
           CONVERT(char(7), np.Fecha_Atencion, 120) as periodo,
           COUNT_BIG(*) as registros,
           COUNT(DISTINCT np.Id_Cita) as atenciones,
           COUNT(DISTINCT np.Id_Paciente) as pacientes
         FROM NProduccion np
         WHERE ${whereSql}
         GROUP BY YEAR(np.Fecha_Atencion), MONTH(np.Fecha_Atencion), CONVERT(char(7), np.Fecha_Atencion, 120)
         ORDER BY YEAR(np.Fecha_Atencion) DESC, MONTH(np.Fecha_Atencion) DESC;`;

    const reportQuery = `
        -- 1. Resumen consolidado del universo filtrado
        SELECT
          COUNT_BIG(*) as totalRegistros,
          COUNT(DISTINCT np.Id_Cita) as citasAtendidas,
          COUNT(DISTINCT np.Id_Paciente) as pacientesAtendidos,
          COUNT(DISTINCT np.Id_Personal) as personalActivo,
          COUNT(DISTINCT np.Id_Establecimiento) as establecimientosActivos,
          COUNT(DISTINCT np.Codigo_Item) as codigosRegistrados,
          MIN(np.Fecha_Atencion) as primeraAtencion,
          MAX(np.Fecha_Atencion) as ultimaAtencion
        FROM NProduccion np
        WHERE ${whereSql};

        -- 2. Tendencia temporal interactiva (por mes o por día)
        ${temporalGroupBySql}

        -- 3. Top Códigos / Tratamientos / Procedimientos (usando CTE para alto rendimiento)
        ;WITH TopCodes AS (
          SELECT TOP 15
            np.Codigo_Item as codigo,
            COUNT_BIG(*) as registros,
            COUNT(DISTINCT np.Id_Cita) as atenciones,
            COUNT(DISTINCT np.Id_Paciente) as pacientes
          FROM NProduccion np
          WHERE ${whereSql}
            AND NULLIF(LTRIM(RTRIM(np.Codigo_Item)), '') IS NOT NULL
          GROUP BY np.Codigo_Item
          ORDER BY registros DESC
        )
        SELECT
          tc.codigo,
          COALESCE(c.Descripcion_Item, tc.codigo) as descripcion,
          c.Fg_Tipo as tipo,
          c.Descripcion_Tipo_Item as tipoItem,
          tc.registros,
          tc.atenciones,
          tc.pacientes
        FROM TopCodes tc
        OUTER APPLY (
          SELECT TOP 1 catalogo.Descripcion_Item, catalogo.Fg_Tipo, catalogo.Descripcion_Tipo_Item
          FROM MAESTRO_HIS_CIE_CPMS catalogo
          WHERE catalogo.Codigo_Item = tc.codigo
        ) c
        ORDER BY tc.registros DESC;

        -- 4. Desglose por Establecimiento (usando CTE para alto rendimiento)
        ;WITH TopEst AS (
          SELECT TOP 12
            np.Id_Establecimiento as id,
            COUNT_BIG(*) as registros,
            COUNT(DISTINCT np.Id_Cita) as atenciones,
            COUNT(DISTINCT np.Id_Paciente) as pacientes
          FROM NProduccion np
          WHERE ${whereSql}
          GROUP BY np.Id_Establecimiento
          ORDER BY atenciones DESC
        )
        SELECT
          te.id,
          COALESCE(e.Nombre_Establecimiento, CONCAT('Establecimiento #', te.id)) as nombre,
          e.Departamento as departamento,
          e.Provincia as provincia,
          e.Categoria_Establecimiento as categoria,
          te.registros,
          te.atenciones,
          te.pacientes
        FROM TopEst te
        OUTER APPLY (
          SELECT TOP 1 catalogo.Nombre_Establecimiento, catalogo.Departamento, catalogo.Provincia, catalogo.Categoria_Establecimiento
          FROM MAESTRO_HIS_ESTABLECIMIENTO catalogo
          WHERE catalogo.Id_Establecimiento = te.id
        ) e
        ORDER BY te.atenciones DESC;

        -- 5. Desglose por Profesional (usando CTE para alto rendimiento)
        ;WITH TopPersonal AS (
          SELECT TOP 20
            np.Id_Personal as id,
            COUNT_BIG(*) as registros,
            COUNT(DISTINCT np.Id_Cita) as atenciones,
            COUNT(DISTINCT np.Id_Paciente) as pacientes,
            MAX(np.Fecha_Atencion) as ultimaAtencion
          FROM NProduccion np
          WHERE ${whereSql}
          GROUP BY np.Id_Personal
          ORDER BY atenciones DESC
        )
        SELECT
          tp.id,
          p.Numero_Documento_Personal as documento,
          COALESCE(LTRIM(RTRIM(CONCAT(p.Apellido_Paterno_Personal, ' ', p.Apellido_Materno_Personal, ' ', p.Nombres_Personal))), CONCAT('Personal #', tp.id)) as nombre,
          pr.Descripcion_Profesion as profesion,
          tp.registros,
          tp.atenciones,
          tp.pacientes,
          tp.ultimaAtencion
        FROM TopPersonal tp
        OUTER APPLY (
          SELECT TOP 1 catalogo.Numero_Documento_Personal, catalogo.Apellido_Paterno_Personal, catalogo.Apellido_Materno_Personal, catalogo.Nombres_Personal, catalogo.Id_Profesion
          FROM MaestroPersonal catalogo
          WHERE catalogo.Id_Personal = tp.id
        ) p
        OUTER APPLY (
          SELECT TOP 1 prof.Descripcion_Profesion
          FROM MAESTRO_HIS_PROFESION prof
          WHERE prof.Id_Profesion = p.Id_Profesion
        ) pr
        ORDER BY tp.atenciones DESC;
      `;

    const request = pool.request();
    request.input('fechaInicio', sql.Date, fechaInicio || null);
    request.input('fechaFin', sql.Date, fechaFin || null);
    request.input('anio', sql.NVarChar, anio || null);
    request.input('mes', sql.NVarChar, mes || null);
    request.input('codigoItem', sql.NVarChar, codigoItem || null);
    if (matchedCodesStr) {
      request.input('matchedCodes', sql.NVarChar(sql.MAX), matchedCodesStr);
    }
    request.input('idEstablecimiento', sql.NVarChar, idEstablecimiento || null);
    request.input('idUps', sql.NVarChar, idUps || null);
    request.input('idPersonal', sql.NVarChar, idPersonal || null);
    request.input('tipoDiagnostico', sql.NVarChar, tipoDiagnostico || null);

    const result = await withTransientRetry(() => request.query(reportQuery));

    const summary = result.recordsets[0][0] || {};
    const payload = {
      resumen: {
        ...summary,
        totalAtenciones: summary.totalRegistros
      },
      filtrosAplicados: {
        anio,
        mes,
        codigoItem,
        idEstablecimiento,
        idUps,
        idPersonal,
        tipoDiagnostico,
        fechaInicio,
        fechaFin,
        esDiario: Boolean(mes)
      },
      versionReporte: 3,
      porMes: result.recordsets[1] || [],
      diagnosticos: result.recordsets[2] || [],
      establecimientos: result.recordsets[3] || [],
      personal: result.recordsets[4] || []
    };

    cache.set(cacheKey, payload, 300); // 5 minutos de caché para reportes analíticos
    res.status(200).json(payload);
  } catch (error) {
    if (error.code === 'INVALID_REPORT_DATE') {
      return res.status(400).json({ message: error.message, code: 'INVALID_REPORT_DATE' });
    }
    console.error('Error in getReportes:', error);
    const transient = ['ESOCKET', 'ECONNRESET', 'ETIMEOUT', 'ENOTOPEN'].includes(error.code);
    res.status(transient ? 503 : 500).json({
      message: transient ? 'La conexión con la base de datos se interrumpió temporalmente. Vuelva a intentar.' : 'No se pudieron generar los reportes.',
      code: error.code || 'DATABASE_ERROR'
    });
  }
};

// Devuelve los metadatos y opciones para los filtros interactivos de producción
const getFiltrosProduccion = async (req, res) => {
  const cacheKey = 'filtros_produccion_meta';
  const cached = cache.get(cacheKey);
  if (cached) return res.status(200).json(cached);

  try {
    const pool = await poolPromise;
    const query = `
      -- Años y meses disponibles en la base de datos
      SELECT DISTINCT Anio as anio, Mes as mes, TRY_CAST(Mes AS INT) as numMes
      FROM NProduccion
      WHERE Anio IS NOT NULL AND Mes IS NOT NULL
      ORDER BY Anio DESC, numMes ASC;

      -- Principales establecimientos con mayor actividad
      ;WITH TopE AS (
        SELECT TOP 25 Id_Establecimiento, COUNT_BIG(*) as volumen
        FROM NProduccion
        GROUP BY Id_Establecimiento
        ORDER BY volumen DESC
      )
      SELECT te.Id_Establecimiento as id, COALESCE(e.Nombre_Establecimiento, CONCAT('Est. ', te.Id_Establecimiento)) as nombre
      FROM TopE te
      LEFT JOIN MAESTRO_HIS_ESTABLECIMIENTO e ON te.Id_Establecimiento = e.Id_Establecimiento
      ORDER BY nombre;

      -- Principales tratamientos y procedimientos CPMS
      SELECT TOP 25 Codigo_Item as codigo, Descripcion_Item as descripcion
      FROM MAESTRO_HIS_CIE_CPMS
      WHERE Fg_Tipo IN ('CP', 'EX')
      ORDER BY Descripcion_Item;

      -- Principales diagnósticos CIE-10
      SELECT TOP 25 Codigo_Item as codigo, Descripcion_Item as descripcion
      FROM MAESTRO_HIS_CIE_CPMS
      WHERE Fg_Tipo = 'CX'
      ORDER BY Descripcion_Item;

      -- Principales UPS / Servicios
      SELECT TOP 25 Id_Ups as id, Descripcion_Ups as descripcion
      FROM MAESTRO_HIS_UPS
      ORDER BY Descripcion_Ups;
    `;

    const result = await withTransientRetry(() => pool.request().query(query));
    const aniosMeses = result.recordsets[0] || [];
    const aniosSet = [...new Set(aniosMeses.map(x => x.anio))];
    const mesesNombres = {
      '1': 'Enero', '2': 'Febrero', '3': 'Marzo', '4': 'Abril', '5': 'Mayo', '6': 'Junio',
      '7': 'Julio', '8': 'Agosto', '9': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre'
    };

    const payload = {
      anios: aniosSet,
      meses: [
        { id: '1', nombre: 'Enero' }, { id: '2', nombre: 'Febrero' }, { id: '3', nombre: 'Marzo' },
        { id: '4', nombre: 'Abril' }, { id: '5', nombre: 'Mayo' }, { id: '6', nombre: 'Junio' },
        { id: '7', nombre: 'Julio' }, { id: '8', nombre: 'Agosto' }, { id: '9', nombre: 'Septiembre' },
        { id: '10', nombre: 'Octubre' }, { id: '11', nombre: 'Noviembre' }, { id: '12', nombre: 'Diciembre' }
      ],
      establecimientos: result.recordsets[1] || [],
      tratamientos: result.recordsets[2] || [],
      diagnosticos: result.recordsets[3] || [],
      servicios: result.recordsets[4] || []
    };

    cache.set(cacheKey, payload, 3600); // 1 hora de caché para catálogos y opciones de filtros
    res.status(200).json(payload);
  } catch (error) {
    console.error('Error in getFiltrosProduccion:', error);
    res.status(500).json({ message: 'No se pudieron consultar los filtros de producción.' });
  }
};

module.exports = {
  getReportes,
  getFiltrosProduccion
};
