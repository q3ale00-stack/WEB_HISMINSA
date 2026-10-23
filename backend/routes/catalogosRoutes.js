// Catálogos (tablas maestras) del HIS; solo lectura y con sesión iniciada.
const express = require('express');
const cc = require('../controllers/catalogosController');

const router = express.Router();

router.get('/', cc.listarCatalogos);
router.get('/:tabla', cc.consultarCatalogo);

module.exports = router;
