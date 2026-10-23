// ═══════════════════════════════════════
//  EXPORTACIÓN A EXCEL Y PDF CON LA PLANTILLA DEL HOSPITAL
// ═══════════════════════════════════════
// Todas las exportaciones de la página usan exportarDocumento(formato, documento).
// Las librerías están en /vendor (no dependen de internet) y se cargan solo la primera vez que se exporta.
//
// El diseño sigue el formato de los reportes del hospital (Reporte F40): un recuadro con el logo del hospital
// a la izquierda, el nombre y el título al centro y el logo del Área de Procesamiento de Datos a la derecha;
// debajo, los datos del reporte en tres columnas («ETIQUETA: valor»).
//
// documento = {
//   titulo: 'Reporte de producción del personal asistencial',
//   datos: [['Año', 2026], ['Mes', 'Enero'], ['DNI', '41217063']],   // datos del recuadro (opcional)
//   descripcion: 'texto libre',                                       // si no hay «datos», se muestra como «Detalle»
//   archivo: 'produccion-personal',                                   // nombre del archivo sin extensión
//   metricas: [{ etiqueta: 'Citas', valor: 1200 }],                   // cifras destacadas (opcional)
//   notas: ['Atenciones: …'],                                         // definiciones al pie (opcional)
//   secciones: [{ titulo: 'Códigos HIS', columnas: [{ titulo: 'Código', tipo: 'codigo' }], filas: [['F928']] }]
// }
// Tipos de columna: 'texto' (predeterminado), 'numero', 'fecha' y 'codigo'. Opcional: ancho (Excel) y alinear.

// Datos de la plantilla: cambia estos textos si el nombre de la institución o del área varía.
const PLANTILLA = {
  institucion: 'Hospital Regional de Ayacucho',
  encabezado: 'HOSPITAL REGIONAL DE AYACUCHO "MIGUEL ÁNGEL MARISCAL LLERENA"',
  fuente: 'Fuente: HIS MINSA (base de datos BDHIS_HRA).',
  elaboracion: 'Elaboración: Unidad de Estadística e Informática - Área de Procesamiento de Datos.',
  logo: '/img/logo-hospital.png',
  logoArea: '/img/logo-area-datos.png',
  colores: {
    primario: '6B2470',
    primarioOscuro: '551B5A',
    acento: 'B25AA0',
    fondoFila: 'F8F1F8',
    borde: 'E3D3E3',
    recuadro: 'A07AA3',
    lila: 'F3E8F3',
    lilaLinea: 'C9B3CA',
    texto: '2E1A30',
    negro: '1D1D1F',
    gris: '6F6F73'
  }
};

const VENDOR = {
  excel: ['/vendor/exceljs.min.js'],
  pdf: ['/vendor/jspdf.umd.min.js', '/vendor/jspdf.plugin.autotable.min.js']
};
const scriptsCargados = new Map();

function cargarScript(src) {
  if (!scriptsCargados.has(src)) {
    scriptsCargados.set(src, new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => { scriptsCargados.delete(src); reject(new Error(`No se pudo cargar ${src}. Recarga la página con Ctrl+F5.`)); };
      document.head.appendChild(script);
    }));
  }
  return scriptsCargados.get(src);
}

async function cargarLibrerias(formato) {
  for (const src of VENDOR[formato === 'pdf' ? 'pdf' : 'excel']) await cargarScript(src);
}

// Carga una imagen, la reduce sobre fondo blanco y la devuelve en JPEG base64 (archivos livianos y nítidos al imprimir).
// Si no se encuentra, el documento sale sin esa imagen.
const imagenesCache = new Map();
function obtenerImagen(src, anchoMax = 480) {
  if (!imagenesCache.has(src)) {
    imagenesCache.set(src, (async () => {
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error('sin imagen');
        const url = URL.createObjectURL(await res.blob());
        const img = await new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = reject;
          image.src = url;
        });
        const width = Math.min(anchoMax, img.naturalWidth);
        const height = Math.round(width * img.naturalHeight / img.naturalWidth);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(url);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
        return { dataUrl, base64: dataUrl.split(',')[1], width, height };
      } catch {
        return null;
      }
    })());
  }
  return imagenesCache.get(src);
}

