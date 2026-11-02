import React, { useEffect, useRef } from 'react';

/**
 * The signature move: a liquid mass of ink that trails the pointer across the
 * whole document and knocks out whatever it passes over.
 *
 * This used to be SVG circles behind a `feGaussianBlur` + alpha-contrast
 * filter. It looked right and ran badly: the browser re-rasterized the entire
 * filter region on the CPU every single frame and then recomposited that
 * result against the page underneath through `mix-blend-mode: difference`.
 * Two full-viewport software passes per frame is not a 60fps budget.
 *
 * So the goo is a fragment shader now. One fullscreen quad evaluates a
 * metaball field — sum of r^2 / d^2 over the chain — and cuts it at the
 * isosurface. The merge is exact rather than an approximation of blur plus
 * contrast, the whole thing lives on the GPU, and the cost is independent of
 * how many blobs are in the chain.
 *
 * The blend stays: yellow fill differenced against the page gives
 *
 *   yellow mass over the acid field -> black   (ink spreading)
 *   yellow mass over black type     -> yellow  (type knocks out)
 *
 * so one layer inverts correctly over every field with no configuration.
 *
 * Motion is a spring chain, not a lerp. Each node accelerates toward the one
 * ahead of it and keeps its velocity, which is what makes the mass surge and
 * settle instead of gliding. Speed also stretches each blob along its own
 * direction of travel at constant area, so the body elongates into a tail when
 * you throw the cursor and relaxes back to round when you stop.
 */

/** Chain shape. Stiffness falls off down the chain to make the tail lag. */
/** Stiff head so the mass feels pinned to the cursor, then a steep falloff so
 *  the body has to catch up — that gap is what reads as liquid rather than as
 *  a shape being dragged around. */
const CHAIN = [
  { r: 72, k: 0.340 },
  { r: 65, k: 0.150 },
  { r: 58, k: 0.095 },
  { r: 51, k: 0.066 },
  { r: 44, k: 0.049 },
  { r: 37, k: 0.037 },
  { r: 30, k: 0.028 },
  { r: 23, k: 0.021 },
];
const N = CHAIN.length;

const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

