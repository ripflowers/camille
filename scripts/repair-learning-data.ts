import { readFile, writeFile } from "node:fs/promises";
import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { buildSpellingBlank, tokenizeEnglish } from "../src/lib/learning";
import type { LearningType, RuntimeLearningItem, SentenceComponent, SpellingUnit } from "../src/lib/types";

interface LearningManifestUnit {
  key: string;
  packageName: string;
  unitId: string;
  unitTitle: string;
  itemCount: number;
  typeCounts?: Record<string, number>;
  itemIds?: string[];
  previewChinese?: string;
  runtimeModulePath?: string;
}

interface LearningManifest {
  version: number;
  generatedAt: string;
  source: string;
  coursePacks: Array<Record<string, unknown>>;
  units: LearningManifestUnit[];
}

interface RepairTarget {
  file: string;
  unit?: LearningManifestUnit;
}

const MANIFEST_FILE = resolve("data/learning-manifest.json");

async function main() {
  const manifest = await readJson<LearningManifest>(MANIFEST_FILE);
  const summaries: Array<Record<string, unknown>> = [];
  let changedFiles = 0;
  let fixedOneWordSentences = 0;
  let fixedSpacedAtomicItems = 0;
  let fixedUnknownItems = 0;
  let promotedPhraseSentences = 0;
  let renamedSeventhGradeUnits = 0;
  let generatedSentenceComponents = 0;
  let completedIncompleteItems = 0;
  let normalizedIncompleteItems = 0;
  let removedIncompleteItems = 0;
  let removedInvalidEnglishItems = 0;

  const targets: RepairTarget[] = process.argv.includes("--all")
    ? findRuntimeFiles(resolve("data")).map((file) => ({ file }))
    : manifest.units.filter((unit) => unit.runtimeModulePath).map((unit) => ({ file: resolveRuntimePath(unit.runtimeModulePath as string), unit }));

  for (const target of targets) {
    const unit = target.unit;
    const file = target.file;
    const items = await readJson<RuntimeLearningItem[]>(file);
    let changed = false;
    const unitFixes = {
      oneWordSentence: 0,
      spacedAtomic: 0,
      unknownType: 0,
      phraseSentence: 0,
      renamedUnit: 0,
      generatedComponents: 0,
      completedIncomplete: 0,
      normalizedIncomplete: 0,
      removedIncomplete: 0,
      removedInvalidEnglish: 0,
    };
    const removedIds = new Set<string>();
    const packageName = unit?.packageName || items[0]?.coursePackageName || "未命名课程";
    const unitId = unit?.unitId || items[0]?.unitId || "";
    const sourceUnitTitle = unit?.unitTitle || items[0]?.unitTitle || "未命名单元";
    const displayUnitTitle = normalizeSeventhGradeUnitTitle(packageName, unitId, sourceUnitTitle);
    if (unit && displayUnitTitle && displayUnitTitle !== unit.unitTitle) {
      unit.unitTitle = displayUnitTitle;
      unitFixes.renamedUnit = 1;
      renamedSeventhGradeUnits += 1;
      changed = true;
    }

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const english = normalizeWhitespace(item.fullEnglish || item.audioText || "");
      const fillableUnits = (item.spellingUnits || []).filter((spellingUnit) => spellingUnit.fillable);

      if (containsInvalidEnglishContent(english)) {
        removedIds.add(item.id);
        unitFixes.removedInvalidEnglish += 1;
        removedInvalidEnglishItems += 1;
        changed = true;
        continue;
      }

      if (hasIncompleteEnglishMarker(english)) {
        const resolution = resolveIncompleteEnglish(item, items, index);
        if (resolution.action === "complete" && resolution.source) {
          copyCompletionFromSource(item, resolution.source);
          unitFixes.completedIncomplete += 1;
          completedIncompleteItems += 1;
          changed = true;
        } else if (resolution.action === "normalize" && resolution.english) {
          applyEnglishReplacement(item, resolution.english);
          unitFixes.normalizedIncomplete += 1;
          normalizedIncompleteItems += 1;
          changed = true;
        } else {
          removedIds.add(item.id);
          unitFixes.removedIncomplete += 1;
          removedIncompleteItems += 1;
          changed = true;
          continue;
        }
      }

      const currentEnglish = normalizeWhitespace(item.fullEnglish || item.audioText || "");
      const currentFillableUnits = (item.spellingUnits || []).filter((spellingUnit) => spellingUnit.fillable);

      if (isDanglingIncompleteSentence(item, currentEnglish)) {
        removedIds.add(item.id);
        unitFixes.removedIncomplete += 1;
        removedIncompleteItems += 1;
        changed = true;
        continue;
      }

      if (currentEnglish && item.fullEnglish !== currentEnglish) {
        item.fullEnglish = currentEnglish;
        changed = true;
      }
      if (!item.audioText?.trim() && currentEnglish) {
        item.audioText = currentEnglish;
        changed = true;
      }

      if (item.type === "unknown" && currentEnglish) {
        item.type = inferRuntimeTypeAfterCleanup(item.type, currentEnglish);
        rebuildSpellingData(item);
        unitFixes.unknownType += 1;
        fixedUnknownItems += 1;
        changed = true;
      }

      if (isOneWordSentenceMislabel(item, currentEnglish, currentFillableUnits.length)) {
        item.type = inferAtomicType(currentEnglish);
        item.sentenceType = "";
        delete item.analysisEngine;
        rebuildSpellingData(item);
        unitFixes.oneWordSentence += 1;
        fixedOneWordSentences += 1;
        changed = true;
      }

      if ((item.type === "word" || item.type === "abbreviation") && /\s/.test(currentEnglish)) {
        item.type = "phrase";
        unitFixes.spacedAtomic += 1;
        fixedSpacedAtomicItems += 1;
        changed = true;
      }

      if (item.type === "phrase" && shouldPromotePhraseToSentence(currentEnglish)) {
        item.type = "sentence";
        item.sentenceType ||= "句子";
        unitFixes.phraseSentence += 1;
        promotedPhraseSentences += 1;
        changed = true;
      }

      if (item.type === "sentence" && shouldGenerateTeachingComponents(item)) {
        const components = generateTeachingComponents(item);
        if (components.length) {
          item.componentTree = components;
          applyComponentsToSpellingUnits(item, components);
          item.sentenceType ||= inferSentenceType(currentEnglish);
          unitFixes.generatedComponents += 1;
          generatedSentenceComponents += 1;
          changed = true;
        }
      }

      if (applyMeaningFallbacks(item)) changed = true;

      if (displayUnitTitle && displayUnitTitle !== item.unitTitle) {
        item.unitTitle = displayUnitTitle;
        changed = true;
      }
    }

    if (removedIds.size) {
      items.splice(0, items.length, ...items.filter((item) => !removedIds.has(item.id)));
    }

    const dedupedItems = dedupeRuntimeItems(items);
    if (dedupedItems.length !== items.length) {
      items.splice(0, items.length, ...dedupedItems);
      changed = true;
    }

    if (changed) {
      changedFiles += 1;
      if (unit) {
        unit.itemCount = items.length;
        unit.typeCounts = countTypes(items);
        unit.previewChinese = items[0]?.displayChinese || "";
      }
      await writeJson(file, items);
      summaries.push({
        packageName,
        unitTitle: displayUnitTitle || sourceUnitTitle,
        file,
        ...unitFixes,
      });
    }
  }

  for (const unit of manifest.units) {
    if (!unit.runtimeModulePath) continue;
    const activeItems = await readJson<RuntimeLearningItem[]>(resolveRuntimePath(unit.runtimeModulePath));
    unit.itemCount = activeItems.length;
    unit.typeCounts = countTypes(activeItems);
    unit.previewChinese = activeItems[0]?.displayChinese || "";
  }

  manifest.generatedAt = new Date().toISOString();
  manifest.source = mergeSourceLabel(manifest.source, "data-repaired");
  await writeJson(MANIFEST_FILE, manifest);

  console.log(
    JSON.stringify(
      {
        changedFiles,
        fixedOneWordSentences,
        fixedSpacedAtomicItems,
        fixedUnknownItems,
        promotedPhraseSentences,
        renamedSeventhGradeUnits,
        generatedSentenceComponents,
        completedIncompleteItems,
        normalizedIncompleteItems,
        removedIncompleteItems,
        removedInvalidEnglishItems,
        summaries: summaries.slice(0, 100),
      },
      null,
      2,
    ),
  );
}

