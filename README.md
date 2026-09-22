# BIS 합주 시간표

밴드 동아리 운영자가 부원들의 가능한 시간을 확인하고 팀을 직접 구성해 합주 시간을 배정하는 웹앱입니다.
React + Vite + TypeScript 프론트엔드와 Supabase(Postgres) 백엔드로 동작하며, 로그인 없이 사용합니다.

## 실행

```bash
npm install
cp .env.example .env.local   # Supabase URL 과 anon key 입력
npm run dev
```

`.env.local` 에는 anon(public) 키만 넣습니다. service role 키는 프론트엔드에 절대 포함하지 않습니다.

## Supabase 설정

마이그레이션은 `supabase/migrations/` 에 있습니다.

- Supabase CLI 사용: `supabase link --project-ref <ref>` 후 `supabase db push`
- CLI 없이: 대시보드 SQL Editor 에 마이그레이션 파일 내용을 붙여넣어 실행

마이그레이션이 만드는 것:

| 구분 | 내용 |
| --- | --- |
| 테이블 | sessions, periods, time_slots, members, member_sessions, member_period_status, member_availability, teams, team_members, team_schedule, schedule_versions |
| 제약 | 부원 이름+구분명 유니크, 팀 이름 유니크, 같은 기간의 동일 요일·타임에 두 팀 배정 금지(부분 유니크 인덱스), 외래키 |
| RPC | `save_member` (부원+세션+두 기간 시간 원자 저장), `save_team` (팀+팀원+시간 원자 저장), `confirm_schedule` (초안 전체를 스냅샷으로 원자 확정), `delete_sample_data` |
| 정책 | 모든 테이블에 RLS 활성화 후 anon 역할에 읽기/쓰기 허용 (로그인 없는 구조) |
| 기본값 | 세션 5종, 종강 전(월~금, 18~20시/20~22시, 12월 19일까지), 종강 후(월~일, 14~16시/18~20시/20~22시, 12월 20일부터) |

## 화면 구성

1. **부원 시간표 등록 현황**: 기간 탭, 요일×타임 표에 가능한 부원과 세션 표시, 이름 검색과 세션 필터, 부원 여러 명 선택 시 공통 가능 시간 강조
2. **합주 시간표**: 초안 탭과 확정본 탭. 팀 추가/수정, 시간 배정, 참석 불가 표시, 초안 전체 확정(스냅샷)
3. **확인이 필요한 항목**: 미입력 부원, 시간 미지정 팀, 참석 불가 충돌, 확정 이후 변경, 초안·확정본 불일치

기간 설정(기준 연도, 종강일, 기간별 사용 요일)과 샘플 데이터 넣기/삭제는 상단 '기간 설정' 에서 합니다. 샘플 데이터는 `is_sample` 로 구분되어 '샘플' 표시가 붙습니다.

## 미입력과 가능한 시간 없음의 구분

`member_period_status.status` 가 `entered` 이면서 `member_availability` 행이 없으면 '가능한 시간 없음', 행이 없거나 `not_entered` 이면 '미입력' 입니다.
