import fs from "fs/promises";
import path from "path";

const MAX_BYTES = 120_000;

async function walkSqlishFiles(rootDir) {
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
        if (["node_modules", "bin", "obj", "wwwroot", "plugins", ".git"].includes(entry.name)) {
          continue;
        }
        await walk(path.join(abs, entry.name), rel ? `${rel}/${entry.name}` : entry.name);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (![".cs", ".sql"].includes(ext)) continue;
      const base = entry.name.toLowerCase();
      if (
        !/repository|query|sql|dapper|dbo|\.sql$/i.test(base) &&
        !/repositories|sql|queries/i.test(rel || "")
      ) {
        if (ext === ".cs" && !/repositor|sql|query|data/i.test(rel || "")) continue;
      }
      out.push({
        abs: path.join(abs, entry.name),
        rel: (rel ? `${rel}/` : "") + entry.name,
      });
    }
  }
  await walk(rootDir, "");
  return out;
}

/**
 * Extract real JOIN / FK usage from application SQL / Dapper repositories.
 * These are evidence-based links from code — not invented from table names.
 */
export async function collectApplicationJoinsFromDisk(rootDir) {
  const files = await walkSqlishFiles(rootDir);
  const joins = [];
  const seen = new Set();

  const joinRe =
    /\b(?:INNER|LEFT|RIGHT|FULL|CROSS)?\s*JOIN\s+\[?([A-Za-z_][\w]*)\]?(?:\s+(?:AS\s+)?\[?([A-Za-z_][\w]*)\]?)?\s+ON\s+([\s\S]{0,180}?)(?=\b(?:INNER|LEFT|RIGHT|FULL|WHERE|GROUP|ORDER|JOIN)\b|$)/gi;

  const onEqRe =
    /\[?([A-Za-z_][\w]*)\]?\.\[?([A-Za-z_][\w]*)\]?\s*=\s*\[?([A-Za-z_][\w]*)\]?\.\[?([A-Za-z_][\w]*)\]?/g;

  for (const f of files) {
    let content = "";
    try {
      const st = await fs.stat(f.abs);
      if (st.size > MAX_BYTES) continue;
      content = await fs.readFile(f.abs, "utf8");
    } catch {
      continue;
    }
    if (!content || !/\bJOIN\b/i.test(content)) continue;

    let m;
    joinRe.lastIndex = 0;
    while ((m = joinRe.exec(content)) !== null) {
      const joinedTable = m[1];
      const onClause = m[3] || "";
      let eq;
      onEqRe.lastIndex = 0;
      while ((eq = onEqRe.exec(onClause)) !== null) {
        const leftTable = eq[1];
        const leftCol = eq[2];
        const rightTable = eq[3];
        const rightCol = eq[4];
        const key = `${leftTable}.${leftCol}=${rightTable}.${rightCol}`.toLowerCase();
        const keyRev = `${rightTable}.${rightCol}=${leftTable}.${leftCol}`.toLowerCase();
        if (seen.has(key) || seen.has(keyRev)) continue;
        seen.add(key);
        joins.push({
          leftTable,
          leftColumn: leftCol,
          rightTable,
          rightColumn: rightCol,
          joinedTable,
          evidence: f.rel.replace(/\\/g, "/"),
          source: "application-sql",
          edge: `${leftTable}.${leftCol} = ${rightTable}.${rightCol}`,
        });
      }
    }
  }

  return joins.sort((a, b) => a.edge.localeCompare(b.edge));
}

/**
 * Infer likely FK links only when a column name exactly matches another table's PK column,
 * AND that PK table exists in live schema. Labeled as inferred — never as declared FK.
 */
export function inferColumnPkLinks(schema) {
  const tables = schema.tables || [];
  const pkIndex = new Map(); // columnName.lower -> [{table, schema, column}]
  for (const t of tables) {
    for (const col of t.primaryKey || []) {
      const k = String(col).toLowerCase();
      if (!pkIndex.has(k)) pkIndex.set(k, []);
      pkIndex.get(k).push({ table: t.name, schema: t.schema, column: col });
    }
  }

  const declared = new Set(
    (schema.relationships || []).map(
      (r) =>
        `${r.fromTable}.${r.fromColumn}→${r.toTable}.${r.toColumn}`.toLowerCase()
    )
  );

  const inferred = [];
  const seen = new Set();
  for (const t of tables) {
    for (const c of t.columns || []) {
      if (c.isPrimaryKey) continue;
      const matches = pkIndex.get(String(c.name).toLowerCase()) || [];
      for (const pk of matches) {
        if (pk.table.toLowerCase() === t.name.toLowerCase()) continue;
        const key = `${t.name}.${c.name}→${pk.table}.${pk.column}`.toLowerCase();
        if (declared.has(key) || seen.has(key)) continue;
        seen.add(key);
        inferred.push({
          fromTable: t.name,
          fromColumn: c.name,
          toTable: pk.table,
          toColumn: pk.column,
          evidence: "column-name equals referenced table PK column",
          source: "inferred-pk-column-match",
          edge: `${t.name}.${c.name} → ${pk.table}.${pk.column}`,
        });
      }
    }
  }
  return inferred;
}
