import { FontMetadata, JamoVarsets } from "@/app/utils/types";

export type MessageToFontAnalyzerWorker =
  | LoadFontRequest
  | GetSampleImageRequest
  | AnalyzeFontRequest;

export interface LoadFontRequest {
  type: "loadFont";
  reqId: number;
  buffer: ArrayBuffer;
}

export interface GetSampleImageRequest {
  type: "getSampleImage";
  reqId: number;
  sampleText: string;
}

export interface AnalyzeFontRequest {
  type: "analyzeFont";
  reqId: number;
}

export type MessageFromFontAnalyzerWorker =
  | LoadFontResult
  | GetSampleImageResult
  | AnalyzeFontResult;

export interface LoadFontResult {
  type: "loadFont";
  reqId: number;
  metadata: FontMetadata;
}

export interface GetSampleImageResult {
  type: "getSampleImage";
  reqId: number;
  sampleImage: string;
}

export interface AnalyzeFontResult {
  type: "analyzeFont";
  reqId: number;
  jamoVarsets: JamoVarsets;
}
