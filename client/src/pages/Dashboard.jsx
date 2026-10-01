import { useState } from 'react';
import { Link } from 'react-router-dom';
import { deleteDocument, errorMessage, listDocuments } from '../api.js';
import { Badge, Button, Card, EmptyState, ErrorBox, Spinner, useLoader } from '../components/ui.jsx';

const statusTone = { ready: 'green', processing: 'amber', pending: 'amber', failed: 'red' };
const typeIcon = { pdf: 'PDF', image: 'IMG', text: 'TXT' };

export default function Dashboard() {
  const { data: docs, loading, error, reload } = useLoader(listDocuments, []);
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState('');

  async function remove(doc) {
    if (!window.confirm(`Delete "${doc.title}"? This cannot be undone.`)) return;
    setBusyId(doc.id);
    setActionError('');
    try {
      await deleteDocument(doc.id);
      reload();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Your documents</h1>
          <p className="text-sm text-slate-500">Upload notes, PDFs or photos, then ask questions and practise.</p>
        </div>
        <Link to="/upload">
          <Button>+ Upload document</Button>
        </Link>
      </div>

      <ErrorBox message={actionError} className="mb-4" />
      {loading && <Spinner label="Loading your documents..." />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {!loading && !error && docs?.length === 0 && (
        <EmptyState title="No documents yet" action={<Link to="/upload"><Button>Upload your first document</Button></Link>}>
          Upload a PDF, an image of handwritten or printed notes, or paste text. We'll extract key points, topics and make it searchable.
        </EmptyState>
      )}
      {!loading && !error && docs?.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {docs.map((d) => (
            <Card key={d.id} className="flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between gap-2">
                  <Link to={`/documents/${d.id}`} className="text-base font-semibold text-slate-900 hover:text-indigo-700">
                    {d.title}
                  </Link>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">{typeIcon[d.sourceType]}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge tone={statusTone[d.status]}>{d.status}</Badge>
                  <Badge tone={d.analyzed ? 'indigo' : 'slate'}>{d.analyzed ? 'analyzed' : 'not analyzed'}</Badge>
                  <Badge>{d.chunkCount} chunks</Badge>
                  {d.needsLlmOcr && <Badge tone="amber" title="OCR confidence was low">low OCR quality</Badge>}
                </div>
                <p className="mt-3 text-xs text-slate-400">Added {new Date(d.createdAt).toLocaleString()}</p>
              </div>
              <div className="mt-4 flex gap-2">
                <Link to={`/documents/${d.id}`} className="flex-1">
                  <Button variant="secondary" className="w-full">Open</Button>
                </Link>
                <Button variant="danger" loading={busyId === d.id} onClick={() => remove(d)}>Delete</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
