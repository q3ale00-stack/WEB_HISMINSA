// Búsqueda nominal del HIS con filtros (estilo tablero Power BI). Solo lectura y con sesión iniciada.
const express = require('express');
const nc = require('../controllers/nominalController');

const router = express.Router();

router.get('/opciones', nc.opciones);
router.get('/sugerencias', nc.sugerencias);
router.get('/', nc.buscar);

module.exports = router;
