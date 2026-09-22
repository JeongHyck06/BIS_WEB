import { supabase } from './supabase';
import { slotKey } from './constants';
import type {
    AppData,
    Member,
    Period,
    SaveMemberPayload,
    SaveTeamPayload,
    ScheduleVersion,
    Session,
    Team,
    TimeSlot,
} from './types';

function throwIf(error: { message: string } | null, fallback: string): void {
    if (error) throw new Error(error.message || fallback);
}

export async function loadAll(): Promise<AppData> {
    const [
        sessionsRes,
        periodsRes,
        slotsRes,
        membersRes,
        msRes,
        mpsRes,
        availRes,
        teamsRes,
        tmRes,
        tsRes,
        verRes,
        verCountRes,
    ] = await Promise.all([
        supabase.from('sessions').select('*').order('sort_order'),
        supabase.from('periods').select('*').order('sort_order'),
        supabase.from('time_slots').select('*').order('slot_index'),
        supabase.from('members').select('*').order('name').order('nickname'),
        supabase.from('member_sessions').select('member_id, session_id'),
        supabase.from('member_period_status').select('member_id, period_id, status, updated_at'),
        supabase.from('member_availability').select('member_id, period_id, day, slot_index'),
        supabase.from('teams').select('*').order('name'),
        supabase.from('team_members').select('team_id, member_id'),
        supabase
            .from('team_schedule')
            .select('team_id, period_id, day, slot_index, override_note, updated_at'),
        supabase
            .from('schedule_versions')
            .select('*')
            .order('version_no', { ascending: false })
            .limit(1),
        supabase.from('schedule_versions').select('id', { count: 'exact', head: true }),
    ]);

    for (const r of [
        sessionsRes,
        periodsRes,
        slotsRes,
        membersRes,
        msRes,
        mpsRes,
        availRes,
        teamsRes,
        tmRes,
        tsRes,
        verRes,
        verCountRes,
    ]) {
        throwIf(r.error, '데이터를 불러오지 못했습니다.');
    }

    const sessions = (sessionsRes.data ?? []) as Session[];
    const slots = (slotsRes.data ?? []) as TimeSlot[];
    const periods: Period[] = ((periodsRes.data ?? []) as Omit<Period, 'slots'>[]).map((p) => ({
        ...p,
        active_days: [...(p.active_days ?? [])].sort((a, b) => a - b),
        slots: slots
            .filter((s) => s.period_id === p.id)
            .sort((a, b) => a.slot_index - b.slot_index),
    }));

    const members: Member[] = (
        (membersRes.data ?? []) as Omit<Member, 'session_ids' | 'periods'>[]
    ).map((m) => ({
        ...m,
        session_ids: [],
        periods: {},
    }));
    const byMember = new Map(members.map((m) => [m.id, m]));
    for (const row of msRes.data ?? [])
        byMember.get(row.member_id)?.session_ids.push(row.session_id);
    // 세션 정렬 순서 유지
    const sessionOrder = new Map(sessions.map((s, i) => [s.id, i]));
    for (const m of members)
        m.session_ids.sort((a, b) => (sessionOrder.get(a) ?? 0) - (sessionOrder.get(b) ?? 0));

    for (const m of members) {
        for (const p of periods)
            m.periods[p.id] = { status: 'not_entered', updated_at: null, slots: new Set() };
    }
    for (const row of mpsRes.data ?? []) {
        const entry = byMember.get(row.member_id)?.periods[row.period_id];
        if (entry) {
            entry.status = row.status;
            entry.updated_at = row.updated_at;
        }
    }
    for (const row of availRes.data ?? []) {
        byMember
            .get(row.member_id)
            ?.periods[row.period_id]?.slots.add(slotKey(row.day, row.slot_index));
    }

    const teams: Team[] = ((teamsRes.data ?? []) as Omit<Team, 'member_ids' | 'schedule'>[]).map(
        (t) => ({
            ...t,
            member_ids: [],
            schedule: {},
        }),
    );
    const byTeam = new Map(teams.map((t) => [t.id, t]));
    for (const t of teams) {
        for (const p of periods)
            t.schedule[p.id] = { day: null, slot_index: null, override_note: '', updated_at: null };
    }
    for (const row of tmRes.data ?? []) byTeam.get(row.team_id)?.member_ids.push(row.member_id);
    for (const row of tsRes.data ?? []) {
        const t = byTeam.get(row.team_id);
        if (t)
            t.schedule[row.period_id] = {
                day: row.day,
                slot_index: row.slot_index,
                override_note: row.override_note ?? '',
                updated_at: row.updated_at,
            };
    }
    // 팀원 이름순 정렬
    const memberIndex = new Map(members.map((m, i) => [m.id, i]));
    for (const t of teams)
        t.member_ids.sort((a, b) => (memberIndex.get(a) ?? 0) - (memberIndex.get(b) ?? 0));

    const confirmed = ((verRes.data ?? [])[0] as ScheduleVersion | undefined) ?? null;

    const confirmedCount = verCountRes.count ?? (confirmed ? 1 : 0);

    return { sessions, periods, members, teams, confirmed, confirmedCount };
}

export async function saveMember(payload: SaveMemberPayload): Promise<string> {
    const { data, error } = await supabase.rpc('save_member', { p: payload });
    throwIf(error, '부원 저장에 실패했습니다.');
    return data as string;
}

export async function deleteMember(id: string): Promise<void> {
    const { error } = await supabase.from('members').delete().eq('id', id);
    throwIf(error, '부원 삭제에 실패했습니다.');
}

