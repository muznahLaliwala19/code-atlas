import fs from "fs/promises";
import path from "path";

const MAX_DIGEST = 90_000;
const MAX_FILE = 18_000;

async function walk(rootDir) {
  const out = [];
  async function rec(abs, rel) {
    let entries;
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") && e.name !== ".github") continue;
      if (e.isDirectory()) {
        if (["node_modules", "bin", "obj", "wwwroot", "plugins"].includes(e.name)) continue;
        await rec(path.join(abs, e.name), rel ? `${rel}/${e.name}` : e.name);
        continue;
      }
      if (!e.isFile()) continue;
      out.push({
        abs: path.join(abs, e.name),
        rel: ((rel ? `${rel}/` : "") + e.name).replace(/\\/g, "/"),
        base: e.name,
        ext: path.extname(e.name).toLowerCase(),
      });
    }
  }
  await rec(rootDir, "");
  return out;
}

function scoreFile(rel, needle) {
  const r = rel.toLowerCase().replace(/\\/g, "/");
  const n = String(needle || "")
    .toLowerCase()
    .replace(/\\/g, "/")
    .replace(/^dashboard\/manage\//, "")
    .replace(/^dashboard\//, "");
  const last = n.split("/").pop();
  let s = 0;

  if (n && r.includes(n)) s += 60;
  if (last && r.includes(`/${last}/`)) s += 45;
  if (last && r.includes(last)) s += 25;

  // Flutter / Dart
  if (/\.dart$/i.test(r)) {
    if (last && r.includes(`/screens/`) && r.includes(last)) s += 40;
    if (last && r.includes(`/features/`) && r.includes(last)) s += 40;
    if (/bloc|cubit|provider|controller|viewmodel|repository|service|api|endpoint/i.test(r) && last && r.includes(last))
      s += 35;
    if (/endpoint/i.test(r)) s += 20;
  }

  // .NET
  if (r.includes(`controllers/${last}`)) s += 40;
  if (r.includes(`repositories/${last}`)) s += 45;
  if (r.includes(`/entity/`) && r.includes(last)) s += 30;
  if (r.includes(`/models/`) && r.includes(last)) s += 25;
  if (r.includes(`/viewmodel/`) && r.includes(last)) s += 20;
  if (r.includes(`/views/${last}/`)) s += 15;
  if (/limithistorylog/i.test(r) && /limit|expenditure|cashbook|budget/i.test(n)) s += 35;
  if (/commonrepository\.cs$/i.test(r) && /limit|expenditure|cashbook|budget/i.test(n)) s += 20;
  return s;
}

function extractStoredProcs(content) {
  const names = new Set();
  const re = /Query(?:Async|FirstOrDefaultAsync|MultipleAsync)?\s*<[^>]*>\s*\(\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    if (!/^(select|insert|update|delete)\b/i.test(m[1])) names.add(m[1]);
  }
  const re2 = /commandType:\s*CommandType\.StoredProcedure[\s\S]{0,80}?["']([^"']+)["']/gi;
  while ((m = re2.exec(content)) !== null) names.add(m[1]);
  // Direct: ("InsertLimit", param, commandType: CommandType.StoredProcedure)
  const re3 = /\(\s*["']([A-Za-z_][\w]*)["']\s*,\s*param\s*,\s*commandType:\s*CommandType\.StoredProcedure/g;
  while ((m = re3.exec(content)) !== null) names.add(m[1]);
  return [...names];
}

function extractParamHints(content) {
  const params = [];
  const re = /param\.Add\(\s*["'](@?\w+)["']\s*,\s*([^)]+)\)/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    params.push(`${m[1]} ← ${m[2].trim().slice(0, 80)}`);
  }
  return params.slice(0, 40);
}

/**
 * Focused digest for one feature module — controller/repo/entity + SP/params + LimitHistoryLog.
 */
export async function buildFocusedModuleDigest(rootDir, moduleName) {
  const needle = String(moduleName || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/controller$/i, "");

  const all = await walk(rootDir);
  const ranked = all
    .map((f) => ({ ...f, score: scoreFile(f.rel, needle) }))
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score);

  // Always pull LimitHistoryLog entity + CommonRepository limit helpers for FMS modules
  const extras = all.filter((f) => {
    const r = f.rel.toLowerCase();
    if (/limithistorylog|schemeallocationmodel\.cs$/i.test(r)) return true;
    if (/commonrepository\.cs$/i.test(r) && /limit|expenditure|budget|cashbook/i.test(needle))
      return true;
    return false;
  });

  const selected = [];
  const seen = new Set();
  for (const f of [...ranked, ...extras]) {
    if (seen.has(f.rel)) continue;
    seen.add(f.rel);
    selected.push(f);
    if (selected.length >= 14) break;
  }

  const files = [];
  const storedProcedures = new Set();
  const paramHints = [];

  for (const f of selected) {
    let content = "";
    try {
      const st = await fs.stat(f.abs);
      if (st.size > 200_000) continue;
      content = await fs.readFile(f.abs, "utf8");
    } catch {
      continue;
    }
    if (!content || content.includes("\u0000")) continue;

    for (const sp of extractStoredProcs(content)) storedProcedures.add(sp);
    if (/Repository\.cs$/i.test(f.base) || /param\.Add/i.test(content)) {
      paramHints.push(...extractParamHints(content).map((p) => `${f.base}: ${p}`));
    }

    if (content.length > MAX_FILE) {
      content = content.slice(0, MAX_FILE) + "\n/* …truncated… */\n";
    }
    files.push({ path: f.rel, content, score: f.score });
  }

  // Extract LimitHistoryLog class block if present
  let limitHistorySnippet = "";
  for (const f of files) {
    if (!/limithistorylog|schemeallocationmodel/i.test(f.path)) continue;
    const m = f.content.match(/public class LimitHistoryLog\s*\{[\s\S]{0,2500}?^\s*\}/m);
    if (m) {
      limitHistorySnippet = m[0];
      break;
    }
  }

  let digest = `FEATURE MODULE: ${moduleName}\n`;
  digest += `NEEDLE: ${needle}\n`;
  digest += `STORED_PROCEDURES: ${[...storedProcedures].join(", ") || "(none found in selected files)"}\n`;
  digest += `SP_PARAMS (from repository param.Add):\n${paramHints.slice(0, 50).join("\n") || "(none)"}\n\n`;

  if (limitHistorySnippet) {
    digest += `LIMIT_HISTORY_LOG_MODEL (central FMS ledger):\n${limitHistorySnippet}\n\n`;
  }

  // Explicit FMS hints so AI does not invent scheme-wise allocation
  if (/limitallocation|expenditure|cashbook|budget/i.test(needle)) {
    digest += `FMS_DOMAIN_HINTS (from code evidence):\n`;
    digest += `- SaveLimit SP params: FromDepartmentID, ToLevelID, FromLevelID, TotalAmount, Json — SchemeID/HeadID are commented out in repository → department/level allocation.\n`;
    digest += `- LimitHistoryLogForExpenditureDetail params: DepartmentID, LevelID, FinancialYear → remaining limit is department-level.\n`;
    digest += `- SaveExpenditure params include SchemeID + DepartmentID → scheme is recorded when spending, not when allocating department limit.\n`;
    digest += `- LimitHistoryLog tracks TotalAllocation, TotalExpenditure, Remain (main FMS ledger).\n\n`;
  }

  digest += `EVIDENCE FILES:\n`;
  for (const f of files) {
    const block = `\n--- FILE: ${f.path} ---\n${f.content}\n`;
    if (digest.length + block.length > MAX_DIGEST) break;
    digest += block;
  }

  return {
    digest,
    stats: {
      files: files.length,
      storedProcedures: [...storedProcedures],
      digestChars: digest.length,
    },
  };
}
