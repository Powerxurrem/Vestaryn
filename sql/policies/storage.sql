-- sql/rls/storage.sql
-- Policies for bucket "vestaryn-files"
-- Storage key format enforced by your app:
-- repos/<repoId>/<fileId>/v<version>

-- Enable RLS on storage.objects is already on in Supabase.

drop policy if exists vestaryn_files_read on storage.objects;
drop policy if exists vestaryn_files_insert on storage.objects;
drop policy if exists vestaryn_files_update on storage.objects;
drop policy if exists vestaryn_files_delete on storage.objects;

create policy vestaryn_files_read
on storage.objects
for select
to authenticated
using (
  bucket_id = 'vestaryn-files'
  and public.is_repo_member( (split_part(name, '/', 2))::uuid )
);

create policy vestaryn_files_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'vestaryn-files'
  and public.is_repo_member( (split_part(name, '/', 2))::uuid )
);

create policy vestaryn_files_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'vestaryn-files'
  and public.is_repo_member( (split_part(name, '/', 2))::uuid )
)
with check (
  bucket_id = 'vestaryn-files'
  and public.is_repo_member( (split_part(name, '/', 2))::uuid )
);

create policy vestaryn_files_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'vestaryn-files'
  and public.is_repo_member( (split_part(name, '/', 2))::uuid )
);

-- sql/rls/storage.sql
-- Policies for bucket "vestaryn-files"
-- Storage key format enforced by your app:
-- repos/<repoId>/<fileId>/v<version>

drop policy if exists vestaryn_files_read on storage.objects;
drop policy if exists vestaryn_files_insert on storage.objects;
drop policy if exists vestaryn_files_update on storage.objects;
drop policy if exists vestaryn_files_delete on storage.objects;

-- Guard: only attempt UUID cast if the object key starts with repos/<uuid>/
-- Prevents ::uuid cast errors and accidental leakage.
-- (Repo ID is segment 2 in "repos/<repoId>/...")
create policy vestaryn_files_read
on storage.objects
for select
to authenticated
using (
  bucket_id = 'vestaryn-files'
  and name ~ '^repos/[0-9a-fA-F-]{8}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{12}/'
  and public.is_repo_member((split_part(name, '/', 2))::uuid)
);

create policy vestaryn_files_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'vestaryn-files'
  and name ~ '^repos/[0-9a-fA-F-]{8}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{12}/'
  and public.is_repo_member((split_part(name, '/', 2))::uuid)
);

create policy vestaryn_files_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'vestaryn-files'
  and name ~ '^repos/[0-9a-fA-F-]{8}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{12}/'
  and public.is_repo_member((split_part(name, '/', 2))::uuid)
)
with check (
  bucket_id = 'vestaryn-files'
  and name ~ '^repos/[0-9a-fA-F-]{8}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{12}/'
  and public.is_repo_member((split_part(name, '/', 2))::uuid)
);

create policy vestaryn_files_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'vestaryn-files'
  and name ~ '^repos/[0-9a-fA-F-]{8}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{12}/'
  and public.is_repo_member((split_part(name, '/', 2))::uuid)
);