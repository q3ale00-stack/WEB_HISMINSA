// Configura la aplicación HTTP: middleware común, archivos estáticos y montaje de las rutas de la API.
const express = require('express');
const cors = require('cors');
const path = require('path');

const maestrosRoutes = require('./routes/maestrosRoutes');
const pacientesRoutes = require('./routes/pacientesRoutes');
const atencionesRoutes = require('./routes/atencionesRoutes');
const consultasRoutes = require('./routes/consultasRoutes');
const authRoutes = require('./routes/authRoutes');
const importacionRoutes = require('./routes/importacionRoutes');
const busquedasRoutes = require('./routes/busquedasRoutes');
const catalogosRoutes = require('./routes/catalogosRoutes');
const nominalRoutes = require('./routes/nominalRoutes');
const adminRoutes = require('./routes/adminRoutes');
const { requireAuth } = require('./controllers/authController');

const app = express();
// La interfaz estática se sirve desde la carpeta frontend hermana de backend.
const frontendDirectory = path.resolve(__dirname, '../frontend');

// Permite CORS solo al origen explícito cuando el frontend se aloja aparte; el modo local usa mismo origen.
const allowedFrontendOrigin = process.env.CORS_ORIGIN;
app.use(cors(allowedFrontendOrigin ? { origin: allowedFrontendOrigin, credentials: true } : { origin: false }));
// Analiza JSON con un límite de tamaño y publica el frontend.
app.use(express.json({ limit: '1mb' }));
app.use(express.static(frontendDirectory));

// Comprueba disponibilidad del proceso sin hacer una consulta a la base de datos.
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'his-minsa-api' });
});

// La autenticación es pública solo para login; el resto de la API requiere sesión válida.
app.use('/api/auth', authRoutes);
app.use('/api', requireAuth);

// Cada grupo de endpoints queda bajo un prefijo estable y protegido de la API.
app.use('/api/maestros', maestrosRoutes);
app.use('/api/pacientes', pacientesRoutes);
app.use('/api/atenciones', atencionesRoutes);
app.use('/api/consultas', consultasRoutes);
// Búsquedas de pacientes, atenciones, defunciones y personal.
app.use('/api/busqueda', busquedasRoutes);
// Catálogos (tablas maestras) del HIS.
app.use('/api/catalogos', catalogosRoutes);
// Búsqueda nominal con filtros (vista Pacientes).
app.use('/api/nominal', nominalRoutes);
// Configuración del sistema (solo administradores).
app.use('/api/admin', adminRoutes);
// Importación de datos: solo administradores (la restricción se aplica dentro del router).
app.use('/api/importacion', importacionRoutes);

module.exports = app;