import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SOURCE_PATH = path.join(ROOT, "data", "中小学英语词库_learning_enriched_compact_v1.json");
const OUT_DIR = path.join(ROOT, "simple", "data");
const VXIAOZHI_DIR = path.join(ROOT, "vendor", "vocabulary-book-by-deepseek");
const VXIAOZHI_GLOBAL_PATH = path.join(VXIAOZHI_DIR, "global-words.json");
const VXIAOZHI_DETAILS_INDEX_PATH = path.join(VXIAOZHI_DIR, "details-index.json");
const WORD_IMAGES_PATH = path.join(ROOT, "simple", "data", "word_images.json");

const IRREGULAR_VERBS = {
  be: ["is", "was/were", "been", "being"],
  become: ["becomes", "became", "become", "becoming"],
  begin: ["begins", "began", "begun", "beginning"],
  bring: ["brings", "brought", "brought", "bringing"],
  buy: ["buys", "bought", "bought", "buying"],
  come: ["comes", "came", "come", "coming"],
  do: ["does", "did", "done", "doing"],
  draw: ["draws", "drew", "drawn", "drawing"],
  drink: ["drinks", "drank", "drunk", "drinking"],
  drive: ["drives", "drove", "driven", "driving"],
  eat: ["eats", "ate", "eaten", "eating"],
  fall: ["falls", "fell", "fallen", "falling"],
  feel: ["feels", "felt", "felt", "feeling"],
  find: ["finds", "found", "found", "finding"],
  fly: ["flies", "flew", "flown", "flying"],
  get: ["gets", "got", "got/gotten", "getting"],
  give: ["gives", "gave", "given", "giving"],
  go: ["goes", "went", "gone", "going"],
  have: ["has", "had", "had", "having"],
  hear: ["hears", "heard", "heard", "hearing"],
  know: ["knows", "knew", "known", "knowing"],
  leave: ["leaves", "left", "left", "leaving"],
  make: ["makes", "made", "made", "making"],
  meet: ["meets", "met", "met", "meeting"],
  put: ["puts", "put", "put", "putting"],
  read: ["reads", "read", "read", "reading"],
  run: ["runs", "ran", "run", "running"],
  say: ["says", "said", "said", "saying"],
  see: ["sees", "saw", "seen", "seeing"],
  sing: ["sings", "sang", "sung", "singing"],
  sit: ["sits", "sat", "sat", "sitting"],
  speak: ["speaks", "spoke", "spoken", "speaking"],
  swim: ["swims", "swam", "swum", "swimming"],
  take: ["takes", "took", "taken", "taking"],
  teach: ["teaches", "taught", "taught", "teaching"],
  tell: ["tells", "told", "told", "telling"],
  think: ["thinks", "thought", "thought", "thinking"],
  write: ["writes", "wrote", "written", "writing"],
};

const EXTRA_MEANINGS = {
  art: ["艺术", "美术"],
  OK: ["好的", "可以", "没问题"],
  go: ["去", "走", "进行"],
  air: ["空气", "空中"],
  way: ["方式", "道路", "方向"],
  age: ["年龄", "时代"],
  bus: ["公共汽车", "公交车"],
  book: ["书", "预订"],
  can: ["能够", "可以", "罐头"],
  like: ["喜欢", "像"],
  right: ["正确的", "右边", "权利"],
  watch: ["观看", "手表"],
  orange: ["橙子", "橙色的"],
};

const UNCOUNTABLE_NOUNS = new Set([
  "advice", "air", "art", "bamboo", "beef", "blood", "bread", "business", "care", "cheese",
  "chess", "coffee", "english", "food", "fun", "grass", "health", "homework", "housework",
  "information", "juice", "knowledge", "luck", "meat", "milk", "money", "music", "news",
  "paper", "pe", "physics", "rain", "rice", "snow", "success", "tea", "tennis", "traffic",
  "water", "weather", "work",
]);

const PROPER_OR_NO_PLURAL = new Set([
  "ai", "christmas", "chinese", "english", "france", "french", "internet", "japan", "japanese",
  "mr", "mrs", "ms", "ok", "pe", "tv",
  "january", "february", "march", "april", "may", "june", "july", "august", "september",
  "october", "november", "december", "thanksgiving",
]);

