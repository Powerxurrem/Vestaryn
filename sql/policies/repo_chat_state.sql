-- repo_chat_state.sql
-- Tracks chat reset cutoff for each repo

create table if not exists public.repo_chat_state (
  repo_id uuid primary key references public.repos(id) on delete cascade,
  cutoff_created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.repo_chat_state enable row level security;

grant select, insert, update, delete on table public.repo_chat_state to authenticated;

drop policy if exists repo_chat_state_select on public.repo_chat_state;
drop policy if exists repo_chat_state_upsert on public.repo_chat_state;

create policy repo_chat_state_select
on public.repo_chat_state
for select
to authenticated
using (public.is_repo_member(repo_id));

create policy repo_chat_state_upsert
on public.repo_chat_state
for insert
to authenticated
with check (public.is_repo_member(repo_id));

create policy repo_chat_state_update
on public.repo_chat_state
for update
to authenticated
using (public.is_repo_member(repo_id))
with check (public.is_repo_member(repo_id));