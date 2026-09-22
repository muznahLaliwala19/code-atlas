import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fsp from "fs/promises";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import { extractZip, safeRm, clearDirContents, ensureDirSync } from "./extract.js";
import { aiAnalyzeOverview, aiExplainModule, aiAnalyzeDatabase } from "./ai/analyze.js";
import { getProviderInfo } from "./ai/client.js";
import config from "./ai/config.js"; // loads server/.env
import {
  saveProjectRecord,
  loadProjectRecord,
  updateProjectRecord,
  saveExtractPath,
  loadExtractPath,
  DATA_ROOT,
} from "./store.js";
import { redactConnectionString } from "./db/parse-connection-string.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const UPLOADS = path.join(ROOT, "uploads");
const TEMP = path.join(ROOT, "temp");
const EXTRACTS = path.join(ROOT, "data", "extracts");
/** Legacy/empty mirror under server/ — real JSON lives in repo-root data/projects */
const SERVER_PROJECTS = path.join(ROOT, "data", "projects");

ensureDirSync(UPLOADS);
ensureDirSync(TEMP);
ensureDirSync(EXTRACTS);

/** Wipe all prior extracts + saved project JSON (New scan / before new upload). */
async function cleanupAllStoredWork({ keepUploadPath = null } = {}) {
  await clearDirContents(EXTRACTS);
  await clearDirContents(DATA_ROOT);
  await clearDirContents(SERVER_PROJECTS);

  try {
    await fsp.mkdir(UPLOADS, { recursive: true });
    const keep = keepUploadPath ? path.resolve(keepUploadPath) : null;
    const entries = await fsp.readdir(UPLOADS, { withFileTypes: true });
    await Promise.all(
      entries.map(async (e) => {
        const full = path.join(UPLOADS, e.name);
        if (keep && path.resolve(full) === keep) return;
        await fsp.rm(full, { recursive: true, force: true }).catch(() => {});
      })
    );
  } catch {
    /* ignore */
  }

  console.log("[cleanup] cleared extracts, data/projects, uploads");
}

