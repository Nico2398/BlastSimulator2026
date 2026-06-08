// BlastSimulator2026 — Barrel re-exports for fragmentation pipeline
// Part of Chapter 5 (Blast Full Pipeline)
// Sub-modules: FragmentationScoring, DelaunayTessellation, VoronoiMerge

export {
  computeFragmentationScore,
  computeFragmentCount,
  sampleVoronoiSeeds,
} from './FragmentationScoring.js';

export {
  type Tetrahedron,
  type VoronoiCell,
  type BoundingBox,
  computeBoundingBox,
  cullLowestScoreVoxels,
  computeCircumcenter,
  bowyerWatsonDelaunay,
  computeVoronoiCells,
  clipVoronoiCell,
  generateFragments,
} from './DelaunayTessellation.js';

export {
  buildAdjacencyMap,
  convexHull3D,
  mergeTwoCells,
  mergeVoronoiCells,
} from './VoronoiMerge.js';
