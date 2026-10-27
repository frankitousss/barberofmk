// ============================================================
// FMK BARBERSHOP — Panel del barbero
// ============================================================

let usuarioActual = null;
let turnosCache = [];

// ---------- Verificación de sesión y rol ----------
(async function iniciar() {
  const { data } = await supabaseClient.auth.getSession();
  if (!data.session) {
    window.location.href = 'index.html';
    return;
  }

  const { data: perfil } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', data.session.user.id)
    .single();

  if (!perfil || perfil.role !== 'barbero') {
    window.location.href = 'index.html';
    return;
  }

  usuarioActual = perfil;
  document.getElementById('nombre-usuario').textContent = perfil.full_name;

  cambiarSeccion('turnos');
  cargarTurnos();
  cargarHorarios();
  cargarProductos();
  cargarCaja();
})();

document.getElementById('btn-salir').addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
  window.location.href = 'index.html';
});

// ---------- Navegación entre secciones ----------
const secciones = ['turnos', 'horarios', 'buscar', 'tienda', 'caja'];

function cambiarSeccion(nombre) {
  secciones.forEach((s) => {
    document.getElementById(`seccion-${s}`).classList.toggle('oculto', s !== nombre);
    document.getElementById(`nav-${s}`).classList.toggle('activo', s === nombre);
  });
}

secciones.forEach((s) => {
  document.getElementById(`nav-${s}`).addEventListener('click', () => cambiarSeccion(s));
});

// ============================================================
// PAGINACIÓN (helper genérico, se usa en horarios y caja)
// ============================================================

function crearPaginador({ contenedorId, total, porPagina, paginaActual, onCambiar }) {
  const cont = document.getElementById(contenedorId);
  cont.innerHTML = '';
  const totalPaginas = Math.ceil(total / porPagina);
  if (totalPaginas <= 1) return;

  for (let i = 1; i <= totalPaginas; i++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'paginacion__btn' + (i === paginaActual ? ' paginacion__btn--activo' : '');
    btn.textContent = i;
    btn.addEventListener('click', () => onCambiar(i));
    cont.appendChild(btn);
  }
}

// ============================================================
// TURNOS RESERVADOS POR CLIENTES
// ============================================================

async function cargarTurnos() {
  const cont = document.getElementById('lista-turnos');
  cont.innerHTML = 'Cargando...';

  const { data: turnos, error } = await supabaseClient
    .from('turnos')
    .select('id, fecha, hora, estado, cliente_id, profiles:cliente_id(full_name, dni, username)')
    .eq('barbero_id', usuarioActual.id)
    .order('fecha', { ascending: true })
    .order('hora', { ascending: true });

  if (error) {
    cont.innerHTML = `<div class="mensaje mensaje--error visible">${error.message}</div>`;
    return;
  }

  turnosCache = turnos;

  if (!turnos.length) {
    cont.innerHTML = '<div class="vacio">Todavía no tenés turnos reservados.</div>';
    return;
  }

  cont.innerHTML = '';
  turnos.forEach((t) => {
    const fila = document.createElement('div');
    fila.className = 'item-lista';
    fila.innerHTML = `
      <div class="item-lista__info">
        <strong>${t.profiles?.full_name ?? 'Cliente'}</strong>
        <span>${formatearFecha(t.fecha)} · ${t.hora.slice(0, 5)} hs</span>
      </div>
      <div style="display:flex; align-items:center; gap:0.6rem;">
        <span class="pill pill--${t.estado}">${etiquetaEstado(t.estado)}</span>
        ${t.estado === 'reservado' ? `
          <button class="btn btn--chico btn--violeta" data-completar="${t.id}">Completar y sellar</button>
          <button class="btn btn--chico btn--peligro" data-cancelar="${t.id}">Cancelar</button>
        ` : ''}
      </div>
    `;
    cont.appendChild(fila);
  });

  cont.querySelectorAll('[data-completar]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const turno = turnosCache.find((t) => t.id === btn.dataset.completar);
      if (turno) completarTurno(turno);
    });
  });
  cont.querySelectorAll('[data-cancelar]').forEach((btn) => {
    btn.addEventListener('click', () => cancelarTurno(btn.dataset.cancelar));
  });
}

