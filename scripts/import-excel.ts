import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import XLSX from "xlsx";
import { buildLearningRuntimeItem, buildLexicon, normalizeLearningType, tokenizeEnglish } from "../src/lib/learning";
import type { Lexicon, RawLearningItem, RuntimeLearningItem, SentenceAnalysisRaw, SentenceComponent } from "../src/lib/types";

const DEFAULT_INPUT_DIR = "/Users/ripflowers/Downloads/study_data";
const OUTPUT_DIR = resolve("data");
const MANIFEST_FILE = join(OUTPUT_DIR, "learning-manifest.json");
const inputDir = resolve(process.argv[2] || DEFAULT_INPUT_DIR);

interface ImportLog {
  level: "info" | "warning" | "error";
  contentId?: string;
  file?: string;
  message: string;
}

interface LearningManifestUnit {
  key: string;
  packageName: string;
  grade: string;
  unitId: string;
  unitTitle: string;
  section: string;
  itemCount: number;
  typeCounts: Record<string, number>;
  itemIds: string[];
  previewChinese: string;
  runtimeModulePath: string;
  files: {
    rawItems: string;
    runtimeItems: string;
    source: string;
  };
}

interface LearningManifest {
  version: number;
  generatedAt: string;
  source: string;
  coursePacks: Array<Record<string, unknown>>;
  units: LearningManifestUnit[];
}

interface SplitGroup {
  key: string;
  rawItems: RawLearningItem[];
  runtimeItems: RuntimeLearningItem[];
}

const logs: ImportLog[] = [];

async function main() {
  const excelFiles = await findExcelFiles(inputDir);
  if (!excelFiles.length) {
    throw new Error(`没有找到 Excel 文件: ${inputDir}`);
  }

  const rawItems: RawLearningItem[] = [];
  const seenContentIds = new Map<string, string>();

  for (const file of excelFiles) {
    rawItems.push(...readWorkbook(file, seenContentIds));
  }

  const supplementalLexicon = await loadSupplementalLexicon();
  enrichRawItems(rawItems, supplementalLexicon);
  const lexicon = mergeLexicons(supplementalLexicon, buildLexicon(rawItems));
  const runtimeItems = rawItems.map((item) => buildLearningRuntimeItem(item, lexicon));
  validateRuntimeItems(rawItems, runtimeItems);

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeJson(join(OUTPUT_DIR, "raw-items.json"), rawItems);
  await writeJson(join(OUTPUT_DIR, "lexicon.json"), lexicon);
  await writeJson(join(OUTPUT_DIR, "runtime-items.json"), runtimeItems);
  await writeSplitCourseData(rawItems, runtimeItems, lexicon);

  printSummary(rawItems, runtimeItems);
}

