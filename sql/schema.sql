-- ============================================================
-- FMK BARBERSHOP · Schema de Supabase
-- ============================================================
-- Cómo usar esto:
-- 1. Entrá a tu proyecto en supabase.com -> SQL Editor
-- 2. Pegá TODO este archivo y ejecutalo (Run)
-- 3. Andá a Authentication > Providers > Email y, si querés
--    probar rápido sin confirmar mails, desactivá
--    "Confirm email" (Settings de Auth).
-- ============================================================

-- Tipo de usuario
do $$ begin
  create type user_role as enum ('barbero', 'cliente');
exception
  when duplicate_object then null;
end $$;

-- ------------------------------------------------------------
-- PROFILES: datos extra de cada usuario (barbero o cliente)
-- ------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null,
  full_name text not null,
  dni text unique,
  username text unique,
  telefono text,
  created_at timestamptz default now()
);

alter table profiles enable row level security;

create policy "ver_perfil_propio" on profiles
  for select using (auth.uid() = id);

create policy "barbero_ve_todos_los_perfiles" on profiles
  for select using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'barbero')
  );

create policy "crear_perfil_propio" on profiles
  for insert with check (auth.uid() = id);

create policy "actualizar_perfil_propio" on profiles
  for update using (auth.uid() = id);

-- ------------------------------------------------------------
-- HORARIOS: turnos disponibles que carga el barbero
-- ------------------------------------------------------------
create table if not exists horarios (
  id uuid primary key default gen_random_uuid(),
  barbero_id uuid not null references profiles(id) on delete cascade,
  fecha date not null,
  hora time not null,
  disponible boolean not null default true,
  created_at timestamptz default now(),
  unique (barbero_id, fecha, hora)
);

alter table horarios enable row level security;

create policy "todos_ven_horarios" on horarios
  for select using (true);

create policy "barbero_crea_horarios" on horarios
  for insert with check (auth.uid() = barbero_id);

create policy "barbero_actualiza_horarios" on horarios
  for update using (auth.uid() = barbero_id);

create policy "barbero_borra_horarios" on horarios
  for delete using (auth.uid() = barbero_id);

-- ------------------------------------------------------------
-- TURNOS: reservas que hacen los clientes sobre un horario
-- ------------------------------------------------------------
create table if not exists turnos (
  id uuid primary key default gen_random_uuid(),
  horario_id uuid not null references horarios(id) on delete cascade,
  barbero_id uuid not null references profiles(id),
  cliente_id uuid not null references profiles(id),
  fecha date not null,
  hora time not null,
  estado text not null default 'reservado'
    check (estado in ('reservado', 'completado', 'cancelado')),
  created_at timestamptz default now()
);

alter table turnos enable row level security;

create policy "ver_turnos_propios" on turnos
  for select using (auth.uid() = cliente_id or auth.uid() = barbero_id);

create policy "cliente_reserva_turno" on turnos
  for insert with check (auth.uid() = cliente_id);

create policy "actualizar_turno_propio" on turnos
  for update using (auth.uid() = cliente_id or auth.uid() = barbero_id);

-- ------------------------------------------------------------
-- TARJETAS DE FIDELIDAD: sellos por cliente
-- ------------------------------------------------------------
create table if not exists tarjetas_fidelidad (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid unique not null references profiles(id) on delete cascade,
  sellos int not null default 0,
  cortes_totales int not null default 0,
  cortes_gratis_disponibles int not null default 0,
  updated_at timestamptz default now()
);

alter table tarjetas_fidelidad enable row level security;

create policy "ver_tarjeta" on tarjetas_fidelidad
  for select using (
    auth.uid() = cliente_id
    or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'barbero')
  );

create policy "crear_tarjeta" on tarjetas_fidelidad
  for insert with check (
    auth.uid() = cliente_id
    or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'barbero')
  );

create policy "actualizar_tarjeta" on tarjetas_fidelidad
  for update using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'barbero')
  );

-- ------------------------------------------------------------
-- HISTORIAL DE SELLOS Y RECOMPENSAS
-- ------------------------------------------------------------
create table if not exists sellos_historial (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references profiles(id),
  barbero_id uuid not null references profiles(id),
  tipo text not null check (tipo in ('sello', 'recompensa_minima', 'corte_gratis')),
  fecha timestamptz default now()
);

alter table sellos_historial enable row level security;

create policy "ver_historial_propio" on sellos_historial
  for select using (auth.uid() = cliente_id or auth.uid() = barbero_id);

create policy "barbero_crea_historial" on sellos_historial
  for insert with check (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'barbero')
  );

