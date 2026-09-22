-- =============================================================
-- 부원 가능 시간을 1시간 단위(0시부터 23시)로 저장
-- 합주 타임(time_slots)은 운영자가 편집하며, 타임 가능 여부는
-- 타임에 포함된 모든 시간이 선택되어 있는지로 계산한다.
-- =============================================================

create table public.member_available_hours (
  member_id   uuid not null references public.members(id) on delete cascade,
  period_id   uuid not null references public.periods(id) on delete cascade,
  day         smallint not null check (day between 0 and 6),
  hour        smallint not null check (hour between 0 and 23),
  primary key (member_id, period_id, day, hour)
);

-- 기존 타임 단위 입력을 시간 단위로 풀어서 이동
insert into public.member_available_hours (member_id, period_id, day, hour)
select ma.member_id, ma.period_id, ma.day, h::smallint
from public.member_availability ma
join public.time_slots ts on ts.period_id = ma.period_id and ts.slot_index = ma.slot_index
cross join lateral generate_series(
  extract(hour from ts.start_time)::int,
  (case when ts.end_time = '00:00'::time then 24 else extract(hour from ts.end_time)::int end) - 1
) as h
on conflict do nothing;

drop table public.member_availability;

alter table public.member_available_hours enable row level security;
create policy "anon_select_member_available_hours" on public.member_available_hours for select to anon, authenticated using (true);
create policy "anon_insert_member_available_hours" on public.member_available_hours for insert to anon, authenticated with check (true);
create policy "anon_update_member_available_hours" on public.member_available_hours for update to anon, authenticated using (true) with check (true);
create policy "anon_delete_member_available_hours" on public.member_available_hours for delete to anon, authenticated using (true);
grant select, insert, update, delete on public.member_available_hours to anon, authenticated;

-- =============================================================
-- RPC: 부원 저장 (시간 단위)
-- availability: { "<period_id>": { "entered": true, "hours": [{"day":0,"hour":18}, ...] } | null }
-- =============================================================
create or replace function public.save_member(p jsonb)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
  v_period_id uuid;
  v_period jsonb;
  v_hour jsonb;
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

      delete from public.member_available_hours
       where member_id = v_id and period_id = v_period_id;

      if coalesce((v_period->>'entered')::boolean, false) then
        for v_hour in select * from jsonb_array_elements(coalesce(v_period->'hours', '[]'::jsonb))
        loop
          insert into public.member_available_hours (member_id, period_id, day, hour)
          values (v_id, v_period_id, (v_hour->>'day')::smallint, (v_hour->>'hour')::smallint)
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
-- RPC: 기간별 합주 타임 저장 (운영자 편집)
-- p_slots: [{"slot_index": 1 | null, "start_hour": 18, "end_hour": 20}, ...]
-- slot_index 가 null 이면 새 타임. 목록에 없는 기존 타임은 삭제되며
-- 그 타임에 배정된 팀 시간도 함께 지워진다(외래키 cascade).
-- 라벨은 시작 시각 순서대로 1타임, 2타임 ... 으로 다시 매긴다.
-- =============================================================
create or replace function public.save_time_slots(p_period_id uuid, p_slots jsonb)
returns void
language plpgsql
as $$
declare
  v_slot jsonb;
  v_idx smallint;
  v_start int;
  v_end int;
  v_next smallint;
  v_keep smallint[] := '{}';
  v_n int := 0;
  r record;
begin
  if p_slots is null or jsonb_array_length(p_slots) = 0 then
    raise exception '합주 타임은 최소 한 개 있어야 합니다.';
  end if;

  -- 검증: 시작 < 종료, 서로 겹치지 않음
  for v_slot in select * from jsonb_array_elements(p_slots) loop
    v_start := (v_slot->>'start_hour')::int;
    v_end := (v_slot->>'end_hour')::int;
    if v_start is null or v_end is null or v_start < 0 or v_end > 24 or v_start >= v_end then
      raise exception '타임의 시작 시각은 종료 시각보다 앞서야 합니다.';
    end if;
  end loop;
  if exists (
    select 1
      from jsonb_array_elements(p_slots) a
      cross join jsonb_array_elements(p_slots) b
     where a <> b
       and (a->>'start_hour')::int < (b->>'end_hour')::int
       and (b->>'start_hour')::int < (a->>'end_hour')::int
  ) then
    raise exception '타임끼리 시간이 겹칠 수 없습니다.';
  end if;

  select coalesce(max(slot_index), 0) into v_next from public.time_slots where period_id = p_period_id;

  for v_slot in select * from jsonb_array_elements(p_slots) loop
    v_start := (v_slot->>'start_hour')::int;
    v_end := (v_slot->>'end_hour')::int;
    v_idx := nullif(v_slot->>'slot_index', '')::smallint;
    if v_idx is null or not exists (select 1 from public.time_slots where period_id = p_period_id and slot_index = v_idx) then
      v_next := v_next + 1;
      v_idx := v_next;
      insert into public.time_slots (period_id, slot_index, label, start_time, end_time)
      values (p_period_id, v_idx, '타임', make_time(v_start, 0, 0), (case when v_end = 24 then '24:00'::time else make_time(v_end, 0, 0) end));
    else
      update public.time_slots
         set start_time = make_time(v_start, 0, 0),
             end_time = (case when v_end = 24 then '24:00'::time else make_time(v_end, 0, 0) end)
       where period_id = p_period_id and slot_index = v_idx;
    end if;
    v_keep := array_append(v_keep, v_idx);
  end loop;

  delete from public.time_slots where period_id = p_period_id and not (slot_index = any (v_keep));

  -- 시작 시각 순서로 라벨 재부여
  for r in select slot_index from public.time_slots where period_id = p_period_id order by start_time loop
    v_n := v_n + 1;
    update public.time_slots set label = v_n || '타임' where period_id = p_period_id and slot_index = r.slot_index;
  end loop;
end $$;

grant execute on function public.save_time_slots(uuid, jsonb) to anon, authenticated;
