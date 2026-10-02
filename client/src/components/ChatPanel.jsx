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
      // fresh: true only drives the typing animation, it is not stored anywhere
      setMessages((m) => [...m, { role: 'assistant', fresh: true, content: r.answer, provider: r.provider, intent: r.intent, mode: r.mode, sources: r.sources, insufficient: r.insufficient, payload: r.payload, warnings: r.warnings, routing: r.routing }]);
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
  const hint = MODES.find((m) => m.value === mode).hint;

  const inputBar = (
    <div className="mx-auto w-full max-w-3xl">
      <ErrorBox message={error} className="mb-2" />
      <form
        onSubmit={(e) => { e.preventDefault(); send(); }}
        className="chat-bar rounded-3xl border border-slate-200 bg-slate-100 px-4 pb-2.5 pt-3 shadow-sm focus-within:border-slate-400"
      >
        <textarea
          ref={boxRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          rows={1}
          maxLength={4000}
          placeholder="Ask anything about this document"
          className="chat-input max-h-[200px] w-full resize-none bg-transparent px-0 py-1 text-base text-slate-900 placeholder:text-slate-500 focus:outline-none"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <div title={hint}><Segmented label="Answer mode" options={MODES} value={mode} onChange={setMode} /></div>
          <button type="submit" className="send-btn" disabled={!input.trim() || sending} aria-label="Send message">
            {sending ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
            )}
          </button>
        </div>
      </form>
      <p className="mt-2 text-center text-xs text-slate-500">{hint}</p>
    </div>
  );

  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-[420px] flex-col">
      {messages.length > 0 && (
        <div className="flex justify-end pb-2">
          <Button variant="secondary" onClick={newChat}>New chat</Button>
        </div>
      )}

      {restoring && <div className="flex flex-1 items-center justify-center"><Spinner label="Loading conversation..." /></div>}

      {empty && (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 pt-16">
          <div className="text-center">
            <h3 className="text-3xl font-medium text-slate-800">What do you want to know?</h3>
            <p className="mt-2 text-sm text-slate-500">Answers are grounded in your document and cite the passages they use.</p>
          </div>
          {inputBar}
          <div className="grid w-full max-w-3xl gap-2 sm:grid-cols-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => send(s)} className="rounded-2xl border border-slate-200 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-100">{s}</button>
            ))}
          </div>
        </div>
      )}

      {!restoring && messages.length > 0 && (
        <>
          <div className="flex-1 overflow-y-auto" aria-live="polite">
            <div className="mx-auto max-w-3xl space-y-8 py-4">
              {messages.map((m, i) => (
                <Message key={i} m={m} onOpenSet={onOpenSet} onTick={() => bottomRef.current?.scrollIntoView({ block: 'end' })} />
              ))}
              {sending && (
                <div className="flex items-center gap-1.5 text-slate-500" aria-label="Thinking">
                  <span className="chat-dot" /><span className="chat-dot" /><span className="chat-dot" />
                </div>
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

function CopyButton({ text }) {
  const [ok, setOk] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setOk(true);
      setTimeout(() => setOk(false), 1500);
    } catch { /* clipboard blocked */ }
  }
  return (
    <button onClick={copy} className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100" title="Copy answer">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></svg>
      {ok ? 'Copied' : 'Copy'}
    </button>
  );
}

function Message({ m, onOpenSet, onTick }) {
  const text = m.content || '';
  // new answers are revealed gradually (like streaming); restored history is shown at once
  const [shown, setShown] = useState(m.fresh ? 0 : text.length);

  useEffect(() => {
    if (!m.fresh || !text) { setShown(text.length); return; }
    const step = Math.max(4, Math.ceil(text.length / 120));
    let n = 0;
    const id = setInterval(() => {
      n = Math.min(n + step, text.length);
      setShown(n);
      onTick?.();
      if (n >= text.length) clearInterval(id);
    }, 16);
    return () => clearInterval(id);
  }, []);

  if (m.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap rounded-3xl bg-slate-100 px-5 py-2.5 text-base text-slate-900">{m.content}</div>
      </div>
    );
  }

  const done = shown >= text.length;
  const p = m.payload;
  return (
    <div className="space-y-3">
      <Markdown>{text.slice(0, shown)}</Markdown>
      {done && (
        <>
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
            <CopyButton text={text} />
            <ProviderBadge provider={m.provider} />
            {m.intent && <Badge tone={intentTone[m.intent]}>{m.intent}</Badge>}
            {m.mode && <Badge>{m.mode}</Badge>}
            {m.insufficient && <Badge tone="amber">not enough context</Badge>}
          </div>
          {m.warnings?.length > 0 && <WarningList warnings={m.warnings} />}
        </>
      )}
    </div>
  );
}