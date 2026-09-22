import { useCallback, useEffect, useState } from 'react'
import { loadAll } from './lib/api'
import { supabaseConfigured } from './lib/supabase'
import type { AppData } from './lib/types'
import { AdminLoginModal, loadAdminFlag, saveAdminFlag } from './components/AdminLoginModal'
import { AttentionSection } from './components/AttentionSection'
import { AvailabilityOverview } from './components/AvailabilityOverview'
import { MemberFormModal } from './components/MemberFormModal'
import { PeriodSettingsModal } from './components/PeriodSettingsModal'
import { TeamFormModal } from './components/TeamFormModal'
import { TeamScheduleSection } from './components/TeamScheduleSection'
import { Notice, ToastProvider } from './components/ui'

type MemberModal = { open: true; memberId: string | null } | { open: false }
type TeamModal = { open: true; teamId: string | null } | { open: false }

export default function App() {
  return (
    <ToastProvider>
      <Main />
    </ToastProvider>
  )
}

function Main() {
  const [data, setData] = useState<AppData | null>(null)
  const [loading, setLoading] = useState(supabaseConfigured)
  const [error, setError] = useState<string | null>(null)
  const [memberModal, setMemberModal] = useState<MemberModal>({ open: false })
  const [teamModal, setTeamModal] = useState<TeamModal>({ open: false })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [isAdmin, setIsAdmin] = useState(loadAdminFlag)
  const [loginOpen, setLoginOpen] = useState(false)

  const logout = () => {
    saveAdminFlag(false)
    setIsAdmin(false)
    setSettingsOpen(false)
  }

  const reload = useCallback(async () => {
    try {
      const d = await loadAll()
      setData(d)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '데이터를 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (supabaseConfigured) void reload() }, [reload])

  if (!supabaseConfigured) {
    return (
      <div className="app">
        <div className="setup-box">
          <h2 className="mb12">Supabase 설정이 필요합니다</h2>
          <p className="mb12">프로젝트 루트에 .env.local 파일을 만들고 아래 값을 채운 뒤 개발 서버를 다시 시작하세요. anon 키만 사용하며 service role 키는 넣지 않습니다.</p>
          <pre>{`VITE_SUPABASE_URL=https://your-project-ref.supabase.co\nVITE_SUPABASE_ANON_KEY=your-anon-public-key`}</pre>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>BIS 합주 시간표</h1>
        <div className="actions">
          <button type="button" className="btn" onClick={() => void reload()} disabled={loading}>새로고침</button>
          {isAdmin ? (
            <>
              <button type="button" className="btn" onClick={() => setSettingsOpen(true)} disabled={!data}>기간 설정</button>
              <button type="button" className="btn" onClick={logout}>로그아웃</button>
            </>
          ) : (
            <button type="button" className="btn" onClick={() => setLoginOpen(true)}>어드민 로그인</button>
          )}
        </div>
      </header>

      {loginOpen && <AdminLoginModal onClose={() => setLoginOpen(false)} onSuccess={() => setIsAdmin(true)} />}

      {loading && <div className="loading">불러오는 중입니다.</div>}
      {!loading && error && (
        <div className="section">
          <Notice kind="danger">
            데이터를 불러오지 못했습니다: {error}
            <div className="mt8"><button type="button" className="btn btn-sm" onClick={() => { setLoading(true); void reload() }}>다시 시도</button></div>
          </Notice>
        </div>
      )}

      {data && (
        <>
          {data.periods.length < 2 && (
            <div className="section"><Notice kind="warn">기간 설정이 없습니다. 마이그레이션이 적용되었는지 확인해 주세요.</Notice></div>
          )}
          <AvailabilityOverview
            data={data}
            onAddMember={() => setMemberModal({ open: true, memberId: null })}
            onOpenMember={(id) => setMemberModal({ open: true, memberId: id })}
          />
          <TeamScheduleSection
            data={data}
            isAdmin={isAdmin}
            onAddTeam={() => setTeamModal({ open: true, teamId: null })}
            onOpenTeam={(id) => setTeamModal({ open: true, teamId: id })}
            onConfirmed={reload}
          />
          {isAdmin && (
            <AttentionSection
              data={data}
              onOpenMember={(id) => setMemberModal({ open: true, memberId: id })}
              onOpenTeam={(id) => setTeamModal({ open: true, teamId: id })}
            />
          )}
          <p className="footnote">
            동아리 내부 도구입니다. 어드민 로그인은 화면을 구분하기 위한 편의 기능이며 실제 권한 보호는 아닙니다.
          </p>

          {memberModal.open && (
            <MemberFormModal data={data} memberId={memberModal.memberId} onClose={() => setMemberModal({ open: false })} onSaved={reload} />
          )}
          {teamModal.open && (
            <TeamFormModal key={teamModal.teamId ?? 'new'} data={data} teamId={teamModal.teamId} readOnly={!isAdmin} onClose={() => setTeamModal({ open: false })} onSaved={reload} />
          )}
          {settingsOpen && isAdmin && (
            <PeriodSettingsModal data={data} onClose={() => setSettingsOpen(false)} onSaved={reload} />
          )}
        </>
      )}
    </div>
  )
}
