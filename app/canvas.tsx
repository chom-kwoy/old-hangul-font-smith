import { MobileStepper } from "@mui/material";
import Button from "@mui/material/Button";
import { Stack } from "@mui/system";
import * as fabric from "fabric";
import { TComplexPathData } from "fabric";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { pathBounds, toBezier } from "@/app/bezier";
import { HANGUL_DATA } from "@/app/hangulData";
import {
  CONSONANT_VARSET_NAMES,
  VOWEL_VARSET_NAMES,
  getVarset,
} from "@/app/jamos";
import { ConsonantInfo, JamoVarsets, VarsetType, VowelInfo } from "@/app/types";

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

export function VarsetMapView({
  width,
  varsets,
  onItemClick,
  selectedJamoName,
  selectedVarsetName,
  ...props
}: {
  width: number;
  varsets: JamoVarsets;
  onItemClick?: (
    jamo: ConsonantInfo | VowelInfo,
    varsetName: VarsetType,
  ) => void;
  selectedJamoName?: string;
  selectedVarsetName?: VarsetType;
} & React.ComponentProps<"div">) {
  const [curPageNumState, setCurPageNum] = useState<number>(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const overlayFabricRef = useRef<fabric.Canvas | null>(null);

  const lastSelectedRef = useRef<{
    jamoName?: string;
    varsetName?: VarsetType;
  }>({
    jamoName: selectedJamoName,
    varsetName: selectedVarsetName,
  });
  type VarsetObjects = {
    rect: fabric.Rect;
    overlayRect: fabric.Rect;
    zoomRect: fabric.Rect;
  };
  const lastSelectedObjRef = useRef<VarsetObjects | null>(null);
  const rectMap = useRef(new Map<string, VarsetObjects>());

  const nCols = Math.max(Math.ceil(width / 25), 1);
  const cellSize = width / nCols;
  const zoomSize = cellSize * 2;
  const height = cellSize * CONSONANT_VARSET_NAMES.length;

  const pages = useMemo(() => {
    const pages: (
      | { type: "consonant"; jamos: ConsonantInfo[] }
      | { type: "vowel"; jamos: VowelInfo[] }
    )[] = [];
    const consonantInfos = HANGUL_DATA.consonantInfo.values().toArray();
    for (let offset = 0; offset < consonantInfos.length; offset += nCols) {
      pages.push({
        type: "consonant",
        jamos: consonantInfos.slice(offset, offset + nCols),
      });
    }
    const vowelInfos = HANGUL_DATA.vowelInfo.values().toArray();
    for (let offset = 0; offset < vowelInfos.length; offset += nCols * 2) {
      pages.push({
        type: "vowel",
        jamos: vowelInfos.slice(offset, offset + nCols * 2),
      });
    }
    return pages;
  }, [nCols]);

  const curPageNum = curPageNumState < pages.length ? curPageNumState : 0;

  const updateSelected = useCallback(() => {
    if (fabricRef.current !== null && overlayFabricRef.current !== null) {
      if (lastSelectedObjRef.current) {
        overlayFabricRef.current.remove(lastSelectedObjRef.current.overlayRect);
      }
      const objects = rectMap.current.get(
        `${lastSelectedRef.current.jamoName}/${lastSelectedRef.current.varsetName}`,
      );
      if (objects) {
        objects.overlayRect.set("stroke", "red");
        overlayFabricRef.current.add(objects.overlayRect);
        overlayFabricRef.current.requestRenderAll();

        lastSelectedObjRef.current = objects;
      }
    }
  }, []);

  useEffect(() => {
    if (canvasRef.current === null || overlayCanvasRef.current === null) {
      return () => {};
    }

    // Initialize the Fabric canvas
    fabricRef.current = new fabric.Canvas(canvasRef.current, {
      width: width,
      height: height,
      selection: false,
    });

    overlayFabricRef.current = new fabric.Canvas(overlayCanvasRef.current, {
      width: width + zoomSize,
      height: height + zoomSize,
      selection: false,
    });

    rectMap.current.clear();
    lastSelectedObjRef.current = null;

    // Render background
    fabricRef.current.add(
      new fabric.Rect({
        left: width / 2,
        top: height / 2,
        width: width,
        height: height,
        fill: "oklch(97% 0.001 106.424)",
        strokeWidth: 0,
        selectable: false,
        evented: false,
      }),
    );

    function renderBox(
      canvas: fabric.Canvas,
      overlayCanvas: fabric.Canvas,
      jamoInfo: ConsonantInfo | VowelInfo,
      varsetName: VarsetType,
      path: TComplexPathData | null,
      isInvalid: boolean,
      offX: number,
      offY: number,
    ) {
      const fill = isInvalid
        ? "oklch(86.9% 0.005 56.366)"
        : path
          ? "white"
          : "oklch(89.2% 0.058 10.001)";
      const rect = new fabric.Rect({
        left: offX * cellSize + cellSize / 2,
        top: offY * cellSize + cellSize / 2,
        width: cellSize,
        height: cellSize,
        fill: fill,
        stroke: "grey",
        strokeWidth: 0.3,
        selectable: false,
        evented: false,
      });
      const overlayRect = new fabric.Rect({
        left: offX * cellSize + cellSize / 2,
        top: offY * cellSize + cellSize / 2,
        width: cellSize,
        height: cellSize,
        fill: "#FFFFFF00",
        stroke: "grey",
        strokeWidth: 2,
        selectable: false,
        evented: false,
      });
      const zoomRect = new fabric.Rect({
        left: (offX + 1) * cellSize + zoomSize / 2,
        top: offY * cellSize + zoomSize / 2,
        width: zoomSize,
        height: zoomSize,
        fill: fill,
        stroke: "grey",
        strokeWidth: 2,
        selectable: false,
        evented: false,
      });
      const objects: fabric.Object[] = [rect];
      const overlayObjects: fabric.Object[] = [overlayRect, zoomRect];
      if (path !== null) {
        objects.push(
          toFabricPath(path, cellSize, cellSize, {
            offsetX: offX * cellSize,
            offsetY: offY * cellSize,
            selectable: false,
            evented: false,
          }),
        );
        overlayObjects.push(
          toFabricPath(path, zoomSize, zoomSize, {
            offsetX: (offX + 1) * cellSize,
            offsetY: offY * cellSize,
            selectable: false,
            evented: false,
          }),
        );
      }
      const group = new fabric.Group(objects, {
        selectable: false,
        evented: !isInvalid,
        hoverCursor: "pointer",
      });
      const overlayGroup = new fabric.Group(overlayObjects, {
        selectable: false,
        evented: false,
      });
      rectMap.current.set(`${jamoInfo.name}/${varsetName}`, {
        rect: rect,
        overlayRect: overlayRect,
        zoomRect: zoomRect,
      });
      group.on("mousedown", () => {
        if (onItemClick) {
          onItemClick(jamoInfo, varsetName);
        }
      });
      group.on("mouseover", () => {
        if (
          lastSelectedRef.current.jamoName == jamoInfo.name &&
          lastSelectedRef.current.varsetName === varsetName
        ) {
          overlayRect.set("stroke", "red");
        } else {
          overlayRect.set("stroke", "grey");
        }
        overlayCanvas.add(overlayGroup);
        overlayCanvas.requestRenderAll();
      });
      group.on("mouseout", () => {
        overlayCanvas.remove(overlayGroup);
        overlayCanvas.requestRenderAll();
      });
      canvas.add(group);
      return group;
    }

    const curPage = pages[curPageNum];
    if (curPage.type === "consonant") {
      let offX = 0;
      let offY = 0;
      for (const varsetName of CONSONANT_VARSET_NAMES) {
        for (const consonant of curPage.jamos) {
          const isInvalid =
            (consonant.leading === null && varsetName.startsWith("l")) ||
            (consonant.trailing === null && varsetName.startsWith("t"));
          const curVarset = varsets.consonants.get(consonant.name)!;
          const path = getVarset(curVarset, varsetName);
          const realOffX = offX % nCols;
          const realOffY =
            Math.floor(offX / nCols) * CONSONANT_VARSET_NAMES.length + offY;
          renderBox(
            fabricRef.current,
            overlayFabricRef.current,
            consonant,
            varsetName,
            path,
            isInvalid,
            realOffX,
            realOffY,
          );
          offX += 1;
        }
        offX = 0;
        offY += 1;
      }
    } else {
      let offX = 0;
      let offY = 0;
      for (const varsetName of VOWEL_VARSET_NAMES) {
        for (const vowel of curPage.jamos) {
          const isInvalid = false;
          const curVarset = varsets.vowel.get(vowel.name)!;
          const path = getVarset(curVarset, varsetName);
          const realOffX = offX % nCols;
          const realOffY =
            Math.floor(offX / nCols) * (VOWEL_VARSET_NAMES.length + 1) + offY;
          renderBox(
            fabricRef.current,
            overlayFabricRef.current,
            vowel,
            varsetName,
            path,
            isInvalid,
            realOffX,
            realOffY,
          );
          offX += 1;
        }
        offX = 0;
        offY += 1;
      }
    }

    updateSelected();

    // Clean up on unmount to prevent memory leaks
    return () => {
      if (fabricRef.current) {
        fabricRef.current.dispose();
      }
      if (overlayFabricRef.current) {
        overlayFabricRef.current.dispose();
      }
    };
  }, [
    width,
    height,
    nCols,
    cellSize,
    pages,
    curPageNum,
    onItemClick,
    varsets.consonants,
    varsets.vowel,
    zoomSize,
    updateSelected,
  ]);

  useEffect(() => {
    lastSelectedRef.current = {
      jamoName: selectedJamoName,
      varsetName: selectedVarsetName,
    };
    updateSelected();
  }, [selectedJamoName, selectedVarsetName, updateSelected]);

  return (
    <Stack>
      <div {...props} style={{ position: "relative" }}>
        <canvas ref={canvasRef} />
        {/* Overlay */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            pointerEvents: "none",
            zIndex: 10000,
          }}
        >
          <canvas ref={overlayCanvasRef} />
        </div>
      </div>
      <MobileStepper
        variant="dots"
        position="static"
        backButton={
          <Button
            disabled={curPageNum === 0}
            onClick={() => setCurPageNum(curPageNum - 1)}
          >
            Prev
          </Button>
        }
        nextButton={
          <Button
            disabled={curPageNum === pages.length - 1}
            onClick={() => setCurPageNum(curPageNum + 1)}
          >
            Next
          </Button>
        }
        steps={pages.length}
        activeStep={curPageNum}
      />
    </Stack>
  );
}

function toFabricPath(
  path: TComplexPathData,
  width: number,
  height: number,
  {
    offsetX,
    offsetY,
    ...options
  }: { offsetX?: number; offsetY?: number } & Partial<fabric.PathProps> = {},
): fabric.Path {
  offsetX = offsetX || 0;
  offsetY = offsetY || 0;
  const bbox = pathBounds(toBezier(path));
  const bboxWidth = bbox.right - bbox.left;
  const bboxHeight = bbox.bottom - bbox.top;
  return new fabric.Path(path, {
    ...options,
    left: offsetX + (bbox.left + bboxWidth / 2) * (width / 1000),
    top: offsetY + (bbox.top + bboxHeight / 2) * (height / 1000),
    scaleX: width / 1000,
    scaleY: height / 1000,
  });
}