async function completarTurno(turno) {
  // Antes de marcar el turno como completado, pedimos qué se cobró.
  const cobro = await abrirModalCobro(turno);
  if (!cobro) return; // el barbero cerró el modal sin confirmar, no se toca el turno

  const { error: errorTurno } = await supabaseClient
    .from('turnos')
    .update({ estado: 'completado' })
    .eq('id', turno.id);

  if (errorTurno) {
    alert('No se pudo completar el turno: ' + errorTurno.message);
    return;
  }

  const montoTotal = cobro.monto + (cobro.compróTienda ? cobro.tiendaMonto : 0);
  let descripcion = `Corte a ${turno.profiles?.full_name ?? 'cliente'}: ${cobro.servicios.join(', ')}`;
  if (cobro.compróTienda && cobro.tiendaDetalle) {
    descripcion += ` + Tienda: ${cobro.tiendaDetalle}`;
  }

  const { error: errorCaja } = await supabaseClient.from('caja_movimientos').insert({
    barbero_id: usuarioActual.id,
    tipo: 'ingreso',
    monto: montoTotal,
    descripcion,
    turno_id: turno.id,
    cliente_id: turno.cliente_id,
  });

  if (errorCaja) {
    alert('El turno se completó pero no se pudo cargar en la caja: ' + errorCaja.message);
  }

  const { data, error } = await supabaseClient.rpc('agregar_sello', { p_cliente_id: turno.cliente_id });

  if (error) {
    alert('El turno se completó pero falló el sello: ' + error.message);
  } else if (data.corte_gratis) {
    alert('¡Sello cargado! El cliente completó la tarjeta: tiene un corte gratis disponible 🎉');
  } else if (data.recompensa_minima) {
    alert('¡Sello cargado! El cliente llegó a un múltiplo de 3 cortes: le corresponde una recompensa mínima.');
  } else {
    alert('Sello cargado correctamente.');
  }

  cargarTurnos();
  cargarCaja();
}

async function cancelarTurno(turnoId) {
  if (!confirm('¿Cancelar este turno?')) return;

  const { error } = await supabaseClient.from('turnos').update({ estado: 'cancelado' }).eq('id', turnoId);

  if (error) {
    alert('No se pudo cancelar el turno: ' + error.message);
    return;
  }

  // Al cancelar, el horario vuelve a quedar disponible (lo hace el
  // trigger de la base), así que también refrescamos esa lista.
  cargarTurnos();
  cargarHorarios();
}

// ============================================================
// MODAL DE COBRO — se abre al completar un turno
// ============================================================

