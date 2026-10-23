// Centraliza la conexión a SQL Server y el reintento común de operaciones con fallos transitorios.
const sql = require('mssql');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

// Obtiene los datos de conexión del entorno y usa SQL Server local si no hay host configurado.
const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER ? process.env.DB_SERVER.split('\\')[0] : 'localhost',
  database: process.env.DB_DATABASE,
  port: parseInt(process.env.DB_PORT || '1433'),
  connectionTimeout: 30000, // 30 s para establecer la conexión inicial
  requestTimeout: 60000,    // 60 s para las consultas analíticas de Producción sobre NProduccion
  options: {
    encrypt: false, 
    trustServerCertificate: true,
    // Como hemos especificado el puerto (56578), omitimos el instanceName 
    // para evitar que intente buscar la instancia en el SQL Browser (lo que causa el EINSTLOOKUP)
    enableArithAbort: true,
    cryptoCredentialsDetails: {
        minVersion: 'TLSv1'
    }
  },
  pool: {
    max: 35,                    // consultas simultáneas de los tableros de Producción
    min: 2,                     // conexiones listas para responder
    idleTimeoutMillis: 60000,
    acquireTimeoutMillis: 45000
  }
};

// Pool con reconexión automática: si SQL Server se reinicia o se cae la red, la siguiente
// solicitud crea un pool nuevo en lugar de quedarse con uno cerrado.
let currentPool = null;

const createPool = () => {
  const pool = new sql.ConnectionPool(config);
  pool.on('error', err => {
    console.error('SQL Server Pool connection error:', err.message || err);
    currentPool = null;
  });
  return pool.connect().then(p => {
    console.log('Connected to SQL Server 2022');
    return p;
  }).catch(err => {
    // Mantiene disponible la interfaz y la API aunque SQL Server no esté configurado o accesible.
    console.error('Database Connection Failed! Bad Config: ', err.message || err);
    currentPool = null;
    throw err;
  });
};

const getPool = async () => {
  if (!currentPool) currentPool = createPool();
  try {
    const pool = await currentPool;
    if (!pool.connected) {
      currentPool = createPool();
      return await currentPool;
    }
    return pool;
  } catch (err) {
    currentPool = null;
    throw err;
  }
};

// Se usa igual que antes (await poolPromise) pero pasa por getPool en cada uso.
const poolPromise = {
  then(onFulfilled, onRejected) { return getPool().then(onFulfilled, onRejected); },
  catch(onRejected) { return getPool().catch(onRejected); }
};

// Conecta al iniciar; el error queda registrado y se reintenta en la siguiente solicitud.
getPool().catch(() => {});

// Reintenta hasta tres veces solo ante errores de conexión transitorios reconocidos.
const withTransientRetry = async operation => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await operation();
    } catch (error) {
      // La pausa incremental evita reintentos inmediatos; los errores permanentes se propagan.
      // Una consulta que agotó su tiempo (RequestError) volvería a tardar lo mismo: no se reintenta.
      const queryTimeout = error.name === 'RequestError' && error.code === 'ETIMEOUT';
      const transient = ['ESOCKET', 'ECONNRESET', 'ETIMEOUT', 'ENOTOPEN'].includes(error.code) && !queryTimeout;
      if (!transient || attempt === 2) throw error;
      currentPool = null; // ante una caída de socket se recrea el pool
      await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
};

module.exports = {
  sql,
  config,
  poolPromise,
  getPool,
  withTransientRetry
};
