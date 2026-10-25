import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const featuresDir = join(repoRoot, "features");

function isExcluded(absolutePath) {
  const rel = relative(repoRoot, absolutePath);
  return rel === "features/rag/integration" || rel.startsWith("features/rag/integration/");
}

function collectTestFiles(dir, out) {
  if (isExcluded(dir)) return;
  for (const entry of readdirSync(dir)) {
    const absolute = join(dir, entry);
    if (isExcluded(absolute)) continue;
    const stat = statSync(absolute);
    if (stat.isDirectory()) {
      collectTestFiles(absolute, out);
      continue;
    }
    if (entry.endsWith(".test.ts")) out.push(absolute);
  }
}

const testFiles = [];
collectTestFiles(featuresDir, testFiles);
testFiles.sort();

if (testFiles.length === 0) {
  console.error("No feature unit test files found under features/.");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  cwd: repoRoot,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