function abrirModalCobro(turno) {
  return new Promise((resolve) => {
    const fondo = document.createElement('div');
    fondo.className = 'modal-fondo';
    fondo.innerHTML = `
      <div class="modal-caja modal-cobro">
        <button type="button" class="modal-cerrar" aria-label="Cerrar">&times;</button>
        <h2 style="margin-top:0;">Cobrar a ${turno.profiles?.full_name ?? 'cliente'}</h2>
        <p class="modal-aviso">Cargá lo que le cobraste para sumarlo a la caja.</p>
        <form id="form-cobro">
          <div id="mensaje-cobro" class="mensaje"></div>
          <div class="campo">
            <label>Servicios realizados</label>
            <div class="servicios-grilla">
              <label class="campo-check"><input type="checkbox" name="servicio" value="Corte"> Corte</label>
              <label class="campo-check"><input type="checkbox" name="servicio" value="Barba"> Barba</label>
              <label class="campo-check"><input type="checkbox" name="servicio" value="Cejas"> Cejas</label>
              <label class="campo-check"><input type="checkbox" name="servicio" value="Color"> Color</label>
              <label class="campo-check"><input type="checkbox" name="servicio" value="Otro"> Otro</label>
            </div>
          </div>
          <div class="campo">
            <label for="cobro-monto">Monto cobrado por el servicio</label>
            <input type="number" step="0.01" min="0" id="cobro-monto" required>
          </div>
          <label class="campo-check" for="cobro-tienda-check">
            <input type="checkbox" id="cobro-tienda-check">
            También compró algo de la tienda
          </label>
          <div id="cobro-tienda-campos" class="oculto">
            <div class="fila-campos">
              <div class="campo">
                <label for="cobro-tienda-detalle">¿Qué compró?</label>
                <input type="text" id="cobro-tienda-detalle" placeholder="Ej: cera, shampoo">
              </div>
              <div class="campo">
                <label for="cobro-tienda-monto">Monto de esa compra</label>
                <input type="number" step="0.01" min="0" id="cobro-tienda-monto">
              </div>
            </div>
          </div>
          <button type="submit" class="btn btn--violeta" style="width:100%;">Confirmar y sellar</button>
        </form>
      </div>
    `;
    document.body.appendChild(fondo);

    const cerrar = (resultado) => {
      fondo.remove();
      resolve(resultado);
    };

    fondo.querySelector('.modal-cerrar').addEventListener('click', () => cerrar(null));
    fondo.addEventListener('click', (e) => {
      if (e.target === fondo) cerrar(null);
    });

    const checkTienda = fondo.querySelector('#cobro-tienda-check');
    const camposTienda = fondo.querySelector('#cobro-tienda-campos');
    checkTienda.addEventListener('change', () => {
      camposTienda.classList.toggle('oculto', !checkTienda.checked);
    });

    fondo.querySelector('#form-cobro').addEventListener('submit', (e) => {
      e.preventDefault();
      const mensaje = fondo.querySelector('#mensaje-cobro');
      const servicios = Array.from(fondo.querySelectorAll('input[name="servicio"]:checked')).map((c) => c.value);

      if (!servicios.length) {
        mensaje.textContent = 'Marcá al menos un servicio.';
        mensaje.className = 'mensaje visible mensaje--error';
        return;
      }

      const monto = parseFloat(fondo.querySelector('#cobro-monto').value) || 0;
      const compróTienda = checkTienda.checked;
      const tiendaDetalle = fondo.querySelector('#cobro-tienda-detalle').value.trim();
      const tiendaMonto = parseFloat(fondo.querySelector('#cobro-tienda-monto').value) || 0;

      cerrar({ servicios, monto, compróTienda, tiendaDetalle, tiendaMonto });
    });
  });
}

// ============================================================
// HORARIOS DEL BARBERO
// ============================================================

let horariosPagina = 1;
const HORARIOS_POR_PAGINA = 4;

const formHorario = document.getElementById('form-horario');

formHorario.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fecha = document.getElementById('horario-fecha').value;
  const hora = document.getElementById('horario-hora').value;
  const mensaje = document.getElementById('mensaje-horario');

  const { error } = await supabaseClient.from('horarios').insert({
    barbero_id: usuarioActual.id,
    fecha,
    hora,
  });

  if (error) {
    mensaje.textContent = 'No se pudo cargar: ' + error.message;
    mensaje.className = 'mensaje visible mensaje--error';
    return;
  }

  mensaje.textContent = 'Horario cargado.';
  mensaje.className = 'mensaje visible mensaje--ok';
  formHorario.reset();
  horariosPagina = 1;
  cargarHorarios();
});

