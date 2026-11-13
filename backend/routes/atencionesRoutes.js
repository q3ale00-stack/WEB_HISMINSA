// Define endpoints de lectura relacionados con atenciones y sus reportes.
const express = require('express');
const router = express.Router();
const atencionesController = require('../controllers/atencionesController');
const { forzarMiPersonal } = require('../controllers/alcance');

// El reporte agregado se expone únicamente mediante GET y no altera registros HIS.
router.get('/filtros-produccion', atencionesController.getFiltrosProduccion);
// Un médico restringido ve solo su propia producción: se fija ?idPersonal= al suyo.
router.get('/reportes', forzarMiPersonal, atencionesController.getReportes);
router.get('/citas-dia', forzarMiPersonal, atencionesController.getCitasDia);

module.exports = router;
