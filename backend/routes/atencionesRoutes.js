// Define endpoints de lectura relacionados con atenciones y sus reportes.
const express = require('express');
const router = express.Router();
const atencionesController = require('../controllers/atencionesController');

// El reporte agregado se expone únicamente mediante GET y no altera registros HIS.
router.get('/filtros-produccion', atencionesController.getFiltrosProduccion);
router.get('/reportes', atencionesController.getReportes);

module.exports = router;
