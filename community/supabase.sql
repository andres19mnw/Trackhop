-- Trackhop community matches: the Supabase side (paste it once in Supabase › SQL Editor › Run).
-- Design: community/README.md. The app only ever calls the two functions below with the
-- public (anon) key; it can neither read nor change the tables. Everyone reads the daily export on
-- GitHub instead (.github/workflows/community-export.yml), never this database.

create table if not exists public.matches (
  id            bigserial primary key,
  -- A pair is stored once, the two sides in alphabetical order of service, so A→B and B→A meet.
  a_service     text not null check (a_service ~ '^[a-z0-9_]{2,32}$'),
  a_id          text not null check (length(a_id) between 1 and 128),
  b_service     text not null check (b_service ~ '^[a-z0-9_]{2,32}$'),
  b_id          text not null check (length(b_id) between 1 and 128),
  isrc          text check (isrc is null or isrc ~ '^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$'),
  duration_ms   integer check (duration_ms is null or duration_ms between 1000 and 7200000),
  confirmations integer not null default 0,
  reports       integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (a_service < b_service),
  unique (a_service, a_id, b_service, b_id)
);

-- One row per device and pair. The proof is sha256(install secret + ":" + the pair), made on the
-- device: the same device cannot confirm a pair twice, and two proofs of one device for two
-- different pairs cannot be linked. No user id, no device id, no IP is stored.
create table if not exists public.confirmations (
  match_id   bigint not null references public.matches(id) on delete cascade,
  proof      text not null check (proof ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (match_id, proof)
);

create table if not exists public.match_reports (
  match_id   bigint not null references public.matches(id) on delete cascade,
  proof      text not null check (proof ~ '^[0-9a-f]{64}$'),
  reason     text not null check (reason in ('wrong_song', 'wrong_version', 'unavailable')),
  created_at timestamptz not null default now(),
  primary key (match_id, proof)
);

alter table public.matches       enable row level security;
alter table public.confirmations enable row level security;
alter table public.match_reports enable row level security;
-- No policies on purpose: with RLS on and no policy, anon and authenticated see and change nothing.
revoke all on public.matches, public.confirmations, public.match_reports from anon, authenticated;

-- The pair in canonical order, or null when a side is invalid.
create or replace function public._pair(s1 text, i1 text, s2 text, i2 text)
returns table (a_service text, a_id text, b_service text, b_id text)
language sql immutable as $$
  select case when s1 < s2 then s1 else s2 end, case when s1 < s2 then i1 else i2 end,
         case when s1 < s2 then s2 else s1 end, case when s1 < s2 then i2 else i1 end
  where s1 is not null and s2 is not null and s1 <> s2 and i1 is not null and i2 is not null
$$;

-- Up to 200 pairs a call: [{"s1":"spotify","i1":"…","s2":"ytm","i2":"…","isrc":null,"ms":215000,"proof":"<64 hex>"}].
-- Returns how many confirmations were new. Invalid rows are skipped, never an error for the batch.
create or replace function public.submit_matches(rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare r jsonb; p record; mid bigint; added integer := 0; n integer := 0;
begin
  if jsonb_typeof(rows) <> 'array' then return 0; end if;
  for r in select value from jsonb_array_elements(rows) loop
    n := n + 1; exit when n > 200;
    begin
      select * into p from public._pair(r->>'s1', r->>'i1', r->>'s2', r->>'i2');
      if p is null or coalesce(r->>'proof', '') !~ '^[0-9a-f]{64}$' then continue; end if;
      insert into public.matches (a_service, a_id, b_service, b_id, isrc, duration_ms)
      values (p.a_service, p.a_id, p.b_service, p.b_id, nullif(r->>'isrc', ''), (r->>'ms')::integer)
      on conflict (a_service, a_id, b_service, b_id)
        do update set isrc = coalesce(public.matches.isrc, excluded.isrc), updated_at = now()
      returning id into mid;
      insert into public.confirmations (match_id, proof) values (mid, r->>'proof') on conflict do nothing;
      if found then
        update public.matches set confirmations = confirmations + 1 where id = mid;
        added := added + 1;
      end if;
    exception when others then continue;  -- a bad row (format, number) never fails the others
    end;
  end loop;
  return added;
end $$;

create or replace function public.report_match(s1 text, i1 text, s2 text, i2 text, proof text, reason text)
returns boolean language plpgsql security definer set search_path = public as $$
declare p record; mid bigint;
begin
  select * into p from public._pair(s1, i1, s2, i2);
  if p is null then return false; end if;
  select id into mid from public.matches m
   where m.a_service = p.a_service and m.a_id = p.a_id and m.b_service = p.b_service and m.b_id = p.b_id;
  if mid is null then return false; end if;
  insert into public.match_reports (match_id, proof, reason) values (mid, proof, reason) on conflict do nothing;
  if found then update public.matches set reports = reports + 1 where id = mid; end if;
  return found;
exception when others then return false;
end $$;

revoke all on function public.submit_matches(jsonb) from public;
revoke all on function public.report_match(text, text, text, text, text, text) from public;
grant execute on function public.submit_matches(jsonb) to anon;
grant execute on function public.report_match(text, text, text, text, text, text) to anon;

-- What the daily export publishes: confirmed by at least two devices, and more confirmations than reports.
create or replace view public.matches_export as
  select a_service, a_id, b_service, b_id, isrc, duration_ms, confirmations
  from public.matches where confirmations >= 2 and reports < confirmations;
revoke all on public.matches_export from anon, authenticated;

-- With "Automatically expose new tables" off, nothing is granted by default: the daily export
-- (service_role key, GitHub secret) needs to read the view. Skipped where the role does not exist.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage on schema public to service_role';
    execute 'grant select on public.matches_export to service_role';
  end if;
end $$;
