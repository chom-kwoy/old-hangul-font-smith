import CheckIcon from "@mui/icons-material/Check";
import ContentCutIcon from "@mui/icons-material/ContentCut";
import DownloadIcon from "@mui/icons-material/Download";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import {
  IconButton,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
} from "@mui/material";
import { amber, blue, teal } from "@mui/material/colors";
import * as fabric from "fabric";
import React, { useEffect, useRef } from "react";

import { pathDataToSVG } from "@/app/utils/bezier";
import { downloadStringAsFile } from "@/app/utils/download";
import {
  fabricToCompoundPath,
  paperToFabricPath,
  toFabricPaths,
} from "@/app/utils/fabricUtils";
import { createPathControls } from "@/app/utils/pathControl";
import { PathData } from "@/app/utils/types";

export enum GlyphViewState {
  NORMAL,
  CUTTING,
}

export function GlyphView({
  width,
  height,
  path,
  onPathChanged,
  bgPaths,
  interactive,
  onResetToSyllable,
  glyphName,
  ...props
}: {
  width: number;
  height: number;
  interactive: boolean;
  path: PathData | null;
  onPathChanged?: (newPath: PathData | null) => void;
  bgPaths?: PathData[];
  onResetToSyllable?: (target: HTMLElement) => void;
  glyphName?: string;
} & React.ComponentProps<"div">) {
  bgPaths = bgPaths || [];
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const vptRef = useRef<fabric.TMat2D | null>(null);
  const pathRef = useRef(path);

  const [mode, setMode] = React.useState<GlyphViewState>(GlyphViewState.NORMAL);

  // handle what happens on key press
  const handleKeyPress = React.useCallback(
    (event: KeyboardEvent) => {
      console.log(event.key);
      if (event.key === "Delete" || event.key === "Backspace") {
        if (fabricRef.current) {
          const canvas = fabricRef.current;
          const activeObjects = canvas.getActiveObjects();
          if (activeObjects.length > 0) {
            canvas.discardActiveObject();
            for (const obj of activeObjects) {
              canvas.remove(obj);
            }
            canvas.requestRenderAll();
            // update pathRef
            if (pathRef.current !== null) {
              const newPaths: fabric.Path[] = [];
              for (const obj of canvas.getObjects()) {
                if (obj instanceof fabric.Path && obj.selectable) {
                  newPaths.push(obj);
                }
              }
              const newPathData: PathData = {
                paths: newPaths.map((p) => p.path),
              };
              pathRef.current = newPathData;
              if (onPathChanged) {
                onPathChanged(newPathData);
              }
            }
          }
        }
      }
    },
    [onPathChanged],
  );

  React.useEffect(() => {
    document.addEventListener("keydown", handleKeyPress);
    return () => {
      document.removeEventListener("keydown", handleKeyPress);
    };
  }, [handleKeyPress]);

  useEffect(() => {
    if (canvasRef.current === null) return;

    pathRef.current = structuredClone(path);

    // Initialize the Fabric canvas
    const canvas = new fabric.Canvas(canvasRef.current, {
      width: width,
      height: height,
      backgroundColor: "white",
    });
    fabricRef.current = canvas;

    canvas.selection = interactive && mode !== GlyphViewState.CUTTING;
    canvas.isDrawingMode = mode === GlyphViewState.CUTTING;
    canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
    canvas.freeDrawingBrush.width = 2;

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

    const pathSelectable = interactive && mode !== GlyphViewState.CUTTING;
    const fabricPaths =
      path !== null
        ? toFabricPaths(path, width, height, {
            selectable: pathSelectable,
            evented: pathSelectable,
            fill: mode === GlyphViewState.CUTTING ? "grey" : "black",
            stroke: amber[800],
            strokeWidth: 8,
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
    function constrainViewport(vpt: fabric.TMat2D) {
      vpt[4] = Math.min(vpt[4], 0);
      vpt[4] = Math.max(vpt[4], width * (1 - vpt[0] - vpt[2]));
      vpt[5] = Math.min(vpt[5], 0);
      vpt[5] = Math.max(vpt[5], height * (1 - vpt[1] - vpt[3]));
    }
    function adjustStrokes(zoom: number) {
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
      canvas.freeDrawingBrush.width = 2.0 / zoom;
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
        vptRef.current = canvas.viewportTransform;
        // Keep stroke width appear constant regardless of zoom
        adjustStrokes(zoom);
        canvas.requestRenderAll();
      }
    });
    canvas.on("mouse:down:before", function (opt) {
      const evt = opt.e as MouseEvent;
      if (evt.ctrlKey) {
        canvas.isDrawingMode = false;
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
          vptRef.current = vpt;
          canvas.requestRenderAll();
          lastPosX = e.clientX;
          lastPosY = e.clientY;
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
        canvas.isDrawingMode = mode === GlyphViewState.CUTTING;
        for (const obj of canvas.getObjects()) {
          obj.lockMovementX = false;
          obj.lockMovementY = false;
        }
      }
    });
    const cuttingPaths: paper.CompoundPath[] = [];
    canvas.on("path:created", function (event) {
      if (
        mode === GlyphViewState.CUTTING &&
        path !== null &&
        pathRef.current !== null
      ) {
        const addedPath = fabricToCompoundPath(
          (event.path as fabric.Path).path,
          { scaleX: 1000 / width, scaleY: 1000 / height, dontClose: true },
        );
        cuttingPaths.push(addedPath);
        console.log(cuttingPaths);
        for (let i = 0; i < path.paths.length; ++i) {
          const fabricPath = fabricPaths[i];
          let newPath = fabricToCompoundPath(path.paths[i]);
          for (const cut of cuttingPaths) {
            newPath = newPath.divide(cut, {
              trace: false,
            }) as paper.CompoundPath;
            newPath.closePath();
          }
          fabricPath.set("path", paperToFabricPath(newPath));
          fabricPath.setCoords();
          // Update the pathRef
          pathRef.current.paths[i] = fabricPath.path;
        }
        canvas.remove(event.path);
        canvas.requestRenderAll();
      }
    });

    // Set the viewport transform if it exists
    canvas.viewportTransform = vptRef.current || [1, 0, 0, 1, 0, 0];
    adjustStrokes(canvas.getZoom());

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
            value={mode === GlyphViewState.CUTTING ? "cut" : null}
            exclusive
            onChange={(event, newValue) => {
              setMode(
                newValue === "cut"
                  ? GlyphViewState.CUTTING
                  : GlyphViewState.NORMAL,
              );
            }}
          >
            <ToggleButton value={"cut"}>
              <Tooltip title="Cut Elements">
                <ContentCutIcon />
              </Tooltip>
            </ToggleButton>
          </ToggleButtonGroup>
          {mode === GlyphViewState.CUTTING && (
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
          <IconButton
            onClick={() => {
              // TODO: implement SVG import
            }}
            className="ml-auto"
          >
            <Tooltip title="Import SVG">
              <UploadFileIcon />
            </Tooltip>
          </IconButton>
          <IconButton
            onClick={() => {
              if (path === null) return;
              downloadStringAsFile(
                pathDataToSVG(path),
                glyphName ? `${glyphName}.svg` : "glyph.svg",
                "image/svg+xml",
              );
            }}
          >
            <Tooltip title="Download as SVG">
              <DownloadIcon />
            </Tooltip>
          </IconButton>
        </div>
      )}
      <canvas ref={canvasRef} />
    </div>
  );
}
