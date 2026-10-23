// Búsqueda nominal del HIS con filtros al estilo del tablero de Power BI (U.E. Red de Salud Huamanga).
// Solo lectura. Todos los valores llegan como parámetros; los nombres de columnas opcionales se comprueban en sys.columns.
const { sql, poolPromise, withTransientRetry } = require('../config/db');
const cache = require('../config/cache');

const MAX_TEXTO = 100;
const TAMANOS_PAGINA = [50, 100, 200];
const MAX_EXPORTAR = 5000;
const TTL_OPCIONES = 600; // 10 minutos
const MAX_VALORES_LISTA = 80;

// Diferencia entre la fecha de atención y la de registro, en días.
const DIF_REGISTRO = 'DATEDIFF(day, CAST(n.Fecha_Atencion AS date), CAST(n.Fecha_Registro AS date))';
const RANGOS_DIF = {
  '0': `${DIF_REGISTRO} <= 0`,
  '1': `${DIF_REGISTRO} = 1`,
  '2-7': `${DIF_REGISTRO} BETWEEN 2 AND 7`,
  '8-30': `${DIF_REGISTRO} BETWEEN 8 AND 30`,
  '31+': `${DIF_REGISTRO} > 30`
};

const nombre = (alias, sufijo) => `NULLIF(LTRIM(RTRIM(CONCAT(LTRIM(RTRIM(${alias}.Apellido_Paterno_${sufijo})), ' ', LTRIM(RTRIM(${alias}.Apellido_Materno_${sufijo})), ' ', LTRIM(RTRIM(${alias}.Nombres_${sufijo}))))), '')`;
const NOMBRE_PACIENTE = nombre('pac', 'Paciente');
const NOMBRE_PERSONAL = nombre('per', 'Personal');
const NOMBRE_REGISTRADOR = nombre('reg', 'Registrador');

// ── Columnas opcionales (se leen una vez y se guardan en caché) ──
async function columnasDe(pool, tabla) {
  const clave = `nominal:cols:${tabla}`;
  const enCache = cache.get(clave);
  if (enCache) return enCache;
  const result = await withTransientRetry(() => pool.request()
    .input('t', sql.NVarChar(200), `dbo.${tabla}`)
    .query('SELECT c.name FROM sys.columns c WHERE c.object_id = OBJECT_ID(@t)'));
  const nombres = result.recordset.map(r => String(r.name));
  cache.set(clave, nombres, 3600);
  return nombres;
}
const buscarCol = (cols, patron) => cols.find(c => patron.test(c)) || null;
const q = nombreCol => `[${String(nombreCol).replace(/]/g, ']]')}]`;

// Descubre los nombres reales de las columnas que cambian entre versiones del HIS.
async function esquema(pool) {
  const enCache = cache.get('nominal:esquema');
  if (enCache) return enCache;
  const [colsReg, colsTd, colsSis] = await Promise.all([
    columnasDe(pool, 'MaestroRegistrador'),
    columnasDe(pool, 'MAESTRO_HIS_TIPO_DOC'),
    columnasDe(pool, 'MAESTRO_HIS_SISTEMA')
  ]);
  const tdId = buscarCol(colsTd, /^Id_Tipo_Doc/i);
  const tdTexto = buscarCol(colsTd, /Abrev/i) || buscarCol(colsTd, /^Descripcion/i);
  const sisId = buscarCol(colsSis, /Aplicacion/i) || buscarCol(colsSis, /^Id_/i);
  const sisTexto = buscarCol(colsSis, /^Descripcion/i) || buscarCol(colsSis, /^(Nombre_)?Sistema$/i);
  const valor = {
    docRegistrador: buscarCol(colsReg, /^Numero_Documento/i),
    tipoDoc: tdId && tdTexto ? { id: tdId, texto: tdTexto } : null,
    sistema: sisId && sisTexto && sisId !== sisTexto ? { id: sisId, texto: sisTexto } : null
  };
  cache.set('nominal:esquema', valor, 3600);
  return valor;
}

