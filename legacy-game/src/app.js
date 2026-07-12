import { getDay, getTodayNumber, loadLearningData, sampleOptions, shuffle } from "./data.js";
import {
  ensureDaily,
  loadProgress,
  markBossDone,
  markWordsCompleted,
  recordResult,
  resetToday,
  saveProgress,
} from "./storage.js";
import { listenOnce, similarityScore, speak } from "./speech.js";

const state = {
  data: null,
  progress: loadProgress(),
  profile: "grade1",
  dayNumber: 1,
};

const app = document.querySelector("#app");
const statusEl = document.querySelector("#appStatus");
document.querySelector("#homeBtn").addEventListener("click", renderHome);
document.querySelector("#previewBtn").addEventListener("click", renderPreview);
document.querySelector("#resetTodayBtn").addEventListener("click", () => {
  resetToday(state.progress, state.profile, state.dayNumber);
  state.progress = loadProgress();
  renderToday();
});

init();

async function init() {
  try {
    state.data = await loadLearningData();
    state.profile = state.progress.selectedProfile || "grade1";
    syncDay();
    statusEl.textContent = `已加载 ${state.data.words.length} 个词条`;
    renderHome();
  } catch (error) {
    app.innerHTML = `<section class="panel"><h2>加载失败</h2><p>${escapeHtml(error.message)}</p><p>请用本地静态服务打开，不要直接双击 HTML。</p></section>`;
    statusEl.textContent = "数据加载失败";
  }
}

function syncDay() {
  const plan = state.data.plans[state.profile];
  state.dayNumber = getTodayNumber(plan, state.progress.profiles[state.profile]);
}

function setProfile(profile) {
  state.profile = profile;
  state.progress.selectedProfile = profile;
  saveProgress(state.progress);
  syncDay();
}

function currentPlan() {
  return state.data.plans[state.profile];
}

function currentDay() {
  return getDay(currentPlan(), state.dayNumber);
}

function currentDaily() {
  return ensureDaily(state.progress, state.profile, state.dayNumber);
}

function renderHome() {
  syncDay();
  const plan = currentPlan();
  const day = currentDay();
  const daily = currentDaily();
  app.innerHTML = `
    <section class="grid">
      ${renderLearnerCard("grade1", "一年级启蒙", "每天 10 个新词，听音选词、跟读、简单拼写。")}
      ${renderLearnerCard("grade7", "初一考纲", "每天 15 个新词，听写、填空、词形变化和综合测验。")}
    </section>
    <section class="panel stack" style="margin-top:16px">
      <div class="row between">
        <div>
          <h2>${plan.label} · 第 ${day.day} 天</h2>
          <p class="muted">今日 ${day.newWords.length} 个新词，已完成 ${daily.completedWordIds.length} 个，Boss ${daily.bossDone ? "已完成" : "待完成"}。</p>
        </div>
        <button class="primary" id="startTodayBtn" type="button">进入今日任务</button>
      </div>
      ${renderStats(day, daily)}
      <div class="word-list">${day.newWords.map(renderWordCardHtml).join("")}</div>
    </section>
  `;
  app.querySelectorAll("[data-profile]").forEach((button) => {
    button.addEventListener("click", () => {
      setProfile(button.dataset.profile);
      renderHome();
    });
  });
  app.querySelector("#startTodayBtn").addEventListener("click", renderToday);
  bindSpeakButtons();
}

function renderLearnerCard(profile, title, description) {
  const active = state.profile === profile;
  return `
    <button class="panel learner-card ${active ? "secondary" : ""}" type="button" data-profile="${profile}">
      <h2>${title}</h2>
      <p>${description}</p>
      <p class="muted">${active ? "当前学习者" : "点击切换"}</p>
    </button>
  `;
}

function renderStats(day, daily) {
  const results = daily.gameResults;
  const answered = results.filter((r) => typeof r.correct === "boolean");
  const correct = answered.filter((r) => r.correct).length;
  const speakScores = daily.speakScores;
  const avgSpeak = speakScores.length ? Math.round(speakScores.reduce((a, b) => a + b, 0) / speakScores.length) : 0;
  const gameScore = getDailyGameScore(daily);
  return `
    <div class="grid">
      <div class="stat"><span class="muted">今日词数</span><strong>${day.newWords.length}</strong></div>
      <div class="stat"><span class="muted">答题正确率</span><strong>${answered.length ? Math.round((correct / answered.length) * 100) : 0}%</strong></div>
      <div class="stat"><span class="muted">朗读平均环数</span><strong>${avgSpeak || "-"}</strong></div>
      <div class="stat"><span class="muted">游戏得分</span><strong>${gameScore}</strong></div>
    </div>
  `;
}

function renderToday() {
  const day = currentDay();
  const daily = currentDaily();
  app.innerHTML = `
    <section class="panel stack">
      <div class="row between">
        <div>
          <h2>${currentPlan().label} · 今日任务</h2>
          <p class="muted">按顺序完成卡片学习、小游戏、Boss 战，最后查看报告。</p>
        </div>
        <button id="reportBtn" type="button">今日报告</button>
      </div>
      ${renderStats(day, daily)}
      <div class="row">
        <button class="primary" id="cardsBtn" type="button">单词卡片</button>
        <button id="meteorBtn" type="button">星空打陨石</button>
        <button id="targetBtn" type="button">发音打靶</button>
        <button id="sentenceBtn" type="button">句子小火车</button>
        <button id="dictationBtn" type="button">听写工厂</button>
        <button id="bossBtn" type="button">Boss 战</button>
        <button id="revengeBtn" type="button">错词复仇</button>
      </div>
      <div id="moduleMount"></div>
    </section>
  `;
  app.querySelector("#cardsBtn").addEventListener("click", renderCards);
  app.querySelector("#meteorBtn").addEventListener("click", () => renderMeteor(0, createGameSession()));
  app.querySelector("#targetBtn").addEventListener("click", () => renderTarget(0, createGameSession()));
  app.querySelector("#sentenceBtn").addEventListener("click", () => renderSentenceTrain(0, createGameSession()));
  app.querySelector("#dictationBtn").addEventListener("click", () => renderDictation(0, createGameSession()));
  app.querySelector("#bossBtn").addEventListener("click", () => renderBoss(0, buildBossQuestions(), createGameSession()));
  app.querySelector("#revengeBtn").addEventListener("click", () => renderRevenge(0, buildRevengeQuestions(), createGameSession()));
  app.querySelector("#reportBtn").addEventListener("click", renderReport);
  renderCards();
}

