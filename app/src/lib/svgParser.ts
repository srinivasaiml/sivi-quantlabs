import type { LineSegment, Point } from './math';

// ──────────────────────────────────────────────────────────
// Color classification — handles every real-world SVG format
// ──────────────────────────────────────────────────────────

/** Expand short hex #rgb → #rrggbb and lowercase */
function normalizeColor(raw: string): string {
  let c = raw.toLowerCase().trim();
  // Expand shorthand hex: #f00 → #ff0000
  if (/^#[0-9a-f]{3}$/.test(c)) {
    c = '#' + c[1]+c[1] + c[2]+c[2] + c[3]+c[3];
  }
  return c;
}

/** Convert rgb(r,g,b) / rgba(...) to #rrggbb */
function rgbToHex(rgb: string): string {
  const m = rgb.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (!m) return rgb;
  const r = parseInt(m[1]).toString(16).padStart(2, '0');
  const g = parseInt(m[2]).toString(16).padStart(2, '0');
  const b = parseInt(m[3]).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

function classifyColor(rawColor: string): 'cut' | 'crease' | 'score' {
  let c = normalizeColor(rawColor);
  // Convert rgb() to hex first
  if (c.startsWith('rgb')) c = normalizeColor(rgbToHex(c));

  // ── GREEN → crease / fold ──
  if (
    c === 'green' || c === 'lime' ||
    c === '#008000' || c === '#00ff00' ||
    c.startsWith('#0') && /^#0[0-9a-f][3-9a-f]0[0-9a-f][0-9a-f]$/.test(c) ||
    ['00a650','00b050','00aa00','009900','007700','006600',
     '00cc55','00c853','33cc33','22bb22'].some(h => c.includes(h))
  ) return 'crease';

  // ── BLUE → score / detail ──
  if (
    c === 'blue' || c === '#0000ff' ||
    c.startsWith('#00') && /^#00[0-9a-f]{2}[4-9a-f][0-9a-f]$/.test(c) ||
    ['0070c0','0066cc','1f78b4','4472c4','0080ff',
     '2196f3','1565c0','0d47a1','1976d2','2979ff'].some(h => c.includes(h))
  ) return 'score';

  // ── RED → cut / outer contour (default fallback too) ──
  // Catches named red, all #ff____ reds, short #f00, #e00, etc.
  return 'cut';
}

// ──────────────────────────────────────────────────────────
// Robust stroke resolver — walks DOM ancestry for inheritance
// ──────────────────────────────────────────────────────────

/** Extract a raw CSS property value from an inline style string */
function styleValue(style: string, prop: string): string {
  const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i');
  const m = style.match(re);
  return m ? m[1].trim() : '';
}

/**
 * Walk the element AND its ancestors to find an effective stroke color.
 * Falls back to fill if stroke is 'none' / missing.
 * Returns empty string only if truly nothing is found anywhere.
 */
function resolveStroke(el: Element): string {
  let node: Element | null = el;
  while (node && node.tagName !== 'svg') {
    // 1. inline style attribute
    const style = node.getAttribute('style') || '';
    const strokeStyle = styleValue(style, 'stroke');
    if (strokeStyle && strokeStyle !== 'none' && strokeStyle !== 'transparent') {
      return strokeStyle;
    }

    // 2. presentation attribute
    const strokeAttr = node.getAttribute('stroke');
    if (strokeAttr && strokeAttr !== 'none' && strokeAttr !== 'transparent') {
      return strokeAttr;
    }

    // 3. color attribute (used as currentColor in some exporters)
    const colorAttr = node.getAttribute('color');
    if (colorAttr && colorAttr !== 'none') return colorAttr;

    node = node.parentElement;
  }

  // 4. Fill fallback — some exporters use fill instead of stroke
  node = el;
  while (node && node.tagName !== 'svg') {
    const style = node.getAttribute('style') || '';
    const fillStyle = styleValue(style, 'fill');
    if (fillStyle && fillStyle !== 'none' && fillStyle !== 'transparent') {
      return fillStyle;
    }
    const fillAttr = node.getAttribute('fill');
    if (fillAttr && fillAttr !== 'none' && fillAttr !== 'transparent') {
      return fillAttr;
    }
    node = node.parentElement;
  }

  // 5. Last resort: treat as cut (so the path is never silently dropped)
  return 'red';
}

// ──────────────────────────────────────────────────────────
// Transform matrix helpers
// ──────────────────────────────────────────────────────────

function parseTransformMatrix(transformStr: string | null): number[] {
  if (!transformStr) return [1, 0, 0, 1, 0, 0];
  const match = transformStr.match(/matrix\(([^)]+)\)/);
  if (match) {
    return match[1].split(/[\s,]+/).map(Number);
  }
  // Handle translate(tx, ty)
  const t = transformStr.match(/translate\(([^)]+)\)/);
  if (t) {
    const vals = t[1].split(/[\s,]+/).map(Number);
    return [1, 0, 0, 1, vals[0] || 0, vals[1] || 0];
  }
  return [1, 0, 0, 1, 0, 0];
}

