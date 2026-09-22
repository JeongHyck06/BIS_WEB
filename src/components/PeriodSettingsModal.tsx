import { useMemo, useState } from 'react'
import { deleteSampleData, insertSampleData, updatePeriod } from '../lib/api'
import { ALL_DAYS, DAY_LABELS } from '../lib/constants'
import { slotTime } from '../lib/logic'
import type { AppData } from '../lib/types'
import { Modal, Notice, useToast } from './ui'

interface Props {
  data: AppData
  onClose: () => void
  onSaved: () => Promise<void>
}

function splitDate(d: string | null): { year: number; md: string } {
  if (!d) return { year: new Date().getFullYear(), md: '12-19' }
  const [y, m, day] = d.split('-')
  return { year: Number(y), md: `${m}-${day}` }
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + n)
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function PeriodSettingsModal({ data, onClose, onSaved }: Props) {
  const toast = useToast()
  const before = data.periods.find((p) => p.key === 'before')!
  const after = data.periods.find((p) => p.key === 'after')!
  const init = useMemo(() => splitDate(before.end_date), [before.end_date])

  const [year, setYear] = useState(String(init.year))
  const [endMd, setEndMd] = useState(init.md)
  const [activeDays, setActiveDays] = useState<Record<string, number[]>>({ [before.id]: before.active_days, [after.id]: after.active_days })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busySample, setBusySample] = useState(false)

  const endDate = /^\d{4}$/.test(year) && /^\d{2}-\d{2}$/.test(endMd) ? `${year}-${endMd}` : null
  const valid = endDate != null && !Number.isNaN(new Date(`${endDate}T00:00:00`).getTime())

  const toggleDay = (pid: string, d: number) =>
    setActiveDays((prev) => {
      const cur = prev[pid]
      const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort((a, b) => a - b)
      return { ...prev, [pid]: next }
    })

  const save = async () => {
    if (!valid || !endDate) { setError('기준 연도와 종강일을 올바르게 입력해 주세요. 예: 2026, 12-19'); return }
    if (activeDays[before.id].length === 0 || activeDays[after.id].length === 0) { setError('각 기간에 최소 한 요일은 사용해야 합니다.'); return }
    setSaving(true)
    setError(null)
    try {
      await updatePeriod(before.id, { end_date: endDate, active_days: activeDays[before.id] })
      await updatePeriod(after.id, { start_date: addDays(endDate, 1), active_days: activeDays[after.id] })
      toast.show('기간 설정을 저장했습니다.', 'success')
      await onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const sampleMembers = data.members.filter((m) => m.is_sample).length
  const sampleTeams = data.teams.filter((t) => t.is_sample).length

  const addSample = async () => {
    if (sampleMembers > 0 && !window.confirm('샘플 데이터가 이미 있습니다. 그래도 다시 넣을까요? 이름이 겹치면 실패할 수 있습니다.')) return
    setBusySample(true)
    try {
      await insertSampleData(data)
      toast.show('샘플 데이터를 넣었습니다. 샘플 표시로 실제 데이터와 구분됩니다.', 'success')
      await onSaved()
    } catch (err) {
      toast.show(err instanceof Error ? `샘플 데이터 추가 실패: ${err.message}` : '샘플 데이터 추가 실패', 'error')
    } finally {
      setBusySample(false)
    }
  }
  const removeSample = async () => {
    if (!window.confirm(`샘플 부원 ${sampleMembers}명과 샘플 팀 ${sampleTeams}개를 삭제할까요? 실제 데이터는 유지됩니다.`)) return
    setBusySample(true)
    try {
      await deleteSampleData()
      toast.show('샘플 데이터를 삭제했습니다.', 'success')
      await onSaved()
    } catch (err) {
      toast.show(err instanceof Error ? `삭제 실패: ${err.message}` : '삭제 실패', 'error')
    } finally {
      setBusySample(false)
    }
  }

  return (
    <Modal
      title="기간 설정"
      onClose={onClose}
      footer={
        <div className="right">
          <button type="button" className="btn" onClick={onClose} disabled={saving}>취소</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>{saving ? '저장 중' : '저장하기'}</button>
        </div>
      }
    >
      {error && <div className="mb12"><Notice kind="danger">{error}</Notice></div>}
      <div className="row row-2">
        <div className="field">
          <label>기준 연도</label>
          <input className="input" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" placeholder="2026" />
        </div>
        <div className="field">
          <label>종강 전 마지막 날</label>
          <input className="input" value={endMd} onChange={(e) => setEndMd(e.target.value)} placeholder="12-19" />
          <span className="hint">월-일 형식으로 입력합니다. 종강 후는 다음 날부터 시작합니다.{valid && endDate && <> 종강 전은 {endDate}까지, 종강 후는 {addDays(endDate, 1)}부터입니다.</>}</span>
        </div>
      </div>

      {[before, after].map((p) => (
        <div key={p.id} className="group">
          <div className="legend">{p.name} 사용 요일 <span className="status">사용하지 않는 요일은 표에서 회색으로 표시되고 선택할 수 없습니다.</span></div>
          <div className="checks">
            {ALL_DAYS.map((d) => (
              <label key={d} className="check">
                <input type="checkbox" checked={activeDays[p.id].includes(d)} onChange={() => toggleDay(p.id, d)} />{DAY_LABELS[d]}
              </label>
            ))}
          </div>
          <p className="muted small mt8">합주 타임: {p.slots.map((s) => `${s.label} ${slotTime(s)}`).join(', ')}</p>
        </div>
      ))}

      <div className="group">
        <div className="legend">샘플 데이터</div>
        <p className="small muted mb8">화면을 살펴보기 위한 예시 부원과 팀입니다. 샘플 표시가 붙어 실제 데이터와 구분되며 한 번에 삭제할 수 있습니다. 현재 샘플 부원 {sampleMembers}명, 샘플 팀 {sampleTeams}개.</p>
        <div className="flex">
          <button type="button" className="btn btn-sm" onClick={addSample} disabled={busySample}>샘플 데이터 넣기</button>
          <button type="button" className="btn btn-sm btn-danger" onClick={removeSample} disabled={busySample || (sampleMembers === 0 && sampleTeams === 0)}>샘플 데이터 삭제하기</button>
        </div>
      </div>
    </Modal>
  )
}
