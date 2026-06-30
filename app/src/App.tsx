import React, { useState, useRef, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';
import { Upload, Package, FolderOpen, Layers, Eye, EyeOff } from 'lucide-react';
import './App.css';
import { parseSVGPaths, extractRawPaths } from './lib/svgParser';
import type { RawPath } from './lib/svgParser';
import { buildPlanarFaces } from './lib/planarGraph';
import { buildFoldingTree } from './lib/foldingTree';
import type { FoldNode } from './lib/foldingTree';
import { BoxNode } from './Box';
import * as THREE from 'three';
import { FoldState } from './store';
import DielinePreview from './DielinePreview';

// ──────────────────────────────────────────────────────────
// 3-D canvas inner component
// ──────────────────────────────────────────────────────────

function AppCanvas({ tree }: { tree: FoldNode }) {
  useFrame((_, delta) => {
    FoldState.current = THREE.MathUtils.damp(FoldState.current, FoldState.target, 4, delta);
  });
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={1} castShadow />
      <Environment preset="city" />
      <OrbitControls makeDefault />
      <group scale={[0.01, 0.01, 0.01]}>
        <BoxNode node={tree} />
      </group>
    </>
  );
}

// ──────────────────────────────────────────────────────────
// Main App
// ──────────────────────────────────────────────────────────

type ViewMode = 'split' | '2d' | '3d';