function joinsLectura(esq) {
  return `
  LEFT JOIN MaestroPaciente pac ON pac.Id_Paciente = n.Id_Paciente
  LEFT JOIN MaestroPersonal per ON per.Id_Personal = n.Id_Personal
  LEFT JOIN MaestroRegistrador reg ON reg.Id_Registrador = n.Id_Registrador
  OUTER APPLY (SELECT TOP (1) e.Nombre_Establecimiento, e.Disa, e.Red, e.MicroRed FROM MAESTRO_HIS_ESTABLECIMIENTO e WHERE e.Id_Establecimiento = n.Id_Establecimiento) est
  OUTER APPLY (SELECT TOP (1) u.Descripcion_Ups FROM MAESTRO_HIS_UPS u WHERE u.Id_Ups = n.Id_Ups) ups
  OUTER APPLY (SELECT TOP (1) ci.Descripcion_Item FROM MAESTRO_HIS_CIE_CPMS ci WHERE ci.Codigo_Item = n.Codigo_Item
               ORDER BY CASE WHEN NULLIF(LTRIM(RTRIM(ci.Descripcion_Item)), '') IS NULL THEN 1 ELSE 0 END) item
  OUTER APPLY (SELECT TOP (1) pr.Descripcion_Profesion FROM MAESTRO_HIS_PROFESION pr WHERE pr.Id_Profesion = per.Id_Profesion) prof
  ${esq.tipoDoc ? `OUTER APPLY (SELECT TOP (1) td.${q(esq.tipoDoc.texto)} AS Texto FROM MAESTRO_HIS_TIPO_DOC td WHERE td.${q(esq.tipoDoc.id)} = pac.Id_Tipo_Documento_Paciente) tdoc` : ''}
  ${esq.sistema ? `OUTER APPLY (SELECT TOP (1) s.${q(esq.sistema.texto)} AS Texto FROM MAESTRO_HIS_SISTEMA s WHERE CONVERT(nvarchar(50), s.${q(esq.sistema.id)}) = CONVERT(nvarchar(50), n.Id_AplicacionOrigen)) sis` : ''}`;
}

function columnasLectura(esq) {
  return `
    n.Anio, n.Mes, n.Dia, n.Fecha_Atencion, n.Id_Cita, n.Id_Establecimiento,
    est.Nombre_Establecimiento AS Ipress, est.Disa, est.Red, est.MicroRed, n.renipress AS Renipress,
    n.Id_AplicacionOrigen, ${esq.sistema ? 'sis.Texto' : 'CAST(NULL AS nvarchar(100))'} AS Sistema,
    n.Lote, n.Num_Pag, n.Num_Reg, n.Id_Ups, ups.Descripcion_Ups AS ServicioUps,
    n.Id_Paciente, pac.Numero_Documento_Paciente AS Documento, pac.Id_Tipo_Documento_Paciente AS IdTipoDocumento,
    ${esq.tipoDoc ? 'tdoc.Texto' : 'CAST(NULL AS nvarchar(60))'} AS TipoDocumento,
    ${NOMBRE_PACIENTE} AS Paciente, pac.Historia_Clinica,
    n.Edad_Reg, n.Tipo_Edad, n.Anio_Actual_Paciente, n.Mes_Actual_Paciente, n.Dia_Actual_Paciente,
    n.Tipo_Diagnostico, n.Codigo_Item, n.Valor_Lab, item.Descripcion_Item AS DescItem,
    n.Peso, n.Talla, n.Perimetro_Abdominal, n.Hemoglobina, n.Id_Turno,
    n.Id_Personal, per.Numero_Documento_Personal AS DocumentoPersonal, ${NOMBRE_PERSONAL} AS Personal, prof.Descripcion_Profesion AS Profesion,
    n.Id_Registrador, ${esq.docRegistrador ? `reg.${q(esq.docRegistrador)}` : 'CAST(NULL AS nvarchar(30))'} AS DocumentoRegistrador, ${NOMBRE_REGISTRADOR} AS Registrador,
    n.Fecha_Registro, ${DIF_REGISTRO} AS DiasRegistro, n.Fecha_Modificacion,
    n.gruporiesgo_desc AS GrupoRiesgo, n.condicion_gestante AS CondicionGestante`;
}

