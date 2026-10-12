// BlastSimulator2026 — MPEG Layer III header reader for the shipped sound files
// Reads the first frame by hand (no audio decoding), so a test can check format and duration without a codec.

const BITRATES_MPEG1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITRATES_MPEG2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const SAMPLE_RATES = [[11025, 12000, 8000], [0, 0, 0], [22050, 24000, 16000], [44100, 48000, 32000]];

export interface Mp3Info {
  readonly sampleRate: number;
  readonly channels: number;
  readonly durationS: number;
  readonly hasXing: boolean;
}

/** Parse the first MPEG audio frame (after an optional ID3v2 tag) and estimate the duration. */
export function parseMp3(buf: Buffer): Mp3Info | null {
  let pos = 0;
  if (buf.toString('latin1', 0, 3) === 'ID3') {
    pos = 10 + ((buf[6]! << 21) | (buf[7]! << 14) | (buf[8]! << 7) | buf[9]!);
  }
  const b0 = buf[pos], b1 = buf[pos + 1], b2 = buf[pos + 2], b3 = buf[pos + 3];
  if (b0 !== 0xff || b1 === undefined || b2 === undefined || b3 === undefined || (b1 & 0xe0) !== 0xe0) return null;
  const version = (b1 >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
  const layer = (b1 >> 1) & 3; // 1 = Layer III
  if (version === 1 || layer !== 1) return null;
  const mpeg1 = version === 3;
  const bitrate = (mpeg1 ? BITRATES_MPEG1_L3 : BITRATES_MPEG2_L3)[b2 >> 4]! * 1000;
  const sampleRate = SAMPLE_RATES[version]![(b2 >> 2) & 3]!;
  if (bitrate === 0 || sampleRate === 0) return null;
  const channels = (b3 >> 6) === 3 ? 1 : 2;
  const samplesPerFrame = mpeg1 ? 1152 : 576;
  const crcBytes = (b1 & 1) === 0 ? 2 : 0;
  const sideInfo = mpeg1 ? (channels === 1 ? 17 : 32) : (channels === 1 ? 9 : 17);
  const tagAt = pos + 4 + crcBytes + sideInfo;
  const tag = buf.toString('latin1', tagAt, tagAt + 4);
  if ((tag === 'Xing' || tag === 'Info') && (buf.readUInt32BE(tagAt + 4) & 1) !== 0) {
    const frames = buf.readUInt32BE(tagAt + 8);
    return { sampleRate, channels, durationS: (frames * samplesPerFrame) / sampleRate, hasXing: true };
  }
  return { sampleRate, channels, durationS: ((buf.length - pos) * 8) / bitrate, hasXing: false };
}
