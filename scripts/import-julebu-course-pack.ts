import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildLearningRuntimeItem, buildLexicon, tokenizeEnglish } from "../src/lib/learning";
import type { Lexicon, RawLearningItem, SentenceAnalysisRaw, SentenceComponent } from "../src/lib/types";

const API_BASE = "https://api.julebu.co/trpc";
const WEB_BASE = "https://julebu.co";
const SIGNATURE_CHUNK_URL = `${WEB_BASE}/_nuxt/u96USuLK.js`;
const DEFAULT_PACK_ID = "fqg57vkritz89iaeb1ofbfne";
const OUTPUT_DIR = resolve("data");
const ONLINE_COURSE_DIR = "course-packs";
const GENERATED_SOURCE = "online-course";
const COURSE_REQUEST_DELAY_MS = Number(process.env.ONLINE_COURSE_REQUEST_DELAY_MS || 600);
const RATE_LIMIT_RETRY_DELAYS_MS = [15_000, 30_000, 60_000];
const coursePackId = process.argv[2] || DEFAULT_PACK_ID;
const mode = process.argv[3] || "chinese_to_english";

type JsonRecord = Record<string, unknown>;

interface CourseSummary {
  id: string;
  title?: string;
  topic?: string;
  subtitle?: string;
  description?: string;
  order?: number;
  type?: string;
}

interface ImportLog {
  level: "info" | "warning" | "error";
  message: string;
  contentId?: string;
  courseId?: string;
}

interface CourseImportResult {
  summary: CourseSummary;
  order: number;
  detail: JsonRecord;
  rawItems: RawLearningItem[];
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
  itemIds?: string[];
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
  coursePackId?: string;
  mode?: string;
  coursePacks: Array<Record<string, unknown>>;
  units: LearningManifestUnit[];
}

interface SignatureProvider {
  sign(path: string): Promise<string | undefined>;
}

const logs: ImportLog[] = [];

async function main() {
  const authHeaders = await loadAuthHeaders();
  if (!Object.keys(authHeaders).length) {
    throw new Error(
      [
        "缺少 Julebu 登录授权。",
        "请设置 JULEBU_COOKIE、JULEBU_COOKIE_FILE 或 JULEBU_AUTHORIZATION 后重新运行。",
        "示例：JULEBU_COOKIE_FILE=/path/to/julebu-cookie.txt npm run import:julebu",
      ].join("\n"),
    );
  }

  const signatureProvider = await createSignatureProvider();
  const pack = await loadCoursePack(coursePackId, authHeaders, signatureProvider);
  const courses = getCourses(pack);
  if (!courses.length) {
    throw new Error("课程包中没有找到 courses 列表，无法导入。");
  }

  log("info", `课程包 ${stringField(pack, "title") || coursePackId}，课程 ${courses.length} 个`);

  const rawItems: RawLearningItem[] = [];
  const importedCourses: CourseImportResult[] = [];

  for (const [index, course] of courses.entries()) {
    const id = course.id;
    if (!id) continue;
    log("info", `抓取课程 ${index + 1}/${courses.length}: ${course.title || id}`, { courseId: id });
    const detail = await loadCourseDetail(id, authHeaders, signatureProvider);
    const courseRawItems = buildRawItemsFromCourse(pack, course, detail, index + 1);
    importedCourses.push({ summary: course, order: index + 1, detail, rawItems: courseRawItems });
    rawItems.push(...courseRawItems);
    if (COURSE_REQUEST_DELAY_MS > 0) await sleep(COURSE_REQUEST_DELAY_MS);
  }

  const deduped = dedupeRawItems(rawItems);
  const lexicon = buildLexicon(deduped);

  await mkdir(OUTPUT_DIR, { recursive: true });
  const packDir = join(OUTPUT_DIR, ONLINE_COURSE_DIR, safePathSegment(coursePackId));
  await mkdir(packDir, { recursive: true });
  await writeJson(join(packDir, "course-pack.json"), {
    importedAt: new Date().toISOString(),
    coursePackId,
    mode,
    title: stringField(pack, "title"),
    description: stringField(pack, "description"),
    courseCount: importedCourses.length,
    courses: importedCourses.map(({ summary, order }) => ({ ...summary, order: summary.order ?? order })),
  });
  await writeJson(join(packDir, "lexicon.json"), lexicon);

  const manifestUnits: LearningManifestUnit[] = [];
  for (const course of importedCourses) {
    const unitItems = deduped.filter((item) => item.unitId === course.summary.id);
    const runtimeItems = unitItems.map((item) => buildLearningRuntimeItem(item, lexicon));
    const courseSlug = `${String(course.order).padStart(2, "0")}-${safePathSegment(course.summary.title || course.summary.id)}`;
    const courseDir = join(packDir, "courses", courseSlug);
    await mkdir(courseDir, { recursive: true });
    await writeJson(join(courseDir, "source.json"), course.detail);
    await writeJson(join(courseDir, "raw-items.json"), unitItems);
    await writeJson(join(courseDir, "runtime-items.json"), runtimeItems);
    manifestUnits.push(buildManifestUnit(course, runtimeItems, courseSlug));
  }

  const currentPackManifest = {
    id: coursePackId,
    title: stringField(pack, "title") || coursePackId,
    courseCount: importedCourses.length,
    lexiconFile: `data/${ONLINE_COURSE_DIR}/${safePathSegment(coursePackId)}/lexicon.json`,
    source: GENERATED_SOURCE,
  };
  const manifest = await mergeLearningManifest({
    version: 1,
    generatedAt: new Date().toISOString(),
    source: GENERATED_SOURCE,
    coursePackId,
    mode,
    coursePacks: [currentPackManifest],
    units: manifestUnits,
  });
  await writeJson(join(OUTPUT_DIR, "learning-manifest.json"), manifest);

  printSummary(deduped, lexicon, manifestUnits);
}

