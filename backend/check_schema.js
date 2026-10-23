const { sql, poolPromise } = require('./config/db');

// Consulta columnas de tablas relevantes para diagnosticar el esquema configurado.
async function checkDatabase() {
    try {
        // Espera el pool compartido y consulta el catálogo de metadatos de SQL Server.
        const pool = await poolPromise;
        const result = await pool.request().query(`
            -- Inspecciona tablas maestras HIS y tablas de referencia usadas por la aplicación.
            SELECT TABLE_NAME, COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME LIKE 'MAESTRO_HIS_%' OR TABLE_NAME IN ('MaestroPaciente', 'MaestroPersonal', 'NProduccion')
        `);
        console.log(JSON.stringify(result.recordset, null, 2));
    } catch (err) {
        // Muestra errores de conexión o consulta para el diagnóstico desde consola.
        console.error('Error:', err);
    } finally {
        // Cierra el proceso de diagnóstico aunque la consulta falle.
        process.exit();
    }
}

checkDatabase();
