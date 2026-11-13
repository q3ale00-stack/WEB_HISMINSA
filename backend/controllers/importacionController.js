// Importación de maestros y producción nominal HIS desde archivos CSV o Excel (.xlsx).
// Reproduce el script de la Unidad de Estadística (carga_de_datos) sin BULK INSERT ni xp_cmdshell:
// el navegador sube los archivos al servidor Node y este los inserta en SQL Server por la conexión de la aplicación.
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const ExcelJS = require('exceljs');
const { sql, poolPromise } = require('../config/db');
// Al terminar una importación se vacía la caché de reportes para que muestren los datos nuevos.
const cache = require('../config/cache');
const ajustes = require('../config/ajustes');

// Carpeta temporal para los archivos subidos; se vacía al terminar cada importación.
const UPLOAD_DIR = path.resolve(process.env.IMPORT_TMP_DIR || path.join(os.tmpdir(), 'his-minsa-importacion'));
// Tamaño máximo por archivo (MB) y vigencia de un archivo subido que no llegó a importarse.
const MAX_FILE_BYTES = (Number(process.env.IMPORT_MAX_MB) || 2048) * 1024 * 1024;
const UPLOAD_TTL_MS = 6 * 60 * 60 * 1000;
// Filas que se envían a SQL Server en cada lote y tiempo máximo de cada sentencia de importación.
const BATCH_ROWS = 5000;
const IMPORT_REQUEST_TIMEOUT_MS = (Number(process.env.IMPORT_TIMEOUT_MIN) || 60) * 60 * 1000;

// Tablas maestras y su identificador, igual que en los pasos 1, 2 y 3 del script.
const MAESTROS = {
  paciente: { table: 'MaestroPaciente', key: 'Id_Paciente', label: 'Maestro de pacientes' },
  personal: { table: 'MaestroPersonal', key: 'Id_Personal', label: 'Maestro de personal' },
  registrador: { table: 'MaestroRegistrador', key: 'Id_Registrador', label: 'Maestro de registradores' }
};
const NOMINAL_TABLE = 'NProduccion';
const MAESTRO_MODE_LABELS = { actualizar: 'Actualizar y acumular', acumular: 'Acumular', reemplazar: 'Reemplazar' };

const TEXT_TYPES = new Set(['varchar', 'char', 'nvarchar', 'nchar', 'text', 'ntext']);
const DATE_TYPES = new Set(['date', 'datetime', 'datetime2', 'smalldatetime', 'datetimeoffset']);
const SKIPPED_TYPES = new Set(['timestamp', 'rowversion']);

// Error con mensaje apto para mostrarse al usuario.
class ImportError extends Error {}

// Reúne todo lo que informa un error de SQL Server o del controlador, aunque el mensaje principal venga vacío.
const describeSqlError = error => {
  const parts = [
    error?.message,
    error?.originalError?.message,
    error?.info?.message,
    ...(Array.isArray(error?.precedingErrors) ? error.precedingErrors.map(item => item?.message) : []),
    ...(Array.isArray(error?.errors) ? error.errors.map(item => item?.message) : []),
    error?.code ? `código ${error.code}` : null,
    error?.number ? `n.º ${error.number}` : null
  ].filter(Boolean);
  const unique = [...new Set(parts.map(String))];
  return unique.length ? unique.join(' · ') : (error?.name || 'sin detalle');
};

// ═══════════════════════════════════════
//  ARCHIVOS SUBIDOS
// ═══════════════════════════════════════
const uploads = new Map();

const removeUpload = async id => {
  const upload = uploads.get(id);
  uploads.delete(id);
  if (upload) await fsp.rm(upload.path, { force: true }).catch(() => {});
};

// Elimina archivos subidos que nunca se importaron y restos de ejecuciones anteriores del servidor.
const cleanupExpiredUploads = async () => {
  const now = Date.now();
  for (const [id, upload] of uploads) {
    if (!upload.inUse && now - upload.createdAt > UPLOAD_TTL_MS) await removeUpload(id);
  }
  try {
    const known = new Set([...uploads.values()].map(upload => path.basename(upload.path)));
    for (const name of await fsp.readdir(UPLOAD_DIR)) {
      if (known.has(name)) continue;
      const filePath = path.join(UPLOAD_DIR, name);
      const stat = await fsp.stat(filePath).catch(() => null);
      if (stat && now - stat.mtimeMs > UPLOAD_TTL_MS) await fsp.rm(filePath, { force: true }).catch(() => {});
    }
  } catch {
    // La carpeta aún no existe: no hay nada que limpiar.
  }
};

// Recibe un archivo como cuerpo binario (application/octet-stream) y lo guarda en la carpeta temporal.
const uploadFile = async (req, res) => {
  const name = path.basename(typeof req.query.nombre === 'string' ? req.query.nombre : '').slice(0, 200);
  if (/\.xls$/i.test(name)) {
    return res.status(400).json({ message: 'El formato .xls (Excel 97-2003) no es compatible. Ábrelo en Excel y guárdalo como .xlsx.' });
  }
  if (!/\.(csv|txt|xlsx)$/i.test(name)) {
    return res.status(400).json({ message: 'Solo se aceptan archivos .csv, .txt o .xlsx.' });
  }
  const formato = /\.xlsx$/i.test(name) ? 'xlsx' : 'csv';
  const declaredSize = Number(req.headers['content-length']);
  if (Number.isFinite(declaredSize) && declaredSize > MAX_FILE_BYTES) {
    return res.status(413).json({ message: `El archivo supera el máximo permitido de ${Math.round(MAX_FILE_BYTES / 1048576)} MB.` });
  }

  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
  await cleanupExpiredUploads();

  const id = crypto.randomUUID();
  const filePath = path.join(UPLOAD_DIR, `${id}.${formato}`);
  let size = 0;
  const limiter = new Transform({
    transform(chunk, encoding, callback) {
      size += chunk.length;
      if (size > MAX_FILE_BYTES) {
        const error = new ImportError(`El archivo supera el máximo permitido de ${Math.round(MAX_FILE_BYTES / 1048576)} MB.`);
        error.status = 413;
        return callback(error);
      }
      callback(null, chunk);
    }
  });

  try {
    await pipeline(req, limiter, fs.createWriteStream(filePath, { flags: 'wx' }));
  } catch (error) {
    await fsp.rm(filePath, { force: true }).catch(() => {});
    if (error instanceof ImportError) return res.status(error.status || 400).json({ message: error.message });
    console.error('Import upload error:', error);
    return res.status(400).json({ message: 'No se pudo recibir el archivo. Vuelve a intentarlo.' });
  }

  if (size === 0) {
    await fsp.rm(filePath, { force: true }).catch(() => {});
    return res.status(400).json({ message: `El archivo ${name} está vacío.` });
  }

  // Un .xlsx es un ZIP: si no empieza con «PK» no es un Excel válido (por ejemplo, un CSV renombrado).
  if (formato === 'xlsx' && !(await esZip(filePath))) {
    await fsp.rm(filePath, { force: true }).catch(() => {});
    return res.status(400).json({ message: `${name} no es un archivo Excel válido. Ábrelo en Excel y guárdalo de nuevo como .xlsx.` });
  }

  uploads.set(id, { id, name, path: filePath, size, formato, userId: req.user.id, createdAt: Date.now(), inUse: false });
  res.status(201).json({ id, nombre: name, tamano: size });
};

