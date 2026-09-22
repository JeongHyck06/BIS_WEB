-- =============================================================
-- BIS TeamUp: 밴드 동아리 합주 시간표
-- 초기 스키마, 제약, RPC, 익명 접근 정책
-- =============================================================

create extension if not exists "pgcrypto";

-- -------------------------------------------------------------
-- 세션 종류 (보컬, 기타, 베이스 ...)
-- -------------------------------------------------------------
create table public.sessions (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null unique,
  color       text not null default '#64748b',
  sort_order  int  not null default 0
);

-- -------------------------------------------------------------
-- 기간 (종강 전 / 종강 후) 및 기간별 합주 타임
-- -------------------------------------------------------------
create table public.periods (
  id           uuid primary key default gen_random_uuid(),
  key          text not null unique check (key in ('before', 'after')),
  name         text not null,
  start_date   date,
  end_date     date,
  active_days  smallint[] not null default '{0,1,2,3,4,5,6}', -- 0=월 ... 6=일
  sort_order   int not null default 0,
  updated_at   timestamptz not null default now(),
  constraint periods_active_days_range check (
    active_days <@ array[0,1,2,3,4,5,6]::smallint[]
  )
);

create table public.time_slots (
  id          uuid primary key default gen_random_uuid(),
  period_id   uuid not null references public.periods(id) on delete cascade,
  slot_index  smallint not null check (slot_index >= 1),
  label       text not null,
  start_time  time not null,
  end_time    time not null,
  unique (period_id, slot_index)
);

-- -------------------------------------------------------------
-- 부원
-- -------------------------------------------------------------
create table public.members (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  nickname    text not null default '',   -- 구분명/별명 (동명이인 구분용)
  memo        text not null default '',
  is_sample   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (name, nickname)
);

create table public.member_sessions (
  member_id   uuid not null references public.members(id) on delete cascade,
  session_id  uuid not null references public.sessions(id) on delete cascade,
  primary key (member_id, session_id)
);

-- 기간별 입력 상태: 행이 없거나 not_entered = 미입력, entered + 가능 시간 0개 = '가능한 시간 없음'
create table public.member_period_status (
  member_id   uuid not null references public.members(id) on delete cascade,
  period_id   uuid not null references public.periods(id) on delete cascade,
  status      text not null default 'not_entered' check (status in ('not_entered', 'entered')),
  updated_at  timestamptz not null default now(),
  primary key (member_id, period_id)
);

create table public.member_availability (
  member_id   uuid not null references public.members(id) on delete cascade,
  period_id   uuid not null references public.periods(id) on delete cascade,
  day         smallint not null check (day between 0 and 6),
  slot_index  smallint not null,
  primary key (member_id, period_id, day, slot_index),
  foreign key (period_id, slot_index) references public.time_slots(period_id, slot_index) on delete cascade
);

-- -------------------------------------------------------------
-- 팀
-- -------------------------------------------------------------
create table public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (length(trim(name)) > 0),
  color       text not null default '#2563eb',
  memo        text not null default '',
  is_sample   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.team_members (
  team_id     uuid not null references public.teams(id) on delete cascade,
  member_id   uuid not null references public.members(id) on delete cascade,
  primary key (team_id, member_id)
);

-- 팀별 기간별 합주 시간 (초안). day/slot_index 가 null 이면 미지정.
create table public.team_schedule (
  team_id          uuid not null references public.teams(id) on delete cascade,
  period_id        uuid not null references public.periods(id) on delete cascade,
  day              smallint check (day between 0 and 6),
  slot_index       smallint,
  override_note    text not null default '', -- 참석 불가 부원이 있어도 예외로 저장한 사유
  updated_at       timestamptz not null default now(),
  primary key (team_id, period_id),
  foreign key (period_id, slot_index) references public.time_slots(period_id, slot_index) on delete cascade,
  constraint team_schedule_both_or_none check ((day is null) = (slot_index is null))
);

