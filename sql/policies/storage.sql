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