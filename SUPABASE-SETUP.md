# Supabase setup & permissions

Supabase gives us three separate things:

1. **Tables** (`collages`, `layers`) -- one row per collage (its settings and
   share token), one row per image within a collage.
2. **A storage bucket** (`layers`) -- the actual image files, namespaced
   `<collageId>/<file>` so a whole collage's files can be found and removed together.
3. **Permissions** -- who's allowed to read and write those two things.

---

## 1. Create a project

supabase.com -> New project. Pick any name and a region near you, and set a
database password (save it somewhere; we won't need it in the site, but you
can't recover it later). The free tier is plenty.

Note: free projects **pause after about a week of inactivity**. A paused project
means the site can't load its images. That's why the viewer falls back to the
static `manifest.json` if Supabase doesn't answer.

## 2. Find your URL and key

**Project Settings -> API** (or "API Keys"). You need two values:

- **Project URL** -- looks like `https://abcdxyz.supabase.co`
- **A public key** -- newer projects show a *publishable* key (starts with
  `sb_publishable_`); older ones show an *anon* key (a long string starting `eyJ`).
  Either works.

**Never put the `secret` or `service_role` key in the site.** Those bypass all
permissions, and anything in the site's JavaScript is public.

## 3. Create the storage bucket

**Storage -> New bucket** -> name it exactly `layers` -> switch **Public bucket** on
-> Create. (Skip this if you already have it from before.)

What "public" means: anyone with a file's URL can *download* it, no permission
check. It does **not** allow uploading or deleting -- that's step 4.

## 4. Database: migrating to multiple collages

If you already had the single-collage setup running, run this once in the
**SQL Editor**. It's safe to re-run. It does **not** touch your existing
layers or uploaded files -- it adds a `collages` table, moves your current
settings into its first row (slug `main`), and retires the old singleton
`settings` table.

```sql
create extension if not exists pgcrypto;

create table if not exists collages (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  title       text not null default 'Untitled',
  edit_token  text unique not null,
  depth_scale double precision not null default 1,
  speed       double precision not null default 1,
  density     double precision not null default 1.2,
  tilt_sensitivity double precision not null default 0.5,
  created_at  timestamptz not null default now()
);

insert into collages (slug, title, edit_token, depth_scale, speed, density, tilt_sensitivity)
select 'main', 'My Collage', encode(gen_random_bytes(16), 'hex'),
       depth_scale, speed, density, tilt_sensitivity
from settings where id = 1
on conflict (slug) do nothing;

alter table layers add column if not exists collage_id uuid references collages(id) on delete cascade;

update layers set collage_id = (select id from collages where slug = 'main')
where collage_id is null;

alter table layers alter column collage_id set not null;

drop table if exists settings;

alter table collages enable row level security;
drop policy if exists "collages: anyone can read" on collages;
drop policy if exists "collages: anyone can add" on collages;
drop policy if exists "collages: anyone can edit" on collages;
drop policy if exists "collages: anyone can delete" on collages;
create policy "collages: anyone can read"   on collages for select using (true);
create policy "collages: anyone can add"    on collages for insert with check (true);
create policy "collages: anyone can edit"   on collages for update using (true) with check (true);
create policy "collages: anyone can delete" on collages for delete using (true);
```

**Find your migrated collage's share links** afterward:

```sql
select slug, edit_token from collages;
```

Read-only link: `https://yourdomain/?c=main`
Collaborate link: `https://yourdomain/?c=main&edit=<edit_token>`

Open the collaborate link once in your own browser and it remembers edit
access for that device from then on (see the README's "Sharing" section) --
you don't need to keep the token handy after that first visit.

One limitation worth knowing: your migrated collage's *existing* files keep
their old, un-prefixed storage paths (they still work fine) -- only newly
uploaded files get the `<collageId>/` prefix. If you ever delete that specific
collage, its original files won't be auto-removed by the bulk-delete (new
collages don't have this issue). Harmless, just a little storage left behind.

### Fresh install (no existing data)

Same as above, but skip straight to creating the tables with no migration step:

```sql
create extension if not exists pgcrypto;

create table collages (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  title       text not null default 'Untitled',
  edit_token  text unique not null,
  depth_scale double precision not null default 1,
  speed       double precision not null default 1,
  density     double precision not null default 1.2,
  tilt_sensitivity double precision not null default 0.5,
  created_at  timestamptz not null default now()
);

create table layers (
  id           uuid primary key default gen_random_uuid(),
  collage_id   uuid not null references collages(id) on delete cascade,
  name         text not null,
  storage_path text not null,
  depth        double precision not null default 1,
  scale        double precision not null default 1,
  active       boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);

alter table collages enable row level security;
alter table layers   enable row level security;

create policy "collages: anyone can read"   on collages for select using (true);
create policy "collages: anyone can add"    on collages for insert with check (true);
create policy "collages: anyone can edit"   on collages for update using (true) with check (true);
create policy "collages: anyone can delete" on collages for delete using (true);

create policy "layers: anyone can read"   on layers for select using (true);
create policy "layers: anyone can add"    on layers for insert with check (true);
create policy "layers: anyone can edit"   on layers for update using (true) with check (true);
create policy "layers: anyone can delete" on layers for delete using (true);

create policy "layers bucket: anyone can read"   on storage.objects for select using (bucket_id = 'layers');
create policy "layers bucket: anyone can upload" on storage.objects for insert with check (bucket_id = 'layers');
create policy "layers bucket: anyone can delete" on storage.objects for delete using (bucket_id = 'layers');
```

If Supabase complains about ownership/permissions on `storage.objects`, create
those three bucket policies through the dashboard instead: **Storage ->
Policies -> `layers` bucket -> New policy**, one each for SELECT, INSERT and
DELETE, with the condition `bucket_id = 'layers'`.

## 5. Check it works -- before any of our code is involved

**a. The table.** Table Editor -> `collages` should show at least one row.

**b. The file storage.** Storage -> `layers` -> Upload any PNG -> click it ->
"Get URL". Open that URL in a new browser tab -- you should see the image. Try it
on your phone too, on cellular as well as Wi-Fi.

**c. Anonymous reads.** In a terminal, with your values filled in:

```bash
curl "https://YOUR-REF.supabase.co/rest/v1/collages?select=slug,title" \
  -H "apikey: YOUR_PUBLIC_KEY" -H "Authorization: Bearer YOUR_PUBLIC_KEY"
```

You should get back a JSON array with at least one collage.

- `[]` -> the policy or the row is missing (re-run the SQL).
- An error mentioning `permission denied` or a 401/403 -> wrong key, or RLS/policies not set up.

If all three pass, the backend is sound and any remaining problem is in our code,
which is a much smaller thing to debug.

## 6. What the permissions actually mean

- The public key ships inside the site's JavaScript, so it's not a secret. It only
  says "this is an anonymous visitor". **What that visitor can do is decided
  entirely by the policies above.**
- With RLS on, the default is *deny*; each `create policy` grants exactly one
  action on one table.
- **Right now, anyone who finds your site and figures out the API can add, edit,
  and delete any collage.** The edit button/link system is a convenience gate in
  the UI, not real security -- see the README's "Sharing" section for exactly
  what it does and doesn't protect against, and when to upgrade to real accounts.

## 7. Connecting the site

The code needs no library -- it talks to Supabase with plain `fetch`. Once the
checks above pass, put your Project URL and public key into `js/config.js`
(see the README), push, and open the site.

## Adding the Rotation setting (run once)

The Rotation scene slider (0-30 degrees) is saved per collage. Run this in the
Supabase SQL editor; until you do, the slider still works live but isn't saved.

```sql
alter table collages add column if not exists rotation double precision not null default 15;
```
