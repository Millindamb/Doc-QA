import { Badge, Card, EmptyState, ProviderBadge, WarningList } from './ui.jsx';

export default function OverviewPanel({ doc, analysis }) {
  if (!analysis) {
    return <EmptyState title="Not analyzed yet">Run the analysis to see key points, topics, keywords and a summary.</EmptyState>;
  }
  const maxKw = Math.max(...analysis.keywords.map((k) => k.score), 0.0001);
  return (
    <div className="space-y-5">
      <WarningList warnings={[...(doc.warnings || []), ...(analysis.warnings || [])]} />

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Key points</h2>
          <ProviderBadge provider={analysis.keyPointsProvider} />
        </div>
        {analysis.keyPoints?.length ? (
          <div className="space-y-4">
            {analysis.keyPoints.map((kp, i) => (
              <div key={i}>
                <h3 className="text-sm font-semibold text-indigo-700">{kp.topic}</h3>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-800">
                  {kp.keyPoints.map((p, j) => <li key={j}>{p}</li>)}
                </ul>
                {kp.importantTerms?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {kp.importantTerms.map((t) => <Badge key={t} tone="indigo">{t}</Badge>)}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No key points were generated (the LLM may have been unavailable). Re-run the analysis to try again.</p>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-lg font-semibold text-slate-900">Topics</h2>
          <ul className="space-y-2">
            {analysis.topics.map((t) => (
              <li key={t.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <span className="font-medium text-slate-800">{t.label}</span>
                <Badge>{t.size} chunk{t.size === 1 ? '' : 's'}</Badge>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="mb-3 text-lg font-semibold text-slate-900">Keywords</h2>
          <div className="flex flex-wrap gap-2">
            {analysis.keywords.map((k) => (
              <span key={k.term} title={`score ${k.score.toFixed(3)} (${k.sources.join(', ')})`} className="rounded-full bg-indigo-50 px-2.5 py-1 text-indigo-800" style={{ fontSize: `${0.75 + (k.score / maxKw) * 0.35}rem` }}>
                {k.term}
              </span>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Summary</h2>
        <p className="mb-2 text-xs text-slate-500">Extractive (TextRank): the most central sentences, in original order.</p>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-800">
          {analysis.summarySentences.map((s) => <li key={`${s.chunkId}-${s.position}`}>{s.text}</li>)}
        </ol>
      </Card>
    </div>
  );
}
