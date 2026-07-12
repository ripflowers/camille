import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DATA_FILES = [
  path.join(ROOT, "simple", "data", "primary_words.json"),
  path.join(ROOT, "simple", "data", "junior_words.json"),
];
const IMAGE_DIR = path.join(ROOT, "simple", "images", "words");
const IMAGE_INDEX_PATH = path.join(ROOT, "simple", "data", "word_images.json");
const CONCURRENCY = 3;

async function main() {
  await fs.mkdir(IMAGE_DIR, { recursive: true });
  const index = await readIndex();
  const entries = { ...(index.entries || {}) };
  const tasks = await collectRemoteImageTasks(entries);

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  await runPool(tasks, CONCURRENCY, async (task) => {
    const filename = `${safeFileName(task.word)}.jpg`;
    const localPath = path.join(IMAGE_DIR, filename);
    const relativePath = path.relative(ROOT, localPath);
    if (await exists(localPath)) {
      entries[task.key] = {
        word: task.word,
        provider: "localized-remote",
        source_url: task.url,
        local_path: relativePath,
      };
      skipped += 1;
      return;
    }
    try {
      await downloadToFile(task.url, localPath);
      entries[task.key] = {
        word: task.word,
        provider: "localized-remote",
        source_url: task.url,
        local_path: relativePath,
      };
      downloaded += 1;
    } catch (error) {
      failed += 1;
      console.error(`localize image failed ${task.word}: ${error.message}`);
    }
  });

  await fs.writeFile(IMAGE_INDEX_PATH, `${JSON.stringify({
    ...index,
    generated_at: new Date().toISOString(),
    image_count: Object.keys(entries).length,
    entries,
  }, null, 2)}\n`);

  console.log(`remote_tasks=${tasks.length} downloaded=${downloaded} skipped=${skipped} failed=${failed} images=${Object.keys(entries).length}`);
}

async function collectRemoteImageTasks(existingEntries) {
  const seen = new Set();
  const tasks = [];
  for (const file of DATA_FILES) {
    const data = JSON.parse(await fs.readFile(file, "utf8"));
    for (const entry of data.entries || []) {
      const word = entry.word;
      const key = word.toLowerCase();
      const url = entry.image?.url || "";
      if (!word || seen.has(key) || url.startsWith("./") || !/^https?:\/\//.test(url)) continue;
      const existing = existingEntries[key];
      if (existing?.local_path && await exists(path.join(ROOT, existing.local_path))) continue;
      seen.add(key);
      tasks.push({ word, key, url });
    }
  }
  return tasks.sort((a, b) => a.word.localeCompare(b.word));
}

async function readIndex() {
  try {
    return JSON.parse(await fs.readFile(IMAGE_INDEX_PATH, "utf8"));
  } catch {
    return { entries: {} };
  }
}

async function downloadToFile(url, localPath) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 EnstudyImageLocalizer/1.0",
    },
  });
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
