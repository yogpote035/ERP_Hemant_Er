import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ShieldCheck, Factory, ArrowRight, Lock, Mail, AlertCircle, Eye, EyeOff } from 'lucide-react'
import { useStore, currentUser } from '@/store'
import { ApiError } from '@/api/client'
import { loginViaApi } from '@/api/session'

/** Hero stats from the client mock (marketing copy on the sign-in screen). */
const HERO_STATS = [
  { value: '12+ yrs', label: 'on the shop floor' },
  { value: '47', label: 'active vendors' },
  { value: '₹14.2 Cr', label: 'annual throughput' },
]

/**
 * API-backed sign-in: a two-panel layout — branded hero on the left, a
 * **Login ID + Password** card on the right. The backend validates credentials and
 * hydrates the user's authorized data before the app opens the
 * access that user's role + assigned units allow (enforced by `can()` + unit scope).
 */
export default function Login() {
  const user = useStore(currentUser)
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Already signed in → straight to the app.
  if (user) return <Navigate to="/" replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await loginViaApi(loginId, password)
      navigate(from, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? 'Incorrect Login ID or password.' : 'Unable to reach the server.')
      setSubmitting(false)
    }
  }

  return (
    <div className="grid min-h-full grid-cols-1 lg:grid-cols-2">
      {/* Hero panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-10 text-white lg:flex">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/30 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="relative flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-blue-400 to-primary text-[13px] font-bold">HE</span>
          <div className="leading-tight">
            <div className="text-sm font-bold uppercase tracking-wide">Hemant Engineering Works</div>
            <div className="text-[11px] text-sidebar-muted">Job Work &amp; Billing Automation</div>
          </div>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-3xl font-bold leading-tight tracking-tight">The complete ERP for precision manufacturing</h1>
          <p className="mt-3 text-[13px] leading-relaxed text-sidebar-muted">
            Challan-to-invoice job-work automation — material inward, multi-dispatch billing with auto-GST, live
            heat-wise stock and statutory reports, all in one calm workspace.
          </p>
          <dl className="mt-8 grid grid-cols-3 gap-4">
            {HERO_STATS.map((s) => (
              <div key={s.label}>
                <dt className="text-2xl font-bold tracking-tight">{s.value}</dt>
                <dd className="mt-0.5 text-[11px] leading-snug text-sidebar-muted">{s.label}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="relative flex items-center gap-2 text-[11px] text-sidebar-muted">
          <ShieldCheck size={14} className="text-green-400" />
          Secured by 256-bit TLS · Audit logged · ISO 9001:2015 · GST Compliant
        </div>
      </div>

      {/* Sign-in card */}
      <div className="flex items-center justify-center bg-bg p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <div className="mb-5 flex flex-col items-center text-center lg:hidden">
            <span className="mb-3 grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-blue-400 to-primary text-sm font-bold text-white">HE</span>
            <h1 className="text-lg font-bold">Hemant Engineering Works</h1>
            <p className="text-[12px] text-muted">Job Work &amp; Billing Automation</p>
          </div>

          <div className="card">
            <div className="flex items-center gap-2">
              <Factory size={16} className="text-primary" />
              <h2 className="text-sm font-semibold">Sign in to ERP</h2>
            </div>
            <p className="mt-1 text-[12px] text-muted">Enter your Login ID and password to continue.</p>

            <form className="mt-5 space-y-3.5" onSubmit={onSubmit} noValidate>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11.5px] font-medium text-muted-fg">Login ID</span>
                <span className="relative">
                  <Mail size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-fg" aria-hidden />
                  <input
                    type="text"
                    autoComplete="username"
                    className="input h-10 pl-9"
                    placeholder="you@hew.in"
                    value={loginId}
                    onChange={(e) => { setLoginId(e.target.value); setError('') }}
                    aria-invalid={!!error}
                    autoFocus
                  />
                </span>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[11.5px] font-medium text-muted-fg">Password</span>
                <span className="relative">
                  <Lock size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-fg" aria-hidden />
                  <input
                    type={showPw ? 'text' : 'password'}
                    autoComplete="current-password"
                    className="input h-10 pl-9 pr-9"
                    placeholder="••••••"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError('') }}
                    aria-invalid={!!error}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-fg hover:text-fg"
                    aria-label={showPw ? 'Hide password' : 'Show password'}
                  >
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </span>
              </label>

              {error ? (
                <div role="alert" className="flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-[12px] font-medium text-danger">
                  <AlertCircle size={14} className="shrink-0" />
                  {error}
                </div>
              ) : null}

              <button type="submit" className="btn btn-primary h-10 w-full" disabled={submitting || !loginId || !password}>
                {submitting ? 'Signing in…' : 'Sign in'}
                {!submitting ? <ArrowRight size={15} /> : null}
              </button>
            </form>

          </div>

          <p className="mt-6 text-center text-[11px] text-faint">© 2026 Hemant Engineering Works · Pune, MH</p>
        </div>
      </div>
    </div>
  )
}