function moduleMount() {
  return app.querySelector("#moduleMount");
}

function renderCards() {
  const day = currentDay();
  markWordsCompleted(state.progress, state.profile, state.dayNumber, day.newWordIds);
  moduleMount().innerHTML = `
    <div class="stack">
      <h3>单词卡片</h3>
      <div class="word-list">${day.newWords.map(renderWordCardHtml).join("")}</div>
    </div>
  `;
  bindSpeakButtons();
}

function renderWordCardHtml(word) {
  return `
    <article class="word-card">
      <div class="word-card__main">
        <p class="word-card__word">${escapeHtml(word.display)}</p>
        <p class="word-card__meaning">${escapeHtml(word.meaning)}</p>
        ${renderSentenceChips(word)}
      </div>
      <div class="word-card__meta">${escapeHtml([word.pos, word.category, word.levelLabel, `风险:${word.spellingRisk}`].filter(Boolean).join(" · "))}</div>
      <div class="row">
        <button class="word-card__speak" type="button" data-speak="${escapeAttr(word.word)}">读单词</button>
        <button class="word-card__speak" type="button" data-speak="${escapeAttr(getPracticeSentence(word))}">读句子</button>
      </div>
    </article>
  `;
}

function renderSentenceChips(word) {
  return `
    <div class="sentence-stack">
      ${getPracticeSentences(word).slice(0, 3).map((sentence) => `
        <button class="sentence-chip" type="button" data-speak="${escapeAttr(sentence)}">${escapeHtml(sentence)}</button>
      `).join("")}
    </div>
  `;
}

function bindSpeakButtons(root = app) {
  root.querySelectorAll("[data-speak]").forEach((button) => {
    button.addEventListener("click", () => speak(button.dataset.speak));
  });
}

function createGameSession() {
  return {
    score: 0,
    combo: 0,
    shields: 3,
    streakBest: 0,
    hp: 100,
    stars: 0,
  };
}

function renderGameHud(session, label, current, total) {
  return `
    <div class="game-hud">
      <span>${escapeHtml(label)}</span>
      <span>进度 ${current}/${total}</span>
      <span>得分 ${session.score}</span>
      <span>连击 ${session.combo}</span>
      <span>护盾 ${"●".repeat(Math.max(0, session.shields))}${"○".repeat(Math.max(0, 3 - session.shields))}</span>
    </div>
  `;
}

function addScore(session, base, correct) {
  if (correct) {
    session.combo += 1;
    session.streakBest = Math.max(session.streakBest, session.combo);
    const gained = base + Math.min(30, session.combo * 3);
    session.score += gained;
    return gained;
  }
  session.combo = 0;
  session.shields = Math.max(0, session.shields - 1);
  return 0;
}

function playTone(kind) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const context = playTone.context || new AudioContext();
  playTone.context = context;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const now = context.currentTime;
  const config = {
    hit: [660, 880, 0.12],
    miss: [180, 120, 0.16],
    win: [523, 1046, 0.28],
  }[kind] || [440, 660, 0.12];
  oscillator.type = kind === "miss" ? "sawtooth" : "sine";
  oscillator.frequency.setValueAtTime(config[0], now);
  oscillator.frequency.exponentialRampToValueAtTime(config[1], now + config[2]);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.16, now + 0.018);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + config[2]);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + config[2] + 0.02);
}

function getStars(score, maxScore) {
  if (!maxScore) return 0;
  const ratio = score / maxScore;
  if (ratio >= 0.82) return 3;
  if (ratio >= 0.55) return 2;
  if (ratio > 0) return 1;
  return 0;
}

function renderMeteor(index, session) {
  const words = currentDay().newWords;
  if (index >= words.length) {
    session.stars = getStars(session.score, words.length * 28);
    moduleMount().innerHTML = doneBlock("星空打陨石完成", `得分 ${session.score}，最高连击 ${session.streakBest}，星级 ${"★".repeat(session.stars)}${"☆".repeat(3 - session.stars)}。继续发音打靶或进入其他模块。`);
    return;
  }
  const answer = words[index];
  const sentence = getPracticeSentence(answer, index);
  const options = sampleOptions(state.data.words, answer, 4);
  moduleMount().innerHTML = `
    <div class="game-layout">
      <div class="panel game-stage meteor-stage" id="meteorStage">
        ${renderGameHud(session, "星空打陨石", index + 1, words.length)}
        <h3>星空打陨石</h3>
        <p class="muted">听发音，击中正确英文。连击越高得分越高。</p>
        <div class="row">
          <button class="primary" id="playWordBtn" type="button">播放单词</button>
          <button id="playSentenceBtn" type="button">播放句子</button>
        </div>
        <div class="options meteor-field">
          ${options.map((word, optionIndex) => `<button class="meteor lane-${optionIndex + 1}" style="animation-duration:${6 + optionIndex * 0.55}s" data-answer="${word.id}" type="button">${escapeHtml(word.display)}</button>`).join("")}
        </div>
        <div class="combo-pop" id="comboPop"></div>
        <p class="sentence-line">${escapeHtml(sentence)}</p>
        <p class="feedback" id="feedback"></p>
      </div>
      ${renderProgressAside(index, words)}
    </div>
  `;
  speak(answer.word);
  moduleMount().querySelector("#playWordBtn").addEventListener("click", () => speak(answer.word));
  moduleMount().querySelector("#playSentenceBtn").addEventListener("click", () => speak(sentence, { rate: 0.78 }));
  moduleMount().querySelectorAll("[data-answer]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.locked === "true") return;
      moduleMount().querySelectorAll("[data-answer]").forEach((item) => {
        item.dataset.locked = "true";
        item.disabled = true;
      });
      const correct = button.dataset.answer === answer.id;
      const gained = addScore(session, 12, correct);
      animateMeteorChoice(button, correct);
      recordResult(state.progress, state.profile, state.dayNumber, {
        module: "meteor",
        wordId: answer.id,
        correct,
        score: gained,
        combo: session.combo,
      });
      showFeedback(correct ? `击中！+${gained} 分，连击 ${session.combo}。` : `护盾下降。正确答案是 ${answer.display}。`, correct);
      setTimeout(() => renderMeteor(index + 1, session), 650);
    });
  });
}

