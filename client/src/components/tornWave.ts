/**
 * The shape of the boundary between two colour fields, defined once.
 *
 * Two things need it and they must agree exactly. Torn draws the edge with it.
 * LiquidBlobs needs it because the cursor mass is filled with whichever field
 * colour differences to the right result, and a mass straddling a divider has
 * to be filled with both — split along this very curve. Approximating the
 * split as a flat line leaves a hairline of the wrong colour along the wave,
 * so the fragment shader evaluates the same three sines, hence GLSL_WAVE.
 */

export const W = 1200; // viewBox width
export const H = 120; // viewBox height
export const STEPS = 44;
/** Overshoot above the viewBox so the upper fill always reaches the element's
 *  top edge; the root svg clips it back. */
export const OVER = 6;

/** Surface height in viewBox units at a given viewBox x. */
export const waveVbY = (vbX: number, phase: number, amp: number, seed: number) =>
  H * 0.5 +
  amp *
    (1.0 * Math.sin(vbX * 0.0061 + phase * 1.0 + seed) +
      0.56 * Math.sin(vbX * 0.0117 - phase * 1.43 + seed * 2.1) +
      0.3 * Math.sin(vbX * 0.0223 + phase * 0.81 + seed * 3.7));

/** The same function for the fragment shader. Keep in step with waveVbY. */
export const GLSL_WAVE = `
float tornWaveVbY(float vbX, float phase, float amp, float seed) {
  return ${H.toFixed(1)} * 0.5 + amp * (
    1.0  * sin(vbX * 0.0061 + phase * 1.0  + seed) +
    0.56 * sin(vbX * 0.0117 - phase * 1.43 + seed * 2.1) +
    0.3  * sin(vbX * 0.0223 + phase * 0.81 + seed * 3.7)
  );
}
`;

export interface WaveState {
  phase: number;
  amp: number;
  seed: number;
}

/** Each mounted divider publishes its live wave here, so anything that needs to
 *  know where the boundary currently is can ask. */
export const waveRegistry = new Map<Element, WaveState>();
