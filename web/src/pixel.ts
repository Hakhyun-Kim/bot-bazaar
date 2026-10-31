// 8x8, 4-colour designs — same encoding as PixelWorkshop.sol.
export const PRESET16 = [
  "#00000000", "#1c1c22", "#ffffff", "#b8433a", "#e07b39", "#ffd66b", "#7de08a", "#3f7d5a",
  "#7db7ff", "#3d5a8f", "#b48cff", "#ff9ec1", "#c9a86a", "#6b4a30", "#8fe8e0", "#9a958a",
] as const;

export function encodePixels(cells: number[]): `0x${string}` {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 64; i++) bytes[i >> 2] |= ((cells[i] ?? 0) & 3) << (6 - 2 * (i & 3));
  return `0x${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function decodePixels(hex: string): number[] {
  const h = hex.replace(/^0x/, "");
  return Array.from({ length: 64 }, (_, i) => (parseInt(h.slice((i >> 2) * 2, (i >> 2) * 2 + 2) || "0", 16) >> (6 - 2 * (i & 3))) & 3);
}

export const encodePalette = (s: number[]) => ((s[0] & 15) << 12) | ((s[1] & 15) << 8) | ((s[2] & 15) << 4) | (s[3] & 15);
export const paletteSlot = (palette: number, slot: number) => PRESET16[(palette >> (12 - 4 * slot)) & 15];

export function patternCanvas(pixelsHex: string, palette: number, scale = 8): HTMLCanvasElement {
  const cells = decodePixels(pixelsHex);
  const c = document.createElement("canvas");
  c.width = c.height = 8 * scale;
  const ctx = c.getContext("2d")!;
  cells.forEach((v, i) => {
    const color = paletteSlot(palette, v);
    if (color === "#00000000") return;
    ctx.fillStyle = color;
    ctx.fillRect((i % 8) * scale, Math.floor(i / 8) * scale, scale, scale);
  });
  return c;
}

export const decodePalette = (palette: number) => [0, 1, 2, 3].map((s) => (palette >> (12 - 4 * s)) & 15);

/** A published design as a fresh workshop draft: same pixels and colours, a name that credits the original. */
export function remixDraft(pixelsHex: string, palette: number, id: number) {
  return { cells: decodePixels(pixelsHex), slots: decodePalette(palette), name: `Remix of #${id}` };
}

/** File name for a saved design: "bot-bazaar-12-lantern.png". Only safe characters, never empty. */
export function designFileName(id: number, name: string) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  return `bot-bazaar-${id}${slug ? `-${slug}` : ""}.png`;
}

/** The original a remix credits, read from its name ("Remix of #12" → 12), or null. */
export function remixOf(name: string): number | null {
  const m = /^Remix of #(\d{1,9})\b/.exec(name.trim());
  return m ? Number(m[1]) : null;
}
