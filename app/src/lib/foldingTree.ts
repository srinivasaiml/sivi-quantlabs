import type { Face } from './planarGraph';
import { pointsEqual, distance } from './math';
import type { LineSegment, Point } from './math';

export type FoldNode = {
  face: Face;
  children: {
    node: FoldNode;
    // The shared edge between this face and the child face
    edge: { p1: Point; p2: Point };
    // Fold angle relative to parent (typically 90 degrees in standard boxes)
    angle: number;
  }[];
};

function shareEdge(f1: Face, f2: Face, segments: LineSegment[]): { p1: Point; p2: Point } | null {
  for (let i = 0; i < f1.vertices.length; i++) {
    const a1 = f1.vertices[i];
    const b1 = f1.vertices[(i + 1) % f1.vertices.length];

    for (let j = 0; j < f2.vertices.length; j++) {
      const a2 = f2.vertices[j];
      const b2 = f2.vertices[(j + 1) % f2.vertices.length];

      // Edges are shared if vertices match (either order)
      if ((pointsEqual(a1, a2) && pointsEqual(b1, b2)) || (pointsEqual(a1, b2) && pointsEqual(b1, a2))) {
        let isCrease = false;
        let isCut    = false;

        for (const s of segments) {
          // Check whether original segment s covers this shared edge
          if (pointOnSegmentOrEnd(a1, s) && pointOnSegmentOrEnd(b1, s)) {
            if (s.type === 'crease') isCrease = true;
            if (s.type === 'cut')    isCut    = true;
          }
        }

        // Only fold on crease lines; never fold on pure-cut or ambiguous edges.
        // Cut boundaries (outer contour, slots, lock tabs) must NOT become fold hinges.
        if (isCrease && !isCut) {
          return { p1: a1, p2: b1 };
        }

        // If neither crease nor cut was found this is likely an interior T-junction
        // artifact — skip it to avoid phantom folds.
        return null;
      }
    }
  }
  return null;
}

function pointOnSegmentOrEnd(p: Point, s: LineSegment): boolean {
  if (pointsEqual(p, s.p1) || pointsEqual(p, s.p2)) return true;
  const d1 = distance(p, s.p1);
  const d2 = distance(p, s.p2);
  const len = distance(s.p1, s.p2);
  return Math.abs(d1 + d2 - len) < 1e-3;
}

export function buildFoldingTree(faces: Face[], segments: LineSegment[]): FoldNode | null {
  if (faces.length === 0) return null;

  // Find the central face to act as the root. 
  // A good heuristic for the root is the face with the largest area, or one near the geometric center.
  // We'll just pick the largest face for now.
  let rootFace = faces[0];
  for (const f of faces) {
    if (f.area > rootFace.area) rootFace = f;
  }

  const rootNode: FoldNode = { face: rootFace, children: [] };
  const visited = new Set<string>();
  visited.add(rootFace.id);

  // BFS queue
  const queue: FoldNode[] = [rootNode];

  while (queue.length > 0) {
    const current = queue.shift()!;
    
    for (const neighbor of faces) {
      if (visited.has(neighbor.id)) continue;

      const sharedEdge = shareEdge(current.face, neighbor, segments);
      if (sharedEdge) {
        visited.add(neighbor.id);
        const childNode: FoldNode = { face: neighbor, children: [] };
        current.children.push({
          node: childNode,
          edge: sharedEdge,
          angle: Math.PI / 2 // 90 degrees fold by default
        });
        queue.push(childNode);
      }
    }
  }

  return rootNode;
}
