import { useState } from 'react'
import { Modal } from './ui'

/** 편의용 어드민 구분. 비밀번호는 프론트엔드에 하드코딩되어 있어 실제 보안 수단은 아닙니다. */
export const ADMIN_PASSWORD = '5468'
const STORAGE_KEY = 'bis-admin'

export function loadAdminFlag(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function saveAdminFlag(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(STORAGE_KEY, '1')
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // 저장이 막힌 환경에서는 로그인 상태를 유지하지 않습니다.
  }
}

interface Props {
  onClose: () => void
  onSuccess: () => void
}

export function AdminLoginModal({ onClose, onSuccess }: Props) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    if (password === ADMIN_PASSWORD) {
      saveAdminFlag(true)
      onSuccess()
      onClose()
    } else {
      setError('비밀번호가 올바르지 않습니다.')
    }
  }

  return (
    <Modal
      title="어드민 로그인"
      onClose={onClose}
      footer={
        <div className="right">
          <button type="button" className="btn" onClick={onClose}>취소</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={!password}>로그인하기</button>
        </div>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); submit() }}>
        <div className="field">
          <label htmlFor="admin-password">비밀번호</label>
          <input
            id="admin-password"
            className={`input${error ? ' invalid' : ''}`}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(null) }}
          />
          {error
            ? <span className="error">{error}</span>
            : <span className="hint">로그인하면 기간 설정과 확인이 필요한 항목을 볼 수 있습니다. 브라우저 탭을 닫으면 로그아웃됩니다.</span>}
        </div>
      </form>
    </Modal>
  )
}
