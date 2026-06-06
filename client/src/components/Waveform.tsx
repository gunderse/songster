/**
 * Lightweight visual indicator that audio is currently playing on the hub.
 * Pure CSS animation — no Web Audio analysis required (which would lock the
 * AudioContext and complicate snippet handling).
 */
export function Waveform({ active, color = "#a5b4fc" }: { active: boolean; color?: string }) {
  const bars = 5;
  return (
    <span
      aria-hidden
      className="inline-flex h-6 items-end gap-[3px]"
      title={active ? "audio playing" : "silent"}
      style={{ opacity: active ? 1 : 0.25 }}
    >
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className="block w-[3px] rounded-full"
          style={{
            background: color,
            height: active ? "100%" : "25%",
            animation: active ? `songster-wave 0.9s ease-in-out ${i * 0.12}s infinite` : "none",
            transformOrigin: "bottom",
          }}
        />
      ))}
      <style>{`
        @keyframes songster-wave {
          0%, 100% { transform: scaleY(0.35); }
          50% { transform: scaleY(1); }
        }
      `}</style>
    </span>
  );
}
