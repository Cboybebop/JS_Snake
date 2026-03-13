create table if not exists public.snake_highscores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  score integer not null,
  mode text not null check (mode in ('classic', 'versus')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.snake_highscores enable row level security;

create policy "Public read highscores"
on public.snake_highscores
for select
using (true);

create policy "Public insert highscores"
on public.snake_highscores
for insert
with check (true);
