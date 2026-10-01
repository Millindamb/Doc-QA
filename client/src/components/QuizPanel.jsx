import { useEffect, useState } from 'react';
import { createQuiz, errorMessage, getQuiz, getWeakAreas, listQuizzes, submitAttempt } from '../api.js';
import { Badge, Button, Card, EmptyState, ErrorBox, ProgressBar, ProviderBadge, Spinner, WarningList, useLoader } from './ui.jsx';
import QuestionSetup from './QuestionSetup.jsx';

export function WeakAreas({ topics, attempts }) {
  if (!attempts) return <EmptyState title="No weak-area data yet">Take a quiz and your accuracy per topic will show up here.</EmptyState>;
  return (
    <Card>
      <h3 className="mb-3 text-sm font-semibold text-slate-900">Accuracy by topic <span className="font-normal text-slate-500">({attempts} attempt{attempts === 1 ? '' : 's'})</span></h3>
      <ul className="space-y-3">
        {topics.map((t) => (
          <li key={t.topicId}>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="text-slate-800">{t.label}</span>
              <span className="flex items-center gap-2">{t.weak && <Badge tone="red">weak - review this</Badge>}<span className="tabular-nums text-slate-600">{t.percent}%</span></span>
            </div>
            <ProgressBar percent={t.percent} tone={t.weak ? 'red' : 'green'} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function QuizPanel({ documentId, initialQuizId }) {
  const [phase, setPhase] = useState('setup'); // setup | taking | results
  const [quiz, setQuiz] = useState(null);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const weak = useLoader(() => getWeakAreas(documentId), [documentId, result?.attemptId]);
  const past = useLoader(() => listQuizzes(documentId).then((l) => l.filter((q) => q.kind === 'quiz')), [documentId, quiz?.id]);

  async function open(id) {
    setBusy(true);
    setError('');
    try {
      const q = await getQuiz(id);
      setQuiz(q); setAnswers({}); setResult(null); setPhase('taking');
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  useEffect(() => { if (initialQuizId) open(initialQuizId); /* eslint-disable-next-line */ }, [initialQuizId]);

  async function generate(params) {
    setBusy(true);
    setError('');
    try {
      const q = await createQuiz({ documentId, ...params });
      setQuiz(q); setAnswers({}); setResult(null); setPhase('taking');
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  async function submit() {
    const unanswered = quiz.questions.filter((q) => !answers[q.id]?.trim()).length;
    if (unanswered && !window.confirm(`${unanswered} question${unanswered === 1 ? ' is' : 's are'} unanswered and will score 0. Submit anyway?`)) return;
    setBusy(true);
    setError('');
    try {
      setResult(await submitAttempt(quiz.id, quiz.questions.map((q) => ({ questionId: q.id, response: answers[q.id] || '' }))));
      setPhase('results');
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  if (phase === 'setup') {
    return (
      <div className="space-y-5">
        <ErrorBox message={error} />
        <QuestionSetup onGenerate={generate} loading={busy} cta="Generate quiz" />
        {weak.loading ? <Spinner /> : <WeakAreas topics={weak.data?.topics || []} attempts={weak.data?.attempts} />}
        {past.data?.length > 0 && (
          <Card>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Previous quizzes</h3>
            <ul className="divide-y divide-slate-100 text-sm">
              {past.data.map((q) => (
                <li key={q.id} className="flex items-center justify-between py-2">
                  <span>{q.count} questions - {q.difficulty} - {q.type} <span className="text-slate-400">({new Date(q.createdAt).toLocaleDateString()})</span></span>
                  <Button variant="secondary" onClick={() => open(q.id)}>Take again</Button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    );
  }

  if (phase === 'taking') {
    const answered = quiz.questions.filter((q) => answers[q.id]?.trim()).length;
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2"><Badge tone="indigo">{quiz.difficulty}</Badge><Badge>{quiz.mode}</Badge><ProviderBadge provider={quiz.provider} /><span className="text-sm text-slate-500">{answered}/{quiz.questions.length} answered</span></div>
          <Button variant="secondary" onClick={() => setPhase('setup')}>Cancel</Button>
        </div>
        <WarningList warnings={quiz.warnings} />
        <ErrorBox message={error} />
        {quiz.questions.map((q, i) => (
          <Card key={q.id}>
            <p className="mb-3 text-sm font-medium text-slate-900">{i + 1}. {q.question}</p>
            {q.type === 'mcq' ? (
              <div role="radiogroup" className="space-y-2">
                {q.options.map((o) => (
                  <label key={o} className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm ${answers[q.id] === o ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                    <input type="radio" name={q.id} checked={answers[q.id] === o} onChange={() => setAnswers((a) => ({ ...a, [q.id]: o }))} className="accent-indigo-600" />
                    {o}
                  </label>
                ))}
              </div>
            ) : (
              <textarea rows={3} value={answers[q.id] || ''} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} placeholder="Type your answer..." className="w-full rounded-lg border border-slate-300 p-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
            )}
          </Card>
        ))}
        <Button loading={busy} onClick={submit}>Submit answers</Button>
      </div>
    );
  }

  // results
  const tone = result.percent >= 80 ? 'green' : result.percent >= 60 ? 'indigo' : 'red';
  return (
    <div className="space-y-5">
      <Card className="text-center">
        <p className="text-sm text-slate-500">Your score</p>
        <p className="text-4xl font-bold text-slate-900">{result.score} / {result.total}</p>
        <div className="mx-auto mt-2 max-w-xs"><ProgressBar percent={result.percent} tone={tone} /></div>
        <p className="mt-1 text-sm text-slate-600">{result.percent}%</p>
        {result.weakTopics.length > 0 && <p className="mt-3 text-sm text-red-700">Review: {result.weakTopics.map((t) => t.label).join(', ')}</p>}
      </Card>
      <WeakAreas topics={result.perTopic.map((t) => ({ ...t, weak: t.percent < 60 }))} attempts={1} />
      <h3 className="text-sm font-semibold text-slate-900">Review your answers</h3>
      {quiz.questions.map((q, i) => {
        const r = result.results.find((x) => x.questionId === q.id);
        return (
          <Card key={q.id} className={r.correct ? 'border-green-300' : r.score > 0 ? 'border-amber-300' : 'border-red-300'}>
            <div className="mb-2 flex items-start justify-between gap-2">
              <p className="text-sm font-medium text-slate-900">{i + 1}. {q.question}</p>
              <Badge tone={r.correct ? 'green' : r.score > 0 ? 'amber' : 'red'}>{r.correct ? 'correct' : r.score > 0 ? 'partial' : 'incorrect'}</Badge>
            </div>
            <p className="text-sm text-slate-600"><span className="font-medium">Your answer:</span> {r.response || <em>(blank)</em>}</p>
            <p className="text-sm text-slate-800"><span className="font-medium">Correct answer:</span> {r.answer}</p>
            {r.missing?.length > 0 && !r.correct && <p className="text-xs text-slate-500">Key terms missing from your answer: {r.missing.join(', ')}</p>}
            <p className="mt-2 rounded-md bg-slate-50 p-2 text-sm text-slate-700">{r.explanation}</p>
            <div className="mt-2 flex gap-2">{r.sourceChunk && <Badge tone="indigo">source: chunk [{r.sourceChunk}]</Badge>}<Badge>{r.topicLabel}</Badge></div>
          </Card>
        );
      })}
      <div className="flex gap-3">
        <Button onClick={() => open(quiz.id)}>Retake this quiz</Button>
        <Button variant="secondary" onClick={() => setPhase('setup')}>New quiz</Button>
      </div>
    </div>
  );
}