-- 합주실 1개 가정: 같은 기간의 동일 요일·타임에 두 팀 배정 금지
create unique index team_schedule_unique_slot
  on public.team_schedule (period_id, day, slot_index)
  where day is not null;

-- -------------------------------------------------------------
-- 확정 시간표 버전 (스냅샷)
-- -------------------------------------------------------------
create table public.schedule_versions (
  id            uuid primary key default gen_random_uuid(),
  version_no    int not null unique,
  note          text not null default '',
  confirmed_at  timestamptz not null default now(),
  snapshot      jsonb not null
);

-- -------------------------------------------------------------
-- updated_at 자동 갱신
-- -------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger members_set_updated_at before update on public.members
  for each row execute function public.set_updated_at();
create trigger teams_set_updated_at before update on public.teams
  for each row execute function public.set_updated_at();
create trigger periods_set_updated_at before update on public.periods
  for each row execute function public.set_updated_at();
create trigger team_schedule_set_updated_at before update on public.team_schedule
  for each row execute function public.set_updated_at();

-- =============================================================
-- RPC: 부원 저장 (부원 + 세션 + 두 기간 가능 시간을 한 트랜잭션으로)
-- payload 예시:
-- {
--   "id": null | uuid,
--   "name": "김민수", "nickname": "", "memo": "",
--   "session_ids": ["..."],
--   "availability": {
--     "<period_id>": { "entered": true, "slots": [{"day":0,"slot_index":1}, ...] } | null
--   }
-- }
-- availability 에 기간이 없거나 null 이면 해당 기간은 건드리지 않음.
-- =============================================================
create or replace function public.save_member(p jsonb)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
  v_period_id uuid;
  v_period jsonb;
  v_slot jsonb;
begin
  if p->>'id' is null then
    insert into public.members (name, nickname, memo, is_sample)
    values (trim(p->>'name'), coalesce(trim(p->>'nickname'), ''), coalesce(p->>'memo', ''), coalesce((p->>'is_sample')::boolean, false))
    returning id into v_id;
  else
    v_id := (p->>'id')::uuid;
    update public.members
       set name = trim(p->>'name'),
           nickname = coalesce(trim(p->>'nickname'), ''),
           memo = coalesce(p->>'memo', '')
     where id = v_id;
    if not found then
      raise exception '부원을 찾을 수 없습니다.' using errcode = 'P0002';
    end if;
  end if;

  if p ? 'session_ids' then
    delete from public.member_sessions where member_id = v_id;
    insert into public.member_sessions (member_id, session_id)
    select v_id, (s)::uuid from jsonb_array_elements_text(p->'session_ids') as s;
  end if;

  if p ? 'availability' then
    for v_period_id, v_period in
      select key::uuid, value from jsonb_each(p->'availability')
    loop
      if v_period is null or jsonb_typeof(v_period) = 'null' then
        continue;
      end if;

      delete from public.member_availability
       where member_id = v_id and period_id = v_period_id;

      if coalesce((v_period->>'entered')::boolean, false) then
        for v_slot in select * from jsonb_array_elements(coalesce(v_period->'slots', '[]'::jsonb))
        loop
          insert into public.member_availability (member_id, period_id, day, slot_index)
          values (v_id, v_period_id, (v_slot->>'day')::smallint, (v_slot->>'slot_index')::smallint)
          on conflict do nothing;
        end loop;
        insert into public.member_period_status (member_id, period_id, status, updated_at)
        values (v_id, v_period_id, 'entered', now())
        on conflict (member_id, period_id)
          do update set status = 'entered', updated_at = now();
      else
        insert into public.member_period_status (member_id, period_id, status, updated_at)
        values (v_id, v_period_id, 'not_entered', now())
        on conflict (member_id, period_id)
          do update set status = 'not_entered', updated_at = now();
      end if;
    end loop;
  end if;

  return v_id;
end $$;

