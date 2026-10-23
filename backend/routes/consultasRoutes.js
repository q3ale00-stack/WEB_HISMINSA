// Agrupa rutas de análisis, indicadores, consultas configurables y datos para el dashboard.
const express = require('express');
const router = express.Router();
const consultasController = require('../controllers/consultasController');

// Metadatos e indicadores describen opciones; dashboard entrega el resumen predefinido.
router.get('/metadata', consultasController.getQueryMetadata);
router.get('/indicadores', consultasController.getIndicadores);
router.get('/dashboard', consultasController.getDashboardResumen);
// Ejecuta una consulta analítica generada desde filtros enviados en el cuerpo JSON.
router.post('/ejecutar', consultasController.executeGenericQuery);
// Actividad detallada de un código HIS específico
router.get('/codigo/:codigo/actividad', consultasController.getActividadCodigo);
// Detalle de citas / atenciones para una fila o filtro
router.post('/detalle-atenciones', consultasController.getDetalleAtenciones);

module.exports = router;
