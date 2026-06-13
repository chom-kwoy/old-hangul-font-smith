import * as fabric from "fabric";
import { RefObject, useEffect, useRef, useState } from "react";

import { adjustStrokes } from "@/app/components/glyphCanvas/fabricGeometry";

// A fabric canvas that ignores object interaction while the user is ctrl-panning.
//
// Fabric caches the mousedown target in `_cacheTransformEventData` *before* it
// fires `mouse:down:before`, so a flag toggled from an event handler is always
// too late to influence target finding. Both hooks below therefore read ctrl
// straight from the event:
//   - findTarget: force fabric's own skip-target-find path so the press can't
//     transfer the selection to (or start a transform on) an object under the
//     cursor.
//   - _shouldClearSelection: veto the deselect-on-empty-canvas so the active
//     object — and any in-progress point editing — survives the pan.
// (The rubber-band box is suppressed separately by clearing `canvas.selection`
// in the mouse:down:before handler, which runs early enough for that check.)
class GlyphCanvas extends fabric.Canvas {
  override findTarget(e: fabric.TPointerEvent) {
    if (!this._targetInfo && (e as MouseEvent)?.ctrlKey) {
      const prev = this.skipTargetFind;
      this.skipTargetFind = true;
      try {
        return super.findTarget(e);
      } finally {
        this.skipTargetFind = prev;
      }
    }
    return super.findTarget(e);
  }

  override _shouldClearSelection(
    e: fabric.TPointerEvent,
    target?: fabric.FabricObject,
  ): target is undefined {
    if ((e as MouseEvent)?.ctrlKey) return false;
    return super._shouldClearSelection(e, target);
  }
}

// Owns the fabric.Canvas lifecycle: creation, the em-square grid, and ctrl-based
// pan/zoom (with the viewport persisted across recreations). Returns the canvas
// both as state (so event-wiring/content effects can depend on its identity) and
// as a ref (live canvas, nulled on dispose — used for "is this still the live
// canvas?" guards). `onCanvasCreated` runs synchronously right after a new
// canvas exists, before the content effects below it rebuild — the place to
// reset content refs so they repopulate onto the fresh canvas.
export function useFabricCanvas(
  canvasElemRef: RefObject<HTMLCanvasElement | null>,
  width: number,
  height: number,
  interactive: boolean,
  onCanvasCreated?: (canvas: fabric.Canvas) => void,
): {
  canvas: fabric.Canvas | null;
  canvasRef: RefObject<fabric.Canvas | null>;
} {
  const canvasRef = useRef<fabric.Canvas | null>(null);
  const viewportRef = useRef<fabric.TMat2D | null>(null);
  const [canvas, setCanvas] = useState<fabric.Canvas | null>(null);

  useEffect(() => {
    if (!canvasElemRef.current) return;

    const canvas = new GlyphCanvas(canvasElemRef.current, {
      width,
      height,
      backgroundColor: "white",
      selectionFullyContained: true,
    });

    const minZoom = Math.min(width, height) / 1000;
    const tx = width / 2 - 500 * minZoom;
    const ty = height / 2 - 500 * minZoom;
    const initialVpt: fabric.TMat2D = [minZoom, 0, 0, minZoom, tx, ty];

    canvas.selection = interactive;

    // Gridlines
    const horzGrid: fabric.XY[] = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
    ];
    const vertGrid: fabric.XY[] = [
      { x: 0, y: 0 },
      { x: 0, y: 1000 },
    ];
    const N_MINOR = 10;
    for (let i = 1; i < N_MINOR; ++i) {
      canvas.add(
        new fabric.Polyline(horzGrid, {
          left: 1000 / 2,
          top: (i * 1000) / N_MINOR,
          stroke: "lightgrey",
          strokeWidth: 1,
          selectable: false,
          evented: false,
        }),
      );
      canvas.add(
        new fabric.Polyline(vertGrid, {
          left: (i * 1000) / N_MINOR,
          top: 1000 / 2,
          stroke: "lightgrey",
          strokeWidth: 1,
          selectable: false,
          evented: false,
        }),
      );
    }
    for (const grid of [horzGrid, vertGrid]) {
      canvas.add(
        new fabric.Polyline(grid, {
          left: 1000 / 2,
          top: 1000 / 2,
          stroke: "red",
          strokeWidth: 1,
          selectable: false,
          evented: false,
        }),
      );
    }

    // Pan and zoom
    let isDragging = false;
    let lastPosX: number | null = null;
    let lastPosY: number | null = null;

    function constrainViewport(c: fabric.Canvas) {
      const vpt = c.viewportTransform;
      vpt[4] = Math.min(vpt[4], 0);
      vpt[4] = Math.max(vpt[4], width - 1000 * (vpt[0] + vpt[2]));
      vpt[5] = Math.min(vpt[5], 0);
      vpt[5] = Math.max(vpt[5], height - 1000 * (vpt[1] + vpt[3]));
      c.setViewportTransform(c.viewportTransform);
    }

    canvas.on("mouse:wheel", function (opt) {
      if (opt.e.ctrlKey) {
        const delta = opt.e.deltaY;
        let zoom = canvas.getZoom();
        zoom *= 0.997 ** delta;
        zoom = Math.min(Math.max(zoom, minZoom), 20 * minZoom);
        canvas.zoomToPoint(new fabric.Point(opt.e.offsetX, opt.e.offsetY), zoom);
        constrainViewport(canvas);
        canvas.setViewportTransform(canvas.viewportTransform);
        viewportRef.current = canvas.viewportTransform;
        adjustStrokes(canvas);
        canvas.requestRenderAll();
        opt.e.preventDefault();
        opt.e.stopPropagation();
      }
    });
    canvas.on("mouse:down:before", function (opt) {
      if ((opt.e as MouseEvent).ctrlKey) {
        // The subclass already keeps fabric from changing the selection on this
        // press; here we just ensure drawing mode is off and stop the rubber-band
        // selection box from starting (selection is restored on mouse:up).
        canvas.isDrawingMode = false;
        canvas.selection = false;
      }
    });
    canvas.on("mouse:down", function (opt) {
      const evt = opt.e as MouseEvent;
      if (evt.ctrlKey) {
        isDragging = true;
        lastPosX = evt.clientX;
        lastPosY = evt.clientY;
      }
    });
    canvas.on("mouse:move", function (opt) {
      if (isDragging && lastPosX !== null && lastPosY !== null) {
        const e = opt.e as MouseEvent;
        const vpt = canvas.viewportTransform;
        vpt[4] += e.clientX - lastPosX;
        vpt[5] += e.clientY - lastPosY;
        constrainViewport(canvas);
        viewportRef.current = vpt;
        canvas.requestRenderAll();
        lastPosX = e.clientX;
        lastPosY = e.clientY;
      }
    });
    canvas.on("mouse:up", function () {
      if (isDragging) {
        canvas.setViewportTransform(canvas.viewportTransform);
        isDragging = false;
        // Re-enable the rubber-band selection box now that the pan is over.
        canvas.selection = interactive;
      }
    });

    canvas.viewportTransform = viewportRef.current ?? initialVpt;
    adjustStrokes(canvas);

    // Let the owner reset content refs before the content effects rebuild.
    onCanvasCreated?.(canvas);

    canvasRef.current = canvas;
    setCanvas(canvas);

    return () => {
      canvas.dispose();
      canvasRef.current = null;
      setCanvas(null);
    };
  }, [canvasElemRef, width, height, interactive, onCanvasCreated]);

  return { canvas, canvasRef };
}
