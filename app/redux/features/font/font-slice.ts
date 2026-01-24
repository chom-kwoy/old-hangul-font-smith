import { PayloadAction, createSlice } from "@reduxjs/toolkit";
import undoable from "redux-undo";

import { CONSONANT_VARSET_NAMES, VOWEL_VARSET_NAMES } from "@/app/hangul/jamos";
import { SerializedPathData } from "@/app/pathUtils/PathData";
import {
  ConsonantVarsetType,
  JamoVarsets,
  VarsetType,
  VowelVarsetType,
} from "@/app/utils/types";

interface FontState {
  jamoVarsets?: JamoVarsets;
}

const initialState: FontState = {};

const fontSlice = createSlice({
  name: "font",
  initialState,
  reducers: {
    fontLoaded(state, action: PayloadAction<JamoVarsets>) {
      state.jamoVarsets = action.payload;
    },
    pathUpdated(
      state,
      action: PayloadAction<{
        jamoName: string;
        varsetName: VarsetType;
        path: SerializedPathData | null;
      }>,
    ) {
      if (!state.jamoVarsets) return;
      const varset = state.jamoVarsets[action.payload.jamoName];
      if (!varset) return;
      if (varset.type === "consonant") {
        const v = action.payload.varsetName as ConsonantVarsetType;
        if (CONSONANT_VARSET_NAMES.includes(v)) {
          varset[v] = action.payload.path;
        }
      } else if (varset.type === "vowel") {
        const v = action.payload.varsetName as VowelVarsetType;
        if (VOWEL_VARSET_NAMES.includes(v)) {
          varset[v] = action.payload.path;
        }
      }
    },
  },
});

export const { fontLoaded, pathUpdated } = fontSlice.actions;
export default undoable(fontSlice.reducer);
