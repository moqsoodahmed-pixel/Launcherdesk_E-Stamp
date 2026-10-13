import { useId } from "react";

// Perforation holes along every edge of a w x h stamp: circles of radius r,
// one every `step` units. Used inside an SVG <mask> to punch the edge.
function holes(w, h, r, step) {
  const out = [];
  for (let x = step / 2; x < w; x += step) {
    out.push([x, 0], [x, h]);
  }
  for (let y = step / 2; y < h; y += step) {
    out.push([0, y], [w, y]);
  }
  return out.map(([cx, cy], i) => <circle key={i} cx={cx} cy={cy} r={r} fill="black" />);
}

// Small perforated stamp: the product mark in the sidebar and auth screens.
export function LogoMark({ className = "h-9 w-9", title }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 40 40" className={className} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : "true"}>
      <defs>
        <mask id={`m${id}`}>
          <rect x="0" y="0" width="40" height="40" fill="white" />
          {holes(40, 40, 2.2, 6.66)}
        </mask>
      </defs>
      <rect x="0" y="0" width="40" height="40" rx="3" fill="#FFB020" mask={`url(#m${id})`} />
      <rect x="7" y="7" width="26" height="26" rx="2" fill="none" stroke="#14193F" strokeWidth="1.5" />
      <circle cx="20" cy="20" r="7.5" fill="none" stroke="#14193F" strokeWidth="1.75" />
      <path d="M17 16.5h6M17 19h6M21 19c0 2.2-1.6 3-4 3l4.5 3.5" fill="none" stroke="#14193F" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Large stamp illustration for the auth brand panel: a perforated
// certificate with a seal, rupee mark and ruled lines. Flat colours only.
export function StampIllustration({ className = "w-full max-w-[320px]" }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 240 300" className={className} aria-hidden="true" focusable="false">
      <defs>
        <mask id={`p${id}`}>
          <rect x="0" y="0" width="240" height="300" fill="white" />
          {holes(240, 300, 6, 20)}
        </mask>
      </defs>
      <g transform="rotate(-4 120 150)">
        <rect x="0" y="0" width="240" height="300" fill="#FFFFFF" mask={`url(#p${id})`} />
        <rect x="18" y="18" width="204" height="264" fill="none" stroke="#C3CAFE" strokeWidth="2" />
        <rect x="30" y="34" width="110" height="10" rx="5" fill="#2B3FD9" />
        <rect x="30" y="54" width="70" height="8" rx="4" fill="#DFE3FF" />
        <circle cx="120" cy="150" r="54" fill="#EEF0FF" stroke="#2B3FD9" strokeWidth="3" />
        <circle cx="120" cy="150" r="42" fill="none" stroke="#2B3FD9" strokeWidth="1.5" strokeDasharray="3 5" />
        <path d="M104 132h32M104 144h32M126 144c0 10-7 14-18 14l20 18" fill="none" stroke="#1B2A9B" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="30" y="224" width="180" height="7" rx="3.5" fill="#E1E4EE" />
        <rect x="30" y="240" width="140" height="7" rx="3.5" fill="#E1E4EE" />
        <rect x="150" y="256" width="60" height="12" rx="6" fill="#12A36B" />
      </g>
      <g transform="translate(168 18) rotate(10)">
        <circle cx="30" cy="30" r="30" fill="#FFB020" />
        <circle cx="30" cy="30" r="22" fill="none" stroke="#14193F" strokeWidth="2" />
        <path d="M19 30l7.5 7.5L42 22" fill="none" stroke="#14193F" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}
