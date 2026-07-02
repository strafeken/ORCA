import { useEffect, useRef, useState, useCallback } from "react";
import { Stage, Layer, Image as KonvaImage, Line } from "react-konva";
import { apiFetch } from "../auth/api";

const COLORS = ["#ef4444", "#22c55e", "#3b82f6", "#f59e0b", "#ffffff"];
const MAX_STAGE_WIDTH = 720;

/**
 * AnnotationCanvas — Single Responsibility split from ConsultThread: this
 * component only knows how to draw on ONE image and persist a new overlay
 * version. ConsultThread just decides *when* to show it (which file is
 * selected) and re-fetches the annotation list afterwards.
 *
 * Immutability model (mirrors backend/routes/annotations.js): the base
 * image plus every PAST version is rendered read-only, underneath the
 * strokes the current user is drawing right now. Saving never edits an
 * existing version — it always POSTs a brand new one built from the
 * current user's new strokes layered on top of everything that came before,
 * which the server appends as version = max(version)+1 (SR-08).
 */
export default function AnnotationCanvas({ fileId, downloadUrl, existingVersions, onSaved, onClose }) {
  const [image, setImage] = useState(null);
  const [scale, setScale] = useState(1);
  const [newLines, setNewLines] = useState([]);
  const [color, setColor] = useState(COLORS[0]);
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const isDrawingRef = useRef(false);
  const objectUrlRef = useRef(null);

  // Load the image via the authenticated download endpoint (it isn't a
  // plain <img src="..."> because /api file downloads require the Bearer
  // token apiFetch attaches — a raw <img> tag can't send that header).
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await apiFetch(downloadUrl);
        if (!res.ok) throw new Error("Could not load image.");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;

        const img = new window.Image();
        img.onload = () => {
          if (cancelled) return;
          setImage(img);
          setScale(Math.min(1, MAX_STAGE_WIDTH / img.naturalWidth));
        };
        img.onerror = () => !cancelled && setError("Could not decode image.");
        img.src = url;
      } catch {
        if (!cancelled) setError("Could not load image.");
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, [downloadUrl]);

  // Flatten every past version's lines into one read-only array, in order,
  // so earlier authors' strokes are always visible underneath new ones.
  const historyLines = (existingVersions || []).flatMap(
    (v) => v.overlay_data?.lines || []
  );

  const stageWidth = image ? Math.round(image.naturalWidth * scale) : MAX_STAGE_WIDTH;
  const stageHeight = image ? Math.round(image.naturalHeight * scale) : 480;

  function toStagePoint(stage) {
    const pos = stage.getPointerPosition();
    return { x: pos.x / scale, y: pos.y / scale };
  }

  const handlePointerDown = useCallback((e) => {
    isDrawingRef.current = true;
    const { x, y } = toStagePoint(e.target.getStage());
    setNewLines((prev) => [...prev, { color, strokeWidth, points: [x, y] }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [color, strokeWidth, scale]);

  const handlePointerMove = useCallback((e) => {
    if (!isDrawingRef.current) return;
    const { x, y } = toStagePoint(e.target.getStage());
    setNewLines((prev) => {
      const next = prev.slice();
      const last = next[next.length - 1];
      next[next.length - 1] = { ...last, points: [...last.points, x, y] };
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale]);

  const handlePointerUp = useCallback(() => {
    isDrawingRef.current = false;
  }, []);

  function undoLastStroke() {
    setNewLines((prev) => prev.slice(0, -1));
  }

  function clearNewStrokes() {
    setNewLines([]);
  }

  async function save() {
    if (newLines.length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/files/${fileId}/annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overlayData: { lines: newLines } }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Could not save annotation.");
      }
      const data = await res.json();
      onSaved(data.annotation);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={s.overlay}>
      <div style={s.panel}>
        <div style={s.toolbar}>
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              style={{ ...s.swatch, background: c, outline: color === c ? "2px solid var(--orca-hi)" : "none" }}
              aria-label={`Colour ${c}`}
            />
          ))}
          <input
            type="range"
            min={2}
            max={12}
            value={strokeWidth}
            onChange={(e) => setStrokeWidth(Number(e.target.value))}
            style={s.slider}
          />
          <button style={s.toolBtn} onClick={undoLastStroke} disabled={newLines.length === 0}>Undo</button>
          <button style={s.toolBtn} onClick={clearNewStrokes} disabled={newLines.length === 0}>Clear</button>
          <div style={{ flex: 1 }} />
          <button style={s.toolBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button style={s.saveBtn} onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save annotation"}
          </button>
        </div>

        {error && <div style={s.error}>{error}</div>}

        <div style={s.canvasWrap}>
          {!image ? (
            <p style={s.loading}>Loading image…</p>
          ) : (
            <Stage
              width={stageWidth}
              height={stageHeight}
              onMouseDown={handlePointerDown}
              onMouseMove={handlePointerMove}
              onMouseUp={handlePointerUp}
              onTouchStart={handlePointerDown}
              onTouchMove={handlePointerMove}
              onTouchEnd={handlePointerUp}
              style={{ background: "#000", borderRadius: 8 }}
            >
              <Layer scaleX={scale} scaleY={scale} listening={false}>
                <KonvaImage image={image} />
                {historyLines.map((line, i) => (
                  <Line
                    key={`history-${i}`}
                    points={line.points}
                    stroke={line.color}
                    strokeWidth={line.strokeWidth}
                    lineCap="round"
                    lineJoin="round"
                    opacity={0.85}
                  />
                ))}
              </Layer>
              <Layer scaleX={scale} scaleY={scale}>
                {newLines.map((line, i) => (
                  <Line
                    key={`new-${i}`}
                    points={line.points}
                    stroke={line.color}
                    strokeWidth={line.strokeWidth}
                    lineCap="round"
                    lineJoin="round"
                  />
                ))}
              </Layer>
            </Stage>
          )}
        </div>
      </div>
    </div>
  );
}

const s = {
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 },
  panel: { background: "var(--orca-abyss)", border: "1px solid var(--orca-line)", borderRadius: 12, padding: 16, maxWidth: "94vw" },
  toolbar: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 },
  swatch: { width: 22, height: 22, borderRadius: "50%", border: "1px solid var(--orca-line)", cursor: "pointer" },
  slider: { width: 90 },
  toolBtn: { padding: "6px 10px", borderRadius: 8, border: "1px solid var(--orca-line)", background: "var(--orca-slate)", color: "var(--orca-ink)", fontSize: 12, cursor: "pointer" },
  saveBtn: { padding: "6px 14px", borderRadius: 8, border: "none", background: "var(--orca-hi)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  error: { padding: "8px 10px", borderRadius: 8, background: "#450a0a", color: "#fca5a5", fontSize: 12, marginBottom: 8 },
  canvasWrap: { display: "flex", alignItems: "center", justifyContent: "center", minHeight: 200 },
  loading: { color: "var(--orca-muted)", fontSize: 13 },
};