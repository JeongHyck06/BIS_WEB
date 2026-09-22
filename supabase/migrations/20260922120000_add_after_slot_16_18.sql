-- =============================================================
-- 종강 후 타임에 16시부터 18시 추가
-- 변경 전: 1타임 14~16, 2타임 18~20, 3타임 20~22
-- 변경 후: 1타임 14~16, 2타임 16~18, 3타임 18~20, 4타임 20~22
-- 기존 입력(부원 가능 시간, 팀 배정)은 시간대 기준으로 유지되도록 번호를 옮긴다.
-- =============================================================

do $$
declare
  v_after uuid;
begin
  select id into v_after from public.periods where key = 'after';
  if v_after is null then
    raise exception '종강 후 기간이 없습니다.';
  end if;

  -- 이미 적용된 경우(4타임 존재) 건너뛴다.
  if exists (select 1 from public.time_slots where period_id = v_after and slot_index = 4) then
    return;
  end if;

  -- 4타임(20~22) 추가 후, 기존 3타임(20~22) 참조를 4타임으로 이동
  insert into public.time_slots (period_id, slot_index, label, start_time, end_time)
  values (v_after, 4, '4타임', '20:00', '22:00');

  update public.member_availability set slot_index = 4 where period_id = v_after and slot_index = 3;
  update public.team_schedule       set slot_index = 4 where period_id = v_after and slot_index = 3;

  -- 3타임을 18~20으로 바꾸고, 기존 2타임(18~20) 참조를 3타임으로 이동
  update public.time_slots set start_time = '18:00', end_time = '20:00' where period_id = v_after and slot_index = 3;

  update public.member_availability set slot_index = 3 where period_id = v_after and slot_index = 2;
  update public.team_schedule       set slot_index = 3 where period_id = v_after and slot_index = 2;

  -- 2타임을 16~18로 변경 (새로 생긴 빈 타임)
  update public.time_slots set start_time = '16:00', end_time = '18:00' where period_id = v_after and slot_index = 2;
end $$;
