import { useMemo, useState } from 'react'
import { confirmSchedule, deleteConfirmedVersion } from '../lib/api'
import { ALL_DAYS, DAY_LABELS } from '../lib/constants'
import { changedAfterConfirm, draftMatchesConfirmed, formatDate, formatDateTime, memberAvailability, memberDisplayName, slotTime, teamConflicts } from '../lib/logic'
import type { AppData, Member, Period, SnapshotPeriod, SnapshotTeam, Team } from '../lib/types'
import { SessionText, useToast } from './ui'

interface Props {
  data: AppData
  /** 어드민 로그인 시에만 팀 추가와 확정 조작 표시 */
  isAdmin: boolean
  onAddTeam: () => void
  onOpenTeam: (id: string) => void
  onConfirmed: () => Promise<void>
}

type View = 'draft' | 'confirmed'

/** 팀 색상의 옅은 배경 */
const tint = (hex: string) => `${hex}1f`

export function TeamScheduleSection({ data, isAdmin, onAddTeam, onOpenTeam, onConfirmed }: Props) {
  const toast = useToast()
  const [view, setView] = useState<View>('draft')
  const [note, setNote] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const membersById = useMemo(() => new Map(data.members.map((m) => [m.id, m])), [data.members])

  const pendingCount = data.teams.filter((t) => !draftMatchesConfirmed(t, data.confirmed, data.periods)).length
  const removedFromDraft = (data.confirmed?.snapshot.teams ?? []).filter((st) => !data.teams.some((t) => t.id === st.id))

  const confirm = async () => {
    if (data.teams.length === 0) { toast.show('확정할 팀이 없습니다.', 'error'); return }
    const missing = data.teams.flatMap((t) => data.periods.filter((p) => t.schedule[p.id]?.day == null).map((p) => `${t.name} ${p.name}`))
    const msg = [
      `현재 초안 전체를 확정본 ${(data.confirmed?.version_no ?? 0) + 1}판으로 저장할까요?`,
      missing.length ? `\n시간이 미지정인 항목: ${missing.join(', ')}` : '',
      '\n확정 후에도 초안은 계속 수정할 수 있으며, 다시 확정하기 전까지 확정본은 바뀌지 않습니다.',
    ].join('')
    if (!window.confirm(msg)) return
    setConfirming(true)
    try {
      const v = await confirmSchedule(note.trim())
      toast.show(`시간표를 확정했습니다. ${v.version_no}판`, 'success')
      setNote('')
      await onConfirmed()
      setView('confirmed')
    } catch (err) {
      toast.show(err instanceof Error ? `확정 실패: ${err.message}` : '확정에 실패했습니다.', 'error')
    } finally {
      setConfirming(false)
    }
  }

  const removeConfirmed = async () => {
    if (!data.confirmed) return
    const v = data.confirmed
    const after = data.confirmedCount > 1 ? '삭제하면 바로 이전 확정본이 현재 확정본이 됩니다.' : '삭제하면 확정된 시간표가 없는 상태로 돌아갑니다.'
    if (!window.confirm(`확정본 ${v.version_no}판을 삭제할까요?\n${after}\n초안은 그대로 남습니다.`)) return
    setDeleting(true)
    try {
      await deleteConfirmedVersion(v.id)
      toast.show(`확정본 ${v.version_no}판을 삭제했습니다.`, 'success')
      await onConfirmed()
    } catch (err) {
      toast.show(err instanceof Error ? `삭제 실패: ${err.message}` : '삭제에 실패했습니다.', 'error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <section className="section" id="schedule">
      <div className="section-head">
        <div>
          <h2>합주 시간표</h2>
          <p className="sub">운영자가 팀과 합주 시간을 직접 지정합니다. 초안을 확인한 뒤 확정하면 그 시점의 팀원과 시간이 보관됩니다.</p>
        </div>
        <div className="section-actions">
          <div className="tabs">
            <button type="button" className={`tab${view === 'draft' ? ' active' : ''}`} onClick={() => setView('draft')}>초안</button>
            <button type="button" className={`tab${view === 'confirmed' ? ' active' : ''}`} onClick={() => setView('confirmed')}>확정본{data.confirmed ? ` ${data.confirmed.version_no}판` : ''}</button>
          </div>
          {isAdmin && <button type="button" className="btn btn-primary" onClick={onAddTeam}>팀 추가하기</button>}
        </div>
      </div>

      {view === 'draft' ? (
        <>
          <div className="confirm-bar">
            <span>
              {data.confirmed
                ? <>현재 확정본 {data.confirmed.version_no}판, {formatDateTime(data.confirmed.confirmed_at)} 확정{data.confirmed.note && <span className="muted">, {data.confirmed.note}</span>}.</>
                : <>아직 확정된 시간표가 없습니다.</>}
              {pendingCount > 0 && <span className="status bad" style={{ marginLeft: 8 }}>확정본과 다른 팀 {pendingCount}개</span>}
              {removedFromDraft.length > 0 && <span className="status" style={{ marginLeft: 8 }}>초안에서 삭제된 팀 {removedFromDraft.length}개</span>}
            </span>
            {isAdmin && (
              <>
                <input className="input grow" placeholder="확정 메모, 예: 1차 확정" value={note} onChange={(e) => setNote(e.target.value)} />
                <button type="button" className="btn btn-primary" onClick={confirm} disabled={confirming || data.teams.length === 0}>{confirming ? '확정 중' : '시간표 확정하기'}</button>
              </>
            )}
          </div>
          {data.teams.length === 0 ? (
            <div className="empty">만든 팀이 없습니다.</div>
          ) : (
            <div className="schedule-grid">
              {data.periods.map((p) => <DraftTable key={p.id} period={p} data={data} membersById={membersById} onOpenTeam={onOpenTeam} />)}
            </div>
          )}
        </>
      ) : (
        <>
          {!data.confirmed ? (
            <div className="empty">아직 확정된 시간표가 없습니다.</div>
          ) : (
            <>
              <div className="confirm-bar">
                <span>확정본 {data.confirmed.version_no}판, {formatDateTime(data.confirmed.confirmed_at)} 확정{data.confirmed.note && <span className="muted">, {data.confirmed.note}</span>}.</span>
                <span className="muted grow">확정 당시의 팀원과 시간입니다. 이후 초안이 바뀌어도 이 표는 바뀌지 않습니다.{data.confirmedCount > 1 && ` 보관 중인 확정본 ${data.confirmedCount}개.`}</span>
                {isAdmin && <button type="button" className="btn btn-danger" onClick={removeConfirmed} disabled={deleting}>{deleting ? '삭제 중' : '확정본 삭제하기'}</button>}
              </div>
              <div className="schedule-grid">
                {data.confirmed.snapshot.periods.map((sp) => (
                  <ConfirmedTable key={sp.id} period={sp} teams={data.confirmed!.snapshot.teams} data={data} onOpenTeam={onOpenTeam} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {data.teams.length > 0 && (
        <div className="team-list">
          {data.teams.map((t) => (
            <button type="button" key={t.id} className="link" onClick={() => onOpenTeam(t.id)}>
              <span className="swatch" style={{ background: t.color }} />
              {t.name} <span className="muted">{t.member_ids.length}명</span>
              {t.is_sample && <span className="sample">샘플</span>}
            </button>
          ))}
        </div>
      )}
      <div className="legend-note">
        <span>확정: 확정본과 같음</span>
        <span>초안: 아직 확정되지 않았거나 확정본과 다름</span>
        <span>참석 불가: 붉은 이름은 그 시간에 불가하거나 미입력인 부원</span>
        <span>확인 필요: 확정 이후 부원의 가능 시간이 바뀜</span>
      </div>
    </section>
  )
}

function TableHead({ period }: { period: { name: string; start_date: string | null; end_date: string | null } }) {
  const range = period.start_date ? `${formatDate(period.start_date)}부터` : period.end_date ? `${formatDate(period.end_date)}까지` : ''
  return <h3>{period.name} {range && <span className="range">{range}</span>}</h3>
}

function HeaderRow({ activeDays }: { activeDays: number[] }) {
  return (
    <thead>
      <tr>
        <th className="slot-head" />
        {ALL_DAYS.map((d) => <th key={d} className={activeDays.includes(d) ? '' : 'day-inactive'}>{DAY_LABELS[d]}</th>)}
      </tr>
    </thead>
  )
}

function DraftTable({ period, data, membersById, onOpenTeam }: { period: Period; data: AppData; membersById: Map<string, Member>; onOpenTeam: (id: string) => void }) {
  const sessionsById = new Map(data.sessions.map((s) => [s.id, s]))
  const teamAt = (day: number, slotIndex: number): Team | undefined =>
    data.teams.find((t) => t.schedule[period.id]?.day === day && t.schedule[period.id]?.slot_index === slotIndex)

  return (
    <div className="schedule-period">
      <TableHead period={period} />
      <div className="table-wrap">
        <table className="grid-table schedule-table">
          <HeaderRow activeDays={period.active_days} />
          <tbody>
            {period.slots.map((slot) => (
              <tr key={slot.id}>
                <th className="slot-head">{slot.label}<span className="t">{slotTime(slot)}</span></th>
                {ALL_DAYS.map((d) => {
                  const active = period.active_days.includes(d)
                  const t = teamAt(d, slot.slot_index)
                  if (!t) return <td key={d} className={active ? '' : 'day-inactive'} />
                  const conflicts = teamConflicts(t, period, membersById)
                  const matches = draftMatchesConfirmed(t, data.confirmed, data.periods)
                  const changed = changedAfterConfirm(t, data.confirmed, membersById)
                  const s = t.schedule[period.id]
                  return (
                    <td key={d} className={active ? '' : 'day-inactive'}>
                      <button type="button" className="team-card" style={{ background: tint(t.color), borderLeftColor: t.color }} onClick={() => onOpenTeam(t.id)}>
                        <span className="name">{t.name}</span>
                        <span className="members">
                          {t.member_ids.map((id) => {
                            const m = membersById.get(id)
                            if (!m) return null
                            const bad = memberAvailability(m, period.id, d, slot.slot_index) !== 'available'
                            return (
                              <span key={id} className={`member${bad ? ' bad' : ''}`} title={bad ? '참석 불가 또는 미입력' : undefined}>
                                {memberDisplayName(m)}
                                <SessionText sessions={m.session_ids.map((x) => sessionsById.get(x)!).filter(Boolean)} />
                              </span>
                            )
                          })}
                        </span>
                        <span className="flags">
                          {matches ? <span className="ok">확정</span> : <span>초안</span>}
                          {conflicts.length > 0 && <span className="bad" title={conflicts.map((c) => `${memberDisplayName(c.member)}: ${c.reason}`).join('\n')}>참석 불가 {conflicts.length}명</span>}
                          {changed.length > 0 && <span className="bad">확인 필요</span>}
                          {s?.override_note && <span title={s.override_note}>예외 저장</span>}
                        </span>
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ConfirmedTable({ period, teams, data, onOpenTeam }: { period: SnapshotPeriod; teams: SnapshotTeam[]; data: AppData; onOpenTeam: (id: string) => void }) {
  const membersById = new Map(data.members.map((m) => [m.id, m]))
  const teamAt = (day: number, slotIndex: number) =>
    teams.find((t) => t.schedule[period.id]?.day === day && t.schedule[period.id]?.slot_index === slotIndex)
  return (
    <div className="schedule-period">
      <TableHead period={period} />
      <div className="table-wrap">
        <table className="grid-table schedule-table">
          <HeaderRow activeDays={period.active_days} />
          <tbody>
            {period.slots.map((slot) => (
              <tr key={slot.slot_index}>
                <th className="slot-head">{slot.label}<span className="t">{slotTime(slot)}</span></th>
                {ALL_DAYS.map((d) => {
                  const active = period.active_days.includes(d)
                  const t = teamAt(d, slot.slot_index)
                  if (!t) return <td key={d} className={active ? '' : 'day-inactive'} />
                  const liveTeam = data.teams.find((x) => x.id === t.id)
                  const changed = liveTeam ? changedAfterConfirm(liveTeam, data.confirmed, membersById) : []
                  const conflicts = t.members.filter((sm) => {
                    const m = membersById.get(sm.id)
                    return m ? memberAvailability(m, period.id, d, slot.slot_index) !== 'available' : false
                  })
                  return (
                    <td key={d} className={active ? '' : 'day-inactive'}>
                      <button type="button" className="team-card" style={{ background: tint(t.color), borderLeftColor: t.color }} onClick={() => liveTeam && onOpenTeam(t.id)} disabled={!liveTeam}>
                        <span className="name">{t.name}</span>
                        <span className="members">
                          {t.members.map((m) => (
                            <span key={m.id} className="member">
                              {memberDisplayName(m)}
                              <SessionText sessions={m.sessions.map((s) => ({ ...s, sort_order: 0 }))} />
                            </span>
                          ))}
                        </span>
                        <span className="flags">
                          <span className="ok">확정</span>
                          {conflicts.length > 0 && <span className="bad">참석 불가 {conflicts.length}명</span>}
                          {changed.length > 0 && <span className="bad">가능 시간 변경으로 확인 필요</span>}
                          {!liveTeam && <span>초안에서 삭제됨</span>}
                          {t.schedule[period.id]?.override_note && <span title={t.schedule[period.id].override_note}>예외 저장</span>}
                        </span>
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
