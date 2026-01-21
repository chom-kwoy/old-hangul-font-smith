import { FontObject } from "@/app/processors/fontTools";
import {
  MessageToFontWorker,
  MessageToMainThread,
} from "@/app/processors/fontWorkerTypes";
import { FeatureRecord, Gsub, Lookup } from "@/app/processors/ttxTypes";
import PathData from "@/app/utils/PathData";
import { HANGUL_DATA, precomposedLigatures } from "@/app/utils/hangulData";
import { LEADING_VARSET_NAMES, getJamoVarsetEnv } from "@/app/utils/jamos";
import { ConsonantSets, JamoVarsets } from "@/app/utils/types";

function addThreeJamoSubst(
  gsub: Gsub,
  ttx: FontObject,
  ccmpFeature: FeatureRecord,
) {
  // Add 3-jamo ligatures
  const ligatureSubstLookup3: Lookup = {
    "@_index": gsub.LookupList[0].Lookup.length.toFixed(),
    LookupType: [{ "@_value": "4" }],
    LookupFlag: [{ "@_value": "0" }],
    LigatureSubst: [
      {
        "@_index": "0",
        LigatureSet: [],
      },
    ],
  };
  gsub.LookupList[0].Lookup.push(ligatureSubstLookup3);

  for (const [first, ligatures] of precomposedLigatures(3).entries()) {
    const firstGlyphName = ttx.findGlyphName(first);
    if (firstGlyphName === undefined) {
      console.error(`Glyph for codepoint ${first} not found`);
      continue;
    }

    const ligatureList: {
      "@_components": string;
      "@_glyph": string;
    }[] = [];

    for (const lig of ligatures) {
      const rest = lig.rest.map((ch) => ttx.findGlyphName(ch));
      const composed = ttx.findGlyphName(lig.composed);
      if (rest.some((ch) => ch === undefined) || composed === undefined) {
        console.error(
          `Glyph for codepoint ${lig.composed} or its components not found`,
        );
        continue;
      }
      ligatureList.push({
        "@_components": rest.join(","),
        "@_glyph": composed,
      });
    }

    if (ligatureList.length > 0) {
      ligatureSubstLookup3.LigatureSubst![0].LigatureSet.push({
        "@_glyph": firstGlyphName,
        Ligature: ligatureList,
      });
    }
  }

  ccmpFeature.Feature[0].LookupListIndex.push({
    "@_index": ccmpFeature.Feature[0].LookupListIndex.length.toFixed(),
    "@_value": ligatureSubstLookup3["@_index"],
  });
}

function addTwoJamoSubst(
  gsub: Gsub,
  ttx: FontObject,
  ccmpFeature: FeatureRecord,
) {
  // Add ligatures for 2-jamo precomposed glyphs
  const chainSubstLookup: Lookup = {
    "@_index": gsub.LookupList[0].Lookup.length.toFixed(),
    LookupType: [{ "@_value": "6" }],
    LookupFlag: [{ "@_value": "0" }],
    ChainContextSubst: [],
  };
  gsub.LookupList[0].Lookup.push(chainSubstLookup);

  const ligatureSubstLookup2: Lookup = {
    "@_index": gsub.LookupList[0].Lookup.length.toFixed(),
    LookupType: [{ "@_value": "4" }],
    LookupFlag: [{ "@_value": "0" }],
    LigatureSubst: [
      {
        "@_index": "0",
        LigatureSet: [],
      },
    ],
  };
  gsub.LookupList[0].Lookup.push(ligatureSubstLookup2);

  const trailingJamoGlyphs = HANGUL_DATA.consonantInfo
    .values()
    .map((jamo) => jamo.trailing)
    .filter((jamo) => jamo !== null)
    .map((jamo) => ttx.findGlyphName(jamo))
    .filter((jamo) => jamo !== undefined)
    .toArray()
    .toSorted() // Sort by glyph ids
    .map((jamo) => ({ "@_value": jamo }));

  // Skip composition if trailing jamo is present
  for (const [first, ligatures] of precomposedLigatures(2).entries()) {
    const firstGlyphName = ttx.findGlyphName(first);
    if (firstGlyphName === undefined) {
      console.error(`Glyph for codepoint ${first} not found`);
      continue;
    }

    for (const lig of ligatures) {
      const rest = ttx.findGlyphName(lig.rest[0]);
      if (rest === undefined) {
        console.error(`Glyph for codepoint ${lig.rest[0]} not found`);
        continue;
      }

      chainSubstLookup.ChainContextSubst!.push({
        "@_index": chainSubstLookup.ChainContextSubst!.length.toFixed(),
        "@_Format": "3", // use coverage tables
        InputCoverage: [
          { "@_index": "0", Glyph: [{ "@_value": firstGlyphName }] },
          { "@_index": "1", Glyph: [{ "@_value": rest }] },
        ],
        BacktrackCoverage: [],
        LookAheadCoverage: [
          {
            "@_index": "0",
            Glyph: trailingJamoGlyphs,
          },
        ],
        SubstLookupRecord: [],
      });
    }
  }

  for (const [first, ligatures] of precomposedLigatures(2).entries()) {
    const firstGlyphName = ttx.findGlyphName(first);
    if (firstGlyphName === undefined) {
      continue;
    }

    const ligatureList: {
      "@_components": string;
      "@_glyph": string;
    }[] = [];

    for (const lig of ligatures) {
      const rest = ttx.findGlyphName(lig.rest[0]);
      const composed = ttx.findGlyphName(lig.composed);
      if (rest === undefined) {
        continue;
      }
      if (composed === undefined) {
        console.error(`Glyph for codepoint ${lig.composed} not found`);
        continue;
      }

      chainSubstLookup.ChainContextSubst!.push({
        "@_index": chainSubstLookup.ChainContextSubst!.length.toFixed(),
        "@_Format": "3", // use coverage tables
        InputCoverage: [
          { "@_index": "0", Glyph: [{ "@_value": firstGlyphName }] },
          { "@_index": "1", Glyph: [{ "@_value": rest }] },
        ],
        BacktrackCoverage: [],
        LookAheadCoverage: [],
        SubstLookupRecord: [
          {
            "@_index": "0",
            SequenceIndex: [{ "@_value": "0" }],
            LookupListIndex: [
              {
                "@_value": ligatureSubstLookup2["@_index"],
              },
            ],
          },
        ],
      });

      ligatureList.push({
        "@_components": rest,
        "@_glyph": composed,
      });
    }

    if (ligatureList.length > 0) {
      ligatureSubstLookup2.LigatureSubst![0].LigatureSet.push({
        "@_glyph": firstGlyphName,
        Ligature: ligatureList,
      });
    }
  }

  ccmpFeature.Feature[0].LookupListIndex.push({
    "@_index": ccmpFeature.Feature[0].LookupListIndex.length.toFixed(),
    "@_value": chainSubstLookup["@_index"],
  });
}

