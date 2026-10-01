import ReactMarkdown from 'react-markdown';

const components = {
  h1: (p) => <h3 className="mt-3 mb-1 text-base font-semibold" {...p} />,
  h2: (p) => <h3 className="mt-3 mb-1 text-base font-semibold" {...p} />,
  h3: (p) => <h4 className="mt-2 mb-1 text-sm font-semibold" {...p} />,
  p: (p) => <p className="my-2 leading-relaxed" {...p} />,
  ul: (p) => <ul className="my-2 list-disc space-y-1 pl-5" {...p} />,
  ol: (p) => <ol className="my-2 list-decimal space-y-1 pl-5" {...p} />,
  a: ({ href, ...p }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline hover:text-indigo-800" {...p} />,
  code: (p) => <code className="rounded bg-slate-100 px-1 py-0.5 text-[0.85em]" {...p} />,
  hr: () => <hr className="my-3 border-slate-200" />,
  strong: (p) => <strong className="font-semibold" {...p} />,
};

/** Renders LLM markdown safely (react-markdown does not render raw HTML). */
export default function Markdown({ children }) {
  return (
    <div className="text-sm text-slate-800">
      <ReactMarkdown components={components}>{children || ''}</ReactMarkdown>
    </div>
  );
}
