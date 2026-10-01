import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth, useAuth } from './auth.jsx';
import AuthPage from './pages/AuthPage.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Upload from './pages/Upload.jsx';
import DocumentView from './pages/DocumentView.jsx';
import { Button } from './components/ui.jsx';

function Layout({ children }) {
  const { user, logout } = useAuth();
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/" className="text-lg font-bold text-indigo-700">DocQA</Link>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span className="hidden sm:inline">{user?.name || user?.email}</span>
            <Button variant="secondary" onClick={logout}>Log out</Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}

const Protected = ({ children }) => <RequireAuth><Layout>{children}</Layout></RequireAuth>;

export default function App() {
  const { token } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={token ? <Navigate to="/" replace /> : <AuthPage mode="login" />} />
      <Route path="/register" element={token ? <Navigate to="/" replace /> : <AuthPage mode="register" />} />
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/upload" element={<Protected><Upload /></Protected>} />
      <Route path="/documents/:id" element={<Protected><DocumentView /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
