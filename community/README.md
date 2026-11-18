# Community matches

Trackhop users can choose to share the track pairs their syncs found ("this Spotify track is that
YouTube Music track"), so other users' syncs find them at once instead of searching. Planned for 2.2.

## How it works

- **Off by default.** The first start asks once, Yes or No, nothing preselected; users who update see
  it once. It can be changed in Settings.
- **What is sent, and only when the user said yes:** for each pair, the two services, the two track
  ids, the ISRC when there is one, the duration, and a proof (below). The user can see the exact rows
  before they leave. No account, no user id, no device id, no playlist names, no titles.
- **The proof** is `sha256(install secret + ":" + the pair)`, made on the device: the same device
  cannot confirm a pair twice, and two pairs sent by one device cannot be linked to each other.
- **Reading never asks the server anything.** A GitHub Action exports the pairs once a day to the
  release `community-matches`, one gzipped CSV per pair of services. The app downloads the files for
  the services it uses and looks pairs up on the phone, so nobody learns what anyone listens to.
- **Anyone can copy the whole database**: the same files, from the release page.
- **Wrong pairs:** a pair is exported only once two different devices confirmed it and it has more
  confirmations than reports. The app still checks every pair (duration, title) before using it, and
  a pair can be reported.

## Setting it up (maintainer)

1. Create a free Supabase project, region in the EU.
2. Supabase › SQL Editor: paste `community/supabase.sql` and run it.
3. GitHub › Settings › Secrets › Actions: add `SUPABASE_URL` (Project URL) and
   `SUPABASE_SERVICE_KEY` (the service_role key, never in the app or in a commit).
4. The app gets the Project URL and the public anon key at build time (the anon key is public by
   design: with this schema it can only call `submit_matches` and `report_match`).
5. Run the workflow "Community matches export" once by hand to create the release.

## Limits of the free plan

500 MB of database (a few million pairs) and about 5 GB of egress a month. Only the uploads and the
daily export touch Supabase; downloads come from GitHub. The daily export also keeps the project
from being paused. If the database fills up, uploads stop and the app keeps working.

## File format

`<serviceA>__<serviceB>.csv.gz`, services in alphabetical order, columns
`a_id,b_id,isrc,duration_ms,confirmations`; `manifest.json` lists the files, rows and export time.
Licence of the data: to be decided (proposal: CC0).