const IRREGULAR_ADJECTIVES = {
  good: ["better", "best"],
  bad: ["worse", "worst"],
  far: ["farther/further", "farthest/furthest"],
  little: ["less", "least"],
  many: ["more", "most"],
  much: ["more", "most"],
};

const POS_OVERRIDES = {
  actually: ["adverb"],
  ago: ["adverb"],
  always: ["adverb"],
  careless: ["adjective"],
  enough: ["determiner"],
  last: ["adjective"],
  late: ["adjective"],
  never: ["adverb"],
  often: ["adverb"],
  nowadays: ["adverb"],
  out: ["adverb"],
  perhaps: ["adverb"],
  sometimes: ["adverb"],
};

const PLURAL_ONLY_NOUNS = new Set([
  "children", "chopsticks", "clothes", "fish", "glasses", "jeans", "pants", "people",
  "police", "scissors", "sheep", "shorts", "trousers",
]);

const COUNTABLE_OVERRIDES = new Set([
  "actress", "afternoon", "apple", "bag", "ball", "banana", "bed", "bird", "book", "boss",
  "box", "boy", "bus", "card", "chair", "class", "desk", "dog", "dress", "egg", "empress",
  "family", "friend", "game", "gas", "girl", "glass", "goddess", "hostess", "hour", "month",
  "morning", "orange", "pen", "pencil", "picture", "potato", "princess", "room", "school",
  "student", "teacher", "tomato", "tree", "week", "weekend", "year",
]);

const IRREGULAR_NOUNS = {
  child: "children",
  foot: "feet",
  man: "men",
  mouse: "mice",
  person: "people",
  tooth: "teeth",
  woman: "women",
};

const SPECIAL_EXAMPLES = {
  a: [
    ["I saw a red apple on the table.", "我看到桌子上有一个红苹果。"],
    ["She has a pencil in her hand.", "她手里有一支铅笔。"],
    ["There is a small dog under the chair.", "椅子下面有一只小狗。"],
  ],
  an: [
    ["I ate an egg for breakfast.", "我早餐吃了一个鸡蛋。"],
    ["He saw an elephant in the zoo.", "他在动物园看到了一头大象。"],
    ["She needs an umbrella on a rainy day.", "下雨天她需要一把伞。"],
  ],
  the: [
    ["Please open the door quietly.", "请轻轻打开那扇门。"],
    ["The sun is bright this morning.", "今天早上的太阳很明亮。"],
    ["I put the book on my desk.", "我把那本书放在书桌上。"],
  ],
  i: [
    ["I like reading English stories.", "我喜欢读英语故事。"],
    ["I can finish this exercise by myself.", "我能自己完成这个练习。"],
    ["I wrote the new word in my notebook.", "我把新单词写在笔记本里。"],
  ],
  you: [
    ["You can try again after listening.", "你听完后可以再试一次。"],
    ["I will help you with this word.", "我会帮你学习这个单词。"],
    ["Can you spell the word correctly?", "你能正确拼出这个单词吗？"],
  ],
  he: [
    ["He reads English every morning.", "他每天早上读英语。"],
    ["He put the card on the desk.", "他把卡片放在桌上。"],
    ["He can spell the word now.", "他现在能拼出这个单词了。"],
  ],
  she: [
    ["She listens carefully in class.", "她上课认真听讲。"],
    ["She wrote the answer on the paper.", "她把答案写在纸上。"],
    ["She can read the sentence aloud.", "她能大声读这个句子。"],
  ],
  it: [
    ["It is easy to remember with a picture.", "配合图片记忆它很容易。"],
    ["I found it in the story.", "我在故事里找到了它。"],
    ["It helps me understand the sentence.", "它帮助我理解这个句子。"],
  ],
  ok: [
    ["OK, I will try one more time.", "好的，我会再试一次。"],
    ["Is it OK to start now?", "现在开始可以吗？"],
    ["Everything is OK after practice.", "练习之后一切都没问题。"],
  ],
  tv: [
    ["We watched an English cartoon on TV.", "我们在电视上看了一部英语动画片。"],
    ["The TV is in the living room.", "电视在客厅里。"],
    ["Please turn off the TV before dinner.", "晚饭前请关掉电视。"],
  ],
  mr: [
    ["Mr. Brown is our English teacher.", "布朗先生是我们的英语老师。"],
    ["I said hello to Mr. Green.", "我向格林先生问好。"],
    ["Mr. Li wrote the word on the board.", "李先生把单词写在黑板上。"],
  ],
  ms: [
    ["Ms. Smith teaches us English.", "史密斯女士教我们英语。"],
    ["I gave the notebook to Ms. Wang.", "我把笔记本交给王女士。"],
    ["Ms. Chen read the sentence slowly.", "陈女士慢慢读了这个句子。"],
  ],
};

