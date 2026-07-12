import assert from "node:assert/strict";
import { buildLearningRuntimeItem, buildLexicon, mapWordToComponent, tokenizeEnglish } from "../src/lib/learning";
import type { RawLearningItem, SentenceAnalysisRaw } from "../src/lib/types";

const analysis: SentenceAnalysisRaw = {
  sentence_type: "there be 存在句",
  sentence_zh: "科学楼后面有一个运动场。",
  components: [
    { id: "c1", text: "There", role: "引导词/形式主语", zh: "用于引出“某处有某物”" },
    { id: "c2", text: "is", role: "谓语/存在动词", zh: "有；存在" },
    {
      id: "c3",
      text: "a sports field",
      role: "存在对象/真正主语",
      zh: "一个运动场",
      children: [
        { id: "c3_1", text: "a", role: "限定词", zh: "一个；表示泛指" },
        { id: "c3_2", text: "sports", role: "定语", zh: "运动的；体育的" },
        { id: "c3_3", text: "field", role: "中心名词", zh: "场地" },
      ],
    },
    {
      id: "c4",
      text: "behind the science building",
      role: "地点状语",
      zh: "在科学楼后面",
      children: [
        { id: "c4_1", text: "behind", role: "介词", zh: "在……后面" },
        {
          id: "c4_2",
          text: "the science building",
          role: "介词宾语",
          zh: "科学楼",
          children: [
            { id: "c4_2_1", text: "the", role: "限定词", zh: "表示特指" },
            { id: "c4_2_2", text: "science", role: "定语", zh: "科学" },
            { id: "c4_2_3", text: "building", role: "中心名词", zh: "建筑物；楼" },
          ],
        },
      ],
    },
  ],
};

const rawItems: RawLearningItem[] = [
  {
    id: "science",
    contentId: "science",
    type: "word",
    english: "science",
    chinese: "科学",
    phonetic: "/ˈsaɪəns/",
    pos: "名词",
  },
  {
    id: "behind",
    contentId: "behind",
    type: "word",
    english: "behind",
    chinese: "在……后面",
    phonetic: "/bɪˈhaɪnd/",
    pos: "介词",
  },
  {
    id: "sentence-1",
    contentId: "sentence-1",
    type: "sentence",
    english: "There is a sports field behind the science building.",
    chinese: "科学楼后面有一个运动场。",
    sentenceAnalysis: analysis,
  },
];

const tokens = tokenizeEnglish("What's 7:00, WHO?");
assert.deepEqual(
  tokens.map((token) => [token.text, token.type, token.letterCount, token.fillable]),
  [
    ["What's", "word", 5, true],
    ["7:00", "time", 0, false],
    [",", "punctuation", 0, false],
    ["WHO", "abbreviation", 3, true],
    ["?", "punctuation", 0, false],
  ],
);

const lexicon = buildLexicon(rawItems);
const runtime = buildLearningRuntimeItem(rawItems[2], lexicon);
assert.equal(runtime.spellingUnits.filter((unit) => unit.fillable).length, 9);
assert.equal(runtime.spellingUnits.at(-1)?.text, ".");
assert.equal(runtime.spellingUnits.at(-1)?.fillable, false);
assert.equal(runtime.spellingUnits[0].blank, "_____");
assert.equal(runtime.spellingUnits[7].text, "science");
assert.equal(runtime.spellingUnits[7].phonetic, "/ˈsaɪəns/");
assert.equal(runtime.spellingUnits[5].componentId, "c4_1");
assert.equal(runtime.wordHints[5].parentComponentText, "behind the science building");
assert.equal(runtime.shuffledBlocks.length, 9);

const behindMatch = mapWordToComponent("behind", analysis);
assert.equal(behindMatch.componentId, "c4_1");
assert.equal(behindMatch.parentRole, "地点状语");

const timeRuntime = buildLearningRuntimeItem(
  {
    id: "time",
    contentId: "time",
    type: "sentence",
    english: "I get up at 7:00.",
    chinese: "我七点起床。",
  },
  {},
);
assert.deepEqual(
  timeRuntime.spellingUnits.map((unit) => [unit.text, unit.fillable]),
  [
    ["I", true],
    ["get", true],
    ["up", true],
    ["at", true],
    ["7:00", false],
    [".", false],
  ],
);

const phraseRuntime = buildLearningRuntimeItem(
  {
    id: "phrase-each-other",
    contentId: "phrase-each-other",
    type: "phrase",
    english: "each other",
    chinese: "互相",
  },
  {},
);
assert.deepEqual(
  phraseRuntime.spellingUnits.map((unit) => [unit.text, unit.fillable, unit.blank]),
  [
    ["each", true, "____"],
    ["other", true, "_____"],
  ],
);

const analyzedPhraseRuntime = buildLearningRuntimeItem(
  {
    id: "phrase-at-school",
    contentId: "phrase-at-school",
    type: "phrase",
    english: "at school",
    chinese: "在学校",
    sentenceAnalysis: {
      sentence_type: "短语或标题结构",
      components: [
        {
          id: "p1",
          text: "at school",
          role: "地点状语",
          zh: "在学校",
          children: [
            { id: "p1_1", text: "at", role: "介词", zh: "在" },
            { id: "p1_2", text: "school", role: "介词宾语", zh: "学校" },
          ],
        },
      ],
    },
  },
  {},
);
assert.equal(analyzedPhraseRuntime.componentTree.length, 1);
assert.equal(analyzedPhraseRuntime.spellingUnits[0].role, "介词");
assert.equal(analyzedPhraseRuntime.wordHints[1].parentComponentRole, "地点状语");

const contractionRuntime = buildLearningRuntimeItem(
  {
    id: "contraction-im",
    contentId: "contraction-im",
    type: "sentence",
    english: "I'm ready.",
    chinese: "我准备好了。",
  },
  {},
);
assert.deepEqual(
  contractionRuntime.spellingUnits.map((unit) => [unit.text, unit.fillable, unit.letterCount, unit.blank]),
  [
    ["I'm", true, 2, "_’_"],
    ["ready", true, 5, "_____"],
    [".", false, 0, "."],
  ],
);

console.log("learning-runtime tests passed");
