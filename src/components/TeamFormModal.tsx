import { useMemo, useState } from 'react'
import { deleteTeam, saveTeam } from '../lib/api'
import { TEAM_COLORS, slotKey } from '../lib/constants'
import { commonSlots, dayLabel, draftMatchesConfirmed, memberAvailability, memberDisplayName, pickTeamColor, snapshotTeam, timeLabel } from '../lib/logic'
import type { AppData, Member, Period } from '../lib/types'
import { AvailabilityGrid } from './AvailabilityGrid'
import { Modal, Notice, SessionText, useToast } from './ui'

interface Props {
  data: AppData
  teamId: string | null
  onClose: () => void
  onSaved: () => Promise<void>
  /** 어드민이 아니면 조회만 가능 */
  readOnly?: boolean
}

interface SlotDraft { key: string | null; override_note: string }

export function TeamFormModal({ data, teamId, onClose, onSaved, readOnly = false }: Props) {
  const toast = useToast()
  const team = useMemo(() => data.teams.find((t) => t.id === teamId) ?? null, [data.teams, teamId])

  const [name, setName] = useState(() => team?.name ?? '')
  const [color, setColor] = useState(() => team?.color ?? pickTeamColor(data.teams, TEAM_COLORS))
  const [memo, setMemo] = useState(() => team?.memo ?? '')
  const [memberIds, setMemberIds] = useState<string[]>(() => team?.member_ids ?? [])
  const [slots, setSlots] = useState<Record<string, SlotDraft>>(() => {
    const s: Record<string, SlotDraft> = {}
    for (const p of data.periods) {
      const cur = team?.schedule[p.id]
      s[p.id] = { key: cur && cur.day != null && cur.slot_index != null ? slotKey(cur.day, cur.slot_index) : null, override_note: cur?.override_note ?? '' }
    }
    return s
  })
  const [ack, setAck] = useState(false)
  const [memberQuery, setMemberQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saveError, setSaveError] = useState<string | null>(null)

  const membersById = useMemo(() => new Map(data.members.map((m) => [m.id, m])), [data.members])
  const sessionsById = useMemo(() => new Map(data.sessions.map((s) => [s.id, s])), [data.sessions])
  const sessionsOf = (m: Member) => m.session_ids.map((id) => sessionsById.get(id)!).filter(Boolean)
  const selectedMembers = useMemo(() => memberIds.map((id) => membersById.get(id)).filter((m): m is Member => Boolean(m)), [memberIds, membersById])

  const otherTeamsOf = (memberId: string) => data.teams.filter((t) => t.id !== teamId && t.member_ids.includes(memberId))

  const filteredMembers = useMemo(() => {
    const q = memberQuery.trim()
    return data.members.filter((m) => !q || m.name.includes(q) || m.nickname.includes(q))
  }, [data.members, memberQuery])

  const common = useMemo(() => {
    const out: Record<string, Set<string>> = {}
    for (const p of data.periods) out[p.id] = selectedMembers.length > 0 ? commonSlots(selectedMembers, p) : new Set()
    return out
  }, [selectedMembers, data.periods])

  /** 기간별로 다른 팀이 이미 차지한 시간 */
  const takenBy = useMemo(() => {
    const out: Record<string, Map<string, string>> = {}
    for (const p of data.periods) {
      const map = new Map<string, string>()
      for (const t of data.teams) {
        if (t.id === teamId) continue
        const s = t.schedule[p.id]
        if (s && s.day != null && s.slot_index != null) map.set(slotKey(s.day, s.slot_index), t.name)
      }
      out[p.id] = map
    }
    return out
  }, [data.teams, data.periods, teamId])

  const conflictsFor = (p: Period) => {
    const key = slots[p.id]?.key
    if (!key) return []
    const [day, slot_index] = key.split('-').map(Number)
    return selectedMembers
      .map((m) => ({ member: m, state: memberAvailability(m, p.id, day, slot_index) }))
      .filter((x) => x.state !== 'available')
  }
  const anyConflict = data.periods.some((p) => conflictsFor(p).length > 0)

  const validate = () => {
    const e: Record<string, string> = {}
    if (!name.trim()) e.name = '팀 이름을 입력해 주세요.'
    if (data.teams.some((t) => t.id !== teamId && t.name === name.trim())) e.name = '같은 이름의 팀이 이미 있습니다.'
    if (anyConflict && !ack) e.ack = '참석할 수 없는 부원이 있습니다. 확인 후 예외로 저장하려면 체크해 주세요.'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const submit = async () => {
    if (!validate()) return
    setSaving(true)
    setSaveError(null)
    try {
      const schedule: Record<string, { day: number | null; slot_index: number | null; override_note: string }> = {}
      for (const p of data.periods) {
        const s = slots[p.id]
        if (s?.key) {
          const [day, slot_index] = s.key.split('-').map(Number)
          schedule[p.id] = { day, slot_index, override_note: conflictsFor(p).length > 0 ? s.override_note : '' }
        } else schedule[p.id] = { day: null, slot_index: null, override_note: '' }
      }
      await saveTeam({ id: teamId, name: name.trim(), color, memo, member_ids: memberIds, schedule })
      toast.show(teamId ? '팀을 저장했습니다.' : '팀을 초안으로 추가했습니다.', 'success')
      await onSaved()
      onClose()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!team) return
    if (!window.confirm(`${team.name} 팀을 삭제할까요? 확정본 스냅샷에는 남지만 초안에서는 사라집니다.`)) return
    setSaving(true)
    try {
      await deleteTeam(team.id)
      toast.show('팀을 삭제했습니다.', 'success')
      await onSaved()
      onClose()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '삭제에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const confirmedSnap = team ? snapshotTeam(data.confirmed, team.id) : undefined
  const matches = team ? draftMatchesConfirmed(team, data.confirmed, data.periods) : false

  return (
    <Modal
      wide
      title={readOnly ? `팀 정보: ${team?.name ?? ''}` : team ? `팀 수정: ${team.name}` : '팀 추가'}
      onClose={onClose}
      footer={
        readOnly ? (
          <div className="right">
            <button type="button" className="btn" onClick={onClose}>닫기</button>
          </div>
        ) : (
          <>
            {team && <button type="button" className="btn btn-danger" onClick={remove} disabled={saving}>삭제하기</button>}
            <div className="right">
              <button type="button" className="btn" onClick={onClose} disabled={saving}>취소</button>
              <button type="button" className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? '저장 중' : '초안 저장하기'}</button>
            </div>
          </>
        )
      }
    >
      <fieldset className="plain-fieldset" disabled={readOnly}>
      {readOnly && <p className="small muted mb12">조회 전용입니다. 팀을 수정하려면 어드민 로그인이 필요합니다.</p>}
      {team && (
        <p className="small mb12">
          {team.is_sample && <span className="sample" style={{ marginLeft: 0, marginRight: 6 }}>샘플</span>}
          {confirmedSnap
            ? matches
              ? <span className="status ok">확정본 {data.confirmed?.version_no}판과 동일합니다.</span>
              : <span className="status bad">초안이 확정본 {data.confirmed?.version_no}판과 다릅니다.</span>
            : <span className="status">아직 확정된 적 없는 초안입니다.</span>}
          {!readOnly && <> <span className="muted">초안을 저장해도 확정본은 바뀌지 않습니다. 합주 시간표에서 확정하기를 눌러야 반영됩니다.</span></>}
        </p>
      )}
      {saveError && <div className="mb12"><Notice kind="danger">저장 실패: {saveError}</Notice></div>}

      <div className="row row-2">
        <div className="field">
          <label>팀 이름</label>
          <input className={`input${errors.name ? ' invalid' : ''}`} value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 팀 A" />
          {errors.name && <span className="error">{errors.name}</span>}
        </div>
        <div className="field">
          <label>팀 색상 <span className="muted" style={{ fontWeight: 400 }}>두 기간 시간표에서 같은 색으로 표시됩니다</span></label>
          <div className="color-picks">
            {TEAM_COLORS.map((c) => (
              <button type="button" key={c} className={`color-pick${c === color ? ' on' : ''}`} onClick={() => setColor(c)} title={c} aria-label={`색상 ${c}`} style={{ background: c }} />
            ))}
          </div>
        </div>
      </div>

      <div className="group">
        <div className="legend">
          소속 부원 <span className="status strong">{memberIds.length}명</span>
          <span className="status">세션별 인원 제한은 없습니다. 다른 팀 소속 여부는 표시만 하고 막지 않습니다.</span>
        </div>
        {!readOnly && <input className="input mb8" placeholder="이름으로 찾기" value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} />}
        {data.members.length === 0 && <p className="muted small">등록된 부원이 없습니다. 먼저 부원을 추가해 주세요.</p>}
        <div className="check-list">
          {(readOnly ? selectedMembers : filteredMembers).map((m) => {
            const on = memberIds.includes(m.id)
            const others = otherTeamsOf(m.id)
            return (
              <label key={m.id} className="check">
                <input type="checkbox" checked={on} onChange={(e) => setMemberIds((prev) => (e.target.checked ? [...prev, m.id] : prev.filter((x) => x !== m.id)))} />
                <span>{memberDisplayName(m)}</span>
                <SessionText sessions={sessionsOf(m)} className="sub" />
                {others.length > 0 && <span className="sub">다른 팀: {others.map((t) => t.name).join(', ')}</span>}
              </label>
            )
          })}
        </div>
      </div>

      {data.periods.map((p) => {
        const s = slots[p.id]
        if (!s) return null
        const conflicts = conflictsFor(p)
        const commonKeys = [...common[p.id]].map((k) => k.split('-').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1])
        const cur = s.key ? s.key.split('-').map(Number) : null
        return (
          <div key={p.id} className="group">
            <div className="legend">
              {p.name} 합주 시간
              {cur ? <span className="status strong">{timeLabel(p, cur[0], cur[1])}</span> : <span className="status">미지정. 초안으로 저장할 수 있습니다.</span>}
              {s.key && !readOnly && <button type="button" className="link small" onClick={() => setSlots((prev) => ({ ...prev, [p.id]: { ...prev[p.id], key: null } }))}>시간 해제</button>}
            </div>
            {selectedMembers.length > 0 && (
              <p className="small mb8">
                팀원 전원이 가능한 시간:{' '}
                {commonKeys.length === 0
                  ? <span className="status bad">없음</span>
                  : commonKeys.map(([d, si]) => `${dayLabel(d)} ${p.slots.find((x) => x.slot_index === si)?.label}`).join(', ')}
              </p>
            )}
            <AvailabilityGrid
              period={p}
              single
              readOnly={readOnly}
              value={s.key ? new Set([s.key]) : new Set()}
              onChange={(next) => setSlots((prev) => ({ ...prev, [p.id]: { ...prev[p.id], key: [...next][0] ?? null } }))}
              highlight={common[p.id]}
              decorate={(day, slotIndex) => {
                const key = slotKey(day, slotIndex)
                const other = takenBy[p.id].get(key)
                if (other) return { className: 'taken', disabled: true, title: `${other} 배정됨`, content: <span className="sub">{other}</span> }
                if (selectedMembers.length === 0) return undefined
                const ok = selectedMembers.filter((m) => memberAvailability(m, p.id, day, slotIndex) === 'available').length
                const isPicked = s.key === key
                const cls = isPicked && ok < selectedMembers.length ? 'conflict' : undefined
                return { className: cls, content: <span className="sub">{ok}명</span>, title: `팀원 ${selectedMembers.length}명 중 ${ok}명 가능` }
              }}
            />
            <p className="muted small mt8">칸의 숫자는 팀원 중 가능한 인원입니다. 옅은 파란 칸은 팀원 전원이 가능한 시간, 회색 칸은 다른 팀이 이미 배정된 시간입니다. 합주실은 1개로 봅니다.</p>
            {conflicts.length > 0 && (
              <div className="mt8">
                <Notice kind="warn">
                  선택한 시간에 참석할 수 없는 부원이 있습니다.
                  <ul>
                    {conflicts.map((c) => (
                      <li key={c.member.id}>{memberDisplayName(c.member)}: {c.state === 'unavailable' ? '참석 불가로 등록됨' : `${p.name} 시간표 미입력`}</li>
                    ))}
                  </ul>
                </Notice>
                <div className="field mt8">
                  <label>예외 사유</label>
                  <input className="input" value={s.override_note} onChange={(e) => setSlots((prev) => ({ ...prev, [p.id]: { ...prev[p.id], override_note: e.target.value } }))} placeholder="예: 해당 곡은 이 부원 없이 진행" />
                </div>
              </div>
            )}
          </div>
        )
      })}

      {anyConflict && !readOnly && (
        <div className="field" style={{ marginTop: 12 }}>
          <label className="check">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            참석 불가 부원이 있음을 확인했으며 예외로 저장합니다. 시간표에는 계속 표시됩니다.
          </label>
          {errors.ack && <span className="error">{errors.ack}</span>}
        </div>
      )}

      <div className="field" style={{ marginTop: 16 }}>
        <label>메모 <span className="muted" style={{ fontWeight: 400 }}>곡 목록이나 곡별 참여자를 자유롭게 적습니다</span></label>
        <textarea className="textarea" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={readOnly ? '메모 없음' : '예:\n1. 곡 A: 보컬 김민수, 기타 이지은\n2. 곡 B: 기타 박서준, 이지은'} />
      </div>
      </fieldset>
    </Modal>
  )
}
