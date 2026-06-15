-- Study Calendar — cross-device sync setup.
-- Run this once in your Supabase project: SQL Editor → New query → paste → Run.
-- (Or with the CLI: supabase db query < study-calendar/supabase/setup.sql)
--
-- It creates one table holding a single JSON document per "space". The app
-- derives the space id from your passphrase (SHA-256), so the same passphrase
-- on two devices points them at the same shared document.

create table if not exists study_calendar_state (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Keep updated_at fresh on every write — the app uses it for last-writer-wins.
create or replace function study_calendar_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists study_calendar_touch on study_calendar_state;
create trigger study_calendar_touch
  before update on study_calendar_state
  for each row execute function study_calendar_touch();

-- Single-user app, no login: allow anonymous access. Rows are only reachable by
-- their id (the SHA-256 of your private passphrase). For stricter access, add
-- Supabase Auth and replace `using (true)` with an auth.uid()-based policy.
alter table study_calendar_state enable row level security;

create policy "anon read"   on study_calendar_state for select using (true);
create policy "anon insert" on study_calendar_state for insert with check (true);
create policy "anon update" on study_calendar_state for update using (true) with check (true);

-- Optional: instant push updates via realtime. The app also syncs on tab focus,
-- so this is nice-to-have, not required.
alter publication supabase_realtime add table study_calendar_state;
