// Agrupa rutas de análisis, indicadores, consultas configurables y datos para el dashboard.
const express = require('express');
const router = express.Router();
const consultasController = require('../controllers/consultasController');
const { requireAccesoCompleto } = require('../controllers/authController');

// Metadatos e indicadores describen opciones; dashboard entrega el resumen predefinido.
router.get('/metadata', consultasController.getQueryMetadata);
router.get('/indicadores', requireAccesoCompleto, consultasController.getIndicadores);
router.get('/dashboard', consultasController.getDashboardResumen);
// Ejecuta una consulta analítica generada desde filtros enviados en el cuerpo JSON.
// El constructor de consultas y su detalle por fila requieren acceso completo; metadata, dashboard y
// la actividad de un código los usan también Inicio y las fichas, así que quedan abiertos.
router.post('/ejecutar', requireAccesoCompleto, consultasController.executeGenericQuery);
// Actividad detallada de un código HIS específico
router.get('/codigo/:codigo/actividad', consultasController.getActividadCodigo);
// Detalle de citas / atenciones para una fila o filtro
router.post('/detalle-atenciones', requireAccesoCompleto, consultasController.getDetalleAtenciones);

module.exports = router;