async function loadAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const cookie = (process.env.JULEBU_COOKIE || (await readOptionalText(process.env.JULEBU_COOKIE_FILE))).trim();
  const authorization = (process.env.JULEBU_AUTHORIZATION || (await readOptionalText(process.env.JULEBU_AUTHORIZATION_FILE))).trim();

  if (cookie) headers.cookie = cookie.replace(/^cookie:\s*/i, "").trim();
  if (authorization) headers.authorization = authorization.replace(/^authorization:\s*/i, "").trim();
  return headers;
}

async function readOptionalText(path: string | undefined): Promise<string> {
  if (!path) return "";
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`读取授权文件失败: ${path}: ${(error as Error).message}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function createSignatureProvider(): Promise<SignatureProvider> {
  let signatureCode = "";
  return {
    async sign(path: string) {
      if (!path.startsWith("courses.") && !path.startsWith("pk.")) return undefined;
      signatureCode ||= await fetchSignatureCode();
      const signature = await runSignatureModule(signatureCode);
      if (!signature) {
        throw new Error("Julebu x-signature 生成失败，课程接口会返回“页面版本过旧”。");
      }
      return signature;
    },
  };
}

async function loadCoursePack(id: string, authHeaders: Record<string, string>, signatureProvider: SignatureProvider): Promise<JsonRecord> {
  try {
    return await trpcQuery<JsonRecord>("userCoursePacks.findOne", id, authHeaders, signatureProvider);
  } catch (error) {
    const message = (error as Error).message;
    if (!message.includes("NOT_FOUND") && !message.includes("未找到")) throw error;
    log("warning", `我的课程中未找到 ${id}，改用商城详情接口读取课程包。`);
    return trpcQuery<JsonRecord>("mall.getCoursePackDetail", { coursePackId: id }, authHeaders, signatureProvider);
  }
}

async function loadCourseDetail(
  courseId: string,
  authHeaders: Record<string, string>,
  signatureProvider: SignatureProvider,
): Promise<JsonRecord> {
  const input = { coursePackId, courseId, mode };
  try {
    return await trpcQuery<JsonRecord>("courses.findOne", input, authHeaders, signatureProvider);
  } catch (error) {
    const message = (error as Error).message;
    if (!message.includes("PLEASE_ACQUIRE_COURSE_PACK_FIRST")) throw error;
    log("warning", `课程包 ${coursePackId} 尚未加入我的课程，先自动获取后重试。`, { courseId });
    await trpcMutation<JsonRecord>("userCoursePacks.create", { coursePackId, source: "official" }, authHeaders, signatureProvider);
    return trpcQuery<JsonRecord>("courses.findOne", input, authHeaders, signatureProvider);
  }
}

async function fetchSignatureCode(): Promise<string> {
  const response = await fetch(SIGNATURE_CHUNK_URL, {
    headers: {
      accept: "application/javascript,text/javascript,*/*",
      referer: `${WEB_BASE}/`,
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36",
    },
  });
  if (!response.ok) {
    throw new Error(`下载 Julebu 签名模块失败: HTTP ${response.status}`);
  }
  return response.text();
}

async function runSignatureModule(code: string): Promise<string> {
  const originalConsole = { ...console };
  const originalSetInterval = globalThis.setInterval as unknown as (...args: unknown[]) => unknown;
  const intervalIds: unknown[] = [];
  const fakeCanvas = {
    getContext: () => ({
      textBaseline: "",
      font: "",
      fillStyle: "",
      fillRect() {},
      fillText() {},
      toString() {
        return "[object CanvasRenderingContext2D]";
      },
    }),
    toDataURL: () => "data:image/png;base64,julebu",
  };

  Object.assign(globalThis, {
    window: globalThis,
    document: {
      createElement: (tag: string) => (tag === "canvas" ? fakeCanvas : {}),
      documentElement: {},
    },
    location: {
      protocol: "https:",
      host: "julebu.co",
      hostname: "julebu.co",
      href: `${WEB_BASE}/`,
      origin: WEB_BASE,
    },
    screen: { width: 1440, height: 900, colorDepth: 24 },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      webdriver: false,
      languages: ["zh-CN", "zh"],
      language: "zh-CN",
      platform: "MacIntel",
      plugins: [1, 2, 3],
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36",
    },
  });
  globalThis.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const id = originalSetInterval(handler, timeout, ...args);
    intervalIds.push(id);
    return id;
  }) as typeof setInterval;

  try {
    const executableCode = code.replace(/\/\/# sourceMappingURL=.*$/m, "");
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(executableCode).toString("base64")}#${Date.now()}-${Math.random()}`;
    const mod = (await import(moduleUrl)) as { _$?: () => string | Promise<string> };
    return String((await mod._$?.()) || "");
  } finally {
    for (const id of intervalIds) clearInterval(id as ReturnType<typeof setInterval>);
    globalThis.setInterval = originalSetInterval as typeof setInterval;
    Object.assign(console, originalConsole);
  }
}

