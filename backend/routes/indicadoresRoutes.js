// Rutas para la gestión y visualización de indicadores HIS MINSA
const express = require('express');
const router = express.Router();
const indicadoresController = require('../controllers/indicadoresController');

// Obtener catálogo maestro de indicadores
router.get('/maestro', indicadoresController.getMaestroIndicadores);

// Obtener cálculo y detalle de un indicador por ID (ej. /api/indicadores/14)
router.get('/:id', indicadoresController.getIndicador);

module.exports = router;