function animateMeteorChoice(button, correct) {
  const stage = moduleMount().querySelector("#meteorStage");
  if (correct) {
    playTone("hit");
    button.classList.add("meteor-hit");
    const combo = moduleMount().querySelector("#comboPop");
    if (combo) {
      combo.textContent = "HIT";
      combo.classList.remove("combo-pop--show");
      void combo.offsetWidth;
      combo.classList.add("combo-pop--show");
    }
  } else {
    playTone("miss");
    button.classList.add("meteor-miss");
    stage?.classList.add("shield-hit");
  }
}

function renderTarget(index, session = createGameSession()) {
  const words = currentDay().newWords;
  if (index >= words.length) {
    session.stars = getStars(session.score, words.length * 60);
    moduleMount().innerHTML = doneBlock("发音打靶完成", `命中环数已记录到今日报告。得分 ${session.score}，星级 ${"★".repeat(session.stars)}${"☆".repeat(3 - session.stars)}。`);
    return;
  }
  const word = words[index];
  const sentence = getPracticeSentence(word, index);
  const recognitionAvailable = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  moduleMount().innerHTML = `
    <div class="game-layout">
      <div class="panel game-stage target-stage">
        ${renderGameHud(session, "发音打靶", index + 1, words.length)}
        <h3>发音打靶</h3>
        <div class="target-wrap">
          <div class="mic-pulse" id="micPulse"></div>
          <div class="target" id="targetScore">?</div>
        </div>
        <p><strong>${escapeHtml(word.display)}</strong> · ${escapeHtml(word.meaning)}</p>
        <p class="sentence-line">${escapeHtml(sentence)}</p>
        <div class="row">
          <button class="primary" id="systemReadBtn" type="button">读单词</button>
          <button id="systemSentenceBtn" type="button">读句子</button>
          <button id="listenWordBtn" type="button">${recognitionAvailable ? "跟读单词" : "单词自评"}</button>
          <button id="listenSentenceBtn" type="button">${recognitionAvailable ? "跟读句子" : "句子自评"}</button>
          <button id="nextBtn" type="button">下一个</button>
        </div>
        <p class="feedback" id="feedback">${recognitionAvailable ? "请用 Chrome / Edge 开始跟读。" : "当前浏览器不支持识别，听读后可点自评完成。"}</p>
      </div>
      ${renderProgressAside(index, words)}
    </div>
  `;
  moduleMount().querySelector("#systemReadBtn").addEventListener("click", () => speak(word.word));
  moduleMount().querySelector("#systemSentenceBtn").addEventListener("click", () => speak(sentence, { rate: 0.78 }));
  moduleMount().querySelector("#nextBtn").addEventListener("click", () => renderTarget(index + 1, session));
  moduleMount().querySelector("#listenWordBtn").addEventListener("click", async () => {
    await handleReadingAttempt(word, word.word, recognitionAvailable, "word", session);
  });
  moduleMount().querySelector("#listenSentenceBtn").addEventListener("click", async () => {
    await handleReadingAttempt(word, sentence, recognitionAvailable, "sentence", session);
  });
  speak(word.word);
}

async function handleReadingAttempt(word, targetText, recognitionAvailable, kind, session) {
    const micPulse = moduleMount().querySelector("#micPulse");
    const target = moduleMount().querySelector("#targetScore");
    if (!recognitionAvailable) {
      const gained = addScore(session, 24, true);
      recordSpeak(word, 8, true, gained, session.combo);
      target.textContent = "8";
      target.classList.add("target-hit");
      playTone("hit");
      showFeedback(`已按自评完成记录，+${gained} 分。`, true);
      return;
    }
    showFeedback(kind === "sentence" ? "正在听，请读出这个句子。" : "正在听，请读出这个单词。", true);
    micPulse?.classList.add("listening");
    try {
      const heard = await listenOnce();
      const score = similarityScore(targetText, heard);
      const correct = score >= 6;
      const gained = addScore(session, score * 3, correct);
      recordSpeak(word, score, correct, gained, session.combo);
      target.textContent = String(score);
      target.classList.remove("target-hit", "target-soft");
      void target.offsetWidth;
      target.classList.add(score >= 7 ? "target-hit" : "target-soft");
      playTone(correct ? "hit" : "miss");
      showFeedback(`系统听到：${heard || "未识别"}。命中 ${score} 环，+${gained} 分。`, correct);
    } catch (error) {
      showFeedback(error.message || "系统没有完全听清，再试一次。", false);
    } finally {
      micPulse?.classList.remove("listening");
    }
}

function recordSpeak(word, score, correct, gained = 0, combo = 0) {
  recordResult(state.progress, state.profile, state.dayNumber, {
    module: "target",
    wordId: word.id,
    correct,
    speakScore: score,
    score: gained,
    combo,
  });
}

