/** Small inline SVG icon set (no icon font needed offline). */
const PATHS: Record<string, string> = {
  "chevron-right": "M9 6l6 6-6 6",
  "chevron-left": "M15 6l-6 6 6 6",
  "chevron-down": "M6 9l6 6 6-6",
  "arrow-left": "M19 12H5M11 18l-6-6 6-6",
  "arrow-right": "M5 12h14M13 6l6 6-6 6",
  gear:
    "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z",
  plus: "M12 5v14M5 12h14",
  check: "M5 12l5 5L20 7",
  x: "M6 6l12 12M18 6L6 18",
  clock: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2",
  fire: "M12 22c4 0 7-3 7-7 0-4-3-6-4-9-1 2-2 3-3 3 0-2-1-4-3-6 0 4-4 6-4 12 0 4 3 7 7 7z",
  star: "M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z",
  wand: "M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8l1.4 1.4M17.8 6.2l1.4-1.4M12.2 6.2l-1.4-1.4M15 9L3 21",
  trash: "M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3",
  note: "M4 4h12l4 4v12H4zM8 12h8M8 16h5",
  external: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  book: "M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 21V5",
  target: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 16a4 4 0 100-8 4 4 0 000 8zM12 12h.01",
  play: "M7 4l13 8-13 8z",
  puzzle: "M10 3h4v3a2 2 0 104 0V3h3v7h-3a2 2 0 100 4h3v7h-7v-3a2 2 0 10-4 0v3H3v-7h3a2 2 0 100-4H3V3z",
  bulb: "M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9V16h7v-2.1A6 6 0 0012 3z",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z",
  download: "M12 4v12M6 10l6 6 6-6M4 20h16",
  upload: "M12 20V8M6 14l6-6 6 6M4 4h16",
  flag: "M5 21V4h11l-2 4 2 4H5",
  undo: "M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3",
  history: "M3 12a9 9 0 109-9 9 9 0 00-7 3.3M3 4v5h5M12 8v4l3 2",
  info: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v6M12 7h.01",
  swap: "M7 7h13l-4-4M17 17H4l4 4",
  pause: "M8 5v14M16 5v14",
  forward: "M5 4l10 8-10 8zM19 5v14",
  backward: "M19 20L9 12l10-8zM5 19V5",
};

export function Icon({ name, className = "", size }: { name: string; className?: string; size?: number }) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg
      className={`icon ${className}`}
      viewBox="0 0 24 24"
      width={size ?? "1em"}
      height={size ?? "1em"}
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "star" || name === "play" || name === "fire" ? 0 : 2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} fill={name === "star" || name === "play" || name === "fire" ? "currentColor" : "none"} />
    </svg>
  );
}
