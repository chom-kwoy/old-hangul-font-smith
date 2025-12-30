"use client";

import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DownloadIcon from "@mui/icons-material/Download";
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
import { AdaptiveSelect, AdaptiveSelectItem } from "adaptive-material-ui";
import React, { useState } from "react";

import { downloadArrayBufferAsFile } from "@/app/download";
import { ReactFabricCanvas } from "@/app/fabric";
import { FontProcessor } from "@/app/fontProcessor";
import { HANGUL_DATA } from "@/app/hangulData";
import { getExampleEnvPaths, getVarset } from "@/app/jamos";
import {
  ConsonantInfo,
  FontMetadata,
  JamoVarsets,
  VowelInfo,
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

function getAvailableVarsetList(
  selectedJamoInfo: ConsonantInfo | VowelInfo | undefined,
): [string, string][] {
  const varsetList: [string, string][] = [["canon", "단독형"]];
  if (selectedJamoInfo) {
    if (
      selectedJamoInfo.type === "consonant" &&
      selectedJamoInfo.leading !== null
    ) {
      varsetList.push(["l1", "초성 1벌 (받침없는 ㅏ ㅐ ...)"]);
      varsetList.push(["l2", "초성 2벌 (받침없는 ㅗ ㅛ ㅡ)"]);
      varsetList.push(["l3", "초성 3벌 (받침없는 ㅜ ㅠ)"]);
      varsetList.push(["l4", "초성 4벌 (받침없는 ㅘ ㅙ ㅚ ㅢ)"]);
      varsetList.push(["l5", "초성 5벌 (받침없는 ㅝ ㅞ ㅟ)"]);
      varsetList.push(["l6", "초성 6벌 (받침있는 ㅏ ㅐ ...)"]);
      varsetList.push(["l7", "초성 7벌 (받침있는 ㅗ ㅛ ㅜ ㅠ ㅡ)"]);
      varsetList.push(["l8", "초성 8벌 (받침있는 ㅘ ㅙ ...)"]);
    }
    if (
      selectedJamoInfo.type === "consonant" &&
      selectedJamoInfo.trailing !== null
    ) {
      varsetList.push(["t1", "종성 1벌 (중성 ㅏ ㅑ ㅘ 와 결합)"]);
      varsetList.push(["t2", "종성 2벌 (중성 ㅓ ㅕ ㅚ 등과 결합)"]);
      varsetList.push(["t3", "종성 3벌 (중성 ㅐ ㅒ ㅔ 등과 결합)"]);
      varsetList.push(["t4", "종성 4벌 (중성 ㅗ ㅛ ㅜ 등과 결합)"]);
    }
    if (selectedJamoInfo.type === "vowel" && selectedJamoInfo.vowel !== null) {
      varsetList.push(["v1", "중성 1벌 (받침없는 [ㄱ ㅋ]과 결합)"]);
      varsetList.push(["v2", "중성 2벌 (받침없는 [ㄱ ㅋ] 제외)"]);
      varsetList.push(["v3", "중성 3벌 (받침있는 [ㄱ ㅋ]과 결합)"]);
      varsetList.push(["v4", "중성 4벌 (받침있는 [ㄱ ㅋ] 제외)"]);
    }
  }
  return varsetList;
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

  const selectedJamoInfo =
    HANGUL_DATA.consonantInfo.get(selectedJamo.name) ??
    HANGUL_DATA.vowelInfo.get(selectedJamo.name);
  const varsetList = getAvailableVarsetList(selectedJamoInfo);

  const curVarsets =
    varsets?.consonants?.get(selectedJamo.name) ??
    varsets?.vowel?.get(selectedJamo.name);
  const selectedVarset = curVarsets
    ? getVarset(curVarsets, selectedVarsetName)
    : null;

  const bgPaths = varsets
    ? getExampleEnvPaths(
        varsets,
        selectedJamo.name,
        selectedVarsetName,
        10,
      ).flat()
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
      "유월 활짝 편 배꽃들 밑에 요 콩새야,",
    );
    setPreviewImage(sampleImage);

    setAppState(AppState.READY_TO_GENERATE);
  }

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-stone-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-amber-600 rounded-lg flex items-center justify-center text-white font-bold text-xl shadow-md">
              옛
            </div>
            <div>
              <h1 className="text-xl font-bold text-stone-900 leading-tight">
                Old Hangul Font Smith
              </h1>
              <p className="text-xs text-stone-500 font-medium">
                Typographic Hell
              </p>
            </div>
          </div>
          <div className="text-xs font-mono bg-stone-100 px-3 py-1 rounded text-stone-500">
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
          <div className="bg-white rounded-2xl p-8 shadow-sm border border-stone-200 text-center">
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
                  Select a{" "}
                  <code className="bg-stone-100 px-1 rounded">.ttf</code> or{" "}
                  <code className="bg-stone-100 px-1 rounded">.otf</code> file.
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
                  onClick={() => setAppState(AppState.IDLE)}
                  className="text-sm text-stone-500 hover:text-stone-800 underline"
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
          appState === AppState.COMPLETED) &&
          varsets &&
          curVarsets &&
          bgPaths && (
            <section className="bg-white rounded-2xl p-8 shadow-sm border border-stone-200">
              <div className="flex items-center gap-3 mb-6">
                <h2 className="text-xl font-bold text-stone-900">
                  Style Analysis & Generation
                </h2>
              </div>

              <div className="space-y-6">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-stone-700 uppercase tracking-wide">
                    Input Sample
                  </p>
                  <div className="border border-stone-200 rounded-lg p-4 bg-white overflow-hidden">
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
                  <p className="text-sm font-medium text-stone-700 uppercase tracking-wide">
                    Design
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
                            const newSelectedJamoInfo =
                              HANGUL_DATA.consonantInfo.get(newValue.name) ??
                              HANGUL_DATA.vowelInfo.get(newValue.name);
                            const newJamoHasCurVarset = getAvailableVarsetList(
                              newSelectedJamoInfo,
                            ).some(
                              ([varsetName]) =>
                                varsetName == selectedVarsetName,
                            );
                            if (!newJamoHasCurVarset) {
                              setSelectedVarsetName("canon");
                            }
                          }
                        }}
                        disableClearable={true}
                      />
                    </div>
                    <div className="w-1/2 ps-2">
                      <FormControl fullWidth>
                        <InputLabel id="varset-select-label">
                          Variant Set
                        </InputLabel>
                        <AdaptiveSelect
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
                          {varsetList.map(([setName, description], i) => (
                            <AdaptiveSelectItem
                              key={i}
                              value={setName}
                              className="flex justify-between"
                            >
                              <span>{description}</span>
                              <ReactFabricCanvas
                                className="border border-stone-200 rounded-lg"
                                width={100}
                                height={100}
                                path={getVarset(curVarsets, setName)}
                                bgPaths={[]}
                                interactive={false}
                              />
                            </AdaptiveSelectItem>
                          ))}
                        </AdaptiveSelect>
                      </FormControl>
                    </div>
                  </div>

                  <ReactFabricCanvas
                    className="border border-stone-200 rounded-lg"
                    width={480}
                    height={480}
                    path={selectedVarset}
                    bgPaths={bgPaths}
                    interactive={true}
                  />
                </div>

                <div className="text-center">
                  <Button
                    variant="contained"
                    startIcon={<DownloadIcon />}
                    onClick={() => {
                      const buffer = fontProcessor.addOldHangulSupport();
                      downloadArrayBufferAsFile(
                        buffer,
                        "font.otf",
                        "application/octet-stream",
                      );
                    }}
                  >
                    Download Font
                  </Button>
                </div>
              </div>
            </section>
          )}
      </main>
    </div>
  );
}
