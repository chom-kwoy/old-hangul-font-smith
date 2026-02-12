import { TSimplePathData } from "fabric";
import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { loadPyodide } from "pyodide";

import PYTHON_SRC from "@/app/processors/makeFont/fontTools.py";
import { Gsub, Ttx } from "@/app/processors/makeFont/ttxTypes";

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

export const loadPyodidePromise = loadFontWorkerPyodide();

export class FontObject {
  declare pyodide: Pyodide;
  declare ttxProcessor: unknown;
  declare cmap: Record<number, string>;

  static async create(fontData: Uint8Array): Promise<FontObject> {
    const pyodide = await loadPyodidePromise;
    return new FontObject(pyodide, fontData);
  }

  constructor(pyodide: Pyodide, fontData: Uint8Array) {
    this.pyodide = pyodide;
    this.ttxProcessor = pyodide.runPython(`PyodideTTXProcessor(font_data)`, {
      locals: pyodide.toPy({ font_data: fontData }),
    });
    this.cmap = pyodide
      .runPython(`ttxProcessor.get_cmap()`, {
        locals: pyodide.toPy({ ttxProcessor: this.ttxProcessor }),
      })
      .toJs();
  }

  close(): void {
    this.pyodide.runPython(`ttxProcessor.close()`, {
      locals: this.pyodide.toPy({ ttxProcessor: this.ttxProcessor }),
    });
  }

  getGsubTable(): Gsub {
    const xml: string = this.pyodide.runPython(
      `ttxProcessor.get_gsub_table()`,
      { locals: this.pyodide.toPy({ ttxProcessor: this.ttxProcessor }) },
    );

    const parser = new XMLParser({
      alwaysCreateTextNode: true,
      ignoreAttributes: false,
      isArray: (name, jpath, isLeafNode, isAttribute) => {
        return !isAttribute;
      },
    });

    const ttx: Ttx = parser.parse(xml);
    console.log(ttx);
    const gsub = ttx.ttFont[0].GSUB;

    // prettier-ignore
    const emptyGsub: Gsub = {
      "Version": [{
        "@_value": "0x00010000"
      }],
      "ScriptList": [{
        "ScriptRecord": [{
          "@_index": "0",
          "ScriptTag": [{
            "@_value": "DFLT"
          }],
          "Script": [{
            "DefaultLangSys": [{
              "ReqFeatureIndex": [{
                "@_value": "65535"
              }],
              "FeatureIndex": []
            }]
          }]
        }]
      }],
      "FeatureList": [{
        "FeatureRecord": []
      }],
      "LookupList": [{
        "Lookup": []
      }]
    };

    return gsub ? gsub[0] : emptyGsub;
  }

  addGsubTable(gsub: Gsub): Uint8Array<ArrayBuffer> {
    const builder = new XMLBuilder({
      ignoreAttributes: false,
      format: true,
    });
    const gsubXml = builder.build({
      "?xml": [{ "@_version": "1.0", "@_encoding": "UTF-8" }],
      ttFont: [
        {
          "@_sfntVersion": "OTTO",
          "@_ttLibVersion": "4.56",
          GSUB: [gsub],
        },
      ],
    });

    const output = this.pyodide.runPython(
      `ttxProcessor.add_gsub_table(gsub_xml)`,
      {
        locals: this.pyodide.toPy({
          ttxProcessor: this.ttxProcessor,
          gsub_xml: gsubXml,
        }),
      },
    );
    return output.toJs();
  }

  findGlyphName(ch: string): string | undefined {
    const codepoint = ch.codePointAt(0);
    if (codepoint === undefined) return undefined;
    return this.cmap[codepoint];
  }

  getUnitsPerEm(): number {
    return this.pyodide.runPython(`ttxProcessor.get_units_per_em()`, {
      locals: this.pyodide.toPy({ ttxProcessor: this.ttxProcessor }),
    });
  }

  getTypoDescender(): number {
    return this.pyodide.runPython(`ttxProcessor.get_s_typo_descender()`, {
      locals: this.pyodide.toPy({ ttxProcessor: this.ttxProcessor }),
    });
  }

  addGlyphs(
    pathsDict: Map<
      string,
      {
        width: number;
        height: number;
        path: TSimplePathData;
      }
    >,
  ): Record<string, string> {
    const output = this.pyodide.runPython(
      `ttxProcessor.add_glyphs(paths_dict)`,
      {
        locals: this.pyodide.toPy({
          ttxProcessor: this.ttxProcessor,
          paths_dict: Object.fromEntries(pathsDict),
        }),
      },
    );
    return output.toJs();
  }
}