async function cargarHorarios() {
  const cont = document.getElementById('lista-horarios');
  cont.innerHTML = 'Cargando...';

  const { fecha: hoy, hora: ahora } = fechaHoraActualLocal();

  // Solo mostramos los horarios TODAVÍA disponibles y que todavía no
  // pasaron: los reservados ya se ven en "Mis turnos", y los que ya
  // pasaron desaparecen solos de la lista (siguen en la base, pero
  // no se muestran ni se pueden volver a reservar).
  const { data: horarios, error } = await supabaseClient
    .from('horarios')
    .select('*')
    .eq('barbero_id', usuarioActual.id)
    .eq('disponible', true)
    .or(`fecha.gt.${hoy},and(fecha.eq.${hoy},hora.gte.${ahora})`)
    .order('fecha', { ascending: true })
    .order('hora', { ascending: true });

  if (error) {
    cont.innerHTML = `<div class="mensaje mensaje--error visible">${error.message}</div>`;
    return;
  }

  if (!horarios.length) {
    cont.innerHTML = '<div class="vacio">Todavía no tenés horarios disponibles cargados.</div>';
    document.getElementById('paginacion-horarios').innerHTML = '';
    return;
  }

  const totalPaginas = Math.max(1, Math.ceil(horarios.length / HORARIOS_POR_PAGINA));
  if (horariosPagina > totalPaginas) horariosPagina = totalPaginas;

  const inicio = (horariosPagina - 1) * HORARIOS_POR_PAGINA;
  const pagina = horarios.slice(inicio, inicio + HORARIOS_POR_PAGINA);

  cont.innerHTML = '';
  pagina.forEach((h) => {
    const fila = document.createElement('div');
    fila.className = 'item-lista';
    fila.innerHTML = `
      <div class="item-lista__info">
        <strong>${formatearFecha(h.fecha)}</strong>
        <span>${h.hora.slice(0, 5)} hs</span>
      </div>
      <div style="display:flex; align-items:center; gap:0.6rem;">
        <span class="pill pill--disponible">Disponible</span>
        <button class="btn btn--chico btn--peligro" data-borrar-horario="${h.id}">Borrar</button>
      </div>
    `;
    cont.appendChild(fila);
  });

  cont.querySelectorAll('[data-borrar-horario]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Borrar este horario?')) return;

      btn.disabled = true;
      const { error: errorBorrar } = await supabaseClient
        .from('horarios')
        .delete()
        .eq('id', btn.dataset.borrarHorario);

      if (errorBorrar) {
        console.error('Error al borrar horario:', errorBorrar);
        alert('No se pudo borrar el horario: ' + errorBorrar.message + '\n\n(código: ' + (errorBorrar.code ?? 's/d') + ')');
        btn.disabled = false;
        return;
      }

      cargarHorarios();
    });
  });

  crearPaginador({
    contenedorId: 'paginacion-horarios',
    total: horarios.length,
    porPagina: HORARIOS_POR_PAGINA,
    paginaActual: horariosPagina,
    onCambiar: (p) => {
      horariosPagina = p;
      cargarHorarios();
    },
  });
}

// ============================================================
// CARGA MASIVA DE HORARIOS
// ============================================================
// El barbero elige un rango de fechas, los días de la semana, la
// apertura, el cierre y el intervalo, y se generan todos los
// horarios de una sola vez. No se repiten los que ya existen
// (disponibles o ya reservados) y no se generan horarios pasados.

const MASIVO_MAX_HORARIOS = 3000;
const MASIVO_LOTE = 500;

const formMasivo = document.getElementById('form-masivo');
const masivoResumen = document.getElementById('masivo-resumen');

