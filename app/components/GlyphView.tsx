import CloseIcon from "@mui/icons-material/Close";
import DownloadIcon from "@mui/icons-material/Download";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import {
  AppBar,
  Button,
  Dialog,
  IconButton,
  Slide,
  Tooltip,
  Typography,
} from "@mui/material";
import Toolbar from "@mui/material/Toolbar";
import { amber, blue, teal } from "@mui/material/colors";
import { TransitionProps } from "@mui/material/transitions";
import * as fabric from "fabric";
import React, { useCallback, useEffect, useRef, useState } from "react";

import useComponentSize from "@/app/hooks/useComponentSize";
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
  const canvasElemRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<fabric.TMat2D | null>(null);

  type CanvasState = {
    canvas: fabric.Canvas;
    path: PathData | null;
    pathObjects: fabric.Path[];
    bgPathObjects: fabric.Path[];
  };
  const mainCanvasStateRef = useRef<CanvasState | null>(null);
  const fullScreenCanvasStateRef = useRef<CanvasState | null>(null);

  const [dialogOpen, setDialogOpen] = React.useState(false);

  const commitPath = useCallback(
    (state: CanvasState) => {
      if (onPathChanged) {
        onPathChanged(state.path?.clone() ?? null);
      }
    },
    [onPathChanged],
  );

  const initializeCanvas = useCallback(
    (canvasElement: HTMLCanvasElement, width: number, height: number) => {
      // Initialize the Fabric canvas
      const canvas = new fabric.Canvas(canvasElement, {
        width: width,
        height: height,
        backgroundColor: "white",
      });

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
      return canvas;
    },
    [interactive],
  );

  const updateBgPaths = useCallback(
    (
      bgPaths: PathData[],
      state: CanvasState,
      width: number,
      height: number,
    ) => {
      for (const obj of state.bgPathObjects) {
        state.canvas.remove(obj);
      }
      state.bgPathObjects.length = 0;
      for (const path of bgPaths) {
        state.bgPathObjects.push(
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
      state.canvas.add(...state.bgPathObjects);
    },
    [],
  );

  const updatePath = useCallback(
    (
      path: PathData | null,
      state: CanvasState,
      width: number,
      height: number,
    ) => {
      if (JSON.stringify(state.path) === JSON.stringify(path)) return;

      state.path = path?.clone() ?? null;

      // update canvas with new path
      for (const obj of state.pathObjects) {
        state.canvas.remove(obj);
      }
      state.pathObjects.length = 0;

      const pathSelectable = interactive;
      const fabricPaths =
        state.path !== null
          ? state.path.makeFabricPaths(width, height, {
              selectable: pathSelectable,
              evented: pathSelectable,
              fill: "black",
              stroke: amber[800],
              strokeWidth: 8,
            })
          : [];
      state.pathObjects.push(...fabricPaths);

      if (interactive) {
        if (state.path !== null) {
          // Add a semi-transparent copy of the path for reference
          const refPaths = state.path.makeFabricPaths(width, height, {
            selectable: false,
            evented: false,
            fill: blue[500],
            opacity: 0.3,
          });
          state.pathObjects.push(...refPaths);
          state.canvas.add(...refPaths);
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
            state.canvas.requestRenderAll();
          });
          fabricPath.on("deselected", () => {
            deselectPathControls();
            commitPath(state);
          });
          fabricPath.on("modifyPath", () => {
            if (state.path) {
              state.path.updatePath(i, fabricPath.path);
            }
          });
        }
      }

      state.canvas.add(...fabricPaths);
    },
    [interactive, commitPath],
  );

  const pathRef = useRef<PathData | null>(path);
  useEffect(() => {
    pathRef.current = path;
  }, [path]);
  const bgPathsRef = useRef<PathData[]>(bgPaths);
  useEffect(() => {
    bgPathsRef.current = bgPaths;
  }, [bgPaths]);

  const [dialogDivSize, setDialogDivSize] = useState({ width: 0, height: 0 });
  const dialogRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      const canvasElem = node.querySelector("canvas");
      if (!canvasElem) return;

      // Initialize dimensions
      const resizeObserver = new ResizeObserver((entries) => {
        if (entries[0]) {
          const { width, height } = entries[0].contentRect;
          setDialogDivSize({ width, height });
        }
      });
      resizeObserver.observe(node);

      // Initialize the Fabric canvas
      const size = Math.min(node.clientWidth, node.clientHeight);
      const canvas = initializeCanvas(canvasElem, size, size);
      const state = {
        canvas: canvas,
        path: null,
        pathObjects: [],
        bgPathObjects: [],
      };
      fullScreenCanvasStateRef.current = state;
      updateBgPaths(bgPathsRef.current, state, size, size);
      updatePath(pathRef.current, state, size, size);

      // Clean up on unmount
      return () => {
        resizeObserver.disconnect();
        canvas.dispose();
        fullScreenCanvasStateRef.current = null;
      };
    },
    [initializeCanvas, updateBgPaths, updatePath],
  );

  // Re-initialize the Fabric canvas
  useEffect(() => {
    if (canvasElemRef.current) {
      const canvas = initializeCanvas(canvasElemRef.current, width, height);
      mainCanvasStateRef.current = {
        canvas: canvas,
        path: null,
        pathObjects: [],
        bgPathObjects: [],
      };
      return () => {
        canvas.dispose();
        mainCanvasStateRef.current = null;
      };
    }
  }, [initializeCanvas, width, height]);

  // Update the background paths when they change
  useEffect(() => {
    if (mainCanvasStateRef.current) {
      updateBgPaths(bgPaths, mainCanvasStateRef.current, width, height);
    }
  }, [bgPaths, updateBgPaths, width, height]);
  useEffect(() => {
    if (fullScreenCanvasStateRef.current) {
      const size = Math.min(dialogDivSize.width, dialogDivSize.height);
      updateBgPaths(bgPaths, fullScreenCanvasStateRef.current, size, size);
    }
  }, [bgPaths, updateBgPaths, dialogDivSize]);

  // Update the path when it changes
  useEffect(() => {
    if (mainCanvasStateRef.current) {
      updatePath(path, mainCanvasStateRef.current, width, height);
    }
  }, [path, updatePath, width, height]);
  useEffect(() => {
    if (fullScreenCanvasStateRef.current) {
      const size = Math.min(dialogDivSize.width, dialogDivSize.height);
      updatePath(path, fullScreenCanvasStateRef.current, size, size);
    }
  }, [path, updatePath, dialogDivSize]);

  // handle what happens on key press
  const handleKeyPress = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Delete" || event.key === "Backspace") {
        const state =
          fullScreenCanvasStateRef.current ?? mainCanvasStateRef.current;
        if (state && state.path) {
          const activeObjects = state.canvas.getActiveObjects();
          if (activeObjects.length > 0) {
            state.canvas.discardActiveObject();
            for (const obj of activeObjects) {
              state.canvas.remove(obj);
            }
            state.canvas.requestRenderAll();

            // update pathRef
            state.path.filterPaths((path, i) => {
              const fabricPath = state.pathObjects[i];
              return !activeObjects.includes(fabricPath);
            });
            commitPath(state);
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
      {/* Toolbar */}
      {interactive && (
        <div className="flex bg-stone-200">
          <IconButton onClick={() => setDialogOpen(true)}>
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

      {/* Canvas */}
      <canvas ref={canvasElemRef} />

      {/* Fullscreen dialog */}
      <Dialog
        fullScreen
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        slots={{ transition: Transition }}
      >
        <AppBar sx={{ position: "relative" }}>
          <Toolbar>
            <IconButton
              edge="start"
              color="inherit"
              onClick={() => setDialogOpen(false)}
              aria-label="close"
            >
              <CloseIcon />
            </IconButton>
            <Typography sx={{ ml: 2, flex: 1 }} variant="h6" component="div">
              Fullscreen glyph editor
            </Typography>
            <Button
              autoFocus
              color="inherit"
              onClick={() => setDialogOpen(false)}
            >
              save
            </Button>
          </Toolbar>
        </AppBar>
        <div
          ref={dialogRef}
          className="w-full h-full flex justify-center bg-stone-200"
        >
          <canvas className="m-auto" />
        </div>
      </Dialog>
    </div>
  );
}

const Transition = React.forwardRef(function Transition(
  props: TransitionProps & {
    children: React.ReactElement;
  },
  ref: React.Ref<unknown>,
) {
  return <Slide direction="up" ref={ref} {...props} />;
});
