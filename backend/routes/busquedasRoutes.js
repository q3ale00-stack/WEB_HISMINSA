// Búsquedas de pacientes, atenciones, defunciones y personal (solo lectura, requieren sesión).
const express = require('express');
const bc = require('../controllers/busquedasController');
const dc = require('../controllers/defuncionesController');

const router = express.Router();

router.get('/pacientes/sugerencias', bc.sugerenciasPacientes);
router.get('/pacientes', bc.buscarPacientes);
router.get('/pacientes/:id/atenciones', bc.atencionesPaciente);
router.get('/pacientes/:id/reporte-mensual', bc.reporteMensualPaciente);
router.get('/atenciones', bc.buscarAtenciones);
router.get('/citas/:id', bc.detalleCita);
router.get('/defunciones/opciones', dc.opciones);
router.get('/defunciones/sugerencias', dc.sugerencias);
router.get('/defunciones/avanzada', dc.buscar);
router.get('/defunciones', bc.buscarDefunciones);
router.get('/personal/resumen', bc.resumenPersonal);
router.get('/personal/:id/reporte-mensual', bc.reporteMensualPersonal);
router.get('/personal', bc.buscarPersonal);

module.exports = router;
