import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PKG_NAME = "computer-control";
const CACHE_FILE = path.join(os.homedir(), ".browser-mcp", "update-check.json");
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";

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

async function fetchLatest(): Promise<string | null> {
  try {
    const r = await fetch(`https://registry.npmjs.org/${PKG_NAME}/latest`, {
      signal: AbortSignal.timeout(3000),
    });
    const data: any = await r.json();
    const latest = data.version;
    if (latest) writeCache({ latest, checkedAt: Date.now() });
    return latest ?? null;
  } catch {
    return null;
  }
}

function hasUpdate(latest: string | null, current: string): boolean {
  return !!latest && compareVersions(latest, current) > 0;
}

function printUpdateNotice(current: string, latest: string): void {
  process.stderr.write(
    `${DIM}Update available: ${current} → ${YELLOW}${latest}${RESET}${DIM}  Run ${CYAN}npm i -g ${PKG_NAME}${RESET}${DIM} to update${RESET}\n`,
  );
}

/**
 * For `serve` commands — prints version line, fires background update check.
 */
export function checkForUpdate(currentVersion: string): void {
  const cache = readCache();
  const isFresh = cache && Date.now() - cache.checkedAt < CHECK_INTERVAL_MS;
  const cachedLatest = isFresh ? cache.latest : null;

  if (cachedLatest && hasUpdate(cachedLatest, currentVersion)) {
    process.stderr.write(`${DIM}computer-control v${currentVersion}${RESET}\n`);
    printUpdateNotice(currentVersion, cachedLatest);
  } else if (cachedLatest) {
    process.stderr.write(`${DIM}computer-control v${currentVersion} ${GREEN}✓ latest${RESET}\n`);
  } else {
    process.stderr.write(`${DIM}computer-control v${currentVersion}${RESET}\n`);
  }

  if (!isFresh) {
    fetchLatest()
      .then((latest) => {
        if (hasUpdate(latest, currentVersion)) {
          printUpdateNotice(currentVersion, latest!);
        }
      })
      .catch(() => {});
  }
}

/**
 * For `--version` — async, waits for fetch result to show latest status.
 */
export async function printVersion(currentVersion: string): Promise<void> {
  const cache = readCache();
  const isFresh = cache && Date.now() - cache.checkedAt < CHECK_INTERVAL_MS;
  const latest = isFresh ? cache!.latest : await fetchLatest();

  if (hasUpdate(latest, currentVersion)) {
    process.stdout.write(`${currentVersion}\n`);
    printUpdateNotice(currentVersion, latest!);
  } else if (latest) {
    process.stdout.write(`${currentVersion} ${GREEN}✓ latest${RESET}\n`);
  } else {
    process.stdout.write(`${currentVersion}\n`);
  }
}
