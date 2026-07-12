import { createServer } from "node:http";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const STORAGE_DIR = join(ROOT, "storage", "users");
const PORT = Number(process.env.PORT || 4173);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ico": "image/x-icon",
};

await mkdir(STORAGE_DIR, { recursive: true });

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }
    await serveStatic(response, url.pathname);
  } catch (error) {
    sendJson(response, 500, { error: "server_error", message: error.message });
  }
}).listen(PORT, () => {
  console.log(`Enstudy server running at http://127.0.0.1:${PORT}/`);
});

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/users") {
    sendJson(response, 200, { users: await listUsers() });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/users") {
    const body = await readJsonBody(request);
    const name = normalizeName(body.name);
    if (!name) {
      sendJson(response, 400, { error: "invalid_name", message: "请输入 1-20 个字符的名字" });
      return;
    }
    const users = await listUsers();
    if (users.some((user) => user.name.toLowerCase() === name.toLowerCase())) {
      sendJson(response, 409, { error: "duplicate_name", message: "名字已存在，请换一个名字" });
      return;
    }
    const user = createEmptyUser(name);
    await saveUserFile(user);
    sendJson(response, 201, { user });
    return;
  }

  const match = url.pathname.match(/^\/api\/users\/([^/]+)\/(progress|practice)$/);
  if (match) {
    const [, userId, action] = match;
    const user = await readUserFile(userId);
    if (!user) {
      sendJson(response, 404, { error: "not_found", message: "用户不存在" });
      return;
    }

    if (request.method === "GET" && action === "progress") {
      sendJson(response, 200, { user });
      return;
    }

    if (request.method === "PUT" && action === "progress") {
      const body = await readJsonBody(request);
      user.progress = { ...(user.progress || {}), ...(body.progress || {}) };
      user.learned = { ...(user.learned || {}), ...(body.learned || {}) };
      user.wrong = { ...(user.wrong || {}), ...(body.wrong || {}) };
      user.daily = { ...(user.daily || {}), ...(body.daily || {}) };
      user.updatedAt = new Date().toISOString();
      await saveUserFile(user);
      sendJson(response, 200, { user });
      return;
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
      return;
    }
  }

  sendJson(response, 404, { error: "not_found", message: "接口不存在" });
}

async function serveStatic(response, pathname) {
  const cleanPath = pathname === "/" ? "/primary.html" : decodeURIComponent(pathname);
  const filePath = resolve(ROOT, `.${normalize(cleanPath)}`);
  if (!filePath.startsWith(ROOT)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  const info = await stat(filePath).catch(() => null);
  if (!info || !info.isFile()) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type": MIME_TYPES[extname(filePath).toLowerCase()] || "application/octet-stream",
  });
  createReadStream(filePath).pipe(response);
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
    return JSON.parse(await readFile(join(STORAGE_DIR, `${safeId}.json`), "utf8"));
  } catch {
    return null;
  }
}

async function saveUserFile(user) {
  await mkdir(STORAGE_DIR, { recursive: true });
  await writeFile(join(STORAGE_DIR, `${user.id}.json`), `${JSON.stringify(user, null, 2)}\n`);
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

function sanitizePracticeRecord(body) {
  return {
    profile: body.profile === "junior" ? "junior" : "primary",
    category: String(body.category || ""),
    mode: body.mode === "cn-en" ? "cn-en" : "en-cn",
    wordId: String(body.wordId || ""),
    word: String(body.word || ""),
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
