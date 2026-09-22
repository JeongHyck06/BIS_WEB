import { DAY_LABELS, DAY_LABELS_FULL, slotKey } from './constants'
import type { AppData, Member, Period, ScheduleVersion, SnapshotTeam, Team, TimeSlot } from './types'

/** "18:00:00" -> "18시", "18:30:00" -> "18시 30분" */
export function hourText(t: string): string {
  const [h, m] = t.split(':').map(Number)
  return m ? `${h}시 ${m}분` : `${h}시`
}
/** "18시부터 20시" */
export const slotTime = (slot: { start_time: string; end_time: string }) =>
  `${hourText(slot.start_time)}부터 ${hourText(slot.end_time)}`
export const slotLabel = (slot: TimeSlot) => `${slot.label} ${slotTime(slot)}`
export const dayLabel = (day: number) => DAY_LABELS[day]
export const dayLabelFull = (day: number) => DAY_LABELS_FULL[day]

export function memberDisplayName(m: { name: string; nickname: string }): string {
  return m.nickname ? `${m.name} (${m.nickname})` : m.name
}

export function findSlot(period: Period, slotIndex: number | null): TimeSlot | undefined {
  if (slotIndex == null) return undefined
  return period.slots.find((s) => s.slot_index === slotIndex)
}

export function timeLabel(period: Period, day: number | null, slotIndex: number | null): string {
  if (day == null || slotIndex == null) return '미지정'
  const slot = findSlot(period, slotIndex)
  return `${dayLabel(day)} ${slot ? slot.label : `${slotIndex}타임`}`
}

export type AvailabilityState = 'available' | 'unavailable' | 'not_entered'

/** "18:00:00" -> 18, "24:00:00" -> 24 */
export const hourOf = (t: string) => Number(t.split(':')[0])

/** 타임에 포함되는 시각 목록 (예: 18시부터 20시 -> [18, 19]) */
export function slotHours(slot: { start_time: string; end_time: string }): number[] {
  const out: number[] = []
  for (let h = hourOf(slot.start_time); h < hourOf(slot.end_time); h++) out.push(h)
  return out
}

export type PeriodLike = { id: string; slots: { slot_index: number; start_time: string; end_time: string }[] }

/** 부원이 해당 타임의 모든 시간에 가능한지 */
export function memberAvailability(member: Member, period: PeriodLike, day: number, slotIndex: number): AvailabilityState {
  const entry = member.periods[period.id]
  if (!entry || entry.status !== 'entered') return 'not_entered'
  const slot = period.slots.find((s) => s.slot_index === slotIndex)
  if (!slot) return 'unavailable'
  const hours = slotHours(slot)
  if (hours.length === 0) return 'unavailable'
  return hours.every((h) => entry.hours.has(slotKey(day, h))) ? 'available' : 'unavailable'
}

/** 선택한 부원들이 모두 가능한 타임 (교집합). 미입력 부원은 어떤 시간에도 가능으로 보지 않는다. */
export function commonSlots(members: Member[], period: Period): Set<string> {
  const result = new Set<string>()
  if (members.length === 0) return result
  for (const day of period.active_days) {
    for (const slot of period.slots) {
      if (members.every((m) => memberAvailability(m, period, day, slot.slot_index) === 'available')) {
        result.add(slotKey(day, slot.slot_index))
      }
    }
  }
  return result
}

export interface TeamConflict {
  member: Member
  state: Exclude<AvailabilityState, 'available'>
  reason: string
}

/** 팀에 배정된 시간에 참석할 수 없는 부원 목록 */
export function teamConflicts(team: Team, period: Period, membersById: Map<string, Member>): TeamConflict[] {
  const s = team.schedule[period.id]
  if (!s || s.day == null || s.slot_index == null) return []
  const out: TeamConflict[] = []
  for (const id of team.member_ids) {
    const m = membersById.get(id)
    if (!m) continue
    const state = memberAvailability(m, period, s.day, s.slot_index)
    if (state === 'unavailable') out.push({ member: m, state, reason: '참석 불가로 등록됨' })
    else if (state === 'not_entered') out.push({ member: m, state, reason: `${period.name} 시간표 미입력` })
  }
  return out
}

export function snapshotTeam(confirmed: ScheduleVersion | null, teamId: string): SnapshotTeam | undefined {
  return confirmed?.snapshot.teams.find((t) => t.id === teamId)
}

