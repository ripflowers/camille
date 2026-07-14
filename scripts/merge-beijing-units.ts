import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { LearningType, RuntimeLearningItem } from "../src/lib/types";

interface LearningManifestUnit {
  key: string;
  packageName: string;
  grade: string;
  unitId: string;
  unitTitle: string;
  section?: string;
  itemCount: number;
  typeCounts?: Record<string, number>;
  itemIds?: string[];
  previewChinese?: string;
  runtimeModulePath: string;
  files?: {
    rawItems?: string;
    runtimeItems?: string;
    source?: string;
  };
}

interface LearningManifest {
  version: number;
  generatedAt: string;
  source: string;
  coursePacks: Array<Record<string, unknown>>;
  units: LearningManifestUnit[];
}

interface UnitGroup {
  unitNumber: number;
  unitTitle: string;
  sourceUnits: LearningManifestUnit[];
  runtimeItems: RuntimeLearningItem[];
  rawItems: unknown[];
  dropped: Array<{ id?: string; reason: string; english?: string; chinese?: string }>;
  fixed: Array<{ id: string; reason: string }>;
}

const DATA_DIR = resolve("data");
const MANIFEST_FILE = join(DATA_DIR, "learning-manifest.json");
const BEIJING_PACK_PATTERN = /【北京版】/;

async function main() {
  const manifest = await readJson<LearningManifest>(MANIFEST_FILE);
  const beijingPacks = manifest.coursePacks.filter((pack) => BEIJING_PACK_PATTERN.test(String(pack.title || "")) && typeof pack.id === "string");
  const mergedUnits: LearningManifestUnit[] = [];
  const summary: Array<Record<string, unknown>> = [];

  for (const pack of beijingPacks) {
    const packId = String(pack.id);
    const packageName = String(pack.title || packId);
    const existingMergedUnits = manifest.units.filter(
      (unit) => unit.packageName === packageName && unit.runtimeModulePath?.includes(`/course-packs/${packId}/courses/merged-`),
    );
    const sourceUnits = manifest.units.filter(
      (unit) =>
        unit.packageName === packageName &&
        unit.runtimeModulePath?.includes(`/course-packs/${packId}/courses/`) &&
        !unit.runtimeModulePath.includes("/courses/merged-"),
    );
    if (!sourceUnits.length) {
      mergedUnits.push(...existingMergedUnits);
      Object.assign(pack, {
        courseCount: existingMergedUnits.length,
        mergedBy: "unit",
      });
      summary.push({
        packId,
        packageName,
        originalUnits: 0,
        mergedUnits: existingMergedUnits.length,
        runtimeItems: existingMergedUnits.reduce((sum, unit) => sum + unit.itemCount, 0),
        preserved: true,
      });
      continue;
    }

    const groups = await buildMergedGroups(packId, sourceUnits);
    const packMergedUnits: LearningManifestUnit[] = [];
    for (const group of groups) {
      const unit = await writeMergedUnit(packId, packageName, group);
      packMergedUnits.push(unit);
      mergedUnits.push(unit);
    }

    Object.assign(pack, {
      courseCount: packMergedUnits.length,
      mergedBy: "unit",
      originalCourseCount: sourceUnits.length,
    });

    summary.push({
      packId,
      packageName,
      originalUnits: sourceUnits.length,
      mergedUnits: packMergedUnits.length,
      runtimeItems: packMergedUnits.reduce((sum, unit) => sum + unit.itemCount, 0),
      fixed: groups.reduce((sum, group) => sum + group.fixed.length, 0),
      dropped: groups.reduce((sum, group) => sum + group.dropped.length, 0),
    });
  }

  await archiveLooseBeijingLessonDirs(beijingPacks);

  const beijingPackNames = new Set(beijingPacks.map((pack) => String(pack.title || "")));
  manifest.units = [
    ...manifest.units.filter((unit) => !beijingPackNames.has(unit.packageName)),
    ...mergedUnits,
  ];
  manifest.generatedAt = new Date().toISOString();
  manifest.source = mergeSourceLabel(manifest.source, "beijing-unit-merged");
  await writeJson(MANIFEST_FILE, manifest);

  console.log(JSON.stringify({ mergedPacks: summary.length, summary }, null, 2));
}

async function archiveLooseBeijingLessonDirs(beijingPacks: Array<Record<string, unknown>>) {
  for (const pack of beijingPacks) {
    const packId = String(pack.id || "");
    if (!packId) continue;
    const coursesDir = join(DATA_DIR, "course-packs", packId, "courses");
    const archiveDir = join(DATA_DIR, "course-packs", packId, "source-courses");
    if (!existsSync(coursesDir)) continue;
    await mkdir(archiveDir, { recursive: true });
    for (const name of readdirSync(coursesDir)) {
      if (name.startsWith("merged-")) continue;
      const source = join(coursesDir, name);
      if (!statSync(source).isDirectory()) continue;
      const target = join(archiveDir, name);
      if (existsSync(target)) continue;
      await rename(source, target);
    }
  }
}

