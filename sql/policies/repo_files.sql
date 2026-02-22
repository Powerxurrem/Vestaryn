alter table public.repo_files enable row level security;
alter table public.repo_file_versions enable row level security;

grant select, insert, update, delete on table public.repo_files to authenticated;
grant select, insert, update, delete on table public.repo_file_versions to authenticated;

-- repo_files policies (no deleted_at filter in RLS SELECT)
drop policy if exists repo_files_select on public.repo_files;
drop policy if exists repo_files_insert on public.repo_files;
drop policy if exists repo_files_update on public.repo_files;
drop policy if exists repo_files_delete on public.repo_files;

create policy repo_files_select
on public.repo_files
for select
to authenticated
using (public.is_repo_member(repo_id));

create policy repo_files_insert
on public.repo_files
for insert
to authenticated
with check (public.is_repo_member(repo_id));

create policy repo_files_update
on public.repo_files
for update
to authenticated
using (public.is_repo_member(repo_id))
with check (true);

create policy repo_files_delete
on public.repo_files
for delete
to authenticated
using (public.is_repo_member(repo_id));

-- repo_file_versions policies (append-only model: only SELECT + INSERT)
drop policy if exists repo_file_versions_select on public.repo_file_versions;
drop policy if exists repo_file_versions_insert on public.repo_file_versions;

create policy repo_file_versions_select
on public.repo_file_versions
for select
to authenticated
using (
  exists (
    select 1
    from public.repo_files f
    where f.id = repo_file_versions.file_id
      and public.is_repo_member(f.repo_id)
  )
);

create policy repo_file_versions_insert
on public.repo_file_versions
for insert
to authenticated
with check (
  exists (
    select 1
    from public.repo_files f
    where f.id = repo_file_versions.file_id
      and public.is_repo_member(f.repo_id)
  )
);

-- columns / indexes (idempotent)
alter table public.repo_files
add column if not exists version integer not null default 1;

alter table public.repo_file_versions
add column if not exists file_id uuid,
add column if not exists version integer,
add column if not exists storage_key text,
add column if not exists size_bytes bigint,
add column if not exists mime text,
add column if not exists created_at timestamptz not null default now(),
add column if not exists created_by uuid;

create unique index if not exists repo_file_versions_file_version_uniq
on public.repo_file_versions (file_id, version);