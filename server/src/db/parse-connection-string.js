/**
 * Parse PostgreSQL/MySQL URIs and SQL Server ADO.NET / URI connection strings.
 */

function parseKeyValueConnectionString(raw) {
  const out = {};
  for (const part of String(raw).split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim().toLowerCase();
    const value = trimmed.slice(eq + 1).trim();
    out[key] = value;
  }
  return out;
}

function parseServerHostPort(server) {
  const s = String(server || "").trim();
  if (!s) return { host: "localhost", port: undefined };
  if (s.includes(",")) {
    const [host, portRaw] = s.split(",");
    return { host: host.trim(), port: Number(portRaw.trim()) || undefined };
  }
  if (s.includes(":")) {
    const [host, portRaw] = s.split(":");
    return { host: host.trim(), port: Number(portRaw.trim()) || undefined };
  }
  return { host: s, port: undefined };
}

function parseAdoNetSqlServer(raw) {
  const kv = parseKeyValueConnectionString(raw);
  const server =
    kv.server ||
    kv["data source"] ||
    kv["addr"] ||
    kv["address"] ||
    kv["network address"];
  const database =
    kv.database ||
    kv["initial catalog"] ||
    kv["initialcatalog"];
  const user =
    kv["user id"] ||
    kv.userid ||
    kv.uid ||
    kv.user;
  const password = kv.password || kv.pwd;
  const { host, port } = parseServerHostPort(server);

  if (!host || !database) {
    throw new Error(
      "Invalid SQL Server connection string. Need Server and Database (or Initial Catalog)."
    );
  }

  const trusted =
    /^(true|yes|sspi|1)$/i.test(kv["trusted_connection"] || "") ||
    /^(true|yes|1)$/i.test(kv["integrated security"] || "");

  return {
    engine: "sqlserver",
    server: host,
    port: port || 1433,
    database,
    user: user || undefined,
    password: password || undefined,
    options: {
      encrypt: !/^(false|0|no)$/i.test(kv.encrypt || ""),
      trustServerCertificate: !/^(false|0|no)$/i.test(
        kv.trustservercertificate || "true"
      ),
      trustedConnection: trusted,
    },
  };
}

function parseUriConnectionString(raw) {
  const normalized = raw.replace(/^sqlserver:/i, "mssql:");
  const url = new URL(normalized);
  const engine = url.protocol.replace(":", "").toLowerCase();

  if (engine === "postgres" || engine === "postgresql") {
    return { engine: "postgresql", connectionString: raw };
  }
  if (engine === "mysql" || engine === "mysql2") {
    return { engine: "mysql", connectionString: raw };
  }
  if (engine === "mssql" || engine === "sqlserver") {
    const params = url.searchParams;
    return {
      engine: "sqlserver",
      server: url.hostname,
      port: Number(url.port || 1433),
      database: url.pathname.replace(/^\//, "") || undefined,
      user: decodeURIComponent(url.username || "") || undefined,
      password: decodeURIComponent(url.password || "") || undefined,
      options: {
        encrypt: params.get("encrypt") !== "false",
        trustServerCertificate: params.get("trustServerCertificate") !== "false",
        trustedConnection: false,
      },
    };
  }

  throw new Error(
    "Unsupported connection string URI. Use postgresql://, mysql://, or mssql://"
  );
}

export function parseDatabaseConnection(raw) {
  const s = String(raw || "").trim();
  if (!s) throw new Error("connectionString is required");

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    return parseUriConnectionString(s);
  }

  const lower = s.toLowerCase();
  if (
    lower.includes("server=") ||
    lower.includes("data source=") ||
    lower.includes("initial catalog=") ||
    (lower.includes("database=") && !lower.includes("mysql"))
  ) {
    return parseAdoNetSqlServer(s);
  }

  if (lower.startsWith("postgres") || lower.includes("postgres")) {
    return { engine: "postgresql", connectionString: s };
  }
  if (lower.startsWith("mysql") || lower.includes("mysql://")) {
    return { engine: "mysql", connectionString: s };
  }

  throw new Error(
    "Unsupported connection string. Use postgresql://, mysql://, mssql://, or SQL Server ADO.NET (Server=…;Database=…;…)."
  );
}

export function redactConnectionString(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    return s.replace(/:\/\/([^:@/]+)(?::([^@/]+))?@/, "://$1:***@");
  }

  return s.replace(/(\b(?:password|pwd)\s*=\s*)([^;]*)/gi, "$1***");
}
