import { useMemo, useState } from 'react'
import { deleteSampleData, insertSampleData, saveTimeSlots, updatePeriod } from '../lib/api'
import { ALL_DAYS, DAY_LABELS, GRID_HOUR_END, GRID_HOUR_START } from '../lib/constants'
import { hourOf } from '../lib/logic'
import type { AppData, Period, TimeSlotInput } from '../lib/types'
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

const HOUR_OPTIONS = Array.from({ length: GRID_HOUR_END - GRID_HOUR_START + 1 }, (_, i) => GRID_HOUR_START + i)

function slotsToInputs(p: Period): TimeSlotInput[] {
  return p.slots.map((s) => ({ slot_index: s.slot_index, start_hour: hourOf(s.start_time), end_hour: hourOf(s.end_time) }))
}

/** 시작 시각 순으로 정렬한 뒤 n타임 라벨을 붙인다 (화면 표시용) */
function labeled(slots: TimeSlotInput[]): { slot: TimeSlotInput; label: string; idx: number }[] {
  const order = slots.map((slot, idx) => ({ slot, idx })).sort((a, b) => a.slot.start_hour - b.slot.start_hour)
  const rank = new Map(order.map((o, i) => [o.idx, i + 1]))
  return slots.map((slot, idx) => ({ slot, idx, label: `${rank.get(idx)}타임` }))
}

function validateSlots(slots: TimeSlotInput[]): string | null {
  if (slots.length === 0) return '합주 타임은 최소 한 개 있어야 합니다.'
  for (const s of slots) if (s.start_hour >= s.end_hour) return '타임의 시작 시각은 종료 시각보다 앞서야 합니다.'
  for (const s of slots) if (s.start_hour < GRID_HOUR_START || s.end_hour > GRID_HOUR_END) return `타임은 ${GRID_HOUR_START}시부터 ${GRID_HOUR_END}시 사이여야 합니다.`
  const sorted = [...slots].sort((a, b) => a.start_hour - b.start_hour)
  for (let i = 1; i < sorted.length; i++) if (sorted[i].start_hour < sorted[i - 1].end_hour) return '타임끼리 시간이 겹칠 수 없습니다.'
  return null
}

export function PeriodSettingsModal({ data, onClose, onSaved }: Props) {
  const toast = useToast()
  const before = data.periods.find((p) => p.key === 'before')!
  const after = data.periods.find((p) => p.key === 'after')!
  const init = useMemo(() => splitDate(before.end_date), [before.end_date])

  const [year, setYear] = useState(String(init.year))
  const [endMd, setEndMd] = useState(init.md)
  const [activeDays, setActiveDays] = useState<Record<string, number[]>>({ [before.id]: before.active_days, [after.id]: after.active_days })
  const [slots, setSlots] = useState<Record<string, TimeSlotInput[]>>({ [before.id]: slotsToInputs(before), [after.id]: slotsToInputs(after) })
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

  const updateSlot = (pid: string, idx: number, patch: Partial<TimeSlotInput>) =>
    setSlots((prev) => ({ ...prev, [pid]: prev[pid].map((s, i) => (i === idx ? { ...s, ...patch } : s)) }))
  const removeSlot = (pid: string, idx: number) =>
    setSlots((prev) => ({ ...prev, [pid]: prev[pid].filter((_, i) => i !== idx) }))
  const addSlot = (pid: string) =>
    setSlots((prev) => {
      const cur = prev[pid]
      const last = cur.reduce((m, s) => Math.max(m, s.end_hour), GRID_HOUR_START)
      const start = Math.min(last, GRID_HOUR_END - 1)
      return { ...prev, [pid]: [...cur, { slot_index: null, start_hour: start, end_hour: Math.min(start + 2, GRID_HOUR_END) }] }
    })

  /** 삭제되는 타임에 배정된 팀 이름 */
  const teamsOnRemovedSlots = (p: Period) => {
    const keep = new Set(slots[p.id].map((s) => s.slot_index).filter((x): x is number => x != null))
    return data.teams
      .filter((t) => { const s = t.schedule[p.id]; return s?.slot_index != null && !keep.has(s.slot_index) })
      .map((t) => t.name)
  }

  const save = async () => {
    if (!valid || !endDate) { setError('기준 연도와 종강일을 올바르게 입력해 주세요. 예: 2026, 12-19'); return }
    if (activeDays[before.id].length === 0 || activeDays[after.id].length === 0) { setError('각 기간에 최소 한 요일은 사용해야 합니다.'); return }
    for (const p of [before, after]) {
      const err = validateSlots(slots[p.id])
      if (err) { setError(`${p.name}: ${err}`); return }
    }
    const affected = [before, after].flatMap((p) => teamsOnRemovedSlots(p).map((n) => `${n} (${p.name})`))
    if (affected.length > 0 && !window.confirm(`삭제하는 타임에 배정된 팀이 있습니다.\n${affected.join(', ')}\n저장하면 이 팀들의 해당 기간 합주 시간이 미지정으로 바뀝니다. 계속할까요?`)) return
    setSaving(true)
    setError(null)
    try {
      await updatePeriod(before.id, { end_date: endDate, active_days: activeDays[before.id] })
      await updatePeriod(after.id, { start_date: addDays(endDate, 1), active_days: activeDays[after.id] })
      for (const p of [before, after]) await saveTimeSlots(p.id, slots[p.id])
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
          <div className="checks mb12">
            {ALL_DAYS.map((d) => (
              <label key={d} className="check">
                <input type="checkbox" checked={activeDays[p.id].includes(d)} onChange={() => toggleDay(p.id, d)} />{DAY_LABELS[d]}
              </label>
            ))}
          </div>

          <div className="legend">{p.name} 합주 타임 <span className="status">부원은 1시간 단위로 가능한 시간을 입력하고, 타임 가능 여부는 그 시간이 모두 선택됐는지로 계산합니다.</span></div>
          <div className="slot-editor">
            {labeled(slots[p.id]).map(({ slot, label, idx }) => (
              <div key={idx} className="slot-editor-row">
                <span className="lbl">{label}</span>
                <select className="select" value={slot.start_hour} onChange={(e) => updateSlot(p.id, idx, { start_hour: Number(e.target.value) })}>
                  {HOUR_OPTIONS.filter((h) => h < GRID_HOUR_END).map((h) => <option key={h} value={h}>{h}시</option>)}
                </select>
                <span>부터</span>
                <select className="select" value={slot.end_hour} onChange={(e) => updateSlot(p.id, idx, { end_hour: Number(e.target.value) })}>
                  {HOUR_OPTIONS.filter((h) => h > GRID_HOUR_START).map((h) => <option key={h} value={h}>{h}시</option>)}
                </select>
                <button type="button" className="link" onClick={() => removeSlot(p.id, idx)}>삭제</button>
              </div>
            ))}
            <div>
              <button type="button" className="btn btn-sm" onClick={() => addSlot(p.id)}>타임 추가하기</button>
            </div>
          </div>
          <p className="muted small mt8">타임을 삭제하면 그 타임에 배정된 팀의 합주 시간은 미지정으로 바뀝니다. 부원이 입력한 가능 시간은 시간 단위라 그대로 유지됩니다.</p>
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
