// ═════════════════════════════════════════════════════════════════════
//  MÓDULO DE INDICADORES DE DESEMPEÑO Y GESTIÓN (HIS MINSA - HRA)
// ═════════════════════════════════════════════════════════════════════

let catalogoIndicadores = [];
let indicadorActualId = ''; // No cargar el 14 por defecto; el usuario debe elegir uno
let indicador14Data = null;
let modoBarrasActual = 'acumulado'; // 'acumulado' o 'mensual'
let serieBarrasActual = 'ambos'; // 'ambos', 'cumplen', 'nocumplen'
let seriePuntosActual = 'ambos'; // 'ambos', 'cumplen', 'nocumplen'
let subTabActual = 'graficos'; // 'graficos', 'ordinal', 'nominal'

let padronNominalCompleto = [];
let listaOrdinalCompleta = [];

// Función llamada al abrir la pestaña de Indicadores
async function abrirVistaIndicadores() {
  await inicializarCatalogoIndicadores();
  if (indicadorActualId) {
    await seleccionarIndicador(indicadorActualId);
  } else {
    mostrarEstadoSinSeleccion();
  }
}

// Carga el catálogo maestro de indicadores de MAESTRO_HIS_INDICADOR
async function inicializarCatalogoIndicadores() {
  if (catalogoIndicadores && catalogoIndicadores.length > 0) {
    renderizarOpcionesSelectorIndicador();
    return;
  }
  
  try {
    const data = await apiFetch('/indicadores/maestro');
    if (Array.isArray(data) && data.length > 0) {
      catalogoIndicadores = data;
      renderizarOpcionesSelectorIndicador();
      const q = document.getElementById('indBuscadorTexto')?.value;
      if (q) filtrarIndicadoresEnSelector(q);
    }
  } catch (error) {
    console.error('Error cargando catálogo de indicadores:', error);
  }
}

// Llena el dropdown con todos los indicadores disponibles
function renderizarOpcionesSelectorIndicador(lista = catalogoIndicadores) {
  const select = document.getElementById('indSelectorIndicador');
  if (!select) return;

  const placeholderText = lista.length === catalogoIndicadores.length
    ? '— Seleccione un indicador —'
    : `— ${lista.length} indicadores encontrados —`;

  const opciones = [
    `<option value="">${placeholderText}</option>`,
    ...lista.map(ind => {
      const selected = String(ind.Id_Indicador) === String(indicadorActualId) ? 'selected' : '';
      const num = String(ind.Id_Indicador).padStart(2, '0');
      const desc = ind.Descripcion_Indicador || ind.Tipo_Indicador || '';
      const descCorta = desc.length > 105 ? desc.substring(0, 105) + '…' : desc;
      const disponibleTag = String(ind.Id_Indicador) === '14' ? ' ★ [Activo]' : '';
      return `<option value="${esc(ind.Id_Indicador)}" ${selected}>${esc(num)} — ${esc(descCorta)}${disponibleTag}</option>`;
    })
  ];

  select.innerHTML = opciones.join('');
  select.value = indicadorActualId || '';
}

// Filtra los indicadores según el texto ingresado en el buscador
function filtrarIndicadoresEnSelector(texto) {
  const query = (texto || '').trim().toLowerCase();
  const clearBtn = document.getElementById('indBtnClearSearch');
  if (clearBtn) clearBtn.style.display = query ? 'inline-flex' : 'none';

  if (!catalogoIndicadores || catalogoIndicadores.length === 0) return;

  const filtrados = query
    ? catalogoIndicadores.filter(ind => {
        const id = String(ind.Id_Indicador || '').toLowerCase();
        const tipo = String(ind.Tipo_Indicador || '').toLowerCase();
        const desc = String(ind.Descripcion_Indicador || '').toLowerCase();
        return id.includes(query) || tipo.includes(query) || desc.includes(query);
      })
    : catalogoIndicadores;

  renderizarOpcionesSelectorIndicador(filtrados);

  // Si estamos en la pantalla inicial (sin indicador seleccionado), renderizar tarjetas de resultados
  const resultsGrid = document.getElementById('indSearchResultsGrid');
  const quickList = document.getElementById('indQuickList');
  if (resultsGrid && !indicadorActualId) {
    if (query) {
      if (quickList) quickList.style.display = 'none';
      resultsGrid.style.display = 'grid';
      if (filtrados.length === 0) {
        resultsGrid.innerHTML = `<div class="ind-search-no-results">No se encontraron indicadores que coincidan con «<strong>${esc(query)}</strong>».</div>`;
      } else {
        resultsGrid.innerHTML = filtrados.map(ind => {
          const esActivo = String(ind.Id_Indicador) === '14';
          const num = String(ind.Id_Indicador).padStart(2, '0');
          return `
            <div class="ind-result-item ${esActivo ? 'active-indicator' : ''}" onclick="seleccionarIndicador('${esc(ind.Id_Indicador)}')">
              <div class="ind-result-top">
                <span class="ind-result-badge ${esActivo ? 'badge-active' : ''}">${esActivo ? 'Motor Activo' : 'En desarrollo'}</span>
                <span class="ind-result-num">Indicador ${esc(num)}</span>
              </div>
              <div class="ind-result-desc">${esc(ind.Descripcion_Indicador || ind.Tipo_Indicador || 'Sin descripción')}</div>
              <div class="ind-result-action">
                <span>${esActivo ? 'Abrir análisis completo' : 'Ver ficha técnica'}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
              </div>
            </div>
          `;
        }).join('');
      }
    } else {
      resultsGrid.style.display = 'none';
      if (quickList) quickList.style.display = 'block';
    }
  }
}

// Limpia el texto de búsqueda rápida
function limpiarFiltroBuscador() {
  const input = document.getElementById('indBuscadorTexto');
  if (input) input.value = '';
  filtrarIndicadoresEnSelector('');
  if (input) input.focus();
}

// Permite seleccionar con la tecla Enter en el buscador
function manejarEnterBuscadorIndicador(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    const input = document.getElementById('indBuscadorTexto');
    const query = (input?.value || '').trim().toLowerCase();
    if (!query) return;

    const exacto = catalogoIndicadores.find(i => String(i.Id_Indicador).toLowerCase() === query);
    if (exacto) {
      seleccionarIndicador(exacto.Id_Indicador);
      return;
    }
    const parcial = catalogoIndicadores.find(i => 
      String(i.Id_Indicador).toLowerCase().includes(query) || 
      String(i.Descripcion_Indicador || '').toLowerCase().includes(query)
    );
    if (parcial) {
      seleccionarIndicador(parcial.Id_Indicador);
    }
  }
}

