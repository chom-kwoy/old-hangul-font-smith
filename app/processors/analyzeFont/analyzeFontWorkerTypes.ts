import { JamoVarsets } from "@/app/utils/types";

export type MessageToFontWorker =
  | GenerateFontMessage
  | GetSampleImageMessage
  | AnalyzeFontMessage;

export interface GenerateFontMessage {
  type: "loadFont";
  buffer: ArrayBuffer;
}

export interface GetSampleImageMessage {
  type: "getSampleImage";
  sampleText: string;
}

export interface AnalyzeFontMessage {
  type: "analyzeFont";
}

export type MessageToMainThread =
  | FontBlobMessage
  | SampleImageMessage
  | FontAnalyzedMessage
  | ErrorMessage;

export interface FontBlobMessage {
  type: "fontParsed";
  metadata: {
    name: string;
    style: string;
    family: string;
    numGlyphs: number;
  };
}

export interface SampleImageMessage {
  type: "sampleImage";
  sampleImage: string;
}

export interface FontAnalyzedMessage {
  type: "fontAnalyzed";
  jamoVarsets: JamoVarsets;
}

export interface ErrorMessage {
  type: "error";
  error: string;
}
