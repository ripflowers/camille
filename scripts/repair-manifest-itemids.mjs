// Repair the learning manifest by populating each unit's `itemIds` from its
// runtime-items.json shard.
//
// Background: progress on the course/unit list pages is computed from
// `knownUnitItemIds(unit)`, which returns `unit.itemIds` when present, otherwise
// the (lazily loaded) `unit.items`. On list pages units are never loaded, and
// the importer never wrote `itemIds`, so the list fell back to an empty id set
// (course 已学 = 0) or to position-based progress (unit ~99% instead of 100%).
//
// This script backfills `itemIds` from the shards so progress is computed
// against the real, stable item id set without loading every shard up front.

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const MANIFEST_FILE = resolve("data/learning-manifest.json");

function resolveShardPath(runtimeModulePath) {
  return resolve(runtimeModulePath.replace(/^\.\.\//, ""));
}

async function main() {
  const manifest = JSON.parse(await readFile(MANIFEST_FILE, "utf8"));
  const units = manifest.units || [];
  let repaired = 0;
  let countMismatches = 0;
  const backedUp = `${MANIFEST_FILE}.bak`;

  for (const unit of units) {
    const shardPath = resolveShardPath(unit.runtimeModulePath);
    let shard;
    try {
      shard = JSON.parse(await readFile(shardPath, "utf8"));
    } catch {
      console.warn(`skip (shard missing): ${unit.packageName} / ${unit.unitTitle} -> ${shardPath}`);
      continue;
    }
    const items = Array.isArray(shard) ? shard : shard.items || [];
    const ids = items.map((item) => item.id).filter(Boolean);
    unit.itemIds = ids;
    if (typeof unit.itemCount === "number" && unit.itemCount !== ids.length) {
      countMismatches += 1;
      unit.itemCount = ids.length;
    }
    repaired += 1;
  }

  await writeFile(`${MANIFEST_FILE}.bak`, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(`repaired units: ${repaired}/${units.length}`);
  console.log(`itemCount adjusted to match shard length: ${countMismatches}`);
  console.log(`backup written to: ${backedUp}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