function isOneWordSentenceMislabel(item: RuntimeLearningItem, english: string, fillableCount: number): boolean {
  if (item.type !== "sentence") return false;
  if (fillableCount < 1) return false;
  if (/[.!?]$/.test(english.trim())) return false;
  return !/\s/.test(english.trim());
}

function inferAtomicType(english: string): LearningType {
  if (/^[A-Z]{2,}$/.test(english.trim())) return "abbreviation";
  return english.trim().includes(" ") ? "phrase" : "word";
}

interface IncompleteResolution {
  action: "complete" | "normalize" | "remove";
  source?: RuntimeLearningItem;
  english?: string;
}

function hasIncompleteEnglishMarker(english: string): boolean {
  return /(?:\.{3,}|…|__+)/.test(english);
}

function containsInvalidEnglishContent(english: string): boolean {
  return /[\u4e00-\u9fff]/.test(english);
}

function isDanglingIncompleteSentence(item: RuntimeLearningItem, english: string): boolean {
  if (item.type !== "sentence") return false;
  return /(?:^|[.!?]\s+)(?:i['’]m|you['’]re|he['’]s|she['’]s|it['’]s|we['’]re|they['’]re|that['’]s|there['’]s|let['’]s)\s*[.!?]$/i.test(english);
}

function resolveIncompleteEnglish(item: RuntimeLearningItem, items: RuntimeLearningItem[], index: number): IncompleteResolution {
  const source = findCompletionSource(item, items, index);
  if (source) return { action: "complete", source };

  const normalized = normalizeIncompleteEnglish(item.fullEnglish || item.audioText || "");
  if (normalized && !hasIncompleteEnglishMarker(normalized) && !containsInvalidEnglishContent(normalized)) {
    return { action: "normalize", english: normalized };
  }

  return { action: "remove" };
}

