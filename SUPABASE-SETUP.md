# Supabase setup & permissions (Phase 2)

You don't need any of this for Phase 1 — the static site works without it. Do it
in parallel if you like; nothing here touches the live site until Phase 2 code
is added.

Supabase gives us three separate things, and most of our earlier trouble was
about the third:

1. **A table** (`layers`) — one row per image: its depth, scale, order, on/off.
2. **A storage bucket** (`layers`) — the actual PNG files.
3. **Permissions** — who's allowed to read and write those two things.

---

## 1. Create a project

supabase.com → New project. Pick any name and a region near you, and set a
database password (save it somewhere; we won't need it in the site, but you
can't recover it later). The free tier is plenty.

Note: free projects **pause after about a week of inactivity**. A paused project
means the site can't load its images. That's why the Phase 2 viewer will fall
back to the static `manifest.json` if Supabase doesn't answer.

## 2. Find your URL and key

**Project Settings → API** (or "API Keys"). You need two values:

- **Project URL** — looks like `https://abcdxyz.supabase.co`
- **A public key** — newer projects show a *publishable* key (starts with
  `sb_publishable_`); older ones show an *anon* key (a long string starting `eyJ`).
  Either works.

**Never put the `secret` or `service_role` key in the site.** Those bypass all
permissions, and anything in the site's JavaScript is public.

## 3. Create the storage bucket

**Storage → New bucket** → name it exactly `layers` → switch **Public bucket** on
→ Create.

What "public" means: anyone with a file's URL can *download* it, no permission
check. It does **not** allow uploading or deleting — that's step 4.

## 4. Create the tables and permissions (SQL)

**SQL Editor → New query**, paste all of this, and Run. It's safe to run again
whenever you want a clean slate — it wipes the two tables (and any rows in them)
and removes any old `layers…` storage policies from earlier attempts.

```sql
-- ============ clean slate ============
drop table if exists layers cascade;
drop table if exists settings cascade;

do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname ilike 'layers%'
  loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
end $$;

-- ============ tables ============
create table layers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  storage_path text not null,
  depth        double precision not null default 1,
  scale        double precision not null default 1,
  active       boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);

create table settings (
  id          integer primary key default 1 check (id = 1),   -- exactly one row
  depth_scale double precision not null default 1,
  speed       double precision not null default 1,
  density     double precision not null default 1.2
);
insert into settings (id) values (1);

-- ============ permissions on the tables ============
-- Row Level Security ON = nobody can do anything until a policy allows it.
alter table layers   enable row level security;
alter table settings enable row level security;

create policy "layers: anyone can read"   on layers   for select using (true);
create policy "layers: anyone can add"    on layers   for insert with check (true);
create policy "layers: anyone can edit"   on layers   for update using (true) with check (true);
create policy "layers: anyone can delete" on layers   for delete using (true);

create policy "settings: anyone can read" on settings for select using (true);
create policy "settings: anyone can edit" on settings for update using (true) with check (true);

-- ============ permissions on the files ============
create policy "layers bucket: anyone can read"   on storage.objects for select using (bucket_id = 'layers');
create policy "layers bucket: anyone can upload" on storage.objects for insert with check (bucket_id = 'layers');
create policy "layers bucket: anyone can delete" on storage.objects for delete using (bucket_id = 'layers');
```

If Supabase complains about ownership or permissions on `storage.objects`, create
those three policies through the dashboard instead: **Storage → Policies →
`layers` bucket → New policy**, one each for SELECT, INSERT and DELETE, with the
condition `bucket_id = 'layers'`.

## 5. Check it works — before any of our code is involved

**a. The table.** Table Editor → `settings` should show one row
(`depth_scale 1, speed 1, density 1.2`).

**b. The file storage.** Storage → `layers` → Upload any PNG → click it →
"Get URL". Open that URL in a new browser tab — you should see the image. Try it
on your phone too, on cellular as well as Wi-Fi. (This is the exact URL pattern
the site will use: `…/storage/v1/object/public/layers/<file>`.)

**c. Anonymous reads.** In a terminal, with your values filled in:

```bash
curl "https://YOUR-REF.supabase.co/rest/v1/settings?select=*" \
  -H "apikey: YOUR_PUBLIC_KEY" -H "Authorization: Bearer YOUR_PUBLIC_KEY"
```

You should get `[{"id":1,"depth_scale":1,"speed":1,"density":1.2}]`.

- `[]` → the policy or the row is missing (re-run the SQL).
- An error mentioning `permission denied` or a 401/403 → wrong key, or RLS/policies not set up.

If all three pass, the backend is sound and any remaining problem is in our code,
which is a much smaller thing to debug.

## 6. What the permissions actually mean

- The public key ships inside the site's JavaScript, so it's not a secret. It only
  says "this is an anonymous visitor". **What that visitor can do is decided
  entirely by the policies above.**
- With RLS on, the default is *deny*; each `create policy` grants exactly one
  action on one table.
- **Right now, anyone who finds your site can add, edit, and delete layers and
  files.** That's deliberate, to get things working without a login, and it's fine
  while the content is just test art. It's not a good long-term setup.
- Locking it down later (Phase 3), in increasing effort: keep the console off the
  public site and run it only on your own machine; or add Supabase Auth with a
  single account and change the write policies to `auth.role() = 'authenticated'`.
  We'll only do this once uploads work reliably.

## 7. What Phase 2 adds

- A **console page** to upload PNGs, set each layer's scale/order/on-off, and tweak
  depth, speed and density with a live preview (on phone: no preview, just the
  controls).
- The **viewer** reads from Supabase, falling back to the static manifest.
- Then, one at a time: iPhone sticker/cutout uploads, and phone-tilt parallax with a
  sensitivity slider.
