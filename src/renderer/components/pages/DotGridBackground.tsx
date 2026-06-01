// src/renderer/components/pages/DotGridBackground.tsx
//
// Animated dot-grid background for the sign-in screen, inspired by Claude's
// landing surface. A fixed grid of dots sits at a faint baseline; soft radial
// "light patches" drift across the screen, brightening the dots they overlap
// with a smooth radial falloff. The brightest core of each patch picks up a
// touch of the brand terracotta. Patches breathe slowly (fade in -> hold ->
// fade out) and respawn at new random positions, so different regions of the
// screen light up over time.
//
// Rendering uses a single full-bleed <canvas> (Approach A). Only dot *opacity*
// (and a small color mix) animates; geometry is computed once per resize, which
// keeps the per-frame cost to alpha math + fillRect. The loop is throttled to
// ~30fps because the fades are multi-second — extra frames would be invisible.
//
// The loop always runs: this is an aria-hidden decorative surface whose slow,
// non-flashing drift carries no information, so it deliberately does not branch
// on prefers-reduced-motion (that branch used to freeze the grid on Windows).

import React, { useEffect, useRef } from 'react';

// ---------------------------------------------------------------------------
// Tunable knobs — adjust these to taste while eyeballing the effect.
// ---------------------------------------------------------------------------
const CONFIG = {
  // Grid geometry (CSS pixels)
  spacing: 11, // distance between adjacent dots — denser grid = more dots per patch
  dotSize: 1.3, // rendered dot diameter

  // Brightness tiers (0..1 alpha)
  baselineAlpha: 0.03, // resting opacity of every dot
  peakAlpha: 0.99, // max opacity at a patch's center

  // Patch (light region) behavior
  patchCount: 7, // concurrent patches on screen
  radiusMin: 150, // patch radius range (CSS px) — larger = each patch covers more dots
  radiusMax: 280,
  fadeInMs: 800, // breathe timings
  holdMs: 4100, // long hold so the patch visibly drifts while lit
  fadeOutMs: 900,
  spawnJitterMs: 700, // random extra delay before a dead patch respawns

  // Drift — patches travel continuously so neighboring dots light up in
  // sequence (a wave across the surface) rather than blinking at random spots.
  driftMin: 22, // patch travel speed range (CSS px / second)
  driftMax: 55,

  // Terracotta accent — the brightest core of a tinted patch warms up
  tintProbability: 0.65, // chance a given patch is a "warm" patch
  tintCoreFraction: 0.32, // inner fraction of radius that receives tint
  tintMaxStrength: 0.6, // 0..1 max terracotta mix at the very center

  // Frame pacing
  targetFps: 30,
};

// Base (grey) dot color, as an RGB triple.
const GREY: [number, number, number] = [150, 150, 150];
// Brand-accent fallback if the --si-gold token can't be read (was the old
// hardcoded terracotta). At runtime we resolve the live --si-gold token so the
// dot grid follows the theme — see resolveAccent() below.
const ACCENT_FALLBACK: [number, number, number] = [122, 150, 193]; // --si-gold #7a96c1

