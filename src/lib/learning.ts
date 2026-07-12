import type {
  ComponentMatch,
  EnglishToken,
  LearningType,
  Lexicon,
  LexiconEntry,
  RawLearningItem,
  RuntimeLearningItem,
  SentenceAnalysisRaw,
  SentenceComponent,
  SpellingUnit,
  WordHint,
} from "./types";

const TYPE_MAP: Record<string, LearningType> = {
  "单词": "word",
  "词": "word",
  word: "word",
  words: "word",
  "短语": "phrase",
  phrase: "phrase",
  phrases: "phrase",
  "句子": "sentence",
  sentence: "sentence",
  sentences: "sentence",
  "缩写": "abbreviation",
  abbreviation: "abbreviation",
  abbreviations: "abbreviation",
  abbr: "abbreviation",
};

export function normalizeLearningType(value: unknown): LearningType {
  const key = String(value || "").trim().toLowerCase();
  return TYPE_MAP[key] || TYPE_MAP[String(value || "").trim()] || "unknown";
}

export function normalizeAnswer(value: string): string {
  return value.trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ");
}

export function countEnglishLetters(value: string): number {
  const matches = value.match(/[A-Za-z]/g);
  return matches ? matches.length : 0;
}

export function isSpellingCharacter(value: string): boolean {
  return /^[A-Za-z]$/.test(value) || value === "'" || value === "’" || value === "‘";
}

export function normalizeSpellingCharacter(value: string): string {
  return value === "’" || value === "‘" ? "'" : value;
}

export function getSpellingCharacters(value: string): string[] {
  return Array.from(String(value || ""))
    .filter(isSpellingCharacter)
    .map(normalizeSpellingCharacter);
}

export function buildSpellingBlank(value: string): string {
  return getSpellingCharacters(value).map((character) => (character === "'" ? "’" : "_")).join("");
}

export function tokenizeEnglish(text: string): EnglishToken[] {
  const source = String(text || "");
  const pattern =
    /(?:[$￥¥€£]\s?\d+(?:[.,]\d+)*)|(?:\b\d{1,2}:\d{2}(?:\s?[AP]M)?\b)|(?:\b\d{1,4}[/-]\d{1,2}(?:[/-]\d{1,4})?\b)|(?:\b\d+(?:st|nd|rd|th)\b)|(?:\b\d+(?:[.,]\d+)*\b)|(?:\b[A-Za-z]+(?:[’'][A-Za-z]+)?\b)|(?:[.!?,;:()[\]{}"'“”‘’])|(?:\S)/g;
  const tokens: EnglishToken[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source))) {
    const textValue = match[0];
    const type = detectTokenType(textValue);
    const letterCount = countEnglishLetters(textValue);
    tokens.push({
      index: tokens.length,
      text: textValue,
      type,
      letterCount,
      fillable: type === "word" || type === "abbreviation",
    });
  }

  return tokens;
}

function buildSingleEntryTokens(text: string): EnglishToken[] {
  const letterCount = countEnglishLetters(text);
  return [
    {
      index: 0,
      text,
      type: /^[A-Z]{2,}$/.test(text) ? "abbreviation" : "word",
      letterCount,
      fillable: letterCount > 0,
    },
  ];
}

