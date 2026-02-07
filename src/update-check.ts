import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PKG_NAME = "computer-control";
const CACHE_FILE = path.join(os.homedir(), ".browser-mcp", "update-check.json");
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

interface CacheData {
  latest: string;
  checkedAt: number;
}

function readCache(): CacheData | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function writeCache(data: CacheData): void {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data));
  } catch {}
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function checkForUpdate(currentVersion: string): void {
  const cache = readCache();

  if (cache && Date.now() - cache.checkedAt < CHECK_INTERVAL_MS) {
    if (compareVersions(cache.latest, currentVersion) > 0) {
      printNotice(currentVersion, cache.latest);
    }
    return;
  }

  fetch(`https://registry.npmjs.org/${PKG_NAME}/latest`, {
    signal: AbortSignal.timeout(3000),
  })
    .then((r) => r.json())
    .then((data: any) => {
      const latest = data.version;
      if (!latest) return;
      writeCache({ latest, checkedAt: Date.now() });
      if (compareVersions(latest, currentVersion) > 0) {
        printNotice(currentVersion, latest);
      }
    })
    .catch(() => {});
}

function printNotice(current: string, latest: string): void {
  const DIM = "\x1b[2m";
  const YELLOW = "\x1b[33m";
  const CYAN = "\x1b[36m";
  const RESET = "\x1b[0m";
  process.stderr.write(
    `${DIM}Update available: ${current} → ${YELLOW}${latest}${RESET}${DIM}  Run ${CYAN}npm i -g ${PKG_NAME}${RESET}${DIM} to update${RESET}\n`
  );
}
