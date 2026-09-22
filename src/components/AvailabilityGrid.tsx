import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { ALL_DAYS, DAY_LABELS, slotKey } from '../lib/constants'
import { slotTime } from '../lib/logic'
import type { Period } from '../lib/types'

export interface CellDecoration {
  className?: string
  content?: ReactNode
  title?: string
  disabled?: boolean
}

interface Props {
  period: Period
  /** 선택된 "day-slot" 키 */
  value: Set<string>
  onChange?: (next: Set<string>) => void
  readOnly?: boolean
  /** 강조할 셀 (공통 가능 시간 등) */
  highlight?: Set<string>
  /** 셀별 추가 표시 */
  decorate?: (day: number, slotIndex: number) => CellDecoration | undefined
  /** 단일 선택 모드 (팀 시간 배정) */
  single?: boolean
}

/** 요일과 타임 격자. 클릭 또는 드래그로 선택하거나 해제한다. */
export function AvailabilityGrid({ period, value, onChange, readOnly, highlight, decorate, single }: Props) {
  const dragRef = useRef<{ mode: 'add' | 'remove'; keys: Set<string> } | null>(null)
  const valueRef = useRef(value)
  useEffect(() => { valueRef.current = value }, [value])

  const isActive = (day: number) => period.active_days.includes(day)

  const applyKey = useCallback((key: string) => {
    const d = dragRef.current
    if (!d || !onChange) return
    if (d.keys.has(key)) return
    d.keys.add(key)
    const next = new Set(valueRef.current)
    if (d.mode === 'add') next.add(key)
    else next.delete(key)
    valueRef.current = next
    onChange(next)
  }, [onChange])

  const onPointerDown = (e: React.PointerEvent, day: number, slot: number, disabled: boolean) => {
    if (readOnly || !onChange || disabled || !isActive(day)) return
    e.preventDefault()
    const key = slotKey(day, slot)
    if (single) {
      onChange(value.has(key) ? new Set() : new Set([key]))
      return
    }
    const mode: 'add' | 'remove' = value.has(key) ? 'remove' : 'add'
    dragRef.current = { mode, keys: new Set<string>() }
    valueRef.current = value
    applyKey(key)
  }

  const onPointerEnter = (day: number, slot: number, disabled: boolean) => {
    if (!dragRef.current || disabled || !isActive(day)) return
    applyKey(slotKey(day, slot))
  }

  const gridRef = useRef<HTMLDivElement>(null)
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current || e.pointerType === 'mouse') return
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
    const cell = el?.closest<HTMLElement>('[data-key]')
    if (cell && gridRef.current?.contains(cell) && cell.dataset.disabled !== '1') {
      applyKey(cell.dataset.key!)
    }
  }

  useEffect(() => {
    const end = () => { dragRef.current = null }
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => { window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end) }
  }, [])

  return (
    <div
      ref={gridRef}
      className="avail-grid"
      style={{ gridTemplateColumns: 'minmax(72px, auto) repeat(7, minmax(36px, 1fr))' }}
      onPointerMove={onPointerMove}
    >
      <div />
      {ALL_DAYS.map((d) => (
        <div key={d} className={`hd${isActive(d) ? '' : ' inactive'}`}>{DAY_LABELS[d]}</div>
      ))}
      {period.slots.map((slot) => (
        <Row key={slot.id}>
          <div className="sl">
            <span>{slot.label}</span>
            <span className="t">{slotTime(slot)}</span>
          </div>
          {ALL_DAYS.map((d) => {
            const key = slotKey(d, slot.slot_index)
            const active = isActive(d)
            const deco = active ? decorate?.(d, slot.slot_index) : undefined
            const disabled = !active || Boolean(deco?.disabled)
            const on = value.has(key)
            const cls = ['avail-cell']
            if (!active) cls.push('inactive')
            if (on) cls.push(single ? 'picked' : 'on')
            if (highlight?.has(key)) cls.push('common')
            if (readOnly) cls.push('readonly')
            if (deco?.className) cls.push(deco.className)
            return (
              <div
                key={key}
                data-key={key}
                data-disabled={disabled ? '1' : '0'}
                className={cls.join(' ')}
                title={deco?.title ?? (active ? `${DAY_LABELS[d]} ${slot.label}` : '사용하지 않는 요일')}
                onPointerDown={(e) => onPointerDown(e, d, slot.slot_index, disabled)}
                onPointerEnter={() => onPointerEnter(d, slot.slot_index, disabled)}
                role={readOnly ? undefined : 'button'}
                aria-pressed={on}
                aria-label={`${DAY_LABELS[d]} ${slot.label}`}
              >
                {deco?.content ?? (on && !single ? '가능' : '')}
              </div>
            )
          })}
        </Row>
      ))}
    </div>
  )
}

function Row({ children }: { children: ReactNode }) {
  return <>{children}</>
}
