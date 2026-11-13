// Define búsquedas y consultas de detalle del paciente delegando el acceso a datos al controlador.
const express = require('express');
const router = express.Router();
const pc = require('../controllers/pacientesController');
const { soloPacientePropio } = require('../controllers/alcance');

// La raíz busca pacientes; las rutas restantes exponen verificación, resumen e historial.
router.get('/', pc.getPacientes);
// Un médico restringido solo abre a pacientes que atendió (la lista se filtra dentro de getPacientes).
router.get('/sinadef', soloPacientePropio(req => req.query.documento), pc.checkSinadef);
router.use('/:id', soloPacientePropio());
router.get('/:id/panel', pc.getPanelPaciente);
router.get('/:id/historial', pc.getHistorialPaciente);
router.get('/:id/diagnosticos', pc.getDiagnosticosPaciente);
router.get('/:id/antropometria', pc.getAntropometriaPaciente);
router.get('/:id/resumen', pc.getResumenPaciente);

module.exports = router;
