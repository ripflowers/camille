const TOKEN_REFRESH_BEFORE_EXPIRY_SECONDS = 3 * 60;
const EDGE_ENDPOINT_URL = "https://dev.microsofttranslator.com/apps/endpoint?api-version=1.0";
const EDGE_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 Edg/127.0.0.0";
const EDGE_OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
const EDGE_SIGNATURE_SECRET = "oik6PdDdMnOXemTbwvMn9de/h9lFnfBaCWbGMMZqqoSaQaqUOqjVGm5NqsmjcBI1x+sS9ugjB55HEJWRiFXYFw==";

let tokenInfo = {
  endpoint: null,
  token: null,
  expiredAt: null,
};

export async function handleEdgeTtsNodeRequest(request, response) {
  if (request.method === "OPTIONS") {
    response.writeHead(204, makeCorsHeaders(request));
    response.end();
    return;
  }

  if (request.method !== "POST" && request.method !== "GET") {
    sendJson(response, 405, { error: { message: "Only GET or POST is supported", code: "method_not_allowed" } });
    return;
  }

  try {
    const params = request.method === "GET"
      ? extractGetParams(new URL(request.url, `http://${request.headers.host}`))
      : await readJsonBody(request);
    const audio = await synthesizeEdgeTts(params);
    response.writeHead(200, {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "public, max-age=86400",
      ...makeCorsHeaders(request),
    });
    response.end(audio);
  } catch (error) {
    sendJson(response, 500, {
      error: {
        message: error instanceof Error ? error.message : String(error),
        type: "api_error",
        code: "edge_tts_error",
      },
    });
  }
}

function extractGetParams(url) {
  const search = url.searchParams;
  return {
    input: search.get("input") || "",
    voice: search.get("voice") || undefined,
    style: search.get("style") || undefined,
    speed: search.get("speed") != null ? Number(search.get("speed")) : undefined,
    pitch: search.get("pitch") != null ? Number(search.get("pitch")) : undefined,
    volume: search.get("volume") != null ? Number(search.get("volume")) : undefined,
  };
}

export async function synthesizeEdgeTts(options) {
  const input = String(options?.input || "").trim();
  if (!input) throw new Error("input is required");

  const voice = sanitizeVoice(options.voice || "en-US-JennyNeural");
  const style = sanitizeStyle(options.style || "general");
  const rate = speedToRate(options.speed ?? 0.86);
  const pitch = pitchToHz(options.pitch ?? 0);
  const volume = volumeToPercent(options.volume ?? 0);
  const chunks = splitTextIntoChunks(input);
  const audioChunks = [];

  for (const chunk of chunks) {
    audioChunks.push(await getAudioChunkBuffer(chunk, voice, rate, pitch, volume, style));
  }

  return Buffer.concat(audioChunks);
}

async function getAudioChunkBuffer(text, voiceName, rate, pitch, volume, style) {
  const endpoint = await getEndpoint();
  const url = `https://${endpoint.r}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: endpoint.t,
      "Content-Type": "application/ssml+xml",
      "User-Agent": EDGE_USER_AGENT,
      "X-Microsoft-OutputFormat": EDGE_OUTPUT_FORMAT,
    },
    body: buildSsml(text, voiceName, rate, pitch, volume, style),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`Edge TTS API error: ${response.status} ${message}`.trim());
  }

  return Buffer.from(await response.arrayBuffer());
}

function buildSsml(text, voiceName, rate, pitch, volume, style) {
  const lang = voiceName.split("-").slice(0, 2).join("-") || "en-US";
  const content = `<prosody rate="${rate}" pitch="${pitch}" volume="${volume}">${escapeXml(text)}</prosody>`;
  const spoken = style && style !== "general"
    ? `<mstts:express-as style="${escapeXml(style)}" styledegree="1.2">${content}</mstts:express-as>`
    : content;
  return `<speak xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" version="1.0" xml:lang="${escapeXml(lang)}"><voice name="${escapeXml(voiceName)}">${spoken}</voice></speak>`;
}

async function getEndpoint() {
  const now = Date.now() / 1000;
  if (tokenInfo.token && tokenInfo.expiredAt && now < tokenInfo.expiredAt - TOKEN_REFRESH_BEFORE_EXPIRY_SECONDS) {
    return tokenInfo.endpoint;
  }

  const clientId = crypto.randomUUID().replace(/-/g, "");
  try {
    const response = await fetch(EDGE_ENDPOINT_URL, {
      method: "POST",
      headers: {
        "Accept-Language": "zh-Hans",
        "X-ClientVersion": "4.0.530a 5fe1dc6c",
        "X-UserId": "0f04d16a175c411e",
        "X-HomeGeographicRegion": "zh-Hans-CN",
        "X-ClientTraceId": clientId,
        "X-MT-Signature": await sign(EDGE_ENDPOINT_URL),
        "User-Agent": EDGE_USER_AGENT,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": "0",
        "Accept-Encoding": "gzip",
      },
    });

    if (!response.ok) throw new Error(`获取 Edge TTS endpoint 失败: ${response.status}`);
    const data = await response.json();
    const payload = JSON.parse(Buffer.from(data.t.split(".")[1], "base64url").toString("utf8"));
    tokenInfo = {
      endpoint: data,
      token: data.t,
      expiredAt: payload.exp,
    };
    return data;
  } catch (error) {
    if (tokenInfo.token) return tokenInfo.endpoint;
    throw error;
  }
}

async function sign(urlString) {
  const url = urlString.split("://")[1];
  const encodedUrl = encodeURIComponent(url);
  const uuid = crypto.randomUUID().replace(/-/g, "");
  const formattedDate = new Date().toUTCString().replace(/GMT/, "").trim().toLowerCase() + " gmt";
  const bytesToSign = `MSTranslatorAndroidApp${encodedUrl}${formattedDate}${uuid}`.toLowerCase();
  const key = Buffer.from(EDGE_SIGNATURE_SECRET, "base64");
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(bytesToSign));
  return `MSTranslatorAndroidApp::${Buffer.from(signature).toString("base64")}::${formattedDate}::${uuid}`;
}

function splitTextIntoChunks(text) {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const chunks = [];
  for (const line of lines.length ? lines : [text]) {
    if (line.length <= 1800) {
      chunks.push(line);
      continue;
    }
    for (let start = 0; start < line.length; start += 1600) {
      chunks.push(line.slice(start, start + 1600));
    }
  }
  return chunks;
}

function speedToRate(value) {
  const speed = clampNumber(Number.parseFloat(String(value)), 0.5, 2, 1);
  const rate = Math.round((speed - 1) * 100);
  return rate >= 0 ? `+${rate}%` : `${rate}%`;
}

function pitchToHz(value) {
  const pitch = Math.round(clampNumber(Number.parseFloat(String(value)), -50, 50, 0));
  return pitch >= 0 ? `+${pitch}Hz` : `${pitch}Hz`;
}

function volumeToPercent(value) {
  const volume = Math.round(clampNumber(Number.parseFloat(String(value)), -1, 1, 0) * 100);
  return volume >= 0 ? `+${volume}%` : `${volume}%`;
}

function sanitizeVoice(value) {
  const voice = String(value || "").trim();
  return /^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$/.test(voice) ? voice : "en-US-JennyNeural";
}

function sanitizeStyle(value) {
  const style = String(value || "general").trim().toLowerCase();
  return /^[a-z]+$/.test(style) ? style : "general";
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...makeCorsHeaders(),
  });
  response.end(JSON.stringify(data));
}

function makeCorsHeaders(request) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
    "Access-Control-Allow-Headers": request?.headers?.["access-control-request-headers"] || "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}