// Selección de indicador
async function seleccionarIndicador(id) {
  indicadorActualId = id ? String(id) : '';

  const select = document.getElementById('indSelectorIndicador');
  if (select && select.value !== indicadorActualId) select.value = indicadorActualId;

  const btnDeseleccionar = document.getElementById('indBtnDeseleccionar');
  if (btnDeseleccionar) {
    btnDeseleccionar.style.display = indicadorActualId ? 'inline-flex' : 'none';
  }

  // Si no hay indicador seleccionado, mostrar pantalla inicial
  if (!indicadorActualId) {
    mostrarEstadoSinSeleccion();
    return;
  }

  const headerMeta = document.getElementById('indHeaderMeta');
  const sinSeleccionPanel = document.getElementById('indSinSeleccionPanel');
  const fichaTecnica = document.getElementById('indFichaTecnica');
  const ind14Container = document.getElementById('ind14Container');
  const enDesarrolloPanel = document.getElementById('indEnDesarrolloPanel');

  if (sinSeleccionPanel) sinSeleccionPanel.style.display = 'none';
  if (fichaTecnica) fichaTecnica.style.display = 'block';

  const ficha = catalogoIndicadores.find(i => String(i.Id_Indicador) === indicadorActualId);
  const tituloEl = document.getElementById('indTitulo');
  const descEl = document.getElementById('indDescripcion');
  const badgeEl = document.getElementById('indTipoBadge');
  const formulaEl = document.getElementById('indFormulaOficial');

  if (ficha) {
    if (tituloEl) tituloEl.textContent = `Indicador ${ficha.Id_Indicador}: ${ficha.Tipo_Indicador || 'Indicador'}`;
    if (descEl) descEl.textContent = ficha.Descripcion_Indicador || '';
    if (badgeEl) badgeEl.textContent = ficha.Tipo_Indicador || 'Indicador';
  }

  if (indicadorActualId === '14') {
    if (headerMeta) headerMeta.style.display = 'flex';
    if (ind14Container) ind14Container.style.display = 'block';
    if (enDesarrolloPanel) enDesarrolloPanel.style.display = 'none';

    if (formulaEl) {
      formulaEl.innerHTML = `<code>Cumplimiento (%) = (Numerador [Tratados ≤ 37 d] / [Denominador - Excluidos]) × 100</code>`;
    }

    if (!indicador14Data) await cargarDatosIndicador14();
  } else {
    if (headerMeta) headerMeta.style.display = 'none';
    if (ind14Container) ind14Container.style.display = 'none';
    if (enDesarrolloPanel) enDesarrolloPanel.style.display = 'block';

    if (formulaEl) {
      formulaEl.innerHTML = `<code>En proceso de homologación con la directiva técnica MINSA correspondiente</code>`;
    }

    const msg = document.getElementById('indEnDesarrolloMensaje');
    if (msg) {
      msg.innerHTML = `El catálogo oficial ya incluye la definición del <strong>Indicador ${esc(indicadorActualId)}</strong> (${esc(ficha?.Descripcion_Indicador || '')}). Cada indicador tendrá su propia programación analítica. Actualmente está activo y con motor de cálculo completo el <strong>Indicador 14</strong>.`;
    }
  }
}

// Muestra el estado inicial donde solo se muestra la barra de búsqueda y el panel de selección
function mostrarEstadoSinSeleccion() {
  indicadorActualId = '';

  const select = document.getElementById('indSelectorIndicador');
  if (select) select.value = '';

  const btnDeseleccionar = document.getElementById('indBtnDeseleccionar');
  if (btnDeseleccionar) btnDeseleccionar.style.display = 'none';

  const headerMeta = document.getElementById('indHeaderMeta');
  if (headerMeta) headerMeta.style.display = 'none';

  const fichaTecnica = document.getElementById('indFichaTecnica');
  if (fichaTecnica) fichaTecnica.style.display = 'none';

  const ind14Container = document.getElementById('ind14Container');
  if (ind14Container) ind14Container.style.display = 'none';

  const enDesarrolloPanel = document.getElementById('indEnDesarrolloPanel');
  if (enDesarrolloPanel) enDesarrolloPanel.style.display = 'none';

  const sinSeleccionPanel = document.getElementById('indSinSeleccionPanel');
  if (sinSeleccionPanel) sinSeleccionPanel.style.display = 'block';

  // Si hay texto en el buscador, refrescar resultados dinámicos
  const q = document.getElementById('indBuscadorTexto')?.value;
  if (q) {
    filtrarIndicadoresEnSelector(q);
  }
}

// Quita la selección actual y regresa a la pantalla de búsqueda
function limpiarSeleccionIndicador() {
  mostrarEstadoSinSeleccion();
  const input = document.getElementById('indBuscadorTexto');
  if (input) input.focus();
}

// Cambio de sub-pestaña: Gráficos, Ordinal o Nominal
function cambiarSubTabIndicador(tabName) {
  subTabActual = tabName;
  document.querySelectorAll('.ind-tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.ind-subpanel').forEach(pan => pan.classList.remove('active'));

  const activeBtn = document.getElementById(`tabBtn${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`);
  const activePan = document.getElementById(`subpanel${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`);

  if (activeBtn) activeBtn.classList.add('active');
  if (activePan) activePan.classList.add('active');
}

// Recarga los datos del indicador actual
async function recargarIndicadorActual() {
  if (indicadorActualId === '14') {
    await cargarDatosIndicador14();
  } else if (indicadorActualId) {
    seleccionarIndicador(indicadorActualId);
  } else {
    mostrarEstadoSinSeleccion();
  }
}

// Aplica filtros dinámicos para el Indicador 14
async function aplicarFiltrosIndicador14() {
  await cargarDatosIndicador14();
}

// Restablece los filtros del Indicador 14
async function restablecerFiltrosIndicador14() {
  sv('indFiltroAnio', '2026');
  sv('indFechaInicio', '2026-01-01');
  sv('indFechaFin', '2026-12-31');
  sv('indFiltroCancer', '');
  sv('indFiltroRenaes', '35125');
  await cargarDatosIndicador14();
}