// Descarta un archivo subido que el usuario quitó de la lista antes de importarlo.
const deleteUpload = async (req, res) => {
  const upload = uploads.get(req.params.id);
  if (!upload) return res.status(404).json({ message: 'El archivo ya no está disponible.' });
  if (upload.inUse) return res.status(409).json({ message: 'El archivo se está importando.' });
  await removeUpload(upload.id);
  res.status(200).json({ message: 'Archivo descartado.' });
};

// ═══════════════════════════════════════
//  LECTURA DE CSV
// ═══════════════════════════════════════
// Decide la codificación. En modo automático revisa todo el archivo: si tiene BOM o caracteres
// especiales (tildes, ñ) escritos en UTF-8 válido, usa UTF-8; en cualquier otro caso usa ANSI de Windows,
// que es lo que hacía el script con CODEPAGE = 'ACP'.
const detectEncoding = async (filePath, requested) => {
  if (requested === 'utf8') return 'utf-8';
  if (requested === 'ansi') return 'windows-1252';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let first = true;
  let hasNonAscii = false;
  try {
    for await (const chunk of fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 })) {
      if (first && chunk[0] === 0xef && chunk[1] === 0xbb && chunk[2] === 0xbf) return 'utf-8';
      first = false;
      if (!hasNonAscii && chunk.some(byte => byte > 0x7f)) hasNonAscii = true;
      decoder.decode(chunk, { stream: true });
    }
    decoder.decode();
  } catch {
    return 'windows-1252';
  }
  return hasNonAscii ? 'utf-8' : 'windows-1252';
};

// Recorre el archivo línea por línea sin cargarlo completo en memoria; acepta finales LF y CRLF.
async function* readLines(filePath, encoding, onBytes) {
  const decoder = new TextDecoder(encoding);
  let pending = '';
  let lineNumber = 0;
  for await (const chunk of fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 })) {
    onBytes(chunk.length);
    pending += decoder.decode(chunk, { stream: true });
    let start = 0;
    let end;
    while ((end = pending.indexOf('\n', start)) !== -1) {
      lineNumber += 1;
      const text = pending.slice(start, end);
      yield { lineNumber, text: text.endsWith('\r') ? text.slice(0, -1) : text };
      start = end + 1;
    }
    pending = pending.slice(start);
  }
  pending += decoder.decode();
  if (pending.length) {
    lineNumber += 1;
    yield { lineNumber, text: pending.endsWith('\r') ? pending.slice(0, -1) : pending };
  }
}

// Separa los campos con coma, como FIELDTERMINATOR = ','. Igual que BULK INSERT, la última columna
// conserva el resto de la línea si hay campos de más, y un campo vacío se guarda como NULL (o su valor por defecto).
const splitFields = (text, columnCount, separator = ',') => {
  const fields = text.split(separator);
  if (fields.length > columnCount) {
    fields.splice(columnCount - 1, fields.length - columnCount + 1, fields.slice(columnCount - 1).join(separator));
  }
  return fields.map(value => (value === '' ? null : value));
};

// ═══════════════════════════════════════
//  LECTURA DE EXCEL (.xlsx)
// ═══════════════════════════════════════
// El Excel se pasa a un archivo de texto temporal y luego sigue el mismo camino que un CSV.
// Separa los campos con el carácter de control US (\u001f) en lugar de la coma, para que las
// comas dentro de una celda (nombres, direcciones) no corran las columnas.
const SEPARADOR_EXCEL = '\u001f';

const esZip = async filePath => {
  const handle = await fsp.open(filePath, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(4), 0, 4, 0);
    return bytesRead === 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
  } finally {
    await handle.close();
  }
};

const dos = n => String(n).padStart(2, '0');
// Excel guarda las fechas sin zona horaria; ExcelJS las entrega como fecha UTC con la misma hora del archivo.
const fechaExcel = date => {
  if (Number.isNaN(date.getTime())) return '';
  const dia = `${date.getUTCFullYear()}-${dos(date.getUTCMonth() + 1)}-${dos(date.getUTCDate())}`;
  const h = date.getUTCHours(), m = date.getUTCMinutes(), s = date.getUTCSeconds();
  return h || m || s ? `${dia} ${dos(h)}:${dos(m)}:${dos(s)}` : dia;
};
// Números sin notación científica ni separador de miles (por ejemplo 0.0000012 o 1e21).
const numeroExcel = value => {
  const text = String(value);
  return /e/i.test(text) ? value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 }) : text;
};
// Convierte una celda de ExcelJS en el texto que tendría en un CSV.
const textoCelda = value => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return fechaExcel(value);
  if (typeof value === 'number') return numeroExcel(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map(part => part.text || '').join('');
    if ('result' in value) return textoCelda(value.result);          // fórmula: se usa su resultado
    if ('text' in value) return textoCelda(value.text);              // hipervínculo
    if ('error' in value) return '';                                 // #N/A, #DIV/0!...
    return '';
  }
  // Un salto de línea dentro de la celda partiría la fila en dos.
  return String(value).replace(/[\r\n]+/g, ' ').replace(/\u001f/g, ' ');
};

// Lee la PRIMERA hoja por partes (sin cargar todo el libro en memoria) y escribe una línea por fila.
// Las filas vacías se dejan como líneas vacías para que los mensajes de error usen el número de fila de Excel.
const convertirExcel = async ({ upload, destino, onBytes = () => {} }) => {
  const entrada = fs.createReadStream(upload.path, { highWaterMark: 1024 * 1024 });
  entrada.on('data', chunk => onBytes(chunk.length));
  const salida = fs.createWriteStream(destino, { encoding: 'utf8' });
  const escribir = text => (salida.write(text) ? null : new Promise(resolve => salida.once('drain', resolve)));
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(entrada, {
    sharedStrings: 'cache', styles: 'cache', hyperlinks: 'ignore', worksheets: 'emit', entries: 'emit'
  });
  let columnas = 0;
  let filaAnterior = 0;
  let hojas = 0;
  try {
    for await (const hoja of reader) {
      hojas += 1;
      for await (const fila of hoja) {
        const valores = Array.isArray(fila.values) ? fila.values : [];
        // El encabezado (fila 1) fija cuántas columnas tiene el archivo.
        if (!columnas) columnas = Math.max(fila.cellCount || 0, valores.length - 1);
        const espera = escribir('\n'.repeat(Math.max(0, fila.number - filaAnterior - 1)));
        if (espera) await espera;
        filaAnterior = fila.number;
        const campos = [];
        for (let c = 1; c <= columnas; c += 1) campos.push(textoCelda(valores[c]));
        const linea = campos.some(campo => campo !== '') ? campos.join(SEPARADOR_EXCEL) : '';
        const espera2 = escribir(`${linea}\n`);
        if (espera2) await espera2;
      }
      break; // solo la primera hoja
    }
  } catch (error) {
    salida.destroy();
    throw new ImportError(`${upload.name}: no se pudo leer el Excel (${error.message}). Ábrelo en Excel y guárdalo de nuevo como .xlsx.`);
  } finally {
    entrada.destroy();
  }
  await new Promise((resolve, reject) => salida.end(error => (error ? reject(error) : resolve())));
  if (!hojas || !filaAnterior) throw new ImportError(`${upload.name}: la primera hoja del Excel está vacía.`);
  return { filas: filaAnterior };
};

