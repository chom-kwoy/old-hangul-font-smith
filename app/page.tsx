"use client";

import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import Button from "@mui/material/Button";
import { styled } from "@mui/system";
import App from "next/app";
import { useState } from "react";

import { FontProcessor } from "@/app/fontProcessor";
import { FontMetadata } from "@/app/types";

const VisuallyHiddenInput = styled("input")({
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  height: 1,
  overflow: "hidden",
  position: "absolute",
  bottom: 0,
  left: 0,
  whiteSpace: "nowrap",
  width: 1,
});

export enum AppState {
  IDLE,
  PROCESSING_FONT,
  READY_TO_GENERATE,
  GENERATING,
  COMPLETED,
  ERROR,
}

export default function Home() {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [fontProcessor] = useState(() => new FontProcessor());
  const [fontMetadata, setFontMetadata] = useState<FontMetadata | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  async function handleFileChange(files: FileList | null) {
    if (!files || !files.length) {
      setAppState(AppState.ERROR);
      return;
    }

    setAppState(AppState.PROCESSING_FONT);

    const metadata = await fontProcessor.loadFont(files[0]);
    setFontMetadata(metadata);

    fontProcessor.analyzeJamoSets();

    const sampleImage = fontProcessor.getSampleImage(
      "유월 활짝 편 배꽃들 밑에 요 콩새야",
    );
    setPreviewImage(sampleImage);

    setAppState(AppState.READY_TO_GENERATE);
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold text-xl shadow-md">
              옛
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 leading-tight">
                Old Hangul Font Smith
              </h1>
              <p className="text-xs text-slate-500 font-medium">
                AI-Powered Typography
              </p>
            </div>
          </div>
          <div className="text-xs font-mono bg-slate-100 px-3 py-1 rounded text-slate-500">
            v1.0.0
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-8 space-y-8">
        {/* Step 1: Upload */}
        <section
          className={`transition-all duration-500 ${appState === AppState.IDLE ? "opacity-100" : "opacity-100"}`}
        >
          <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200 text-center">
            {(appState === AppState.IDLE ||
              appState === AppState.PROCESSING_FONT) && (
              <div className="max-w-md mx-auto space-y-4">
                <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4">
                  <UploadFileIcon />
                </div>
                <h2 className="text-2xl font-bold text-slate-900">
                  Upload Modern Hangul Font
                </h2>
                <p className="text-slate-600">
                  Select a{" "}
                  <code className="bg-slate-100 px-1 rounded">.ttf</code> or{" "}
                  <code className="bg-slate-100 px-1 rounded">.otf</code> file.
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
                      onChange={(event) => handleFileChange(event.target.files)}
                    />
                  </Button>
                </div>
              </div>
            )}

            {appState !== AppState.IDLE && fontMetadata && (
              <div className="flex items-center justify-between text-left">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-green-50 text-green-600 rounded-full flex items-center justify-center">
                    <CheckCircleIcon />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-slate-900">
                      {fontMetadata.name}
                    </h3>
                    <p className="text-sm text-slate-500">
                      {fontMetadata.family} • {fontMetadata.style} •{" "}
                      {fontMetadata.numGlyphs} Glyphs
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setAppState(AppState.IDLE)}
                  className="text-sm text-slate-500 hover:text-slate-800 underline"
                >
                  Change Font
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Step 2: Analysis & Generate */}
        {(appState === AppState.READY_TO_GENERATE ||
          appState === AppState.GENERATING ||
          appState === AppState.COMPLETED) && (
          <section className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200">
            <div className="flex items-center gap-3 mb-6">
              <h2 className="text-xl font-bold text-slate-900">
                Style Analysis & Generation
              </h2>
            </div>

            <div className="space-y-6">
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700 uppercase tracking-wide">
                  Input Sample
                </p>
                <div className="border border-slate-200 rounded-lg p-4 bg-white overflow-hidden">
                  {previewImage && (
                    <img
                      src={previewImage}
                      alt="Font Preview"
                      className="h-16 object-contain opacity-80"
                    />
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700 uppercase tracking-wide">
                  Jamos
                </p>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