function App() {
  const [tree, setTree]         = useState<FoldNode | null>(null);
  const [rawPaths, setRawPaths] = useState<RawPath[]>([]);
  const [svgText, setSvgText]   = useState<string>('');
  const [isOpen, setIsOpen]     = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [show2D, setShow2D]         = useState(true);
  const [processing, setProcessing] = useState(false);
  const fileInputRef                = useRef<HTMLInputElement>(null);

  // ── Shared SVG processing (async so UI stays responsive) ───
  const processSVG = useCallback(async (text: string) => {
    setProcessing(true);
    setError(null);
    try {
      // Yield to browser so spinner renders before heavy work
      await new Promise<void>(res => setTimeout(res, 0));

      const rp = extractRawPaths(text);
      setRawPaths(rp);
      setSvgText(text);

      // Second yield before the heavy graph computation
      await new Promise<void>(res => setTimeout(res, 0));

      const segments = parseSVGPaths(text);
      if (segments.length === 0) throw new Error('No valid paths found in SVG');

      const faces = buildPlanarFaces(segments);
      if (faces.length === 0) throw new Error('Could not extract panels from SVG');

      const newTree = buildFoldingTree(faces, segments);
      if (!newTree) throw new Error('Could not build folding tree');

      setTree(newTree);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to parse SVG';
      setError(msg);
      setTree(null);
      setRawPaths([]);
    } finally {
      setProcessing(false);
    }
  }, []);

  // ── File upload handler ─────────────────────────────────
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      processSVG(text);
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [processSVG]);

  const triggerUpload = () => fileInputRef.current?.click();

  const toggleFold = () => {
    const next = !isOpen;
    setIsOpen(next);
    FoldState.target = next ? 0 : 1;
  };

  // ── Drag-and-drop support ───────────────────────────────
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.name.endsWith('.svg')) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      processSVG(text);
    };
    reader.readAsText(file);
  }, [processSVG]);

  const onDragOver = (e: React.DragEvent) => e.preventDefault();

  // ── Computed layout ────────────────────────────────────
  const has2D  = rawPaths.length > 0;
  const has3D  = !!tree;
  const show3D = has3D && (viewMode === '3d' || viewMode === 'split');
  const show2DPanel = has2D && show2D && (viewMode === '2d' || viewMode === 'split');

  return (
    <div
      className="app-container"
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
      {/* ── Top toolbar ── */}
      <div className="ui-overlay">
        {/* Logo / Title */}
        <div className="toolbar-brand">
          <span className="brand-icon">📦</span>
          <h1 className="title">Sivi 3D Dieline</h1>
        </div>

        <div className="toolbar-divider" />

        {/* Upload */}
        <button className="btn primary" onClick={triggerUpload}>
          <Upload size={16} />
          <span>Upload SVG</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".svg"
          style={{ display: 'none' }}
          onChange={handleFileUpload}
        />

        {/* View mode switcher */}
        {(has2D || has3D) && (
          <>
            <div className="toolbar-divider" />
            <div className="view-mode-group">
              {(['split', '2d', '3d'] as ViewMode[]).map(mode => (
                <button
                  key={mode}
                  className={`view-mode-btn ${viewMode === mode ? 'active' : ''}`}
                  onClick={() => setViewMode(mode)}
                  title={mode === 'split' ? 'Split view' : mode === '2d' ? '2D flat dieline' : '3D folded model'}
                >
                  {mode === 'split' ? <Layers size={14} /> : null}
                  {mode.toUpperCase()}
                </button>
              ))}
            </div>

            {/* Toggle 2D panel */}
            {has2D && viewMode !== '3d' && (
              <button
                className={`btn ${show2D ? '' : 'muted'}`}
                onClick={() => setShow2D(v => !v)}
                title="Toggle 2D dieline view"
              >
                {show2D ? <Eye size={16} /> : <EyeOff size={16} />}
                <span>Flat</span>
              </button>
            )}
          </>
        )}

        {/* Fold toggle */}
        {has3D && viewMode !== '2d' && (
          <>
            <div className="toolbar-divider" />
            <button className="btn accent" onClick={toggleFold}>
              {isOpen ? <Package size={16} /> : <FolderOpen size={16} />}
              <span>{isOpen ? 'Close Box' : 'Open Box'}</span>
            </button>
          </>
        )}
      </div>

      {/* ── Error message ── */}
      {error && (
        <div className="status-message error">
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {/* ── Processing spinner ── */}
      {processing && (
        <div className="status-message processing">
          <span className="spinner" />
          <span>Processing SVG…</span>
        </div>
      )}

      {/* ── Empty state ── */}
      {!has2D && !has3D && !error && !processing && (
        <div className="empty-state">
          <div className="empty-state-icon">📐</div>
          <h2>Drop your SVG dieline here</h2>
          <p>or click <strong>Upload SVG</strong> above</p>
          <div className="empty-state-legend">
            <div className="legend-row cut">   <span className="legend-line" /> Cut / Outer contour</div>
            <div className="legend-row crease"><span className="legend-line" /> Crease / Fold lines</div>
            <div className="legend-row score"> <span className="legend-line" /> Score / Detail lines</div>
          </div>
        </div>
      )}

      {/* ── Main content area ── */}
      <div className={`content-area ${viewMode === 'split' && show2DPanel ? 'layout-split' : 'layout-single'}`}>

        {/* 2D preview panel */}
        {show2DPanel && (
          <div className="panel panel-2d">
            <DielinePreview
              rawPaths={rawPaths}
              svgText={svgText}
            />
          </div>
        )}

        {/* 3D canvas panel */}
        {(viewMode === '3d' || viewMode === 'split') && (
          <div className="panel panel-3d">
            {has3D ? (
              <Canvas
                camera={{ position: [0, 5, 10], fov: 45 }}
                onDoubleClick={toggleFold}
              >
                <AppCanvas tree={tree!} />
              </Canvas>
            ) : (
              <div className="panel-placeholder">
                <span>3D model will appear here after upload</span>
              </div>
            )}
            {has3D && (
              <div className="panel-label">
                3D Model · Double-click to {isOpen ? 'fold' : 'unfold'}
              </div>
            )}
          </div>
        )}

        {/* 2D-only mode */}
        {viewMode === '2d' && has2D && (
          <div className="panel panel-2d panel-full">
            <DielinePreview rawPaths={rawPaths} svgText={svgText} />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
