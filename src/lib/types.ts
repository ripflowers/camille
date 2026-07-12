export type LearningType = "word" | "phrase" | "sentence" | "abbreviation" | "unknown";

export interface PracticePolicy {
  explanation_granularity?: string;
  spelling_granularity?: string;
  show_letter_count?: boolean;
  blank_count_rule?: string;
  fillable?: string;
}

export interface SentenceComponent {
  id: string;
  text: string;
  role?: string;
  zh?: string;
  explanation?: string;
  children?: SentenceComponent[];
}

export interface SentenceAnalysisRaw {
  sentence_type?: string;
  sentence_zh?: string;
  components?: SentenceComponent[];
  practice_policy?: PracticePolicy;
}

export interface RawLearningItem {
  id: string;
  coursePackageId?: string;
  coursePackageName?: string;
  grade?: string;
  unitId?: string;
  unitTitle?: string;
  section?: string;
  sourcePage?: string;
  sourceType?: string;
  importance?: string;
  contentId: string;
  type: LearningType;
  typeRaw?: string;
  english: string;
  chinese: string;
  audioText?: string;
  phonetic?: string;
  pos?: string;
  sentencePattern?: string;
  sentenceAnalysis?: SentenceAnalysisRaw;
  sentenceAnalysisRawText?: string;
  remark?: string;
  qualityStatus?: string;
  sourceFile?: string;
}

export interface EnglishToken {
  index: number;
  text: string;
  type: "word" | "abbreviation" | "punctuation" | "time" | "number" | "price" | "date" | "symbol";
  letterCount: number;
  fillable: boolean;
}

export interface LexiconEntry {
  key: string;
  text: string;
  phonetic?: string;
  pos?: string;
  meanings: string[];
  type: LearningType;
  contentId?: string;
}

export interface ComponentMatch {
  componentId?: string;
  componentText?: string;
  role?: string;
  zh?: string;
  parentId?: string;
  parentText?: string;
  parentRole?: string;
  parentZh?: string;
}

export interface WordHint {
  text: string;
  phonetic?: string;
  pos?: string;
  zh?: string;
  componentRole?: string;
  componentZh?: string;
  parentComponentText?: string;
  parentComponentRole?: string;
  parentComponentZh?: string;
}

export interface SpellingUnit {
  index: number;
  text: string;
  answer: string;
  blank: string;
  letterCount: number;
  fillable: boolean;
  type: EnglishToken["type"];
  componentId?: string;
  role?: string;
  zh?: string;
  phonetic?: string;
  pos?: string;
  parentComponentId?: string;
  parentComponentText?: string;
  parentComponentRole?: string;
  parentComponentZh?: string;
}

export interface RuntimeLearningItem {
  id: string;
  contentId: string;
  type: LearningType;
  coursePackageId?: string;
  coursePackageName?: string;
  grade?: string;
  unitId?: string;
  unitTitle?: string;
  section?: string;
  importance?: string;
  displayChinese: string;
  audioText: string;
  fullEnglish: string;
  phonetic?: string;
  pos?: string;
  sentenceType?: string;
  sentencePattern?: string;
  analysisEngine?: string;
  spellingUnits: SpellingUnit[];
  shuffledBlocks: string[];
  componentTree: SentenceComponent[];
  wordHints: Record<number, WordHint>;
}

export type Lexicon = Record<string, LexiconEntry>;
