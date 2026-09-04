-- Login usernames are case-insensitive identifiers.  Auth metadata is not a
-- relational unique key, so preserve the invariant on the mirrored user table.
create unique index if not exists users_name_normalized_unique
  on public.users (lower(btrim(name)))
  where name is not null and btrim(name) <> '';
