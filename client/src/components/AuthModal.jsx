import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { errorMessage } from '../api.js';
import { Button, ErrorBox } from './ui.jsx';

// background image: put your file at client/public/paperly-bg.jpg
const BG = '/paperly-bg.png';

const field =
  'mt-1.5 w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-base text-white placeholder:text-white/50 focus:border-white/50 focus:outline-none focus:ring-1 focus:ring-white/40';

export default function AuthModal() {
  const { authOpen, authMode, closeAuth, setAuthMode, login, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isRegister = authMode === 'register';
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Esc closes the card
  useEffect(() => {
    if (!authOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') closeAuth(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [authOpen, closeAuth]);

  useEffect(() => { setError(''); }, [authMode, authOpen]);

  if (!authOpen) return null;

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (isRegister && form.password.length < 6) return setError('Password must be at least 6 characters.');
    setBusy(true);
    try {
      if (isRegister) await register(form.name, form.email, form.password);
      else await login(form.email, form.password);
      setForm({ name: '', email: '', password: '' });
      closeAuth();
      navigate('/', { replace: true }); // after signing in, go to the main page
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto px-4 py-8"
      style={{
        backgroundColor: '#000',
        backgroundImage: `linear-gradient(rgba(0,0,0,.45), rgba(0,0,0,.65)), url(${BG})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) closeAuth(); }}
    >
      <form
        onSubmit={submit}
        className="glass-card relative w-full max-w-lg space-y-5 rounded-3xl p-8 sm:p-12"
      >
        <button
          type="button"
          onClick={closeAuth}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>

        <div>
          <h1 className="text-3xl font-bold text-white">{isRegister ? 'Create your account' : 'Welcome back'}</h1>
          <p className="mt-1 text-base text-white/70">
            {isRegister ? 'Start turning your documents into answers and quizzes.' : 'Sign in to upload and study your documents.'}
          </p>
        </div>

        <ErrorBox message={error} />

        {isRegister && (
          <label className="block text-sm font-medium text-white/90">
            Name
            <input className={field} value={form.name} onChange={set('name')} required autoComplete="name" autoFocus />
          </label>
        )}
        <label className="block text-sm font-medium text-white/90">
          Email
          <input type="email" className={field} value={form.email} onChange={set('email')} required autoComplete="email" autoFocus={!isRegister} />
        </label>
        <label className="block text-sm font-medium text-white/90">
          Password
          <input type="password" className={field} value={form.password} onChange={set('password')} required autoComplete={isRegister ? 'new-password' : 'current-password'} />
        </label>

        <Button type="submit" loading={busy} className="w-full">
          {isRegister ? 'Create account' : 'Sign in'}
        </Button>

        <p className="text-center text-sm text-white/70">
          {isRegister ? 'Already have an account?' : 'New here?'}{' '}
          <button
            type="button"
            onClick={() => setAuthMode(isRegister ? 'login' : 'register')}
            className="font-medium text-indigo-300 hover:text-indigo-200 hover:underline"
          >
            {isRegister ? 'Sign in' : 'Create an account'}
          </button>
        </p>
      </form>
    </div>
  );
}