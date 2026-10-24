
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const source = path.join(root, "starters");
const functionsRoot = path.join(root, ".vercel/output/functions");

if (!fs.existsSync(source) || !fs.existsSync(functionsRoot)) {
  throw new Error("Starters or Vercel output directory is missing.");
}

const apiFunction = path.join(functionsRoot, "api/chat.func");

if (!fs.existsSync(apiFunction)) {
  throw new Error(`API function bundle not found: ${apiFunction}`);
}

fs.cpSync(source, path.join(apiFunction, "starters"), {
  recursive: true,
  force: true,
});

const expectedFile = path.join(
  apiFunction,
  "starters/nextjs-shadcn/app/page.tsx"
);

if (!fs.existsSync(expectedFile)) {
  throw new Error(`Starter packaging verification failed: ${expectedFile}`);
}

console.log("Verified starter files in the API function bundle.");
