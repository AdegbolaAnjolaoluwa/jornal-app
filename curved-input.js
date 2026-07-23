/**
 * Vanilla-JS/SVG port of the React Bits "CurvedInput" component, scoped down
 * to what this app's signup wizard needs: a single curved text field (no
 * baked-in submit button - Continue/Back are the app's normal buttons below
 * the curve), one theme read live from CSS variables (so it repaints on a
 * theme switch, same approach as light-rays.js), Enter-to-submit, and a
 * masked-dot render mode for passwords. No React here, this app has no build
 * step - same init(container, options) / destroy() pattern as light-rays.js.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

const DEFAULTS = {
  placeholder: "",
  mode: "text", // "text" | "password"
  maxLength: null,
  bend: 22, // px the center arches above the ends; 0 = flat
  height: 56,
  fontSize: 16,
  onSubmit: () => {},
  onChange: () => {},
};

const round2 = (n) => Math.round(n * 100) / 100;

// Maps a flat (u along the bar, v offset from centerline) coordinate onto a
// circular arc with the given sagitta (bend, in px).
//
// The end caps are perpendicular to the curve's tangent at u0/u1, so on a
// bent bar they lean outward - the top/bottom corners at each end don't sit
// at the same x as the bar's own edge, they splay out past it. Left
// unaccounted for, those corners land outside a viewBox sized to just the
// bar's flat width/height and get clipped, which is what made the ends look
// sheared/broken. padX below is exactly that splay, added as canvas margin
// (and folded into point()'s output) so the full rotated cap always fits.
function buildGeometry(width, bend, thickness) {
  const W = Math.max(width, 1);
  const T = thickness;
  const s = Math.max(-W * 0.35, Math.min(bend, W * 0.35));
  const a = Math.abs(s);
  const dir = s >= 0 ? 1 : -1;
  const pad = 6;
  const svgH = T + a + pad * 2;

  if (a < 0.75) {
    const midY = pad + T / 2;
    return {
      straight: true,
      W,
      canvasW: W,
      T,
      svgH,
      point: (u, v) => [u, midY + v],
      angleAt: () => 0,
    };
  }

  const R = (W * W * 0.25 + a * a) / (2 * a);
  const cx = W / 2;
  const apexY = pad + T / 2 + (dir > 0 ? 0 : a);
  const cy = apexY + dir * R;
  const phi = Math.asin(Math.min(1, W / (2 * R)));

  // Horizontal splay of the end-cap corners (v = -T/2 and v = +T/2) beyond
  // the bar's own x = 0 / x = W edges. W (and the u domain callers use for
  // text layout/caret placement) stays the original bar width - only the
  // canvas (canvasW, and point()'s x output) grows to fit the splay, so u=0
  // and u=W still land exactly on the bar's own edges, just shifted right by
  // padX inside the wider canvas.
  const rhoAtEdge = R + dir * (T / 2);
  const edgeX = rhoAtEdge * Math.sin(phi);
  const padX = Math.max(0, edgeX - W / 2);

  return {
    straight: false,
    W,
    canvasW: W + padX * 2,
    T,
    svgH,
    point: (u, v) => {
      const th = ((u - cx) / cx) * phi;
      const rho = R - dir * v;
      return [padX + cx + rho * Math.sin(th), cy - dir * rho * Math.cos(th)];
    },
    angleAt: (u) => dir * ((u - cx) / cx) * phi * (180 / Math.PI),
  };
}

function fmt(g, u, v) {
  const [x, y] = g.point(u, v);
  return `${round2(x)} ${round2(y)}`;
}

// A rectangle bent along the arc: curved top/bottom edges, straight end caps.
function bentRectPath(g, u0, u1, vTop, vBot) {
  if (g.straight) {
    return `M ${fmt(g, u0, vTop)} L ${fmt(g, u1, vTop)} L ${fmt(g, u1, vBot)} L ${fmt(g, u0, vBot)} Z`;
  }
  const midU = (u0 + u1) / 2;
  return [
    `M ${fmt(g, u0, vTop)}`,
    `Q ${fmt(g, midU, vTop)} ${fmt(g, u1, vTop)}`,
    `L ${fmt(g, u1, vBot)}`,
    `Q ${fmt(g, midU, vBot)} ${fmt(g, u0, vBot)}`,
    "Z",
  ].join(" ");
}

function bentLinePath(g, u0, u1, v) {
  if (g.straight) return `M ${fmt(g, u0, v)} L ${fmt(g, u1, v)}`;
  const midU = (u0 + u1) / 2;
  return `M ${fmt(g, u0, v)} Q ${fmt(g, midU, v)} ${fmt(g, u1, v)}`;
}

let uidCounter = 0;

/**
 * Mount a curved input into `container` (must be a plain, empty, positioned
 * or static block-level element - it will be filled and cleared like
 * light-rays.js's canvas host). Returns a handle: { destroy, getValue,
 * setValue, focus, setError }.
 */