async function findExcelFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (/\.xlsx?$/i.test(entry.name) && !entry.name.startsWith("~$")) {
        files.push(fullPath);
      }
    }
  }
  await walk(root);
  return files.sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function readWorkbook(file: string, seenContentIds: Map<string, string>): RawLearningItem[] {
  const workbook = XLSX.readFile(file, { cellDates: false });
  const sheetName = workbook.SheetNames.find((name) => name.includes("学习内容")) || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
  const packageName = getCoursePackageName(file);
  const items: RawLearningItem[] = [];

  rows.forEach((row, rowIndex) => {
    const english = getField(row, ["英文内容", "english", "英文", "内容英文"]);
    const typeRaw = getField(row, ["类型", "type"]);
    if (!english && !typeRaw) return;

    const sourceContentId = getField(row, ["内容ID", "contentId", "id"]);
    let contentId = isValidContentId(sourceContentId) ? sourceContentId : createFallbackContentId(file, rowIndex);
    if (sourceContentId && !isValidContentId(sourceContentId)) {
      log("warning", `内容ID格式无效，已生成稳定行级ID（原ID：${sourceContentId}）`, { contentId, file });
    }
    if (seenContentIds.has(contentId)) {
      const duplicateContentId = contentId;
      contentId = createFallbackContentId(file, rowIndex);
      log("error", `内容ID 重复，已生成稳定行级ID（原ID：${duplicateContentId}；首次出现于 ${seenContentIds.get(duplicateContentId)}）`, {
        contentId,
        file,
      });
    }
    seenContentIds.set(contentId, file);

    const normalizedType = normalizeLearningType(typeRaw);
    const type = normalizedType === "unknown" ? inferImportedType(english) : normalizedType;
    if (normalizedType === "unknown") {
      log("warning", `类型为空或无法识别，已按英文内容推断为 ${type}`, { contentId, file });
    }
    const analysisText = getField(row, ["句子拆分分析JSON（原始v2）", "句子拆分分析JSON", "sentenceAnalysis", "sentence_analysis"]);
    const item: RawLearningItem = {
      id: contentId,
      coursePackageId: getField(row, ["课程包ID", "coursePackageId"]),
      coursePackageName: packageName,
      grade: getField(row, ["年级", "grade"]),
      unitId: getField(row, ["单元ID", "unitId"]),
      unitTitle: getField(row, ["单元标题", "unitTitle"]),
      section: getField(row, ["Section", "section"]),
      sourcePage: getField(row, ["来源页码", "页码", "sourcePage"]),
      sourceType: getField(row, ["来源类型", "来源", "sourceType"]),
      importance: getField(row, ["重要性等级", "importance"]),
      contentId,
      type,
      typeRaw,
      english,
      chinese: getField(row, ["中文释义", "中文释义/翻译", "中文", "释义", "chinese"]),
      audioText: getField(row, ["音频文本", "audioText"]),
      phonetic: getField(row, ["音标", "音标/读音", "phonetic"]),
      pos: getField(row, ["词性", "词性/短语类型", "pos"]),
      sentencePattern: getField(row, ["句型结构", "sentencePattern"]),
      sentenceAnalysisRawText: analysisText,
      remark: getField(row, ["备注", "remark"]),
      qualityStatus: getField(row, ["质量状态", "qualityStatus"]),
      sourceFile: relative(process.cwd(), file),
    };

    if (type === "sentence") {
      if (!analysisText) {
        log("warning", "句子类型但 JSON 为空", { contentId, file });
      } else {
        item.sentenceAnalysis = parseSentenceAnalysis(analysisText, contentId, file);
      }
    }

    if ((type === "word" || type === "abbreviation") && !item.phonetic) {
      log("warning", "单词音标缺失", { contentId, file });
    }

    items.push(item);
  });

  log("info", `读取 ${rows.length} 行，导入 ${items.length} 条`, { file });
  return items;
}

function parseSentenceAnalysis(value: string, contentId: string, file: string): SentenceAnalysisRaw | undefined {
  try {
    const cleaned = value
      .trim()
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .trim();
    return JSON.parse(cleaned) as SentenceAnalysisRaw;
  } catch (error) {
    log("error", `JSON 解析失败: ${(error as Error).message}`, { contentId, file });
    return undefined;
  }
}

async function loadSupplementalLexicon(): Promise<Lexicon> {
  const lexicon: Lexicon = {};
  const candidates = [
    resolve("simple/data/junior_words.json"),
    resolve("simple/data/primary_words.json"),
  ];

  for (const file of candidates) {
    try {
      const data = JSON.parse(await readFile(file, "utf8")) as {
        entries?: Array<{
          id?: string;
          word?: string;
          display?: string;
          pos_raw?: string;
          pos_cn?: string[];
          meanings?: string[];
        }>;
      };
      for (const entry of data.entries || []) {
        const text = String(entry.word || entry.display || "").trim();
        const key = text.toLowerCase();
        if (!key) continue;
        const meanings = normalizeStringList(entry.meanings || []);
        const pos = entry.pos_raw || normalizeStringList(entry.pos_cn || []).join("/");
        const previous = lexicon[key];
        lexicon[key] = {
          key,
          text,
          phonetic: previous?.phonetic,
          pos: pos || previous?.pos,
          meanings: meanings.length ? meanings : previous?.meanings || [],
          type: text.includes(" ") ? "phrase" : /^[A-Z]{2,}$/.test(text) ? "abbreviation" : "word",
          contentId: entry.id || previous?.contentId,
        };
      }
      log("info", `加载补充词典 ${Object.keys(lexicon).length} 条`, { file });
    } catch (error) {
      log("warning", `补充词典不可用: ${(error as Error).message}`, { file });
    }
  }

  return lexicon;
}

