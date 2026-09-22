import pg from "pg";
import mysql from "mysql2/promise";
import sql from "mssql";
import { parseDatabaseConnection } from "./parse-connection-string.js";

function tableKey(schema, name) {
  return `${schema || "dbo"}.${name}`.toLowerCase();
}

function attachKeysToTables(tables, primaryKeys, foreignKeys) {
  const pkMap = new Map();
  for (const pk of primaryKeys || []) {
    const k = tableKey(pk.schema, pk.table);
    if (!pkMap.has(k)) pkMap.set(k, []);
    pkMap.get(k).push(pk.column);
  }

  const fkByFrom = new Map();
  const fkByTo = new Map();
  for (const fk of foreignKeys || []) {
    const fromK = tableKey(fk.fromSchema, fk.fromTable);
    const toK = tableKey(fk.toSchema, fk.toTable);
    if (!fkByFrom.has(fromK)) fkByFrom.set(fromK, []);
    if (!fkByTo.has(toK)) fkByTo.set(toK, []);
    fkByFrom.get(fromK).push(fk);
    fkByTo.get(toK).push(fk);
  }

  return (tables || []).map((t) => {
    const k = tableKey(t.schema, t.name);
    const pks = pkMap.get(k) || [];
    const columns = (t.columns || []).map((c) => ({
      ...c,
      isPrimaryKey: pks.includes(c.name),
      isForeignKey: (fkByFrom.get(k) || []).some((fk) => fk.fromColumn === c.name),
    }));
    return {
      ...t,
      primaryKey: pks,
      foreignKeys: (fkByFrom.get(k) || []).map((fk) => ({
        constraint: fk.constraint,
        column: fk.fromColumn,
        references: `${fk.toSchema}.${fk.toTable}.${fk.toColumn}`,
        referencesTable: fk.toTable,
        referencesSchema: fk.toSchema,
        referencesColumn: fk.toColumn,
      })),
      referencedBy: (fkByTo.get(k) || []).map((fk) => ({
        constraint: fk.constraint,
        from: `${fk.fromSchema}.${fk.fromTable}.${fk.fromColumn}`,
        fromTable: fk.fromTable,
        fromSchema: fk.fromSchema,
        fromColumn: fk.fromColumn,
      })),
      columns,
    };
  });
}

function buildRelationshipGraph(foreignKeys) {
  return (foreignKeys || []).map((fk) => ({
    from: `${fk.fromSchema}.${fk.fromTable}`,
    fromTable: fk.fromTable,
    fromColumn: fk.fromColumn,
    to: `${fk.toSchema}.${fk.toTable}`,
    toTable: fk.toTable,
    toColumn: fk.toColumn,
    constraint: fk.constraint,
    edge: `${fk.fromTable}.${fk.fromColumn} → ${fk.toTable}.${fk.toColumn}`,
  }));
}

async function introspectPostgres(connectionString) {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10000 });
  await client.connect();
  try {
    const tablesRes = await client.query(`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_type = 'BASE TABLE'
        AND table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name
      LIMIT 200
    `);

    const pkRes = await client.query(`
      SELECT
        tc.table_schema,
        tc.table_name,
        kcu.column_name,
        tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY tc.table_schema, tc.table_name, kcu.ordinal_position
    `);

    const fkRes = await client.query(`
      SELECT
        tc.constraint_name,
        kcu.table_schema AS from_schema,
        kcu.table_name AS from_table,
        kcu.column_name AS from_column,
        ccu.table_schema AS to_schema,
        ccu.table_name AS to_table,
        ccu.column_name AS to_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY from_table, from_column
    `);

    const primaryKeys = pkRes.rows.map((r) => ({
      schema: r.table_schema,
      table: r.table_name,
      column: r.column_name,
      constraint: r.constraint_name,
    }));

    const foreignKeys = fkRes.rows.map((r) => ({
      constraint: r.constraint_name,
      fromSchema: r.from_schema,
      fromTable: r.from_table,
      fromColumn: r.from_column,
      toSchema: r.to_schema,
      toTable: r.to_table,
      toColumn: r.to_column,
    }));

    const tables = [];
    for (const row of tablesRes.rows) {
      const cols = await client.query(
        `
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position
      `,
        [row.table_schema, row.table_name]
      );
      let rowCount = null;
      try {
        const c = await client.query(
          `SELECT COUNT(*)::int AS c FROM "${row.table_schema}"."${row.table_name}"`
        );
        rowCount = c.rows[0]?.c ?? null;
      } catch {
        /* skip count */
      }
      tables.push({
        schema: row.table_schema,
        name: row.table_name,
        rowCount,
        columns: cols.rows.map((c) => ({
          name: c.column_name,
          type: c.data_type,
          nullable: c.is_nullable === "YES",
          default: c.column_default,
        })),
      });
    }

    const enriched = attachKeysToTables(tables, primaryKeys, foreignKeys);
    return {
      engine: "PostgreSQL",
      tables: enriched,
      primaryKeys,
      foreignKeys,
      relationships: buildRelationshipGraph(foreignKeys),
    };
  } finally {
    await client.end().catch(() => {});
  }
}

