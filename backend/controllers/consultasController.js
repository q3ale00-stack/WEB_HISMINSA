    // Controlador analítico: valida opciones de consulta, construye SQL parametrizado y ofrece resúmenes agregados.
    const { sql, poolPromise, withTransientRetry } = require('../config/db');

    // Lista blanca de campos consultables; cada campo declara su etiqueta, tipo y expresión SQL fija.
    const FIELD_DEFS = {
      idPaciente: { label: 'ID del paciente', type: 'string', sql: 'np.Id_Paciente' },
      fechaAtencion: { label: 'Fecha de atención', type: 'date', sql: 'np.Fecha_Atencion' },
      establecimiento: { label: 'Establecimiento', type: 'string', sql: 'e.Nombre_Establecimiento' },
      departamento: { label: 'Departamento', type: 'string', sql: 'e.Departamento' },
      provincia: { label: 'Provincia', type: 'string', sql: 'e.Provincia' },
      ups: { label: 'UPS / servicio', type: 'string', sql: 'u.Descripcion_Ups' },
      profesional: { label: 'Profesional', type: 'string', sql: 'p.Nombre_Completo_Personal' },
      tipoDiagnostico: { label: 'Tipo de diagnóstico HIS', type: 'string', sql: 'np.Tipo_Diagnostico' },
      financiador: { label: 'Financiador', type: 'string', sql: 'f.Descripcion_Financiador' },
      sexo: { label: 'Sexo', type: 'string', sql: 'mp.Id_Genero' },
      edad: { label: 'Edad registrada (años)', type: 'number', sql: "CASE WHEN np.Tipo_Edad = 'A' THEN np.Edad_Reg END" },
      codigoHIS: { label: 'Código HIS', type: 'string', sql: 'np.Codigo_Item' },
      diagnostico: { label: 'Diagnóstico', type: 'string', sql: 'c.Descripcion_Item' },
      valorLab: {
        label: 'Valor LAB',
        type: 'number',
        sql: "CASE WHEN TRY_CAST(np.Valor_Lab AS DECIMAL(18,2)) IS NOT NULL THEN TRY_CAST(np.Valor_Lab AS DECIMAL(18,2)) WHEN LTRIM(RTRIM(np.Valor_Lab)) = '10+' THEN 10 ELSE NULL END"
      },
      peso: { label: 'Peso', type: 'number', sql: 'np.Peso' },
      talla: { label: 'Talla', type: 'number', sql: 'np.Talla' },
      hemoglobina: { label: 'Hemoglobina', type: 'number', sql: 'np.Hemoglobina' },
      documento: { label: 'Documento', type: 'string', sql: 'mp.Numero_Documento_Paciente' },
      nombrePaciente: { label: 'Nombre del paciente', type: 'string', sql: "LTRIM(RTRIM(CONCAT(mp.Apellido_Paterno_Paciente, ' ', mp.Apellido_Materno_Paciente, ' ', mp.Nombres_Paciente)))" },
      historiaClinica: { label: 'Historia clínica', type: 'string', sql: 'mp.Historia_Clinica' }
    };

    // Lista blanca de dimensiones disponibles para agrupar los resultados.
    const GROUP_BY_DEFS = {
      establecimiento: { label: 'Establecimiento', sql: 'e.Nombre_Establecimiento' },
      departamento: { label: 'Departamento', sql: 'e.Departamento' },
      provincia: { label: 'Provincia', sql: 'e.Provincia' },
      profesional: { label: 'Profesional', sql: 'p.Nombre_Completo_Personal' },
      mes: { label: 'Mes', sql: 'CONVERT(char(7), np.Fecha_Atencion, 120)' },
      dia: { label: 'Día', sql: 'CONVERT(date, np.Fecha_Atencion)' },
      año: { label: 'Año', sql: 'YEAR(np.Fecha_Atencion)' },
      codigoHIS: { label: 'Código HIS', sql: 'np.Codigo_Item' },
      diagnostico: { label: 'Diagnóstico', sql: 'c.Descripcion_Item' },
      tipoDiagnostico: { label: 'Tipo de diagnóstico HIS', sql: 'np.Tipo_Diagnostico' },
      financiador: { label: 'Financiador', sql: 'f.Descripcion_Financiador' },
      sexo: { label: 'Sexo', sql: 'mp.Id_Genero' },
      ups: { label: 'UPS', sql: 'u.Descripcion_Ups' },
      idPaciente: { label: 'ID del paciente', sql: 'np.Id_Paciente' },
      documento: { label: 'Nro. Documento', sql: 'mp.Numero_Documento_Paciente' },
      nombrePaciente: { label: 'Nombre Paciente', sql: "LTRIM(RTRIM(CONCAT(mp.Apellido_Paterno_Paciente, ' ', mp.Apellido_Materno_Paciente, ' ', mp.Nombres_Paciente)))" }
    };

    // Métricas agregadas permitidas; el cliente elige una clave, nunca envía una expresión SQL propia.
    const MEASURE_DEFS = {
      pacientesUnicos: { label: 'Pacientes únicos', sql: 'COUNT(DISTINCT np.Id_Paciente)' },
      atenciones: { label: 'Atenciones (citas únicas)', sql: 'COUNT(DISTINCT np.Id_Cita)' },
      registros: { label: 'Registros HIS', sql: 'COUNT_BIG(*)' },
      sumLab: {
        label: 'Suma LAB (10+ como 10)',
        sql: "SUM(CASE WHEN TRY_CAST(np.Valor_Lab AS DECIMAL(18,2)) IS NOT NULL THEN TRY_CAST(np.Valor_Lab AS DECIMAL(18,2)) WHEN LTRIM(RTRIM(np.Valor_Lab)) = '10+' THEN 10 ELSE NULL END)"
      },
      avgLab: {
        label: 'Promedio LAB (10+ como 10)',
        sql: "AVG(CASE WHEN TRY_CAST(np.Valor_Lab AS DECIMAL(18,2)) IS NOT NULL THEN TRY_CAST(np.Valor_Lab AS DECIMAL(18,2)) WHEN LTRIM(RTRIM(np.Valor_Lab)) = '10+' THEN 10 ELSE NULL END)"
      },
      avgEdad: { label: 'Edad promedio (años registrados)', sql: "AVG(CASE WHEN np.Tipo_Edad = 'A' THEN CAST(np.Edad_Reg AS DECIMAL(10,2)) END)" },
      maxPeso: { label: 'Peso máximo', sql: 'MAX(np.Peso)' },
      avgPeso: { label: 'Peso promedio', sql: 'AVG(np.Peso)' },
      avgTalla: { label: 'Talla promedio', sql: 'AVG(np.Talla)' },
      maxTalla: { label: 'Talla máxima', sql: 'MAX(np.Talla)' },
      avgHemoglobina: { label: 'Hemoglobina promedio', sql: 'AVG(np.Hemoglobina)' },
      maxHemoglobina: { label: 'Hemoglobina máxima', sql: 'MAX(np.Hemoglobina)' },
      codigosUnicos: { label: 'Códigos HIS distintos', sql: 'COUNT(DISTINCT np.Codigo_Item)' }
    };

    const LEGACY_MEASURE_KEYS = { personasUnicas: 'pacientesUnicos' };
    // Acepta la clave mal escrita que pudo usar una versión previa sin publicarla en los metadatos.
    const LEGACY_FIELD_KEYS = { ID_pasciente: 'idPaciente' };
    const RECORD_COUNT_SQL = 'COUNT_BIG(*)';
    const PATIENT_COUNT_SQL = 'COUNT(DISTINCT np.Id_Paciente)';
    const APPOINTMENT_COUNT_SQL = 'COUNT(DISTINCT np.Id_Cita)';
    // Límites de entrada y salida para mantener las consultas complejas bajo control.
    const MAX_QUERY_GROUPS = 20;
    const MAX_QUERY_FILTERS = 100;
    const MAX_SQL_PARAMETERS = 2000;
    const MAX_RESULT_GROUPS = 5000;

    // Conserva el alias histórico de pacientes únicos para solicitudes de versiones anteriores.
    const normalizeMeasureKey = (key) => LEGACY_MEASURE_KEYS[key] || key;

    // Operadores autorizados según el tipo de dato para evitar combinaciones incompatibles.
    const OPERATOR_MAP = {
      string: ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with', 'in'],
      number: ['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'between', 'in'],
      date: ['equals', 'before', 'after', 'between', 'year', 'month']
    };

    // Recupera un campo de la lista blanca y rechaza cualquier identificador no reconocido.
    const getFieldDef = (field) => {
      const normalizedField = LEGACY_FIELD_KEYS[field] || field;
      if (!FIELD_DEFS[normalizedField]) {
        throw new Error(`Campo no permitido: ${field}`);
      }
      return FIELD_DEFS[normalizedField];
    };

    // Asigna a cada parámetro el tipo SQL correspondiente al campo filtrado.
    const parseSqlType = (fieldDef) => {
      if (fieldDef.type === 'number') return sql.Decimal(18, 2);
      if (fieldDef.type === 'date') return sql.Date;
      return sql.NVarChar;
    };

    // Restringe la combinación de condiciones a AND u OR.
    const normalizeLogic = (value, context) => {
      const logic = String(value || 'AND').toUpperCase();
      if (!['AND', 'OR'].includes(logic)) {
        throw new Error(`Lógica no permitida en ${context}.`);
      }
      return logic;
    };

    // Comprueba formato ISO y calendario real, evitando fechas normalizadas silenciosamente.
    const isValidISODate = (value) => {
      const text = String(value || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
      const date = new Date(`${text}T00:00:00.000Z`);
      return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text;
    };

    // Limpia valores recibidos y normaliza listas, rangos, números y fechas según el operador.
    const normalizeFilterValues = (fieldDef, operator, value, value2) => {
      // Convierte cada entrada al tipo esperado y descarta valores vacíos o inválidos.
      const sanitize = (raw) => {
        if (raw === null || raw === undefined) return null;
        const text = String(raw).trim();
        if (!text) return null;
        if (fieldDef.type === 'number') {
          const num = Number(text.endsWith('+') ? text.slice(0, -1) : text);
          return Number.isFinite(num) ? num : null;
        }
        if (fieldDef.type === 'date') {
          if (['year', 'month'].includes(operator) && /^\d+$/.test(text)) return text;
          if (!isValidISODate(text)) return null;
        }
        return text;
      };

      switch (operator) {
        case 'contains':
          return [`%${sanitize(value) ?? ''}%`].filter((v) => v && v !== '%%');
        case 'not_contains':
          return [`%${sanitize(value) ?? ''}%`].filter((v) => v && v !== '%%');
        case 'starts_with':
          return [`${sanitize(value) ?? ''}%`].filter((v) => v && v !== '%');
        case 'ends_with':
          return [`%${sanitize(value) ?? ''}`].filter((v) => v && v !== '%');
        case 'in': {
          const list = Array.isArray(value) ? value : String(value || '').split(',');
          return list.map((v) => sanitize(v)).filter((v) => v !== null && v !== '');
        }
        case 'between': {
          const v1 = sanitize(value);
          const v2 = sanitize(value2);
          return [v1, v2].filter((v) => v !== null && v !== '');
        }
        default:
          return [sanitize(value)].filter((v) => v !== null && v !== '');
      }
    };

    // Campos constantes dentro de un mismo paciente y dentro de una misma cita (verificado en NProduccion).
    // Se evalúan directamente sobre la fila; solo los campos que varían entre ítems requieren EXISTS.
    const PATIENT_LEVEL_FIELDS = new Set(['idPaciente', 'sexo', 'documento', 'nombrePaciente', 'historiaClinica']);
    const APPOINTMENT_LEVEL_FIELDS = new Set([
      ...PATIENT_LEVEL_FIELDS,
      'fechaAtencion', 'establecimiento', 'departamento', 'provincia', 'ups', 'profesional', 'financiador', 'edad'
    ]);

    // Mapeo para subconsultas EXISTS según el ámbito de evaluación (misma cita o mismo paciente).
    const SUBQUERY_FIELD_MAPPING = {
      idPaciente: { expr: (sub) => `${sub}.Id_Paciente`, join: () => '' },
      fechaAtencion: { expr: (sub) => `${sub}.Fecha_Atencion`, join: () => '' },
      establecimiento: {
        expr: (sub) => `${sub}_e.Nombre_Establecimiento`,
        join: (sub) => `OUTER APPLY (SELECT TOP (1) catalogo.Nombre_Establecimiento FROM MAESTRO_HIS_ESTABLECIMIENTO catalogo WHERE catalogo.Id_Establecimiento = ${sub}.Id_Establecimiento ORDER BY CASE WHEN NULLIF(LTRIM(RTRIM(catalogo.Nombre_Establecimiento)), '') IS NULL THEN 1 ELSE 0 END, catalogo.Nombre_Establecimiento) ${sub}_e`
      },
      departamento: {
        expr: (sub) => `${sub}_e.Departamento`,
        join: (sub) => `OUTER APPLY (SELECT TOP (1) catalogo.Departamento FROM MAESTRO_HIS_ESTABLECIMIENTO catalogo WHERE catalogo.Id_Establecimiento = ${sub}.Id_Establecimiento ORDER BY CASE WHEN NULLIF(LTRIM(RTRIM(catalogo.Departamento)), '') IS NULL THEN 1 ELSE 0 END, catalogo.Departamento) ${sub}_e`
      },
      provincia: {
        expr: (sub) => `${sub}_e.Provincia`,
        join: (sub) => `OUTER APPLY (SELECT TOP (1) catalogo.Provincia FROM MAESTRO_HIS_ESTABLECIMIENTO catalogo WHERE catalogo.Id_Establecimiento = ${sub}.Id_Establecimiento ORDER BY CASE WHEN NULLIF(LTRIM(RTRIM(catalogo.Provincia)), '') IS NULL THEN 1 ELSE 0 END, catalogo.Provincia) ${sub}_e`
      },
      ups: {
        expr: (sub) => `${sub}_u.Descripcion_Ups`,
        join: (sub) => `OUTER APPLY (SELECT TOP (1) catalogo.Descripcion_Ups FROM MAESTRO_HIS_UPS catalogo WHERE catalogo.Id_Ups = ${sub}.Id_Ups ORDER BY CASE WHEN NULLIF(LTRIM(RTRIM(catalogo.Descripcion_Ups)), '') IS NULL THEN 1 ELSE 0 END, catalogo.Descripcion_Ups) ${sub}_u`
      },
      profesional: {
        expr: (sub) => `${sub}_p.Nombre_Completo_Personal`,
        join: (sub) => `OUTER APPLY (SELECT TOP (1) LTRIM(RTRIM(CONCAT(catalogo.Apellido_Paterno_Personal, ' ', catalogo.Apellido_Materno_Personal, ' ', catalogo.Nombres_Personal))) AS Nombre_Completo_Personal, catalogo.Nombres_Personal, catalogo.Numero_Documento_Personal FROM MaestroPersonal catalogo WHERE catalogo.Id_Personal = ${sub}.Id_Personal ORDER BY CASE WHEN NULLIF(LTRIM(RTRIM(catalogo.Nombres_Personal)), '') IS NULL THEN 1 ELSE 0 END, catalogo.Apellido_Paterno_Personal, catalogo.Nombres_Personal) ${sub}_p`
      },
      tipoDiagnostico: { expr: (sub) => `${sub}.Tipo_Diagnostico`, join: () => '' },
      financiador: {
        expr: (sub) => `${sub}_f.Descripcion_Financiador`,
        join: (sub) => `OUTER APPLY (SELECT TOP (1) catalogo.Descripcion_Financiador FROM MAESTRO_HIS_FINANCIADOR catalogo WHERE catalogo.Id_Financiador = ${sub}.Id_Financiador ORDER BY CASE WHEN NULLIF(LTRIM(RTRIM(catalogo.Descripcion_Financiador)), '') IS NULL THEN 1 ELSE 0 END, catalogo.Descripcion_Financiador) ${sub}_f`
      },
      sexo: {
        expr: (sub) => `${sub}_mp.Id_Genero`,
        join: (sub) => `LEFT JOIN MaestroPaciente ${sub}_mp ON ${sub}.Id_Paciente = ${sub}_mp.Id_Paciente`
      },
      edad: { expr: (sub) => `CASE WHEN ${sub}.Tipo_Edad = 'A' THEN ${sub}.Edad_Reg END`, join: () => '' },
      codigoHIS: { expr: (sub) => `${sub}.Codigo_Item`, join: () => '' },
      diagnostico: {
        expr: (sub) => `${sub}_c.Descripcion_Item`,
        join: (sub) => `OUTER APPLY (SELECT TOP (1) catalogo.Descripcion_Item FROM MAESTRO_HIS_CIE_CPMS catalogo WHERE catalogo.Codigo_Item = ${sub}.Codigo_Item ORDER BY CASE WHEN NULLIF(LTRIM(RTRIM(catalogo.Descripcion_Item)), '') IS NULL THEN 1 ELSE 0 END, catalogo.Descripcion_Item) ${sub}_c`
      },
      valorLab: {
        expr: (sub) => `CASE WHEN TRY_CAST(${sub}.Valor_Lab AS DECIMAL(18,2)) IS NOT NULL THEN TRY_CAST(${sub}.Valor_Lab AS DECIMAL(18,2)) WHEN LTRIM(RTRIM(${sub}.Valor_Lab)) = '10+' THEN 10 ELSE NULL END`,
        join: () => ''
      },
      peso: { expr: (sub) => `${sub}.Peso`, join: () => '' },
      talla: { expr: (sub) => `${sub}.Talla`, join: () => '' },
      hemoglobina: { expr: (sub) => `${sub}.Hemoglobina`, join: () => '' },
      documento: {
        expr: (sub) => `${sub}_mp.Numero_Documento_Paciente`,
        join: (sub) => `LEFT JOIN MaestroPaciente ${sub}_mp ON ${sub}.Id_Paciente = ${sub}_mp.Id_Paciente`
      },
      nombrePaciente: {
        expr: (sub) => `CONCAT(${sub}_mp.Apellido_Paterno_Paciente, ' ', ${sub}_mp.Apellido_Materno_Paciente, ' ', ${sub}_mp.Nombres_Paciente)`,
        join: (sub) => `LEFT JOIN MaestroPaciente ${sub}_mp ON ${sub}.Id_Paciente = ${sub}_mp.Id_Paciente`
      },
      historiaClinica: {
        expr: (sub) => `${sub}_mp.Historia_Clinica`,
        join: (sub) => `LEFT JOIN MaestroPaciente ${sub}_mp ON ${sub}.Id_Paciente = ${sub}_mp.Id_Paciente`
      }
    };

    // La expresión se obtiene exclusivamente de la definición interna validada.
    const getFieldExpression = (fieldDef) => fieldDef.sql;

    // Traduce un filtro lógico en una cláusula SQL y sus parámetros tipados, sin incrustar valores en el texto.
    const buildFilterClause = (field, operator, value, value2, paramIndex, customFieldExpr) => {
      const fieldDef = getFieldDef(field);
      const values = normalizeFilterValues(fieldDef, operator, value, value2);
      const fieldExpression = customFieldExpr || getFieldExpression(fieldDef);

      if (!values.length || (operator === 'between' && values.length < 2)) {
        throw new Error(`Ingrese valores válidos para el filtro "${fieldDef.label}".`);
      }
      if (operator === 'in' && values.length > 500) {
        throw new Error(`El filtro "${fieldDef.label}" admite hasta 500 valores por criterio.`);
      }

      const normalizedField = LEGACY_FIELD_KEYS[field] || field;
      const isProfesional = normalizedField === 'profesional';
      const profPrefix = isProfesional && fieldExpression.endsWith('.Nombre_Completo_Personal')
        ? fieldExpression.slice(0, -'.Nombre_Completo_Personal'.length)
        : null;

      switch (operator) {
        case 'contains':
          if (profPrefix) {
            return {
              clause: `(${fieldExpression} LIKE @p${paramIndex} OR ${profPrefix}.Numero_Documento_Personal LIKE @p${paramIndex})`,
              nextIndex: paramIndex + 1,
              params: [{ key: `p${paramIndex}`, value: values[0], sqlType: parseSqlType(fieldDef) }]
            };
          }
          return { clause: `${fieldExpression} LIKE @p${paramIndex}`, nextIndex: paramIndex + 1, params: [{ key: `p${paramIndex}`, value: values[0], sqlType: parseSqlType(fieldDef) }] };
        case 'not_contains':
          return { clause: `${fieldExpression} NOT LIKE @p${paramIndex}`, nextIndex: paramIndex + 1, params: [{ key: `p${paramIndex}`, value: values[0], sqlType: parseSqlType(fieldDef) }] };
        case 'starts_with':
          return { clause: `${fieldExpression} LIKE @p${paramIndex}`, nextIndex: paramIndex + 1, params: [{ key: `p${paramIndex}`, value: values[0], sqlType: parseSqlType(fieldDef) }] };
        case 'ends_with':
          return { clause: `${fieldExpression} LIKE @p${paramIndex}`, nextIndex: paramIndex + 1, params: [{ key: `p${paramIndex}`, value: values[0], sqlType: parseSqlType(fieldDef) }] };
        case 'in': {
          const valuesList = Array.isArray(values) ? values : [values];
          const placeholders = valuesList.map((_, i) => `@p${paramIndex + i}`).join(', ');
          const paramEntries = valuesList.map((val, i) => ({ key: `p${paramIndex + i}`, value: val, sqlType: parseSqlType(fieldDef) }));
          return { clause: `${fieldExpression} IN (${placeholders})`, nextIndex: paramIndex + valuesList.length, params: paramEntries };
        }
        case 'between': {
          if (values.length < 2) {
            return { clause: '1 = 0', nextIndex: paramIndex, params: [] };
          }
          const result = [
            { key: `p${paramIndex}`, value: values[0], sqlType: parseSqlType(fieldDef) },
            { key: `p${paramIndex + 1}`, value: values[1], sqlType: parseSqlType(fieldDef) }
          ];
          return { clause: `${fieldExpression} BETWEEN @p${paramIndex} AND @p${paramIndex + 1}`, nextIndex: paramIndex + 2, params: result };
        }
        case 'year':
        case 'month': {
          const part = operator === 'year' ? String(values[0]).slice(0, 4) : String(values[0]).slice(5, 7);
          const number = Number(part || values[0]);
          if (!Number.isInteger(number) || (operator === 'month' && (number < 1 || number > 12))) {
            throw new Error(`Ingrese un ${operator === 'year' ? 'año' : 'mes'} válido para "${fieldDef.label}".`);
          }
          const datePart = operator === 'year' ? 'YEAR' : 'MONTH';
          return { clause: `${datePart}(${fieldExpression}) = @p${paramIndex}`, nextIndex: paramIndex + 1, params: [{ key: `p${paramIndex}`, value: number, sqlType: sql.Int }] };
        }
        case 'before':
          return { clause: `${fieldExpression} < @p${paramIndex}`, nextIndex: paramIndex + 1, params: [{ key: `p${paramIndex}`, value: values[0], sqlType: parseSqlType(fieldDef) }] };
        case 'after':
          return { clause: `${fieldExpression} > @p${paramIndex}`, nextIndex: paramIndex + 1, params: [{ key: `p${paramIndex}`, value: values[0], sqlType: parseSqlType(fieldDef) }] };
        case 'equals':
          if (profPrefix) {
            return {
              clause: `(${fieldExpression} = @p${paramIndex} OR ${profPrefix}.Nombres_Personal = @p${paramIndex} OR ${profPrefix}.Numero_Documento_Personal = @p${paramIndex})`,
              nextIndex: paramIndex + 1,
              params: [{ key: `p${paramIndex}`, value: values[0], sqlType: parseSqlType(fieldDef) }]
            };
          }
          return { clause: `${fieldExpression} = @p${paramIndex}`, nextIndex: paramIndex + 1, params: [{ key: `p${paramIndex}`, value: values[0], sqlType: parseSqlType(fieldDef) }] };
        case 'not_equals':
          return { clause: `${fieldExpression} <> @p${paramIndex}`, nextIndex: paramIndex + 1, params: [{ key: `p${paramIndex}`, value: values[0], sqlType: parseSqlType(fieldDef) }] };
        case 'gt':
          return { clause: `${fieldExpression} > @p${paramIndex}`, nextIndex: paramIndex + 1, params: [{ key: `p${paramIndex}`, value: values[0], sqlType: parseSqlType(fieldDef) }] };
        case 'gte':
          return { clause: `${fieldExpression} >= @p${paramIndex}`, nextIndex: paramIndex + 1, params: [{ key: `p${paramIndex}`, value: values[0], sqlType: parseSqlType(fieldDef) }] };
        case 'lt':
          return { clause: `${fieldExpression} < @p${paramIndex}`, nextIndex: paramIndex + 1, params: [{ key: `p${paramIndex}`, value: values[0], sqlType: parseSqlType(fieldDef) }] };
        case 'lte':
          return { clause: `${fieldExpression} <= @p${paramIndex}`, nextIndex: paramIndex + 1, params: [{ key: `p${paramIndex}`, value: values[0], sqlType: parseSqlType(fieldDef) }] };
        default:
          return { clause: `${fieldExpression} = @p${paramIndex}`, nextIndex: paramIndex + 1, params: [{ key: `p${paramIndex}`, value: values[0], sqlType: parseSqlType(fieldDef) }] };
      }
    };

    // Valida la configuración completa y compone agregaciones, filtros agrupados y parámetros SQL.
    const buildQuery = (payload) => {
      const flatFilters = Array.isArray(payload.filters) ? payload.filters : [];
      const measureKey = normalizeMeasureKey(payload.measure || 'pacientesUnicos');
      if (!MEASURE_DEFS[measureKey]) {
        throw new Error(`Medida no permitida: ${measureKey}`);
      }
      const groupBy = Array.isArray(payload.groupBy)
        ? [...new Set(payload.groupBy.filter(Boolean).map((key) => LEGACY_FIELD_KEYS[key] || key))]
        : [];
      groupBy.forEach((key) => {
        if (!GROUP_BY_DEFS[key]) throw new Error(`Agrupación no permitida: ${key}`);
      });
      const logicMode = normalizeLogic(payload.logicMode, 'la consulta');
      const periodStart = payload.period?.start || null;
      const periodEnd = payload.period?.end || null;
      if (periodStart && !isValidISODate(periodStart)) {
        throw new Error('La fecha inicial no es válida.');
      }
      if (periodEnd && !isValidISODate(periodEnd)) {
        throw new Error('La fecha final no es válida.');
      }
      if (periodStart && periodEnd && periodStart > periodEnd) {
        throw new Error('La fecha inicial no puede ser posterior a la fecha final.');
      }
      // Admite grupos de filtros actuales y transforma el formato plano antiguo en un solo grupo.
      const topLevelGroups = Array.isArray(payload.filterGroups) && payload.filterGroups.length
        ? payload.filterGroups
        : [{ mode: logicMode, items: flatFilters, scope: 'cita' }];
      const filterCount = topLevelGroups.reduce(
        (total, group) => total + (Array.isArray(group.items) ? group.items.length : 0),
        0
      );
      if (topLevelGroups.length > MAX_QUERY_GROUPS) {
        throw new Error(`La consulta admite hasta ${MAX_QUERY_GROUPS} grupos de criterios.`);
      }
      if (filterCount > MAX_QUERY_FILTERS) {
        throw new Error(`La consulta admite hasta ${MAX_QUERY_FILTERS} criterios.`);
      }

      let paramIndex = 0;
      const params = [];
      const whereClauses = [];
      const combinedGroupClauses = [];

      // El fin del periodo es exclusivo para incluir de forma segura todo el día final.
      let periodStartKey = null;
      let periodEndKey = null;
      if (periodStart) {
        periodStartKey = `p${paramIndex}`;
        whereClauses.push({ clause: `np.Fecha_Atencion >= @${periodStartKey}`, logic: 'AND' });
        params.push({ key: periodStartKey, value: periodStart, sqlType: sql.Date });
        paramIndex += 1;
      }

      if (periodEnd) {
        periodEndKey = `p${paramIndex}`;
        whereClauses.push({ clause: `np.Fecha_Atencion < DATEADD(DAY, 1, @${periodEndKey})`, logic: 'AND' });
        params.push({ key: periodEndKey, value: periodEnd, sqlType: sql.Date });
        paramIndex += 1;
      }

      // Las subconsultas por paciente también respetan el periodo, para no contar registros fuera del rango.
      const periodConditions = (alias) => [
        periodStartKey ? `${alias}.Fecha_Atencion >= @${periodStartKey}` : null,
        periodEndKey ? `${alias}.Fecha_Atencion < DATEADD(DAY, 1, @${periodEndKey})` : null
      ].filter(Boolean);

      // Construye cada grupo con su operador interno y su ámbito (misma cita, mismo paciente o misma fila).
      // Cada cita ocupa varias filas (una por ítem HIS); un AND entre ítems distintos se resuelve con EXISTS.
      topLevelGroups.forEach((group, groupIndex) => {
        const groupItems = Array.isArray(group.items) ? group.items : [];
        if (!groupItems.length) return;
        const groupMode = normalizeLogic(group.mode, `el bloque ${groupIndex + 1}`);
        const rawScope = String(group.scope || '').toLowerCase().trim();
        const groupScope = ['cita', 'paciente', 'registro'].includes(rawScope)
          ? rawScope
          : 'cita';
        const sharedFields = groupScope === 'paciente' ? PATIENT_LEVEL_FIELDS : APPOINTMENT_LEVEL_FIELDS;

        const groupParams = [];
        const directClauses = [];
        const crossRowItems = [];
        let localIndex = paramIndex;

        groupItems.forEach((filter, filterIndex) => {
          if (!filter || !filter.field) return;
          const normalizedField = LEGACY_FIELD_KEYS[filter.field] || filter.field;
          const fieldDef = getFieldDef(normalizedField);
          const operator = filter.operator || 'equals';
          if (!OPERATOR_MAP[fieldDef.type].includes(operator)) {
            throw new Error(`Operador no permitido: ${operator} para ${filter.field}`);
          }
          const normValues = normalizeFilterValues(fieldDef, operator, filter.value, filter.value2);
          if (!normValues.length || (operator === 'between' && normValues.length < 2)) {
            return;
          }
          const startIndex = localIndex;
          const built = buildFilterClause(normalizedField, operator, filter.value, filter.value2, startIndex);
          if (built.nextIndex > MAX_SQL_PARAMETERS) {
            throw new Error(`La consulta supera el máximo seguro de ${MAX_SQL_PARAMETERS} valores de filtro.`);
          }
          groupParams.push(...built.params);
          localIndex = built.nextIndex;

          // Con O, en el ámbito de fila o en campos constantes de la cita/paciente, basta evaluar la fila actual.
          if (groupScope === 'registro' || groupMode === 'OR' || sharedFields.has(normalizedField)) {
            directClauses.push(built.clause);
            return;
          }

          // La subconsulta reutiliza los mismos parámetros (@pN) con columnas del alias correlacionado.
          const subAlias = `s_${groupIndex}_${filterIndex}`;
          const mapping = SUBQUERY_FIELD_MAPPING[normalizedField];
          if (!mapping) throw new Error(`Campo no permitido: ${filter.field}`);
          const subBuilt = buildFilterClause(normalizedField, operator, filter.value, filter.value2, startIndex, mapping.expr(subAlias));
          crossRowItems.push({
            rowClause: built.clause,
            subAlias,
            joinClause: mapping.join(subAlias),
            subClause: subBuilt.clause
          });
        });

        let clauses;
        if (crossRowItems.length < 2) {
          // Un único criterio variable equivale a filtrar la fila y conserva el detalle por código.
          clauses = [...directClauses, ...crossRowItems.map((item) => item.rowClause)];
        } else {
          const correlationColumn = groupScope === 'paciente' ? 'Id_Paciente' : 'Id_Cita';
          const existsClauses = crossRowItems.map((item) => {
            const conditions = [`${item.subAlias}.${correlationColumn} = np.${correlationColumn}`];
            if (groupScope === 'paciente') conditions.push(...periodConditions(item.subAlias));
            conditions.push(item.subClause);
            const join = item.joinClause ? ` ${item.joinClause}` : '';
            return `EXISTS (SELECT 1 FROM NProduccion ${item.subAlias}${join} WHERE ${conditions.join(' AND ')})`;
          });
          // La fila resultante debe ser uno de los ítems buscados para no mezclar otros códigos de la misma cita.
          const rowMatch = `(${crossRowItems.map((item) => item.rowClause).join(' OR ')})`;
          clauses = [...directClauses, ...existsClauses, rowMatch];
        }

        if (!clauses.length) return;
        const groupedClause = `(${clauses.join(` ${groupMode} `)})`;
        combinedGroupClauses.push({
          clause: groupedClause,
          params: groupParams,
          sourceIndex: groupIndex
        });
        paramIndex = localIndex;
      });

      // Combina grupos con el operador indicado en cada conexión; AND conserva la precedencia SQL habitual.
      if (combinedGroupClauses.length) {
        const groupExpression = combinedGroupClauses.map((group, index) => {
          if (index === 0) return group.clause;
          const previousGroup = topLevelGroups[combinedGroupClauses[index - 1].sourceIndex];
          const connectorMode = typeof previousGroup.nextMode === 'string'
            ? normalizeLogic(previousGroup.nextMode, `la conexión entre los grupos ${index} y ${index + 1}`)
            : logicMode;
          return `${connectorMode} ${group.clause}`;
        }).join(' ');
        whereClauses.push({
          clause: `(${groupExpression})`,
          logic: 'AND'
        });
        combinedGroupClauses.forEach((group) => params.push(...group.params));
      }

      // A partir de las listas blancas genera columnas, filtros y agrupaciones de la consulta.
      const measureSql = MEASURE_DEFS[measureKey].sql;
      const groupExpressions = groupBy.map((key) => GROUP_BY_DEFS[key].sql);
      const groupColumns = groupBy.map((key, index) => `${groupExpressions[index]} AS ${key}`).join(', ');
      const selectSql = [
        groupColumns,
        `${measureSql} AS total`,
        `${RECORD_COUNT_SQL} AS registros`,
        `${PATIENT_COUNT_SQL} AS pacientes`,
        `${APPOINTMENT_COUNT_SQL} AS atenciones`,
        groupBy.length ? `GROUPING_ID(${groupExpressions.join(', ')}) AS __isSummary` : 'CAST(1 AS int) AS __isSummary'
      ].filter(Boolean).join(', ');

      const whereSql = whereClauses.length
        ? `WHERE 1 = 1 ${whereClauses.map((item, index) => `${index === 0 ? 'AND' : item.logic || 'AND'} ${item.clause}`).join(' ')}`
        : 'WHERE 1 = 1';

      // GROUPING SETS calcula el total filtrado y los desgloses en una sola lectura de NProduccion.
      const query = `
        -- Limita el volumen devuelto; el resumen general sigue calculándose sobre todos los datos filtrados.
        SELECT TOP (${MAX_RESULT_GROUPS + 2}) ${selectSql}
        FROM NProduccion np
        LEFT JOIN MaestroPaciente mp ON np.Id_Paciente = mp.Id_Paciente
        -- Catálogos se resuelven a una sola fila por identificador para no duplicar ítems HIS en los conteos.
        OUTER APPLY (
          SELECT TOP (1)
            LTRIM(RTRIM(CONCAT(catalogo.Apellido_Paterno_Personal, ' ', catalogo.Apellido_Materno_Personal, ' ', catalogo.Nombres_Personal))) AS Nombre_Completo_Personal,
            catalogo.Nombres_Personal,
            catalogo.Numero_Documento_Personal
          FROM MaestroPersonal catalogo
          WHERE catalogo.Id_Personal = np.Id_Personal
          ORDER BY
            CASE WHEN NULLIF(LTRIM(RTRIM(catalogo.Nombres_Personal)), '') IS NULL THEN 1 ELSE 0 END,
            catalogo.Apellido_Paterno_Personal,
            catalogo.Nombres_Personal
        ) p
        OUTER APPLY (
          SELECT TOP (1) catalogo.Nombre_Establecimiento, catalogo.Departamento, catalogo.Provincia
          FROM MAESTRO_HIS_ESTABLECIMIENTO catalogo
          WHERE catalogo.Id_Establecimiento = np.Id_Establecimiento
          ORDER BY
            CASE WHEN NULLIF(LTRIM(RTRIM(catalogo.Nombre_Establecimiento)), '') IS NULL THEN 1 ELSE 0 END,
            catalogo.Nombre_Establecimiento
        ) e
        OUTER APPLY (
          SELECT TOP (1) catalogo.Descripcion_Ups
          FROM MAESTRO_HIS_UPS catalogo
          WHERE catalogo.Id_Ups = np.Id_Ups
          ORDER BY
            CASE WHEN NULLIF(LTRIM(RTRIM(catalogo.Descripcion_Ups)), '') IS NULL THEN 1 ELSE 0 END,
            catalogo.Descripcion_Ups
        ) u
        OUTER APPLY (
          SELECT TOP (1) catalogo.Descripcion_Item
          FROM MAESTRO_HIS_CIE_CPMS catalogo
          WHERE catalogo.Codigo_Item = np.Codigo_Item
          ORDER BY
            CASE WHEN NULLIF(LTRIM(RTRIM(catalogo.Descripcion_Item)), '') IS NULL THEN 1 ELSE 0 END,
            catalogo.Descripcion_Item
        ) c
        OUTER APPLY (
          SELECT TOP (1) catalogo.Descripcion_Financiador
          FROM MAESTRO_HIS_FINANCIADOR catalogo
          WHERE catalogo.Id_Financiador = np.Id_Financiador
          ORDER BY
            CASE WHEN NULLIF(LTRIM(RTRIM(catalogo.Descripcion_Financiador)), '') IS NULL THEN 1 ELSE 0 END,
            catalogo.Descripcion_Financiador
        ) f
        ${whereSql}
        ${groupBy.length ? `GROUP BY GROUPING SETS ((${groupExpressions.join(', ')}), ())` : ''}
        ORDER BY ${groupBy.length ? '__isSummary DESC, ' : ''}total DESC
      `;

      return {
        query,
        params,
        measureKey,
        groupBy,
        summaryGrouping: groupBy.length ? (2 ** groupBy.length) - 1 : 1
      };
    };

    // Ejecuta la consulta validada, separa fila resumen de desgloses y devuelve errores accionables.
    const executeGenericQuery = async (req, res) => {
      try {
        const payload = req.body || {};
        const { query, params, measureKey, groupBy, summaryGrouping } = buildQuery(payload);
        const pool = await poolPromise;
        // Vincula parámetros tipados al request y aplica reintentos solo ante fallos transitorios.
        const result = await withTransientRetry(() => {
          const request = pool.request();
          params.forEach((param) => {
            if (param.value !== null && param.value !== undefined) {
              request.input(param.key, param.sqlType, param.value);
            }
          });
          return request.query(query);
        });
        const resultRows = result.recordset || [];
        // GROUPING_ID permite distinguir el total general de las filas desglosadas.
        const summaryRow = resultRows.find((row) => Number(row.__isSummary) === summaryGrouping);
        const summary = summaryRow
          ? {
              total: summaryRow.total,
              registros: summaryRow.registros,
              pacientes: summaryRow.pacientes,
              atenciones: summaryRow.atenciones
            }
          : { total: 0, registros: 0, pacientes: 0, atenciones: 0 };
        const groupedRows = resultRows
          .filter((row) => Number(row.__isSummary) !== summaryGrouping)
          .map(({ __isSummary, ...row }) => row);
        const truncated = groupBy.length > 0 && groupedRows.length > MAX_RESULT_GROUPS;
        const rows = groupBy.length
          ? groupedRows.slice(0, MAX_RESULT_GROUPS)
          : Number(summary.registros) > 0 ? [summaryRow].map(({ __isSummary, ...row }) => row) : [];

        res.status(200).json({
          measure: measureKey,
          groupBy,
          truncated,
          rowLimit: MAX_RESULT_GROUPS,
          rows,
          summary: {
            ...summary,
            rows: rows.length
          }
        });
      } catch (error) {
        // Las validaciones y errores SQL se devuelven como 400; solo una interrupción de conexión usa 503.
        console.error('Error in executeGenericQuery:', error);
        const transient = ['ESOCKET', 'ECONNRESET', 'ETIMEOUT', 'ENOTOPEN'].includes(error.code);
        res.status(transient ? 503 : 400).json({
          message: transient ? 'La conexión con la base de datos se interrumpió. Vuelva a intentar.' : (error.message || 'La consulta no pudo ejecutarse.'),
          code: error.code || 'QUERY_ERROR'
        });
      }
    };

    // Obtiene los KPI generales y las dos series principales para el dashboard analítico (con caché de 3 min).
    const cache = require('../config/cache');
    const getDashboardResumen = async (req, res) => {
      try {
        const cached = cache.get('dashboard_resumen');
        if (cached) {
          return res.status(200).json(cached);
        }

        const pool = await poolPromise;
        // Cada SELECT produce el total del dashboard, el top por establecimiento y la tendencia mensual.
        const query = `
          -- Indicadores globales: distingue padrón, pacientes atendidos, citas, establecimientos y fecha reciente.
          SELECT
            (SELECT COUNT_BIG(*) FROM MaestroPaciente) AS pacientesRegistrados,
            COUNT(DISTINCT np.Id_Paciente) AS pacientesUnicos,
            COUNT(DISTINCT np.Id_Paciente) AS personasUnicas,
            COUNT(DISTINCT np.Id_Cita) AS atenciones,
            COUNT(DISTINCT np.Id_Establecimiento) AS establecimientos,
            MAX(np.Fecha_Atencion) AS ultimaAtencion
          FROM NProduccion np;

          -- Establecimientos con mayor número de pacientes distintos atendidos (optimizado).
          ;WITH TopEst AS (
            SELECT TOP 8
              np.Id_Establecimiento,
              COUNT(DISTINCT np.Id_Paciente) AS value
            FROM NProduccion np
            GROUP BY np.Id_Establecimiento
            ORDER BY value DESC
          )
          SELECT COALESCE(e.Nombre_Establecimiento, CONCAT('Establecimiento #', te.Id_Establecimiento)) AS label, te.value
          FROM TopEst te
          LEFT JOIN MAESTRO_HIS_ESTABLECIMIENTO e ON te.Id_Establecimiento = e.Id_Establecimiento
          ORDER BY te.value DESC;

          -- Ocho meses más recientes con conteo de citas únicas.
          SELECT TOP 8
            CONVERT(char(7), np.Fecha_Atencion, 120) AS label,
            COUNT(DISTINCT np.Id_Cita) AS value
          FROM NProduccion np
          GROUP BY YEAR(np.Fecha_Atencion), MONTH(np.Fecha_Atencion), CONVERT(char(7), np.Fecha_Atencion, 120)
          ORDER BY YEAR(np.Fecha_Atencion) DESC, MONTH(np.Fecha_Atencion) DESC;
        `;

        const result = await withTransientRetry(() => pool.request().query(query));
        const payload = {
          resumen: result.recordsets[0][0] || {},
          establecimientos: result.recordsets[1] || [],
          evolucion: result.recordsets[2] || []
        };
        cache.set('dashboard_resumen', payload, 180);
        res.status(200).json(payload);
      } catch (error) {
        // Conserva una respuesta compacta para el cliente y distingue indisponibilidad temporal de fallo interno.
        console.error('Error in getDashboardResumen:', error);
        const transient = ['ESOCKET', 'ECONNRESET', 'ETIMEOUT', 'ENOTOPEN'].includes(error.code);
        res.status(transient ? 503 : 500).json({
          message: transient ? 'La conexión con la base de datos sigue interrumpida.' : 'No se pudo cargar el resumen analítico.',
          code: error.code || 'DASHBOARD_ERROR'
        });
      }
    };

    // Publica al cliente las opciones compatibles con buildQuery sin revelar una consulta dinámica.
    const getQueryMetadata = (req, res) => {
      // Adapta las listas blancas internas al formato value/label/type esperado por la interfaz.
      const fields = Object.entries(FIELD_DEFS).map(([key, value]) => ({
        value: key,
        label: value.label,
        type: value.type
      }));

      const measures = Object.entries(MEASURE_DEFS).map(([key, value]) => ({
        value: key,
        label: value.label
      }));

      const groupings = Object.entries(GROUP_BY_DEFS).map(([key, value]) => ({
        value: key,
        label: value.label
      }));

      res.status(200).json({
        fields,
        measures,
        groupings,
        scopes: [
          { value: 'cita', label: 'Misma cita / atención' },
          { value: 'paciente', label: 'Mismo paciente' },
          { value: 'registro', label: 'Mismo registro / fila' }
        ],
        operators: OPERATOR_MAP,
        note: 'Los conteos distinguen pacientes únicos, citas HIS únicas y registros de producción.'
      });
    };

    // Describe indicadores de referencia para mostrar fórmulas y dimensiones sugeridas.
    const getIndicadores = (req, res) => {
      res.status(200).json({
        indicadores: [
          {
            id: 'cumplimiento-sesiones',
            nombre: 'Cumplimiento de sesiones',
            descripcion: 'Comparación entre ejecución real y meta programada por actividad.',
            fuente: 'NProduccion',
            formula: 'Ejecutado / Meta × 100',
            periodicidad: 'Mensual',
            agrupacion: ['Establecimiento', 'Mes']
          },
          {
            id: 'pacientes-unicos',
            nombre: 'Pacientes únicos por establecimiento',
            descripcion: 'Conteo de pacientes distintos por establecimiento.',
            fuente: 'NProduccion + MaestroPaciente',
            formula: 'COUNT(DISTINCT Id_Paciente)',
            periodicidad: 'Flexible',
            agrupacion: ['Establecimiento', 'Mes', 'Año']
          },
          {
            id: 'produccion-por-codigo',
            nombre: 'Producción por código HIS',
            descripcion: 'Cantidad de atenciones y pacientes por código HIS.',
            fuente: 'NProduccion',
            formula: 'COUNT(*) agrupado por codigoHIS',
            periodicidad: 'Flexible',
            agrupacion: ['Código HIS', 'Establecimiento']
          }
        ]
      });
    };

    // Obtiene la actividad histórica y analítica completa de un código HIS (CIE-10 o CPMS)
    const getActividadCodigo = async (req, res) => {
      const codigo = String(req.params.codigo || '').trim();
      if (!codigo) return res.status(400).json({ message: 'Código HIS requerido' });
      try {
        const pool = await poolPromise;
        const request = pool.request();
        request.input('codigo', sql.NVarChar, codigo);

        const query = `
          -- Resuelve el código incluso si desde una tabla agrupada por diagnóstico se envió la descripción.
          DECLARE @resolvedCodigo NVARCHAR(100) = @codigo;
          IF NOT EXISTS (SELECT 1 FROM MAESTRO_HIS_CIE_CPMS WHERE Codigo_Item = @resolvedCodigo)
             AND NOT EXISTS (SELECT 1 FROM NProduccion WHERE Codigo_Item = @resolvedCodigo)
          BEGIN
            SELECT TOP 1 @resolvedCodigo = Codigo_Item
            FROM MAESTRO_HIS_CIE_CPMS
            WHERE Descripcion_Item = @codigo;
          END

          -- 0. Información del código en el catálogo
          SELECT TOP 1
            Codigo_Item as codigo,
            Descripcion_Item as descripcion,
            Descripcion_Tipo_Item as tipoItem,
            Fg_Tipo as fgTipo
          FROM MAESTRO_HIS_CIE_CPMS
          WHERE Codigo_Item = @resolvedCodigo;

          -- 1. Resumen general del código
          SELECT
            COUNT_BIG(*) as totalRegistros,
            COUNT(DISTINCT Id_Cita) as citasUnicas,
            COUNT(DISTINCT Id_Paciente) as pacientesUnicos,
            COUNT(DISTINCT Id_Personal) as personalDistinto,
            COUNT(DISTINCT Id_Establecimiento) as establecimientosDistintos,
            MIN(Fecha_Atencion) as primeraAtencion,
            MAX(Fecha_Atencion) as ultimaAtencion
          FROM NProduccion
          WHERE Codigo_Item = @resolvedCodigo;

          -- 2. Top profesionales que registraron este código
          SELECT TOP 10
            p.Id_Personal as id,
            LTRIM(RTRIM(CONCAT(p.Apellido_Paterno_Personal, ' ', p.Apellido_Materno_Personal, ' ', p.Nombres_Personal))) as nombre,
            p.Numero_Documento_Personal as documento,
            COUNT_BIG(*) as registros,
            COUNT(DISTINCT np.Id_Cita) as atenciones,
            COUNT(DISTINCT np.Id_Paciente) as pacientes
          FROM NProduccion np
          OUTER APPLY (
            SELECT TOP 1 Id_Personal, Apellido_Paterno_Personal, Apellido_Materno_Personal, Nombres_Personal, Numero_Documento_Personal
            FROM MaestroPersonal
            WHERE Id_Personal = np.Id_Personal
          ) p
          WHERE np.Codigo_Item = @resolvedCodigo AND p.Nombres_Personal IS NOT NULL
          GROUP BY p.Id_Personal, p.Apellido_Paterno_Personal, p.Apellido_Materno_Personal, p.Nombres_Personal, p.Numero_Documento_Personal
          ORDER BY registros DESC;

          -- 3. Top establecimientos donde se registró
          SELECT TOP 10
            e.Id_Establecimiento as id,
            e.Nombre_Establecimiento as nombre,
            e.Departamento as departamento,
            e.Provincia as provincia,
            COUNT_BIG(*) as registros,
            COUNT(DISTINCT np.Id_Cita) as atenciones
          FROM NProduccion np
          OUTER APPLY (
            SELECT TOP 1 Id_Establecimiento, Nombre_Establecimiento, Departamento, Provincia
            FROM MAESTRO_HIS_ESTABLECIMIENTO
            WHERE Id_Establecimiento = np.Id_Establecimiento
          ) e
          WHERE np.Codigo_Item = @resolvedCodigo AND e.Nombre_Establecimiento IS NOT NULL
          GROUP BY e.Id_Establecimiento, e.Nombre_Establecimiento, e.Departamento, e.Provincia
          ORDER BY registros DESC;

          -- 4. Tendencia mensual
          SELECT TOP 12
            CONVERT(char(7), Fecha_Atencion, 120) as periodo,
            COUNT_BIG(*) as registros,
            COUNT(DISTINCT Id_Cita) as atenciones,
            COUNT(DISTINCT Id_Paciente) as pacientes
          FROM NProduccion
          WHERE Codigo_Item = @resolvedCodigo
          GROUP BY YEAR(Fecha_Atencion), MONTH(Fecha_Atencion), CONVERT(char(7), Fecha_Atencion, 120)
          ORDER BY YEAR(Fecha_Atencion) DESC, MONTH(Fecha_Atencion) DESC;

          -- 5. Atenciones recientes con este código (hasta 50)
          SELECT TOP 50
            np.Id_Cita as idCita,
            np.Fecha_Atencion as fechaAtencion,
            np.Codigo_Item as codigoItem,
            np.Tipo_Diagnostico as tipoDiagnostico,
            np.Valor_Lab as valorLab,
            np.Edad_Reg as edadRegistro,
            np.Tipo_Edad as tipoEdad,
            np.Id_Paciente as idPaciente,
            mp.Numero_Documento_Paciente as documentoPaciente,
            LTRIM(RTRIM(CONCAT(mp.Apellido_Paterno_Paciente, ' ', mp.Apellido_Materno_Paciente, ' ', mp.Nombres_Paciente))) as nombrePaciente,
            LTRIM(RTRIM(CONCAT(p.Apellido_Paterno_Personal, ' ', p.Apellido_Materno_Personal, ' ', p.Nombres_Personal))) as nombrePersonal,
            e.Nombre_Establecimiento as nombreEstablecimiento,
            u.Descripcion_Ups as descripcionUps
          FROM NProduccion np
          OUTER APPLY (SELECT TOP 1 Numero_Documento_Paciente, Apellido_Paterno_Paciente, Apellido_Materno_Paciente, Nombres_Paciente FROM MaestroPaciente WHERE Id_Paciente = np.Id_Paciente) mp
          OUTER APPLY (SELECT TOP 1 Apellido_Paterno_Personal, Apellido_Materno_Personal, Nombres_Personal FROM MaestroPersonal WHERE Id_Personal = np.Id_Personal) p
          OUTER APPLY (SELECT TOP 1 Nombre_Establecimiento FROM MAESTRO_HIS_ESTABLECIMIENTO WHERE Id_Establecimiento = np.Id_Establecimiento) e
          OUTER APPLY (SELECT TOP 1 Descripcion_Ups FROM MAESTRO_HIS_UPS WHERE Id_Ups = np.Id_Ups) u
          WHERE np.Codigo_Item = @resolvedCodigo
          ORDER BY np.Fecha_Atencion DESC, np.Num_Reg DESC;
        `;

        const result = await withTransientRetry(() => request.query(query));
        res.status(200).json({
          info: result.recordsets[0][0] || { codigo, descripcion: 'Sin descripción en catálogo' },
          resumen: result.recordsets[1][0] || {},
          profesionales: result.recordsets[2] || [],
          establecimientos: result.recordsets[3] || [],
          porMes: (result.recordsets[4] || []).reverse(),
          atenciones: result.recordsets[5] || []
        });
      } catch (error) {
        console.error('Error in getActividadCodigo:', error);
        const transient = ['ESOCKET', 'ECONNRESET', 'ETIMEOUT', 'ENOTOPEN'].includes(error.code);
        res.status(transient ? 503 : 500).json({
          message: transient ? 'La conexión con la base de datos se interrumpió.' : 'No se pudo obtener la actividad del código.',
          code: error.code || 'CODE_ACTIVITY_ERROR'
        });
      }
    };

    // Obtiene las atenciones y citas individuales para una fila o filtro agrupado de la consulta
    const getDetalleAtenciones = async (req, res) => {
      try {
        const { rowFilter = {}, period = {}, limit = 100 } = req.body || {};
        const startDate = period.start || req.body?.fechaInicio || null;
        const endDate = period.end || req.body?.fechaFin || null;

        if (startDate && !isValidISODate(startDate)) {
          return res.status(400).json({ message: 'La fecha de inicio del periodo no es válida.' });
        }
        if (endDate && !isValidISODate(endDate)) {
          return res.status(400).json({ message: 'La fecha de fin del periodo no es válida.' });
        }

        const pool = await poolPromise;
        const request = pool.request();
        const whereClauses = ['1=1'];

        if (startDate) {
          whereClauses.push('np.Fecha_Atencion >= @startDate');
          request.input('startDate', sql.Date, startDate);
        }
        if (endDate) {
          whereClauses.push('np.Fecha_Atencion < DATEADD(DAY, 1, @endDate)');
          request.input('endDate', sql.Date, endDate);
        }

        if (rowFilter.idPaciente) {
          whereClauses.push('np.Id_Paciente = @rowIdPaciente');
          request.input('rowIdPaciente', sql.NVarChar, String(rowFilter.idPaciente));
        }
        if (rowFilter.documento) {
          whereClauses.push('mp.Numero_Documento_Paciente = @rowDocumento');
          request.input('rowDocumento', sql.NVarChar, String(rowFilter.documento));
        }
        if (rowFilter.nombrePaciente) {
          whereClauses.push("LTRIM(RTRIM(CONCAT(mp.Apellido_Paterno_Paciente, ' ', mp.Apellido_Materno_Paciente, ' ', mp.Nombres_Paciente))) LIKE @rowNombrePaciente");
          request.input('rowNombrePaciente', sql.NVarChar, `%${String(rowFilter.nombrePaciente).trim()}%`);
        }
        if (rowFilter.codigoHIS) {
          whereClauses.push('np.Codigo_Item = @rowCodigoHIS');
          request.input('rowCodigoHIS', sql.NVarChar, String(rowFilter.codigoHIS));
        }
        if (rowFilter.diagnostico) {
          whereClauses.push('c.Descripcion_Item = @rowDiagnostico');
          request.input('rowDiagnostico', sql.NVarChar, String(rowFilter.diagnostico));
        }
        if (rowFilter.establecimiento) {
          whereClauses.push('e.Nombre_Establecimiento = @rowEstablecimiento');
          request.input('rowEstablecimiento', sql.NVarChar, String(rowFilter.establecimiento));
        }
        if (rowFilter.departamento) {
          whereClauses.push('e.Departamento = @rowDepartamento');
          request.input('rowDepartamento', sql.NVarChar, String(rowFilter.departamento));
        }
        if (rowFilter.provincia) {
          whereClauses.push('e.Provincia = @rowProvincia');
          request.input('rowProvincia', sql.NVarChar, String(rowFilter.provincia));
        }
        if (rowFilter.profesional) {
          whereClauses.push('(p.Nombre_Completo_Personal = @rowProfesional OR p.Nombres_Personal = @rowProfesional)');
          request.input('rowProfesional', sql.NVarChar, String(rowFilter.profesional));
        }
        if (rowFilter.ups) {
          whereClauses.push('u.Descripcion_Ups = @rowUps');
          request.input('rowUps', sql.NVarChar, String(rowFilter.ups));
        }
        if (rowFilter.financiador) {
          whereClauses.push('f.Descripcion_Financiador = @rowFinanciador');
          request.input('rowFinanciador', sql.NVarChar, String(rowFilter.financiador));
        }
        if (rowFilter.sexo) {
          whereClauses.push('mp.Id_Genero = @rowSexo');
          request.input('rowSexo', sql.NVarChar, String(rowFilter.sexo));
        }
        if (rowFilter.historiaClinica) {
          whereClauses.push('mp.Historia_Clinica = @rowHistoriaClinica');
          request.input('rowHistoriaClinica', sql.NVarChar, String(rowFilter.historiaClinica));
        }
        if (rowFilter.mes) {
          whereClauses.push('CONVERT(char(7), np.Fecha_Atencion, 120) = @rowMes');
          request.input('rowMes', sql.NVarChar, String(rowFilter.mes));
        }
        if (rowFilter.dia && isValidISODate(String(rowFilter.dia).slice(0, 10))) {
          whereClauses.push('CONVERT(date, np.Fecha_Atencion) = @rowDia');
          request.input('rowDia', sql.Date, String(rowFilter.dia).slice(0, 10));
        }
        if (rowFilter.año && Number.isFinite(Number(rowFilter.año))) {
          whereClauses.push('YEAR(np.Fecha_Atencion) = @rowAnio');
          request.input('rowAnio', sql.Int, Number(rowFilter.año));
        }
        if (rowFilter.tipoDiagnostico) {
          whereClauses.push('np.Tipo_Diagnostico = @rowTipoDx');
          request.input('rowTipoDx', sql.NVarChar, String(rowFilter.tipoDiagnostico));
        }

        const maxLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);

        const query = `
          SELECT TOP (${maxLimit})
            np.Id_Cita as idCita,
            np.Num_Reg as numeroRegistro,
            np.Id_Correlativo_Item as correlativo,
            np.Fecha_Atencion as fechaAtencion,
            np.Codigo_Item as codigoItem,
            c.Descripcion_Item as descripcionItem,
            c.Descripcion_Tipo_Item as descripcionTipoItem,
            np.Tipo_Diagnostico as tipoDiagnostico,
            np.Valor_Lab as valorLab,
            np.Edad_Reg as edadRegistro,
            np.Tipo_Edad as tipoEdad,
            np.Peso as peso,
            np.Talla as talla,
            np.Hemoglobina as hemoglobina,
            np.Id_Paciente as idPaciente,
            mp.Numero_Documento_Paciente as documentoPaciente,
            LTRIM(RTRIM(CONCAT(mp.Apellido_Paterno_Paciente, ' ', mp.Apellido_Materno_Paciente, ' ', mp.Nombres_Paciente))) as nombrePaciente,
            p.Nombre_Completo_Personal as nombrePersonal,
            e.Nombre_Establecimiento as nombreEstablecimiento,
            u.Descripcion_Ups as descripcionUps,
            f.Descripcion_Financiador as financiador
          FROM NProduccion np
          OUTER APPLY (
            SELECT TOP (1) catalogo.Descripcion_Item, catalogo.Descripcion_Tipo_Item
            FROM MAESTRO_HIS_CIE_CPMS catalogo
            WHERE catalogo.Codigo_Item = np.Codigo_Item
            ORDER BY CASE WHEN NULLIF(LTRIM(RTRIM(catalogo.Descripcion_Item)), '') IS NULL THEN 1 ELSE 0 END, catalogo.Descripcion_Item
          ) c
          OUTER APPLY (
            SELECT TOP (1) catalogo.Numero_Documento_Paciente, catalogo.Apellido_Paterno_Paciente, catalogo.Apellido_Materno_Paciente, catalogo.Nombres_Paciente, catalogo.Id_Genero, catalogo.Historia_Clinica
            FROM MaestroPaciente catalogo
            WHERE catalogo.Id_Paciente = np.Id_Paciente
          ) mp
          OUTER APPLY (
            SELECT TOP (1)
              LTRIM(RTRIM(CONCAT(catalogo.Apellido_Paterno_Personal, ' ', catalogo.Apellido_Materno_Personal, ' ', catalogo.Nombres_Personal))) AS Nombre_Completo_Personal,
              catalogo.Nombres_Personal
            FROM MaestroPersonal catalogo
            WHERE catalogo.Id_Personal = np.Id_Personal
            ORDER BY CASE WHEN NULLIF(LTRIM(RTRIM(catalogo.Nombres_Personal)), '') IS NULL THEN 1 ELSE 0 END, catalogo.Apellido_Paterno_Personal, catalogo.Nombres_Personal
          ) p
          OUTER APPLY (
            SELECT TOP (1) catalogo.Nombre_Establecimiento, catalogo.Departamento, catalogo.Provincia
            FROM MAESTRO_HIS_ESTABLECIMIENTO catalogo
            WHERE catalogo.Id_Establecimiento = np.Id_Establecimiento
            ORDER BY CASE WHEN NULLIF(LTRIM(RTRIM(catalogo.Nombre_Establecimiento)), '') IS NULL THEN 1 ELSE 0 END, catalogo.Nombre_Establecimiento
          ) e
          OUTER APPLY (
            SELECT TOP (1) catalogo.Descripcion_Ups
            FROM MAESTRO_HIS_UPS catalogo
            WHERE catalogo.Id_Ups = np.Id_Ups
            ORDER BY CASE WHEN NULLIF(LTRIM(RTRIM(catalogo.Descripcion_Ups)), '') IS NULL THEN 1 ELSE 0 END, catalogo.Descripcion_Ups
          ) u
          OUTER APPLY (
            SELECT TOP (1) catalogo.Descripcion_Financiador
            FROM MAESTRO_HIS_FINANCIADOR catalogo
            WHERE catalogo.Id_Financiador = np.Id_Financiador
            ORDER BY CASE WHEN NULLIF(LTRIM(RTRIM(catalogo.Descripcion_Financiador)), '') IS NULL THEN 1 ELSE 0 END, catalogo.Descripcion_Financiador
          ) f
          WHERE ${whereClauses.join(' AND ')}
          ORDER BY np.Fecha_Atencion DESC, np.Num_Reg DESC, np.Id_Correlativo_Item;
        `;

        const result = await withTransientRetry(() => request.query(query));
        res.status(200).json({
          atenciones: result.recordset || [],
          total: result.recordset?.length || 0
        });
      } catch (error) {
        console.error('Error in getDetalleAtenciones:', error);
        const transient = ['ESOCKET', 'ECONNRESET', 'ETIMEOUT', 'ENOTOPEN'].includes(error.code);
        res.status(transient ? 503 : 500).json({
          message: transient ? 'La conexión con la base de datos se interrumpió.' : 'No se pudo obtener el detalle de atenciones.',
          code: error.code || 'ATENCIONES_DETAIL_ERROR'
        });
      }
    };

    module.exports = {
      executeGenericQuery,
      getDashboardResumen,
      getQueryMetadata,
      getIndicadores,
      getActividadCodigo,
      getDetalleAtenciones,
      buildQuery,
      FIELD_DEFS,
      GROUP_BY_DEFS,
      MEASURE_DEFS,
      OPERATOR_MAP
    };