function renderSentenceTrain(index, session = createGameSession()) {
  const words = currentDay().newWords;
  if (index >= words.length) {
    session.stars = getStars(session.score, words.length * 22);
    moduleMount().innerHTML = doneBlock("句子小火车完成", `今天的句子朗读和填空已完成。得分 ${session.score}，星级 ${"★".repeat(session.stars)}${"☆".repeat(3 - session.stars)}。`);
    return;
  }
  const word = words[index];
  const sentence = getPracticeSentence(word, index + 1);
  moduleMount().innerHTML = `
    <div class="game-layout">
      <div class="panel game-stage train-stage">
        ${renderGameHud(session, "句子小火车", index + 1, words.length)}
        <h3>句子小火车</h3>
        <div class="train-track">
          <span>I</span><span>know</span><span>the</span><span>word</span><input id="trainInput" autocomplete="off" aria-label="句子填空" /><span>.</span>
        </div>
        <p class="muted">中文：${escapeHtml(word.meaning)} · 先听，再填，再读整句。</p>
        <div class="row">
          <button class="primary" id="playTrainBtn" type="button">播放整句</button>
          <button id="checkTrainBtn" type="button">检查</button>
          <button id="nextTrainBtn" type="button">下一个</button>
        </div>
        <p class="sentence-line">${escapeHtml(sentence)}</p>
        <p class="feedback" id="feedback"></p>
      </div>
      ${renderProgressAside(index, words, { hideWords: true })}
    </div>
  `;
  const input = moduleMount().querySelector("#trainInput");
  moduleMount().querySelector("#playTrainBtn").addEventListener("click", () => speak(sentence, { rate: 0.78 }));
  moduleMount().querySelector("#nextTrainBtn").addEventListener("click", () => renderSentenceTrain(index + 1, session));
  moduleMount().querySelector("#checkTrainBtn").addEventListener("click", () => {
    const correct = normalizeAnswer(input.value) === normalizeAnswer(word.word);
    const gained = addScore(session, 10, correct);
    recordResult(state.progress, state.profile, state.dayNumber, {
      module: "sentence_train",
      wordId: word.id,
      correct,
      score: gained,
      combo: session.combo,
    });
    showFeedback(correct ? "车厢接上了，读一遍整句。" : "还差一点，听整句再试一次。", correct);
    if (correct) {
      moduleMount().querySelector("#checkTrainBtn").disabled = true;
      playTone("hit");
      speak(sentence, { rate: 0.78 });
      moduleMount().querySelector(".train-track")?.classList.add("train-success");
      setTimeout(() => renderSentenceTrain(index + 1, session), 850);
    } else {
      playTone("miss");
      const track = moduleMount().querySelector(".train-track");
      track?.classList.remove("shake");
      void track?.offsetWidth;
      track?.classList.add("shake");
    }
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") moduleMount().querySelector("#checkTrainBtn").click();
  });
  speak(sentence, { rate: 0.78 });
  input.focus();
}

function renderDictation(index, session = createGameSession()) {
  const words = currentDay().newWords;
  if (index >= words.length) {
    session.stars = getStars(session.score, words.length * 32);
    moduleMount().innerHTML = doneBlock("听写工厂完成", `听写结果已保存。得分 ${session.score}，星级 ${"★".repeat(session.stars)}${"☆".repeat(3 - session.stars)}。`);
    return;
  }
  const word = words[index];
  const sentence = getPracticeSentence(word, index + 2);
  const attempts = { count: 0 };
  moduleMount().innerHTML = `
    <div class="game-layout">
      <div class="panel game-stage factory-stage">
        ${renderGameHud(session, "听写工厂", index + 1, words.length)}
        <h3>听写工厂</h3>
        <div class="letter-slots" id="letterSlots">${renderLetterSlots(word.word.length)}</div>
        <p class="muted">只显示长度：${word.word.length} 个字母。默认不显示字母提示。</p>
        <div class="row">
          <button class="primary" id="playWordBtn" type="button">播放单词</button>
          <button id="playDictSentenceBtn" type="button">播放句子</button>
        </div>
        <input id="dictationInput" autocomplete="off" placeholder="输入听到的英文单词" />
        <div class="row">
          <button id="checkBtn" type="button">检查</button>
          <button id="hintBtn" type="button">少量提示</button>
          <button id="nextBtn" type="button">下一个</button>
        </div>
        <p class="feedback" id="feedback"></p>
      </div>
      ${renderProgressAside(index, words, { hideWords: true })}
    </div>
  `;
  moduleMount().querySelector(".progress-list")?.classList.add("dictation-hidden-list");
  speak(word.word);
  const input = moduleMount().querySelector("#dictationInput");
  moduleMount().querySelector("#playWordBtn").addEventListener("click", () => speak(word.word));
  moduleMount().querySelector("#playDictSentenceBtn").addEventListener("click", () => speak(sentence, { rate: 0.78 }));
  moduleMount().querySelector("#nextBtn").addEventListener("click", () => renderDictation(index + 1, session));
  moduleMount().querySelector("#hintBtn").addEventListener("click", () => {
    showFeedback(`少量提示：首字母 ${word.word[0] || ""}，共 ${word.word.length} 个字母。`, true);
  });
  moduleMount().querySelector("#checkBtn").addEventListener("click", () => {
    const correct = normalizeAnswer(input.value) === normalizeAnswer(word.word);
    attempts.count += 1;
    const gained = addScore(session, Math.max(8, 24 - attempts.count * 3), correct);
    recordResult(state.progress, state.profile, state.dayNumber, {
      module: "dictation",
      wordId: word.id,
      correct,
      score: gained,
      combo: session.combo,
    });
    const message = correct ? "拼对了。" : getDictationFeedback(word, attempts.count);
    showFeedback(message, correct);
    const stage = moduleMount().querySelector(".factory-stage");
    if (correct) {
      moduleMount().querySelector("#checkBtn").disabled = true;
      playTone("hit");
      moduleMount().querySelector("#letterSlots")?.classList.add("slots-packed");
      setTimeout(() => renderDictation(index + 1, session), 700);
    } else {
      playTone("miss");
      stage?.classList.remove("shake");
      void stage?.offsetWidth;
      stage?.classList.add("shake");
    }
  });
  input.addEventListener("input", () => updateLetterSlots(input.value, word.word.length));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") moduleMount().querySelector("#checkBtn").click();
  });
  input.focus();
}

function buildBossQuestions() {
  const words = shuffle(currentDay().newWords).slice(0, Math.min(14, currentDay().newWords.length));
  const types = state.profile === "grade7"
    ? ["listen", "sentence_listen", "sentence_choice", "spelling", "choice", "cloze", "initial", "formation"]
    : ["listen", "sentence_listen", "sentence_choice", "spelling", "choice", "cloze"];
  return words.map((word, index) => ({ word, type: types[index % types.length], sentence: getPracticeSentence(word, index) }));
}