async function introspectMysql(connectionString) {
  const url = new URL(connectionString.replace(/^mysql2:/, "mysql:"));
  const conn = await mysql.createConnection({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, "") || undefined,
    connectTimeout: 10000,
  });
  try {
    const db = url.pathname.replace(/^\//, "") || null;
    const [tableRows] = await conn.query(
      `
      SELECT TABLE_SCHEMA as table_schema, TABLE_NAME as table_name
      FROM information_schema.tables
      WHERE TABLE_TYPE = 'BASE TABLE'
        AND TABLE_SCHEMA = COALESCE(?, DATABASE())
      ORDER BY TABLE_NAME
      LIMIT 200
    `,
      [db]
    );

    const [pkRows] = await conn.query(
      `
      SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, CONSTRAINT_NAME
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE CONSTRAINT_NAME = 'PRIMARY'
        AND TABLE_SCHEMA = COALESCE(?, DATABASE())
      ORDER BY TABLE_NAME, ORDINAL_POSITION
    `,
      [db]
    );

    const [fkRows] = await conn.query(
      `
      SELECT
        CONSTRAINT_NAME,
        TABLE_SCHEMA AS from_schema,
        TABLE_NAME AS from_table,
        COLUMN_NAME AS from_column,
        REFERENCED_TABLE_SCHEMA AS to_schema,
        REFERENCED_TABLE_NAME AS to_table,
        REFERENCED_COLUMN_NAME AS to_column
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = COALESCE(?, DATABASE())
        AND REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY TABLE_NAME, COLUMN_NAME
    `,
      [db]
    );

    const primaryKeys = (pkRows || []).map((r) => ({
      schema: r.TABLE_SCHEMA,
      table: r.TABLE_NAME,
      column: r.COLUMN_NAME,
      constraint: r.CONSTRAINT_NAME,
    }));

    const foreignKeys = (fkRows || []).map((r) => ({
      constraint: r.CONSTRAINT_NAME,
      fromSchema: r.from_schema,
      fromTable: r.from_table,
      fromColumn: r.from_column,
      toSchema: r.to_schema,
      toTable: r.to_table,
      toColumn: r.to_column,
    }));

    const tables = [];
    for (const row of tableRows) {
      const [cols] = await conn.query(
        `
        SELECT COLUMN_NAME as column_name, DATA_TYPE as data_type,
               IS_NULLABLE as is_nullable, COLUMN_DEFAULT as column_default
        FROM information_schema.columns
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION
      `,
        [row.table_schema, row.table_name]
      );
      let rowCount = null;
      try {
        const [c] = await conn.query(
          `SELECT COUNT(*) AS c FROM \`${row.table_schema}\`.\`${row.table_name}\``
        );
        rowCount = c[0]?.c ?? null;
      } catch {
        /* skip */
      }
      tables.push({
        schema: row.table_schema,
        name: row.table_name,
        rowCount,
        columns: cols.map((c) => ({
          name: c.column_name,
          type: c.data_type,
          nullable: c.is_nullable === "YES",
          default: c.column_default,
        })),
      });
    }

    const enriched = attachKeysToTables(tables, primaryKeys, foreignKeys);
    return {
      engine: "MySQL",
      tables: enriched,
      primaryKeys,
      foreignKeys,
      relationships: buildRelationshipGraph(foreignKeys),
    };
  } finally {
    await conn.end().catch(() => {});
  }
}

