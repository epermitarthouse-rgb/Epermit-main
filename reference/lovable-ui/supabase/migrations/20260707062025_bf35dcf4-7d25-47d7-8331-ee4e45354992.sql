
create policy "Users read own signatures" on storage.objects
  for select to authenticated
  using (bucket_id = 'signatures' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users upload own signatures" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'signatures' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users delete own signatures" on storage.objects
  for delete to authenticated
  using (bucket_id = 'signatures' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Admins read all signatures" on storage.objects
  for select to authenticated
  using (bucket_id = 'signatures' and public.has_role(auth.uid(), 'admin'));