function buildRevengeQuestions() {
  const daily = currentDaily();
  const wrongWords = daily.wrongWordIds.map((id) => state.data.byId.get(id)).filter(Boolean);
  const challengeWords = wrongWords.length
    ? wrongWords
    : currentDay().newWords.filter((word) => word.spellingRisk !== "low").concat(currentDay().newWords).slice(0, 6);
  const types = ["listen", "sentence_choice", "spelling", "cloze"];
  return shuffle(challengeWords).slice(0, 8).map((word, index) => ({
    word,
    type: types[index % types.length],
    sentence: getPracticeSentence(word, index + 2),
  }));
}

function renderRevenge(index, questions, session = createGameSession()) {
  if (!questions.length) {
    moduleMount().innerHTML = doneBlock("错词复仇", "今天还没有可复习的词，先完成几个小游戏再回来。");
    return;
  }
  if (index >= questions.length) {
    session.stars = getStars(session.score, questions.length * 34);
    moduleMount().innerHTML = doneBlock("错词复仇完成", `得分 ${session.score}，最高连击 ${session.streakBest}，星级 ${"★".repeat(session.stars)}${"☆".repeat(3 - session.stars)}。`);
    return;
  }
  const question = questions[index];
  moduleMount().innerHTML = `
    <div class="game-layout">
      <div class="panel game-stage revenge-stage">
        ${renderGameHud(session, "错词复仇", index + 1, questions.length)}
        <h3>错词复仇 ${index + 1}/${questions.length}</h3>
        ${renderRevengeQuestion(question)}
        <p class="feedback" id="feedback"></p>
      </div>
      ${renderProgressAside(index, questions.map((item) => item.word))}
    </div>
  `;
  bindRevengeQuestion(question, () => setTimeout(() => renderRevenge(index + 1, questions, session), 760), session);
}

function renderRevengeQuestion(question) {
  const { word, type, sentence } = question;
  if (type === "listen") {
    const options = sampleOptions(state.data.words, word, 4);
    return `
      <p>听单词，抢回能量。</p>
      <button class="primary" id="revengePlayBtn" type="button">播放</button>
      <div class="options">${options.map((item) => `<button data-revenge-option="${item.id}" type="button">${escapeHtml(item.display)}</button>`).join("")}</div>
    `;
  }
  if (type === "sentence_choice") {
    const options = buildSentenceOptions(word);
    return `
      <p>找出属于 <strong>${escapeHtml(word.display)}</strong> 的例句。</p>
      <div class="sentence-options">${options.map((option) => `<button data-revenge-sentence="${option.correct ? "1" : "0"}" type="button">${escapeHtml(option.text)}</button>`).join("")}</div>
    `;
  }
  if (type === "cloze") {
    return `
      <p>补全句子：${escapeHtml(maskWordInSentence(sentence, word))}</p>
      <button id="revengeSentenceBtn" type="button">听整句</button>
      <input id="revengeInput" autocomplete="off" placeholder="填写目标词" />
      <button id="revengeCheckBtn" type="button">提交</button>
    `;
  }
  return `
    <p>听写复仇：${escapeHtml(word.meaning)}</p>
    <button class="primary" id="revengePlayBtn" type="button">播放</button>
    <input id="revengeInput" autocomplete="off" placeholder="输入英文单词" />
    <button id="revengeCheckBtn" type="button">提交</button>
  `;
}

function bindRevengeQuestion(question, next, session) {
  const { word, type, sentence } = question;
  const playBtn = moduleMount().querySelector("#revengePlayBtn");
  if (playBtn) {
    playBtn.addEventListener("click", () => speak(word.word));
    speak(word.word);
  }
  const sentenceBtn = moduleMount().querySelector("#revengeSentenceBtn");
  if (sentenceBtn) sentenceBtn.addEventListener("click", () => speak(sentence, { rate: 0.78 }));
  moduleMount().querySelectorAll("[data-revenge-option]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.locked === "true") return;
      lockRevengeInputs();
      finishRevengeQuestion(word, type, button.dataset.revengeOption === word.id, session, next);
    });
  });
  moduleMount().querySelectorAll("[data-revenge-sentence]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.locked === "true") return;
      lockRevengeInputs();
      finishRevengeQuestion(word, type, button.dataset.revengeSentence === "1", session, next);
    });
  });
  const input = moduleMount().querySelector("#revengeInput");
  const checkBtn = moduleMount().querySelector("#revengeCheckBtn");
  if (input && checkBtn) {
    const check = () => {
      if (checkBtn.disabled) return;
      lockRevengeInputs();
      finishRevengeQuestion(word, type, normalizeAnswer(input.value) === normalizeAnswer(word.word), session, next);
    };
    checkBtn.addEventListener("click", check);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") check();
    });
    input.focus();
  }
}

function finishRevengeQuestion(word, type, correct, session, next) {
  const gained = addScore(session, 18, correct);
  playTone(correct ? "hit" : "miss");
  recordResult(state.progress, state.profile, state.dayNumber, {
    module: `revenge:${type}`,
    wordId: word.id,
    correct,
    score: gained,
    combo: session.combo,
  });
  showFeedback(correct ? `复仇成功，+${gained} 分。` : `先记住：${word.display}，${word.meaning}。`, correct);
  moduleMount().querySelector(".revenge-stage")?.classList.add(correct ? "revenge-hit" : "shield-hit");
  next();
}

function lockRevengeInputs() {
  moduleMount().querySelectorAll("[data-revenge-option], [data-revenge-sentence]").forEach((item) => {
    item.dataset.locked = "true";
    item.disabled = true;
  });
  const checkBtn = moduleMount().querySelector("#revengeCheckBtn");
  if (checkBtn) checkBtn.disabled = true;
}

