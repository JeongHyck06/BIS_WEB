export const DAY_LABELS = ['월', '화', '수', '목', '금', '토', '일'] as const
export const DAY_LABELS_FULL = ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일'] as const
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]

/** 팀 색상 팔레트 (낮은 채도). 두 기간 시간표에서 같은 팀은 같은 색을 사용한다. */
export const TEAM_COLORS = [
  '#5b7a99', // 회청
  '#6f8f6a', // 세이지
  '#a37f5c', // 황갈
  '#8c6f8a', // 연보라
  '#5f8f8c', // 청록
  '#9a8b5a', // 올리브
  '#8a6e6e', // 적갈
  '#6d7f9a', // 남회색
  '#7f8f5f', // 이끼
  '#9a7a8a', // 자회색
]

/** 세션 이모지 (세션을 나타낼 때만 사용) */
export const SESSION_EMOJI: Record<string, string> = {
  vocal: '🎤',
  guitar: '🎸',
  bass: '🎸',
  drum: '🥁',
  keyboard: '🎹',
}

export const slotKey = (day: number, slot: number) => `${day}-${slot}`
export const parseSlotKey = (key: string) => {
  const [d, s] = key.split('-').map(Number)
  return { day: d, slot_index: s }
}
