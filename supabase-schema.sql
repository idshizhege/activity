create table if not exists public.event_info (
  id bigint primary key,
  title text not null,
  category text not null default '',
  date text not null default '',
  start_time text not null default '',
  end_time text not null default '',
  location text not null default '',
  description text not null default '',
  updated_at timestamptz not null default now()
);

insert into public.event_info (id, title, category, date, start_time, end_time, location, description)
values (
  1,
  '五一回来一起聚一聚',
  '吃饭 / 小聚 / 续摊自由',
  '2025-05-05',
  '18:30',
  '22:30',
  '市中心商圈 · 地点待最终确认',
  '大家按自己的情况填写就行，能不能来、几点到、什么时候走、卡在哪一步都写清楚。右侧会自动汇总整体情况，方便群里快速决策。'
)
on conflict (id) do nothing;

create table if not exists public.participants (
  id bigint generated always as identity primary key,
  viewer_token text not null unique,
  name text not null,
  status text not null check (status in ('yes', 'maybe', 'no')),
  eta text not null default '',
  leave_at text not null default '',
  obstacle text not null default '',
  note text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.event_info enable row level security;
alter table public.participants enable row level security;

create policy "public read event info"
on public.event_info
for select
using (true);

create policy "public read participants"
on public.participants
for select
using (true);

create policy "public insert participants"
on public.participants
for insert
with check (true);

create policy "public update participants"
on public.participants
for update
using (true)
with check (true);

create policy "authenticated update event info"
on public.event_info
for update
using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');

create policy "authenticated insert event info"
on public.event_info
for insert
with check (auth.role() = 'authenticated');
