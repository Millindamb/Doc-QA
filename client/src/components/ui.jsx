import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../api.js';

export function Spinner({ label = 'Loading...', className = '' }) {
  return (
    <div role="status" className={`flex items-center justify-center gap-3 py-10 text-slate-500 ${className}`}>
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function ErrorBox({ message, onRetry, className = '' }) {
  if (!message) return null;
  return (
    <div role="alert" className={`flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 ${className}`}>
      <span>{message}</span>
      {onRetry && (
        <button onClick={onRetry} className="shrink-0 rounded border border-red-300 px-2 py-0.5 font-medium hover:bg-red-100">
          Retry
        </button>
      )}
    </div>
  );
}

export function WarningList({ warnings = [] }) {
  if (!warnings.length) return null;
  return (
    <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
      {warnings.map((w, i) => (
        <li key={i}>{w}</li>
      ))}
    </ul>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <h3 className="text-base font-semibold text-slate-800">{title}</h3>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

const btn = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-300',
  secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'border border-red-300 bg-white text-red-700 hover:bg-red-50 disabled:text-red-300',
};
export function Button({ variant = 'primary', className = '', loading = false, children, ...props }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed ${btn[variant]} ${className}`}
    >
      {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
      {children}
    </button>
  );
}

export function Card({ className = '', children }) {
  return <div className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>{children}</div>;
}

const tones = {
  slate: 'bg-slate-100 text-slate-700',
  indigo: 'bg-indigo-100 text-indigo-700',
  green: 'bg-green-100 text-green-700',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-700',
  sky: 'bg-sky-100 text-sky-700',
  violet: 'bg-violet-100 text-violet-700',
};
export function Badge({ tone = 'slate', title, children }) {
  return (
    <span title={title} className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** Which LLM answered (Gemini primary / Groq fallback). */
export function ProviderBadge({ provider }) {
  if (!provider) return null;
  return (
    <Badge tone={provider === 'gemini' ? 'sky' : provider === 'groq' ? 'violet' : 'slate'} title="LLM provider that produced this">
      {provider}
    </Badge>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div role="tablist" className="flex flex-wrap gap-1 border-b border-slate-200">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
            active === t.id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Segmented({ options, value, onChange, label }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-slate-300 bg-slate-100 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          title={o.hint}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1 text-sm font-medium transition ${value === o.value ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ProgressBar({ percent, tone = 'indigo' }) {
  const color = tone === 'red' ? 'bg-red-500' : tone === 'green' ? 'bg-green-500' : 'bg-indigo-600';
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
      <div className={`h-full ${color} transition-all`} style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
    </div>
  );
}

/** Tiny data-loading hook: { data, loading, error, reload }. */
export function useLoader(fn, deps) {
  const [state, setState] = useState({ data: null, loading: true, error: '' });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: '' }));
    fnRef.current()
      .then((data) => alive && setState({ data, loading: false, error: '' }))
      .catch((e) => alive && setState({ data: null, loading: false, error: errorMessage(e) }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

export function useToggleSet() {
  const [set, setSet] = useState(new Set());
  return [set, (k) => setSet((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; }), setSet];
}