function enrichRawItems(items: RawLearningItem[], supplementalLexicon: Lexicon) {
  for (const item of items) {
    if (!["word", "phrase", "abbreviation"].includes(item.type)) continue;
    const entry = supplementalLexicon[item.english.toLowerCase()];
    if (!entry) continue;
    if (!item.chinese && entry.meanings.length) {
      item.chinese = entry.meanings.join("；");
      log("warning", "原始中文释义为空，已用补充词典补全", { contentId: item.contentId, file: item.sourceFile });
    }
    if (!item.pos && entry.pos) item.pos = entry.pos;
    if (!item.phonetic && entry.phonetic) item.phonetic = entry.phonetic;
  }
}

function mergeLexicons(base: Lexicon, preferred: Lexicon): Lexicon {
  const merged: Lexicon = { ...base };
  for (const [key, entry] of Object.entries(preferred)) {
    const previous = merged[key];
    merged[key] = {
      ...previous,
      ...entry,
      phonetic: entry.phonetic || previous?.phonetic,
      pos: entry.pos || previous?.pos,
      meanings: entry.meanings.length ? entry.meanings : previous?.meanings || [],
    };
  }
  return merged;
}

function normalizeStringList(values: unknown[]): string[] {
  return values.map((value) => String(value || "").trim()).filter(Boolean);
}

function validateRuntimeItems(rawItems: RawLearningItem[], runtimeItems: RuntimeLearningItem[]) {
  for (let i = 0; i < rawItems.length; i += 1) {
    const raw = rawItems[i];
    const runtime = runtimeItems[i];
    if (raw.type === "sentence") {
      for (const component of flattenComponents(raw.sentenceAnalysis?.components || [])) {
        if (component.text && !containsLoose(runtime.fullEnglish, component.text)) {
          log("warning", `component.text 在英文句子中找不到: ${component.text}`, {
            contentId: raw.contentId,
            file: raw.sourceFile,
          });
        }
      }
    }

    if (!runtime.spellingUnits.some((unit) => unit.fillable)) {
      log("warning", "spellingUnits 中没有任何可填写单词", {
        contentId: raw.contentId,
        file: raw.sourceFile,
      });
    }

    for (const unit of runtime.spellingUnits) {
      if (unit.fillable && raw.type === "sentence" && !unit.phonetic) {
        const wordOnly = /^[A-Za-z]+(?:[’'][A-Za-z]+)?$/.test(unit.text);
        if (wordOnly) {
          log("warning", `句子单词音标缺失: ${unit.text}`, {
            contentId: raw.contentId,
            file: raw.sourceFile,
          });
        }
      }
    }

    const tokenProbe = tokenizeEnglish(runtime.fullEnglish);
    const badTime = tokenProbe.find((token) => /^\d{1,2}:\d{2}$/.test(token.text) && token.fillable);
    if (badTime) {
      log("error", `时间 token 不应可填写: ${badTime.text}`, { contentId: raw.contentId, file: raw.sourceFile });
    }
  }
}

function flattenComponents(components: SentenceComponent[]): SentenceComponent[] {
  const result: SentenceComponent[] = [];
  for (const component of components) {
    result.push(component);
    result.push(...flattenComponents(component.children || []));
  }
  return result;
}

function containsLoose(sentence: string, componentText: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ").replace(/[’‘]/g, "'").trim();
  return normalize(sentence).includes(normalize(componentText));
}

function getField(row: Record<string, unknown>, candidates: string[]): string {
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(row, candidate)) return cleanCell(row[candidate]);
  }
  const normalized = new Map(Object.keys(row).map((key) => [key.replace(/\s/g, "").toLowerCase(), key]));
  for (const candidate of candidates) {
    const key = normalized.get(candidate.replace(/\s/g, "").toLowerCase());
    if (key) return cleanCell(row[key]);
  }
  return "";
}

