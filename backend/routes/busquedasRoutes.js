// Búsquedas de pacientes, atenciones, defunciones y personal (solo lectura, requieren sesión).
// Un médico con acceso restringido solo ve a sus pacientes y sus atenciones (ver controllers/alcance.js).
const express = require('express');
const bc = require('../controllers/busquedasController');
const dc = require('../controllers/defuncionesController');
const { requireAccesoCompleto } = require('../controllers/authController');
const alcance = require('../controllers/alcance');

const router = express.Router();

// Las sugerencias de personal de un médico restringido devuelven solo su propia ficha.
const soloMiFicha = (req, res, next) => {
  if (alcance.esLimitado(req)) req.query = { ...req.query, id: alcance.miPersonal(req) };
  next();
};

router.get('/pacientes/sugerencias', bc.sugerenciasPacientes);
router.get('/pacientes', bc.buscarPacientes);
router.get('/mis-pacientes', bc.misPacientes);
router.get('/pacientes/:id/atenciones', alcance.soloPacientePropio(), bc.atencionesPaciente);
router.get('/pacientes/:id/reporte-mensual', alcance.soloPacientePropio(), bc.reporteMensualPaciente);
router.get('/atenciones/citas', bc.citasPaginadas);
router.get('/atenciones', bc.buscarAtenciones);
router.get('/citas/:id', alcance.soloCitaPropia, bc.detalleCita);
// Defunciones (SINADEF): no disponible para médicos restringidos; la avanzada requiere acceso completo.
router.use('/defunciones', alcance.bloquearLimitado);
router.get('/defunciones/opciones', requireAccesoCompleto, dc.opciones);
router.get('/defunciones/sugerencias', requireAccesoCompleto, dc.sugerencias);
router.get('/defunciones/avanzada', requireAccesoCompleto, dc.buscar);
router.get('/defunciones', bc.buscarDefunciones);
router.get('/personal/resumen', bc.resumenPersonal);
router.get('/personal/sugerencias', soloMiFicha, bc.sugerenciasPersonal);
router.get('/personal/:id/reporte-mensual', alcance.soloPersonalPropio, bc.reporteMensualPersonal);
router.get('/personal', bc.buscarPersonal);

module.exports = router;
