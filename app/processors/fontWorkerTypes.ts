export type MessageToFontWorker = GenerateFontMessage;

export interface GenerateFontMessage {
  type: "generateFont";
  buffer: ArrayBuffer;
}

export type MessageToMainThread = FontBlobMessage;

export interface FontBlobMessage {
  type: "fontBlob";
  blob: Blob;
}
