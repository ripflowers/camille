import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const VENDOR_DIR = path.join(ROOT, "vendor", "vocabulary-book-by-deepseek");
const TREE_PATH = path.join(VENDOR_DIR, "tree.json");
const DETAILS_INDEX_PATH = path.join(VENDOR_DIR, "details-index.json");
const LOCAL_DATA = [
  path.join(ROOT, "simple", "data", "primary_words.json"),
  path.join(ROOT, "simple", "data", "junior_words.json"),
];
const IMAGE_DIR = path.join(ROOT, "simple", "images", "words");
const IMAGE_INDEX_PATH = path.join(ROOT, "simple", "data", "word_images.json");
const RAW_BASE = "https://raw.githubusercontent.com/vxiaozhi/vocabulary-book-by-deepseek/main/";
const CONCURRENCY = 8;

async function main() {
  const words = await readLocalWords();
  const details = await readDetails();
  const remoteImages = await readRemoteImageMap();
  await fs.mkdir(IMAGE_DIR, { recursive: true });

  const existingIndex = await readExistingIndex();
  const entries = { ...existingIndex.entries };
  const tasks = words.map((word) => ({
    word,
    key: word.toLowerCase(),
    detail: details.get(word.toLowerCase()),
    remotePath: remoteImages.get(word.toLowerCase()),
  }));

  let remote = 0;
  let generated = 0;
  let skipped = 0;
  let failed = 0;
  await runPool(tasks, CONCURRENCY, async (task) => {
    const current = entries[task.key];
    if (current && await exists(path.join(ROOT, current.local_path))) {
      skipped += 1;
      return;
    }

    const filename = `${safeFileName(task.word)}.jpg`;
    const localPath = path.join(IMAGE_DIR, filename);
    try {
      if (task.remotePath) {
        await downloadToFile(`${RAW_BASE}${task.remotePath.split("/").map(encodeURIComponent).join("/")}`, localPath);
        entries[task.key] = {
          word: task.word,
          provider: "vxiaozhi",
          remote_path: task.remotePath,
          local_path: path.relative(ROOT, localPath),
        };
        remote += 1;
        return;
      }

      const prompt = task.detail?.draw_prompt || buildFallbackPrompt(task.word);
      if (prompt) {
        const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=640&height=420&nologo=true&seed=${encodeURIComponent(cleanKey(task.word) || task.word)}`;
        await downloadToFile(url, localPath);
        entries[task.key] = {
          word: task.word,
          provider: task.detail?.draw_prompt ? "pollinations" : "pollinations-fallback",
          prompt,
          local_path: path.relative(ROOT, localPath),
        };
        generated += 1;
        return;
      }

      failed += 1;
    } catch (error) {
      failed += 1;
      console.error(`image failed ${task.word}: ${error.message}`);
    }
  });

  await fs.writeFile(IMAGE_INDEX_PATH, JSON.stringify({
    source: "https://github.com/vxiaozhi/vocabulary-book-by-deepseek",
    license: "Apache-2.0",
    generated_at: new Date().toISOString(),
    total_local_words: words.length,
    image_count: Object.keys(entries).length,
    entries,
  }, null, 2));

  console.log(`local=${words.length} images=${Object.keys(entries).length} remote=${remote} generated=${generated} skipped=${skipped} failed=${failed}`);
}

async function readLocalWords() {
  const words = new Set();
  for (const file of LOCAL_DATA) {
    const json = JSON.parse(await fs.readFile(file, "utf8"));
    for (const entry of json.entries || []) words.add(entry.word);
  }
  return [...words].sort((a, b) => a.localeCompare(b));
}

async function readDetails() {
  const details = new Map();
  try {
    const index = JSON.parse(await fs.readFile(DETAILS_INDEX_PATH, "utf8"));
    for (const [key, item] of Object.entries(index.entries || {})) {
      try {
        const detail = JSON.parse(await fs.readFile(path.join(ROOT, item.local_path), "utf8"));
        details.set(key, detail);
      } catch {
        // Missing detail files just mean generated fallback is unavailable.
      }
    }
  } catch {
    // Details are optional.
  }
  return details;
}

async function readRemoteImageMap() {
  const tree = JSON.parse(await fs.readFile(TREE_PATH, "utf8")).tree || [];
  const images = new Map();
  for (const item of tree) {
    if (item.type !== "blob") continue;
    if (!item.path.startsWith("result/word_imgs/") || !/\.(jpg|jpeg|png|webp)$/i.test(item.path)) continue;
    const name = path.basename(item.path).replace(/\.(jpg|jpeg|png|webp)$/i, "").toLowerCase();
    if (!images.has(name)) images.set(name, item.path);
  }
  return images;
}

async function readExistingIndex() {
  try {
    return JSON.parse(await fs.readFile(IMAGE_INDEX_PATH, "utf8"));
  } catch {
    return { entries: {} };
  }
}

async function downloadToFile(url, localPath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) throw new Error(`not image: ${contentType}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 1024) throw new Error("image too small");
  await fs.writeFile(localPath, buffer);
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

function safeFileName(word) {
  const cleaned = String(word || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return cleaned || encodeURIComponent(word);
}

function cleanKey(word) {
  return String(word || "").toLowerCase().replace(/[^a-z]/g, "");
}

function buildFallbackPrompt(word) {
  const value = String(word || "").trim();
  if (!value) return "";
  return [
    "A clear child-friendly educational image for an English vocabulary card.",
    `Concept: ${value}.`,
    "Bright clean style, simple central subject, easy for elementary and middle school students to understand.",
    "No letters, no words, no captions, no watermark.",
  ].join(" ");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
