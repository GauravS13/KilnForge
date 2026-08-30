import { describe, expect, test } from "bun:test";
import { rasterizeText } from "./font.ts";

describe("rasterizeText", () => {
  test("dimensions scale with text length and the scale option", () => {
    const one = rasterizeText("A");
    expect(one.width).toBe(5); // one glyph, no spacing gap after it
    expect(one.height).toBe(7);

    const two = rasterizeText("AB");
    expect(two.width).toBe(5 + 1 + 5); // glyph + spacing + glyph
    expect(two.height).toBe(7);

    const scaled = rasterizeText("A", { scale: 3 });
    expect(scaled.width).toBe(15);
    expect(scaled.height).toBe(21);
  });

  test("uses the requested color at full alpha for lit pixels", () => {
    const out = rasterizeText("I", { color: [10, 20, 30] });
    // "I" glyph row 0 is 0b01110 — columns 1,2,3 lit, 0 and 4 not.
    const litIdx = (0 * out.width + 2) * 4;
    expect(Array.from(out.pixels.slice(litIdx, litIdx + 4))).toEqual([10, 20, 30, 255]);
    const unlitIdx = (0 * out.width + 0) * 4;
    expect(Array.from(out.pixels.slice(unlitIdx, unlitIdx + 4))).toEqual([0, 0, 0, 0]);
  });

  test("lowercase input renders using the uppercase glyph", () => {
    const lower = rasterizeText("a");
    const upper = rasterizeText("A");
    expect(Array.from(lower.pixels)).toEqual(Array.from(upper.pixels));
  });

  test("unsupported characters render as blank (space), not a throw", () => {
    expect(() => rasterizeText("A@B")).not.toThrow();
    const out = rasterizeText("@");
    // entirely transparent — no lit pixels anywhere
    let anyLit = false;
    for (let i = 3; i < out.pixels.length; i += 4) if (out.pixels[i] !== 0) anyLit = true;
    expect(anyLit).toBe(false);
  });

  test("empty string does not throw and returns a minimal valid image", () => {
    expect(() => rasterizeText("")).not.toThrow();
    const out = rasterizeText("");
    expect(out.width).toBeGreaterThan(0);
    expect(out.height).toBeGreaterThan(0);
  });
});
