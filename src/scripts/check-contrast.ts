/**
 * WCAG 2.2 AA contrast for every colour pair the panel actually uses.
 *
 *   npx tsx src/scripts/check-contrast.ts
 *
 * Reads the tokens straight out of `src/app/globals.css` for both themes, so it
 * keeps telling the truth when a token changes rather than drifting into a
 * comment that used to be right.
 *
 * Thresholds: 4.5:1 for body text (1.4.3), 3:1 for large text and for the
 * boundaries of user interface components and meaningful graphics (1.4.11).
 * Purely decorative boundaries have no requirement and are reported as FYI so
 * the numbers are visible without inflating the failure count.
 */
import io from "node:fs";
import path from "node:path";

type Rgb = [number, number, number];

function parseHex(hex: string): Rgb {
  const h = hex.trim().replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function luminance([r, g, b]: Rgb): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Pull `--name:#value;` pairs out of one CSS block. */
function tokensIn(css: string, startMarker: string): Record<string, string> {
  const start = css.indexOf(startMarker);
  if (start === -1) throw new Error(`could not find ${startMarker}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const block = css.slice(open + 1, close);
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9A-Fa-f]{3,6})/g)) {
    out[m[1]] = m[2];
  }
  return out;
}

type Pair = {
  what: string;
  fg: string;
  bg: string;
  need: number;
  note?: string;
  advisory?: boolean;
};

/* Everything new in the Due view, the lead card affordances and the dialogs,
   plus the pre-existing pairs they sit next to so the report is complete. */
const PAIRS: Pair[] = [
  { what: "body text", fg: "ink", bg: "ground", need: 4.5 },
  { what: "card text", fg: "ink", bg: "surface", need: 4.5 },
  { what: "secondary text (.what, .due-note)", fg: "ink-2", bg: "surface", need: 4.5 },
  { what: "muted text (.hint, .h-when, .due-context, .verdict-ask)", fg: "ink-3", bg: "surface", need: 4.5 },
  { what: "muted text on the ground", fg: "ink-3", bg: "ground", need: 4.5 },
  { what: "tag: follow-up chip (NEW)", fg: "accent", bg: "accent-soft", need: 4.5 },
  { what: "tag: overdue chip", fg: "no-ink", bg: "no-bg", need: 4.5 },
  { what: "tag: approved", fg: "ok-ink", bg: "ok-bg", need: 4.5 },
  { what: "tag: high fit", fg: "high-ink", bg: "high-bg", need: 4.5 },
  { what: "tag: medium fit", fg: "med-ink", bg: "med-bg", need: 4.5 },
  { what: "tag: low fit", fg: "low-ink", bg: "low-bg", need: 4.5 },
  { what: "tag: scanner", fg: "ink-2", bg: "surface-2", need: 4.5 },
  { what: "app bar overdue badge (NEW)", fg: "no-ink", bg: "no-bg", need: 4.5 },
  { what: "app bar nav, resting (NEW)", fg: "ink-2", bg: "surface", need: 4.5 },
  { what: "app bar nav, current page (NEW)", fg: "ink", bg: "accent-soft", need: 4.5 },
  { what: "late-by line (NEW)", fg: "no-ink", bg: "surface", need: 4.5 },
  { what: "set-next panel text (NEW)", fg: "ink", bg: "accent-soft", need: 4.5 },
  { what: "due count pill (NEW)", fg: "ink-2", bg: "surface-2", need: 4.5 },
  { what: "dialog text (NEW)", fg: "ink", bg: "surface", need: 4.5 },
  { what: "dialog description (NEW)", fg: "ink-2", bg: "surface", need: 4.5 },
  { what: "button label, resting", fg: "ink-2", bg: "surface", need: 4.5 },
  { what: "button label, approve", fg: "ok-ink", bg: "ok-bg", need: 4.5 },
  { what: "button label, reject", fg: "no-ink", bg: "no-bg", need: 4.5 },
  { what: "error text", fg: "no-ink", bg: "no-bg", need: 4.5 },

  /* 1.4.11 — boundaries of controls, which must be distinguishable. */
  { what: "control border (.btn, .chip, inputs)", fg: "rule-2", bg: "surface", need: 3 },
  { what: "focus ring", fg: "accent", bg: "surface", need: 3 },
  { what: "focus ring on the ground", fg: "accent", bg: "ground", need: 3 },
  { what: "overdue card edge (NEW)", fg: "no-ink", bg: "surface", need: 3 },

  /* Decorative only: a hairline between cards conveys nothing on its own. */
  { what: "hairline rule between sections", fg: "rule", bg: "surface", need: 3, advisory: true,
    note: "decorative separator, no AA requirement" },
];

const css = io.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
const themes = {
  light: tokensIn(css, ":root {"),
  dark: tokensIn(css, ':root[data-theme="dark"]'),
};

let failures = 0;
let advisories = 0;

for (const [themeName, tokens] of Object.entries(themes)) {
  console.log(`\n${themeName.toUpperCase()}`);
  console.log("  ratio   need  result  pair");
  for (const p of PAIRS) {
    const fg = tokens[p.fg];
    const bg = tokens[p.bg];
    if (!fg || !bg) {
      console.log(`  ------  ----  MISSING ${p.what} (${p.fg}/${p.bg})`);
      failures++;
      continue;
    }
    const r = ratio(parseHex(fg), parseHex(bg));
    const pass = r >= p.need;
    if (!pass) {
      if (p.advisory) advisories++;
      else failures++;
    }
    const verdict = pass ? "pass  " : p.advisory ? "fyi   " : "FAIL  ";
    console.log(
      `  ${r.toFixed(2).padStart(6)}  ${p.need.toFixed(1)}   ${verdict}  ${p.what}` +
        (p.note ? `  (${p.note})` : ""),
    );
  }
}

console.log(
  failures === 0
    ? `\nAll required pairs pass AA in both themes.${advisories ? ` ${advisories} advisory note(s).` : ""}`
    : `\n${failures} pair(s) FAIL.`,
);
process.exit(failures === 0 ? 0 : 1);
