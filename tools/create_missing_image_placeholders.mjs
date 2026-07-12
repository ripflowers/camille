import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const IMAGE_DIR = path.join(ROOT, "simple", "images", "words");
const IMAGE_INDEX_PATH = path.join(ROOT, "simple", "data", "word_images.json");
const WORDS = [
  "ice cream",
  "kung fu",
  "a little",
  "lots of",
  "post office",
  "right now",
  "South Africa",
  "as long as",
  "at least",
  "because of",
  "miss somebody",
];

async function main() {
  await fs.mkdir(IMAGE_DIR, { recursive: true });
  const index = JSON.parse(await fs.readFile(IMAGE_INDEX_PATH, "utf8"));
  const entries = { ...(index.entries || {}) };
  for (const word of WORDS) {
    const filename = `${safeFileName(word)}.svg`;
    const localPath = path.join(IMAGE_DIR, filename);
    await fs.writeFile(localPath, buildSvg(word));
    entries[word.toLowerCase()] = {
      word,
      provider: "local-placeholder",
      local_path: path.relative(ROOT, localPath),
      prompt: `Local educational placeholder for ${word}`,
    };
  }
  await fs.writeFile(IMAGE_INDEX_PATH, `${JSON.stringify({
    ...index,
    generated_at: new Date().toISOString(),
    image_count: Object.keys(entries).length,
    entries,
  }, null, 2)}\n`);
  console.log(`placeholders=${WORDS.length} images=${Object.keys(entries).length}`);
}

function buildSvg(word) {
  const colors = palette(word);
  const icon = iconFor(word);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420" role="img" aria-label="${escapeXml(word)}">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="${colors[0]}"/>
      <stop offset="100%" stop-color="${colors[1]}"/>
    </linearGradient>
  </defs>
  <rect width="640" height="420" rx="38" fill="url(#bg)"/>
  <circle cx="118" cy="86" r="54" fill="rgba(255,255,255,.32)"/>
  <circle cx="548" cy="340" r="72" fill="rgba(255,255,255,.22)"/>
  <g transform="translate(170 70)">
    ${icon}
  </g>
</svg>\n`;
}

function iconFor(word) {
  const key = word.toLowerCase();
  if (key === "ice cream") return `<path d="M150 245h120l-60 120z" fill="#d97706"/><circle cx="185" cy="205" r="58" fill="#fff7ed"/><circle cx="240" cy="205" r="58" fill="#f9a8d4"/><circle cx="212" cy="150" r="58" fill="#bfdbfe"/>`;
  if (key === "post office") return `<rect x="75" y="145" width="250" height="165" rx="18" fill="#fff"/><path d="M55 145h290L200 58z" fill="#ef4444"/><rect x="105" y="195" width="70" height="115" fill="#bfdbfe"/><rect x="215" y="195" width="80" height="55" fill="#bfdbfe"/>`;
  if (key === "south africa") return `<circle cx="200" cy="205" r="122" fill="#dbeafe"/><path d="M94 210c45-44 96-72 165-92 28 36 45 71 50 111-48 49-116 73-190 53-14-20-22-44-25-72z" fill="#22c55e"/><circle cx="250" cy="142" r="12" fill="#f97316"/>`;
  if (key === "kung fu") return `<circle cx="210" cy="92" r="42" fill="#fde68a"/><path d="M160 150h100l42 92-42 28-30-66-38 122h-50l28-126-68 44-28-36z" fill="#1d4ed8"/><path d="M265 152l90-40 18 34-86 54z" fill="#f97316"/>`;
  if (key === "right now") return `<circle cx="205" cy="205" r="112" fill="#fff"/><path d="M205 115v90l68 42" stroke="#2563eb" stroke-width="24" stroke-linecap="round" fill="none"/><circle cx="205" cy="205" r="10" fill="#2563eb"/>`;
  if (key === "lots of") return `<g fill="#fff"><circle cx="120" cy="160" r="42"/><circle cx="205" cy="130" r="42"/><circle cx="292" cy="160" r="42"/><circle cx="158" cy="245" r="42"/><circle cx="250" cy="250" r="42"/></g>`;
  if (key === "a little") return `<circle cx="205" cy="210" r="92" fill="rgba(255,255,255,.35)"/><circle cx="205" cy="210" r="28" fill="#fff"/><path d="M286 142l48-48" stroke="#fff" stroke-width="18" stroke-linecap="round"/>`;
  if (key === "as long as") return `<path d="M80 210h250" stroke="#fff" stroke-width="30" stroke-linecap="round"/><path d="M290 150l70 60-70 60" fill="none" stroke="#fff" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (key === "at least") return `<rect x="86" y="238" width="260" height="40" rx="20" fill="#fff"/><rect x="86" y="172" width="180" height="40" rx="20" fill="rgba(255,255,255,.75)"/><circle cx="102" cy="120" r="35" fill="#fff"/>`;
  if (key === "because of") return `<circle cx="145" cy="190" r="58" fill="#fff"/><path d="M210 190h92" stroke="#fff" stroke-width="22" stroke-linecap="round"/><path d="M285 145l55 45-55 45" fill="none" stroke="#fff" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `<path d="M110 160c36-70 150-70 186 0 35 68-37 130-93 170-56-40-128-102-93-170z" fill="#fff"/><circle cx="170" cy="165" r="18" fill="#f97316"/><circle cx="238" cy="165" r="18" fill="#f97316"/>`;
}

function palette(word) {
  const palettes = [
    ["#bfdbfe", "#818cf8"],
    ["#fed7aa", "#fb7185"],
    ["#bbf7d0", "#38bdf8"],
    ["#ddd6fe", "#60a5fa"],
  ];
  const sum = [...word].reduce((total, char) => total + char.charCodeAt(0), 0);
  return palettes[sum % palettes.length];
}

function safeFileName(word) {
  return String(word || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || encodeURIComponent(word);
}

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, (char) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
    "'": "&apos;",
  })[char]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
