/**
 * WebM/Opus (what Chrome's MediaRecorder makes) → Ogg/Opus (what WhatsApp
 * voice notes are). A REMUX: the Opus audio frames are copied as they are,
 * only the container changes. Pure JS, no ffmpeg, no quality loss.
 */

// Matroska element ids we care about.
const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  Cluster: 0x1f43b675,
  BlockGroup: 0xa0,
  Block: 0xa1,
  SimpleBlock: 0xa3,
};
/** Elements that contain other elements: we read into them instead of skipping. */
const MASTERS = new Set([ID.Segment, ID.Tracks, ID.TrackEntry, ID.Cluster, ID.BlockGroup]);

function readVint(buf: Uint8Array, pos: number, keepMarker: boolean): { value: number; length: number; unknown: boolean } {
  const first = buf[pos];
  if (first === undefined) throw new Error("Unexpected end of WebM data");
  let length = 1;
  let mask = 0x80;
  while (length <= 8 && !(first & mask)) {
    length++;
    mask >>= 1;
  }
  if (length > 8) throw new Error("Invalid WebM data");
  let value = keepMarker ? first : first & (mask - 1);
  let allOnes = (first & (mask - 1)) === mask - 1;
  for (let i = 1; i < length; i++) {
    const b = buf[pos + i];
    if (b === undefined) throw new Error("Unexpected end of WebM data");
    value = value * 256 + b;
    if (b !== 0xff) allOnes = false;
  }
  return { value, length, unknown: !keepMarker && allOnes };
}

/** Samples (at 48 kHz) in one Opus packet, from its TOC byte (RFC 6716 §3.1). */
export function opusPacketSamples(packet: Uint8Array): number {
  if (!packet.length) return 0;
  const toc = packet[0];
  const config = toc >> 3;
  let frameMs: number;
  if (config < 12) frameMs = [10, 20, 40, 60][config % 4];
  else if (config < 16) frameMs = [10, 20][config % 2];
  else frameMs = [2.5, 5, 10, 20][config % 4];
  const code = toc & 3;
  const frames = code === 0 ? 1 : code === 3 ? (packet[1] ?? 0) & 0x3f : 2;
  return Math.round(frames * frameMs * 48);
}

function parseWebm(buf: Uint8Array): { opusHead: Uint8Array | null; packets: Uint8Array[]; codec: string | null } {
  let opusHead: Uint8Array | null = null;
  let codec: string | null = null;
  const packets: Uint8Array[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const id = readVint(buf, pos, true);
    const size = readVint(buf, pos + id.length, false);
    const start = pos + id.length + size.length;
    if (MASTERS.has(id.value)) {
      pos = start; // read the children (works for "unknown size" live streams too)
      continue;
    }
    const end = size.unknown ? buf.length : start + size.value;
    if (end > buf.length) break; // a cut-off last element: keep what we have
    const data = buf.subarray(start, end);
    if (id.value === ID.CodecID) codec = new TextDecoder().decode(data);
    else if (id.value === ID.CodecPrivate) opusHead = data;
    else if (id.value === ID.SimpleBlock || id.value === ID.Block) {
      const track = readVint(data, 0, false);
      const flags = data[track.length + 2];
      if (flags & 0x06) throw new Error("Laced WebM blocks are not supported");
      packets.push(data.subarray(track.length + 3));
    }
    pos = end;
  }
  return { opusHead, packets, codec };
}

// --- Ogg writing --------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  return t;
})();

function oggCrc(bytes: Uint8Array): number {
  let crc = 0;
  for (const b of bytes) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ b) & 0xff]) >>> 0;
  return crc;
}

function oggPage(packets: Uint8Array[], opts: { granule: bigint; serial: number; seq: number; flags: number }): Uint8Array {
  const lacing: number[] = [];
  for (const p of packets) {
    let len = p.length;
    while (len >= 255) {
      lacing.push(255);
      len -= 255;
    }
    lacing.push(len);
  }
  const body = packets.reduce((n, p) => n + p.length, 0);
  const page = new Uint8Array(27 + lacing.length + body);
  const view = new DataView(page.buffer);
  page.set([0x4f, 0x67, 0x67, 0x53], 0); // "OggS"
  page[4] = 0; // version
  page[5] = opts.flags;
  view.setBigInt64(6, opts.granule, true);
  view.setUint32(14, opts.serial, true);
  view.setUint32(18, opts.seq, true);
  page[26] = lacing.length;
  page.set(lacing, 27);
  let at = 27 + lacing.length;
  for (const p of packets) {
    page.set(p, at);
    at += p.length;
  }
  view.setUint32(22, oggCrc(page), true);
  return page;
}

function defaultOpusHead(channels = 1): Uint8Array {
  const head = new Uint8Array(19);
  head.set(new TextEncoder().encode("OpusHead"), 0);
  head[8] = 1; // version
  head[9] = channels;
  new DataView(head.buffer).setUint16(10, 312, true); // pre-skip
  new DataView(head.buffer).setUint32(12, 48000, true); // original rate
  return head;
}

/** Remux a WebM/Opus recording into an Ogg/Opus file. */
export function webmToOgg(webm: Uint8Array): Uint8Array {
  const { opusHead, packets, codec } = parseWebm(webm);
  if (codec && codec !== "A_OPUS") throw new Error(`WebM audio is ${codec}, expected Opus`);
  if (!packets.length) throw new Error("No audio in the recording");
  const head = opusHead && new TextDecoder().decode(opusHead.subarray(0, 8)) === "OpusHead" ? opusHead : defaultOpusHead();
  const preSkip = new DataView(head.buffer, head.byteOffset, head.byteLength).getUint16(10, true);
  const tags = (() => {
    const vendor = new TextEncoder().encode("orderly");
    const t = new Uint8Array(8 + 4 + vendor.length + 4);
    t.set(new TextEncoder().encode("OpusTags"), 0);
    new DataView(t.buffer).setUint32(8, vendor.length, true);
    t.set(vendor, 12);
    return t;
  })();

  const serial = 0x0d3a7c51;
  const pages: Uint8Array[] = [];
  let seq = 0;
  pages.push(oggPage([head], { granule: BigInt(0), serial, seq: seq++, flags: 0x02 }));
  pages.push(oggPage([tags], { granule: BigInt(0), serial, seq: seq++, flags: 0 }));

  let granule = BigInt(preSkip);
  let batch: Uint8Array[] = [];
  let segments = 0;
  const flush = (last: boolean) => {
    if (!batch.length) return;
    pages.push(oggPage(batch, { granule, serial, seq: seq++, flags: last ? 0x04 : 0 }));
    batch = [];
    segments = 0;
  };
  packets.forEach((p, i) => {
    const segs = Math.floor(p.length / 255) + 1;
    if (segments + segs > 255 || batch.length >= 50) flush(false);
    batch.push(p);
    segments += segs;
    granule += BigInt(opusPacketSamples(p));
    if (i === packets.length - 1) flush(true);
  });

  const total = pages.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of pages) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
