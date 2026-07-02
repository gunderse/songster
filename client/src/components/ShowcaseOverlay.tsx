import { useEffect, useRef } from "react";
import type { ShowcaseView } from "@songster/shared/game";

export function ShowcaseOverlay({ view, cueIndex }: { view: ShowcaseView; cueIndex: number }) {
  const idx = Math.max(0, Math.min(cueIndex, view.cues.length - 1));
  const cue = view.cues[idx];
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = true;
    }
  }, [view.bgVideoUrl]);

  function highlightText(text: string) {
    const words = text.split(" ");
    return words.map((word, idx) => {
      // Clean word for matching
      const cleanWord = word.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()“”'"\n]/g, "");
      const isYear = /^\d{4}$/.test(cleanWord);
      const isTeam = /^(Red|Blue|Green|Gold|Statler|Waldorf)$/i.test(cleanWord);
      const isAction = /^(stole|wins|won|correct|wrong|winner|champion)$/i.test(cleanWord);
      
      if (isYear || isTeam) {
        return (
          <span key={idx} className="text-gold-yellow font-black">
            {word}{" "}
          </span>
        );
      }
      if (isAction) {
        return (
          <span key={idx} className="text-magenta-soft font-bold">
            {word}{" "}
          </span>
        );
      }
      return word + " ";
    });
  }

  return (
    <div className="absolute inset-0 z-30 overflow-hidden bg-bg-deep font-sans">
      {view.bgVideoUrl !== null ? (
        <video
          ref={videoRef}
          src={view.bgVideoUrl}
          autoPlay
          loop
          muted={true}
          playsInline
          className="absolute inset-0 h-full w-full object-cover opacity-50"
          onError={(e) => {
            (e.currentTarget as HTMLVideoElement).style.display = "none";
          }}
        />
      ) : view.bgImageUrl !== null ? (
        <img src={view.bgImageUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-50" />
      ) : null}
      
      {/* Cinematic vignette gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#0a0605]/80 via-[#0a0605]/30 to-[#0a0605]/95 pointer-events-none" />

      {/* Top telemetry chrome (low opacity Space Mono tags) */}
      <div className="absolute top-6 left-6 z-40 text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-text-faint flex items-center gap-2">
        <span>▶</span>
        <span>PRODUCED SEGMENT · 1080P</span>
      </div>
      <div className="absolute top-6 right-6 z-40 text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-accent-magenta flex items-center gap-1.5 bg-surface border border-line rounded-full px-3 py-1 animate-sc-pulse">
        <span className="h-1.5 w-1.5 rounded-full bg-accent-magenta" />
        <span>RENDERING INTERACTIVE</span>
      </div>

      <div className="relative flex h-full flex-col items-center justify-between p-8 text-center text-text-main">
        {/* Theme Title */}
        <div className="mt-8">
          <div className="font-display text-2xl font-black uppercase tracking-[0.15em] text-gold-yellow">
            🎬 {view.themeLabel}
          </div>
          <div className="text-xs font-mono font-bold uppercase tracking-[0.2em] text-text-dim mt-1">
            {view.tagline}
          </div>
        </div>

        {/* Produced Narration Lower-Third Subtitle Bar */}
        {cue !== undefined && (
          <div className="max-w-4xl w-full bg-[#0a0605]/95 border border-line rounded-[18px] p-6 flex flex-col md:flex-row items-center justify-between gap-6 shadow-[0_30px_80px_rgba(0,0,0,0.8)] backdrop-blur-md mb-8">
            {/* Left: Speaker and Waveform */}
            <div className="flex items-center gap-4 w-full md:w-auto shrink-0 border-b md:border-b-0 md:border-r border-line pb-4 md:pb-0 md:pr-6">
              <div className="bg-accent-magenta text-[#1a1110] font-mono font-bold text-xs uppercase px-3.5 py-1.5 rounded-full shadow-[0_0_15px_rgba(255,45,120,0.3)]">
                {cue.characterName ?? cue.speakerLabel}
              </div>
              {/* Gold waveform bars */}
              <div className="flex items-end gap-1 h-6">
                {[...Array(6)].map((_, i) => (
                  <span
                    key={i}
                    className="w-1 bg-gold-yellow rounded-t-sm animate-sc-wave"
                    style={{
                      animationDelay: `-${(i * 0.15).toFixed(2)}s`,
                      height: `${40 + (i % 3) * 30}%`
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Center: Dialog Text with highlighted words & caret */}
            <p className="text-xl font-bold font-sans leading-relaxed text-text-main flex-1 text-left">
              “{highlightText(cue.text)}”
              <span className="inline-block w-1.5 h-5 bg-accent-magenta ml-1.5 align-middle animate-sc-caret" />
            </p>

            {/* Right: Telemetry info */}
            <div className="hidden md:flex flex-col items-end text-[9px] font-mono font-bold text-text-faint uppercase leading-tight text-right shrink-0 border-l border-line pl-6">
              <span>AUTO-PRODUCED</span>
              <span>AI NARRATION</span>
            </div>
          </div>
        )}

        {/* Slide navigation dots */}
        <div className="flex gap-2 mb-4 z-20">
          {view.cues.map((_, i) => (
            <span
              key={i}
              className={`h-2.5 w-2.5 rounded-full transition-colors duration-300 ${
                i === idx ? "bg-accent-magenta shadow-[0_0_8px_#ff2d78]" : "bg-white/20"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

