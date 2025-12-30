import DownloadIcon from "@mui/icons-material/Download";
import {
  Autocomplete,
  FormControl,
  InputLabel,
  TextField,
} from "@mui/material";
import Button from "@mui/material/Button";
import { Box } from "@mui/system";
import { AdaptiveSelect, AdaptiveSelectItem } from "adaptive-material-ui";
import React, { useState } from "react";

import { ReactFabricCanvas } from "@/app/canvas";
import { downloadArrayBufferAsFile } from "@/app/download";
import { FontProcessor } from "@/app/fontProcessor";
import { HANGUL_DATA, unicodeNameToHangul } from "@/app/hangulData";
import { getExampleEnvPaths, getVarset } from "@/app/jamos";
import { ConsonantInfo, JamoVarsets, VarsetType, VowelInfo } from "@/app/types";

export function Editor({
  fontProcessor,
  previewImage,
  varsets,
}: {
  fontProcessor: FontProcessor;
  previewImage: string;
  varsets: JamoVarsets;
}) {
  type JamoItem = { label: string; name: string; value: string };
  const JAMO_LIST = React.useMemo(
    () =>
      [
        ...HANGUL_DATA.consonantInfo.values(),
        ...HANGUL_DATA.vowelInfo.values(),
      ].map((info) => ({
        label: `${unicodeNameToHangul(info.unicode_name)} (${info.canonical})`,
        name: info.unicode_name,
        value: info.canonical,
      })),
    [],
  );

  const [selectedJamo, setSelectedJamo] = useState<JamoItem>(JAMO_LIST[0]);
  const [selectedVarsetName, setSelectedVarsetName] =
    useState<VarsetType>("canon");

  const selectedJamoInfo =
    HANGUL_DATA.consonantInfo.get(selectedJamo.name) ??
    HANGUL_DATA.vowelInfo.get(selectedJamo.name);
  const varsetList = getAvailableVarsetList(selectedJamoInfo);

  const curVarsets = (varsets.consonants.get(selectedJamo.name) ??
    varsets.vowel.get(selectedJamo.name))!;
  const selectedVarset = getVarset(curVarsets, selectedVarsetName);

  const bgPaths = getExampleEnvPaths(
    varsets,
    selectedJamo.name,
    selectedVarsetName,
    10,
  ).flat();

  return (
    <>
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
                options={JAMO_LIST}
                renderInput={(params) => <TextField {...params} label="Jamo" />}
                value={selectedJamo}
                onChange={(event, newValue) => {
                  if (newValue !== null) {
                    setSelectedJamo(newValue);
                    const newSelectedJamoInfo =
                      HANGUL_DATA.consonantInfo.get(newValue.name) ??
                      HANGUL_DATA.vowelInfo.get(newValue.name);
                    const newJamoHasCurVarset = getAvailableVarsetList(
                      newSelectedJamoInfo,
                    ).some(([varsetName]) => varsetName == selectedVarsetName);
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
                <InputLabel id="varset-select-label">Variant Set</InputLabel>
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
    </>
  );
}

function getAvailableVarsetList(
  selectedJamoInfo: ConsonantInfo | VowelInfo | undefined,
): [VarsetType, string][] {
  const varsetList: [VarsetType, string][] = [["canon", "단독형"]];
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
