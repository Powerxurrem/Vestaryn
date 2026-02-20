-- sql/rls/functions.sql
-- Canonical membership function used by RLS policies.

create or replace function public.is_repo_member(_repo_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.repos r
    join public.workspace_members wm
      on wm.workspace_id = r.workspace_id
    where r.id = _repo_id
      and wm.user_id = auth.uid()
  );
$$;

revoke all on function public.is_repo_member(uuid) from public;
grant execute on function public.is_repo_member(uuid) to authenticated;