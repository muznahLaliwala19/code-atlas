import {
  DB_NPM_RULES,
  DB_PYTHON_RULES,
  DB_COMPOSER_RULES,
  DB_URL_PATTERNS,
  DB_FILE_RULES,
  PRISMA_PROVIDER_MAP,
  DOTNET_DB_RULES,
  JAVA_DB_RULES,
} from "./rules/database.js";

function keyOf(name, orm) {
  return `${name || ""}||${orm || ""}`;
}

/**
 * Detect databases and ORMs with evidence.
 */
export function detectDatabases(files, npmPackages = []) {
  const map = new Map(); // key -> { name, orm, evidence:Set }

  function upsert({ name, orm, evidence }) {
    const k = keyOf(name, orm);
    // Prefer entries that have a concrete DB name when merging same orm
    if (!map.has(k)) {
      map.set(k, { name: name || null, orm: orm || null, evidence: new Set() });
    }
    const row = map.get(k);
    if (name && !row.name) row.name = name;
    if (orm && !row.orm) row.orm = orm;
    if (evidence) row.evidence.add(evidence);
  }

  // From npm package list
  for (const pkg of npmPackages) {
    for (const rule of DB_NPM_RULES) {
      if (pkg === rule.pkg || pkg.startsWith(rule.pkg + "/")) {
        upsert({ name: rule.name, orm: rule.orm, evidence: `package:${pkg}` });
      }
    }
  }

  for (const f of files) {
    const norm = f.rel.replace(/\\/g, "/");

    for (const rule of DB_FILE_RULES) {
      if (rule.match.test(norm)) {
        upsert({ name: rule.name, orm: rule.orm, evidence: norm });
      }
    }

    if (!f.content) continue;

    // Prisma datasource provider (ignore generator provider like prisma-client-js)
    if (f.base === "schema.prisma" || norm.endsWith("schema.prisma")) {
      upsert({ name: null, orm: "Prisma", evidence: norm });
      const datasource = f.content.match(
        /datasource\s+\w+\s*\{([\s\S]*?)\}/i
      );
      const block = datasource ? datasource[1] : "";
      const provider = block.match(/provider\s*=\s*"([^"]+)"/i);
      if (provider) {
        const raw = provider[1].toLowerCase();
        const dbName = PRISMA_PROVIDER_MAP[raw] || provider[1];
        upsert({
          name: dbName,
          orm: "Prisma",
          evidence: `${norm} (provider=${provider[1]})`,
        });
      }
    }

    for (const rule of DB_URL_PATTERNS) {
      if (rule.match.test(f.content)) {
        upsert({ name: rule.name, orm: null, evidence: norm });
      }
    }

    if (f.base === "requirements.txt" || f.base === "pyproject.toml" || f.base === "Pipfile") {
      for (const rule of DB_PYTHON_RULES) {
        const re = new RegExp(`\\b${rule.pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        if (re.test(f.content)) {
          upsert({ name: rule.name, orm: rule.orm, evidence: `${norm}:${rule.pkg}` });
        }
      }
    }

    if (f.base === "composer.json") {
      for (const rule of DB_COMPOSER_RULES) {
        if (f.content.includes(rule.pkg)) {
          upsert({ name: rule.name, orm: rule.orm, evidence: `${norm}:${rule.pkg}` });
        }
      }
    }

    if (f.ext === ".cs" || f.ext === ".csproj" || f.base === "appsettings.json") {
      for (const rule of DOTNET_DB_RULES) {
        if (rule.match.test(f.content)) {
          upsert({ name: rule.name, orm: rule.orm, evidence: norm });
        }
      }
      // ConnectionStrings in appsettings
      const cs = f.content.match(/ConnectionStrings[\s\S]{0,400}/i);
      if (cs) {
        if (/Server=|Initial Catalog=/i.test(cs[0])) {
          upsert({ name: "Microsoft SQL Server", orm: null, evidence: norm });
        }
        if (/Host=.*Database=/i.test(cs[0]) || /Postgres/i.test(cs[0])) {
          upsert({ name: "PostgreSQL", orm: null, evidence: norm });
        }
      }
    }

    if (
      f.ext === ".java" ||
      f.ext === ".kt" ||
      f.base === "application.properties" ||
      f.base === "application.yml" ||
      f.base === "application.yaml"
    ) {
      for (const rule of JAVA_DB_RULES) {
        if (rule.match.test(f.content)) {
          upsert({ name: rule.name, orm: rule.orm, evidence: norm });
        }
      }
    }

    // Django DATABASES
    if (/DATABASES\s*=\s*\{/i.test(f.content) && /django/i.test(f.content + f.rel)) {
      if (/postgres|psycopg/i.test(f.content)) upsert({ name: "PostgreSQL", orm: "Django ORM", evidence: norm });
      if (/mysql/i.test(f.content)) upsert({ name: "MySQL", orm: "Django ORM", evidence: norm });
      if (/sqlite/i.test(f.content)) upsert({ name: "SQLite", orm: "Django ORM", evidence: norm });
      if (/mongo/i.test(f.content)) upsert({ name: "MongoDB", orm: "Django ORM", evidence: norm });
    }
  }

  let rows = [...map.values()].map((r) => ({
    name: r.name || null,
    orm: r.orm || null,
    evidence: [...r.evidence].slice(0, 12),
  }));

  // If we have PostgreSQL + Prisma separately, merge into one strong row
  const withOrmNoDb = rows.filter((r) => r.orm && !r.name);
  const withDb = rows.filter((r) => r.name);
  if (withOrmNoDb.length && withDb.length) {
    for (const ormRow of withOrmNoDb) {
      const match = withDb.find((d) => !d.orm) || withDb[0];
      if (match) {
        match.orm = match.orm || ormRow.orm;
        match.evidence = [...new Set([...match.evidence, ...ormRow.evidence])].slice(0, 12);
      }
    }
    rows = rows.filter((r) => r.name);
  }

  rows = rows.map((r) => ({
    name: r.name || (r.orm ? "Unknown (via ORM)" : "Unknown"),
    orm: r.orm,
    evidence: r.evidence,
  }));

  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const k = `${r.name}::${r.orm || ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }

  return out.filter((r) => !(r.name === "Unknown" && !r.orm));
}
