import React, { useEffect, useRef } from 'react';

/**
 * The signature move: a liquid mass of ink that trails the pointer across the
 * whole document and knocks out whatever it passes over.
 *
 *   yellow mass over the acid field -> black   (ink spreading)
 *   yellow mass over black type     -> yellow  (type knocks out)
 *
 * via `mix-blend-mode: difference`, so one layer inverts correctly over every
 * colour field with no per-section configuration.
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
 * a transform. The chain's reach is bounded (see LINK_MAX), which is what makes
 * a fixed-size box possible. Blended area drops by roughly 5x at 1080p, and the
 * clear and fill shrink with it.
 *
 * ── Motion ────────────────────────────────────────────────────────────────
 * The head is pinned to the pointer so the mass reads as attached to it. The
 * rest is a spring chain on a fixed 120Hz step, so 60Hz and 144Hz agree, with
 * stiffness falling away down the chain — the gap that opens between the nodes
 * is what reads as liquid rather than as a shape being dragged. Each blob also
 * elongates along its own velocity, so the body stretches when thrown.
 */

const CHAIN = [
  { r: 72, k: 1.000 }, // head: pinned to the pointer, k unused
  { r: 66, k: 0.150 },
  { r: 59, k: 0.098 },
  { r: 52, k: 0.070 },
  { r: 45, k: 0.052 },
  { r: 38, k: 0.040 },
  { r: 31, k: 0.031 },
  { r: 24, k: 0.024 },
];
const N = CHAIN.length;

/**
 * How far each node may trail the one ahead of it. Past roughly 0.62x the sum
 * of two radii the summed field no longer clears the isosurface between them
 * and the mass visibly tears into separate droplets — which is what it was
 * doing on a fast flick. Clamping the link keeps it one body at any speed, and
 * as a side effect bounds the chain's total extent, which is what lets the
 * canvas be a fixed size.
 */
const LINK_MAX = CHAIN.slice(0, -1).map((b, i) => 0.62 * (b.r + CHAIN[i + 1].r));
/** Worst-case extent of the whole mass: every link at full stretch, plus the
 *  reach of the field around the ends. */
const SPAN = LINK_MAX.reduce((a, b) => a + b, 0);
const REACH = Math.sqrt(CHAIN.reduce((a, b) => a + b.r * b.r, 0));
const MAX_STRETCH = 1.55;
/** How long a still cursor keeps its mass before it starts retracting. Long
 *  enough not to flicker on the pauses inside ordinary pointer movement,
 *  short enough that stopping to read clears the page. */
const IDLE_AFTER = 650;
const BOX_AT_FULL_SCALE = Math.ceil(SPAN + 2 * REACH * MAX_STRETCH);

const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

