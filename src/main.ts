import "./styles.css";
import learningManifestData from "../data/learning-manifest.json";
import { getSpellingCharacters, isSpellingCharacter, normalizeAnswer, normalizeSpellingCharacter } from "./lib/learning";
import type { LearningType, RuntimeLearningItem, SentenceComponent, SpellingUnit, WordHint } from "./lib/types";
import { escapeAttr, escapeHtml } from "./lib/view";

type SentenceInputMode = "choice" | "keyboard";

interface UnitGroup {
  key: string;
  packageName: string;
  grade: string;
  unitId: string;
  unitTitle: string;
  items: RuntimeLearningItem[];
  itemCount?: number;
  itemIds?: string[];
  previewChinese?: string;
  runtimeModulePath?: string;
  section?: string;
  typeCounts?: Partial<Record<LearningType, number>>;
}

interface LearningManifest {
  version?: number;
  source?: string;
  generatedAt?: string;
  coursePacks?: Array<Record<string, unknown>>;
  units?: LearningManifestUnit[];
}

interface LearningManifestUnit {
  key: string;
  packageName: string;
  grade: string;
  unitId: string;
  unitTitle: string;
  section?: string;
  itemCount: number;
  typeCounts?: Partial<Record<LearningType, number>>;
  itemIds?: string[];
  previewChinese?: string;
  runtimeModulePath?: string;
}

interface UserSummary {
  id: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
}

interface UserRecord extends UserSummary {
  progress?: Record<string, unknown>;
  learned?: Record<string, string[]>;
  wrong?: Record<string, string[]>;
  daily?: Record<string, DailyLog>;
}

interface DailyLog {
  [date: string]: {
    viewed: string[];
    correct: string[];
    wrong: string[];
    records: PracticeRecord[];
  };
}

interface PracticeRecord {
  itemId: string;
  contentId: string;
  english: string;
  type: LearningType;
  mode: string;
  correct: boolean;
  selected?: string;
  answer?: string;
  createdAt: string;
}

interface SavedProgress {
  selectedUnitKey: string;
  positions: Record<string, number>;
  updatedAt: string;
}

interface WrongReviewReturnPoint {
  unitKey: string;
  lessonPosition: number;
}

type ContentListFilter = "all" | "learned" | "unlearned";

interface AppState {
  items: RuntimeLearningItem[];
  units: UnitGroup[];
  users: UserSummary[];
  user: UserRecord | null;
  serverReady: boolean;
  selectedIndex: number;
  lessonItems: RuntimeLearningItem[];
  lessonPosition: number;
  selectedUnitKey: string;
  selectedPackageName: string;
  wrongReviewActive: boolean;
  wrongReviewReturnPoint: WrongReviewReturnPoint | null;
  filters: {
    contentSearch: string;
    contentType: string;
  };
  answers: Record<number, string>;
  activeUnitIndex?: number;
  hintVisible: boolean;
  showAnswer: boolean;
  activeComponentId: string;
  sentenceInputMode: SentenceInputMode;
  learnedIds: Set<string>;
  wrongIds: Set<string>;
  dailyLog: DailyLog;
  progress: SavedProgress;
  rewardText: string;
  completedCurrent: boolean;
  isSpeaking: boolean;
}

interface CourseSummary {
  packageName: string;
  group: string;
  units: UnitGroup[];
  itemCount: number;
  learnedCount: number;
  wrongCount: number;
  typeCounts: Partial<Record<LearningType, number>>;
  previewChinese: string;
  grade: string;
}

const API_BASE = "/api";
const ACTIVE_USER_KEY = "enstudy.simple.activeUser.v1";
const LOCAL_USERS_KEY = "enstudy.sentence.localUsers.v1";
const LOCAL_DATA_KEY = "enstudy.sentence.localData.v1";
const SENTENCE_MODE_KEY = "enstudy.sentence.inputMode.v1";
const TTS_SETTINGS_KEY = "enstudy.sentence.ttsSettings.v1";
const TTS_SERVICE_KEY = "enstudy.sentence.ttsService.v1";
const MODE = "sentence-mixed";
const SCOPE_KEY = `junior:${MODE}`;
const PROGRESS_KEY = `enstudy.sentence.${MODE}.progress.v1`;
const WORD_PROFILE_KEY = "enstudy.navigation.wordProfile.v1";
const sourceProfile = new URLSearchParams(window.location.search).get("from");
if (sourceProfile === "primary" || sourceProfile === "junior") {
  localStorage.setItem(WORD_PROFILE_KEY, sourceProfile);
}
const SOUND_URLS = {
  click: "/simple/sounds/click.wav",
  bad: "/simple/sounds/beep.wav",
  ok: "/simple/sounds/correct.mp3",
};

interface TtsSettings {
  service: "edge" | "browser";
  edgeVoice: string;
  edgeSpeed: number;
  edgePitch: number;
  edgeStyle: string;
  browserRate: number;
  browserPitch: number;
  autoPlay: boolean;
  playCount: number;
  playInterval: number;
}

const DEFAULT_TTS_SETTINGS: TtsSettings = {
  service: "edge",
  edgeVoice: "en-US-JennyNeural",
  edgeSpeed: 0.86,
  edgePitch: 0,
  edgeStyle: "general",
  browserRate: 0.82,
  browserPitch: 1,
  autoPlay: true,
  playCount: 1,
  playInterval: 800,
};

const EDGE_ENGLISH_VOICES = [
  { value: "en-US-JennyNeural", label: "Jenny · 女声·温柔 (美音)" },
  { value: "en-US-GuyNeural", label: "Guy · 男声·沉稳 (美音)" },
  { value: "en-US-AriaNeural", label: "Aria · 女声·清新 (美音)" },
  { value: "en-US-DavisNeural", label: "Davis · 男声·爽朗 (美音)" },
  { value: "en-US-AmberNeural", label: "Amber · 女声·明亮 (美音)" },
  { value: "en-US-BrandonNeural", label: "Brandon · 男声·浑厚 (美音)" },
  { value: "en-GB-SoniaNeural", label: "Sonia · 女声·优雅 (英音)" },
  { value: "en-GB-RyanNeural", label: "Ryan · 男声·绅士 (英音)" },
  { value: "en-GB-LibbyNeural", label: "Libby · 女声·甜美 (英音)" },
  { value: "en-AU-NatashaNeural", label: "Natasha · 女声·亲切 (澳音)" },
  { value: "en-AU-WilliamNeural", label: "William · 男声·阳光 (澳音)" },
  { value: "en-CA-ClaraNeural", label: "Clara · 女声·温婉 (加音)" },
  { value: "en-IN-NeerjaNeural", label: "Neerja · 女声·清晰 (印音)" },
];

const EDGE_STYLES = [
  { value: "general", label: "通用风格" },
  { value: "assistant", label: "智能助手" },
  { value: "chat", label: "聊天对话" },
  { value: "customerservice", label: "客服专业" },
  { value: "newscast", label: "新闻播报" },
  { value: "affectionate", label: "亲切温暖" },
  { value: "calm", label: "平静舒缓" },
  { value: "cheerful", label: "愉快欢乐" },
  { value: "gentle", label: "温和柔美" },
  { value: "lyrical", label: "抒情诗意" },
  { value: "serious", label: "严肃正式" },
];

const SPEED_OPTIONS = [
  { value: 0.5, label: "很慢" },
  { value: 0.7, label: "慢速" },
  { value: 0.86, label: "正常" },
  { value: 1.0, label: "稍快" },
  { value: 1.25, label: "快速" },
  { value: 1.5, label: "很快" },
];

const PITCH_OPTIONS = [
  { value: -50, label: "很低沉" },
  { value: -25, label: "低沉" },
  { value: 0, label: "标准" },
  { value: 25, label: "高亢" },
  { value: 50, label: "很高亢" },
];

const app = document.querySelector<HTMLDivElement>("#app") as HTMLDivElement | null;
if (!app) throw new Error("Missing #app");
const appRoot = app;
const soundPool: Partial<Record<keyof typeof SOUND_URLS, HTMLAudioElement>> = {};
const runtimeItemModules = import.meta.glob("../data/*/*/courses/*/runtime-items.json");
let speechRunId = 0;
let speechVoicesPromise: Promise<SpeechSynthesisVoice[]> | null = null;
let currentSpeechAudio: HTMLAudioElement | null = null;
let currentSpeechObjectUrl = "";
let ttsFallbackStarted = false;

let ttsSettings: TtsSettings = loadTtsSettings();

const state: AppState = {
  items: [],
  units: [],
  users: [],
  user: null,
  serverReady: false,
  selectedIndex: 0,
  lessonItems: [],
  lessonPosition: 0,
  selectedUnitKey: "",
  selectedPackageName: "",
  wrongReviewActive: false,
  wrongReviewReturnPoint: null,
  filters: {
    contentSearch: "",
    contentType: "",
  },
  answers: {},
  showAnswer: false,
  hintVisible: false,
  activeComponentId: "",
  sentenceInputMode: loadPreferredSentenceMode(),
  learnedIds: new Set(),
  wrongIds: new Set(),
  dailyLog: {},
  progress: {
    selectedUnitKey: "",
    positions: {},
    updatedAt: new Date().toISOString(),
  },
  rewardText: "",
  completedCurrent: false,
  isSpeaking: false,
};

init();

async function init() {
  await unregisterLegacyServiceWorkers();
  renderShell(`<section class="panel empty">正在加载课程数据...</section>`);
  try {
    await loadLearningDataIndex();
    state.serverReady = await checkServerReady();
    await loadUsers();
    await restoreActiveUser();
    renderList();
    if (!state.user) openUserModal();
  } catch (error) {
    renderShell(`
      <section class="panel empty">
        <h2>课程数据未生成</h2>
        <p class="muted">${escapeHtml((error as Error).message)}</p>
        <p>请先运行在线课程导入命令或 <code>npm run import:study-data</code></p>
      </section>
    `);
  }
}

async function loadLearningDataIndex() {
  const manifest = learningManifestData as LearningManifest;
  if (manifest.units?.length) {
    state.units = manifest.units.map((unit) => ({
      key: unit.key,
      packageName: unit.packageName || "默认课程包",
      grade: unit.grade || "",
      unitId: unit.unitId || "",
      unitTitle: unit.unitTitle || "未分单元",
      section: unit.section || "",
      itemCount: unit.itemCount,
      itemIds: unit.itemIds || [],
      previewChinese: unit.previewChinese || "",
      runtimeModulePath: unit.runtimeModulePath,
      typeCounts: unit.typeCounts || {},
      items: [],
    }));
    if (!state.units.length) throw new Error("data/learning-manifest.json 中没有课程单元。");
    return;
  }

  throw new Error("data/learning-manifest.json 中没有课程单元，请先运行课程导入命令生成分片课程数据。");
}

async function unregisterLegacyServiceWorkers() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  } catch {
    // Legacy PWA cleanup is best-effort.
  }
}

function renderShell(content: string) {
  appRoot.innerHTML = `
    <div class="simple-app">
      ${renderAppHeader()}
      ${content}
      ${state.rewardText ? `<div class="reward-pop">${escapeHtml(state.rewardText)}</div>` : ""}
      <div id="modalMount"></div>
    </div>
  `;
  bindShellEvents();
}

function renderPracticeShell(content: string) {
  appRoot.innerHTML = `
    <div class="simple-app">
      ${renderAppHeader()}
      ${content}
      ${state.rewardText ? `<div class="reward-pop">${escapeHtml(state.rewardText)}</div>` : ""}
      <div id="modalMount"></div>
    </div>
  `;
}

