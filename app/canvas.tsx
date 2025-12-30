import { MobileStepper } from "@mui/material";
import Button from "@mui/material/Button";
import { Stack } from "@mui/system";
import * as fabric from "fabric";
import { TComplexPathData } from "fabric";
import React, { useEffect, useMemo, useRef, useState } from "react";

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
            opacity: 0.3,
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
  selectedVarsetName?: string;
} & React.ComponentProps<"canvas">) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const [curPageNumState, setCurPageNum] = useState<number>(0);

  const nCols = Math.max(Math.ceil(width / 25), 1);
  const cellSize = width / nCols;
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

  useEffect(() => {
    if (canvasRef.current === null) {
      return () => {};
    }

    // Initialize the Fabric canvas
    fabricRef.current = new fabric.Canvas(canvasRef.current, {
      width: width,
      height: height,
      selection: false,
    });

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
      path: TComplexPathData | null,
      isSelected: boolean,
      isInvalid: boolean,
      offX: number,
      offY: number,
    ) {
      const objects = [];
      objects.push(
        new fabric.Rect({
          left: offX * cellSize + cellSize / 2,
          top: offY * cellSize + cellSize / 2,
          width: cellSize,
          height: cellSize,
          fill: isInvalid
            ? "oklch(86.9% 0.005 56.366)"
            : path
              ? "white"
              : "oklch(89.2% 0.058 10.001)",
          stroke: isSelected ? "red" : "grey",
          strokeWidth: isSelected ? 1 : 0.3,
          selectable: false,
          evented: false,
        }),
      );
      if (path !== null) {
        objects.push(
          toFabricPath(path, cellSize, cellSize, {
            offsetX: offX * cellSize,
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
      canvas.add(group);
      return group;
    }

    const curPage = pages[curPageNum];
    let selectedRect: fabric.Object | null = null;
    if (curPage.type === "consonant") {
      let offX = 0;
      let offY = 0;
      for (const varsetName of CONSONANT_VARSET_NAMES) {
        for (const consonant of curPage.jamos) {
          const isSelected =
            consonant.name === selectedJamoName &&
            varsetName === selectedVarsetName;
          const isInvalid =
            (consonant.leading === null && varsetName.startsWith("l")) ||
            (consonant.trailing === null && varsetName.startsWith("t"));
          const curVarset = varsets.consonants.get(consonant.name)!;
          const path = getVarset(curVarset, varsetName);
          const realOffX = offX % nCols;
          const realOffY =
            Math.floor(offX / nCols) * CONSONANT_VARSET_NAMES.length + offY;
          const rect = renderBox(
            fabricRef.current,
            path,
            isSelected,
            isInvalid,
            realOffX,
            realOffY,
          );
          if (isSelected) {
            selectedRect = rect;
          }
          rect.on("mousedown", () => {
            if (onItemClick) {
              onItemClick(consonant, varsetName);
            }
          });
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
          const isSelected =
            vowel.name === selectedJamoName &&
            varsetName === selectedVarsetName;
          const isInvalid = false;
          const curVarset = varsets.vowel.get(vowel.name)!;
          const path = getVarset(curVarset, varsetName);
          const realOffX = offX % nCols;
          const realOffY =
            Math.floor(offX / nCols) * (VOWEL_VARSET_NAMES.length + 0.5) + offY;
          const rect = renderBox(
            fabricRef.current,
            path,
            isSelected,
            isInvalid,
            realOffX,
            realOffY,
          );
          if (isSelected) {
            selectedRect = rect;
          }
          rect.on("mousedown", () => {
            if (onItemClick) {
              onItemClick(vowel, varsetName);
            }
          });
          offX += 1;
        }
        offX = 0;
        offY += 1;
      }
    }
    if (selectedRect) {
      fabricRef.current.bringObjectToFront(selectedRect);
    }

    // Clean up on unmount to prevent memory leaks
    return () => {
      if (fabricRef.current) {
        fabricRef.current.dispose();
      }
    };
  });

  return (
    <Stack>
      <canvas ref={canvasRef} {...props} />
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
