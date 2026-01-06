import { PayloadAction, createSlice } from "@reduxjs/toolkit";

import { CONSONANT_VARSET_NAMES, VOWEL_VARSET_NAMES } from "@/app/utils/jamos";
import {
  ConsonantVarsetType,
  JamoVarsets,
  PathData,
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
        path: PathData | null;
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
export default fontSlice.reducer;