function renderAppHeader() {
  const viewed = todayBucket().viewed.length;
  const correct = todayBucket().correct.length;
  const userName = state.user?.name || "未选择";
  const userInitial = userName.charAt(0).toUpperCase();
  return `
    <header class="learn-status">
      <div class="status-title">
        <span class="status-icon"><img src="/assets/pwa/icon.svg" alt="EnStudy" /></span>
        <div>
          <h1>英语句子闯关${state.wrongReviewActive ? " · 错题练习" : ""}</h1>
          <div class="muted">听音频 · 看中文 · 拼英文 · 看成分</div>
        </div>
      </div>
      <div class="status-metrics">
        <div class="metric-card"><span>今日看过</span><strong>${viewed}</strong></div>
        <div class="metric-card"><span>今日答对</span><strong>${correct}</strong></div>
        <button class="metric-card wrong-metric" type="button" data-action="wrong-review"><span>错题练习</span><strong>${state.wrongIds.size}</strong></button>
      </div>
      <div class="status-user">
        <nav class="app-nav-tabs" aria-label="练习入口">
          <a class="app-nav-link" href="${wordPracticeHref()}"><span class="nav-icon">Aa</span><span>单词</span></a>
          <button class="app-nav-link active" type="button" data-action="home"><span class="nav-icon">⌂</span><span>${state.wrongReviewActive ? "课程" : "课程"}</span></button>
        </nav>
        <div class="header-user-section">
          <button class="header-settings-btn" type="button" data-action="open-settings" title="语音设置">
            <span class="btn-icon">⚙</span>
          </button>
          <button class="header-user-btn" type="button" data-action="open-user" title="切换用户">
            <span class="user-avatar">${escapeHtml(userInitial)}</span>
            <span class="user-name">${escapeHtml(userName)}</span>
          </button>
        </div>
      </div>
    </header>
  `;
}

function wordPracticeHref(): string {
  const profile = localStorage.getItem(WORD_PROFILE_KEY) === "primary" ? "primary" : "junior";
  return `/${profile}.html`;
}

function bindShellEvents() {
  appRoot.querySelector<HTMLElement>('[data-action="home"]')?.addEventListener("click", () => {
    if (state.wrongReviewActive) {
      exitWrongReview();
    } else {
      state.selectedPackageName = "";
      renderList();
    }
  });
  appRoot.querySelector<HTMLElement>('[data-action="wrong-review"]')?.addEventListener("click", startWrongReview);
  appRoot.querySelector<HTMLElement>('[data-action="open-settings"]')?.addEventListener("click", openSettingsModal);
  appRoot.querySelector<HTMLElement>('[data-action="open-user"]')?.addEventListener("click", openUserModal);
}

function renderList() {
  document.onkeydown = null;
  state.selectedPackageName = "";
  const groupedCourses = groupCoursesByLevel(buildCourseSummaries());

  renderShell(`
    <section class="panel stack">
      <div class="between row">
        <div>
          <h2>选择课程</h2>
          <p class="muted">先选择课程，再进入单元。单词、短语和句子会在同一个单元里混合练习。</p>
        </div>
      </div>
      <div class="course-pack-groups">
        ${groupedCourses.map(([group, courses]) => `
          <section class="course-pack-group">
            <div class="group-title-row">
              <h3>${escapeHtml(group)}</h3>
              <span>${courses.length} 门课程</span>
            </div>
            <div class="course-pack-grid">${courses.map(renderCourseCard).join("")}</div>
          </section>
        `).join("")}
      </div>
    </section>
  `);

  appRoot.querySelectorAll<HTMLButtonElement>("[data-open-course]").forEach((button) => {
    button.addEventListener("click", () => {
      playSound("click");
      void renderCourseDetail(button.dataset.openCourse || "");
    });
  });
}

async function renderCourseDetail(packageName: string) {
  document.onkeydown = null;
  const units = state.units.filter((unit) => unit.packageName === packageName);
  if (!units.length) return renderList();
  state.selectedPackageName = packageName;
  const summary = buildCourseSummary(packageName, units);

  renderShell(`
    <section class="panel stack course-detail">
      <div class="course-detail-head">
        <div class="course-detail-title">
          <button class="back-button" type="button" data-action="course-home"><span class="btn-icon">←</span><span>课程</span></button>
          <div>
            <span class="level-chip">${escapeHtml(summary.grade || summary.group)}</span>
            <h2>${escapeHtml(packageName)}</h2>
          </div>
        </div>
        <div class="course-detail-summary">
          <span>${summary.units.length} 个单元</span>
          <span>${summary.itemCount} 道内容</span>
          <span>已学 ${summary.learnedCount}</span>
        </div>
      </div>
      <div class="section-title-row">
        <div>
          <h3>选择单元</h3>
          <span>进入后按顺序混合练习单词、短语和句子</span>
        </div>
        <div class="course-detail-progress">
          <strong>${Math.round((summary.learnedCount / Math.max(summary.itemCount, 1)) * 100)}%</strong>
          <span>课程进度</span>
        </div>
      </div>
      <div class="unit-compact-grid">${units.map(renderUnitCard).join("")}</div>
    </section>
  `);

  appRoot.querySelector<HTMLElement>('[data-action="course-home"]')?.addEventListener("click", () => {
    playSound("click");
    state.selectedPackageName = "";
    renderList();
  });

  appRoot.querySelectorAll<HTMLButtonElement>("[data-open-unit]").forEach((button) => {
    button.addEventListener("click", () => {
      playSound("click");
      const key = button.dataset.openUnit || "";
      void openUnit(key, state.progress.positions[key] || 0);
    });
  });

  appRoot.querySelectorAll<HTMLButtonElement>("[data-reset-unit]").forEach((button) => {
    button.addEventListener("click", () => {
      requestResetUnitProgress(button.dataset.resetUnit || "");
    });
  });
}

function renderCourseCard(course: CourseSummary): string {
  const progressPercent = Math.round((course.learnedCount / Math.max(course.itemCount, 1)) * 100);
  return `
    <button class="course-pack-card" type="button" data-open-course="${escapeAttr(course.packageName)}">
      <span class="course-pack-main">
        <span class="level-chip">${escapeHtml(course.grade || course.group)}</span>
        <strong>${escapeHtml(course.packageName)}</strong>
        <span>${course.units.length} 个单元 · ${course.itemCount} 道内容</span>
      </span>
      <span class="unit-progress-orbit" style="--progress:${progressPercent}%"><span>${progressPercent}%</span></span>
      <span class="tag-row unit-tags">
        <span class="tag learned-tag">已学 ${course.learnedCount}</span>
        <span class="tag">错题 ${course.wrongCount}</span>
        <span class="tag">句子 ${course.typeCounts.sentence || 0}</span>
      </span>
    </button>
  `;
}

function buildCourseSummaries(): CourseSummary[] {
  const map = new Map<string, UnitGroup[]>();
  for (const unit of state.units) {
    if (!map.has(unit.packageName)) map.set(unit.packageName, []);
    map.get(unit.packageName)?.push(unit);
  }
  return [...map.entries()].map(([packageName, units]) => buildCourseSummary(packageName, units))
    .sort((a, b) => `${a.group}-${a.packageName}`.localeCompare(`${b.group}-${b.packageName}`, "zh-CN", { numeric: true }));
}

function buildCourseSummary(packageName: string, units: UnitGroup[]): CourseSummary {
  const itemIds = units.flatMap((unit) => unit.itemIds?.length ? unit.itemIds : unit.items.map((item) => item.id));
  const typeCounts = units.reduce<Partial<Record<LearningType, number>>>((acc, unit) => {
    const counts = unit.typeCounts || countTypes(unit.items);
    for (const [type, count] of Object.entries(counts)) {
      const key = type as LearningType;
      acc[key] = (acc[key] || 0) + Number(count || 0);
    }
    return acc;
  }, {});
  return {
    packageName,
    group: courseGroupLabel(packageName),
    units,
    itemCount: units.reduce((sum, unit) => sum + (unit.itemCount || unit.items.length), 0),
    learnedCount: itemIds.filter((id) => state.learnedIds.has(id)).length,
    wrongCount: itemIds.filter((id) => state.wrongIds.has(id)).length,
    typeCounts,
    previewChinese: units.find((unit) => unit.previewChinese)?.previewChinese || "",
    grade: unique(units.map((unit) => unit.grade))[0] || "",
  };
}

function groupCoursesByLevel(courses: CourseSummary[]): Array<[string, CourseSummary[]]> {
  const map = new Map<string, CourseSummary[]>();
  for (const course of courses) {
    if (!map.has(course.group)) map.set(course.group, []);
    map.get(course.group)?.push(course);
  }
  const order = ["小学同步", "初中同步", "新概念英语", "专项词汇与口语", "其他课程"];
  return [...map.entries()].sort((a, b) => orderIndex(order, a[0]) - orderIndex(order, b[0]));
}

function courseGroupLabel(packageName: string): string {
  if (/一年级|二年级|三年级|四年级|五年级|六年级|小学|北京版/.test(packageName)) return "小学同步";
  if (/七年级|八年级|九年级|初中/.test(packageName)) return "初中同步";
  if (/新概念/i.test(packageName)) return "新概念英语";
  if (/星火|词汇|对话|口语/.test(packageName)) return "专项词汇与口语";
  return "其他课程";
}

function orderIndex(order: string[], value: string): number {
  const index = order.indexOf(value);
  return index < 0 ? order.length : index;
}

function filterContentItems(items: RuntimeLearningItem[]): RuntimeLearningItem[] {
  const keyword = state.filters.contentSearch.trim().toLowerCase();
  return items.filter((item) => {
    if (state.filters.contentType && item.type !== state.filters.contentType) return false;
    if (!keyword) return true;
    return `${item.fullEnglish} ${item.displayChinese} ${item.section || ""}`.toLowerCase().includes(keyword);
  });
}

function renderContentRow(item: RuntimeLearningItem, unit: UnitGroup): string {
  const index = unit.items.findIndex((candidate) => candidate.id === item.id);
  const learned = state.learnedIds.has(item.id);
  const wrong = state.wrongIds.has(item.id);
  return `
    <button class="content-row ${learned ? "learned" : ""} ${wrong ? "wrong" : ""}" type="button" data-open-content="${escapeAttr(item.id)}">
      <span class="content-row-main">
        <span class="content-type">${escapeHtml(typeLabel(item.type))}</span>
        <strong>${escapeHtml(item.fullEnglish)}</strong>
        <span>${escapeHtml(item.displayChinese || "暂无中文释义")}</span>
      </span>
      <span class="content-row-meta">第 ${Math.max(index + 1, 1)} 题 ${learned ? "· 已学" : ""}${wrong ? "· 错题" : ""}</span>
    </button>
  `;
}

function formatUnitTitle(unit?: UnitGroup): string {
  if (!unit) return "未分单元";
  const title = unit.unitTitle || "未分单元";
  const id = unit.unitId || "";
  if (unit.packageName === "七年级英语上" && id && !title.toLowerCase().includes(id.toLowerCase())) {
    if (/^starter unit\b/i.test(title)) return title;
    if (/^su\d+$/i.test(id)) return `Starter Unit ${id.replace(/\D+/g, "")} ${title}`.trim();
    return `${id} ${title}`.trim();
  }
  if (unit.packageName === "七年级英语上" && /^Starter Unit 3$/i.test(id) && !/^Starter Unit 3/i.test(title)) {
    return `Starter Unit 3 ${title}`;
  }
  return title;
}

function renderUnitCard(unit: UnitGroup): string {
  const counts = unit.typeCounts || countTypes(unit.items);
  const savedPosition = state.progress.positions[unit.key] || 0;
  const itemIds = unit.itemIds?.length ? unit.itemIds : unit.items.map((item) => item.id);
  const totalItems = unit.itemCount || unit.items.length;
  const learnedInUnit = itemIds.filter((id) => state.learnedIds.has(id)).length;
  const currentPosition = Math.min(savedPosition + 1, totalItems);
  const progressPercent = Math.round((learnedInUnit / Math.max(totalItems, 1)) * 100);
  const progressMessage = learnedInUnit === totalItems ? "本单元已完成" : learnedInUnit ? `从第 ${currentPosition} 题继续` : "从第一题开始";
  const selected = state.selectedUnitKey === unit.key ? " selected" : "";
  const startLabel = learnedInUnit ? "继续" : "开始";
  return `
    <section class="panel item-card unit-card${selected}">
      <div class="unit-card-body">
        <span class="unit-card-top">
          <span class="unit-card-copy">
            <span class="level-chip">${escapeHtml(progressMessage)}</span>
            <strong>${escapeHtml(formatUnitTitle(unit))}</strong>
            <span class="course-caption">${totalItems} 题 · 单词 ${counts.word || 0} · 短语 ${counts.phrase || 0} · 句子 ${counts.sentence || 0}</span>
          </span>
          <span class="unit-progress-orbit" style="--progress:${progressPercent}%" aria-label="已学习 ${progressPercent}%">
            <span>${progressPercent}%</span>
          </span>
        </span>
        <span class="unit-progress-track" aria-hidden="true"><span style="width:${progressPercent}%"></span></span>
        <span class="unit-mini-meta">已学 ${learnedInUnit}/${totalItems}</span>
      </div>
      <div class="unit-card-actions">
        <button class="unit-start" type="button" data-open-unit="${escapeAttr(unit.key)}">${startLabel}</button>
        <button class="unit-reset" type="button" data-reset-unit="${escapeAttr(unit.key)}">重置</button>
      </div>
    </section>
  `;
}

