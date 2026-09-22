import fs from "fs/promises";
import path from "path";
import { detectDatabases } from "../scanner/detect-database.js";
import { IGNORE_DIRS } from "../scanner/constants.js";

const MAX_BYTES = 80_000;

async function walkFiles(rootDir) {
  const out = [];
  async function walk(abs, rel) {
    let entries;
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith(".") && entry.name !== ".github") continue;
      const childAbs = path.join(abs, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(childAbs, childRel);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      const interesting =
        ext === ".cs" ||
        ext === ".csproj" ||
        ext === ".json" ||
        ext === ".xml" ||
        entry.name === "appsettings.json" ||
        entry.name === "appsettings.Development.json";
      if (!interesting) continue;
      out.push({
        rel: childRel.replace(/\\/g, "/"),
        base: entry.name,
        ext,
        abs: childAbs,
      });
    }
  }
  await walk(rootDir, "");
  return out;
}

/**
 * Deterministic DB/ORM detection from disk (Dapper, EF, SQL Server, etc.).
 */
export async function detectDatabasesFromDisk(rootDir) {
  const paths = await walkFiles(rootDir);
  const files = [];
  for (const f of paths) {
    let content = "";
    try {
      const st = await fs.stat(f.abs);
      if (st.size > MAX_BYTES) continue;
      content = await fs.readFile(f.abs, "utf8");
    } catch {
      continue;
    }
    files.push({ rel: f.rel, base: f.base, ext: f.ext, content });
  }
  return detectDatabases(files, []);
}

export function mergeDatabaseSignals(diskRows, aiRows) {
  const map = new Map();

  const add = (row) => {
    const name = row.name || "Unknown";
    const orm = row.orm || null;
    const key = `${name}||${orm || ""}`;
    if (!map.has(key)) {
      map.set(key, { name, orm, evidence: new Set() });
    }
    const entry = map.get(key);
    for (const e of row.evidence || []) entry.evidence.add(e);
  };

  for (const row of diskRows || []) {
    add({
      name: row.name,
      orm: row.orm,
      evidence: Array.isArray(row.evidence) ? row.evidence : [],
    });
  }

  for (const row of aiRows || []) {
    const existing = [...map.values()].find(
      (x) => x.name === row.name || (row.orm && x.orm === row.orm)
    );
    if (existing) {
      for (const e of row.evidence || []) existing.evidence.add(`ai:${e}`);
      if (!existing.orm && row.orm) existing.orm = row.orm;
    } else {
      add({
        name: row.name,
        orm: row.orm,
        evidence: (row.evidence || []).map((e) => `ai:${e}`),
      });
    }
  }

  // If Dapper evidence exists, don't label as EF unless EF package also present
  const hasDapper = [...map.values()].some((x) => x.orm === "Dapper");
  const hasEf = [...map.values()].some((x) => x.orm === "Entity Framework Core");
  if (hasDapper && !hasEf) {
    for (const entry of map.values()) {
      if (entry.orm === "Entity Framework Core") entry.orm = null;
    }
  }

  return [...map.values()]
    .map((x) => ({
      name: x.name,
      orm: x.orm,
      evidence: [...x.evidence].slice(0, 12),
    }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}
