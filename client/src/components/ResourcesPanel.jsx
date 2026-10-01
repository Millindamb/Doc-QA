import { useState } from 'react';
import { errorMessage, runResources } from '../api.js';
import { Badge, Button, Card, EmptyState, ErrorBox, Spinner, WarningList } from './ui.jsx';

const compact = new Intl.NumberFormat('en', { notation: 'compact' });

export default function ResourcesPanel({ documentId, analyzed }) {
  const [query, setQuery] = useState('');
  const [r, setR] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function go(e) {
    e?.preventDefault();
    setLoading(true); setError('');
    try { setR(await runResources(documentId, query.trim())); } catch (err) { setError(errorMessage(err)); } finally { setLoading(false); }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={go} className="flex flex-wrap gap-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} maxLength={300} placeholder={analyzed ? "Optional: a specific topic (blank = use this document's topics)" : 'A topic to find resources for'} className="min-w-[240px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        <Button type="submit" loading={loading} disabled={!analyzed && !query.trim()}>Find resources</Button>
      </form>
      <ErrorBox message={error} onRetry={go} />
      {loading && <Spinner label="Searching YouTube, Wikipedia and asking for suggestions..." />}
      {!loading && !r && !error && <EmptyState title="Find study resources">Ranked YouTube videos (5-40 minutes), Wikipedia articles and clearly-labelled AI suggestions for further study.</EmptyState>}
      {r && !loading && (
        <>
          <WarningList warnings={r.warnings} />
          <section>
            <h2 className="mb-2 text-lg font-semibold text-slate-900">Videos</h2>
            {r.youtube.length === 0 ? (
              <EmptyState title="No videos to show">Add a YOUTUBE_API_KEY on the server, or nothing matched the filters (title match, 5-40 minutes).</EmptyState>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {r.youtube.map((v) => (
                  <a key={v.videoId} href={v.url} target="_blank" rel="noopener noreferrer" className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:border-indigo-300">
                    {v.thumbnail && <img src={v.thumbnail} alt="" className="h-20 w-32 shrink-0 rounded object-cover" loading="lazy" />}
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-sm font-medium text-slate-900">{v.title}</p>
                      <p className="text-xs text-slate-500">{v.channel}</p>
                      <div className="mt-1 flex flex-wrap gap-1"><Badge>{v.minutes} min</Badge><Badge>{compact.format(v.views)} views</Badge><Badge tone="indigo" title={JSON.stringify(v.scoreBreakdown)}>score {v.score}</Badge></div>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </section>
          {r.wikipedia.length > 0 && (
            <Card>
              <h2 className="mb-2 text-lg font-semibold text-slate-900">Wikipedia</h2>
              <ul className="space-y-2 text-sm">
                {r.wikipedia.map((w) => (
                  <li key={w.url}><a href={w.url} target="_blank" rel="noopener noreferrer" className="font-medium text-indigo-600 hover:underline">{w.title}</a><p className="text-xs text-slate-500">{w.snippet}</p></li>
                ))}
              </ul>
            </Card>
          )}
          {r.suggestions && (
            <Card className="border-amber-200 bg-amber-50/40">
              <div className="mb-1 flex items-center gap-2"><h2 className="text-lg font-semibold text-slate-900">Suggestions</h2><Badge tone="amber">AI-generated</Badge></div>
              <p className="mb-3 text-xs text-amber-800">{r.suggestions.label}</p>
              <h3 className="text-sm font-semibold text-slate-800">Topics to study next</h3>
              <ul className="mb-3 list-disc pl-5 text-sm text-slate-700">{r.suggestions.topics.map((t) => <li key={t.title}><span className="font-medium">{t.title}</span>{t.why && ` - ${t.why}`}</li>)}</ul>
              {r.suggestions.books.length > 0 && (
                <>
                  <h3 className="text-sm font-semibold text-slate-800">Books</h3>
                  <ul className="list-disc pl-5 text-sm text-slate-700">{r.suggestions.books.map((b) => <li key={b.title}><span className="font-medium">{b.title}</span>{b.author && ` by ${b.author}`}{b.why && ` - ${b.why}`}</li>)}</ul>
                </>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
