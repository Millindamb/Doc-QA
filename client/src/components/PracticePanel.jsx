import { useEffect, useState } from 'react';
import { createPractice, errorMessage, getQuiz, listQuizzes } from '../api.js';
import { Badge, Button, Card, ErrorBox, ProviderBadge, WarningList, useLoader, useToggleSet } from './ui.jsx';
import QuestionSetup from './QuestionSetup.jsx';

export default function PracticePanel({ documentId, initialSetId }) {
  const [set, setSet] = useState(null);
  const [attempts, setAttempts] = useState({});
  const [revealed, toggle, setRevealed] = useToggleSet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const past = useLoader(() => listQuizzes(documentId).then((l) => l.filter((q) => q.kind === 'practice')), [documentId, set?.id]);

  async function open(id) {
    setBusy(true); setError('');
    try { setSet(await getQuiz(id)); setAttempts({}); setRevealed(new Set()); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  useEffect(() => { if (initialSetId) open(initialSetId); /* eslint-disable-next-line */ }, [initialSetId]);

  async function generate(params) {
    setBusy(true); setError('');
    try { setSet(await createPractice({ documentId, ...params })); setAttempts({}); setRevealed(new Set()); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  if (!set) {
    return (
      <div className="space-y-5">
        <ErrorBox message={error} />
        <QuestionSetup onGenerate={generate} loading={busy} cta="Generate practice questions" defaultType="short" />
        {past.data?.length > 0 && (
          <Card>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Previous practice sets</h3>
            <ul className="divide-y divide-slate-100 text-sm">
              {past.data.map((q) => (
                <li key={q.id} className="flex items-center justify-between py-2">
                  <span>{q.count} questions - {q.difficulty} <span className="text-slate-400">({new Date(q.createdAt).toLocaleDateString()})</span></span>
                  <Button variant="secondary" onClick={() => open(q.id)}>Open</Button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    );
  }

  const allRevealed = revealed.size === set.questions.length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><Badge tone="indigo">{set.difficulty}</Badge><Badge>{set.mode}</Badge><ProviderBadge provider={set.provider} /></div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setRevealed(allRevealed ? new Set() : new Set(set.questions.map((q) => q.id)))}>{allRevealed ? 'Hide all answers' : 'Reveal all answers'}</Button>
          <Button variant="secondary" onClick={() => setSet(null)}>New set</Button>
        </div>
      </div>
      <WarningList warnings={set.warnings} />
      <p className="text-sm text-slate-500">Write your own attempt first, then reveal the model answer to compare. Nothing here is graded or saved.</p>
      {set.questions.map((q, i) => (
        <Card key={q.id}>
          <p className="mb-2 text-sm font-medium text-slate-900">{i + 1}. {q.question}</p>
          {q.options?.length > 0 && <ul className="mb-2 list-[upper-alpha] pl-6 text-sm text-slate-700">{q.options.map((o) => <li key={o}>{o}</li>)}</ul>}
          <textarea rows={3} value={attempts[q.id] || ''} onChange={(e) => setAttempts((a) => ({ ...a, [q.id]: e.target.value }))} placeholder="Your attempt..." className="w-full rounded-lg border border-slate-300 p-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          <Button variant="secondary" className="mt-2" onClick={() => toggle(q.id)}>{revealed.has(q.id) ? 'Hide model answer' : 'Reveal model answer'}</Button>
          {revealed.has(q.id) && (
            <div className="mt-3 space-y-1 rounded-lg bg-green-50 p-3 text-sm">
              <p className="text-slate-900"><span className="font-semibold">Model answer:</span> {q.answer}</p>
              <p className="text-slate-700">{q.explanation}</p>
              <div className="flex gap-2 pt-1">{q.sourceChunk && <Badge tone="indigo">source: chunk [{q.sourceChunk}]</Badge>}<Badge>{q.topicLabel}</Badge></div>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
