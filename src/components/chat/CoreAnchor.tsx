export default function CoreAnchor() {
  return (
    <div
      className="
        pointer-events-auto
        h-12 w-12
        rounded-xl
        border border-white/15
        bg-black/50
        shadow-[0_10px_30px_rgba(0,0,0,0.6)]
        ring-1 ring-white/5
        flex items-center justify-center
      "
      aria-label="Vestaryn core"
    >
      {/* Inline SVG so you can style it */}
      <svg viewBox="0 0 1024 1024" className="h-8 w-8 opacity-90">
        {/* No background rect — the container provides background */}
        <rect
          x="160"
          y="160"
          width="704"
          height="704"
          fill="none"
          stroke="currentColor"
          strokeWidth="64"
          rx="32"
          ry="32"
          className="text-red-200/70"
        />
        <polygon
          points="512,720 320,420 704,420"
          className="fill-white/70"
        />
        <polygon
          points="512,720 440,600 584,600"
          className="fill-black/60"
        />
      </svg>
    </div>
  );
}