async function openUnit(unitKey: string, position = 0) {
  const unit = state.units.find((candidate) => candidate.key === unitKey);
  if (!unit) return;
  if (!unit.items.length) {
    renderShell(`<section class="panel empty">正在加载 ${escapeHtml(unit.unitTitle || "当前单元")}...</section>`);
    await loadUnitItems(unit);
  }
  state.wrongReviewActive = false;
  state.selectedUnitKey = unit.key;
  state.selectedPackageName = unit.packageName;
  state.lessonItems = [...unit.items];
  state.lessonPosition = clamp(position, 0, Math.max(0, state.lessonItems.length - 1));
  openCurrentLessonItem();
}

function openCurrentLessonItem() {
  const item = currentItem();
  if (!item) return renderCurrentCourseOrList();
  state.selectedIndex = state.items.findIndex((candidate) => candidate.id === item.id);
  state.answers = {};
  state.showAnswer = false;
  state.hintVisible = false;
  state.completedCurrent = false;
  state.activeComponentId = "";
  state.sentenceInputMode = loadPreferredSentenceMode();
  state.activeUnitIndex = item.spellingUnits.find((unit) => unit.fillable)?.index;
  recordViewed(item);
  saveCurrentProgress();
  renderLearn();
  if (ttsSettings.autoPlay) {
    window.setTimeout(() => speak(item.audioText, { restart: true }), 220);
  }
}

function renderLearn() {
  const item = currentItem();
  if (!item) return renderCurrentCourseOrList();

  const progressLabel = state.lessonItems.length ? `第 ${state.lessonPosition + 1} / ${state.lessonItems.length} 题` : "";
  renderPracticeShell(`
    <section class="game-shell">
      <section class="challenge-panel panel">
        ${renderPracticeHead(item, progressLabel)}
        <div class="practice-board">
          ${renderPracticePrompt(item)}
          <div class="practice-workspace">
            ${renderTypeIntro(item)}
            ${renderSpellingArea(item)}
            ${state.hintVisible ? renderInlineHint(getActiveHint(item)) : ""}
            ${state.showAnswer ? renderAnswerPanel(item) : ""}
          </div>
        </div>
        ${renderPracticeFooter(item)}
        <div class="shortcut-hints">键盘：A-Z 选择字母 · Backspace 撤回 · Delete/Esc 清空 · Space 下一个词 · Enter 下一题 · Shift+Enter 上一题</div>
      </section>
    </section>
  `);

  bindShellEvents();
  bindLearnEvents(item);
}

function renderPracticeHead(item: RuntimeLearningItem, progressLabel: string): string {
  return `
    <div class="challenge-head">
      <div class="practice-title-block">
        <div class="practice-title-row">
          <h2>${escapeHtml(typeLabel(item.type))}练习</h2>
          <span class="practice-step">${escapeHtml(progressLabel)}</span>
        </div>
        <p class="muted">${escapeHtml([item.coursePackageName, item.unitTitle || item.unitId, item.section].filter(Boolean).join(" · "))}</p>
      </div>
      <div class="practice-head-tools">
        ${renderProgressTools()}
        ${renderInputModeSwitch()}
        ${renderCompletionBadge(item)}
      </div>
    </div>
  `;
}

function renderPracticePrompt(item: RuntimeLearningItem): string {
  const speakState = state.isSpeaking ? " speaking" : "";
  const hintState = state.hintVisible ? " active" : "";
  return `
    <div class="practice-prompt-wrap">
      <div class="practice-prompt">${escapeHtml(item.displayChinese || "暂无中文释义")}</div>
      <div class="prompt-actions" aria-label="学习辅助操作">
        <button type="button" data-action="speak" class="sound-pill${speakState}" title="播放英文发音" ${state.isSpeaking ? "disabled" : ""}><span class="btn-icon">▶</span><span>${state.isSpeaking ? "播放中" : "播放"}</span></button>
        <button type="button" data-action="hint" class="hint-toggle${hintState}" title="${state.hintVisible ? "收起提示" : "提示当前单词"}" aria-pressed="${state.hintVisible ? "true" : "false"}"><span class="btn-icon">?</span><span>${state.hintVisible ? "收起" : "提示"}</span></button>
        <button type="button" data-action="show-answer" title="显示完整答案"><span class="btn-icon">✓</span><span>答案</span></button>
      </div>
    </div>
  `;
}

function renderProgressTools(): string {
  const learnedCount = state.lessonItems.filter((candidate) => state.learnedIds.has(candidate.id)).length;
  const unlearnedCount = Math.max(0, state.lessonItems.length - learnedCount);
  return `
    <div class="practice-progress-tools" aria-label="题目状态与题单">
      <button class="status-filter learned" type="button" data-content-filter="learned">已学 <strong>${learnedCount}</strong></button>
      <button class="status-filter unlearned" type="button" data-content-filter="unlearned">未学 <strong>${unlearnedCount}</strong></button>
      <button class="status-filter list" type="button" data-action="content-list">题单 <strong>${state.lessonItems.length}</strong></button>
    </div>
  `;
}

function renderPracticeFooter(item: RuntimeLearningItem): string {
  const unitActions = state.wrongReviewActive
    ? `<button type="button" data-action="home">返回课程</button>`
    : `<button type="button" data-action="back-course">返回课程单元</button>
       <button type="button" data-action="reset-unit" title="清空当前所选单元的当前位置、已学和错题">重置本单元</button>`;
  return `
    <footer class="practice-footer" aria-label="题目操作">
      <div class="footer-unit-actions">${unitActions}</div>
      <div class="footer-question-actions">
        <button type="button" data-action="redo">重做</button>
        <button type="button" data-action="prev">上一题</button>
        <button type="button" data-action="next" class="primary">${state.learnedIds.has(item.id) && !state.completedCurrent ? "跳到下一题" : "下一题"}</button>
      </div>
    </footer>
  `;
}

function renderCompletionBadge(item: RuntimeLearningItem): string {
  if (!state.completedCurrent && !state.learnedIds.has(item.id)) return "";
  return `<span class="done-corner"><span>★</span><strong>✓ 已学</strong></span>`;
}

function renderLearnedBadge(learned: boolean, wrong: boolean) {
  if (wrong) return `<span class="learned-badge wrong"><span>!</span><strong>错题</strong></span>`;
  return `
    <span class="learned-badge ${learned ? "done" : "new"}">
      <span>${learned ? "✓" : "○"}</span>
      <strong>${learned ? "已学" : "未学"}</strong>
    </span>
  `;
}

function renderTypeIntro(item: RuntimeLearningItem): string {
  if (shouldUseSentenceView(item)) return "";
  const title = item.type === "phrase" ? "短语逐词拼写" : item.type === "abbreviation" ? "缩写拼写" : "单词拼写";
  return `
    <div class="mode-row">
      <strong>${escapeHtml(title)}</strong>
      <span class="muted">点击字母块或直接键盘输入，横线数量对应英文字母数。</span>
    </div>
  `;
}

function renderInputModeSwitch(): string {
  return `
    <div class="practice-progress-tools mode-toggle" aria-label="填空方式">
      <button type="button" class="status-filter ${state.sentenceInputMode === "choice" ? "active" : ""}" data-mode="choice"><span>词块</span></button>
      <button type="button" class="status-filter ${state.sentenceInputMode === "keyboard" ? "active" : ""}" data-mode="keyboard"><span>键盘</span></button>
    </div>
  `;
}

function renderSpellingArea(item: RuntimeLearningItem): string {
  if (state.sentenceInputMode === "choice") return renderChoicePracticeArea(item);
  return renderKeyboardPracticeArea(item);
}

function renderChoicePracticeArea(item: RuntimeLearningItem): string {
  return `
    <div class="choice-practice stack">
      <div class="choice-sentence">
        ${item.spellingUnits.map((unit) => renderChoiceUnit(unit)).join("")}
      </div>
      <div class="word-bank">
        ${getChoiceBlocks(item).map((word, index) => renderWordBlock(word, item, index)).join("")}
      </div>
    </div>
  `;
}

function renderKeyboardPracticeArea(item: RuntimeLearningItem): string {
  return `
    <div class="keyboard-practice stack">
      <div class="spelling-area keyboard-area">${item.spellingUnits.map((unit) => renderKeyboardWordUnit(unit)).join("")}</div>
      ${renderLetterBank(item)}
    </div>
  `;
}

function renderChoiceUnit(unit: SpellingUnit): string {
  if (!unit.fillable) return `<span class="locked-token">${escapeHtml(unit.text)}</span>`;
  const value = state.showAnswer ? unit.answer : state.answers[unit.index] || "";
  const status = getUnitStatus(unit, value);
  const content = value || displayBlank(unit.blank);
  return `
    <span class="choice-wrap">
      <button class="choice-blank ${status}" type="button" data-choice-blank="${unit.index}" title="点击清空或选中此空">${escapeHtml(content)}</button>
    </span>
  `;
}

function renderWordBlock(word: string, item: RuntimeLearningItem, index: number): string {
  const disabled = isWordBlockExhausted(word, item) || state.showAnswer;
  return `<button class="word-block" type="button" data-word-block="${escapeAttr(word)}" data-word-block-index="${index}" ${disabled ? "disabled" : ""}>${escapeHtml(word)}</button>`;
}

function renderSpellingUnit(unit: SpellingUnit): string {
  if (!unit.fillable) return `<span class="locked-token">${escapeHtml(unit.text)}</span>`;
  const value = state.showAnswer ? unit.answer : state.answers[unit.index] || "";
  const status = getUnitStatus(unit, value);
  const width = Math.max(76, Math.min(340, unit.letterCount * 22 + 42));
  return `
    <label class="spell-unit" style="--unit-width:${width}px">
      <input
        data-unit-index="${unit.index}"
        class="${status}"
        value="${escapeAttr(value)}"
        placeholder="${escapeAttr(displayBlank(unit.blank))}"
        autocomplete="off"
        autocapitalize="none"
        spellcheck="false"
      />
    </label>
  `;
}

function renderKeyboardWordUnit(unit: SpellingUnit): string {
  if (!unit.fillable) return `<span class="locked-token">${escapeHtml(unit.text)}</span>`;
  const value = state.showAnswer ? unit.answer : state.answers[unit.index] || "";
  const status = getUnitStatus(unit, value);
  const active = state.activeUnitIndex === unit.index ? " active" : "";
  const answerCharacters = getSpellingCharacters(unit.answer);
  const typedCharacters = getSpellingCharacters(value);
  return `
    <span class="keyboard-unit-wrap">
      <button class="keyboard-word ${status}${active}" type="button" data-keyboard-word="${unit.index}" style="--letter-count:${answerCharacters.length}">
        ${answerCharacters.map((answerCharacter, index) => {
          const typedCharacter = typedCharacters[index] || "";
          const apostrophe = answerCharacter === "'" ? " apostrophe-slot" : "";
          const display = typedCharacter ? displaySpellingCharacter(typedCharacter) : answerCharacter === "'" ? "’" : "";
          return `<span class="letter-slot${apostrophe} ${typedCharacter ? "filled" : ""}" data-slot="${index}">${escapeHtml(display)}</span>`;
        }).join("")}
      </button>
    </span>
  `;
}

function renderLetterBank(item: RuntimeLearningItem): string {
  const activeUnit = getActiveFillableUnit(item);
  if (!activeUnit || state.showAnswer) return "";
  const letters = getLetterBlocks(activeUnit);
  return `
    <div class="letter-bank" aria-label="字母块">
      ${letters.map((letter, index) => {
        const exhausted = isLetterBlockExhausted(letter, activeUnit, letters);
        const apostrophe = normalizeSpellingCharacter(letter) === "'" ? " apostrophe-block" : "";
        return `<button class="letter-block${apostrophe}" type="button" data-letter-block="${escapeAttr(letter)}" data-letter-index="${index}" ${exhausted ? "disabled" : ""}>${escapeHtml(displaySpellingCharacter(letter))}</button>`;
      }).join("")}
    </div>
  `;
}

