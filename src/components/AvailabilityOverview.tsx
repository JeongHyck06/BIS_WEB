import { useMemo, useState } from 'react'
import { ALL_DAYS, DAY_LABELS, GRID_HOURS, slotKey } from '../lib/constants'
import { commonSlots, dayLabel, memberAvailability, memberDisplayName, slotTime } from '../lib/logic'
import type { AppData, Member, Period, Session } from '../lib/types'
import { AvailabilityGrid } from './AvailabilityGrid'
import { SessionText } from './ui'

interface Props {
  data: AppData
  onAddMember: () => void
  onOpenMember: (id: string) => void
}

type View = 'slots' | 'members'

export function AvailabilityOverview({ data, onAddMember, onOpenMember }: Props) {
  const [view, setView] = useState<View>('slots')
  const [periodId, setPeriodId] = useState<string>(data.periods[0]?.id ?? '')
  const [query, setQuery] = useState('')
  const [sessionFilter, setSessionFilter] = useState<string>('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [focusId, setFocusId] = useState<string>('')

  const period = data.periods.find((p) => p.id === periodId) ?? data.periods[0]
  const sessionsById = useMemo(() => new Map(data.sessions.map((s) => [s.id, s])), [data.sessions])
  const sessionsOf = (m: Member) => m.session_ids.map((id) => sessionsById.get(id)!).filter(Boolean)

  const filtered = useMemo(() => {
    const q = query.trim()
    return data.members.filter((m) =>
      (!q || m.name.includes(q) || m.nickname.includes(q)) &&
      (!sessionFilter || m.session_ids.includes(sessionFilter)),
    )
  }, [data.members, query, sessionFilter])

  const selectedMembers = useMemo(() => data.members.filter((m) => selected.has(m.id)), [data.members, selected])
  const common = useMemo(() => {
    const out: Record<string, Set<string>> = {}
    for (const p of data.periods) out[p.id] = selectedMembers.length >= 2 ? commonSlots(selectedMembers, p) : new Set()
    return out
  }, [selectedMembers, data.periods])

  const toggleSelect = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const stats = (p: Period) => {
    const entered = data.members.filter((m) => m.periods[p.id]?.status === 'entered').length
    return { entered, missing: data.members.length - entered }
  }

  const cellMembers = (day: number, slotIndex: number): Member[] =>
    filtered.filter((m) => memberAvailability(m, period, day, slotIndex) === 'available')

  const focusMember = data.members.find((m) => m.id === focusId) ?? filtered[0] ?? data.members[0] ?? null
  const hourRows = GRID_HOURS.map((h) => ({ key: h, label: `${h}시` }))

  if (!period) return null

  return (
    <section className="section" id="overview">
      <div className="section-head">
        <div>
          <h2>부원 시간표 등록 현황</h2>
          <p className="sub">타임별 보기는 그 타임의 모든 시간에 가능한 부원을, 부원별 보기는 한 사람이 입력한 시간을 보여줍니다.</p>
        </div>
        <div className="section-actions">
          <button type="button" className="btn btn-primary" onClick={onAddMember}>본인 일정 추가하기</button>
        </div>
      </div>

      <p className="summary">
        등록 부원 <b>{data.members.length}명</b>.{' '}
        {data.periods.map((p) => {
          const s = stats(p)
          return <span key={p.id}>{p.name} 입력 <b>{s.entered}명</b>, 미입력 <b>{s.missing}명</b>. </span>
        })}
      </p>

      {data.members.length === 0 ? (
        <div className="empty">등록된 일정이 없습니다.</div>
      ) : (
        <>
          <div className="toolbar">
            <div className="tabs">
              <button type="button" className={`tab${view === 'slots' ? ' active' : ''}`} onClick={() => setView('slots')}>타임별</button>
              <button type="button" className={`tab${view === 'members' ? ' active' : ''}`} onClick={() => setView('members')}>부원별</button>
            </div>
            {view === 'slots' && (
              <div className="tabs">
                {data.periods.map((p) => (
                  <button type="button" key={p.id} className={`tab${p.id === period.id ? ' active' : ''}`} onClick={() => setPeriodId(p.id)}>{p.name}</button>
                ))}
              </div>
            )}
            <input className="input" placeholder="이름 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
            <select className="select" value={sessionFilter} onChange={(e) => setSessionFilter(e.target.value)}>
              <option value="">모든 세션</option>
              {data.sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {(query || sessionFilter) && <button type="button" className="link" onClick={() => { setQuery(''); setSessionFilter('') }}>필터 지우기</button>}
          </div>

          {view === 'members' ? (
            <MemberView
              data={data}
              members={filtered}
              member={focusMember}
              onPick={setFocusId}
              onEdit={onOpenMember}
              hourRows={hourRows}
              sessionsOf={sessionsOf}
            />
          ) : (
            <>
              <div className="pick-panel">
                <div className="pick-panel-head">
                  <h3>공통 가능 시간 확인 <span className="sub">부원을 2명 이상 고르면 모두 가능한 타임이 표에서 강조됩니다. 팀을 추천하는 기능은 아닙니다.</span></h3>
                  {selected.size > 0 && <button type="button" className="link" onClick={() => setSelected(new Set())}>선택 해제 {selected.size}명</button>}
                </div>
                <div className="check-list">
                  {filtered.map((m) => (
                    <label key={m.id} className="check">
                      <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggleSelect(m.id)} />
                      <span>{memberDisplayName(m)}{m.is_sample && <span className="sample">샘플</span>}</span>
                      <SessionText sessions={sessionsOf(m)} className="sub" />
                    </label>
                  ))}
                  {filtered.length === 0 && <span className="muted small">조건에 맞는 부원이 없습니다.</span>}
                </div>
                {selectedMembers.length >= 2 && (
                  <div className="common-result">
                    <span>{selectedMembers.map(memberDisplayName).join(', ')} 님의 공통 가능 시간</span>
                    {data.periods.map((p) => {
                      const keys = [...common[p.id]].map((k) => k.split('-').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1])
                      const notEntered = selectedMembers.filter((m) => m.periods[p.id]?.status !== 'entered')
                      return (
                        <div key={p.id} className="line">
                          <span className="period">{p.name}</span>
                          {keys.length === 0
                            ? <span className="none">공통 가능 시간이 없습니다.</span>
                            : keys.map(([d, s]) => <span key={`${d}-${s}`} className="slot">{dayLabel(d)} {p.slots.find((x) => x.slot_index === s)?.label ?? `${s}타임`}</span>)}
                          {notEntered.length > 0 && <span className="muted small">미입력: {notEntered.map(memberDisplayName).join(', ')}</span>}
                        </div>
                      )
                    })}
                  </div>
                )}
                {selectedMembers.length === 1 && <p className="muted small mt8">한 명 더 고르면 공통 가능 시간을 확인할 수 있습니다.</p>}
              </div>

              <div className="table-wrap">
                <table className="grid-table">
                  <thead>
                    <tr>
                      <th className="slot-head">{period.name}</th>
                      {ALL_DAYS.map((d) => (
                        <th key={d} className={period.active_days.includes(d) ? '' : 'day-inactive'}>{DAY_LABELS[d]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {period.slots.map((slot) => (
                      <tr key={slot.id}>
                        <th className="slot-head">
                          {slot.label}
                          <span className="t">{slotTime(slot)}</span>
                        </th>
                        {ALL_DAYS.map((d) => {
                          const active = period.active_days.includes(d)
                          if (!active) return <td key={d} className="day-inactive" />
                          const ms = cellMembers(d, slot.slot_index)
                          const isCommon = common[period.id].has(slotKey(d, slot.slot_index))
                          return (
                            <td key={d} className={isCommon ? 'cell-common' : ''}>
                              {(ms.length > 0 || isCommon) && (
                                <div className="cell-count">
                                  <span>{ms.length}명</span>
                                  {isCommon && <span className="common">공통 가능</span>}
                                </div>
                              )}
                              {ms.length > 0 && (
                                <div className="name-list">
                                  {ms.map((m) => (
                                    <div key={m.id} className="name-row" style={{ background: `${sessionsOf(m)[0]?.color ?? '#888888'}1f` }}>
                                      <button type="button" className={`name${selected.has(m.id) ? ' selected' : ''}`} onClick={() => onOpenMember(m.id)}>{memberDisplayName(m)}</button>
                                      <SessionText sessions={sessionsOf(m)} />
                                    </div>
                                  ))}
                                </div>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}

function MemberView({ data, members, member, onPick, onEdit, hourRows, sessionsOf }: {
  data: AppData
  members: Member[]
  member: Member | null
  onPick: (id: string) => void
  onEdit: (id: string) => void
  hourRows: { key: number; label: string }[]
  sessionsOf: (m: Member) => Session[]
}) {
  if (!member) return <div className="empty">조건에 맞는 부원이 없습니다.</div>

  /** 기간별로 가능한 타임을 요일 순으로 정리 */
  const availableSlots = (p: Period) =>
    p.active_days.map((d) => ({
      day: d,
      slots: p.slots.filter((s) => memberAvailability(member, p, d, s.slot_index) === 'available'),
    }))

  return (
    <div className="member-view">
      <div className="member-view-side">
        <div className="member-list">
          {members.map((m) => (
            <button type="button" key={m.id} className={`member-item${m.id === member.id ? ' active' : ''}`} onClick={() => onPick(m.id)}>
              <span>{memberDisplayName(m)}{m.is_sample && <span className="sample">샘플</span>}</span>
              <span className="sub">
                {data.periods.map((p) => (m.periods[p.id]?.status === 'entered' ? `${p.name} 입력` : `${p.name} 미입력`)).join(', ')}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="member-view-main">
        <div className="member-view-head">
          <div>
            <h3>{memberDisplayName(member)}</h3>
            <p className="sub"><SessionText sessions={sessionsOf(member)} />{sessionsOf(member).length === 0 && '세션 없음'}{member.memo && <> . 메모: {member.memo}</>}</p>
          </div>
          <button type="button" className="btn" onClick={() => onEdit(member.id)}>일정 수정하기</button>
        </div>

        {data.periods.map((p) => {
          const e = member.periods[p.id]
          const entered = e?.status === 'entered'
          const rows = availableSlots(p)
          return (
            <div key={p.id} className="group">
              <div className="legend">
                {p.name}
                {entered
                  ? e.hours.size === 0
                    ? <span className="status bad">입력 완료, 가능한 시간 없음</span>
                    : <span className="status ok">입력 완료, {e.hours.size}시간</span>
                  : <span className="status">미입력</span>}
              </div>
              {entered ? (
                <>
                  <p className="small mb8">
                    가능한 타임:{' '}
                    {rows.every((r) => r.slots.length === 0)
                      ? <span className="status bad">없음</span>
                      : rows.filter((r) => r.slots.length > 0).map((r) => `${DAY_LABELS[r.day]} ${r.slots.map((s) => s.label).join(', ')}`).join(' / ')}
                  </p>
                  <AvailabilityGrid period={p} rows={hourRows} compact readOnly value={e.hours} />
                </>
              ) : (
                <p className="muted small">아직 {p.name} 일정을 입력하지 않았습니다.</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