function applyTransform(p: Point, m: number[]): Point {
  const [a, b, c, d, e, f] = m;
  return {
    x: a * p.x + c * p.y + e,
    y: b * p.x + d * p.y + f,
  };
}

// ──────────────────────────────────────────────────────────
// Full SVG path 'd' attribute tokenizer & parser
// ──────────────────────────────────────────────────────────

type PathCommand = { cmd: string; args: number[] };

function tokenizePath(d: string): PathCommand[] {
  const tokens: PathCommand[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(d)) !== null) {
    const cmd = match[1];
    const rawArgs = match[2].trim();
    const args = rawArgs
      ? rawArgs.split(/[\s,]+/).filter(Boolean).map(Number)
      : [];
    tokens.push({ cmd, args });
  }
  return tokens;
}

function cubicBezierPoints(
  p0: Point, cp1: Point, cp2: Point, p3: Point,
  steps = 8
): Point[] {
  const pts: Point[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    pts.push({
      x: mt ** 3 * p0.x + 3 * mt ** 2 * t * cp1.x + 3 * mt * t ** 2 * cp2.x + t ** 3 * p3.x,
      y: mt ** 3 * p0.y + 3 * mt ** 2 * t * cp1.y + 3 * mt * t ** 2 * cp2.y + t ** 3 * p3.y,
    });
  }
  return pts;
}

function quadBezierPoints(
  p0: Point, cp: Point, p2: Point,
  steps = 6
): Point[] {
  const pts: Point[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    pts.push({
      x: mt ** 2 * p0.x + 2 * mt * t * cp.x + t ** 2 * p2.x,
      y: mt ** 2 * p0.y + 2 * mt * t * cp.y + t ** 2 * p2.y,
    });
  }
  return pts;
}

// ──────────────────────────────────────────────────────────
// Main SVG path parser
// ──────────────────────────────────────────────────────────