// ── Lectura de filtros ──
class FiltroError extends Error {}

const texto = (valor, etiqueta) => {
  const v = typeof valor === 'string' ? valor.trim() : '';
  if (v.length > MAX_TEXTO) throw new FiltroError(`«${etiqueta}» admite hasta ${MAX_TEXTO} caracteres.`);
  return v;
};
const entero = (valor, etiqueta, min = 0, max = 2147483647) => {
  if (valor === undefined || valor === null || valor === '') return null;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < min || n > max) throw new FiltroError(`«${etiqueta}» debe ser un número válido.`);
  return n;
};
const listaEnteros = (valor, etiqueta, min, max) => {
  if (!valor) return [];
  const partes = String(valor).split(',').map(s => s.trim()).filter(Boolean);
  if (partes.length > 31) throw new FiltroError(`Demasiados valores en «${etiqueta}».`);
  return [...new Set(partes.map(p => entero(p, etiqueta, min, max)))];
};

// Arma el WHERE y los parámetros a partir de la consulta. Devuelve también la lista de filtros aplicados.
function armarFiltros(query) {
  const condiciones = [];
  const params = [];
  const aplicados = [];
  const add = (cond, etiqueta, mostrado, ...ps) => { condiciones.push(cond); params.push(...ps); aplicados.push([etiqueta, mostrado]); };
  let i = 0;
  const p = (tipo, valor) => ({ nombre: `f${i++}`, tipo, valor });

  // Territorio
  const territorio = [];
  for (const [clave, col, etiqueta] of [['disa', 'Disa', 'DISA'], ['red', 'Red', 'Red'], ['microRed', 'MicroRed', 'MicroRed']]) {
    const v = texto(query[clave], etiqueta);
    if (v) { const par = p(sql.NVarChar(150), v); territorio.push([`e2.${col} = @${par.nombre}`, par, etiqueta, v]); }
  }
  if (territorio.length) {
    condiciones.push(`n.Id_Establecimiento IN (SELECT e2.Id_Establecimiento FROM MAESTRO_HIS_ESTABLECIMIENTO e2 WHERE ${territorio.map(t => t[0]).join(' AND ')})`);
    territorio.forEach(t => { params.push(t[1]); aplicados.push([t[2], t[3]]); });
  }
  const est = entero(query.establecimiento, 'Establecimiento');
  if (est !== null) { const par = p(sql.Int, est); add(`n.Id_Establecimiento = @${par.nombre}`, 'Establecimiento', String(est), par); }

  // Fechas
  const anio = entero(query.anio, 'Año', 1990, 2100);
  if (anio !== null) { const par = p(sql.Int, anio); add(`n.Anio = @${par.nombre}`, 'Año', String(anio), par); }
  const meses = listaEnteros(query.meses, 'Mes', 1, 12);
  if (meses.length) add(`n.Mes IN (${meses.join(',')})`, 'Mes', meses.join(', '));
  const dias = listaEnteros(query.dias, 'Día', 1, 31);
  if (dias.length) add(`n.Dia IN (${dias.join(',')})`, 'Día', dias.join(', '));

  // Paciente
  const paciente = texto(query.paciente, 'Paciente');
  if (paciente) {
    const terminos = paciente.split(/\s+/).filter(Boolean).slice(0, 6);
    const pars = terminos.map(t => p(sql.NVarChar(MAX_TEXTO + 2), `%${t}%`));
    const porNombre = pars.map(par => `CONCAT(pac.Apellido_Paterno_Paciente, ' ', pac.Apellido_Materno_Paciente, ' ', pac.Nombres_Paciente) LIKE @${par.nombre}`).join(' AND ');
    const exacto = p(sql.NVarChar(MAX_TEXTO), paciente);
    add(`n.Id_Paciente IN (SELECT pac2.Id_Paciente FROM MaestroPaciente pac2 WHERE pac2.Numero_Documento_Paciente = @${exacto.nombre} OR pac2.Id_Paciente = @${exacto.nombre} OR (${porNombre.replace(/pac\./g, 'pac2.')}))`,
      'Paciente', paciente, exacto, ...pars);
  }
  for (const [clave, col, etiqueta] of [['idPaciente', 'n.Id_Paciente', 'Id_Paciente'], ['cita', 'n.Id_Cita', 'Id_Cita']]) {
    const v = texto(query[clave], etiqueta);
    if (v) { const par = p(sql.NVarChar(MAX_TEXTO), v); add(`${col} = @${par.nombre}`, etiqueta, v, par); }
  }
  const historia = texto(query.historia, 'Historia clínica');
  if (historia) { const par = p(sql.NVarChar(MAX_TEXTO), historia); add(`n.Id_Paciente IN (SELECT pac3.Id_Paciente FROM MaestroPaciente pac3 WHERE pac3.Historia_Clinica = @${par.nombre})`, 'Historia clínica', historia, par); }

  // Profesional y registrador: id exacto (de las sugerencias) o texto libre (documento o nombre)
  for (const [clave, tabla, alias, sufijo, idCol, docCol, etiqueta] of [
    ['personal', 'MaestroPersonal', 'perf', 'Personal', 'n.Id_Personal', 'Numero_Documento_Personal', 'Personal'],
    ['registrador', 'MaestroRegistrador', 'regf', 'Registrador', 'n.Id_Registrador', null, 'Registrador']
  ]) {
    const id = texto(query[`${clave}Id`], etiqueta);
    const libre = texto(query[clave], etiqueta);
    if (id) { const par = p(sql.NVarChar(MAX_TEXTO), id); add(`${idCol} = @${par.nombre}`, etiqueta, libre || id, par); continue; }
    if (!libre) continue;
    const terminos = libre.split(/\s+/).filter(Boolean).slice(0, 6);
    const pars = terminos.map(t => p(sql.NVarChar(MAX_TEXTO + 2), `%${t}%`));
    const porNombre = pars.map(par => `CONCAT(${alias}.Apellido_Paterno_${sufijo}, ' ', ${alias}.Apellido_Materno_${sufijo}, ' ', ${alias}.Nombres_${sufijo}) LIKE @${par.nombre}`).join(' AND ');
    const exacto = p(sql.NVarChar(MAX_TEXTO), libre);
    const porDoc = docCol ? ` OR ${alias}.${docCol} = @${exacto.nombre}` : '';
    add(`${idCol} IN (SELECT ${alias}.Id_${sufijo} FROM ${tabla} ${alias} WHERE ${alias}.Id_${sufijo} = @${exacto.nombre}${porDoc} OR (${porNombre}))`, etiqueta, libre, exacto, ...pars);
  }

  const profesion = texto(query.profesion, 'Profesión');
  if (profesion) { const par = p(sql.NVarChar(50), profesion); add(`n.Id_Personal IN (SELECT perp.Id_Personal FROM MaestroPersonal perp WHERE CONVERT(nvarchar(50), perp.Id_Profesion) = @${par.nombre})`, 'Profesión', profesion, par); }

  // Listas cortas (valor exacto)
  for (const [clave, col, etiqueta] of [
    ['grupo', 'n.gruporiesgo_desc', 'Grupo de riesgo'],
    ['gestante', 'n.condicion_gestante', 'Condición gestante'],
    ['ups', 'n.Id_Ups', 'UPS'],
    ['tipoEdad', 'n.Tipo_Edad', 'Tipo de edad'],
    ['td', 'n.Tipo_Diagnostico', 'Tipo de diagnóstico'],
    ['lab', 'n.Valor_Lab', 'Lab'],
    ['turno', 'n.Id_Turno', 'Turno'],
    ['lote', 'n.Lote', 'Lote']
  ]) {
    const v = texto(query[clave], etiqueta);
    if (v) { const par = p(sql.NVarChar(MAX_TEXTO), v); add(`${col} = @${par.nombre}`, etiqueta, v, par); }
  }
  const sistema = texto(query.sistema, 'Sistema');
  if (sistema) { const par = p(sql.NVarChar(50), sistema); add(`CONVERT(nvarchar(50), n.Id_AplicacionOrigen) = @${par.nombre}`, 'Sistema', sistema, par); }
  const tipoDoc = texto(query.tipoDoc, 'Tipo de documento');
  if (tipoDoc) { const par = p(sql.NVarChar(20), tipoDoc); add(`n.Id_Paciente IN (SELECT pac4.Id_Paciente FROM MaestroPaciente pac4 WHERE CONVERT(nvarchar(20), pac4.Id_Tipo_Documento_Paciente) = @${par.nombre})`, 'Tipo de documento', tipoDoc, par); }

  const codigo = texto(query.codigo, 'CIE / CPMS');
  if (codigo) { const par = p(sql.NVarChar(MAX_TEXTO + 1), `${codigo}%`); add(`n.Codigo_Item LIKE @${par.nombre}`, 'CIE / CPMS', codigo, par); }

  for (const [clave, col, etiqueta, max] of [['edad', 'n.Edad_Reg', 'Edad', 150], ['pag', 'n.Num_Pag', 'N.º de página', 100000], ['reg', 'n.Num_Reg', 'N.º de registro', 100000]]) {
    const v = entero(query[clave], etiqueta, 0, max);
    if (v !== null) { const par = p(sql.Int, v); add(`${col} = @${par.nombre}`, etiqueta, String(v), par); }
  }

  const dif = texto(query.difRegistro, 'Atención vs. registro');
  if (dif) {
    if (!RANGOS_DIF[dif]) throw new FiltroError('Rango de «Atención vs. registro» no válido.');
    add(RANGOS_DIF[dif], 'Días entre atención y registro', dif);
  }
  const estado = texto(query.estado, 'Estado del registro');
  if (estado === 'modificado') add('n.Fecha_Modificacion IS NOT NULL', 'Estado del registro', 'Modificado');
  else if (estado === 'original') add('n.Fecha_Modificacion IS NULL', 'Estado del registro', 'Sin modificar');
  else if (estado) throw new FiltroError('Estado de registro no válido.');

  return { where: condiciones.length ? `WHERE ${condiciones.join('\n    AND ')}` : '', params, aplicados };
}

