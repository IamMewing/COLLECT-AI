import React, { useEffect, useRef } from 'react';
import { W as VB_W, H as VB_H, GLSL_WAVE, waveRegistry } from './tornWave';

/**
 * The signature move: a liquid mass that trails the pointer across the whole
 * document, carrying the opposite brand colour and knocking out whatever type
 * it passes over.
 *
 *   mass over the ultramarine field -> lime      (and its type goes black)
 *   mass over the lime field        -> ultramarine
 *   mass over the ink field         -> lime      (and its type goes blue)
 *
 * via `mix-blend-mode: difference`, so one layer resolves correctly over every
 * colour field with no per-section configuration — see FILL for the arithmetic
 * that makes those land on real palette colours rather than near-misses.
 *
 * The field is a fragment shader — sum of r^2/d^2 over the chain, cut at the
 * isosurface — so the blobs genuinely merge rather than being blur-and-
 * threshold faked, as they were when this was an SVG filter.
 *
 * ── Why the canvas is small and moves ──────────────────────────────────────
 * The cost of this effect is pixels, three times over: the shader fills them,
 * the clear wipes them, and the difference blend makes the compositor re-blend
 * every one of them against the page beneath. A viewport-sized canvas pays all
 * three on ~2M pixels a frame whether the mass is 300px across or not. Profiled
 * on the software rasteriser, that was the entire frame budget: removing this
 * canvas took the page from 12fps to a locked 60, while removing everything
 * else on the page changed nothing.
 *
 * So the canvas is a box just big enough to hold the mass, parked over it with
 * a transform. The trail's length is capped (see MAX_LEN), which is what makes
 * a bounded box possible. Blended area drops by roughly 5x at 1080p, and the
 * clear and fill shrink with it.
 *
 * ── Motion ────────────────────────────────────────────────────────────────
 * The head is pinned to the pointer so the mass reads as attached to it. The
 * rest is a spring chain on a fixed 120Hz step, so 60Hz and 144Hz agree, with
 * stiffness falling away down the chain — the gap that opens between the nodes
 * is what reads as liquid rather than as a shape being dragged. Each blob also
 * elongates along its own velocity, so the body stretches when thrown.
 */

/**
 * The mass is laid along the path the pointer just took, not dragged behind it
 * by springs.
 *
 * Springs were the wrong model. Watch the reference closely and the stroke is
 * clearly a *record*: it lies along the route the cursor travelled, thick at
 * the head, tapering, pinching off into a round droplet at the far tail, and
 * it retracts along itself when you stop. A spring chain can approximate that
 * while moving in a straight line and never gets a corner right — it cuts the
 * corner, because each node is pulled towards the one ahead rather than
 * following where it actually went.
 *
 * So: keep a short history of pointer positions, resample it by arc length
 * every frame, and put a metaball at each sample. The shape then follows the
 * path exactly, the taper is a radius profile rather than an emergent accident,
 * and dropping points once they age out makes the trail retract on its own when
 * the pointer stops — which is also what makes it vanish.
 */

/** Metaballs along the trail. Enough of them that the body is a smooth ribbon
 *  rather than a row of circles. Cheap, because placing them by arc length
 *  removes the need for the per-blob stretch the spring version used. */
const N = 18;
/** Radius at the head, before viewport scaling. */
const R_HEAD = 46;
/** How long a piece of trail survives. This is also what makes the mass
 *  disappear: stop moving and the whole thing ages out from the tail. */
const TRAIL_MS = 320;
/** Longest stretch of path the mass will span, so a fast flick lays down a
 *  ribbon rather than a streak across the whole screen. */
const MAX_LEN = 440;

/**
 * Radius along the trail, head (0) to tail (1). It holds nearly full width for
 * the first third, then falls away — the tail thins faster than the samples
 * spread, which is what lets the very end pinch off into a separate droplet
 * the way poured ink does.
 */
const profile = (u: number) => {
  if (u < 0.3) return 1 - 0.1 * (u / 0.3);
  const v = (u - 0.3) / 0.7;
  return 0.9 * Math.pow(1 - v, 1.45) + 0.06;
};

/** The most each blob's radius can be inflated above its profile value: the
 *  surface ripple multiplies it, and the box has to allow for that or the mass
 *  is clipped square against the canvas edge exactly when it is largest. */