function normalizeWord(entry, externalSource) {
  const word = entry.word || entry.display || "";
  const external = externalSource.words.get(word.toLowerCase());
  const detail = externalSource.details.get(word.toLowerCase());
  const imageEntry = externalSource.images.get(word.toLowerCase());
  const externalMeanings = external ? extractMeaningsFromTranslations(external.translations || []) : [];
  const meanings = unique([
    ...(entry.meanings || []),
    entry.meaning_cn,
    ...externalMeanings,
    ...(EXTRA_MEANINGS[word] || []),
    ...(EXTRA_MEANINGS[word.toLowerCase()] || []),
  ].filter(Boolean));
  const posTags = POS_OVERRIDES[cleanKey(word)] || parsePos(entry.pos);
  const forms = buildForms(word, posTags, entry.forms || {}, entry);
  const examples = mergeExamples(
    detail ? extractExamplesFromAnalysis(detail.analysis || "", word) : [],
    buildExamples(word, meanings, posTags, entry.category || ""),
  );
  return {
    id: entry.id,
    word,
    display: entry.display || word,
    pos: posTags,
    pos_cn: posTags.map(posCn),
    pos_raw: entry.pos || "",
    meanings,
    examples,
    image: buildImage(word, detail, imageEntry),
    category: entry.category || "未分类",
    level_label: entry.level_label || "",
    spelling_risk: entry.spelling_risk || "low",
    forms,
    phrases: buildPhrases(external),
    word_analysis: buildWordAnalysis(detail),
    source: {
      vxiaozhi: Boolean(external || detail),
      detail: Boolean(detail),
    },
    memory: buildMemory(word, posTags, forms, entry, detail),
  };
}

function parsePos(pos = "") {
  const text = String(pos || "").toLowerCase();
  const tags = [];
  if (/\bpron\.?/.test(text)) tags.push("pronoun");
  if (/\bconj\.?/.test(text)) tags.push("conjunction");
  if (/\bprep\.?/.test(text)) tags.push("preposition");
  if (/\badj\.?/.test(text)) tags.push("adjective");
  if (/\badv\.?/.test(text)) tags.push("adverb");
  if (/\bdet\.?|\bart\.?/.test(text)) tags.push("determiner");
  if (/(^|[\s,/;])v\.?($|[\s,/;])/.test(text)) tags.push("verb");
  if (/(^|[\s,/;])n\.?($|[\s,/;])/.test(text)) tags.push("noun");
  if (/(^|[\s,/;])num\.?($|[\s,/;])/.test(text)) tags.push("number");
  return tags.length ? unique(tags) : ["word"];
}

function posCn(pos) {
  return {
    verb: "动词",
    noun: "名词",
    adjective: "形容词",
    adverb: "副词",
    preposition: "介词",
    pronoun: "代词",
    conjunction: "连词",
    determiner: "限定词",
    number: "数词",
    word: "单词",
  }[pos] || pos;
}

