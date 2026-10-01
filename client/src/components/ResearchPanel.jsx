import { useState } from 'react';
import { errorMessage, runResearch } from '../api.js';
import { Badge, Button, Card, EmptyState, ErrorBox, ProviderBadge, Spinner, WarningList } from './ui.jsx';
import Markdown from './Markdown.jsx';

export default function ResearchPanel({ documentId, analyzed }) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function go(e) {
    e?.preventDefault();
    setLoading(true); setError('');
    try { setResult(await runResearch(documentId, query.trim())); } catch (err) { setError(errorMessage(err)); } finally { setLoading(false); }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={go} className="flex flex-wrap gap-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} maxLength={300} placeholder={analyzed ? 'Optional: a specific topic (blank = use this document\'s topics)' : 'A topic to research (analyze the document to research it automatically)'} className="min-w-[240px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        <Button type="submit" loading={loading} disabled={!analyzed && !query.trim()}>Research</Button>
      </form>
      <ErrorBox message={error} onRetry={go} />
      {loading && <Spinner label="Searching and summarising sources..." />}
      {!loading && !result && !error && <EmptyState title="Look beyond the document">Searches Tavily, Wikipedia and SerpAPI (in that order of preference) and writes a cited summary. Every link comes from a real search result.</EmptyState>}
      {result && !loading && (
        <>
          <WarningList warnings={result.warnings} />
          {result.summary ? (
            <Card>
              <div className="mb-2 flex items-center justify-between"><h2 className="text-lg font-semibold text-slate-900">Summary</h2><ProviderBadge provider={result.provider} /></div>
              <Markdown>{result.summary}</Markdown>
            </Card>
          ) : (
            <EmptyState title="No sources found">None of the search providers returned results. Try a different query.</EmptyState>
          )}
          {result.sources.length > 0 && (
            <Card>
              <h3 className="mb-3 text-sm font-semibold text-slate-900">Sources</h3>
              <ol className="space-y-3">
                {result.sources.map((s) => (
                  <li key={s.url} className="flex gap-3 text-sm">
                    <span className="font-mono text-slate-500">[{s.n}]</span>
                    <div>
                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-medium text-indigo-600 hover:underline">{s.title}</a>
                      <span className="ml-2 inline-flex gap-1"><Badge>{s.provider}</Badge>{s.cited && <Badge tone="green">cited</Badge>}</span>
                      <p className="text-xs text-slate-500">{s.snippet}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          )}
          <p className="text-xs text-slate-400">Queries used: {result.queries.join(' | ')}</p>
        </>
      )}
    </div>
  );
}
