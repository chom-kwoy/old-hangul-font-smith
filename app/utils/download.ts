export function downloadArrayBufferAsFile(
  arrayBuffer: ArrayBuffer,
  filename: string,
  mimeType: string,
) {
  // 1. Create a Blob from the ArrayBuffer
  // The ArrayBuffer must be wrapped in an array
  const blob = new Blob([arrayBuffer], { type: mimeType });

  // 2. Create a URL for the Blob
  const url = URL.createObjectURL(blob);

  // 3. Create a temporary anchor element
  const a = document.createElement("a");
  a.href = url;
  a.download = filename; // Set the file name for the download

  // 4. Append the anchor to the body, click it, and remove it
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // 5. Revoke the object URL to free up memory
  URL.revokeObjectURL(url);
}

function stringToArrayBuffer(str: string) {
  const encoder = new TextEncoder(); // defaults to 'utf-8'
  const uint8Array = encoder.encode(str); // returns a Uint8Array
  return uint8Array.buffer;
}

export function downloadStringAsFile(
  str: string,
  filename: string,
  mimeType: string,
) {
  const arrayBuffer = stringToArrayBuffer(str);
  downloadArrayBufferAsFile(arrayBuffer, filename, mimeType);
}
