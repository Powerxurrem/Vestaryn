-- sql/rls/repo_files.sql
-- Canonical file + version policies.
-- IMPORTANT: Do NOT filter deleted_at in RLS SELECT, or soft-delete UPDATE can fail.
-- Hide deleted files in your API/UI by filtering deleted_at IS NULL.

alter table public.repo_files enable row level security;
alter table public.repo_file_versions enable row level security;

grant select, insert, update, delete on table public.repo_files to authenticated;
grant select, insert, update, delete on table public.repo_file_versions to authenticated;

-- repo_files policies
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

-- UPDATE is required for soft delete (deleted_at) and metadata changes.
-- WITH CHECK must be true, to avoid "new row violates RLS" edge cases.
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

-- repo_file_versions policies
drop policy if exists repo_file_versions_select on public.repo_file_versions;
drop policy if exists repo_file_versions_insert on public.repo_file_versions;
drop policy if exists repo_file_versions_update on public.repo_file_versions;
drop policy if exists repo_file_versions_delete on public.repo_file_versions;

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

-- Usually you don't allow update/delete of versions (append-only).
-- If you want strict append-only: do NOT create update/delete policies.
-- Leaving them absent will deny those actions under RLS.