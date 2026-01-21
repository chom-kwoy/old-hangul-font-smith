import DownloadIcon from "@mui/icons-material/Download";
import {
  Autocomplete,
  FormControl,
  InputLabel,
  Menu,
  MenuItem,
  TextField,
} from "@mui/material";
import Button from "@mui/material/Button";
import { Box } from "@mui/system";
import { AdaptiveSelect, AdaptiveSelectItem } from "adaptive-material-ui";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActionCreators } from "redux-undo";

import { GlyphView } from "@/app/components/GlyphView";
import { VarsetMapView } from "@/app/components/VarsetMapView";
import useComponentSize from "@/app/hooks/useComponentSize";
import { FontProcessor } from "@/app/processors/fontProcessor";
import { pathUpdated } from "@/app/redux/features/font/font-slice";
import { useAppDispatch, useAppSelector, useAppStore } from "@/app/redux/hooks";
import PathData from "@/app/utils/PathData";
import { HANGUL_DATA, unicodeNameToHangul } from "@/app/utils/hangulData";
import {
  getExampleEnvPaths,
  getSyllablesFor,
  getVarset,
} from "@/app/utils/jamos";
import { uniToPua } from "@/app/utils/puaUniConv";
import {
  ConsonantInfo,
  JamoVarsets,
  VarsetType,
  VowelInfo,
} from "@/app/utils/types";

