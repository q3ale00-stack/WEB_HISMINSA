// Punto de entrada: carga variables de entorno, crea la aplicación y abre el puerto HTTP.
const path = require('path');
const projectRoot = path.resolve(__dirname, '..');
// Busca .env en la raíz del proyecto para mantener la configuración fuera del código.
require('dotenv').config({ path: path.join(projectRoot, '.env') });

const app = require('./app');
const { initializeAuth } = require('./controllers/authController');
// Permite configurar el puerto por entorno y usa 3000 como valor predeterminado.
const port = Number(process.env.PORT) || 3000;

// Inicia el servidor y confirma en consola el puerto que quedó activo.
const server = app.listen(port, () => {
  console.log(`HIS MINSA server listening on port ${port}`);
});
// Amplía el tiempo para recibir una petición completa (por defecto 5 min) para subir CSV grandes de la trama nominal.
server.requestTimeout = 30 * 60 * 1000;

// Prepara las tablas de autenticación y el administrador inicial sin impedir servir la interfaz.
initializeAuth().catch(error => {
  console.error('Authentication initialization failed:', error.message);
});