function renderBoss(index, questions, session = createGameSession()) {
  if (index >= questions.length) {
    markBossDone(state.progress, state.profile, state.dayNumber);
    session.stars = getStars(session.score, questions.length * 34);
    moduleMount().innerHTML = doneBlock("Boss 战通关", `Boss 已击败。得分 ${session.score}，最高连击 ${session.streakBest}，星级 ${"★".repeat(session.stars)}${"☆".repeat(3 - session.stars)}。`);
    return;
  }
  const question = questions[index];
  const html = renderBossQuestion(question, index, questions.length);
  moduleMount().innerHTML = `
    <div class="panel game-stage boss-stage">
      ${renderGameHud(session, "Boss 战", index + 1, questions.length)}
      <div class="boss-avatar" id="bossAvatar">
        <div class="boss-core">BOSS</div>
        <div class="attack-bolt" id="attackBolt"></div>
      </div>
      <div class="boss-health"><span style="width:${Math.max(0, session.hp)}%"></span></div>
      <h3>Boss 战 ${index + 1}/${questions.length}</h3>
      ${html}
      <p class="feedback" id="feedback"></p>
    </div>
  `;
  bindBossQuestion(question, () => setTimeout(() => renderBoss(index + 1, questions, session), 760), session, questions.length);
}

function renderBossQuestion(question) {
  const { word, type } = question;
  if (type === "listen" || type === "choice" || type === "sentence_listen") {
    const options = sampleOptions(state.data.words, word, 4);
    return `
      <p>${getBossPrompt(word, type)}</p>
      <button class="primary" id="playBossBtn" type="button">播放</button>
      <div class="options">${options.map((item) => `<button data-boss-option="${item.id}" type="button">${escapeHtml(item.display)}</button>`).join("")}</div>
    `;
  }
  if (type === "sentence_choice") {
    const options = buildSentenceOptions(word);
    return `
      <p>选择包含目标词的正确例句：<strong>${escapeHtml(word.display)}</strong></p>
      <div class="sentence-options">${options.map((option) => `<button data-boss-sentence="${option.correct ? "1" : "0"}" type="button">${escapeHtml(option.text)}</button>`).join("")}</div>
    `;
  }
  if (type === "cloze") {
    const sentence = question.sentence || getPracticeSentence(word);
    return `
      <p>例句填空：${escapeHtml(maskWordInSentence(sentence, word))}</p>
      <p class="muted">中文：${escapeHtml(word.meaning)}</p>
      <input id="bossInput" autocomplete="off" placeholder="填写缺失单词" />
      <button id="bossCheckBtn" type="button">提交</button>
    `;
  }
  if (type === "initial") {
    return `
      <p>首字母填空：${escapeHtml(word.meaning)}，首字母是 <strong>${escapeHtml(word.word[0] || "")}</strong></p>
      <input id="bossInput" autocomplete="off" placeholder="填写完整英文" />
      <button id="bossCheckBtn" type="button">提交</button>
    `;
  }
  if (type === "formation") {
    const formHint = getFormationHint(word);
    return `
      <p>词形变化：写出 <strong>${escapeHtml(word.display)}</strong> 的相关形式。</p>
      <p class="muted">${escapeHtml(formHint.label)}</p>
      <input id="bossInput" autocomplete="off" placeholder="${escapeAttr(formHint.placeholder)}" />
      <button id="bossCheckBtn" type="button">提交</button>
    `;
  }
  return `
    <p>听写：${escapeHtml(word.meaning)}</p>
    <button class="primary" id="playBossBtn" type="button">播放</button>
    <input id="bossInput" autocomplete="off" placeholder="填写英文单词" />
    <button id="bossCheckBtn" type="button">提交</button>
  `;
}

function bindBossQuestion(question, next, session, total) {
  const { word, type } = question;
  const playBtn = moduleMount().querySelector("#playBossBtn");
  if (playBtn) {
    const spoken = type === "sentence_listen" ? question.sentence : word.word;
    playBtn.addEventListener("click", () => speak(spoken, { rate: type === "sentence_listen" ? 0.78 : 0.82 }));
    if (type === "listen" || type === "sentence_listen") speak(spoken, { rate: type === "sentence_listen" ? 0.78 : 0.82 });
  }
  moduleMount().querySelectorAll("[data-boss-option]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.locked === "true") return;
      lockBossInputs();
      const correct = button.dataset.bossOption === word.id;
      const gained = handleBossScore(session, total, correct);
      animateBossResult(correct);
      recordBoss(word, type, correct, gained, session.combo);
      showFeedback(correct ? `Boss 被击中，+${gained} 分。` : `护盾挡住反击。答案是 ${word.display}。`, correct);
      next();
    });
  });
  moduleMount().querySelectorAll("[data-boss-sentence]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.locked === "true") return;
      lockBossInputs();
      const correct = button.dataset.bossSentence === "1";
      const gained = handleBossScore(session, total, correct);
      animateBossResult(correct);
      recordBoss(word, type, correct, gained, session.combo);
      showFeedback(correct ? `句子识别命中，+${gained} 分。` : `再看一遍目标词：${word.display}。`, correct);
      next();
    });
  });
  const input = moduleMount().querySelector("#bossInput");
  const checkBtn = moduleMount().querySelector("#bossCheckBtn");
  if (checkBtn && input) {
    const check = () => {
      if (checkBtn.disabled) return;
      lockBossInputs();
      const answers = getBossAnswers(word, type);
      const correct = answers.includes(normalizeAnswer(input.value));
      const gained = handleBossScore(session, total, correct);
      animateBossResult(correct);
      recordBoss(word, type, correct, gained, session.combo);
      showFeedback(correct ? `攻击命中，+${gained} 分。` : `这题先记一下：${word.display}，${word.meaning}。`, correct);
      next();
    };
    checkBtn.addEventListener("click", check);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") check();
    });
    input.focus();
  }
}

function lockBossInputs() {
  moduleMount().querySelectorAll("[data-boss-option], [data-boss-sentence]").forEach((item) => {
    item.dataset.locked = "true";
    item.disabled = true;
  });
  const checkBtn = moduleMount().querySelector("#bossCheckBtn");
  if (checkBtn) checkBtn.disabled = true;
}

function handleBossScore(session, total, correct) {
  const gained = addScore(session, 16, correct);
  if (correct) {
    session.hp = Math.max(0, session.hp - Math.ceil(100 / total));
  }
  return gained;
}

function animateBossResult(correct) {
  const boss = moduleMount().querySelector("#bossAvatar");
  const bolt = moduleMount().querySelector("#attackBolt");
  if (correct) {
    playTone("hit");
    bolt?.classList.add("attack-bolt--fire");
    boss?.classList.add("boss-hit");
  } else {
    playTone("miss");
    boss?.classList.add("boss-counter");
    moduleMount().querySelector(".boss-stage")?.classList.add("shield-hit");
  }
}

