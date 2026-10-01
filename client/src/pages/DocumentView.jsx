import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { analyzeDocument, errorMessage, getAnalysis, getDocument } from '../api.js';
import { Badge, Button, ErrorBox, Spinner, Tabs, useLoader } from '../components/ui.jsx';
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
      <div>
        <Link to="/" className="text-sm text-slate-500 hover:text-slate-800">&larr; All documents</Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-900">{doc.title}</h1>
          <Badge tone={doc.status === 'ready' ? 'green' : doc.status === 'failed' ? 'red' : 'amber'}>{doc.status}</Badge>
          <Badge>{doc.chunks.length} chunks</Badge>
          <Badge>{doc.sourceType}</Badge>
        </div>
      </div>

      {doc.status === 'failed' && <ErrorBox message={doc.errorMessage || 'Processing failed for this document.'} />}
      {doc.status === 'ready' && !analyzed && !anaQ.loading && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
          <span>This document hasn't been analyzed yet. Analysis unlocks topics, key points, importance-aware exam mode and better quizzes.</span>
          <Button loading={analyzing} onClick={runAnalysis}>Analyze now</Button>
        </div>
      )}
      <ErrorBox message={analyzeError} />

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      <div className="pt-2">
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