// Consulta la API para el cálculo del Indicador 14
async function cargarDatosIndicador14() {
  const anio = gv('indFiltroAnio') || '2026';
  const fechaInicio = gv('indFechaInicio') || `${anio}-01-01`;
  const fechaFin = gv('indFechaFin') || `${anio}-12-31`;
  const tipoCancer = gv('indFiltroCancer') || '';
  const codRenaes = gv('indFiltroRenaes') || '';

  // Actualizar placeholders de carga
  document.getElementById('indBarrasAcumuladasCanvas').innerHTML = '<div class="ind-loading-state">Calculando total acumulado de pacientes que sí cumplen el requisito...</div>';
  document.getElementById('indPuntosTendenciaCanvas').innerHTML = '<div class="ind-loading-state">Trazando puntos mensuales de los casos que cumplen...</div>';

  const params = new URLSearchParams({
    anio,
    fechaInicio,
    fechaFin,
    tipoCancer,
    codRenaes
  });

  try {
    const data = await apiFetch(`/indicadores/14?${params.toString()}`);
    indicador14Data = data;
    padronNominalCompleto = data.nominal || [];
    listaOrdinalCompleta = data.ordinal || [];

    // Badges en las pestañas
    document.getElementById('badgeOrdinalCount').textContent = `${listaOrdinalCompleta.length}`;
    document.getElementById('badgeNominalCount').textContent = `${padronNominalCompleto.length}`;

    // 1. Actualizar Tarjetas KPI
    renderizarKPIsIndicador14(data.resumen);

    // 2. Renderizar Diagrama de Barras (Dual / Stacked según selección)
    renderizarGraficoBarras(data.mensual, modoBarrasActual, serieBarrasActual);

    // 3. Renderizar Diagrama de Puntos / Línea (Cáncer vs Tratados)
    renderizarGraficoPuntos(data.mensual, seriePuntosActual);

    // 4. Renderizar Vista Ordinal (Cálculo Agrupado del Script)
    renderizarTablaOrdinal(listaOrdinalCompleta);

    // 5. Renderizar Vista Nominal (Padrón Detallado de Pacientes)
    filtrarPadronNominal();

    // Marca de tiempo
    const timeEl = document.getElementById('indLastUpdated');
    if (timeEl) {
      const now = new Date();
      timeEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
  } catch (error) {
    console.error('Error cargando Indicador 14:', error);
    document.getElementById('indBarrasAcumuladasCanvas').innerHTML = `<div class="ind-loading-state" style="color:#ef4444;">Error al cargar datos: ${esc(error.message)}</div>`;
    document.getElementById('indPuntosTendenciaCanvas').innerHTML = `<div class="ind-loading-state" style="color:#ef4444;">Error al cargar datos: ${esc(error.message)}</div>`;
    toast('No se pudieron obtener los datos del indicador', 'error');
  }
}

// Tarjetas KPI de Resumen
function renderizarKPIsIndicador14(resumen = {}) {
  const pct = resumen.pctCumplimiento != null ? `${resumen.pctCumplimiento}%` : '0.0%';
  document.getElementById('kpiPctCumplimiento').textContent = pct;
  
  const den = resumen.denominador || resumen.totalDiagnosticos || 0;
  const num = resumen.numerador || resumen.siCumplen || 0;
  const exc = resumen.excluidos || 0;
  const noC = resumen.noContinuaron || resumen.noCumplen || 0;
  const evaluables = den - exc;

  document.getElementById('kpiSubCumplimiento').textContent = `${num} de ${evaluables} evaluables iniciaron a tiempo`;
  document.getElementById('kpiNumerador').textContent = num.toLocaleString();
  document.getElementById('kpiDenominador').textContent = den.toLocaleString();
  document.getElementById('kpiExcluidos').textContent = exc.toLocaleString();
  document.getElementById('kpiNoCumplen').textContent = noC.toLocaleString();
  document.getElementById('kpiDiasPromedio').textContent = resumen.diasPromedioTratamiento && resumen.diasPromedioTratamiento !== '—' ? `${resumen.diasPromedioTratamiento} d` : '—';
}

// Alternar entre modo Acumulado y Mensual en las Barras
function toggleModoBarras(modo) {
  modoBarrasActual = modo;
  document.getElementById('btnToggleBarrasAcum')?.classList.toggle('active', modo === 'acumulado');
  document.getElementById('btnToggleBarrasMes')?.classList.toggle('active', modo === 'mensual');
  if (indicador14Data?.mensual) {
    renderizarGraficoBarras(indicador14Data.mensual, modoBarrasActual, serieBarrasActual);
  }
}

// Alternar serie de datos en Diagrama de Barras (Ambos, Sí Cumplen, No Continuaron)
function cambiarSerieBarras(serie) {
  serieBarrasActual = serie;
  document.getElementById('btnBarrasAmbos')?.classList.toggle('active', serie === 'ambos');
  document.getElementById('btnBarrasCumplen')?.classList.toggle('active', serie === 'cumplen');
  document.getElementById('btnBarrasNoCumplen')?.classList.toggle('active', serie === 'nocumplen');
  if (indicador14Data?.mensual) {
    renderizarGraficoBarras(indicador14Data.mensual, modoBarrasActual, serieBarrasActual);
  }
}

// Alternar serie de datos en Diagrama de Puntos (Ambos, Sí Cumplen, No Continuaron / Diagnósticos)
function cambiarSeriePuntos(serie) {
  seriePuntosActual = serie;
  document.getElementById('btnPuntosAmbos')?.classList.toggle('active', serie === 'ambos');
  document.getElementById('btnPuntosCumplen')?.classList.toggle('active', serie === 'cumplen');
  document.getElementById('btnPuntosNoCumplen')?.classList.toggle('active', serie === 'nocumplen');
  if (indicador14Data?.mensual) {
    renderizarGraficoPuntos(indicador14Data.mensual, seriePuntosActual);
  }
}

// ═════════════════════════════════════════════════════════════════════
//  DIAGRAMA 1: BARRAS AGRUPADAS / DOBLES (TRATAMIENTO OPORTUNO VS PENDIENTE)
// ═════════════════════════════════════════════════════════════════════
function renderizarGraficoBarras(mensual = [], modo = 'acumulado', serie = 'ambos') {
  const container = document.getElementById('indBarrasAcumuladasCanvas');
  if (!container) return;

  if (!mensual || mensual.length === 0) {
    container.innerHTML = '<div class="ind-loading-state">No se registraron datos para el periodo seleccionado.</div>';
    return;
  }

  // Dimensiones SVG
  const width = 960;
  const height = 270;
  const margin = { top: 38, right: 28, bottom: 44, left: 52 };
  const chartW = width - margin.left - margin.right;
  const chartH = height - margin.top - margin.bottom;

  // Escala máxima del eje Y
  let maxVal = 5;
  if (modo === 'acumulado') {
    if (serie === 'ambos') {
      maxVal = Math.max(...mensual.map(m => {
        const c = Number(m.acumuladoSiCumplen ?? m.acumuladoCumplen) || 0;
        const nc = Number(m.acumuladoNoContinuaron ?? m.noCumplen) || 0;
        return Math.max(c, nc);
      }), 5);
    } else if (serie === 'cumplen') {
      maxVal = Math.max(...mensual.map(m => Number(m.acumuladoSiCumplen ?? m.acumuladoCumplen) || 0), 5);
    } else {
      maxVal = Math.max(...mensual.map(m => Number(m.acumuladoNoContinuaron ?? m.noCumplen) || 0), 5);
    }
  } else {
    if (serie === 'ambos') {
      maxVal = Math.max(...mensual.map(m => {
        const c = Number(m.siCumplen ?? m.cumplen) || 0;
        const nc = Number(m.noContinuaron ?? m.noCumplen) || 0;
        return Math.max(c, nc);
      }), 5);
    } else if (serie === 'cumplen') {
      maxVal = Math.max(...mensual.map(m => Number(m.siCumplen ?? m.cumplen) || 0), 5);
    } else {
      maxVal = Math.max(...mensual.map(m => Number(m.noContinuaron ?? m.noCumplen) || 0), 5);
    }
  }
  const yMax = Math.ceil(maxVal * 1.22); // Espacio superior para etiquetas numéricas

  const n = mensual.length; // 12 meses
  const slotW = chartW / n;

  // Líneas de grilla horizontales
  const gridTicks = [0, Math.round(yMax * 0.33), Math.round(yMax * 0.66), yMax];
  let gridLinesSvg = '';
  gridTicks.forEach(tick => {
    const yPos = margin.top + chartH - (tick / yMax) * chartH;
    gridLinesSvg += `
      <line x1="${margin.left}" y1="${yPos}" x2="${margin.left + chartW}" y2="${yPos}" class="ind-grid-line"/>
      <text x="${margin.left - 8}" y="${yPos + 4}" class="ind-axis-label-val">${tick}</text>
    `;
  });

  // Anchos y separaciones de barras
  const gap = 3; // Distancia entre las 2 barras dobles
  const barWDouble = Math.max(Math.min((slotW - 14 - gap) / 2, 22), 12);
  const groupW = 2 * barWDouble + gap;
  const barWSingle = Math.max(slotW * 0.48, 20);

  // Renderizar Barras
  let barsSvg = '';
  mensual.forEach((m, idx) => {
    const cx = margin.left + idx * slotW + slotW / 2;
    const nombreCorto = m.nombreMes.substring(0, 3).toUpperCase();
    const baseY = margin.top + chartH;

    const vCumplen = modo === 'acumulado'
      ? (Number(m.acumuladoSiCumplen ?? m.acumuladoCumplen) || 0)
      : (Number(m.siCumplen ?? m.cumplen) || 0);

    const vNoCumplen = modo === 'acumulado'
      ? (Number(m.acumuladoNoContinuaron ?? m.noCumplen) || 0)
      : (Number(m.noContinuaron ?? m.noCumplen) || 0);

    const vTotal = modo === 'acumulado'
      ? (Number(m.acumuladoTotal ?? m.acumuladoDenominador) || (vCumplen + vNoCumplen))
      : (Number(m.totalDiagnosticos ?? m.denominador) || (vCumplen + vNoCumplen));

    const nuevoMes = Number(m.totalDiagnosticos ?? m.denominador) || (Number(m.siCumplen ?? m.cumplen) || 0) + (Number(m.noContinuaron ?? m.noCumplen) || 0);

    let tooltip = '';
    let barGroupContent = '';

    if (serie === 'ambos') {
      // 2 Barras visibles lado a lado:
      // Barra 1: Verde (Tratamiento Oportuno ≤ 37 d)
      // Barra 2: Ámbar (Pendiente / Fuera de Plazo)
      const groupStartX = cx - groupW / 2;
      const x1 = groupStartX;
      const x2 = groupStartX + barWDouble + gap;

      const h1 = vCumplen > 0 ? Math.max((vCumplen / yMax) * chartH, 4) : 0;
      const y1 = baseY - h1;

      const h2 = vNoCumplen > 0 ? Math.max((vNoCumplen / yMax) * chartH, 4) : 0;
      const y2 = baseY - h2;

      tooltip = modo === 'acumulado'
        ? `${m.nombreMes} (Acumulado):\n• Tratamiento Oportuno (≤ 37 d): ${vCumplen}\n• Pendientes / Fuera de Plazo: ${vNoCumplen}\n• Total Acumulado: ${vTotal} (+${nuevoMes} nuevos en el mes)`
        : `${m.nombreMes} (Mensual):\n• Tratamiento Oportuno (≤ 37 d): ${vCumplen}\n• Pendientes / Fuera de Plazo: ${vNoCumplen}\n• Total del Mes: ${vTotal}`;

      // Barra 1: Tratamiento Oportuno (Verde)
      if (vCumplen > 0) {
        barGroupContent += `
          <rect x="${x1}" y="${y1}" width="${barWDouble}" height="${h1}" rx="3" class="ind-bar-rect green">
            <animate attributeName="height" from="0" to="${h1}" dur="0.32s" fill="freeze" />
            <animate attributeName="y" from="${baseY}" to="${y1}" dur="0.32s" fill="freeze" />
          </rect>
          <text x="${x1 + barWDouble / 2}" y="${y1 - 6}" class="ind-bar-val-text green">${vCumplen}</text>
        `;
      }

      // Barra 2: Pendientes / Fuera de Plazo (Ámbar)
      if (vNoCumplen > 0) {
        barGroupContent += `
          <rect x="${x2}" y="${y2}" width="${barWDouble}" height="${h2}" rx="3" class="ind-bar-rect amber">
            <animate attributeName="height" from="0" to="${h2}" dur="0.32s" fill="freeze" />
            <animate attributeName="y" from="${baseY}" to="${y2}" dur="0.32s" fill="freeze" />
          </rect>
          <text x="${x2 + barWDouble / 2}" y="${y2 - 6}" class="ind-bar-val-text amber">${vNoCumplen}</text>
        `;
      }

      // En modo acumulado, si hubo nuevos diagnósticos ese mes, mostrar el incremento sobre la barra más alta
      if (modo === 'acumulado' && nuevoMes > 0) {
        const topY = Math.min(vCumplen > 0 ? y1 : baseY, vNoCumplen > 0 ? y2 : baseY);
        barGroupContent += `<text x="${cx}" y="${topY - 18}" class="ind-bar-sub-text" title="+${nuevoMes} nuevos diagnósticos en ${m.nombreMes}">+${nuevoMes}</text>`;
      }

    } else if (serie === 'cumplen') {
      // Solo Tratamiento Oportuno (Verde centrado)
      const x = cx - barWSingle / 2;
      const h = vCumplen > 0 ? Math.max((vCumplen / yMax) * chartH, 4) : 0;
      const y = baseY - h;
      tooltip = modo === 'acumulado'
        ? `${m.nombreMes} (Acumulado): ${vCumplen} pacientes con Tratamiento Oportuno (≤ 37 d)`
        : `${m.nombreMes}: ${vCumplen} pacientes con Tratamiento Oportuno en el mes`;

      if (vCumplen > 0) {
        barGroupContent += `
          <rect x="${x}" y="${y}" width="${barWSingle}" height="${h}" rx="4" class="ind-bar-rect green">
            <animate attributeName="height" from="0" to="${h}" dur="0.32s" fill="freeze" />
            <animate attributeName="y" from="${baseY}" to="${y}" dur="0.32s" fill="freeze" />
          </rect>
          <text x="${cx}" y="${y - 7}" class="ind-bar-val-text green">${vCumplen}</text>
        `;
      }

    } else if (serie === 'nocumplen') {
      // Solo Pendientes / Fuera de Plazo (Ámbar centrado)
      const x = cx - barWSingle / 2;
      const h = vNoCumplen > 0 ? Math.max((vNoCumplen / yMax) * chartH, 4) : 0;
      const y = baseY - h;
      tooltip = modo === 'acumulado'
        ? `${m.nombreMes} (Acumulado): ${vNoCumplen} pacientes pendientes o fuera de plazo`
        : `${m.nombreMes}: ${vNoCumplen} pacientes pendientes o fuera de plazo en el mes`;

      if (vNoCumplen > 0) {
        barGroupContent += `
          <rect x="${x}" y="${y}" width="${barWSingle}" height="${h}" rx="4" class="ind-bar-rect amber">
            <animate attributeName="height" from="0" to="${h}" dur="0.32s" fill="freeze" />
            <animate attributeName="y" from="${baseY}" to="${y}" dur="0.32s" fill="freeze" />
          </rect>
          <text x="${cx}" y="${y - 7}" class="ind-bar-val-text amber">${vNoCumplen}</text>
        `;
      }
    }

    barsSvg += `
      <g class="ind-bar-group" tabindex="0">
        <title>${esc(tooltip)}</title>
        ${barGroupContent}
        <text x="${cx}" y="${height - 12}" class="ind-axis-label">${esc(nombreCorto)}</text>
      </g>
    `;
  });

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" class="ind-svg-chart" preserveAspectRatio="xMidYMid meet">
      ${gridLinesSvg}
      <line x1="${margin.left}" y1="${margin.top + chartH}" x2="${margin.left + chartW}" y2="${margin.top + chartH}" class="ind-axis-line"/>
      ${barsSvg}
    </svg>
  `;
}

// ═════════════════════════════════════════════════════════════════════
//  DIAGRAMA 2: PUNTOS / LÍNEAS (CASOS DIAGNOSTICADOS VS TRATAMIENTO OPORTUNO)
// ═════════════════════════════════════════════════════════════════════
function renderizarGraficoPuntos(mensual = [], serie = 'ambos') {
  const container = document.getElementById('indPuntosTendenciaCanvas');
  if (!container) return;

  if (!mensual || mensual.length === 0) {
    container.innerHTML = '<div class="ind-loading-state">No se registraron datos para el periodo seleccionado.</div>';
    return;
  }

  // Dimensiones SVG
  const width = 960;
  const height = 240;
  const margin = { top: 34, right: 28, bottom: 40, left: 52 };
  const chartW = width - margin.left - margin.right;
  const chartH = height - margin.top - margin.bottom;

  // Escala máxima del eje Y
  let maxPuntos = 5;
  if (serie === 'ambos') {
    maxPuntos = Math.max(...mensual.map(m => Math.max(Number(m.totalDiagnosticos ?? m.denominador) || 0, Number(m.siCumplen ?? m.cumplen) || 0)), 5);
  } else if (serie === 'cumplen') {
    maxPuntos = Math.max(...mensual.map(m => Number(m.siCumplen ?? m.cumplen) || 0), 5);
  } else {
    maxPuntos = Math.max(...mensual.map(m => Number(m.totalDiagnosticos ?? m.denominador) || 0), 5);
  }
  const yMax = Math.ceil(maxPuntos * 1.25);

  const n = mensual.length;
  const slotW = chartW / n;

  // Líneas de grilla horizontales
  const gridTicks = [0, Math.round(yMax * 0.33), Math.round(yMax * 0.66), yMax];
  let gridLinesSvg = '';
  gridTicks.forEach(tick => {
    const yPos = margin.top + chartH - (tick / yMax) * chartH;
    gridLinesSvg += `
      <line x1="${margin.left}" y1="${yPos}" x2="${margin.left + chartW}" y2="${yPos}" class="ind-grid-line"/>
      <text x="${margin.left - 8}" y="${yPos + 4}" class="ind-axis-label-val">${tick}</text>
    `;
  });

  // Coordenadas Serie 1: Casos Diagnosticados (Azul)
  const coordsCancer = mensual.map((m, idx) => {
    const cx = margin.left + idx * slotW + slotW / 2;
    const valTotal = Number(m.totalDiagnosticos ?? m.denominador) || 0;
    const valNoC = Number(m.noContinuaron ?? m.noCumplen) || 0;
    const cy = margin.top + chartH - (valTotal / yMax) * chartH;
    return { x: cx, y: cy, val: valTotal, mes: m.nombreMes, noContinuaron: valNoC };
  });

  // Coordenadas Serie 2: Tratamiento Oportuno ≤ 37 d (Verde)
  const coordsCumplen = mensual.map((m, idx) => {
    const cx = margin.left + idx * slotW + slotW / 2;
    const valSi = Number(m.siCumplen ?? m.cumplen) || 0;
    const cy = margin.top + chartH - (valSi / yMax) * chartH;
    return { x: cx, y: cy, val: valSi, mes: m.nombreMes, pct: m.porcentajeMes || 0 };
  });

  let pathsSvg = '';
  let pointsSvg = '';

  // Serie 1: Casos Diagnosticados (Azul)
  if (serie === 'ambos' || serie === 'nocumplen') {
    const pathDCancer = coordsCancer.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`).join(' ');
    pathsSvg += `<path d="${pathDCancer}" class="ind-trend-line blue" />`;

    coordsCancer.forEach(pt => {
      const tooltip = `${pt.mes}: ${pt.val} pacientes con diagnóstico de cáncer prevalente (${pt.noContinuaron} pendientes o fuera de plazo)`;
      pointsSvg += `
        <g class="ind-point-group blue" tabindex="0">
          <title>${esc(tooltip)}</title>
          <circle cx="${pt.x}" cy="${pt.y}" r="5.5" class="ind-trend-point blue" />
          ${pt.val > 0 ? `<text x="${pt.x}" y="${pt.y - 10}" class="ind-point-val-text blue">${pt.val}</text>` : ''}
        </g>
      `;
    });
  }

  // Serie 2: Tratamiento Oportuno (Verde)
  if (serie === 'ambos' || serie === 'cumplen') {
    const pathDCumplen = coordsCumplen.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`).join(' ');
    pathsSvg += `<path d="${pathDCumplen}" class="ind-trend-line green" />`;

    coordsCumplen.forEach(pt => {
      const tooltip = `${pt.mes}: ${pt.val} pacientes con tratamiento oportuno ≤ 37 d (${pt.pct}% de cumplimiento)`;
      const yLabel = (serie === 'ambos' && pt.val === coordsCancer.find(c => c.mes === pt.mes)?.val && pt.val > 0)
        ? pt.y + 18
        : pt.y - 10;

      pointsSvg += `
        <g class="ind-point-group green" tabindex="0">
          <title>${esc(tooltip)}</title>
          <circle cx="${pt.x}" cy="${pt.y}" r="5" class="ind-trend-point green" />
          ${pt.val > 0 ? `<text x="${pt.x}" y="${yLabel}" class="ind-point-val-text green">${pt.val}</text>` : ''}
        </g>
      `;
    });
  }

  // Etiquetas de meses
  let xLabelsSvg = '';
  mensual.forEach((m, idx) => {
    const cx = margin.left + idx * slotW + slotW / 2;
    const nombreCorto = m.nombreMes.substring(0, 3).toUpperCase();
    xLabelsSvg += `<text x="${cx}" y="${height - 12}" class="ind-axis-label">${esc(nombreCorto)}</text>`;
  });

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" class="ind-svg-chart" preserveAspectRatio="xMidYMid meet">
      ${gridLinesSvg}
      <line x1="${margin.left}" y1="${margin.top + chartH}" x2="${margin.left + chartW}" y2="${margin.top + chartH}" class="ind-axis-line"/>
      ${pathsSvg}
      ${pointsSvg}
      ${xLabelsSvg}
    </svg>
  `;
}

