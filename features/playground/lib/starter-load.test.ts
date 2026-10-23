import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { scanTemplateDirectory, type TemplateFolder, type TemplateItem } from "./path-to-json.ts";

const tempRoots: string[] = [];

after(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function makeStarter(): Promise<{ root: string; starter: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "starter-load-"));
  tempRoots.push(root);
  const starter = path.join(root, "react");
  await mkdir(path.join(starter, "src"), { recursive: true });
  await mkdir(path.join(starter, "node_modules"), { recursive: true });
  await writeFile(path.join(starter, "package.json"), '{"name":"demo"}\n');
  await writeFile(path.join(starter, "src", "App.tsx"), "export const App = 1;\n");
  await writeFile(path.join(starter, ".env"), "SECRET=1\n");
  await writeFile(path.join(starter, "node_modules", "left.txt"), "do not scan\n");
  return { root, starter };
}

function fileContents(template: TemplateFolder): Map<string, string> {
  const files = new Map<string, string>();

  const visit = (item: TemplateItem, parent: string) => {
    if ("folderName" in item && "items" in item) {
      const next = parent ? `${parent}/${item.folderName}` : item.folderName;
      for (const child of item.items) {
        visit(child, next);
      }
      return;
    }

    const name = item.fileExtension
      ? `${item.filename}.${item.fileExtension}`
      : item.filename;
    files.set(parent ? `${parent}/${name}` : name, item.content);
  };

  for (const item of template.items) {
    visit(item, "");
  }

  return files;
}

describe("scanTemplateDirectory", () => {
  it("keeps starter files and folders and skips ignored paths", async () => {
    const { starter } = await makeStarter();
    const tree = await scanTemplateDirectory(starter);
    const files = fileContents(tree);

    assert.equal(tree.folderName, "react");
    assert.equal(files.get("package.json"), '{"name":"demo"}\n');
    assert.equal(files.get("src/App.tsx"), "export const App = 1;\n");
    assert.equal(files.has(".env"), false);
    assert.equal(files.has("node_modules/left.txt"), false);
    assert.equal(
      tree.items.some((item) => "folderName" in item && item.folderName === "src"),
      true,
    );
  });

  it("returns independent trees for two overlapping scans and does not touch a shared output file", async () => {
    const { root, starter } = await makeStarter();
    const sharedFile = path.join(root, "output", "REACT.json");
    await mkdir(path.dirname(sharedFile), { recursive: true });
    await writeFile(sharedFile, "original shared template\n");

    const [first, second] = await Promise.all([
      scanTemplateDirectory(starter),
      scanTemplateDirectory(starter),
    ]);

    assert.deepEqual(
      Object.fromEntries(fileContents(first)),
      Object.fromEntries(fileContents(second)),
    );
    assert.notEqual(first, second);

    const firstPackage = fileContents(first).get("package.json");
    const packageItem = first.items.find(
      (item) => "filename" in item && item.filename === "package",
    );
    assert.ok(packageItem && "content" in packageItem);
    packageItem.content = "changed by the first request\n";

    assert.equal(fileContents(second).get("package.json"), firstPackage);
    assert.equal(await readFile(sharedFile, "utf8"), "original shared template\n");
  });

  it("fails for a missing starter directory", async () => {
    const { root } = await makeStarter();
    await assert.rejects(
      () => scanTemplateDirectory(path.join(root, "missing-starter")),
      /does not exist/,
    );
  });

  it("fails when the starter path is a file", async () => {
    const { starter } = await makeStarter();
    await assert.rejects(
      () => scanTemplateDirectory(path.join(starter, "package.json")),
      /is not a directory/,
    );
  });
});

describe("starter template route", () => {
  it("does not write or delete a shared output file", async () => {
    const source = await readFile(
      path.join(process.cwd(), "app/api/template/[id]/route.ts"),
      "utf8",
    );

    assert.equal(source.includes("output/"), false);
    assert.equal(source.includes("unlink"), false);
    assert.equal(source.includes("saveTemplateStructureToJson"), false);
    assert.equal(source.includes("readTemplateStructureFromJson"), false);
    assert.equal(source.includes("scanTemplateDirectory"), true);
    assert.equal(source.includes("success:false"), true);
    assert.equal(source.includes("templateJSON"), true);
  });
});