export function initCurvedInput(container, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const uid = `ci-${++uidCounter}`;

  let value = "";
  let focused = false;
  let errorActive = false;
  let resizeHandler = null;
  let destroyed = false;

  const theme = {};
  function readTheme() {
    const cs = getComputedStyle(document.documentElement);
    theme.bg = cs.getPropertyValue("--surface-warm").trim() || "#fffdf7";
    theme.border = cs.getPropertyValue("--border-input").trim() || "rgba(0,0,0,0.16)";
    theme.ink = cs.getPropertyValue("--ink").trim() || "#2b2419";
    theme.faint = cs.getPropertyValue("--ink-faint").trim() || "#a79c89";
    theme.gold = cs.getPropertyValue("--gold").trim() || "#b8873a";
    theme.error = cs.getPropertyValue("--error").trim() || "#b0473c";
  }
  readTheme();

  // Hidden native input: real typing/IME/mobile-keyboard/password-manager
  // support, positioned over the SVG so clicks/taps focus it directly.
  const hiddenInput = document.createElement("input");
  hiddenInput.type = opts.mode === "password" ? "password" : "text";
  hiddenInput.autocomplete = opts.mode === "password" ? "new-password" : "off";
  hiddenInput.autocapitalize = "none";
  hiddenInput.spellcheck = false;
  if (opts.maxLength) hiddenInput.maxLength = opts.maxLength;
  hiddenInput.setAttribute("aria-label", opts.placeholder || "input");
  Object.assign(hiddenInput.style, {
    position: "absolute",
    inset: "0",
    width: "100%",
    height: "100%",
    opacity: "0",
    border: "0",
    padding: "0",
    margin: "0",
    background: "transparent",
    color: "transparent",
    caretColor: "transparent",
    cursor: "text",
    outline: "none",
  });

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "curved-input__svg");
  Object.assign(svg.style, { display: "block", width: "100%", height: "auto" });

  const band = document.createElementNS(SVG_NS, "path");
  const layoutPath = document.createElementNS(SVG_NS, "path");
  layoutPath.setAttribute("id", uid);
  layoutPath.setAttribute("fill", "none");

  const text = document.createElementNS(SVG_NS, "text");
  text.setAttribute("fill", theme.ink);
  text.style.fontSize = `${opts.fontSize}px`;
  text.style.fontWeight = "500";
  text.setAttribute("aria-hidden", "true");
  const textPath = document.createElementNS(SVG_NS, "textPath");
  textPath.setAttributeNS("http://www.w3.org/1999/xlink", "href", `#${uid}`);
  textPath.setAttribute("href", `#${uid}`);
  text.appendChild(textPath);

  const caret = document.createElementNS(SVG_NS, "line");
  caret.setAttribute("stroke-width", "1.5");
  caret.setAttribute("stroke-linecap", "round");
  const caretAnim = document.createElementNS(SVG_NS, "animate");
  caretAnim.setAttribute("attributeName", "opacity");
  caretAnim.setAttribute("values", "1;0");
  caretAnim.setAttribute("dur", "1.06s");
  caretAnim.setAttribute("calcMode", "discrete");
  caretAnim.setAttribute("repeatCount", "indefinite");
  caret.appendChild(caretAnim);

  svg.appendChild(band);
  svg.appendChild(layoutPath);
  svg.appendChild(text);
  svg.appendChild(caret);

  container.innerHTML = "";
  container.style.position = container.style.position || "relative";
  container.appendChild(svg);
  container.appendChild(hiddenInput);

  function displayValue() {
    return opts.mode === "password" ? "•".repeat(value.length) : value;
  }

  function render() {
    if (destroyed) return;
    const width = container.clientWidth || 300;
    const geom = buildGeometry(width, opts.bend, opts.height);

    svg.setAttribute("width", round2(geom.canvasW));
    svg.setAttribute("height", round2(geom.svgH));
    svg.setAttribute("viewBox", `0 0 ${round2(geom.canvasW)} ${round2(geom.svgH)}`);

    const strokeColor = errorActive ? theme.error : focused ? theme.gold : theme.border;
    const strokeWidth = focused || errorActive ? 2 : 1.5;
    band.setAttribute("d", bentRectPath(geom, 0, geom.W, -opts.height / 2, opts.height / 2));
    band.setAttribute("fill", theme.bg);
    band.setAttribute("stroke", strokeColor);
    band.setAttribute("stroke-width", String(strokeWidth));

    const textStartU = 22;
    const textEndU = geom.W - 22;
    const vBase = opts.fontSize * 0.34;
    layoutPath.setAttribute("d", bentLinePath(geom, textStartU, textEndU, vBase));

    const shown = displayValue();
    if (shown) {
      textPath.textContent = shown;
      text.setAttribute("fill", theme.ink);
    } else {
      textPath.textContent = opts.placeholder;
      text.setAttribute("fill", theme.faint);
    }

    if (focused) {
      const winLen = textEndU - textStartU;
      const approxCharW = opts.fontSize * 0.55;
      const caretOffset = Math.min(shown.length * approxCharW, winLen);
      const caretU = textStartU + caretOffset;
      const [cx, cy] = geom.point(caretU, 0);
      const angle = geom.angleAt(caretU);
      const caretH = Math.min(opts.height * 0.55, opts.fontSize * 1.4);
      caret.setAttribute("transform", `translate(${round2(cx)} ${round2(cy)}) rotate(${round2(angle)})`);
      caret.setAttribute("x1", "0");
      caret.setAttribute("x2", "0");
      caret.setAttribute("y1", String(-caretH / 2));
      caret.setAttribute("y2", String(caretH / 2));
      caret.setAttribute("stroke", theme.ink);
      caret.style.display = "";
    } else {
      caret.style.display = "none";
    }
  }

  function handleInput() {
    value = hiddenInput.value;
    errorActive = false;
    render();
    opts.onChange(value);
  }

  function handleFocus() {
    focused = true;
    render();
  }

  function handleBlur() {
    focused = false;
    render();
  }

  function handleKeydown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      opts.onSubmit(value);
    }
  }

  function handleContainerClick() {
    hiddenInput.focus();
  }

  hiddenInput.addEventListener("input", handleInput);
  hiddenInput.addEventListener("focus", handleFocus);
  hiddenInput.addEventListener("blur", handleBlur);
  hiddenInput.addEventListener("keydown", handleKeydown);
  svg.addEventListener("click", handleContainerClick);

  resizeHandler = () => render();
  window.addEventListener("resize", resizeHandler);

  render();

  function retint() {
    readTheme();
    render();
  }

  if (!window.curvedInputRetintCallbacks) window.curvedInputRetintCallbacks = [];
  window.curvedInputRetintCallbacks.push(retint);

  return {
    destroy() {
      destroyed = true;
      window.removeEventListener("resize", resizeHandler);
      hiddenInput.removeEventListener("input", handleInput);
      hiddenInput.removeEventListener("focus", handleFocus);
      hiddenInput.removeEventListener("blur", handleBlur);
      hiddenInput.removeEventListener("keydown", handleKeydown);
      svg.removeEventListener("click", handleContainerClick);
      if (window.curvedInputRetintCallbacks) {
        const i = window.curvedInputRetintCallbacks.indexOf(retint);
        if (i !== -1) window.curvedInputRetintCallbacks.splice(i, 1);
      }
      container.innerHTML = "";
    },
    getValue() {
      return value;
    },
    setValue(v) {
      value = v || "";
      hiddenInput.value = value;
      render();
    },
    focus() {
      hiddenInput.focus();
    },
    setError(message) {
      errorActive = !!message;
      render();
    },
  };
}