// ═════════════════════════════════════════════════════════════════════
//  VISTA ORDINAL (CONSOLIDADO AGRUPADO DEL SCRIPT OFICIAL)
// ═════════════════════════════════════════════════════════════════════
function renderizarTablaOrdinal(lista = []) {
  const tbody = document.getElementById('indOrdinalTableBody');
  const countBadge = document.getElementById('badgeOrdinalTotalTable');
  if (!tbody) return;

  if (countBadge) countBadge.textContent = `${lista.length} registros`;

  if (!lista || lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="13" class="ind-td-empty">No se encontraron registros ordinales para los filtros seleccionados.</td></tr>';
    return;
  }

  const nombresMeses = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  tbody.innerHTML = lista.map(row => {
    const mesNombre = nombresMeses[row.Mes] || row.Mes;
    const pct = row.Porcentaje !== '—' ? `${row.Porcentaje}%` : '—';
    return `
      <tr>
        <td>${esc(row.Region)}</td>
        <td>${esc(row.Provincia)}</td>
        <td>${esc(row.Distrito)}</td>
        <td><strong>${esc(row.Establecimiento)}</strong></td>
        <td>${esc(row.Categoria)}</td>
        <td>${esc(row.Anio)}</td>
        <td><strong>${esc(mesNombre)}</strong></td>
        <td>${esc(row.Tipo)}</td>
        <td>${esc(row.Genero)}</td>
        <td>${esc(row.Excluye)}</td>
        <td><strong>${row.Denominador}</strong></td>
        <td><strong style="color:#059669;">${row.Numerador}</strong></td>
        <td><strong>${pct}</strong></td>
      </tr>
    `;
  }).join('');
}

