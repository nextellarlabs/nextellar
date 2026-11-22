import { createHash } from "crypto";
import {
  encodeQr,
  qrToSvgPath,
  qrToSvgString,
  type QrMatrix,
} from "../../src/templates/default/src/lib/qr";

const ADDRESS = "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57";

function matrixHash(qr: QrMatrix): string {
  const rows = qr.modules
    .map((row) => row.map((dark) => (dark ? 1 : 0)).join(""))
    .join("\n");
  return createHash("sha256").update(rows).digest("hex");
}

/** Read the 15 format bits from the copy around the top-left finder. */
function readFormatBits(qr: QrMatrix): number {
  const m = (x: number, y: number) => (qr.modules[y][x] ? 1 : 0);
  const coords: Array<[number, number]> = [];
  for (let i = 0; i <= 5; i++) coords.push([8, i]);
  coords.push([8, 7], [8, 8], [7, 8]);
  for (let i = 9; i < 15; i++) coords.push([14 - i, 8]);
  return coords.reduce((bits, [x, y], i) => bits | (m(x, y) << i), 0);
}

/** Read the second copy (bottom-left column + top-right row). */
function readFormatBitsCopy2(qr: QrMatrix): number {
  const m = (x: number, y: number) => (qr.modules[y][x] ? 1 : 0);
  let bits = 0;
  for (let i = 0; i < 8; i++) bits |= m(qr.size - 1 - i, 8) << i;
  for (let i = 8; i < 15; i++) bits |= m(8, qr.size - 15 + i) << i;
  return bits;
}

function bchRemainder(data: number): number {
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return rem & 0x3ff;
}

function hasFinder(qr: QrMatrix, left: number, top: number): boolean {
  for (let dy = 0; dy < 7; dy++) {
    for (let dx = 0; dx < 7; dx++) {
      const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
      if (qr.modules[top + dy][left + dx] !== (ring !== 2)) return false;
    }
  }
  return true;
}

describe("qr (#662)", () => {
  // Fixtures produced by this encoder and verified with an independent QR
  // decoder (jsQR) when they were recorded. A change here means the encoder's
  // output changed and must be re-verified with a real scanner.
  it.each([
    [
      ADDRESS,
      4,
      4,
      "369b98536a00cc76d4eab3ef7c8e40d4f3b09795dcec6c0f22d31c591b1d5648",
    ],
    [
      `web+stellar:pay?destination=${ADDRESS}&amount=25`,
      6,
      4,
      "5fbf60d2c9e6532fc07717d28f7c234b9be3de0b6d2eaf0cc2eaa51e91dd0811",
    ],
  ])("encodes %s to the verified symbol", (text, version, mask, hash) => {
    const qr = encodeQr(text);
    expect(qr.version).toBe(version);
    expect(qr.size).toBe(version * 4 + 17);
    expect(qr.mask).toBe(mask);
    expect(matrixHash(qr)).toBe(hash);
  });

  it("draws the three finder patterns and the dark module", () => {
    const qr = encodeQr(ADDRESS);
    expect(hasFinder(qr, 0, 0)).toBe(true);
    expect(hasFinder(qr, qr.size - 7, 0)).toBe(true);
    expect(hasFinder(qr, 0, qr.size - 7)).toBe(true);
    expect(qr.modules[qr.size - 8][8]).toBe(true);
  });

  it.each(["a", ADDRESS, "x".repeat(200)])(
    "writes valid, matching format info for ECC level M (%#)",
    (text) => {
      const qr = encodeQr(text);
      const bits = readFormatBits(qr);
      expect(readFormatBitsCopy2(qr)).toBe(bits);
      const unmasked = bits ^ 0x5412;
      const data = unmasked >>> 10;
      expect(bchRemainder(data)).toBe(unmasked & 0x3ff);
      expect(data >>> 3).toBe(0); // ECC level M
      expect(data & 7).toBe(qr.mask);
    },
  );

  it("grows the version with the payload and caps at version 40", () => {
    expect(encodeQr("a").version).toBe(1);
    expect(encodeQr("x".repeat(300)).version).toBeGreaterThan(7);
    expect(encodeQr("x".repeat(2331)).version).toBe(40);
    expect(() => encodeQr("x".repeat(2332))).toThrow(/too long/);
  });

  it("encodes UTF-8 by bytes", () => {
    // 20 characters but 40 bytes: needs a bigger symbol than 20 ASCII characters.
    expect(encodeQr("é".repeat(20)).version).toBeGreaterThan(
      encodeQr("e".repeat(20)).version,
    );
  });

  it("is deterministic", () => {
    expect(matrixHash(encodeQr(ADDRESS))).toBe(matrixHash(encodeQr(ADDRESS)));
  });

  it("renders one path square per dark module, offset by the quiet zone", () => {
    const qr = encodeQr(ADDRESS);
    const dark = qr.modules.flat().filter(Boolean).length;
    const path = qrToSvgPath(qr, 2);
    expect(path.match(/M/g)).toHaveLength(dark);
    expect(path.startsWith("M2,2h1v1h-1z")).toBe(true); // top-left finder corner
  });

  it("produces standalone SVG markup sized to the symbol plus border", () => {
    const svg = qrToSvgString(ADDRESS, {
      border: 4,
      dark: "#111",
      light: "#eee",
    });
    expect(svg).toContain('viewBox="0 0 41 41"');
    expect(svg).toContain('fill="#111"');
    expect(svg).toContain('fill="#eee"');
    expect(svg.startsWith("<svg")).toBe(true);
  });
});