/* u_blob: xy = centre in viewport CSS px, z = radius, w = stretch along u_dir */
const FRAG = `
#extension GL_OES_standard_derivatives : enable
precision highp float;

uniform vec2 u_dev;      // backing-store size in device px
uniform float u_inv;     // 1 / devicePixelRatio
uniform vec2 u_origin;   // canvas top-left in viewport CSS px
uniform vec4 u_blob[${N}];
uniform vec2 u_dir[${N}];

void main() {
  // Fragment -> canvas-local CSS px -> viewport CSS px, which is the space the
  // blob positions live in.
  vec2 p = vec2(gl_FragCoord.x, u_dev.y - gl_FragCoord.y) * u_inv + u_origin;

  float field = 0.0;
  for (int i = 0; i < ${N}; i++) {
    vec2 d = p - u_blob[i].xy;
    float s = u_blob[i].w;
    vec2 dir = u_dir[i];
    // Rotate into the blob's own frame, then stretch along it. The across-axis
    // is squeezed by far less than area preservation would ask for: at speed
    // that turned the mass into a hairline.
    float across = pow(s, 0.3);
    d = vec2(dot(d, dir) / s, dot(d, vec2(-dir.y, dir.x)) * across);
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

  // Premultiplied, to match the context and the ONE / ONE_MINUS_SRC_ALPHA
  // blend. Getting this pair out of step makes the whole canvas composite as
  // opaque, which with a difference blend inverts the page.
  gl_FragColor = vec4(vec3(1.0, 0.898, 0.0) * a, a);
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
    const uBlob = gl.getUniformLocation(prog, 'u_blob');
    const uDir = gl.getUniformLocation(prog, 'u_dir');

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    let w = 0;
    let h = 0;
    let scale = 1; // radius multiplier for narrow viewports
    let box = 0; // canvas edge length in CSS px

    /* Resolution is adaptive. A soft-edged shape hides a low sample rate well,
       and a machine that cannot hold 60 at full resolution is far better served
       by a slightly softer mass that does. */
    const DPR_STEPS = [1.5, 1.25, 1.0, 0.8, 0.62];
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

    const resize = () => {
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

    /* ── physics state ──────────────────────────────────────────────────── */
    const px = new Float32Array(N);
    const py = new Float32Array(N);
    const vx = new Float32Array(N);
    const vy = new Float32Array(N);
    const blobData = new Float32Array(N * 4);
    const dirData = new Float32Array(N * 2);

    let tx = w * 0.5;
    let ty = h * 0.42;
    for (let i = 0; i < N; i++) {
      px[i] = tx;
      py[i] = ty;
      dirData[i * 2] = 1;
    }

    let pointerSeen = false;
    let lastMove = 0;
    const idleAnchor = { x: tx, y: ty };

    /* The mass inverts everything it covers, which is the point of it — but
       held over a table of figures or a field someone is typing into, that
       stops being a flourish and starts being an obstruction. So it retreats
       over anything marked quiet and comes straight back on the way out. */
    const QUIET = '[data-quiet], input, textarea, .ag-root-wrapper';
    let quietTarget = 0;

    const onMove = (e: PointerEvent) => {
      tx = e.clientX;
      ty = e.clientY;
      pointerSeen = true;
      lastMove = performance.now();
      const el = e.target as Element | null;
      quietTarget = el && el.closest && el.closest(QUIET) ? 1 : 0;
    };

    /* ── loop ───────────────────────────────────────────────────────────── */
    const DAMP = 0.855;
    const STEP = 1 / 120; // fixed physics step, so 60Hz and 144Hz agree
    let acc = 0;
    let prev = performance.now();
    const t0 = prev;
    let raf = 0;
    let idleMix = 0; // 0 = following pointer, 1 = fully idle
    let quietMix = 0; // 0 = full mass, 1 = withdrawn over a quiet surface

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
         to, so rather than never appearing at all it drifts the hero. */
      const idle = coarse ? false : !pointerSeen || now - lastMove > IDLE_AFTER;
      idleMix += ((idle ? 1 : 0) - idleMix) * Math.min(1, dt * 4.4);
      quietMix += (quietTarget - quietMix) * Math.min(1, dt * 6.5);

      if (coarse) {
        // Penned to the hero: anchored mid-viewport it would sit on top of the
        // body copy of whatever section you scrolled to.
        const hero = document.getElementById('top');
        const r = hero?.getBoundingClientRect();
        const top = r ? r.top : 0;
        const hh = r ? r.height : h;
        idleAnchor.x = w * (0.5 + 0.26 * Math.sin(t * 0.31));
        idleAnchor.y = top + hh * (0.34 + 0.12 * Math.sin(t * 0.43 + 1.1));
        tx = idleAnchor.x + 46 * Math.sin(t * 0.37);
        ty = idleAnchor.y + 34 * Math.sin(t * 0.52 + 0.8);
      }

      // Fully retracted: park the whole chain on the pointer so that when it
      // next moves the mass grows out of the cursor, rather than streaking
      // across from wherever it was last seen.
      if (idleMix > 0.99) {
        for (let i = 0; i < N; i++) {
          px[i] = tx;
          py[i] = ty;
          vx[i] = 0;
          vy[i] = 0;
        }
      }

      acc += dt;
      let guard = 0;
      while (acc >= STEP && guard++ < 12) {
        acc -= STEP;

        // Head is the pointer. Anything less and the mass reads as sliding
        // after the cursor rather than being held by it.
        const hvx = tx - px[0];
        const hvy = ty - py[0];
        vx[0] = hvx;
        vy[0] = hvy;
        px[0] = tx;
        py[0] = ty;

        for (let i = 1; i < N; i++) {
          const k = CHAIN[i].k;
          vx[i] = (vx[i] + (px[i - 1] - px[i]) * k) * DAMP;
          vy[i] = (vy[i] + (py[i - 1] - py[i]) * k) * DAMP;
          px[i] += vx[i];
          py[i] += vy[i];

          // Hard limit on how far this node may fall behind, so the field
          // always has enough overlap to stay one body.
          const lim = LINK_MAX[i - 1] * scale;
          const dx = px[i] - px[i - 1];
          const dy = py[i] - py[i - 1];
          const d2 = dx * dx + dy * dy;
          if (d2 > lim * lim) {
            const inv = lim / Math.sqrt(d2);
            px[i] = px[i - 1] + dx * inv;
            py[i] = py[i - 1] + dy * inv;
          }
        }
      }

      for (let i = 0; i < N; i++) {
        const sp = Math.hypot(vx[i], vy[i]);
        if (sp > 0.08) {
          dirData[i * 2] = vx[i] / sp;
          dirData[i * 2 + 1] = vy[i] / sp;
        }
        const o = i * 4;
        blobData[o] = px[i];
        blobData[o + 1] = py[i];
        // Retracts to nothing when the cursor stops, and withdraws to nothing
        // over a surface someone is trying to read or type into.
        blobData[o + 2] = CHAIN[i].r * scale * (1 - idleMix) * (1 - quietMix);
        blobData[o + 3] = 1 + Math.min(MAX_STRETCH - 1, sp * 0.042);
      }

      // Fit and centre the canvas on the mass.
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      let reachSq = 0;
      for (let i = 0; i < N; i++) {
        if (px[i] < x0) x0 = px[i];
        if (px[i] > x1) x1 = px[i];
        if (py[i] < y0) y0 = py[i];
        if (py[i] > y1) y1 = py[i];
        // How far this frame's field can actually reach: the coincident-mass
        // radius built from the radii and stretches in play right now.
        const e = blobData[i * 4 + 2] * blobData[i * 4 + 3];
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

      gl.uniform4fv(uBlob, blobData);
      gl.uniform2fv(uDir, dirData);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };

    raf = requestAnimationFrame(tick);
    if (!coarse) window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('resize', resize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('resize', resize);
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
