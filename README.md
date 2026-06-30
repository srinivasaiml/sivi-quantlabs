# Sivi 3D Dieline

> Upload a flat SVG dieline → see the 2D preview with color-coded lines → watch it fold into a 3D box in real time.

![Stack](https://img.shields.io/badge/React-18-blue) ![Stack](https://img.shields.io/badge/Three.js-r162-black) ![Stack](https://img.shields.io/badge/Vite-8-purple) ![Stack](https://img.shields.io/badge/TypeScript-5-blue)

---

## What it does

1. You upload an SVG dieline exported from Illustrator, Inkscape, CorelDraw, or any CAD tool.
2. The app reads the stroke colors and classifies every path:
   - 🔴 **Red** → cut / outer contour
   - 🟢 **Green** → crease / fold line
   - 🔵 **Blue** → score / detail line
3. The left panel shows the **flat 2D dieline** with those exact colors, zoom/pan, and layer toggles.
4. The right panel shows a **live 3D model** built from the geometry. Double-click (or press **Close Box**) to animate it folding.

---

## How to run

```bash
cd app
npm install
npm run dev
# → http://localhost:5173
```

---

## Project layout

```
app/
├── index.html
└── src/
    ├── main.tsx              # React entry point
    ├── App.tsx               # Top-level UI, view modes, upload handler
    ├── App.css               # Glassmorphism toolbar, split layout, spinner
    ├── Box.tsx               # Recursive Three.js panel renderer
    ├── DielinePreview.tsx    # 2D SVG preview panel (zoom, pan, layer toggles)
    ├── DielinePreview.css    # Preview panel styles
    ├── store.ts              # Shared fold animation state (FoldState)
    └── lib/
        ├── math.ts           # Point, LineSegment types, distance, angle helpers
        ├── svgParser.ts      # SVG → LineSegments (all formats, color detection)
        ├── planarGraph.ts    # LineSegments → planar faces (graph algorithm)
        └── foldingTree.ts    # Faces → fold tree (BFS, crease-only edges)
```

---

## Pipeline — step by step

```
SVG file
   │
   ▼
svgParser.ts        — extractRawPaths()  →  RawPath[]   (for 2D preview)
                    — parseSVGPaths()    →  LineSegment[] (for 3D engine)
   │
   ▼
planarGraph.ts      — buildPlanarFaces() →  Face[]
   │
   ▼
foldingTree.ts      — buildFoldingTree() →  FoldNode (tree)
   │
   ▼
Box.tsx             — recursive <BoxNode> renders each face as an extruded mesh,
                      animates fold angle via FoldState shared store
```

---

## Where the fold logic lives

### `lib/svgParser.ts` — Color classification & path parsing

**`resolveStroke(el)`** walks the DOM tree upward (element → parent `<g>` → SVG root) to find the effective stroke color, handling:
- Inherited group colors
- `style="stroke:rgb(255,0,0)"` format
- Short hex `#f00` → `#ff0000` expansion
- Fill fallback when stroke is `none`
- Last-resort default to `'cut'` so no path is silently dropped

**`parsePath(d, type, transform, segments)`** implements the full SVG path command set: `M m L l H h V v C c S s Q q Z z` — including relative commands and cubic/quadratic Bézier approximation via line segments.

---

### `lib/planarGraph.ts` — Face extraction

This is the algorithmic core. Given a set of `LineSegment[]` it:

1. **Splits at intersections** — finds every T/X-junction where two segments cross and splits both at the intersection point.
2. **Splits at T-junctions** — finds endpoints that lie in the interior of another segment and splits there.
3. **Builds a planar graph** — each unique coordinate becomes a vertex; each segment becomes a directed half-edge pair.
4. **Sorts edges CCW** — at every vertex, outgoing edges are sorted by angle (counter-clockwise). This is the key invariant for correct face extraction.
5. **Traverses faces** — follows the "next CCW edge" rule at each vertex to trace closed face cycles (standard DCEL half-edge face traversal).
6. **Removes the outer face** — the bounding face (largest absolute area) is discarded; only interior panels remain.

**Hard guards added to prevent browser freeze:**
- `MAX_SEGMENTS = 4000` — caps input before heavy loops
- `MAX_ITERATIONS = 8000` — prevents infinite while-loops on degenerate geometry
- `MAX_FACE_VERTS = 1000` — prevents infinite face cycles

---

### `lib/foldingTree.ts` — Spanning tree of fold hinges

**`shareEdge(f1, f2, segments)`** checks whether two faces share an edge AND that edge is a **crease line** (green). It explicitly rejects cut-only edges — outer contour boundaries must not become fold hinges.

**`buildFoldingTree(faces, segments)`**:
1. Picks the largest face as the root (usually the main front panel).
2. BFS over all faces — for each unvisited face that shares a crease edge with the current node, attaches it as a child with `angle = Math.PI / 2` (90° fold).

---

### `Box.tsx` — Recursive 3D renderer

Each `<BoxNode>` receives:
- `node` — its `FoldNode` (face geometry + children)
- `myLocalOrigin` — the midpoint of the shared crease edge (the pivot point)
- `parentLocalOrigin` — the parent face's reference point
- `foldAxis` — the Three.js Vector3 along the crease edge
- `foldAngle` — signed ±90°

**Fold direction** is determined by the Z-component of `axis × vecToChild` (cross product). If `crossZ > 0` the child is to the left of the axis and folds with `+angle`; otherwise `-angle`.

**Animation** uses `useFrame` + `THREE.MathUtils.damp()` to smoothly interpolate `FoldState.current` toward `FoldState.target` (0 = flat, 1 = folded). All panels share this single global scalar — they all fold simultaneously at the same rate.

---

## The hard parts

### 1. Planar graph from raw SVG paths
SVG files don't give you "panels" — they give you thousands of raw line segments that may overlap, have T-junctions, float slightly off each other due to floating-point export errors, or be completely disconnected. Converting this into a topologically correct planar subdivision (where each closed region is a face) required implementing the full half-edge DCEL traversal with intersection splitting.

### 2. Robust color/stroke inheritance
Every SVG exporter (Illustrator, Inkscape, CorelDraw, Figma) stores colors differently — some on `<path stroke="">`, some in `style=""`, some on parent `<g>` groups, some as `rgb()`, some as `#f00` short hex. The parser had to walk the full DOM ancestry and handle all these cases, plus fall back gracefully so no path is silently dropped.

### 3. Fold direction sign
When a child panel folds around its crease edge, the sign of the rotation angle determines whether it folds **inward** (correct) or **outward** (inside-out). This depends on which side of the crease edge the child panel sits, which requires a cross-product test in 3D (Y-up) space. Getting this right for all panel orientations — especially when the SVG Y-axis is flipped relative to Three.js — took careful coordinate-system reasoning.

### 4. Crease-only fold edges
Early versions used a "lenient" fallback that connected any two faces sharing any edge, including cut (outer contour) edges. This caused tabs, slots, and lock flaps to fold when they should remain flat. The fix was to strictly gate `shareEdge()` on confirmed crease-type segments only.

### 5. Performance on large/complex SVGs
The intersection-splitting algorithm is O(n²) per pass and can run thousands of passes on a complex dieline. Without guards, the browser's main thread locks up completely. The fix added hard caps (`MAX_ITERATIONS`, `MAX_SEGMENTS`) and moved the heavy computation behind `async/await + setTimeout(0)` yields so the UI stays responsive and shows a spinner.

---

## SVG dieline format requirements

For best results, your SVG should follow these conventions:

| Requirement | Why |
|-------------|-----|
| **One continuous outer cut path** (red) | Ensures the planar graph has a single connected outer boundary |
| **Green crease lines touch the red contour exactly** | Endpoints must match to within 1e-3 units for T-junction detection |
| **No fills on cut/crease paths** | `fill="none"` prevents false area detection |
| **Colors on the path or a parent `<g>`** | The parser walks up the DOM, so group-level colors work |

---

## Test dielines included

| File | Description |
|------|-------------|
| `test_dieline.svg` | Simple 5-panel tuck box (top flap, front, left, right, bottom) |
| `test_dieline2.svg` | Full 6-panel wrap-around product box (front, back, 2× depth, top/bottom flaps) |

---

## Known limitations

- **Bezier curves** in cut lines are approximated as polylines (8 steps per curve segment) — round tabs/slots render correctly in 2D but become polygonal in 3D
- **Glue tabs** that share only a cut edge are correctly excluded from folding but appear as separate flat panels
- **Very large SVGs** (>4000 segments) are capped — complex production dielines may need simplification before upload
- **Fold angle** is fixed at 90° for all panels — non-orthogonal boxes (e.g. tuck-in flaps at 45°) will not fold to the correct final angle

---

*Built with React 18 · React Three Fiber · Three.js · Vite · TypeScript*
