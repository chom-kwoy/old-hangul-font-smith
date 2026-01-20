import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { loadPyodide } from "pyodide";

import { Gsub, Ttx } from "@/app/processors/ttxTypes";

import PYTHON_SRC from "./fontWorker.py";

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

async function getGsubTable(fontData: Uint8Array): Promise<Gsub> {
  const pyodide = await loadPyodidePromise;

  const xml: string = pyodide.runPython(
    `ttx_processor.getGsubTable(font_data)`,
    { locals: pyodide.toPy({ font_data: fontData }) },
  );

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

type FontWorkerMessage = GenerateFontMessage;

interface GenerateFontMessage {
  type: "generateFont";
  buffer: ArrayBuffer;
}

addEventListener("message", async (event: MessageEvent<FontWorkerMessage>) => {
  console.log("Font worker received message:", event.data);
  if (event.data.type === "generateFont") {
    console.log("Generating font from buffer...");
    // dump the font to TTX
    const gsub = await getGsubTable(new Uint8Array(event.data.buffer));

    console.log(gsub);
  }
});
