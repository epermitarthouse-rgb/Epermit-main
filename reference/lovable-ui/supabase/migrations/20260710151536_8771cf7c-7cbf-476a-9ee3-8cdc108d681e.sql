revoke execute on function public.approve_member(uuid, public.app_role) from public, anon;
revoke execute on function public.reject_member(uuid, text) from public, anon;
grant execute on function public.approve_member(uuid, public.app_role) to authenticated;
grant execute on function public.reject_member(uuid, text) to authenticated;