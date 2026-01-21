import { JamoVarsets } from "@/app/utils/types";

export type MessageToFontWorker = GenerateFontMessage;

export interface GenerateFontMessage {
  type: "generateFont";
  buffer: ArrayBuffer;
  jamoVarsets: JamoVarsets;
}

export type MessageToMainThread = FontBlobMessage;

export interface FontBlobMessage {
  type: "fontBlob";
  blob: Blob;
}
