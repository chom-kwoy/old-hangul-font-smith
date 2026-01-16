"use client";

import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { IconButton, Menu, MenuItem, Snackbar } from "@mui/material";
import Button from "@mui/material/Button";
import * as fabric from "fabric";
import { produce } from "immer";
import moment from "moment";
import paper from "paper";
import React, { useEffect, useState } from "react";
import { useLocalStorage } from "react-use";

import { Editor } from "@/app/components/Editor";
import { VisuallyHiddenInput } from "@/app/components/VisuallyHiddenInput";
import { FontProcessor } from "@/app/processors/fontProcessor";
import { fontLoaded } from "@/app/redux/features/font/font-slice";
import { useAppDispatch, useAppStore } from "@/app/redux/hooks";
import { getProgress } from "@/app/utils/jamos";
import schedulerYield from "@/app/utils/schedulerYield";
import { FontMetadata, JamoVarsets, SavedState } from "@/app/utils/types";

export enum AppState {
  IDLE,
  PROCESSING_FONT,
  READY_TO_GENERATE,
  GENERATING,
  COMPLETED,
  ERROR,
}

const FONT_MIME_TYPES = ".otf,.ttf,font/otf,font/ttf";

export default function Home() {
  useEffect(() => {
    // Initialize paper.js context
    // @ts-expect-error no argument is also allowed
    paper.setup();
    paper.settings.insertItems = false;

    // Set global fabric.js defaults
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
  }, []);

  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [errorMsg, setErrorMsg] = useState<string>("Unknown error.");
  const [fontProcessor] = useState(() => new FontProcessor());
  const [fontMetadata, setFontMetadata] = useState<FontMetadata | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // Redux dispatch action
  const dispatch = useAppDispatch();
  const store = useAppStore();

  // State for the saved fonts popup menu
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
  const menuOpen = Boolean(anchorEl);
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMsg, setSnackbarMsg] = useState("");

  // Access localstorage for saved fonts
  const [savedFonts_, setSavedFonts] = useLocalStorage<SavedState[]>(
    "saved-fonts",
    [],
  );

  // Workaround for hydration mismatch error
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMounted(true);
  }, []);
  const savedFonts = isMounted ? (savedFonts_ ?? []) : [];
  const [curSavedFontIdx, setCurSavedFontIdx] = useState<number | null>(null);

  async function handleFileChange(files: FileList | null) {
    if (!files || !files.length) {
      setAppState(AppState.ERROR);
      setErrorMsg("No file found.");
      return;
    }

    setAppState(AppState.PROCESSING_FONT);

    // Allow page to render before heavy operation
    await schedulerYield();

    const metadata = await fontProcessor.loadFont(files[0]);
    setFontMetadata(metadata);

    const varsets = await fontProcessor.analyzeJamoVarsets();
    dispatch(fontLoaded(varsets));

    const sampleImage = fontProcessor.getSampleImage(
      "유월 활짝 편 배꽃들 밑에 요 콩새야,",
    );
    setPreviewImage(sampleImage);

    setAppState(AppState.READY_TO_GENERATE);

    setCurSavedFontIdx(savedFonts.length);
    setSavedFonts(
      produce(savedFonts, (prevSavedFonts) => {
        prevSavedFonts.push({
          metadata: metadata,
          previewImage: sampleImage,
          jamoVarsets: varsets,
          progress: getProgress(varsets),
          date: moment().valueOf(),
        });
      }),
    );
  }

  async function loadSavedFont(index: number, saved: SavedState) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = FONT_MIME_TYPES;
    input.onchange = async () => {
      const files = input.files;
      if (!files || !files.length) {
        setAppState(AppState.ERROR);
        setErrorMsg("No file found.");
        return;
      }

      setAppState(AppState.PROCESSING_FONT);

      // Allow page to render before heavy operation
      await schedulerYield();

      const loadedMetadata = await fontProcessor.loadFont(files[0]);
      if (
        saved.metadata.name !== loadedMetadata.name ||
        saved.metadata.family !== loadedMetadata.family ||
        saved.metadata.style !== loadedMetadata.style
      ) {
        setAppState(AppState.ERROR);
        setErrorMsg("You need to select the same font file as before.");
        return;
      }

      setFontMetadata(loadedMetadata);
      setPreviewImage(saved.previewImage);
      dispatch(fontLoaded(saved.jamoVarsets));

      setAppState(AppState.READY_TO_GENERATE);

      setCurSavedFontIdx(index);
      // update date
      setSavedFonts(
        produce(savedFonts, (prevSavedFonts) => {
          prevSavedFonts[index].date = moment().valueOf();
        }),
      );
    };
    input.click();
  }

  function saveFont(newJamoVarsets: JamoVarsets) {
    if (curSavedFontIdx !== null) {
      setSavedFonts(
        produce(savedFonts, (prevSavedFonts) => {
          prevSavedFonts[curSavedFontIdx].jamoVarsets = newJamoVarsets;
        }),
      );
      setSnackbarMsg("Saved.");
      setSnackbarOpen(true);
    }
  }

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-stone-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-amber-600 rounded-lg flex items-center justify-center text-white font-bold text-xl shadow-md">
              옛
            </div>
            <div>
              <h1 className="text-xl font-bold text-stone-900 leading-tight">
                Old Hangul Font Smith
              </h1>
              <p className="text-xs text-stone-500 font-medium">
                Create Old Hangul Fonts
              </p>
            </div>
          </div>
          <div className="text-xs font-mono bg-stone-100 px-3 py-1 rounded text-stone-500">
            v1.0.0
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-8 space-y-8">
        {/* Step 0: Select saved fonts to resume */}
        {appState == AppState.IDLE && savedFonts.length > 0 && (
          <section className="bg-white rounded-2xl p-8 shadow-sm border border-stone-200">
            <div className="flex items-center gap-3 mb-6">
              <h2 className="text-xl font-bold text-stone-900">
                Continue Editing
              </h2>
            </div>
            <div className="text-sm text-stone-600 pb-1">
              Select a font to continue editing. After selecting,{" "}
              <strong>re-upload the source font file</strong> to resume your
              session.
            </div>
            <div className="bg-stone-50 border border-stone-200 p-10">
              <div className="flex flex-wrap justify-evenly items-center gap-10">
                {savedFonts.map((font, i) => (
                  <div
                    key={i}
                    className="w-80 flex-none shadow-sm rounded-xl bg-white hover:bg-amber-200 transition-colors duration-300 ease-in-out border border-stone-200 p-2 cursor-pointer"
                    onClick={() => loadSavedFont(i, savedFonts[i])}
                  >
                    <div className="flex">
                      <div className="text-stone-700 self-center">
                        <div>{font.metadata.name}</div>
                      </div>
                      <div className="text-stone-700 ml-auto">
                        <span onClick={(event) => event.stopPropagation()}>
                          <IconButton
                            aria-label="options"
                            onClick={handleClick}
                            value={i}
                          >
                            <MoreHorizIcon />
                          </IconButton>
                          <Menu
                            anchorEl={anchorEl}
                            open={menuOpen}
                            onClose={() => setAnchorEl(null)}
                            slotProps={{
                              list: {
                                "aria-labelledby": "basic-button",
                              },
                            }}
                          >
                            <MenuItem
                              onClick={() => {
                                if (anchorEl) {
                                  const i = parseInt(anchorEl.value);
                                  setSavedFonts(
                                    produce(savedFonts, (prevSavedFonts) => {
                                      prevSavedFonts.splice(i, 1);
                                    }),
                                  );
                                  setAnchorEl(null);
                                }
                              }}
                            >
                              Delete
                            </MenuItem>
                          </Menu>
                        </span>
                      </div>
                    </div>
                    <img
                      src={font.previewImage}
                      alt="Font Preview"
                      className="h-16 object-cover object-left opacity-80 border border-stone-200"
                    />
                    <span className="text-stone-500 text-sm">
                      {(font.progress * 100).toFixed(1)}%
                    </span>
                    <span className="text-stone-500"> • </span>
                    <span className="text-stone-500 text-sm">
                      last edited {moment(font.date).fromNow()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Step 1: Upload */}
        <section className="bg-white rounded-2xl p-8 shadow-sm border border-stone-200 text-center">
          {/* Error message */}
          {appState === AppState.ERROR && (
            <div className="max-w-md mx-auto space-y-4">
              <h2 className="text-xl font-bold text-stone-900">
                An error occurred while loading the font.
              </h2>
              <div className="text-md text-stone-700">{errorMsg}</div>
            </div>
          )}

          {(appState === AppState.IDLE ||
            appState === AppState.PROCESSING_FONT) && (
            <div className="max-w-md mx-auto space-y-4">
              <div className="w-16 h-16 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <UploadFileIcon />
              </div>
              <h2 className="text-2xl font-bold text-stone-900">
                Upload Modern Hangul Font
              </h2>
              <p className="text-stone-600">
                Select a <code className="bg-stone-100 px-1 rounded">.ttf</code>{" "}
                or <code className="bg-stone-100 px-1 rounded">.otf</code> file.
                We will analyze its style to generate Old Hangul characters.
              </p>
              <div className="relative">
                <Button
                  component="label"
                  role={undefined}
                  variant="contained"
                  startIcon={<UploadFileIcon />}
                  loading={appState === AppState.PROCESSING_FONT}
                >
                  Upload font file
                  <VisuallyHiddenInput
                    type="file"
                    accept={FONT_MIME_TYPES}
                    onChange={(event) => handleFileChange(event.target.files)}
                  />
                </Button>
              </div>
            </div>
          )}

          {appState !== AppState.IDLE &&
            appState !== AppState.PROCESSING_FONT &&
            appState !== AppState.ERROR &&
            fontMetadata && (
              <div className="flex items-center justify-between text-left">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-green-50 text-green-600 rounded-full flex items-center justify-center">
                    <CheckCircleIcon />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-stone-900">
                      {fontMetadata.name}
                    </h3>
                    <p className="text-sm text-stone-500">
                      {fontMetadata.family} • {fontMetadata.style} •{" "}
                      {fontMetadata.numGlyphs} Glyphs
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    const jamoVarsets =
                      store.getState().font.present.jamoVarsets;
                    if (jamoVarsets) {
                      saveFont(jamoVarsets);
                      setAppState(AppState.IDLE);
                      setCurSavedFontIdx(null);
                    }
                  }}
                  className="text-sm text-stone-500 hover:text-stone-800 underline"
                >
                  Change Font
                </button>
              </div>
            )}
        </section>

        {/* Step 2: Analysis & Generate */}
        {(appState === AppState.READY_TO_GENERATE ||
          appState === AppState.GENERATING ||
          appState === AppState.COMPLETED) &&
          previewImage && (
            <section className="bg-white rounded-2xl p-8 shadow-sm border border-stone-200">
              <Editor
                fontProcessor={fontProcessor}
                previewImage={previewImage}
                onSaveFont={(newJamoVarsets) => saveFont(newJamoVarsets)}
              />
            </section>
          )}
      </main>
      <Snackbar
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        open={snackbarOpen}
        autoHideDuration={500}
        onClose={() => setSnackbarOpen(false)}
        message={snackbarMsg}
      />
    </div>
  );
}
