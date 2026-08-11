/**
 * Vanilla-JS port of the React Bits "ParticleText" component (Canvas
 * 2D particle-formation text effect). No React here, this app has no build
 * step, so the original hooks/refs/prop-diffing useEffect are replaced with
 * a single init function that takes a fixed options object and returns a
 * destroy() callback, same pattern as light-rays.js/side-rays.js use for
 * their own React Bits ports (though this one needs no external rendering
 * library - it's plain Canvas 2D, not WebGL).
 *
 * The container is expected to already hold the real heading text in a
 * child element (see landing.html's hero markup) - this only adds/animates
 * a <canvas> layered on top and never removes the real text, so screen
 * readers, SEO, and a no-JS fallback all still see it.
 */

const hexToRgb = (hex) => {
  const clean = hex.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
};

const mixRgb = (from, to, amount) => ({
  r: Math.round(from.r + (to.r - from.r) * amount),
  g: Math.round(from.g + (to.g - from.g) * amount),
  b: Math.round(from.b + (to.b - from.b) * amount),
});

const rgbToCss = (rgb) => `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

const resolveFontSize = (value, container, fontWeight, fontFamily) => {
  if (typeof value === "number") return value;

  const probe = document.createElement("span");
  probe.textContent = "M";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.fontSize = value;
  probe.style.fontWeight = String(fontWeight);
  probe.style.fontFamily = fontFamily;
  container.appendChild(probe);
  const size = parseFloat(window.getComputedStyle(probe).fontSize) || 96;
  probe.remove();
  return size;
};

const waitForFonts = async (font) => {
  if (!("fonts" in document)) return;

  try {
    await document.fonts.load(font);
  } catch {
    // Font failed to load (e.g. unavailable) - proceed with whatever font
    // the browser falls back to rather than blocking the effect entirely.
  }

  await document.fonts.ready;
};

const DEFAULTS = {
  text: "React Bits",
  particleSize: 2,
  density: 4,
  color: "#ffffff",
  highlightColor: "#8b5cf6",
  scatter: 180,
  gatherDuration: 1600,
  stagger: 420,
  pointerRepel: 40,
  repelRadius: 120,
  idleDrift: 0.7,
  trigger: "mount",
  fontSize: "clamp(3rem, 12vw, 8rem)",
  fontWeight: 800,
  fontFamily: "inherit",
  glow: true,
};

/**
 * Mount the particle-text effect into `container`, drawing onto a <canvas>
 * that fills it. `container` must be position:relative (or similar) since
 * the canvas is absolutely positioned to fill it. Returns a destroy()
 * function that tears down the animation loop, observers, and listeners.
 */
export function initParticleText(container, options = {}) {
  const opts = { ...DEFAULTS, ...options };

  const canvas = document.createElement("canvas");
  canvas.className = "particle-text__canvas";
  canvas.setAttribute("aria-hidden", "true");
  container.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.remove();
    return () => {};
  }

  let particles = [];
  let animationFrame = null;
  let resizeFrame = null;
  let buildId = 0;
  let gathering = false;
  let gatherStart = 0;
  let reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let destroyed = false;

  const pointer = { active: false, x: 0, y: 0, smoothX: 0, smoothY: 0 };

  const startGather = (fromScatter = true) => {
    if (!particles.length) return;

    const now = performance.now();
    const spread = reducedMotion ? 0 : opts.scatter;

    particles.forEach((particle) => {
      if (fromScatter) {
        const angle = particle.seed * Math.PI * 2;
        const distance = spread * (0.35 + particle.depth * 0.75);
        particle.x = particle.targetX + Math.cos(angle) * distance + (particle.depth - 0.5) * spread * 0.55;
        particle.y = particle.targetY + Math.sin(angle) * distance + (particle.seed - 0.5) * spread * 0.55;
      }

      particle.startX = particle.x;
      particle.startY = particle.y;
      particle.delay = reducedMotion ? 0 : particle.seed * opts.stagger;
    });

    gatherStart = now;
    gathering = true;
  };

  const drawParticle = (particle) => {
    const size = particle.size;
    ctx.fillStyle = particle.color;

    if (size <= 2.1) {
      ctx.fillRect(particle.x - size / 2, particle.y - size / 2, size, size);
      return;
    }

    ctx.beginPath();
    ctx.arc(particle.x, particle.y, size / 2, 0, Math.PI * 2);
    ctx.fill();
  };

  const render = (now) => {
    ctx.clearRect(0, 0, width, height);

    if (opts.glow && !reducedMotion) {
      ctx.shadowBlur = opts.particleSize * 3;
      ctx.shadowColor = opts.highlightColor;
    } else {
      ctx.shadowBlur = 0;
    }

    pointer.smoothX += (pointer.x - pointer.smoothX) * 0.18;
    pointer.smoothY += (pointer.y - pointer.smoothY) * 0.18;

    let complete = true;

    particles.forEach((particle) => {
      let baseX = particle.targetX;
      let baseY = particle.targetY;
      let progress = 1;

      if (gathering) {
        const local = (now - gatherStart - particle.delay) / Math.max(1, reducedMotion ? 1 : opts.gatherDuration);
        progress = clamp(local, 0, 1);
        const eased = easeOutCubic(progress);
        baseX = particle.startX + (particle.targetX - particle.startX) * eased;
        baseY = particle.startY + (particle.targetY - particle.startY) * eased;
        if (progress < 1) complete = false;
      } else if (!reducedMotion && opts.idleDrift > 0) {
        const driftTime = now * 0.001;
        baseX += Math.sin(driftTime * 0.9 + particle.seed * 10) * opts.idleDrift * particle.depth;
        baseY += Math.cos(driftTime * 0.75 + particle.depth * 10) * opts.idleDrift * particle.depth;
      }

      if (pointer.active && !reducedMotion && opts.pointerRepel > 0 && opts.repelRadius > 0) {
        const dx = baseX - pointer.smoothX;
        const dy = baseY - pointer.smoothY;
        const distance = Math.hypot(dx, dy);
        if (distance > 0 && distance < opts.repelRadius) {
          const force = Math.pow(1 - distance / opts.repelRadius, 2) * opts.pointerRepel;
          baseX += (dx / distance) * force;
          baseY += (dy / distance) * force;
        }
      }

      const follow = reducedMotion ? 1 : 0.22;
      particle.x += (baseX - particle.x) * follow;
      particle.y += (baseY - particle.y) * follow;

      ctx.globalAlpha = clamp(0.35 + progress * 0.65, 0, 1);
      drawParticle(particle);
    });

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    if (gathering && complete) {
      gathering = false;
    }

    animationFrame = window.requestAnimationFrame(render);
  };

  const ensureRenderLoop = () => {
    if (animationFrame === null) {
      animationFrame = window.requestAnimationFrame(render);
    }
  };

  const sampleText = async () => {
    const currentBuild = ++buildId;
    const rect = container.getBoundingClientRect();
    width = Math.floor(rect.width);
    height = Math.floor(rect.height);

    if (width <= 0 || height <= 0) return;

    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const computed = window.getComputedStyle(container);
    const resolvedFamily = opts.fontFamily === "inherit" ? computed.fontFamily || "sans-serif" : opts.fontFamily;
    let resolvedSize = resolveFontSize(opts.fontSize, container, opts.fontWeight, resolvedFamily);
    let font = `${opts.fontWeight} ${resolvedSize}px ${resolvedFamily}`;

    await waitForFonts(font);
    if (currentBuild !== buildId || destroyed) return;

    const offscreen = document.createElement("canvas");
    const offCtx = offscreen.getContext("2d", { willReadFrequently: true });
    if (!offCtx) return;

    const content = String(opts.text || " ");
    const maxTextWidth = width * 0.92;
    offCtx.font = font;
    let metrics = offCtx.measureText(content);
    const measuredWidth = Math.max(1, metrics.width);
    if (measuredWidth > maxTextWidth) {
      resolvedSize = Math.max(18, resolvedSize * (maxTextWidth / measuredWidth));
      font = `${opts.fontWeight} ${resolvedSize}px ${resolvedFamily}`;
      await waitForFonts(font);
      if (currentBuild !== buildId || destroyed) return;
      offCtx.font = font;
      metrics = offCtx.measureText(content);
    }

    const left = Math.ceil(metrics.actualBoundingBoxLeft || 0);
    const right = Math.ceil(metrics.actualBoundingBoxRight || metrics.width);
    const ascent = Math.ceil(metrics.actualBoundingBoxAscent || resolvedSize * 0.78);
    const descent = Math.ceil(metrics.actualBoundingBoxDescent || resolvedSize * 0.22);
    const padding = Math.max(12, Math.ceil(resolvedSize * 0.08));
    const textWidth = Math.max(1, left + right);
    const textHeight = Math.max(1, ascent + descent);

    offscreen.width = textWidth + padding * 2;
    offscreen.height = textHeight + padding * 2;
    offCtx.clearRect(0, 0, offscreen.width, offscreen.height);
    offCtx.font = font;
    offCtx.textAlign = "left";
    offCtx.textBaseline = "alphabetic";
    offCtx.fillStyle = "#ffffff";
    offCtx.fillText(content, padding - left, padding + ascent);

    const imageData = offCtx.getImageData(0, 0, offscreen.width, offscreen.height);
    const targets = [];
    const step = Math.max(2, Math.floor(opts.density));

    for (let y = 0; y < offscreen.height; y += step) {
      for (let x = 0; x < offscreen.width; x += step) {
        const alpha = imageData.data[(y * offscreen.width + x) * 4 + 3];
        if (alpha > 40) {
          targets.push({
            x: width / 2 - offscreen.width / 2 + x,
            y: height / 2 - offscreen.height / 2 + y,
            alpha: alpha / 255,
          });
        }
      }
    }

    const maxParticles = Math.max(900, Math.min(5200, Math.floor((width * height) / 90)));
    const stride = Math.max(1, Math.ceil(targets.length / maxParticles));
    const baseRgb = hexToRgb(opts.color);
    const highlightRgb = hexToRgb(opts.highlightColor);
    const selected = targets.filter((_, index) => index % stride === 0);

    particles = selected.map((target, index) => {
      const seed = ((index * 9301 + 49297) % 233280) / 233280;
      const depth = 0.45 + (((index * 233 + 97) % 1000) / 1000) * 0.9;
      const blend = baseRgb && highlightRgb ? clamp(target.x / Math.max(1, width) + (seed - 0.5) * 0.35, 0, 1) : 0;
      const particleColor = baseRgb && highlightRgb ? rgbToCss(mixRgb(baseRgb, highlightRgb, blend)) : opts.color;
      const angle = seed * Math.PI * 2;
      const distance = (reducedMotion ? 0 : opts.scatter) * (0.35 + depth * 0.75);
      const startX = target.x + Math.cos(angle) * distance + (seed - 0.5) * opts.scatter * 0.45;
      const startY = target.y + Math.sin(angle) * distance + (depth - 0.9) * opts.scatter * 0.45;

      return {
        x: reducedMotion ? target.x : startX,
        y: reducedMotion ? target.y : startY,
        startX,
        startY,
        targetX: target.x,
        targetY: target.y,
        size: Math.max(0.6, opts.particleSize * (0.75 + target.alpha * 0.45)),
        color: particleColor,
        seed,
        depth,
        delay: seed * opts.stagger,
      };
    });

    pointer.x = width / 2;
    pointer.y = height / 2;
    pointer.smoothX = pointer.x;
    pointer.smoothY = pointer.y;

    if (reducedMotion) {
      particles.forEach((particle) => {
        particle.x = particle.targetX;
        particle.y = particle.targetY;
        particle.startX = particle.targetX;
        particle.startY = particle.targetY;
        particle.delay = 0;
      });
      gathering = false;
    } else {
      startGather(false);
    }

    ensureRenderLoop();
  };

  const queueSample = () => {
    if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
    resizeFrame = window.requestAnimationFrame(sampleText);
  };

  const handlePointerMove = (event) => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = event.clientX - rect.left;
    pointer.y = event.clientY - rect.top;
    pointer.active = true;
  };

  const handlePointerLeave = () => {
    pointer.active = false;
  };

  const handlePointerEnter = (event) => {
    handlePointerMove(event);
    if (opts.trigger === "hover") startGather(true);
  };

  const handleClick = () => {
    if (opts.trigger === "click") startGather(true);
  };

  const reduceMotionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const handleReduceMotionChange = (event) => {
    reducedMotion = event.matches;
    sampleText();
  };

  reduceMotionQuery?.addEventListener("change", handleReduceMotionChange);
  canvas.addEventListener("pointerenter", handlePointerEnter);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerleave", handlePointerLeave);
  canvas.addEventListener("click", handleClick);

  const resizeObserver = new ResizeObserver(queueSample);
  resizeObserver.observe(container);
  sampleText();

  return function destroy() {
    destroyed = true;
    buildId += 1;
    resizeObserver.disconnect();
    reduceMotionQuery?.removeEventListener("change", handleReduceMotionChange);
    canvas.removeEventListener("pointerenter", handlePointerEnter);
    canvas.removeEventListener("pointermove", handlePointerMove);
    canvas.removeEventListener("pointerleave", handlePointerLeave);
    canvas.removeEventListener("click", handleClick);

    if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
    if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
    canvas.remove();
  };
}