const conParams = (request, params) => { params.forEach(par => request.input(par.nombre, par.tipo, par.valor)); return request; };

// GET /api/nominal?filtros…&pagina=1&tam=100   |   &exportar=1 (hasta 5000 filas, sin total)
async function buscar(req, res) {
  let filtros;
  try {
    filtros = armarFiltros(req.query);
  } catch (error) {
    if (error instanceof FiltroError) return res.status(400).json({ message: error.message });
    throw error;
  }
  if (!filtros.params.length && !filtros.where) {
    return res.status(400).json({ message: 'Elige al menos un filtro (por ejemplo el año o el mes) antes de buscar.' });
  }
  const exportar = req.query.exportar === '1';
  const tam = exportar ? MAX_EXPORTAR : (TAMANOS_PAGINA.includes(Number(req.query.tam)) ? Number(req.query.tam) : 100);
  const pagina = exportar ? 1 : Math.max(1, Math.min(100000, Number.parseInt(req.query.pagina, 10) || 1));

  try {
    const pool = await poolPromise;
    const esq = await esquema(pool);
    const orden = 'n.Fecha_Atencion DESC, n.Id_Cita DESC, n.Codigo_Item';
    const filas = await withTransientRetry(() => conParams(pool.request(), filtros.params).query(`
      SELECT ${columnasLectura(esq)}
      FROM NProduccion n
      ${joinsLectura(esq)}
      ${filtros.where}
      ORDER BY ${orden}
      OFFSET ${(pagina - 1) * tam} ROWS FETCH NEXT ${tam} ROWS ONLY`));
    let total = null;
    let resumen = null;
    if (!exportar) {
      const conteo = await withTransientRetry(() => conParams(pool.request(), filtros.params).query(`
        SELECT COUNT_BIG(*) AS registros
        FROM NProduccion n
        ${filtros.where}`));
      const fila = conteo.recordset[0] || {};
      total = Number(fila.registros || 0);
      resumen = { registros: total };
    }
    res.status(200).json({ pagina, tam, total, resumen, filtros: filtros.aplicados, filas: filas.recordset, limiteExportar: exportar ? MAX_EXPORTAR : undefined });
  } catch (error) {
    console.error('Error en la búsqueda nominal:', error);
    res.status(500).json({ message: 'No se pudo realizar la búsqueda. Intenta con filtros más específicos.' });
  }
}

