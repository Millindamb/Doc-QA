import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { analyzeDocument, errorMessage, uploadDocument } from '../api.js';
import { Button, Card, ErrorBox, ProgressBar, Segmented, WarningList } from '../components/ui.jsx';

const ACCEPT = ['.pdf', '.png', '.jpg', '.jpeg', '.txt'];
const MAX_MB = 20;
const STAGES = [
  { id: 'upload', label: 'Uploading' },
  { id: 'extract', label: 'Extracting text (OCR / cleaning / chunking)' },
  { id: 'analyze', label: 'Analyzing (keywords, topics, key points)' },
  { id: 'done', label: 'Ready' },
];

export default function Upload() {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [kind, setKind] = useState('file');
  const [file, setFile] = useState(null);
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [drag, setDrag] = useState(false);
  const [stage, setStage] = useState(null); // null | upload | extract | analyze | done
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState([]);
  const [uploadedId, setUploadedId] = useState(null);

  const busy = stage && stage !== 'done';

  function pick(f) {
    setError('');
    if (!f) return;
    const ext = `.${f.name.split('.').pop().toLowerCase()}`;
    if (!ACCEPT.includes(ext)) return setError(`Unsupported file type ${ext}. Use ${ACCEPT.join(', ')}.`);
    if (f.size > MAX_MB * 1024 * 1024) return setError(`File is larger than ${MAX_MB} MB.`);
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''));
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    setWarnings([]);
    if (kind === 'file' && !file) return setError('Choose a file first.');
    if (kind === 'text' && text.trim().length < 20) return setError('Paste at least a few sentences of text.');

    let docId = uploadedId;
    try {
      if (!docId) {
        setStage('upload');
        setPercent(0);
        const doc = await uploadDocument(
          { file: kind === 'file' ? file : null, text: kind === 'text' ? text : null, title: title || undefined },
          (p) => {
            setPercent(p);
            if (p >= 100) setStage('extract');
          }
        );
        docId = doc.id;
        setUploadedId(docId);
        setWarnings(doc.warnings || []);
        if (doc.status === 'failed') throw new Error(doc.errorMessage || 'Processing failed. Try a clearer file.');
      }
      setStage('analyze');
      await analyzeDocument(docId);
      setStage('done');
      setTimeout(() => navigate(`/documents/${docId}`), 600);
    } catch (err) {
      setError(errorMessage(err));
      // an uploaded-but-not-analyzed document is still usable; let the user continue or retry analysis
      setStage(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold text-slate-900">Upload a document</h1>
      <p className="mb-6 text-sm text-slate-500">PDF, image (PNG/JPG) or plain text. Scanned pages are read with OCR automatically.</p>

      <form onSubmit={submit} className="space-y-5">
        <Segmented label="Source" value={kind} onChange={setKind} options={[{ value: 'file', label: 'Upload file' }, { value: 'text', label: 'Paste text' }]} />

        {kind === 'file' ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]); }}
            onClick={() => !busy && inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
            className={`cursor-pointer rounded-xl border-2 border-dashed px-6 py-12 text-center transition ${drag ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-white hover:border-slate-400'}`}
          >
            <input ref={inputRef} type="file" hidden accept={ACCEPT.join(',')} onChange={(e) => pick(e.target.files?.[0])} />
            {file ? (
              <>
                <p className="font-medium text-slate-900">{file.name}</p>
                <p className="text-xs text-slate-500">{(file.size / 1024 / 1024).toFixed(2)} MB - click or drop to replace</p>
              </>
            ) : (
              <>
                <p className="font-medium text-slate-700">Drag & drop a file here, or click to browse</p>
                <p className="text-xs text-slate-500">PDF, PNG, JPG, TXT - up to {MAX_MB} MB</p>
              </>
            )}
          </div>
        ) : (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            placeholder="Paste your notes or article text here..."
            className="w-full rounded-xl border border-slate-300 p-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        )}

        <label className="block text-sm font-medium text-slate-700">
          Title (optional)
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="e.g. Biology chapter 4" />
        </label>

        <ErrorBox message={error} />
        <WarningList warnings={warnings} />

        {stage && (
          <Card>
            <ol className="space-y-3">
              {STAGES.map((s, i) => {
                const current = STAGES.findIndex((x) => x.id === stage);
                const state = i < current || stage === 'done' ? 'done' : i === current ? 'active' : 'todo';
                return (
                  <li key={s.id} className="flex items-center gap-3 text-sm">
                    <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${state === 'done' ? 'bg-green-500 text-white' : state === 'active' ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
                      {state === 'done' ? '✓' : i + 1}
                    </span>
                    <span className={state === 'todo' ? 'text-slate-400' : 'text-slate-800'}>{s.label}</span>
                    {state === 'active' && s.id === 'upload' && <span className="ml-auto w-32"><ProgressBar percent={percent} /></span>}
                    {state === 'active' && s.id !== 'upload' && <span className="ml-auto h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" />}
                  </li>
                );
              })}
            </ol>
          </Card>
        )}

        <div className="flex gap-3">
          <Button type="submit" loading={busy} disabled={stage === 'done'}>
            {uploadedId && !busy ? 'Retry analysis' : 'Upload & analyze'}
          </Button>
          {uploadedId && !busy && (
            <Button type="button" variant="secondary" onClick={() => navigate(`/documents/${uploadedId}`)}>Open without analysis</Button>
          )}
        </div>
      </form>
    </div>
  );
}
