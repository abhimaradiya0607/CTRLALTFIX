import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, parse } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

function findPackageRoot(entry, packageName) {
  let dir = dirname(entry);
  const root = parse(dir).root;

  while (dir !== root) {
    try {
      const pkg = require(join(dir, "package.json"));
      if (pkg.name === packageName) return dir;
    } catch {
      // Continue searching parent directories.
    }
    dir = dirname(dir);
  }

  throw new Error(`Could not find package root for ${packageName}`);
}

const monacoRoot = findPackageRoot(
  require.resolve("monaco-editor"),
  "monaco-editor"
);

const modulePath = join(
  monacoRoot,
  "esm/vs/base/browser/dompurify/dompurify.js"
);

const dompurifyRoot = findPackageRoot(
  require.resolve("dompurify"),
  "dompurify"
);

const dompurifyEntry = join(dompurifyRoot, "dist/purify.es.mjs");
const { default: DOMPurify } = await import(
  pathToFileURL(dompurifyEntry).href
);

if (
  !DOMPurify.version ||
  DOMPurify.version.localeCompare("3.4.17", undefined, {
    numeric: true,
  }) < 0
) {
  throw new Error(`DOMPurify version is not patched: ${DOMPurify.version}`);
}

await writeFile(
  modulePath,
  "export { default } from 'dompurify';\n",
  "utf8"
);

console.log(`Patched Monaco ESM sanitizer to use DOMPurify ${DOMPurify.version}`);
