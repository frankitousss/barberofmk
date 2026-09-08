// ============================================================
// FMK BARBERSHOP · barberofmk — Login y registro (solo barberos)
// ============================================================

const tabLogin = document.getElementById('tab-login');
const tabRegistro = document.getElementById('tab-registro');
const formLogin = document.getElementById('form-login');
const formRegistro = document.getElementById('form-registro');
const formOlvide = document.getElementById('form-olvide');
const mensajeLogin = document.getElementById('mensaje-login');
const mensajeRegistro = document.getElementById('mensaje-registro');
const mensajeOlvide = document.getElementById('mensaje-olvide');

// --- Si ya hay sesión activa de barbero, vamos directo al panel ---
(async function redirigirSiYaHaySesion() {
  try {
    const { data } = await supabaseClient.auth.getSession();
    if (data.session) {
      const { data: perfil } = await supabaseClient
        .from('profiles')
        .select('role')
        .eq('id', data.session.user.id)
        .maybeSingle();
      if (perfil?.role === 'barbero') {
        window.location.href = 'barbero.html';
      }
    }
  } catch (e) {
    // Sin conexión a Supabase todavía (claves sin configurar, etc). No hacemos nada.
    console.warn('No se pudo revisar la sesión:', e);
  }
})();

function mostrarMensaje(el, texto, tipo) {
  el.textContent = texto;
  el.className = `mensaje visible mensaje--${tipo}`;
}

function ocultarMensaje(el) {
  el.className = 'mensaje';
  el.textContent = '';
}

// --- Mostrar / ocultar contraseña ---
document.querySelectorAll('.btn-ojo').forEach((boton) => {
  boton.addEventListener('click', () => {
    const input = document.getElementById(boton.dataset.toggle);
    const esOculta = input.type === 'password';
    input.type = esOculta ? 'text' : 'password';
    boton.setAttribute('aria-label', esOculta ? 'Ocultar contraseña' : 'Mostrar contraseña');
    boton.classList.toggle('activo', esOculta);
  });
});

// --- Tabs login / registro ---
function mostrarLogin() {
  tabLogin.classList.add('activo');
  tabRegistro.classList.remove('activo');
  formLogin.classList.remove('oculto');
  formRegistro.classList.add('oculto');
  formOlvide.classList.add('oculto');
}

tabLogin.addEventListener('click', mostrarLogin);

tabRegistro.addEventListener('click', () => {
  tabRegistro.classList.add('activo');
  tabLogin.classList.remove('activo');
  formRegistro.classList.remove('oculto');
  formLogin.classList.add('oculto');
  formOlvide.classList.add('oculto');
});

// --- Olvidé mi contraseña ---
document.getElementById('btn-olvide').addEventListener('click', () => {
  formLogin.classList.add('oculto');
  formOlvide.classList.remove('oculto');
});

document.getElementById('btn-volver-login').addEventListener('click', () => {
  formOlvide.classList.add('oculto');
  mostrarLogin();
});

formOlvide.addEventListener('submit', async (e) => {
  e.preventDefault();
  ocultarMensaje(mensajeOlvide);
  const email = document.getElementById('olvide-email').value.trim();

  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname.replace('index.html', '') + 'reset.html',
  });

  if (error) {
    mostrarMensaje(mensajeOlvide, 'No pudimos enviar el email: ' + error.message, 'error');
    return;
  }

  mostrarMensaje(mensajeOlvide, 'Listo. Revisá tu email (y la carpeta de spam) para crear una contraseña nueva.', 'ok');
});

