-- Cover the optional admin audit foreign key reported by the database advisor.
create index notification_defaults_updated_by_idx
  on public.notification_defaults(updated_by)
  where updated_by is not null;
