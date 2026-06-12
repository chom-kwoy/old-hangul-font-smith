import React, { useCallback, useEffect, useRef } from "react";

import { useBackgroundPaths } from "@/app/components/glyphCanvas/useBackgroundPaths";
import { useFabricCanvas } from "@/app/components/glyphCanvas/useFabricCanvas";
import { useOutlinePaths } from "@/app/components/glyphCanvas/useOutlinePaths";
import { useSkeletonEditing } from "@/app/components/glyphCanvas/useSkeletonEditing";
import { PathObjects, SkeletonSub } from "@/app/components/glyphCanvas/types";
import PathData from "@/app/pathUtils/PathData";

export function FabricGlyphCanvas({
  path,
  bgPaths = [],
  width,
  height,
  interactive,
  onPathChanged,
  className,
  enableRescaling,
  skeletonEditMode,
}: {
  path: PathData | null;
  bgPaths?: PathData[];
  width: number;
  height: number;
  interactive: boolean;
  onPathChanged?: (path: PathData | null) => void;
  className?: string;
  enableRescaling?: boolean;
  skeletonEditMode?: boolean;
}) {
  enableRescaling = enableRescaling ?? true;
  skeletonEditMode = skeletonEditMode ?? false;

  const canvasElemRef = useRef<HTMLCanvasElement | null>(null);

  // Cross-concern state: the cloned path being edited, its fabric outline
  // objects, and the active skeleton-edit session. Held here (the integration
  // layer) because both the outline and skeleton hooks read/write them.
  const pathObjectsRef = useRef<PathObjects[]>([]);
  const skeletonSubsRef = useRef<SkeletonSub[]>([]);
  const currentPathRef = useRef<PathData | null>(null);

  // Keep latest callback in a ref so fabric event closures never go stale.
  const onPathChangedRef = useRef(onPathChanged);
  useEffect(() => {
    onPathChangedRef.current = onPathChanged;
  }, [onPathChanged]);

  // Reset content refs whenever a fresh canvas is created, so the content hooks
  // rebuild onto it. Runs (from useFabricCanvas) before those hooks' effects.
  const resetContent = useCallback(() => {
    pathObjectsRef.current = [];
    skeletonSubsRef.current = [];
    currentPathRef.current = null;
  }, []);

  const { canvas, canvasRef } = useFabricCanvas(
    canvasElemRef,
    width,
    height,
    interactive,
    resetContent,
  );

  useOutlinePaths({
    canvas,
    canvasRef,
    path,
    width,
    height,
    interactive,
    enableRescaling,
    pathObjectsRef,
    currentPathRef,
    onPathChangedRef,
  });

  useBackgroundPaths(
    canvasRef,
    bgPaths,
    width,
    height,
    interactive,
    enableRescaling,
  );

  useSkeletonEditing({
    canvas,
    canvasRef,
    path,
    width,
    height,
    interactive,
    skeletonEditMode,
    pathObjectsRef,
    currentPathRef,
    onPathChangedRef,
    skeletonSubsRef,
  });

  // Wrap canvas in a div so React unmounts the outer div rather than the canvas
  // element itself. fabric.js moves the canvas into its own wrapper div on init,
  // so if React owned the canvas directly it would fail to remove it on unmount.
  return (
    <div className={className} style={{ width, height }}>
      <canvas ref={canvasElemRef} />
    </div>
  );
}
