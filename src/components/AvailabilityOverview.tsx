import { useMemo, useState } from 'react'
import { ALL_DAYS, DAY_LABELS, slotKey } from '../lib/constants'
import { commonSlots, dayLabel, memberAvailability, memberDisplayName, slotTime } from '../lib/logic'
import type { AppData, Member, Period } from '../lib/types'
import { SessionText } from './ui'

interface Props {
  data: AppData
  onAddMember: () => void
  onOpenMember: (id: string) => void
}

export function AvailabilityOverview({ data, onAddMember, onOpenMember }: Props) {
  const [periodId, setPeriodId] = useState<string>(data.periods[0]?.id ?? '')
  const [query, setQuery] = useState('')
  const [sessionFilter, setSessionFilter] = useState<string>('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

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

  if (!period) return null

  return (
    <section className="section" id="overview">
      <div className="section-head">
        <div>
          <h2>부원 시간표 등록 현황</h2>
          <p className="sub">각 칸에는 그 타임의 모든 시간에 가능하다고 등록한 부원이 표시됩니다. 이름을 누르면 시간표를 수정할 수 있습니다.</p>
        </div>
        <div className="section-actions">
          <button type="button" className="btn btn-primary" onClick={onAddMember}>부원 추가하기</button>
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
        <div className="empty">등록된 부원이 없습니다.</div>
      ) : (
        <>
          <div className="toolbar">
            <div className="tabs">
              {data.periods.map((p) => (
                <button type="button" key={p.id} className={`tab${p.id === period.id ? ' active' : ''}`} onClick={() => setPeriodId(p.id)}>{p.name}</button>
              ))}
            </div>
            <input className="input" placeholder="이름 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
            <select className="select" value={sessionFilter} onChange={(e) => setSessionFilter(e.target.value)}>
              <option value="">모든 세션</option>
              {data.sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {(query || sessionFilter) && <button type="button" className="link" onClick={() => { setQuery(''); setSessionFilter('') }}>필터 지우기</button>}
          </div>

          <div className="pick-panel">
            <div className="pick-panel-head">
              <h3>공통 가능 시간 확인 <span className="sub">부원을 2명 이상 고르면 모두 가능한 시간이 표에서 강조됩니다. 팀을 추천하는 기능은 아닙니다.</span></h3>
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
                                <div key={m.id} className="name-row">
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
    </section>
  )
}