function displayBlank(blank: string): string {
  if (!/^_+$/.test(blank)) return blank;
  return blank.split("").join(" ");
}

function displaySpellingCharacter(character: string): string {
  return normalizeSpellingCharacter(character) === "'" ? "’" : character;
}

function renderInlineHint(hint?: WordHint): string {
  if (!hint) return "";
  const parent = hint.parentComponentText
    ? `<span>所在成分：${escapeHtml(hint.parentComponentText)} = ${escapeHtml(hint.parentComponentRole || "未标注")}，${escapeHtml(hint.parentComponentZh || "")}</span>`
    : "";
  return `
    <aside class="hint-card inline-hint">
      <strong>${escapeHtml(hint.text)}</strong>
      <span>音标：${escapeHtml(hint.phonetic || "暂缺")}</span>
      <span>中文：${escapeHtml(hint.zh || "暂缺")}</span>
      <span>词性/成分：${escapeHtml(hint.pos || hint.componentRole || "暂缺")}</span>
      ${parent}
    </aside>
  `;
}

function renderAnswerPanel(item: RuntimeLearningItem): string {
  const englishDisplay =
    shouldUseSentenceView(item) ? renderAnnotatedSentence(item) : renderWordCompletion(item);
  const speakState = state.isSpeaking ? " speaking" : "";
  return `
    <section class="answer-panel">
      <div class="completion-card">
        <div class="completion-head">
          <span>成句展示</span>
          <button type="button" data-action="speak" class="sound-pill${speakState}" ${state.isSpeaking ? "disabled" : ""}><span class="btn-icon">▶</span><span>${state.isSpeaking ? "播放中" : "重新播放"}</span></button>
        </div>
        ${englishDisplay}
      </div>
    </section>
  `;
}

function renderWordCompletion(item: RuntimeLearningItem): string {
  const fillable = item.spellingUnits.filter((unit) => unit.fillable);
  const primaryUnit = fillable[0];
  const phonetic = item.phonetic || primaryUnit?.phonetic || "";
  const pos = item.pos || primaryUnit?.pos || primaryUnit?.role || "";
  const zh = item.displayChinese || primaryUnit?.zh || "";
  return `
    <div class="completion-word-card">
      <div class="completion-word-main">
        <strong>${escapeHtml(item.fullEnglish)}</strong>
        ${phonetic ? `<span>${escapeHtml(phonetic)}</span>` : ""}
      </div>
      <div class="completion-word-tags">
        ${pos ? `<span class="annotated-label word-pos"><strong>${escapeHtml(pos)}</strong></span>` : ""}
        ${zh ? `<span class="annotated-label word-meaning"><em>${escapeHtml(zh)}</em></span>` : ""}
      </div>
    </div>
  `;
}

function openContentListModal(item: RuntimeLearningItem, filter: ContentListFilter = "all", page = 1) {
  const modalMount = appRoot.querySelector("#modalMount");
  if (!modalMount || !state.lessonItems.length) return;

  const filteredItems = state.lessonItems
    .map((candidate, position) => ({ candidate, position }))
    .filter(({ candidate }) => {
      if (filter === "learned") return state.learnedIds.has(candidate.id);
      if (filter === "unlearned") return !state.learnedIds.has(candidate.id);
      return true;
    });
  const pageSize = 12;
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const currentPage = clamp(page, 1, totalPages);
  const pageItems = filteredItems.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const learnedCount = state.lessonItems.filter((candidate) => state.learnedIds.has(candidate.id)).length;
  const filterLabel = filter === "learned" ? "已学题目" : filter === "unlearned" ? "未学题目" : "全部题目";

  modalMount.innerHTML = `
    <div class="modal-backdrop content-list-backdrop">
      <section class="modal content-list-modal panel" role="dialog" aria-modal="true" aria-labelledby="contentListTitle">
        <div class="modal-head">
          <div>
            <h2 id="contentListTitle">${escapeHtml(item.unitTitle || "当前单元")} · 题单</h2>
            <p class="muted">共 ${state.lessonItems.length} 题 · 已学 ${learnedCount} · 未学 ${state.lessonItems.length - learnedCount}</p>
          </div>
          <button type="button" data-close-modal>关闭</button>
        </div>
        <div class="content-list-filters" role="tablist" aria-label="题单筛选">
          ${(["all", "learned", "unlearned"] as ContentListFilter[]).map((value) => `
            <button class="content-filter-tab ${filter === value ? "active" : ""}" type="button" data-content-filter="${value}">
              ${value === "all" ? "全部" : value === "learned" ? "已学" : "未学"}
            </button>
          `).join("")}
          <span class="content-list-filter-label">${filterLabel} · 第 ${currentPage}/${totalPages} 页</span>
        </div>
        <div class="content-list-page">
          ${pageItems.length ? pageItems.map(({ candidate, position }) => `
            <button class="practice-content-row ${candidate.id === item.id ? "active" : ""} ${state.learnedIds.has(candidate.id) ? "learned" : ""}" type="button" data-content-position="${position}">
              <span class="content-order">${position + 1}</span>
              <span>
                <strong>${escapeHtml(candidate.fullEnglish)}</strong>
                <em>${escapeHtml(candidate.displayChinese || "暂无中文释义")}</em>
              </span>
              <small>${escapeHtml(typeLabel(candidate.type))} · ${state.learnedIds.has(candidate.id) ? "已学" : "未学"}</small>
            </button>
          `).join("") : `<div class="empty muted">当前筛选下没有题目。</div>`}
        </div>
        <div class="content-list-pagination">
          <button type="button" data-content-page="${currentPage - 1}" ${currentPage <= 1 ? "disabled" : ""}>上一页</button>
          <strong>第 ${currentPage} / ${totalPages} 页</strong>
          <button type="button" data-content-page="${currentPage + 1}" ${currentPage >= totalPages ? "disabled" : ""}>下一页</button>
        </div>
      </section>
    </div>
  `;

  modalMount.querySelectorAll<HTMLElement>("[data-close-modal]").forEach((button) => button.addEventListener("click", closeModal));
  modalMount.querySelectorAll<HTMLButtonElement>("[data-content-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextFilter = (button.dataset.contentFilter || "all") as ContentListFilter;
      if (nextFilter === "all" || nextFilter === "learned" || nextFilter === "unlearned") openContentListModal(item, nextFilter, 1);
    });
  });
  modalMount.querySelectorAll<HTMLButtonElement>("[data-content-page]").forEach((button) => {
    button.addEventListener("click", () => openContentListModal(item, filter, Number(button.dataset.contentPage || currentPage)));
  });
  modalMount.querySelectorAll<HTMLButtonElement>("[data-content-position]").forEach((button) => {
    button.addEventListener("click", () => {
      const position = Number(button.dataset.contentPosition);
      if (!Number.isFinite(position)) return;
      closeModal();
      state.lessonPosition = clamp(position, 0, Math.max(0, state.lessonItems.length - 1));
      openCurrentLessonItem();
    });
  });
}

interface AnnotatedChunk {
  text: string;
  componentId?: string;
  role?: string;
  zh?: string;
  colorIndex: number;
}

function renderAnnotatedSentence(item: RuntimeLearningItem): string {
  const chunks = buildAnnotatedChunks(item);
  if (!chunks.some((chunk) => chunk.role)) {
    return `<div class="full-english">${escapeHtml(item.fullEnglish)}</div>`;
  }

  return `
    <div class="annotated-sentence-wrap">
      <div class="annotated-sentence" aria-label="句子成分标注">
        ${chunks.map((chunk) => renderAnnotatedChunk(chunk)).join("")}
      </div>
    </div>
  `;
}

function renderAnnotatedChunk(chunk: AnnotatedChunk): string {
  if (!chunk.role) return `<span class="annotated-plain">${escapeHtml(chunk.text)}</span>`;
  const active = state.activeComponentId === chunk.componentId ? " active" : "";
  return `
    <button
      class="annotated-part tone-${chunk.colorIndex}${active}"
      type="button"
      data-component-id="${escapeAttr(chunk.componentId || "")}" 
      title="${escapeAttr([chunk.role, chunk.zh].filter(Boolean).join("："))}"
    >
      <span class="annotated-text">${escapeHtml(chunk.text)}</span>
      <span class="annotated-label">
        <strong>${escapeHtml(chunk.role)}</strong>
        ${chunk.zh ? `<em>${escapeHtml(chunk.zh)}</em>` : ""}
      </span>
    </button>
  `;
}

function buildAnnotatedChunks(item: RuntimeLearningItem): AnnotatedChunk[] {
  const componentMap = buildTopComponentMap(item.componentTree);
  const chunks: AnnotatedChunk[] = [];
  const colorByComponent = new Map<string, number>();
  let colorCursor = 0;

  for (const unit of item.spellingUnits) {
    if (!unit.fillable) {
      if (chunks.length && unit.type === "punctuation") {
        chunks[chunks.length - 1].text += unit.text;
      } else {
        chunks.push({ text: unit.text, colorIndex: 0 });
      }
      continue;
    }

    const component = unit.componentId ? componentMap.get(unit.componentId) : undefined;
    const componentId = component?.id || unit.componentId;
    const role = component?.role || unit.role;
    const zh = component?.zh || unit.zh;
    const key = componentId || `word-${unit.index}`;
    if (!colorByComponent.has(key)) {
      colorByComponent.set(key, colorCursor % 6);
      colorCursor += 1;
    }
    const previous = chunks[chunks.length - 1];
    if (previous?.componentId && previous.componentId === componentId) {
      previous.text += ` ${unit.text}`;
      continue;
    }

    chunks.push({
      text: unit.text,
      componentId,
      role,
      zh,
      colorIndex: colorByComponent.get(key) || 0,
    });
  }

  return chunks;
}

function buildTopComponentMap(components: SentenceComponent[]): Map<string, SentenceComponent> {
  const map = new Map<string, SentenceComponent>();
  for (const component of components) {
    fillTopComponentMap(component, component, map);
  }
  return map;
}

function fillTopComponentMap(component: SentenceComponent, top: SentenceComponent, map: Map<string, SentenceComponent>) {
  map.set(component.id, top);
  for (const child of component.children || []) {
    fillTopComponentMap(child, top, map);
  }
}

function bindLearnEvents(item: RuntimeLearningItem) {
  appRoot.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      playSound("click");
      state.sentenceInputMode = button.dataset.mode === "keyboard" ? "keyboard" : "choice";
      savePreferredSentenceMode(state.sentenceInputMode);
      renderLearn();
    });
  });

  appRoot.querySelectorAll<HTMLButtonElement>("[data-keyboard-word]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeUnitIndex = Number(button.dataset.keyboardWord);
      renderLearn();
    });
  });

  document.onkeydown = (event) => handlePracticeKeydown(event, item);

  appRoot.querySelectorAll<HTMLInputElement>("[data-unit-index]").forEach((input) => {
    input.addEventListener("focus", () => {
      state.activeUnitIndex = Number(input.dataset.unitIndex);
    });
    input.addEventListener("input", () => {
      const index = Number(input.dataset.unitIndex);
      state.answers[index] = input.value;
      const unit = item.spellingUnits.find((candidate) => candidate.index === index);
      if (unit) {
        const status = getUnitStatus(unit, input.value);
        input.className = status;
        if (status === "wrong") markWrong(item, input.value);
      }
      checkCompletion(item);
    });
  });

  appRoot.querySelectorAll<HTMLButtonElement>("[data-hint-index]").forEach((button) => {
    button.addEventListener("click", () => {
      playSound("click");
      state.activeUnitIndex = Number(button.dataset.hintIndex);
      state.hintVisible = true;
      renderLearn();
    });
  });

  appRoot.querySelectorAll<HTMLButtonElement>("[data-choice-blank]").forEach((button) => {
    button.addEventListener("click", () => {
      playSound("click");
      const index = Number(button.dataset.choiceBlank);
      state.activeUnitIndex = index;
      if (state.answers[index]) state.answers[index] = "";
      renderLearn();
    });
  });

  appRoot.querySelectorAll<HTMLButtonElement>("[data-word-block]").forEach((button) => {
    button.addEventListener("click", () => {
      fillChoiceWord(item, button.dataset.wordBlock || "");
    });
  });

  appRoot.querySelectorAll<HTMLButtonElement>("[data-letter-block]").forEach((button) => {
    button.addEventListener("click", () => {
      appendLetterToActiveUnit(item, button.dataset.letterBlock || "");
    });
  });

  appRoot.querySelectorAll<HTMLElement>('[data-action="speak"]').forEach((button) => {
    button.addEventListener("click", () => speak(item.audioText));
  });
  appRoot.querySelector<HTMLElement>('[data-action="hint"]')?.addEventListener("click", () => useActiveHint(item));
  appRoot.querySelector<HTMLElement>('[data-action="show-answer"]')?.addEventListener("click", () => revealAnswer(item));
  appRoot.querySelector<HTMLElement>('[data-action="content-list"]')?.addEventListener("click", () => openContentListModal(item));
  appRoot.querySelectorAll<HTMLButtonElement>("[data-content-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      const filter = button.dataset.contentFilter as ContentListFilter;
      if (filter === "learned" || filter === "unlearned") openContentListModal(item, filter);
    });
  });
  appRoot.querySelector<HTMLElement>('[data-action="next"]')?.addEventListener("click", () => tryOpenNextItem(item));
  appRoot.querySelector<HTMLElement>('[data-action="prev"]')?.addEventListener("click", openPrevItem);
  appRoot.querySelector<HTMLElement>('[data-action="redo"]')?.addEventListener("click", () => redoCurrentItem(item));
  appRoot.querySelector<HTMLElement>('[data-action="back-course"]')?.addEventListener("click", renderCurrentCourseOrList);
  appRoot.querySelector<HTMLElement>('[data-action="reset-unit"]')?.addEventListener("click", resetCurrentUnitProgress);
  appRoot.querySelectorAll<HTMLElement>("[data-component-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeComponentId = button.dataset.componentId || "";
      renderLearn();
    });
  });

  appRoot.querySelectorAll<HTMLButtonElement>("[data-jump-position]").forEach((button) => {
    button.addEventListener("click", () => {
      const position = Number(button.dataset.jumpPosition);
      if (Number.isFinite(position)) {
        state.lessonPosition = clamp(position, 0, Math.max(0, state.lessonItems.length - 1));
        openCurrentLessonItem();
      }
    });
  });
}

