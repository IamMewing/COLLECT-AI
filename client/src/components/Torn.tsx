import React from 'react';

type Tone = 'acid' | 'ink' | 'bone';

const HEX: Record<Tone, string> = {
  acid: '#FFE500',
  ink: '#000000',
  bone: '#F2EFE4',
};

/** Hand-tuned liquid edges. Lobed and uneven, like poured paint settling. */
const EDGES = [
  'M0,58 C96,18 168,84 268,62 C372,38 452,98 560,72 C668,46 742,6 856,36 C962,64 1070,20 1200,48 L1200,112 L0,112 Z',
  'M0,42 C140,88 232,14 352,46 C470,78 556,22 664,52 C782,84 880,28 1000,56 C1090,76 1150,40 1200,66 L1200,112 L0,112 Z',
  'M0,72 C80,40 130,78 210,54 C300,26 352,70 440,58 C540,44 602,88 700,66 C810,42 862,14 960,42 C1060,70 1132,46 1200,60 L1200,112 L0,112 Z',
];

interface TornProps {
  from: Tone;
  to: Tone;
  /** 0–2, picks one of the hand-tuned edges. */
  variant?: 0 | 1 | 2;
  drift?: boolean;
}

export const Torn: React.FC<TornProps> = ({ from, to, variant = 0, drift = true }) => (
  <div
    className={`torn${drift ? ' torn--drift' : ''}`}
    style={{ background: HEX[from] }}
    aria-hidden="true"
  >
    <svg viewBox="0 0 1200 112" preserveAspectRatio="none">
      <path d={EDGES[variant]} fill={HEX[to]} />
    </svg>
  </div>
);

export default Torn;
