import CheckIcon from "@mui/icons-material/Check";
import CropIcon from "@mui/icons-material/Crop";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import {
  IconButton,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
} from "@mui/material";
import { blue, teal } from "@mui/material/colors";
import * as fabric from "fabric";
import paper from "paper";
import React, { useEffect, useRef } from "react";

import { intersectCompoundPath } from "@/app/bezier";
import {
  fabricToCompoundPath,
  paperToFabricPath,
  toFabricPaths,
} from "@/app/fabricUtils";
import { createPathControls } from "@/app/pathControl";
import { PathData } from "@/app/types";

export enum GlyphViewState {
  NORMAL,
  SELECTING,
}

export function GlyphView({
  width,
  height,
  path,
  onPathChanged,
  bgPaths,
  interactive,
  onResetToSyllable,
  ...props
}: {
  width: number;
  height: number;
  interactive: boolean;
  path: PathData | null;
  onPathChanged?: (newPath: PathData | null) => void;
  bgPaths?: PathData[];
  onResetToSyllable?: (target: HTMLElement) => void;
} & React.ComponentProps<"div">) {
  bgPaths = bgPaths || [];
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const pathRef = useRef(path);

  const [mode, setMode] = React.useState<GlyphViewState>(GlyphViewState.NORMAL);

  useEffect(() => {
    if (canvasRef.current === null) {
      return () => {};
    }

    pathRef.current = structuredClone(path);

    // Initialize the Fabric canvas
    const canvas = new fabric.Canvas(canvasRef.current, {
      width: width,
      height: height,
      backgroundColor: "white",
    });
    fabricRef.current = canvas;

    // Add gridlines
    const horzGrid = [
      { x: 0, y: 0 },
      { x: width, y: 0 },
    ];
    const vertGrid = [
      { x: 0, y: 0 },
      { x: 0, y: height },
    ];

    // Minor gridlines
    const N_MINOR = 10;
    for (let i = 1; i < N_MINOR; ++i) {
      canvas.add(
        new fabric.Polyline(horzGrid, {
          left: width / 2,
          top: (i * height) / N_MINOR,
          stroke: "lightgrey",
          selectable: false,
          evented: false,
        }),
      );
      canvas.add(
        new fabric.Polyline(vertGrid, {
          left: (i * width) / N_MINOR,
          top: height / 2,
          stroke: "lightgrey",
          selectable: false,
          evented: false,
        }),
      );
    }

    // Center gridline
    for (const grid of [horzGrid, vertGrid]) {
      canvas.add(
        new fabric.Polyline(grid, {
          left: width / 2,
          top: height / 2,
          stroke: "red",
          selectable: false,
          evented: false,
        }),
      );
    }

    for (const path of bgPaths) {
      canvas.add(
        ...toFabricPaths(path, width, height, {
          selectable: false,
          evented: false,
          strokeWidth: 2,
          stroke: teal[800],
          fill: "transparent",
          opacity: 0.3,
        }),
      );
    }

    const pathSelectable =
      mode === GlyphViewState.SELECTING ? false : interactive;
    const fabricPaths =
      path !== null
        ? toFabricPaths(path, width, height, {
            selectable: pathSelectable,
            evented: pathSelectable,
            fill: mode === GlyphViewState.SELECTING ? "grey" : "black",
          })
        : [];

    if (path !== null) {
      if (interactive) {
        canvas.add(
          ...toFabricPaths(path, width, height, {
            selectable: false,
            evented: false,
            fill: blue[500],
            opacity: 0.3,
          }),
        );
      }

      for (const fabricPath of fabricPaths) {
        let editing = false;
        fabricPath.on("mousedblclick", () => {
          editing = !editing;
          if (editing) {
            fabricPath.controls = createPathControls(fabricPath, {
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
            });
            fabricPath.hasBorders = false;
          } else {
            fabricPath.controls =
              fabric.controlsUtils.createObjectDefaultControls();
            fabricPath.hasBorders = true;
          }
          fabricPath.setCoords();
          canvas.requestRenderAll();
        });
      }

      canvas.add(...fabricPaths);
    }

    let isDragging = false;
    let lastPosX: number | null = null;
    let lastPosY: number | null = null;
    let isCropping = false;
    let startPosX: number | null = null;
    let startPosY: number | null = null;
    function constrainViewport(vpt: fabric.TMat2D) {
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
        constrainViewport(canvas.viewportTransform);
        // Keep stroke width appear constant regardless of zoom
        canvas.forEachObject(function (obj_) {
          // typescript hack
          const obj = obj_ as typeof obj_ & {
            originalStrokeWidth: number | undefined;
          };
          if (obj.originalStrokeWidth === undefined) {
            obj.originalStrokeWidth = obj_.strokeWidth;
          }
          obj.set("strokeWidth", obj.originalStrokeWidth / zoom);
        });
      }
    });
    canvas.on("mouse:down", function (opt) {
      const evt = opt.e as MouseEvent;
      if (evt.ctrlKey) {
        isDragging = true;
        canvas.selection = false;
        lastPosX = evt.clientX;
        lastPosY = evt.clientY;
        const obj = canvas.getActiveObject();
        if (obj) {
          obj.lockMovementX = true;
          obj.lockMovementY = true;
        }
      } else if (mode == GlyphViewState.SELECTING) {
        isCropping = true;
        startPosX = opt.scenePoint.x * (1000 / width);
        startPosY = opt.scenePoint.y * (1000 / height);
      }
    });
    canvas.on("mouse:move", function (opt) {
      if (isDragging) {
        if (lastPosX !== null && lastPosY !== null) {
          const e = opt.e as MouseEvent;
          const vpt = canvas.viewportTransform;
          vpt[4] += e.clientX - lastPosX;
          vpt[5] += e.clientY - lastPosY;
          constrainViewport(vpt);
          canvas.setViewportTransform(vpt);
          canvas.requestRenderAll();
          lastPosX = e.clientX;
          lastPosY = e.clientY;
        }
      } else if (isCropping) {
        if (
          path !== null &&
          pathRef.current !== null &&
          startPosX !== null &&
          startPosY !== null
        ) {
          const curX = opt.scenePoint.x * (1000 / width);
          const curY = opt.scenePoint.y * (1000 / height);
          for (let i = 0; i < path.paths.length; ++i) {
            const fabricPath = fabricPaths[i];
            const comp = path.paths[i];
            const newPath = paperToFabricPath(
              intersectCompoundPath(fabricToCompoundPath(comp), [
                {
                  left: Math.min(startPosX, curX),
                  top: Math.min(startPosY, curY),
                  right: Math.max(startPosX, curX),
                  bottom: Math.max(startPosY, curY),
                },
              ]),
            );
            pathRef.current.paths[i] = newPath;
            fabricPath.set("path", newPath);
            fabricPath.setCoords();
          }
          canvas.requestRenderAll();
        }
      }
    });
    canvas.on("mouse:up", function () {
      // on mouse up we want to recalculate new interaction
      // for all objects, so we call setViewportTransform
      if (isDragging) {
        canvas.setViewportTransform(canvas.viewportTransform);
        isDragging = false;
        canvas.selection = true;
        for (const obj of canvas.getObjects()) {
          obj.lockMovementX = false;
          obj.lockMovementY = false;
        }
      } else if (isCropping) {
        isCropping = false;
      }
    });

    // Clean up on unmount to prevent memory leaks
    return () => {
      if (fabricRef.current) {
        fabricRef.current.dispose();
      }
    };
  }, [width, height, mode, path, bgPaths, interactive]);

  return (
    <div {...props}>
      {interactive && (
        <div className="flex bg-stone-200">
          <IconButton
            onClick={(event) => {
              if (onResetToSyllable) {
                onResetToSyllable(event.currentTarget);
              }
            }}
          >
            <Tooltip title="Reset to Full Syllable">
              <RestartAltIcon />
            </Tooltip>
          </IconButton>
          <ToggleButtonGroup
            value={mode === GlyphViewState.SELECTING ? "select" : null}
            exclusive
            onChange={(event, newValue) => {
              setMode(
                newValue === "select"
                  ? GlyphViewState.SELECTING
                  : GlyphViewState.NORMAL,
              );
            }}
          >
            <ToggleButton value={"select"}>
              <Tooltip title="Select Elements">
                <CropIcon />
              </Tooltip>
            </ToggleButton>
          </ToggleButtonGroup>
          {mode == GlyphViewState.SELECTING && (
            <IconButton
              onClick={() => {
                setMode(GlyphViewState.NORMAL);
                if (onPathChanged) {
                  onPathChanged(pathRef.current);
                }
              }}
            >
              <Tooltip title="Done">
                <CheckIcon />
              </Tooltip>
            </IconButton>
          )}
        </div>
      )}
      <canvas ref={canvasRef} />
    </div>
  );
}
