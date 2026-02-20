-- sql/rls/repos.sql
-- Repo visibility is granted to workspace members.

alter table public.repos enable row level security;

grant select, insert, update, delete on table public.repos to authenticated;

drop policy if exists repos_select_member on public.repos;
drop policy if exists repos_insert_member on public.repos;
drop policy if exists repos_update_member on public.repos;
drop policy if exists repos_delete_member on public.repos;

-- Members of a workspace can read repos in that workspace
create policy repos_select_member
on public.repos
for select
to authenticated
using (
  exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = repos.workspace_id
      and wm.user_id = auth.uid()
  )
);

-- Allow creating repos only if the creator is a member of the workspace_id they assign.
-- (If you create repos via service role, you can drop this insert policy.)
create policy repos_insert_member
on public.repos
for insert
to authenticated
with check (
  exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = repos.workspace_id
      and wm.user_id = auth.uid()
  )
);

-- Allow updating/deleting repos only for workspace members (tighten later to owners/admins if needed)
create policy repos_update_member
on public.repos
for update
to authenticated
using (
  exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = repos.workspace_id
      and wm.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = repos.workspace_id
      and wm.user_id = auth.uid()
  )
);

create policy repos_delete_member
on public.repos
for delete
to authenticated
using (
  exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = repos.workspace_id
      and wm.user_id = auth.uid()
  )
);