// Autenticación de usuarios, perfiles, sesiones y alta administrativa de cuentas.
const crypto = require('crypto');
const { promisify } = require('util');
const { sql, poolPromise } = require('../config/db');
const { ACCESO_DENEGADO } = require('./mensajes');

const scrypt = promisify(crypto.scrypt);
const COOKIE_NAME = 'his_session';
const SESSION_SECONDS = 12 * 60 * 60;
let initializationPromise;
let authAvailable = false;

const publicUser = row => ({
  id: row.IdUsuario,
  username: row.Username,
  role: row.Role,
  fullName: row.FullName,
  dni: row.Dni,
  email: row.Email,
  phone: row.Phone,
  profession: row.Profession || '',
  specialty: row.Specialty || '',
  cmp: row.Cmp || '',
  establishment: row.Establishment || '',
  personalId: row.PersonalId || '',
  // Los administradores siempre tienen acceso completo; los médicos, el que se eligió al crear la cuenta.
  access: row.Role === 'admin' ? 'completo' : (row.Acceso || 'completo'),
  createdAt: row.CreatedAt
});

const ACCESOS = ['completo', 'restringido'];

const hashPassword = async password => {
  const salt = crypto.randomBytes(16);
  const derivedKey = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('hex')}$${derivedKey.toString('hex')}`;
};

const verifyPassword = async (password, storedHash) => {
  const parts = storedHash.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt' || parts[1] !== '16384' || parts[2] !== '8' || parts[3] !== '1') return false;
  const salt = Buffer.from(parts[4], 'hex');
  const expected = Buffer.from(parts[5], 'hex');
  if (salt.length !== 16 || expected.length !== 64) return false;
  const actual = await scrypt(password, salt, expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(actual, expected);
};

const readCookie = (req, name) => {
  const cookies = req.headers.cookie || '';
  for (const cookie of cookies.split(';')) {
    const separator = cookie.indexOf('=');
    if (separator < 0) continue;
    if (cookie.slice(0, separator).trim() === name) return cookie.slice(separator + 1).trim();
  }
  return '';
};

const setSessionCookie = (res, token, maxAge) => {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`);
};

