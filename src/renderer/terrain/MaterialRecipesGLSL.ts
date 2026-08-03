// BlastSimulator2026 — Material recipes (GLSL source)
//
// One function per recipe, each a different composition of the 3D noise fields
// in NoiseGLSL. A material's recipe is part of its identity: the point is that
// gravel and marble are not the same texture under different colours, they are
// different constructions.
//
// Every recipe returns a single 0..1 scalar, which the caller uses to mix the
// material's two colours and to drive its relief. Keeping the signature
// uniform is what lets the dispatcher pick one by index without the caller
// knowing anything about how that material is built.

import { MaterialRecipe } from '../../core/world/SurfaceMaterialCatalog.js';

export const MATERIAL_RECIPES_GLSL = /* glsl */`
// p     already scaled by the material's own frequency
// alt   secondary-field frequency, relative to the primary
// warp  composition / domain-warp strength
// lod   distance detail budget, 1 near, 0 far

/** f(p) + f'(p·alt) — two independent stacks added. Granular, no structure. */
float recipeSum(vec3 p, float alt, float warp, float lod){
  return clamp(fbmPerlin(p, lod) * 0.65 + fbmValue(p * alt, lod) * 0.35, 0.0, 1.0);
}

/** f(f'(p)) — one field re-sampled through another. Soft organic blotches. */
float recipeCompose(vec3 p, float alt, float warp, float lod){
  float inner = fbmSimplex(p * alt, lod);
  return clamp(fbmPerlin(p + inner * warp, lod), 0.0, 1.0);
}

/**
 * f(p + k·f'(p)) — domain warping.
 *
 * The classic marble construction: a banded field, with the coordinate it is
 * sampled at pushed sideways by a second field, so the bands fold and swirl
 * instead of running straight.
 */
float recipeWarp(vec3 p, float alt, float warp, float lod){
  vec3 q = vec3(fbmSimplex(p * alt, lod), fbmSimplex(p * alt + 5.2, lod), fbmSimplex(p * alt + 9.1, lod));
  float bands = sin((p.x + p.z * 0.35 + (q.x - 0.5) * warp * 6.0) * 3.1416);
  return clamp(bands * 0.5 + 0.5, 0.0, 1.0);
}

/** Worley F1 — packed grains, each cell its own pebble. */
float recipeCell(vec3 p, float alt, float warp, float lod){
  vec2 w = worley(p);
  float grains = 1.0 - clamp(w.x, 0.0, 1.0);
  // A slow field varies grain brightness so the packing does not read uniform.
  return clamp(grains * 0.8 + fbmValue(p * alt, lod) * 0.2, 0.0, 1.0);
}

/** Worley F2 − F1 — the seams between cells: cracks, crystal boundaries. */
float recipeCellEdge(vec3 p, float alt, float warp, float lod){
  vec2 w = worley(p);
  float seam = smoothstep(0.0, 0.28, w.y - w.x);
  return clamp(seam * 0.75 + fbmValue(p * alt, lod) * 0.25, 0.0, 1.0);
}

/** Ridged multifractal — sharp crests. Strata and wind-drifted snow. */
float recipeRidged(vec3 p, float alt, float warp, float lod){
  return clamp(ridged(p, lod) * 0.8 + fbmValue(p * alt, lod) * 0.2, 0.0, 1.0);
}

/** Broad field with fine cellular speckle scattered through it. */
float recipeSpeckle(vec3 p, float alt, float warp, float lod){
  float broad = fbmPerlin(p, lod);
  float fleck = lod > 0.25 ? (1.0 - smoothstep(0.0, 0.35, worley(p * alt).x)) * smoothstep(0.25, 0.6, lod) : 0.0;
  return clamp(broad * 0.72 + fleck * 0.28, 0.0, 1.0);
}

/**
 * Evaluate recipe 'id' at 'p'.
 *
 * A switch rather than an array of function pointers, which GLSL does not
 * have. Only the two or three strongest materials at a pixel are ever
 * evaluated, so the branch is taken a handful of times per fragment, not once
 * per material in the catalog.
 */
float evalRecipe(int id, vec3 p, float alt, float warp, float lod){
  if (id == ${MaterialRecipe.Sum})      return recipeSum(p, alt, warp, lod);
  if (id == ${MaterialRecipe.Compose})  return recipeCompose(p, alt, warp, lod);
  if (id == ${MaterialRecipe.Warp})     return recipeWarp(p, alt, warp, lod);
  if (id == ${MaterialRecipe.Cell})     return recipeCell(p, alt, warp, lod);
  if (id == ${MaterialRecipe.CellEdge}) return recipeCellEdge(p, alt, warp, lod);
  if (id == ${MaterialRecipe.Ridged})   return recipeRidged(p, alt, warp, lod);
  return recipeSpeckle(p, alt, warp, lod);
}
`;
