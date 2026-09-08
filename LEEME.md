# FMK Barbershop — ahora en dos sitios conectados

Se separó todo en dos carpetas/repos, conectados al MISMO proyecto de
Supabase (mismas tablas, mismo login):

- **clientesfmk/** → el sitio público. Se entra directo, sin login. Se
  puede ver horarios y la tienda como invitado. Al querer reservar un
  turno o comprar, aparece un modal (cuadrado) para iniciar sesión o
  registrarse — no un alert del navegador.
- **barberofmk/** → el panel del barbero. Sitio aparte, con su propio
  login. Ahí el barbero también puede cargar su DNI al registrarse.

Subí cada carpeta a su propio repo de GitHub (`barberofmk` y
`clientesfmk` como pediste) y desplegalos por separado (Netlify,
Vercel, GitHub Pages, etc. — los dos gratis y sin backend propio).

## 1. Correr el SQL nuevo en Supabase

Es el MISMO proyecto de Supabase de antes. Andá a **SQL Editor** y
volvé a correr **todo** el archivo `sql/schema.sql` (es seguro
volver a correrlo, no rompe lo que ya tenías). Lo nuevo que agrega es
la función `email_by_dni`, que permite iniciar sesión con el DNI en
vez del email (Supabase Auth solo entiende de "email", así que esta
función busca el email correspondiente al DNI antes de loguear).

## 2. Configurar el link de "olvidé mi contraseña"

Para que el link que llega por email funcione:

- Andá a **Authentication → URL Configuration** en Supabase.
- En **Redirect URLs**, agregá la URL de `reset.html` de CADA sitio
  una vez que estén publicados, por ejemplo:
  - `https://clientesfmk.vercel.app/reset.html`
  - `https://barberofmk.vercel.app/reset.html`
  (o los dominios que uses). Mientras probás en tu compu con un
  servidor local, también podés agregar algo como
  `http://localhost:8000/reset.html`.

## 3. Por qué el login "andaba mal" antes

Las causas más comunes (y ya quedaron cubiertas en el código nuevo):

- Si abrís el `index.html` con doble clic (`file://...`) en vez de un
  servidor local, Supabase no funciona bien. Usá Live Server de VS
  Code o `python3 -m http.server`.
- Si en Supabase tenés activo "Confirm email" (Authentication →
  Settings), el usuario no puede entrar hasta confirmar el mail — el
  sistema ahora te avisa ese error de forma clara en vez de fallar
  raro.
- Si el registro fallaba a mitad de camino (por ejemplo un DNI
  duplicado), ahora se ve el mensaje de error real en vez de quedar
  colgado.

## 4. Qué es nuevo en los formularios

- Confirmar contraseña en el registro (cliente y barbero).
- El barbero también puede cargar su DNI al registrarse.
- Se puede iniciar sesión con email O con DNI, en ambos sitios.
- Botón de ojo para mostrar/ocultar la contraseña.
- Link "Olvidé mi contraseña" debajo de "Entrar", con su propia
  pantalla para crear una contraseña nueva (`reset.html`).
- En `clientesfmk`, se entra directo a la página (sin pantalla de
  login primero). Reservar un turno o comprar un producto sin estar
  logueado abre un modal con el estilo del sitio para iniciar sesión
  o registrarse; después de entrar, retoma automáticamente lo que
  querías hacer.

## Cosas para mejorar más adelante

- El botón "Comprar" de la tienda hoy solo avisa que hay que
  coordinar con el barbero (no había carrito/pago armado en el
  proyecto original). Cuando quieras, se puede sumar un carrito de
  verdad con pago online.
- Las imágenes de productos siguen siendo por URL; se puede sumar
  Supabase Storage para subirlas desde la compu.
