/** Read required image formats' dimensions before asking the browser to decode pixels. */
export const imageDimensions = (bytes: Uint8Array, mime: string): { width: number; height: number } | null => {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (mime === 'image/png' && bytes.length >= 24 && ascii(12, 4) === 'IHDR') {
    return { width: data.getUint32(16), height: data.getUint32(20) };
  }
  if (mime === 'image/jpeg') {
    for (let offset = 2; offset + 3 < bytes.length;) {
      if (bytes[offset++] !== 0xff) return null;
      while (bytes[offset] === 0xff) offset += 1;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) return null; // Scan data follows all frame headers.
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) return null;
      const length = data.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) return null;
      const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isFrame && length >= 7) return { width: data.getUint16(offset + 5), height: data.getUint16(offset + 3) };
      offset += length;
    }
  }
  if (mime === 'image/webp' && bytes.length >= 20) {
    const uint24 = (offset: number) => bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16);
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const kind = ascii(offset, 4);
      const length = data.getUint32(offset + 4, true);
      const start = offset + 8;
      if (start + length > bytes.length) return null;
      if (kind === 'VP8X' && length >= 10) return { width: uint24(start + 4) + 1, height: uint24(start + 7) + 1 };
      if (kind === 'VP8L' && length >= 5 && bytes[start] === 0x2f) {
        const bits = data.getUint32(start + 1, true);
        return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
      }
      if (kind === 'VP8 ' && length >= 10 && bytes[start + 3] === 0x9d && bytes[start + 4] === 0x01 && bytes[start + 5] === 0x2a) {
        return { width: data.getUint16(start + 6, true) & 0x3fff, height: data.getUint16(start + 8, true) & 0x3fff };
      }
      offset = start + length + (length % 2);
    }
  }
  return null; // Best-effort formats still receive post-decode validation.
};
