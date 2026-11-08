/** Minimal CBOR decoder (RFC 8949) for App Attest objects: ints, byte/text strings, arrays, maps, simple values. */
export function decodeCbor(buf: Buffer): unknown {
  let pos = 0;
  const readLen = (info: number): number => {
    if (info < 24) return info;
    if (info === 24) return buf.readUInt8(pos++);
    if (info === 25) { const v = buf.readUInt16BE(pos); pos += 2; return v; }
    if (info === 26) { const v = buf.readUInt32BE(pos); pos += 4; return v; }
    if (info === 27) { const v = Number(buf.readBigUInt64BE(pos)); pos += 8; return v; }
    throw new Error('CBOR: indefinite lengths are not supported');
  };
  const item = (depth: number): unknown => {
    if (depth > 16) throw new Error('CBOR: nesting too deep');
    if (pos >= buf.length) throw new Error('CBOR: truncated');
    const b = buf.readUInt8(pos++);
    const major = b >> 5;
    const info = b & 0x1f;
    switch (major) {
      case 0: return readLen(info);
      case 1: return -1 - readLen(info);
      case 2: { const n = readLen(info); if (pos + n > buf.length) throw new Error('CBOR: truncated bytes'); const v = buf.subarray(pos, pos + n); pos += n; return Buffer.from(v); }
      case 3: { const n = readLen(info); if (pos + n > buf.length) throw new Error('CBOR: truncated text'); const v = buf.toString('utf8', pos, pos + n); pos += n; return v; }
      case 4: { const n = readLen(info); const a: unknown[] = []; for (let i = 0; i < n; i++) a.push(item(depth + 1)); return a; }
      case 5: { const n = readLen(info); const m = new Map<unknown, unknown>(); for (let i = 0; i < n; i++) { const k = item(depth + 1); m.set(k, item(depth + 1)); } return m; }
      case 6: readLen(info); return item(depth + 1); // tag: ignore
      case 7:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        throw new Error('CBOR: unsupported simple/float');
      default: throw new Error('CBOR: bad major type');
    }
  };
  const out = item(0);
  if (pos !== buf.length) throw new Error('CBOR: trailing bytes');
  return out;
}

export function cborGet(m: unknown, key: string): unknown {
  return m instanceof Map ? m.get(key) : undefined;
}
