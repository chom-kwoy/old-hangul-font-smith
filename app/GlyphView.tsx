import { blue } from "@mui/material/colors";
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
    const canvas = new fabric.Canvas(canvasRef.current, {
      width: width,
      height: height,
      backgroundColor: "white",
    });
    fabricRef.current = canvas;

    let isDragging = false;
    let lastPosX: number | null = null;
    let lastPosY: number | null = null;
    function constrainViewport() {
      const vpt = canvas.viewportTransform;
      vpt[4] = Math.min(vpt[4], 0);
      vpt[4] = Math.max(vpt[4], width * (1 - vpt[0] - vpt[2]));
      vpt[5] = Math.min(vpt[5], 0);
      vpt[5] = Math.max(vpt[5], height * (1 - vpt[1] - vpt[3]));
    }
    canvas.on("mouse:wheel", function (opt) {
      if (opt.e.ctrlKey) {
        const delta = opt.e.deltaY;
        let zoom = canvas.getZoom();
        zoom *= 0.997 ** delta;
        if (zoom > 20) zoom = 20;
        if (zoom < 1) zoom = 1;
        canvas.zoomToPoint(
          new fabric.Point(opt.e.offsetX, opt.e.offsetY),
          zoom,
        );
        opt.e.preventDefault();
        opt.e.stopPropagation();
        // constrain to glyph area
        constrainViewport();
      }
    });
    canvas.on("mouse:down", function (opt) {
      const evt = opt.e as MouseEvent;
      if (evt.ctrlKey) {
        isDragging = true;
        canvas.selection = false;
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
        constrainViewport();
        canvas.requestRenderAll();
        lastPosX = e.clientX;
        lastPosY = e.clientY;
      }
    });
    canvas.on("mouse:up", function () {
      // on mouse up we want to recalculate new interaction
      // for all objects, so we call setViewportTransform
      canvas.setViewportTransform(canvas.viewportTransform);
      isDragging = false;
      canvas.selection = true;
    });

    // Add gridlines
    canvas.add(
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
    canvas.add(
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
      canvas.add(
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
        canvas.add(
          toFabricPath(path, width, height, {
            selectable: false,
            evented: false,
            fill: "blue",
            opacity: 0.1,
          }),
        );
      }

      const fabricPath = toFabricPath(path, width, height, {
        selectable: interactive,
        evented: interactive,
      });

      let editing = false;
      fabricPath.on("mousedblclick", () => {
        editing = !editing;
        if (editing) {
          fabricPath.controls = fabric.controlsUtils.createPathControls(
            fabricPath,
            {
              sizeX: 8,
              sizeY: 8,
              pointStyle: {
                controlFill: blue[300],
                controlStroke: "white",
              },
              controlPointStyle: {
                controlFill: "white",
                controlStroke: blue[100],
                connectionDashArray: [3],
              },
            },
          );
          fabricPath.hasBorders = false;
        } else {
          fabricPath.controls =
            fabric.controlsUtils.createObjectDefaultControls();
          fabricPath.hasBorders = true;
        }
        fabricPath.setCoords();
        canvas.requestRenderAll();
      });

      canvas.add(fabricPath);
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
