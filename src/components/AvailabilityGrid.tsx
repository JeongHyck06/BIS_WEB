import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { ALL_DAYS, DAY_LABELS, slotKey } from '../lib/constants'
import type { Period } from '../lib/types'

export interface CellDecoration {
  className?: string
  content?: ReactNode
  title?: string
  disabled?: boolean
}

/** 격자의 한 행. key 는 셀 키("day-key")에 쓰인다. */
export interface GridRow {
  key: number
  label: string
  sub?: string
}

interface Props {
  period: Pick<Period, 'active_days'>
  rows: GridRow[]
  /** 선택된 "day-rowKey" 키 */
  value: Set<string>
  onChange?: (next: Set<string>) => void
  readOnly?: boolean
  /** 강조할 셀 (공통 가능 시간 등) */
  highlight?: Set<string>
  /** 셀별 추가 표시 */
  decorate?: (day: number, rowKey: number) => CellDecoration | undefined
  /** 단일 선택 모드 (팀 시간 배정) */
  single?: boolean
  /** 행이 많을 때(24시간) 칸을 낮게 */
  compact?: boolean
}

/** 요일 × 행 격자. 클릭 또는 드래그로 선택하거나 해제한다. */
export function AvailabilityGrid({ period, rows, value, onChange, readOnly, highlight, decorate, single, compact }: Props) {
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

  const onPointerDown = (e: React.PointerEvent, day: number, rowKey: number, disabled: boolean) => {
    if (readOnly || !onChange || disabled || !isActive(day)) return
    e.preventDefault()
    const key = slotKey(day, rowKey)
    if (single) {
      onChange(value.has(key) ? new Set() : new Set([key]))
      return
    }
    const mode: 'add' | 'remove' = value.has(key) ? 'remove' : 'add'
    dragRef.current = { mode, keys: new Set<string>() }
    valueRef.current = value
    applyKey(key)
  }

  const onPointerEnter = (day: number, rowKey: number, disabled: boolean) => {
    if (!dragRef.current || disabled || !isActive(day)) return
    applyKey(slotKey(day, rowKey))
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
      className={`avail-grid${compact ? ' compact' : ''}`}
      style={{ gridTemplateColumns: 'minmax(64px, auto) repeat(7, minmax(36px, 1fr))' }}
      onPointerMove={onPointerMove}
    >
      <div />
      {ALL_DAYS.map((d) => (
        <div key={d} className={`hd${isActive(d) ? '' : ' inactive'}`}>{DAY_LABELS[d]}</div>
      ))}
      {rows.map((row) => (
        <Row key={row.key}>
          <div className="sl">
            <span>{row.label}</span>
            {row.sub && <span className="t">{row.sub}</span>}
          </div>
          {ALL_DAYS.map((d) => {
            const key = slotKey(d, row.key)
            const active = isActive(d)
            const deco = active ? decorate?.(d, row.key) : undefined
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
                title={deco?.title ?? (active ? `${DAY_LABELS[d]} ${row.label}` : '사용하지 않는 요일')}
                onPointerDown={(e) => onPointerDown(e, d, row.key, disabled)}
                onPointerEnter={() => onPointerEnter(d, row.key, disabled)}
                role={readOnly ? undefined : 'button'}
                aria-pressed={on}
                aria-label={`${DAY_LABELS[d]} ${row.label}`}
              >
                {deco?.content ?? (on && !single && !compact ? '가능' : '')}
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
