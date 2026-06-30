import { pointsEqual, distance, angleBetween, EPSILON } from './math';
import type { LineSegment, Point } from './math';

export type Face = {
  vertices: Point[];
  area: number;
  center: Point;
  id: string;
};

// ── Max guards to prevent infinite loops on complex SVGs ───
const MAX_SEGMENTS   = 4000;   // bail if graph explodes
const MAX_ITERATIONS = 8000;   // max passes for each while-loop

// ──────────────────────────────────────────────────────────
// Geometry utilities
// ──────────────────────────────────────────────────────────

function intersectSegments(s1: LineSegment, s2: LineSegment): Point | null {
  const { p1: a, p2: b } = s1;
  const { p1: c, p2: d } = s2;

  const denom = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (Math.abs(denom) < EPSILON) return null; // Parallel / collinear

  const t1 = ((a.y - c.y) * (d.x - c.x) - (a.x - c.x) * (d.y - c.y)) / denom;
  const t2 = ((a.y - c.y) * (b.x - a.x) - (a.x - c.x) * (b.y - a.y)) / denom;

  if (t1 > EPSILON && t1 < 1 - EPSILON && t2 > EPSILON && t2 < 1 - EPSILON) {
    return {
      x: a.x + t1 * (b.x - a.x),
      y: a.y + t1 * (b.y - a.y),
    };
  }
  return null;
}

function pointOnSegment(p: Point, s: LineSegment): boolean {
  if (pointsEqual(p, s.p1) || pointsEqual(p, s.p2)) return false;
  const len = distance(s.p1, s.p2);
  if (len < EPSILON) return false;
  return Math.abs(distance(p, s.p1) + distance(p, s.p2) - len) < EPSILON;
}

// ──────────────────────────────────────────────────────────
// Deduplicate & clamp segments before heavy processing
// ──────────────────────────────────────────────────────────

function deduplicateSegments(segs: LineSegment[]): LineSegment[] {
  const seen = new Set<string>();
  return segs.filter(s => {
    const key = [
      Math.round(s.p1.x * 10), Math.round(s.p1.y * 10),
      Math.round(s.p2.x * 10), Math.round(s.p2.y * 10),
    ].join(',');
    const rev = [
      Math.round(s.p2.x * 10), Math.round(s.p2.y * 10),
      Math.round(s.p1.x * 10), Math.round(s.p1.y * 10),
    ].join(',');
    if (seen.has(key) || seen.has(rev)) return false;
    seen.add(key);
    return true;
  });
}

// ──────────────────────────────────────────────────────────
// Main face extraction
// ──────────────────────────────────────────────────────────