function cleanCell(value: unknown): string {
  return String(value ?? "").trim();
}

function getCoursePackageName(file: string): string {
  const relativePath = relative(inputDir, file);
  const first = relativePath.split(/[\\/]/)[0];
  return first && first !== ".." ? first : dirname(file).split(/[\\/]/).pop() || "默认课程包";
}

async function writeSplitCourseData(rawItems: RawLearningItem[], runtimeItems: RuntimeLearningItem[], lexicon: Lexicon) {
  const groups = groupImportedItems(rawItems, runtimeItems);
  const units: LearningManifestUnit[] = [];
  const packageNames = new Set<string>();
  for (const packageName of new Set(groups.map((group) => group.runtimeItems[0]?.coursePackageName || group.rawItems[0]?.coursePackageName || "默认课程包"))) {
    await rm(join(OUTPUT_DIR, "legacy", safePathSegment(packageName), "courses"), { recursive: true, force: true });
  }

  for (const [index, group] of groups.entries()) {
    const first = group.runtimeItems[0];
    const firstRaw = group.rawItems[0];
    const packageName = first.coursePackageName || firstRaw?.coursePackageName || "默认课程包";
    packageNames.add(packageName);
    const unitTitle = normalizeImportedUnitTitle(packageName, first.unitId || "", first.unitTitle || first.unitId || `Unit ${index + 1}`);
    for (const item of group.runtimeItems) item.unitTitle = unitTitle;
    for (const item of group.rawItems) item.unitTitle = unitTitle;

    const packSlug = safePathSegment(packageName);
    const unitSlug = `${String(index + 1).padStart(2, "0")}-${safePathSegment(unitTitle)}`;
    const courseDir = join(OUTPUT_DIR, "legacy", packSlug, "courses", unitSlug);
    await mkdir(courseDir, { recursive: true });
    await writeJson(join(courseDir, "raw-items.json"), group.rawItems);
    await writeJson(join(courseDir, "runtime-items.json"), group.runtimeItems);
    await writeJson(join(courseDir, "source.json"), {
      source: "study-data-excel",
      inputDir,
      generatedAt: new Date().toISOString(),
      sourceFiles: Array.from(new Set(group.rawItems.map((item) => item.sourceFile).filter(Boolean))),
    });

    units.push({
      key: [packageName, first.grade || "", first.unitId || "", unitTitle].join("||"),
      packageName,
      grade: first.grade || "",
      unitId: first.unitId || "",
      unitTitle,
      section: first.section || "",
      itemCount: group.runtimeItems.length,
      typeCounts: countTypes(group.runtimeItems),
      itemIds: group.runtimeItems.map((item) => item.id),
      previewChinese: group.runtimeItems[0]?.displayChinese || "",
      runtimeModulePath: `../data/legacy/${packSlug}/courses/${unitSlug}/runtime-items.json`,
      files: {
        rawItems: `data/legacy/${packSlug}/courses/${unitSlug}/raw-items.json`,
        runtimeItems: `data/legacy/${packSlug}/courses/${unitSlug}/runtime-items.json`,
        source: `data/legacy/${packSlug}/courses/${unitSlug}/source.json`,
      },
    });
  }

  for (const [packageName, entries] of groupLexiconByPackage(rawItems, lexicon)) {
    const packSlug = safePathSegment(packageName);
    await mkdir(join(OUTPUT_DIR, "legacy", packSlug), { recursive: true });
    await writeJson(join(OUTPUT_DIR, "legacy", packSlug, "lexicon.json"), entries);
  }

  const existing = await readManifest();
  const importedPackNames = new Set(packageNames);
  const preservedUnits = (existing.units || []).filter((unit) => !importedPackNames.has(unit.packageName));
  const preservedPacks = (existing.coursePacks || []).filter((pack) => !importedPackNames.has(String(pack.title || "")));
  const importedPacks = Array.from(importedPackNames).sort((a, b) => a.localeCompare(b, "zh-CN")).map((packageName) => {
    const packUnits = units.filter((unit) => unit.packageName === packageName);
    const packSlug = safePathSegment(packageName);
    return {
      id: `study-data-${packSlug}`,
      title: packageName,
      courseCount: packUnits.length,
      itemCount: packUnits.reduce((sum, unit) => sum + unit.itemCount, 0),
      lexiconFile: `data/legacy/${packSlug}/lexicon.json`,
      source: "study-data-excel",
    };
  });

  await writeJson(MANIFEST_FILE, {
    ...existing,
    version: 1,
    generatedAt: new Date().toISOString(),
    source: mergeSourceLabel(existing.source, "study-data-excel"),
    coursePacks: [...importedPacks, ...preservedPacks],
    units: [...units, ...preservedUnits],
  });
}