function recordBoss(word, type, correct, gained = 0, combo = 0) {
  recordResult(state.progress, state.profile, state.dayNumber, {
    module: `boss:${type}`,
    wordId: word.id,
    correct,
    score: gained,
    combo,
  });
}

function getBossAnswers(word, type) {
  if (type === "formation") {
    const values = Object.values(word.forms || {}).flat().filter(Boolean);
    return [word.word, ...values].map(normalizeAnswer);
  }
  return [word.word, word.display].map(normalizeAnswer);
}

function getBossPrompt(word, type) {
  if (type === "listen") return "听单词发音，选择正确单词。";
  if (type === "sentence_listen") return "听句子，选择句子里的目标单词。";
  return `选择“${escapeHtml(word.meaning)}”对应的英文。`;
}

function getFormationHint(word) {
  const forms = word.forms || {};
  const plural = forms.plural_forms?.[0];
  const variant = forms.variants?.find((item) => normalizeAnswer(item) !== normalizeAnswer(word.word));
  const note = forms.verb_forms_or_notes?.[0];
  if (plural) return { label: "可以写复数形式，也可以写原词。", placeholder: plural };
  if (variant) return { label: "可以写同组变体，也可以写原词。", placeholder: variant };
  if (note) return { label: note, placeholder: word.word };
  return { label: "本词暂无明确词形数据，写原词即可。", placeholder: word.word };
}

function renderReport() {
  const day = currentDay();
  const daily = currentDaily();
  const results = daily.gameResults.filter((r) => typeof r.correct === "boolean");
  const correct = results.filter((r) => r.correct).length;
  const wrongWords = daily.wrongWordIds.map((id) => state.data.byId.get(id)).filter(Boolean);
  const speakAvg = daily.speakScores.length ? Math.round(daily.speakScores.reduce((a, b) => a + b, 0) / daily.speakScores.length) : 0;
  const gameScore = getDailyGameScore(daily);
  const bestCombo = getDailyBestCombo(daily);
  const stars = getStars(gameScore, Math.max(1, day.newWords.length * 120));
  moduleMountOrApp().innerHTML = `
    <section class="panel stack">
      <div class="row between">
        <div>
          <h2>今日报告</h2>
          <p class="muted">${currentPlan().label} · 第 ${day.day} 天</p>
        </div>
        <button class="primary" id="backTodayBtn" type="button">返回今日任务</button>
      </div>
      <div class="grid">
        <div class="stat"><span class="muted">完成词数</span><strong>${daily.completedWordIds.length}/${day.newWords.length}</strong></div>
        <div class="stat"><span class="muted">正确率</span><strong>${results.length ? Math.round((correct / results.length) * 100) : 0}%</strong></div>
        <div class="stat"><span class="muted">朗读平均环数</span><strong>${speakAvg || "-"}</strong></div>
        <div class="stat"><span class="muted">游戏得分</span><strong>${gameScore}</strong></div>
        <div class="stat"><span class="muted">最高连击</span><strong>${bestCombo}</strong></div>
        <div class="stat"><span class="muted">今日星级</span><strong>${"★".repeat(stars)}${"☆".repeat(3 - stars)}</strong></div>
      </div>
      <div>
        <h3>错词列表</h3>
        ${wrongWords.length ? `<div class="word-list">${wrongWords.map(renderWordCardHtml).join("")}</div>` : `<p class="muted">今天还没有错词记录。</p>`}
      </div>
      <div>
        <h3>明日复习建议</h3>
        <p>${wrongWords.length ? `明天先复习 ${wrongWords.map((w) => w.display).join("、")}，再进入新词。` : "明天先快速朗读今天的新词，再开始新任务。"}</p>
      </div>
    </section>
  `;
  document.querySelector("#backTodayBtn").addEventListener("click", renderToday);
  bindSpeakButtons(document);
}

function moduleMountOrApp() {
  return moduleMount() || app;
}

function getDailyGameScore(daily) {
  return daily.gameResults.reduce((sum, result) => sum + Number(result.score || 0), 0);
}

function getDailyBestCombo(daily) {
  return daily.gameResults.reduce((best, result) => Math.max(best, Number(result.combo || 0)), 0);
}