// Parse a CSS color token (#rgb / #rrggbb) into an [r,g,b] triple. Canvas
// fillStyle needs concrete numbers, so we read the --si-gold custom property
// once on mount and convert it; this is the one place a CSS var can't be used
// directly (the colour is math-mixed per-dot, not handed to the DOM).
function resolveAccent(): [number, number, number] {
  try {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue('--si-gold')
      .trim();
    let hex = raw.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    if (hex.length === 6) {
      const n = parseInt(hex, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
  } catch {
    /* fall through to fallback */
  }
  return ACCENT_FALLBACK;
}

interface Patch {
  cx: number;
  cy: number;
  vx: number; // velocity (CSS px / second) — gives continuous drift
  vy: number;
  radius: number;
  peak: number; // this patch's peak intensity (0..1), slightly randomized
  tint: number; // 0 = neutral grey, >0 = warm; scales tintMaxStrength
  startAt: number; // timestamp (ms) when fade-in began
  bornAt: number; // timestamp (ms) when this slot becomes active (respawn delay)
  total: number; // full lifecycle duration (fadeIn + hold + fadeOut)
}

// smoothstep: 0..1 -> 0..1 with eased ends. Gives the soft cloud falloff.
function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

export const DotGridBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Resolve the live brand accent once on mount so the dot grid follows the
    // --si-gold theme token instead of a hardcoded colour.
    const ACCENT = resolveAccent();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Dot positions in CSS pixels, recomputed on resize.
    let dots: Array<{ x: number; y: number }> = [];
    let patches: Patch[] = [];
    let cssW = 0;
    let cssH = 0;
    let dpr = 1;

    const rand = (min: number, max: number) => min + Math.random() * (max - min);

    // Create a fresh patch at a random position with a random lifecycle.
    // `now` lets us stagger initial spawns so they don't all pulse in sync.
    const makePatch = (now: number, initialStagger = 0): Patch => {
      const isTinted = Math.random() < CONFIG.tintProbability;
      const total = CONFIG.fadeInMs + CONFIG.holdMs + CONFIG.fadeOutMs;
      const bornAt = now + initialStagger;
      const angle = rand(0, Math.PI * 2);
      const speed = rand(CONFIG.driftMin, CONFIG.driftMax);
      return {
        cx: rand(0, cssW),
        cy: rand(0, cssH),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: rand(CONFIG.radiusMin, CONFIG.radiusMax),
        peak: rand(0.8, 1) * CONFIG.peakAlpha,
        tint: isTinted ? rand(0.5, 1) : 0,
        startAt: bornAt,
        bornAt,
        total,
      };
    };

    // Current intensity (0..1) of a patch given the clock.
    const patchIntensity = (p: Patch, now: number): number => {
      const t = now - p.startAt;
      if (t < 0) return 0; // not yet born (respawn delay)
      if (t < CONFIG.fadeInMs) return smoothstep(t / CONFIG.fadeInMs);
      if (t < CONFIG.fadeInMs + CONFIG.holdMs) return 1;
      if (t < p.total) {
        const ft = (t - CONFIG.fadeInMs - CONFIG.holdMs) / CONFIG.fadeOutMs;
        return 1 - smoothstep(ft);
      }
      return -1; // dead — signal for respawn
    };

    const setupGrid = () => {
      const parent = canvas.parentElement;
      const rect = parent
        ? parent.getBoundingClientRect()
        : { width: window.innerWidth, height: window.innerHeight };
      cssW = Math.max(1, Math.floor(rect.width));
      cssH = Math.max(1, Math.floor(rect.height));
      dpr = Math.min(window.devicePixelRatio || 1, 2); // cap at 2x — 3x retina buys nothing here

      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS-pixel space

      // Build the dot grid, centered so edges have symmetric margins.
      dots = [];
      const cols = Math.floor(cssW / CONFIG.spacing);
      const rows = Math.floor(cssH / CONFIG.spacing);
      const offsetX = (cssW - (cols - 1) * CONFIG.spacing) / 2;
      const offsetY = (cssH - (rows - 1) * CONFIG.spacing) / 2;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          dots.push({
            x: offsetX + c * CONFIG.spacing,
            y: offsetY + r * CONFIG.spacing,
          });
        }
      }
    };

    // Draw one frame. For each dot we take the strongest overlapping patch's
    // contribution (max, not sum — sum would blow out where patches overlap).
    const draw = (now: number) => {
      ctx.clearRect(0, 0, cssW, cssH);
      const half = CONFIG.dotSize / 2;
      const tintCore = CONFIG.tintCoreFraction;

      for (let i = 0; i < dots.length; i++) {
        const d = dots[i];
        let best = 0; // strongest patch contribution at this dot (0..1)
        let bestTint = 0; // terracotta mix to apply (0..1)

        for (let p = 0; p < patches.length; p++) {
          const patch = patches[p];
          const intensity = patchIntensity(patch, now);
          if (intensity <= 0) continue;
          const dx = d.x - patch.cx;
          const dy = d.y - patch.cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > patch.radius) continue;
          // Radial falloff: 1 at center -> 0 at edge, eased.
          const falloff = smoothstep(1 - dist / patch.radius);
          const contribution = intensity * falloff * patch.peak;
          if (contribution > best) {
            best = contribution;
            // Tint only the inner core, ramping from edge-of-core to center.
            if (patch.tint > 0) {
              const coreEdge = patch.radius * tintCore;
              const coreT = dist >= coreEdge ? 0 : 1 - dist / coreEdge;
              bestTint =
                smoothstep(coreT) *
                patch.tint *
                CONFIG.tintMaxStrength *
                intensity;
            } else {
              bestTint = 0;
            }
          }
        }

        const alpha = CONFIG.baselineAlpha + best;
        if (alpha <= 0.012) continue; // skip imperceptible dots

        // Mix grey -> terracotta by the tint amount.
        const rC = GREY[0] + (ACCENT[0] - GREY[0]) * bestTint;
        const gC = GREY[1] + (ACCENT[1] - GREY[1]) * bestTint;
        const bC = GREY[2] + (ACCENT[2] - GREY[2]) * bestTint;

        ctx.fillStyle = `rgba(${rC | 0}, ${gC | 0}, ${bC | 0}, ${alpha.toFixed(
          3
        )})`;
        ctx.fillRect(d.x - half, d.y - half, CONFIG.dotSize, CONFIG.dotSize);
      }
    };

    // ---- Animated path ----
    // This is a purely decorative, aria-hidden background. The motion is slow,
    // non-flashing drift that carries no information, so we intentionally do not
    // branch on prefers-reduced-motion — the previous static branch caused the
    // grid to freeze on Windows (where "Animation effects = Off" is a common
    // default), with the initial dots stuck and never animating.
    setupGrid();
    const t0 = performance.now();
    patches = Array.from({ length: CONFIG.patchCount }, (_, i) =>
      // Stagger initial births across a couple of lifecycles so the screen
      // doesn't pulse all at once on first paint.
      makePatch(t0, rand(0, (CONFIG.fadeInMs + CONFIG.holdMs) * 2))
    );

    let rafId = 0;
    let lastFrame = 0;
    const frameInterval = 1000 / CONFIG.targetFps;

    const loop = (now: number) => {
      rafId = requestAnimationFrame(loop);
      if (now - lastFrame < frameInterval) return; // throttle to targetFps
      // Cap dt so a long gap (window hidden/minimized/suspended, which throttles
      // rAF) doesn't fling patches far off-screen on the first frame back.
      const dt =
        lastFrame === 0 ? 0 : Math.min((now - lastFrame) / 1000, 0.1); // seconds since last drawn frame
      lastFrame = now;

      // Advance each patch's center by its velocity, then respawn dead ones.
      for (let p = 0; p < patches.length; p++) {
        const patch = patches[p];
        if (now >= patch.bornAt) {
          patch.cx += patch.vx * dt;
          patch.cy += patch.vy * dt;
        }
        if (patchIntensity(patch, now) < 0) {
          patches[p] = makePatch(now, rand(0, CONFIG.spawnJitterMs));
        }
      }
      draw(now);
    };
    rafId = requestAnimationFrame(loop);

    let resizeRaf = 0;
    const onResize = () => {
      // Debounce resize to the next frame to avoid thrashing the grid rebuild.
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(setupGrid);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(rafId);
      cancelAnimationFrame(resizeRaf);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return <canvas ref={canvasRef} className="signin-dotgrid" aria-hidden="true" />;
};

export default DotGridBackground;
