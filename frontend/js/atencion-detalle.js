// ═══════════════════════════════════════
//  DETALLE DE UNA ATENCIÓN (vista completa)
// ═══════════════════════════════════════
// Abre a pantalla completa toda la cita: paciente, profesional, servicio, todos sus diagnósticos y procedimientos,
// mediciones y datos del registro. Primero dibuja con la fila recibida y luego completa con /busqueda/citas/:id.
// Usa funciones globales de app.js: apiFetch, esc, abrirModal, cerrarModal, factGrid, formatearValor, botonesExportarHtml,
// showView, buscarPacienteSimple, SEXO, TIPOS_DX.

const AD_TURNO = { M: 'Mañana', T: 'Tarde', N: 'Noche' };
const AD_TIPO_EDAD = { A: 'años', M: 'meses', D: 'días' };
const AD_CONDICION = { N: 'Nuevo', C: 'Continuador', R: 'Reingresante' };
const AD_DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const AD_MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
let adSeq = 0;

const adTxt = v => (v === null || v === undefined ? '' : String(v).trim());
const adIso = v => (/^\d{4}-\d{2}-\d{2}/.test(adTxt(v)) ? adTxt(v).slice(0, 10) : '');
const adFecha = v => { const f = adIso(v); return f ? f.split('-').reverse().join('/') : ''; };
const adIcono = d => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const AD_ICONOS = {
  paciente: adIcono('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>'),
  profesional: adIcono('<circle cx="12" cy="7" r="4"/><path d="M4 21a8 8 0 0116 0"/><path d="M12 15v4M10 17h4"/>'),
  lugar: adIcono('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M12 8v6M9 11h6M9 21v-3h6v3"/>'),
  dx: adIcono('<path d="M6 3v6a4 4 0 008 0V3"/><path d="M10 13v2a5 5 0 0010 0v-2"/><circle cx="20" cy="11" r="2"/>'),
  medidas: adIcono('<path d="M3 12h4l3-8 4 16 3-8h4"/>'),
  registro: adIcono('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"/>')
};

function adEdadRegistro(r) {
  const edad = adTxt(r.Edad_Reg);
  if (!edad) return '';
  return `${edad} ${AD_TIPO_EDAD[adTxt(r.Tipo_Edad).toUpperCase()] || adTxt(r.Tipo_Edad)}`.trim();
}

function adDato(etiqueta, valor, { mono = false } = {}) {
  const v = adTxt(valor);
  return `<div class="vat-dato"><dt>${etiqueta}</dt><dd${mono ? ' class="mono"' : ''}>${v ? esc(v) : '<span class="vat-nd">Sin dato</span>'}</dd></div>`;
}

// Nombre del registrador (MaestroRegistrador) con su ID debajo; si no está en el maestro, solo el ID.
function adRegistrador(r) {
  const nombre = adTxt(r.Registrador);
  const id = adTxt(r.Id_Registrador);
  if (!nombre) return adDato('Registrado por (ID)', id, { mono: true });
  return `<div class="vat-dato"><dt>Registrado por</dt><dd>${esc(nombre)}${id ? `<span class="vat-dato-id mono">ID ${esc(id)}</span>` : ''}</dd></div>`;
}

function adTarjeta(clase, icono, titulo, cuerpo, pie = '') {
  return `<section class="vat-card vat-${clase}">
    <header><span class="vat-card-icon">${icono}</span><h4>${titulo}</h4></header>
    <dl class="vat-datos">${cuerpo}</dl>${pie}
  </section>`;
}

