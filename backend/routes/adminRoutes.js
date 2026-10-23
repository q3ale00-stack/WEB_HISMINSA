// Configuración del sistema: solo administradores (la sesión ya se exige en app.js).
const express = require('express');
const { requireAdmin } = require('../controllers/authController');
const ac = require('../controllers/adminController');

const router = express.Router();
router.use(requireAdmin);

router.get('/estado', ac.estado);
router.post('/cache/limpiar', ac.limpiarCache);
router.get('/usuarios', ac.listarUsuarios);
router.patch('/usuarios/:id', ac.actualizarUsuario);
router.post('/usuarios/:id/password', ac.restablecerPassword);
router.post('/usuarios/:id/cerrar-sesiones', ac.cerrarSesiones);
router.get('/accesos', ac.accesos);
router.get('/ajustes', ac.leerAjustes);
router.put('/ajustes', ac.guardarAjustes);

module.exports = router;
