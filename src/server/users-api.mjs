import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const STORAGE_DIR = join(ROOT, "storage", "users");
const LEARNING_MODES = ["spelling", "en-cn", "cn-en", "sentence-mixed"];

await mkdir(STORAGE_DIR, { recursive: true });

export async function handleUserApiRequest(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/users") {
    sendJson(response, 200, { users: await listUsers() });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/users") {
    const body = await readJsonBody(request);
    const name = normalizeName(body.name);
    if (!name) {
      sendJson(response, 400, { error: "invalid_name", message: "请输入 1-20 个字符的名字" });
      return true;
    }
    const users = await listUsers();
    if (users.some((user) => user.name.toLowerCase() === name.toLowerCase())) {
      sendJson(response, 409, { error: "duplicate_name", message: "名字已存在，请换一个名字" });
      return true;
    }
    const user = createEmptyUser(name);
    await saveUserFile(user);
    sendJson(response, 201, { user });
    return true;
  }

  const match = url.pathname.match(/^\/api\/users\/([^/]+)\/(progress|practice)$/);
  if (!match) return false;

  const [, userId, action] = match;
  const user = await readUserFile(userId);
  if (!user) {
    sendJson(response, 404, { error: "not_found", message: "用户不存在" });
    return true;
  }
  if (migrateLegacyUserProgress(user)) await saveUserFile(user);

  if (request.method === "GET" && action === "progress") {
    sendJson(response, 200, { user });
    return true;
  }

  if (request.method === "PUT" && action === "progress") {
    const body = await readJsonBody(request);
    applyProgressResets(user, body.resets);
    user.progress = { ...(user.progress || {}), ...(body.progress || {}) };
    user.learned = { ...(user.learned || {}), ...(body.learned || {}) };
    user.wrong = { ...(user.wrong || {}), ...(body.wrong || {}) };
    user.daily = { ...(user.daily || {}), ...(body.daily || {}) };
    user.updatedAt = new Date().toISOString();
    await saveUserFile(user);
    sendJson(response, 200, { user });
    return true;
  }

  if (request.method === "POST" && action === "practice") {
    const body = await readJsonBody(request);
    const record = sanitizePracticeRecord(body);
    const key = practiceKey(record.profile, record.category, record.mode);
    user.practice = user.practice || {};
    user.practice[key] = user.practice[key] || { profile: record.profile, category: record.category, mode: record.mode, total: 0, correct: 0, wrong: 0, records: [] };
    user.practice[key].total += 1;
    user.practice[key].correct += record.correct ? 1 : 0;
    user.practice[key].wrong += record.correct ? 0 : 1;
    user.practice[key].records.push(record);
    user.practice[key].records = user.practice[key].records.slice(-500);
    user.updatedAt = new Date().toISOString();
    await saveUserFile(user);
    sendJson(response, 200, { practice: user.practice[key] });
    return true;
  }

  sendJson(response, 405, { error: "method_not_allowed", message: "请求方法不支持" });
  return true;
}

async function listUsers() {
  const files = await readdir(STORAGE_DIR).catch(() => []);
  const users = [];
  for (const file of files.filter((item) => item.endsWith(".json"))) {
    const user = await readUserFile(file.replace(/\.json$/, ""));
    if (user) users.push({ id: user.id, name: user.name, createdAt: user.createdAt, updatedAt: user.updatedAt });
  }
  return users.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

function createEmptyUser(name) {
  const now = new Date().toISOString();
  return {
    id: `${slugName(name)}-${Date.now().toString(36)}`,
    name,
    createdAt: now,
    updatedAt: now,
    progress: {},
    learned: {},
    wrong: {},
    daily: {},
    practice: {},
  };
}

async function readUserFile(userId) {
  const safeId = String(userId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeId) return null;
  try {
    return parseUserJson(await readFile(join(STORAGE_DIR, `${safeId}.json`), "utf8"));
  } catch {
    return null;
  }
}

async function saveUserFile(user) {
  await mkdir(STORAGE_DIR, { recursive: true });
  const target = join(STORAGE_DIR, `${user.id}.json`);
  const temp = join(STORAGE_DIR, `${user.id}.${Date.now()}.tmp`);
  await writeFile(temp, `${JSON.stringify(user, null, 2)}\n`);
  await rename(temp, target);
}

function parseUserJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const end = findFirstJsonObjectEnd(text);
    if (end > 0) return JSON.parse(text.slice(0, end));
    throw new Error("invalid_user_json");
  }
}

