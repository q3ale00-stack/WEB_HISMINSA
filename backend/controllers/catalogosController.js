// Catálogos (tablas maestras) del HIS: lista de catálogos con su número de registros y consulta de cada uno.
// Solo se consultan las tablas de la lista blanca; el nombre de una tabla nunca se toma tal cual del usuario.
const { sql, poolPromise, withTransientRetry } = require('../config/db');

const MAX_FILAS = 500;
const MAX_TEXTO = 100;

// Tabla → título y descripción, en el orden en que se muestran.
const CATALOGOS = [
  ['MAESTRO_HIS_CIE_CPMS', 'Diagnósticos y procedimientos', 'Códigos CIE-10 y CPMS con su descripción, tipo y estado'],
  ['MAESTRO_HIS_ESTABLECIMIENTO', 'Establecimientos', 'Código, nombre, DISA, red, microred, ubicación y categoría'],
  ['MAESTRO_HIS_UPS', 'Servicios / UPS', 'Código de la UPS y su descripción'],
  ['MAESTRO_HIS_LAB', 'Laboratorio', 'Código, valor y descripción de los resultados LAB'],
  ['MAESTRO_HIS_GRUPORIESGO_LAB', 'Grupos de riesgo', 'Grupo, laboratorio y valor'],
  ['MAESTRO_HIS_ACTIVIDAD_HIS', 'Actividades HIS', 'Actividad y estado'],
  ['MAESTRO_HIS_DOSIS', 'Dosis', 'Código y descripción'],
  ['MAESTRO_HIS_FINANCIADOR', 'Financiadores', 'Código y descripción'],
  ['MAESTRO_HIS_PROFESION', 'Profesiones', 'Profesión y colegio'],
  ['MAESTRO_HIS_COLEGIO', 'Colegios profesionales', 'Descripción del colegio'],
  ['MAESTRO_HIS_CONDICION_CONTRATO', 'Condiciones de contrato', 'Código y descripción'],
  ['MaestroRegistrador', 'Registradores', 'Documento, nombres y fecha de nacimiento'],
  ['MAESTRO_HIS_TIPO_DOC', 'Tipos de documento', 'Código, abreviatura y descripción'],
  ['MAESTRO_HIS_ETNIA', 'Etnias', 'Código y descripción'],
  ['MAESTRO_HIS_OTRA_CONDICION', 'Otras condiciones', 'Código y descripción'],
  ['MAESTRO_HIS_PAIS', 'Países', 'Código y descripción'],
  ['MAESTRO_HIS_UBIGEO_INEI_RENIEC', 'Ubigeos', 'INEI, RENIEC, departamento, provincia y distrito'],
  ['MAESTRO_HIS_CENTRO_POBLADO', 'Centros poblados', 'Código, descripción, ubigeo y altitud'],
  ['MAESTRO_HIS_INSTITUCION_EDUCATIVA', 'Instituciones educativas', 'Código modular, nombre, dirección, nivel y área'],
  ['MAESTRO_HIS_SISTEMA', 'Sistemas', 'Sistema y lote general']
].map(([tabla, titulo, descripcion]) => ({ tabla, titulo, descripcion }));
const POR_TABLA = new Map(CATALOGOS.map(item => [item.tabla.toLowerCase(), item]));

const TEXTO = new Set(['varchar', 'nvarchar', 'char', 'nchar']);
const NUMERO = new Set(['int', 'bigint', 'smallint', 'tinyint', 'decimal', 'numeric']);

// GET /api/catalogos : catálogos disponibles con su número de registros (null si la tabla no existe).
const listarCatalogos = async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await withTransientRetry(() => pool.request().query(`
      SELECT t.name AS tabla, SUM(p.rows) AS registros
      FROM sys.tables t
      JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
      WHERE SCHEMA_NAME(t.schema_id) = 'dbo'
      GROUP BY t.name
    `));
    const conteos = new Map(result.recordset.map(row => [String(row.tabla).toLowerCase(), Number(row.registros)]));
    res.status(200).json(CATALOGOS.map(item => ({
      ...item,
      registros: conteos.has(item.tabla.toLowerCase()) ? conteos.get(item.tabla.toLowerCase()) : null
    })));
  } catch (error) {
    console.error('Error al listar catálogos:', error);
    res.status(500).json({ message: 'No se pudo consultar la lista de catálogos.' });
  }
};

// GET /api/catalogos/:tabla?q= : hasta 500 registros; con q busca en las columnas de texto y numéricas.
const consultarCatalogo = async (req, res) => {
  const catalogo = POR_TABLA.get(String(req.params.tabla || '').toLowerCase());
  if (!catalogo) return res.status(404).json({ message: 'Ese catálogo no está disponible.' });
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q.length > MAX_TEXTO) return res.status(400).json({ message: `La búsqueda admite hasta ${MAX_TEXTO} caracteres.` });

  try {
    const pool = await poolPromise;
    const columnas = await withTransientRetry(() => pool.request()
      .input('tabla', sql.NVarChar(200), `dbo.${catalogo.tabla}`)
      .query(`
        SELECT c.name, TYPE_NAME(c.system_type_id) AS tipo
        FROM sys.columns c
        WHERE c.object_id = OBJECT_ID(@tabla)
        ORDER BY c.column_id
      `));
    if (!columnas.recordset.length) {
      return res.status(404).json({ message: `La tabla ${catalogo.tabla} no existe en la base de datos.` });
    }
    const nombre = col => `[${String(col).replace(/]/g, ']]')}]`;
    const tabla = `dbo.${nombre(catalogo.tabla)}`;

    let where = '';
    if (q) {
      const condiciones = columnas.recordset
        .filter(col => TEXTO.has(String(col.tipo).toLowerCase()) || NUMERO.has(String(col.tipo).toLowerCase()))
        .map(col => (TEXTO.has(String(col.tipo).toLowerCase())
          ? `${nombre(col.name)} LIKE @q`
          : `CONVERT(nvarchar(40), ${nombre(col.name)}) LIKE @q`));
      where = condiciones.length ? `WHERE ${condiciones.join(' OR ')}` : '';
    }
    const orden = nombre(columnas.recordset[0].name);
    const result = await withTransientRetry(() => {
      const request = pool.request();
      if (q) request.input('q', sql.NVarChar(MAX_TEXTO + 2), `%${q}%`);
      return request.query(`
        SELECT TOP (${MAX_FILAS}) * FROM ${tabla} ${where} ORDER BY ${orden};
        SELECT COUNT_BIG(*) AS total FROM ${tabla} ${where};
      `);
    });
    res.status(200).json({
      tabla: catalogo.tabla,
      titulo: catalogo.titulo,
      columnas: columnas.recordset.map(col => col.name),
      total: Number(result.recordsets[1][0].total),
      limite: MAX_FILAS,
      filas: result.recordsets[0]
    });
  } catch (error) {
    console.error(`Error al consultar el catálogo ${catalogo.tabla}:`, error);
    res.status(500).json({ message: `No se pudo consultar el catálogo ${catalogo.titulo}.` });
  }
};

module.exports = { listarCatalogos, consultarCatalogo, CATALOGOS };
