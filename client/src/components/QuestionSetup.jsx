import { useState } from 'react';
import { Button, Card, Segmented } from './ui.jsx';

/** Shared generator form for quizzes and practice sets. */
export default function QuestionSetup({ onGenerate, loading, cta, defaultType = 'mixed' }) {
  const [count, setCount] = useState(5);
  const [difficulty, setDifficulty] = useState('medium');
  const [type, setType] = useState(defaultType);
  const [mode, setMode] = useState('knowledge');
  return (
    <Card>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-700">
          Number of questions: <span className="font-bold text-indigo-700">{count}</span>
          <input type="range" min={3} max={15} value={count} onChange={(e) => setCount(Number(e.target.value))} className="mt-2 w-full accent-indigo-600" />
        </label>
        <div className="space-y-1 text-sm font-medium text-slate-700">Difficulty
          <div><Segmented label="Difficulty" value={difficulty} onChange={setDifficulty} options={[{ value: 'easy', label: 'Easy' }, { value: 'medium', label: 'Medium' }, { value: 'hard', label: 'Hard' }]} /></div>
        </div>
        <div className="space-y-1 text-sm font-medium text-slate-700">Question type
          <div><Segmented label="Question type" value={type} onChange={setType} options={[{ value: 'mcq', label: 'Multiple choice' }, { value: 'short', label: 'Short answer' }, { value: 'mixed', label: 'Mixed' }]} /></div>
        </div>
        <div className="space-y-1 text-sm font-medium text-slate-700">Focus
          <div><Segmented label="Focus" value={mode} onChange={setMode} options={[
            { value: 'knowledge', label: 'Spread across topics', hint: 'Knowledge mode: questions cover every topic' },
            { value: 'exam', label: 'Most important', hint: 'Exam mode: questions from the highest-importance passages' },
          ]} /></div>
        </div>
      </div>
      <Button className="mt-5" loading={loading} onClick={() => onGenerate({ count, difficulty, type, mode })}>{cta}</Button>
      {loading && <p className="mt-2 text-xs text-slate-500">Generating and validating questions - this can take up to a minute.</p>}
    </Card>
  );
}