function filtrarTablaOrdinal(termino) {
  const q = String(termino || '').trim().toLowerCase();
  if (!q) {
    renderizarTablaOrdinal(listaOrdinalCompleta);
    return;
  }

  const filtrados = listaOrdinalCompleta.filter(r => {
    const t = String(r.Tipo || '').toLowerCase();
    const m = String(r.Mes || '').toLowerCase();
    const e = String(r.Establecimiento || '').toLowerCase();
    return t.includes(q) || m.includes(q) || e.includes(q);
  });

  renderizarTablaOrdinal(filtrados);
}

// ═════════════════════════════════════════════════════════════════════
//  EXPORTACIONES INSTITUCIONALES (EXCEL Y PDF) — PLANTILLA HRA
// ═════════════════════════════════════════════════════════════════════

const NOMBRES_MESES_ESP = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function obtenerMetadatosIndicador14() {
  const anio = gv('indFiltroAnio') || '2026';
  const fIni = gv('indFechaInicio') || `${anio}-01-01`;
  const fFin = gv('indFechaFin') || `${anio}-12-31`;
  const tCancer = document.getElementById('indFiltroCancer')?.selectedOptions?.[0]?.text || 'Todos los cánceres (10)';
  const estab = document.getElementById('indFiltroRenaes')?.selectedOptions?.[0]?.text || 'Hospital Regional de Ayacucho (35125)';
  const res = indicador14Data?.resumen || {};

  return {
    titulo: 'Indicador 14: Tratamiento oportuno de cánceres prevalentes',
    datos: [
      ['Indicador', '14 - Tratamiento oportuno de cánceres prevalentes'],
      ['Tipo de Indicador', 'Indicador de desempeño (Fórmula oficial MINSA)'],
      ['Año evaluado', anio],
      ['Rango de fechas', `${fIni} al ${fFin}`],
      ['Establecimiento', estab],
      ['Tipo de cáncer', tCancer],
      ['Fórmula oficial', 'Cumplimiento (%) = (Tratados ≤ 37 d / [Denominador - Excluidos]) × 100']
    ],
    metricas: [
      { etiqueta: 'Cumplimiento Global', valor: `${res.pctCumplimiento || '0.0'}%` },
      { etiqueta: 'Total Evaluados (Denominador)', valor: res.totalDiagnosticos || res.denominador || 0 },
      { etiqueta: 'Tratamiento Oportuno (≤ 37 d)', valor: res.siCumplen || res.numerador || 0 },
      { etiqueta: 'Pendientes / Fuera de Plazo', valor: res.noContinuaron || res.noCumplen || 0 },
      { etiqueta: 'Excluidos (Paliativo/Defunción)', valor: res.excluidos || 0 },
      { etiqueta: 'Tiempo Promedio a Tratamiento', valor: res.diasPromedioTratamiento && res.diasPromedioTratamiento !== '—' ? `${res.diasPromedioTratamiento} d` : '—' }
    ],
    notas: [
      'Denominador: Pacientes con diagnóstico de cáncer prevalente (Cuello Uterino, Mama, Próstata, Colon, Estómago, Piel, Pulmón, Hígado, Linfoma, Leucemia) con procedimiento diagnóstico (Lab: A).',
      'Numerador: Pacientes del denominador que inician tratamiento oncológico oportuno (quimioterapia, radioterapia o cirugía con Lab: 1) dentro de los 37 días calendario posteriores al diagnóstico.',
      'Exclusiones: Pacientes con atención de cuidados paliativos o defunción (SINADEF) registrada dentro de los 37 días.',
      'Meta de Gestión: ≥ 80.0% de cumplimiento oportuno.'
    ]
  };
}

