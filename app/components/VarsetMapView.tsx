import { MobileStepper } from "@mui/material";
import Button from "@mui/material/Button";
import { Stack } from "@mui/system";
import * as fabric from "fabric";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { toFabricPaths } from "@/app/utils/fabricUtils";
import { HANGUL_DATA } from "@/app/utils/hangulData";
import {
  CONSONANT_VARSET_NAMES,
  VOWEL_VARSET_NAMES,
  getVarset,
} from "@/app/utils/jamos";
import {
  ConsonantInfo,
  JamoVarsets,
  PathData,
  VarsetType,
  VowelInfo,
} from "@/app/utils/types";

type VarsetObjects = {
  overlayRect: fabric.Rect;
  path: PathData | null;
  mainPaths: fabric.Group;
  zoomPaths: fabric.Group;
  makeMainPath: (path: PathData | null) => fabric.Path[];
  makeZoomPath: (path: PathData | null) => fabric.Path[];
};
type SelectedVarset = {
  jamoName?: string;
  varsetName?: VarsetType;
};

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

  const varsetRef = useRef(varsets);
  const selectedVarsetRef = useRef<SelectedVarset>({
    jamoName: selectedJamoName,
    varsetName: selectedVarsetName,
  });

  const selectedObjRef = useRef<VarsetObjects | null>(null);
  const varsetToObjMap = useRef(new Map<string, VarsetObjects>());

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

  const updateVarsets = useCallback(
    (newVarsets: JamoVarsets) => {
      if (fabricRef.current !== null && overlayFabricRef.current !== null) {
        const curPage = pages[curPageNum];
        const varsetNames =
          curPage.type === "consonant"
            ? CONSONANT_VARSET_NAMES
            : VOWEL_VARSET_NAMES;
        for (const varsetName of varsetNames) {
          for (const jamo of curPage.jamos) {
            const objects = varsetToObjMap.current.get(
              `${jamo.name}/${varsetName}`,
            );
            if (objects) {
              const newVarset = newVarsets.jamos.get(jamo.name)!;
              const newPath = getVarset(newVarset, varsetName);
              if (objects.path !== newPath) {
                objects.mainPaths.removeAll();
                objects.mainPaths.add(...objects.makeMainPath(newPath));
                objects.zoomPaths.removeAll();
                objects.zoomPaths.add(...objects.makeZoomPath(newPath));
              }
            }
          }
        }
        fabricRef.current.requestRenderAll();
        overlayFabricRef.current.requestRenderAll();
      }
    },
    [pages, curPageNum],
  );
  const updateSelected = useCallback((newSelectedVarset: SelectedVarset) => {
    if (fabricRef.current !== null && overlayFabricRef.current !== null) {
      if (selectedObjRef.current) {
        overlayFabricRef.current.remove(selectedObjRef.current.overlayRect);
      }
      const objects = varsetToObjMap.current.get(
        `${newSelectedVarset.jamoName}/${newSelectedVarset.varsetName}`,
      );
      if (objects) {
        objects.overlayRect.set("stroke", "red");
        overlayFabricRef.current.add(objects.overlayRect);
        overlayFabricRef.current.requestRenderAll();

        selectedObjRef.current = objects;
      }
    }
  }, []);

  useEffect(() => {
    if (
      width === 0 ||
      canvasRef.current === null ||
      overlayCanvasRef.current === null
    ) {
      return;
    }

    console.log("WARNING: expensive (re)make varsetmap canvas!!");

    // Initialize the Fabric canvas
    fabricRef.current = new fabric.Canvas(canvasRef.current, {
      width: width,
      height: height,
      selection: false,
      renderOnAddRemove: false,
    });

    overlayFabricRef.current = new fabric.Canvas(overlayCanvasRef.current, {
      width: width + zoomSize + 20,
      height: height + zoomSize + 20,
      selection: false,
      renderOnAddRemove: false,
    });

    varsetToObjMap.current.clear();
    selectedObjRef.current = null;

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

    const zoomShadow = new fabric.Shadow({
      color: "rgba(0,0,0,0.3)", // Shadow color
      blur: 3, // Blur level
      offsetX: 3, // Horizontal offset
      offsetY: 3, // Vertical offset
    });

    function renderBox(
      canvas: fabric.Canvas,
      overlayCanvas: fabric.Canvas,
      jamoInfo: ConsonantInfo | VowelInfo,
      varsetName: VarsetType,
      path: PathData | null,
      isInvalid: boolean,
      offX: number,
      offY: number,
    ) {
      const fill = isInvalid
        ? "#E7E5E4"
        : path
          ? "white"
          : "oklch(89.2% 0.058 10.001)";

      // Cell borders for main layer
      const rect = new fabric.Rect({
        left: offX * cellSize + cellSize / 2,
        top: offY * cellSize + cellSize / 2,
        width: cellSize,
        height: cellSize,
        fill: fill,
        stroke: "grey",
        strokeWidth: 0.3,
        selectable: false,
        evented: !isInvalid,
        hoverCursor: "pointer",
      });
      canvas.add(rect);

      // Cell borders for overlay layer
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
        shadow: zoomShadow,
        selectable: false,
        evented: false,
      });

      // Add paths
      const makeMainPath = (path: PathData | null) => {
        if (!path) return [];
        return toFabricPaths(path, cellSize, cellSize, {
          offsetX: offX * cellSize,
          offsetY: offY * cellSize,
          selectable: false,
          evented: false,
        });
      };
      const makeZoomPath = (path: PathData | null) => {
        if (!path) return [];
        return toFabricPaths(path, zoomSize, zoomSize, {
          offsetX: (offX + 1) * cellSize,
          offsetY: offY * cellSize,
          selectable: false,
          evented: false,
        });
      };
      const mainPaths: fabric.Path[] = [...makeMainPath(path)];
      const zoomPaths: fabric.Path[] = [...makeZoomPath(path)];

      const mainPathGroup = new fabric.Group(mainPaths, {
        selectable: false,
        evented: false,
      });
      canvas.add(mainPathGroup);

      const zoomPathGroup = new fabric.Group(zoomPaths, {
        selectable: false,
        evented: false,
      });
      const overlayGroup = new fabric.Group(
        [overlayRect, zoomRect, zoomPathGroup],
        {
          selectable: false,
          evented: false,
        },
      );

      varsetToObjMap.current.set(`${jamoInfo.name}/${varsetName}`, {
        overlayRect: overlayRect,
        path: path,
        mainPaths: mainPathGroup,
        zoomPaths: zoomPathGroup,
        makeMainPath: makeMainPath,
        makeZoomPath: makeZoomPath,
      });

      rect.on("mousedown", () => {
        if (onItemClick) {
          onItemClick(jamoInfo, varsetName);
        }
      });
      rect.on("mouseover", () => {
        if (
          selectedVarsetRef.current.jamoName == jamoInfo.name &&
          selectedVarsetRef.current.varsetName === varsetName
        ) {
          overlayRect.set("stroke", "red");
        } else {
          overlayRect.set("stroke", "grey");
        }
        overlayCanvas.add(overlayGroup);
        overlayCanvas.requestRenderAll();
      });
      rect.on("mouseout", () => {
        overlayCanvas.remove(overlayGroup);
        overlayCanvas.requestRenderAll();
      });
    }

    const curPage = pages[curPageNum];
    const varsetNames =
      curPage.type === "consonant"
        ? CONSONANT_VARSET_NAMES
        : VOWEL_VARSET_NAMES;
    const ySkip =
      curPage.type === "consonant"
        ? CONSONANT_VARSET_NAMES.length
        : VOWEL_VARSET_NAMES.length + 1;

    let offX = 0;
    let offY = 0;
    for (const varsetName of varsetNames) {
      for (const jamo of curPage.jamos) {
        const isInvalid =
          jamo.type === "consonant"
            ? (jamo.leading === null && varsetName.startsWith("l")) ||
              (jamo.trailing === null && varsetName.startsWith("t"))
            : jamo.vowel === null && varsetName.startsWith("v");
        const curVarset = varsetRef.current.jamos.get(jamo.name)!;
        const path = getVarset(curVarset, varsetName);
        const realOffX = offX % nCols;
        const realOffY = Math.floor(offX / nCols) * ySkip + offY;
        renderBox(
          fabricRef.current,
          overlayFabricRef.current,
          jamo,
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

    updateSelected(selectedVarsetRef.current);

    fabricRef.current.requestRenderAll();
    overlayFabricRef.current.requestRenderAll();

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
    zoomSize,
    pages,
    curPageNum,
    onItemClick,
    updateSelected,
  ]);

  useEffect(() => {
    varsetRef.current = varsets;
    updateVarsets(varsetRef.current);
  }, [varsets, updateVarsets]);

  useEffect(() => {
    selectedVarsetRef.current = {
      jamoName: selectedJamoName,
      varsetName: selectedVarsetName,
    };
    updateSelected(selectedVarsetRef.current);
  }, [selectedJamoName, selectedVarsetName, updateSelected]);

  if (width === 0) {
    return null;
  }

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
            zIndex: 1299,
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