-- ------------------------------------------------------------
-- PRODUCTOS: la tienda
-- ------------------------------------------------------------
create table if not exists productos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  descripcion text,
  precio numeric(10,2) not null default 0,
  imagen_url text,
  stock int not null default 0,
  activo boolean not null default true,
  creado_por uuid references profiles(id),
  created_at timestamptz default now()
);

alter table productos enable row level security;

create policy "todos_ven_productos" on productos
  for select using (activo = true or auth.uid() = creado_por);

create policy "barbero_crea_productos" on productos
  for insert with check (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'barbero')
  );

create policy "barbero_actualiza_productos" on productos
  for update using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'barbero')
  );

create policy "barbero_borra_productos" on productos
  for delete using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'barbero')
  );

-- ------------------------------------------------------------
-- FUNCIÓN: agregar un sello a un cliente
-- Cada 10 sellos = corte gratis (se resetea el contador de sellos)
-- Cada 3 cortes totales = recompensa mínima
-- SECURITY DEFINER para poder saltar RLS de forma controlada,
-- validando adentro que quien llama es un barbero.
-- ------------------------------------------------------------
create or replace function agregar_sello(p_cliente_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_barbero_id uuid := auth.uid();
  v_es_barbero boolean;
  v_sellos int;
  v_cortes int;
  v_recompensa_minima boolean := false;
  v_corte_gratis boolean := false;
begin
  select exists(select 1 from profiles where id = v_barbero_id and role = 'barbero')
    into v_es_barbero;

  if not v_es_barbero then
    raise exception 'Solo un barbero puede cargar sellos';
  end if;

  insert into tarjetas_fidelidad (cliente_id)
    values (p_cliente_id)
    on conflict (cliente_id) do nothing;

  update tarjetas_fidelidad
    set sellos = sellos + 1,
        cortes_totales = cortes_totales + 1,
        updated_at = now()
    where cliente_id = p_cliente_id
    returning sellos, cortes_totales into v_sellos, v_cortes;

  insert into sellos_historial (cliente_id, barbero_id, tipo)
    values (p_cliente_id, v_barbero_id, 'sello');

  if v_cortes % 3 = 0 and v_sellos <> 10 then
    v_recompensa_minima := true;
    insert into sellos_historial (cliente_id, barbero_id, tipo)
      values (p_cliente_id, v_barbero_id, 'recompensa_minima');
  end if;

  if v_sellos >= 10 then
    v_corte_gratis := true;
    update tarjetas_fidelidad
      set sellos = 0,
          cortes_gratis_disponibles = cortes_gratis_disponibles + 1
      where cliente_id = p_cliente_id
      returning sellos into v_sellos;
    insert into sellos_historial (cliente_id, barbero_id, tipo)
      values (p_cliente_id, v_barbero_id, 'corte_gratis');
  end if;

  return jsonb_build_object(
    'sellos', v_sellos,
    'cortes_totales', v_cortes,
    'recompensa_minima', v_recompensa_minima,
    'corte_gratis', v_corte_gratis
  );
end;
$$;

grant execute on function agregar_sello(uuid) to authenticated;

-- ------------------------------------------------------------
-- FUNCIÓN: usar un corte gratis disponible (opcional, botón del barbero)
-- ------------------------------------------------------------
create or replace function usar_corte_gratis(p_cliente_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_es_barbero boolean;
  v_disponibles int;
begin
  select exists(select 1 from profiles where id = auth.uid() and role = 'barbero')
    into v_es_barbero;

  if not v_es_barbero then
    raise exception 'Solo un barbero puede usar un corte gratis';
  end if;

  select cortes_gratis_disponibles into v_disponibles
    from tarjetas_fidelidad where cliente_id = p_cliente_id;

  if v_disponibles is null or v_disponibles < 1 then
    raise exception 'Este cliente no tiene cortes gratis disponibles';
  end if;

  update tarjetas_fidelidad
    set cortes_gratis_disponibles = cortes_gratis_disponibles - 1
    where cliente_id = p_cliente_id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function usar_corte_gratis(uuid) to authenticated;

-- ------------------------------------------------------------
-- FUNCIÓN: buscar el email de una cuenta a partir de su DNI
-- Se usa para poder iniciar sesión con DNI en vez de email.
-- SECURITY DEFINER porque el DNI se busca ANTES de estar logueado
-- (rol "anon"), y "anon" no tiene permiso de leer profiles ni
-- auth.users directamente. La función solo devuelve el email,
-- nunca expone otros datos.
-- ------------------------------------------------------------
create or replace function public.email_by_dni(p_dni text)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid;
  v_email text;
begin
  select id into v_user_id from profiles where dni = p_dni;

  if v_user_id is null then
    return null;
  end if;

  select email into v_email from auth.users where id = v_user_id;
  return v_email;
end;
$$;

grant execute on function public.email_by_dni(text) to anon, authenticated;