/* xy = centre in CSS px, z = radius, w = stretch along u_dir (area preserved) */
const FRAG = `
#extension GL_OES_standard_derivatives : enable
precision highp float;

uniform vec2 u_res;
uniform vec4 u_blob[${N}];
uniform vec2 u_dir[${N}];

void main() {
  vec2 p = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);

  float field = 0.0;
  for (int i = 0; i < ${N}; i++) {
    vec2 d = p - u_blob[i].xy;
    float s = u_blob[i].w;
    vec2 dir = u_dir[i];
    // Rotate into the blob's own frame and scale the two axes inversely, so a
    // fast blob becomes a lozenge pointing the way it is going.
    d = vec2(dot(d, dir) / s, dot(d, vec2(-dir.y, dir.x)) * s);
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
  // blend below. Getting this pair out of step makes the whole canvas
  // composite as opaque, which with a difference blend inverts the page.
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

    const reduced =
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

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

    // The quad is refitted to the chain's bounding box every frame instead of
    // covering the viewport. The mass occupies a few percent of the screen, so
    // shading all of it is wasted fill — and fill is the whole cost here.
    const quad = new Float32Array(12);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.DYNAMIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, 'u_res');
    const uBlob = gl.getUniformLocation(prog, 'u_blob');
    const uDir = gl.getUniformLocation(prog, 'u_dir');

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    let w = 0;
    let h = 0;
    let scale = 1; // radius multiplier for narrow viewports

    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      // Capping DPR at 1.75 costs nothing visible on a soft-edged blob and
      // keeps fill rate sane on 3x phones.
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, w, h);
      scale = Math.max(0.46, Math.min(1, w / 1240));
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
    let idleAnchor = { x: tx, y: ty };

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

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);

      let dt = (now - prev) / 1000;
      prev = now;
      if (dt > 0.1) dt = 0.1; // a backgrounded tab must not fling the chain
      const t = (now - t0) / 1000;

      const idle = !pointerSeen || now - lastMove > 1800;
      idleMix += ((idle ? 1 : 0) - idleMix) * Math.min(1, dt * 2.2);
      quietMix += (quietTarget - quietMix) * Math.min(1, dt * 6.5);

      if (idle) {
        // Where the mass rests depends on whether it has a cursor to answer
        // to. Once the pointer has moved it parks where it was left, which is
        // where the eye already is. Until then — touch, or a mouse that hasn't
        // moved yet — it belongs in the hero: anchored mid-viewport it would
        // sit on top of the body copy of whatever section you scrolled to.
        if (coarse || !pointerSeen) {
          const hero = document.getElementById('top');
          const r = hero?.getBoundingClientRect();
          const top = r ? r.top : 0;
          const hh = r ? r.height : h;
          idleAnchor.x = w * (0.5 + 0.26 * Math.sin(t * 0.31));
          idleAnchor.y = top + hh * (0.34 + 0.12 * Math.sin(t * 0.43 + 1.1));
        }
        tx = idleAnchor.x + 46 * Math.sin(t * 0.37);
        ty = idleAnchor.y + 34 * Math.sin(t * 0.52 + 0.8);
      } else {
        idleAnchor.x = tx;
        idleAnchor.y = ty;
      }

      acc += dt;
      let guard = 0;
      while (acc >= STEP && guard++ < 12) {
        acc -= STEP;
        let ax = tx;
        let ay = ty;
        for (let i = 0; i < N; i++) {
          const k = CHAIN[i].k;
          vx[i] = (vx[i] + (ax - px[i]) * k) * DAMP;
          vy[i] = (vy[i] + (ay - py[i]) * k) * DAMP;
          px[i] += vx[i];
          py[i] += vy[i];
          ax = px[i];
          ay = py[i];
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
        // Idle mass contracts a little so a parked blob reads as resting.
        blobData[o + 2] = CHAIN[i].r * scale * (1 - 0.22 * idleMix) * (1 - 0.94 * quietMix);
        // Stretch saturates, or a fast flick turns the chain into needles.
        blobData[o + 3] = 1 + Math.min(0.85, sp * 0.055);
      }

      // Bounding box of the chain, padded by how far the isosurface can
      // possibly reach. Not r: the field is a SUM, so where blobs pile up the
      // surface pushes well past any single radius. The worst case is every
      // blob coincident, which puts it at sqrt(sum of r^2) — bound it by that,
      // times the largest stretch in play, or a fast flick clips its own tail.
      let maxStretch = 1;
      let rsq = 0;
      for (let i = 0; i < N; i++) {
        rsq += blobData[i * 4 + 2] * blobData[i * 4 + 2];
        if (blobData[i * 4 + 3] > maxStretch) maxStretch = blobData[i * 4 + 3];
      }
      const reach = Math.sqrt(rsq) * maxStretch + 8;

      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < N; i++) {
        const o = i * 4;
        if (blobData[o] - reach < x0) x0 = blobData[o] - reach;
        if (blobData[o] + reach > x1) x1 = blobData[o] + reach;
        if (blobData[o + 1] - reach < y0) y0 = blobData[o + 1] - reach;
        if (blobData[o + 1] + reach > y1) y1 = blobData[o + 1] + reach;
      }

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      // Nothing of the mass is on screen — the clear above is the whole frame.
      if (x1 < 0 || y1 < 0 || x0 > w || y0 > h) return;

      const cx0 = (Math.max(x0, 0) / w) * 2 - 1;
      const cx1 = (Math.min(x1, w) / w) * 2 - 1;
      const cy0 = 1 - (Math.max(y0, 0) / h) * 2;
      const cy1 = 1 - (Math.min(y1, h) / h) * 2;
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
