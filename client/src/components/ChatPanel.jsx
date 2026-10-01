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
  const boxRef = useRef(null);

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

  // auto-grow the input like ChatGPT
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [input]);

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

  const empty = !restoring && messages.length === 0;

  const inputBar = (
    <div className="mx-auto w-full max-w-3xl">
      <ErrorBox message={error} className="mb-2" />
      <form
        onSubmit={(e) => { e.preventDefault(); send(); }}
        className="rounded-3xl border border-slate-200 bg-slate-100 px-4 pb-2 pt-3 shadow-sm"
      >
        <textarea
          ref={boxRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          rows={1}
          maxLength={4000}
          placeholder="Ask anything about this document"
          className="max-h-[200px] w-full resize-none bg-transparent text-base text-slate-900 placeholder:text-slate-500 focus:outline-none"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Segmented label="Answer mode" options={MODES} value={mode} onChange={setMode} />
            <span className="hidden truncate text-xs text-slate-500 lg:inline">{MODES.find((m) => m.value === mode).hint}</span>
          </div>
          <Button type="submit" loading={sending} disabled={!input.trim()}>Send</Button>
        </div>
      </form>
    </div>
  );

  return (
    <div className="flex h-[calc(100vh-11rem)] min-h-[440px] flex-col">
      {messages.length > 0 && (
        <div className="flex justify-end pb-2">
          <Button variant="secondary" onClick={newChat}>New chat</Button>
        </div>
      )}

      {restoring && <div className="flex flex-1 items-center justify-center"><Spinner label="Loading conversation..." /></div>}

      {empty && (
        <div className="flex flex-1 flex-col items-center justify-center gap-6">
          <div className="text-center">
            <h3 className="text-3xl font-medium text-slate-800">What do you want to know?</h3>
            <p className="mt-2 text-sm text-slate-500">Answers are grounded in your document and cite the passages they use.</p>
          </div>
          {inputBar}
          <div className="flex max-w-3xl flex-wrap justify-center gap-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => send(s)} className="rounded-full border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100">{s}</button>
            ))}
          </div>
        </div>
      )}

      {!restoring && messages.length > 0 && (
        <>
          <div className="flex-1 overflow-y-auto" aria-live="polite">
            <div className="mx-auto max-w-3xl space-y-8 py-4">
              {messages.map((m, i) => <Message key={i} m={m} onOpenSet={onOpenSet} />)}
              {sending && (
                <div className="flex items-center gap-2 text-sm text-slate-500"><span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" />Thinking...</div>
              )}
              <div ref={bottomRef} />
            </div>
          </div>
          <div className="pt-2">{inputBar}</div>
        </>
      )}
    </div>
  );
}

function Message({ m, onOpenSet }) {
  if (m.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap rounded-3xl bg-slate-100 px-5 py-2.5 text-base text-slate-900">{m.content}</div>
      </div>
    );
  }
  const p = m.payload;
  return (
    <div className="space-y-3">
      <Markdown>{m.content}</Markdown>
      {p && (p.kind === 'quiz' || p.kind === 'practice') && (
        <Button variant="secondary" onClick={() => onOpenSet(p.kind, p.quizId)}>Open {p.kind === 'quiz' ? 'quiz' : 'practice set'} &rarr;</Button>
      )}
      {m.sources?.length > 0 && (
        <div className="flex flex-wrap items-start gap-1.5 pt-1">
          <span className="mr-1 text-xs text-slate-500">Sources:</span>
          {m.sources.map((s) => <SourceChip key={s.chunkId || s.label} source={s} />)}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <ProviderBadge provider={m.provider} />
        {m.intent && <Badge tone={intentTone[m.intent]}>{m.intent}</Badge>}
        {m.mode && <Badge>{m.mode}</Badge>}
        {m.insufficient && <Badge tone="amber">not enough context</Badge>}
      </div>
      {m.warnings?.length > 0 && <WarningList warnings={m.warnings} />}
    </div>
  );
}