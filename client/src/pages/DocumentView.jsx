import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useParams } from 'react-router-dom';
import { analyzeDocument, errorMessage, getAnalysis, getDocument } from '../api.js';
import { Badge, Button, ErrorBox, Spinner, useLoader } from '../components/ui.jsx';
import OverviewPanel from '../components/OverviewPanel.jsx';
import ChatPanel from '../components/ChatPanel.jsx';
import QuizPanel from '../components/QuizPanel.jsx';
import PracticePanel from '../components/PracticePanel.jsx';
import ResearchPanel from '../components/ResearchPanel.jsx';
import ResourcesPanel from '../components/ResourcesPanel.jsx';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'chat', label: 'Chat' },
  { id: 'quiz', label: 'Quiz' },
  { id: 'practice', label: 'Practice' },
  { id: 'research', label: 'Research' },
  { id: 'resources', label: 'Resources' },
];

// Renders its children inside the app's top bar (the #topbar-slot element in App.jsx)
function NavSlot({ children }) {
  const [el, setEl] = useState(null);
  useEffect(() => { setEl(document.getElementById('topbar-slot')); }, []);
  return el ? createPortal(children, el) : null;
}

export default function DocumentView() {
  const { id } = useParams();
  const [tab, setTab] = useState('overview');
  const [openQuizId, setOpenQuizId] = useState(null);
  const [openPracticeId, setOpenPracticeId] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState('');

  const docQ = useLoader(() => getDocument(id), [id]);
  const anaQ = useLoader(() => getAnalysis(id).catch((e) => (e?.response?.status === 404 ? null : Promise.reject(e))), [id]);

  async function runAnalysis() {
    setAnalyzing(true);
    setAnalyzeError('');
    try {
      await analyzeDocument(id);
      anaQ.reload();
      docQ.reload();
    } catch (err) {
      setAnalyzeError(errorMessage(err));
    } finally {
      setAnalyzing(false);
    }
  }

  if (docQ.loading) return <Spinner label="Loading document..." />;
  if (docQ.error) return <ErrorBox message={docQ.error} onRetry={docQ.reload} />;
  const doc = docQ.data;
  const analyzed = Boolean(anaQ.data);

  function openFromChat(kind, quizId) {
    if (kind === 'practice') setOpenPracticeId(quizId);
    else setOpenQuizId(quizId);
    setTab(kind === 'practice' ? 'practice' : 'quiz');
  }

  return (
    <div className="space-y-4">
      {/* ---- navbar: back, title, badges and tabs live in the top bar ---- */}
      <NavSlot>
        <div className="flex min-w-0 flex-1 items-stretch gap-2">
          <Link
            to="/"
            title="All documents"
            aria-label="All documents"
            className="my-auto shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </Link>

          <div className="my-auto flex min-w-0 shrink items-center gap-2">
            <h1 className="max-w-[8rem] truncate text-sm font-semibold text-slate-900 sm:max-w-[13rem] lg:max-w-xs" title={doc.title}>{doc.title}</h1>
            <div className="hidden items-center gap-1.5 xl:flex">
              <Badge tone={doc.status === 'ready' ? 'green' : doc.status === 'failed' ? 'red' : 'amber'}>{doc.status}</Badge>
              <Badge>{doc.chunks.length} chunks</Badge>
              <Badge>{doc.sourceType}</Badge>
            </div>
          </div>

          <nav className="ml-2 flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto" role="tablist" aria-label="Document sections">
            {TABS.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.id)}
                  className={`flex shrink-0 items-center border-b-2 px-3 text-sm font-medium transition-colors ${
                    active ? 'border-indigo-500 text-indigo-600' : 'border-transparent sb-muted sb-strong-hover'
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </nav>
        </div>
      </NavSlot>

      {doc.status === 'failed' && <ErrorBox message={doc.errorMessage || 'Processing failed for this document.'} />}
      {doc.status === 'ready' && !analyzed && !anaQ.loading && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
          <span>This document hasn't been analyzed yet. Analysis unlocks topics, key points, importance-aware exam mode and better quizzes.</span>
          <Button loading={analyzing} onClick={runAnalysis}>Analyze now</Button>
        </div>
      )}
      <ErrorBox message={analyzeError} />

      <div>
        {doc.status !== 'ready' ? (
          <p className="text-sm text-slate-500">This document is not ready yet.</p>
        ) : (
          <>
            {tab === 'overview' && (anaQ.loading ? <Spinner /> : anaQ.error ? <ErrorBox message={anaQ.error} onRetry={anaQ.reload} /> : <OverviewPanel doc={doc} analysis={anaQ.data} />)}
            {/* chat keeps its state while you switch tabs */}
            <div hidden={tab !== 'chat'}><ChatPanel documentId={id} onOpenSet={openFromChat} /></div>
            {tab === 'quiz' && <QuizPanel documentId={id} initialQuizId={openQuizId} />}
            {tab === 'practice' && <PracticePanel documentId={id} initialSetId={openPracticeId} />}
            {tab === 'research' && <ResearchPanel documentId={id} analyzed={analyzed} />}
            {tab === 'resources' && <ResourcesPanel documentId={id} analyzed={analyzed} />}
          </>
        )}
      </div>
    </div>
  );
}