function handlePracticeKeydown(event: KeyboardEvent, item: RuntimeLearningItem) {
  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement || activeElement instanceof HTMLSelectElement) return;
  if (document.querySelector(".modal-backdrop")) return;

  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    revealAnswer(item);
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    if (event.shiftKey) {
      openPrevItem();
    } else {
      tryOpenNextItem(item);
    }
    return;
  }

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    openPrevItem();
    return;
  }

  if (event.key === "ArrowRight") {
    event.preventDefault();
    tryOpenNextItem(item);
    return;
  }

  if ((event.ctrlKey || event.metaKey) && event.key === " ") {
    event.preventDefault();
    speak(item.audioText);
    return;
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r") {
    event.preventDefault();
    redoCurrentItem(item);
    return;
  }
  if (event.key === "F4") {
    event.preventDefault();
    speak(item.audioText);
    return;
  }
  if (event.key === "F8") {
    event.preventDefault();
    revealAnswer(item);
    return;
  }
  if (event.key === "F2") {
    event.preventDefault();
    redoCurrentItem(item);
    return;
  }

  if (state.sentenceInputMode === "keyboard") {
    handleKeyboardWordInput(event, item);
  }
}

function handleKeyboardWordInput(event: KeyboardEvent, item: RuntimeLearningItem) {
  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement || activeElement instanceof HTMLSelectElement) return;
  const unit = item.spellingUnits.find((candidate) => candidate.index === state.activeUnitIndex && candidate.fillable)
    || item.spellingUnits.find((candidate) => candidate.fillable);
  if (!unit || state.showAnswer) return;

  if (event.key === " ") {
    event.preventDefault();
    moveToNextKeyboardUnit(item, unit.index);
    renderLearn();
    return;
  }

  if (event.key === "Backspace") {
    event.preventDefault();
    undoActiveLetter(item);
    renderLearn();
    return;
  }

  if (event.key === "Delete" || event.key === "Escape") {
    event.preventDefault();
    clearActiveUnit(item);
    renderLearn();
    return;
  }

  if (isSpellingCharacter(event.key)) {
    event.preventDefault();
    selectLetterByKeyboard(item, event.key);
  }
}

function appendLetterToActiveUnit(item: RuntimeLearningItem, letter: string) {
  const unit = getActiveFillableUnit(item);
  if (!unit || state.showAnswer || !isSpellingCharacter(letter)) return;
  const bank = getLetterBlocks(unit);
  if (isLetterBlockExhausted(letter, unit, bank)) {
    playSound("bad");
    return;
  }
  appendTextToUnit(item, unit, letter);
}

function appendTextToUnit(item: RuntimeLearningItem, unit: SpellingUnit, text: string) {
  const current = state.answers[unit.index] || "";
  if (countTypedSpellingCharacters(current) >= getSpellingCharacters(unit.answer).length) return;
  state.answers[unit.index] = current + normalizeSpellingCharacter(text);
  if (countTypedSpellingCharacters(state.answers[unit.index]) >= getSpellingCharacters(unit.answer).length) {
    const status = getUnitStatus(unit, state.answers[unit.index]);
    if (status === "wrong") markWrong(item, state.answers[unit.index]);
  }
  checkCompletion(item);
  renderLearn();
}

function selectLetterByKeyboard(item: RuntimeLearningItem, letter: string) {
  const unit = getActiveFillableUnit(item);
  if (!unit || state.showAnswer) return;
  const bank = getLetterBlocks(unit);
  const normalizedLetter = normalizeSpellingCharacter(letter).toLowerCase();
  if (!bank.some((candidate) => normalizeSpellingCharacter(candidate).toLowerCase() === normalizedLetter) || isLetterBlockExhausted(letter, unit, bank)) {
    playSound("bad");
    flashReward("当前字母块里没有可用的这个字母");
    renderLearn();
    return;
  }
  playSound("click");
  appendTextToUnit(item, unit, normalizedLetter);
}

function undoActiveLetter(item: RuntimeLearningItem) {
  const unit = getActiveFillableUnit(item);
  if (!unit || state.showAnswer) return;
  const current = state.answers[unit.index] || "";
  if (current) {
    state.answers[unit.index] = current.slice(0, -1);
    return;
  }
  const previous = getPreviousFillableUnit(item, unit.index);
  if (!previous) return;
  state.activeUnitIndex = previous.index;
  state.answers[previous.index] = (state.answers[previous.index] || "").slice(0, -1);
}

function clearActiveUnit(item: RuntimeLearningItem) {
  const unit = getActiveFillableUnit(item);
  if (!unit || state.showAnswer) return;
  state.answers[unit.index] = "";
}

function useActiveHint(item: RuntimeLearningItem) {
  const unit = getActiveFillableUnit(item);
  if (!unit || state.showAnswer) return;
  playSound("click");
  state.activeUnitIndex = unit.index;
  state.hintVisible = !state.hintVisible;
  renderLearn();
}

function moveToNextKeyboardUnit(item: RuntimeLearningItem, currentIndex: number) {
  const fillable = item.spellingUnits.filter((unit) => unit.fillable);
  const currentPosition = fillable.findIndex((unit) => unit.index === currentIndex);
  const currentUnit = fillable[currentPosition];
  if (currentUnit && state.answers[currentUnit.index] && getUnitStatus(currentUnit, state.answers[currentUnit.index]) === "wrong") {
    markWrong(item, state.answers[currentUnit.index]);
  }
  const next = fillable[currentPosition + 1];
  if (next) state.activeUnitIndex = next.index;
}

function getPreviousFillableUnit(item: RuntimeLearningItem, currentIndex: number): SpellingUnit | undefined {
  const fillable = item.spellingUnits.filter((unit) => unit.fillable);
  const currentPosition = fillable.findIndex((unit) => unit.index === currentIndex);
  return currentPosition > 0 ? fillable[currentPosition - 1] : undefined;
}

function revealAnswer(item: RuntimeLearningItem) {
  if (state.showAnswer) return;
  state.showAnswer = true;
  state.completedCurrent = true;
  for (const unit of item.spellingUnits) {
    if (unit.fillable) state.answers[unit.index] = unit.answer;
  }
  markWrong(item, "show-answer");
  playSound("bad");
  flashReward("已显示答案，并加入错题");
  renderLearn();
}

function fillChoiceWord(item: RuntimeLearningItem, word: string) {
  if (!word || state.showAnswer) return;
  playSound("click");
  const targetIndex = getChoiceTargetIndex(item);
  if (targetIndex === undefined) return;
  state.answers[targetIndex] = word;
  const unit = item.spellingUnits.find((candidate) => candidate.index === targetIndex);
  if (unit && normalizeAnswer(word) !== normalizeAnswer(unit.answer)) {
    markWrong(item, word);
    playSound("bad");
  }
  state.activeUnitIndex = getNextEmptyFillableIndex(item) ?? targetIndex;
  checkCompletion(item);
  renderLearn();
}

function checkCompletion(item: RuntimeLearningItem) {
  if (!allFillableCorrect(item) || state.completedCurrent) return;
  state.completedCurrent = true;
  state.showAnswer = true;
  completeItem(item);
}

function completeItem(item: RuntimeLearningItem) {
  state.learnedIds.add(item.id);
  const removedWrong = state.wrongIds.delete(item.id);
  recordPractice(item, true);
  saveLearningData();
  playSound("ok");
  flashReward(removedWrong ? "答对了，已移出错题" : "答对了，已记录进度");
  if (state.wrongReviewActive && !state.wrongIds.size) {
    window.setTimeout(() => {
      exitWrongReview();
    }, 600);
  }
}

function markWrong(item: RuntimeLearningItem, selected = "") {
  if (!state.wrongIds.has(item.id)) {
    state.wrongIds.add(item.id);
    recordPractice(item, false, selected);
    saveLearningData();
  }
}

function tryOpenNextItem(item: RuntimeLearningItem) {
  if (!canMoveForward(item)) {
    playSound("bad");
    flashReward("先完成本题，再进入下一题");
    renderLearn();
    return;
  }
  openNextItem();
}

function renderCurrentCourseOrList() {
  if (state.selectedPackageName) {
    void renderCourseDetail(state.selectedPackageName);
    return;
  }
  renderList();
}

function canMoveForward(item: RuntimeLearningItem): boolean {
  return state.learnedIds.has(item.id) || state.completedCurrent || state.showAnswer || allFillableCorrect(item);
}

function openNextItem() {
  if (!state.lessonItems.length) return renderCurrentCourseOrList();
  if (state.wrongReviewActive) {
    const currentId = currentItem()?.id || "";
    const wrongItems = getWrongReviewItems();
    if (!wrongItems.length) {
      exitWrongReview();
      return;
    }
    const currentIndex = wrongItems.findIndex((item) => item.id === currentId);
    state.lessonItems = wrongItems;
    state.lessonPosition = currentIndex >= 0 ? (currentIndex + 1) % wrongItems.length : 0;
    openCurrentLessonItem();
    return;
  }
  state.lessonPosition = (state.lessonPosition + 1) % state.lessonItems.length;
  openCurrentLessonItem();
}

function openPrevItem() {
  if (!state.lessonItems.length) return renderCurrentCourseOrList();
  if (state.lessonPosition <= 0) {
    flashReward("已经是第一题");
    renderLearn();
    return;
  }
  state.lessonPosition -= 1;
  openCurrentLessonItem();
}

function redoCurrentItem(item: RuntimeLearningItem) {
  playSound("click");
  state.answers = {};
  state.showAnswer = false;
  state.hintVisible = false;
  state.completedCurrent = false;
  state.activeComponentId = "";
  state.activeUnitIndex = item.spellingUnits.find((unit) => unit.fillable)?.index;
  renderLearn();
}

function resetCurrentUnitProgress() {
  if (!state.selectedUnitKey || state.wrongReviewActive) return;
  requestResetUnitProgress(state.selectedUnitKey);
}