function buildExamples(word, meanings, posTags, category) {
  const main = meanings[0] || "这个词";
  const display = word;
  const key = word.toLowerCase().replace(/[^a-z]/g, "");
  if (SPECIAL_EXAMPLES[key]) {
    return SPECIAL_EXAMPLES[key].map(([en, cn]) => ({ en, cn }));
  }
  const examples = [];
  if (posTags.includes("verb")) {
    examples.push({ en: `I will ${display} after I finish my homework.`, cn: `我完成作业后会${main}。` });
    examples.push({ en: `We often ${display} together on weekends.`, cn: `我们周末经常一起${main}。` });
    examples.push({ en: `It is important to ${display} at the right time.`, cn: `在合适的时候${main}很重要。` });
  } else if (posTags.includes("adjective")) {
    examples.push({ en: `The room feels ${display} after we clean it.`, cn: `我们打扫后，房间感觉很${main}。` });
    examples.push({ en: `This story is ${display}, so I want to read it again.`, cn: `这个故事很${main}，所以我想再读一遍。` });
    examples.push({ en: `Try to find something ${display} in the picture.`, cn: `试着在图片里找一个${main}的东西。` });
  } else if (posTags.includes("preposition")) {
    examples.push(...prepositionExamples(display, main));
  } else if (posTags.includes("adverb")) {
    examples.push({ en: `She answered the question ${display} and clearly.`, cn: `她${main}而清楚地回答了问题。` });
    examples.push({ en: `Read the sentence ${display}, then say it again.`, cn: `${main}地读这个句子，然后再说一遍。` });
    examples.push({ en: `He walked ${display} because the road was wet.`, cn: `因为路湿了，他走得很${main}。` });
  } else if (posTags.includes("pronoun")) {
    examples.push({ en: `${capitalize(display)} can help us finish the task.`, cn: `${display} 可以帮助我们完成任务。` });
    examples.push({ en: `The teacher gave ${display} a new book.`, cn: `老师给了${display}一本新书。` });
    examples.push({ en: `I heard ${display} in the sentence.`, cn: `我在句子里听到了 ${display}。` });
  } else if (posTags.includes("determiner")) {
    examples.push({ en: `I used ${display} before a noun in the sentence.`, cn: `我在句子里的名词前使用了 ${display}。` });
    examples.push({ en: `The word ${display} helps make the sentence complete.`, cn: `${display} 这个词帮助句子变完整。` });
    examples.push({ en: `Find ${display} before the next word.`, cn: `在下一个词前找到 ${display}。` });
  } else {
    examples.push(...nounLikeExamples(display, main, category));
  }
  return examples.slice(0, 3);
}

function prepositionExamples(word, meaning) {
  const common = {
    about: [
      ["The book is about animals and nature.", "这本书是关于动物和自然的。"],
      ["We talked about our weekend plan.", "我们谈论了周末计划。"],
      ["The teacher asked a question about the story.", "老师问了一个关于这个故事的问题。"],
    ],
    above: [
      ["The plane flew above the clouds.", "飞机在云层上方飞行。"],
      ["There is a clock above the door.", "门上方有一个钟。"],
      ["Write your name above the line.", "把你的名字写在线的上方。"],
    ],
    after: [
      ["We play basketball after school.", "放学后我们打篮球。"],
      ["I brush my teeth after dinner.", "晚饭后我刷牙。"],
      ["Read the question after the example.", "读完例子后再读问题。"],
    ],
    before: [
      ["Wash your hands before lunch.", "午饭前洗手。"],
      ["Think before you answer.", "回答前先思考。"],
      ["I arrived before the class started.", "我在上课前到了。"],
    ],
    in: [
      ["The pencil is in the box.", "铅笔在盒子里。"],
      ["We study English in the classroom.", "我们在教室里学英语。"],
      ["There are many stars in the sky.", "天空中有许多星星。"],
    ],
    on: [
      ["The book is on the desk.", "书在桌子上。"],
      ["I wrote the word on the card.", "我把单词写在卡片上。"],
      ["The picture is on the wall.", "图画在墙上。"],
    ],
    under: [
      ["The cat is under the chair.", "猫在椅子下面。"],
      ["Put the bag under the desk.", "把包放在书桌下面。"],
      ["I found the card under the book.", "我在书下面找到了卡片。"],
    ],
    with: [
      ["I write with a blue pen.", "我用一支蓝色钢笔写字。"],
      ["She studies English with her friend.", "她和朋友一起学英语。"],
      ["Cut the paper with scissors.", "用剪刀剪纸。"],
    ],
  };
  return (common[word.toLowerCase()] || [
    [`The word ${word} shows a relationship in the sentence.`, `${word} 在句子中表示一种关系。`],
    [`Please read the sentence with ${word} carefully.`, `请认真读含有 ${word} 的句子。`],
    [`We practiced ${word} in a short phrase.`, `我们在一个短语中练习了 ${word}。`],
  ]).map(([en, cn]) => ({ en, cn }));
}

