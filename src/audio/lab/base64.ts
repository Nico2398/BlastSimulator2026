// BlastSimulator2026 — Bytes to base64
// How a rendered WAV leaves the page for the check script: a base64 string is the
// cheapest thing a browser-automation call can carry.

const CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}