function groupImportedItems(rawItems: RawLearningItem[], runtimeItems: RuntimeLearningItem[]): SplitGroup[] {
  const map = new Map<string, SplitGroup>();
  for (let index = 0; index < runtimeItems.length; index += 1) {
    const runtime = runtimeItems[index];
    const raw = rawItems[index];
    const key = [
      runtime.coursePackageName || raw?.coursePackageName || "默认课程包",
      runtime.grade || raw?.grade || "",
      runtime.unitId || raw?.unitId || "",
      runtime.unitTitle || raw?.unitTitle || "未分单元",
    ].join("||");
    if (!map.has(key)) map.set(key, { key, rawItems: [], runtimeItems: [] });
    map.get(key)?.rawItems.push(raw);
    map.get(key)?.runtimeItems.push(runtime);
  }
  return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key, "zh-CN", { numeric: true }));
}

function normalizeImportedUnitTitle(packageName: string, unitId: string, title: string): string {
  const cleanTitle = cleanUnitTitle(title);
  const cleanUnitId = cleanUnitTitle(unitId);
  const normalizedTitle = normalizeUnitNumberTitle(cleanTitle);
  if (!/七年级英语[上下]/.test(packageName) || !cleanUnitId) return cleanTitle || cleanUnitId || "未分单元";
  if (/^(?:starter\s+unit|unit)\s+\d+\b/i.test(cleanTitle)) return normalizedTitle;
  const lowerTitle = cleanTitle.toLowerCase();
  const lowerId = cleanUnitId.toLowerCase();
  if (lowerTitle.includes(lowerId)) return normalizedTitle;
  const starterMatch = cleanUnitId.match(/starter\s*unit\s*(\d+)/i) || cleanUnitId.match(/^su\s*(\d+)/i);
  if (starterMatch) return `Starter Unit ${Number(starterMatch[1])} ${cleanTitle}`.trim();
  const unitMatch = cleanUnitId.match(/unit\s*(\d+)/i) || cleanUnitId.match(/^u\s*(\d+)/i);
  if (unitMatch) return `Unit ${Number(unitMatch[1])} ${cleanTitle}`.trim();
  return `${cleanUnitId} ${cleanTitle}`.trim();
}

function cleanUnitTitle(value: string): string {
  return String(value || "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeUnitNumberTitle(value: string): string {
  return value
    .replace(/^Starter\s+Unit\s+0*(\d+)\b/i, (_match, unitNumber) => `Starter Unit ${Number(unitNumber)}`)
    .replace(/^Unit\s+0*(\d+)\b/i, (_match, unitNumber) => `Unit ${Number(unitNumber)}`);
}

function countTypes(items: RuntimeLearningItem[]): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    acc[item.type] = (acc[item.type] || 0) + 1;
    return acc;
  }, {});
}