function nounLikeExamples(word, meaning, category) {
  if (category.includes("食物")) {
    return [
      { en: `My family eats ${word} for breakfast on Sunday.`, cn: `我家周日早餐吃${meaning}。` },
      { en: `I put the ${word} on a clean plate.`, cn: `我把${meaning}放在干净的盘子上。` },
      { en: `The ${word} smells good in the kitchen.`, cn: `厨房里的${meaning}闻起来很香。` },
    ];
  }
  if (category.includes("动物")) {
    return [
      { en: `The ${word} moves quickly across the grass.`, cn: `这只${meaning}快速穿过草地。` },
      { en: `I saw a ${word} in the picture book.`, cn: `我在图画书里看到了一只${meaning}。` },
      { en: `The little ${word} looks very cute.`, cn: `这只小${meaning}看起来很可爱。` },
    ];
  }
  if (category.includes("学校")) {
    return [
      { en: `We use the ${word} in class when we learn English.`, cn: `我们学英语时在课堂上使用${meaning}。` },
      { en: `I put the ${word} into my schoolbag.`, cn: `我把${meaning}放进书包里。` },
      { en: `The teacher pointed to the ${word}.`, cn: `老师指向了${meaning}。` },
    ];
  }
  return [
    { en: `We talked about ${word} in English class.`, cn: `我们在英语课上谈到了${meaning}。` },
    { en: `The picture helps me remember ${word}.`, cn: `这张图片帮助我记住${meaning}。` },
    { en: `I wrote ${word} in my vocabulary notebook.`, cn: `我把${meaning}写进了单词本。` },
  ];
}

function buildForms(word, posTags, sourceForms, entry = {}) {
  const lower = word.toLowerCase();
  const forms = {};
  if (posTags.includes("verb")) {
    const irregular = IRREGULAR_VERBS[lower];
    const generated = irregular || [
      thirdPerson(lower),
      regularPast(lower),
      regularPast(lower),
      presentParticiple(lower),
    ];
    forms.verb = {
      base: word,
      third_person: generated[0],
      past: generated[1],
      past_participle: generated[2],
      present_participle: generated[3],
      irregular: Boolean(irregular),
    };
  }
  if (posTags.includes("noun") || sourceForms.plural_forms?.length) {
    const nounForm = buildNounForm(word, lower, sourceForms, entry);
    forms.noun = {
      singular: word,
      ...nounForm,
    };
  }
  if (posTags.includes("adjective")) {
    forms.adjective = {
      base: word,
      comparative: comparative(lower),
      superlative: superlative(lower),
    };
  }
  if (sourceForms.variants?.length) forms.variants = sourceForms.variants;
  if (sourceForms.aliases?.length) forms.aliases = sourceForms.aliases;
  if (sourceForms.verb_forms_or_notes?.length) forms.notes = sourceForms.verb_forms_or_notes;
  return forms;
}

function buildMemory(word, posTags, forms, entry, detail) {
  const notes = [];
  if (forms.verb) {
    notes.push(forms.verb.irregular
      ? `${word} 是不规则动词：过去式 ${forms.verb.past}，过去分词 ${forms.verb.past_participle}。`
      : `${word} 是动词：过去式和过去分词通常为 ${forms.verb.past}。`);
  }
  if (forms.noun?.plural) notes.push(`${word} 作名词时，复数形式可记为 ${forms.noun.plural}。`);
  if (forms.noun?.countability_note) notes.push(forms.noun.countability_note);
  if (forms.adjective) notes.push(`${word} 作形容词时，可联想比较级 ${forms.adjective.comparative}，最高级 ${forms.adjective.superlative}。`);
  if (posTags.includes("preposition")) notes.push(`${word} 是介词，建议放在短句中记忆位置关系或搭配。`);
  if (posTags.includes("adverb")) notes.push(`${word} 是副词，注意它常用来修饰动作或句子。`);
  const compactAnalysis = firstAnalysisParagraph(detail?.analysis || "");
  if (compactAnalysis) notes.push(compactAnalysis);
  return {
    form_note: notes.join(" "),
    confusable: entry.confusable_with || [],
    related: entry.forms?.variants || [],
  };
}

