-- ============================================================
-- FMK BARBERSHOP · Actualización: caja + sincronización de horarios
-- ============================================================
-- Cómo usar esto:
-- 1. Entrá a tu proyecto en supabase.com -> SQL Editor
-- 2. Pegá TODO este archivo y ejecutalo (Run)
-- Es seguro correrlo aunque ya hayas corrido schema.sql antes,
-- no rompe nada de lo que ya tenías.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Sincronizar "disponible" de horarios con el estado del turno
-- Cuando un cliente reserva -> el horario pasa a no disponible
-- (así desaparece de "Mis horarios", porque ya se ve en "Mis
-- turnos"). Si el turno se cancela -> el horario vuelve a estar
-- disponible para poder reservarlo de nuevo.
-- ------------------------------------------------------------
create or replace function public.sync_disponibilidad_horario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update horarios set disponible = false where id = new.horario_id;
    return new;
  elsif tg_op = 'UPDATE' then
    if new.estado = 'cancelado' and old.estado <> 'cancelado' then
      update horarios set disponible = true where id = new.horario_id;
    elsif new.estado in ('reservado', 'completado') and old.estado = 'cancelado' then
      update horarios set disponible = false where id = new.horario_id;
    end if;
    return new;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_sync_disponibilidad_horario on turnos;
create trigger trg_sync_disponibilidad_horario
after insert or update on turnos
for each row execute function public.sync_disponibilidad_horario();

-- ------------------------------------------------------------
-- 2) CAJA: movimientos de plata (ingresos por cortes/tienda,
-- egresos por gastos de la barbería)
-- ------------------------------------------------------------
create table if not exists caja_movimientos (
  id uuid primary key default gen_random_uuid(),
  barbero_id uuid not null references profiles(id) on delete cascade,
  tipo text not null check (tipo in ('ingreso', 'egreso')),
  monto numeric(10,2) not null,
  descripcion text not null,
  turno_id uuid references turnos(id) on delete set null,
  cliente_id uuid references profiles(id),
  created_at timestamptz default now()
);

alter table caja_movimientos enable row level security;

create policy "barbero_ve_caja_propia" on caja_movimientos
  for select using (auth.uid() = barbero_id);

create policy "barbero_crea_caja" on caja_movimientos
  for insert with check (auth.uid() = barbero_id);

create policy "barbero_borra_caja" on caja_movimientos
  for delete using (auth.uid() = barbero_id);
