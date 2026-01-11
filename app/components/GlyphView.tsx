import DownloadIcon from "@mui/icons-material/Download";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { IconButton, Tooltip } from "@mui/material";
import { amber, blue, teal } from "@mui/material/colors";
import * as fabric from "fabric";
import React, { useCallback, useEffect, useRef } from "react";

import PathData from "@/app/utils/PathData";
import { downloadStringAsFile } from "@/app/utils/download";
import {
  createPathControls,
  deselectPathControls,
} from "@/app/utils/pathControl";

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
  const canvasRecreatedRef = useRef(false);
  const viewportRef = useRef<fabric.TMat2D | null>(null);

  const pathRef = useRef(path);
  const pathObjectsRef = useRef<fabric.Path[]>([]);
  const bgPathsObjectsRef = useRef<fabric.Path[]>([]);

  const commitPath = useCallback(() => {
    if (onPathChanged) {
      onPathChanged(pathRef.current?.clone() ?? null);
    }
  }, [onPathChanged]);

  // handle what happens on key press
  const handleKeyPress = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Delete" || event.key === "Backspace") {
        if (fabricRef.current && pathRef.current) {
          const canvas = fabricRef.current;
          const activeObjects = canvas.getActiveObjects();
          if (activeObjects.length > 0) {
            canvas.discardActiveObject();
            for (const obj of activeObjects) {
              canvas.remove(obj);
            }
            canvas.requestRenderAll();

            // update pathRef
            pathRef.current.filterPaths((path, i) => {
              const fabricPath = pathObjectsRef.current[i];
              return !activeObjects.includes(fabricPath);
            });

            commitPath();
          }
        }
      }
    },
    [commitPath],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyPress);
    return () => {
      document.removeEventListener("keydown", handleKeyPress);
    };
  }, [handleKeyPress]);

  // Re-initialize the Fabric canvas
  useEffect(() => {
    if (canvasRef.current === null) return;

    // Initialize the Fabric canvas
    const canvas = new fabric.Canvas(canvasRef.current, {
      width: width,
      height: height,
      backgroundColor: "white",
    });
    fabricRef.current = canvas;
    canvasRecreatedRef.current = true;

    canvas.selection = interactive;

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
        viewportRef.current = canvas.viewportTransform;
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
          viewportRef.current = vpt;
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
        for (const obj of canvas.getObjects()) {
          obj.lockMovementX = false;
          obj.lockMovementY = false;
        }
      }
    });

    // Set the viewport transform if it exists
    canvas.viewportTransform = viewportRef.current || [1, 0, 0, 1, 0, 0];
    adjustStrokes(canvas.getZoom());

    // Clean up on unmount to prevent memory leaks
    return () => {
      if (fabricRef.current) {
        fabricRef.current.dispose();
      }
    };
  }, [width, height, interactive, onPathChanged]);

  // Update the background paths when they change
  useEffect(() => {
    if (!fabricRef.current) return;
    for (const obj of bgPathsObjectsRef.current) {
      fabricRef.current.remove(obj);
    }
    bgPathsObjectsRef.current.length = 0;
    for (const path of bgPaths) {
      bgPathsObjectsRef.current.push(
        ...path.makeFabricPaths(width, height, {
          selectable: false,
          evented: false,
          strokeWidth: 2,
          stroke: teal[800],
          fill: "transparent",
          opacity: 0.3,
        }),
      );
    }
    fabricRef.current.add(...bgPathsObjectsRef.current);
  }, [width, height, bgPaths]);

  // Update the path when it changes
  useEffect(() => {
    if (!fabricRef.current) return;
    if (
      !canvasRecreatedRef.current &&
      JSON.stringify(pathRef.current) === JSON.stringify(path)
    )
      return;

    const canvas = fabricRef.current;

    pathRef.current = path?.clone() ?? null;

    // update canvas with new path
    for (const obj of pathObjectsRef.current) {
      fabricRef.current.remove(obj);
    }
    pathObjectsRef.current.length = 0;

    const pathSelectable = interactive;
    const fabricPaths =
      pathRef.current !== null
        ? pathRef.current.makeFabricPaths(width, height, {
            selectable: pathSelectable,
            evented: pathSelectable,
            fill: "black",
            stroke: amber[800],
            strokeWidth: 8,
          })
        : [];
    pathObjectsRef.current.push(...fabricPaths);

    if (interactive) {
      if (pathRef.current !== null) {
        // Add a semi-transparent copy of the path for reference
        const refPaths = pathRef.current.makeFabricPaths(width, height, {
          selectable: false,
          evented: false,
          fill: blue[500],
          opacity: 0.3,
        });
        pathObjectsRef.current.push(...refPaths);
        canvas.add(...refPaths);
      }

      // Attach event listeners
      for (let i = 0; i < fabricPaths.length; ++i) {
        const fabricPath = fabricPaths[i];
        let editing = false;
        fabricPath.on("mousedblclick", () => {
          editing = !editing;
          if (editing) {
            fabricPath.controls = createPathControls(fabricPath, {
              pointStyle: {
                controlSize: 10.0,
                controlFill: "white",
                controlStroke: "blue",
                controlStyle: "rect",
              },
              controlPointStyle: {
                controlSize: 10.0,
                controlFill: "transparent",
                controlStroke: "white",
                connectionStroke: "blue",
                strokeCompositeOperation: "difference",
              },
            });
            fabricPath.hasBorders = false;
          } else {
            fabricPath.controls =
              fabric.controlsUtils.createObjectDefaultControls();
            fabricPath.hasBorders = true;
            deselectPathControls();
          }
          fabricPath.setCoords();
          canvas.requestRenderAll();
        });
        fabricPath.on("deselected", () => {
          deselectPathControls();
          commitPath();
        });
        fabricPath.on("modifyPath", () => {
          if (pathRef.current) {
            pathRef.current.updatePath(i, fabricPath.path);
          }
        });
      }
    }

    canvas.add(...fabricPaths);
  }, [width, height, path, interactive, commitPath]);

  canvasRecreatedRef.current = false;

  function importFromSVG() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".svg,image/svg+xml";
    input.onchange = async () => {
      const files = input.files;
      if (!files || !files.length) {
        return;
      }
      const file = files[0];
      const text = await file.text();
      if (onPathChanged) {
        onPathChanged(PathData.fromSvg(text));
      }
    };
    input.click();
  }

  return (
    <div {...props}>
      {interactive && (
        <div className="flex bg-stone-200">
          <IconButton onClick={() => {}}>
            <Tooltip title="Fullscreen">
              <FullscreenIcon />
            </Tooltip>
          </IconButton>
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
          <IconButton onClick={() => importFromSVG()} className="ml-auto">
            <Tooltip title="Import SVG">
              <UploadFileIcon />
            </Tooltip>
          </IconButton>
          <IconButton
            onClick={() => {
              if (path === null) return;
              downloadStringAsFile(
                path.exportSvg(),
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
