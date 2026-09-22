import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import yauzl from "yauzl";
import { IGNORE_DIRS } from "./scanner/constants.js";

function openZip(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zipfile) => {
      if (err) reject(err);
      else resolve(zipfile);
    });
  });
}

function shouldSkipEntry(entryName) {
  const parts = entryName.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.some((p) => IGNORE_DIRS.has(p));
}

/**
 * Stream-extract zip to destDir (GB-safe — does not load whole archive into RAM).
 */
export async function extractZip(zipPath, destDir) {
  await fsp.mkdir(destDir, { recursive: true });

  const zipfile = await openZip(zipPath);
  let extracted = 0;
  let skipped = 0;

  await new Promise((resolve, reject) => {
    zipfile.on("error", reject);
    zipfile.on("end", resolve);

    zipfile.readEntry();
    zipfile.on("entry", (entry) => {
      const raw = entry.fileName.replace(/\\/g, "/");

      if (shouldSkipEntry(raw)) {
        skipped += 1;
        zipfile.readEntry();
        return;
      }

      const normalized = path.normalize(raw).replace(/^(\.\.(\/|\\|$))+/, "");
      const parts = normalized.split(/[/\\]/).filter(Boolean);
      const target = path.join(destDir, ...parts);
      const resolved = path.resolve(target);

      if (!resolved.startsWith(path.resolve(destDir))) {
        skipped += 1;
        zipfile.readEntry();
        return;
      }

      if (/\/$/.test(raw)) {
        fsp
          .mkdir(resolved, { recursive: true })
          .then(() => zipfile.readEntry())
          .catch(reject);
        return;
      }

      fsp
        .mkdir(path.dirname(resolved), { recursive: true })
        .then(
          () =>
            new Promise((res, rej) => {
              zipfile.openReadStream(entry, (err, readStream) => {
                if (err) return rej(err);
                const writeStream = fs.createWriteStream(resolved);
                readStream.on("error", rej);
                writeStream.on("error", rej);
                writeStream.on("finish", () => {
                  extracted += 1;
                  res();
                });
                readStream.pipe(writeStream);
              });
            })
        )
        .then(() => zipfile.readEntry())
        .catch(reject);
    });
  });

  const top = await fsp.readdir(destDir, { withFileTypes: true });
  const dirs = top.filter((d) => d.isDirectory());
  const files = top.filter((d) => d.isFile());
  if (dirs.length === 1 && files.length === 0) {
    return {
      root: path.join(destDir, dirs[0].name),
      extracted,
      skipped,
    };
  }

  return { root: destDir, extracted, skipped };
}

export async function safeRm(dir) {
  try {
    await fsp.rm(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

/** Delete every entry inside a directory; keep the directory itself. */
export async function clearDirContents(dir) {
  try {
    await fsp.mkdir(dir, { recursive: true });
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    await Promise.all(
      entries.map((e) => fsp.rm(path.join(dir, e.name), { recursive: true, force: true }).catch(() => {}))
    );
  } catch {
    /* ignore */
  }
}

export function ensureDirSync(dir) {
  fs.mkdirSync(dir, { recursive: true });
}
