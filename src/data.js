const WORDS_URL = "./data/中小学英语词库_learning_enriched_compact_v1.json";
const PLANS = {
  grade1: {
    label: "一年级启蒙",
    url: "./data/学习计划_grade1_启蒙全量.json",
    dailyTarget: 10,
  },
  grade7: {
    label: "初一考纲",
    url: "./data/学习计划_grade7_考纲全量.json",
    dailyTarget: 15,
  },
};

let cache = null;

async function loadJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`数据加载失败：${url}`);
  }
  return response.json();
}

export async function loadLearningData() {
  if (cache) return cache;
  const [wordData, grade1Plan, grade7Plan] = await Promise.all([
    loadJson(WORDS_URL),
    loadJson(PLANS.grade1.url),
    loadJson(PLANS.grade7.url),
  ]);
  const words = wordData.entries.map(normalizeWord);
  const byId = new Map(words.map((word) => [word.id, word]));
  cache = {
    words,
    byId,
    plans: {
      grade1: normalizePlan("grade1", grade1Plan, byId),
      grade7: normalizePlan("grade7", grade7Plan, byId),
    },
    metadata: wordData.metadata,
  };
  return cache;
}

function normalizeWord(entry) {
  return {
    id: entry.id,
    word: entry.word || entry.display,
    display: entry.display || entry.word,
    meaning: entry.meaning_cn || (entry.meanings || []).join("；"),
    meanings: entry.meanings || [],
    category: entry.category || "未分类",
    pos: entry.pos || "",
    levelLabel: entry.level_label || "",
    spellingHint: entry.spelling_hint || "",
    spellingRisk: entry.spelling_risk || "low",
    grade1: entry.grade1 || { enabled: false, exercises: [] },
    grade7: entry.grade7 || { tier: "", exercises: [] },
    forms: entry.forms || {},
    confusableWith: entry.confusable_with || [],
    etymologyLevels: entry.etymology_levels || {},
    gameTags: entry.game_tags || [],
  };
}

function normalizePlan(profile, plan, byId) {
  return {
    profile,
    label: PLANS[profile].label,
    dailyTarget: plan.metadata?.new_words_per_day || PLANS[profile].dailyTarget,
    days: plan.days.map((day) => ({
      day: day.day,
      newWordIds: day.new_word_ids || [],
      newWords: (day.new_word_ids || []).map((id) => byId.get(id)).filter(Boolean),
      categories: day.categories || {},
      reviewRule: day.review_rule || "",
      recommendedGames: day.recommended_games || [],
    })),
  };
}

export function getTodayNumber(plan, progress) {
  const completedDays = Number(progress?.completedDays || 0);
  return Math.min(completedDays + 1, plan.days.length);
}

export function getDay(plan, dayNumber) {
  return plan.days[Math.max(0, Math.min(plan.days.length - 1, dayNumber - 1))];
}

export function sampleOptions(words, answer, count = 4) {
  const pool = words.filter((word) => word.id !== answer.id);
  shuffle(pool);
  const picked = pool.slice(0, Math.max(0, count - 1));
  return shuffle([answer, ...picked]);
}

export function shuffle(items) {
  const arr = [...items];
  for (let index = arr.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [arr[index], arr[swapIndex]] = [arr[swapIndex], arr[index]];
  }
  return arr;
}