function findFirstJsonObjectEnd(text) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = inString;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function normalizeName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 20);
}

function slugName(value) {
  return encodeURIComponent(value).replace(/%/g, "").replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase() || "user";
}

function practiceKey(profile, category, mode) {
  return [profile || "primary", category || "all", mode || "en-cn"].join(":");
}

function migrateLegacyUserProgress(user) {
  user.progress = user.progress || {};
  user.learned = user.learned || {};
  user.wrong = user.wrong || {};
  user.daily = user.daily || {};
  user.practice = user.practice || {};
  user.migrations = user.migrations || {};
  if (user.migrations.modeScopedProgressV2 === true) return false;

  let changed = false;
  for (const profile of ["primary", "junior"]) {
    changed = migrateLegacyUserProgressKeys(user.progress, profile) || changed;
    changed = migrateLegacyUserScopedValue(user.learned, profile) || changed;
    changed = migrateLegacyUserScopedValue(user.wrong, profile) || changed;
    changed = migrateLegacyUserScopedValue(user.daily, profile) || changed;
  }
  user.migrations.modeScopedProgressV2 = true;
  user.updatedAt = new Date().toISOString();
  return changed || true;
}

function migrateLegacyUserProgressKeys(progress, profile) {
  let changed = false;
  const oldBase = `enstudy.simple.${profile}.progress`;
  for (const key of Object.keys(progress)) {
    if (key !== `${oldBase}.v1` && !key.startsWith(`${oldBase}.category.`)) continue;
    const suffix = key === `${oldBase}.v1` ? ".v1" : key.slice(oldBase.length);
    for (const mode of LEARNING_MODES) {
      const targetKey = `enstudy.simple.${profile}.${mode}.progress${suffix}`;
      if (progress[targetKey] == null) {
        progress[targetKey] = progress[key];
        changed = true;
      }
    }
  }
  return changed;
}

function migrateLegacyUserScopedValue(bucket, profile) {
  if (bucket[profile] == null) return false;
  let changed = false;
  for (const mode of LEARNING_MODES) {
    const targetKey = `${profile}:${mode}`;
    if (bucket[targetKey] == null) {
      bucket[targetKey] = bucket[profile];
      changed = true;
    }
  }
  return changed;
}

function applyProgressResets(user, resets) {
  if (!Array.isArray(resets) || !resets.length) return;
  user.progress = user.progress || {};
  user.learned = user.learned || {};
  user.wrong = user.wrong || {};
  user.daily = user.daily || {};
  user.practice = user.practice || {};
  for (const reset of resets) {
    const profile = reset?.profile === "junior" ? "junior" : "primary";
    const mode = sanitizeMode(reset?.mode);
    const scopedKey = `${profile}:${mode}`;
    const progressPrefix = `enstudy.simple.${profile}.${mode}.progress`;
    for (const key of Object.keys(user.progress)) {
      if (key.startsWith(progressPrefix)) delete user.progress[key];
    }
    delete user.learned[scopedKey];
    delete user.wrong[scopedKey];
    delete user.daily[scopedKey];
    for (const key of Object.keys(user.practice)) {
      const [practiceProfile, , practiceMode] = key.split(":");
      if (practiceProfile === profile && practiceMode === mode) delete user.practice[key];
    }
  }
}

function sanitizeMode(value) {
  return LEARNING_MODES.includes(value) ? value : "spelling";
}

function sanitizePracticeRecord(body) {
  const mode = sanitizeMode(body.mode);
  const profile = body.profile === "junior" ? "junior" : "primary";
  const itemId = String(body.itemId || body.wordId || "");
  const english = String(body.english || body.word || "");
  return {
    profile,
    category: String(body.category || ""),
    mode,
    itemId,
    contentId: String(body.contentId || itemId),
    type: String(body.type || (mode === "sentence-mixed" ? "sentence" : "word")),
    english,
    wordId: String(body.wordId || itemId),
    word: String(body.word || english),
    selected: String(body.selected || ""),
    answer: String(body.answer || ""),
    correct: Boolean(body.correct),
    createdAt: new Date().toISOString(),
  };
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}