function aMinutos(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function deMinutos(min) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

function aFechaISO(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Devuelve { slots, error }. Cada slot es { fecha: 'YYYY-MM-DD', hora: 'HH:MM' }.
// Nota: el último horario es el que termina justo al cierre. Con
// 10:00 a 20:00 cada 30 min se generan 10:00, 10:30 ... 19:30.
function generarSlots() {
  const desde = document.getElementById('masivo-desde').value;
  const hasta = document.getElementById('masivo-hasta').value;
  const apertura = document.getElementById('masivo-apertura').value;
  const cierre = document.getElementById('masivo-cierre').value;
  const intervalo = parseInt(document.getElementById('masivo-intervalo').value, 10);
  const dias = Array.from(document.querySelectorAll('input[name="dia-semana"]:checked')).map((c) => Number(c.value));

  if (!desde || !hasta || !apertura || !cierre) return { slots: [], error: null };
  if (hasta < desde) return { slots: [], error: 'La fecha final no puede ser anterior a la inicial.' };
  if (!dias.length) return { slots: [], error: 'Elegí al menos un día de la semana.' };
  if (aMinutos(cierre) <= aMinutos(apertura)) return { slots: [], error: 'El cierre tiene que ser posterior a la apertura.' };

  const minApertura = aMinutos(apertura);
  const minCierre = aMinutos(cierre);
  const horas = [];
  for (let t = minApertura; t + intervalo <= minCierre; t += intervalo) horas.push(deMinutos(t));

  if (!horas.length) return { slots: [], error: 'El intervalo es más largo que el horario de atención.' };

  const { fecha: hoy, hora: ahora } = fechaHoraActualLocal();
  const ahoraHHMM = ahora.slice(0, 5);

  const [a1, m1, d1] = desde.split('-').map(Number);
  const [a2, m2, d2] = hasta.split('-').map(Number);
  const cursor = new Date(a1, m1 - 1, d1);
  const fin = new Date(a2, m2 - 1, d2);

  const slots = [];
  while (cursor <= fin) {
    if (dias.includes(cursor.getDay())) {
      const fecha = aFechaISO(cursor);
      if (fecha >= hoy) {
        horas.forEach((hora) => {
          // Hoy no se generan horarios que ya pasaron
          if (fecha === hoy && hora < ahoraHHMM) return;
          slots.push({ fecha, hora });
        });
      }
    }
    cursor.setDate(cursor.getDate() + 1);
    if (slots.length > MASIVO_MAX_HORARIOS) {
      return { slots: [], error: `Son demasiados horarios (más de ${MASIVO_MAX_HORARIOS}). Acortá el rango de fechas.` };
    }
  }

  return { slots, error: null };
}

function actualizarResumenMasivo() {
  const { slots, error } = generarSlots();
  if (error) {
    masivoResumen.textContent = error;
  } else if (!slots.length) {
    masivoResumen.textContent = '';
  } else {
    masivoResumen.textContent = `Se van a generar hasta ${slots.length} horarios (los que ya existan se saltean).`;
  }
}

formMasivo.addEventListener('input', actualizarResumenMasivo);
formMasivo.addEventListener('change', actualizarResumenMasivo);

// Trae TODOS los horarios del barbero en el rango (disponibles y
// reservados) para no duplicarlos. Se pagina porque Supabase
// devuelve como máximo 1000 filas por consulta.
async function traerHorariosExistentes(desde, hasta) {
  const existentes = new Set();
  const TAM = 1000;
  let desdeFila = 0;

  while (true) {
    const { data, error } = await supabaseClient
      .from('horarios')
      .select('fecha, hora')
      .eq('barbero_id', usuarioActual.id)
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .order('fecha', { ascending: true })
      .order('hora', { ascending: true })
      .range(desdeFila, desdeFila + TAM - 1);

    if (error) throw error;
    data.forEach((h) => existentes.add(`${h.fecha}|${h.hora.slice(0, 5)}`));
    if (data.length < TAM) break;
    desdeFila += TAM;
  }

  return existentes;
}

formMasivo.addEventListener('submit', async (e) => {
  e.preventDefault();
  const mensaje = document.getElementById('mensaje-masivo');
  const boton = document.getElementById('btn-masivo');

  const mostrar = (texto, tipo) => {
    mensaje.textContent = texto;
    mensaje.className = `mensaje visible mensaje--${tipo}`;
  };

  const { slots, error: errorValidacion } = generarSlots();
  if (errorValidacion) {
    mostrar(errorValidacion, 'error');
    return;
  }
  if (!slots.length) {
    mostrar('Con esa configuración no hay horarios para generar (revisá las fechas y los días elegidos).', 'error');
    return;
  }

  boton.disabled = true;
  boton.textContent = 'Generando...';

  try {
    const desde = slots[0].fecha;
    const hasta = slots[slots.length - 1].fecha;
    const existentes = await traerHorariosExistentes(desde, hasta);

    const nuevos = slots.filter((s) => !existentes.has(`${s.fecha}|${s.hora}`));
    const repetidos = slots.length - nuevos.length;

    if (!nuevos.length) {
      mostrar(`No se cargó nada: los ${slots.length} horarios ya existían.`, 'error');
      return;
    }

    const filas = nuevos.map((s) => ({
      barbero_id: usuarioActual.id,
      fecha: s.fecha,
      hora: s.hora,
    }));

    for (let i = 0; i < filas.length; i += MASIVO_LOTE) {
      const lote = filas.slice(i, i + MASIVO_LOTE);
      // ignoreDuplicates es una red de seguridad extra: si un horario
      // se coló entre la consulta y el insert, se saltea sin fallar.
      const { error } = await supabaseClient
        .from('horarios')
        .upsert(lote, { onConflict: 'barbero_id,fecha,hora', ignoreDuplicates: true });
      if (error) throw error;
    }

    let texto = `Se cargaron ${nuevos.length} horarios nuevos.`;
    if (repetidos) texto += ` Se saltearon ${repetidos} que ya existían.`;
    mostrar(texto, 'ok');

    horariosPagina = 1;
    cargarHorarios();
  } catch (err) {
    console.error('Error en carga masiva:', err);
    mostrar('No se pudieron generar los horarios: ' + (err.message ?? err), 'error');
  } finally {
    boton.disabled = false;
    boton.textContent = 'Generar horarios';
  }
});

// ============================================================
// BUSCAR CLIENTE POR DNI O USUARIO
// ============================================================

document.getElementById('form-buscar').addEventListener('submit', async (e) => {
  e.preventDefault();
  const valor = document.getElementById('buscar-input').value.trim();
  const cont = document.getElementById('resultado-buscar');
  cont.innerHTML = 'Buscando...';

  const { data: clientes, error } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('role', 'cliente')
    .or(`dni.eq.${valor},username.eq.${valor}`);

  if (error) {
    cont.innerHTML = `<div class="mensaje mensaje--error visible">${error.message}</div>`;
    return;
  }

  if (!clientes.length) {
    cont.innerHTML = '<div class="vacio">No se encontró ningún cliente con ese DNI o usuario.</div>';
    return;
  }

  const cliente = clientes[0];

  const { data: tarjeta } = await supabaseClient
    .from('tarjetas_fidelidad')
    .select('*')
    .eq('cliente_id', cliente.id)
    .single();

  const sellos = tarjeta?.sellos ?? 0;
  const cortesGratis = tarjeta?.cortes_gratis_disponibles ?? 0;

  cont.innerHTML = `
    <div class="ficha-cliente">
      <h3>${cliente.full_name}</h3>
      <p class="texto-tenue">DNI: ${cliente.dni ?? '—'} · Usuario: ${cliente.username ?? '—'}</p>
      <p>Sellos actuales: <strong>${sellos} / 10</strong> · Cortes gratis disponibles: <strong>${cortesGratis}</strong></p>
      <div style="display:flex; gap:0.6rem; flex-wrap:wrap; margin-top:0.8rem;">
        <button class="btn btn--violeta" id="btn-agregar-sello">Cobrar y agregar sello</button>
        <button class="btn btn--fantasma" id="btn-usar-gratis" ${cortesGratis < 1 ? 'disabled' : ''}>Usar corte gratis</button>
      </div>
    </div>
  `;

  // Este botón es para cortes que agendaste "por fuera" de la web
  // (de palabra, por WhatsApp, etc.): abre el mismo formulario de
  // cobro que usás al completar un turno reservado desde la página,
  // para que también quede cargado en la Caja.
  document.getElementById('btn-agregar-sello').addEventListener('click', async () => {
    const cobro = await abrirModalCobro({ profiles: { full_name: cliente.full_name } });
    if (!cobro) return;

    const montoTotal = cobro.monto + (cobro.compróTienda ? cobro.tiendaMonto : 0);
    let descripcion = `Corte a ${cliente.full_name} (turno cargado a mano): ${cobro.servicios.join(', ')}`;
    if (cobro.compróTienda && cobro.tiendaDetalle) {
      descripcion += ` + Tienda: ${cobro.tiendaDetalle}`;
    }

    const { error: errorCaja } = await supabaseClient.from('caja_movimientos').insert({
      barbero_id: usuarioActual.id,
      tipo: 'ingreso',
      monto: montoTotal,
      descripcion,
      cliente_id: cliente.id,
    });

    if (errorCaja) {
      alert('No se pudo cargar en la caja: ' + errorCaja.message);
    }

    const { data, error } = await supabaseClient.rpc('agregar_sello', { p_cliente_id: cliente.id });
    if (error) {
      alert('Se cargó en caja pero no se pudo agregar el sello: ' + error.message);
      cargarCaja();
      return;
    }
    if (data.corte_gratis) {
      alert('¡Tarjeta completa! El cliente ganó un corte gratis 🎉');
    } else if (data.recompensa_minima) {
      alert('Este corte le da al cliente una recompensa mínima (cada 3 cortes).');
    } else {
      alert('Sello agregado.');
    }
    cargarCaja();
    document.getElementById('form-buscar').requestSubmit();
  });

  const btnGratis = document.getElementById('btn-usar-gratis');
  if (btnGratis) {
    btnGratis.addEventListener('click', async () => {
      if (!confirm('¿Confirmás que este cliente usa un corte gratis ahora?')) return;
      const { error } = await supabaseClient.rpc('usar_corte_gratis', { p_cliente_id: cliente.id });
      if (error) {
        alert('No se pudo usar el corte gratis: ' + error.message);
        return;
      }
      alert('Corte gratis utilizado.');
      document.getElementById('form-buscar').requestSubmit();
    });
  }
});

// ============================================================
// TIENDA — el barbero carga productos
// ============================================================

const formProducto = document.getElementById('form-producto');

formProducto.addEventListener('submit', async (e) => {
  e.preventDefault();
  const nombre = document.getElementById('producto-nombre').value.trim();
  const descripcion = document.getElementById('producto-descripcion').value.trim();
  const precio = parseFloat(document.getElementById('producto-precio').value);
  const stock = parseInt(document.getElementById('producto-stock').value, 10) || 0;
  const imagen_url = document.getElementById('producto-imagen').value.trim();
  const mensaje = document.getElementById('mensaje-producto');

  const { error } = await supabaseClient.from('productos').insert({
    nombre,
    descripcion,
    precio,
    stock,
    imagen_url: imagen_url || null,
    creado_por: usuarioActual.id,
  });

  if (error) {
    mensaje.textContent = 'No se pudo guardar el producto: ' + error.message;
    mensaje.className = 'mensaje visible mensaje--error';
    return;
  }

  mensaje.textContent = 'Producto agregado a la tienda.';
  mensaje.className = 'mensaje visible mensaje--ok';
  formProducto.reset();
  cargarProductos();
});

async function cargarProductos() {
  const cont = document.getElementById('lista-productos-barbero');
  cont.innerHTML = 'Cargando...';

  const { data: productos, error } = await supabaseClient
    .from('productos')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    cont.innerHTML = `<div class="mensaje mensaje--error visible">${error.message}</div>`;
    return;
  }

  if (!productos.length) {
    cont.innerHTML = '<div class="vacio">Todavía no cargaste productos.</div>';
    return;
  }

  cont.innerHTML = '';
  productos.forEach((p) => {
    const fila = document.createElement('div');
    fila.className = 'item-lista';
    fila.innerHTML = `
      <div class="item-lista__info">
        <strong>${p.nombre}</strong>
        <span>$${Number(p.precio).toLocaleString('es-AR')} · Stock: ${p.stock} · ${p.activo ? 'Visible' : 'Oculto'}</span>
      </div>
      <div style="display:flex; gap:0.6rem;">
        <button class="btn btn--chico" data-toggle="${p.id}" data-activo="${p.activo}">${p.activo ? 'Ocultar' : 'Mostrar'}</button>
        <button class="btn btn--chico btn--peligro" data-borrar-producto="${p.id}">Borrar</button>
      </div>
    `;
    cont.appendChild(fila);
  });

  cont.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const activo = btn.dataset.activo === 'true';
      await supabaseClient.from('productos').update({ activo: !activo }).eq('id', btn.dataset.toggle);
      cargarProductos();
    });
  });

  cont.querySelectorAll('[data-borrar-producto]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Borrar este producto?')) return;
      await supabaseClient.from('productos').delete().eq('id', btn.dataset.borrarProducto);
      cargarProductos();
    });
  });
}

