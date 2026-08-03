// BlastSimulator2026 — Pure base64 codec for byte arrays
// No btoa/atob (browser-only) and no Buffer (Node-only): SaveLoad runs in
// both the browser bundle and Node (console mode, tests), so the codec used
// to embed binary save payloads in JSON must depend on neither (#458 T0.3).

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const PAD = '=';

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const hasB1 = i + 1 < bytes.length;
    const hasB2 = i + 2 < bytes.length;
    const b1 = hasB1 ? bytes[i + 1]! : 0;
    const b2 = hasB2 ? bytes[i + 2]! : 0;

    const n = (b0 << 16) | (b1 << 8) | b2;
    out += ALPHABET[(n >> 18) & 0x3f];
    out += ALPHABET[(n >> 12) & 0x3f];
    out += hasB1 ? ALPHABET[(n >> 6) & 0x3f] : PAD;
    out += hasB2 ? ALPHABET[n & 0x3f] : PAD;
  }
  return out;
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let outIdx = 0;

  for (let i = 0; i < clean.length; i += 4) {
    const hasC2 = i + 2 < clean.length;
    const hasC3 = i + 3 < clean.length;
    const c0 = ALPHABET.indexOf(clean[i]!);
    const c1 = ALPHABET.indexOf(clean[i + 1]!);
    const c2 = hasC2 ? ALPHABET.indexOf(clean[i + 2]!) : 0;
    const c3 = hasC3 ? ALPHABET.indexOf(clean[i + 3]!) : 0;

    const n = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    out[outIdx++] = (n >> 16) & 0xff;
    if (hasC2) out[outIdx++] = (n >> 8) & 0xff;
    if (hasC3) out[outIdx++] = n & 0xff;
  }
  return out;
}
