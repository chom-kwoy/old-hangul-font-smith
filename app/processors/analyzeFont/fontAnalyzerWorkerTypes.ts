import { JamoVarsets } from "@/app/utils/types";

export type MessageToFontAnalyzerWorker =
  | GenerateFontRequest
  | SampleImageRequest
  | AnalyzeFontRequest;

export interface GenerateFontRequest {
  type: "loadFont";
  buffer: ArrayBuffer;
}

export interface SampleImageRequest {
  type: "getSampleImage";
  sampleText: string;
}

export interface AnalyzeFontRequest {
  type: "analyzeFont";
}

export type MessageFromFontAnalyzerWorker =
  | GenerateFontResult
  | SampleImageResult
  | AnalyzeFontResult
  | ErrorMessage;

export interface GenerateFontResult {
  type: "fontParsed";
  metadata: {
    name: string;
    style: string;
    family: string;
    numGlyphs: number;
  };
}

export interface SampleImageResult {
  type: "sampleImage";
  sampleImage: string;
}

export interface AnalyzeFontResult {
  type: "fontAnalyzed";
  jamoVarsets: JamoVarsets;
}

export interface ErrorMessage {
  type: "error";
  error: string;
}
