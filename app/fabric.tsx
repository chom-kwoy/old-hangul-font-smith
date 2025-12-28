import * as fabric from "fabric";
import { TComplexPathData } from "fabric";
import React, { useEffect, useRef } from "react";

import { pathBounds, toBezier } from "@/app/bezier";

export function ReactFabricCanvas({
  width,
  height,
  path,
  interactive,
  ...props
}: {
  width: number;
  height: number;
  interactive: boolean;
  path: TComplexPathData | null;
} & React.ComponentProps<"canvas">) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);

  useEffect(() => {
    if (canvasRef.current === null) {
      return () => {};
    }

    fabric.InteractiveFabricObject.ownDefaults = {
      ...fabric.InteractiveFabricObject.ownDefaults,
      cornerStrokeColor: "white",
      cornerColor: "lightblue",
      cornerStyle: "circle",
      cornerSize: 12,
      padding: 0,
      transparentCorners: false,
      borderColor: "grey",
      borderScaleFactor: 1.2,
    };

    // 1. Initialize the Fabric canvas
    fabricRef.current = new fabric.Canvas(canvasRef.current, {
      width: width,
      height: height,
      backgroundColor: "white",
    });

    // 2. Add an initial object
    if (path !== null) {
      const bbox = pathBounds(toBezier(path));
      const bbox_width = bbox.right - bbox.left;
      const bbox_height = bbox.bottom - bbox.top;
      const pathObj = new fabric.Path(path, {
        left: (bbox.left + bbox_width / 2) * (width / 1000),
        top: (bbox.top + bbox_height / 2) * (height / 1000),
        scaleX: width / 1000,
        scaleY: height / 1000,
        selectable: interactive,
      });
      fabricRef.current.add(pathObj);
    }

    // 3. Clean up on unmount to prevent memory leaks
    return () => {
      if (fabricRef.current) {
        fabricRef.current.dispose();
      }
    };
  }, [width, height, path, interactive]);

  return <canvas ref={canvasRef} {...props} />;
}
