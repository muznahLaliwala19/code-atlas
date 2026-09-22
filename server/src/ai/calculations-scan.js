import fs from "fs/promises";
import path from "path";

const MAX_FILE_BYTES = 100_000;
const MAX_DIGEST_CHARS = 180_000;

const CALC_FILE_RE =
  /(?:Repository|Helper|Service|Calculator|Compute|Formula|Proc|Report|Budget|Expenditure|Deduction|TDS|Cashbook|Limit|Payment|MIS)/i;

const CALC_LINE_RE =
  /\b(Sum|Calculate|TotalAmount|GrossTotal|NetAmount|TotalDeduction|Percentage|TDS|Interest|Balance|Deduction|Tax|GST|CGST|SGST|Round|Avg|Average|Formula|Compute)\b/i;

async function walkCalcFiles(rootDir) {
  const out = [];
  async function walk(abs, rel) {
    let entries;
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".github") continue;
      if (entry.isDirectory()) {
        if (["node_modules", "bin", "obj", "wwwroot", "plugins"].includes(entry.name)) continue;
        await walk(path.join(abs, entry.name), rel ? `${rel}/${entry.name}` : entry.name);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (![".cs", ".sql", ".dart", ".py", ".js", ".ts"].includes(ext)) continue;
      const norm = (rel ? `${rel}/` : "") + entry.name;
      if (!CALC_FILE_RE.test(norm) && ext !== ".sql") continue;
      out.push({ abs: path.join(abs, entry.name), rel: norm.replace(/\\/g, "/"), ext });
    }
  }
  await walk(rootDir, "");
  return out;
}

function extractSnippets(content, rel) {
  const lines = content.split("\n");
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!CALC_LINE_RE.test(line)) continue;
    if (/^\s*(\/\/|#|\/\*|\*)/.test(line)) continue;
    const start = Math.max(0, i - 2);
    const end = Math.min(lines.length, i + 4);
    const snippet = lines.slice(start, end).join("\n").trim();
    hits.push({
      file: rel,
      line: i + 1,
      snippet: snippet.slice(0, 600),
      hint: line.trim().slice(0, 120),
    });
  }
  return hits;
}

/**
 * Collect calculation/business-formula candidates from repositories, helpers, SQL.
 */
export async function collectCalculationCandidatesFromDisk(rootDir) {
  const files = await walkCalcFiles(rootDir);
  const candidates = [];
  const seen = new Set();

  for (const f of files) {
    let content = "";
    try {
      const st = await fs.stat(f.abs);
      if (st.size > MAX_FILE_BYTES) continue;
      content = await fs.readFile(f.abs, "utf8");
    } catch {
      continue;
    }
    if (!content || content.includes("\u0000")) continue;

    for (const hit of extractSnippets(content, f.rel)) {
      const key = `${hit.file}:${hit.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(hit);
    }

    if (f.ext === ".sql") {
      const procs = content.match(/CREATE\s+PROC(?:EDURE)?\s+[\[\w.]+/gi) || [];
      for (const p of procs.slice(0, 20)) {
        candidates.push({
          file: f.rel,
          line: null,
          snippet: p,
          hint: "stored procedure",
        });
      }
    }
  }

  return candidates.sort((a, b) => a.file.localeCompare(b.file));
}

export async function buildCalculationsDigest(candidates) {
  let digest = `CALCULATION CANDIDATES (${candidates.length})\n\n`;
  for (const c of candidates) {
    const block = `--- ${c.file}${c.line ? `:${c.line}` : ""} ---\n${c.snippet}\n\n`;
    if (digest.length + block.length > MAX_DIGEST_CHARS) break;
    digest += block;
  }
  return {
    digest,
    stats: { count: candidates.length, digestChars: digest.length },
  };
}