async function trpcQuery<T>(path: string, input: unknown, authHeaders: Record<string, string>, signatureProvider: SignatureProvider): Promise<T> {
  const url = `${API_BASE}/${path}?batch=1&input=${encodeURIComponent(JSON.stringify({ 0: { json: input } }))}`;
  const signature = await signatureProvider.sign(path);
  const { response, text } = await fetchTrpcWithRateLimitRetry(path, url, {
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      origin: WEB_BASE,
      referer: `${WEB_BASE}/my-course-packs/${coursePackId}?tab=courses`,
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36",
      ...(signature ? { "x-signature": signature } : {}),
      ...authHeaders,
    },
  });
  if (!response.ok) {
    throw new Error(`${path} 请求失败: HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new Error(`${path} 返回不是 JSON: ${(error as Error).message}`);
  }

  return unwrapTrpcPayload<T>(payload, path);
}

async function trpcMutation<T>(path: string, input: unknown, authHeaders: Record<string, string>, signatureProvider: SignatureProvider): Promise<T> {
  const url = `${API_BASE}/${path}?batch=1`;
  const signature = await signatureProvider.sign(path);
  const { response, text } = await fetchTrpcWithRateLimitRetry(path, url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      origin: WEB_BASE,
      referer: `${WEB_BASE}/mall/${coursePackId}`,
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36",
      ...(signature ? { "x-signature": signature } : {}),
      ...authHeaders,
    },
    body: JSON.stringify({ 0: { json: input } }),
  });
  if (!response.ok) {
    throw new Error(`${path} 请求失败: HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new Error(`${path} 返回不是 JSON: ${(error as Error).message}`);
  }

  return unwrapTrpcPayload<T>(payload, path);
}

async function fetchTrpcWithRateLimitRetry(
  path: string,
  url: string,
  init: RequestInit,
): Promise<{ response: Response; text: string }> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, init);
    const text = await response.text();
    if (response.status !== 429 || attempt >= RATE_LIMIT_RETRY_DELAYS_MS.length) return { response, text };
    const delay = RATE_LIMIT_RETRY_DELAYS_MS[attempt];
    log("warning", `${path} 触发限速，等待 ${Math.round(delay / 1000)} 秒后重试。`);
    await sleep(delay);
  }
}

