import { useAuth } from '../auth.jsx';

// background image: put your file at client/public/paperly-bg.jpg
const BG = '/img4.jpg';

const FEATURES = [
  { title: 'Chat with citations', text: 'Ask anything and get answers grounded in your document, with the passages cited.' },
  { title: 'Quizzes and practice', text: 'Auto-made multiple-choice and short questions, graded, with weak-area tracking.' },
  { title: 'Exam mode', text: 'Concise answers ranked by what is most likely to be asked.' },
  { title: 'Research and resources', text: 'Web research with real links, plus ranked study videos for any topic.' },
];

export default function GuestHome() {
  const { openAuth } = useAuth();
  return (
    <div className="space-y-8">
      <section
        className="relative overflow-hidden rounded-3xl"
        style={{
          backgroundColor: '#000',
          backgroundImage: `linear-gradient(rgba(0,0,0,.35), rgba(0,0,0,.7)), url(${BG})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div className="mx-auto flex min-h-[420px] max-w-2xl flex-col items-center justify-center px-6 py-16 text-center text-white">
          <h1 className="text-4xl font-bold sm:text-5xl">Turn any document into answers</h1>
          <p className="mt-4 text-lg text-white/80">
            Upload a PDF, a photo of your notes, or paste text. Paperly finds the key points, answers your questions with citations, and quizzes you.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <button onClick={() => openAuth('login')} className="rounded-xl bg-indigo-600 px-6 py-3 text-base font-semibold text-white hover:bg-indigo-500">
              Upload a document
            </button>
            <button onClick={() => openAuth('register')} className="rounded-xl border border-white/30 px-6 py-3 text-base font-semibold text-white hover:bg-white/10">
              Create free account
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-2xl border border-slate-200 bg-white p-5">
            <h3 className="font-semibold text-slate-900">{f.title}</h3>
            <p className="mt-1.5 text-sm text-slate-500">{f.text}</p>
          </div>
        ))}
      </section>
    </div>
  );
}