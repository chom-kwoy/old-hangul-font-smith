import { GenerateOptions, JamoVarsets } from "@/app/utils/types";

export type MessageToFontGenWorker = GenerateFontRequest;

export interface GenerateFontRequest {
  type: "generateFont";
  buffer: ArrayBuffer;
  jamoVarsets: JamoVarsets;
  options: GenerateOptions;
}

export type MessageFromFontGenWorker = GenerateFontResult;

export interface GenerateFontResult {
  type: "fontBlob";
  blob: Blob;
}
