// BlastSimulator2026 — GLSL for the rain streaks and ground splashes (#1601).
//
// Kept apart from RainField/RainSplashes so the CPU side (which owns every
// world position, and is what the unit tests read) stays readable. Neither
// shader moves a drop: positions arrive already wrapped into the world-anchored
// window, and the shaders only decide how each one looks on screen.

/**
 * Streak vertex shader. Each instance is one drop; the four quad corners come
 * from `position` — x is across the streak (-1 or 1), y picks the end (0 = the
 * drop's leading head, 1 = its trailing tail). The streak is built in screen
 * space between the projected head and tail so it stays a crisp, anti-aliased
 * line however far away the drop is: a drop thinner than a pixel is drawn one
 * pixel wide at proportionally lower alpha, so distant rain thins into a fine
 * shimmer instead of popping out or turning into fat blocks.
 */
export const RAIN_STREAK_VERTEX_SHADER = /* glsl */ `
attribute vec3 aHead;
attribute float aSeed;

uniform vec3 uTrail;
uniform float uRadius;
uniform vec2 uViewport;
uniform float uOpacity;
uniform float uDensity;
uniform vec3 uFocus;
uniform vec3 uHalfWindow;
uniform float uWindowTopY;
uniform float uNearFade;

varying vec2 vPx;
varying float vLenPx;
varying float vRadiusPx;
varying float vAlpha;

const float MIN_RADIUS_PX = 0.5;

void main() {
  // Per-drop variety: some drops are a little bigger, some streak a little longer.
  float sizeJitter = mix(0.75, 1.3, fract(aSeed * 7.31));
  float trailJitter = mix(0.75, 1.25, fract(aSeed * 3.17));
  float radius = uRadius * sizeJitter;

  vec4 head = projectionMatrix * viewMatrix * vec4(aHead, 1.0);
  vec4 tail = projectionMatrix * viewMatrix * vec4(aHead + uTrail * trailJitter, 1.0);

  // Thin the field to the weather's density: each drop has its own threshold.
  float alpha = uOpacity * clamp((uDensity - aSeed) * 25.0, 0.0, 1.0);
  // Fade toward the window's sides and top so its wrap seam never shows.
  vec2 edge = abs(aHead.xz - uFocus.xz) / uHalfWindow.xz;
  alpha *= 1.0 - smoothstep(0.72, 1.0, max(edge.x, edge.y));
  alpha *= 1.0 - smoothstep(uWindowTopY - uHalfWindow.y * 0.3, uWindowTopY, aHead.y);
  // Fade drops right in front of the lens — a near drop is a huge smear.
  alpha *= smoothstep(uNearFade * 0.35, uNearFade, head.w);

  if (head.w < 0.05 || tail.w < 0.05 || alpha < 0.002) {
    // Behind the camera or invisible: collapse outside the clip volume.
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vPx = vec2(0.0);
    vLenPx = 0.0;
    vRadiusPx = 0.0;
    vAlpha = 0.0;
    return;
  }

  vec2 halfViewport = 0.5 * uViewport;
  vec2 headPx = head.xy / head.w * halfViewport;
  vec2 tailPx = tail.xy / tail.w * halfViewport;

  // Pixels per world metre at the head's depth.
  float pxPerMetre = projectionMatrix[1][1] * halfViewport.y / head.w;
  float radiusPx = radius * pxPerMetre;
  float clampedRadiusPx = max(radiusPx, MIN_RADIUS_PX);
  // A sub-pixel drop is drawn one pixel wide and fainter — by the square root
  // of its coverage rather than the coverage itself, so rain at the usual
  // overview zoom still reads instead of thinning to nothing.
  alpha *= sqrt(radiusPx / clampedRadiusPx);

  vec2 axis = tailPx - headPx;
  float lenPx = length(axis);
  vec2 dir = lenPx > 1e-3 ? axis / lenPx : vec2(0.0, 1.0);
  vec2 across = vec2(-dir.y, dir.x);
  float pad = clampedRadiusPx + 1.0;

  bool atTail = position.y > 0.5;
  vec2 endPx = atTail ? tailPx + dir * pad : headPx - dir * pad;
  vec2 cornerPx = endPx + across * position.x * pad;
  vec4 endClip = atTail ? tail : head;
  gl_Position = vec4(cornerPx / halfViewport * endClip.w, endClip.z, endClip.w);

  vPx = vec2(position.x * pad, atTail ? lenPx + pad : -pad);
  vLenPx = lenPx;
  vRadiusPx = clampedRadiusPx;
  vAlpha = alpha;
}
`;

/**
 * Streak fragment shader: a capsule from head to tail that tapers toward the
 * tail, with a bright head and a fading tail — a falling drop reads as a
 * teardrop with its motion trailing behind it. A drop big enough on screen to
 * have a shape (a close-up, or a paused frame where the streak collapses to its
 * bead) gets the cartoon treatment: a slightly deeper rim and a white glint.
 */
export const RAIN_STREAK_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uRimColor;
uniform float uTailAlpha;

varying vec2 vPx;
varying float vLenPx;
varying float vRadiusPx;
varying float vAlpha;

const float TAIL_RADIUS_RATIO = 0.3;

