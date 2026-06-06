import type { ShowcaseView } from "@songster/shared/game";

export function ShowcaseOverlay({ view, cueIndex }: { view: ShowcaseView; cueIndex: number }) {
  const idx = Math.max(0, Math.min(cueIndex, view.cues.length - 1));
  const cue = view.cues[idx];

  return (
    <div className="absolute inset-0 z-30 overflow-hidden bg-black">
      {view.bgVideoUrl !== null ? (
        <video
          src={view.bgVideoUrl}
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 h-full w-full object-cover opacity-60"
          onError={(e) => {
            (e.currentTarget as HTMLVideoElement).style.display = "none";
          }}
        />
      ) : view.bgImageUrl !== null ? (
        <img src={view.bgImageUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-60" />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/30 to-black/85" />

      <div className="relative flex h-full flex-col items-center justify-between p-10 text-center text-white">
        <div>
          <div className="text-sm uppercase tracking-[0.3em] text-amber-300">🎬 {view.themeLabel}</div>
          <div className="text-slate-300">{view.tagline}</div>
        </div>

        {cue !== undefined && (
          <div className="max-w-3xl">
            <div className="mb-2 text-lg font-bold uppercase tracking-wide text-amber-200">
              {cue.characterName ?? cue.speakerLabel}
            </div>
            <p className="text-3xl font-black leading-snug drop-shadow-lg sm:text-4xl">“{cue.text}”</p>
          </div>
        )}

        <div className="flex gap-1.5">
          {view.cues.map((_, i) => (
            <span key={i} className={`h-2 w-2 rounded-full ${i <= idx ? "bg-amber-300" : "bg-white/30"}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
