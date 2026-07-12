import { readFile } from "node:fs/promises";
import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { RuntimeLearningItem } from "../src/lib/types";

interface Finding {
  level: "warning" | "error";
  code: string;
  file: string;
  itemId?: string;
  message: string;
}

interface LearningManifest {
  coursePacks?: Array<Record<string, unknown>>;
  units?: Array<{
    key: string;
    packageName: string;
    unitId: string;
    unitTitle: string;
    itemCount: number;
    itemIds?: string[];
    runtimeModulePath?: string;
  }>;
}

const DATA_DIR = resolve("data");
const findings: Finding[] = [];

async function main() {
  const manifest = await readJson<LearningManifest>(resolve(DATA_DIR, "learning-manifest.json"));
  auditManifest(manifest);

  const scanAll = process.argv.includes("--all");
  const files = scanAll ? findRuntimeFiles(DATA_DIR) : getManifestRuntimeFiles(manifest);
  let runtimeFiles = 0;
  let runtimeItems = 0;
  for (const file of files) {
    runtimeFiles += 1;
    const items = await readJson<RuntimeLearningItem[]>(file);
    runtimeItems += items.length;
    auditRuntimeItems(file, items);
  }

  const errors = findings.filter((finding) => finding.level === "error");
  const warnings = findings.filter((finding) => finding.level === "warning");
  console.log(
    JSON.stringify(
      {
        coursePacks: manifest.coursePacks?.length || 0,
        manifestUnits: manifest.units?.length || 0,
        scope: scanAll ? "all-runtime-files" : "manifest-active-runtime-files",
        runtimeFiles,
        runtimeItems,
        errors: errors.length,
        warnings: warnings.length,
        topFindings: summarizeFindings(findings),
      },
      null,
      2,
    ),
  );

  if (findings.length) {
    console.log(JSON.stringify(findings.slice(0, 100), null, 2));
  }

  if (errors.length) process.exitCode = 1;
}

function auditManifest(manifest: LearningManifest) {
  const unitKeys = new Set<string>();
  const unitPaths = new Set<string>();
  for (const unit of manifest.units || []) {
    if (unitKeys.has(unit.key)) {
      findings.push({ level: "error", code: "duplicate_manifest_key", file: "data/learning-manifest.json", message: unit.key });
    }
    unitKeys.add(unit.key);

    if (!unit.runtimeModulePath) {
      findings.push({ level: "error", code: "missing_runtime_module_path", file: "data/learning-manifest.json", message: unit.key });
      continue;
    }
    if (unitPaths.has(unit.runtimeModulePath)) {
      findings.push({ level: "error", code: "duplicate_runtime_module_path", file: "data/learning-manifest.json", message: unit.runtimeModulePath });
    }
    unitPaths.add(unit.runtimeModulePath);

    const runtimePath = resolve(unit.runtimeModulePath.replace(/^\.\.\/data\//, "data/"));
    if (!existsSync(runtimePath)) {
      findings.push({ level: "error", code: "missing_runtime_file", file: "data/learning-manifest.json", message: unit.runtimeModulePath });
    }
  }
}

function auditRuntimeItems(file: string, items: RuntimeLearningItem[]) {
  const ids = new Set<string>();
  const duplicateKeys = new Set<string>();
  for (const item of items) {
    if (!item.id || ids.has(item.id)) {
      findings.push({ level: "error", code: "duplicate_or_missing_item_id", file, itemId: item.id, message: item.fullEnglish || "" });
    }
    ids.add(item.id);

    const english = item.fullEnglish || "";
    const chinese = item.displayChinese || "";
    const fillableUnits = (item.spellingUnits || []).filter((unit) => unit.fillable);

    if (!/[A-Za-z]/.test(english)) {
      findings.push({ level: "error", code: "no_english_letters", file, itemId: item.id, message: english });
    }
    if (/(?:\.{3,}|…|__+)/.test(english)) {
      findings.push({ level: "error", code: "incomplete_english_marker", file, itemId: item.id, message: english });
    }
    if (/[\u4e00-\u9fff]/.test(english)) {
      findings.push({ level: "error", code: "english_contains_chinese", file, itemId: item.id, message: english });
    }
    if (item.type === "sentence" && /(?:^|[.!?]\s+)(?:i['’]m|you['’]re|he['’]s|she['’]s|it['’]s|we['’]re|they['’]re|that['’]s|there['’]s|let['’]s)\s*[.!?]$/i.test(english)) {
      findings.push({ level: "error", code: "dangling_incomplete_sentence", file, itemId: item.id, message: english });
    }
    if (!fillableUnits.length) {
      findings.push({ level: "error", code: "no_fillable_units", file, itemId: item.id, message: english });
    }
    if (!chinese.trim() || /^[?？.\s]+$/.test(chinese)) {
      findings.push({ level: "error", code: "missing_chinese", file, itemId: item.id, message: english });
    }
    if (!item.audioText?.trim()) {
      findings.push({ level: "warning", code: "missing_audio_text", file, itemId: item.id, message: english });
    }
    if ((item.type === "word" || item.type === "abbreviation") && /\s/.test(english.trim())) {
      findings.push({ level: "warning", code: "atomic_type_contains_space", file, itemId: item.id, message: english });
    }
    if (item.type === "sentence" && fillableUnits.length === 1 && !/[.!?]$/.test(english.trim()) && !/\s/.test(english.trim())) {
      findings.push({ level: "warning", code: "one_word_sentence", file, itemId: item.id, message: english });
    }

    for (const unit of item.spellingUnits || []) {
      if (unit.fillable && unit.letterCount <= 0) {
        findings.push({ level: "error", code: "bad_letter_count", file, itemId: item.id, message: unit.text });
      }
      if (!unit.fillable && /[A-Za-z]/.test(unit.text) && !["time", "number", "date", "price"].includes(unit.type)) {
        findings.push({ level: "warning", code: "english_token_not_fillable", file, itemId: item.id, message: unit.text });
      }
    }

    const key = `${item.type}|${english.toLowerCase().trim()}|${chinese.toLowerCase().trim()}`;
    if (duplicateKeys.has(key)) {
      findings.push({ level: "warning", code: "duplicate_item_content", file, itemId: item.id, message: english });
    }
    duplicateKeys.add(key);
  }
}

function findRuntimeFiles(root: string): string[] {
  const result: string[] = [];
  walk(root);
  return result;

  function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      const path = `${dir}/${name}`;
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else if (name === "runtime-items.json") result.push(resolve(path));
    }
  }
}

function getManifestRuntimeFiles(manifest: LearningManifest): string[] {
  const files = new Set<string>();
  for (const unit of manifest.units || []) {
    if (!unit.runtimeModulePath) continue;
    files.add(resolveRuntimePath(unit.runtimeModulePath));
  }
  return [...files].sort();
}

function resolveRuntimePath(runtimeModulePath: string): string {
  return resolve(runtimeModulePath.replace(/^\.\.\/data\//, "data/"));
}

function summarizeFindings(items: Finding[]): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, finding) => {
    acc[finding.code] = (acc[finding.code] || 0) + 1;
    return acc;
  }, {});
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
