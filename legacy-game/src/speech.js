export function speak(text, options = {}) {
  if (!("speechSynthesis" in window) || !text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = options.lang || "en-US";
  utterance.rate = options.rate || 0.82;
  utterance.pitch = options.pitch || 1;
  window.speechSynthesis.speak(utterance);
}

export function createRecognizer() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;
  const recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  return recognition;
}

export function listenOnce() {
  return new Promise((resolve, reject) => {
    const recognition = createRecognizer();
    if (!recognition) {
      reject(new Error("当前浏览器不支持 SpeechRecognition"));
      return;
    }
    recognition.onresult = (event) => {
      const text = event.results?.[0]?.[0]?.transcript || "";
      resolve(text);
    };
    recognition.onerror = () => reject(new Error("系统没有完全听清，再试一次"));
    recognition.onend = () => {};
    recognition.start();
  });
}

export function similarityScore(target, heard) {
  const a = normalize(target);
  const b = normalize(heard);
  if (!a || !b) return 0;
  const distance = levenshtein(a, b);
  const maxLength = Math.max(a.length, b.length);
  const similarity = Math.max(0, 1 - distance / maxLength);
  return Math.max(1, Math.round(similarity * 10));
}

function normalize(text) {
  return String(text).toLowerCase().replace(/[^a-z]/g, "");
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}
