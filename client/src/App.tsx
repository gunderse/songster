import { Library } from "./routes/Library";

function Home() {
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-6 p-6 text-slate-100">
      <h1 className="text-5xl font-black tracking-tight">🎵 Songster</h1>
      <p className="text-slate-400">LAN music party game — hear a snippet, guess the year, build your team's timeline.</p>
      <nav className="flex flex-wrap justify-center gap-3">
        <a
          href="/library"
          className="rounded-lg bg-indigo-500 px-5 py-2 font-semibold text-white transition hover:bg-indigo-400"
        >
          Library / Curation
        </a>
        <span className="rounded-lg border border-slate-700 px-5 py-2 text-slate-500">Admin · M3</span>
        <span className="rounded-lg border border-slate-700 px-5 py-2 text-slate-500">Hub · M3</span>
      </nav>
      <p className="max-w-sm text-center text-xs text-slate-500">
        Milestones M0–M2 complete: scaffold, library ingest, curation. Game rooms arrive in M3.
      </p>
    </main>
  );
}

export function App() {
  const path = window.location.pathname;
  if (path.startsWith("/library")) {
    return <Library />;
  }
  return <Home />;
}
