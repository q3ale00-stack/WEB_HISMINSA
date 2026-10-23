const { poolPromise } = require('./config/db');

async function addIndexes() {
  const pool = await poolPromise;
  console.log('Checking and adding indexes for high-speed performance...');
  
  const indexStatements = [
    {
      name: 'IX_NProduccion_Fecha',
      sql: `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_NProduccion_Fecha' AND object_id = OBJECT_ID('NProduccion'))
            CREATE NONCLUSTERED INDEX IX_NProduccion_Fecha ON NProduccion(Fecha_Atencion)
            INCLUDE (Id_Cita, Id_Paciente, Codigo_Item, Id_Personal, Id_Establecimiento, Tipo_Diagnostico);`
    },
    {
      name: 'IX_NProduccion_Anio_Mes',
      sql: `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_NProduccion_Anio_Mes' AND object_id = OBJECT_ID('NProduccion'))
            CREATE NONCLUSTERED INDEX IX_NProduccion_Anio_Mes ON NProduccion(Anio, Mes)
            INCLUDE (Id_Cita, Id_Paciente, Codigo_Item, Id_Personal, Id_Establecimiento);`
    },
    {
      name: 'IX_NProduccion_Personal',
      sql: `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_NProduccion_Personal' AND object_id = OBJECT_ID('NProduccion'))
            CREATE NONCLUSTERED INDEX IX_NProduccion_Personal ON NProduccion(Id_Personal, Fecha_Atencion)
            INCLUDE (Id_Cita, Id_Paciente, Codigo_Item);`
    },
    {
      name: 'IX_NProduccion_Establecimiento',
      sql: `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_NProduccion_Establecimiento' AND object_id = OBJECT_ID('NProduccion'))
            CREATE NONCLUSTERED INDEX IX_NProduccion_Establecimiento ON NProduccion(Id_Establecimiento, Fecha_Atencion)
            INCLUDE (Id_Cita, Id_Paciente, Codigo_Item);`
    },
    {
      name: 'IX_NProduccion_Codigo_Item',
      sql: `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_NProduccion_Codigo_Item' AND object_id = OBJECT_ID('NProduccion'))
            CREATE NONCLUSTERED INDEX IX_NProduccion_Codigo_Item ON NProduccion(Codigo_Item, Fecha_Atencion)
            INCLUDE (Id_Cita, Id_Paciente, Id_Personal, Id_Establecimiento);`
    },
    {
      name: 'IX_MaestroPaciente_Doc_Nom',
      sql: `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_MaestroPaciente_Doc_Nom' AND object_id = OBJECT_ID('MaestroPaciente'))
            CREATE NONCLUSTERED INDEX IX_MaestroPaciente_Doc_Nom ON MaestroPaciente(Numero_Documento_Paciente)
            INCLUDE (Apellido_Paterno_Paciente, Apellido_Materno_Paciente, Nombres_Paciente, Historia_Clinica);`
    }
  ];

  for (const item of indexStatements) {
    const start = Date.now();
    process.stdout.write(`Creating index ${item.name}... `);
    await pool.request().query(item.sql);
    console.log(`Done in ${Date.now() - start}ms`);
  }

  console.log('All indexes created successfully!');
  process.exit(0);
}

addIndexes().catch(e => {
  console.error('Error creating indexes:', e);
  process.exit(1);
});