function buildNounForm(word, lower, sourceForms, entry = {}) {
  const clean = cleanKey(word);
  if (UNCOUNTABLE_NOUNS.has(clean)) {
    return {
      countability: "uncountable",
      countability_note: `${word} 在当前释义中通常作不可数名词，不展示复数形式。`,
    };
  }
  if (PLURAL_ONLY_NOUNS.has(clean)) {
    return {
      countability: "plural_only",
      countability_note: `${word} 本身常作复数、特殊复数或单复数同形使用，不再生成新的复数形式。`,
    };
  }
  if (PROPER_OR_NO_PLURAL.has(clean) || isLikelyProperOrAbbreviation(word)) {
    return {
      countability: "not_shown",
      countability_note: `${word} 当前作为专有名词、缩写或称呼使用，不展示普通复数形式。`,
    };
  }
  if (IRREGULAR_NOUNS[clean]) {
    return { plural: IRREGULAR_NOUNS[clean], plural_source: "rule" };
  }
  if (sourceForms.plural_forms?.[0]) {
    return { plural: sourceForms.plural_forms[0], plural_source: "source" };
  }
  if (!isSafeCountableNoun(word, entry)) {
    return {
      countability: "unknown",
      countability_note: `${word} 的复数形式暂不自动展示，避免误导。`,
    };
  }
  return { plural: pluralize(lower), plural_source: "rule" };
}

function buildImage(word, detail, imageEntry) {
  const query = encodeURIComponent(word.replace(/[^a-zA-Z0-9 ]/g, "").trim() || "english word");
  if (imageEntry?.local_path) {
    return {
      provider: imageEntry.provider || "local",
      query: word,
      prompt: imageEntry.prompt || detail?.draw_prompt || "",
      url: `./${imageEntry.local_path}`,
      remote_path: imageEntry.remote_path || "",
      note: imageEntry.provider === "vxiaozhi"
        ? "使用 vocabulary-book-by-deepseek 已生成图片的本地缓存。"
        : "使用 draw_prompt 生成并缓存到本地的图片。",
    };
  }
  const prompt = detail?.draw_prompt || "";
  if (prompt) {
    return {
      provider: "pollinations",
      query: word,
      prompt,
      url: `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=640&height=420&nologo=true&seed=${encodeURIComponent(cleanKey(word) || word)}`,
      fallback_url: `https://loremflickr.com/640/420/${query}`,
      note: "根据 vocabulary-book-by-deepseek 的 draw_prompt 生成的免密钥图片 URL。",
    };
  }
  return {
    provider: "loremflickr",
    query: word,
    url: `https://loremflickr.com/640/420/${query}`,
    note: "免密钥关键词图片。后续可替换为本地下载图片。",
  };
}

function thirdPerson(word) {
  if (word.endsWith("y") && !/[aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh|o)$/.test(word)) return `${word}es`;
  return `${word}s`;
}

function regularPast(word) {
  if (word.endsWith("e")) return `${word}d`;
  if (word.endsWith("y") && !/[aeiou]y$/.test(word)) return `${word.slice(0, -1)}ied`;
  return `${word}ed`;
}

function presentParticiple(word) {
  if (word.endsWith("ie")) return `${word.slice(0, -2)}ying`;
  if (word.endsWith("e") && word !== "be") return `${word.slice(0, -1)}ing`;
  return `${word}ing`;
}