async function buildMergedGroups(packId: string, sourceUnits: LearningManifestUnit[]): Promise<UnitGroup[]> {
  const groups = new Map<number, UnitGroup>();
  for (const sourceUnit of sourceUnits) {
    const parsed = parseBeijingUnitTitle(sourceUnit.unitTitle);
    const group = groups.get(parsed.unitNumber) || {
      unitNumber: parsed.unitNumber,
      unitTitle: parsed.unitTitle,
      sourceUnits: [],
      runtimeItems: [],
      rawItems: [],
      dropped: [],
      fixed: [],
    };
    group.sourceUnits.push(sourceUnit);

    const runtimePath = resolveRuntimePath(sourceUnit.runtimeModulePath);
    const items = await readJson<RuntimeLearningItem[]>(runtimePath);
    for (const item of items) {
      const cleaned = cleanRuntimeItem(item, packId, parsed.unitNumber, parsed.unitTitle);
      if (cleaned.dropReason) {
        group.dropped.push({ id: item.id, reason: cleaned.dropReason, english: item.fullEnglish, chinese: item.displayChinese });
      } else {
        group.runtimeItems.push(cleaned.item);
        if (cleaned.fixedReason) group.fixed.push({ id: cleaned.item.id, reason: cleaned.fixedReason });
      }
    }

    const rawPath = sourceUnit.files?.rawItems ? resolve(sourceUnit.files.rawItems) : join(dirname(runtimePath), "raw-items.json");
    if (existsSync(rawPath)) {
      const rawItems = await readJson<unknown[]>(rawPath);
      group.rawItems.push(...rawItems);
    }

    groups.set(parsed.unitNumber, group);
  }

  return [...groups.values()]
    .sort((a, b) => a.unitNumber - b.unitNumber)
    .map((group) => ({
      ...group,
      runtimeItems: dedupeRuntimeItems(group.runtimeItems),
      rawItems: dedupeRawItems(group.rawItems),
    }));
}

function cleanRuntimeItem(item: RuntimeLearningItem, packId: string, unitNumber: number, unitTitle: string): { item: RuntimeLearningItem; fixedReason?: string; dropReason?: string } {
  const cloned: RuntimeLearningItem = JSON.parse(JSON.stringify(item));
  const english = normalizeWhitespace(cloned.fullEnglish || cloned.audioText || "");
  const chinese = normalizeWhitespace(cloned.displayChinese || inferChinese(cloned));
  const fillableUnits = (cloned.spellingUnits || []).filter((unit) => unit.fillable);

  if (!/[A-Za-z]/.test(english)) return { item: cloned, dropReason: "no_english_letters" };
  if (!fillableUnits.length) return { item: cloned, dropReason: "no_fillable_units" };
  if (!chinese || /^[?？.\s]+$/.test(chinese)) return { item: cloned, dropReason: "missing_chinese" };

  let fixedReason = "";
  cloned.fullEnglish = english;
  cloned.audioText = normalizeWhitespace(cloned.audioText || english);
  cloned.displayChinese = chinese;
  cloned.coursePackageId = packId;
  cloned.unitId = `unit-${String(unitNumber).padStart(2, "0")}`;
  cloned.unitTitle = unitTitle;
  cloned.section = "";

  if (isOneWordSentenceMislabel(cloned)) {
    cloned.type = inferAtomicType(english);
    cloned.sentenceType = "";
    fixedReason = "one_word_sentence_type_fixed";
  }

  return { item: cloned, fixedReason: fixedReason || undefined };
}

function isOneWordSentenceMislabel(item: RuntimeLearningItem): boolean {
  if (item.type !== "sentence") return false;
  const fillableUnits = item.spellingUnits.filter((unit) => unit.fillable);
  if (fillableUnits.length !== 1) return false;
  if (/[.!?]$/.test(item.fullEnglish.trim())) return false;
  return !/\s/.test(item.fullEnglish.trim());
}

function inferAtomicType(english: string): LearningType {
  if (/^[A-Z]{2,}$/.test(english.trim())) return "abbreviation";
  return english.trim().includes(" ") ? "phrase" : "word";
}

function inferChinese(item: RuntimeLearningItem): string {
  for (const hint of Object.values(item.wordHints || {})) {
    if (hint.zh && !/^[?？.\s]+$/.test(hint.zh)) return hint.zh;
    if (hint.componentZh && !/^[?？.\s]+$/.test(hint.componentZh)) return hint.componentZh;
  }
  for (const unit of item.spellingUnits || []) {
    if (unit.zh && !/^[?？.\s]+$/.test(unit.zh)) return unit.zh;
  }
  return "";
}

function dedupeRuntimeItems(items: RuntimeLearningItem[]): RuntimeLearningItem[] {
  const map = new Map<string, RuntimeLearningItem>();
  for (const item of items) {
    const key = dedupeKey(item);
    const existing = map.get(key);
    if (!existing || scoreRuntimeItem(item) > scoreRuntimeItem(existing)) {
      map.set(key, item);
    }
  }
  return [...map.values()].sort((a, b) => `${a.type}-${a.fullEnglish}`.localeCompare(`${b.type}-${b.fullEnglish}`, "zh-CN"));
}

