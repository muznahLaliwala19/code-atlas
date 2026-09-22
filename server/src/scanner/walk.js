import fs from "fs/promises";
import path from "path";
import {
  IGNORE_DIRS,
  SCAN_EXTENSIONS,
  IMPORTANT_FILES,
  MAX_FILE_BYTES,
  MAX_FILES_TO_SCAN,
} from "./constants.js";

function shouldIgnoreDir(name) {
  return IGNORE_DIRS.has(name) || name.startsWith(".") && name !== ".github" && name !== ".env";
}

function isImportant(base) {
  if (IMPORTANT_FILES.has(base)) return true;
  if (base.endsWith(".csproj") || base.endsWith(".fsproj") || base.endsWith(".vbproj")) return true;
  if (base.endsWith(".sln")) return true;
  if (base === "schema.prisma") return true;
  return false;
}

function shouldReadContent(relPath, base, ext) {
  if (isImportant(base)) return true;
  if (SCAN_EXTENSIONS.has(ext)) return true;
  // env-like files without extension patterns
  if (base.startsWith(".env")) return true;
  return false;
}

/**
 * Walk project tree. Memory-safe for large repos:
 * - skips heavy dirs
 * - caps file count
 * - reads only relevant files up to MAX_FILE_BYTES
 */
export async function walkProject(rootDir) {
  const files = [];
  let scanned = 0;
  let skippedDirs = 0;
  let totalBytes = 0;

  async function walk(absDir, relDir) {
    if (scanned >= MAX_FILES_TO_SCAN) return;

    let entries;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (scanned >= MAX_FILES_TO_SCAN) break;

      const name = entry.name;
      const abs = path.join(absDir, name);
      const rel = relDir ? `${relDir}/${name}` : name;

      if (entry.isDirectory()) {
        // Special-case nested ignore names
        if (shouldIgnoreDir(name) || IGNORE_DIRS.has(rel.replace(/\\/g, "/"))) {
          skippedDirs += 1;
          continue;
        }
        await walk(abs, rel);
        continue;
      }

      if (!entry.isFile()) continue;

      scanned += 1;
      const ext = path.extname(name).toLowerCase();
      const base = name;
      let size = 0;
      try {
        const st = await fs.stat(abs);
        size = st.size;
        totalBytes += size;
      } catch {
        continue;
      }

      const record = {
        abs,
        rel: rel.replace(/\\/g, "/"),
        base,
        ext,
        size,
        content: null,
      };

      if (shouldReadContent(rel, base, ext) && size > 0 && size <= MAX_FILE_BYTES) {
        try {
          record.content = await fs.readFile(abs, "utf8");
        } catch {
          // binary / unreadable — skip content
        }
      } else if (shouldReadContent(rel, base, ext) && size > MAX_FILE_BYTES) {
        // Read only the head for huge files (APIs often near top / decorators)
        try {
          const fh = await fs.open(abs, "r");
          const buf = Buffer.alloc(Math.min(256 * 1024, size));
          await fh.read(buf, 0, buf.length, 0);
          await fh.close();
          record.content = buf.toString("utf8");
          record.truncated = true;
        } catch {
          /* ignore */
        }
      }

      files.push(record);
    }
  }

  await walk(rootDir, "");

  return {
    files,
    stats: {
      fileCount: files.length,
      skippedDirs,
      totalBytes,
      capped: scanned >= MAX_FILES_TO_SCAN,
    },
  };
}
