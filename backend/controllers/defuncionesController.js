// Búsqueda avanzada de defunciones (V_SINADEF_AYACUCHO_DOMFALLECIDO) con filtros combinables.
// Solo lectura. Los valores llegan como parámetros y solo se filtra por columnas que existen en la vista.
const { sql, poolPromise, withTransientRetry } = require('../config/db');
const cache = require('../config/cache');

const VISTA = 'V_SINADEF_AYACUCHO_DOMFALLECIDO';
const MAX_TEXTO = 100;
const TAMANOS_PAGINA = [50, 100, 200];
const MAX_EXPORTAR = 5000;
const TTL_OPCIONES = 600; // 10 minutos
const MAX_VALORES_LISTA = 120;

// Listas desplegables: clave del filtro → columna de la vista.
const LISTAS = {
  provincia: 'PROVINCIA',
  distrito: 'DISTRITO',
  tipoLugar: 'TIPO_LUGAR',
  institucion: 'INSTITUCION',
  seguro: 'TIPO_SEGURO',
  estadoCivil: 'ESTADO_CIVIL',
  instruccion: 'NIVEL_DE_INSTRUCCION'
};
const ETIQUETAS = {
  provincia: 'Provincia', distrito: 'Distrito', tipoLugar: 'Tipo de lugar', institucion: 'Institución',
  seguro: 'Seguro', estadoCivil: 'Estado civil', instruccion: 'Nivel de instrucción'
};
const CAUSAS = ['A', 'B', 'C', 'D', 'E', 'F'];
const EDAD_ANIOS = "TRY_CONVERT(int, EDAD)";
// Sin unidad o en años: la edad en meses o días cuenta como menor de 1 año.
const EN_ANIOS = "(NULLIF(LTRIM(RTRIM(TIEMPO_EDAD)), '') IS NULL OR UPPER(LTRIM(TIEMPO_EDAD)) LIKE 'A%')";
const EDAD = `CASE WHEN ${EN_ANIOS} THEN ${EDAD_ANIOS} ELSE 0 END`;
// Código CIE de la causa A sin los marcadores de «sin dato»; en el resumen solo se muestra si la causa tiene un único código.
const CIE_A = "NULLIF(NULLIF(LTRIM(RTRIM(CAUSA_A_CIEX)), ''), 'SIN REGISTRO')";
const ES_SI = "UPPER(LTRIM(RTRIM(ISNULL(MUERTE_VIOLENTA, '')))) IN ('SI', 'SÍ', 'S', '1', 'TRUE')";

async function columnas(pool) {
  const enCache = cache.get('defunciones:cols');
  if (enCache) return enCache;
  const result = await withTransientRetry(() => pool.request()
    .input('t', sql.NVarChar(200), `dbo.${VISTA}`)
    .query('SELECT c.name FROM sys.columns c WHERE c.object_id = OBJECT_ID(@t)'));
  const nombres = new Set(result.recordset.map(r => String(r.name).toUpperCase()));
  cache.set('defunciones:cols', nombres, 3600);
  return nombres;
}

class FiltroError extends Error {}

const texto = (valor, etiqueta) => {
  const v = typeof valor === 'string' ? valor.trim() : '';
  if (v.length > MAX_TEXTO) throw new FiltroError(`«${etiqueta}» admite hasta ${MAX_TEXTO} caracteres.`);
  return v;
};
const entero = (valor, etiqueta, min, max) => {
  if (valor === undefined || valor === null || valor === '') return null;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < min || n > max) throw new FiltroError(`«${etiqueta}» debe ser un número entre ${min} y ${max}.`);
  return n;
};
const esFecha = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

