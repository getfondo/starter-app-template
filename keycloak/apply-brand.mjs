// Usage: node keycloak/apply-brand.mjs <plan.json> <brand.css>
// Writes the login theme's brand variables from the Plan color. Runs inside keycloak/Dockerfile.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const [planPath, outPath] = process.argv.slice(2);
if (!planPath || !outPath) {
  console.error("usage: apply-brand.mjs <plan.json> <brand.css>");
  process.exit(2);
}

const plan = JSON.parse(readFileSync(planPath, "utf8"));
const color = /^#[0-9a-fA-F]{6}$/.test(plan.color ?? "") ? plan.color.toLowerCase() : "#006fee";

function darken(hex, factor) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift) => Math.max(0, Math.round(((n >> shift) & 0xff) * factor));
  return `#${[ch(16), ch(8), ch(0)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function tint(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift) => Math.round(((n >> shift) & 0xff) * 0.08 + 255 * 0.92);
  return `#${[ch(16), ch(8), ch(0)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

const css = `:root {
    --brand-primary: ${color};
    --brand-primary-hover: ${darken(color, 0.8)};
    --brand-background: ${tint(color)};
    --brand-header-text: #1b1f24;
}

.login-pf body {
    background: var(--brand-background);
}

:root,
.pf-v5-theme-dark {
    --keycloak-card-top-color: var(--brand-primary);
    --pf-v5-global--primary-color--100: var(--brand-primary);
    --pf-v5-global--primary-color--200: var(--brand-primary-hover);
    --pf-v5-global--link--Color: var(--brand-primary);
    --pf-v5-global--link--Color--hover: var(--brand-primary-hover);
}

.pf-v5-c-button.pf-m-primary {
    --pf-v5-c-button--m-primary--BackgroundColor: var(--brand-primary);
    --pf-v5-c-button--m-primary--hover--BackgroundColor: var(--brand-primary-hover);
    --pf-v5-c-button--m-primary--focus--BackgroundColor: var(--brand-primary-hover);
    --pf-v5-c-button--m-primary--active--BackgroundColor: var(--brand-primary-hover);
}

#kc-header-wrapper {
    color: var(--brand-header-text) !important;
    font-weight: 700;
    letter-spacing: 0.02em;
}

div.kc-logo-text {
    background-image: none;
}

div.kc-logo-text span {
    display: inline;
}
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, css);
console.log(`brand.css written for ${plan.productName ?? "app"} with ${color}`);