function parsePath(
  d: string,
  type: 'cut' | 'crease' | 'score',
  transform: number[],
  segments: LineSegment[]
): void {
  const commands = tokenizePath(d);
  let cur: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 }; // for Z close
  let lastCP: Point | null = null; // for smooth curves

  const addSeg = (a: Point, b: Point) => {
    const ta = applyTransform(a, transform);
    const tb = applyTransform(b, transform);
    segments.push({ p1: ta, p2: tb, type });
  };

  for (const { cmd, args } of commands) {
    switch (cmd) {
      // ── Move ──────────────────────────────────────────
      case 'M': {
        for (let i = 0; i < args.length; i += 2) {
          const p: Point = { x: args[i], y: args[i + 1] };
          if (i === 0) {
            cur = p;
            start = p;
          } else {
            addSeg(cur, p);
            cur = p;
          }
        }
        break;
      }
      case 'm': {
        for (let i = 0; i < args.length; i += 2) {
          const p: Point = { x: cur.x + args[i], y: cur.y + args[i + 1] };
          if (i === 0) {
            cur = p;
            start = p;
          } else {
            addSeg(cur, p);
            cur = p;
          }
        }
        break;
      }

      // ── Line ──────────────────────────────────────────
      case 'L': {
        for (let i = 0; i < args.length; i += 2) {
          const p: Point = { x: args[i], y: args[i + 1] };
          addSeg(cur, p);
          cur = p;
        }
        break;
      }
      case 'l': {
        for (let i = 0; i < args.length; i += 2) {
          const p: Point = { x: cur.x + args[i], y: cur.y + args[i + 1] };
          addSeg(cur, p);
          cur = p;
        }
        break;
      }

      // ── Horizontal ────────────────────────────────────
      case 'H': {
        for (const ax of args) {
          const p: Point = { x: ax, y: cur.y };
          addSeg(cur, p);
          cur = p;
        }
        break;
      }
      case 'h': {
        for (const ax of args) {
          const p: Point = { x: cur.x + ax, y: cur.y };
          addSeg(cur, p);
          cur = p;
        }
        break;
      }

      // ── Vertical ──────────────────────────────────────
      case 'V': {
        for (const ay of args) {
          const p: Point = { x: cur.x, y: ay };
          addSeg(cur, p);
          cur = p;
        }
        break;
      }
      case 'v': {
        for (const ay of args) {
          const p: Point = { x: cur.x, y: cur.y + ay };
          addSeg(cur, p);
          cur = p;
        }
        break;
      }

      // ── Cubic Bezier ──────────────────────────────────
      case 'C': {
        for (let i = 0; i + 5 < args.length; i += 6) {
          const cp1: Point = { x: args[i],     y: args[i + 1] };
          const cp2: Point = { x: args[i + 2], y: args[i + 3] };
          const end: Point = { x: args[i + 4], y: args[i + 5] };
          const pts = cubicBezierPoints(cur, cp1, cp2, end);
          let prev = cur;
          for (const pt of pts) { addSeg(prev, pt); prev = pt; }
          lastCP = cp2;
          cur = end;
        }
        break;
      }
      case 'c': {
        for (let i = 0; i + 5 < args.length; i += 6) {
          const cp1: Point = { x: cur.x + args[i],     y: cur.y + args[i + 1] };
          const cp2: Point = { x: cur.x + args[i + 2], y: cur.y + args[i + 3] };
          const end: Point = { x: cur.x + args[i + 4], y: cur.y + args[i + 5] };
          const pts = cubicBezierPoints(cur, cp1, cp2, end);
          let prev = cur;
          for (const pt of pts) { addSeg(prev, pt); prev = pt; }
          lastCP = cp2;
          cur = end;
        }
        break;
      }

      // ── Smooth Cubic ─────────────────────────────────
      case 'S': {
        for (let i = 0; i + 3 < args.length; i += 4) {
          const cp1: Point = lastCP
            ? { x: 2 * cur.x - lastCP.x, y: 2 * cur.y - lastCP.y }
            : cur;
          const cp2: Point = { x: args[i],     y: args[i + 1] };
          const end: Point = { x: args[i + 2], y: args[i + 3] };
          const pts = cubicBezierPoints(cur, cp1, cp2, end);
          let prev = cur;
          for (const pt of pts) { addSeg(prev, pt); prev = pt; }
          lastCP = cp2;
          cur = end;
        }
        break;
      }
      case 's': {
        for (let i = 0; i + 3 < args.length; i += 4) {
          const cp1: Point = lastCP
            ? { x: 2 * cur.x - lastCP.x, y: 2 * cur.y - lastCP.y }
            : cur;
          const cp2: Point = { x: cur.x + args[i],     y: cur.y + args[i + 1] };
          const end: Point = { x: cur.x + args[i + 2], y: cur.y + args[i + 3] };
          const pts = cubicBezierPoints(cur, cp1, cp2, end);
          let prev = cur;
          for (const pt of pts) { addSeg(prev, pt); prev = pt; }
          lastCP = cp2;
          cur = end;
        }
        break;
      }

      // ── Quadratic Bezier ──────────────────────────────
      case 'Q': {
        for (let i = 0; i + 3 < args.length; i += 4) {
          const cp: Point = { x: args[i],     y: args[i + 1] };
          const end: Point = { x: args[i + 2], y: args[i + 3] };
          const pts = quadBezierPoints(cur, cp, end);
          let prev = cur;
          for (const pt of pts) { addSeg(prev, pt); prev = pt; }
          lastCP = cp;
          cur = end;
        }
        break;
      }
      case 'q': {
        for (let i = 0; i + 3 < args.length; i += 4) {
          const cp: Point = { x: cur.x + args[i],     y: cur.y + args[i + 1] };
          const end: Point = { x: cur.x + args[i + 2], y: cur.y + args[i + 3] };
          const pts = quadBezierPoints(cur, cp, end);
          let prev = cur;
          for (const pt of pts) { addSeg(prev, pt); prev = pt; }
          lastCP = cp;
          cur = end;
        }
        break;
      }

      // ── Close ─────────────────────────────────────────
      case 'Z':
      case 'z': {
        addSeg(cur, start);
        cur = start;
        lastCP = null;
        break;
      }

      default:
        lastCP = null;
        break;
    }

    // Reset lastCP when command is not a curve
    if (!['C','c','S','s','Q','q'].includes(cmd)) {
      lastCP = null;
    }
  }
}