function requestResetUnitProgress(unitKey: string) {
  const unit = state.units.find((candidate) => candidate.key === unitKey);
  if (!unit) return;
  const modalMount = appRoot.querySelector("#modalMount");
  if (!modalMount) return;
  modalMount.innerHTML = `
    <div class="modal-backdrop">
      <section class="modal reset-modal panel" role="dialog" aria-modal="true" aria-labelledby="resetUnitTitle">
        <div class="modal-head">
          <h2 id="resetUnitTitle">重置本单元进度？</h2>
          <button type="button" data-close-modal>取消</button>
        </div>
        <p>将清空“${escapeHtml(unit.unitTitle || unit.unitId || "当前单元")}”的当前题号、已学标记和错题记录。此操作无法恢复。</p>
        <div class="modal-actions">
          <button type="button" data-close-modal>取消</button>
          <button type="button" class="danger" data-confirm-reset>确认重置</button>
        </div>
      </section>
    </div>
  `;
  modalMount.querySelectorAll<HTMLElement>("[data-close-modal]").forEach((button) => button.addEventListener("click", closeModal));
  modalMount.querySelector<HTMLElement>("[data-confirm-reset]")?.addEventListener("click", () => {
    resetUnitProgress(unitKey);
    closeModal();
    if (state.selectedUnitKey === unitKey && !state.wrongReviewActive) {
      void openUnit(unitKey, 0);
    } else {
      renderCurrentCourseOrList();
    }
  });
}

function resetUnitProgress(unitKey: string) {
  const unit = state.units.find((candidate) => candidate.key === unitKey);
  if (!unit) return;
  playSound("click");
  const ids = new Set(unit.items.map((item) => item.id));
  for (const id of ids) {
    state.learnedIds.delete(id);
    state.wrongIds.delete(id);
  }
  state.progress.positions[unitKey] = 0;
  if (state.selectedUnitKey === unitKey) state.lessonPosition = 0;
  saveLearningData();
  flashReward("本单元进度已重置");
}

async function startWrongReview() {
  if (state.wrongReviewActive) return;
  playSound("click");
  await ensureWrongReviewItemsLoaded();
  const wrongItems = getWrongReviewItems();
  if (!wrongItems.length) {
    flashReward("当前没有错题");
    renderCurrentCourseOrList();
    return;
  }
  const fallbackUnitKey = state.selectedUnitKey || state.progress.selectedUnitKey;
  state.wrongReviewReturnPoint = fallbackUnitKey
    ? { unitKey: fallbackUnitKey, lessonPosition: state.lessonPosition || state.progress.positions[fallbackUnitKey] || 0 }
    : null;
  state.wrongReviewActive = true;
  state.lessonItems = wrongItems;
  state.lessonPosition = 0;
  openCurrentLessonItem();
}

function getWrongReviewItems(): RuntimeLearningItem[] {
  return Array.from(state.wrongIds)
    .map((id) => state.items.find((item) => item.id === id))
    .filter((item): item is RuntimeLearningItem => Boolean(item));
}

function exitWrongReview() {
  const returnPoint = state.wrongReviewReturnPoint;
  state.wrongReviewActive = false;
  state.wrongReviewReturnPoint = null;
  if (returnPoint && state.units.some((unit) => unit.key === returnPoint.unitKey)) {
    void openUnit(returnPoint.unitKey, returnPoint.lessonPosition);
    return;
  }
  renderCurrentCourseOrList();
}

function getChoiceTargetIndex(item: RuntimeLearningItem): number | undefined {
  const activeUnit = item.spellingUnits.find((unit) => unit.index === state.activeUnitIndex && unit.fillable);
  if (activeUnit && !state.answers[activeUnit.index]) return activeUnit.index;
  return getNextEmptyFillableIndex(item);
}

function getNextEmptyFillableIndex(item: RuntimeLearningItem): number | undefined {
  return item.spellingUnits.find((unit) => unit.fillable && !state.answers[unit.index])?.index;
}

function getActiveHint(item: RuntimeLearningItem): WordHint | undefined {
  return state.activeUnitIndex === undefined ? undefined : item.wordHints[state.activeUnitIndex];
}

function getActiveFillableUnit(item: RuntimeLearningItem): SpellingUnit | undefined {
  return item.spellingUnits.find((unit) => unit.index === state.activeUnitIndex && unit.fillable)
    || item.spellingUnits.find((unit) => unit.fillable);
}

function getUnitStatus(unit: SpellingUnit, value: string): string {
  if (!value) return "";
  if (normalizeKeyboardAnswer(value) === normalizeKeyboardAnswer(unit.answer)) return "correct";
  return countTypedSpellingCharacters(value) >= getSpellingCharacters(unit.answer).length ? "wrong" : "";
}

function allFillableCorrect(item: RuntimeLearningItem): boolean {
  const fillable = item.spellingUnits.filter((unit) => unit.fillable);
  return fillable.length > 0 && fillable.every((unit) => normalizeKeyboardAnswer(state.answers[unit.index] || "") === normalizeKeyboardAnswer(unit.answer));
}

function getChoiceBlocks(item: RuntimeLearningItem): string[] {
  const correct = item.shuffledBlocks.length ? item.shuffledBlocks : item.spellingUnits.filter((unit) => unit.fillable).map((unit) => unit.answer);
  const answerSet = new Set(correct.map(normalizeAnswer));
  const candidates = state.lessonItems
    .flatMap((candidate) => candidate.spellingUnits.filter((unit) => unit.fillable).map((unit) => unit.answer))
    .filter((word) => !answerSet.has(normalizeAnswer(word)) && /^[A-Za-z]+(?:[’'][A-Za-z]+)?$/.test(word));
  const uniqueCandidates = Array.from(new Map(candidates.map((word) => [normalizeAnswer(word), word])).values());
  const distractorCount = Math.min(Math.max(3, Math.ceil(correct.length / 2)), 6, uniqueCandidates.length);
  const distractors = deterministicPick(uniqueCandidates, distractorCount, `${item.id}:distractors`);
  return deterministicPick([...correct, ...distractors], correct.length + distractors.length, `${item.id}:blocks`);
}

function getLetterBlocks(unit: SpellingUnit): string[] {
  const answerLetters = getSpellingCharacters(unit.answer).map((character) => character.toLowerCase());
  const alphabet = "abcdefghijklmnopqrstuvwxyz".split("");
  const answerSet = new Set(answerLetters);
  const distractors = deterministicPick(alphabet.filter((letter) => !answerSet.has(letter)), Math.min(3, alphabet.length - answerSet.size), `${unit.answer}:${unit.index}:letters`);
  return deterministicPick([...answerLetters, ...distractors], answerLetters.length + distractors.length, `${unit.answer}:${unit.index}:letter-bank`);
}

function isLetterBlockExhausted(letter: string, unit: SpellingUnit, bank: string[]): boolean {
  const key = normalizeSpellingCharacter(letter).toLowerCase();
  const available = bank.filter((candidate) => normalizeSpellingCharacter(candidate).toLowerCase() === key).length;
  const used = getSpellingCharacters(state.answers[unit.index] || "").filter((candidate) => candidate.toLowerCase() === key).length;
  return available > 0 && used >= available;
}

function deterministicPick(values: string[], count: number, seedText: string): string[] {
  const result = [...values];
  let seed = Array.from(seedText || "enstudy").reduce((sum, char) => sum + char.charCodeAt(0), 0) || 1;
  for (let i = result.length - 1; i > 0; i -= 1) {
    seed = (seed * 9301 + 49297) % 233280;
    const j = seed % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result.slice(0, count);
}

function isWordBlockExhausted(word: string, item: RuntimeLearningItem): boolean {
  const total = item.spellingUnits.filter((unit) => unit.fillable && normalizeAnswer(unit.answer) === normalizeAnswer(word)).length;
  if (total === 0) return false;
  const used = Object.values(state.answers).filter((answer) => normalizeAnswer(answer) === normalizeAnswer(word)).length;
  return used >= total;
}

function currentItem(): RuntimeLearningItem | undefined {
  return state.lessonItems[state.lessonPosition] || state.items[state.selectedIndex];
}

async function loadUnitItems(unit: UnitGroup): Promise<RuntimeLearningItem[]> {
  if (unit.items.length) return unit.items;
  if (!unit.runtimeModulePath) {
    throw new Error(`单元 ${unit.unitTitle || unit.unitId} 缺少 runtimeModulePath`);
  }
  const loader = runtimeItemModules[unit.runtimeModulePath] || Object.entries(runtimeItemModules).find(([path]) => path.endsWith(unit.runtimeModulePath || ""))?.[1];
  if (!loader) {
    throw new Error(`找不到课程数据分片：${unit.runtimeModulePath}`);
  }
  const mod = (await loader()) as { default?: RuntimeLearningItem[] };
  const items = (mod.default || []) as RuntimeLearningItem[];
  unit.items = items;
  unit.itemIds = items.map((item) => item.id);
  unit.itemCount = items.length;
  unit.typeCounts = countTypes(items);
  const existingIds = new Set(state.items.map((item) => item.id));
  state.items.push(...items.filter((item) => !existingIds.has(item.id)));
  return items;
}

async function ensureWrongReviewItemsLoaded() {
  if (!state.wrongIds.size) return;
  for (const unit of state.units) {
    if (unit.items.length) continue;
    const ids = unit.itemIds || [];
    if (!ids.length || ids.some((id) => state.wrongIds.has(id))) {
      await loadUnitItems(unit);
    }
  }
}

function buildUnitGroups(items: RuntimeLearningItem[]): UnitGroup[] {
  const map = new Map<string, UnitGroup>();
  for (const item of items) {
    const key = unitKey(item);
    if (!map.has(key)) {
      map.set(key, {
        key,
        packageName: item.coursePackageName || "默认课程包",
        grade: item.grade || "",
        unitId: item.unitId || "",
        unitTitle: item.unitTitle || "未分单元",
        itemIds: [],
        items: [],
      });
    }
    const unit = map.get(key);
    unit?.items.push(item);
    unit?.itemIds?.push(item.id);
  }
  return Array.from(map.values()).sort((a, b) => `${a.packageName}-${a.unitId}-${a.unitTitle}`.localeCompare(`${b.packageName}-${b.unitId}-${b.unitTitle}`, "zh-CN"));
}

function unitKey(item: RuntimeLearningItem): string {
  return [item.coursePackageName || "默认课程包", item.grade || "", item.unitId || "", item.unitTitle || "未分单元"].join("||");
}

function countTypes(items: RuntimeLearningItem[]): Partial<Record<LearningType, number>> {
  return items.reduce<Partial<Record<LearningType, number>>>((acc, item) => {
    acc[item.type] = (acc[item.type] || 0) + 1;
    return acc;
  }, {});
}

async function checkServerReady(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/health`, { cache: "no-store" });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return false;
    const data = await response.json();
    return data?.ok === true;
  } catch {
    return false;
  }
}

async function loadUsers() {
  if (state.serverReady) {
    try {
      const response = await fetch(`${API_BASE}/users`, { cache: "no-store" });
      if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new Error("users api unavailable");
      const data = await response.json();
      state.users = data.users || [];
      return;
    } catch {
      state.serverReady = false;
    }
  }
  state.users = loadLocalUsers();
}

async function restoreActiveUser() {
  const active = loadUserSession();
  if (active) await selectUser(active.id, false);
  if (!state.user && !state.serverReady) {
    const localUsers = loadLocalUsers();
    if (localUsers[0]) await selectUser(localUsers[0].id, false);
  }
}

async function selectUser(userId: string, rerender = true) {
  if (state.serverReady) {
    const response = await fetch(`${API_BASE}/users/${encodeURIComponent(userId)}/progress`, { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    state.user = data.user;
  } else {
    const user = loadLocalUsers().find((candidate) => candidate.id === userId);
    if (!user) return;
    state.user = { ...user };
  }
  if (!state.user) return;
  localStorage.setItem(ACTIVE_USER_KEY, JSON.stringify({ id: state.user.id, name: state.user.name }));
  loadLearningDataForUser();
  if (rerender) renderList();
}

async function createUser(name: string) {
  const cleanName = name.trim().slice(0, 20);
  if (!cleanName) return;
  if (state.serverReady) {
    const response = await fetch(`${API_BASE}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: cleanName }),
    });
    if (!response.ok) return;
    const data = await response.json();
    await loadUsers();
    await selectUser(data.user.id);
    return;
  }
  const users = loadLocalUsers();
  const user = { id: `${encodeURIComponent(cleanName)}-${Date.now().toString(36)}`, name: cleanName, createdAt: new Date().toISOString() };
  users.push(user);
  localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
  await loadUsers();
  await selectUser(user.id);
}