// Arma el WHERE y los parámetros. Devuelve también los filtros aplicados para mostrarlos o exportarlos.
function armarFiltros(query, cols) {
  const condiciones = [];
  const params = [];
  const aplicados = [];
  let i = 0;
  const p = (tipo, valor) => { const par = { nombre: `f${i++}`, tipo, valor }; params.push(par); return `@${par.nombre}`; };
  const add = (cond, etiqueta, mostrado) => { condiciones.push(cond); aplicados.push([etiqueta, mostrado]); };
  const tiene = col => cols.has(col);

  const anio = entero(query.anio, 'Año', 1990, 2100);
  if (anio !== null) add(`YEAR(FECHA) = ${p(sql.Int, anio)}`, 'Año', String(anio));
  const meses = query.meses ? [...new Set(String(query.meses).split(',').map(s => entero(s.trim(), 'Mes', 1, 12)).filter(m => m !== null))] : [];
  if (meses.length) add(`MONTH(FECHA) IN (${meses.join(',')})`, 'Mes', meses.join(', '));
  const desde = texto(query.desde, 'Desde');
  const hasta = texto(query.hasta, 'Hasta');
  if ((desde && !esFecha(desde)) || (hasta && !esFecha(hasta))) throw new FiltroError('Las fechas deben tener el formato AAAA-MM-DD.');
  if (desde && hasta && desde > hasta) throw new FiltroError('La fecha «Desde» no puede ser posterior a «Hasta».');
  if (desde) add(`FECHA >= ${p(sql.Date, desde)}`, 'Desde', desde.split('-').reverse().join('/'));
  if (hasta) add(`FECHA < DATEADD(day, 1, ${p(sql.Date, hasta)})`, 'Hasta', hasta.split('-').reverse().join('/'));

  const persona = texto(query.persona, 'Persona');
  if (persona) {
    const exacto = p(sql.NVarChar(MAX_TEXTO), persona);
    const inicio = p(sql.NVarChar(MAX_TEXTO + 1), `${persona}%`);
    const terminos = persona.split(/\s+/).filter(Boolean).slice(0, 6)
      .map(t => p(sql.NVarChar(MAX_TEXTO + 2), `%${t}%`))
      .map(par => `(NOMBRES LIKE ${par} OR PRIMER_APELLIDO LIKE ${par} OR SEGUNDO_APELLIDO LIKE ${par})`);
    add(`(DOCUMENTO LIKE ${inicio} OR CDEF = ${exacto} OR (${terminos.join(' AND ')}))`, 'Persona', persona);
  }

  const sexo = texto(query.sexo, 'Sexo').toUpperCase();
  if (sexo === 'F' || sexo === 'M') add(`UPPER(LTRIM(SEXO)) LIKE ${p(sql.NVarChar(2), `${sexo}%`)}`, 'Sexo', sexo === 'F' ? 'Femenino' : 'Masculino');
  else if (sexo) throw new FiltroError('Sexo no válido.');

  const edadMin = entero(query.edadMin, 'Edad desde', 0, 130);
  const edadMax = entero(query.edadMax, 'Edad hasta', 0, 130);
  if (edadMin !== null && edadMax !== null && edadMin > edadMax) throw new FiltroError('«Edad desde» no puede ser mayor que «Edad hasta».');
  if (edadMin !== null) add(`${EDAD} >= ${p(sql.Int, edadMin)}`, 'Edad desde', `${edadMin} años`);
  if (edadMax !== null) add(`${EDAD} <= ${p(sql.Int, edadMax)}`, 'Edad hasta', `${edadMax} años`);

  for (const [clave, col] of Object.entries(LISTAS)) {
    const v = texto(query[clave], ETIQUETAS[clave]);
    if (v && tiene(col)) add(`LTRIM(RTRIM(${col})) = ${p(sql.NVarChar(MAX_TEXTO), v)}`, ETIQUETAS[clave], v);
  }

  // CIE-10: por prefijo, en la causa A o en cualquier causa de la cadena.
  const cie = texto(query.cie, 'CIE-10').toUpperCase();
  const soloA = query.soloCausaA === '1';
  const columnasCie = (soloA ? ['A'] : CAUSAS).map(l => `CAUSA_${l}_CIEX`).filter(tiene);
  if (cie && columnasCie.length) {
    const par = p(sql.NVarChar(MAX_TEXTO + 1), `${cie.replace(/[.\s]/g, '')}%`);
    add(`(${columnasCie.map(c => `REPLACE(${c}, '.', '') LIKE ${par}`).join(' OR ')})`, soloA ? 'CIE-10 (causa A)' : 'CIE-10', cie);
  }
  const causa = texto(query.causa, 'Causa');
  const columnasCausa = (soloA ? ['A'] : CAUSAS).map(l => `DEBIDO_CAUSA_${l}`).filter(tiene);
  if (causa && columnasCausa.length) {
    const par = p(sql.NVarChar(MAX_TEXTO + 2), `%${causa}%`);
    add(`(${columnasCausa.map(c => `${c} LIKE ${par}`).join(' OR ')})`, soloA ? 'Causa A' : 'Causa', causa);
  }

  const violenta = texto(query.violenta, 'Muerte violenta');
  if (violenta && tiene('MUERTE_VIOLENTA')) {
    if (violenta === 'si') add(ES_SI, 'Muerte violenta', 'Sí');
    else if (violenta === 'no') add(`NOT (${ES_SI})`, 'Muerte violenta', 'No');
    else throw new FiltroError('Valor de «Muerte violenta» no válido.');
  }

  return { where: condiciones.length ? `WHERE ${condiciones.join('\n    AND ')}` : '', params, aplicados };
}