// ──────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────

/** Parsed raw SVG path data for direct 2-D preview rendering */
export type RawPath = {
  d: string;
  type: 'cut' | 'crease' | 'score';
  transform: string;
};

export function extractRawPaths(svgText: string): RawPath[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const rawPaths: RawPath[] = [];

  /** Collect the cumulative transform chain from element up to SVG root */
  function getTransformChain(el: Element): string {
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node.tagName !== 'svg') {
      const t = node.getAttribute('transform');
      if (t) parts.unshift(t);
      node = node.parentElement;
    }
    return parts.join(' ');
  }

  // <path> elements
  doc.querySelectorAll('path').forEach(el => {
    const d = el.getAttribute('d');
    if (!d) return;
    const color = resolveStroke(el);
    const type  = classifyColor(color);
    rawPaths.push({ d, type, transform: getTransformChain(el) });
  });

  // <line> elements
  doc.querySelectorAll('line').forEach(el => {
    const x1 = parseFloat(el.getAttribute('x1') || '0');
    const y1 = parseFloat(el.getAttribute('y1') || '0');
    const x2 = parseFloat(el.getAttribute('x2') || '0');
    const y2 = parseFloat(el.getAttribute('y2') || '0');
    const color = resolveStroke(el);
    const type  = classifyColor(color);
    rawPaths.push({ d: `M${x1},${y1} L${x2},${y2}`, type, transform: getTransformChain(el) });
  });

  // <polyline> / <polygon>
  doc.querySelectorAll('polyline, polygon').forEach(el => {
    const pts = el.getAttribute('points');
    if (!pts) return;
    const nums = pts.trim().split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
    if (nums.length < 4) return;
    const pairs: string[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pairs.push(`${nums[i]},${nums[i+1]}`);
    const close = el.tagName.toLowerCase() === 'polygon' ? ' Z' : '';
    const d = `M${pairs[0]} L${pairs.slice(1).join(' L')}${close}`;
    const color = resolveStroke(el);
    const type  = classifyColor(color);
    rawPaths.push({ d, type, transform: getTransformChain(el) });
  });

  // <rect> elements (common in some exporters)
  doc.querySelectorAll('rect').forEach(el => {
    const x = parseFloat(el.getAttribute('x') || '0');
    const y = parseFloat(el.getAttribute('y') || '0');
    const w = parseFloat(el.getAttribute('width') || '0');
    const h = parseFloat(el.getAttribute('height') || '0');
    if (w <= 0 || h <= 0) return;
    const d = `M${x},${y} L${x+w},${y} L${x+w},${y+h} L${x},${y+h} Z`;
    const color = resolveStroke(el);
    const type  = classifyColor(color);
    rawPaths.push({ d, type, transform: getTransformChain(el) });
  });

  return rawPaths;
}