// ============================================================
// CAJA — ingresos (de los cortes/tienda) y gastos
// ============================================================

let cajaPagina = 1;
const CAJA_POR_PAGINA = 6;

const formGasto = document.getElementById('form-gasto');

formGasto.addEventListener('submit', async (e) => {
  e.preventDefault();
  const monto = parseFloat(document.getElementById('gasto-monto').value);
  const descripcion = document.getElementById('gasto-descripcion').value.trim();
  const mensaje = document.getElementById('mensaje-gasto');

  const { error } = await supabaseClient.from('caja_movimientos').insert({
    barbero_id: usuarioActual.id,
    tipo: 'egreso',
    monto,
    descripcion,
  });

  if (error) {
    mensaje.textContent = 'No se pudo guardar el gasto: ' + error.message;
    mensaje.className = 'mensaje visible mensaje--error';
    return;
  }

  mensaje.textContent = 'Gasto agregado.';
  mensaje.className = 'mensaje visible mensaje--ok';
  formGasto.reset();
  cajaPagina = 1;
  cargarCaja();
});

async function cargarCaja() {
  const resumenCont = document.getElementById('caja-resumen');
  const listaCont = document.getElementById('lista-caja');
  listaCont.innerHTML = 'Cargando...';

  const { data: movimientos, error } = await supabaseClient
    .from('caja_movimientos')
    .select('*')
    .eq('barbero_id', usuarioActual.id)
    .order('created_at', { ascending: false });

  if (error) {
    listaCont.innerHTML = `<div class="mensaje mensaje--error visible">${error.message}</div>`;
    return;
  }

  const ingresos = movimientos.filter((m) => m.tipo === 'ingreso').reduce((acc, m) => acc + Number(m.monto), 0);
  const egresos = movimientos.filter((m) => m.tipo === 'egreso').reduce((acc, m) => acc + Number(m.monto), 0);
  const balance = ingresos - egresos;

  resumenCont.innerHTML = `
    <div class="caja-tarjeta caja-tarjeta--positivo">
      <span>Ingresos</span>
      <strong>$${ingresos.toLocaleString('es-AR')}</strong>
    </div>
    <div class="caja-tarjeta caja-tarjeta--negativo">
      <span>Gastos</span>
      <strong>$${egresos.toLocaleString('es-AR')}</strong>
    </div>
    <div class="caja-tarjeta ${balance >= 0 ? 'caja-tarjeta--positivo' : 'caja-tarjeta--negativo'}">
      <span>Balance</span>
      <strong>$${balance.toLocaleString('es-AR')}</strong>
    </div>
  `;

  if (!movimientos.length) {
    listaCont.innerHTML = '<div class="vacio">Todavía no hay movimientos en la caja.</div>';
    document.getElementById('paginacion-caja').innerHTML = '';
    return;
  }

  const totalPaginas = Math.max(1, Math.ceil(movimientos.length / CAJA_POR_PAGINA));
  if (cajaPagina > totalPaginas) cajaPagina = totalPaginas;

  const inicio = (cajaPagina - 1) * CAJA_POR_PAGINA;
  const pagina = movimientos.slice(inicio, inicio + CAJA_POR_PAGINA);

  listaCont.innerHTML = '';
  pagina.forEach((m) => {
    const signo = m.tipo === 'ingreso' ? '+' : '-';
    const fila = document.createElement('div');
    fila.className = 'item-lista';
    fila.innerHTML = `
      <div class="item-lista__info">
        <strong>${m.descripcion}</strong>
        <span>${new Date(m.created_at).toLocaleDateString('es-AR')}</span>
      </div>
      <div style="display:flex; align-items:center; gap:0.6rem;">
        <span class="pill pill--${m.tipo}">${signo}$${Number(m.monto).toLocaleString('es-AR')}</span>
        <button class="btn btn--chico btn--peligro" data-borrar-mov="${m.id}">Borrar</button>
      </div>
    `;
    listaCont.appendChild(fila);
  });

  listaCont.querySelectorAll('[data-borrar-mov]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Borrar este movimiento de caja?')) return;

      const { error: errorBorrar } = await supabaseClient
        .from('caja_movimientos')
        .delete()
        .eq('id', btn.dataset.borrarMov);

      if (errorBorrar) {
        alert('No se pudo borrar el movimiento: ' + errorBorrar.message);
        return;
      }

      cargarCaja();
    });
  });

  crearPaginador({
    contenedorId: 'paginacion-caja',
    total: movimientos.length,
    porPagina: CAJA_POR_PAGINA,
    paginaActual: cajaPagina,
    onCambiar: (p) => {
      cajaPagina = p;
      cargarCaja();
    },
  });
}

// ============================================================
// Utilidades
// ============================================================

function fechaHoraActualLocal() {
  const ahora = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return {
    fecha: `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-${pad(ahora.getDate())}`,
    hora: `${pad(ahora.getHours())}:${pad(ahora.getMinutes())}:${pad(ahora.getSeconds())}`,
  };
}

function formatearFecha(fechaStr) {
  const [anio, mes, dia] = fechaStr.split('-');
  return `${dia}/${mes}/${anio}`;
}

function etiquetaEstado(estado) {
  return { reservado: 'Reservado', completado: 'Completado', cancelado: 'Cancelado' }[estado] ?? estado;
}