function openSettingsModal() {
  const modalMount = appRoot.querySelector("#modalMount");
  if (!modalMount) return;
  const s = ttsSettings;
  modalMount.innerHTML = `
    <div class="modal-backdrop">
      <section class="modal settings-modal panel">
        <div class="modal-head">
          <h2>语音设置</h2>
          <button type="button" data-close-modal>关闭</button>
        </div>
        <div class="settings-body">
          <div class="settings-section">
            <h3>TTS 服务</h3>
            <div class="settings-row">
              <label class="radio-label">
                <input type="radio" name="tts-service" value="edge" ${s.service === "edge" ? "checked" : ""} />
                <span>Edge TTS (高质量)</span>
              </label>
              <label class="radio-label">
                <input type="radio" name="tts-service" value="browser" ${s.service === "browser" ? "checked" : ""} />
                <span>浏览器 TTS (离线可用)</span>
              </label>
            </div>
          </div>

          <div class="settings-section" data-settings-for="edge">
            <h3>Edge TTS 设置</h3>
            <div class="settings-grid">
              <div class="settings-item">
                <label for="settings-edge-voice">语音选择</label>
                <select id="settings-edge-voice">
                  ${EDGE_ENGLISH_VOICES.map((v) => `<option value="${escapeAttr(v.value)}" ${s.edgeVoice === v.value ? "selected" : ""}>${escapeHtml(v.label)}</option>`).join("")}
                </select>
              </div>
              <div class="settings-item">
                <label for="settings-edge-speed">语速</label>
                <select id="settings-edge-speed">
                  ${SPEED_OPTIONS.map((opt) => `<option value="${opt.value}" ${s.edgeSpeed === opt.value ? "selected" : ""}>${escapeHtml(opt.label)}</option>`).join("")}
                </select>
              </div>
              <div class="settings-item">
                <label for="settings-edge-pitch">音调</label>
                <select id="settings-edge-pitch">
                  ${PITCH_OPTIONS.map((opt) => `<option value="${opt.value}" ${s.edgePitch === opt.value ? "selected" : ""}>${escapeHtml(opt.label)}</option>`).join("")}
                </select>
              </div>
              <div class="settings-item">
                <label for="settings-edge-style">语音风格</label>
                <select id="settings-edge-style">
                  ${EDGE_STYLES.map((opt) => `<option value="${escapeAttr(opt.value)}" ${s.edgeStyle === opt.value ? "selected" : ""}>${escapeHtml(opt.label)}</option>`).join("")}
                </select>
              </div>
            </div>
          </div>

          <div class="settings-section" data-settings-for="browser" style="${s.service === "edge" ? "display:none" : ""}">
            <h3>浏览器 TTS 设置</h3>
            <div class="settings-grid">
              <div class="settings-item">
                <label for="settings-browser-rate">语速</label>
                <input type="range" id="settings-browser-rate" min="0.5" max="2" step="0.1" value="${s.browserRate}" />
                <span class="range-value">${s.browserRate.toFixed(1)}</span>
              </div>
              <div class="settings-item">
                <label for="settings-browser-pitch">音调</label>
                <input type="range" id="settings-browser-pitch" min="0" max="2" step="0.1" value="${s.browserPitch}" />
                <span class="range-value">${s.browserPitch.toFixed(1)}</span>
              </div>
            </div>
          </div>

          <div class="settings-section">
            <h3>播放行为</h3>
            <div class="settings-grid">
              <div class="settings-item">
                <label class="checkbox-label">
                  <input type="checkbox" id="settings-autoplay" ${s.autoPlay ? "checked" : ""} />
                  <span>进入题目自动播放语音</span>
                </label>
              </div>
              <div class="settings-item">
                <label for="settings-play-count">播放次数</label>
                <select id="settings-play-count">
                  <option value="1" ${s.playCount === 1 ? "selected" : ""}>1 次</option>
                  <option value="2" ${s.playCount === 2 ? "selected" : ""}>2 次</option>
                  <option value="3" ${s.playCount === 3 ? "selected" : ""}>3 次</option>
                </select>
              </div>
              <div class="settings-item">
                <label for="settings-play-interval">重复间隔</label>
                <select id="settings-play-interval">
                  <option value="500" ${s.playInterval === 500 ? "selected" : ""}>0.5 秒</option>
                  <option value="800" ${s.playInterval === 800 ? "selected" : ""}>0.8 秒</option>
                  <option value="1200" ${s.playInterval === 1200 ? "selected" : ""}>1.2 秒</option>
                  <option value="2000" ${s.playInterval === 2000 ? "selected" : ""}>2 秒</option>
                </select>
              </div>
            </div>
          </div>

          <div class="settings-actions">
            <button type="button" class="settings-test-btn" data-action="test-speech">试听当前设置</button>
          </div>
        </div>
      </section>
    </div>
  `;

  modalMount.querySelector("[data-close-modal]")?.addEventListener("click", closeModal);

  modalMount.querySelectorAll<HTMLInputElement>('input[name="tts-service"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      const service = radio.value as "edge" | "browser";
      ttsSettings.service = service;
      saveTtsSettings();
      const edgeSection = modalMount.querySelector('[data-settings-for="edge"]');
      const browserSection = modalMount.querySelector('[data-settings-for="browser"]');
      if (edgeSection) (edgeSection as HTMLElement).style.display = service === "edge" ? "" : "none";
      if (browserSection) (browserSection as HTMLElement).style.display = service === "browser" ? "" : "none";
    });
  });

  const edgeVoice = modalMount.querySelector<HTMLSelectElement>("#settings-edge-voice");
  edgeVoice?.addEventListener("change", () => {
    ttsSettings.edgeVoice = edgeVoice.value;
    saveTtsSettings();
  });

  const edgeSpeed = modalMount.querySelector<HTMLSelectElement>("#settings-edge-speed");
  edgeSpeed?.addEventListener("change", () => {
    ttsSettings.edgeSpeed = parseFloat(edgeSpeed.value);
    saveTtsSettings();
  });

  const edgePitch = modalMount.querySelector<HTMLSelectElement>("#settings-edge-pitch");
  edgePitch?.addEventListener("change", () => {
    ttsSettings.edgePitch = parseInt(edgePitch.value, 10);
    saveTtsSettings();
  });

  const edgeStyle = modalMount.querySelector<HTMLSelectElement>("#settings-edge-style");
  edgeStyle?.addEventListener("change", () => {
    ttsSettings.edgeStyle = edgeStyle.value;
    saveTtsSettings();
  });

  const browserRate = modalMount.querySelector<HTMLInputElement>("#settings-browser-rate");
  browserRate?.addEventListener("input", () => {
    ttsSettings.browserRate = parseFloat(browserRate.value);
    saveTtsSettings();
    const valSpan = browserRate.parentElement?.querySelector(".range-value");
    if (valSpan) valSpan.textContent = ttsSettings.browserRate.toFixed(1);
  });

  const browserPitch = modalMount.querySelector<HTMLInputElement>("#settings-browser-pitch");
  browserPitch?.addEventListener("input", () => {
    ttsSettings.browserPitch = parseFloat(browserPitch.value);
    saveTtsSettings();
    const valSpan = browserPitch.parentElement?.querySelector(".range-value");
    if (valSpan) valSpan.textContent = ttsSettings.browserPitch.toFixed(1);
  });

  const autoPlay = modalMount.querySelector<HTMLInputElement>("#settings-autoplay");
  autoPlay?.addEventListener("change", () => {
    ttsSettings.autoPlay = autoPlay.checked;
    saveTtsSettings();
  });

  const playCount = modalMount.querySelector<HTMLSelectElement>("#settings-play-count");
  playCount?.addEventListener("change", () => {
    ttsSettings.playCount = parseInt(playCount.value, 10);
    saveTtsSettings();
  });

  const playInterval = modalMount.querySelector<HTMLSelectElement>("#settings-play-interval");
  playInterval?.addEventListener("change", () => {
    ttsSettings.playInterval = parseInt(playInterval.value, 10);
    saveTtsSettings();
  });

  modalMount.querySelector<HTMLElement>('[data-action="test-speech"]')?.addEventListener("click", () => {
    speak("Hello, this is a test of the text-to-speech system.", { restart: true });
  });
}

function openUserModal() {
  const modalMount = appRoot.querySelector("#modalMount");
  if (!modalMount) return;
  modalMount.innerHTML = `
    <div class="modal-backdrop">
      <section class="modal user-modal panel">
        <div class="modal-head">
          <h2>选择学习者</h2>
          <button type="button" data-close-modal>关闭</button>
        </div>
        <p class="muted">${state.serverReady ? "使用旧版单词学习同一批用户，记录会保存到 storage/users。" : "当前没有连接 Node 服务端，先使用浏览器本地用户记录。"}</p>
        <div class="user-create-row">
          <input id="newUserName" placeholder="输入学习者名字" maxlength="20" />
          <button class="primary" type="button" data-create-user>新建</button>
        </div>
        <div class="user-list">
          ${state.users.length ? state.users.map((user) => `
            <button class="user-choice ${state.user?.id === user.id ? "active" : ""}" type="button" data-select-user="${escapeAttr(user.id)}">
              <strong>${escapeHtml(user.name)}</strong>
              <span>${escapeHtml(user.updatedAt || user.createdAt || "")}</span>
            </button>
          `).join("") : `<div class="empty muted">还没有学习者。</div>`}
        </div>
      </section>
    </div>
  `;
  modalMount.querySelector("[data-close-modal]")?.addEventListener("click", closeModal);
  modalMount.querySelector("[data-create-user]")?.addEventListener("click", () => {
    const input = modalMount.querySelector<HTMLInputElement>("#newUserName");
    createUser(input?.value || "").then(closeModal);
  });
  modalMount.querySelectorAll<HTMLButtonElement>("[data-select-user]").forEach((button) => {
    button.addEventListener("click", () => selectUser(button.dataset.selectUser || "").then(closeModal));
  });
}

function closeModal() {
  const modalMount = appRoot.querySelector("#modalMount");
  if (modalMount) modalMount.innerHTML = "";
}

function loadLearningDataForUser() {
  const source = state.serverReady ? state.user : loadLocalData()[state.user?.id || ""];
  const progress = source?.progress?.[PROGRESS_KEY] as SavedProgress | undefined;
  state.progress = progress || { selectedUnitKey: "", positions: {}, updatedAt: new Date().toISOString() };
  state.learnedIds = new Set(source?.learned?.[SCOPE_KEY] || []);
  state.wrongIds = new Set(source?.wrong?.[SCOPE_KEY] || []);
  state.dailyLog = source?.daily?.[SCOPE_KEY] || {};
}

function saveCurrentProgress() {
  if (state.wrongReviewActive || !state.selectedUnitKey) return;
  state.progress.selectedUnitKey = state.selectedUnitKey;
  state.progress.positions[state.selectedUnitKey] = state.lessonPosition;
  state.progress.updatedAt = new Date().toISOString();
  saveLearningData();
}

function saveLearningData() {
  if (!state.user) return;
  if (!state.serverReady) {
    const data = loadLocalData();
    data[state.user.id] = {
      progress: { [PROGRESS_KEY]: state.progress },
      learned: { [SCOPE_KEY]: Array.from(state.learnedIds) },
      wrong: { [SCOPE_KEY]: Array.from(state.wrongIds) },
      daily: { [SCOPE_KEY]: state.dailyLog },
    };
    localStorage.setItem(LOCAL_DATA_KEY, JSON.stringify(data));
    return;
  }
  fetch(`${API_BASE}/users/${encodeURIComponent(state.user.id)}/progress`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      progress: { [PROGRESS_KEY]: state.progress },
      learned: { [SCOPE_KEY]: Array.from(state.learnedIds) },
      wrong: { [SCOPE_KEY]: Array.from(state.wrongIds) },
      daily: { [SCOPE_KEY]: state.dailyLog },
    }),
  }).catch(() => {});
}

function recordViewed(item: RuntimeLearningItem) {
  const day = todayBucket();
  if (!day.viewed.includes(item.id)) day.viewed.push(item.id);
  saveLearningData();
}