export function Editor({
  fontProcessor,
  previewImage,
  onSaveFont,
}: {
  fontProcessor: FontProcessor;
  previewImage: string;
  onSaveFont: (jamoVarsets: JamoVarsets) => void;
}) {
  const store = useAppStore();
  const dispatch = useAppDispatch();

  // handle what happens on key press
  const handleKeyPress = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "z" && event.ctrlKey && !event.shiftKey) {
        // Ctrl+Z pressed
        const pastStates = store.getState().font.past;
        if (pastStates.length > 1) {
          dispatch(ActionCreators.undo());
        }
        event.preventDefault();
      } else if (
        (event.key === "y" && event.ctrlKey) ||
        (event.key === "Z" && event.ctrlKey && event.shiftKey)
      ) {
        // Ctrl+Y / Ctrl+Shift+Z pressed
        dispatch(ActionCreators.redo());
        event.preventDefault();
      } else if (event.key === "s" && event.ctrlKey) {
        const jamoVarsets = store.getState().font.present.jamoVarsets;
        if (jamoVarsets) {
          onSaveFont(jamoVarsets);
          event.preventDefault();
        }
      }
    },
    [onSaveFont, store, dispatch],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyPress);
    return () => {
      document.removeEventListener("keydown", handleKeyPress);
    };
  }, [handleKeyPress]);

  const [leftDivRef, leftDivSize] = useComponentSize<HTMLDivElement>();
  const [rightDivRef, rightDivSize] = useComponentSize<HTMLDivElement>();

  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);

  type JamoItem = { label: string; name: string; value: string };
  const JAMO_LIST = useMemo(
    () =>
      new Map<string, JamoItem>(
        [
          ...HANGUL_DATA.consonantInfo.values(),
          ...HANGUL_DATA.vowelInfo.values(),
        ].map((info) => [
          info.name,
          {
            label: `${unicodeNameToHangul(info.name)} (${info.canonical})`,
            name: info.name,
            value: info.canonical,
          },
        ]),
      ),
    [],
  );

  const [selectedJamoName, setSelectedJamoName] = useState<string>(
    JAMO_LIST.keys().toArray()[0],
  );
  const selectedJamo = JAMO_LIST.get(selectedJamoName)!;
  const [selectedVarsetName, setSelectedVarsetName] =
    useState<VarsetType>("canon");

  const selectedJamoInfo =
    HANGUL_DATA.consonantInfo.get(selectedJamoName) ??
    HANGUL_DATA.vowelInfo.get(selectedJamoName);
  const varsetList = getAvailableVarsetList(selectedJamoInfo);

  const jamoVarsets = useAppSelector(
    (state) => state.font.present.jamoVarsets,
  )!;
  const curVarsets = jamoVarsets[selectedJamoName];
  const selectedVarset = getVarset(curVarsets, selectedVarsetName);

  const bgPaths = useMemo(
    () =>
      getExampleEnvPaths(
        jamoVarsets,
        selectedJamoName,
        selectedVarsetName,
        10,
      ).flat(),
    [jamoVarsets, selectedJamoName, selectedVarsetName],
  );

  const updateSelectedItem = useCallback(
    (jamoInfo: ConsonantInfo | VowelInfo, varsetName: VarsetType) => {
      setSelectedJamoName(jamoInfo.name);
      setSelectedVarsetName(varsetName);
    },
    [],
  );

  const syllables = useMemo(
    () =>
      getSyllablesFor(selectedJamoName, selectedVarsetName, false)
        .filter((syllable) => {
          const pua = uniToPua(syllable);
          return pua.length === 1 && fontProcessor.font?.hasChar(pua);
        })
        .toArray(),
    [selectedJamoName, selectedVarsetName, fontProcessor],
  );

  const setCurrentPath = useCallback(
    (newPath: PathData | null) => {
      dispatch(
        pathUpdated({
          jamoName: selectedJamoName,
          varsetName: selectedVarsetName,
          path: newPath?.serialize() ?? null,
        }),
      );
    },
    [dispatch, selectedJamoName, selectedVarsetName],
  );

  const [isDownloadLoading, setIsDownloadLoading] = useState<boolean>(false);

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
            <img
              src={previewImage}
              alt="Font Preview"
              className="h-16 object-contain opacity-80"
            />
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-stone-700 uppercase tracking-wide">
            Design
          </p>

          <div className="flex">
            <div className="w-1/2 pe-1">
              <Autocomplete
                disablePortal
                options={JAMO_LIST.values().toArray()}
                renderInput={(params) => <TextField {...params} label="Jamo" />}
                value={selectedJamo}
                onChange={(event, newValue) => {
                  if (newValue !== null) {
                    setSelectedJamoName(newValue.name);
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
            <div className="w-1/2 ps-1">
              <FormControl fullWidth>
                <InputLabel id="varset-select-label">Variant Set</InputLabel>
                <AdaptiveSelect
                  variant="outlined"
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
                      <GlyphView
                        className="outline outline-stone-200 rounded-lg overflow-hidden"
                        width={100}
                        height={100}
                        path={getVarset(curVarsets, setName)}
                        interactive={false}
                      />
                    </AdaptiveSelectItem>
                  ))}
                </AdaptiveSelect>
              </FormControl>
            </div>
          </div>

          <div className="flex">
            <div ref={leftDivRef} className="w-1/3 pe-1">
              <GlyphView
                className="outline outline-stone-200 rounded-lg overflow-hidden"
                width={leftDivSize.width}
                height={leftDivSize.width}
                path={selectedVarset}
                bgPaths={bgPaths}
                interactive={true}
                onResetToSyllable={setAnchorEl}
                onPathChanged={setCurrentPath}
                glyphName={`${selectedJamoName}-${selectedVarsetName}`}
              />
              <Menu
                anchorEl={anchorEl}
                open={open}
                onClose={() => setAnchorEl(null)}
                style={{ maxHeight: 400 }}
              >
                {syllables.map((syllable, idx) => (
                  <MenuItem
                    key={idx}
                    onClick={() => {
                      setAnchorEl(null);
                      setCurrentPath(
                        fontProcessor.getPath(
                          syllable.length === 1 ? syllable : uniToPua(syllable),
                        ),
                      );
                    }}
                  >
                    {syllable}
                  </MenuItem>
                ))}
              </Menu>
              <div className="text-stone-500 text-sm [font-variant:small-caps]">
                Use ctrl+mouse wheel to zoom, ctrl+drag to pan
              </div>
            </div>
            <div ref={rightDivRef} className="w-2/3 text-stone-700 ps-1">
              <VarsetMapView
                className="outline outline-stone-200"
                width={rightDivSize.width}
                varsets={jamoVarsets}
                onItemClick={updateSelectedItem}
                selectedJamoName={selectedJamoName}
                selectedVarsetName={selectedVarsetName}
              />
            </div>
          </div>
        </div>

        <div className="text-center">
          <Button
            variant="contained"
            startIcon={<DownloadIcon />}
            onClick={() => {
              setIsDownloadLoading(true);
              const jamoVarsets = store.getState().font.present.jamoVarsets;
              fontProcessor.downloadFont(jamoVarsets!).finally(() => {
                setIsDownloadLoading(false);
              });
            }}
            loading={isDownloadLoading}
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
