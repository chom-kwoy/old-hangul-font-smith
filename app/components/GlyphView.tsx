import CloseIcon from "@mui/icons-material/Close";
import DownloadIcon from "@mui/icons-material/Download";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import FullscreenExitIcon from "@mui/icons-material/FullscreenExit";
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

import PathData from "@/app/pathUtils/PathData";
import { extractMedialAxis } from "@/app/pathUtils/medialAxis";
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
  width = Math.max(width, 1);
  height = Math.max(height, 1);

  const canvasElemRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<fabric.TMat2D | null>(null);

  type CanvasState = {
    canvas: fabric.Canvas;
    path: PathData | null;
    pathObjects: fabric.Path[];
    bgPathObjects: fabric.Path[];
    otherObjects: fabric.FabricObject[];
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

  const adjustStrokes = useCallback((canvas: fabric.Canvas) => {
    // Keep stroke width appear constant regardless of zoom
    canvas.forEachObject(function (obj_) {
      // typescript hack
      const obj = obj_ as typeof obj_ & {
        originalScale: number | undefined;
        originalStrokeWidth: number | undefined;
      };
      if (obj.originalStrokeWidth === undefined) {
        obj.originalStrokeWidth = obj.strokeWidth;
      }
      const objScale = (obj.scaleX + obj.scaleY) / 2;
      const multiplier = 1 / canvas.getZoom() / objScale;
      obj.set("strokeWidth", obj.originalStrokeWidth * multiplier);
    });
  }, []);

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
            strokeWidth: 1,
            selectable: false,
            evented: false,
          }),
        );
        canvas.add(
          new fabric.Polyline(vertGrid, {
            left: (i * width) / N_MINOR,
            top: height / 2,
            stroke: "lightgrey",
            strokeWidth: 1,
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
            strokeWidth: 1,
            selectable: false,
            evented: false,
          }),
        );
      }

      let isDragging = false;
      let lastPosX: number | null = null;
      let lastPosY: number | null = null;
      function constrainViewport(canvas: fabric.Canvas) {
        const vpt = canvas.viewportTransform;
        vpt[4] = Math.min(vpt[4], 0);
        vpt[4] = Math.max(vpt[4], width * (1 - vpt[0] - vpt[2]));
        vpt[5] = Math.min(vpt[5], 0);
        vpt[5] = Math.max(vpt[5], height * (1 - vpt[1] - vpt[3]));
        canvas.setViewportTransform(canvas.viewportTransform);
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
          // constrain to glyph area
          constrainViewport(canvas);
          canvas.setViewportTransform(canvas.viewportTransform);
          viewportRef.current = canvas.viewportTransform;
          // Keep stroke width appear constant regardless of zoom
          adjustStrokes(canvas);
          canvas.requestRenderAll();
          opt.e.preventDefault();
          opt.e.stopPropagation();
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
            constrainViewport(canvas);
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
      adjustStrokes(canvas);

      // Clean up on unmount to prevent memory leaks
      return canvas;
    },
    [interactive, adjustStrokes],
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
      for (const obj of state.bgPathObjects) {
        state.canvas.sendObjectToBack(obj);
      }

      adjustStrokes(state.canvas);
    },
    [adjustStrokes],
  );

  const updatePath = useCallback(
    (
      path: PathData | null,
      state: CanvasState,
      width: number,
      height: number,
    ) => {
      if (JSON.stringify(state.path) === JSON.stringify(path)) return;

      state.path = path ? path.clone() : null;
      console.log(state.path?.exportSvg());

      const medialAxis = state.path?.getMedialAxis() ?? [];

      // update canvas with new path
      for (const obj of state.pathObjects) {
        state.canvas.remove(obj);
      }
      state.pathObjects.length = 0;

      for (const obj of state.otherObjects) {
        state.canvas.remove(obj);
      }
      state.otherObjects.length = 0;

      const pathSelectable = interactive;
      const fabricPaths =
        state.path !== null
          ? state.path.makeFabricPaths(width, height, {
              selectable: pathSelectable,
              evented: pathSelectable,
              fill: "black",
              stroke: amber[600],
              strokeWidth: interactive ? 3 : 0,
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
          });
          fabricPath.on("modified", (event) => {
            if (event.transform && state.path) {
              state.path.updatePath(i, fabricPath);
              commitPath(state);
            }
          });
        }
      }

      state.canvas.add(...fabricPaths);

      const medialAxisLines = medialAxis.flatMap((segments) =>
        segments.map((seg) => {
          const line = [
            { x: seg[0].x, y: seg[0].y },
            { x: seg[1].x, y: seg[1].y },
          ];
          const center = {
            x: (seg[0].x + seg[1].x) / 2,
            y: (seg[0].y + seg[1].y) / 2,
          };
          return new fabric.Polyline(line, {
            left: center.x * (width / 1000),
            top: center.y * (height / 1000),
            scaleX: width / 1000,
            scaleY: height / 1000,
            stroke: "#AAFFAA",
            strokeWidth: 2,
            selectable: false,
            evented: false,
          });
        }),
      );
      state.otherObjects.push(...medialAxisLines);
      state.canvas.add(...medialAxisLines);

      adjustStrokes(state.canvas);
    },
    [interactive, commitPath, adjustStrokes],
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
        otherObjects: [],
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
        otherObjects: [],
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
            state.pathObjects = state.pathObjects.filter((fabricPath) => {
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

  function downloadSVG() {
    if (path === null) return;
    downloadStringAsFile(
      path.exportSvg(),
      glyphName ? `${glyphName}.svg` : "glyph.svg",
      "image/svg+xml",
    );
  }

  return (
    <div {...props}>
      {/* Toolbar */}
      {interactive && (
        <div className="flex bg-stone-200">
          <GlyphViewMenu
            isFullScreen={false}
            openFullScreen={() => setDialogOpen(true)}
            closeFullScreen={() => setDialogOpen(false)}
            onResetToSyllable={onResetToSyllable}
            importFromSVG={importFromSVG}
            downloadSVG={downloadSVG}
            tooltipPlacement="top"
          />
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
          <Toolbar variant="dense">
            <IconButton
              edge="start"
              color="inherit"
              onClick={() => setDialogOpen(false)}
              aria-label="close"
            >
              <CloseIcon />
            </IconButton>
            <Typography sx={{ ml: 2, flex: 1 }} variant="h6" component="div">
              Glyph editor
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
        <div className="h-full flex">
          {interactive && (
            <div className="flex flex-col bg-stone-200">
              <GlyphViewMenu
                isFullScreen={true}
                openFullScreen={() => setDialogOpen(true)}
                closeFullScreen={() => setDialogOpen(false)}
                onResetToSyllable={onResetToSyllable}
                importFromSVG={importFromSVG}
                downloadSVG={downloadSVG}
                tooltipPlacement="right"
              />
            </div>
          )}
          <div
            ref={dialogRef}
            className="w-full h-full flex justify-center bg-stone-200"
          >
            <canvas className="m-auto" />
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function GlyphViewMenu({
  isFullScreen,
  openFullScreen,
  closeFullScreen,
  onResetToSyllable,
  importFromSVG,
  downloadSVG,
  tooltipPlacement,
}: {
  isFullScreen: boolean;
  openFullScreen: () => void;
  closeFullScreen: () => void;
  onResetToSyllable?: (target: HTMLElement) => void;
  importFromSVG: () => void;
  downloadSVG: () => void;
  tooltipPlacement: "right" | "left" | "top" | "bottom";
}) {
  return (
    <>
      {!isFullScreen && (
        <IconButton onClick={openFullScreen}>
          <Tooltip title="Fullscreen" placement={tooltipPlacement}>
            <FullscreenIcon />
          </Tooltip>
        </IconButton>
      )}
      {isFullScreen && (
        <IconButton onClick={closeFullScreen}>
          <Tooltip title="Exit Fullscreen" placement={tooltipPlacement}>
            <FullscreenExitIcon />
          </Tooltip>
        </IconButton>
      )}
      <IconButton
        onClick={(event) => {
          if (onResetToSyllable) {
            onResetToSyllable(event.currentTarget);
          }
        }}
      >
        <Tooltip title="Reset to Full Syllable" placement={tooltipPlacement}>
          <RestartAltIcon />
        </Tooltip>
      </IconButton>
      <IconButton onClick={importFromSVG} className="ml-auto">
        <Tooltip title="Import SVG" placement={tooltipPlacement}>
          <UploadFileIcon />
        </Tooltip>
      </IconButton>
      <IconButton onClick={downloadSVG}>
        <Tooltip title="Download as SVG" placement={tooltipPlacement}>
          <DownloadIcon />
        </Tooltip>
      </IconButton>
    </>
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
