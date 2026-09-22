import { useMemo, useState } from 'react'
import { attentionItems, type AttentionKind } from '../lib/logic'
import type { AppData } from '../lib/types'

interface Props {
  data: AppData
  onOpenMember: (id: string) => void
  onOpenTeam: (id: string) => void
}

const KIND_LABEL: Record<AttentionKind, string> = {
  member_not_entered: '시간표 미입력',
  team_time_missing: '합주 시간 미지정',
  team_conflict: '참석 불가',
  team_changed_after_confirm: '확정 후 변경',
  team_draft_differs: '확정본과 다름',
}
const KIND_ORDER: AttentionKind[] = ['team_conflict', 'team_changed_after_confirm', 'team_draft_differs', 'team_time_missing', 'member_not_entered']

export function AttentionSection({ data, onOpenMember, onOpenTeam }: Props) {
  const items = useMemo(() => attentionItems(data), [data])
  const [filter, setFilter] = useState<AttentionKind | ''>('')
  const counts = useMemo(() => {
    const c = {} as Record<AttentionKind, number>
    for (const k of KIND_ORDER) c[k] = items.filter((i) => i.kind === k).length
    return c
  }, [items])
  const shown = (filter ? items.filter((i) => i.kind === filter) : items)
    .slice()
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))

  return (
    <section className="section" id="attention">
      <div className="section-head">
        <div>
          <h2>확인이 필요한 항목 {items.length > 0 && <span className="muted">{items.length}건</span>}</h2>
          <p className="sub">운영자가 직접 확인할 항목만 표시합니다. 세션별 필요 인원은 정해져 있지 않으므로 부족 여부는 판단하지 않습니다.</p>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="empty">확인이 필요한 항목이 없습니다.</div>
      ) : (
        <>
          <div className="attention-filter">
            <button type="button" className={`link${filter === '' ? ' active' : ''}`} onClick={() => setFilter('')}>전체 {items.length}</button>
            {KIND_ORDER.filter((k) => counts[k] > 0).map((k) => (
              <button type="button" key={k} className={`link${filter === k ? ' active' : ''}`} onClick={() => setFilter(k)}>
                {KIND_LABEL[k]} {counts[k]}
              </button>
            ))}
          </div>
          <ul className="attention-list">
            {shown.map((it, i) => (
              <li key={i} className="attention-item">
                <span className={`kind${it.kind === 'team_conflict' || it.kind === 'team_changed_after_confirm' ? ' bad' : ''}`}>{KIND_LABEL[it.kind]}</span>
                <span className="msg">{it.message}</span>
                {it.teamId
                  ? <button type="button" className="btn btn-sm" onClick={() => onOpenTeam(it.teamId!)}>팀 열기</button>
                  : it.memberId && <button type="button" className="btn btn-sm" onClick={() => onOpenMember(it.memberId!)}>시간표 입력하기</button>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