async function makeFont(
  fontData: ArrayBuffer,
  jamoVarsets: JamoVarsets,
): Promise<Blob> {
  const ttx = await FontObject.create(new Uint8Array(fontData));

  // dump the font to TTX
  const gsub = ttx.getGsubTable();
  console.log("Gsub table extracted:", gsub);

  // Add ljmo feature to the feature list
  const ljmoFeature: FeatureRecord = {
    "@_index": gsub.FeatureList[0].FeatureRecord.length.toFixed(),
    FeatureTag: [{ "@_value": "ljmo" }],
    Feature: [{ LookupListIndex: [] }],
  };
  gsub.FeatureList[0].FeatureRecord.push(ljmoFeature);

  // Add vjmo feature to the feature list
  const vjmoFeature: FeatureRecord = {
    "@_index": gsub.FeatureList[0].FeatureRecord.length.toFixed(),
    FeatureTag: [{ "@_value": "vjmo" }],
    Feature: [{ LookupListIndex: [] }],
  };
  gsub.FeatureList[0].FeatureRecord.push(vjmoFeature);

  // Add tjmo feature to the feature list
  const tjmoFeature: FeatureRecord = {
    "@_index": gsub.FeatureList[0].FeatureRecord.length.toFixed(),
    FeatureTag: [{ "@_value": "tjmo" }],
    Feature: [{ LookupListIndex: [] }],
  };
  gsub.FeatureList[0].FeatureRecord.push(tjmoFeature);

  // Add ligature feature to the feature list
  const ccmpFeature: FeatureRecord = {
    "@_index": gsub.FeatureList[0].FeatureRecord.length.toFixed(),
    FeatureTag: [{ "@_value": "ccmp" }],
    Feature: [{ LookupListIndex: [] }],
  };
  gsub.FeatureList[0].FeatureRecord.push(ccmpFeature);

  // Enable features for default language system
  const defaultFeatures =
    gsub.ScriptList[0].ScriptRecord[0].Script[0].DefaultLangSys[0].FeatureIndex;
  defaultFeatures.push({
    "@_index": defaultFeatures.length.toFixed(),
    "@_value": ccmpFeature["@_index"],
  });
  defaultFeatures.push({
    "@_index": defaultFeatures.length.toFixed(),
    "@_value": ljmoFeature["@_index"],
  });
  defaultFeatures.push({
    "@_index": defaultFeatures.length.toFixed(),
    "@_value": vjmoFeature["@_index"],
  });
  defaultFeatures.push({
    "@_index": defaultFeatures.length.toFixed(),
    "@_value": tjmoFeature["@_index"],
  });

  addThreeJamoSubst(gsub, ttx, ccmpFeature);
  console.log("Added 3-jamo ligature substitutions.");

  addTwoJamoSubst(gsub, ttx, ccmpFeature);
  console.log("Added 2-jamo ligature substitutions.");

  const substitutions: Map<string, Array<string>> = new Map();

  for (const varsetName of LEADING_VARSET_NAMES) {
    const jamoInfos = HANGUL_DATA.consonantInfo
      .values()
      .filter((info) => info.leading !== null)
      .toArray();

    const inputCoverage: {
      "@_value": string;
    }[] = jamoInfos
      .map((info) => {
        const glyphName = ttx.findGlyphName(info.leading!);
        if (glyphName === undefined) {
          console.log(`Glyph for jamo ${info.name} not found`);
        }
        return glyphName;
      })
      .filter((glyph) => glyph !== undefined)
      .map((glyph) => ({ "@_value": glyph }));

    const env = getJamoVarsetEnv(varsetName);

    const backtrackCoverage: {
      "@_index": string;
      Glyph: { "@_value": string }[];
    }[] = env.prevJamoNames.reverse().map((jamoList, index) => ({
      "@_index": index.toFixed(),
      Glyph: jamoList
        .map((jamo) => {
          const glyphName = ttx.findGlyphName(jamo);
          if (glyphName === undefined) {
            console.log(`Glyph for jamo ${jamo} not found`);
          }
          return glyphName;
        })
        .filter((glyph) => glyph !== undefined)
        .map((glyph) => ({ "@_value": glyph })),
    }));
    const lookAheadCoverage: {
      "@_index": string;
      Glyph: { "@_value": string }[];
    }[] = env.nextJamoNames.map((jamoList, index) => ({
      "@_index": index.toFixed(),
      Glyph: jamoList
        .map((jamo) => {
          const glyphName = ttx.findGlyphName(jamo);
          if (glyphName === undefined) {
            console.log(`Glyph for jamo ${jamo} not found`);
          }
          return glyphName;
        })
        .filter((glyph) => glyph !== undefined)
        .map((glyph) => ({ "@_value": glyph })),
    }));

    const substArray: {
      "@_in": string;
      "@_out": string;
    }[] = jamoInfos
      .map((info) => {
        const glyphName = ttx.findGlyphName(info.leading!);
        if (glyphName === undefined) {
          return undefined;
        }
        const varset = jamoVarsets[info.name] as ConsonantSets;
        const path = varset[varsetName];
        if (path === null) {
          return undefined;
        }
        return {
          "@_in": glyphName,
          "@_out": ttx.addGlyph(PathData.deserialize(path)),
        };
      })
      .filter((subst) => subst !== undefined);

    // Add lookups
    const singleSubstLookup: Lookup = {
      "@_index": gsub.LookupList[0].Lookup.length.toFixed(),
      LookupType: [{ "@_value": "1" }],
      LookupFlag: [{ "@_value": "0" }],
      SingleSubst: [{ Substitution: substArray }],
    };
    gsub.LookupList[0].Lookup.push(singleSubstLookup);

    const chainSubstLookup = {
      "@_index": gsub.LookupList[0].Lookup.length.toFixed(),
      LookupType: [{ "@_value": "6" }],
      LookupFlag: [{ "@_value": "0" }],
      ChainContextSubst: [
        {
          "@_index": "0",
          "@_Format": "3", // use coverage tables
          InputCoverage: [{ "@_index": "0", Glyph: inputCoverage }],
          BacktrackCoverage: backtrackCoverage,
          LookAheadCoverage: lookAheadCoverage,
          SubstLookupRecord: [
            {
              "@_index": "0",
              SequenceIndex: [{ "@_value": "0" }],
              LookupListIndex: [{ "@_value": singleSubstLookup["@_index"] }],
            },
          ],
        },
      ],
    };
    gsub.LookupList[0].Lookup.push(chainSubstLookup);

    ljmoFeature.Feature[0].LookupListIndex.push({
      "@_index": ljmoFeature.Feature[0].LookupListIndex.length.toFixed(),
      "@_value": chainSubstLookup["@_index"],
    });
  }

  // Add the modified GSUB table back to the font
  const result = ttx.addGsubTable(gsub);
  console.log("Modified GSUB table added back to font.");

  ttx.close(); // Clean up resources

  // Return the modified font data
  return new Blob([result], { type: "font/otf" });
}

addEventListener(
  "message",
  async (event: MessageEvent<MessageToFontWorker>) => {
    console.log("Font worker received message:", event.data);
    if (event.data.type === "generateFont") {
      console.log("Generating font from buffer...");
      const result = await makeFont(event.data.buffer, event.data.jamoVarsets);
      console.log("Font generation completed, sending back result...");
      postMessage({
        type: "fontBlob",
        blob: result,
      } as MessageToMainThread);
      console.log("Font blob sent back to main thread.");
    }
  },
);