export async function saveTeam(payload: SaveTeamPayload): Promise<string> {
    const { data, error } = await supabase.rpc('save_team', { p: payload });
    throwIf(error, '팀 저장에 실패했습니다.');
    return data as string;
}

export async function deleteTeam(id: string): Promise<void> {
    const { error } = await supabase.from('teams').delete().eq('id', id);
    throwIf(error, '팀 삭제에 실패했습니다.');
}

export async function confirmSchedule(note: string): Promise<ScheduleVersion> {
    const { data, error } = await supabase.rpc('confirm_schedule', { p_note: note });
    throwIf(error, '시간표 확정에 실패했습니다.');
    return data as ScheduleVersion;
}

/** 확정본 삭제. 최신 확정본을 지우면 이전 확정본이 현재 확정본이 된다. */
export async function deleteConfirmedVersion(id: string): Promise<void> {
    const { error } = await supabase.from('schedule_versions').delete().eq('id', id);
    throwIf(error, '확정본 삭제에 실패했습니다.');
}

export async function updatePeriod(
    id: string,
    patch: { start_date?: string | null; end_date?: string | null; active_days?: number[] },
): Promise<void> {
    const { error } = await supabase.from('periods').update(patch).eq('id', id);
    throwIf(error, '기간 설정 저장에 실패했습니다.');
}

export async function deleteSampleData(): Promise<void> {
    const { error } = await supabase.rpc('delete_sample_data');
    throwIf(error, '샘플 데이터 삭제에 실패했습니다.');
}

/** 샘플 데이터 삽입 (is_sample = true 로 실제 데이터와 구분) */
export async function insertSampleData(data: AppData): Promise<void> {
    const before = data.periods.find((p) => p.key === 'before');
    const after = data.periods.find((p) => p.key === 'after');
    if (!before || !after) throw new Error('기간 설정이 없습니다.');
    const sid = (code: string) => data.sessions.find((s) => s.code === code)?.id;
    const sess = (...codes: string[]) => codes.map(sid).filter((x): x is string => Boolean(x));
    const slots = (...keys: string[]) =>
        keys.map((k) => ({ day: Number(k[0]), slot_index: Number(k[1]) }));

    const samples: SaveMemberPayload[] = [
        {
            id: null,
            name: '김민수',
            nickname: '샘플',
            memo: '',
            is_sample: true,
            session_ids: sess('vocal'),
            availability: {
                [before.id]: { entered: true, slots: slots('01', '02', '21', '31', '32') },
                [after.id]: null,
            },
        },
        {
            id: null,
            name: '이지은',
            nickname: '샘플',
            memo: '',
            is_sample: true,
            session_ids: sess('guitar', 'vocal'),
            availability: {
                [before.id]: { entered: true, slots: slots('01', '11', '12', '41', '42') },
                [after.id]: { entered: true, slots: slots('01', '02', '04', '13', '53', '63') },
            },
        },
        {
            id: null,
            name: '박서준',
            nickname: '샘플',
            memo: '',
            is_sample: true,
            session_ids: sess('bass'),
            availability: {
                [before.id]: { entered: true, slots: slots('01', '02', '11', '31', '32', '41') },
                [after.id]: {
                    entered: true,
                    slots: slots('01', '02', '11', '13', '21', '23', '33', '34'),
                },
            },
        },
        {
            id: null,
            name: '최유진',
            nickname: '샘플',
            memo: '',
            is_sample: true,
            session_ids: sess('drum'),
            availability: {
                [before.id]: { entered: true, slots: slots('02', '12', '22', '32', '42') },
                [after.id]: {
                    entered: true,
                    slots: slots('04', '14', '24', '34', '44', '54', '64'),
                },
            },
        },
        {
            id: null,
            name: '정우성',
            nickname: '샘플 22학번',
            memo: '',
            is_sample: true,
            session_ids: sess('keyboard'),
            availability: {
                [before.id]: { entered: true, slots: slots('01', '21', '22', '31') },
                [after.id]: { entered: true, slots: slots('01', '11', '21', '31', '41') },
            },
        },
        {
            id: null,
            name: '정우성',
            nickname: '샘플 24학번',
            memo: '동명이인 구분용 샘플',
            is_sample: true,
            session_ids: sess('guitar'),
            availability: { [before.id]: { entered: true, slots: [] }, [after.id]: null },
        },
        {
            id: null,
            name: '한소희',
            nickname: '샘플',
            memo: '',
            is_sample: true,
            session_ids: sess('vocal', 'keyboard'),
            availability: {
                [before.id]: null,
                [after.id]: { entered: true, slots: slots('03', '13', '23', '33', '43', '53') },
            },
        },
    ];
    const ids: string[] = [];
    for (const s of samples) ids.push(await saveMember(s));

    await saveTeam({
        id: null,
        name: '샘플 팀 A',
        color: '#2563eb',
        memo: '샘플 곡 1 (보컬 김민수), 샘플 곡 2 (보컬 이지은)',
        is_sample: true,
        member_ids: [ids[0], ids[1], ids[2], ids[3]],
        schedule: {
            [before.id]: { day: 0, slot_index: 2, override_note: '' },
            [after.id]: { day: null, slot_index: null, override_note: '' },
        },
    });
    await saveTeam({
        id: null,
        name: '샘플 팀 B',
        color: '#059669',
        memo: '',
        is_sample: true,
        member_ids: [ids[4], ids[6], ids[2]],
        schedule: {
            [before.id]: { day: null, slot_index: null, override_note: '' },
            [after.id]: { day: 1, slot_index: 3, override_note: '' },
        },
    });
}
