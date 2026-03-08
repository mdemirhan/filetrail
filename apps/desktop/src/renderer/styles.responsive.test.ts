import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const stylesPath = resolve(import.meta.dirname, "./styles.css");

describe("responsive shell styles", () => {
  it("does not assign global workspace columns in responsive media rules", () => {
    const styles = readFileSync(stylesPath, "utf8");
    expect(styles).not.toMatch(/@media\s*\(max-width:\s*1240px\)\s*{[\s\S]*?\.workspace\s*{/);
  });
});
