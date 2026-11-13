// Búsqueda nominal del HIS con filtros (estilo tablero Power BI). Solo lectura y con sesión iniciada.
// Un médico «solo sus pacientes» también la usa: el controlador limita los resultados a sus pacientes o a sus
// atenciones (ver filtroAlcance en nominalController.js y controllers/alcance.js).
const express = require('express');
const nc = require('../controllers/nominalController');

const router = express.Router();

router.get('/opciones', nc.opciones);
router.get('/sugerencias', nc.sugerencias);
router.get('/', nc.buscar);

module.exports = router;