function pluralize(word) {
  if (word.endsWith("y") && !/[aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(potato|tomato|hero)$/.test(word)) return `${word}es`;
  if (/(s|x|z|ch|sh)$/.test(word)) return `${word}es`;
  return `${word}s`;
}

function comparative(word) {
  if (IRREGULAR_ADJECTIVES[word]) return IRREGULAR_ADJECTIVES[word][0];
  if (word.endsWith("y") && !/[aeiou]y$/.test(word)) return `${word.slice(0, -1)}ier`;
  if (word.endsWith("e")) return `${word}r`;
  if (word.length <= 5) return `${word}er`;
  return `more ${word}`;
}

function superlative(word) {
  if (IRREGULAR_ADJECTIVES[word]) return IRREGULAR_ADJECTIVES[word][1];
  if (word.endsWith("y") && !/[aeiou]y$/.test(word)) return `${word.slice(0, -1)}iest`;
  if (word.endsWith("e")) return `${word}st`;
  if (word.length <= 5) return `${word}est`;
  return `most ${word}`;
}

function articleFor(word) {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

function cleanKey(word) {
  return String(word || "").toLowerCase().replace(/[^a-z]/g, "");
}

function isLikelyProperOrAbbreviation(word) {
  const text = String(word || "");
  if (text.includes(".")) return true;
  if (/^[A-Z]{2,}$/.test(text)) return true;
  if (/^[A-Z][a-z]+$/.test(text) && !["I"].includes(text)) return true;
  return false;
}

function isSafeCountableNoun(word, entry = {}) {
  const clean = cleanKey(word);
  if (!clean || clean.length < 2) return false;
  if (COUNTABLE_OVERRIDES.has(clean)) return true;
  if (clean.endsWith("ness") || clean.endsWith("tion") || clean.endsWith("sion") || clean.endsWith("ity")) return false;
  if (clean.endsWith("ss") && !["actress", "boss", "class", "dress", "empress", "goddess", "hostess", "princess"].includes(clean)) return false;
  if (clean.endsWith("ics")) return false;
  if (clean.endsWith("s")) return false;
  if (clean.endsWith("ly")) return false;
  const category = String(entry.category || "");
  if (category.includes("抽象") || category.includes("天气自然")) return false;
  return false;
}

function capitalize(word) {
  const text = String(word || "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unique(values) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

async function loadExternalSource() {
  const source = {
    words: new Map(),
    details: new Map(),
    images: new Map(),
    metadata: {
      source: "https://github.com/vxiaozhi/vocabulary-book-by-deepseek",
      license: "Apache-2.0",
      global_words: 0,
      detail_words: 0,
      local_images: 0,
    },
  };
  try {
    const global = JSON.parse(await fs.readFile(VXIAOZHI_GLOBAL_PATH, "utf8"));
    for (const item of global.words || []) {
      if (item?.word) source.words.set(item.word.toLowerCase(), item);
    }
    source.metadata.global_words = source.words.size;
  } catch {
    // External source is optional; the app still builds from the local compact word list.
  }
  try {
    const index = JSON.parse(await fs.readFile(VXIAOZHI_DETAILS_INDEX_PATH, "utf8"));
    for (const [key, item] of Object.entries(index.entries || {})) {
      const detailPath = path.join(ROOT, item.local_path);
      try {
        const detail = JSON.parse(await fs.readFile(detailPath, "utf8"));
        source.details.set(key, detail);
      } catch {
        // Keep the global translation data even when one detail file is missing or malformed.
      }
    }
    source.metadata.detail_words = source.details.size;
  } catch {
    // Details are optional and can be downloaded later.
  }
  try {
    const index = JSON.parse(await fs.readFile(WORD_IMAGES_PATH, "utf8"));
    for (const [key, item] of Object.entries(index.entries || {})) {
      source.images.set(key, item);
    }
    source.metadata.local_images = source.images.size;
  } catch {
    // Local images are optional; URL fallbacks are used when they are not cached.
  }
  return source;
}

function extractMeaningsFromTranslations(translations) {
  const meanings = [];
  for (const item of translations || []) {
    const text = String(item.translation || "")
      .replace(/\[[^\]]+\]/g, "")
      .replace(/[()（）][^()（）]*[)）]/g, "")
      .replace(/[。.;；]+$/g, "");
    for (const part of text.split(/[；;，,、]/)) {
      const cleaned = part.trim();
      if (!cleaned || cleaned.length > 18) continue;
      meanings.push(cleaned);
    }
  }
  return meanings.slice(0, 8);
}

function buildPhrases(external) {
  return (external?.phrases || [])
    .filter((item) => item.phrase && item.translation)
    .slice(0, 8)
    .map((item) => ({
      phrase: String(item.phrase).trim(),
      translation: String(item.translation).trim(),
    }));
}

function buildWordAnalysis(detail) {
  if (!detail) return null;
  return {
    meaning: extractSection(detail.analysis || "", "分析词义"),
    root: extractSection(detail.analysis || "", "词根分析"),
    affix: extractSection(detail.analysis || "", "词缀分析"),
    history: extractSection(detail.analysis || "", "发展历史和文化背景"),
    forms_note: "",
    image_memory: detail.draw_explain || "",
    image_prompt: detail.draw_prompt || "",
  };
}

function extractSection(markdown, title) {
  const text = String(markdown || "");
  const pattern = new RegExp(`###\\s*${escapeRegExp(title)}\\s*([\\s\\S]*?)(?=\\n###\\s|$)`);
  const match = text.match(pattern);
  return sanitizeAnalysisText(match?.[1] || "");
}

function firstAnalysisParagraph(markdown) {
  const section = extractSection(markdown, "分析词义");
  if (!section) return "";
  return section.split(/\n+/).map((line) => line.trim()).find(Boolean) || "";
}

function sanitizeAnalysisText(value) {
  return String(value || "")
    .replace(/\*\*/g, "")
    .replace(/^\s*[-*]\s*/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractExamplesFromAnalysis(markdown, word) {
  const section = extractSection(markdown, "列举例句");
  if (!section) return [];
  const lines = section.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const examples = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = stripMarkdownPrefix(lines[index]);
    const explicit = line.match(/例句\s*[:：]\s*(.+?)\s*$/);
    if (explicit && looksEnglish(explicit[1])) {
      const cn = findNearbyTranslation(lines, index);
      examples.push({ en: cleanExampleEnglish(explicit[1]), cn });
      continue;
    }
    const quoted = line.match(/^["“](.+?[.!?])["”]$/);
    if (quoted && looksEnglish(quoted[1])) {
      const cn = findNearbyTranslation(lines, index);
      examples.push({ en: cleanExampleEnglish(quoted[1]), cn });
      continue;
    }
    const plain = line.match(/^([A-Z][^。！？\u4e00-\u9fff]+?[.!?])$/);
    if (plain && looksEnglish(plain[1])) {
      const cn = findNearbyTranslation(lines, index);
      examples.push({ en: cleanExampleEnglish(plain[1]), cn });
      continue;
    }
    const inline = line.match(/^["“]?([A-Z][^。！？\u4e00-\u9fff]+?[.!?])["”]?\s*[（(]([^()（）]*[\u4e00-\u9fff][^()（）]*)[）)]/);
    if (inline && looksEnglish(inline[1])) {
      examples.push({ en: cleanExampleEnglish(inline[1]), cn: inline[2].trim() });
    }
  }
  return examples
    .filter((item) => item.en && item.cn)
    .filter((item) => item.en.toLowerCase().includes(cleanKey(word)) || examples.length <= 3)
    .slice(0, 3);
}

function stripMarkdownPrefix(line) {
  return String(line || "")
    .replace(/^\d+\.\s*/, "")
    .replace(/^[-*]\s*/, "")
    .replace(/\*\*/g, "")
    .trim();
}

function findNearbyTranslation(lines, start) {
  for (let index = start + 1; index < Math.min(lines.length, start + 4); index += 1) {
    const line = stripMarkdownPrefix(lines[index]);
    const match = line.match(/中文翻译\s*[:：]\s*(.+?)\s*$/);
    if (match) return cleanWrappedQuote(match[1]);
  }
  return "";
}

function cleanExampleEnglish(value) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  return cleanWrappedQuote(text);
}

function cleanWrappedQuote(value) {
  const text = String(value || "").trim();
  if ((text.startsWith("\"") && text.endsWith("\"")) || (text.startsWith("“") && text.endsWith("”"))) {
    return text.slice(1, -1).trim();
  }
  return text;
}

function looksEnglish(value) {
  const text = String(value || "");
  return /[a-zA-Z]/.test(text) && !/[\u4e00-\u9fff]/.test(text);
}

function mergeExamples(primary, fallback) {
  const merged = [];
  for (const item of [...primary, ...fallback]) {
    if (!item?.en || !item?.cn) continue;
    if (merged.some((existing) => existing.en.toLowerCase() === item.en.toLowerCase())) continue;
    merged.push(item);
    if (merged.length >= 3) break;
  }
  return merged;
}

async function main() {
  const source = JSON.parse(await fs.readFile(SOURCE_PATH, "utf8"));
  const externalSource = await loadExternalSource();
  const entries = source.entries.map((entry) => normalizeWord(entry, externalSource));
  const primary = entries.filter((entry) => source.entries.find((item) => item.id === entry.id)?.primary);
  const junior = entries.filter((entry) => source.entries.find((item) => item.id === entry.id)?.junior);
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, "primary_words.json"), JSON.stringify({
    metadata: { profile: "primary", count: primary.length, generated_at: new Date().toISOString(), external_source: externalSource.metadata },
    entries: primary,
  }, null, 2));
  await fs.writeFile(path.join(OUT_DIR, "junior_words.json"), JSON.stringify({
    metadata: { profile: "junior", count: junior.length, generated_at: new Date().toISOString(), external_source: externalSource.metadata },
    entries: junior,
  }, null, 2));
  console.log(`primary=${primary.length} junior=${junior.length} external=${externalSource.metadata.global_words} details=${externalSource.metadata.detail_words}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
