"use client";

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
import { TransitionProps } from "@mui/material/transitions";
import React, { useCallback, useRef, useState } from "react";
import { MaterialSymbol } from "react-material-symbols-react19";
import "react-material-symbols-react19/outlined";

import { FabricGlyphCanvas } from "@/app/components/FabricGlyphCanvas";
import PathData from "@/app/pathUtils/PathData";
import { downloadStringAsFile } from "@/app/utils/download";

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

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogContentSize, setDialogContentSize] = useState({
    width: 0,
    height: 0,
  });
  const dialogObserverRef = useRef<ResizeObserver | null>(null);
  const dialogContentRef = useCallback((node: HTMLDivElement | null) => {
    dialogObserverRef.current?.disconnect();
    dialogObserverRef.current = null;
    if (!node) return;
    // Read dimensions synchronously so the initial render gets the correct size,
    // then keep tracking with ResizeObserver for subsequent changes.
    setDialogContentSize({
      width: node.clientWidth,
      height: node.clientHeight,
    });
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) {
        const { width, height } = entries[0].contentRect;
        setDialogContentSize({ width, height });
      }
    });
    observer.observe(node);
    dialogObserverRef.current = observer;
  }, []);
  const dialogCanvasSize = Math.max(
    Math.min(dialogContentSize.width, dialogContentSize.height),
    1,
  );

  function importFromSVG() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".svg,image/svg+xml";
    input.onchange = async () => {
      const files = input.files;
      if (!files || !files.length) return;
      const text = await files[0].text();
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

      {/* Main canvas */}
      <FabricGlyphCanvas
        width={width}
        height={height}
        path={path}
        bgPaths={bgPaths}
        interactive={interactive}
        onPathChanged={onPathChanged}
      />

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
              <MaterialSymbol icon={"close"} size={24} fill />
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
            ref={dialogContentRef}
            className="w-full h-full flex justify-center bg-stone-200"
          >
            {dialogOpen && (
              <FabricGlyphCanvas
                className="m-auto"
                width={dialogCanvasSize}
                height={dialogCanvasSize}
                path={path}
                bgPaths={bgPaths}
                interactive={interactive}
                onPathChanged={onPathChanged}
              />
            )}
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
            <MaterialSymbol icon={"fullscreen"} size={24} fill />
          </Tooltip>
        </IconButton>
      )}
      {isFullScreen && (
        <IconButton onClick={closeFullScreen}>
          <Tooltip title="Exit Fullscreen" placement={tooltipPlacement}>
            <MaterialSymbol icon={"fullscreen_exit"} size={24} fill />
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
          <MaterialSymbol icon={"restart_alt"} size={24} fill />
        </Tooltip>
      </IconButton>
      <IconButton onClick={importFromSVG} className="ml-auto">
        <Tooltip title="Import SVG" placement={tooltipPlacement}>
          <MaterialSymbol icon={"upload_file"} size={24} fill />
        </Tooltip>
      </IconButton>
      <IconButton onClick={downloadSVG}>
        <Tooltip title="Download as SVG" placement={tooltipPlacement}>
          <MaterialSymbol icon={"download"} size={24} fill />
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