function construirSeccionOrdinal(lista = listaOrdinalCompleta) {
  const num = { tipo: 'numero', alinear: 'right' };
  return {
    titulo: 'Vista Ordinal — Consolidado Agrupado del Indicador',
    hoja: 'Vista Ordinal',
    columnas: [
      { titulo: 'Región', ancho: 14 },
      { titulo: 'Provincia', ancho: 14 },
      { titulo: 'Distrito', ancho: 26 },
      { titulo: 'Establecimiento', ancho: 38 },
      { titulo: 'Cat.', ancho: 8, alinear: 'center' },
      { titulo: 'Año', tipo: 'numero', ancho: 8, alinear: 'center' },
      { titulo: 'Mes', ancho: 12, alinear: 'center' },
      { titulo: 'Tipo Cáncer', ancho: 16 },
      { titulo: 'Género', ancho: 8, alinear: 'center' },
      { titulo: 'Excluye', ancho: 10, alinear: 'center' },
      { titulo: 'Denominador', ...num, ancho: 14 },
      { titulo: 'Numerador (Cumplen)', ...num, ancho: 16 },
      { titulo: '% Cumplimiento', ancho: 16, alinear: 'right' }
    ],
    filas: (lista || []).map(r => [
      r.Region || 'AYACUCHO',
      r.Provincia || 'HUAMANGA',
      r.Distrito || 'ANDRES AVELINO CACERES DORREGARAY',
      r.Establecimiento || 'HOSPITAL REGIONAL DE AYACUCHO',
      r.Categoria || 'II-2',
      r.Anio || 2026,
      NOMBRES_MESES_ESP[r.Mes] || r.Mes,
      r.Tipo || '',
      r.Genero || '',
      r.Excluye || 'NO',
      Number(r.Denominador) || 0,
      Number(r.Numerador) || 0,
      r.Porcentaje !== '—' ? `${r.Porcentaje}%` : '0.0%'
    ])
  };
}

function construirSeccionNominal(lista = padronNominalCompleto) {
  const num = { tipo: 'numero', alinear: 'right' };
  return {
    titulo: 'Vista Nominal — Padrón Detallado de Pacientes',
    hoja: 'Padrón Nominal',
    columnas: [
      { titulo: 'RENAES', ancho: 12, alinear: 'center' },
      { titulo: 'Año', tipo: 'numero', ancho: 8, alinear: 'center' },
      { titulo: 'Mes', ancho: 10, alinear: 'center' },
      { titulo: 'Cita Diag.', tipo: 'codigo', ancho: 14 },
      { titulo: 'N° Documento', tipo: 'codigo', ancho: 14 },
      { titulo: 'Apellidos y Nombres del Paciente', ancho: 36 },
      { titulo: 'Género', ancho: 8, alinear: 'center' },
      { titulo: 'Tipo Cáncer', ancho: 16 },
      { titulo: 'F. Diagnóstico', tipo: 'fecha', ancho: 14, alinear: 'center' },
      { titulo: 'F. Límite Oportuna (37d)', tipo: 'fecha', ancho: 18, alinear: 'center' },
      { titulo: 'F. Tratamiento', tipo: 'fecha', ancho: 14, alinear: 'center' },
      { titulo: 'Días Tratam.', ...num, ancho: 12 },
      { titulo: 'Plazo Restante', ancho: 20, alinear: 'center' },
      { titulo: 'Excluye', ancho: 10, alinear: 'center' },
      { titulo: 'Den', ...num, ancho: 8 },
      { titulo: 'Num', ...num, ancho: 8 },
      { titulo: 'Estado de Gestión', ancho: 26 }
    ],
    filas: (lista || []).map(p => {
      const fDiag = p.Fecha_Diagnostico || '';
      const fLimite = p.Fecha_Limite || calcularFechaLimiteTratamiento(fDiag, 37);
      const plazo = calcularPlazoRestante(p);
      let estadoTexto = p.Estado_Gestion;
      if (p.Excluye === 'SI') estadoTexto = 'EXCLUIDO';
      else if (p.Num === 1) estadoTexto = 'CUMPLE REQUISITO (≤ 37 d)';
      else estadoTexto = 'PENDIENTE / NO CONTINUÓ';

      return [
        p.renaes || '00035125',
        p.Anio || 2026,
        NOMBRES_MESES_ESP[p.Mes] || p.Mes,
        p.Id_Cita_Diagnostico || '',
        p.num_doc || '',
        p.Paciente || 'Sin nombre registrado',
        p.id_genero || '',
        p.Tipo_Cancer || '',
        fDiag,
        fLimite !== '—' ? fLimite : '',
        p.Fecha_Tratamiento || '',
        p.Dias_Hasta_Tratamiento != null ? p.Dias_Hasta_Tratamiento : '',
        plazo.texto,
        p.Excluye || 'NO',
        Number(p.den) || 1,
        Number(p.Num) || 0,
        estadoTexto
      ];
    })
  };
}

