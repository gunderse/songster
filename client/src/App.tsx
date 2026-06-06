import { Admin } from "./routes/Admin";
import { Hub } from "./routes/Hub";
import { Join } from "./routes/Join";
import { Library } from "./routes/Library";

function Home() {
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-6 p-6 text-slate-100">
      <h1 className="text-5xl font-black tracking-tight">🎵 Songster</h1>
      <p className="text-slate-400">LAN music party game — hear a snippet, guess the year, build your team's timeline.</p>
      <nav className="flex flex-wrap justify-center gap-3">
        <a href="/play" className="rounded-lg bg-emerald-500 px-5 py-2 font-semibold text-white transition hover:bg-emerald-400">
          📱 Join a game
        </a>
        <a href="/admin" className="rounded-lg bg-indigo-500 px-5 py-2 font-semibold text-white transition hover:bg-indigo-400">
          Admin
        </a>
        <a href="/library" className="rounded-lg border border-slate-700 px-5 py-2 font-semibold transition hover:bg-slate-800">
          Library / Curation
        </a>
      </nav>
      <p className="max-w-sm text-center text-xs text-slate-500">
        Create a room in Admin, open the Hub on the big screen, and join from phones via the QR code.
      </p>
    </main>
  );
}

export function App() {
  const path = window.location.pathname;

  if (path.startsWith("/library")) return <Library />;
  if (path.startsWith("/admin")) return <Admin />;
  if (path.startsWith("/hub/")) return <Hub code={path.slice("/hub/".length).toUpperCase()} />;
  if (path.startsWith("/play") || path.startsWith("/join")) {
    return <Join initialCode={new URLSearchParams(window.location.search).get("code")} />;
  }

  const code = new URLSearchParams(window.location.search).get("code");
  if (code !== null && code.trim().length > 0) return <Join initialCode={code.toUpperCase()} />;

  return <Home />;
}