const conParams = (request, params) => { params.forEach(par => request.input(par.nombre, par.tipo, par.valor)); return request; };

// GET /api/busqueda/defunciones/avanzada?filtros…&pagina=1&tam=100   |   &exportar=1 (hasta 5000 filas)
async function buscar(req, res) {
  try {
    const pool = await poolPromise;
    const cols = await columnas(pool);
    let filtros;
    try {
      filtros = armarFiltros(req.query, cols);
    } catch (error) {
      if (error instanceof FiltroError) return res.status(400).json({ message: error.message });
      throw error;
    }
    if (!filtros.where) return res.status(400).json({ message: 'Elige al menos un filtro (por ejemplo el año o el mes) antes de buscar.' });

    const exportar = req.query.exportar === '1';
    const tam = exportar ? MAX_EXPORTAR : (TAMANOS_PAGINA.includes(Number(req.query.tam)) ? Number(req.query.tam) : 100);
    const pagina = exportar ? 1 : Math.max(1, Math.min(100000, Number.parseInt(req.query.pagina, 10) || 1));
    const filas = await withTransientRetry(() => conParams(pool.request(), filtros.params).query(`
      SELECT * FROM ${VISTA}
      ${filtros.where}
      ORDER BY FECHA DESC
      OFFSET ${(pagina - 1) * tam} ROWS FETCH NEXT ${tam} ROWS ONLY`));

    let resumen = null;
    if (!exportar) {
      // Resumen sobre todos los registros que cumplen los filtros (no solo la página).
      const causaA = cols.has('DEBIDO_CAUSA_A');
      const result = await withTransientRetry(() => conParams(pool.request(), filtros.params).query(`
        SELECT COUNT_BIG(*) AS total,
               SUM(CASE WHEN UPPER(LTRIM(SEXO)) LIKE 'F%' THEN 1 ELSE 0 END) AS mujeres,
               SUM(CASE WHEN UPPER(LTRIM(SEXO)) LIKE 'M%' THEN 1 ELSE 0 END) AS hombres,
               AVG(CASE WHEN ${EN_ANIOS} AND ${EDAD_ANIOS} >= 0 THEN CAST(${EDAD_ANIOS} AS float) END) AS edadPromedio
        FROM ${VISTA} ${filtros.where};
        ${causaA ? `SELECT TOP (1) LTRIM(RTRIM(DEBIDO_CAUSA_A)) AS descripcion, ${cols.has('CAUSA_A_CIEX') ? `CASE WHEN MIN(${CIE_A}) = MAX(${CIE_A}) THEN MAX(${CIE_A}) END` : 'CAST(NULL AS nvarchar(20))'} AS cie, COUNT_BIG(*) AS casos
        FROM ${VISTA} ${filtros.where} ${filtros.where ? 'AND' : 'WHERE'} NULLIF(LTRIM(RTRIM(DEBIDO_CAUSA_A)), '') IS NOT NULL
        GROUP BY LTRIM(RTRIM(DEBIDO_CAUSA_A)) ORDER BY casos DESC;` : ''}`));
      const fila = result.recordsets[0][0] || {};
      const top = causaA ? result.recordsets[1][0] : null;
      resumen = {
        total: Number(fila.total || 0),
        mujeres: Number(fila.mujeres || 0),
        hombres: Number(fila.hombres || 0),
        edadPromedio: fila.edadPromedio === null || fila.edadPromedio === undefined ? null : Math.round(fila.edadPromedio),
        causa: top ? { descripcion: top.descripcion, cie: top.cie, casos: Number(top.casos) } : null
      };
    }
    res.status(200).json({ pagina, tam, total: resumen?.total ?? null, resumen, filtros: filtros.aplicados, filas: filas.recordset, limiteExportar: exportar ? MAX_EXPORTAR : undefined });
  } catch (error) {
    console.error('Error en la búsqueda avanzada de defunciones:', error);
    if (error?.number === 208) return res.status(404).json({ message: 'La base de datos no tiene la vista del SINADEF.' });
    if (error?.code === 'ETIMEOUT') return res.status(504).json({ message: 'La búsqueda tardó demasiado. Acota los filtros.' });
    res.status(500).json({ message: 'No se pudo realizar la búsqueda de defunciones.' });
  }
}