// ═══════════════════════════════════════
//  ESTRUCTURA DE TABLAS Y CONVERSIONES
// ═══════════════════════════════════════
const quoteName = name => `[${String(name).replace(/]/g, ']]')}]`;

// Lee las columnas de la tabla en su orden físico: BULK INSERT asigna los campos del CSV por posición.
const getTableColumns = async (request, table) => {
  const result = await request
    .input('tabla', sql.NVarChar(300), `dbo.${table}`)
    .query(`
      SELECT c.column_id, c.name, TYPE_NAME(c.system_type_id) AS tipo, c.max_length, c.precision, c.scale,
             c.is_nullable, c.is_identity, c.is_computed, dc.definition AS valorPorDefecto
      FROM sys.columns c
      LEFT JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id
      WHERE c.object_id = OBJECT_ID(@tabla)
      ORDER BY c.column_id
    `);
  if (!result.recordset.length) throw new ImportError(`La tabla dbo.${table} no existe en la base de datos.`);
  // Las columnas calculadas no reciben datos del archivo.
  const fileColumns = result.recordset
    .filter(column => !column.is_computed)
    .map((column, index) => ({ ...column, tipo: String(column.tipo).toLowerCase(), stage: `c${index + 1}` }));
  // Identidad y rowversion ocupan un campo del archivo pero el valor lo genera SQL Server.
  const insertColumns = fileColumns.filter(column => !column.is_identity && !SKIPPED_TYPES.has(column.tipo));
  return { fileColumns, insertColumns };
};

const typeSpec = column => {
  const { tipo } = column;
  if (['varchar', 'char', 'varbinary', 'binary'].includes(tipo)) return `${tipo}(${column.max_length === -1 ? 'max' : column.max_length})`;
  if (['nvarchar', 'nchar'].includes(tipo)) return `${tipo}(${column.max_length === -1 ? 'max' : column.max_length / 2})`;
  if (['decimal', 'numeric'].includes(tipo)) return `${tipo}(${column.precision},${column.scale})`;
  if (['datetime2', 'time', 'datetimeoffset'].includes(tipo)) return `${tipo}(${column.scale})`;
  return tipo;
};

// Convierte el texto del CSV al tipo de la columna. Las fechas se interpretan de forma explícita
// (AAAA-MM-DD o DD/MM/AAAA) para no depender del idioma de la sesión de SQL Server.
const valueExpression = (column, fn = 'CONVERT') => {
  const src = quoteName(column.stage);
  const spec = typeSpec(column);
  let expression;
  if (TEXT_TYPES.has(column.tipo)) {
    expression = src;
  } else if (DATE_TYPES.has(column.tipo)) {
    expression = `CASE
        WHEN ${src} LIKE '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T%' THEN ${fn}(${spec}, ${src}, 126)
        WHEN ${src} LIKE '[0-9][0-9][0-9][0-9]-[0-9]%' THEN ${fn}(${spec}, ${src}, 120)
        WHEN ${src} LIKE '[0-9][0-9][0-9][0-9]/[0-9]%' THEN ${fn}(${spec}, ${src}, 111)
        WHEN ${src} LIKE '[0-9]%/[0-9]%/[0-9][0-9][0-9][0-9]%' THEN ${fn}(${spec}, ${src}, 103)
        WHEN ${src} LIKE '[0-9]%-[0-9]%-[0-9][0-9][0-9][0-9]%' THEN ${fn}(${spec}, ${src}, 105)
        ELSE ${fn}(${spec}, ${src})
      END`;
  } else {
    expression = `${fn}(${spec}, ${src})`;
  }
  return column.valorPorDefecto ? `COALESCE(${expression}, ${column.valorPorDefecto})` : expression;
};

// Tabla temporal de paso: un campo de texto por columna del archivo y el número de línea para los mensajes de error.
const createStageTable = async (transaction, fileColumns) => {
  const definitions = fileColumns.map(column => {
    const isMax = TEXT_TYPES.has(column.tipo) && (column.max_length === -1 || ['text', 'ntext'].includes(column.tipo));
    return `${quoteName(column.stage)} nvarchar(${isMax ? 'max' : '4000'}) NULL`;
  });
  // Se crea con batch() y no con query(): query() usa sp_executesql y la tabla temporal desaparecería al terminar.
  await new sql.Request(transaction).batch(`
    IF OBJECT_ID('tempdb..#carga') IS NOT NULL DROP TABLE #carga;
    CREATE TABLE #carga (linea_archivo int NOT NULL, ${definitions.join(', ')});
  `);
};