// GET /api/nominal/opciones : valores de las listas desplegables (una sola lectura de NProduccion, en caché 10 min).
async function opciones(req, res) {
  const enCache = cache.get('nominal:opciones');
  if (enCache) return res.status(200).json(enCache);
  try {
    const pool = await poolPromise;
    const esq = await esquema(pool);
    const result = await withTransientRetry(() => pool.request().query(`
      SELECT n.Anio, n.Id_Establecimiento, n.Id_Ups, n.gruporiesgo_desc, n.condicion_gestante,
             CONVERT(nvarchar(50), n.Id_AplicacionOrigen) AS Sistema, n.Tipo_Edad, n.Tipo_Diagnostico, n.Valor_Lab, n.Id_Turno,
             COUNT_BIG(*) AS total
      FROM NProduccion n
      GROUP BY GROUPING SETS ((n.Anio), (n.Id_Establecimiento), (n.Id_Ups), (n.gruporiesgo_desc), (n.condicion_gestante),
                             (CONVERT(nvarchar(50), n.Id_AplicacionOrigen)), (n.Tipo_Edad), (n.Tipo_Diagnostico), (n.Valor_Lab), (n.Id_Turno));

      SELECT e.Id_Establecimiento AS id, MAX(e.Nombre_Establecimiento) AS nombre, MAX(e.Disa) AS disa, MAX(e.Red) AS red, MAX(e.MicroRed) AS microRed
      FROM MAESTRO_HIS_ESTABLECIMIENTO e
      WHERE e.Id_Establecimiento IN (SELECT DISTINCT n.Id_Establecimiento FROM NProduccion n)
      GROUP BY e.Id_Establecimiento;

      SELECT u.Id_Ups AS id, MAX(u.Descripcion_Ups) AS nombre FROM MAESTRO_HIS_UPS u
      WHERE u.Id_Ups IN (SELECT DISTINCT n.Id_Ups FROM NProduccion n) GROUP BY u.Id_Ups;

      SELECT CONVERT(nvarchar(20), p.Id_Tipo_Documento_Paciente) AS id, COUNT_BIG(*) AS total
      FROM MaestroPaciente p WHERE p.Id_Tipo_Documento_Paciente IS NOT NULL GROUP BY p.Id_Tipo_Documento_Paciente;
      ${esq.tipoDoc ? `SELECT CONVERT(nvarchar(20), td.${q(esq.tipoDoc.id)}) AS id, MAX(td.${q(esq.tipoDoc.texto)}) AS nombre FROM MAESTRO_HIS_TIPO_DOC td GROUP BY td.${q(esq.tipoDoc.id)};` : 'SELECT CAST(NULL AS nvarchar(20)) AS id, CAST(NULL AS nvarchar(60)) AS nombre WHERE 1 = 0;'}
      ${esq.sistema ? `SELECT CONVERT(nvarchar(50), s.${q(esq.sistema.id)}) AS id, MAX(s.${q(esq.sistema.texto)}) AS nombre FROM MAESTRO_HIS_SISTEMA s GROUP BY s.${q(esq.sistema.id)};` : 'SELECT CAST(NULL AS nvarchar(50)) AS id, CAST(NULL AS nvarchar(60)) AS nombre WHERE 1 = 0;'}

      SELECT CONVERT(nvarchar(50), pr.Id_Profesion) AS id, MAX(pr.Descripcion_Profesion) AS nombre FROM MAESTRO_HIS_PROFESION pr
      WHERE pr.Id_Profesion IN (SELECT DISTINCT per.Id_Profesion FROM MaestroPersonal per) GROUP BY pr.Id_Profesion;
    `));
    const [agrupado, establecimientos, ups, tiposDoc, tiposDocNombres, sistemas, profesiones] = result.recordsets;
    // De GROUPING SETS: cada fila trae un solo campo con valor; se cuentan por campo.
    const columnas = ['Anio', 'Id_Establecimiento', 'Id_Ups', 'gruporiesgo_desc', 'condicion_gestante', 'Sistema', 'Tipo_Edad', 'Tipo_Diagnostico', 'Valor_Lab', 'Id_Turno'];
    const valores = Object.fromEntries(columnas.map(c => [c, []]));
    agrupado.forEach(fila => {
      const col = columnas.find(c => fila[c] !== null && fila[c] !== undefined && String(fila[c]).trim() !== '');
      if (col) valores[col].push({ valor: String(fila[col]).trim(), total: Number(fila.total) });
    });
    const lista = (col, max = MAX_VALORES_LISTA) => valores[col].sort((a, b) => b.total - a.total).slice(0, max).map(v => v.valor)
      .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
    const nombresTd = new Map(tiposDocNombres.map(t => [String(t.id), t.nombre]));
    const nombresSis = new Map(sistemas.map(s => [String(s.id), s.nombre]));
    const payload = {
      anios: lista('Anio').map(Number).sort((a, b) => b - a),
      establecimientos: establecimientos.map(e => ({ id: e.id, nombre: e.nombre, disa: e.disa, red: e.red, microRed: e.microRed }))
        .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es')),
      ups: ups.map(u => ({ id: String(u.id), nombre: u.nombre })).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es')),
      profesiones: (profesiones || []).map(pr => ({ id: String(pr.id), nombre: pr.nombre || String(pr.id) }))
        .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es')),
      grupos: lista('gruporiesgo_desc'),
      gestante: lista('condicion_gestante'),
      sistemas: lista('Sistema').map(id => ({ id, nombre: nombresSis.get(id) || id })),
      tiposEdad: lista('Tipo_Edad'),
      tiposDiagnostico: lista('Tipo_Diagnostico'),
      labs: lista('Valor_Lab', 60),
      turnos: lista('Id_Turno'),
      tiposDocumento: tiposDoc.map(t => ({ id: String(t.id), nombre: nombresTd.get(String(t.id)) || String(t.id) }))
        .sort((a, b) => a.id.localeCompare(b.id, 'es', { numeric: true }))
    };
    cache.set('nominal:opciones', payload, TTL_OPCIONES);
    res.status(200).json(payload);
  } catch (error) {
    console.error('Error al leer las opciones de la búsqueda nominal:', error);
    res.status(500).json({ message: 'No se pudieron cargar las listas de filtros.' });
  }
}

