/**
 * Vanilla-JS port of the React Bits "SideRays" component (ogl-based WebGL
 * light-ray effect). No React here, this app has no build step, so the
 * original hooks/refs are replaced with a single init function that returns
 * a destroy() callback.
 */
import { Renderer, Program, Triangle, Mesh } from "https://esm.sh/ogl@1.0.11";

const hexToRgb = (hex) => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [1, 1, 1];
};

const originToFlip = (origin) => {
  switch (origin) {
    case "top-left":
      return [1, 0];
    case "bottom-right":
      return [0, 1];
    case "bottom-left":
      return [1, 1];
    default:
      return [0, 0];
  }
};

const VERTEX_SHADER = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `precision highp float;

uniform float iTime;
uniform vec2 iResolution;
uniform float iSpeed;
uniform vec3 iRayColor1;
uniform vec3 iRayColor2;
uniform float iIntensity;
uniform float iSpread;
uniform float iFlipX;
uniform float iFlipY;
uniform float iTilt;
uniform float iSaturation;
uniform float iBlend;
uniform float iFalloff;
uniform float iOpacity;

float rayStrength(vec2 raySource, vec2 rayRefDirection, vec2 coord, float seedA, float seedB, float speed) {
  vec2 sourceToCoord = coord - raySource;
  float cosAngle = dot(normalize(sourceToCoord), rayRefDirection);
  return clamp(
    (0.45 + 0.15 * sin(cosAngle * seedA + iTime * speed)) +
    (0.3 + 0.2 * cos(-cosAngle * seedB + iTime * speed)),
    0.0, 1.0) *
    clamp((iResolution.x - length(sourceToCoord)) / iResolution.x, 0.5, 1.0);
}

void main() {
  vec2 fragCoord = gl_FragCoord.xy;
  if (iFlipX > 0.5) fragCoord.x = iResolution.x - fragCoord.x;
  if (iFlipY > 0.5) fragCoord.y = iResolution.y - fragCoord.y;

  vec2 coord = vec2(fragCoord.x, iResolution.y - fragCoord.y);
  vec2 rayPos = vec2(iResolution.x * 1.1, -0.5 * iResolution.y);

  float tiltRad = iTilt * 3.14159265 / 180.0;
  float cs = cos(tiltRad);
  float sn = sin(tiltRad);
  vec2 rel = coord - rayPos;
  vec2 tiltedCoord = vec2(rel.x * cs - rel.y * sn, rel.x * sn + rel.y * cs) + rayPos;

  float halfSpread = iSpread * 0.275;
  vec2 rayRefDir1 = normalize(vec2(cos(0.785398 + halfSpread), sin(0.785398 + halfSpread)));
  vec2 rayRefDir2 = normalize(vec2(cos(0.785398 - halfSpread), sin(0.785398 - halfSpread)));

  vec4 rays1 = vec4(iRayColor1, 1.0) * rayStrength(rayPos, rayRefDir1, tiltedCoord, 36.2214, 21.11349, iSpeed);
  vec4 rays2 = vec4(iRayColor2, 1.0) * rayStrength(rayPos, rayRefDir2, tiltedCoord, 22.3991, 18.0234, iSpeed * 0.2);

  vec4 color = rays1 * (1.0 - iBlend) * 0.9 + rays2 * iBlend * 0.9;

  float distanceToLight = length(fragCoord.xy - vec2(rayPos.x, iResolution.y - rayPos.y)) / iResolution.y;
  float brightness = iIntensity * 0.4 / pow(max(distanceToLight, 0.001), iFalloff);
  color.rgb *= brightness;

  float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  color.rgb = mix(vec3(gray), color.rgb, iSaturation);

  color.a = max(color.r, max(color.g, color.b)) * iOpacity;
  gl_FragColor = color;
}`;

const DEFAULTS = {
  speed: 2.5,
  rayColor1: "#EAB308",
  rayColor2: "#96c8ff",
  intensity: 2,
  spread: 2,
  origin: "top-right",
  tilt: 0,
  saturation: 1.5,
  blend: 0.75,
  falloff: 1.6,
  opacity: 1.0,
};

/**
 * Mount the ray effect into `container` and start animating once it's on
 * screen. Returns a destroy() function that tears down the WebGL context,
 * listeners, and observer.
 */
export function initSideRays(container, options = {}) {
  const opts = { ...DEFAULTS, ...options };

  let renderer = null;
  let animationId = null;
  let resizeHandler = null;
  let mesh = null;
  let uniforms = null;
  let destroyed = false;

  const teardownWebGL = () => {
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
    if (resizeHandler) {
      window.removeEventListener("resize", resizeHandler);
      resizeHandler = null;
    }
    if (renderer) {
      try {
        const loseCtx = renderer.gl.getExtension("WEBGL_lose_context");
        if (loseCtx) loseCtx.loseContext();
        const canvas = renderer.gl.canvas;
        if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
      } catch (e) {
        // context already gone, nothing to clean up
      }
    }
    renderer = null;
    uniforms = null;
    mesh = null;
  };

  const setupWebGL = () => {
    if (destroyed || renderer) return;

    renderer = new Renderer({ dpr: Math.min(window.devicePixelRatio, 2), alpha: true });
    const gl = renderer.gl;
    gl.canvas.style.width = "100%";
    gl.canvas.style.height = "100%";

    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
    container.appendChild(gl.canvas);

    const [flipX, flipY] = originToFlip(opts.origin);
    uniforms = {
      iTime: { value: 0 },
      iResolution: { value: [1, 1] },
      iSpeed: { value: opts.speed },
      iRayColor1: { value: hexToRgb(opts.rayColor1) },
      iRayColor2: { value: hexToRgb(opts.rayColor2) },
      iIntensity: { value: opts.intensity },
      iSpread: { value: opts.spread },
      iFlipX: { value: flipX },
      iFlipY: { value: flipY },
      iTilt: { value: opts.tilt },
      iSaturation: { value: opts.saturation },
      iBlend: { value: opts.blend },
      iFalloff: { value: opts.falloff },
      iOpacity: { value: opts.opacity },
    };

    const geometry = new Triangle(gl);
    const program = new Program(gl, { vertex: VERTEX_SHADER, fragment: FRAGMENT_SHADER, uniforms });
    mesh = new Mesh(gl, { geometry, program });

    const updateSize = () => {
      if (!container || !renderer) return;
      renderer.dpr = Math.min(window.devicePixelRatio, 2);
      const { clientWidth: w, clientHeight: h } = container;
      renderer.setSize(w, h);
      uniforms.iResolution.value = [w * renderer.dpr, h * renderer.dpr];
    };

    const loop = (t) => {
      if (!renderer || !uniforms || !mesh) return;
      uniforms.iTime.value = t * 0.001;
      try {
        renderer.render({ scene: mesh });
        animationId = requestAnimationFrame(loop);
      } catch (e) {
        // WebGL context lost mid-frame, stop the loop rather than throw
      }
    };

    resizeHandler = updateSize;
    window.addEventListener("resize", resizeHandler);
    updateSize();
    animationId = requestAnimationFrame(loop);
  };

  const observer = new IntersectionObserver(
    (entries) => {
      const isVisible = entries[0].isIntersecting;
      if (isVisible) {
        setupWebGL();
      } else {
        teardownWebGL();
      }
    },
    { threshold: 0.1 }
  );
  observer.observe(container);

  return function destroy() {
    destroyed = true;
    observer.disconnect();
    teardownWebGL();
  };
}