const app = express();
app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);
app.use(express.json({ limit: "2mb" }));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS),
  filename: (_req, file, cb) => {
    const id = uuidv4();
    const safe = file.originalname.replace(/[^\w.\-()+\s]/g, "_");
    cb(null, `${id}__${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = file.originalname.toLowerCase();
    if (
      name.endsWith(".zip") ||
      file.mimetype === "application/zip" ||
      file.mimetype === "application/x-zip-compressed"
    ) {
      cb(null, true);
    } else {
      cb(new Error("Please upload a .zip of your project folder"));
    }
  },
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "codeatlas",
    version: "2.0.0-ai",
    ai: getProviderInfo(),
  });
});

app.get("/api/ai/status", (_req, res) => {
  res.json(getProviderInfo());
});

/**
 * Step 1: Upload zip → AI overview (projectName, modules, apis, database, calculations)
 * Stores locally under data/projects/{id}/project.json
 */
app.post("/api/analyze", upload.single("project"), async (req, res) => {
  const projectId = uuidv4();
  const workZipCleanup = [];
  let zipPath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded. Field name must be 'project' (.zip)." });
    }
    zipPath = req.file.path;
    workZipCleanup.push(zipPath);

    // Drop any previous extracts/results so old projects never linger
    // (keep the zip we just uploaded)
    await cleanupAllStoredWork({ keepUploadPath: zipPath });

    const projectHint = req.file.originalname.replace(/\.zip$/i, "");
    const extractDir = path.join(EXTRACTS, projectId);
    ensureDirSync(extractDir);

    const { root, extracted, skipped } = await extractZip(zipPath, extractDir);
    await saveExtractPath(projectId, root);

    const overview = await aiAnalyzeOverview(root, projectHint);
    const { _scanCache, ...clientOverview } = overview;

    const record = {
      id: projectId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      zipName: req.file.originalname,
      zipBytes: req.file.size,
      extract: { extractedEntries: extracted, skippedArchiveEntries: skipped },
      overview: clientOverview,
      moduleExplanations: {},
      databaseAnalysis: null,
      ai: getProviderInfo(),
    };

    await saveProjectRecord(projectId, record);

    // remove uploaded zip; keep extract for module/db follow-ups
    await fsp.unlink(zipPath).catch(() => {});

    res.json({
      projectId,
      step: "overview",
      ...clientOverview,
      ai: record.ai,
      meta: {
        ...clientOverview.meta,
        projectId,
        zipBytes: req.file.size,
        storedAt: path.join("data", "projects", projectId, "project.json"),
      },
    });
  } catch (err) {
    console.error("[analyze]", err);
    // cleanup extract on failure
    await safeRm(path.join(EXTRACTS, projectId));
    if (zipPath) await fsp.unlink(zipPath).catch(() => {});
    res.status(500).json({ error: err.message || "AI analysis failed" });
  }
});

/**
 * Step 2: Explain one module via AI
 */
app.post("/api/projects/:id/modules/explain", async (req, res) => {
  try {
    const projectId = req.params.id;
    const moduleName = String(req.body?.module || "").trim();
    if (!moduleName) return res.status(400).json({ error: "module is required" });

    const record = await loadProjectRecord(projectId);
    if (record.moduleExplanations?.[moduleName]) {
      return res.json({
        projectId,
        step: "module",
        cached: true,
        explanation: record.moduleExplanations[moduleName],
      });
    }

    const extractRoot = await loadExtractPath(projectId);
    if (!extractRoot) {
      return res.status(404).json({ error: "Extracted project not found. Re-upload the zip." });
    }

    const explanation = await aiExplainModule(extractRoot, moduleName, record.overview);
    await updateProjectRecord(projectId, {
      moduleExplanations: { [moduleName]: explanation },
    });

    res.json({
      projectId,
      step: "module",
      cached: false,
      explanation,
    });
  } catch (err) {
    console.error("[module]", err);
    res.status(500).json({ error: err.message || "Module explanation failed" });
  }
});

/**
 * Step 3: Provide DB connection string → introspect + AI explain
 */
app.post("/api/projects/:id/database/analyze", async (req, res) => {
  try {
    const projectId = req.params.id;
    const connectionString = String(req.body?.connectionString || "").trim();
    if (!connectionString) {
      return res.status(400).json({
        error:
          "connectionString is required (postgresql://, mysql://, mssql://, or SQL Server ADO.NET)",
      });
    }

    const record = await loadProjectRecord(projectId);
    const extractRoot = await loadExtractPath(projectId).catch(() => null);
    const analysis = await aiAnalyzeDatabase(connectionString, record.overview, extractRoot);

    // Never store raw password-bearing URI in JSON — store redacted label only
    const redacted = redactConnectionString(connectionString);
    await updateProjectRecord(projectId, {
      databaseAnalysis: {
        ...analysis,
        connectionRedacted: redacted,
        analyzedAt: new Date().toISOString(),
      },
    });

    res.json({
      projectId,
      step: "database",
      analysis: {
        ...analysis,
        connectionRedacted: redacted,
      },
    });
  } catch (err) {
    console.error("[database]", err);
    res.status(500).json({ error: err.message || "Database analysis failed" });
  }
});

app.get("/api/projects/:id", async (req, res) => {
  try {
    const record = await loadProjectRecord(req.params.id);
    res.json(record);
  } catch {
    res.status(404).json({ error: "Project not found" });
  }
});

/**
 * New scan: wipe ALL extracts + saved project JSON (not only current id).
 * Going back to Modules must NOT call this — only "New scan" does.
 */
app.delete("/api/projects/:id", async (req, res) => {
  try {
    const projectId = req.params.id;
    if (!projectId || !/^[0-9a-f-]{36}$/i.test(projectId)) {
      return res.status(400).json({ error: "Invalid project id" });
    }
    await cleanupAllStoredWork();
    res.json({
      ok: true,
      projectId,
      extractRemoved: true,
      projectRemoved: true,
      clearedAll: true,
    });
  } catch (err) {
    console.error("[project cleanup]", err);
    res.status(500).json({ error: err.message || "Failed to remove project" });
  }
});

/** Explicit full cleanup (optional). */
app.post("/api/cleanup", async (_req, res) => {
  try {
    await cleanupAllStoredWork();
    res.json({ ok: true, clearedAll: true });
  } catch (err) {
    console.error("[cleanup]", err);
    res.status(500).json({ error: err.message || "Cleanup failed" });
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  if (res.headersSent) return;
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "Zip too large (max 8GB)" });
    }
    return res.status(400).json({ error: err.message });
  }
  res.status(400).json({ error: err.message || "Request failed" });
});

const server = app.listen(config.port, () => {
  console.log(`CodeAtlas AI API on http://localhost:${config.port}`);
  console.log(`AI provider: ${config.provider}`);
});
server.setTimeout(30 * 60 * 1000);
server.requestTimeout = 30 * 60 * 1000;
server.headersTimeout = 31 * 60 * 1000;