async function introspectSqlServer(config) {
  const pool = await sql.connect({
    server: config.server,
    port: config.port || 1433,
    database: config.database,
    user: config.user,
    password: config.password,
    options: {
      encrypt: config.options?.encrypt ?? false,
      trustServerCertificate: config.options?.trustServerCertificate ?? true,
      trustedConnection: config.options?.trustedConnection ?? false,
    },
    connectionTimeout: 15000,
    requestTimeout: 30000,
  });

  try {
    const tablesRes = await pool.request().query(`
      SELECT TABLE_SCHEMA AS table_schema, TABLE_NAME AS table_name
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE = 'BASE TABLE'
        AND TABLE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA', 'guest')
      ORDER BY TABLE_SCHEMA, TABLE_NAME
      OFFSET 0 ROWS FETCH NEXT 200 ROWS ONLY
    `);

    const pkRes = await pool.request().query(`
      SELECT
        s.name AS table_schema,
        t.name AS table_name,
        c.name AS column_name,
        i.name AS constraint_name
      FROM sys.indexes i
      INNER JOIN sys.index_columns ic
        ON i.object_id = ic.object_id AND i.index_id = ic.index_id
      INNER JOIN sys.columns c
        ON ic.object_id = c.object_id AND ic.column_id = c.column_id
      INNER JOIN sys.tables t ON i.object_id = t.object_id
      INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
      WHERE i.is_primary_key = 1
      ORDER BY s.name, t.name, ic.key_ordinal
    `);

    const fkRes = await pool.request().query(`
      SELECT
        fk.name AS constraint_name,
        sch_from.name AS from_schema,
        tab_from.name AS from_table,
        col_from.name AS from_column,
        sch_to.name AS to_schema,
        tab_to.name AS to_table,
        col_to.name AS to_column
      FROM sys.foreign_keys fk
      INNER JOIN sys.foreign_key_columns fkc
        ON fk.object_id = fkc.constraint_object_id
      INNER JOIN sys.tables tab_from ON fkc.parent_object_id = tab_from.object_id
      INNER JOIN sys.schemas sch_from ON tab_from.schema_id = sch_from.schema_id
      INNER JOIN sys.columns col_from
        ON fkc.parent_object_id = col_from.object_id
       AND fkc.parent_column_id = col_from.column_id
      INNER JOIN sys.tables tab_to ON fkc.referenced_object_id = tab_to.object_id
      INNER JOIN sys.schemas sch_to ON tab_to.schema_id = sch_to.schema_id
      INNER JOIN sys.columns col_to
        ON fkc.referenced_object_id = col_to.object_id
       AND fkc.referenced_column_id = col_to.column_id
      ORDER BY from_table, from_column
    `);

    const primaryKeys = (pkRes.recordset || []).map((r) => ({
      schema: r.table_schema,
      table: r.table_name,
      column: r.column_name,
      constraint: r.constraint_name,
    }));

    const foreignKeys = (fkRes.recordset || []).map((r) => ({
      constraint: r.constraint_name,
      fromSchema: r.from_schema,
      fromTable: r.from_table,
      fromColumn: r.from_column,
      toSchema: r.to_schema,
      toTable: r.to_table,
      toColumn: r.to_column,
    }));

    const tables = [];
    for (const row of tablesRes.recordset || []) {
      const colsRes = await pool
        .request()
        .input("schema", sql.NVarChar, row.table_schema)
        .input("table", sql.NVarChar, row.table_name)
        .query(`
          SELECT COLUMN_NAME AS column_name, DATA_TYPE AS data_type,
                 IS_NULLABLE AS is_nullable, COLUMN_DEFAULT AS column_default
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
          ORDER BY ORDINAL_POSITION
        `);

      let rowCount = null;
      try {
        const countRes = await pool.request().query(
          `SELECT COUNT(*) AS c FROM [${row.table_schema}].[${row.table_name}]`
        );
        rowCount = countRes.recordset?.[0]?.c ?? null;
      } catch {
        /* skip count */
      }

      tables.push({
        schema: row.table_schema,
        name: row.table_name,
        rowCount,
        columns: (colsRes.recordset || []).map((c) => ({
          name: c.column_name,
          type: c.data_type,
          nullable: c.is_nullable === "YES",
          default: c.column_default,
        })),
      });
    }

    const enriched = attachKeysToTables(tables, primaryKeys, foreignKeys);
    return {
      engine: "Microsoft SQL Server",
      tables: enriched,
      primaryKeys,
      foreignKeys,
      relationships: buildRelationshipGraph(foreignKeys),
    };
  } finally {
    await pool.close().catch(() => {});
  }
}

/**
 * Connect to Postgres/MySQL/SQL Server and return full schema JSON
 * including primary keys, foreign keys, and relationship graph.
 */
export async function introspectDatabase(connectionString) {
  const parsed = parseDatabaseConnection(connectionString);
  if (parsed.engine === "postgresql") {
    return introspectPostgres(parsed.connectionString);
  }
  if (parsed.engine === "mysql") {
    return introspectMysql(parsed.connectionString);
  }
  return introspectSqlServer(parsed);
}