-- =============================================================
-- RPC: 팀 저장 (팀 + 팀원 + 기간별 시간을 한 트랜잭션으로)
-- payload 예시:
-- {
--   "id": null | uuid, "name": "팀 A", "color": "#...", "memo": "",
--   "member_ids": ["..."],
--   "schedule": { "<period_id>": {"day": 3, "slot_index": 2, "override_note": ""} | {"day": null, "slot_index": null} }
-- }
-- =============================================================
create or replace function public.save_team(p jsonb)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
  v_period_id uuid;
  v_sched jsonb;
  v_day smallint;
  v_slot smallint;
  v_other text;
begin
  if p->>'id' is null then
    insert into public.teams (name, color, memo, is_sample)
    values (trim(p->>'name'), coalesce(p->>'color', '#2563eb'), coalesce(p->>'memo', ''), coalesce((p->>'is_sample')::boolean, false))
    returning id into v_id;
  else
    v_id := (p->>'id')::uuid;
    update public.teams
       set name = trim(p->>'name'),
           color = coalesce(p->>'color', color),
           memo = coalesce(p->>'memo', '')
     where id = v_id;
    if not found then
      raise exception '팀을 찾을 수 없습니다.' using errcode = 'P0002';
    end if;
  end if;

  if p ? 'member_ids' then
    delete from public.team_members where team_id = v_id;
    insert into public.team_members (team_id, member_id)
    select v_id, (m)::uuid from jsonb_array_elements_text(p->'member_ids') as m
    on conflict do nothing;
  end if;

  if p ? 'schedule' then
    for v_period_id, v_sched in
      select key::uuid, value from jsonb_each(p->'schedule')
    loop
      v_day := nullif(v_sched->>'day', '')::smallint;
      v_slot := nullif(v_sched->>'slot_index', '')::smallint;

      -- 친절한 오류 메시지를 위해 미리 검사 (유니크 인덱스가 최종 보증)
      if v_day is not null then
        select t.name into v_other
          from public.team_schedule ts
          join public.teams t on t.id = ts.team_id
         where ts.period_id = v_period_id and ts.day = v_day and ts.slot_index = v_slot
           and ts.team_id <> v_id
         limit 1;
        if v_other is not null then
          raise exception '해당 시간에는 이미 "%" 팀이 배정되어 있습니다.', v_other using errcode = '23505';
        end if;
      end if;

      insert into public.team_schedule (team_id, period_id, day, slot_index, override_note)
      values (v_id, v_period_id, v_day, v_slot, coalesce(v_sched->>'override_note', ''))
      on conflict (team_id, period_id)
        do update set day = excluded.day,
                      slot_index = excluded.slot_index,
                      override_note = excluded.override_note,
                      updated_at = now();
    end loop;
  end if;

  return v_id;
end $$;

-- =============================================================
-- RPC: 시간표 확정 (현재 초안 전체를 스냅샷으로 원자적으로 저장)
-- =============================================================
create or replace function public.confirm_schedule(p_note text default '')
returns jsonb
language plpgsql
as $$
declare
  v_version int;
  v_snapshot jsonb;
  v_row public.schedule_versions;
