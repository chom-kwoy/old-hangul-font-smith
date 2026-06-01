import * as clipperLib from "js-angusj-clipper/web";

/**
 * Shared js-angusj-clipper instance. Loading the WASM library is async and
 * relatively expensive, so it's done once here via top-level await and imported
 * wherever Clipper boolean/offset ops are needed.
 */
export const clipper = await clipperLib.loadNativeClipperLibInstanceAsync(
  // autodetect; WasmOnly / AsmJsOnly are also available.
  clipperLib.NativeClipperLibRequestedFormat.WasmWithAsmJsFallback,
);
