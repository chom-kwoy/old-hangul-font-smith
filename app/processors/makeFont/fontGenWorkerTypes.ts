import { GenerateOptions, JamoVarsets } from "@/app/utils/types";

export type MessageToFontGenWorker = GenerateFontRequest;

export interface GenerateFontRequest {
  type: "generateFont";
  reqId: number;
  buffer: ArrayBuffer;
  jamoVarsets: JamoVarsets;
  options: GenerateOptions;
}

export type MessageFromFontGenWorker = GenerateFontResult;

export interface GenerateFontResult {
  type: "generateFont";
  reqId: number;
  blob: Blob;
}