/** 초안이 확정본과 동일한지 (팀원과 두 기간 시간) */
export function draftMatchesConfirmed(team: Team, confirmed: ScheduleVersion | null, periods: Period[]): boolean {
  const snap = snapshotTeam(confirmed, team.id)
  if (!snap) return false
  const snapIds = [...snap.members.map((m) => m.id)].sort()
  const ids = [...team.member_ids].sort()
  if (snapIds.length !== ids.length || snapIds.some((v, i) => v !== ids[i])) return false
  for (const p of periods) {
    const a = team.schedule[p.id]
    const b = snap.schedule[p.id]
    if ((a?.day ?? null) !== (b?.day ?? null) || (a?.slot_index ?? null) !== (b?.slot_index ?? null)) return false
  }
  return true
}

/** 확정 이후 가능 시간을 바꾼 팀원 목록 */
export function changedAfterConfirm(team: Team, confirmed: ScheduleVersion | null, membersById: Map<string, Member>): Member[] {
  const snap = snapshotTeam(confirmed, team.id)
  if (!snap || !confirmed) return []
  const at = new Date(confirmed.confirmed_at).getTime()
  const changed: Member[] = []
  for (const sm of snap.members) {
    const m = membersById.get(sm.id)
    if (!m) continue
    const touched = Object.values(m.periods).some((e) => e.updated_at && new Date(e.updated_at).getTime() > at)
    if (touched) changed.push(m)
  }
  return changed
}

export type AttentionKind =
  | 'member_not_entered'
  | 'team_time_missing'
  | 'team_conflict'
  | 'team_changed_after_confirm'
  | 'team_draft_differs'

export interface AttentionItem {
  kind: AttentionKind
  message: string
  memberId?: string
  teamId?: string
}

export function attentionItems(data: AppData): AttentionItem[] {
  const items: AttentionItem[] = []
  const membersById = new Map(data.members.map((m) => [m.id, m]))

  for (const m of data.members) {
    for (const p of data.periods) {
      if (m.periods[p.id]?.status !== 'entered') {
        items.push({
          kind: 'member_not_entered',
          memberId: m.id,
          message: `${memberDisplayName(m)} 님의 ${p.name} 시간표가 미입력 상태입니다.`,
        })
      }
    }
  }

  for (const t of data.teams) {
    for (const p of data.periods) {
      const s = t.schedule[p.id]
      if (!s || s.day == null || s.slot_index == null) {
        items.push({ kind: 'team_time_missing', teamId: t.id, message: `${t.name}의 ${p.name} 합주 시간이 아직 지정되지 않았습니다.` })
        continue
      }
      const slot = findSlot(p, s.slot_index)
      const when = `${p.name} ${dayLabelFull(s.day)} ${slot?.label ?? `${s.slot_index}타임`}`
      for (const c of teamConflicts(t, p, membersById)) {
        const msg =
          c.state === 'unavailable'
            ? `${t.name}의 ${when}에 ${memberDisplayName(c.member)} 님이 참석 불가로 등록되어 있습니다.`
            : `${t.name}의 ${when}에 ${memberDisplayName(c.member)} 님의 시간표가 미입력 상태입니다.`
        items.push({ kind: 'team_conflict', teamId: t.id, memberId: c.member.id, message: msg })
      }
    }
    if (data.confirmed) {
      const changed = changedAfterConfirm(t, data.confirmed, membersById)
      if (changed.length > 0) {
        items.push({
          kind: 'team_changed_after_confirm',
          teamId: t.id,
          message: `${t.name}의 부원 시간표가 확정 이후 변경되었습니다. 변경한 부원: ${changed.map(memberDisplayName).join(', ')}`,
        })
      }
      if (snapshotTeam(data.confirmed, t.id) && !draftMatchesConfirmed(t, data.confirmed, data.periods)) {
        items.push({ kind: 'team_draft_differs', teamId: t.id, message: `${t.name}의 초안이 확정본과 다릅니다. 확인 후 다시 확정해 주세요.` })
      }
    }
  }
  return items
}

export function pickTeamColor(teams: Team[], palette: string[]): string {
  const used = new Map<string, number>()
  for (const t of teams) used.set(t.color, (used.get(t.color) ?? 0) + 1)
  let best = palette[0]
  let bestCount = Infinity
  for (const c of palette) {
    const n = used.get(c) ?? 0
    if (n < bestCount) {
      best = c
      bestCount = n
    }
  }
  return best
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${pad(d.getHours())}시 ${pad(d.getMinutes())}분`
}

export function formatDate(iso: string | null): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  return `${y}년 ${m}월 ${d}일`
}
