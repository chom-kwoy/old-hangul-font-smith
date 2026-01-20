import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { loadPyodide } from "pyodide";

import { FeatureRecord, Gsub, Lookup, Ttx } from "@/app/processors/ttxTypes";
import { precomposedLigatures } from "@/app/utils/hangulData";

import PYTHON_SRC from "./fontWorker.py";

type Pyodide = Awaited<ReturnType<typeof loadPyodide>>;

async function loadFontWorkerPyodide() {
  console.log("Loading Pyodide for Font Worker...");
  const pyodideLib = await loadPyodide({
    indexURL: "https://cdn.jsdelivr.net/pyodide/v0.29.1/full/",
  });
  console.log("Pyodide loaded successfully, version:", pyodideLib.version);
  console.log("Available globals methods:", Object.keys(pyodideLib.globals));

  console.log("Installing FontTools and dependencies...");
  // First load micropip package via JavaScript
  await pyodideLib.loadPackage(["micropip"]);

  // Then install our dependencies
  await pyodideLib.runPythonAsync(`
    import micropip
    await micropip.install(['fonttools', 'brotli'])
  `);

  // Load our Python TTX reference implementation
  console.log("Loading TTX implementation...");
  await pyodideLib.runPythonAsync(PYTHON_SRC);

  console.log("Pyodide TTX initialized successfully!");
  return pyodideLib;
}
const loadPyodidePromise = loadFontWorkerPyodide();

class FontObject {
  declare pyodide: Pyodide;
  declare ttxProcessor: unknown;
  declare cmap: Record<number, string>;

  constructor(pyodide: Pyodide, fontData: Uint8Array) {
    this.pyodide = pyodide;
    this.ttxProcessor = pyodide.runPython(`PyodideTTXProcessor(font_data)`, {
      locals: pyodide.toPy({ font_data: fontData }),
    });
    this.cmap = pyodide
      .runPython(`ttxProcessor.getCmap()`, {
        locals: pyodide.toPy({ ttxProcessor: this.ttxProcessor }),
      })
      .toJs();
  }

  getGsubTable(): Gsub {
    const xml: string = this.pyodide.runPython(`ttxProcessor.getGsubTable()`, {
      locals: this.pyodide.toPy({ ttxProcessor: this.ttxProcessor }),
    });

    const parser = new XMLParser({
      alwaysCreateTextNode: true,
      ignoreAttributes: false,
      isArray: (name, jpath, isLeafNode, isAttribute) => {
        return !isAttribute;
      },
    });

    const ttx: Ttx = parser.parse(xml);
    const gsub = ttx.ttFont[0].GSUB;

    // prettier-ignore
    const emptyGsub: Gsub = {
      'Version': [{
        '@_value': '0x00010000',
      }],
      'ScriptList': [{
        'ScriptRecord': [{
          '@_index': '0',
          'ScriptTag': [{
            '@_value': 'DFLT'
          }],
          'Script': [{
            'DefaultLangSys': [{
              'ReqFeatureIndex': [{
                '@_value': '65535',
              }],
              'FeatureIndex': [],
            }],
          }],
        }]
      }],
      'FeatureList': [{
        'FeatureRecord': [],
      }],
      'LookupList': [{
        'Lookup': [],
      }],
    };

    return gsub ? gsub[0] : emptyGsub;
  }

  findGlyphName(ch: string): string | undefined {
    const codepoint = ch.codePointAt(0);
    if (codepoint === undefined) return undefined;
    return this.cmap[codepoint];
  }
}

async function makeFont(fontData: ArrayBuffer) {
  const pyodide = await loadPyodidePromise;
  const ttx = new FontObject(pyodide, new Uint8Array(fontData));

  // dump the font to TTX
  const gsub = ttx.getGsubTable();
  console.log("Gsub table extracted:", gsub);

  // Add ljmo feature to the feature list
  const ljmoFeature: FeatureRecord = {
    "@_index": gsub.FeatureList[0].FeatureRecord.length.toFixed(0),
    FeatureTag: [{ "@_value": "ljmo" }],
    Feature: [{ LookupListIndex: [] }],
  };
  gsub.FeatureList[0].FeatureRecord.push(ljmoFeature);

  // Add vjmo feature to the feature list
  const vjmoFeature: FeatureRecord = {
    "@_index": gsub.FeatureList[0].FeatureRecord.length.toFixed(0),
    FeatureTag: [{ "@_value": "vjmo" }],
    Feature: [{ LookupListIndex: [] }],
  };
  gsub.FeatureList[0].FeatureRecord.push(vjmoFeature);

  // Add tjmo feature to the feature list
  const tjmoFeature: FeatureRecord = {
    "@_index": gsub.FeatureList[0].FeatureRecord.length.toFixed(0),
    FeatureTag: [{ "@_value": "tjmo" }],
    Feature: [{ LookupListIndex: [] }],
  };
  gsub.FeatureList[0].FeatureRecord.push(tjmoFeature);

  // Add ligature feature to the feature list
  const ccmpFeature: FeatureRecord = {
    "@_index": gsub.FeatureList[0].FeatureRecord.length.toFixed(0),
    FeatureTag: [{ "@_value": "ccmp" }],
    Feature: [{ LookupListIndex: [] }],
  };
  gsub.FeatureList[0].FeatureRecord.push(ccmpFeature);

  // Enable features for default language system
  const defaultFeatures =
    gsub.ScriptList[0].ScriptRecord[0].Script[0].DefaultLangSys[0].FeatureIndex;
  defaultFeatures.push({
    "@_index": defaultFeatures.length.toFixed(0),
    "@_value": ccmpFeature["@_index"],
  });
  defaultFeatures.push({
    "@_index": defaultFeatures.length.toFixed(0),
    "@_value": ljmoFeature["@_index"],
  });
  defaultFeatures.push({
    "@_index": defaultFeatures.length.toFixed(0),
    "@_value": vjmoFeature["@_index"],
  });
  defaultFeatures.push({
    "@_index": defaultFeatures.length.toFixed(0),
    "@_value": tjmoFeature["@_index"],
  });

  const substitutions: Map<string, Array<string>> = new Map();

  // Add 3-jamo ligatures
  const ligatureSubstLookup3: Lookup = {
    "@_index": gsub.LookupList[0].Lookup.length.toFixed(0),
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
    "@_index": ccmpFeature.Feature[0].LookupListIndex.length.toFixed(0),
    "@_value": ligatureSubstLookup3["@_index"],
  });

  console.log("Added 3-jamo ligature substitutions.");
}

type FontWorkerMessage = GenerateFontMessage;

interface GenerateFontMessage {
  type: "generateFont";
  buffer: ArrayBuffer;
}

addEventListener("message", async (event: MessageEvent<FontWorkerMessage>) => {
  console.log("Font worker received message:", event.data);
  if (event.data.type === "generateFont") {
    console.log("Generating font from buffer...");
    await makeFont(event.data.buffer);
  }
});
