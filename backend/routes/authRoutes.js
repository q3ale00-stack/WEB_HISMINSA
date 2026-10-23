// Endpoints de inicio/cierre de sesión, perfil y administración de cuentas.
const express = require('express');
const auth = require('../controllers/authController');
const { ajustesSesionPublicos } = require('../controllers/adminController');

const router = express.Router();

router.post('/login', auth.limitLoginAttempts, auth.login);
router.post('/logout', auth.requireAuth, auth.logout);
router.get('/session', auth.getSession);
router.get('/me', auth.requireAuth, auth.getProfile);
router.get('/ajustes-sesion', auth.requireAuth, ajustesSesionPublicos);
router.get('/personal', auth.requireAuth, auth.requireAdmin, auth.searchPersonnel);
router.post('/users', auth.requireAuth, auth.requireAdmin, auth.createUser);

module.exports = router;
