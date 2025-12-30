import * as fabric from "fabric";
import { TComplexPathData } from "fabric";
import React, { useEffect, useRef } from "react";

import { pathBounds, toBezier } from "@/app/bezier";

export function ReactFabricCanvas({
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
  }, [width, height, path, bgPaths, interactive]);

  return <canvas ref={canvasRef} {...props} />;
}

function toFabricPath(
  path: TComplexPathData,
  width: number,
  height: number,
  options: Partial<fabric.PathProps> = {},
): fabric.Path {
  const bbox = pathBounds(toBezier(path));
  const bbox_width = bbox.right - bbox.left;
  const bbox_height = bbox.bottom - bbox.top;
  return new fabric.Path(path, {
    ...options,
    left: (bbox.left + bbox_width / 2) * (width / 1000),
    top: (bbox.top + bbox_height / 2) * (height / 1000),
    scaleX: width / 1000,
    scaleY: height / 1000,
  });
}
