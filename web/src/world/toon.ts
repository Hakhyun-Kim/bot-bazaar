// The cartoon look shared by the market and its characters: three flat bands of light and ink outlines.
import { DataTexture, NearestFilter, RedFormat } from "three";

export const INK = "#3a2e3f";

/** Three flat bands of light: the cartoon look comes from this plus ink outlines. */
export const GRAD = (() => {
  const t = new DataTexture(new Uint8Array([90, 175, 255]), 3, 1, RedFormat);
  t.minFilter = t.magFilter = NearestFilter;
  t.needsUpdate = true;
  return t;
})();

/** A colour from an address, so every trader keeps the same one on every visit. */
export function hashOf(a: string): number {
  let h = 0;
  for (let i = 2; i < a.length; i++) h = (h * 31 + a.charCodeAt(i)) >>> 0;
  return h;
}
export const hue = (a: string, shift = 0, s = 75, l = 64) => `hsl(${(hashOf(a) + shift) % 360}, ${s}%, ${l}%)`;
