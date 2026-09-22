import { useMemo, useState } from 'react'
import { deleteMember, saveMember } from '../lib/api'
import { memberDisplayName, slotHours, slotTime } from '../lib/logic'
import { GRID_HOURS, slotKey } from '../lib/constants'
import type { AppData, Member, Period } from '../lib/types'
import { AvailabilityGrid } from './AvailabilityGrid'
import { Modal, Notice, SessionText, sessionText, useToast } from './ui'

interface Props {
  data: AppData
  memberId: string | null
  onClose: () => void
  onSaved: () => Promise<void>
}

interface PeriodDraft { entered: boolean; hours: Set<string> }

export function MemberFormModal({ data, memberId: initialId, onClose, onSaved }: Props) {
  const [memberId, setMemberId] = useState<string | null>(initialId)
  // 편집 대상이 바뀌면 key 로 폼을 새로 초기화
  return <MemberEditor key={memberId ?? 'new'} data={data} memberId={memberId} initialId={initialId} setMemberId={setMemberId} onClose={onClose} onSaved={onSaved} />
}

function MemberEditor({ data, memberId, initialId, setMemberId, onClose, onSaved }: Props & { memberId: string | null; initialId: string | null; setMemberId: (id: string | null) => void }) {
  const toast = useToast()
  const member = useMemo(() => data.members.find((m) => m.id === memberId) ?? null, [data.members, memberId])

  const [name, setName] = useState(() => member?.name ?? '')
  const [nickname, setNickname] = useState(() => member?.nickname ?? '')
  const [memo, setMemo] = useState(() => member?.memo ?? '')
  const [sessionIds, setSessionIds] = useState<string[]>(() => member?.session_ids ?? [])
  const [periodDraft, setPeriodDraft] = useState<Record<string, PeriodDraft>>(() => {
    const draft: Record<string, PeriodDraft> = {}
    for (const p of data.periods) {
      const e = member?.periods[p.id]
      draft[p.id] = { entered: e?.status === 'entered', hours: new Set(e?.hours ?? []) }
    }
    return draft
  })
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saveError, setSaveError] = useState<string | null>(null)

  const searchResults = useMemo(() => {
    const q = search.trim()
    if (!q) return []
    return data.members.filter((m) => m.name.includes(q) || m.nickname.includes(q)).slice(0, 12)
  }, [search, data.members])

  const teamsOf = (m: Member) => data.teams.filter((t) => t.member_ids.includes(m.id))

  const validate = () => {
    const e: Record<string, string> = {}
    if (!name.trim()) e.name = '이름을 입력해 주세요.'
    const dup = data.members.find((m) => m.id !== memberId && m.name === name.trim() && m.nickname === nickname.trim())
    if (dup) e.nickname = '같은 이름과 구분명의 부원이 이미 있습니다. 동명이인이면 구분명을 다르게 입력해 주세요.'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const submit = async () => {
    if (!validate()) return
    setSaving(true)
    setSaveError(null)
    try {
      const availability: Record<string, { entered: boolean; hours: { day: number; hour: number }[] }> = {}
      for (const p of data.periods) {
        const d = periodDraft[p.id]
        availability[p.id] = {
          entered: d.entered,
          hours: d.entered ? [...d.hours].map((k) => { const [day, hour] = k.split('-').map(Number); return { day, hour } }) : [],
        }
      }
      await saveMember({ id: memberId, name: name.trim(), nickname: nickname.trim(), memo, session_ids: sessionIds, availability })
      toast.show(memberId ? '부원 정보를 저장했습니다.' : '부원을 등록했습니다.', 'success')
      await onSaved()
      onClose()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!member) return
    const teams = teamsOf(member)
    const msg = `${memberDisplayName(member)} 님을 삭제할까요?` + (teams.length ? `\n소속된 팀(${teams.map((t) => t.name).join(', ')})에서도 제외됩니다.` : '')
    if (!window.confirm(msg)) return
    setSaving(true)
    try {
      await deleteMember(member.id)
      toast.show('부원을 삭제했습니다.', 'success')
      await onSaved()
      onClose()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '삭제에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const setPeriod = (p: Period, patch: Partial<PeriodDraft>) =>
    setPeriodDraft((prev) => ({ ...prev, [p.id]: { ...prev[p.id], ...patch } }))

  const HOURS = GRID_HOURS
  const hourRows = HOURS.map((h) => ({ key: h, label: `${h}시` }))
  const allKeys = (p: Period) => {
    const s = new Set<string>()
    for (const d of p.active_days) for (const h of HOURS) s.add(slotKey(d, h))
    return s
  }
  /** 합주 타임에 포함된 시간만 */
  const slotKeys = (p: Period) => {
    const s = new Set<string>()
    for (const d of p.active_days) for (const slot of p.slots) for (const h of slotHours(slot)) s.add(slotKey(d, h))
    return s
  }

  const title = member ? `부원 정보 수정: ${memberDisplayName(member)}` : '부원 추가'

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          {member && <button type="button" className="btn btn-danger" onClick={remove} disabled={saving}>삭제하기</button>}
          <div className="right">
            <button type="button" className="btn" onClick={onClose} disabled={saving}>취소</button>
            <button type="button" className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? '저장 중' : '저장하기'}</button>
          </div>
        </>
      }
    >
      {!member && (
        <div className="field">
          <label>기존 부원 검색</label>
          <input className="input" placeholder="이미 등록된 부원이면 이름으로 검색해서 수정하세요" value={search} onChange={(e) => setSearch(e.target.value)} />
          {search.trim() && (
            <div className="search-results">
              {searchResults.length === 0 && <div className="search-item none">검색 결과가 없습니다. 아래에서 새로 등록하세요.</div>}
              {searchResults.map((m) => (
                <button type="button" key={m.id} className="search-item" onClick={() => { setMemberId(m.id); setSearch('') }}>
                  <span>
                    {memberDisplayName(m)}
                    {m.is_sample && <span className="sample">샘플</span>}
                    <span className="meta" style={{ marginLeft: 8 }}>
                      {m.session_ids.map((id) => data.sessions.find((s) => s.id === id)).filter(Boolean).map((s) => sessionText(s!)).join(', ') || '세션 없음'}
                    </span>
                  </span>
                  <span className="meta">
                    {data.periods.map((p) => `${p.name} ${m.periods[p.id]?.status === 'entered' ? '입력' : '미입력'}`).join(', ')}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {member && (
        <p className="small muted mb12">
          {member.is_sample && <span className="sample" style={{ marginLeft: 0, marginRight: 6 }}>샘플</span>}
          소속 팀: {teamsOf(member).length ? teamsOf(member).map((t) => t.name).join(', ') : '없음'}
          {initialId && <> <button type="button" className="link" onClick={() => setMemberId(null)}>다른 부원 검색</button></>}
        </p>
      )}

      {saveError && <div className="mb12"><Notice kind="danger">저장 실패: {saveError}</Notice></div>}

      <div className="row row-2">
        <div className="field">
          <label>이름</label>
          <input className={`input${errors.name ? ' invalid' : ''}`} value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 김민수" />
          {errors.name && <span className="error">{errors.name}</span>}
        </div>
        <div className="field">
          <label>구분명 또는 별명</label>
          <input className={`input${errors.nickname ? ' invalid' : ''}`} value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="동명이인 구분용, 예: 22학번" />
          {errors.nickname ? <span className="error">{errors.nickname}</span> : <span className="hint">같은 이름이 있을 때만 입력하면 됩니다.</span>}
        </div>
      </div>

      <div className="field">
        <label>가능한 세션</label>
        <div className="checks">
          {data.sessions.map((s) => {
            const on = sessionIds.includes(s.id)
            return (
              <label key={s.id} className="check">
                <input type="checkbox" checked={on} onChange={(e) => setSessionIds((prev) => (e.target.checked ? [...prev, s.id] : prev.filter((x) => x !== s.id)))} />
                {sessionText(s)}
              </label>
            )
          })}
        </div>
      </div>

      {data.periods.map((p) => {
        const d = periodDraft[p.id]
        if (!d) return null
        const total = allKeys(p).size
        return (
          <div key={p.id} className="group">
            <div className="legend">
              {p.name} 가능한 시간
              {d.entered
                ? d.hours.size === 0
                  ? <span className="status bad">입력 완료, 가능한 시간 없음</span>
                  : <span className="status ok">입력 완료, {d.hours.size}시간 선택</span>
                : <span className="status">미입력</span>}
            </div>
            <div className="grid-actions">
              <label className="check">
                <input type="checkbox" checked={d.entered} onChange={(e) => setPeriod(p, { entered: e.target.checked })} />
                {p.name} 시간표 입력
              </label>
              <span className="spacer" />
              <button type="button" className="btn btn-sm" disabled={!d.entered} onClick={() => setPeriod(p, { hours: new Set([...d.hours, ...slotKeys(p)]) })}>합주 타임 전체 선택</button>
              <button type="button" className="btn btn-sm" disabled={!d.entered || d.hours.size === total} onClick={() => setPeriod(p, { hours: allKeys(p) })}>전체 선택</button>
              <button type="button" className="btn btn-sm" disabled={!d.entered || d.hours.size === 0} onClick={() => setPeriod(p, { hours: new Set() })}>전체 해제</button>
            </div>
            {d.entered ? (
              <>
                <p className="muted small mb8">합주 타임: {p.slots.map((slot) => `${slot.label} ${slotTime(slot)}`).join(', ')}. 각 칸은 그 시각부터 1시간이며, 10시부터 22시까지 표시합니다.</p>
                <AvailabilityGrid period={p} rows={hourRows} compact value={d.hours} onChange={(next) => setPeriod(p, { hours: next })} />
                <p className="hint mt8 muted small">칸을 클릭하거나 드래그해서 선택하세요. 아무 칸도 선택하지 않고 저장하면 가능한 시간 없음으로 기록됩니다.</p>
              </>
            ) : (
              <p className="muted small">시간표 입력을 켜면 시간을 선택할 수 있습니다. 끈 상태로 저장하면 미입력으로 남습니다.</p>
            )}
          </div>
        )
      })}

      <div className="field" style={{ marginTop: 16 }}>
        <label>메모</label>
        <textarea className="textarea" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="예: 시험 기간에는 참석 어려움" />
      </div>

      {member && (
        <p className="muted small">
          세션: {member.session_ids.length ? <SessionText sessions={data.sessions.filter((s) => member.session_ids.includes(s.id))} /> : '없음'}. 마지막 수정 {new Date(member.updated_at).toLocaleString('ko-KR')}
        </p>
      )}
    </Modal>
  )
}
