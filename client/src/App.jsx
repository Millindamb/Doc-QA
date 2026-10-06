import { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import * as api from './api.js';
import GuestHome from './pages/GuestHome.jsx';
import AuthModal from './components/AuthModal.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Upload from './pages/Upload.jsx';
import DocumentView from './pages/DocumentView.jsx';
import { useTheme } from './theme.js';
import './dark-theme.css';

/* ---------- helpers ---------- */
const docId = (d) => d.id || d._id;
const docTitle = (d) => d.title || d.filename || d.name || 'Untitled';

/* ---------- inline icons (no extra package needed) ---------- */
const Svg = ({ children }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
const SidebarIcon = () => <Svg><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" /></Svg>;
const NewIcon = () => <Svg><path d="M12 4H7a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-5" /><path d="M18.4 3.6a2 2 0 0 1 2.8 2.8L12 15.6 8 16l.4-4z" /></Svg>;
const SearchIcon = () => <Svg><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></Svg>;
const FolderIcon = () => <Svg><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Svg>;
const ChatIcon = () => <Svg><path d="M21 12a8 8 0 0 1-11.7 7L4 20l1.1-4.6A8 8 0 1 1 21 12z" /></Svg>;
const LogoutIcon = () => <Svg><path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" /><path d="M16 8l4 4-4 4M20 12H9" /></Svg>;
const LoginIcon = () => <Svg><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 8l4 4-4 4M14 12H4" /></Svg>;
const SunIcon = () => <Svg><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Svg>;
const MoonIcon = () => <Svg><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></Svg>;

// Paperly logo mark: a document on an indigo tile
function Logo({ size = 36 }) {
  return (
    <div style={{ width: size, height: size }} className="flex shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white">
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
        <path d="M14 3v5h5" />
        <path d="M9 13h6M9 17h4" />
      </svg>
    </div>
  );
}

function useDesktop() {
  const q = '(min-width: 768px)';
  const [match, setMatch] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const h = (e) => setMatch(e.matches);
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, []);
  return match;
}

const rowBase = 'flex items-center rounded-lg text-sm transition-colors';
const rowClass = (compact) => ({ isActive }) =>
  `${rowBase} ${compact ? 'h-11 w-11 justify-center' : 'gap-3 px-3 py-2'} ${isActive ? 'sb-active sb-strong' : 'sb-text sb-hover'}`;
const btnClass = (compact) =>
  `${rowBase} ${compact ? 'h-11 w-11 justify-center' : 'gap-3 px-3 py-2 w-full text-left'} sb-text sb-hover`;

/* ---------- search modal: searches document titles and chat messages ---------- */
function snippet(text, q) {
  const i = text.toLowerCase().indexOf(q);
  const start = Math.max(0, i - 30);
  const s = text.slice(start, start + 110).replace(/\s+/g, ' ');
  return (start > 0 ? '…' : '') + s + (start + 110 < text.length ? '…' : '');
}

function SearchModal({ docs, onClose }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState([]);
  const [loading, setLoading] = useState(true);

  // load chat history for the user's documents once when the modal opens
  useEffect(() => {
    let alive = true;
    const out = [];
    (async () => {
      await Promise.all(
        docs.slice(0, 25).map(async (d) => {
          try {
            const sessions = await api.listSessions(docId(d));
            for (const s of (sessions || []).slice(0, 5)) {
              try {
                const full = await api.getSession(s.id);
                for (const m of full.messages || []) {
                  if (m?.content) out.push({ id: docId(d), title: docTitle(d), role: m.role, text: String(m.content) });
                }
              } catch { /* skip a session that fails */ }
            }
          } catch { /* skip a document that fails */ }
        })
      );
      if (alive) { setIndex(out); setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const titleHits = q ? docs.filter((d) => docTitle(d).toLowerCase().includes(q)) : docs.slice(0, 8);
  const chatHits = q ? index.filter((e) => e.text.toLowerCase().includes(q)).slice(0, 20) : [];

  const open = (id) => { navigate(`/documents/${id}`); onClose(); };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[12vh]" onClick={onClose}>
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border sb-border sb-bg sb-strong shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b sb-border px-4 py-3 sb-muted">
          <SearchIcon />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your documents and chats"
            className="chat-input flex-1 border-0 bg-transparent text-base sb-strong outline-none"
          />
          <button onClick={onClose} className="rounded-md px-2 py-1 text-xs sb-muted sb-hover">Esc</button>
        </div>

        <div className="max-h-[55vh] overflow-y-auto p-2">
          {titleHits.length > 0 && (
            <>
              <div className="px-3 py-1 text-xs sb-muted">{q ? 'Documents' : 'Recent documents'}</div>
              {titleHits.map((d) => (
                <button key={docId(d)} onClick={() => open(docId(d))} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm sb-hover">
                  <ChatIcon /><span className="truncate">{docTitle(d)}</span>
                </button>
              ))}
            </>
          )}

          {q && chatHits.length > 0 && (
            <>
              <div className="mt-2 px-3 py-1 text-xs sb-muted">Chat messages</div>
              {chatHits.map((e, i) => (
                <button key={i} onClick={() => open(e.id)} className="block w-full rounded-lg px-3 py-2 text-left sb-hover">
                  <div className="truncate text-sm">{snippet(e.text, q)}</div>
                  <div className="mt-0.5 text-xs sb-muted">{e.title} · {e.role === 'user' ? 'You' : 'Paperly'}</div>
                </button>
              ))}
            </>
          )}

          {q && loading && <p className="px-3 py-3 text-sm sb-muted">Searching chats...</p>}
          {q && !loading && titleHits.length === 0 && chatHits.length === 0 && (
            <p className="px-3 py-6 text-center text-sm sb-muted">No results for "{query.trim()}"</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- sidebar ---------- */
function Sidebar({ compact, onToggle, onNavigate, onSearch, docs }) {
  const { user, logout, token, openAuth } = useAuth();
  const navigate = useNavigate();
  const guest = !token;
  const doLogout = () => { navigate('/'); logout(); };

  const name = user?.name || user?.email || 'You';
  const initials = name.slice(0, 2).toUpperCase();
  const go = (path) => { navigate(path); onNavigate?.(); };

  /* collapsed icon rail: logo on top, then the open button */
  if (compact) {
    return (
      <div className="flex h-full flex-col items-center gap-1 py-3">
        {/* logo and open-sidebar button share one spot: the logo shows normally, the button replaces it while the rail is hovered */}
        <button onClick={onToggle} title="Open sidebar" aria-label="Open sidebar" className="relative mb-1 h-11 w-11 shrink-0">
          <span className="absolute inset-0 flex items-center justify-center transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0"><Logo /></span>
          <span className="absolute inset-0 flex items-center justify-center rounded-lg opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 sb-text sb-hover"><SidebarIcon /></span>
        </button>
        <button onClick={() => go('/upload')} title="New document" aria-label="New document" className={btnClass(true)}><NewIcon /></button>
        <button onClick={onSearch} title="Search chats" aria-label="Search chats" className={btnClass(true)}><SearchIcon /></button>
        <NavLink to="/" end title="All documents" aria-label="All documents" className={rowClass(true)}><FolderIcon /></NavLink>
        <button onClick={onToggle} title="Recent documents" aria-label="Recent documents" className={btnClass(true)}><ChatIcon /></button>
        <div className="flex-1" />
        {guest ? (
          <button onClick={() => openAuth('login')} title="Sign in" aria-label="Sign in" className={btnClass(true)}><LoginIcon /></button>
        ) : (
          <>
            <button onClick={doLogout} title="Log out" aria-label="Log out" className={btnClass(true)}><LogoutIcon /></button>
            <button onClick={onToggle} title={name} aria-label="Open sidebar" className="mt-1 flex h-9 w-9 items-center justify-center rounded-full bg-purple-500 text-xs font-semibold text-white">{initials}</button>
          </>
        )}
      </div>
    );
  }

  /* full sidebar */
  return (
    <div className="flex h-full flex-col p-2">
      <div className="flex items-center justify-between px-1 py-2">
        <button onClick={() => go('/')} className="flex items-center gap-2 text-lg font-semibold sb-strong">
          <Logo size={32} />Paperly
        </button>
        <button onClick={onToggle} title="Close sidebar" aria-label="Close sidebar" className="rounded-lg p-2 sb-text sb-hover"><SidebarIcon /></button>
      </div>

      <button onClick={() => go('/upload')} className={`${btnClass(false)} mt-1`}><NewIcon />New document</button>
      <button onClick={onSearch} className={btnClass(false)}><SearchIcon />Search chats</button>
      <NavLink to="/" end onClick={onNavigate} className={rowClass(false)}><FolderIcon />All documents</NavLink>

      <div className="mt-5 px-3 text-xs sb-muted">Recent documents</div>
      <div className="mt-1 flex-1 space-y-0.5 overflow-y-auto">
        {docs.length === 0 && <p className="px-3 py-2 text-sm sb-muted">{guest ? 'Sign in to see your documents' : 'No documents yet'}</p>}
        {docs.map((d) => (
          <NavLink key={docId(d)} to={`/documents/${docId(d)}`} onClick={onNavigate} className={rowClass(false)}>
            <ChatIcon />
            <span className="truncate">{docTitle(d)}</span>
          </NavLink>
        ))}
      </div>

      {guest ? (
        <div className="space-y-2 border-t sb-border px-1 pt-3">
          <button onClick={() => openAuth('login')} className="w-full rounded-xl bg-indigo-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500">Sign in</button>
          <button onClick={() => openAuth('register')} className="w-full rounded-xl px-3 py-2 text-sm sb-text sb-hover">Create account</button>
        </div>
      ) : (
        <div className="flex items-center justify-between border-t sb-border px-2 pt-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-500 text-xs font-semibold text-white">{initials}</div>
            <span className="truncate text-sm sb-strong">{name}</span>
          </div>
          <button onClick={doLogout} title="Log out" aria-label="Log out" className="ml-2 shrink-0 rounded-lg p-2 sb-muted sb-hover"><LogoutIcon /></button>
        </div>
      )}
    </div>
  );
}

/* ---------- layout ---------- */
function Layout({ children }) {
  const isDesktop = useDesktop();
  const location = useLocation();
  const { theme, toggle: toggleTheme } = useTheme();
  const { token, openAuth } = useAuth();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === '1');
  const [drawer, setDrawer] = useState(false); // mobile only
  const [searchOpen, setSearchOpen] = useState(false);
  const [docs, setDocs] = useState([]);

  // CHANGE if your api.js names this function differently
  const loadDocs = api.listDocuments || api.getDocuments;

  useEffect(() => {
    if (!loadDocs || !token) { setDocs([]); return; }
    let alive = true;
    loadDocs()
      .then((d) => { if (alive) setDocs(Array.isArray(d) ? d : d?.documents || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [location.pathname, token]); // refresh after uploads / deletes

  useEffect(() => { localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0'); }, [collapsed]);

  // Ctrl+K / Cmd+K opens search
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const compact = isDesktop && collapsed;
  const toggle = () => (isDesktop ? setCollapsed((c) => !c) : setDrawer(false));
  const openSearch = () => { setDrawer(false); if (!token) openAuth('login'); else setSearchOpen(true); };

  return (
    <div className="flex h-[100dvh] bg-white text-slate-900">
      {drawer && <div className="fixed inset-0 z-20 bg-black/50 md:hidden" onClick={() => setDrawer(false)} />}

      <aside
        className={`group fixed z-30 h-full w-64 border-r sb-border sb-bg transition-all duration-200 md:static md:translate-x-0 ${
          compact ? 'md:w-[72px]' : 'md:w-64'
        } ${drawer ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <Sidebar compact={compact} onToggle={toggle} onNavigate={() => setDrawer(false)} onSearch={openSearch} docs={docs} />
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="sticky top-0 z-10 shrink-0 bg-white">
        <div className="flex h-12 items-center border-b sb-border px-3">
          <div className="flex items-center md:hidden">
            <button onClick={() => setDrawer(true)} className="rounded-lg p-2 hover:bg-slate-100" aria-label="Open menu"><SidebarIcon /></button>
          </div>
          {/* pages (e.g. a document) can render their navbar here via a portal */}
          <div id="topbar-slot" className="flex min-w-0 flex-1 items-stretch self-stretch" />
          {!token && (
            <button
              onClick={() => openAuth('login')}
              className="mr-2 shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Sign in
            </button>
          )}
          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            aria-label="Toggle theme"
            className="ml-auto shrink-0 rounded-lg p-2 text-slate-600 hover:bg-slate-100"
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
        {/* mobile sub navbar (document tabs) is rendered here by DocumentView */}
        <div id="subnav-slot" className="md:hidden" />
        </div>
        <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-4">{children}</div>
      </main>

      {searchOpen && <SearchModal docs={docs} onClose={() => setSearchOpen(false)} />}
    </div>
  );
}

// a guest who opens a protected page goes to the home page and gets the sign-in card
function GuestGate() {
  const { openAuth } = useAuth();
  const navigate = useNavigate();
  useEffect(() => { navigate('/', { replace: true }); openAuth('login'); }, []);
  return null;
}

// /login and /register still work as links: they open the card over the home page
function AuthRedirect({ mode }) {
  const { token, openAuth } = useAuth();
  const navigate = useNavigate();
  useEffect(() => { navigate('/', { replace: true }); if (!token) openAuth(mode); }, []);
  return null;
}

function Gated({ children }) {
  const { token } = useAuth();
  return <Layout>{token ? children : <GuestGate />}</Layout>;
}

export default function App() {
  const { token } = useAuth();
  return (
    <>
      <Routes>
        <Route path="/login" element={<AuthRedirect mode="login" />} />
        <Route path="/register" element={<AuthRedirect mode="register" />} />
        <Route path="/" element={<Layout>{token ? <Dashboard /> : <GuestHome />}</Layout>} />
        <Route path="/upload" element={<Gated><Upload /></Gated>} />
        <Route path="/documents/:id" element={<Gated><DocumentView /></Gated>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <AuthModal />
    </>
  );
}