const ensureAuthSchema = async () => {
  const pool = await poolPromise;
  await pool.request().query(`
    IF OBJECT_ID(N'dbo.HisUsuarios', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.HisUsuarios (
        IdUsuario int IDENTITY(1,1) NOT NULL CONSTRAINT PK_HisUsuarios PRIMARY KEY,
        Username nvarchar(100) NOT NULL,
        PasswordHash nvarchar(255) NOT NULL,
        Role nvarchar(20) NOT NULL,
        FullName nvarchar(200) NOT NULL,
        Dni nvarchar(20) NOT NULL,
        Email nvarchar(254) NOT NULL,
        Phone nvarchar(30) NOT NULL,
        Profession nvarchar(120) NULL,
        Specialty nvarchar(120) NULL,
        Cmp nvarchar(50) NULL,
        Establishment nvarchar(200) NULL,
        PersonalId nvarchar(50) NULL,
        IsActive bit NOT NULL CONSTRAINT DF_HisUsuarios_IsActive DEFAULT 1,
        CreatedAt datetime2(0) NOT NULL CONSTRAINT DF_HisUsuarios_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_HisUsuarios_Role CHECK (Role IN (N'admin', N'doctor')),
        CONSTRAINT UQ_HisUsuarios_Username UNIQUE (Username),
        CONSTRAINT UQ_HisUsuarios_Dni UNIQUE (Dni),
        CONSTRAINT UQ_HisUsuarios_Email UNIQUE (Email)
      );
    END;

    IF OBJECT_ID(N'dbo.HisSesiones', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.HisSesiones (
        TokenHash char(64) NOT NULL CONSTRAINT PK_HisSesiones PRIMARY KEY,
        IdUsuario int NOT NULL,
        ExpiresAt datetime2(0) NOT NULL,
        CreatedAt datetime2(0) NOT NULL CONSTRAINT DF_HisSesiones_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_HisSesiones_HisUsuarios FOREIGN KEY (IdUsuario)
          REFERENCES dbo.HisUsuarios(IdUsuario) ON DELETE CASCADE
      );
      CREATE INDEX IX_HisSesiones_User_Expiry ON dbo.HisSesiones(IdUsuario, ExpiresAt);
    END;

    IF OBJECT_ID(N'dbo.HisAccesos', N'U') IS NULL
    BEGIN
      -- Registro de inicios de sesión (correctos y fallidos) para auditoría.
      CREATE TABLE dbo.HisAccesos (
        IdAcceso bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_HisAccesos PRIMARY KEY,
        IdUsuario int NULL,
        Username nvarchar(100) NOT NULL,
        Fecha datetime2(0) NOT NULL CONSTRAINT DF_HisAccesos_Fecha DEFAULT SYSUTCDATETIME(),
        Ip nvarchar(64) NULL,
        Exito bit NOT NULL,
        Detalle nvarchar(200) NULL
      );
      CREATE INDEX IX_HisAccesos_Fecha ON dbo.HisAccesos(Fecha DESC);
    END;

    -- Nivel de acceso de los médicos: «completo» (todo menos la administración) o «restringido»
    -- (solo sus atenciones y la historia de los pacientes que atendió; ver controllers/alcance.js)
    -- Las cuentas que ya existían quedan con acceso completo.
    IF COL_LENGTH(N'dbo.HisUsuarios', N'Acceso') IS NULL
    BEGIN
      ALTER TABLE dbo.HisUsuarios ADD Acceso nvarchar(20) NOT NULL
        CONSTRAINT DF_HisUsuarios_Acceso DEFAULT N'completo'
        CONSTRAINT CK_HisUsuarios_Acceso CHECK (Acceso IN (N'completo', N'restringido'));
    END;
  `);

  const configuredAdmin = [
    process.env.AUTH_ADMIN_USERNAME,
    process.env.AUTH_ADMIN_PASSWORD,
    process.env.AUTH_ADMIN_FULL_NAME,
    process.env.AUTH_ADMIN_DNI,
    process.env.AUTH_ADMIN_EMAIL,
    process.env.AUTH_ADMIN_PHONE
  ];
  const count = await pool.request().query('SELECT COUNT(*) AS total FROM dbo.HisUsuarios');

  if (count.recordset[0].total === 0 && configuredAdmin.every(value => value && value.trim())) {
    if (process.env.AUTH_ADMIN_PASSWORD.length < 12) {
      throw new Error('AUTH_ADMIN_PASSWORD debe tener al menos 12 caracteres.');
    }
    const passwordHash = await hashPassword(process.env.AUTH_ADMIN_PASSWORD);
    await pool.request()
      .input('username', sql.NVarChar(100), process.env.AUTH_ADMIN_USERNAME.trim())
      .input('passwordHash', sql.NVarChar(255), passwordHash)
      .input('fullName', sql.NVarChar(200), process.env.AUTH_ADMIN_FULL_NAME.trim())
      .input('dni', sql.NVarChar(20), process.env.AUTH_ADMIN_DNI.trim())
      .input('email', sql.NVarChar(254), process.env.AUTH_ADMIN_EMAIL.trim().toLowerCase())
      .input('phone', sql.NVarChar(30), process.env.AUTH_ADMIN_PHONE.trim())
      .input('profession', sql.NVarChar(120), 'Administración')
      .input('establishment', sql.NVarChar(200), 'Hospital Miguel A. Mariscal Llerena')
      .query(`
        INSERT INTO dbo.HisUsuarios
          (Username, PasswordHash, Role, FullName, Dni, Email, Phone, Profession, Establishment)
        VALUES
          (@username, @passwordHash, N'admin', @fullName, @dni, @email, @phone, @profession, @establishment)
      `);
    console.log('Initial HIS administrator account created from environment configuration.');
  }

  const userCount = await pool.request().query('SELECT COUNT(*) AS total FROM dbo.HisUsuarios');
  authAvailable = userCount.recordset[0].total > 0;
  if (!authAvailable) {
    console.error('Authentication setup required: configure AUTH_ADMIN_* values in .env to create the first administrator.');
  }
};

const initializeAuth = () => {
  if (!initializationPromise) initializationPromise = ensureAuthSchema();
  return initializationPromise;
};

