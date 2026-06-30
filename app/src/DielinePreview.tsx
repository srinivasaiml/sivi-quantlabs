import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { RawPath } from './lib/svgParser';
import './DielinePreview.css';

// ──────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────

const LINE_COLORS: Record<'cut' | 'crease' | 'score', string> = {
  cut:    '#FF2020',  // vivid red
  crease: '#00CC55',  // vivid green
  score:  '#2196F3',  // vivid blue
};

const LINE_WIDTHS: Record<'cut' | 'crease' | 'score', number> = {
  cut:    1.2,
  crease: 1.0,
  score:  0.8,
};

const LINE_DASH: Record<'cut' | 'crease' | 'score', string> = {
  cut:    'none',
  crease: 'none',
  score:  '4,3',
};

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

function parseSVGViewBox(svgText: string): { x: number; y: number; w: number; h: number } | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const svg = doc.querySelector('svg');
  if (!svg) return null;

  const vb = svg.getAttribute('viewBox');
  if (vb) {
    const [x, y, w, h] = vb.split(/[\s,]+/).map(Number);
    if (!isNaN(w) && !isNaN(h) && w > 0 && h > 0) return { x, y, w, h };
  }

  const wAttr = parseFloat(svg.getAttribute('width') || '0');
  const hAttr = parseFloat(svg.getAttribute('height') || '0');
  if (wAttr > 0 && hAttr > 0) return { x: 0, y: 0, w: wAttr, h: hAttr };

  return null;
}

// ──────────────────────────────────────────────────────────
// Props & Component
// ──────────────────────────────────────────────────────────

interface DielinePreviewProps {
  rawPaths: RawPath[];
  svgText: string;
  onClose?: () => void;
}

export default function DielinePreview({ rawPaths, svgText, onClose }: DielinePreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const [activeTypes, setActiveTypes] = useState<Set<'cut' | 'crease' | 'score'>>(
    new Set(['cut', 'crease', 'score'])
  );

  const viewBox = parseSVGViewBox(svgText);

  // ── Zoom via wheel ──────────────────────────────────────
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom(z => Math.min(Math.max(z * delta, 0.1), 20));
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // ── Pan via drag ───────────────────────────────────────
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsPanning(true);
    lastMouse.current = { x: e.clientX, y: e.clientY };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!isPanning) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    setPan(p => ({ x: p.x + dx, y: p.y + dy }));
    lastMouse.current = { x: e.clientX, y: e.clientY };
  };
  const onMouseUp = () => setIsPanning(false);

  // ── Reset view ─────────────────────────────────────────
  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  // ── Toggle layer visibility ────────────────────────────
  const toggleType = (t: 'cut' | 'crease' | 'score') => {
    setActiveTypes(prev => {
      const next = new Set(prev);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });
  };

  // ── Build SVG content with transforms applied ──────────
  // We pass the raw `d` strings with any transform into a nested <g transform>
  const svgContent = rawPaths.filter(p => activeTypes.has(p.type)).map((path, i) => {
    const color = LINE_COLORS[path.type];
    const width = LINE_WIDTHS[path.type];
    const dash = LINE_DASH[path.type];

    return (
      <g key={i} transform={path.transform || undefined}>
        <path
          d={path.d}
          stroke={color}
          strokeWidth={width}
          strokeDasharray={dash === 'none' ? undefined : dash}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    );
  });

  // Compute viewBox string for the SVG element
  const svgViewBox = viewBox
    ? `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`
    : '0 0 500 600';

  const counts = {
    cut:    rawPaths.filter(p => p.type === 'cut').length,
    crease: rawPaths.filter(p => p.type === 'crease').length,
    score:  rawPaths.filter(p => p.type === 'score').length,
  };

  return (
    <div className="dieline-preview-panel">
      {/* ── Header ── */}
      <div className="dp-header">
        <div className="dp-title">
          <span className="dp-icon">📐</span>
          <span>Dieline Preview</span>
        </div>

        {/* Layer toggles */}
        <div className="dp-layers">
          {(['cut', 'crease', 'score'] as const).map(t => (
            <button
              key={t}
              className={`dp-layer-btn ${activeTypes.has(t) ? 'active' : 'inactive'}`}
              style={{ '--layer-color': LINE_COLORS[t] } as React.CSSProperties}
              onClick={() => toggleType(t)}
              title={`Toggle ${t} lines (${counts[t]} paths)`}
            >
              <span className="dp-layer-dot" />
              <span className="dp-layer-label">{t.charAt(0).toUpperCase() + t.slice(1)}</span>
              <span className="dp-layer-count">{counts[t]}</span>
            </button>
          ))}
        </div>

        <div className="dp-actions">
          <button className="dp-icon-btn" onClick={resetView} title="Reset view">⟳</button>
          {onClose && (
            <button className="dp-icon-btn dp-close" onClick={onClose} title="Close preview">✕</button>
          )}
        </div>
      </div>

      {/* ── Canvas ── */}
      <div
        className="dp-canvas"
        ref={containerRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
      >
        <div
          className="dp-transform-root"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        >
          <svg
            viewBox={svgViewBox}
            width="100%"
            height="100%"
            style={{ display: 'block', maxWidth: '100%', maxHeight: '100%' }}
            xmlns="http://www.w3.org/2000/svg"
          >
            {/* White background */}
            <rect
              x={viewBox?.x ?? 0}
              y={viewBox?.y ?? 0}
              width={viewBox?.w ?? 500}
              height={viewBox?.h ?? 600}
              fill="#ffffff"
              rx="0"
            />
            {svgContent}
          </svg>
        </div>

        {/* Zoom badge */}
        <div className="dp-zoom-badge">{Math.round(zoom * 100)}%</div>
      </div>

      {/* ── Legend footer ── */}
      <div className="dp-footer">
        <div className="dp-legend">
          {(['cut', 'crease', 'score'] as const).map(t => (
            <div key={t} className="dp-legend-item">
              <svg width="28" height="8">
                <line
                  x1="0" y1="4" x2="28" y2="4"
                  stroke={LINE_COLORS[t]}
                  strokeWidth="2"
                  strokeDasharray={LINE_DASH[t] === 'none' ? undefined : LINE_DASH[t]}
                />
              </svg>
              <span>{t === 'cut' ? 'Cut / Outer contour' : t === 'crease' ? 'Crease / Fold' : 'Score / Detail'}</span>
            </div>
          ))}
        </div>
        <div className="dp-hint">Scroll to zoom · Drag to pan</div>
      </div>
    </div>
  );
}
