"use client";

import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import {
  Autocomplete,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
} from "@mui/material";
import Button from "@mui/material/Button";
import { Box, styled } from "@mui/system";
import { TComplexPathData } from "fabric";
import { METHODS } from "node:http";
import React, { useState } from "react";

import { ReactFabricCanvas } from "@/app/fabric";
import { FontProcessor } from "@/app/fontProcessor";
import { HANGUL_DATA } from "@/app/hangulData";
import {
  ConsonantSets,
  FontMetadata,
  JamoVarsets,
  VowelSets,
} from "@/app/types";

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

function getVarset(varsets: ConsonantSets | VowelSets, varsetName: string) {
  let varset: TComplexPathData | null = null;
  if (varsets.type === "consonant") {
    // prettier-ignore
    switch (varsetName) {
      case "canon": varset = varsets.canonical ?? null; break;
      case "l1": varset = varsets.leadingSet1 ?? null; break;
      case "l2": varset = varsets.leadingSet2 ?? null; break;
      case "l3": varset = varsets.leadingSet3 ?? null; break;
      case "l4": varset = varsets.leadingSet4 ?? null; break;
      case "l5": varset = varsets.leadingSet5 ?? null; break;
      case "l6": varset = varsets.leadingSet6 ?? null; break;
      case "l7": varset = varsets.leadingSet7 ?? null; break;
      case "l8": varset = varsets.leadingSet8 ?? null; break;
      case "t1": varset = varsets.trailingSet1 ?? null; break;
      case "t2": varset = varsets.trailingSet2 ?? null; break;
      case "t3": varset = varsets.trailingSet3 ?? null; break;
      case "t4": varset = varsets.trailingSet4 ?? null; break;
    }
  } else {
    // prettier-ignore
    switch (varsetName) {
      case "canon": varset = varsets.canonical ?? null; break;
      case "v1": varset = varsets.set1 ?? null; break;
      case "v2": varset = varsets.set2 ?? null; break;
      case "v3": varset = varsets.set3 ?? null; break;
      case "v4": varset = varsets.set4 ?? null; break;
    }
  }
  return varset;
}

export default function Home() {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [fontProcessor] = useState(() => new FontProcessor());
  const [fontMetadata, setFontMetadata] = useState<FontMetadata | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [varsets, setVarsets] = useState<JamoVarsets | null>(null);

  type JamoItem = { label: string; name: string; value: string };
  const jamoList = React.useMemo(
    () =>
      [
        ...HANGUL_DATA.consonantInfo.values(),
        ...HANGUL_DATA.vowelInfo.values(),
      ].map((info) => ({
        label: `${info.unicode_name} (${info.canonical})`,
        name: info.unicode_name,
        value: info.canonical,
      })),
    [],
  );
  const [selectedJamo, setSelectedJamo] = useState<JamoItem>(jamoList[0]);
  const [selectedVarsetName, setSelectedVarsetName] = useState<string>("canon");

  const curVarsets =
    varsets?.consonants?.get(selectedJamo.name) ??
    varsets?.vowel?.get(selectedJamo.name);

  const varsetList =
    curVarsets?.type === "consonant"
      ? [
          ["canon", "Canonical (단독형)"],
          ["l1", "Leading 1 (받침없는 ㅏ ㅐ ...)"],
          ["l2", "Leading 2 (받침없는 ㅗ ㅛ ㅡ)"],
          ["l3", "Leading 3 (받침없는 ㅜ ㅠ)"],
          ["l4", "Leading 4 (받침없는 ㅘ ㅙ ㅚ ㅢ)"],
          ["l5", "Leading 5 (받침없는 ㅝ ㅞ ㅟ)"],
          ["l6", "Leading 6 (받침있는 ㅏ ㅐ ...)"],
          ["l7", "Leading 7 (받침있는 ㅗ ㅛ ㅜ ㅠ ㅡ)"],
          ["l8", "Leading 8 (받침있는 ㅘ ㅙ ...)"],
          ["t1", "Trailing 1 (중성 ㅏ ㅑ ㅘ 와 결합)"],
          ["t2", "Trailing 2 (중성 ㅓ ㅕ ㅚ 등과 결합)"],
          ["t3", "Trailing 3 (중성 ㅐ ㅒ ㅔ 등과 결합)"],
          ["t4", "Trailing 4 (중성 ㅗ ㅛ ㅜ 등과 결합)"],
        ]
      : [
          ["canon", "Canonical (단독형)"],
          ["v1", "Vowel 1 (받침없는 [ㄱ ㅋ]과 결합)"],
          ["v2", "Vowel 2 (받침없는 [ㄱ ㅋ] 제외)"],
          ["v3", "Vowel 3 (받침있는 [ㄱ ㅋ]과 결합)"],
          ["v4", "Vowel 4 (받침있는 [ㄱ ㅋ] 제외)"],
        ];

  const selectedVarset = curVarsets
    ? getVarset(curVarsets, selectedVarsetName)
    : null;

  async function handleFileChange(files: FileList | null) {
    if (!files || !files.length) {
      setAppState(AppState.ERROR);
      return;
    }

    setAppState(AppState.PROCESSING_FONT);

    const metadata = await fontProcessor.loadFont(files[0]);
    setFontMetadata(metadata);

    const varsets = fontProcessor.analyzeJamoVarsets();
    setVarsets(varsets);

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

                <div className="flex">
                  <div className="w-1/2 pe-2">
                    <Autocomplete
                      disablePortal
                      options={jamoList}
                      renderInput={(params) => (
                        <TextField {...params} label="Jamo" />
                      )}
                      value={selectedJamo}
                      onChange={(event, newValue) => {
                        if (newValue !== null) {
                          setSelectedJamo(newValue);
                          // reset selected varset name if jamo type changes
                          const newJamoType = HANGUL_DATA.consonantInfo.has(
                            newValue.name,
                          )
                            ? "consonant"
                            : "vowel";
                          if (curVarsets?.type !== newJamoType) {
                            setSelectedVarsetName("canon");
                          }
                        }
                      }}
                    />
                  </div>
                  <div className="w-1/2 ps-2">
                    <FormControl fullWidth>
                      <InputLabel id="varset-select-label">
                        Variant Set
                      </InputLabel>
                      <Select
                        labelId="varset-select-label"
                        label={"Variant Set"}
                        value={selectedVarsetName}
                        onChange={(event) => {
                          setSelectedVarsetName(event.target.value);
                        }}
                        MenuProps={{
                          PaperProps: {
                            style: {
                              maxHeight: 400, // Set a fixed max height in pixels
                            },
                          },
                        }}
                        renderValue={(value) => (
                          <Box>
                            {varsetList.find((item) => item[0] === value)![1]}
                          </Box>
                        )}
                      >
                        {curVarsets &&
                          varsetList.map(([setName, description], i) => (
                            <MenuItem
                              key={i}
                              value={setName}
                              className="flex justify-between"
                            >
                              <span>{description}</span>
                              <ReactFabricCanvas
                                className="border border-slate-200 rounded-lg"
                                width={100}
                                height={100}
                                path={getVarset(curVarsets, setName)}
                                interactive={false}
                              />
                            </MenuItem>
                          ))}
                      </Select>
                    </FormControl>
                  </div>
                </div>

                <ReactFabricCanvas
                  className="border border-slate-200 rounded-lg"
                  width={480}
                  height={480}
                  path={selectedVarset}
                  interactive={true}
                />
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
