import { useState } from 'react';

/** Chip for a cited chunk: "[3] RESPIRATION". Click to expand the snippet when we have it. */
export default function SourceChip({ source }) {
  const [open, setOpen] = useState(false);
  const cited = source.cited !== false;
  return (
    <span className="inline-block max-w-full align-top">
      <button
        type="button"
        onClick={() => source.snippet && setOpen((o) => !o)}
        title={source.snippet ? 'Click to show/hide the passage' : `Chunk ${source.label}`}
        className={`rounded-full border px-2 py-0.5 text-xs transition ${
          cited ? 'border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
        }`}
      >
        [{source.label}]{source.heading ? ` ${source.heading.slice(0, 28)}` : ''}
        {source.finalScore != null && <span className="ml-1 opacity-60">{Number(source.finalScore).toFixed(2)}</span>}
      </button>
      {open && <span className="mt-1 block rounded-md bg-slate-50 p-2 text-xs text-slate-600">{source.snippet}</span>}
    </span>
  );
}