export function buildPlanarFaces(inputSegments: LineSegment[]): Face[] {

  // ── Pre-process: remove zero-length & duplicates ───────
  let segments = deduplicateSegments(
    inputSegments.filter(s => distance(s.p1, s.p2) > EPSILON)
  );

  // ── Hard cap: skip graph-building for huge files ───────
  if (segments.length > MAX_SEGMENTS) {
    console.warn(`[planarGraph] Too many segments (${segments.length}), capping at ${MAX_SEGMENTS}`);
    segments = segments.slice(0, MAX_SEGMENTS);
  }

  // ── 1. Split at interior intersections ─────────────────
  let iters = 0;
  let changed = true;
  while (changed && iters < MAX_ITERATIONS) {
    changed = false;
    iters++;
    outer: for (let i = 0; i < segments.length; i++) {
      for (let j = i + 1; j < segments.length; j++) {
        const pt = intersectSegments(segments[i], segments[j]);
        if (pt) {
          const s1 = segments[i], s2 = segments[j];
          // Remove old, add four halves
          segments.splice(j, 1);
          segments.splice(i, 1);
          segments.push(
            { p1: s1.p1, p2: pt, type: s1.type },
            { p1: pt, p2: s1.p2, type: s1.type },
            { p1: s2.p1, p2: pt, type: s2.type },
            { p1: pt, p2: s2.p2, type: s2.type },
          );
          // Guard against runaway growth
          if (segments.length > MAX_SEGMENTS) {
            console.warn('[planarGraph] Intersection splitting hit segment cap, stopping early.');
            changed = false;
            break outer;
          }
          changed = true;
          break outer;
        }
      }
    }
  }

  // ── 1b. Split at T-junctions (endpoints lying on segments) ─
  // Collect endpoints ONCE and don't update during iteration
  const allEndpoints = segments.flatMap(s => [s.p1, s.p2]);
  iters = 0;
  changed = true;
  while (changed && iters < MAX_ITERATIONS) {
    changed = false;
    iters++;
    outer2: for (let i = 0; i < segments.length; i++) {
      for (const pt of allEndpoints) {
        if (pointOnSegment(pt, segments[i])) {
          const s1 = segments[i];
          segments.splice(i, 1);
          segments.push(
            { p1: s1.p1, p2: pt, type: s1.type },
            { p1: pt, p2: s1.p2, type: s1.type },
          );
          changed = true;
          break outer2;
        }
      }
    }
  }

  // ── Remove zero-length / duplicates again after splitting ─
  segments = deduplicateSegments(
    segments.filter(s => distance(s.p1, s.p2) > EPSILON)
  );

  // ── 2. Build planar graph ───────────────────────────────
  const vertices: Point[] = [];
  const getVertexIndex = (p: Point): number => {
    let idx = vertices.findIndex(v => pointsEqual(v, p));
    if (idx === -1) { vertices.push(p); return vertices.length - 1; }
    return idx;
  };

  type Edge = { to: number; angle: number; rev: Edge | null; type: 'cut' | 'crease' | 'score' };
  const adj: Edge[][] = [];

  for (const s of segments) {
    const u = getVertexIndex(s.p1);
    const v = getVertexIndex(s.p2);
    if (u === v) continue;

    while (adj.length <= Math.max(u, v)) adj.push([]);

    // Skip duplicate edges
    if (adj[u].some(e => e.to === v)) continue;

    const edgeUV: Edge = { to: v, angle: angleBetween(vertices[u], vertices[v]), rev: null, type: s.type };
    const edgeVU: Edge = { to: u, angle: angleBetween(vertices[v], vertices[u]), rev: null, type: s.type };
    edgeUV.rev = edgeVU;
    edgeVU.rev = edgeUV;
    adj[u].push(edgeUV);
    adj[v].push(edgeVU);
  }

  // ── 3. Sort edges CCW ───────────────────────────────────
  for (let i = 0; i < vertices.length; i++) {
    if (adj[i]) adj[i].sort((a, b) => a.angle - b.angle);
  }

  // ── 4. Extract faces via half-edge traversal ────────────
  const faces: Face[] = [];
  const visitedEdges = new Set<string>();
  const MAX_FACE_VERTS = 1000; // guard against infinite face cycles

  for (let u = 0; u < vertices.length; u++) {
    if (!adj[u]) continue;
    for (const startEdge of adj[u]) {
      const startId = `${u}-${startEdge.to}`;
      if (visitedEdges.has(startId)) continue;

      const faceVerts: Point[] = [];
      let currNode = u;
      let currEdge = startEdge;
      let steps = 0;

      while (!visitedEdges.has(`${currNode}-${currEdge.to}`) && steps < MAX_FACE_VERTS) {
        visitedEdges.add(`${currNode}-${currEdge.to}`);
        faceVerts.push(vertices[currNode]);
        steps++;

        const nextNode = currEdge.to;
        const revEdge  = currEdge.rev!;
        const nextAdj  = adj[nextNode];
        if (!nextAdj || nextAdj.length === 0) break;

        const revIdx      = nextAdj.indexOf(revEdge);
        const nextEdgeIdx = (revIdx + 1) % nextAdj.length;
        currNode  = nextNode;
        currEdge  = nextAdj[nextEdgeIdx];
      }

      if (faceVerts.length > 2) {
        // Shoelace formula
        let area = 0, cx = 0, cy = 0;
        for (let k = 0; k < faceVerts.length; k++) {
          const p1 = faceVerts[k];
          const p2 = faceVerts[(k + 1) % faceVerts.length];
          const cross = p1.x * p2.y - p2.x * p1.y;
          area += cross;
          cx   += (p1.x + p2.x) * cross;
          cy   += (p1.y + p2.y) * cross;
        }
        area /= 2;

        if (Math.abs(area) > EPSILON) {
          faces.push({
            vertices: faceVerts,
            area,
            center: { x: cx / (6 * area), y: cy / (6 * area) },
            id: `face-${faces.length}`,
          });
        }
      }
    }
  }

  // ── 5. Remove the outer infinite face (largest absolute area) ─
  let maxAbsArea = 0, maxAreaIndex = -1;
  for (let i = 0; i < faces.length; i++) {
    if (Math.abs(faces[i].area) > maxAbsArea) {
      maxAbsArea = Math.abs(faces[i].area);
      maxAreaIndex = i;
    }
  }
  if (maxAreaIndex !== -1) faces.splice(maxAreaIndex, 1);

  // Normalize areas to positive
  for (const face of faces) face.area = Math.abs(face.area);

  return faces;
}
