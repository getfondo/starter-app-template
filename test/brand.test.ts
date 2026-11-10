import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("keycloak/apply-brand.mjs", () => {
  it("writes brand.css with the plan color and a darker hover color", () => {
    const dir = mkdtempSync(join(tmpdir(), "brand-"));
    const plan = join(dir, "plan.json");
    const out = join(dir, "brand.css");
    writeFileSync(plan, JSON.stringify({ color: "#3366CC", productName: "Acme Tasks" }));
    execFileSync("node", ["keycloak/apply-brand.mjs", plan, out]);
    const css = readFileSync(out, "utf8");
    expect(css).toContain("--brand-primary: #3366cc;");
    expect(css).toContain("--brand-primary-hover: #2952a3;");
    expect(css).toContain("--keycloak-card-top-color: var(--brand-primary)");
  });
});
