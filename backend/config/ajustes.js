// Ajustes del sistema guardados en SQL Server (tabla dbo.HisConfiguracion, clave → valor en JSON).
// Se usan para la seguridad de la sesión y para recordar la última importación.
const { sql, poolPromise } = require('./db');

let listo;
const asegurarTabla = () => {
  if (!listo) {
    listo = poolPromise.then(pool => pool.request().query(`
      IF OBJECT_ID(N'dbo.HisConfiguracion', N'U') IS NULL
      BEGIN
        CREATE TABLE dbo.HisConfiguracion (
          Clave nvarchar(100) NOT NULL CONSTRAINT PK_HisConfiguracion PRIMARY KEY,
          Valor nvarchar(max) NULL,
          ActualizadoEn datetime2(0) NOT NULL CONSTRAINT DF_HisConfiguracion_Fecha DEFAULT SYSUTCDATETIME(),
          ActualizadoPor nvarchar(200) NULL
        );
      END;`)).catch(error => { listo = null; throw error; });
  }
  return listo;
};

async function leer(clave, porDefecto = null) {
  await asegurarTabla();
  const pool = await poolPromise;
  const result = await pool.request().input('clave', sql.NVarChar(100), clave)
    .query('SELECT Valor FROM dbo.HisConfiguracion WHERE Clave = @clave');
  if (!result.recordset.length || result.recordset[0].Valor === null) return porDefecto;
  try { return JSON.parse(result.recordset[0].Valor); } catch (_) { return porDefecto; }
}

async function guardar(clave, valor, usuario = null) {
  await asegurarTabla();
  const pool = await poolPromise;
  await pool.request()
    .input('clave', sql.NVarChar(100), clave)
    .input('valor', sql.NVarChar(sql.MAX), JSON.stringify(valor))
    .input('usuario', sql.NVarChar(200), usuario)
    .query(`
      MERGE dbo.HisConfiguracion AS t
      USING (SELECT @clave AS Clave) AS s ON t.Clave = s.Clave
      WHEN MATCHED THEN UPDATE SET Valor = @valor, ActualizadoEn = SYSUTCDATETIME(), ActualizadoPor = @usuario
      WHEN NOT MATCHED THEN INSERT (Clave, Valor, ActualizadoPor) VALUES (@clave, @valor, @usuario);`);
}

module.exports = { leer, guardar, asegurarTabla };