function detectTokenType(text: string): EnglishToken["type"] {
  if (/^[$￥¥€£]\s?\d/.test(text)) return "price";
  if (/^\d{1,2}:\d{2}(?:\s?[AP]M)?$/i.test(text)) return "time";
  if (/^\d{1,4}[/-]\d{1,2}(?:[/-]\d{1,4})?$/.test(text)) return "date";
  if (/^\d+(?:st|nd|rd|th)$/i.test(text)) return "date";
  if (/^\d+(?:[.,]\d+)*$/.test(text)) return "number";
  if (/^[A-Z]{2,}$/.test(text)) return "abbreviation";
  if (/^[A-Za-z]+(?:[’'][A-Za-z]+)?$/.test(text)) return "word";
  if (/^[.!?,;:()[\]{}"'“”‘’]$/.test(text)) return "punctuation";
  return "symbol";
}

export function buildLexicon(items: RawLearningItem[]): Lexicon {
  const lexicon: Lexicon = {};
  for (const item of items) {
    if (!["word", "phrase", "abbreviation"].includes(item.type)) continue;
    const key = lexiconKey(item.english);
    if (!key) continue;
    const meanings = splitMeanings(item.chinese);
    lexicon[key] = {
      key,
      text: item.english,
      phonetic: item.phonetic || lexicon[key]?.phonetic,
      pos: item.pos || lexicon[key]?.pos,
      meanings: meanings.length ? meanings : lexicon[key]?.meanings || [],
      type: item.type,
      contentId: item.contentId,
    };
  }
  return lexicon;
}

export function buildLearningRuntimeItem(rawItem: RawLearningItem, lexicon: Lexicon = {}): RuntimeLearningItem {
  const fullEnglish = rawItem.english || rawItem.audioText || "";
  const itemLexiconEntry = lookupLexicon(fullEnglish, lexicon);
  const displayChinese = rawItem.sentenceAnalysis?.sentence_zh || rawItem.chinese || itemLexiconEntry?.meanings.join("；") || "";
  const audioText = rawItem.audioText || fullEnglish;
  const analysis = rawItem.type === "sentence" || rawItem.type === "phrase" ? rawItem.sentenceAnalysis : undefined;
  const componentTree = analysis?.components || [];
  const tokens = rawItem.type === "sentence" || rawItem.type === "phrase" ? tokenizeEnglish(fullEnglish) : buildSingleEntryTokens(fullEnglish);
  const matches = analysis ? mapWordsToComponents(tokens, analysis) : new Map<number, ComponentMatch>();

  const spellingUnits = tokens.map((token): SpellingUnit => {
    const match = matches.get(token.index);
    const lexiconEntry = token.fillable ? lookupLexicon(token.text, lexicon) : undefined;
    const zh = lexiconEntry?.meanings.join("；") || match?.zh || rawItem.chinese;
    const unit: SpellingUnit = {
      index: token.index,
      text: token.text,
      answer: token.text,
      blank: token.fillable ? buildSpellingBlank(token.text) : token.text,
      letterCount: token.letterCount,
      fillable: token.fillable,
      type: token.type,
      componentId: match?.componentId,
      role: match?.role,
      zh,
      phonetic: lexiconEntry?.phonetic || (rawItem.type === "sentence" ? undefined : rawItem.phonetic),
      pos: lexiconEntry?.pos || match?.role || (rawItem.type === "sentence" ? undefined : rawItem.pos),
      parentComponentId: match?.parentId,
      parentComponentText: match?.parentText,
      parentComponentRole: match?.parentRole,
      parentComponentZh: match?.parentZh,
    };
    return unit;
  });

  const wordHints: Record<number, WordHint> = {};
  for (const unit of spellingUnits) {
    if (!unit.fillable) continue;
    wordHints[unit.index] = {
      text: unit.text,
      phonetic: unit.phonetic,
      pos: unit.pos,
      zh: unit.zh,
      componentRole: unit.role,
      componentZh: unit.zh,
      parentComponentText: unit.parentComponentText,
      parentComponentRole: unit.parentComponentRole,
      parentComponentZh: unit.parentComponentZh,
    };
  }

  return {
    id: rawItem.id,
    contentId: rawItem.contentId,
    type: rawItem.type,
    coursePackageId: rawItem.coursePackageId,
    coursePackageName: rawItem.coursePackageName,
    grade: rawItem.grade,
    unitId: rawItem.unitId,
    unitTitle: rawItem.unitTitle,
    section: rawItem.section,
    importance: rawItem.importance,
    displayChinese,
    audioText,
    fullEnglish,
    phonetic: rawItem.phonetic || itemLexiconEntry?.phonetic,
    pos: rawItem.pos || itemLexiconEntry?.pos,
    sentenceType: analysis?.sentence_type,
    sentencePattern: rawItem.sentencePattern,
    spellingUnits,
    shuffledBlocks: deterministicShuffle(spellingUnits.filter((unit) => unit.fillable).map((unit) => unit.answer), rawItem.contentId),
    componentTree,
    wordHints,
  };
}

function deterministicShuffle(values: string[], seedText: string): string[] {
  const result = [...values];
  let seed = Array.from(seedText || "enstudy").reduce((sum, char) => sum + char.charCodeAt(0), 0) || 1;
  for (let i = result.length - 1; i > 0; i -= 1) {
    seed = (seed * 9301 + 49297) % 233280;
    const j = seed % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function mapWordToComponent(word: string, sentenceAnalysis?: SentenceAnalysisRaw): ComponentMatch {
  const token = tokenizeEnglish(word).find((item) => item.fillable);
  if (!token) return {};
  const mapped = mapWordsToComponents([token], sentenceAnalysis);
  return mapped.get(token.index) || {};
}

export function mapWordsToComponents(tokens: EnglishToken[], sentenceAnalysis?: SentenceAnalysisRaw): Map<number, ComponentMatch> {
  const result = new Map<number, ComponentMatch>();
  const wordTokens = tokens.filter((token) => token.fillable);
  const used = new Set<number>();
  const leaves = flattenComponents(sentenceAnalysis?.components || []);
  leaves.sort((a, b) => b.depth - a.depth);

  for (const leaf of leaves) {
    const componentTokens = tokenizeEnglish(leaf.component.text).filter((token) => token.fillable);
    if (!componentTokens.length) continue;
    const start = findTokenSequence(wordTokens, componentTokens, used);
    if (start < 0) continue;

    for (let offset = 0; offset < componentTokens.length; offset += 1) {
      const target = wordTokens[start + offset];
      used.add(target.index);
      result.set(target.index, {
        componentId: leaf.component.id,
        componentText: leaf.component.text,
        role: leaf.component.role,
        zh: leaf.component.zh,
        parentId: leaf.parent?.id,
        parentText: leaf.parent?.text,
        parentRole: leaf.parent?.role,
        parentZh: leaf.parent?.zh,
      });
    }
  }

  for (const token of wordTokens) {
    if (result.has(token.index)) continue;
    const parentMatch = findContainingComponent(token.text, sentenceAnalysis?.components || []);
    if (parentMatch) result.set(token.index, parentMatch);
  }

  return result;
}

function findTokenSequence(wordTokens: EnglishToken[], componentTokens: EnglishToken[], used: Set<number>): number {
  for (let i = 0; i <= wordTokens.length - componentTokens.length; i += 1) {
    let ok = true;
    for (let j = 0; j < componentTokens.length; j += 1) {
      if (used.has(wordTokens[i + j].index) || !sameToken(wordTokens[i + j].text, componentTokens[j].text)) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

function findContainingComponent(word: string, components: SentenceComponent[], parent?: SentenceComponent): ComponentMatch | undefined {
  for (const component of components) {
    const child = findContainingComponent(word, component.children || [], component);
    if (child) return child;
    const tokens = tokenizeEnglish(component.text).filter((token) => token.fillable);
    if (tokens.some((token) => sameToken(token.text, word))) {
      return {
        componentId: component.id,
        componentText: component.text,
        role: component.role,
        zh: component.zh,
        parentId: parent?.id,
        parentText: parent?.text,
        parentRole: parent?.role,
        parentZh: parent?.zh,
      };
    }
  }
  return undefined;
}

function flattenComponents(components: SentenceComponent[], parent?: SentenceComponent, depth = 0) {
  const flattened: Array<{ component: SentenceComponent; parent?: SentenceComponent; depth: number }> = [];
  for (const component of components) {
    flattened.push({ component, parent, depth });
    flattened.push(...flattenComponents(component.children || [], component, depth + 1));
  }
  return flattened;
}

function sameToken(a: string, b: string): boolean {
  return normalizeAnswer(a) === normalizeAnswer(b);
}

function lookupLexicon(text: string, lexicon: Lexicon): LexiconEntry | undefined {
  return lexicon[lexiconKey(text)];
}

function lexiconKey(value: string): string {
  return normalizeAnswer(value);
}

function splitMeanings(value: string): string[] {
  return String(value || "")
    .split(/[；;｜|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