/** Compose a full transform matrix by walking from element up to SVG root */
function resolveTransformMatrix(el: Element): number[] {
  const chain: number[][] = [];
  let node: Element | null = el;
  while (node && node.tagName !== 'svg') {
    const t = node.getAttribute('transform');
    if (t) chain.unshift(parseTransformMatrix(t));
    node = node.parentElement;
  }
  // Multiply matrices left-to-right
  let m: number[] = [1, 0, 0, 1, 0, 0];
  for (const tm of chain) {
    const [a1,b1,c1,d1,e1,f1] = m;
    const [a2,b2,c2,d2,e2,f2] = tm;
    m = [
      a1*a2 + c1*b2,  b1*a2 + d1*b2,
      a1*c2 + c1*d2,  b1*c2 + d1*d2,
      a1*e2 + c1*f2 + e1,
      b1*e2 + d1*f2 + f1,
    ];
  }
  return m;
}

/** Parse SVG into flat LineSegments for the 3-D folding engine */
export function parseSVGPaths(svgText: string): LineSegment[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const segments: LineSegment[] = [];

  // <path>
  doc.querySelectorAll('path').forEach(path => {
    const d = path.getAttribute('d');
    if (!d) return;
    const color = resolveStroke(path);
    const type  = classifyColor(color);
    const transform = resolveTransformMatrix(path);
    parsePath(d, type, transform, segments);
  });

  // <line>
  doc.querySelectorAll('line').forEach(el => {
    const x1 = parseFloat(el.getAttribute('x1') || '0');
    const y1 = parseFloat(el.getAttribute('y1') || '0');
    const x2 = parseFloat(el.getAttribute('x2') || '0');
    const y2 = parseFloat(el.getAttribute('y2') || '0');
    const color = resolveStroke(el);
    const type  = classifyColor(color);
    const transform = resolveTransformMatrix(el);
    segments.push({
      p1: applyTransform({ x: x1, y: y1 }, transform),
      p2: applyTransform({ x: x2, y: y2 }, transform),
      type,
    });
  });

  // <polyline> / <polygon>
  doc.querySelectorAll('polyline, polygon').forEach(el => {
    const pts = el.getAttribute('points');
    if (!pts) return;
    const nums = pts.trim().split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
    if (nums.length < 4) return;
    const color = resolveStroke(el);
    const type  = classifyColor(color);
    const transform = resolveTransformMatrix(el);
    const close = el.tagName.toLowerCase() === 'polygon';
    const points: Point[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2)
      points.push(applyTransform({ x: nums[i], y: nums[i+1] }, transform));
    for (let i = 0; i < points.length - 1; i++)
      segments.push({ p1: points[i], p2: points[i+1], type });
    if (close && points.length > 1)
      segments.push({ p1: points[points.length-1], p2: points[0], type });
  });

  // <rect>
  doc.querySelectorAll('rect').forEach(el => {
    const x = parseFloat(el.getAttribute('x') || '0');
    const y = parseFloat(el.getAttribute('y') || '0');
    const w = parseFloat(el.getAttribute('width') || '0');
    const h = parseFloat(el.getAttribute('height') || '0');
    if (w <= 0 || h <= 0) return;
    const color = resolveStroke(el);
    const type  = classifyColor(color);
    const transform = resolveTransformMatrix(el);
    const corners = [
      { x, y }, { x: x+w, y }, { x: x+w, y: y+h }, { x, y: y+h }
    ].map(p => applyTransform(p, transform));
    for (let i = 0; i < 4; i++)
      segments.push({ p1: corners[i], p2: corners[(i+1)%4], type });
  });

  return segments;
}
