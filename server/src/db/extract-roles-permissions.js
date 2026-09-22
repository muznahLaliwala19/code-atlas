/**
 * Read distinct role / permission values from live DB tables.
 * Only tables whose names look like roles/permissions; only name-like columns.
 * Never invent values — returns empty when nothing matches.
 */
import pg from "pg";
import mysql from "mysql2/promise";
import sql from "mssql";
import { parseDatabaseConnection } from "./parse-connection-string.js";

const ROLE_TABLE_RE =
  /role|rolemaster|userrole|approle|aspnetroles/i;
const PERM_TABLE_RE =
  /permission|userpermission|roleclaim|aspnetroleclaims|claim/i;

const ROLE_COL_RE = /^(rolename|role_name|rolecode|role_code|name|code|title|label|rolenameen)$/i;
const PERM_COL_RE =
  /^(permission|permissionname|permission_name|claimvalue|claim_value|name|code|key|title|label)$/i;

const SKIP_VALUE_RE =
  /^(true|false|null|none|n\/a|undefined|0|1|isclosed|isactive|isdeleted|isenabled)$/i;

function isRoleTable(name) {
  const n = String(name || "").replace(/^dbo\./i, "");
  if (!ROLE_TABLE_RE.test(n)) return false;
  // Avoid matching unrelated tables like "Payroll", "Control"
  if (/payroll|enrol|control|scroll/i.test(n) && !/role/i.test(n)) return false;
  return /role/i.test(n);
}

function isPermTable(name) {
  const n = String(name || "").replace(/^dbo\./i, "");
  return PERM_TABLE_RE.test(n);
}

function pickColumn(columns, preferRe) {
  const cols = (columns || []).map((c) => (typeof c === "string" ? c : c.name)).filter(Boolean);
  const hit = cols.find((c) => preferRe.test(c));
  if (hit) return hit;
  // secondary: any column containing role/name/permission
  return cols.find((c) => /role|name|permission|claim|code/i.test(c)) || null;
}

function cleanValue(v) {
  const s = String(v ?? "").trim();
  if (!s || s.length > 80) return null;
  if (SKIP_VALUE_RE.test(s)) return null;
  if (/^[0-9a-f-]{36}$/i.test(s)) return null; // guids
  if (/^\d+$/.test(s)) return null;
  return s;
}

async function distinctPostgres(client, schema, table, column) {
  const q = `
    SELECT DISTINCT TRIM(BOTH FROM "${column}"::text) AS v
    FROM "${schema}"."${table}"
    WHERE "${column}" IS NOT NULL
      AND TRIM(BOTH FROM "${column}"::text) <> ''
    ORDER BY 1
    LIMIT 80
  `;
  const res = await client.query(q);
  return (res.rows || []).map((r) => cleanValue(r.v)).filter(Boolean);
}

async function distinctMysql(conn, schema, table, column) {
  const [rows] = await conn.query(
    `
    SELECT DISTINCT TRIM(\`${column}\`) AS v
    FROM \`${schema}\`.\`${table}\`
    WHERE \`${column}\` IS NOT NULL AND TRIM(\`${column}\`) <> ''
    ORDER BY 1
    LIMIT 80
    `
  );
  return (rows || []).map((r) => cleanValue(r.v)).filter(Boolean);
}

async function distinctMssql(pool, schema, table, column) {
  const res = await pool.request().query(`
    SELECT DISTINCT TOP 80 LTRIM(RTRIM(CONVERT(nvarchar(200), [${column}]))) AS v
    FROM [${schema}].[${table}]
    WHERE [${column}] IS NOT NULL
      AND LTRIM(RTRIM(CONVERT(nvarchar(200), [${column}]))) <> N''
    ORDER BY 1
  `);
  return (res.recordset || []).map((r) => cleanValue(r.v)).filter(Boolean);
}

/**
 * @param {string} connectionString
 * @param {{ tables?: array }} schema - from introspectDatabase
 */