function renderPreview() {
  const categories = [...new Set(state.data.words.map((word) => word.category))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  app.innerHTML = `
    <section class="panel stack">
      <h2>全部词库预览</h2>
      <div class="preview-tools">
        <input id="searchInput" placeholder="搜索英文、中文、分类" />
        <select id="profileFilter">
          <option value="all">全部</option>
          <option value="grade1">一年级可学</option>
          <option value="grade7">初一考纲</option>
        </select>
        <select id="categoryFilter">
          <option value="all">全部分类</option>
          ${categories.map((category) => `<option value="${escapeAttr(category)}">${escapeHtml(category)}</option>`).join("")}
        </select>
      </div>
      <p class="muted" id="previewCount"></p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>单词</th><th>中文</th><th>词性</th><th>分类</th><th>级别</th><th>操作</th></tr></thead>
          <tbody id="previewBody"></tbody>
        </table>
      </div>
    </section>
  `;
  const render = () => renderPreviewRows();
  app.querySelector("#searchInput").addEventListener("input", render);
  app.querySelector("#profileFilter").addEventListener("change", render);
  app.querySelector("#categoryFilter").addEventListener("change", render);
  render();
}

function renderPreviewRows() {
  const keyword = normalizeText(app.querySelector("#searchInput").value);
  const profile = app.querySelector("#profileFilter").value;
  const category = app.querySelector("#categoryFilter").value;
  const filtered = state.data.words.filter((word) => {
    const hitKeyword = !keyword || normalizeText(`${word.word} ${word.meaning} ${word.category}`).includes(keyword);
    const hitProfile = profile === "all" || (profile === "grade1" ? word.grade1.enabled : Boolean(word.grade7.tier));
    const hitCategory = category === "all" || word.category === category;
    return hitKeyword && hitProfile && hitCategory;
  });
  app.querySelector("#previewCount").textContent = `显示 ${Math.min(filtered.length, 300)} / ${filtered.length} 个，最多渲染前 300 个以保证页面流畅。`;
  app.querySelector("#previewBody").innerHTML = filtered.slice(0, 300).map((word) => `
    <tr>
      <td><strong>${escapeHtml(word.display)}</strong></td>
      <td>${escapeHtml(word.meaning)}</td>
      <td>${escapeHtml(word.pos)}</td>
      <td>${escapeHtml(word.category)}</td>
      <td>${escapeHtml(word.levelLabel)}</td>
      <td><button data-speak="${escapeAttr(word.word)}" type="button">朗读</button></td>
    </tr>
  `).join("");
  bindSpeakButtons(app);
}

function renderProgressAside(index, words, options = {}) {
  return `
    <aside class="panel">
      <h3>今日词表</h3>
      <div class="progress-list">
        ${words.map((word, wordIndex) => `
          <div class="progress-item">
            <span>${wordIndex === index ? "▶ " : ""}${options.hideWords ? renderHiddenWord(word) : escapeHtml(word.display)}</span>
            <span class="muted">${escapeHtml(word.meaning)}</span>
          </div>
        `).join("")}
      </div>
    </aside>
  `;
}

function renderHiddenWord(word) {
  return `<span class="hidden-word" aria-label="听写时隐藏英文">${"•".repeat(Math.max(1, word.word.length))}</span>`;
}

function doneBlock(title, message) {
  return `
    <div class="panel game-stage">
      <h3>${title}</h3>
      <p>${message}</p>
      <button class="primary" type="button" onclick="document.querySelector('#reportBtn')?.click()">查看今日报告</button>
    </div>
  `;
}

function getPracticeSentence(word, offset = 0) {
  const sentences = getPracticeSentences(word);
  return sentences[Math.abs(offset) % sentences.length];
}

function getPracticeSentences(word) {
  const text = word.word;
  const meaning = word.meaning || "这个词";
  const category = word.category || "";
  const pos = word.pos || "";
  const simple = [
    `I know the word ${text}.`,
    `Can you say ${text}?`,
    `Please write ${text}.`,
  ];
  const byPos = [];
  if (pos.includes("v")) {
    byPos.push(`I can ${text} today.`);
    byPos.push(`We ${text} together.`);
  } else if (pos.includes("adj")) {
    byPos.push(`It is ${text}.`);
    byPos.push(`This one looks ${text}.`);
  } else if (pos.includes("adv")) {
    byPos.push(`Please say it ${text}.`);
    byPos.push(`We can do it ${text}.`);
  } else if (pos.includes("prep")) {
    byPos.push(`The ball is ${text} the box.`);
    byPos.push(`Use ${text} in a short sentence.`);
  } else {
    byPos.push(`This is ${articleFor(text)} ${text}.`);
    byPos.push(`I see ${articleFor(text)} ${text}.`);
  }
  const byCategory = [];
  if (category.includes("动物")) byCategory.push(`The ${text} is in the picture.`, `I like this ${text}.`);
  if (category.includes("食物")) byCategory.push(`I eat ${text} for lunch.`, `The ${text} tastes good.`);
  if (category.includes("颜色")) byCategory.push(`The bag is ${text}.`, `I can find something ${text}.`);
  if (category.includes("家庭") || category.includes("人物")) byCategory.push(`My ${text} is kind.`, `I talk with ${text}.`);
  if (category.includes("学校")) byCategory.push(`We use ${text} at school.`, `The ${text} is in my classroom.`);
  if (category.includes("时间")) byCategory.push(`I remember ${text}.`, `${capitalize(text)} is important for our plan.`);
  if (category.includes("地点")) byCategory.push(`I go to the ${text}.`, `The ${text} is near my home.`);
  if (category.includes("功能词")) byCategory.push(`Use ${text} to make a sentence.`, `Listen for ${text} in the sentence.`);
  const meaningSentence = `In Chinese, ${text} means ${meaning}.`;
  return uniqueSentences([...simple, ...byPos, ...byCategory, meaningSentence]).slice(0, 6);
}

function buildSentenceOptions(answer) {
  const correct = getPracticeSentence(answer, 1);
  const distractors = shuffle(currentDay().newWords.filter((word) => word.id !== answer.id))
    .slice(0, 3)
    .map((word, index) => ({ text: getPracticeSentence(word, index), correct: false }));
  return shuffle([{ text: correct, correct: true }, ...distractors]);
}

function maskWordInSentence(sentence, word) {
  const pattern = new RegExp(`\\b${escapeRegExp(word.word)}\\b`, "i");
  return sentence.replace(pattern, "____");
}

function uniqueSentences(sentences) {
  return [...new Set(sentences.filter(Boolean).map((sentence) => sentence.replace(/\s+/g, " ").trim()))];
}

function articleFor(word) {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

function capitalize(text) {
  return String(text).charAt(0).toUpperCase() + String(text).slice(1);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderLetterSlots(length) {
  return Array.from({ length }, (_, index) => `<span data-slot="${index}"></span>`).join("");
}

function updateLetterSlots(value, length) {
  const chars = String(value).slice(0, length).split("");
  moduleMount().querySelectorAll("[data-slot]").forEach((slot, index) => {
    slot.textContent = chars[index] || "";
    slot.classList.toggle("filled", Boolean(chars[index]));
  });
}

function getDictationFeedback(word, count) {
  if (count <= 1) return "先不提示字母，再听一遍试试。";
  if (count === 2) return `少量提示：首字母 ${word.word[0] || ""}，共 ${word.word.length} 个字母。`;
  return `最后提示：${buildHint(word.word)}`;
}

function showFeedback(message, ok) {
  const feedback = moduleMountOrApp().querySelector("#feedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.className = `feedback ${ok ? "ok" : "bad"}`;
}

function buildHint(word) {
  if (word.length <= 2) return word[0] || "";
  return `${word[0]} ${"_ ".repeat(Math.max(0, word.length - 2))}${word[word.length - 1]}`;
}

function normalizeAnswer(text) {
  return String(text).trim().toLowerCase().replace(/[^a-z]/g, "");
}

function normalizeText(text) {
  return String(text).trim().toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