function unwrapTrpcPayload<T>(payload: unknown, path: string): T {
  const first = Array.isArray(payload) ? payload[0] : payload;
  if (!isRecord(first)) throw new Error(`${path} 返回结构异常`);
  if (isRecord(first.error)) {
    const message = deepString(first.error, ["json", "message"]) || JSON.stringify(first.error).slice(0, 500);
    throw new Error(`${path} 返回错误: ${message}`);
  }

  const result = isRecord(first.result) ? first.result : first;
  const data = isRecord(result.data) ? result.data : result.data;
  if (isRecord(data) && Object.prototype.hasOwnProperty.call(data, "json")) return data.json as T;
  return data as T;
}

function getCourses(pack: JsonRecord): CourseSummary[] {
  const direct = arrayField(pack, "courses");
  const nested = arrayField(recordField(pack, "coursePack"), "courses");
  return [...direct, ...nested]
    .map((course): CourseSummary | undefined => {
      if (!isRecord(course)) return undefined;
      const id = stringField(course, "id") || stringField(course, "courseId");
      if (!id) return undefined;
      return {
        id,
        title: stringField(course, "title") || stringField(course, "name"),
        topic: stringField(course, "topic") || stringField(course, "subtitle"),
        subtitle: stringField(course, "subtitle"),
        description: stringField(course, "description"),
        order: numberField(course, "order"),
        type: stringField(course, "type"),
      };
    })
    .filter((course): course is CourseSummary => Boolean(course));
}

