// Publica catálogos maestros utilizados por formularios y vistas analíticas.
const express = require('express');
const router = express.Router();
const mc = require('../controllers/maestrosController');

// Cada endpoint asocia una ruta de catálogo con su manejador de lectura correspondiente.
router.get('/establecimientos', mc.getEstablecimientos);
router.get('/ups', mc.getUps);
router.get('/personal/:id/actividad', mc.getActividadPersonal);
router.get('/personal', mc.getPersonal);
router.get('/profesiones', mc.getProfesiones);
router.get('/financiadores', mc.getFinanciadores);
router.get('/condiciones-contrato', mc.getCondicionesContrato);
router.get('/tipo-documento', mc.getTipoDocumento);
router.get('/paises', mc.getPaises);
router.get('/etnias', mc.getEtnias);
router.get('/centros-poblados', mc.getCentrosPoblados);
router.get('/instituciones-educativas', mc.getInstitucionesEducativas);
router.get('/colegios', mc.getColegios);
router.get('/cie10', mc.getCie10);
router.get('/cpms', mc.getCpms);
router.get('/items', mc.getItemsHis);
router.get('/laboratorio', mc.getLaboratorio);
router.get('/dosis', mc.getDosis);
router.get('/actividades', mc.getActividades);
router.get('/grupo-riesgo', mc.getGrupoRiesgo);
router.get('/otra-condicion', mc.getOtraCondicion);

module.exports = router;