export async function extractRolesPermissionsFromDatabase(connectionString, schema) {
  const tables = schema?.tables || [];
  const roles = new Set();
  const permissions = new Set();
  const evidence = [];
  const sources = [];

  const roleTables = tables.filter((t) => isRoleTable(t.name));
  const permTables = tables.filter((t) => isPermTable(t.name));

  if (!roleTables.length && !permTables.length) {
    return {
      roles: [],
      permissions: [],
      evidence: [],
      notes: [
        "No role/permission tables found in live schema (expected names like Role, Roles, RoleMaster, Permission, UserPermission).",
      ],
      source: "database",
    };
  }

  const parsed = parseDatabaseConnection(connectionString);

  async function runForEngine(queryDistinct) {
    for (const t of roleTables) {
      const col = pickColumn(t.columns, ROLE_COL_RE);
      if (!col) {
        evidence.push(`db-table:${t.schema || "dbo"}.${t.name} (no name-like column)`);
        continue;
      }
      try {
        const vals = await queryDistinct(t.schema || "dbo", t.name, col);
        for (const v of vals) roles.add(v);
        evidence.push(`db:${t.schema || "dbo"}.${t.name}.${col} → ${vals.length} values`);
        sources.push({ table: t.name, column: col, kind: "role", count: vals.length });
      } catch (e) {
        evidence.push(`db-error:${t.name}.${col}: ${e.message}`);
      }
    }
    for (const t of permTables) {
      const col = pickColumn(t.columns, PERM_COL_RE);
      if (!col) {
        evidence.push(`db-table:${t.schema || "dbo"}.${t.name} (no name-like column)`);
        continue;
      }
      try {
        const vals = await queryDistinct(t.schema || "dbo", t.name, col);
        for (const v of vals) permissions.add(v);
        evidence.push(`db:${t.schema || "dbo"}.${t.name}.${col} → ${vals.length} values`);
        sources.push({ table: t.name, column: col, kind: "permission", count: vals.length });
      } catch (e) {
        evidence.push(`db-error:${t.name}.${col}: ${e.message}`);
      }
    }
  }

  if (parsed.engine === "postgresql") {
    const client = new pg.Client({
      connectionString: parsed.connectionString,
      connectionTimeoutMillis: 10000,
    });
    await client.connect();
    try {
      await runForEngine((schemaName, table, column) =>
        distinctPostgres(client, schemaName, table, column)
      );
    } finally {
      await client.end().catch(() => {});
    }
  } else if (parsed.engine === "mysql") {
    const url = new URL(parsed.connectionString.replace(/^mysql2:/, "mysql:"));
    const conn = await mysql.createConnection({
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\//, ""),
      connectTimeout: 10000,
    });
    try {
      await runForEngine((schemaName, table, column) =>
        distinctMysql(conn, schemaName, table, column)
      );
    } finally {
      await conn.end().catch(() => {});
    }
  } else {
    const pool = await sql.connect({
      server: parsed.server,
      port: parsed.port || 1433,
      database: parsed.database,
      user: parsed.user,
      password: parsed.password,
      options: {
        encrypt: parsed.options?.encrypt ?? false,
        trustServerCertificate: parsed.options?.trustServerCertificate ?? true,
        trustedConnection: parsed.options?.trustedConnection ?? false,
      },
      connectionTimeout: 15000,
      requestTimeout: 30000,
    });
    try {
      await runForEngine((schemaName, table, column) =>
        distinctMssql(pool, schemaName, table, column)
      );
    } finally {
      await pool.close().catch(() => {});
    }
  }

  const roleList = [...roles].sort((a, b) => a.localeCompare(b));
  const permList = [...permissions].sort((a, b) => a.localeCompare(b));
  const notes = [];
  if (!roleList.length) {
    notes.push(
      roleTables.length
        ? "Role tables found but no distinct name values could be read (check column names / permissions)."
        : "No role tables matched in live schema."
    );
  }
  if (!permList.length) {
    notes.push(
      permTables.length
        ? "Permission tables found but no distinct values could be read."
        : "No permission tables matched in live schema."
    );
  }

  return {
    roles: roleList,
    permissions: permList,
    evidence,
    sources,
    notes,
    source: "database",
  };
}