function buildRawItemsFromCourse(pack: JsonRecord, summary: CourseSummary, detail: JsonRecord, order: number): RawLearningItem[] {
  const items: RawLearningItem[] = [];
  const packTitle = stringField(pack, "title") || "在线课程包";
  const unitTitle = summary.title || stringField(detail, "title") || `Lesson ${order}`;
  const unitId = summary.id;
  const common = {
    coursePackageId: coursePackId,
    coursePackageName: packTitle,
    grade: "在线课程",
    unitId,
    unitTitle,
    section: summary.topic || summary.subtitle || "",
    sourceType: GENERATED_SOURCE,
    importance: "",
    sourceFile: `course-pack:${coursePackId}/${unitId}`,
  };

  const seen = new Set<string>();
  for (const sentence of getSentenceRecords(detail)) {
    const english = getEnglish(sentence);
    if (!english || seen.has(`sentence:${english.toLowerCase()}`)) continue;
    if (!hasEnglishLetters(english)) continue;
    seen.add(`sentence:${english.toLowerCase()}`);

    const sentenceId = stringField(sentence, "id") || stringField(sentence, "sentenceId") || stableId(english);
    const contentId = `JLB-${unitId}-S-${sentenceId}`;
    const chinese = getChinese(sentence);
    const wordDetails = getWordDetails(sentence);
    const analysis = buildSentenceAnalysis(sentence, english, chinese);

    items.push({
      id: contentId,
      contentId,
      type: "sentence",
      typeRaw: "sentence",
      english,
      chinese,
      audioText: english,
      sentenceAnalysis: analysis,
      sentenceAnalysisRawText: JSON.stringify(analysis),
      remark: "Imported from online course",
      qualityStatus: "",
      ...common,
    });

    for (const [index, word] of wordDetails.entries()) {
      const text = stringField(word, "word") || stringField(word, "displayText");
      if (!text || seen.has(`word:${text.toLowerCase()}`)) continue;
      if (!hasEnglishLetters(text)) continue;
      seen.add(`word:${text.toLowerCase()}`);
      const wordContentId = `JLB-${unitId}-W-${sentenceId}-${index + 1}`;
      const type = /^[A-Z]{2,}$/.test(text) ? "abbreviation" : text.includes(" ") ? "phrase" : "word";
      items.push({
        id: wordContentId,
        contentId: wordContentId,
        type,
        typeRaw: "wordDetail",
        english: text,
        chinese: getDefinition(word) || fallbackMeaning(text, type),
        audioText: text,
        phonetic: getPhonetic(word),
        pos: stringField(word, "partOfSpeech") || stringField(word, "pos"),
        remark: `From sentence ${sentenceId}`,
        qualityStatus: "",
        ...common,
      });
    }
  }

  for (const statement of getStatementRecords(detail)) {
    const english = getEnglish(statement);
    if (!english) continue;
    if (!hasEnglishLetters(english)) continue;
    const type = inferStatementType(statement, english);
    const key = `${type}:${english.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const statementId = stringField(statement, "id") || stringField(statement, "statementId") || stableId(english);
    const contentId = `JLB-${unitId}-${type.toUpperCase()}-${statementId}`;
    const analysis = type === "sentence" ? buildSentenceAnalysis(statement, english, getChinese(statement)) : undefined;
    items.push({
      id: contentId,
      contentId,
      type,
      typeRaw: stringField(statement, "type") || stringField(statement, "statementType"),
      english,
      chinese: getChinese(statement) || fallbackMeaning(english, type),
      audioText: english,
      sentenceAnalysis: analysis,
      sentenceAnalysisRawText: analysis ? JSON.stringify(analysis) : "",
      remark: "Imported from online course statements",
      qualityStatus: "",
      ...common,
    });
  }

  return items;
}

function getSentenceRecords(detail: JsonRecord): JsonRecord[] {
  const direct = arrayField(detail, "sentences");
  const reading = arrayField(recordField(detail, "reading"), "sentences");
  return uniqueRecords([...direct, ...reading]);
}

function getStatementRecords(detail: JsonRecord): JsonRecord[] {
  return uniqueRecords([...arrayField(detail, "statements"), ...arrayField(detail, "exercises")]);
}

function buildSentenceAnalysis(sentence: JsonRecord, english: string, chinese: string): SentenceAnalysisRaw {
  const components = componentsFromGroups(arrayField(sentence, "wordGroups"));
  return {
    sentence_type: stringifyLoose(field(sentence, "sentenceStructure")) || stringifyLoose(field(sentence, "dependencyAnalysis")) || "",
    sentence_zh: chinese,
    components: components.length ? components : fallbackWordComponents(english, sentence),
    practice_policy: {
      explanation_granularity: "component_or_phrase",
      spelling_granularity: "word",
      show_letter_count: true,
      blank_count_rule: "english_letters_only",
      fillable: "english_words_only",
    },
  };
}

function fallbackWordComponents(english: string, sentence: JsonRecord): SentenceComponent[] {
  const detailByWord = new Map<string, JsonRecord>();
  for (const detail of getWordDetails(sentence)) {
    const word = stringField(detail, "word") || stringField(detail, "displayText");
    if (word) detailByWord.set(word.toLowerCase(), detail);
  }

  return tokenizeEnglish(english)
    .filter((token) => token.fillable)
    .map((token, index) => {
      const detail = detailByWord.get(token.text.toLowerCase());
      return {
        id: `w${index + 1}`,
        text: token.text,
        role: stringField(detail, "partOfSpeech") || stringField(detail, "pos"),
        zh: detail ? getDefinition(detail) : "",
      };
    });
}

function componentsFromGroups(groups: unknown[]): SentenceComponent[] {
  return groups
    .map((group, index) => componentFromGroup(group, `g${index + 1}`))
    .filter((component): component is SentenceComponent => Boolean(component));
}

function componentFromGroup(group: unknown, fallbackId: string): SentenceComponent | undefined {
  if (!isRecord(group)) return undefined;
  const text = cleanImportedText(
    stringField(group, "text") ||
    stringField(group, "content") ||
    stringField(group, "phrase") ||
    stringField(group, "english") ||
    stringField(group, "displayText"),
  );
  if (!text) return undefined;

  const childrenSource =
    arrayField(group, "children").length > 0
      ? arrayField(group, "children")
      : arrayField(group, "words").length > 0
        ? arrayField(group, "words")
        : arrayField(group, "tokens");

  const children = childrenSource
    .map((child, index) => componentFromGroup(child, `${fallbackId}_${index + 1}`))
    .filter((component): component is SentenceComponent => Boolean(component));

  return {
    id: stringField(group, "id") || fallbackId,
    text,
    role:
      stringField(group, "role") ||
      stringField(group, "label") ||
      stringField(group, "type") ||
      stringField(group, "partOfSpeech") ||
      stringField(group, "pos"),
    zh: cleanImportedText(stringField(group, "zh") || stringField(group, "chinese") || stringField(group, "definition") || stringField(group, "meaning")),
    children: children.length ? children : undefined,
  };
}

function getWordDetails(record: JsonRecord): JsonRecord[] {
  const direct = arrayField(record, "wordDetails");
  const assist = arrayField(recordField(record, "languageAssist"), "wordDetails");
  return uniqueRecords([...direct, ...assist]);
}

function getEnglish(record: JsonRecord): string {
  const content = recordField(record, "content");
  return cleanImportedText(
    stringField(record, "english") ||
    stringField(record, "content") ||
    stringField(record, "text") ||
    stringField(content, "english") ||
    stringField(content, "text"),
  );
}

function getChinese(record: JsonRecord): string {
  const content = recordField(record, "content");
  return cleanImportedText(
    stringField(record, "chinese") ||
    stringField(record, "translation") ||
    stringField(record, "zh") ||
    stringField(record, "meaning") ||
    stringField(content, "chinese") ||
    stringField(content, "translation") ||
    stringField(content, "zh"),
  );
}

function getDefinition(record: JsonRecord): string {
  return cleanImportedText(stringField(record, "definition") || stringField(record, "chinese") || stringField(record, "meaning") || stringField(record, "zh"));
}

function getPhonetic(record: JsonRecord): string {
  const direct = field(record, "phonetic");
  if (typeof direct === "string") return cleanPhonetic(direct);
  if (isRecord(direct)) return stringField(direct, "us") || stringField(direct, "uk") || stringField(direct, "text");
  return cleanPhonetic(stringField(record, "soundmark"));
}

function inferStatementType(statement: JsonRecord, english: string): RawLearningItem["type"] {
  const raw = `${stringField(statement, "type")} ${stringField(statement, "statementType")}`.toLowerCase();
  if (raw.includes("sentence")) return "sentence";
  if (raw.includes("phrase") || raw.includes("chunk") || english.trim().includes(" ")) return "phrase";
  if (/^[A-Z]{2,}$/.test(english.trim())) return "abbreviation";
  return "word";
}

async function mergeLearningManifest(current: LearningManifest): Promise<LearningManifest> {
  const manifestPath = join(OUTPUT_DIR, "learning-manifest.json");
  if (!existsSync(manifestPath)) return current;
  const existing = JSON.parse(await readFile(manifestPath, "utf8")) as LearningManifest;
  const packSegments = [`/${ONLINE_COURSE_DIR}/${safePathSegment(coursePackId)}/`, `/julebu/${safePathSegment(coursePackId)}/`];
  const keptPacks = (existing.coursePacks || []).filter((pack) => pack.id !== coursePackId);
  const keptUnits = (existing.units || []).filter((unit) => !packSegments.some((segment) => unit.runtimeModulePath?.includes(segment)));
  return {
    ...existing,
    version: 1,
    generatedAt: current.generatedAt,
    source: uniqueSource([existing.source, current.source]),
    coursePackId: current.coursePackId,
    mode: current.mode,
    coursePacks: [...keptPacks, ...current.coursePacks],
    units: [...keptUnits, ...current.units],
  };
}

function uniqueSource(values: Array<string | undefined>): string {
  return Array.from(
    new Set(
      values
        .flatMap((value) => String(value || "").split("+"))
        .map((value) => (value === "julebu" ? GENERATED_SOURCE : value))
        .filter(Boolean),
    ),
  ).join("+");
}

function hasEnglishLetters(value: string): boolean {
  return /[A-Za-z]/.test(value);
}

function fallbackMeaning(english: string, type: RawLearningItem["type"]): string {
  const text = cleanImportedText(english);
  if (!text) return "";
  if (type === "abbreviation") return `缩写 ${text}`;
  if (/^[A-Z]$/.test(text)) return `字母 ${text}`;
  return "";
}

function dedupeRawItems(items: RawLearningItem[]): RawLearningItem[] {
  const seenIds = new Set<string>();
  const seenContent = new Set<string>();
  const result: RawLearningItem[] = [];

  for (const item of items) {
    if (!item.english) continue;
    if (seenIds.has(item.contentId)) {
      log("error", "内容ID 重复，已跳过", { contentId: item.contentId });
      continue;
    }
    seenIds.add(item.contentId);

    const contentKey = `${item.unitId}:${item.type}:${item.english.toLowerCase()}`;
    if (seenContent.has(contentKey)) continue;
    seenContent.add(contentKey);
    result.push(item);
  }

  return result;
}

function uniqueRecords(records: unknown[]): JsonRecord[] {
  const result: JsonRecord[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    if (!isRecord(record)) continue;
    const key = stringField(record, "id") || stringField(record, "sentenceId") || getEnglish(record) || JSON.stringify(record).slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(record);
  }
  return result;
}

function arrayField(record: unknown, key: string): unknown[] {
  if (!isRecord(record)) return [];
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function recordField(record: unknown, key: string): JsonRecord {
  if (!isRecord(record)) return {};
  const value = record[key];
  return isRecord(value) ? value : {};
}

function field(record: unknown, key: string): unknown {
  return isRecord(record) ? record[key] : undefined;
}

function stringField(record: unknown, key: string): string {
  const value = field(record, key);
  if (value === null || value === undefined) return "";
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value).trim() : "";
}

function numberField(record: unknown, key: string): number | undefined {
  const value = field(record, key);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function deepString(record: unknown, path: string[]): string {
  let current: unknown = record;
  for (const key of path) {
    current = field(current, key);
  }
  return typeof current === "string" ? current : "";
}

function stringifyLoose(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (isRecord(value)) {
    return stringField(value, "type") || stringField(value, "name") || stringField(value, "label") || "";
  }
  return "";
}

function stableId(text: string): string {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash.toString(36);
}

function buildManifestUnit(course: CourseImportResult, runtimeItems: ReturnType<typeof buildLearningRuntimeItem>[], courseSlug: string): LearningManifestUnit {
  const first = runtimeItems[0];
  const packageName = first?.coursePackageName || "在线课程包";
  const grade = first?.grade || "在线课程";
  const unitId = course.summary.id;
  const unitTitle = course.summary.title || first?.unitTitle || `Lesson ${course.order}`;
  const key = [packageName || "默认课程包", grade || "", unitId || "", unitTitle || "未分单元"].join("||");
  return {
    key,
    packageName,
    grade,
    unitId,
    unitTitle,
    section: first?.section || course.summary.topic || course.summary.subtitle || "",
    itemCount: runtimeItems.length,
    typeCounts: countTypes(runtimeItems),
    previewChinese: first?.displayChinese || "",
    runtimeModulePath: `../data/${ONLINE_COURSE_DIR}/${safePathSegment(coursePackId)}/courses/${courseSlug}/runtime-items.json`,
    files: {
      rawItems: `data/${ONLINE_COURSE_DIR}/${safePathSegment(coursePackId)}/courses/${courseSlug}/raw-items.json`,
      runtimeItems: `data/${ONLINE_COURSE_DIR}/${safePathSegment(coursePackId)}/courses/${courseSlug}/runtime-items.json`,
      source: `data/${ONLINE_COURSE_DIR}/${safePathSegment(coursePackId)}/courses/${courseSlug}/source.json`,
    },
  };
}

function countTypes(items: Array<{ type: string }>): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    acc[item.type] = (acc[item.type] || 0) + 1;
    return acc;
  }, {});
}

function cleanPhonetic(value: string): string {
  return value.replace(/[\u200b-\u200f\u2060-\u206f\u034f]/g, "").replace(/\s+/g, " ").trim();
}

function cleanImportedText(value: string): string {
  return value
    .replace(/[\u200b-\u200f\u2060-\u206f\u034f]/g, "")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function safePathSegment(value: string): string {
  return (value || "untitled")
    .normalize("NFKD")
    .replace(/[^\w\u4e00-\u9fa5.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "untitled";
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function log(level: ImportLog["level"], message: string, context: Omit<ImportLog, "level" | "message"> = {}) {
  logs.push({ level, message, ...context });
}

async function writeJson(path: string, data: unknown) {
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function printSummary(items: RawLearningItem[], lexicon: Lexicon, manifestUnits: LearningManifestUnit[]) {
  const byType = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.type] = (acc[item.type] || 0) + 1;
    return acc;
  }, {});
  const warnings = logs.filter((entry) => entry.level === "warning").length;
  const errors = logs.filter((entry) => entry.level === "error").length;

  for (const entry of logs) {
    const scope = [entry.courseId, entry.contentId].filter(Boolean).join(" ");
    console.log(`[${entry.level.toUpperCase()}]${scope ? ` ${scope}` : ""} ${entry.message}`);
  }

  console.log(
    JSON.stringify(
      {
        coursePackId,
        mode,
        rawItems: items.length,
        lexiconEntries: Object.keys(lexicon).length,
        byType,
        warnings,
        errors,
        outputFiles: ["data/learning-manifest.json", `data/${ONLINE_COURSE_DIR}/${safePathSegment(coursePackId)}/course-pack.json`, `data/${ONLINE_COURSE_DIR}/${safePathSegment(coursePackId)}/lexicon.json`],
        courseFiles: manifestUnits.map((unit) => unit.files.runtimeItems),
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
