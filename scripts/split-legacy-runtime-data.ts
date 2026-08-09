import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { LearningType, RuntimeLearningItem } from "../src/lib/types";

interface LearningManifestUnit {
  key: string;
  packageName: string;
  grade: string;
  unitId: string;
  unitTitle: string;
  section: string;
  itemCount: number;
  typeCounts: Partial<Record<LearningType, number>>;
  itemIds?: string[];
  previewChinese: string;
  runtimeModulePath: string;
  files: {
    runtimeItems: string;
  };
}

interface LearningManifest {
  version: number;
  generatedAt: string;
  source: string;
  coursePacks: Array<Record<string, unknown>>;
  units: LearningManifestUnit[];
}

const DATA_DIR = resolve("data");
const LEGACY_RUNTIME_FILE = join(DATA_DIR, "runtime-items.json");
const MANIFEST_FILE = join(DATA_DIR, "learning-manifest.json");

async function main() {
  if (!existsSync(LEGACY_RUNTIME_FILE)) {
    throw new Error("没有找到 data/runtime-items.json，无法恢复旧课程数据。");
  }

  const items = JSON.parse(await readFile(LEGACY_RUNTIME_FILE, "utf8")) as RuntimeLearningItem[];
  const grouped = groupByUnit(items);
  const units: LearningManifestUnit[] = [];

  for (const [index, group] of grouped.entries()) {
    const first = group.items[0];
    const packageName = first.coursePackageName || first.coursePackageId || "旧版课程";
    const grade = first.grade || "";
    const unitTitle = first.unitTitle || first.unitId || `Unit ${index + 1}`;
    const unitSlug = `${String(index + 1).padStart(2, "0")}-${safePathSegment(unitTitle)}`;
    const packSlug = safePathSegment(packageName);
    const courseDir = join(DATA_DIR, "legacy", packSlug, "courses", unitSlug);
    await mkdir(courseDir, { recursive: true });
    await writeJson(join(courseDir, "runtime-items.json"), group.items);

    units.push({
      key: group.key,
      packageName,
      grade,
      unitId: first.unitId || "",
      unitTitle,
      section: first.section || "",
      itemCount: group.items.length,
      itemIds: group.items.map((item) => item.id),
      typeCounts: countTypes(group.items),
      previewChinese: group.items[0]?.displayChinese || "",
      runtimeModulePath: `../data/legacy/${packSlug}/courses/${unitSlug}/runtime-items.json`,
      files: {
        runtimeItems: `data/legacy/${packSlug}/courses/${unitSlug}/runtime-items.json`,
      },
    });
  }

  const existing = existsSync(MANIFEST_FILE)
    ? (JSON.parse(await readFile(MANIFEST_FILE, "utf8")) as LearningManifest)
    : { version: 1, generatedAt: "", source: "", coursePacks: [], units: [] };
  const nonLegacyUnits = (existing.units || []).filter((unit) => !unit.runtimeModulePath?.includes("../data/legacy/"));
  const nonLegacyPacks = (existing.coursePacks || []).filter((pack) => pack.source !== "legacy-runtime");
  const legacyPackName = units[0]?.packageName || "旧版课程";

  await writeJson(MANIFEST_FILE, {
    ...existing,
    version: 1,
    generatedAt: new Date().toISOString(),
    source: [existing.source, "legacy-runtime"].filter(Boolean).join("+"),
    coursePacks: [
      {
        id: `legacy-${safePathSegment(legacyPackName)}`,
        title: legacyPackName,
        courseCount: units.length,
        source: "legacy-runtime",
      },
      ...nonLegacyPacks,
    ],
    units: [...units, ...nonLegacyUnits],
  });

  console.log(
    JSON.stringify(
      {
        legacyItems: items.length,
        legacyUnits: units.length,
        manifestUnits: units.length + nonLegacyUnits.length,
      },
      null,
      2,
    ),
  );
}

function groupByUnit(items: RuntimeLearningItem[]) {
  const map = new Map<string, { key: string; items: RuntimeLearningItem[] }>();
  for (const item of items) {
    const key = [item.coursePackageName || "默认课程包", item.grade || "", item.unitId || "", item.unitTitle || "未分单元"].join("||");
    if (!map.has(key)) map.set(key, { key, items: [] });
    map.get(key)?.items.push(item);
  }
  return Array.from(map.values());
}

function countTypes(items: RuntimeLearningItem[]): Partial<Record<LearningType, number>> {
  return items.reduce<Partial<Record<LearningType, number>>>((acc, item) => {
    acc[item.type] = (acc[item.type] || 0) + 1;
    return acc;
  }, {});
}

async function writeJson(path: string, data: unknown) {
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function safePathSegment(value: string): string {
  return (value || "untitled")
    .normalize("NFKD")
    .replace(/[^\w\u4e00-\u9fa5.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "untitled";
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