const requireAuth = async (req, res, next) => {
  try {
    await initializeAuth();
    const token = readCookie(req, COOKIE_NAME);
    if (!token || !authAvailable) {
      return res.status(401).json({ message: 'Inicia sesión para continuar.' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const pool = await poolPromise;
    const result = await pool.request()
      .input('tokenHash', sql.Char(64), tokenHash)
      .query(`
        SELECT u.*
        FROM dbo.HisSesiones s
        INNER JOIN dbo.HisUsuarios u ON u.IdUsuario = s.IdUsuario
        WHERE s.TokenHash = @tokenHash
          AND s.ExpiresAt > SYSUTCDATETIME()
          AND u.IsActive = 1
      `);

    if (!result.recordset.length) return res.status(401).json({ message: 'Tu sesión venció. Inicia sesión nuevamente.' });
    req.user = publicUser(result.recordset[0]);
    req.sessionTokenHash = tokenHash;
    next();
  } catch (error) {
    console.error('Authentication middleware error:', error);
    res.status(503).json({ message: 'El servicio de autenticación no está disponible.' });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ message: ACCESO_DENEGADO, code: 'ACCESO_DENEGADO' });
  next();
};

// Búsquedas avanzadas y Consultas: administradores y médicos con acceso completo.
const requireAccesoCompleto = (req, res, next) => {
  if (req.user?.access !== 'completo') {
    return res.status(403).json({ message: ACCESO_DENEGADO, code: 'ACCESO_DENEGADO' });
  }
  next();
};

const login = async (req, res) => {
  const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!username || !password || username.length > 100 || password.length > 256) {
    return res.status(400).json({ message: 'Ingresa un usuario y una contraseña válidos.' });
  }

  try {
    await initializeAuth();
    if (!authAvailable) {
      return res.status(503).json({ message: 'El administrador inicial aún no está configurado en el servidor.' });
    }

    const pool = await poolPromise;
    const result = await pool.request()
      .input('username', sql.NVarChar(100), username)
      .query('SELECT TOP 1 * FROM dbo.HisUsuarios WHERE Username = @username AND IsActive = 1');
    const user = result.recordset[0];
    if (!user || !(await verifyPassword(password, user.PasswordHash))) {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const attempt = failedLoginAttempts.get(ip);
      if (attempt && attempt.resetAt > Date.now()) attempt.count += 1;
      await registrarAcceso({ idUsuario: user?.IdUsuario ?? null, username, ip, exito: false, detalle: user ? 'Contraseña incorrecta' : 'Usuario no existe o está desactivado' });
      return res.status(401).json({ message: 'Usuario o contraseña incorrectos.' });
    }

    failedLoginAttempts.delete(req.ip || req.socket.remoteAddress || 'unknown');
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await pool.request()
      .input('tokenHash', sql.Char(64), tokenHash)
      .input('userId', sql.Int, user.IdUsuario)
      .input('expiresAt', sql.DateTime2, new Date(Date.now() + SESSION_SECONDS * 1000))
      .query('INSERT INTO dbo.HisSesiones (TokenHash, IdUsuario, ExpiresAt) VALUES (@tokenHash, @userId, @expiresAt)');

    setSessionCookie(res, token, SESSION_SECONDS);
    await registrarAcceso({ idUsuario: user.IdUsuario, username, ip: req.ip || req.socket.remoteAddress, exito: true });
    res.status(200).json({ user: publicUser(user) });
  } catch (error) {
    console.error('Login error:', error);
    res.status(503).json({ message: 'No se pudo iniciar sesión en este momento.' });
  }
};

// Guarda un intento de inicio de sesión; si falla el registro, el inicio de sesión sigue normalmente.
const registrarAcceso = async ({ idUsuario = null, username, ip, exito, detalle = null }) => {
  try {
    const pool = await poolPromise;
    await pool.request()
      .input('idUsuario', sql.Int, idUsuario)
      .input('username', sql.NVarChar(100), String(username || '').slice(0, 100))
      .input('ip', sql.NVarChar(64), String(ip || '').slice(0, 64))
      .input('exito', sql.Bit, exito ? 1 : 0)
      .input('detalle', sql.NVarChar(200), detalle)
      .query('INSERT INTO dbo.HisAccesos (IdUsuario, Username, Ip, Exito, Detalle) VALUES (@idUsuario, @username, @ip, @exito, @detalle)');
  } catch (error) {
    console.error('No se pudo registrar el acceso:', error.message);
  }
};

const getProfile = (req, res) => res.status(200).json({ user: req.user });

const getSession = async (req, res) => {
  try {
    await initializeAuth();
    const token = readCookie(req, COOKIE_NAME);
    if (!token || !authAvailable) return res.status(200).json({ user: null });

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const pool = await poolPromise;
    const result = await pool.request()
      .input('tokenHash', sql.Char(64), tokenHash)
      .query(`
        SELECT u.*
        FROM dbo.HisSesiones s
        INNER JOIN dbo.HisUsuarios u ON u.IdUsuario = s.IdUsuario
        WHERE s.TokenHash = @tokenHash
          AND s.ExpiresAt > SYSUTCDATETIME()
          AND u.IsActive = 1
      `);
    res.status(200).json({ user: result.recordset.length ? publicUser(result.recordset[0]) : null });
  } catch (error) {
    console.error('Session restore error:', error);
    res.status(503).json({ message: 'No se pudo comprobar la sesión en este momento.' });
  }
};

const logout = async (req, res) => {
  try {
    const pool = await poolPromise;
    await pool.request()
      .input('tokenHash', sql.Char(64), req.sessionTokenHash)
      .query('DELETE FROM dbo.HisSesiones WHERE TokenHash = @tokenHash');
    setSessionCookie(res, '', 0);
    res.status(200).json({ message: 'Sesión cerrada.' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(503).json({ message: 'No se pudo cerrar la sesión en el servidor.' });
  }
};

const failedLoginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 8;

const limitLoginAttempts = (req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const record = failedLoginAttempts.get(ip);
  if (!record || record.resetAt <= now) {
    failedLoginAttempts.set(ip, { count: 0, resetAt: now + LOGIN_WINDOW_MS });
  }
  const current = failedLoginAttempts.get(ip);
  if (current.count >= MAX_LOGIN_ATTEMPTS) {
    res.setHeader('Retry-After', String(Math.ceil((current.resetAt - now) / 1000)));
    return res.status(429).json({ message: 'Demasiados intentos de inicio de sesión. Inténtalo más tarde.' });
  }
  next();
};

const searchPersonnel = async (req, res) => {
  const term = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (term.length < 2) return res.status(200).json([]);

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('term', sql.NVarChar(100), `%${term}%`)
      .query(`
        SELECT TOP 30
          p.Id_Personal AS personalId,
          p.Numero_Documento_Personal AS dni,
          LTRIM(RTRIM(CONCAT(p.Apellido_Paterno_Personal, ' ', p.Apellido_Materno_Personal, ' ', p.Nombres_Personal))) AS fullName,
          pr.Descripcion_Profesion AS profession,
          p.Numero_Colegiatura AS cmp,
          e.Nombre_Establecimiento AS establishment
        FROM dbo.MaestroPersonal p
        LEFT JOIN dbo.MAESTRO_HIS_PROFESION pr ON p.Id_Profesion = pr.Id_Profesion
        LEFT JOIN dbo.MAESTRO_HIS_ESTABLECIMIENTO e ON p.Id_Establecimiento = e.Id_Establecimiento
        WHERE (
          p.Numero_Documento_Personal LIKE @term
          OR p.Apellido_Paterno_Personal LIKE @term
          OR p.Apellido_Materno_Personal LIKE @term
          OR p.Nombres_Personal LIKE @term
        )
          AND pr.Descripcion_Profesion LIKE N'MEDICO%'
        ORDER BY p.Apellido_Paterno_Personal, p.Apellido_Materno_Personal, p.Nombres_Personal
      `);
    res.status(200).json(result.recordset);
  } catch (error) {
    console.error('Personnel lookup error:', error);
    res.status(503).json({ message: 'No se pudo consultar el catálogo de personal.' });
  }
};

const createUser = async (req, res) => {
  const { username, password, role, fullName, dni, email, phone, specialty, personalId, access } = req.body;
  const normalizedRole = typeof role === 'string' ? role : '';
  if (!['admin', 'doctor'].includes(normalizedRole)) return res.status(400).json({ message: 'Selecciona un rol válido.' });
  if (normalizedRole === 'doctor' && !ACCESOS.includes(access)) return res.status(400).json({ message: 'Elige el nivel de acceso del médico.' });
  const acceso = normalizedRole === 'doctor' ? access : 'completo';
  if (typeof username !== 'string' || username.trim().length < 3 || username.trim().length > 100) {
    return res.status(400).json({ message: 'El usuario debe tener entre 3 y 100 caracteres.' });
  }
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) {
    return res.status(400).json({ message: 'La contraseña debe tener al menos 12 caracteres.' });
  }
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.length > 254) {
    return res.status(400).json({ message: 'Ingresa un correo electrónico válido.' });
  }
  if (typeof phone !== 'string' || phone.trim().length < 6 || phone.trim().length > 30) {
    return res.status(400).json({ message: 'Ingresa un teléfono válido.' });
  }
  if (typeof specialty !== 'string' || specialty.trim().length > 120) {
    return res.status(400).json({ message: 'La especialidad no puede superar 120 caracteres.' });
  }
  if (normalizedRole === 'doctor' && !specialty.trim()) {
    return res.status(400).json({ message: 'Ingresa la especialidad del médico.' });
  }

  try {
    const pool = await poolPromise;
    let profile;
    if (normalizedRole === 'doctor') {
      if (typeof personalId !== 'string' || !personalId.trim()) {
        return res.status(400).json({ message: 'Selecciona al médico del catálogo de personal.' });
      }
      const personResult = await pool.request()
        .input('personalId', sql.NVarChar(50), personalId.trim())
        .query(`
          SELECT TOP 1
            p.Id_Personal AS personalId,
            p.Numero_Documento_Personal AS dni,
            LTRIM(RTRIM(CONCAT(p.Apellido_Paterno_Personal, ' ', p.Apellido_Materno_Personal, ' ', p.Nombres_Personal))) AS fullName,
            pr.Descripcion_Profesion AS profession,
            p.Numero_Colegiatura AS cmp,
            e.Nombre_Establecimiento AS establishment
          FROM dbo.MaestroPersonal p
          LEFT JOIN dbo.MAESTRO_HIS_PROFESION pr ON p.Id_Profesion = pr.Id_Profesion
          LEFT JOIN dbo.MAESTRO_HIS_ESTABLECIMIENTO e ON p.Id_Establecimiento = e.Id_Establecimiento
          WHERE p.Id_Personal = @personalId
            AND pr.Descripcion_Profesion LIKE N'MEDICO%'
        `);
      if (!personResult.recordset.length) return res.status(400).json({ message: 'El médico seleccionado ya no está disponible en el catálogo.' });
      const person = personResult.recordset[0];
      profile = {
        fullName: person.fullName,
        dni: person.dni,
        profession: person.profession || '',
        cmp: person.cmp || '',
        establishment: person.establishment || '',
        personalId: person.personalId
      };
    } else {
      if (typeof fullName !== 'string' || fullName.trim().length < 3 || fullName.trim().length > 200) {
        return res.status(400).json({ message: 'Ingresa el nombre completo.' });
      }
      if (typeof dni !== 'string' || dni.trim().length < 8 || dni.trim().length > 20) {
        return res.status(400).json({ message: 'Ingresa un DNI válido.' });
      }
      profile = {
        fullName: fullName.trim(),
        dni: dni.trim(),
        profession: 'Administración',
        cmp: '',
        establishment: 'Hospital Miguel A. Mariscal Llerena',
        personalId: ''
      };
    }

    if (!profile.dni) return res.status(400).json({ message: 'El registro seleccionado no tiene un documento de identidad.' });
    const passwordHash = await hashPassword(password);
    const created = await pool.request()
      .input('username', sql.NVarChar(100), username.trim())
      .input('passwordHash', sql.NVarChar(255), passwordHash)
      .input('role', sql.NVarChar(20), normalizedRole)
      .input('fullName', sql.NVarChar(200), profile.fullName)
      .input('dni', sql.NVarChar(20), profile.dni)
      .input('email', sql.NVarChar(254), email.trim().toLowerCase())
      .input('phone', sql.NVarChar(30), phone.trim())
      .input('profession', sql.NVarChar(120), profile.profession)
      .input('specialty', sql.NVarChar(120), specialty.trim())
      .input('cmp', sql.NVarChar(50), profile.cmp)
      .input('establishment', sql.NVarChar(200), profile.establishment)
      .input('personalId', sql.NVarChar(50), profile.personalId)
      .input('acceso', sql.NVarChar(20), acceso)
      .query(`
        INSERT INTO dbo.HisUsuarios
          (Username, PasswordHash, Role, FullName, Dni, Email, Phone, Profession, Specialty, Cmp, Establishment, PersonalId, Acceso)
        OUTPUT INSERTED.IdUsuario
        VALUES
          (@username, @passwordHash, @role, @fullName, @dni, @email, @phone, @profession, @specialty, @cmp, @establishment, @personalId, @acceso)
      `);
    res.status(201).json({ id: created.recordset[0].IdUsuario, message: 'La cuenta fue creada.' });
  } catch (error) {
    if (error.number === 2627 || error.number === 2601) {
      return res.status(409).json({ message: 'El nombre de usuario, DNI o correo ya está registrado.' });
    }
    console.error('Create user error:', error);
    res.status(503).json({ message: 'No se pudo crear la cuenta.' });
  }
};

module.exports = {
  hashPassword,
  initializeAuth,
  requireAuth,
  requireAdmin,
  requireAccesoCompleto,
  limitLoginAttempts,
  login,
  getProfile,
  getSession,
  logout,
  searchPersonnel,
  createUser
};