// --- Login (con email o DNI) ---
formLogin.addEventListener('submit', async (e) => {
  e.preventDefault();
  ocultarMensaje(mensajeLogin);

  const usuario = document.getElementById('login-usuario').value.trim();
  const password = document.getElementById('login-password').value;

  if (!usuario || !password) {
    mostrarMensaje(mensajeLogin, 'Completá usuario y contraseña.', 'error');
    return;
  }

  let email = usuario;

  // Si no parece un email, lo tratamos como DNI y buscamos el email real.
  if (!usuario.includes('@')) {
    const { data: emailEncontrado, error: errorDni } = await supabaseClient.rpc('email_by_dni', { p_dni: usuario });

    if (errorDni) {
      mostrarMensaje(mensajeLogin, 'No pudimos validar el DNI: ' + errorDni.message, 'error');
      return;
    }
    if (!emailEncontrado) {
      mostrarMensaje(mensajeLogin, 'No encontramos ninguna cuenta con ese DNI.', 'error');
      return;
    }
    email = emailEncontrado;
  }

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

  if (error) {
    if (error.message.toLowerCase().includes('email not confirmed')) {
      mostrarMensaje(mensajeLogin, 'Tenés que confirmar tu email antes de entrar. Revisá tu casilla de correo.', 'error');
    } else if (error.message.toLowerCase().includes('invalid login credentials')) {
      mostrarMensaje(mensajeLogin, 'Usuario o contraseña incorrectos.', 'error');
    } else {
      mostrarMensaje(mensajeLogin, 'No pudimos iniciar sesión: ' + error.message, 'error');
    }
    return;
  }

  const { data: perfil, error: errorPerfil } = await supabaseClient
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .maybeSingle();

  if (errorPerfil || !perfil) {
    mostrarMensaje(mensajeLogin, 'Tu cuenta no tiene un perfil de barbero cargado. Contactá al administrador.', 'error');
    await supabaseClient.auth.signOut();
    return;
  }

  if (perfil.role !== 'barbero') {
    mostrarMensaje(mensajeLogin, 'Esta cuenta no es de barbero. Usá el sitio de clientes para entrar.', 'error');
    await supabaseClient.auth.signOut();
    return;
  }

  window.location.href = 'barbero.html';
});

// --- Registro (solo barberos) ---
formRegistro.addEventListener('submit', async (e) => {
  e.preventDefault();
  ocultarMensaje(mensajeRegistro);

  const nombre = document.getElementById('reg-nombre').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const passwordConfirmar = document.getElementById('reg-password-confirmar').value;
  const username = document.getElementById('reg-username').value.trim();
  const dni = document.getElementById('reg-dni').value.trim();

  if (!dni) {
    mostrarMensaje(mensajeRegistro, 'Ingresá tu DNI para crear la cuenta.', 'error');
    return;
  }

  if (password !== passwordConfirmar) {
    mostrarMensaje(mensajeRegistro, 'Las contraseñas no coinciden.', 'error');
    return;
  }

  if (password.length < 6) {
    mostrarMensaje(mensajeRegistro, 'La contraseña tiene que tener al menos 6 caracteres.', 'error');
    return;
  }

  const { data, error } = await supabaseClient.auth.signUp({ email, password });

  if (error) {
    mostrarMensaje(mensajeRegistro, 'No pudimos crear la cuenta: ' + error.message, 'error');
    return;
  }

  const userId = data.user?.id;
  if (!userId) {
    mostrarMensaje(mensajeRegistro, 'Revisá tu email para confirmar la cuenta y después iniciá sesión.', 'ok');
    return;
  }

  const { error: errorPerfil } = await supabaseClient.from('profiles').insert({
    id: userId,
    role: 'barbero',
    full_name: nombre,
    username: username || null,
    dni: dni,
  });

  if (errorPerfil) {
    mostrarMensaje(mensajeRegistro, 'La cuenta se creó pero falló el perfil: ' + errorPerfil.message, 'error');
    return;
  }

  const { data: sesion } = await supabaseClient.auth.getSession();
  if (sesion.session) {
    window.location.href = 'barbero.html';
  } else {
    mostrarMensaje(mensajeRegistro, '¡Cuenta creada! Revisá tu email para confirmarla y después iniciá sesión.', 'ok');
    formRegistro.reset();
  }
});