function htmlDetalleAtencion(filas, cargando) {
  const r = filas[0];
  const cita = adTxt(r.Id_Cita ?? r.Cita);
  const f = adIso(r.Fecha_Atencion);
  let fechaLarga = 'Sin fecha';
  if (f) {
    const [y, m, d] = f.split('-').map(Number);
    fechaLarga = `${AD_DIAS[new Date(y, m - 1, d).getDay()]} ${d} de ${AD_MESES[m - 1]} de ${y}`;
  }
  const sexo = SEXO[adTxt(r.SexoPaciente).toUpperCase()] || '';
  const servicio = adTxt(r.Servicio) || (r.Id_Ups ? `UPS ${r.Id_Ups}` : '');
  const turno = AD_TURNO[adTxt(r.Id_Turno).toUpperCase()] || adTxt(r.Id_Turno);
  const documento = adTxt(r.DocumentoPaciente);

  // Diagnósticos y procedimientos de toda la cita
  const items = filas.map((x, i) => {
    const codigo = adTxt(x.Codigo_Item);
    const tipo = adTxt(x.Tipo_Diagnostico).toUpperCase();
    const esProc = /^\d/.test(codigo);
    const etiqueta = esProc ? ['Procedimiento', 'proc'] : TIPOS_DX[tipo] ? [TIPOS_DX[tipo], `dx-${tipo.toLowerCase()}`] : ['—', 'nd'];
    return `<tr>
      <td class="vat-n">${i + 1}</td>
      <td><span class="vat-codigo">${esc(codigo || '—')}</span></td>
      <td class="vat-desc">${esc(adTxt(x.DescItem) || 'Sin descripción')}</td>
      <td><span class="vat-tag vat-tag-${etiqueta[1]}">${etiqueta[0]}</span></td>
      <td class="vat-center">${adTxt(x.Valor_Lab) ? `<span class="vat-lab">${esc(x.Valor_Lab)}</span>` : '<span class="vat-nd">—</span>'}</td>
    </tr>`;
  }).join('');

  // Mediciones: se toman de cualquier fila de la cita que las tenga
  const valor = campo => adTxt(filas.map(x => x[campo]).find(v => adTxt(v)));
  const peso = Number(valor('Peso'));
  const talla = Number(valor('Talla'));
  const imc = peso > 0 && talla > 0 ? (peso / ((talla / 100) ** 2)).toFixed(1) : '';
  const medidas = [
    ['Peso', valor('Peso'), 'kg'], ['Talla', valor('Talla'), 'cm'], ['IMC', imc, 'kg/m²'], ['Hemoglobina', valor('Hemoglobina'), 'g/dL'],
    ['Perímetro abdominal', valor('Perimetro_Abdominal'), 'cm'], ['Perímetro cefálico', valor('Perimetro_Cefalico'), 'cm'],
    ['Peso pregestacional', valor('peso_pregestacional') || valor('Peso_Pregestacional'), 'kg'],
    ['Última regla', adFecha(valor('Fecha_Ultima_Regla')), ''], ['Solicitud de Hb', adFecha(valor('Fecha_Solicitud_Hb')), ''], ['Resultado de Hb', adFecha(valor('Fecha_Resultado_Hb')), '']
  ].filter(([, v]) => v);

  const exportar = cita ? botonesExportarHtml('cita').replace(/data-export="cita"/g, `data-export="cita" data-cita="${esc(cita)}"`) : '';
  return `
  <div class="vat">
    <div class="vat-hero">
      <div class="vat-hero-main">
        <span class="vat-chip">Cita ${esc(cita || '—')}</span>
        <h2>${esc(servicio || 'Atención')}</h2>
        <p>${esc(fechaLarga)}${turno ? ` · Turno ${esc(turno.toLowerCase())}` : ''}${adTxt(r.NombreEstablecimiento) ? ` · ${esc(r.NombreEstablecimiento)}` : ''}</p>
      </div>
      <div class="vat-hero-side">
        <div class="vat-hero-stat"><strong>${filas.length}</strong><span>${filas.length === 1 ? 'código registrado' : 'códigos registrados'}</span></div>
        <div class="vat-hero-export"><span>Reporte de esta atención</span>${exportar}</div>
      </div>
    </div>
    ${cargando ? '<div class="vat-cargando"><span class="ps-spinner" aria-hidden="true"></span>Completando los datos de la atención…</div>' : ''}

    <div class="vat-grid-3">
      ${adTarjeta('paciente', AD_ICONOS.paciente, 'Paciente',
        `${adDato('Nombre', r.Paciente)}${adDato('DNI', documento, { mono: true })}${adDato('Historia clínica', r.HistoriaClinica, { mono: true })}
         ${adDato('Edad en la atención', adEdadRegistro(r))}${adDato('Sexo', sexo)}${adDato('Condición', AD_CONDICION[adTxt(r.Id_Condicion_Servicio).toUpperCase()] ? `${AD_CONDICION[adTxt(r.Id_Condicion_Servicio).toUpperCase()]} en el servicio` : '')}`,
        documento ? `<button type="button" class="vat-link" onclick="cerrarModal(); showView('pacientes'); buscarPacienteSimple('${esc(documento)}')">Ver su historial de atenciones →</button>` : '')}
      ${adTarjeta('profesional', AD_ICONOS.profesional, 'Profesional',
        `${adDato('Nombre', r.Personal)}${adDato('Profesión', r.ProfesionPersonal)}${adDato('DNI', r.DocumentoPersonal, { mono: true })}${adDato('Colegiatura', r.ColegiaturaPersonal, { mono: true })}`)}
      ${adTarjeta('lugar', AD_ICONOS.lugar, 'Servicio y lugar',
        `${adDato('Servicio (UPS)', servicio)}${adDato('Establecimiento', r.NombreEstablecimiento || r.Id_Establecimiento)}${adDato('Turno', turno)}
         ${adDato('Financiador', r.Financiador || r.Id_Financiador)}${adDato('Condición en el establecimiento', AD_CONDICION[adTxt(r.Id_Condicion_Establecimiento).toUpperCase()] || r.Id_Condicion_Establecimiento)}`)}
    </div>

    <section class="vat-card vat-dx">
      <header><span class="vat-card-icon">${AD_ICONOS.dx}</span><h4>Diagnósticos y procedimientos</h4><span class="vat-count">${filas.length}</span></header>
      <div class="vat-table-wrap"><table class="vat-table">
        <thead><tr><th>#</th><th>Código</th><th>Descripción</th><th>Tipo</th><th class="vat-center">LAB</th></tr></thead>
        <tbody>${items}</tbody>
      </table></div>
    </section>

    <div class="vat-grid-2">
      <section class="vat-card vat-medidas">
        <header><span class="vat-card-icon">${AD_ICONOS.medidas}</span><h4>Mediciones</h4></header>
        ${medidas.length
          ? `<div class="vat-medidas-grid">${medidas.map(([t, v, u]) => `<div class="vat-medida"><span>${t}</span><strong>${esc(v)}${u ? ` <small>${u}</small>` : ''}</strong></div>`).join('')}</div>`
          : '<p class="vat-vacio">No se registraron mediciones en esta atención.</p>'}
      </section>
      ${adTarjeta('registro', AD_ICONOS.registro, 'Registro en el HIS',
        `${adDato('Lote · página · registro', [r.Lote, r.Num_Pag, r.Num_Reg].map(adTxt).filter(Boolean).join(' · '), { mono: true })}
         ${adRegistrador(r)}${adDato('Fecha de registro', formatearValor(r.Fecha_Registro))}
         ${adDato('Última modificación', r.Fecha_Modificacion ? formatearValor(r.Fecha_Modificacion) : '')}${adDato('Aplicación de origen', r.Id_AplicacionOrigen)}${adDato('RENIPRESS', r.renipress, { mono: true })}`)}
    </div>

    <details class="vat-tecnico">
      <summary>Ver todos los datos técnicos del registro</summary>
      ${factGrid(r, Object.keys(r))}
    </details>
  </div>`;
}

async function verAtencion(row) {
  if (!row) return;
  const seq = ++adSeq;
  const cita = adTxt(row.Id_Cita ?? row.Cita);
  const titulo = cita ? `Atención · Cita ${cita}` : 'Atención';
  abrirModal(titulo, htmlDetalleAtencion([row], Boolean(cita)), { full: true });
  if (!cita) return;
  try {
    const filas = await apiFetch(`/busqueda/citas/${encodeURIComponent(cita)}`);
    if (seq !== adSeq || !document.getElementById('modal').classList.contains('show')) return;
    if (filas.length) document.getElementById('modalBody').innerHTML = htmlDetalleAtencion(filas, false);
  } catch (_) {
    if (seq === adSeq) document.querySelector('#modalBody .vat-cargando')?.remove();
  }
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && document.getElementById('modal')?.classList.contains('show')) cerrarModal();
});