function groupLexiconByPackage(rawItems: RawLearningItem[], lexicon: Lexicon): Map<string, Lexicon> {
  const packageWords = new Map<string, Set<string>>();
  for (const item of rawItems) {
    const packageName = item.coursePackageName || "默认课程包";
    if (!packageWords.has(packageName)) packageWords.set(packageName, new Set());
    const words = item.type === "sentence" || item.type === "phrase"
      ? tokenizeEnglish(item.english).filter((token) => token.fillable).map((token) => token.text)
      : [item.english];
    for (const word of words) packageWords.get(packageName)?.add(word.toLowerCase().replace(/[’‘]/g, "'"));
  }

  const result = new Map<string, Lexicon>();
  for (const [packageName, words] of packageWords) {
    const entries: Lexicon = {};
    for (const word of words) {
      const entry = lexicon[word];
      if (entry) entries[word] = entry;
    }
    result.set(packageName, entries);
  }
  return result;
}

async function readManifest(): Promise<LearningManifest> {
  if (!existsSync(MANIFEST_FILE)) {
    return { version: 1, generatedAt: "", source: "", coursePacks: [], units: [] };
  }
  try {
    return JSON.parse(await readFile(MANIFEST_FILE, "utf8")) as LearningManifest;
  } catch {
    return { version: 1, generatedAt: "", source: "", coursePacks: [], units: [] };
  }
}

function safePathSegment(value: string): string {
  return (value || "untitled")
    .normalize("NFKD")
    .replace(/[^\w\u4e00-\u9fa5.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "untitled";
}

function mergeSourceLabel(existing: string, label: string): string {
  const labels = new Set(String(existing || "").split("+").filter(Boolean));
  labels.add(label);
  return Array.from(labels).join("+");
}

function createFallbackContentId(file: string, rowIndex: number): string {
  const source = relative(inputDir, file)
    .replace(/\.[^.]+$/, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `AUTO-${source}-R${rowIndex + 2}`;
}

function isValidContentId(value: string): boolean {
  return /^[A-Za-z0-9\u4e00-\u9fff][A-Za-z0-9\u4e00-\u9fff._:-]*$/.test(value) && /\d/.test(value);
}

function inferImportedType(english: string): RawLearningItem["type"] {
  const value = String(english || "").trim();
  if (!value) return "unknown";
  if (/^[A-Z]{2,}$/.test(value)) return "abbreviation";
  const words = value.match(/[A-Za-z]+(?:[’'][A-Za-z]+)?/g) || [];
  if (/[.!?]$/.test(value) || /^(?:what|where|when|who|whose|which|why|how|do|does|did|is|are|am|was|were|can|could|will|would|should|shall|may|might|must|have|has|had)\b/i.test(value)) {
    return "sentence";
  }
  if (words.length >= 3 && /^(?:design|make|write|read|listen|look|talk|tell|ask|answer|choose|complete|practice|learn|use|find|draw|circle|match)\b/i.test(value)) {
    return "sentence";
  }
  return words.length > 1 ? "phrase" : "word";
}

function log(level: ImportLog["level"], message: string, context: Partial<ImportLog> = {}) {
  logs.push({ level, message, ...context });
}

async function writeJson(path: string, data: unknown) {
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function printSummary(rawItems: RawLearningItem[], runtimeItems: RuntimeLearningItem[]) {
  const warnings = logs.filter((entry) => entry.level === "warning");
  const errors = logs.filter((entry) => entry.level === "error");
  const byType = rawItems.reduce<Record<string, number>>((acc, item) => {
    acc[item.type] = (acc[item.type] || 0) + 1;
    return acc;
  }, {});

  for (const entry of logs) {
    const prefix = entry.level.toUpperCase();
    const scope = [entry.contentId, entry.file].filter(Boolean).join(" ");
    console.log(`[${prefix}]${scope ? ` ${scope}` : ""} ${entry.message}`);
  }

  console.log(
    JSON.stringify(
      {
        inputDir,
        outputDir: OUTPUT_DIR,
        rawItems: rawItems.length,
        runtimeItems: runtimeItems.length,
        byType,
        warnings: warnings.length,
        errors: errors.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