const SWELL = 1.06;
/** Worst-case reach of the summed field, for sizing the canvas. */
const REACH = R_HEAD * SWELL * Math.sqrt(
  Array.from({ length: N }, (_, i) => profile(i / (N - 1)) ** 2).reduce((a, b) => a + b, 0)
);
/** How long a still cursor keeps its mass before it starts retracting. Short
 *  enough to read as "gone the moment you stop", long enough to survive the
 *  gap between two pointer events during ordinary movement. */
const IDLE_AFTER = 110;

/**
 * What the mass is filled with over each field.
 *
 * The layer composites with `mix-blend-mode: difference`, so what you SEE is
 * `|backdrop - fill|` per channel — which means the fill is not the colour of
 * the mass, it is the colour that *solves for* it. Pick the result first, then
 * work backwards: `fill = backdrop ± result`, taking whichever branch stays
 * inside 0–255.
 *
 * The rule the palette is built around: the mass carries the OTHER brand
 * colour. Drag it across ultramarine and it reveals lime; drag it across lime
 * and it reveals ultramarine. Two of the three solve exactly:
 *
 *   over ULTRA (27,0,255)  fill (231,255,255)  ->  (204,255,0)  = #CCFF00 lime
 *   over LIME  (204,255,0) fill (177,255,255)  ->  (27,0,255)   = #1B00FF ultra
 *   over INK   (10,10,10)  fill (214,255,10)   ->  (204,245,0)  ~ lime
 *
 * Ink's green is 10 short of true lime because a channel starting at 10 can
 * reach at most |10 - 255| = 245; 4% down one channel is not something the eye
 * resolves on a moving shape. Ultra's own green is 0x00 for the same class of
 * reason — see the note in index.css's :root.
 *
 * Type knocks out of the mass for free, since the text underneath is a
 * different backdrop running through the same subtraction:
 *
 *   paper type on ultra -> (13,11,16)    near-black, inside a lime mass
 *   paper type on ink   -> (30,11,229)   ultramarine, inside a lime mass
 *   ink type on lime    -> (167,245,245) pale cyan, inside an ultra mass
 *
 * So the mass is never a flat blob: it is lime with black lettering over the
 * hero, lime with blue lettering over the dark fields, blue with pale lettering
 * over lime. Change a palette hex and every number here has to be resolved
 * again — a fill that no longer solves doesn't fail, it just lands on a colour
 * from nowhere in the palette.
 */
const FILL: Record<string, [number, number, number]> = {
  ultra: [0.90588, 1.0, 1.0], //     #E7FFFF -> reveals lime over ultramarine
  lime: [0.69412, 1.0, 1.0], //      #B1FFFF -> reveals ultramarine over lime
  ink: [0.83922, 1.0, 0.03922], //   #D6FF0A -> reveals lime over black
};
/* Must cover what a fully-extended frame actually asks for, with headroom.
   Undersized by even a few pixels, fitBox clamps to it and the mass gets cut
   off against the canvas edge the moment you move fast — which reads exactly
   like the trail snagging. */
const BOX_AT_FULL_SCALE = Math.ceil(MAX_LEN + 2 * REACH + 40);

const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

/* u_blob: xy = centre in viewport CSS px, z = radius. No per-blob stretch any
   more — the ribbon's shape comes from where the samples sit on the path, so
   each iteration is a subtract and a dot instead of a rotate and two scales.
   That pays for more than twice as many of them. */