function construirSeccionMensual() {
  const num = { tipo: 'numero', alinear: 'right' };
  return {
    titulo: 'Evolución y Totales Mensuales Progresivos',
    hoja: 'Evolución Mensual',
    columnas: [
      { titulo: 'Mes', ancho: 14 },
      { titulo: 'Total Diagnósticos', ...num, ancho: 18 },
      { titulo: 'Sí Cumplen (≤ 37 d)', ...num, ancho: 18 },
      { titulo: 'No Continuaron', ...num, ancho: 18 },
      { titulo: 'Total Acumulado', ...num, ancho: 18 },
      { titulo: 'Acumulado Sí Cumplen', ...num, ancho: 20 },
      { titulo: '% Cumplimiento Mes', ancho: 18, alinear: 'right' },
      { titulo: '% Cumplimiento Acumulado', ancho: 22, alinear: 'right' }
    ],
    filas: (indicador14Data?.mensual || []).map(m => [
      m.nombreMes,
      Number(m.totalDiagnosticos ?? m.denominador) || 0,
      Number(m.siCumplen ?? m.cumplen) || 0,
      Number(m.noContinuaron ?? m.noCumplen) || 0,
      Number(m.acumuladoTotal) || 0,
      Number(m.acumuladoSiCumplen) || 0,
      `${m.porcentajeMes || 0}%`,
      `${m.porcentajeAcumulado || 0}%`
    ])
  };
}

// 1. Exportación Completa (Tres hojas en Excel / Reporte integral en PDF)
async function exportarReporteIndicador(formato = 'excel', boton = null) {
  if (!indicador14Data) {
    toast('Espere a que carguen los datos del indicador para exportar.', 'info');
    return;
  }
  const meta = obtenerMetadatosIndicador14();
  const seccionOrdinal = construirSeccionOrdinal(listaOrdinalCompleta);
  const seccionNominal = construirSeccionNominal(padronNominalCompleto);
  const seccionMensual = construirSeccionMensual();

  const doc = {
    titulo: 'Reporte Oficial — Indicador 14: Tratamiento Oportuno de Cánceres Prevalentes',
    archivo: `indicador-14-reporte-completo-${gv('indFiltroAnio') || '2026'}`,
    datos: meta.datos,
    metricas: meta.metricas,
    notas: meta.notas,
    secciones: [seccionOrdinal, seccionNominal, seccionMensual]
  };

  if (typeof exportarDocumento === 'function') {
    await exportarDocumento(formato, doc, boton);
  } else {
    toast('Módulo institucional de exportación no disponible.', 'error');
  }
}

// 2. Exportación de Vista Ordinal
async function exportarVistaOrdinal(formato = 'excel', boton = null) {
  if (!listaOrdinalCompleta || listaOrdinalCompleta.length === 0) {
    toast('No hay datos ordinales para exportar.', 'info');
    return;
  }
  const meta = obtenerMetadatosIndicador14();
  const seccionOrdinal = construirSeccionOrdinal(listaOrdinalCompleta);

  const doc = {
    titulo: 'Indicador 14: Cálculo Agrupado — Vista Ordinal',
    archivo: `indicador-14-vista-ordinal-${gv('indFiltroAnio') || '2026'}`,
    datos: meta.datos,
    metricas: meta.metricas,
    notas: meta.notas,
    secciones: [seccionOrdinal]
  };

  if (typeof exportarDocumento === 'function') {
    await exportarDocumento(formato, doc, boton);
  } else {
    toast('Módulo institucional de exportación no disponible.', 'error');
  }
}

function exportarTablaOrdinal() {
  exportarVistaOrdinal('excel');
}

// 3. Exportación de Vista Nominal
async function exportarVistaNominal(formato = 'excel', boton = null) {
  const q = (document.getElementById('indNominalSearch')?.value || '').toLowerCase().trim();
  const estadoFiltro = document.getElementById('filtroEstadoNominal')?.value || '';

  let listaAExportar = padronNominalCompleto || [];
  if (estadoFiltro === 'CUMPLE') {
    listaAExportar = listaAExportar.filter(p => p.Num === 1 && p.Excluye !== 'SI');
  } else if (estadoFiltro === 'NO_CUMPLE') {
    listaAExportar = listaAExportar.filter(p => p.Num === 0 && p.Excluye !== 'SI');
  } else if (estadoFiltro === 'EXCLUIDO') {
    listaAExportar = listaAExportar.filter(p => p.Excluye === 'SI');
  }
  if (q) {
    listaAExportar = listaAExportar.filter(p => {
      const doc = String(p.num_doc || '').toLowerCase();
      const pac = String(p.Paciente || '').toLowerCase();
      const can = String(p.Tipo_Cancer || '').toLowerCase();
      return doc.includes(q) || pac.includes(q) || can.includes(q);
    });
  }

  if (!listaAExportar || listaAExportar.length === 0) {
    toast('No hay pacientes para exportar con los filtros actuales.', 'info');
    return;
  }

  const meta = obtenerMetadatosIndicador14();
  const seccionNominal = construirSeccionNominal(listaAExportar);

  const doc = {
    titulo: 'Indicador 14: Padrón Detallado de Pacientes — Vista Nominal',
    archivo: `indicador-14-padron-nominal-${gv('indFiltroAnio') || '2026'}`,
    datos: meta.datos,
    metricas: meta.metricas,
    notas: meta.notas,
    secciones: [seccionNominal]
  };

  if (typeof exportarDocumento === 'function') {
    await exportarDocumento(formato, doc, boton);
  } else {
    toast('Módulo institucional de exportación no disponible.', 'error');
  }
}

function exportarPadronIndicador14() {
  exportarVistaNominal('excel');
}

// ═════════════════════════════════════════════════════════════════════
//  VISTA NOMINAL (PADRÓN DETALLADO DE PACIENTES DEL SCRIPT OFICIAL)
// ═════════════════════════════════════════════════════════════════════