function recordPractice(item: RuntimeLearningItem, correct: boolean, selected = "") {
  const day = todayBucket();
  const bucket = correct ? day.correct : day.wrong;
  if (!bucket.includes(item.id)) bucket.push(item.id);
  const record: PracticeRecord = {
    itemId: item.id,
    contentId: item.contentId,
    english: item.fullEnglish,
    type: item.type,
    mode: state.sentenceInputMode,
    correct,
    selected,
    answer: item.fullEnglish,
    createdAt: new Date().toISOString(),
  };
  day.records.push(record);
  day.records = day.records.slice(-500);
  saveLearningData();
  if (state.serverReady && state.user) {
    fetch(`${API_BASE}/users/${encodeURIComponent(state.user.id)}/practice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile: "junior",
        category: state.selectedUnitKey,
        mode: MODE,
        wordId: item.id,
        word: item.fullEnglish,
        selected,
        answer: item.fullEnglish,
        correct,
      }),
    }).catch(() => {});
  }
}

function todayBucket() {
  const date = new Date().toISOString().slice(0, 10);
  state.dailyLog[date] ||= { viewed: [], correct: [], wrong: [], records: [] };
  return state.dailyLog[date];
}

function loadUserSession(): UserSummary | null {
  try {
    return JSON.parse(localStorage.getItem(ACTIVE_USER_KEY) || "null");
  } catch {
    return null;
  }
}

function loadLocalUsers(): UserSummary[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_USERS_KEY) || "[]");
  } catch {
    return [];
  }
}

function loadLocalData(): Record<string, Partial<UserRecord>> {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_DATA_KEY) || "{}");
  } catch {
    return {};
  }
}

function flashReward(text: string) {
  state.rewardText = text;
  window.setTimeout(() => {
    state.rewardText = "";
    const reward = appRoot.querySelector(".reward-pop");
    if (reward) reward.remove();
  }, 1200);
}

function playSound(kind: keyof typeof SOUND_URLS) {
  try {
    soundPool[kind] ||= new Audio(SOUND_URLS[kind]);
    const audio = soundPool[kind];
    if (!audio) return;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  } catch {
    // ignore browser autoplay restrictions
  }
}

function loadTtsSettings(): TtsSettings {
  try {
    const raw = localStorage.getItem(TTS_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_TTS_SETTINGS, ...parsed };
    }
  } catch {
    // fall through
  }
  return { ...DEFAULT_TTS_SETTINGS };
}

function saveTtsSettings() {
  localStorage.setItem(TTS_SETTINGS_KEY, JSON.stringify(ttsSettings));
}

function checkEdgeTtsAvailable(): Promise<boolean> {
  const cached = localStorage.getItem(TTS_SERVICE_KEY);
  if (cached === "unavailable") return Promise.resolve(false);
  if (cached === "available") return Promise.resolve(true);
  return fetch(`${API_BASE}/tts/edge`, { method: "OPTIONS" })
    .then(() => {
      localStorage.setItem(TTS_SERVICE_KEY, "available");
      return true;
    })
    .catch(() => {
      localStorage.setItem(TTS_SERVICE_KEY, "unavailable");
      return false;
    });
}

function speak(text: string, options: { restart?: boolean } = {}) {
  if (!text) return;
  if (state.isSpeaking && !options.restart) return;

  const runId = ++speechRunId;
  ttsFallbackStarted = false;
  stopCurrentSpeech();
  setSpeakingState(true);

  const totalPlays = Math.max(1, ttsSettings.playCount);
  const interval = Math.max(200, ttsSettings.playInterval);

  const playOnce = (attempt: number) => {
    if (speechRunId !== runId) return;
    void playTtsOnce(text, runId).then(() => {
      if (speechRunId !== runId) return;
      if (attempt < totalPlays) {
        window.setTimeout(() => playOnce(attempt + 1), interval);
      } else {
        setSpeakingState(false);
      }
    }).catch(() => {
      if (speechRunId === runId) setSpeakingState(false);
    });
  };
  playOnce(1);
}

function playTtsOnce(text: string, runId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ttsSettings.service === "browser") {
      playBrowserTts(text, runId, resolve, reject);
      return;
    }
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      if (ok) resolve();
      else reject();
    };
    playEdgeTtsAudio(text, runId, () => done(true), () => {
      if (!ttsFallbackStarted) {
        ttsFallbackStarted = true;
        playBrowserTts(text, runId, () => done(true), () => done(false));
      }
    });
  });
}

function playEdgeTtsAudio(text: string, runId: number, onEnded: () => void, onError: () => void) {
  fetch(`${API_BASE}/tts/edge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: text,
      voice: ttsSettings.edgeVoice,
      speed: ttsSettings.edgeSpeed,
      pitch: ttsSettings.edgePitch,
      volume: 0,
      style: ttsSettings.edgeStyle,
    }),
  }).then((response) => {
    if (!response.ok) throw new Error("edge_tts_failed");
    return response.blob();
  }).then((blob) => {
    if (speechRunId !== runId) return;
    const objectUrl = URL.createObjectURL(blob);
    currentSpeechObjectUrl = objectUrl;
    const audio = new Audio(objectUrl);
    currentSpeechAudio = audio;
    audio.onended = () => {
      if (speechRunId === runId) {
        cleanupCurrentSpeechAudio();
        onEnded();
      }
    };
    audio.onerror = () => {
      cleanupCurrentSpeechAudio();
      if (speechRunId === runId) onError();
    };
    audio.play().catch(() => {
      if (speechRunId === runId) onError();
    });
  }).catch(() => {
    if (speechRunId === runId) onError();
  });
}

function playBrowserTts(text: string, runId: number, onEnded: () => void, onError: () => void) {
  cleanupCurrentSpeechAudio();
  if (!("speechSynthesis" in window)) {
    if (speechRunId === runId) onError();
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = ttsSettings.browserRate;
  utterance.pitch = ttsSettings.browserPitch;
  utterance.onend = () => {
    if (speechRunId === runId) onEnded();
  };
  utterance.onerror = () => {
    if (speechRunId === runId) onError();
  };
  getPreferredSpeechVoice().then((voice) => {
    if (speechRunId !== runId) return;
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang || utterance.lang;
    }
    window.speechSynthesis.speak(utterance);
  }).catch(() => {
    if (speechRunId !== runId) return;
    window.speechSynthesis.speak(utterance);
  });
}

function stopCurrentSpeech() {
  cleanupCurrentSpeechAudio();
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

function cleanupCurrentSpeechAudio() {
  if (currentSpeechAudio) {
    currentSpeechAudio.pause();
    currentSpeechAudio.src = "";
    currentSpeechAudio = null;
  }
  if (currentSpeechObjectUrl) {
    URL.revokeObjectURL(currentSpeechObjectUrl);
    currentSpeechObjectUrl = "";
  }
}

function setSpeakingState(isSpeaking: boolean) {
  state.isSpeaking = isSpeaking;
  appRoot.querySelectorAll<HTMLButtonElement>('[data-action="speak"]').forEach((button) => {
    button.disabled = isSpeaking;
    button.classList.toggle("speaking", isSpeaking);
    const label = button.querySelector<HTMLSpanElement>("span:last-child");
    if (!label) return;
    label.textContent = isSpeaking ? "播放中" : button.closest(".completion-head") ? "重新播放" : "播放";
  });
}

async function getPreferredSpeechVoice(): Promise<SpeechSynthesisVoice | undefined> {
  const voices = await loadSpeechVoices();
  const englishVoices = voices.filter((voice) => /^en[-_]/i.test(voice.lang || ""));
  return englishVoices.find((voice) => /microsoft|edge|aria|jenny|guy/i.test(`${voice.name} ${voice.voiceURI}`))
    || englishVoices.find((voice) => /en[-_]US/i.test(voice.lang || ""))
    || englishVoices[0];
}

function loadSpeechVoices(): Promise<SpeechSynthesisVoice[]> {
  if (speechVoicesPromise) return speechVoicesPromise;
  speechVoicesPromise = new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const existing = synth.getVoices();
    if (existing.length) {
      resolve(existing);
      return;
    }
    const timeout = window.setTimeout(() => {
      synth.removeEventListener("voiceschanged", handleVoicesChanged);
      resolve(synth.getVoices());
    }, 800);
    function handleVoicesChanged() {
      window.clearTimeout(timeout);
      synth.removeEventListener("voiceschanged", handleVoicesChanged);
      resolve(synth.getVoices());
    }
    synth.addEventListener("voiceschanged", handleVoicesChanged);
  });
  return speechVoicesPromise;
}

function unique(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)))).sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function typeLabel(type: LearningType): string {
  const labels: Record<LearningType, string> = {
    word: "单词",
    phrase: "短语",
    sentence: "句子",
    abbreviation: "缩写",
    unknown: "未知",
  };
  return labels[type] || type;
}

function shouldUseSentenceView(item: RuntimeLearningItem): boolean {
  if (item.type === "sentence") return true;
  if (item.type !== "phrase") return false;
  const english = item.fullEnglish.trim();
  if (item.componentTree.length) return true;
  if (/[.!?]$/.test(english)) return true;
  return looksLikeSentence(english);
}

function looksLikeSentence(value: string): boolean {
  const words = value.match(/[A-Za-z]+(?:[’'][A-Za-z]+)?/g) || [];
  if (words.length < 2) return false;
  const normalized = words.map((word) => normalizeAnswer(word));
  const first = normalized[0] || "";
  if (FRONTEND_SUBJECT_CONTRACTIONS.has(first)) return words.length >= 2;
  if (FRONTEND_IMPERATIVE_VERBS.has(first)) return true;
  if (FRONTEND_QUESTION_WORDS.has(first) && words.length >= 3) return true;
  if (FRONTEND_AUXILIARIES.has(first) && isFrontendSubject(normalized[1] || "") && words.length >= 3) return true;
  const verbIndex = findFrontendSubjectVerb(normalized);
  return verbIndex >= 1 && verbIndex < normalized.length - 1;
}

const FRONTEND_SUBJECT_CONTRACTIONS = new Set(["i'm", "you're", "he's", "she's", "it's", "we're", "they're", "that's", "there's", "let's"]);
const FRONTEND_QUESTION_WORDS = new Set(["what", "where", "when", "who", "whose", "which", "why", "how"]);
const FRONTEND_AUXILIARIES = new Set(["am", "is", "are", "was", "were", "be", "been", "being", "do", "does", "did", "can", "could", "will", "would", "shall", "should", "may", "might", "must", "have", "has", "had"]);
const FRONTEND_IMPERATIVE_VERBS = new Set(["buy", "bring", "build", "call", "come", "cut", "dance", "decide", "design", "drink", "drive", "eat", "enjoy", "feel", "find", "finish", "fly", "get", "give", "go", "grow", "have", "hear", "help", "hold", "keep", "know", "learn", "leave", "like", "live", "look", "love", "make", "meet", "need", "open", "paint", "pay", "play", "practice", "prepare", "put", "read", "remember", "return", "run", "say", "see", "sell", "send", "show", "sing", "sit", "sleep", "speak", "spell", "spend", "stand", "start", "stay", "stop", "study", "take", "teach", "tell", "think", "throw", "try", "use", "visit", "wait", "walk", "want", "wash", "watch", "wear", "win", "work", "write"]);

function isFrontendSubject(value: string): boolean {
  return /^(?:i|you|he|she|it|we|they|there|this|that|these|those|someone|somebody|everyone|everybody|nobody|my|your|his|her|its|our|their|a|an|the|[a-z]+)$/i.test(value);
}

function isFrontendFiniteVerb(value: string): boolean {
  if (!value) return false;
  if (FRONTEND_AUXILIARIES.has(value) || FRONTEND_IMPERATIVE_VERBS.has(value)) return true;
  return /(?:s|es|ed)$/.test(value) && !/(?:ss|us|is)$/.test(value);
}

function findFrontendSubjectVerb(words: string[]): number {
  const first = words[0] || "";
  const start = /^(?:my|your|his|her|its|our|their|a|an|the)$/.test(first) ? 2 : 1;
  for (let index = start; index < Math.min(words.length, 13); index += 1) {
    if (isFrontendFiniteVerb(words[index])) return index;
  }
  return -1;
}

function loadPreferredSentenceMode(): SentenceInputMode {
  return localStorage.getItem(SENTENCE_MODE_KEY) === "keyboard" ? "keyboard" : "choice";
}

function savePreferredSentenceMode(mode: SentenceInputMode) {
  localStorage.setItem(SENTENCE_MODE_KEY, mode);
}

function normalizeKeyboardAnswer(value: string): string {
  return normalizeAnswer(value).replace(/[^a-z']/g, "");
}

function countTypedLetters(value: string): number {
  return (value.match(/[A-Za-z]/g) || []).length;
}

function countTypedSpellingCharacters(value: string): number {
  return getSpellingCharacters(value).length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
