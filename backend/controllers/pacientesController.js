// Controlador de búsqueda y lectura de fichas, atenciones e indicadores individuales de pacientes.
const { sql, poolPromise, withTransientRetry } = require('../config/db');
const alcance = require('./alcance');

// Resuelve el identificador interno aceptando tanto el ID HIS como el número de documento.
const resolverIdPaciente = async (pool, identificador) => {
  // Prioriza una coincidencia exacta por ID cuando ambos campos pudieran coincidir.
  const result = await withTransientRetry(() => pool.request()
    .input('identificador', sql.NVarChar, String(identificador))
    .query(`
      SELECT TOP 1 Id_Paciente as id
      FROM MaestroPaciente
      WHERE Id_Paciente = @identificador
        OR Numero_Documento_Paciente = @identificador
      ORDER BY CASE WHEN Id_Paciente = @identificador THEN 0 ELSE 1 END
    `));
  return result.recordset[0]?.id ?? null;
};

// Busca pacientes por documento o texto, pagina los resultados y devuelve un registro único en modo documento.
const getPacientes = async (req, res) => {
  const { tipoDocumento, documento, q } = req.query;
  const requestedPage = Number.parseInt(req.query.page, 10);
  const requestedPageSize = Number.parseInt(req.query.pageSize, 10);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 1000000) : 1;
  const pageSize = Number.isSafeInteger(requestedPageSize) && requestedPageSize > 0 ? Math.min(requestedPageSize, 100) : 50;
  try {
    const pool = await poolPromise;
    const parameters = [];
    let whereSql = 'WHERE 1 = 1';

    if (tipoDocumento && documento) {
      whereSql += ' AND p.Id_Tipo_Documento_Paciente = @tipoDocumento AND p.Numero_Documento_Paciente = @documento';
      parameters.push(['tipoDocumento', sql.NVarChar, tipoDocumento], ['documento', sql.NVarChar, documento]);
    } else if (q && q.trim()) {
      const terms = q.trim().split(/\s+/).filter(Boolean);
      const termConditions = terms.map((_, index) => `(
        p.Id_Paciente LIKE @q${index}
        OR p.Numero_Documento_Paciente LIKE @q${index}
        OR p.Nombres_Paciente LIKE @q${index}
        OR p.Apellido_Paterno_Paciente LIKE @q${index}
        OR p.Apellido_Materno_Paciente LIKE @q${index}
        OR p.Historia_Clinica LIKE @q${index}
      )`);
      whereSql += ` AND (${termConditions.join(' AND ')})`;
      terms.forEach((term, index) => parameters.push([`q${index}`, sql.NVarChar, `%${term}%`]));
    }
    // Un médico restringido solo encuentra a los pacientes que ha atendido.
    if (alcance.esLimitado(req)) {
      whereSql += ' AND EXISTS (SELECT 1 FROM NProduccion mio WHERE mio.Id_Paciente = p.Id_Paciente AND mio.Id_Personal = @miPersonal)';
      parameters.push(['miPersonal', sql.NVarChar(50), alcance.miPersonal(req)]);
    }

    // El primer SELECT obtiene la página y el segundo el total de coincidencias para calcular páginas.
    const queryStr = `
      SELECT
        p.Id_Paciente as id,
        p.Id_Tipo_Documento_Paciente as tipoDocumento,
        p.Numero_Documento_Paciente as numeroDocumento,
        p.Apellido_Paterno_Paciente as apellidoPaterno,
        p.Apellido_Materno_Paciente as apellidoMaterno,
        p.Nombres_Paciente as nombres,
        p.Id_Genero as sexo,
        p.Fecha_Nacimiento_Paciente as fechaNacimiento,
        p.Historia_Clinica as historiaClinica,
        p.Ficha_Familiar as fichaFamiliar,
        p.Id_Etnia as etnia,
        p.Id_Pais as pais,
        p.Ubigeo_Nacimiento as ubigeoNacimiento,
        p.Domicilio_Declarado as domicilio,
        p.Id_Establecimiento as establecimiento,
        p.Fecha_Alta as fechaAlta
      FROM MaestroPaciente p
      ${whereSql}
      ORDER BY p.Id_Paciente
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;

      SELECT COUNT_BIG(*) as total
      FROM MaestroPaciente p
      ${whereSql};
    `;

    const result = await withTransientRetry(() => {
      const request = pool.request();
      parameters.forEach(([name, type, value]) => request.input(name, type, value));
      request.input('offset', sql.Int, (page - 1) * pageSize);
      request.input('pageSize', sql.Int, pageSize);
      return request.query(queryStr);
    });

    if (tipoDocumento && documento) {
      if (result.recordsets[0].length > 0) {
        res.status(200).json(result.recordsets[0][0]);
      } else {
        res.status(404).json({ message: 'Paciente no encontrado' });
      }
    } else {
      const total = Number(result.recordsets[1][0]?.total || 0);
      res.status(200).json({
        data: result.recordsets[0],
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize)
      });
    }
  } catch (error) {
    // Distingue fallos transitorios de base de datos para indicar si la solicitud puede reintentarse.
    console.error('Error in getPacientes:', error);
    const transient = ['ESOCKET', 'ECONNRESET', 'ETIMEOUT', 'ENOTOPEN'].includes(error.code);
    res.status(transient ? 503 : 500).json({ message: transient ? 'La conexión con la base de datos sigue interrumpida.' : 'No se pudo consultar pacientes.', code: error.code || 'DATABASE_ERROR' });
  }
};