// Ubica la primera fila del lote que no se puede insertar y explica la causa.
const diagnoseBatch = async (transaction, insertColumns) => {
  const checks = [];
  for (const column of insertColumns) {
    const src = quoteName(column.stage);
    const label = column.name.replace(/'/g, "''");
    if (!TEXT_TYPES.has(column.tipo)) {
      checks.push(`SELECT TOP 1 linea_archivo, N'${label}' AS columna, ${src} AS valor, N'conversion' AS motivo, N'${typeSpec(column)}' AS tipo
        FROM #carga WHERE ${src} IS NOT NULL AND ${valueExpression({ ...column, valorPorDefecto: null }, 'TRY_CONVERT')} IS NULL ORDER BY linea_archivo`);
    } else if (column.max_length !== -1 && !['text', 'ntext'].includes(column.tipo)) {
      const maxChars = ['nvarchar', 'nchar'].includes(column.tipo) ? column.max_length / 2 : column.max_length;
      checks.push(`SELECT TOP 1 linea_archivo, N'${label}' AS columna, ${src} AS valor, N'longitud' AS motivo, N'${typeSpec(column)}' AS tipo
        FROM #carga WHERE LEN(${src}) > ${maxChars} ORDER BY linea_archivo`);
    }
    if (!column.is_nullable && !column.valorPorDefecto) {
      checks.push(`SELECT TOP 1 linea_archivo, N'${label}' AS columna, NULL AS valor, N'vacio' AS motivo, N'${typeSpec(column)}' AS tipo
        FROM #carga WHERE ${src} IS NULL ORDER BY linea_archivo`);
    }
  }
  if (!checks.length) return null;
  const result = await new sql.Request(transaction).query(`
    SELECT TOP 1 * FROM (${checks.map(check => `SELECT * FROM (${check}) AS x`).join(' UNION ALL ')}) AS problemas
    ORDER BY linea_archivo
  `);
  return result.recordset[0] || null;
};

const describeProblem = (problem, fileName) => {
  const where = `${fileName}, línea ${problem.linea_archivo.toLocaleString('es-PE')}, columna ${problem.columna}`;
  if (problem.motivo === 'longitud') return `${where}: el valor «${String(problem.valor).slice(0, 80)}» es más largo de lo que admite la columna (${problem.tipo}).`;
  if (problem.motivo === 'vacio') return `${where}: la columna no admite valores vacíos.`;
  return `${where}: el valor «${String(problem.valor).slice(0, 80)}» no es válido para el tipo ${problem.tipo}.`;
};

// ═══════════════════════════════════════
//  CARGA DE UN ARCHIVO
// ═══════════════════════════════════════
// Lee el CSV (omitiendo el encabezado, FIRSTROW = 2) y lo inserta por lotes en la tabla destino.
const loadFile = async (options) => {
  const { job, upload } = options;
  if (upload.formato !== 'xlsx') return loadTextFile({ ...options, lectura: { path: upload.path, separator: ',', countBytes: true } });
  // Excel: primero se pasa a texto (el avance se cuenta con los bytes del .xlsx) y luego se carga igual que un CSV.
  const destino = `${upload.path}.txt`;
  log(job, `Leyendo Excel: ${upload.name} (primera hoja)`);
  try {
    const { filas } = await convertirExcel({ upload, destino, onBytes: bytes => { job.bytesProcesados += bytes; } });
    log(job, `${upload.name}: ${filas.toLocaleString('es-PE')} filas en la hoja, incluido el encabezado.`);
    return await loadTextFile({ ...options, encodingOption: 'utf8', lectura: { path: destino, separator: SEPARADOR_EXCEL, countBytes: false } });
  } finally {
    await fsp.rm(destino, { force: true }).catch(() => {});
  }
};

const loadTextFile = async ({ transaction, job, upload, fileColumns, insertColumns, target, includeLine = false, tablock = false, encodingOption, yearCheck = null, lectura }) => {
  const encoding = await detectEncoding(lectura.path, encodingOption);
  log(job, `Cargando: ${upload.name} (${upload.formato === 'xlsx' ? 'Excel' : encoding === 'utf-8' ? 'UTF-8' : 'ANSI'})`);

  const targetColumns = insertColumns.map(column => quoteName(column.name));
  const sourceValues = insertColumns.map(column => valueExpression(column));
  if (includeLine) {
    targetColumns.push('linea_archivo');
    sourceValues.push('linea_archivo');
  }
  const insertSql = `
    INSERT INTO ${target}${tablock ? ' WITH (TABLOCK)' : ''} (${targetColumns.join(', ')})
    SELECT ${sourceValues.join(', ')} FROM #carga;
    TRUNCATE TABLE #carga;
  `;

  let batch = [];
  let inserted = 0;

  // Modo compatible: INSERT ... VALUES de hasta 1.000 filas con los textos como literales N'...'
  // (las comillas se duplican). Se usa si la carga rápida (bulk) no funciona en el servidor.
  const stageColumnList = ['linea_archivo', ...fileColumns.map(column => quoteName(column.stage))].join(', ');
  const literal = value => (value === null || value === undefined ? 'NULL' : `N'${String(value).replace(/'/g, "''")}'`);
  const insertStageWithValues = async rows => {
    const statements = [];
    for (let start = 0; start < rows.length; start += 1000) {
      const values = rows.slice(start, start + 1000)
        .map(([line, ...fields]) => `(${Number(line)}, ${fields.map(literal).join(', ')})`)
        .join(',\n');
      statements.push(`INSERT INTO #carga (${stageColumnList}) VALUES\n${values};`);
    }
    await new sql.Request(transaction).query(statements.join('\n'));
  };

  const flush = async () => {
    if (!batch.length) return;
    const rows = batch;
    const stage = new sql.Table('#carga');
    stage.create = false;
    stage.columns.add('linea_archivo', sql.Int, { nullable: false });
    for (const column of fileColumns) {
      const isMax = TEXT_TYPES.has(column.tipo) && (column.max_length === -1 || ['text', 'ntext'].includes(column.tipo));
      stage.columns.add(column.stage, isMax ? sql.NVarChar(sql.MAX) : sql.NVarChar(4000), { nullable: true });
    }
    for (const row of batch) stage.rows.add(...row);
    const firstLine = batch[0][0];
    const lastLine = batch[batch.length - 1][0];
    batch = [];

    const failure = error => new ImportError(`${upload.name}, líneas ${firstLine.toLocaleString('es-PE')} a ${lastLine.toLocaleString('es-PE')}: no se pudieron enviar los datos a SQL Server (${describeSqlError(error)}).`);
    if (job.stageMode !== 'values') {
      try {
        await new sql.Request(transaction).bulk(stage);
      } catch (error) {
        console.error('Bulk load error:', error);
        log(job, `La carga rápida no funcionó en este servidor (${describeSqlError(error)}). Se continúa en modo compatible, que es más lento.`, 'warn');
        job.stageMode = 'values';
        try {
          await new sql.Request(transaction).query('TRUNCATE TABLE #carga;');
        } catch (truncateError) {
          throw failure(error);
        }
      }
    }
    if (job.stageMode === 'values') {
      try {
        await insertStageWithValues(rows);
      } catch (error) {
        console.error('Stage insert error:', error);
        throw failure(error);
      }
    }

    // Al reemplazar un año, todas las filas deben ser de ese año; si no, se duplicaría la producción de otro año.
    if (yearCheck) {
      const src = quoteName(yearCheck.stage);
      const other = await new sql.Request(transaction)
        .input('anio', sql.Int, yearCheck.year)
        .query(`SELECT TOP 1 linea_archivo, ${src} AS valor_anio FROM #carga WHERE TRY_CONVERT(int, ${src}) IS NULL OR TRY_CONVERT(int, ${src}) <> @anio ORDER BY linea_archivo;`);
      const row = other.recordset[0];
      if (row) {
        throw new ImportError(`${lugar(row.linea_archivo)}: el registro es del año «${row.valor_anio ?? 'vacío'}» y el modo «Reemplazar ${yearCheck.year}» solo admite registros de ${yearCheck.year}. Se canceló la importación de la producción nominal y no se modificó.`);
      }
    }

    try {
      const result = await new sql.Request(transaction).query(insertSql);
      inserted += result.rowsAffected[0] || 0;
      job.filasInsertadas += result.rowsAffected[0] || 0;
    } catch (error) {
      let problem = null;
      try {
        problem = await diagnoseBatch(transaction, insertColumns);
      } catch {
        // Si la transacción ya no admite consultas, se informa el rango de líneas del lote.
      }
      if (problem) throw new ImportError(describeProblem(problem, upload.name));
      throw new ImportError(`${upload.name}, líneas ${firstLine.toLocaleString('es-PE')} a ${lastLine.toLocaleString('es-PE')}: ${error.message}`);
    }
  };

  const lugar = n => `${upload.name}, ${upload.formato === 'xlsx' ? 'fila' : 'línea'} ${n.toLocaleString('es-PE')}`;
  for await (const { lineNumber, text } of readLines(lectura.path, encoding, bytes => { if (lectura.countBytes) job.bytesProcesados += bytes; })) {
    if (lineNumber === 1 || text.trim() === '') continue;
    const fields = splitFields(text, fileColumns.length, lectura.separator);
    if (fields.length < fileColumns.length) {
      throw new ImportError(`${lugar(lineNumber)}: tiene ${fields.length} ${upload.formato === 'xlsx' ? 'columnas' : 'campos'} y la tabla espera ${fileColumns.length}. Revisa que el archivo corresponda a esta tabla.`);
    }
    batch.push([lineNumber, ...fields]);
    if (batch.length >= BATCH_ROWS) await flush();
  }
  await flush();

  log(job, `OK: ${upload.name} — ${inserted.toLocaleString('es-PE')} registros`, 'ok');
  return inserted;
};

// ═══════════════════════════════════════
//  TRABAJOS DE IMPORTACIÓN
// ═══════════════════════════════════════
let currentJob = null;

// La importación usa la misma conexión que el resto de la aplicación (la que ya funciona).
// Para no exceder su tiempo de espera, las operaciones largas se hacen por tandas.
const TRANSIENT_CONNECT_ERRORS = ['ESOCKET', 'ECONNRESET', 'ETIMEOUT', 'ENOTOPEN', 'ECONNCLOSED'];
const IMPORT_CONNECT_ATTEMPTS = 3;
const DELETE_CHUNK_ROWS = 50000;

const isTransientError = error => TRANSIENT_CONNECT_ERRORS.includes(error?.code) || /ECONNRESET|Connection lost/i.test(error?.message || '');

let importPool = null;

// Conexión propia para importar, con tiempo de espera largo (copia la configuración de la conexión principal).
// Si no se puede abrir, se usa la conexión principal: las operaciones largas igualmente van por tandas.
const getImportPool = async job => {
  let mainPool;
  try {
    mainPool = await poolPromise;
  } catch (error) {
    throw new ImportError(`La aplicación no tiene conexión con SQL Server (${error.message}). Comprueba que la instancia esté encendida y reinicia el servidor; no se modificó la base de datos.`);
  }
  if (importPool?.connected) return importPool;
  try {
    const pool = new sql.ConnectionPool({
      ...mainPool.config,
      options: { ...(mainPool.config?.options || {}) },
      requestTimeout: IMPORT_REQUEST_TIMEOUT_MS,
      pool: { max: 2, min: 0, idleTimeoutMillis: 60000 }
    });
    pool.on('error', error => console.error('Import pool error:', error.message));
    await pool.connect();
    importPool = pool;
    return pool;
  } catch (error) {
    if (job) log(job, `No se pudo abrir la conexión de importación (${describeSqlError(error)}); se usa la conexión principal.`, 'warn');
    return mainPool;
  }
};

// Abre la transacción y, si SQL Server corta la conexión al empezar, lo reintenta.
const beginTransaction = async (job, pool) => {
  for (let attempt = 1; attempt <= IMPORT_CONNECT_ATTEMPTS; attempt++) {
    const transaction = new sql.Transaction(pool);
    try {
      await transaction.begin();
      return transaction;
    } catch (error) {
      if (!isTransientError(error) || attempt === IMPORT_CONNECT_ATTEMPTS) {
        throw new ImportError(`No se pudo iniciar la importación en SQL Server${isTransientError(error) ? ` después de ${IMPORT_CONNECT_ATTEMPTS} intentos` : ''} (${error.message}). No se modificó la base de datos.`);
      }
      log(job, `SQL Server cortó la conexión (${error.message}). Reintentando (${attempt + 1} de ${IMPORT_CONNECT_ATTEMPTS})...`, 'warn');
      await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
    }
  }
  throw new ImportError('No se pudo iniciar la importación en SQL Server.');
};

function log(job, mensaje, nivel = 'info') {
  job.log.push({ hora: new Date().toISOString(), nivel, mensaje });
  if (job.log.length > 400) job.log.splice(0, job.log.length - 400);
  console.log(`[importación] ${mensaje}`);
}

const publicJob = job => job && ({
  id: job.id,
  descripcion: job.descripcion,
  estado: job.estado,
  fase: job.fase,
  usuario: job.usuario,
  inicio: job.inicio,
  fin: job.fin,
  bytesTotal: job.bytesTotal,
  bytesProcesados: job.bytesProcesados,
  filasInsertadas: job.filasInsertadas,
  resultados: job.resultados,
  error: job.error,
  log: job.log
});

const rollbackQuietly = async transaction => {
  try {
    await transaction.rollback();
  } catch {
    // SQL Server ya revirtió la transacción.
  }
};

// Pasos 1 a 3 del script, uno por maestro y cada uno en su propia transacción.
// Acumular: los registros cuyo identificador ya existe se actualizan con la versión del archivo y los nuevos se agregan.
// Reemplazar: se vacía el maestro y se carga completo desde el archivo.
// En ambos casos se eliminan los duplicados por identificador, como en el script.
const runMaestro = async (job, { tipo, upload, modo }, encodingOption) => {
  const pool = await getImportPool(job);
  const maestro = MAESTROS[tipo];
  const table = `dbo.${quoteName(maestro.table)}`;
  job.fase = `Importando ${maestro.label.toLowerCase()}`;
  log(job, `— ${maestro.label} (dbo.${maestro.table}) · ${MAESTRO_MODE_LABELS[modo]} —`);
  const transaction = await beginTransaction(job, pool);
  try {
    const { fileColumns, insertColumns } = await getTableColumns(new sql.Request(transaction), maestro.table);
    const keyColumn = insertColumns.find(column => column.name.toLowerCase() === maestro.key.toLowerCase());
    if (!keyColumn) throw new ImportError(`La tabla dbo.${maestro.table} no tiene la columna ${maestro.key}.`);
    const key = quoteName(keyColumn.name);
    const columnList = insertColumns.map(column => quoteName(column.name)).join(', ');

    await createStageTable(transaction, fileColumns);
    // batch() para que #nuevos siga existiendo en la sesión durante toda la importación del maestro.
    await new sql.Request(transaction).batch(`
      IF OBJECT_ID('tempdb..#nuevos') IS NOT NULL DROP TABLE #nuevos;
      SELECT TOP 0 ${columnList} INTO #nuevos FROM ${table};
      ALTER TABLE #nuevos ADD linea_archivo int NULL;
    `);

    const leidos = await loadFile({ transaction, job, upload, fileColumns, insertColumns, target: '#nuevos', includeLine: true, encodingOption });

    job.fase = `Actualizando ${maestro.label.toLowerCase()}`;
    // Reemplazar: vacía la tabla. Actualizar y acumular: retira las versiones anteriores de los Id del archivo.
    // Acumular: descarta del archivo los Id que ya existen, para agregar solo los nuevos.
    const removeExisting = {
      reemplazar: `DELETE FROM ${table};`,
      actualizar: `DELETE t FROM ${table} t WHERE EXISTS (SELECT 1 FROM #nuevos n WHERE n.${key} = t.${key});`,
      acumular: `DELETE n FROM #nuevos n WHERE EXISTS (SELECT 1 FROM ${table} t WHERE t.${key} = n.${key});`
    }[modo];
    const result = await new sql.Request(transaction).query(`
      WITH repetidos AS (
        SELECT ROW_NUMBER() OVER (PARTITION BY ${key} ORDER BY linea_archivo DESC) AS fila FROM #nuevos
      )
      DELETE FROM repetidos WHERE fila > 1;

      ${removeExisting}

      INSERT INTO ${table} (${columnList})
      SELECT ${columnList} FROM #nuevos;

      WITH duplicados AS (
        SELECT ROW_NUMBER() OVER (PARTITION BY ${key} ORDER BY ${key}) AS fila FROM ${table}
      )
      DELETE FROM duplicados WHERE fila > 1;

      DROP TABLE #nuevos;
      DROP TABLE #carga;
      SELECT COUNT_BIG(*) AS total FROM ${table};
    `);
    const [repetidosArchivo, quitados, insertados, duplicadosTabla] = result.rowsAffected;
    await transaction.commit();

    const resultado = {
      tipo,
      modo,
      etiqueta: maestro.label,
      tabla: maestro.table,
      archivo: upload.name,
      leidos,
      repetidosArchivo,
      insertados,
      // «quitados» son: en actualizar, los registros existentes que se actualizaron; en reemplazar, todo el contenido
      // anterior; en acumular, los registros del archivo cuyo Id ya existía y no se tocaron.
      actualizados: modo === 'actualizar' ? quitados : 0,
      agregados: modo === 'actualizar' ? Math.max(0, insertados - quitados) : insertados,
      eliminados: modo === 'reemplazar' ? quitados : 0,
      omitidos: modo === 'acumular' ? quitados : 0,
      duplicadosEliminados: duplicadosTabla,
      totalTabla: Number(result.recordset[0].total)
    };
    job.resultados.push(resultado);
    const detalle = {
      reemplazar: `se eliminaron ${quitados.toLocaleString('es-PE')} registros anteriores y se cargaron ${insertados.toLocaleString('es-PE')}`,
      actualizar: `${resultado.agregados.toLocaleString('es-PE')} nuevos y ${resultado.actualizados.toLocaleString('es-PE')} actualizados`,
      acumular: `${insertados.toLocaleString('es-PE')} nuevos agregados; ${quitados.toLocaleString('es-PE')} ya existían y no se modificaron`
    }[modo];
    log(job, `${maestro.label}: ${detalle}${repetidosArchivo ? ` (${repetidosArchivo.toLocaleString('es-PE')} repetidos en el archivo)` : ''}. Total en la tabla: ${resultado.totalTabla.toLocaleString('es-PE')}.`, 'ok');
  } catch (error) {
    await rollbackQuietly(transaction);
    throw error;
  }
};

// Modo «Actualizar»: la atención (Id_Cita) identifica los registros repetidos. Las atenciones del archivo que ya
// están en NProduccion se reemplazan completas por la versión del archivo; las que no están se agregan. El resto no se toca.
// Si una misma atención viene en varios archivos, vale la del último archivo elegido.
const updateNominal = async ({ transaction, job, uploadsToLoad, fileColumns, insertColumns, encodingOption }) => {
  const citaColumn = insertColumns.find(column => column.name.toLowerCase() === 'id_cita');
  if (!citaColumn) throw new ImportError(`La tabla dbo.${NOMINAL_TABLE} no tiene la columna Id_Cita, necesaria para reconocer los registros repetidos.`);
  const cita = quoteName(citaColumn.name);
  const table = `dbo.${quoteName(NOMINAL_TABLE)}`;
  const columnList = insertColumns.map(column => quoteName(column.name)).join(', ');

  // Tabla de paso con los mismos tipos que NProduccion; batch() para que dure toda la sesión.
  await createStageTable(transaction, fileColumns);
  await new sql.Request(transaction).batch(`
    IF OBJECT_ID('tempdb..#nprod') IS NOT NULL DROP TABLE #nprod;
    IF OBJECT_ID('tempdb..#citas') IS NOT NULL DROP TABLE #citas;
    SELECT TOP 0 ${columnList} INTO #nprod FROM ${table};
    ALTER TABLE #nprod ADD orden_archivo int NULL;
  `);

  const archivos = [];
  for (const [index, upload] of uploadsToLoad.entries()) {
    job.fase = `Cargando ${upload.name}`;
    const registros = await loadFile({ transaction, job, upload, fileColumns, insertColumns, target: '#nprod', encodingOption });
    await new sql.Request(transaction).query(`UPDATE #nprod SET orden_archivo = ${index + 1} WHERE orden_archivo IS NULL;`);
    archivos.push({ archivo: upload.name, registros });
  }

  job.fase = 'Comparando con la base de datos';
  log(job, 'Comparando las atenciones del archivo con las de la base de datos...');
  const prepared = await new sql.Request(transaction).batch(`
    CREATE INDEX IX_nprod_cita ON #nprod (${cita}, orden_archivo);
    -- Misma atención en varios archivos: se conserva la del último archivo.
    DELETE n FROM #nprod n WHERE EXISTS (SELECT 1 FROM #nprod m WHERE m.${cita} = n.${cita} AND m.orden_archivo > n.orden_archivo);
    SELECT DISTINCT ${cita} AS Id_Cita INTO #citas FROM #nprod WHERE ${cita} IS NOT NULL;
    CREATE UNIQUE CLUSTERED INDEX IX_citas ON #citas (Id_Cita);
    SELECT
      (SELECT COUNT_BIG(*) FROM #citas) AS citasArchivo,
      (SELECT COUNT_BIG(*) FROM #citas c WHERE EXISTS (SELECT 1 FROM ${table} np WHERE np.${cita} = c.Id_Cita)) AS citasExistentes;
  `);
  const totals = prepared.recordset[0];
  const citasArchivo = Number(totals.citasArchivo);
  const citasActualizadas = Number(totals.citasExistentes);
  log(job, `El archivo trae ${citasArchivo.toLocaleString('es-PE')} atenciones: ${citasActualizadas.toLocaleString('es-PE')} ya estaban en la base (se reemplazarán) y ${(citasArchivo - citasActualizadas).toLocaleString('es-PE')} son nuevas.`);

  // Borra los registros anteriores de las atenciones repetidas, por tandas.
  let eliminados = 0;
  if (citasActualizadas) {
    for (;;) {
      const deleted = await new sql.Request(transaction).query(`
        DELETE TOP (${DELETE_CHUNK_ROWS}) np FROM ${table} np INNER JOIN #citas c ON c.Id_Cita = np.${cita};
      `);
      const count = deleted.rowsAffected[0] || 0;
      eliminados += count;
      job.fase = `Reemplazando atenciones repetidas: ${eliminados.toLocaleString('es-PE')} registros anteriores retirados`;
      if (count < DELETE_CHUNK_ROWS) break;
    }
  }

  job.fase = 'Guardando los registros del archivo';
  const inserted = await new sql.Request(transaction).query(`
    INSERT INTO ${table} WITH (TABLOCK) (${columnList}) SELECT ${columnList} FROM #nprod;
    DROP TABLE #nprod; DROP TABLE #citas; DROP TABLE #carga;
  `);
  const cargados = inserted.rowsAffected[0] || 0;
  return { eliminados, cargados, citasArchivo, citasActualizadas, citasNuevas: citasArchivo - citasActualizadas, archivos };
};

// Trama nominal: todos los archivos en una sola transacción; si algo falla, SQL Server revierte todo.
// Acumular: agrega los registros sin borrar nada.
// Reemplazar: borra la producción del año elegido y la carga de nuevo (carga múltiple del script).
const runNominal = async (job, { uploads: uploadsToLoad, modo, anio: year }, encodingOption) => {
  const pool = await getImportPool(job);
  job.fase = 'Importando la producción nominal';
  const modeLabel = { reemplazar: `Reemplazar ${year}`, actualizar: 'Actualizar y acumular', acumular: 'Acumular' }[modo];
  log(job, `— Producción nominal (dbo.${NOMINAL_TABLE}) · ${modeLabel} —`);
  const transaction = await beginTransaction(job, pool);
  try {
    const { fileColumns, insertColumns } = await getTableColumns(new sql.Request(transaction), NOMINAL_TABLE);
    const yearColumn = fileColumns.find(column => column.name.toLowerCase() === 'anio');
    const yearExpression = yearColumn ? quoteName(yearColumn.name) : 'YEAR(Fecha_Atencion)';

    let eliminados = 0;
    if (modo === 'reemplazar') {
      job.fase = `Eliminando la producción ${year}`;
      log(job, `Eliminando los registros de ${year} en dbo.${NOMINAL_TABLE}...`);
      // Por tandas, para que cada sentencia termine en pocos segundos.
      for (;;) {
        const deleted = await new sql.Request(transaction)
          .input('anio', sql.Int, year)
          .query(`DELETE TOP (${DELETE_CHUNK_ROWS}) FROM dbo.${quoteName(NOMINAL_TABLE)} WHERE ${yearExpression} = @anio;`);
        const count = deleted.rowsAffected[0] || 0;
        eliminados += count;
        job.fase = `Eliminando la producción ${year}: ${eliminados.toLocaleString('es-PE')} registros`;
        if (count < DELETE_CHUNK_ROWS) break;
      }
      log(job, `Se eliminaron ${eliminados.toLocaleString('es-PE')} registros de ${year}.`);
    }

    if (modo === 'actualizar') {
      const resultado = await updateNominal({ transaction, job, uploadsToLoad, fileColumns, insertColumns, encodingOption });
      job.fase = 'Confirmando los cambios';
      await transaction.commit();
      job.resultados.push({ tipo: 'nominal', modo, etiqueta: 'Producción nominal', tabla: NOMINAL_TABLE, ...resultado });
      log(job, `Producción nominal actualizada: ${resultado.citasActualizadas.toLocaleString('es-PE')} atenciones reemplazadas (${resultado.eliminados.toLocaleString('es-PE')} registros anteriores), ${resultado.citasNuevas.toLocaleString('es-PE')} atenciones nuevas; ${resultado.cargados.toLocaleString('es-PE')} registros cargados en total.`, 'ok');
      return;
    }

    await createStageTable(transaction, fileColumns);
    const archivos = [];
    for (const upload of uploadsToLoad) {
      job.fase = `Cargando ${upload.name}`;
      const yearCheck = modo === 'reemplazar' && yearColumn ? { stage: yearColumn.stage, column: yearColumn.name, year } : null;
      const registros = await loadFile({ transaction, job, upload, fileColumns, insertColumns, target: `dbo.${quoteName(NOMINAL_TABLE)}`, tablock: true, encodingOption, yearCheck });
      archivos.push({ archivo: upload.name, registros });
    }
    const cargados = archivos.reduce((sum, item) => sum + item.registros, 0);

    job.fase = 'Verificando la carga';
    await new sql.Request(transaction).query('DROP TABLE #carga;');
    // Sin columna Anio, el control del año se hace al final sobre la fecha de atención.
    if (modo === 'reemplazar' && !yearColumn) {
      const check = await new sql.Request(transaction)
        .input('anio', sql.Int, year)
        .query(`SELECT COUNT_BIG(*) AS total FROM dbo.${quoteName(NOMINAL_TABLE)} WHERE ${yearExpression} = @anio;`);
      const enAnio = Number(check.recordset[0].total);
      if (enAnio !== cargados) {
        throw new ImportError(`De ${cargados.toLocaleString('es-PE')} registros cargados, ${(cargados - enAnio).toLocaleString('es-PE')} no corresponden al año ${year}. Se canceló la importación de la producción nominal y no se modificó; revisa que los archivos sean solo de ${year}.`);
      }
    }

    job.fase = 'Confirmando los cambios';
    await transaction.commit();
    job.resultados.push({ tipo: 'nominal', modo, etiqueta: 'Producción nominal', tabla: NOMINAL_TABLE, anio: year, eliminados, cargados, archivos });
    log(job, modo === 'reemplazar'
      ? `Producción ${year} reemplazada: ${eliminados.toLocaleString('es-PE')} registros anteriores, ${cargados.toLocaleString('es-PE')} registros nuevos.`
      : `Producción nominal: se agregaron ${cargados.toLocaleString('es-PE')} registros.`, 'ok');
  } catch (error) {
    job.fase = 'Revirtiendo los cambios';
    await rollbackQuietly(transaction);
    throw error;
  }
};

// Inicia una importación en segundo plano, como el botón «Importar» de la aplicación de escritorio:
// procesa en orden Paciente, Personal, Registrador y Nominal, cada uno con su modo.
const startImport = async (req, res) => {
  if (currentJob?.estado === 'en_proceso') {
    return res.status(409).json({ message: `Ya hay una importación en curso iniciada por ${currentJob.usuario}.` });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const archivos = body.archivos && typeof body.archivos === 'object' ? body.archivos : {};
  const encodingOption = ['auto', 'ansi', 'utf8'].includes(body.codificacion) ? body.codificacion : 'auto';
  const lookup = id => (typeof id === 'string' ? uploads.get(id) : undefined);
  // Maestros: «actualizar» (actualizar y acumular) es el predeterminado si llega un valor desconocido.
  const normalizeMode = value => (['reemplazar', 'acumular', 'actualizar'].includes(value) ? value : 'actualizar');
  const normalizeNominalMode = value => (['reemplazar', 'actualizar'].includes(value) ? value : 'acumular');
  const missing = () => res.status(400).json({ message: 'Uno de los archivos ya no está disponible; vuelve a seleccionarlo.' });

  const maestros = [];
  for (const tipo of Object.keys(MAESTROS)) {
    const entry = archivos[tipo];
    if (!entry) continue;
    const upload = lookup(entry.id);
    if (!upload) return missing();
    maestros.push({ tipo, upload, modo: normalizeMode(entry.modo) });
  }

  let nominal = null;
  if (archivos.nominal) {
    const ids = Array.isArray(archivos.nominal.ids) ? archivos.nominal.ids : [];
    const nominalUploads = ids.map(lookup);
    if (!nominalUploads.length) return res.status(400).json({ message: 'Selecciona los archivos de la trama nominal.' });
    if (nominalUploads.length > 100) return res.status(400).json({ message: 'Se admiten hasta 100 archivos nominales por importación.' });
    if (nominalUploads.some(upload => !upload)) return missing();
    const modo = normalizeNominalMode(archivos.nominal.modo);
    const year = Number(archivos.nominal.anio);
    const currentYear = new Date().getFullYear();
    if (modo === 'reemplazar' && (!Number.isInteger(year) || year < 2000 || year > currentYear + 1)) {
      return res.status(400).json({ message: 'Selecciona un año válido para reemplazar la producción nominal.' });
    }
    nominal = { uploads: nominalUploads, modo, anio: modo === 'reemplazar' ? year : null };
  }

  if (!maestros.length && !nominal) return res.status(400).json({ message: 'Selecciona al menos un archivo para importar.' });
  const replaces = maestros.some(item => item.modo === 'reemplazar') || nominal?.modo === 'reemplazar';
  if (replaces && body.confirmacion !== true) {
    return res.status(400).json({ message: 'Confirma que entiendes qué datos se reemplazarán.' });
  }

  const usedUploads = [...maestros.map(item => item.upload), ...(nominal ? nominal.uploads : [])];
  usedUploads.forEach(upload => { upload.inUse = true; });

  const parts = maestros.map(item => `${MAESTROS[item.tipo].label} (${MAESTRO_MODE_LABELS[item.modo].toLowerCase()})`);
  if (nominal) parts.push(`Producción nominal (${nominal.modo === 'reemplazar' ? `reemplazar ${nominal.anio}` : nominal.modo === 'actualizar' ? 'actualizar y acumular' : 'acumular'})`);
  const job = {
    id: crypto.randomUUID(),
    descripcion: parts.join(' · '),
    estado: 'en_proceso',
    fase: 'Preparando',
    usuario: req.user.fullName,
    inicio: new Date().toISOString(),
    fin: null,
    bytesTotal: usedUploads.reduce((sum, upload) => sum + upload.size, 0),
    bytesProcesados: 0,
    filasInsertadas: 0,
    resultados: [],
    error: null,
    log: []
  };
  currentJob = job;
  log(job, `Importación iniciada por ${job.usuario}: ${job.descripcion}.`);

  (async () => {
    try {
      for (const item of maestros) await runMaestro(job, item, encodingOption);
      if (nominal) await runNominal(job, nominal, encodingOption);
      job.estado = 'completado';
      job.fase = 'Importación completada';
      cache.clear();
      // Se recuerda la última importación para mostrarla en Configuración → Estado del sistema.
      ajustes.guardar('ultimaImportacion', { fecha: new Date().toISOString(), usuario: job.usuario, detalle: job.resultados.map(item => item.etiqueta) }, job.usuario)
        .catch(error => console.error('No se pudo guardar la fecha de la última importación:', error.message));
    } catch (error) {
      job.estado = 'error';
      job.fase = 'La importación no se completó';
      job.error = error instanceof ImportError ? error.message : `Error de base de datos: ${describeSqlError(error)}`;
      if (!(error instanceof ImportError)) console.error('Import job error:', error);
      log(job, job.error, 'error');
      if (job.resultados.length) cache.clear();
      if (job.resultados.length) {
        log(job, `Lo importado antes del error (${job.resultados.map(item => item.etiqueta).join(', ')}) sí quedó guardado; lo demás no se modificó.`, 'warn');
      } else {
        log(job, 'No se modificó la base de datos.', 'warn');
      }
    } finally {
      job.fin = new Date().toISOString();
      job.bytesProcesados = job.bytesTotal;
      await Promise.all(usedUploads.map(upload => removeUpload(upload.id)));
    }
  })();

  res.status(202).json(publicJob(job));
};

// Devuelve el estado de la importación en curso o de la última realizada desde que inició el servidor.
const getStatus = (req, res) => {
  res.status(200).json({ trabajo: publicJob(currentJob) });
};

// Totales actuales: filas de cada maestro y producción del año por mes (equivale a «CONTABILIZAR REGISTROS» del script).
const getSummary = async (req, res) => {
  const currentYear = new Date().getFullYear();
  const year = Number(req.query.anio) || currentYear;
  if (!Number.isInteger(year) || year < 2000 || year > currentYear + 1) {
    return res.status(400).json({ message: 'Selecciona un año válido.' });
  }
  try {
    const pool = await poolPromise;
    const maestros = {};
    for (const { table } of Object.values(MAESTROS)) {
      const result = await pool.request()
        .input('tabla', sql.NVarChar(300), `dbo.${table}`)
        .query(`SELECT OBJECT_ID(@tabla, N'U') AS id`);
      if (!result.recordset[0].id) {
        maestros[table] = null;
        continue;
      }
      const count = await pool.request().query(`SELECT COUNT_BIG(*) AS total FROM dbo.${quoteName(table)}`);
      maestros[table] = Number(count.recordset[0].total);
    }

    const columns = await pool.request()
      .input('tabla', sql.NVarChar(300), `dbo.${NOMINAL_TABLE}`)
      .query(`SELECT name FROM sys.columns WHERE object_id = OBJECT_ID(@tabla) AND LOWER(name) IN (N'anio', N'mes')`);
    const names = Object.fromEntries(columns.recordset.map(row => [row.name.toLowerCase(), row.name]));
    const yearExpression = names.anio ? quoteName(names.anio) : 'YEAR(Fecha_Atencion)';
    const monthExpression = names.mes ? `TRY_CONVERT(int, ${quoteName(names.mes)})` : 'MONTH(Fecha_Atencion)';
    const months = await pool.request()
      .input('anio', sql.Int, year)
      .query(`
        SELECT ${monthExpression} AS mes, COUNT_BIG(*) AS total
        FROM dbo.${quoteName(NOMINAL_TABLE)}
        WHERE ${yearExpression} = @anio
        GROUP BY ${monthExpression}
        ORDER BY mes
      `);
    const meses = months.recordset.map(row => ({ mes: row.mes, total: Number(row.total) }));
    res.status(200).json({
      maestros,
      nominal: { anio: year, total: meses.reduce((sum, row) => sum + row.total, 0), meses }
    });
  } catch (error) {
    console.error('Import summary error:', error);
    res.status(503).json({ message: 'No se pudieron consultar los totales actuales.' });
  }
};

module.exports = {
  uploadFile,
  deleteUpload,
  startImport,
  getStatus,
  getSummary,
  // Exportadas para pruebas.
  _internal: { splitFields, readLines, detectEncoding, valueExpression, typeSpec, convertirExcel, textoCelda, esZip, SEPARADOR_EXCEL }
};