// Calcula la fecha límite de tratamiento (37 días calendario posteriores al diagnóstico)
function calcularFechaLimiteTratamiento(fechaDiagStr, diasPlazo = 37) {
  if (!fechaDiagStr || fechaDiagStr === '—') return '—';
  try {
    const raw = String(fechaDiagStr).split('T')[0].trim();
    const parts = raw.split('-');
    if (parts.length < 3) return '—';
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    const dateObj = new Date(y, m, d);
    dateObj.setDate(dateObj.getDate() + diasPlazo);
    const resY = dateObj.getFullYear();
    const resM = String(dateObj.getMonth() + 1).padStart(2, '0');
    const resD = String(dateObj.getDate()).padStart(2, '0');
    return `${resY}-${resM}-${resD}`;
  } catch (e) {
    return '—';
  }
}

// Calcula el plazo restante en días respecto a la fecha actual y el estado clínico del paciente
function calcularPlazoRestante(paciente) {
  if (paciente.Excluye === 'SI') {
    return {
      dias: null,
      texto: 'Excluido',
      clase: 'excluido',
      tooltip: paciente.Motivo_Exclusion || 'Paciente excluido por criterio técnico (paliativo o defunción ≤ 37 d)'
    };
  }

  // Si ya inició tratamiento oportuno (Num === 1 o tiene fecha de tratamiento dentro de los 37 días)
  if (paciente.Num === 1 || (paciente.Fecha_Tratamiento && paciente.Dias_Hasta_Tratamiento != null && paciente.Dias_Hasta_Tratamiento <= 37)) {
    const dias = paciente.Dias_Hasta_Tratamiento != null ? `${paciente.Dias_Hasta_Tratamiento} d` : '≤ 37 d';
    return {
      dias: 0,
      texto: `Atendido (${dias})`,
      clase: 'cumple',
      tooltip: `Tratamiento oncológico oportuno iniciado a los ${dias} de diagnosticado`
    };
  }

  if (!paciente.Fecha_Diagnostico) {
    return { dias: null, texto: '—', clase: '', tooltip: 'Sin fecha de diagnóstico registrada' };
  }

  const fLimiteStr = paciente.Fecha_Limite || calcularFechaLimiteTratamiento(paciente.Fecha_Diagnostico, 37);
  if (fLimiteStr === '—') {
    return { dias: null, texto: '—', clase: '', tooltip: '' };
  }

  const parts = fLimiteStr.split('-');
  const fLimite = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  fLimite.setHours(0, 0, 0, 0);

  const diffMs = fLimite.getTime() - hoy.getTime();
  const diffDias = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDias > 20) {
    return {
      dias: diffDias,
      texto: `${diffDias} d restantes`,
      clase: 'largo',
      tooltip: `Plazo amplio: quedan ${diffDias} días calendario para inicio oportuno (límite: ${fLimiteStr})`
    };
  } else if (diffDias > 7) {
    return {
      dias: diffDias,
      texto: `${diffDias} d restantes`,
      clase: 'medio',
      tooltip: `Plazo medio: quedan ${diffDias} días (límite: ${fLimiteStr})`
    };
  } else if (diffDias > 0) {
    return {
      dias: diffDias,
      texto: `${diffDias} d restantes`,
      clase: 'critico',
      tooltip: `Plazo crítico: vence en ${diffDias} días (límite: ${fLimiteStr})`
    };
  } else if (diffDias === 0) {
    return {
      dias: 0,
      texto: 'Vence hoy',
      clase: 'critico',
      tooltip: `Urgente: Hoy es el último día para inicio oportuno de tratamiento (${fLimiteStr})`
    };
  } else {
    const diasVencido = Math.abs(diffDias);
    return {
      dias: diffDias,
      texto: `Vencido (-${diasVencido} d)`,
      clase: 'critico',
      tooltip: `Plazo oportuno vencido hace ${diasVencido} días (venció el ${fLimiteStr})`
    };
  }
}

function renderizarTablaNominal(lista = []) {
  const tbody = document.getElementById('indNominalTableBody');
  const countBadge = document.getElementById('badgeNominalTotalTable');
  if (!tbody) return;

  if (countBadge) countBadge.textContent = `${lista.length} pacientes`;

  if (!lista || lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="17" class="ind-td-empty">No se encontraron pacientes para los filtros especificados.</td></tr>';
    return;
  }

  tbody.innerHTML = lista.map(p => {
    let statusClass = 'nocumple';
    let estadoTexto = p.Estado_Gestion;
    if (p.Excluye === 'SI') {
      statusClass = 'excluido';
      estadoTexto = 'EXCLUIDO';
    } else if (p.Num === 1) {
      statusClass = 'cumple';
      estadoTexto = 'CUMPLE REQUISITO (≤ 37 d)';
    } else {
      estadoTexto = 'PENDIENTE / NO CONTINUÓ';
    }

    const fDiag = p.Fecha_Diagnostico || '—';
    const fLimite = p.Fecha_Limite || calcularFechaLimiteTratamiento(fDiag, 37);
    const fTrat = p.Fecha_Tratamiento || '—';
    const dias = p.Dias_Hasta_Tratamiento != null ? `${p.Dias_Hasta_Tratamiento} d` : '—';
    const plazo = calcularPlazoRestante(p);

    return `
      <tr>
        <td>${esc(p.renaes)}</td>
        <td>${esc(p.Anio)}</td>
        <td>${esc(p.Mes)}</td>
        <td>${esc(p.Id_Cita_Diagnostico)}</td>
        <td><strong>${esc(p.num_doc)}</strong></td>
        <td><strong>${esc(p.Paciente || 'Sin nombre registrado')}</strong></td>
        <td>${esc(p.id_genero)}</td>
        <td>${esc(p.Tipo_Cancer)}</td>
        <td>${esc(fDiag)}</td>
        <td><strong style="color:#1e40af;">${esc(fLimite)}</strong></td>
        <td>${esc(fTrat)}</td>
        <td><strong>${esc(dias)}</strong></td>
        <td><span class="ind-plazo-badge ${plazo.clase}" title="${esc(plazo.tooltip)}">${esc(plazo.texto)}</span></td>
        <td>${esc(p.Excluye)}</td>
        <td>${p.den}</td>
        <td><strong>${p.Num}</strong></td>
        <td><span class="ind-status-pill ${statusClass}">${esc(estadoTexto)}</span></td>
      </tr>
    `;
  }).join('');
}

// Filtro rápido sobre el padrón nominal cargado
function filtrarPadronNominal() {
  const q = gv('indNominalSearch').toLowerCase();
  const estadoFiltro = gv('filtroEstadoNominal');

  let filtrados = padronNominalCompleto;

  if (estadoFiltro === 'CUMPLE') {
    filtrados = filtrados.filter(p => p.Num === 1 && p.Excluye !== 'SI');
  } else if (estadoFiltro === 'NO_CUMPLE') {
    filtrados = filtrados.filter(p => p.Num === 0 && p.Excluye !== 'SI');
  } else if (estadoFiltro === 'EXCLUIDO') {
    filtrados = filtrados.filter(p => p.Excluye === 'SI');
  }

  if (q) {
    filtrados = filtrados.filter(p => {
      const doc = String(p.num_doc || '').toLowerCase();
      const pac = String(p.Paciente || '').toLowerCase();
      const can = String(p.Tipo_Cancer || '').toLowerCase();
      return doc.includes(q) || pac.includes(q) || can.includes(q);
    });
  }

  renderizarTablaNominal(filtrados);
}
