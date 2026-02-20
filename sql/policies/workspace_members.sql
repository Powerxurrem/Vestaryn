-- sql/rls/workspace_members.sql
-- Workspace membership visibility for authenticated users.

alter table public.workspace_members enable row level security;

-- Ensure privileges (RLS still applies)
grant select, insert, update, delete on table public.workspace_members to authenticated;

-- Drop existing policies (safe/idempotent)
drop policy if exists workspace_members_select_own on public.workspace_members;
drop policy if exists workspace_members_insert_self on public.workspace_members;
drop policy if exists workspace_members_update_own on public.workspace_members;
drop policy if exists workspace_members_delete_own on public.workspace_members;

-- Users can view their own membership rows
create policy workspace_members_select_own
on public.workspace_members
for select
to authenticated
using (user_id = auth.uid());

-- Optional: allow users to insert themselves (often you create memberships server-side; keep or remove)
create policy workspace_members_insert_self
on public.workspace_members
for insert
to authenticated
with check (user_id = auth.uid());

-- Optional: allow users to update their own membership row (usually you DON'T want this; keep locked down if desired)
-- If you want to forbid, do not create update/delete policies.
create policy workspace_members_update_own
on public.workspace_members
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy workspace_members_delete_own
on public.workspace_members
for delete
to authenticated
using (user_id = auth.uid());