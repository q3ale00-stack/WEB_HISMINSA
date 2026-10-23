// Endpoints para importar maestros y producción nominal desde CSV; solo para administradores.
const express = require('express');
const { requireAdmin } = require('../controllers/authController');
const ic = require('../controllers/importacionController');

const router = express.Router();

router.use(requireAdmin);
// Totales actuales y estado de la importación en curso o de la última realizada.
router.get('/resumen', ic.getSummary);
router.get('/estado', ic.getStatus);
// El archivo se envía como cuerpo binario (application/octet-stream) con su nombre en ?nombre=.
router.post('/archivos', ic.uploadFile);
router.delete('/archivos/:id', ic.deleteUpload);
// Inicia la importación en segundo plano; el progreso se consulta en /estado.
router.post('/ejecutar', ic.startImport);

module.exports = router;