// Devuelve ítems de producción del paciente; cada fila conserva el detalle original de NProduccion.
const getHistorialPaciente = async (req, res) => {
  const { id } = req.params;
  const { fechaInicio, fechaFin } = req.query;
  try {
    const pool = await poolPromise;
    const idPaciente = await resolverIdPaciente(pool, id);
    if (idPaciente === null) return res.status(404).json({ message: 'Paciente no encontrado' });
    const request = pool.request();
    request.input('idPaciente', sql.VarChar, idPaciente);

    // Trae registros HIS recientes junto con las descripciones disponibles en los catálogos.
    let queryStr = `
      SELECT TOP 200
        np.Id_Cita as idCita,
        np.Fecha_Atencion as fechaAtencion,
        np.Codigo_Item as codigoItem,
        np.Tipo_Diagnostico as tipoDiagnostico,
        np.Valor_Lab as valorLab,
        np.Peso as peso,
        np.Talla as talla,
        np.Hemoglobina as hemoglobina,
        np.Perimetro_Cefalico as perimetroCefalico,
        np.Perimetro_Abdominal as perimetroAbdominal,
        np.Edad_Reg as edadRegistro,
        np.Tipo_Edad as tipoEdad,
        np.Id_Ups as idUps,
        np.Id_Establecimiento as idEstablecimiento,
        np.Id_Personal as idPersonal,
        np.Id_Financiador as idFinanciador,
        np.Id_Otra_Condicion as otraCondicion,
        np.Fecha_Registro as fechaRegistro,
        np.Id_Dosis as dosis,
        np.Alerta as alerta,
        c.Descripcion_Item as descripcionItem,
        u.Descripcion_Ups as descripcionUps
      FROM NProduccion np
      OUTER APPLY (SELECT TOP 1 Descripcion_Item FROM MAESTRO_HIS_CIE_CPMS WHERE Codigo_Item = np.Codigo_Item) c
      OUTER APPLY (SELECT TOP 1 Descripcion_Ups FROM MAESTRO_HIS_UPS WHERE Id_Ups = np.Id_Ups) u
      WHERE np.Id_Paciente = @idPaciente
    `;

    if (fechaInicio) {
      queryStr += ' AND np.Fecha_Atencion >= @fechaInicio';
      request.input('fechaInicio', sql.Date, fechaInicio);
    }
    if (fechaFin) {
      queryStr += ' AND np.Fecha_Atencion < DATEADD(DAY, 1, @fechaFin)';
      request.input('fechaFin', sql.Date, fechaFin);
    }

    queryStr += ' ORDER BY np.Fecha_Atencion DESC, np.Id_Correlativo_Item';

    const result = await withTransientRetry(() => request.query(queryStr));
    res.status(200).json(result.recordset);
  } catch (error) {
    // Registra el fallo y conserva un mensaje HTTP genérico para esta consulta de historial.
    console.error('Error in getHistorialPaciente:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// Combina métricas generales, historial filtrable y códigos agrupados para mostrar la ficha del paciente.
const getPanelPaciente = async (req, res) => {
  const { id } = req.params;
  const { fechaInicio, fechaFin, q } = req.query;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 500);

  try {
    const pool = await poolPromise;
    const idPaciente = await resolverIdPaciente(pool, id);
    if (idPaciente === null) return res.status(404).json({ message: 'Paciente no encontrado' });

    // Los SELECT devuelven, en orden, el resumen, el detalle cronológico y los diagnósticos agrupados.
    const panelQuery = `
        -- Métricas globales del paciente, independientes del filtro aplicado al historial.
        SELECT
            COUNT(*) as totalRegistros,
          COUNT(DISTINCT Id_Cita) as citasUnicas,
          MAX(Fecha_Atencion) as ultimaAtencion,
          COUNT(DISTINCT Codigo_Item) as diagnosticosDistintos,
          COUNT(DISTINCT Id_Establecimiento) as establecimientosDistintos
        FROM NProduccion
        WHERE Id_Paciente = @idPaciente;

        -- Detalle clínico opcionalmente filtrado por fechas y texto; limit está acotado en el servidor.
        SELECT TOP ${limit}
          np.Id_Cita as idCita,
          np.Num_Reg as numeroRegistro,
          np.Id_Correlativo_Item as correlativo,
          np.Fecha_Atencion as fechaAtencion,
          np.Codigo_Item as codigoItem,
          np.Tipo_Diagnostico as tipoDiagnostico,
          np.Valor_Lab as valorLab,
          np.Edad_Reg as edadRegistro,
          np.Tipo_Edad as tipoEdad,
          np.Peso as peso,
          np.Talla as talla,
          np.Hemoglobina as hemoglobina,
          np.Perimetro_Cefalico as perimetroCefalico,
          np.Perimetro_Abdominal as perimetroAbdominal,
          np.Alerta as alerta,
          c.Descripcion_Item as descripcionItem,
          u.Descripcion_Ups as descripcionUps,
          LTRIM(RTRIM(CONCAT(p.Apellido_Paterno_Personal, ' ', p.Apellido_Materno_Personal, ' ', p.Nombres_Personal))) as nombrePersonal,
          f.Descripcion_Financiador as financiador
        FROM NProduccion np
        OUTER APPLY (SELECT TOP 1 Descripcion_Item FROM MAESTRO_HIS_CIE_CPMS WHERE Codigo_Item = np.Codigo_Item) c
        OUTER APPLY (SELECT TOP 1 Descripcion_Ups FROM MAESTRO_HIS_UPS WHERE Id_Ups = np.Id_Ups) u
        OUTER APPLY (SELECT TOP 1 Apellido_Paterno_Personal, Apellido_Materno_Personal, Nombres_Personal FROM MaestroPersonal WHERE Id_Personal = np.Id_Personal) p
        OUTER APPLY (SELECT TOP 1 Descripcion_Financiador FROM MAESTRO_HIS_FINANCIADOR WHERE Id_Financiador = np.Id_Financiador) f
        WHERE np.Id_Paciente = @idPaciente
          AND (@fechaInicio IS NULL OR np.Fecha_Atencion >= @fechaInicio)
          AND (@fechaFin IS NULL OR np.Fecha_Atencion < DATEADD(DAY, 1, @fechaFin))
          AND (@busqueda IS NULL OR np.Codigo_Item LIKE @busqueda OR c.Descripcion_Item LIKE @busqueda
            OR u.Descripcion_Ups LIKE @busqueda
            OR p.Nombres_Personal LIKE @busqueda OR p.Apellido_Paterno_Personal LIKE @busqueda
            OR p.Apellido_Materno_Personal LIKE @busqueda)
        ORDER BY np.Fecha_Atencion DESC, np.Num_Reg DESC, np.Id_Correlativo_Item;

        -- Resume cada código con frecuencia y rango de fechas en el mismo periodo de búsqueda.
        SELECT TOP 50
          np.Codigo_Item as codigo,
          c.Descripcion_Item as descripcion,
          COUNT(*) as veces,
          MIN(np.Fecha_Atencion) as primeraVez,
          MAX(np.Fecha_Atencion) as ultimaVez,
          MAX(np.Tipo_Diagnostico) as ultimoTipo
        FROM NProduccion np
        OUTER APPLY (SELECT TOP 1 Descripcion_Item FROM MAESTRO_HIS_CIE_CPMS WHERE Codigo_Item = np.Codigo_Item) c
        WHERE np.Id_Paciente = @idPaciente
          AND NULLIF(LTRIM(RTRIM(np.Codigo_Item)), '') IS NOT NULL
          AND (@fechaInicio IS NULL OR np.Fecha_Atencion >= @fechaInicio)
          AND (@fechaFin IS NULL OR np.Fecha_Atencion < DATEADD(DAY, 1, @fechaFin))
          AND (@busqueda IS NULL OR np.Codigo_Item LIKE @busqueda OR c.Descripcion_Item LIKE @busqueda)
        GROUP BY np.Codigo_Item, c.Descripcion_Item
        ORDER BY veces DESC;
      `;
    const result = await withTransientRetry(() => pool.request()
      .input('idPaciente', sql.VarChar, idPaciente)
      .input('fechaInicio', sql.Date, fechaInicio || null)
      .input('fechaFin', sql.Date, fechaFin || null)
      .input('busqueda', sql.NVarChar, q?.trim() ? `%${q.trim()}%` : null)
      .query(panelQuery));

    res.status(200).json({
      resumen: result.recordsets[0][0],
      historial: result.recordsets[1],
      diagnosticos: result.recordsets[2]
    });
  } catch (error) {
    // Los errores de conexión reciben 503; otros fallos del panel se reportan como 500.
    console.error('Error in getPanelPaciente:', error);
    const transient = ['ESOCKET', 'ECONNRESET', 'ETIMEOUT', 'ENOTOPEN'].includes(error.code);
    res.status(transient ? 503 : 500).json({
      message: transient ? 'La conexión con la base de datos se interrumpió. Vuelva a intentar.' : 'No se pudo cargar la historia del paciente.',
      code: error.code || 'DATABASE_ERROR'
    });
  }
};

// ── Resumen de diagnósticos del paciente (agrupados) ──
// Agrupa los códigos HIS registrados para el paciente y calcula frecuencia y fechas de ocurrencia.
const getDiagnosticosPaciente = async (req, res) => {
  const { id } = req.params;
  try {
    const pool = await poolPromise;
    const idPaciente = await resolverIdPaciente(pool, id);
    if (idPaciente === null) return res.status(404).json({ message: 'Paciente no encontrado' });
    const result = await withTransientRetry(() => pool.request()
      .input('idPaciente', sql.VarChar, idPaciente)
      .query(`
        -- Agrupa por código y descripción; MIN/MAX indican primera y última aparición en producción.
        SELECT 
          np.Codigo_Item as codigo,
          c.Descripcion_Item as descripcion,
          COUNT(*) as veces,
          MIN(np.Fecha_Atencion) as primeraVez,
          MAX(np.Fecha_Atencion) as ultimaVez,
          MAX(np.Tipo_Diagnostico) as ultimoTipo
        FROM NProduccion np
        OUTER APPLY (SELECT TOP 1 Descripcion_Item FROM MAESTRO_HIS_CIE_CPMS WHERE Codigo_Item = np.Codigo_Item) c
        WHERE np.Id_Paciente = @idPaciente
          AND np.Codigo_Item IS NOT NULL
          AND np.Codigo_Item != ''
        GROUP BY np.Codigo_Item, c.Descripcion_Item
        ORDER BY veces DESC
      `));
    res.status(200).json(result.recordset);
  } catch (error) {
    // Registra problemas de base de datos sin exponer detalles internos al cliente.
    console.error('Error in getDiagnosticosPaciente:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ── Datos antropométricos del paciente (evolución peso/talla/hemoglobina) ──
// Devuelve mediciones clínicas registradas para graficar su evolución temporal.
const getAntropometriaPaciente = async (req, res) => {
  const { id } = req.params;
  try {
    const pool = await poolPromise;
    const idPaciente = await resolverIdPaciente(pool, id);
    if (idPaciente === null) return res.status(404).json({ message: 'Paciente no encontrado' });
    const result = await pool.request()
      .input('idPaciente', sql.VarChar, idPaciente)
      .query(`
        -- Omite filas sin mediciones relevantes y ordena desde la atención más reciente.
        SELECT 
          Fecha_Atencion as fecha,
          Peso as peso,
          Talla as talla,
          Hemoglobina as hemoglobina,
          Perimetro_Cefalico as perimetroCefalico,
          Perimetro_Abdominal as perimetroAbdominal
        FROM NProduccion
        WHERE Id_Paciente = @idPaciente
          AND (Peso IS NOT NULL OR Talla IS NOT NULL OR Hemoglobina IS NOT NULL)
        ORDER BY Fecha_Atencion DESC
      `);
    res.status(200).json(result.recordset);
  } catch (error) {
    // Mantiene la respuesta pública genérica y deja el detalle técnico en el log del servidor.
    console.error('Error in getAntropometriaPaciente:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ── Verificar si paciente está en SINADEF (fallecidos) ──
// Busca por documento en la vista SINADEF y responde si existe coincidencia de fallecimiento.
const checkSinadef = async (req, res) => {
  const { documento } = req.query;
  if (!documento) {
    return res.status(400).json({ message: 'Documento requerido' });
  }
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('documento', sql.NVarChar, documento)
      .query(`
        -- Recupera los datos disponibles de defunción asociados al documento solicitado.
        SELECT TOP 1
          PRIMER_APELLIDO as apellidoPaterno,
          SEGUNDO_APELLIDO as apellidoMaterno,
          NOMBRES as nombres,
          DOCUMENTO as documento,
          SEXO as sexo,
          EDAD as edad,
          TIEMPO_EDAD as tiempoEdad,
          FECHA as fechaFallecimiento,
          HORA as horaFallecimiento,
          DEBIDO_CAUSA_A as causaA,
          CAUSA_A_CIEX as causaACie,
          DEBIDO_CAUSA_B as causaB,
          CAUSA_B_CIEX as causaBCie,
          DEBIDO_CAUSA_C as causaC,
          CAUSA_C_CIEX as causaCCie,
          TIPO_SEGURO as tipoSeguro,
          ESTADO_CIVIL as estadoCivil,
          DEPARTAMENTO_DOMICILIO as departamento,
          PROVINCIA_DOMICILIO as provincia,
          DISTRITO_DOMICILIO as distrito,
          DIRECCION_DE_DOMICILIO as direccion,
          DESCRIPCION_DE_LUGAR as lugarFallecimiento,
          MUERTE_VIOLENTA as muerteViolenta,
          NECROPSIA as necropsia,
          TIPO_CDEF as tipoCdef,
          CDEF as cdef,
          ESTADO as estado
        FROM V_SINADEF_AYACUCHO_DOMFALLECIDO
        WHERE DOCUMENTO = @documento
      `);

    if (result.recordset.length > 0) {
      res.status(200).json({ fallecido: true, datos: result.recordset[0] });
    } else {
      res.status(200).json({ fallecido: false });
    }
  } catch (error) {
    // Protege al cliente de mensajes SQL internos cuando la vista SINADEF no puede consultarse.
    console.error('Error in checkSinadef:', error);
    res.status(500).json({ error: 'Error al consultar SINADEF' });
  }
};

// ── Últimas atenciones del paciente (resumen rápido) ──
// Calcula indicadores rápidos de uso de servicios para el encabezado de la ficha del paciente.
const getResumenPaciente = async (req, res) => {
  const { id } = req.params;
  try {
    const pool = await poolPromise;
    const idPaciente = await resolverIdPaciente(pool, id);
    if (idPaciente === null) return res.status(404).json({ message: 'Paciente no encontrado' });
    const result = await withTransientRetry(() => pool.request()
      .input('idPaciente', sql.VarChar, idPaciente)
      .query(`
        SELECT
          COUNT(*) as total,
          MAX(Fecha_Atencion) as ultima,
          COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(Codigo_Item)), '') IS NOT NULL THEN Codigo_Item END) as totalDx,
          COUNT(DISTINCT Id_Establecimiento) as totalEst
        FROM NProduccion
        WHERE Id_Paciente = @idPaciente
      `));
    const row = result.recordset[0] || {};
    res.status(200).json({
      totalAtenciones: row.total || 0,
      ultimaAtencion: row.ultima || null,
      diagnosticosDistintos: row.totalDx || 0,
      establecimientosDistintos: row.totalEst || 0
    });
  } catch (error) {
    // Registra la causa técnica y responde con un error genérico para la consulta del resumen.
    console.error('Error in getResumenPaciente:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

module.exports = {
  getPacientes,
  getHistorialPaciente,
  getPanelPaciente,
  getDiagnosticosPaciente,
  getAntropometriaPaciente,
  checkSinadef,
  getResumenPaciente
};
