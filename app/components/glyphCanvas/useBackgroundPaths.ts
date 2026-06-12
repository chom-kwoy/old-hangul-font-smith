import { teal } from "@mui/material/colors";
import * as fabric from "fabric";
import { RefObject, useEffect, useRef } from "react";

import { adjustStrokes } from "@/app/components/glyphCanvas/fabricGeometry";
import PathData from "@/app/pathUtils/PathData";

// Renders the faint reference glyphs behind the editable path. Owns its own
// fabric objects; re-runs (and self-clears) whenever bgPaths or the canvas
// dimensions change — the latter also recreates the canvas, so the stale
// objects from the old canvas are simply dropped.
export function useBackgroundPaths(
  canvasRef: RefObject<fabric.Canvas | null>,
  bgPaths: PathData[],
  width: number,
  height: number,
  interactive: boolean,
  enableRescaling: boolean,
) {
  const bgPathObjectsRef = useRef<fabric.Path[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    for (const obj of bgPathObjectsRef.current) {
      canvas.remove(obj);
    }
    bgPathObjectsRef.current = [];

    for (const p of bgPaths) {
      bgPathObjectsRef.current.push(
        ...p.makeFabricPaths({
          selectable: false,
          evented: false,
          strokeWidth: 2,
          stroke: teal[800],
          fill: "transparent",
          opacity: 0.3,
        }),
      );
    }
    canvas.add(...bgPathObjectsRef.current);
    for (const obj of bgPathObjectsRef.current) {
      canvas.sendObjectToBack(obj);
    }
    adjustStrokes(canvas);
    // width/height: not used directly — they re-fire this effect in the same
    // render useFabricCanvas recreates the canvas (it keys on the same deps), so
    // the backgrounds rebuild onto the fresh canvas synchronously via canvasRef.
    // Depending on the `canvas` state instead would lag a render and lose content
    // during the ResizeObserver's initial size churn.
  }, [canvasRef, bgPaths, width, height, interactive, enableRescaling]);
}
