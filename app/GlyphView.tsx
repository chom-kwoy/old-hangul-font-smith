import * as fabric from "fabric";
import { TComplexPathData } from "fabric";
import React, { useEffect, useRef } from "react";

import { toFabricPath } from "@/app/fabricUtils";

export function GlyphView({
  width,
  height,
  path,
  bgPaths,
  interactive,
  ...props
}: {
  width: number;
  height: number;
  interactive: boolean;
  path: TComplexPathData | null;
  bgPaths: TComplexPathData[];
} & React.ComponentProps<"canvas">) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);

  useEffect(() => {
    if (canvasRef.current === null) {
      return () => {};
    }

    // Initialize the Fabric canvas
    fabricRef.current = new fabric.Canvas(canvasRef.current, {
      width: width,
      height: height,
      backgroundColor: "white",
    });

    // Add gridlines
    fabricRef.current.add(
      new fabric.Polyline(
        [
          { x: 0, y: 0 },
          { x: 0, y: height },
        ],
        {
          stroke: "red",
          left: width / 2,
          top: height / 2,
          selectable: false,
          evented: false,
        },
      ),
    );
    fabricRef.current.add(
      new fabric.Polyline(
        [
          { x: 0, y: 0 },
          { x: width, y: 0 },
        ],
        {
          stroke: "red",
          left: width / 2,
          top: height / 2,
          selectable: false,
          evented: false,
        },
      ),
    );

    for (const path of bgPaths) {
      fabricRef.current.add(
        toFabricPath(path, width, height, {
          selectable: false,
          evented: false,
          strokeWidth: 2,
          stroke: "grey",
          fill: "transparent",
          opacity: 0.7,
        }),
      );
    }

    if (path !== null) {
      if (interactive) {
        fabricRef.current.add(
          toFabricPath(path, width, height, {
            selectable: false,
            evented: false,
            fill: "blue",
            opacity: 0.1,
          }),
        );
      }

      fabricRef.current.add(
        toFabricPath(path, width, height, {
          selectable: interactive,
          evented: interactive,
        }),
      );
    }

    // Clean up on unmount to prevent memory leaks
    return () => {
      if (fabricRef.current) {
        fabricRef.current.dispose();
      }
    };
  });

  return <canvas ref={canvasRef} {...props} />;
}