begin
  -- 동시 확정 방지
  lock table public.schedule_versions in exclusive mode;

  select coalesce(max(version_no), 0) + 1 into v_version from public.schedule_versions;

  select jsonb_build_object(
    'periods', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', pr.id, 'key', pr.key, 'name', pr.name,
        'start_date', pr.start_date, 'end_date', pr.end_date,
        'active_days', to_jsonb(pr.active_days),
        'slots', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'slot_index', ts.slot_index, 'label', ts.label,
            'start_time', ts.start_time, 'end_time', ts.end_time
          ) order by ts.slot_index), '[]'::jsonb)
          from public.time_slots ts where ts.period_id = pr.id
        )
      ) order by pr.sort_order), '[]'::jsonb)
      from public.periods pr
    ),
    'teams', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'color', t.color, 'memo', t.memo,
        'members', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', m.id, 'name', m.name, 'nickname', m.nickname,
            'sessions', (
              select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name, 'color', s.color) order by s.sort_order), '[]'::jsonb)
              from public.member_sessions ms join public.sessions s on s.id = ms.session_id
              where ms.member_id = m.id
            )
          ) order by m.name), '[]'::jsonb)
          from public.team_members tm join public.members m on m.id = tm.member_id
          where tm.team_id = t.id
        ),
        'schedule', (
          select coalesce(jsonb_object_agg(ts.period_id, jsonb_build_object(
            'day', ts.day, 'slot_index', ts.slot_index, 'override_note', ts.override_note
          )), '{}'::jsonb)
          from public.team_schedule ts where ts.team_id = t.id
        )
      ) order by t.name), '[]'::jsonb)
      from public.teams t
    )
  ) into v_snapshot;

  insert into public.schedule_versions (version_no, note, snapshot)
  values (v_version, coalesce(p_note, ''), v_snapshot)
  returning * into v_row;

  return to_jsonb(v_row);
end $$;

-- =============================================================
-- RPC: 샘플 데이터 삭제 (is_sample = true 인 부원/팀만)
-- =============================================================
create or replace function public.delete_sample_data()
returns void
language plpgsql
as $$
begin
  delete from public.teams where is_sample = true;
  delete from public.members where is_sample = true;
end $$;

-- =============================================================
-- 익명 접근 정책 (로그인 없이 사용하는 구조)
-- 주의: anon 키로 누구나 읽고 쓸 수 있습니다. 동아리 내부용 도구를 전제로 합니다.
-- =============================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'sessions', 'periods', 'time_slots', 'members', 'member_sessions',
    'member_period_status', 'member_availability', 'teams', 'team_members',
    'team_schedule', 'schedule_versions'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "anon_select_%s" on public.%I for select to anon, authenticated using (true)', t, t);
    execute format('create policy "anon_insert_%s" on public.%I for insert to anon, authenticated with check (true)', t, t);
    execute format('create policy "anon_update_%s" on public.%I for update to anon, authenticated using (true) with check (true)', t, t);
    execute format('create policy "anon_delete_%s" on public.%I for delete to anon, authenticated using (true)', t, t);
  end loop;
end $$;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant execute on function public.save_member(jsonb) to anon, authenticated;
grant execute on function public.save_team(jsonb) to anon, authenticated;
grant execute on function public.confirm_schedule(text) to anon, authenticated;
grant execute on function public.delete_sample_data() to anon, authenticated;

-- =============================================================
-- 기본 데이터: 세션, 기간, 타임
-- =============================================================
insert into public.sessions (code, name, color, sort_order) values
  ('vocal',    '보컬',   '#db2777', 1),
  ('guitar',   '기타',   '#d97706', 2),
  ('bass',     '베이스', '#059669', 3),
  ('drum',     '드럼',   '#7c3aed', 4),
  ('keyboard', '키보드', '#2563eb', 5);

insert into public.periods (key, name, start_date, end_date, active_days, sort_order) values
  ('before', '종강 전', null,         '2026-12-19', '{0,1,2,3,4}',     1),
  ('after',  '종강 후', '2026-12-20', null,         '{0,1,2,3,4,5,6}', 2);

insert into public.time_slots (period_id, slot_index, label, start_time, end_time)
select p.id, s.idx, s.label, s.st, s.et
from public.periods p
join (values
  ('before', 1, '1타임', '18:00'::time, '20:00'::time),
  ('before', 2, '2타임', '20:00'::time, '22:00'::time),
  ('after',  1, '1타임', '14:00'::time, '16:00'::time),
  ('after',  2, '2타임', '18:00'::time, '20:00'::time),
  ('after',  3, '3타임', '20:00'::time, '22:00'::time)
) as s(key, idx, label, st, et) on s.key = p.key;
