import { useEffect, useRef, useState } from 'react';
import { errorMessage, getSession, listSessions, sendChat } from '../api.js';
import { Badge, Button, ErrorBox, ProviderBadge, Segmented, Spinner, WarningList } from './ui.jsx';
import Markdown from './Markdown.jsx';
import SourceChip from './SourceChip.jsx';

const MODES = [
  { value: 'knowledge', label: 'Knowledge', hint: 'In-depth answers with background, examples and analogies (top 8 passages by relevance)' },
  { value: 'exam', label: 'Exam', hint: 'Concise, definitions first, likely exam questions (top 5 passages re-ranked by importance)' },
];
const SUGGESTIONS = ['Summarize the main ideas of this document', 'What are the key definitions I should know?', "I don't understand the most difficult concept - explain it simply", 'Quiz me on this document', 'Find videos to study this topic'];
const intentTone = { question: 'slate', doubt: 'amber', quiz: 'indigo', practice: 'indigo', research: 'green', resources: 'green' };

export default function ChatPanel({ documentId, onOpenSet }) {
  const [messages, setMessages] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [mode, setMode] = useState('knowledge');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);

  // restore the most recent conversation for this document
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const sessions = await listSessions(documentId);
        if (sessions.length && alive) {
          const s = await getSession(sessions[0].id);
          if (!alive) return;
          setSessionId(s.id);
          setMode(s.mode || 'knowledge');
          setMessages(s.messages.map((m) => ({ role: m.role, content: m.content, provider: m.provider, intent: m.intent, mode: m.mode, sources: m.sources || [], insufficient: m.insufficient, payload: m.payload })));
        }
      } catch {
        /* a missing history is not fatal */
      } finally {
        if (alive) setRestoring(false);
      }
    })();
    return () => { alive = false; };
  }, [documentId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, sending]);

  async function send(text) {
    const message = (text ?? input).trim();
    if (!message || sending) return;
    setError('');
    setInput('');
    setMessages((m) => [...m, { role: 'user', content: message, mode }]);
    setSending(true);
    try {
      const r = await sendChat({ documentId, sessionId: sessionId || undefined, message, mode });
      setSessionId(r.sessionId);
      setMessages((m) => [...m, { role: 'assistant', content: r.answer, provider: r.provider, intent: r.intent, mode: r.mode, sources: r.sources, insufficient: r.insufficient, payload: r.payload, warnings: r.warnings, routing: r.routing }]);
    } catch (err) {
      setError(errorMessage(err));
      setMessages((m) => m.slice(0, -1)); // drop the optimistic message and give the text back
      setInput(message);
    } finally {
      setSending(false);
    }
  }

  function newChat() {
    setMessages([]);
    setSessionId(null);
    setError('');
  }

  return (
    <div className="flex h-[70vh] min-h-[420px] flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2">
        <div className="flex items-center gap-3">
          <Segmented label="Answer mode" options={MODES} value={mode} onChange={setMode} />
          <span className="hidden text-xs text-slate-500 sm:inline">{MODES.find((m) => m.value === mode).hint}</span>
        </div>
        <Button variant="secondary" onClick={newChat} disabled={!messages.length}>New chat</Button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
        {restoring && <Spinner label="Loading conversation..." />}
        {!restoring && messages.length === 0 && (
          <div className="mx-auto max-w-md py-8 text-center">
            <h3 className="font-semibold text-slate-800">Ask anything about this document</h3>
            <p className="mt-1 text-sm text-slate-500">Answers are grounded in your document and cite the passages they use.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50">{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => <Message key={i} m={m} onOpenSet={onOpenSet} />)}
        {sending && (
          <div className="flex items-center gap-2 text-sm text-slate-500"><span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" />Thinking...</div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-slate-200 p-3">
        <ErrorBox message={error} className="mb-2" />
        <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={2}
            maxLength={4000}
            placeholder={`Ask in ${mode} mode... (Enter to send, Shift+Enter for a new line)`}
            className="flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <Button type="submit" loading={sending} disabled={!input.trim()}>Send</Button>
        </form>
      </div>
    </div>
  );
}

function Message({ m, onOpenSet }) {
  if (m.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-indigo-600 px-4 py-2 text-sm text-white">{m.content}</div>
      </div>
    );
  }
  const p = m.payload;
  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] space-y-2 rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-3">
        <Markdown>{m.content}</Markdown>
        {p && (p.kind === 'quiz' || p.kind === 'practice') && (
          <Button variant="secondary" onClick={() => onOpenSet(p.kind, p.quizId)}>Open {p.kind === 'quiz' ? 'quiz' : 'practice set'} &rarr;</Button>
        )}
        {m.sources?.length > 0 && (
          <div className="flex flex-wrap items-start gap-1.5 border-t border-slate-200 pt-2">
            <span className="mr-1 text-xs text-slate-500">Sources:</span>
            {m.sources.map((s) => <SourceChip key={s.chunkId || s.label} source={s} />)}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <ProviderBadge provider={m.provider} />
          {m.intent && <Badge tone={intentTone[m.intent]}>{m.intent}</Badge>}
          {m.mode && <Badge>{m.mode}</Badge>}
          {m.insufficient && <Badge tone="amber">not enough context</Badge>}
        </div>
        {m.warnings?.length > 0 && <WarningList warnings={m.warnings} />}
      </div>
    </div>
  );
}