function dedupeKey(item: RuntimeLearningItem): string {
  const english = normalizeForCompare(item.fullEnglish);
  if (item.type === "sentence") return `${item.type}|${english}|${normalizeForCompare(item.displayChinese)}`;
  return `${item.type}|${english}`;
}

function scoreRuntimeItem(item: RuntimeLearningItem): number {
  let score = 0;
  if (item.displayChinese) score += 10;
  if (item.phonetic) score += 2;
  if (item.pos) score += 2;
  score += Object.keys(item.wordHints || {}).length;
  score += (item.componentTree || []).length;
  return score;
}

function dedupeRawItems(items: unknown[]): unknown[] {
  const map = new Map<string, unknown>();
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const key = String(record.contentId || record.id || `${record.type || ""}|${record.english || ""}|${record.chinese || ""}`);
    if (!map.has(key)) map.set(key, item);
  }
  return [...map.values()];
}

async function writeMergedUnit(packId: string, packageName: string, group: UnitGroup): Promise<LearningManifestUnit> {
  const slug = `merged-${String(group.unitNumber).padStart(2, "0")}-${safePathSegment(group.unitTitle)}`;
  const courseDir = join(DATA_DIR, "course-packs", packId, "courses", slug);
  await mkdir(courseDir, { recursive: true });
  await writeJson(join(courseDir, "runtime-items.json"), group.runtimeItems);
  await writeJson(join(courseDir, "raw-items.json"), group.rawItems);
  await writeJson(join(courseDir, "source.json"), {
    mergedAt: new Date().toISOString(),
    mergedBy: "unit",
    sourceUnits: group.sourceUnits.map((unit) => ({
      unitId: unit.unitId,
      unitTitle: unit.unitTitle,
      itemCount: unit.itemCount,
      runtimeModulePath: unit.runtimeModulePath,
    })),
    dropped: group.dropped,
    fixed: group.fixed,
  });

  const runtimeModulePath = `../data/course-packs/${packId}/courses/${slug}/runtime-items.json`;
  return {
    key: [packageName, "在线课程", `unit-${String(group.unitNumber).padStart(2, "0")}`, group.unitTitle].join("||"),
    packageName,
    grade: "在线课程",
    unitId: `unit-${String(group.unitNumber).padStart(2, "0")}`,
    unitTitle: group.unitTitle,
    section: "单词、短语、句子混合练习",
    itemCount: group.runtimeItems.length,
    typeCounts: countTypes(group.runtimeItems),
    previewChinese: group.runtimeItems[0]?.displayChinese || "",
    runtimeModulePath,
    files: {
      rawItems: `data/course-packs/${packId}/courses/${slug}/raw-items.json`,
      runtimeItems: `data/course-packs/${packId}/courses/${slug}/runtime-items.json`,
      source: `data/course-packs/${packId}/courses/${slug}/source.json`,
    },
  };
}

function parseBeijingUnitTitle(title: string): { unitNumber: number; unitTitle: string } {
  const cleaned = normalizeWhitespace(title.replace(/【[^】]+】/g, ""));
  const match = cleaned.match(/\bUnit\s*(\d+)\s+(.+?)(?:-+\s*Lesson|\s+Lesson\b|$)/i);
  if (!match) {
    const fallbackNumber = Number(cleaned.match(/\d+/)?.[0] || 999);
    return { unitNumber: fallbackNumber, unitTitle: cleaned || `Unit ${fallbackNumber}` };
  }
  const unitNumber = Number(match[1]);
  const unitName = normalizeWhitespace(match[2].replace(/-+$/g, ""));
  return { unitNumber, unitTitle: `Unit ${unitNumber} ${unitName}` };
}

function countTypes(items: RuntimeLearningItem[]): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    acc[item.type] = (acc[item.type] || 0) + 1;
    return acc;
  }, {});
}

function resolveRuntimePath(runtimeModulePath: string): string {
  return resolve(runtimeModulePath.replace(/^\.\.\/data\//, "data/"));
}

function normalizeWhitespace(value: string): string {
  return value.replace(/[\u200b-\u200f\u2060-\u206f\u034f]/g, "").replace(/\s+/g, " ").trim();
}

function normalizeForCompare(value: string): string {
  return normalizeWhitespace(value).toLowerCase().replace(/[’‘]/g, "'").replace(/[.?!。？！]+$/g, "");
}

function mergeSourceLabel(current: string, label: string): string {
  const parts = new Set((current || "").split("+").filter(Boolean));
  parts.add(label);
  return [...parts].join("+");
}

function safePathSegment(value: string): string {
  return (value || "untitled")
    .normalize("NFKD")
    .replace(/[^\w\u4e00-\u9fa5.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "untitled";
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function writeJson(path: string, data: unknown) {
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
