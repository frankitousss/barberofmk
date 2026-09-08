// ============================================================
// FMK BARBERSHOP — Panel del barbero
// ============================================================

let usuarioActual = null;

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
})();

document.getElementById('btn-salir').addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
  window.location.href = 'index.html';
});

// ---------- Navegación entre secciones ----------
const secciones = ['turnos', 'horarios', 'buscar', 'tienda'];

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
          <button class="btn btn--chico btn--violeta" data-completar="${t.id}" data-cliente="${t.cliente_id}">Completar y sellar</button>
          <button class="btn btn--chico btn--peligro" data-cancelar="${t.id}">Cancelar</button>
        ` : ''}
      </div>
    `;
    cont.appendChild(fila);
  });

  cont.querySelectorAll('[data-completar]').forEach((btn) => {
    btn.addEventListener('click', () => completarTurno(btn.dataset.completar, btn.dataset.cliente));
  });
  cont.querySelectorAll('[data-cancelar]').forEach((btn) => {
    btn.addEventListener('click', () => cancelarTurno(btn.dataset.cancelar));
  });
}

async function completarTurno(turnoId, clienteId) {
  const { error: errorTurno } = await supabaseClient
    .from('turnos')
    .update({ estado: 'completado' })
    .eq('id', turnoId);

  if (errorTurno) {
    alert('No se pudo completar el turno: ' + errorTurno.message);
    return;
  }

  const { data, error } = await supabaseClient.rpc('agregar_sello', { p_cliente_id: clienteId });

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
}

async function cancelarTurno(turnoId) {
  if (!confirm('¿Cancelar este turno?')) return;
  await supabaseClient.from('turnos').update({ estado: 'cancelado' }).eq('id', turnoId);
  cargarTurnos();
}

// ============================================================
// HORARIOS DEL BARBERO
// ============================================================

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
  cargarHorarios();
});

async function cargarHorarios() {
  const cont = document.getElementById('lista-horarios');
  cont.innerHTML = 'Cargando...';

  const { data: horarios, error } = await supabaseClient
    .from('horarios')
    .select('*')
    .eq('barbero_id', usuarioActual.id)
    .order('fecha', { ascending: true })
    .order('hora', { ascending: true });

  if (error) {
    cont.innerHTML = `<div class="mensaje mensaje--error visible">${error.message}</div>`;
    return;
  }

  if (!horarios.length) {
    cont.innerHTML = '<div class="vacio">Todavía no cargaste horarios.</div>';
    return;
  }

  cont.innerHTML = '';
  horarios.forEach((h) => {
    const fila = document.createElement('div');
    fila.className = 'item-lista';
    fila.innerHTML = `
      <div class="item-lista__info">
        <strong>${formatearFecha(h.fecha)}</strong>
        <span>${h.hora.slice(0, 5)} hs</span>
      </div>
      <div style="display:flex; align-items:center; gap:0.6rem;">
        <span class="pill pill--${h.disponible ? 'disponible' : 'reservado'}">${h.disponible ? 'Disponible' : 'Reservado'}</span>
        <button class="btn btn--chico btn--peligro" data-borrar-horario="${h.id}">Borrar</button>
      </div>
    `;
    cont.appendChild(fila);
  });

  cont.querySelectorAll('[data-borrar-horario]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Borrar este horario?')) return;
      await supabaseClient.from('horarios').delete().eq('id', btn.dataset.borrarHorario);
      cargarHorarios();
    });
  });
}

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
        <button class="btn btn--violeta" id="btn-agregar-sello">Agregar sello (corte hecho)</button>
        <button class="btn btn--fantasma" id="btn-usar-gratis" ${cortesGratis < 1 ? 'disabled' : ''}>Usar corte gratis</button>
      </div>
    </div>
  `;

  document.getElementById('btn-agregar-sello').addEventListener('click', async () => {
    const { data, error } = await supabaseClient.rpc('agregar_sello', { p_cliente_id: cliente.id });
    if (error) {
      alert('No se pudo agregar el sello: ' + error.message);
      return;
    }
    if (data.corte_gratis) {
      alert('¡Tarjeta completa! El cliente ganó un corte gratis 🎉');
    } else if (data.recompensa_minima) {
      alert('Este corte le da al cliente una recompensa mínima (cada 3 cortes).');
    } else {
      alert('Sello agregado.');
    }
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
// Utilidades
// ============================================================

function formatearFecha(fechaStr) {
  const [anio, mes, dia] = fechaStr.split('-');
  return `${dia}/${mes}/${anio}`;
}

function etiquetaEstado(estado) {
  return { reservado: 'Reservado', completado: 'Completado', cancelado: 'Cancelado' }[estado] ?? estado;
}