const pad2 = n => String(n).padStart(2, '0');
function fechaHoraActual() {
  const d = new Date();
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// Convierte una fecha ISO (como las entrega SQL Server) en Date sin desfase de zona horaria.
function aFecha(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value;
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(value));
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3], +(iso[4] || 0), +(iso[5] || 0), +(iso[6] || 0)));
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value));
  if (dmy) return new Date(Date.UTC(+dmy[3], +dmy[2] - 1, +dmy[1]));
  return null;
}
function fechaTexto(value) {
  const d = aFecha(value);
  if (!d) return value === null || value === undefined ? '' : String(value);
  const base = `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  return d.getUTCHours() || d.getUTCMinutes() ? `${base} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}` : base;
}
function aNumero(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}
function textoCelda(value, tipo) {
  if (value === null || value === undefined || value === '') return '';
  if (tipo === 'fecha') return fechaTexto(value);
  if (tipo === 'numero') { const n = aNumero(value); return n === null ? String(value) : n.toLocaleString('es-PE'); }
  return String(value);
}

function nombreArchivo(base, extension) {
  const limpio = String(base || 'reporte').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'reporte';
  const d = new Date();
  return `${limpio}-${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}.${extension}`;
}

function descargarBlob(blob, filename) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}

// Datos del recuadro: los del documento (o su descripción como «Detalle») más la fecha de emisión.
// Los valores largos ocupan una fila completa; los demás se reparten en tres columnas.
function datosRecuadro(doc) {
  const valido = ([, valor]) => valor !== null && valor !== undefined && String(valor).trim() !== '';
  const normal = ([etiqueta, valor]) => [String(etiqueta).toUpperCase(), String(valor)];
  // Con «datosColumnas» cada lista va en su propia columna del recuadro (en el orden dado).
  if (doc.datosColumnas?.length) {
    const columnas = doc.datosColumnas.slice(0, 3).map(col => col.filter(valido).map(normal));
    while (columnas.length < 3) columnas.push([]);
    columnas[2].push(['FECHA DE EMISIÓN', fechaHoraActual()]);
    const alto = Math.max(...columnas.map(c => c.length));
    const cortos = columnas.flatMap(c => [...c, ...Array(alto - c.length).fill(null)]);
    return { cortos, largos: [] };
  }
  const base = (doc.datos?.length ? doc.datos : (doc.descripcion ? [['Detalle', doc.descripcion]] : []))
    .filter(([, valor]) => valor !== null && valor !== undefined && String(valor).trim() !== '')
    .map(([etiqueta, valor]) => [String(etiqueta).toUpperCase(), String(valor)]);
  base.push(['FECHA DE EMISIÓN', fechaHoraActual()]);
  const largos = base.filter(([e, v]) => e.length + v.length > 58);
  const cortos = base.filter(item => !largos.includes(item));
  return { cortos, largos };
}

// Celdas combinadas hacia abajo (seccion.combinar = índices de columna): un valor se extiende por las filas vacías
// siguientes de su columna; un valor nuevo en una columna combinada anterior corta la combinación.
function calcularCombinadas(seccion) {
  const cols = seccion.combinar || [];
  const span = seccion.filas.map(() => ({}));
  cols.forEach((c, k) => {
    let inicio = -1;
    seccion.filas.forEach((fila, r) => {
      const vacio = v => v === null || v === undefined || v === '';
      if (!vacio(fila[c])) { inicio = r; span[r][c] = 1; return; }
      if (cols.slice(0, k).some(prev => !vacio(fila[prev]))) inicio = -1;
      if (inicio >= 0) { span[inicio][c] += 1; span[r][c] = 0; }
    });
  });
  return span;
}

// ── Excel ──
function nombreHoja(titulo, usados) {
  const base = String(titulo || 'Datos').replace(/[\\/*?:[\]]/g, ' ').trim().slice(0, 31) || 'Datos';
  let nombre = base;
  for (let i = 2; usados.has(nombre.toLowerCase()); i += 1) nombre = `${base.slice(0, 28)} ${i}`;
  usados.add(nombre.toLowerCase());
  return nombre;
}

// Ubica una posición en píxeles dentro de las columnas (ExcelJS ancla las imágenes por columna y fracción).
function columnaEnPx(anchosPx, px) {
  let acumulado = 0;
  for (let i = 0; i < anchosPx.length; i += 1) {
    if (px <= acumulado + anchosPx[i]) return i + (px - acumulado) / anchosPx[i];
    acumulado += anchosPx[i];
  }
  return anchosPx.length;
}

async function generarExcel(doc) {
  await cargarLibrerias('excel');
  const [logo, logoArea] = await Promise.all([obtenerImagen(PLANTILLA.logo), obtenerImagen(PLANTILLA.logoArea, 520)]);
  const C = PLANTILLA.colores;
  const argb = hex => `FF${hex}`;
  const wb = new window.ExcelJS.Workbook();
  wb.creator = `${PLANTILLA.institucion} – HIS MINSA`;
  wb.created = new Date();
  const logoId = logo ? wb.addImage({ base64: logo.base64, extension: 'jpeg' }) : null;
  const logoAreaId = logoArea ? wb.addImage({ base64: logoArea.base64, extension: 'jpeg' }) : null;
  const usados = new Set();
  const borde = { style: 'thin', color: { argb: argb(C.borde) } };
  const lineaRecuadro = { style: 'thin', color: { argb: argb(C.recuadro) } };
  const { cortos, largos } = datosRecuadro(doc);

  doc.secciones.forEach((seccion, indice) => {
    const columnas = seccion.columnas;
    const n = Math.max(columnas.length, 1);
    const ws = wb.addWorksheet(nombreHoja(seccion.hoja || seccion.titulo, usados), {
      pageSetup: { paperSize: 9, orientation: n > 6 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
        margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.3 } },
      headerFooter: { oddFooter: `&L&8${PLANTILLA.institucion} · HIS MINSA&C&8${doc.titulo.replace(/&/g, '&&')}&R&8Página &P de &N` },
      properties: { defaultRowHeight: 16 }
    });

    // Anchos según el contenido (9 a 55 caracteres); como mínimo 110 en total para que entren los dos logos y el título.
    const anchos = columnas.map((col, i) => {
      if (col.ancho) return col.ancho;
      const largo = Math.max(String(col.titulo).length, ...seccion.filas.slice(0, 400).map(f => textoCelda(f[i], col.tipo).length));
      return Math.min(55, Math.max(9, largo + 2));
    });
    const total = anchos.reduce((a, b) => a + b, 0);
    if (total < 110) {
      const extra = 110 - total;
      anchos.forEach((w, i) => { anchos[i] = w + extra * (w / total); });
    }
    ws.columns = anchos.map(width => ({ width }));
    const anchosTotal = anchos.reduce((a, b) => a + b, 0);
    const anchosPx = anchos.map(w => Math.round(w * 7 + 5));
    const totalPx = anchosPx.reduce((a, b) => a + b, 0);

    const celdaUnida = (row, c1, c2, valor, font, alignment, height) => {
      if (c2 > c1) ws.mergeCells(row, c1, row, c2);
      const cell = ws.getCell(row, c1);
      cell.value = valor;
      if (font) cell.font = { name: 'Calibri', ...font };
      cell.alignment = { vertical: 'middle', wrapText: true, ...alignment };
      if (height) ws.getRow(row).height = height;
      return cell;
    };

    // Línea superior: fecha y hora de emisión y nombre del reporte (como el encabezado del navegador en el modelo).
    celdaUnida(1, 1, n, `${fechaHoraActual()}        ${doc.titulo}`, { size: 8, color: { argb: argb(C.gris) } }, { horizontal: 'left' }, 14);

    // Recuadro: filas 2 a 4 con logos y textos centrados.
    const r0 = 2;
    ws.getRow(r0).height = 8;
    celdaUnida(r0 + 1, 1, n, PLANTILLA.encabezado, { size: 11, bold: true, color: { argb: argb(C.primarioOscuro) } }, { horizontal: 'center' }, 20);
    celdaUnida(r0 + 2, 1, n, doc.titulo.toUpperCase(), { size: 10.5, bold: true, color: { argb: argb(C.primario) } }, { horizontal: 'center' }, 20);
    ws.getRow(r0 + 3).height = 8;
    if (logoId !== null) {
      const w = 165, h = Math.round(w * logo.height / logo.width);
      ws.addImage(logoId, { tl: { col: columnaEnPx(anchosPx, 8), row: r0 - 1 + 0.35 }, ext: { width: w, height: h }, editAs: 'oneCell' });
    }
    if (logoAreaId !== null) {
      const w = 130, h = Math.round(w * logoArea.height / logoArea.width);
      ws.addImage(logoAreaId, { tl: { col: columnaEnPx(anchosPx, totalPx - w - 8), row: r0 - 1 + 0.25 }, ext: { width: w, height: h }, editAs: 'oneCell' });
    }

    // Datos del recuadro en tres grupos de columnas, con la etiqueta en negrita.
    let row = r0 + 4;
    const separador = row;
    for (let c = 1; c <= n; c += 1) ws.getCell(separador, c).border = { top: lineaRecuadro };
    ws.getRow(separador).height = 5;
    row += 1;
    // Tres grupos de columnas de ancho parecido (según el ancho real de cada columna, no su cantidad).
    const grupos = Math.min(3, n);
    const cortes = [0];
    for (let g = 1; g < grupos; g += 1) {
      let acumulado = 0;
      let c = 0;
      while (c < n && acumulado + anchos[c] / 2 < (g * anchosTotal) / grupos) { acumulado += anchos[c]; c += 1; }
      cortes.push(Math.min(Math.max(c, cortes[g - 1] + 1), n - (grupos - g)));
    }
    cortes.push(n);
    const limites = Array.from({ length: grupos }, (_, g) => [cortes[g] + 1, cortes[g + 1]]);
    const capacidad = limites.map(([c1, c2]) => anchos.slice(c1 - 1, c2).reduce((a, b) => a + b, 0) * 1.05);
    const rico = (etiqueta, valor) => ({ richText: [
      { text: `${etiqueta}: `, font: { name: 'Calibri', size: 9.5, bold: true, color: { argb: argb(C.negro) } } },
      { text: valor, font: { name: 'Calibri', size: 9.5, color: { argb: argb(C.negro) } } }
    ] });
    const porColumna = Math.ceil(cortos.length / grupos);
    for (let i = 0; i < porColumna; i += 1) {
      let lineas = 1;
      limites.forEach(([c1, c2], g) => {
        const item = cortos[g * porColumna + i];
        if (item) {
          celdaUnida(row, c1, c2, rico(item[0], item[1]), null, { horizontal: 'left', vertical: 'top' });
          lineas = Math.max(lineas, Math.ceil((item[0].length + item[1].length + 2) / Math.max(8, capacidad[g])));
        } else if (c2 > c1) ws.mergeCells(row, c1, row, c2);
      });
      ws.getRow(row).height = Math.max(15, lineas * 13);
      row += 1;
    }
    largos.forEach(([etiqueta, valor]) => {
      const lineas = Math.ceil((etiqueta.length + valor.length) / Math.max(80, total * 1.05));
      celdaUnida(row, 1, n, rico(etiqueta, valor), null, { horizontal: 'left' }, Math.max(15, lineas * 13));
      row += 1;
    });
    ws.getRow(row).height = 5;
    const finRecuadro = row;
    // Borde del recuadro (de la fila 2 a la última fila de datos).
    for (let r = r0; r <= finRecuadro; r += 1) {
      for (let c = 1; c <= n; c += 1) {
        const cell = ws.getCell(r, c);
        const b = { ...(cell.border || {}) };
        if (r === r0) b.top = lineaRecuadro;
        if (r === finRecuadro) b.bottom = lineaRecuadro;
        if (c === 1) b.left = lineaRecuadro;
        if (c === n) b.right = lineaRecuadro;
        cell.border = b;
      }
    }
    row += 2;

    // Cifras destacadas en la primera hoja.
    if (indice === 0 && doc.metricas?.length) {
      const mitad = Math.max(1, Math.floor(n / 2));
      doc.metricas.forEach(m => {
        const label = celdaUnida(row, 1, mitad, m.etiqueta, { size: 10, color: { argb: argb(C.gris) } }, { horizontal: 'left' });
        label.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(C.fondoFila) } };
        label.border = { left: { style: 'thick', color: { argb: argb(C.primario) } } };
        const num = aNumero(m.valor);
        const val = celdaUnida(row, Math.min(mitad + 1, n), n, num === null ? (m.valor ?? '—') : num, { size: 11, bold: true, color: { argb: argb(C.primario) } }, { horizontal: 'left' });
        if (num !== null) val.numFmt = '#,##0';
        row += 1;
      });
      row += 1;
    }

    if (doc.secciones.length > 1) {
      celdaUnida(row++, 1, n, seccion.titulo, { size: 11, bold: true, color: { argb: argb(C.primarioOscuro) } }, { horizontal: 'left' }, 18);
    }

    // Tabla: cabecera morada (o gris en el estilo F40), filas alternadas, filtros y cabecera fija.
    const f40 = seccion.estilo === 'f40';
    const bordeTabla = f40 ? { style: 'thin', color: { argb: argb(C.lilaLinea) } } : borde;
    const combinar = seccion.combinar || [];
    const esTotal = r => seccion.totalDesde !== undefined && r >= seccion.totalDesde;
    const headerRow = row;
    columnas.forEach((col, i) => {
      const cell = ws.getCell(headerRow, i + 1);
      cell.value = col.titulo;
      cell.font = { name: 'Calibri', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(C.primario) } };
      cell.alignment = { vertical: 'middle', horizontal: col.alinear || (col.tipo === 'numero' ? 'right' : 'left'), wrapText: true };
      cell.border = { top: bordeTabla, left: bordeTabla, bottom: bordeTabla, right: bordeTabla };
    });
    ws.getRow(headerRow).height = 22;
    seccion.filas.forEach((fila, r) => {
      const excelRow = ws.getRow(headerRow + 1 + r);
      columnas.forEach((col, i) => {
        const cell = excelRow.getCell(i + 1);
        const raw = fila[i];
        if (col.tipo === 'numero') {
          const num = aNumero(raw);
          cell.value = num === null ? (raw ?? null) : num;
          if (num !== null) cell.numFmt = Number.isInteger(num) ? '#,##0' : '#,##0.00';
          cell.alignment = { horizontal: col.alinear || 'right', vertical: f40 ? 'middle' : 'top' };
        } else if (col.tipo === 'fecha') {
          const d = aFecha(raw);
          cell.value = d || (raw ?? null);
          if (d) cell.numFmt = d.getUTCHours() || d.getUTCMinutes() ? 'dd/mm/yyyy hh:mm' : 'dd/mm/yyyy';
          cell.alignment = { horizontal: 'left', vertical: 'top' };
        } else {
          cell.value = raw === null || raw === undefined ? null : String(raw);
          cell.alignment = { vertical: f40 ? 'middle' : 'top', horizontal: col.alinear || 'left', wrapText: true };
          if (col.tipo === 'codigo') cell.font = { bold: true, color: { argb: argb(C.primario) } };
        }
        cell.border = { top: bordeTabla, left: bordeTabla, bottom: bordeTabla, right: bordeTabla };
        if (r % 2 === 1 && !f40) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(C.fondoFila) } };
        if (f40) {
          // Estilo F40 en tonos morados: UPSS y servicio en lila, columna TOTAL y filas de total resaltadas.
          const destacada = combinar.includes(i) || esTotal(r) || (seccion.resaltarTotal && i === n - 1);
          cell.font = { name: 'Calibri', size: 9.5, bold: destacada, color: { argb: argb(destacada ? C.primarioOscuro : C.texto) } };
          if (combinar.includes(i) || esTotal(r)) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(C.lila) } };
          else if (seccion.resaltarTotal && i === n - 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(C.fondoFila) } };
        }
      });
    });
    // Combina UPSS / servicio hacia abajo, centrados como en el modelo.
    calcularCombinadas(seccion).forEach((fila, r) => {
      Object.entries(fila).forEach(([c, n]) => {
        if (n > 1) ws.mergeCells(headerRow + 1 + r, Number(c) + 1, headerRow + r + n, Number(c) + 1);
        if (n >= 1) ws.getCell(headerRow + 1 + r, Number(c) + 1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      });
    });
    if (!seccion.filas.length) {
      celdaUnida(headerRow + 1, 1, n, 'Sin registros para mostrar.', { italic: true, color: { argb: argb(C.gris) } }, { horizontal: 'center' });
    } else if (!seccion.combinar?.length) {
      ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow + seccion.filas.length, column: n } };
    }
    ws.views = [{ state: 'frozen', ySplit: headerRow, showGridLines: false }];
    ws.pageSetup.printTitlesRow = `${headerRow}:${headerRow}`;

    // Definiciones, fuente y elaboración al pie, como en el modelo.
    let pie = headerRow + Math.max(seccion.filas.length, 1) + 2;
    if (doc.notas?.length) {
      celdaUnida(pie++, 1, n, 'Definiciones:', { size: 8.5, bold: true, underline: true, color: { argb: argb(C.negro) } }, { horizontal: 'left' });
      doc.notas.forEach(nota => celdaUnida(pie++, 1, n, nota, { size: 8.5, color: { argb: argb(C.negro) } }, { horizontal: 'left' }));
      pie += 1;
    }
    celdaUnida(pie++, 1, n, PLANTILLA.fuente, { size: 8.5, color: { argb: argb(C.negro) } }, { horizontal: 'left' });
    celdaUnida(pie, 1, n, PLANTILLA.elaboracion, { size: 8.5, color: { argb: argb(C.negro) } }, { horizontal: 'left' });
  });

  const buffer = await wb.xlsx.writeBuffer();
  descargarBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nombreArchivo(doc.archivo, 'xlsx'));
}

// ── PDF ──
async function generarPdf(doc) {
  await cargarLibrerias('pdf');
  const [logo, logoArea] = await Promise.all([obtenerImagen(PLANTILLA.logo), obtenerImagen(PLANTILLA.logoArea, 520)]);
  const C = PLANTILLA.colores;
  const rgb = hex => [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  const maxCols = Math.max(...doc.secciones.map(s => s.columnas.length), 1);
  const orientation = doc.orientacion || (maxCols > 5 ? 'landscape' : 'portrait');
  const pdf = new window.jspdf.jsPDF({ orientation, unit: 'mm', format: 'a4' });
  pdf.setProperties({ title: doc.titulo, subject: doc.titulo, creator: `${PLANTILLA.institucion} – HIS MINSA` });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const M = 10;
  const emision = fechaHoraActual();
  const CAJA_Y = 9;
  const CAJA_CAB = 17; // alto de la fila de logos y títulos
  const TOP = CAJA_Y + CAJA_CAB + 4; // inicio de la tabla en las páginas siguientes

  // Datos del recuadro (solo en la primera página): tres columnas y, debajo, los valores largos a todo el ancho.
  // Cada valor puede ocupar dos líneas en su columna; la fila toma el alto de su valor más largo.
  const { cortos, largos } = datosRecuadro(doc);
  const colAncho = (W - 2 * M - 8) / 3;
  const porColumna = Math.ceil(cortos.length / 3);
  const LINEA = 3.7;
  const partirDato = (etiqueta, valor, ancho) => {
    pdf.setFont('helvetica', 'bold').setFontSize(8);
    const et = `${etiqueta}: `;
    const wEt = pdf.getTextWidth(et) + 0.9;
    pdf.setFont('helvetica', 'normal').setFontSize(8);
    const primera = pdf.splitTextToSize(String(valor), Math.max(10, ancho - wEt));
    const resto = primera.length > 1 ? pdf.splitTextToSize(primera.slice(1).join(' '), ancho) : [];
    return { et, wEt, lineas: [primera[0] || '', ...resto] };
  };
  const filasDatos = Array.from({ length: porColumna }, (_, i) => {
    const celdas = [0, 1, 2].map(g => {
      const item = cortos[g * porColumna + i];
      return item ? partirDato(item[0], item[1], colAncho - 3) : null;
    });
    const alto = Math.max(1, ...celdas.map(c => (c ? Math.min(c.lineas.length, 2) : 1))) * LINEA + 0.6;
    return { celdas, alto };
  });
  const bloquesLargos = largos.map(([e, v]) => partirDato(e, v, W - 2 * M - 8));
  const altoDatos = 3 + filasDatos.reduce((a, f) => a + f.alto, 0) + bloquesLargos.reduce((a, b) => a + b.lineas.length * LINEA, 0) + 1.5;
  const finCaja1 = CAJA_Y + CAJA_CAB + altoDatos;

  const escribirBloque = (dato, x, y, maxLineas = 99) => {
    pdf.setTextColor(...rgb(C.negro)).setFontSize(8);
    pdf.setFont('helvetica', 'bold');
    pdf.text(dato.et, x, y);
    pdf.setFont('helvetica', 'normal');
    dato.lineas.slice(0, maxLineas).forEach((linea, k) => pdf.text(linea, k === 0 ? x + dato.wEt : x, y + k * LINEA));
  };
  let yd = CAJA_Y + CAJA_CAB + 4.5;
  filasDatos.forEach(fila => {
    fila.celdas.forEach((dato, g) => { if (dato) escribirBloque(dato, M + 4 + g * colAncho, yd, 2); });
    yd += fila.alto;
  });
  bloquesLargos.forEach(dato => {
    escribirBloque(dato, M + 4, yd);
    yd += dato.lineas.length * LINEA;
  });

  // Recuadro con logos y títulos en cada página; pie con página.
  const encabezado = (pagina) => {
    pdf.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...rgb(C.gris));
    pdf.text(emision, M, 6);
    pdf.text(doc.titulo, W / 2, 6, { align: 'center' });
    const alto = pagina === 1 ? finCaja1 - CAJA_Y : CAJA_CAB;
    pdf.setDrawColor(...rgb(C.recuadro)).setLineWidth(0.3);
    pdf.rect(M, CAJA_Y, W - 2 * M, alto);
    if (pagina === 1) pdf.line(M, CAJA_Y + CAJA_CAB, W - M, CAJA_Y + CAJA_CAB);
    if (logo) {
      const w = 38, h = w * logo.height / logo.width;
      pdf.addImage(logo.dataUrl, 'JPEG', M + 3, CAJA_Y + (CAJA_CAB - h) / 2, w, h, 'logo-hospital', 'FAST');
    }
    if (logoArea) {
      const w = 31, h = w * logoArea.height / logoArea.width;
      pdf.addImage(logoArea.dataUrl, 'JPEG', W - M - 3 - w, CAJA_Y + (CAJA_CAB - h) / 2, w, h, 'logo-area', 'FAST');
    }
    pdf.setFont('helvetica', 'bold').setTextColor(...rgb(C.primarioOscuro));
    const anchoTitulo = W - 2 * M - 2 * 43;
    // El nombre del hospital va en una sola línea: se reduce la letra hasta que entre entre los dos logos.
    let tam = 9.5;
    pdf.setFontSize(tam);
    while (tam > 6.5 && pdf.getTextWidth(PLANTILLA.encabezado) > anchoTitulo) { tam -= 0.25; pdf.setFontSize(tam); }
    pdf.text(PLANTILLA.encabezado, W / 2, CAJA_Y + 7.2, { align: 'center' });
    pdf.setFontSize(9);
    const titulo = pdf.splitTextToSize(doc.titulo.toUpperCase(), anchoTitulo);
    pdf.text(titulo.slice(0, 2), W / 2, CAJA_Y + 12, { align: 'center' });
  };
  const pie = (pagina, total) => {
    pdf.setDrawColor(...rgb(C.borde)).setLineWidth(0.3).line(M, H - 10, W - M, H - 10);
    pdf.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...rgb(C.gris));
    pdf.text(`${PLANTILLA.institucion} · Área de Procesamiento de Datos · Emitido el ${emision}`, M, H - 6);
    pdf.text(`Página ${pagina} de ${total}`, W - M, H - 6, { align: 'right' });
  };

  let y = finCaja1 + 5;

  if (doc.metricas?.length) {
    const porFila = orientation === 'landscape' ? 5 : 3;
    const gap = 3;
    const ancho = (W - 2 * M - gap * (porFila - 1)) / porFila;
    doc.metricas.forEach((m, i) => {
      const col = i % porFila;
      if (i && col === 0) y += 17;
      const x = M + col * (ancho + gap);
      pdf.setFillColor(...rgb(C.fondoFila)).setDrawColor(...rgb(C.borde)).setLineWidth(0.25);
      pdf.roundedRect(x, y, ancho, 14, 1.8, 1.8, 'FD');
      pdf.setFillColor(...rgb(C.primario)).rect(x, y + 1.8, 0.9, 10.4, 'F');
      pdf.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...rgb(C.gris));
      pdf.text(String(m.etiqueta), x + 4, y + 5);
      const num = aNumero(m.valor);
      pdf.setFont('helvetica', 'bold').setFontSize(12).setTextColor(...rgb(C.primario));
      pdf.text(num === null ? String(m.valor ?? '—') : num.toLocaleString('es-PE'), x + 4, y + 11);
    });
    y += 20;
  }

  doc.secciones.forEach((seccion, indice) => {
    if (doc.secciones.length > 1) {
      if (y > H - 40) { pdf.addPage(); y = TOP + 3; }
      pdf.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...rgb(C.primarioOscuro));
      pdf.text(seccion.titulo || doc.titulo, M, y + 1);
      if (!seccion.ocultarConteo) {
        pdf.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...rgb(C.gris));
        pdf.text(`${seccion.filas.length.toLocaleString('es-PE')} registro(s)`, W - M, y + 1, { align: 'right' });
      }
      y += 3.5;
    }
    const muchas = seccion.columnas.length > 9;
    const muchisimas = seccion.columnas.length > 20;
    const f40 = seccion.estilo === 'f40';
    const combinadas = calcularCombinadas(seccion);
    const cuerpo = seccion.filas.map((f, r) => seccion.columnas.flatMap((c, i) => {
      const n = combinadas[r][i];
      if (n === 0) return [];
      const content = textoCelda(f[i], c.tipo);
      const estiloComb = { valign: 'middle', halign: 'center', fontStyle: 'bold', fillColor: rgb(C.lila), textColor: rgb(C.primarioOscuro) };
      return n > 1 ? [{ content, rowSpan: n, styles: estiloComb }]
        : n === 1 ? [{ content, styles: estiloComb }] : [content];
    }));
    const lineaF40 = rgb(C.lilaLinea);
    const totalDesde = seccion.totalDesde;
    pdf.autoTable({
      startY: y,
      margin: { top: TOP, left: M, right: M, bottom: 14 },
      head: [seccion.columnas.map(c => c.titulo)],
      body: seccion.filas.length ? cuerpo : [[{ content: 'Sin registros para mostrar.', colSpan: seccion.columnas.length, styles: { halign: 'center', fontStyle: 'italic', textColor: rgb(C.gris) } }]],
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: muchisimas ? 6 : muchas ? 6.5 : 7.8, cellPadding: muchisimas ? 0.8 : muchas ? 1.2 : 1.8, textColor: f40 ? rgb(C.negro) : rgb(C.texto), lineColor: f40 ? lineaF40 : rgb(C.borde), lineWidth: f40 ? 0.2 : 0.15, overflow: 'linebreak', valign: f40 ? 'middle' : 'top' },
      headStyles: f40 ? { fillColor: rgb(C.primario), textColor: 255, fontStyle: 'bold', valign: 'middle', lineColor: lineaF40, lineWidth: 0.2 }
        : { fillColor: rgb(C.primario), textColor: 255, fontStyle: 'bold', valign: 'middle' },
      alternateRowStyles: f40 ? {} : { fillColor: rgb(C.fondoFila) },
      columnStyles: Object.fromEntries(seccion.columnas.map((c, i) => [i, {
        halign: c.alinear || (c.tipo === 'numero' ? 'right' : 'left'),
        fontStyle: c.tipo === 'codigo' ? 'bold' : 'normal',
        textColor: f40 ? rgb(C.negro) : c.tipo === 'codigo' ? rgb(C.primario) : rgb(C.texto),
        cellWidth: c.tipo === 'fecha' ? 20 : c.tipo === 'numero' ? 'wrap' : 'auto'
      }])),
      didParseCell: data => {
        if (data.section === 'head') { const c = seccion.columnas[data.column.index]; data.cell.styles.halign = c?.alinear || (c?.tipo === 'numero' ? 'right' : 'left'); }
        if (f40 && data.section === 'body') {
          const ultima = seccion.resaltarTotal && data.column.index === seccion.columnas.length - 1;
          if (totalDesde !== undefined && data.row.index >= totalDesde) {
            data.cell.styles.fillColor = rgb(C.lila);
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.textColor = rgb(C.primarioOscuro);
          } else if (ultima) {
            data.cell.styles.fillColor = rgb(C.fondoFila);
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.textColor = rgb(C.primarioOscuro);
          }
        }
      }
    });
    y = pdf.lastAutoTable.finalY + (indice < doc.secciones.length - 1 ? 9 : 5);
  });

  // Definiciones, fuente y elaboración al pie de la última tabla, como en el modelo.
  const lineasPie = (doc.notas?.length ? doc.notas.length + 2 : 0) + 2;
  if (y > H - 14 - lineasPie * 3.6) { pdf.addPage(); y = TOP + 3; }
  pdf.setTextColor(...rgb(C.negro)).setFontSize(7.2);
  if (doc.notas?.length) {
    pdf.setFont('helvetica', 'bold');
    pdf.text('Definiciones:', M, y + 2);
    const wDef = pdf.getTextWidth('Definiciones:');
    pdf.setDrawColor(...rgb(C.negro)).setLineWidth(0.2).line(M, y + 2.6, M + wDef, y + 2.6);
    pdf.setFont('helvetica', 'normal');
    doc.notas.forEach((nota, i) => pdf.text(nota, M, y + 6 + i * 3.6));
    y += 6 + doc.notas.length * 3.6 + 2;
  }
  pdf.setFont('helvetica', 'normal');
  pdf.text(PLANTILLA.fuente, M, y + 2);
  pdf.text(PLANTILLA.elaboracion, M, y + 5.6);

  const total = pdf.internal.getNumberOfPages();
  for (let p = 1; p <= total; p += 1) {
    pdf.setPage(p);
    encabezado(p);
    pie(p, total);
  }
  pdf.save(nombreArchivo(doc.archivo, 'pdf'));
}

// Punto de entrada común. Si se pasa el botón, se deshabilita mientras se genera el archivo.
async function exportarDocumento(formato, documento, boton = null) {
  const doc = { ...documento };
  doc.secciones = (doc.secciones || []).filter(Boolean);
  if (!doc.secciones.length || doc.secciones.every(s => !s.filas?.length)) {
    toast('No hay datos para exportar.', 'info');
    return;
  }
  const etiqueta = boton?.innerHTML;
  if (boton) { boton.disabled = true; boton.textContent = 'Generando…'; }
  try {
    if (formato === 'pdf') await generarPdf(doc);
    else await generarExcel(doc);
    toast(formato === 'pdf' ? 'PDF generado.' : 'Excel generado.', 'success');
  } catch (error) {
    console.error('Error al exportar:', error);
    showAlert(error.message || 'No se pudo generar el archivo.', 'error');
  } finally {
    if (boton) { boton.disabled = false; boton.innerHTML = etiqueta; }
  }
}

// Botones «Excel» y «PDF» con el mismo aspecto en todas las vistas.
const ICONO_EXCEL = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5M9 12l4 5M13 12l-4 5"/></svg>';
const ICONO_PDF = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5M9 13h1.5a1.5 1.5 0 010 3H9v-3zm0 3v2"/></svg>';
// Con «fecha» (AAAA-MM-DD) los botones exportan solo las atenciones de ese día.
function botonesExportarHtml(prefijo, fecha = '') {
  const extra = fecha ? ` data-fecha="${fecha}"` : '';
  return `<div class="export-buttons" role="group" aria-label="Exportar">
    <button type="button" class="btn btn-secondary btn-sm btn-export-excel" data-export="${prefijo}" data-formato="excel"${extra}>${ICONO_EXCEL} Excel</button>
    <button type="button" class="btn btn-secondary btn-sm btn-export-pdf" data-export="${prefijo}" data-formato="pdf"${extra}>${ICONO_PDF} PDF</button>
  </div>`;
}

// Botones pequeños (solo íconos) para el reporte de una atención (cita).
function botonesCitaHtml(cita) {
  const id = esc(cita);
  return `<div class="export-buttons export-compact" role="group" aria-label="Reporte de la cita ${id}">
    <button type="button" class="btn btn-secondary btn-sm btn-export-excel" data-export="cita" data-cita="${id}" data-formato="excel" title="Reporte de esta atención (cita ${id}) en Excel">${ICONO_EXCEL} Excel</button>
    <button type="button" class="btn btn-secondary btn-sm btn-export-pdf" data-export="cita" data-cita="${id}" data-formato="pdf" title="Reporte de esta atención (cita ${id}) en PDF">${ICONO_PDF} PDF</button>
  </div>`;
}
