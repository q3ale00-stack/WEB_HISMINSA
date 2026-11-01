// Controlador de Indicadores de Gestión y Desempeño HIS MINSA
const { poolPromise, sql } = require('../config/db');
const cache = require('../config/cache');

// Obtiene el catálogo de todos los indicadores registrados en MAESTRO_HIS_INDICADOR
const getMaestroIndicadores = async (req, res) => {
  try {
    const cacheKey = 'maestro_his_indicadores';
    const cached = cache.get(cacheKey);
    if (cached) return res.status(200).json(cached);

    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT 
        Id_Indicador,
        Tipo_Indicador,
        Descripcion_Indicador
      FROM MAESTRO_HIS_INDICADOR WITH (NOLOCK)
      ORDER BY 
        CASE 
          WHEN TRY_CAST(Id_Indicador AS FLOAT) IS NOT NULL THEN TRY_CAST(Id_Indicador AS FLOAT)
          ELSE 999 
        END,
        Id_Indicador
    `);

    const indicadores = result.recordset || [];
    cache.set(cacheKey, indicadores, 600); // 10 minutos
    res.status(200).json(indicadores);
  } catch (error) {
    console.error('Error al obtener catálogo de indicadores:', error);
    res.status(500).json({ error: 'Error al obtener indicadores', message: error.message });
  }
};

// Obtiene el cálculo y detalle de un indicador según su programación específica
const getIndicador = async (req, res) => {
  const { id } = req.params;

  // Si no es el indicador 14, se devuelven los metadatos oficiales indicando su fase de formulación
  if (id !== '14') {
    try {
      const pool = await poolPromise;
      const r = await pool.request()
        .input('id', sql.VarChar(10), String(id))
        .query('SELECT Id_Indicador, Tipo_Indicador, Descripcion_Indicador FROM MAESTRO_HIS_INDICADOR WITH (NOLOCK) WHERE Id_Indicador = @id');
      
      const info = r.recordset[0] || { Id_Indicador: id, Tipo_Indicador: 'Indicador', Descripcion_Indicador: 'Indicador ' + id };
      return res.status(200).json({
        disponible: false,
        indicador: info,
        mensaje: `El motor de cálculo para el Indicador ${id} está en desarrollo. Seleccione el Indicador 14 para visualizar el análisis completo.`
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  //  PROGRAMACIÓN ESPECÍFICA: INDICADOR 14 (CÁNCERES PREVALENTES)
  // ═════════════════════════════════════════════════════════════════════
  try {
    const anio = req.query.anio ? parseInt(req.query.anio) : 2026;
    const fechaInicio = req.query.fechaInicio || `${anio}-01-01`;
    const fechaFin = req.query.fechaFin || `${anio}-12-31`;
    const codRenaes = req.query.codRenaes ? String(req.query.codRenaes).trim() : '35125'; // Hospital Regional de Ayacucho por defecto
    const tipoCancerFiltro = req.query.tipoCancer ? String(req.query.tipoCancer).trim() : null;

    const cacheKey = `ind14_v4_${anio}_${fechaInicio}_${fechaFin}_${codRenaes}_${tipoCancerFiltro || 'ALL'}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.status(200).json(cached);

    const pool = await poolPromise;
    const request = pool.request();
    request.input('fechaInicio', sql.Date, fechaInicio);
    request.input('fechaFin', sql.Date, fechaFin);
    request.input('codRenaes', sql.VarChar(50), codRenaes || null);
    request.input('tipoCancerFiltro', sql.VarChar(50), tipoCancerFiltro || null);

    const query = `
      SET NOCOUNT ON;

      -- 1. Filtrar RENAES (Establecimiento de salud, 35125 por defecto)
      IF OBJECT_ID('tempdb..#Renaes_Anexo01') IS NOT NULL DROP TABLE #Renaes_Anexo01;
      SELECT r.Codigo_Unico cod_estab
      INTO #Renaes_Anexo01
      FROM [MAESTRO_HIS_ESTABLECIMIENTO] r WITH (NOLOCK)
      WHERE (@codRenaes IS NULL OR @codRenaes = '' OR TRY_CONVERT(INT, r.Codigo_Unico) = TRY_CONVERT(INT, @codRenaes));

      -- 2. Universo de registros para el cálculo de Indicador 14
      IF OBJECT_ID('tempdb..#his_minsa') IS NOT NULL DROP TABLE #his_minsa;
      SELECT 
          e.Codigo_Unico AS renaes,
          np.Edad_Reg AS edad_reg,
          np.Tipo_Edad AS id_tipedad_reg,
          RTRIM(LTRIM(p.Id_Genero)) AS id_genero,
          CONVERT(DATE, np.Fecha_Atencion) AS Fecha_Atencion,
          p.Id_Tipo_Documento_Paciente AS id_tipo_doc,
          RTRIM(LTRIM(p.Numero_Documento_Paciente)) AS num_doc,
          np.Id_Cita AS id_cita,
          RTRIM(LTRIM(np.Tipo_Diagnostico)) AS id_tipitem,
          CONVERT(INT, np.Id_Correlativo_Lab) AS id_lab,
          NULLIF(RTRIM(LTRIM(np.Valor_Lab)), '') AS valor_lab,
          CONVERT(INT, np.Id_Correlativo_Item) AS id_cod_item,
          RTRIM(LTRIM(np.Codigo_Item)) AS cod_item,
          RTRIM(LTRIM(ISNULL(p.Apellido_Paterno_Paciente,'') + ' ' + ISNULL(p.Apellido_Materno_Paciente,'') + ', ' + ISNULL(p.Nombres_Paciente,''))) AS Paciente,
          e.Nombre_Establecimiento AS Establecimiento,
          e.Disa,
          e.Provincia,
          e.Distrito,
          e.Categoria_Establecimiento AS Categoria
      INTO #his_minsa
      FROM NProduccion np WITH (NOLOCK)
      INNER JOIN MaestroPaciente p WITH (NOLOCK) ON p.Id_Paciente = np.Id_Paciente
      INNER JOIN MAESTRO_HIS_ESTABLECIMIENTO e WITH (NOLOCK) ON e.Id_Establecimiento = np.Id_Establecimiento
      INNER JOIN #Renaes_Anexo01 r ON TRY_CONVERT(INT, e.Codigo_Unico) = TRY_CONVERT(INT, r.cod_estab)
      -- Se extrae hasta 37 días después del fin: un diagnóstico del final del periodo puede tratarse después.
      WHERE np.Fecha_Atencion >= @fechaInicio AND np.Fecha_Atencion < DATEADD(DAY, 38, @fechaFin)
        AND np.Codigo_Item IN (
          -- CÓDIGOS DE CÁNCERES PREVALENTES Y PROCEDIMIENTOS DIAGNÓSTICOS (DENOMINADOR)
          'C530','C531','C532','C533','C534','C535','C536','C537','C538','C539','57500','58100',
          'C500','C501','C502','C503','C504','C505','C506','C507','C508','C509','19100','19101','19102',
          'C61X','55700','55705','55706',
          'C180','C181','C182','C183','C184','C185','C186','C187','C188','C189','C19X','C20X','44388','44389','45359','45358',
          'C160','C161','C162','C163','C164','C165','C166','C167','C168','C169','43234','43600',
          'C430','C431','C432','C433','C434','C435','C436','C437','C438','C439','C440','C441','C442','C443','C444','C445','C446','C447','C448','C449','11100','11101',
          'C340','C341','C342','C343','C344','C345','C346','C347','C348','C349','32405','32400',
          'C220','C221','C222','C223','C224','C225','C226','C227','C228','C229','47000','47001','47100',
          'C810','C811','C812','C813','C814','C815','C816','C817','C818','C819','C820','C821','C822','C823','C824','C825','C826','C827','C828','C829','C830','C831','C832','C833','C834','C835','C836','C837','C838','C839','C840','C841','C842','C843','C844','C845','C846','C847','C848','C849','C850','C851','C852','C853','C854','C855','C856','C857','C858','C859','38500','88206',
          'C901','C910','C911','C912','C913','C914','C915','C916','C917','C918','C919','C920','C921','C922','C923','C924','C925','C926','C927','C928','C929','C930','C931','C932','C933','C934','C935','C936','C937','C938','C939','C940','C941','C942','C943','C944','C945','C946','C947','C948','C949','C950','C951','C952','C953','C954','C955','C956','C957','C958','C959','85095','38220','85102','88204','88204.01','88182.01','88185.02','88185.03','88205.04','85060',
          -- TRATAMIENTOS ONCOLÓGICOS (NUMERADOR) Y PALIATIVOS
          '96402','96407','96409','96410','96411','96412','96413','96414','96415','96416','96417','96420','96421','96422','96423','96549','90780','90782','90784','77305','77500','77295','77301','77315','77315.01','77401','77290','76499','77263','77418','77418.01','77285','77427','77504','77501','77781','77784','77501.01','77501.02','77501.03','77781','77781.01','77781.02','77781.03','77782','77783','77784.01','77785','77786','77787','99024','99489'
        );

      CREATE NONCLUSTERED INDEX IX_tmp_diag ON #his_minsa(id_cita, cod_item, id_tipitem, valor_lab);

      -- 3. DENOMINADOR EXACTO (Script Oficial MINSA)
      IF OBJECT_ID('tempdb..#Denonimador') IS NOT NULL DROP TABLE #Denonimador;
      WITH DenominadorPreliminar AS (
          SELECT
              h.renaes, h.Establecimiento, h.Disa, h.Provincia, h.Distrito, h.Categoria,
              h.id_cita, h.Fecha_Atencion, YEAR(h.Fecha_Atencion) [Anio],
              h.id_tipo_doc, h.id_genero, h.num_doc, h.edad_reg, h.id_tipedad_reg, h.Paciente,
              CASE 
                  WHEN h.cod_item IN ('C530','C531','C532','C533','C534','C535','C536','C537','C538','C539') THEN 'CA_CUELLO'
                  WHEN h.cod_item IN ('C500','C501','C502','C503','C504','C505','C506','C507','C508','C509') THEN 'CA_MAMA'
                  WHEN h.cod_item = 'C61X' THEN 'CA_PROSTATA'
                  WHEN h.cod_item IN ('C180','C181','C182','C183','C184','C185','C186','C187','C188','C189','C19X','C20X') THEN 'CA_COLON'
                  WHEN h.cod_item IN ('C160','C161','C162','C163','C164','C165','C166','C167','C168','C169') THEN 'CA_ESTOMAGO'
                  WHEN h.cod_item IN ('C430','C431','C432','C433','C434','C435','C436','C437','C438','C439','C440','C441','C442','C443','C444','C445','C446','C447','C448','C449') THEN 'CA_PIEL'
                  WHEN h.cod_item IN ('C340','C341','C342','C343','C344','C345','C346','C347','C348','C349') THEN 'CA_PULMON'
                  WHEN h.cod_item IN ('C220','C221','C222','C223','C224','C225','C226','C227','C228','C229') THEN 'CA_HIGADO'
                  WHEN h.cod_item LIKE 'C8%' THEN 'CA_LINFOMA'
                  WHEN h.cod_item LIKE 'C9%' THEN 'CA_LEUCEMIA'
                  ELSE NULL
              END AS Tipo
          FROM #his_minsa h WITH (NOLOCK)
          WHERE
              h.Fecha_Atencion BETWEEN @fechaInicio AND @fechaFin AND
              h.id_tipitem = 'D' AND
              h.valor_lab IS NULL AND
              (
                  (h.id_cita IN (SELECT r.id_cita FROM #his_minsa r WHERE r.id_tipitem = 'D' AND r.valor_lab = 'A' AND r.cod_item IN ('57500','58100') AND r.id_genero = 'F' AND r.id_tipedad_reg = 'A' AND r.edad_reg >= 18) AND h.cod_item LIKE 'C53%') OR
                  (h.id_cita IN (SELECT r.id_cita FROM #his_minsa r WHERE r.id_tipitem = 'D' AND r.valor_lab = 'A' AND r.cod_item IN ('19100','19101', '19102') AND r.id_genero = 'F' AND r.id_tipedad_reg = 'A' AND r.edad_reg >= 18) AND h.cod_item LIKE 'C50%') OR
                  (h.id_cita IN (SELECT r.id_cita FROM #his_minsa r WHERE r.id_tipitem = 'D' AND r.valor_lab = 'A' AND r.cod_item IN ('55700', '55705', '55706') AND r.id_genero = 'M' AND r.id_tipedad_reg = 'A' AND r.edad_reg >= 18) AND h.cod_item = 'C61X') OR
                  (h.id_cita IN (SELECT r.id_cita FROM #his_minsa r WHERE r.id_tipitem = 'D' AND r.valor_lab = 'A' AND r.cod_item IN ('44388','44389','45359','45358') AND r.id_tipedad_reg = 'A' AND r.edad_reg >= 18) AND (h.cod_item LIKE 'C18%' OR h.cod_item IN ('C19X','C20X'))) OR
                  (h.id_cita IN (SELECT r.id_cita FROM #his_minsa r WHERE r.id_tipitem = 'D' AND r.valor_lab = 'A' AND r.cod_item IN ('43234','43600') AND r.id_tipedad_reg = 'A' AND r.edad_reg >= 18) AND h.cod_item LIKE 'C16%')  OR
                  (h.id_cita IN (SELECT r.id_cita FROM #his_minsa r WHERE r.id_tipitem = 'D' AND r.valor_lab = 'A' AND r.cod_item IN ('11100','11101') AND r.id_tipedad_reg = 'A' AND r.edad_reg >= 18) AND (h.cod_item LIKE 'C43%' OR h.cod_item LIKE 'C44%')) OR
                  (h.id_cita IN (SELECT r.id_cita FROM #his_minsa r WHERE r.id_tipitem = 'D' AND r.valor_lab = 'A' AND r.cod_item IN ('32405','32400') AND r.edad_reg >= 18 AND r.id_tipedad_reg = 'A') AND h.cod_item LIKE 'C34%') OR
                  (h.id_cita IN (SELECT r.id_cita FROM #his_minsa r WHERE r.id_tipitem = 'D' AND r.valor_lab = 'A' AND r.cod_item IN ('47000','47001','47100') AND r.edad_reg >= 18 AND r.id_tipedad_reg = 'A') AND h.cod_item LIKE 'C22%') OR
                  (h.id_cita IN (SELECT r.id_cita FROM #his_minsa r WHERE r.id_tipitem = 'D' AND r.valor_lab = 'A' AND r.cod_item IN ('38500','88206')) AND h.cod_item LIKE 'C8%') OR
                  (h.id_cita IN (SELECT r.id_cita FROM #his_minsa r WHERE r.id_tipitem = 'D' AND r.valor_lab = 'A' AND r.cod_item IN ('85095','38220','85102','88204','88204.01','88182.01','88185.02','88185.03','88205.04','85060')) AND h.cod_item LIKE 'C9%')
              )
      ),
      NominaDenominador AS(
          SELECT
              ROW_NUMBER() OVER (PARTITION BY h.Anio, h.id_tipo_doc, h.num_doc, h.tipo ORDER BY h.Fecha_Atencion ASC) [id],
              h.id_cita, h.renaes, h.Establecimiento, h.Disa, h.Provincia, h.Distrito, h.Categoria,
              h.Fecha_Atencion, h.Anio, h.id_tipo_doc, h.num_doc, h.id_genero, h.edad_reg, h.id_tipedad_reg, h.Tipo, h.Paciente
          FROM DenominadorPreliminar h
          WHERE h.Tipo IS NOT NULL AND (@tipoCancerFiltro IS NULL OR @tipoCancerFiltro = '' OR h.Tipo = @tipoCancerFiltro)
      )
      SELECT
          h.renaes, h.Establecimiento, h.Disa, h.Provincia, h.Distrito, h.Categoria,
          h.Fecha_Atencion [fecha_diagnostico], h.id_cita, h.Anio, h.id_tipo_doc, h.num_doc,
          h.id_genero, h.Tipo, h.Paciente, 1 [den]
      INTO #Denonimador FROM NominaDenominador h WHERE h.id = 1;

      -- 4. NUMERADOR EXACTO (Script Oficial MINSA)
      IF OBJECT_ID('tempdb..#Procedimiento') IS NOT NULL DROP TABLE #Procedimiento;
      SELECT DISTINCT h.id_cita
      INTO #Procedimiento
      FROM #his_minsa h
      WHERE h.id_tipitem = 'D' AND h.valor_lab = '1' AND h.cod_item IN(
          '96402','96407','96409','96410','96411','96412','96413','96414','96415','96416','96417','96420','96421','96422','96423','96549','90780','90782','90784','77305','77500','77295','77301','77315','77315.01','77401','77290','76499','77263','77418','77418.01','77285','77427','77504','77501','77781','77784','77501.01','77501.02','77501.03','77781','77781.01','77781.02','77781.03','77782','77783','77784.01','77785','77786','77787','99024'
      );

      IF OBJECT_ID('tempdb..#Numerador') IS NOT NULL DROP TABLE #Numerador;
      WITH Cte_PreliminarNumerador AS(
          SELECT
              h.renaes, h.id_tipo_doc, h.num_doc, h.id_cita [id_cita_tratamiento],
              h.Fecha_Atencion [Fecha_Tratamiento],
              d.Tipo
          FROM #his_minsa h
          INNER JOIN #Denonimador d ON h.id_tipo_doc = d.id_tipo_doc AND h.num_doc = d.num_doc
          INNER JOIN #Procedimiento p ON h.id_cita = p.id_cita
          WHERE
              h.Fecha_Atencion BETWEEN d.fecha_diagnostico AND DATEADD(DAY, 37, d.fecha_diagnostico) AND
              h.id_tipitem = 'R' AND
              h.valor_lab IS NULL AND
              h.cod_item LIKE 'C%'
      ), Cte_Numerador AS(
          SELECT c.renaes [renaes_numerador], c.id_cita_tratamiento, c.id_tipo_doc, c.num_doc,
          c.Fecha_Tratamiento, c.Tipo, ROW_NUMBER() OVER(PARTITION BY c.id_tipo_doc, c.num_doc, c.Tipo ORDER BY c.Fecha_Tratamiento) [id]
          FROM Cte_PreliminarNumerador c
      ) SELECT n.renaes_numerador, n.id_cita_tratamiento, n.id_tipo_doc, n.num_doc, n.Fecha_Tratamiento, n.Tipo INTO #Numerador FROM Cte_Numerador n WHERE n.id = 1;

      -- 5. CUIDADO PALIATIVO (Exclusión)
      IF OBJECT_ID('tempdb..#CuidadoPaliativo') IS NOT NULL DROP TABLE #CuidadoPaliativo;
      WITH NominaCuidadosPaliativos AS(
          SELECT
              h.renaes [renaes_paliativo], h.Fecha_Atencion [fecha_atencion_paliativo], h.id_cita [id_cita_paliativo], h.id_tipo_doc, h.num_doc,
              ROW_NUMBER() OVER(PARTITION BY h.id_tipo_doc, h.num_doc ORDER BY h.Fecha_Atencion) [Id]
          FROM #his_minsa h
          INNER JOIN #his_minsa h2 ON h.id_cita = h2.id_cita AND h2.id_tipitem = 'D' AND h2.valor_lab = '2' AND h2.cod_item = '99489'
          INNER JOIN #Denonimador d ON h.id_tipo_doc = d.id_tipo_doc AND h.num_doc = d.num_doc
          WHERE
              h.Fecha_Atencion >= d.fecha_diagnostico AND
              h.id_tipitem = 'R' AND h.valor_lab IS NULL
      )
      SELECT p.renaes_paliativo, p.fecha_atencion_paliativo, p.id_cita_paliativo, p.id_tipo_doc, p.num_doc
      INTO #CuidadoPaliativo FROM NominaCuidadosPaliativos p WHERE p.Id = 1;

      -- 6. INDICADOR CONSOLIDADO EXACTO (#Indicador)
      IF OBJECT_ID('tempdb..#Indicador') IS NOT NULL DROP TABLE #Indicador;
      SELECT
          d.renaes, d.Establecimiento, d.Disa, d.Provincia, d.Distrito, d.Categoria,
          d.Anio, MONTH(d.fecha_diagnostico) [Mes], d.id_cita [Id_Cita_Diagnostico],
          d.Tipo, d.fecha_diagnostico, d.id_tipo_doc, d.id_genero, d.num_doc, d.Paciente,
          n.renaes_numerador, n.id_cita_tratamiento, n.Fecha_Tratamiento,
          DATEDIFF(DAY, d.fecha_diagnostico, n.Fecha_Tratamiento) AS Dias_Hasta_Tratamiento,
          p.renaes_paliativo, p.id_cita_paliativo, p.fecha_atencion_paliativo,
          def.FECHA [Fecha_Defuncion],
          CASE
              WHEN def.FECHA IS NOT NULL THEN 'SI'
              WHEN p.fecha_atencion_paliativo IS NOT NULL THEN 'SI'
              ELSE 'NO'
          END [Excluye],
          d.den,
          IIF(n.Fecha_Tratamiento IS NULL, 0, 1) [Num]
      INTO #Indicador FROM #Denonimador d
      LEFT JOIN #Numerador n ON d.id_tipo_doc = n.id_tipo_doc AND d.num_doc = n.num_doc AND d.Tipo = n.Tipo
      LEFT JOIN #CuidadoPaliativo p ON d.id_tipo_doc = p.id_tipo_doc AND d.num_doc = p.num_doc
      -- TOP 1: si una persona tiene más de un registro en SINADEF no se duplica en el denominador.
      OUTER APPLY (
          SELECT TOP 1 x.FECHA FROM [dbo].[V_SINADEF_AYACUCHO_DOMFALLECIDO] x WITH (NOLOCK)
          WHERE x.DOCUMENTO = d.num_doc AND x.FECHA <= DATEADD(DAY, 37, d.fecha_diagnostico)
          ORDER BY x.FECHA
      ) def;

      -- RESULTADO 1: RESUMEN GLOBAL
      SELECT 
          COUNT(*) AS Total_Denominador,
          SUM(CASE WHEN Excluye = 'SI' THEN 1 ELSE 0 END) AS Total_Excluidos,
          SUM(CASE WHEN Excluye = 'NO' AND Num = 1 THEN 1 ELSE 0 END) AS Total_SiCumplen,
          SUM(CASE WHEN Excluye = 'NO' AND Num = 0 THEN 1 ELSE 0 END) AS Total_NoContinuaron,
          AVG(CASE WHEN Num = 1 THEN CAST(Dias_Hasta_Tratamiento AS FLOAT) ELSE NULL END) AS Promedio_Dias_Tratamiento
      FROM #Indicador;

      -- RESULTADO 2: MENSUAL PARA GRÁFICOS DUALES Y ACUMULATIVOS
      SELECT 
          Mes,
          COUNT(*) AS Total_Diagnosticos,
          SUM(CASE WHEN Excluye = 'NO' AND Num = 1 THEN 1 ELSE 0 END) AS Si_Cumplen,
          SUM(CASE WHEN Excluye = 'NO' AND Num = 0 THEN 1 ELSE 0 END) AS No_Continuaron,
          SUM(CASE WHEN Excluye = 'SI' THEN 1 ELSE 0 END) AS Excluidos
      FROM #Indicador
      GROUP BY Mes
      ORDER BY Mes;

      -- RESULTADO 3: VISTA ORDINAL (Cálculo Agrupado del Script Oficial)
      SELECT
          ISNULL(r.Disa, 'AYACUCHO') [Region], 
          ISNULL(r.Provincia, 'HUAMANGA') [Provincia], 
          ISNULL(r.Distrito, 'ANDRES AVELINO CACERES DORREGARAY') [Distrito],
          ISNULL(r.Nombre_Establecimiento, 'HOSPITAL REGIONAL DE AYACUCHO MIGUEL ÁNGEL MARISCAL LLERENA') [Establecimiento], 
          ISNULL(r.Categoria_Establecimiento, 'II-2') [Categoria], 
          i.Anio [Anio],
          i.Mes, 
          i.Tipo, 
          i.id_genero [Genero], 
          i.Excluye [Excluye],
          SUM(i.den) [Denominador], 
          SUM(i.Num) [Numerador]
      FROM #Indicador i
      LEFT JOIN [MAESTRO_HIS_ESTABLECIMIENTO] r WITH (NOLOCK) ON TRY_CONVERT(INT, i.renaes) = TRY_CONVERT(INT, r.Codigo_Unico)
      GROUP BY
          r.Disa, r.Provincia, r.Distrito, r.Nombre_Establecimiento, r.Categoria_Establecimiento,
          i.Anio, i.Mes, i.Tipo, i.id_genero, i.Excluye
      ORDER BY i.Anio, i.Mes, i.Tipo, i.id_genero;

      -- RESULTADO 4: VISTA NOMINAL (Padrón Detallado de Pacientes del Script Oficial)
      SELECT 
          i.renaes,
          i.Anio,
          i.Mes,
          i.Id_Cita_Diagnostico,
          i.id_tipo_doc,
          i.id_genero,
          i.num_doc,
          i.Paciente,
          i.Tipo AS Tipo_Cancer,
          CONVERT(VARCHAR(10), i.fecha_diagnostico, 120) AS Fecha_Diagnostico,
          i.renaes_numerador,
          i.id_cita_tratamiento,
          CONVERT(VARCHAR(10), i.Fecha_Tratamiento, 120) AS Fecha_Tratamiento,
          i.Dias_Hasta_Tratamiento,
          i.renaes_paliativo,
          i.id_cita_paliativo,
          CONVERT(VARCHAR(10), i.fecha_atencion_paliativo, 120) AS fecha_atencion_paliativo,
          CONVERT(VARCHAR(10), i.Fecha_Defuncion, 120) AS Fecha_Defuncion,
          i.Excluye,
          CASE 
              WHEN i.Fecha_Defuncion IS NOT NULL THEN 'Defunción dentro de 37 días'
              WHEN i.fecha_atencion_paliativo IS NOT NULL THEN 'Cuidado Paliativo'
              ELSE NULL
          END AS Motivo_Exclusion,
          i.den,
          i.Num,
          CASE 
              WHEN i.Excluye = 'SI' THEN 'EXCLUIDO'
              WHEN i.Num = 1 THEN 'CUMPLE REQUISITO (≤ 37 d)'
              ELSE 'NO CONTINUÓ / PENDIENTE'
          END AS Estado_Gestion
      FROM #Indicador i
      ORDER BY i.fecha_diagnostico DESC;
    `;

    const result = await request.query(query);

    const nombresMeses = [
      '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];

    // Procesar Resumen Global
    const globalRow = result.recordsets[0]?.[0] || {};
    const denTotal = Number(globalRow.Total_Denominador) || 0;
    const excTotal = Number(globalRow.Total_Excluidos) || 0;
    const siCumplenTotal = Number(globalRow.Total_SiCumplen) || 0;
    const noContinuaronTotal = Number(globalRow.Total_NoContinuaron) || 0;
    const diasProm = globalRow.Promedio_Dias_Tratamiento != null ? Number(globalRow.Promedio_Dias_Tratamiento).toFixed(1) : '—';
    const baseCalculo = denTotal - excTotal;
    const pctCumplimientoGlobal = baseCalculo > 0 ? ((siCumplenTotal / baseCalculo) * 100).toFixed(1) : '0.0';

    // Procesar Tendencia Mensual y Sumas Acumulativas Progresivas
    const mesesRaw = result.recordsets[1] || [];
    const mesesMap = {};
    mesesRaw.forEach(m => { mesesMap[m.Mes] = m; });

    let acumuladoTotal = 0;
    let acumuladoSiCumplen = 0;
    let acumuladoNoContinuaron = 0;
    let acumuladoExc = 0;

    const mensual = [];
    for (let m = 1; m <= 12; m++) {
      const dataMes = mesesMap[m] || { Total_Diagnosticos: 0, Si_Cumplen: 0, No_Continuaron: 0, Excluidos: 0 };
      const tot = Number(dataMes.Total_Diagnosticos) || 0;
      const si = Number(dataMes.Si_Cumplen) || 0;
      const no = Number(dataMes.No_Continuaron) || 0;
      const e = Number(dataMes.Excluidos) || 0;

      acumuladoTotal += tot;
      acumuladoSiCumplen += si;
      acumuladoNoContinuaron += no;
      acumuladoExc += e;

      const baseMes = tot - e;
      const pctMes = baseMes > 0 ? Number(((si / baseMes) * 100).toFixed(1)) : 0;
      const baseAcum = acumuladoTotal - acumuladoExc;
      const pctAcum = baseAcum > 0 ? Number(((acumuladoSiCumplen / baseAcum) * 100).toFixed(1)) : 0;

      mensual.push({
        mes: m,
        nombreMes: nombresMeses[m],
        totalDiagnosticos: tot,
        siCumplen: si,
        noContinuaron: no,
        excluidos: e,
        acumuladoTotal: acumuladoTotal,
        acumuladoSiCumplen: acumuladoSiCumplen,
        acumuladoNoContinuaron: acumuladoNoContinuaron,
        acumuladoExcluidos: acumuladoExc,
        porcentajeMes: pctMes,
        porcentajeAcumulado: pctAcum
      });
    }

    // Procesar Vista Ordinal
    const ordinal = (result.recordsets[2] || []).map(r => {
      const den = Number(r.Denominador) || 0;
      const num = Number(r.Numerador) || 0;
      const pct = (r.Excluye === 'NO' && den > 0) ? ((num / den) * 100).toFixed(1) : '—';
      return {
        ...r,
        Denominador: den,
        Numerador: num,
        Porcentaje: pct
      };
    });

    // Procesar Vista Nominal
    const nominal = result.recordsets[3] || [];

    const responsePayload = {
      disponible: true,
      indicador: {
        id: '14',
        tipo: 'Indicador de desempeño',
        nombre: 'Porcentaje de personas con diagnóstico de cánceres prevalentes que inician tratamiento oncológico oportuno (≤ 37 días)',
        formula: '(Numerador [Tratados ≤ 37 d] / [Denominador - Excluidos]) × 100',
        meta: '≥ 80.0%'
      },
      filtrosAplicados: { anio, fechaInicio, fechaFin, codRenaes, tipoCancerFiltro },
      resumen: {
        totalDiagnosticos: denTotal,
        denominador: denTotal,
        numerador: siCumplenTotal,
        siCumplen: siCumplenTotal,
        noContinuaron: noContinuaronTotal,
        noCumplen: noContinuaronTotal,
        excluidos: excTotal,
        pctCumplimiento: pctCumplimientoGlobal,
        diasPromedioTratamiento: diasProm
      },
      mensual,
      ordinal,
      nominal
    };

    cache.set(cacheKey, responsePayload, 120); // 2 minutos
    res.status(200).json(responsePayload);
  } catch (error) {
    console.error('Error al procesar Indicador 14:', error);
    res.status(500).json({ error: 'Error al calcular indicador', message: error.message });
  }
};

module.exports = {
  getMaestroIndicadores,
  getIndicador
};
