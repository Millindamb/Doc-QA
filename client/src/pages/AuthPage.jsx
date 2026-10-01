import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { errorMessage } from '../api.js';
import { Button, ErrorBox } from '../components/ui.jsx';

const input = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';

export default function AuthPage({ mode }) {
  const isRegister = mode === 'register';
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (isRegister && form.password.length < 6) return setError('Password must be at least 6 characters.');
    setBusy(true);
    try {
      if (isRegister) await register(form.name, form.email, form.password);
      else await login(form.email, form.password);
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">DocQA</h1>
          <p className="text-sm text-slate-500">{isRegister ? 'Create your account' : 'Sign in to your study workspace'}</p>
        </div>
        <ErrorBox message={error} />
        {isRegister && (
          <label className="block text-sm font-medium text-slate-700">
            Name
            <input className={input} value={form.name} onChange={set('name')} required autoComplete="name" />
          </label>
        )}
        <label className="block text-sm font-medium text-slate-700">
          Email
          <input type="email" className={input} value={form.email} onChange={set('email')} required autoComplete="email" />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Password
          <input type="password" className={input} value={form.password} onChange={set('password')} required autoComplete={isRegister ? 'new-password' : 'current-password'} />
        </label>
        <Button type="submit" loading={busy} className="w-full">
          {isRegister ? 'Create account' : 'Sign in'}
        </Button>
        <p className="text-center text-sm text-slate-500">
          {isRegister ? 'Already have an account?' : 'New here?'}{' '}
          <Link to={isRegister ? '/login' : '/register'} className="font-medium text-indigo-600 hover:underline">
            {isRegister ? 'Sign in' : 'Create an account'}
          </Link>
        </p>
      </form>
    </div>
  );
}