const FRAG = `
#extension GL_OES_standard_derivatives : enable
precision highp float;
${GLSL_WAVE}

uniform vec2 u_dev;      // backing-store size in device px
uniform float u_inv;     // 1 / devicePixelRatio
uniform vec2 u_origin;   // canvas top-left in viewport CSS px
uniform vec3 u_colA;     // fill above the field boundary
uniform vec3 u_colB;     // fill below it
uniform vec3 u_band;     // divider rect: top, height, element width (CSS px)
uniform vec3 u_wave;     // its live wave: phase, amplitude, seed
uniform float u_hasBand; // 1 when the mass straddles a divider
uniform vec3 u_blob[${N}];

void main() {
  // Fragment -> canvas-local CSS px -> viewport CSS px, which is the space the
  // blob positions live in.
  vec2 p = vec2(gl_FragCoord.x, u_dev.y - gl_FragCoord.y) * u_inv + u_origin;

  float field = 0.0;
  for (int i = 0; i < ${N}; i++) {
    vec2 d = p - u_blob[i].xy;
    float r = u_blob[i].z;
    field += (r * r) / (dot(d, d) + 1.0);
  }

  float f = field - 1.0;
#ifdef GL_OES_standard_derivatives
  // Analytic AA: one pixel of edge regardless of how steep the field is here.
  float a = clamp(f / max(fwidth(f), 1e-5) + 0.5, 0.0, 1.0);
#else
  float a = smoothstep(-0.06, 0.06, f);
#endif

  // Straddling a divider, each half has to be filled with its own field's
  // colour or one of them differences to the wrong thing. One pixel of blend
  // across the boundary; the dividers wave by about 15px either side of this
  // line, which at a soft edge is not something the eye picks up.
  // Where the boundary sits at THIS pixel's x, evaluated from the same three
  // sines the divider is drawn with — a flat split leaves a hairline of the
  // wrong colour along the whole wave.
  float split = u_band.x + u_band.y * 0.5;
  if (u_hasBand > 0.5) {
    float vbX = (p.x / max(u_band.z, 1.0)) * ${VB_W}.0;
    split = u_band.x + (tornWaveVbY(vbX, u_wave.x, u_wave.y, u_wave.z) / ${VB_H}.0) * u_band.y;
  }
  // Stepped, not blended. Blending the two fills puts a 1px line of their
  // mixture along the seam, which is a colour from no part of this palette.
  // A hard handover is invisible across an ultra/ink divider (both fills
  // resolve to lime) and deliberate across an ink/lime one, where the mass
  // genuinely does change colour as it crosses — which is the palette's own
  // swap, not an artefact.
  vec3 col = mix(u_colA, u_colB, step(split, p.y));

  // Premultiplied, to match the context and the ONE / ONE_MINUS_SRC_ALPHA
  // blend. Getting this pair out of step makes the whole canvas composite as
  // opaque, which with a difference blend inverts the page.
  gl_FragColor = vec4(col * a, a);
}
`;

const compile = (gl: WebGLRenderingContext, type: number, src: string) => {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
};