// GET /api/busqueda/defunciones/sugerencias?q= : hasta 10 personas para la lista que aparece mientras se escribe
// (DNI o certificado que empiezan con lo escrito, o todas las palabras en los nombres), de la más reciente a la más antigua.
async function sugerencias(req, res) {
  let q;
  try { q = texto(req.query.q, 'Persona'); } catch (error) { return res.status(400).json({ message: error.message }); }
  if (q.length < 2) return res.status(200).json([]);
  try {
    const pool = await poolPromise;
    const terminos = q.split(/\s+/).filter(Boolean).slice(0, 6);
    const porNombre = terminos.map((_, i) => `(NOMBRES LIKE @t${i} OR PRIMER_APELLIDO LIKE @t${i} OR SEGUNDO_APELLIDO LIKE @t${i})`).join(' AND ');
    const result = await withTransientRetry(() => {
      const request = pool.request().input('inicio', sql.NVarChar(MAX_TEXTO + 1), `${q}%`);
      terminos.forEach((t, i) => request.input(`t${i}`, sql.NVarChar(MAX_TEXTO + 2), `%${t}%`));
      return request.query(`
        SELECT TOP (10) DOCUMENTO, CDEF, NOMBRES, PRIMER_APELLIDO, SEGUNDO_APELLIDO, SEXO, EDAD, TIEMPO_EDAD, FECHA
        FROM ${VISTA}
        WHERE DOCUMENTO LIKE @inicio OR CDEF LIKE @inicio OR (${porNombre})
        ORDER BY FECHA DESC`);
    });
    res.status(200).json(result.recordset);
  } catch (error) {
    console.error('Error en las sugerencias de defunciones:', error);
    if (error?.number === 208) return res.status(404).json({ message: 'La base de datos no tiene la vista del SINADEF.' });
    res.status(500).json({ message: 'No se pudieron cargar las sugerencias.' });
  }
}

// GET /api/busqueda/defunciones/opciones : años y valores de las listas (en caché 10 min).
async function opciones(req, res) {
  const enCache = cache.get('defunciones:opciones');
  if (enCache) return res.status(200).json(enCache);
  try {
    const pool = await poolPromise;
    const cols = await columnas(pool);
    const listas = Object.entries(LISTAS).filter(([, col]) => cols.has(col));
    const conjuntos = ['(YEAR(FECHA))', ...listas.map(([, col]) => `(LTRIM(RTRIM(${col})))`)];
    const result = await withTransientRetry(() => pool.request().query(`
      SELECT YEAR(FECHA) AS Anio, ${listas.map(([clave, col]) => `LTRIM(RTRIM(${col})) AS [${clave}], `).join('')}COUNT_BIG(*) AS total
      FROM ${VISTA}
      GROUP BY GROUPING SETS (${conjuntos.join(', ')});
      ${cols.has('PROVINCIA') && cols.has('DISTRITO') ? `SELECT DISTINCT LTRIM(RTRIM(PROVINCIA)) AS provincia, LTRIM(RTRIM(DISTRITO)) AS distrito FROM ${VISTA}
        WHERE NULLIF(LTRIM(RTRIM(DISTRITO)), '') IS NOT NULL;` : ''}`));
    const [agrupado, pares = []] = result.recordsets;
    const claves = ['Anio', ...listas.map(([clave]) => clave)];
    const valores = Object.fromEntries(claves.map(c => [c, []]));
    agrupado.forEach(fila => {
      const clave = claves.find(c => fila[c] !== null && fila[c] !== undefined && String(fila[c]).trim() !== '');
      if (clave) valores[clave].push({ valor: String(fila[clave]).trim(), total: Number(fila.total) });
    });
    const lista = clave => valores[clave].sort((a, b) => b.total - a.total).slice(0, MAX_VALORES_LISTA).map(v => v.valor)
      .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
    const payload = {
      anios: valores.Anio.map(v => Number(v.valor)).sort((a, b) => b - a),
      listas: Object.fromEntries(listas.map(([clave]) => [clave, lista(clave)])),
      distritos: pares.map(r => ({ provincia: r.provincia, distrito: r.distrito }))
        .sort((a, b) => String(a.distrito).localeCompare(String(b.distrito), 'es')),
      causas: CAUSAS.some(l => cols.has(`CAUSA_${l}_CIEX`)),
      violenta: cols.has('MUERTE_VIOLENTA')
    };
    cache.set('defunciones:opciones', payload, TTL_OPCIONES);
    res.status(200).json(payload);
  } catch (error) {
    console.error('Error al leer las opciones de defunciones:', error);
    res.status(500).json({ message: 'No se pudieron cargar las listas de filtros.' });
  }
}

module.exports = { buscar, opciones, sugerencias, armarFiltros };
