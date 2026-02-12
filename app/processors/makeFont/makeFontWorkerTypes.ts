import { GenerateOptions, JamoVarsets } from "@/app/utils/types";

export type MessageToFontWorker = GenerateFontMessage;

export interface GenerateFontMessage {
  type: "generateFont";
  buffer: ArrayBuffer;
  jamoVarsets: JamoVarsets;
  options: GenerateOptions;
}

export type MessageToMainThread = FontBlobMessage;

export interface FontBlobMessage {
  type: "fontBlob";
  blob: Blob;
}