void main() {
  if (vAlpha <= 0.0) discard;
  float along = clamp(vPx.y, 0.0, vLenPx);
  float t = vLenPx > 0.0 ? along / vLenPx : 0.0;
  float radius = mix(vRadiusPx, max(vRadiusPx * TAIL_RADIUS_RATIO, 0.5), t);
  float dist = length(vec2(vPx.x, vPx.y - along));
  float coverage = clamp(radius + 0.5 - dist, 0.0, 1.0);
  float alpha = coverage * mix(1.0, uTailAlpha, t) * vAlpha;
  if (alpha < 0.003) discard;

  // Cartoon bead shading, only where the drop is big enough to have a shape:
  // a solid pale body, a deeper blue rim standing in for the outline every
  // other model wears, and a white glint up on the bulb.
  float shaped = smoothstep(1.5, 3.5, vRadiusPx);
  float rim = smoothstep(radius - 1.8, radius - 0.6, dist);
  vec3 color = mix(uColor, uRimColor, rim * shaped);
  vec2 glintOffset = vec2(vPx.x + vRadiusPx * 0.35, vPx.y + vRadiusPx * 0.3);
  float glint = 1.0 - smoothstep(vRadiusPx * 0.18, vRadiusPx * 0.32, length(glintOffset));
  color = mix(color, vec3(1.0), glint * shaped * (1.0 - t));
  alpha = mix(alpha, min(0.95, alpha * 1.7), shaped);
  gl_FragColor = vec4(color, alpha);
}
`;

/**
 * Splash vertex shader: one upright quad per splash standing on its ground
 * point, turned to face the camera (x across the screen, y up from the ground).
 * Each instance is (x, y, z, born) with born the rain clock it landed at; its
 * progress comes from the same clock, so a splash freezes mid-bounce on pause
 * and quickens with the time scale. Upright rather than flat on the ground, so
 * no slope can swallow half of it.
 */
export const RAIN_SPLASH_VERTEX_SHADER = /* glsl */ `
attribute vec4 aSplash;
attribute float aSeed;

uniform float uClock;
uniform float uLife;
uniform float uSize;
uniform float uDepthPull;
uniform float uOpacity;
uniform float uDensity;

varying vec2 vLocal;
varying float vProgress;
varying float vAlpha;
varying float vMirror;

void main() {
  float age = (uClock - aSplash.w) / uLife;
  float alive = step(0.0, age) * step(age, 1.0) * clamp((uDensity - aSeed) * 25.0, 0.0, 1.0);
  float size = uSize * mix(0.7, 1.25, fract(aSeed * 5.13));
  // Camera right, flattened onto the ground, keeps the splash upright and facing the viewer.
  vec3 right = vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]);
  right = length(right) > 1e-4 ? normalize(right) : vec3(1.0, 0.0, 0.0);
  vec3 world = aSplash.xyz + right * position.x * size + vec3(0.0, position.y * size, 0.0);
  vec4 viewPos = viewMatrix * vec4(world, 1.0);
  // Slide along the view ray toward the camera: same place on screen, but not buried in a slope.
  viewPos.xyz *= 1.0 - uDepthPull / max(length(viewPos.xyz), uDepthPull * 2.0);
  gl_Position = alive > 0.0 ? projectionMatrix * viewPos : vec4(2.0, 2.0, 2.0, 1.0);
  vLocal = position.xy;
  vProgress = clamp(age, 0.0, 1.0);
  vAlpha = uOpacity * alive;
  vMirror = fract(aSeed * 11.7) < 0.5 ? -1.0 : 1.0;
}
`;

/**
 * Splash fragment shader — the cartoon "plip": a squashed splat that flashes
 * at the impact point, and three droplets thrown up and out of it in little
 * arcs, shrinking as they fall back. Every shape keeps at least about a pixel
 * of size, fading instead, so a far splash is a sparkle rather than nothing.
 */
export const RAIN_SPLASH_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uColor;

varying vec2 vLocal;
varying float vProgress;
varying float vAlpha;
varying float vMirror;

// Coverage of a disc of radius at centre, never thinner than about a pixel (px, in local units).
float disc(vec2 p, vec2 centre, vec2 squash, float radius, float px) {
  float r = max(radius, px * 0.6);
  float cover = sqrt(radius / r);
  float d = length((p - centre) / squash);
  return cover * (1.0 - smoothstep(r - px * 0.5, r + px * 0.5, d));
}

void main() {
  if (vAlpha <= 0.0) discard;
  float px = length(fwidth(vLocal)) * 0.7 + 1e-4;
  float c = vProgress;
  float arc = 4.0 * c * (1.0 - c);
  float radius = 0.1 * (1.0 - 0.5 * c);
  vec2 p = vec2(vLocal.x * vMirror, vLocal.y);
  vec2 round = vec2(1.0);
  float d0 = disc(p, vec2(-0.7 * c, 0.5 * arc + 0.05), round, radius, px);
  float d1 = disc(p, vec2(0.1 * c, 0.75 * arc + 0.05), round, radius * 1.15, px);
  float d2 = disc(p, vec2(0.8 * c, 0.55 * arc + 0.05), round, radius * 0.9, px);
  float drops = max(d0, max(d1, d2)) * (1.0 - c * c);
  // The splat: a flat, wide flash on the ground, gone within the first third.
  float splatLife = clamp(c / 0.3, 0.0, 1.0);
  float splat = disc(p, vec2(0.0, 0.04), vec2(1.0, 0.28), mix(0.2, 0.5, splatLife), px)
    * (1.0 - splatLife) * 0.4;
  float alpha = max(drops, splat) * vAlpha;
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(uColor, alpha);
}
`;