export const LiquidBlobs: React.FC<{ className?: string }> = ({ className }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }

    // No cursor to trail. Keep the mass alive but pen it inside the hero so it
    // can never end up sitting on top of body copy further down the page.
    const coarse =
      typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

    const opts: WebGLContextAttributes = {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
    };
    const gl = (canvas.getContext('webgl2', opts) ||
      canvas.getContext('webgl', opts)) as WebGLRenderingContext | null;

    if (!gl || gl.isContextLost()) return;
    gl.getExtension('OES_standard_derivatives');

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;

    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const quad = new Float32Array(12);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.DYNAMIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uDev = gl.getUniformLocation(prog, 'u_dev');
    const uInv = gl.getUniformLocation(prog, 'u_inv');
    const uOrigin = gl.getUniformLocation(prog, 'u_origin');
    const uColA = gl.getUniformLocation(prog, 'u_colA');
    const uColB = gl.getUniformLocation(prog, 'u_colB');
    const uBand = gl.getUniformLocation(prog, 'u_band');
    const uWave = gl.getUniformLocation(prog, 'u_wave');
    const uHasBand = gl.getUniformLocation(prog, 'u_hasBand');
    const uBlob = gl.getUniformLocation(prog, 'u_blob');

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    let w = 0;
    let h = 0;
    let scale = 1; // radius multiplier for narrow viewports
    let box = 0; // canvas edge length in CSS px

    /* Resolution is adaptive. A soft-edged shape hides a low sample rate well,
       and a machine that cannot hold 60 at full resolution is far better served
       by a slightly softer mass that does. */
    const DPR_STEPS = [1.5, 1.25, 1.0, 0.8, 0.62, 0.5, 0.4];
    let dprStep = 1;
    let dpr = 1;

    const sizeCanvas = () => {
      dpr = Math.min(window.devicePixelRatio || 1, DPR_STEPS[dprStep]);
      canvas.width = Math.round(box * dpr);
      canvas.height = Math.round(box * dpr);
      canvas.style.width = box + 'px';
      canvas.style.height = box + 'px';
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uDev, canvas.width, canvas.height);
      gl.uniform1f(uInv, 1 / dpr);
    };

    /* The box is re-fitted to the mass, not left at the worst case. Worst case
       is every blob coincident AND fully stretched, and those two never happen
       together: coincident means stationary means unstretched. Sized to what
       is actually on screen, the blended area is typically a third of the
       bound. Snapped to a coarse grid and grown eagerly but shrunk lazily, so
       a backing-store reallocation stays a rare event rather than a per-frame
       one. */
    const GRID = 160;
    let maxBox = 0;
    let shrinkFor = 0;

    const fitBox = (needed: number) => {
      const want = Math.min(maxBox, Math.max(GRID * 2, Math.ceil(needed / GRID) * GRID));
      if (want > box) {
        box = want;
        shrinkFor = 0;
        sizeCanvas();
      } else if (want < box && ++shrinkFor > 30) {
        box = want;
        shrinkFor = 0;
        sizeCanvas();
      } else if (want >= box) {
        shrinkFor = 0;
      }
    };

    // Declared before resize(), which runs immediately and marks it stale.
    let geomDirty = true;

    const resize = () => {
      geomDirty = true;
      w = window.innerWidth;
      h = window.innerHeight;
      scale = Math.max(0.46, Math.min(1, w / 1240));
      // The mass shrinks with the viewport, so this stays well under screen
      // size on a phone.
      maxBox = Math.ceil(BOX_AT_FULL_SCALE * scale);
      box = maxBox;
      sizeCanvas();
    };
    resize();

    /* ── trail ──────────────────────────────────────────────────────────── */
    /** Recent pointer path, newest first. Ring-free: it is short, and the
     *  oldest entries are dropped every frame once they age out. */
    type Pt = { x: number; y: number; t: number };
    const trail: Pt[] = [];
    const px = new Float32Array(N); // resampled positions
    const py = new Float32Array(N);
    const blobData = new Float32Array(N * 3);

    let tx = w * 0.5;
    let ty = h * 0.42;
    for (let i = 0; i < N; i++) {
      px[i] = tx;
      py[i] = ty;
    }

    let pointerSeen = false;
    let lastMove = 0;
    const idleAnchor = { x: tx, y: ty };

    /* Where the colour fields start and stop, so the fill can be chosen to
       difference correctly against whatever is behind the mass. Read from the
       DOM because the page owns that layout, cached because it only changes on
       scroll and resize. */
    type Band = {
      el: HTMLElement;
      top: number;
      height: number;
      width: number;
      from: string;
      to: string;
    };
    let bands: Band[] = [];
    let baseTone = 'ultra';

    const readGeometry = () => {
      geomDirty = false;
      const divs = document.querySelectorAll<HTMLElement>('.torn[data-from][data-to]');
      bands = Array.from(divs)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return {
            el,
            top: r.top,
            height: r.height,
            width: r.width,
            from: el.dataset.from || 'ultra',
            to: el.dataset.to || 'ultra',
          };
        })
        .sort((a, b) => a.top - b.top);
      const first = document.querySelector<HTMLElement>('[data-field]');
      baseTone = first?.dataset.field || 'ultra';
    };

    /** The two fills in play around a given height, and the divider to split
     *  them along. Away from any divider both fills are the same and the split
     *  is irrelevant. */
    const fillsAt = (y: number, span: number) => {
      if (geomDirty) readGeometry();
      let tone = baseTone;
      let near: Band | null = null;
      for (const band of bands) {
        // Compare against the wave's own middle, not the element's, so the
        // handover happens where the colour actually changes.
        const mid = band.top + band.height / 2;
        if (y > mid) tone = band.to;
        // Straddling counts generously: the amplitude swells with scroll, so
        // the curve can reach beyond the element's midline.
        if (y > band.top - span && y < band.top + band.height + span) near = band;
      }
      if (near) {
        const wave = waveRegistry.get(near.el);
        return {
          a: FILL[near.from] || FILL.ultra,
          b: FILL[near.to] || FILL.ultra,
          band: near,
          wave,
        };
      }
      const f = FILL[tone] || FILL.ultra;
      return { a: f, b: f, band: null, wave: undefined };
    };

    const onScroll = () => {
      geomDirty = true;
    };

    /* The mass inverts everything it covers, which is the point of it — but
       held over a table of figures or a field someone is typing into, that
       stops being a flourish and starts being an obstruction. So it retreats
       over anything marked quiet and comes straight back on the way out. */
    const QUIET = '[data-quiet], input, textarea, .ag-root-wrapper';
    /* Magnetism: over something you can actually press, the head is drawn
       towards the middle of it, so the mass settles onto the control instead
       of hovering near it. */
    const MAGNET = 'a, button, .pill, [data-magnet]';
    let quietTarget = 0;
    /* The pull is NOT applied here: snapping the recorded point to a control's
       centre the instant the pointer touches it means a fast sweep across the
       hero yanks the trail sideways at every button it crosses, which looks
       exactly like the trail catching on things. The target is remembered and
       the pull is eased in by the loop, and only while the pointer is slow
       enough to count as hovering rather than passing through. */
    let magX = 0;
    let magY = 0;
    let magWanted = 0;
    let speed = 0; // smoothed, px/s

    const onMove = (e: PointerEvent) => {
      const now = performance.now();
      const x = e.clientX;
      const y = e.clientY;

      const el = e.target as Element | null;
      quietTarget = el && el.closest && el.closest(QUIET) ? 1 : 0;

      const dtm = Math.max(1, now - lastMove);
      const inst = Math.hypot(x - tx, y - ty) / (dtm / 1000);
      speed += (inst - speed) * 0.35;

      const mag = el && el.closest ? (el.closest(MAGNET) as HTMLElement | null) : null;
      if (mag && !quietTarget) {
        const r = mag.getBoundingClientRect();
        magX = r.left + r.width / 2;
        magY = r.top + r.height / 2;
        // Only grab when dwelling. Above roughly a flick's speed the pointer
        // is passing over, not aiming at it.
        magWanted = speed < 760 ? 1 : 0;
      } else {
        magWanted = 0;
      }

      tx = x;
      ty = y;
      pointerSeen = true;
      lastMove = now;

      // Drop samples that are too close together, or a slow drag fills the
      // trail with points spanning almost no distance.
      const head = trail[0];
      if (!head || (x - head.x) ** 2 + (y - head.y) ** 2 > 4) {
        trail.unshift({ x, y, t: now });
        if (trail.length > 140) trail.length = 140;
      }
    };

    /* ── loop ───────────────────────────────────────────────────────────── */
    let prev = performance.now();
    const t0 = prev;
    let raf = 0;
    let idleMix = 0; // 0 = following pointer, 1 = fully idle
    let quietMix = 0; // 0 = full mass, 1 = withdrawn over a quiet surface
    let magMix = 0; // 0 = on the pointer, 1 = pulled onto a control

    // Rolling frame-time watch, feeding the resolution step above.
    let samples = 0;
    let slow = 0;
    let fast = 0;
    let hidden = false;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);

      let dt = (now - prev) / 1000;
      prev = now;
      if (dt > 0.1) dt = 0.1; // a backgrounded tab must not fling the chain
      const t = (now - t0) / 1000;

      /* Adaptive resolution. Judged over whole seconds, and only while the
         mass is actually being drawn, so a stall from elsewhere on the page
         doesn't permanently downgrade it. */
      if (dt > 0.0205) slow++;
      else if (dt < 0.0145) fast++;
      if (++samples >= 40) {
        // Drop fast (a third of the window missing frames is enough), climb
        // back slowly and only from a window that was almost entirely clean.
        if (slow > 13 && dprStep < DPR_STEPS.length - 1) {
          dprStep++;
          sizeCanvas();
        } else if (fast > 37 && dprStep > 0) {
          dprStep--;
          sizeCanvas();
        }
        samples = slow = fast = 0;
      }

      /* The mass belongs to the cursor, so a still cursor has no mass: it
         retracts to nothing shortly after you stop and comes back the moment
         you move. Touch is the exception — there is no pointer there to answer
         to, so rather than never appearing at all it drifts the hero.

         "The hero" means literally that: the #top section Hero.tsx renders,
         which only exists on the landing page. A null getElementById used to
         fall through to top=0/hh=h, so the drift ran full-viewport-tall on
         every OTHER route too — a solid disc left drifting over the ledger,
         the agent page, history, wherever a touch user happened to be. It
         retracts like the desktop pointer does on any page that isn't the
         hero, and only drifts where there's a hero to drift across. */
      if (now - lastMove > 90) speed *= Math.pow(0.02, dt);
      const heroEl = coarse ? document.getElementById('top') : null;
      const idle = coarse ? !heroEl : !pointerSeen || now - lastMove > IDLE_AFTER;
      // Asymmetric on purpose: appearing should feel instant, leaving should
      // still be a retraction rather than a cut.
      idleMix += ((idle ? 1 : 0) - idleMix) * Math.min(1, dt * (idle ? 11 : 20));
      quietMix += (quietTarget - quietMix) * Math.min(1, dt * 6.5);

      if (coarse && heroEl) {
        // Penned to the hero: anchored mid-viewport it would sit on top of the
        // body copy of whatever section you scrolled to.
        const r = heroEl.getBoundingClientRect();
        const top = r.top;
        const hh = r.height;
        idleAnchor.x = w * (0.5 + 0.26 * Math.sin(t * 0.31));
        idleAnchor.y = top + hh * (0.34 + 0.12 * Math.sin(t * 0.43 + 1.1));
        tx = idleAnchor.x + 46 * Math.sin(t * 0.37);
        ty = idleAnchor.y + 34 * Math.sin(t * 0.52 + 0.8);
      }

      /* Age the trail out from the tail. This is the whole retraction: stop
         moving and the ribbon shortens into the head and goes, without any
         separate "put it away" animation. */
      // Ease the magnet in and out rather than snapping to it, and let it go
      // as soon as the pointer speeds up again.
      if (speed > 1100) magWanted = 0;
      magMix += (magWanted - magMix) * Math.min(1, dt * (magWanted ? 7 : 11));
      const hx = tx + (magX - tx) * 0.42 * magMix;
      const hy = ty + (magY - ty) * 0.62 * magMix;

      const cutoff = now - TRAIL_MS;
      while (trail.length && trail[trail.length - 1].t < cutoff) trail.pop();
      if (trail.length === 0 || idleMix > 0.995) {
        trail.length = 0;
        trail.push({ x: hx, y: hy, t: now });
      } else {
        // Keep the head glued to the pointer between events. Only the head
        // carries the magnet offset — the body stays on the path the pointer
        // really took, so the ribbon leans into a control without the whole
        // trail lurching across to it.
        trail[0].x = hx;
        trail[0].y = hy;
      }

      /* Resample the path at even arc-length steps, so the metaballs sit on
         the route the pointer actually took — corners included — rather than
         on a line that cuts across them. */
      let total = 0;
      for (let i = 1; i < trail.length; i++) {
        total += Math.hypot(trail[i].x - trail[i - 1].x, trail[i].y - trail[i - 1].y);
      }
      const span = Math.min(total, MAX_LEN * scale);
      const stepLen = span / (N - 1);

      px[0] = trail[0].x;
      py[0] = trail[0].y;
      let seg = 1;
      let walked = 0; // distance covered up to trail[seg - 1]
      let want = stepLen;
      for (let i = 1; i < N; i++, want += stepLen) {
        while (seg < trail.length) {
          const a = trail[seg - 1];
          const b = trail[seg];
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          if (walked + len >= want || seg === trail.length - 1) {
            const f = len > 0 ? Math.min(1, (want - walked) / len) : 0;
            px[i] = a.x + (b.x - a.x) * f;
            py[i] = a.y + (b.y - a.y) * f;
            break;
          }
          walked += len;
          seg++;
        }
        if (seg >= trail.length) {
          px[i] = trail[trail.length - 1].x;
          py[i] = trail[trail.length - 1].y;
        }
      }

      /* Smooth the resampled line. The raw pointer stream is jittery at small
         scales and the ribbon shows every bit of it. */
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 1; i < N - 1; i++) {
          px[i] = px[i] * 0.5 + (px[i - 1] + px[i + 1]) * 0.25;
          py[i] = py[i] * 0.5 + (py[i - 1] + py[i + 1]) * 0.25;
        }
      }

      /* A short trail means the pointer is barely moving, so the mass draws in
         rather than sitting there as a full-size disc. */
      const extent = Math.min(1, span / (MAX_LEN * scale * 0.42));
      const body = 0.55 + 0.45 * extent;

      for (let i = 0; i < N; i++) {
        const o = i * 3;
        blobData[o] = px[i];
        blobData[o + 1] = py[i];
        // A slow ripple travels the length of the ribbon, so its edge is never
        // a run of perfect circles.
        const wob = 1 + 0.055 * Math.sin(t * 2.6 - i * 0.7);
        blobData[o + 2] =
          R_HEAD * scale * profile(i / (N - 1)) * body * wob *
          (1 - idleMix) * (1 - quietMix);
      }

      // Fit and centre the canvas on the mass.
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      let reachSq = 0;
      for (let i = 0; i < N; i++) {
        if (px[i] < x0) x0 = px[i];
        if (px[i] > x1) x1 = px[i];
        if (py[i] < y0) y0 = py[i];
        if (py[i] > y1) y1 = py[i];
        const e = blobData[i * 3 + 2];
        reachSq += e * e;
      }
      fitBox(Math.max(x1 - x0, y1 - y0) + 2 * Math.sqrt(reachSq) + 16);

      const ox = Math.round((x0 + x1) / 2 - box / 2);
      const oy = Math.round((y0 + y1) / 2 - box / 2);

      // Withdrawn to nothing, or entirely off-screen. Taking the layer out
      // altogether skips the blend as well as the draw — leaving a fully
      // transparent one up still costs a composite pass over its whole box.
      const nothingToDraw =
        quietMix > 0.985 ||
        idleMix > 0.985 ||
        ox > w || oy > h || ox + box < 0 || oy + box < 0;
      if (nothingToDraw) {
        if (!hidden) {
          canvas.style.display = 'none';
          hidden = true;
        }
        return;
      }
      if (hidden) {
        canvas.style.display = 'block';
        hidden = false;
      }

      canvas.style.transform = `translate3d(${ox}px, ${oy}px, 0)`;
      gl.uniform2f(uOrigin, ox, oy);

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      // Fit the drawn quad to the mass inside the canvas, in canvas-local clip
      // space. When the mass is compact this is a fraction of the box.
      const reach = Math.sqrt(reachSq) + 8;
      const toClipX = (v: number) => ((Math.min(Math.max(v - ox, 0), box) / box) * 2 - 1);
      const toClipY = (v: number) => (1 - (Math.min(Math.max(v - oy, 0), box) / box) * 2);
      const cx0 = toClipX(x0 - reach);
      const cx1 = toClipX(x1 + reach);
      const cy0 = toClipY(y0 - reach);
      const cy1 = toClipY(y1 + reach);
      quad.set([cx0, cy0, cx1, cy0, cx0, cy1, cx0, cy1, cx1, cy0, cx1, cy1]);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, quad);

      const cy = (y0 + y1) / 2;
      const { a: colA, b: colB, band, wave } = fillsAt(cy, reach);
      gl.uniform3f(uColA, colA[0], colA[1], colA[2]);
      gl.uniform3f(uColB, colB[0], colB[1], colB[2]);
      if (band && wave) {
        gl.uniform3f(uBand, band.top, band.height, band.width);
        gl.uniform3f(uWave, wave.phase, wave.amp, wave.seed);
        gl.uniform1f(uHasBand, 1);
      } else {
        // No divider in range: both fills are equal, so the split only has to
        // be somewhere that doesn't cut through the mass.
        gl.uniform3f(uBand, cy * 2 + 4000, 1, Math.max(w, 1));
        gl.uniform1f(uHasBand, 0);
      }

      gl.uniform3fv(uBlob, blobData);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };

    raf = requestAnimationFrame(tick);
    if (!coarse) window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('resize', resize);
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('resize', resize);
      window.removeEventListener('scroll', onScroll);
      // Deliberately NOT calling WEBGL_lose_context here. A lost context is
      // permanent for that canvas — getContext hands the dead one back — so
      // any remount (StrictMode's double-invoke, most obviously) would get a
      // context that silently no-ops every call.
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buf);
    };
  }, []);

  return <canvas ref={canvasRef} className={className ?? 'blobs'} aria-hidden="true" />;
};

export default LiquidBlobs;
