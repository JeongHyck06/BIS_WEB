export type PeriodKey = 'before' | 'after';

export interface Session {
    id: string;
    code: string;
    name: string;
    color: string;
    sort_order: number;
}

export interface TimeSlot {
    id: string;
    period_id: string;
    slot_index: number;
    label: string;
    start_time: string; // "18:00:00"
    end_time: string;
}

export interface Period {
    id: string;
    key: PeriodKey;
    name: string;
    start_date: string | null;
    end_date: string | null;
    active_days: number[];
    sort_order: number;
    slots: TimeSlot[];
}

export type EntryStatus = 'not_entered' | 'entered';

export interface PeriodEntry {
    status: EntryStatus;
    updated_at: string | null;
    /** "day-slot" 키 집합 */
    slots: Set<string>;
}

export interface Member {
    id: string;
    name: string;
    nickname: string;
    memo: string;
    is_sample: boolean;
    created_at: string;
    updated_at: string;
    session_ids: string[];
    /** period_id -> 입력 상태 및 가능 시간 */
    periods: Record<string, PeriodEntry>;
}

export interface TeamSlot {
    day: number | null;
    slot_index: number | null;
    override_note: string;
    updated_at: string | null;
}

export interface Team {
    id: string;
    name: string;
    color: string;
    memo: string;
    is_sample: boolean;
    created_at: string;
    updated_at: string;
    member_ids: string[];
    /** period_id -> 배정 시간 */
    schedule: Record<string, TeamSlot>;
}

export interface SnapshotSession {
    id: string;
    code: string;
    name: string;
    color: string;
}
export interface SnapshotMember {
    id: string;
    name: string;
    nickname: string;
    sessions: SnapshotSession[];
}
export interface SnapshotTeam {
    id: string;
    name: string;
    color: string;
    memo: string;
    members: SnapshotMember[];
    schedule: Record<
        string,
        { day: number | null; slot_index: number | null; override_note: string }
    >;
}
export interface SnapshotPeriod {
    id: string;
    key: PeriodKey;
    name: string;
    start_date: string | null;
    end_date: string | null;
    active_days: number[];
    slots: { slot_index: number; label: string; start_time: string; end_time: string }[];
}
export interface ScheduleVersion {
    id: string;
    version_no: number;
    note: string;
    confirmed_at: string;
    snapshot: { periods: SnapshotPeriod[]; teams: SnapshotTeam[] };
}

export interface AppData {
    sessions: Session[];
    periods: Period[];
    members: Member[];
    teams: Team[];
    confirmed: ScheduleVersion | null;
}

/** save_member RPC payload */
export interface SaveMemberPayload {
    id: string | null;
    name: string;
    nickname: string;
    memo: string;
    is_sample?: boolean;
    session_ids: string[];
    availability: Record<
        string,
        { entered: boolean; slots: { day: number; slot_index: number }[] } | null
    >;
}

/** save_team RPC payload */
export interface SaveTeamPayload {
    id: string | null;
    name: string;
    color: string;
    memo: string;
    is_sample?: boolean;
    member_ids: string[];
    schedule: Record<
        string,
        { day: number | null; slot_index: number | null; override_note: string }
    >;
}