function findCompletionSource(item: RuntimeLearningItem, items: RuntimeLearningItem[], index: number): RuntimeLearningItem | undefined {
  const template = normalizeEllipsisMarker(item.fullEnglish || item.audioText || "");
  if (!template.includes("...")) return undefined;
  const matcher = templateToMatcher(template);
  const candidates = items
    .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
    .filter(({ candidate, candidateIndex }) => {
      if (candidateIndex === index) return false;
      const english = candidate.fullEnglish || candidate.audioText || "";
      if (!english || hasIncompleteEnglishMarker(english) || containsInvalidEnglishContent(english)) return false;
      if (!matcher.test(normalizeWhitespace(english))) return false;
      return true;
    })
    .sort((a, b) => {
      const distance = Math.abs(a.candidateIndex - index) - Math.abs(b.candidateIndex - index);
      if (distance !== 0) return distance;
      return (b.candidate.fullEnglish || "").length - (a.candidate.fullEnglish || "").length;
    });
  return candidates[0]?.candidate;
}

function templateToMatcher(template: string): RegExp {
  const escaped = escapeRegExp(normalizeWhitespace(template))
    .replace(/\\\.\\\.\\\./g, "__ELLIPSIS__")
    .replace(/\\\//g, "\\s*(?:/|or)\\s*");
  const pattern = escaped
    .replace(/\s+/g, "\\s+")
    .replace(/,\s*__ELLIPSIS__/g, "(?:,\\s*.+?)")
    .replace(/__ELLIPSIS__/g, ".+?");
  return new RegExp(`^${pattern}$`, "i");
}

function normalizeIncompleteEnglish(english: string): string {
  let value = normalizeEllipsisMarker(english);
  value = value
    .replace(/([?!])\.{3,}\s+/g, "$1 ")
    .replace(/\b(OK|Mmm|Mm|Hmm|Baa)\.{3,}\s*/gi, "$1. ")
    .replace(/^\s*\.{3,}\s*,?\s*/g, "")
    .replace(/\s*\.{3,}\s*([.!?])?\s*$/g, (_, mark: string) => mark || ".");

  if (value.includes("...")) return "";
  value = cleanupEnglishPunctuation(value);
  if (!value || hasBadTerminalFragment(value)) return "";
  return value;
}

function normalizeEllipsisMarker(value: string): string {
  return normalizeWhitespace(value)
    .replace(/…+/g, "...")
    .replace(/\.{4,}/g, "...")
    .replace(/\s+\.\.\./g, "...")
    .replace(/\.\.\.\s+/g, "... ");
}

function cleanupEnglishPunctuation(value: string): string {
  return normalizeWhitespace(value)
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([.!?])\s*([.!?])+/g, "$1")
    .replace(/\s+\/\s+/g, " / ")
    .replace(/\s+'/g, "'")
    .trim();
}

function hasBadTerminalFragment(value: string): boolean {
  const words = value.match(/[A-Za-z]+(?:[’'][A-Za-z]+)?/g) || [];
  if (!words.length) return true;
  const last = normalizeForCompare(words[words.length - 1] || "");
  const badTails = new Set(["a", "an", "the", "to", "of", "for", "from", "with", "by", "at", "in", "on", "into", "through", "and", "or", "but", "is", "are", "am", "was", "were", "be", "than"]);
  if (["i'm", "you're", "he's", "she's", "it's", "we're", "they're", "that's", "there's", "let's"].includes(last)) return true;
  return badTails.has(last);
}

function copyCompletionFromSource(item: RuntimeLearningItem, source: RuntimeLearningItem) {
  const keep = {
    id: item.id,
    contentId: item.contentId,
    coursePackageId: item.coursePackageId,
    coursePackageName: item.coursePackageName,
    grade: item.grade,
    unitId: item.unitId,
    unitTitle: item.unitTitle,
    section: item.section,
    importance: item.importance,
  };
  Object.assign(item, structuredCloneRuntimeItem(source), keep);
}

function applyEnglishReplacement(item: RuntimeLearningItem, english: string) {
  const normalized = cleanupEnglishPunctuation(english);
  item.fullEnglish = normalized;
  item.audioText = normalized;
  if (item.displayChinese) item.displayChinese = item.displayChinese.replace(/(?:\.{3,}|…+)/g, "").replace(/\s+/g, " ").trim();
  item.type = inferRuntimeTypeAfterCleanup(item.type, normalized);
  rebuildSpellingData(item);
}

function inferRuntimeTypeAfterCleanup(type: LearningType, english: string): LearningType {
  if (type === "word" || type === "abbreviation") return inferAtomicType(english);
  if (looksLikeSentence(english) || /[.!?]$/.test(english.trim())) return "sentence";
  return english.trim().includes(" ") ? "phrase" : inferAtomicType(english);
}

function rebuildSpellingData(item: RuntimeLearningItem) {
  const oldHints = new Map<string, SpellingUnit>();
  for (const unit of item.spellingUnits || []) {
    if (!unit.fillable) continue;
    oldHints.set(normalizeForCompare(unit.text), unit);
  }
  const tokens = item.type === "word" || item.type === "abbreviation"
    ? tokenizeEnglish(item.fullEnglish).filter((token) => token.fillable).slice(0, 1)
    : tokenizeEnglish(item.fullEnglish);
  item.spellingUnits = tokens.map((token) => {
    const previous = oldHints.get(normalizeForCompare(token.text));
    return {
      index: token.index,
      text: token.text,
      answer: token.text,
      blank: token.fillable ? buildSpellingBlank(token.text) : token.text,
      letterCount: token.letterCount,
      fillable: token.fillable,
      type: token.type,
      componentId: previous?.componentId,
      role: previous?.role,
      zh: previous?.zh,
      phonetic: previous?.phonetic,
      pos: previous?.pos,
      parentComponentId: previous?.parentComponentId,
      parentComponentText: previous?.parentComponentText,
      parentComponentRole: previous?.parentComponentRole,
      parentComponentZh: previous?.parentComponentZh,
    };
  });
  item.wordHints = {};
  for (const unit of item.spellingUnits) {
    if (!unit.fillable) continue;
    item.wordHints[unit.index] = {
      text: unit.text,
      phonetic: unit.phonetic,
      pos: unit.pos,
      zh: unit.zh || item.displayChinese,
      componentRole: unit.role,
      componentZh: unit.zh,
      parentComponentText: unit.parentComponentText,
      parentComponentRole: unit.parentComponentRole,
      parentComponentZh: unit.parentComponentZh,
    };
  }
  item.shuffledBlocks = item.spellingUnits.filter((unit) => unit.fillable).map((unit) => unit.answer);
  if (item.type !== "sentence") {
    item.sentenceType = "";
    item.componentTree = [];
  }
}

function structuredCloneRuntimeItem(item: RuntimeLearningItem): RuntimeLearningItem {
  return JSON.parse(JSON.stringify(item)) as RuntimeLearningItem;
}

const MEANING_FALLBACKS: Record<string, string> = {
  potala: "布达拉宫",
  lhasa: "拉萨",
  shanhai: "山海关（地名）",
  guan: "关（山海关中的地名）",
};

function applyMeaningFallbacks(item: RuntimeLearningItem): boolean {
  let changed = false;
  for (const unit of item.spellingUnits || []) {
    if (!unit.fillable) continue;
    const meaning = MEANING_FALLBACKS[normalizeForCompare(unit.text)];
    if (!meaning) continue;
    if (!unit.zh) {
      unit.zh = meaning;
      changed = true;
    }
    if (!item.wordHints[unit.index]) {
      item.wordHints[unit.index] = { text: unit.text, zh: meaning, pos: unit.pos, phonetic: unit.phonetic };
      changed = true;
    } else if (!item.wordHints[unit.index].zh) {
      item.wordHints[unit.index].zh = meaning;
      changed = true;
    }
  }
  if (!item.displayChinese) {
    const firstMeaning = item.spellingUnits.find((unit) => unit.fillable && unit.zh)?.zh;
    if (firstMeaning) {
      item.displayChinese = firstMeaning;
      changed = true;
    }
  }
  return changed;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shouldPromotePhraseToSentence(english: string): boolean {
  const value = english.trim();
  if (!value) return false;
  if (/[.!?]$/.test(value)) return true;
  return looksLikeSentence(value);
}

function looksLikeSentence(value: string): boolean {
  const commaParts = value.split(/[,，]/).map((part) => part.trim()).filter(Boolean);
  if (commaParts.length > 1 && looksLikeSentence(commaParts[commaParts.length - 1])) return true;
  const words = value.match(/[A-Za-z]+(?:[’'][A-Za-z]+)?/g) || [];
  if (words.length < 2) return false;
  const normalized = words.map((word) => normalizeForCompare(word));
  const first = normalized[0];
  if (isSubjectContraction(first)) return words.length >= 2;
  if (isImperativeVerb(first) && !["using", "reading", "writing", "speaking", "listening"].includes(first)) return true;

  const questionWords = new Set(["what", "where", "when", "who", "whose", "which", "why", "how"]);
  if (questionWords.has(first) && words.length >= 3) return true;

  const questionAuxiliaries = new Set(["am", "is", "are", "was", "were", "do", "does", "did", "can", "could", "will", "would", "shall", "should", "may", "might", "must", "have", "has", "had"]);
  if (questionAuxiliaries.has(first) && isSubjectWord(normalized[1] || "") && words.length >= 3) {
    return isFiniteVerb(normalized[2] || "") || words.length >= 4;
  }

  const verbIndex = findSubjectVerbIndex(normalized);
  if (verbIndex >= 1 && verbIndex < normalized.length - 1) return true;
  if (/^(?:yes|no|here)\b/i.test(value) && verbIndex >= 1) return true;
  return false;
}

const SUBJECT_WORDS = new Set(["i", "you", "he", "she", "it", "we", "they", "there", "this", "that", "these", "those", "someone", "somebody", "everyone", "everybody", "nobody"]);
const POSSESSIVES = new Set(["my", "your", "his", "her", "its", "our", "their"]);
const ARTICLES = new Set(["a", "an", "the"]);
const AUXILIARY_WORDS = new Set(["am", "is", "are", "was", "were", "be", "been", "being", "do", "does", "did", "can", "could", "will", "would", "shall", "should", "may", "might", "must", "have", "has", "had"]);
const COMMON_VERBS = new Set([
  "buy", "bought", "bring", "brought", "build", "built", "call", "called", "come", "came", "cut", "dance", "decide", "design", "did", "drink", "drank", "drive", "eat", "ate", "enjoy", "feel", "felt", "find", "found", "finish", "fly", "flew", "get", "got", "give", "gave", "go", "went", "grow", "grew", "happen", "happens", "have", "hear", "heard", "help", "hold", "keep", "keeps", "know", "knew", "learn", "leave", "left", "like", "likes", "live", "lives", "look", "looks", "love", "loves", "make", "makes", "meet", "met", "mean", "means", "need", "needs", "open", "opens", "paint", "pay", "play", "plays", "practice", "prepare", "put", "read", "remember", "return", "rise", "rises", "run", "say", "says", "see", "saw", "seem", "seems", "sell", "send", "show", "sing", "sit", "sleep", "smell", "sound", "sounds", "speak", "spell", "spend", "spent", "stand", "start", "starts", "stay", "stop", "study", "studies", "take", "takes", "took", "teach", "tell", "think", "throw", "try", "use", "uses", "visit", "wait", "walk", "walks", "want", "wants", "wash", "watch", "wear", "win", "work", "works", "write", "wrote"]);

function isSubjectWord(value: string): boolean {
  return SUBJECT_WORDS.has(value) || POSSESSIVES.has(value) || ARTICLES.has(value) || /^[a-z]+$/i.test(value);
}

function isFiniteVerb(value: string): boolean {
  if (!value) return false;
  if (AUXILIARY_WORDS.has(value) || COMMON_VERBS.has(value)) return true;
  if (/(?:s|es|ed)$/.test(value) && !/(?:ss|us|is)$/.test(value)) return true;
  return false;
}

function isImperativeVerb(value: string): boolean {
  return COMMON_VERBS.has(value) && !/(?:s|es)$/.test(value);
}

function findSubjectVerbIndex(words: string[]): number {
  const first = words[0] || "";
  if (SUBJECT_WORDS.has(first)) return findFiniteVerbAfter(words, 1, 12);
  if (POSSESSIVES.has(first) || ARTICLES.has(first)) return findFiniteVerbAfter(words, 2, 12);
  return findFiniteVerbAfter(words, 1, 12);
}

function findSubjectStart(words: string[], verbIndex: number): number {
  for (let index = verbIndex - 1; index >= 0; index -= 1) {
    if (SUBJECT_WORDS.has(words[index]) || POSSESSIVES.has(words[index]) || ARTICLES.has(words[index])) return index;
  }
  return 0;
}

function findFiniteVerbAfter(words: string[], start: number, end: number): number {
  for (let index = start; index < Math.min(words.length, end + 1); index += 1) {
    if (isFiniteVerb(words[index])) return index;
  }
  return -1;
}

function shouldGenerateTeachingComponents(item: RuntimeLearningItem): boolean {
  if (!looksLikeSentence(item.fullEnglish || "")) return false;
  if (!item.componentTree?.length) return true;
  const roles = flattenComponents(item.componentTree).map((component) => component.role || "").filter(Boolean);
  if (!roles.length) return true;
  return roles.every((role) => /^[A-Z_ -]{2,}$/.test(role));
}

function generateTeachingComponents(item: RuntimeLearningItem): SentenceComponent[] {
  const units = (item.spellingUnits || []).filter((unit) => unit.fillable);
  if (units.length < 2) return [];
  return generateClauseComponents(units, 1);
}

function generateClauseComponents(units: SpellingUnit[], startId: number): SentenceComponent[] {
  const first = normalizedUnitText(units[0]);
  const second = normalizedUnitText(units[1]);
  const components: SentenceComponent[] = [];
  let cursor = startId;

  if (first === "let's") {
    components.push(component(`c${cursor++}`, units.slice(0, 1), "祈使句引导", "让我们"));
    if (units.length > 1) components.push(component(`c${cursor++}`, units.slice(1), "谓语 / 动作短语", joinZh(units.slice(1)) || "动作内容"));
    return components;
  }

  const contractionIndex = units.findIndex((unit) => isSubjectContraction(normalizedUnitText(unit)));
  if (contractionIndex > 0 && contractionIndex < units.length - 1) {
    const leading = units.slice(0, contractionIndex);
    if (leading.length) components.push(component(`c${cursor++}`, leading, "语气 / 引导语", joinZh(leading) || "补充说话语气"));
    components.push(component(`c${cursor++}`, units.slice(contractionIndex, contractionIndex + 1), "主语 + 系动词", units[contractionIndex]?.zh || "主语和谓语"));
    components.push(component(`c${cursor++}`, units.slice(contractionIndex + 1), "谓语 / 补充内容", joinZh(units.slice(contractionIndex + 1)) || "说明动作或状态"));
    return components;
  }

  const responseSubjectIndex = findResponseSubjectIndex(units);
  if (responseSubjectIndex > 0) {
    const leading = units.slice(0, responseSubjectIndex);
    if (leading.length) components.push(component(`c${cursor++}`, leading, "语气 / 引导语", joinZh(leading) || "补充说话语气"));
    components.push(component(`c${cursor++}`, units.slice(responseSubjectIndex, responseSubjectIndex + 1), "主语", units[responseSubjectIndex]?.zh || "动作或状态的发出者"));
    components.push(component(`c${cursor++}`, units.slice(responseSubjectIndex + 1), "谓语 / 补充内容", joinZh(units.slice(responseSubjectIndex + 1)) || "说明动作或状态"));
    return components;
  }

  if (isImperativeVerb(first)) {
    components.push(component(`c${cursor++}`, units.slice(0, 1), "祈使句谓语", units[0]?.zh || "表达请求、命令或建议"));
    const object = units.slice(1);
    if (object.length) components.push(component(`c${cursor++}`, object, "宾语 / 补充内容", joinZh(object) || "动作涉及的对象或补充说明"));
    return components;
  }

  const questionAuxiliaries = new Set(["am", "is", "are", "was", "were", "do", "does", "did", "can", "could", "will", "would", "shall", "should", "may", "might", "must", "have", "has", "had"]);
  if (questionAuxiliaries.has(first) && units.length > 2) {
    components.push(component(`c${cursor++}`, units.slice(0, 1), "助动词 / 情态动词", units[0]?.zh || "帮助构成疑问或语气"));
    components.push(component(`c${cursor++}`, units.slice(1, 2), "主语", units[1]?.zh || "动作或状态的发出者"));
    components.push(component(`c${cursor++}`, units.slice(2), "谓语 / 动作内容", joinZh(units.slice(2)) || "说明动作或状态"));
    return components;
  }

  if (isSubjectContraction(first)) {
    components.push(component(`c${cursor++}`, units.slice(0, 1), "主语 + 系动词", units[0]?.zh || "主语和谓语"));
    const trailingAdverbStart = findTrailingAdverbStart(units, 1);
    const complement = units.slice(1, trailingAdverbStart);
    if (complement.length) components.push(component(`c${cursor++}`, complement, "表语", joinZh(complement) || "说明主语的状态或内容"));
    const adverbial = units.slice(trailingAdverbStart);
    if (adverbial.length) components.push(component(`c${cursor++}`, adverbial, "时间 / 地点状语", joinZh(adverbial) || "补充时间或地点"));
    return components;
  }

  const subjects = new Set(["i", "you", "he", "she", "it", "we", "they", "there", "this", "that", "these", "those"]);
  const beVerbs = new Set(["am", "is", "are", "was", "were", "be", "been", "being"]);
  const auxiliaries = new Set(["do", "does", "did", "can", "could", "will", "would", "shall", "should", "may", "might", "must", "have", "has", "had"]);

  if (subjects.has(first)) {
    components.push(component(`c${cursor++}`, units.slice(0, 1), "主语", units[0]?.zh || "动作或状态的发出者"));
    if (beVerbs.has(second)) {
      components.push(component(`c${cursor++}`, units.slice(1, 2), "系动词 / 谓语", units[1]?.zh || "连接主语和表语"));
      const trailingAdverbStart = findTrailingAdverbStart(units, 2);
      const complement = units.slice(2, trailingAdverbStart);
      if (complement.length) components.push(component(`c${cursor++}`, complement, "表语", joinZh(complement) || "说明主语的状态或内容"));
      const adverbial = units.slice(trailingAdverbStart);
      if (adverbial.length) components.push(component(`c${cursor++}`, adverbial, "状语", joinZh(adverbial) || "补充时间、地点或方式"));
      return components;
    }
    if (auxiliaries.has(second) && units.length > 2) {
      components.push(component(`c${cursor++}`, units.slice(1, 2), "助动词 / 谓语标记", units[1]?.zh || "帮助构成时态、语气或疑问"));
      components.push(component(`c${cursor++}`, units.slice(2), "谓语 / 动作内容", joinZh(units.slice(2)) || "说明动作或状态"));
      return components;
    }
    components.push(component(`c${cursor++}`, units.slice(1, 2), "谓语", units[1]?.zh || "说明动作或状态"));
    const trailingAdverbStart = findTrailingAdverbStart(units, 2);
    const object = units.slice(2, trailingAdverbStart);
    if (object.length) components.push(component(`c${cursor++}`, object, "宾语 / 补足语", joinZh(object) || "动作涉及的对象或补充说明"));
    const adverbial = units.slice(trailingAdverbStart);
    if (adverbial.length) components.push(component(`c${cursor++}`, adverbial, "状语", joinZh(adverbial) || "补充时间、地点或方式"));
    return components;
  }

  if (/^(what|where|when|who|whose|which|why|how)$/.test(first)) {
    components.push(component(`c${cursor++}`, units.slice(0, 1), "疑问词", units[0]?.zh || "引出问题"));
    if (units.length > 1) components.push(component(`c${cursor++}`, units.slice(1), "句子主体", joinZh(units.slice(1)) || "问题的主体内容"));
    return components;
  }

  const normalizedWords = units.map((unit) => normalizedUnitText(unit));
  const verbIndex = findSubjectVerbIndex(normalizedWords);
  if (verbIndex >= 1 && verbIndex < units.length - 1) {
    const subjectStart = findSubjectStart(normalizedWords, verbIndex);
    const leadingAdverbial = units.slice(0, subjectStart);
    const subject = units.slice(subjectStart, verbIndex);
    const predicate = units.slice(verbIndex, verbIndex + 1);
    const trailingAdverbStart = findTrailingAdverbStart(units, verbIndex + 1);
    const object = units.slice(verbIndex + 1, trailingAdverbStart);
    const adverbial = units.slice(trailingAdverbStart);
    if (leadingAdverbial.length) components.push(component(`c${cursor++}`, leadingAdverbial, "时间 / 地点状语", joinZh(leadingAdverbial) || "补充时间、地点或背景"));
    components.push(component(`c${cursor++}`, subject, "主语", joinZh(subject) || "动作或状态的发出者"));
    components.push(component(`c${cursor++}`, predicate, "谓语", joinZh(predicate) || "说明动作或状态"));
    if (object.length) components.push(component(`c${cursor++}`, object, "宾语 / 表语", joinZh(object) || "动作涉及的对象或补充说明"));
    if (adverbial.length) components.push(component(`c${cursor++}`, adverbial, "状语", joinZh(adverbial) || "补充时间、地点或方式"));
    return components;
  }

  return [];
}

function component(id: string, units: SpellingUnit[], role: string, zh: string): SentenceComponent {
  return {
    id,
    text: units.map((unit) => unit.text).join(" "),
    role,
    zh,
  };
}

function applyComponentsToSpellingUnits(item: RuntimeLearningItem, components: SentenceComponent[]) {
  const fillable = item.spellingUnits.filter((unit) => unit.fillable);
  let cursor = 0;
  for (const componentItem of components) {
    const count = componentItem.text.split(/\s+/).filter(Boolean).length;
    for (const unit of fillable.slice(cursor, cursor + count)) {
      unit.componentId = componentItem.id;
      unit.role = componentItem.role;
      unit.zh = unit.zh || componentItem.zh;
      item.wordHints[unit.index] ||= { text: unit.text };
      item.wordHints[unit.index].componentRole = componentItem.role;
      item.wordHints[unit.index].componentZh = componentItem.zh;
      item.wordHints[unit.index].zh ||= unit.zh || componentItem.zh;
    }
    cursor += count;
  }
}

function inferSentenceType(english: string): string {
  const normalized = normalizeForCompare((english.match(/[A-Za-z]+(?:[’'][A-Za-z]+)?/) || [""])[0] || "");
  if (normalized === "let's") return "祈使句";
  if (isSubjectContraction(normalized)) return "主系表结构";
  if (/^(what|where|when|who|whose|which|why|how)$/.test(normalized)) return "特殊疑问句";
  return "主谓结构";
}

function isSubjectContraction(value: string): boolean {
  return ["i'm", "you're", "he's", "she's", "it's", "we're", "they're", "that's", "there's", "i've", "you've", "we've", "they've", "i'd", "you'd", "he'd", "she'd", "we'd", "they'd", "i'll", "you'll", "he'll", "she'll", "we'll", "they'll"].includes(value);
}

function findResponseSubjectIndex(units: SpellingUnit[]): number {
  const subjectWords = new Set(["i", "you", "he", "she", "it", "we", "they", "there", "this", "that", "these", "those"]);
  for (let index = 1; index < units.length - 1; index += 1) {
    const current = normalizedUnitText(units[index]);
    const next = normalizedUnitText(units[index + 1]);
    if (subjectWords.has(current) && isFiniteVerb(next)) return index;
  }
  return -1;
}

function findTrailingAdverbStart(units: SpellingUnit[], fallback: number): number {
  const adverbs = new Set(["now", "today", "tomorrow", "yesterday", "home", "here", "there", "soon", "again"]);
  for (let index = units.length - 1; index >= fallback; index -= 1) {
    if (!adverbs.has(normalizedUnitText(units[index]))) return index + 1;
  }
  return fallback;
}

function normalizedUnitText(unit?: SpellingUnit): string {
  return normalizeForCompare(unit?.text || "");
}

function joinZh(units: SpellingUnit[]): string {
  return units.map((unit) => unit.zh).filter(Boolean).join("；");
}

function flattenComponents(components: SentenceComponent[]): SentenceComponent[] {
  return components.flatMap((componentItem) => [componentItem, ...flattenComponents(componentItem.children || [])]);
}

function normalizeSeventhGradeUnitTitle(packageName: string, unitId: string, unitTitle: string): string {
  if (packageName !== "七年级英语上") return unitTitle;
  const title = normalizeWhitespace(unitTitle || "");
  const id = normalizeWhitespace(unitId || "");
  if (!id || !title) return title;
  if (/^starter unit\b/i.test(title) || /^unit\s+\d+\b/i.test(title)) return title;
  if (/^su\d+$/i.test(id)) return `Starter Unit ${id.replace(/\D+/g, "")} ${title}`;
  if (/^starter unit\s+\d+$/i.test(id)) return `${id} ${title}`;
  if (/^unit\s+\d+$/i.test(id)) return `${id} ${title}`;
  return title;
}

function countTypes(items: RuntimeLearningItem[]): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    acc[item.type] = (acc[item.type] || 0) + 1;
    return acc;
  }, {});
}

function dedupeRuntimeItems(items: RuntimeLearningItem[]): RuntimeLearningItem[] {
  const map = new Map<string, RuntimeLearningItem>();
  for (const item of items) {
    const key = `${item.type}|${normalizeForCompare(item.fullEnglish || "")}|${normalizeForCompare(item.displayChinese || "")}`;
    const existing = map.get(key);
    if (!existing || scoreRuntimeItem(item) > scoreRuntimeItem(existing)) {
      map.set(key, item);
    }
  }
  return [...map.values()];
}

function scoreRuntimeItem(item: RuntimeLearningItem): number {
  let score = 0;
  if (!/reading\s*plus/i.test(item.section || "")) score += 10;
  if (item.displayChinese) score += 4;
  if (item.audioText) score += 2;
  score += Object.keys(item.wordHints || {}).length;
  score += (item.componentTree || []).length;
  return score;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/[\u200b-\u200f\u2060-\u206f\u034f]/g, "").replace(/\s+/g, " ").trim();
}

function normalizeForCompare(value: string): string {
  return normalizeWhitespace(value).toLowerCase().replace(/[’‘]/g, "'").replace(/[.?!。？！]+$/g, "");
}

function resolveRuntimePath(runtimeModulePath: string): string {
  return resolve(runtimeModulePath.replace(/^\.\.\/data\//, "data/"));
}

function findRuntimeFiles(root: string): string[] {
  const files: string[] = [];
  walk(root);
  return files;

  function walk(directory: string) {
    for (const name of readdirSync(directory)) {
      const file = resolve(directory, name);
      const stat = statSync(file);
      if (stat.isDirectory()) walk(file);
      else if (name === "runtime-items.json") files.push(file);
    }
  }
}

function mergeSourceLabel(current: string, label: string): string {
  const parts = new Set((current || "").split("+").filter(Boolean));
  parts.add(label);
  return [...parts].join("+");
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
