import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const VENDOR_DIR = path.join(ROOT, "vendor", "vocabulary-book-by-deepseek");
const TREE_PATH = path.join(VENDOR_DIR, "tree.json");
const LOCAL_DATA = [
  path.join(ROOT, "simple", "data", "primary_words.json"),
  path.join(ROOT, "simple", "data", "junior_words.json"),
];
const DETAILS_DIR = path.join(VENDOR_DIR, "details");
const INDEX_PATH = path.join(VENDOR_DIR, "details-index.json");
const RAW_BASE = "https://raw.githubusercontent.com/vxiaozhi/vocabulary-book-by-deepseek/main/";
const CONCURRENCY = 10;

async function main() {
  const tree = JSON.parse(await fs.readFile(TREE_PATH, "utf8")).tree || [];
  const resultPaths = new Map();
  for (const item of tree) {
    if (item.type !== "blob") continue;
    if (!item.path.startsWith("result/all/") || !item.path.endsWith(".json")) continue;
    const filename = path.basename(item.path, ".json");
    resultPaths.set(filename.toLowerCase(), item.path);
  }

  const words = await readLocalWords();
  await fs.mkdir(DETAILS_DIR, { recursive: true });
  const index = {};
  const tasks = [];
  for (const word of words) {
    const key = word.toLowerCase();
    const remotePath = resultPaths.get(key);
    if (!remotePath) continue;
    const localName = `${encodeURIComponent(word)}.json`;
    const localPath = path.join(DETAILS_DIR, localName);
    index[key] = {
      word,
      remote_path: remotePath,
      local_path: path.relative(ROOT, localPath),
    };
    tasks.push({ word, remotePath, localPath });
  }

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  await runPool(tasks, CONCURRENCY, async (task) => {
    if (await exists(task.localPath)) {
      skipped += 1;
      return;
    }
    const url = `${RAW_BASE}${task.remotePath.split("/").map(encodeURIComponent).join("/")}`;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const text = await response.text();
      JSON.parse(text);
      await fs.writeFile(task.localPath, text);
      downloaded += 1;
    } catch (error) {
      failed += 1;
      console.error(`failed ${task.word}: ${error.message}`);
    }
  });

  await fs.writeFile(INDEX_PATH, JSON.stringify({
    source: "https://github.com/vxiaozhi/vocabulary-book-by-deepseek",
    license: "Apache-2.0",
    total_local_words: words.length,
    matched_detail_files: Object.keys(index).length,
    generated_at: new Date().toISOString(),
    entries: index,
  }, null, 2));

  console.log(`local=${words.length} matched=${Object.keys(index).length} downloaded=${downloaded} skipped=${skipped} failed=${failed}`);
}

async function readLocalWords() {
  const words = new Set();
  for (const file of LOCAL_DATA) {
    const json = JSON.parse(await fs.readFile(file, "utf8"));
    for (const entry of json.entries || []) words.add(entry.word);
  }
  return [...words].sort((a, b) => a.localeCompare(b));
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function runPool(items, concurrency, worker) {
  let index = 0;
  const runners = Array.from({ length: concurrency }, async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
