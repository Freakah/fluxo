// Small flat illustrations drawn inline (no image downloads). Colours come from CSS classes so they follow light/dark themes.
import type { ReactNode } from 'react';

const Svg = ({ children, label }: { children: ReactNode; label?: string }) => (
  <svg className="art" viewBox="0 0 200 140" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>{children}</svg>
);
const Ground = () => <ellipse className="il-soft" cx="100" cy="128" rx="78" ry="8" />;

export const Art = {
  welcome: () => (
    <Svg>
      <Ground />
      <rect className="il-s il-line" x="38" y="22" width="124" height="96" rx="12" />
      <rect className="il-soft" x="50" y="34" width="60" height="8" rx="4" />
      <rect className="il-a" x="50" y="50" width="40" height="14" rx="5" />
      <circle className="il-soft" cx="132" cy="86" r="20" />
      <path className="il-a" d="M132 66a20 20 0 0 1 20 20h-20z" />
      <rect className="il-ok" x="50" y="78" width="10" height="28" rx="3" />
      <rect className="il-a" x="64" y="70" width="10" height="36" rx="3" />
      <rect className="il-warn" x="78" y="88" width="10" height="18" rx="3" />
      <circle className="il-warn" cx="166" cy="24" r="6" /><circle className="il-ok" cx="30" cy="40" r="4" />
    </Svg>
  ),
  bank: () => (
    <Svg>
      <Ground />
      <path className="il-a" d="M100 18 152 42H48z" />
      <rect className="il-s il-line" x="54" y="46" width="92" height="8" rx="2" />
      {[62, 84, 106, 128].map((x) => <rect key={x} className="il-soft" x={x} y="58" width="10" height="44" rx="2" />)}
      <rect className="il-a" x="48" y="104" width="104" height="10" rx="3" />
      <circle className="il-ok" cx="160" cy="34" r="14" />
      <path d="m153 34 5 5 9-10" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  ),
  search: () => (
    <Svg>
      <Ground />
      {[30, 54, 78].map((y) => <g key={y}><rect className="il-s il-line" x="36" y={y} width="104" height="18" rx="6" /><rect className="il-soft" x="44" y={y + 6} width="46" height="6" rx="3" /></g>)}
      <circle className="il-s il-line-a" cx="138" cy="78" r="22" strokeWidth="6" />
      <path className="il-stroke-a" d="m154 94 18 18" strokeWidth="8" strokeLinecap="round" />
    </Svg>
  ),
  target: () => (
    <Svg>
      <Ground />
      <circle className="il-soft" cx="100" cy="70" r="50" /><circle className="il-s" cx="100" cy="70" r="36" />
      <circle className="il-a" cx="100" cy="70" r="22" /><circle className="il-s" cx="100" cy="70" r="9" />
      <path className="il-stroke-warn" d="m100 70 46-40" strokeWidth="4" strokeLinecap="round" />
      <path className="il-warn" d="m140 24 16-2-4 14z" />
    </Svg>
  ),
  calendar: () => (
    <Svg>
      <Ground />
      <rect className="il-s il-line" x="46" y="24" width="108" height="94" rx="12" />
      <path className="il-a" d="M46 36a12 12 0 0 1 12-12h84a12 12 0 0 1 12 12v12H46z" />
      {[0, 1, 2, 3].map((r) => [0, 1, 2, 3, 4].map((c) => <rect key={`${r}${c}`} className={r === 1 && c === 3 ? 'il-a' : 'il-soft'} x={58 + c * 18} y={58 + r * 14} width="12" height="8" rx="2" />))}
      <circle className="il-ok" cx="150" cy="104" r="16" />
      <path d="m143 104 5 5 9-10" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  ),
  done: () => (
    <Svg>
      <Ground />
      <circle className="il-soft" cx="100" cy="66" r="44" />
      <circle className="il-ok" cx="100" cy="66" r="30" />
      <path d="m86 66 10 10 19-21" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <circle className="il-warn" cx="44" cy="30" r="5" /><circle className="il-a" cx="160" cy="28" r="4" /><rect className="il-a" x="150" y="96" width="9" height="9" rx="2" transform="rotate(20 154 100)" /><rect className="il-warn" x="40" y="96" width="8" height="8" rx="2" />
    </Svg>
  ),
  error: () => (
    <Svg>
      <Ground />
      <path className="il-soft" d="M58 98a24 24 0 0 1 4-47 32 32 0 0 1 61-6 26 26 0 0 1 17 53z" />
      <circle className="il-warn" cx="100" cy="74" r="20" />
      <rect x="97" y="62" width="6" height="15" rx="3" fill="#fff" /><circle cx="100" cy="84" r="3.5" fill="#fff" />
    </Svg>
  ),
  shield: () => (
    <Svg>
      <Ground />
      <path className="il-a" d="M100 16 144 32v32c0 30-20 48-44 58-24-10-44-28-44-58V32z" />
      <path className="il-soft" d="M100 30 132 42v22c0 22-14 36-32 44z" />
      <rect className="il-s" x="84" y="58" width="32" height="26" rx="5" />
      <path d="M90 58v-6a10 10 0 0 1 20 0v6" fill="none" className="il-stroke-s" strokeWidth="5" />
    </Svg>
  ),
  chart: () => (
    <Svg>
      <Ground />
      <rect className="il-s il-line" x="34" y="20" width="132" height="100" rx="12" />
      <path className="il-stroke-a" d="m48 96 26-24 20 12 26-34 30 18" fill="none" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      {[[74, 72], [94, 84], [120, 50]].map(([x, y]) => <circle key={x} className="il-s il-line-a" cx={x} cy={y} r="5" strokeWidth="3" />)}
      <circle className="il-ok" cx="150" cy="68" r="6" />
    </Svg>
  ),
};
export type ArtName = keyof typeof Art;