// GET /api/nominal/sugerencias?campo=paciente|personal|registrador|codigo|historia&q=
async function sugerencias(req, res) {
  const campo = String(req.query.campo || '');
  let valor;
  try { valor = texto(req.query.q, 'Búsqueda'); } catch (error) { return res.status(400).json({ message: error.message }); }
  if (valor.length < 2) return res.status(200).json([]);
  try {
    const pool = await poolPromise;
    const esq = await esquema(pool);
    const request = pool.request();
    const terminos = valor.split(/\s+/).filter(Boolean).slice(0, 6);
    terminos.forEach((t, i) => request.input(`t${i}`, sql.NVarChar(MAX_TEXTO + 2), `%${t}%`));
    request.input('inicio', sql.NVarChar(MAX_TEXTO + 1), `${valor}%`);
    const porNombre = (alias, sufijo) => terminos.map((_, i) => `CONCAT(${alias}.Apellido_Paterno_${sufijo}, ' ', ${alias}.Apellido_Materno_${sufijo}, ' ', ${alias}.Nombres_${sufijo}) LIKE @t${i}`).join(' AND ');
    let consulta;
    switch (campo) {
      case 'paciente':
        consulta = `SELECT TOP (15) pac.Id_Paciente AS id, pac.Numero_Documento_Paciente AS documento, ${NOMBRE_PACIENTE} AS nombre,
          CONCAT('ID ', pac.Id_Paciente, CASE WHEN NULLIF(LTRIM(RTRIM(pac.Historia_Clinica)), '') IS NOT NULL THEN CONCAT(' · H.C. ', pac.Historia_Clinica) ELSE '' END) AS detalle
          FROM MaestroPaciente pac WHERE pac.Numero_Documento_Paciente LIKE @inicio OR (${porNombre('pac', 'Paciente')}) ORDER BY nombre`;
        break;
      case 'historia':
        consulta = `SELECT TOP (15) pac.Historia_Clinica AS id, pac.Numero_Documento_Paciente AS documento, ${NOMBRE_PACIENTE} AS nombre
          FROM MaestroPaciente pac WHERE pac.Historia_Clinica LIKE @inicio ORDER BY pac.Historia_Clinica`;
        break;
      case 'personal':
        consulta = `SELECT TOP (15) per.Id_Personal AS id, per.Numero_Documento_Personal AS documento, ${NOMBRE_PERSONAL} AS nombre, prof.Descripcion_Profesion AS detalle
          FROM MaestroPersonal per OUTER APPLY (SELECT TOP (1) pr.Descripcion_Profesion FROM MAESTRO_HIS_PROFESION pr WHERE pr.Id_Profesion = per.Id_Profesion) prof
          WHERE per.Numero_Documento_Personal LIKE @inicio OR (${porNombre('per', 'Personal')}) ORDER BY nombre`;
        break;
      case 'registrador':
        consulta = `SELECT TOP (15) reg.Id_Registrador AS id, ${esq.docRegistrador ? `reg.${q(esq.docRegistrador)}` : 'reg.Id_Registrador'} AS documento, ${NOMBRE_REGISTRADOR} AS nombre
          FROM MaestroRegistrador reg WHERE reg.Id_Registrador LIKE @inicio ${esq.docRegistrador ? `OR reg.${q(esq.docRegistrador)} LIKE @inicio` : ''} OR (${porNombre('reg', 'Registrador')}) ORDER BY nombre`;
        break;
      case 'codigo':
        consulta = `SELECT TOP (15) ci.Codigo_Item AS id, ci.Codigo_Item AS documento, MAX(ci.Descripcion_Item) AS nombre
          FROM MAESTRO_HIS_CIE_CPMS ci WHERE ci.Codigo_Item LIKE @inicio OR (${terminos.map((_, i) => `ci.Descripcion_Item LIKE @t${i}`).join(' AND ')})
          GROUP BY ci.Codigo_Item ORDER BY CASE WHEN ci.Codigo_Item LIKE @inicio THEN 0 ELSE 1 END, ci.Codigo_Item`;
        break;
      default:
        return res.status(400).json({ message: 'Campo de sugerencias no válido.' });
    }
    const result = await withTransientRetry(() => request.query(consulta));
    res.status(200).json(result.recordset);
  } catch (error) {
    console.error('Error en las sugerencias de la búsqueda nominal:', error);
    res.status(500).json({ message: 'No se pudieron cargar las sugerencias.' });
  }
}

module.exports = { buscar, opciones, sugerencias, armarFiltros };
