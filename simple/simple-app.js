const PROFILE = document.body.dataset.profile || "primary";
const DATA_URLS = {
  primary: "./simple/data/primary_words.json",
  junior: "./simple/data/junior_words.json",
};
const LABELS = {
  primary: "小学英语单词",
  junior: "中学英语单词",
};
const POS_EN_LABELS = {
  adjective: "adj.",
  adverb: "adv.",
  conjunction: "conj.",
  determiner: "det.",
  noun: "n.",
  number: "num.",
  preposition: "prep.",
  pronoun: "pron.",
  verb: "v.",
  word: "word",
};
const PROFILE_PAGE = {
  primary: "primary.html",
  junior: "junior.html",
};
const LEARNING_MODES = ["spelling", "en-cn", "cn-en"];
const PAGE_SIZE = 20;
const AUTO_SPEAK_TIMES = 1;
const USER_SESSION_KEY = "enstudy.simple.activeUser.v1";
const LOCAL_USERS_KEY = "enstudy.simple.localUsers.v1";
const LEGACY_SENTENCE_LOCAL_USERS_KEY = "enstudy.sentence.localUsers.v1";
const MODE_KEY = `enstudy.simple.${PROFILE}.mode.v1`;
const CATEGORY_KEY = `enstudy.simple.${PROFILE}.category.v1`;
const STORED_MODE = localStorage.getItem(MODE_KEY) || "spelling";
const INITIAL_MODE = LEARNING_MODES.includes(STORED_MODE) ? STORED_MODE : "spelling";
const API_BASE = "./api";
const PAGE_PARAMS = new URLSearchParams(window.location.search);
migrateLegacyLocalStorage(PROFILE);
migrateSharedLocalUsers();
const INITIAL_CATEGORY = PAGE_PARAMS.has("category")
  ? PAGE_PARAMS.get("category") || ""
  : localStorage.getItem(categoryStorageKey(PROFILE, INITIAL_MODE)) || localStorage.getItem(CATEGORY_KEY) || "";
const SOUND_URLS = {
  click: "./simple/sounds/click.wav",
  bad: "./simple/sounds/beep.wav",
  ok: "./simple/sounds/correct.mp3",
};

const state = {
  allEntries: [],
  entries: [],
  activeCategory: INITIAL_CATEGORY,
  index: 0,
  selected: [],
  bank: [],
  revealed: false,
  learnedIds: new Set(),
  wrongIds: new Set(),
  user: null,
  serverReady: false,
  serverMessage: "本地模式",
  serverUserLoaded: false,
  mode: INITIAL_MODE,
  streak: 0,
  lastReward: "",
  choiceQuestion: null,
  choiceAnswered: false,
  choiceSelected: "",
  meaningsExpanded: false,
  practice: null,
  hintCount: 0,
  listPage: 1,
  wrongReview: null,
};

const app = document.querySelector("#app");
let autoSpeakToken = 0;
let activeVoiceAudio = null;
const soundPool = {};

installZoomGuards();
init();

async function init() {
  const data = await loadJson(DATA_URLS[PROFILE]);
  state.allEntries = data.entries;
  state.entries = filterEntriesByCategory(state.allEntries, state.activeCategory);
  if (state.activeCategory && !state.entries.length) {
    state.activeCategory = "";
    state.entries = state.allEntries;
    localStorage.removeItem(categoryStorageKey(PROFILE, state.mode));
  } else if (state.activeCategory) {
    localStorage.setItem(categoryStorageKey(PROFILE, state.mode), state.activeCategory);
  } else if (PAGE_PARAMS.has("category")) {
    localStorage.removeItem(categoryStorageKey(PROFILE, state.mode));
  }
  state.user = loadUserSession();
  state.serverReady = await checkServerReady();
  state.learnedIds = loadLearned();
  state.wrongIds = loadWrong();
  state.index = clamp(Number(localStorage.getItem(progressKey()) || 0), 0, state.entries.length - 1);
  if (state.user && state.serverReady) await loadUserProgress();
  render();
  if (state.serverReady && !state.user) openUserModal();
}

async function loadJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`加载失败：${url}`);
  return response.json();
}

function installZoomGuards() {
  let lastTouchEnd = 0;
  document.addEventListener("touchend", (event) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) event.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });
  document.addEventListener("gesturestart", (event) => event.preventDefault(), { passive: false });
}

function render() {
  if (!state.entries.length) {
    state.activeCategory = "";
    state.entries = state.allEntries;
    state.index = 0;
  }
  const word = currentWord();
  const target = currentChallengeTarget(word);
  const isLearned = state.learnedIds.has(word.id);
  const isChoiceMode = isChoicePracticeMode();
  state.selected = [];
  state.bank = buildLetterBank(target);
  state.revealed = isLearned || (isChoiceMode ? state.choiceAnswered : false);
  state.hintCount = 0;
  prepareChoiceQuestion(word);
  app.innerHTML = `
    <header class="learn-status">
      <div class="status-title">
        <span class="status-icon">★</span>
        <div>
          <h1>${LABELS[PROFILE]}${state.activeCategory ? ` · ${escapeHtml(state.activeCategory)}` : ""}${state.wrongReview?.active ? " · 错题练习" : ""}</h1>
          <div class="muted">${state.wrongReview?.active ? "当前模式错题复习，答对后自动移除" : "轻游戏化单词闯关"}</div>
        </div>
      </div>
      <div class="status-metrics">
        <div class="metric-card"><span>学习进度</span><strong>${state.index + 1}/${state.entries.length}</strong></div>
        <div class="metric-card"><span>连续学习</span><strong>${consecutiveDays()} 天</strong></div>
        <button id="wrongListTopBtn" class="metric-card wrong-metric" type="button"><span>${state.wrongReview?.active ? "剩余错题" : "错题练习"}</span><strong>${state.wrongIds.size}</strong></button>
      </div>
      <div class="status-user">
        <a class="icon-btn nav-link" href="/sentence?from=${PROFILE}">句子练习</a>
        ${renderUserBadge()}
        <button id="settingsBtn" class="icon-btn" type="button" title="设置">设置</button>
      </div>
    </header>
    <section class="game-shell">
      <div id="studyPanelMount">${renderStudyPanel(word, isLearned)}</div>
      <div class="challenge-panel panel">
        ${renderChallenge(word, target)}
        ${renderExamplesPanel(word)}
      </div>
    </section>
    ${state.lastReward ? `<div class="reward-pop">${escapeHtml(state.lastReward)}</div>` : ""}
    <div id="modalMount"></div>
  `;
  recordDaily("viewed", word);
  bindEvents();
  if (shouldAutoSpeakCurrentWord()) autoSpeakWord(word.word);
}

function renderMeanings(meanings = []) {
  const visible = state.meaningsExpanded ? meanings : meanings.slice(0, 3);
  const hiddenCount = Math.max(0, meanings.length - visible.length);
  return `
    <div class="meaning-strip" aria-label="中文释义">
      ${visible.map((meaning, index) => `
        <div class="meaning-chip" title="${escapeAttr(meaning)}">
          <span>${index + 1}</span>
          <strong>${escapeHtml(meaning)}</strong>
        </div>
      `).join("")}
      ${hiddenCount ? `<button id="toggleMeaningsBtn" class="meaning-more" type="button">更多 ${hiddenCount}</button>` : ""}
      ${state.meaningsExpanded && meanings.length > 3 ? `<button id="collapseMeaningsBtn" class="meaning-more less" type="button">收起</button>` : ""}
    </div>
  `;
}

function renderStudyPanel(word, isLearned) {
  const locked = isChoicePending();
  return `
    <aside class="study-panel panel">
      ${renderWordCard(word, isLearned, locked, state.mode === "spelling" && !state.revealed)}
      <div id="revealMount">${state.revealed ? renderMemory(word) : renderHiddenMemory()}</div>
    </aside>
  `;
}

function renderWordCard(word, isLearned, locked = false, hideWord = false) {
  const phonetic = word.phonetic || word.ukphone || word.usphone || "";
  if (locked) {
    return `
      <article class="word-card word-card-locked">
        <div class="level-chip">第 ${state.index + 1} 关</div>
        <div class="answer-cover">
          <strong>${state.mode === "en-cn" ? "先看英文，选中文" : "先看中文，选英文"}</strong>
          <span>选完以后再解锁单词卡和关联记忆。</span>
        </div>
        <div class="tag-row">
          ${renderLearnedBadge(isLearned)}
          <span class="tag">${escapeHtml(word.category)}</span>
        </div>
      </article>
    `;
  }
  return `
    <article class="word-card">
      <div class="level-chip">第 ${state.index + 1} 关</div>
      <div class="word-image">
        <img src="${escapeAttr(word.image.url)}" alt="${escapeAttr(word.word)}" referrerpolicy="no-referrer" />
      </div>
      <div class="word-main">
        <div class="word-meta-line">
          <button id="wordSpeakHeroBtn" class="sound-pill" data-speak-word="${escapeAttr(word.word)}" type="button">播放读音</button>
          <span class="tag">${escapeHtml(word.category)}</span>
          <span class="tag">${escapeHtml(formatPosLabel(word))}</span>
          <span class="tag reward-tag">${escapeHtml(word.spelling_risk)}</span>
          ${renderLearnedBadge(isLearned)}
        </div>
        <h2 class="${hideWord ? "word-hidden" : ""}">${hideWord ? "拼写挑战" : escapeHtml(word.display || word.word)}</h2>
        <p class="phonetic">${hideWord ? `先听读音，再拼出 ${spellingTarget(word.word).length} 个字母` : escapeHtml(phonetic ? `/${phonetic}/` : "听一听，读一读")}</p>
      </div>
      ${renderMeanings(word.meanings)}
    </article>
  `;
}

function renderChallenge(word, target) {
  if (isChoicePracticeMode()) return renderChoiceChallenge(word);
  return renderSpelling(word, target);
}

function isChoicePending() {
  return isChoicePracticeMode() && !state.choiceAnswered && !state.learnedIds.has(currentWord().id);
}

function isChoicePracticeMode() {
  return state.mode === "en-cn" || state.mode === "cn-en";
}

function revealWord(markLearned = true) {
  state.revealed = true;
  const word = currentWord();
  if (markLearned) {
    const wasLearned = state.learnedIds.has(word.id);
    state.learnedIds.add(word.id);
    saveLearned();
    recordDaily("learned", word);
    if (!wasLearned) flashReward("已掌握 +1");
    updateLearnedStatusUi(word);
  } else {
    updateLearnedStatusUi(word);
  }
  const memoryMount = document.querySelector("#revealMount");
  if (memoryMount) memoryMount.innerHTML = renderMemory(word);
  const examplesMount = document.querySelector("#examplesMount");
  if (examplesMount) {
    examplesMount.className = "examples";
    examplesMount.innerHTML = renderExamples(word, true);
  }
  bindSpeakButtons();
}

function updateLearnedStatusUi(word) {
  const mount = document.querySelector("#studyPanelMount");
  if (mount) mount.innerHTML = renderStudyPanel(word, state.learnedIds.has(word.id));
}

function renderLearnedBadge(isLearned) {
  return `
    <div class="learned-badge ${isLearned ? "done" : "new"}" title="${isLearned ? "当前单词已学" : "当前单词未学"}" aria-label="${isLearned ? "当前单词已学" : "当前单词未学"}">
      <span>${isLearned ? "✓" : "○"}</span>
      <strong>${isLearned ? "已学" : "未学"}</strong>
    </div>
  `;
}

function renderUserBadge() {
  const label = state.user ? state.user.name : state.serverReady ? "未选择用户" : "本地模式";
  const title = state.serverReady ? "学习记录会保存到服务端文件" : "未启动服务端，学习记录只保存在本机浏览器";
  return `
    <div class="user-badge ${state.user ? "active" : ""}" title="${escapeAttr(title)}">
      <span>人</span>
      <strong>${escapeHtml(label)}</strong>
    </div>
  `;
}

function renderHiddenMemory() {
  return `
    <div class="memory">
      <h2>关联记忆</h2>
      <div class="memory-locked">
        <strong>完成本关后解锁</strong>
        <p class="muted compact-note">${PROFILE === "primary" ? "这里会出现一个好记的小故事，帮你把单词和图片连起来。" : "这里会显示词根词缀、词形变化、搭配和例句，帮助你系统记忆。"}</p>
      </div>
    </div>
  `;
}

function renderMemory(word) {
  return `
    <div class="memory">
      <div class="reveal-title">
        <h2>${escapeHtml(word.display || word.word)}</h2>
        <button id="speakWordBtn" data-speak-word="${escapeAttr(word.word)}" type="button">播放读音</button>
      </div>
      <div class="memory-meaning">${escapeHtml(formatMeanings(word))}</div>
      ${word.memory.form_note ? `<p class="memory-note">${escapeHtml(trimLong(word.memory.form_note, 220))}</p>` : `<p class="muted memory-note">这个词先重点记住释义和拼写。</p>`}
      <div class="forms">${renderForms(word.forms)}</div>
      ${PROFILE === "primary" ? renderStoryMemory(word) : renderAnalysis(word)}
      ${renderPhrases(word.phrases)}
      ${renderRelatedMemory(word)}
    </div>
  `;
}

function renderStoryMemory(word) {
  const imageMemory = word.word_analysis?.image_memory || word.memory?.tip || "";
  const text = imageMemory || `看着图片，大声读 ${word.word}，再说出它的意思：${formatMeanings(word)}。`;
  return `<div class="story-memory"><strong>小故事联想</strong><p>${escapeHtml(trimLong(text, 180))}</p></div>`;
}

function renderRelatedMemory(word) {
  const related = [
    ...(word.synonyms || []).slice(0, 3).map((item) => `近义：${item}`),
    ...(word.antonyms || []).slice(0, 3).map((item) => `反义：${item}`),
  ];
  if (!related.length) return "";
  return `<div class="related-memory">${related.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>`;
}

function renderForms(forms) {
  const rows = [];
  if (forms.verb) {
    rows.push(["原形", forms.verb.base]);
    rows.push(["第三人称单数", forms.verb.third_person]);
    rows.push(["过去式", forms.verb.past]);
    rows.push(["过去分词", forms.verb.past_participle]);
    rows.push(["现在分词", forms.verb.present_participle]);
  }
  if (forms.noun) {
    rows.push([forms.noun.countability === "plural_only" ? "当前形式" : "原形", forms.noun.singular]);
    if (forms.noun.plural) rows.push(["复数", forms.noun.plural]);
    if (forms.noun.countability_note) rows.push(["说明", forms.noun.countability_note]);
  }
  if (forms.adjective) {
    rows.push(["原级", forms.adjective.base]);
    rows.push(["比较级", forms.adjective.comparative]);
    rows.push(["最高级", forms.adjective.superlative]);
  }
  if (forms.variants?.length) rows.push(["变体", forms.variants.join(" / ")]);
  if (forms.notes?.length) rows.push(["备注", forms.notes.join("；")]);
  return rows.length
    ? rows.map(([label, value]) => `<div class="form-row"><span class="muted">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")
    : `<div class="muted">暂无词形变化。</div>`;
}

function renderAnalysis(word) {
  const analysis = word.word_analysis;
  if (!analysis) return "";
  const rows = [
    ["词根", analysis.root],
    ["词缀", analysis.affix],
    ["变形说明", analysis.forms_note],
    ["图像记忆", analysis.image_memory],
  ].filter(([, value]) => value);
  if (!rows.length) return "";
  return `
    <div class="analysis-grid">
      ${rows.map(([label, value]) => `
        <details>
          <summary>${escapeHtml(label)}</summary>
          <p>${escapeHtml(trimLong(value, 260))}</p>
        </details>
      `).join("")}
    </div>
  `;
}

function renderPhrases(phrases = []) {
  if (!phrases.length) return "";
  return `
    <div class="phrase-list">
      <h3>常用搭配</h3>
      ${phrases.slice(0, 6).map((item) => `
        <div class="phrase-row">
          <strong>${escapeHtml(item.phrase)}</strong>
          <span>${escapeHtml(item.translation)}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function renderSpelling(word, target) {
  return `
    <div class="spell-area mini-game">
      <div class="spell-head">
        <div>
          <span class="stage-label">拼写打靶</span>
          <h2>把字母送到正确位置</h2>
        </div>
        <button id="speakBeforeBtn" class="secondary-btn" data-speak-word="${escapeAttr(word.word)}" type="button">播放单词读音</button>
      </div>
      <div class="combo-line">${state.streak >= 2 ? `连击 x${state.streak}` : "瞄准目标，开始拼写"}</div>
      <div class="answer-slots" id="answerSlots">
        ${target.split("").map(() => `<div class="slot"></div>`).join("")}
      </div>
      <div class="letter-bank" id="letterBank">
        ${state.bank.map((item) => `<button class="letter-card" data-id="${item.id}" type="button">${escapeHtml(item.letter)}</button>`).join("")}
      </div>
      <div class="feedback" id="feedback"></div>
      <div class="practice-controls">
        <button id="hintBtn" class="secondary-btn" type="button">提示</button>
        <button id="undoBtn" class="secondary-btn" type="button">撤回</button>
        <button id="clearBtn" class="secondary-btn" type="button">清空</button>
        <button id="prevBtn" class="secondary-btn" type="button">上一个</button>
        <button class="primary" id="nextBtn" type="button" disabled>下一个</button>
      </div>
      <div class="shortcut-hints">键盘：A-Z 拼写 · Backspace 撤回 · Delete/Esc 清空 · Enter 下一题 · Shift+Enter 上一题；其他按钮可用 Tab 聚焦后 Enter/Space 操作</div>
    </div>
  `;
}

function renderChoiceChallenge(word) {
  const question = state.choiceQuestion || buildPracticeQuestion(word, state.mode, state.entries);
  const stats = loadPracticeStats(state.mode);
  const modeTitle = state.mode === "en-cn" ? "英文选中文" : "中文选英文";
  return `
    <div class="choice-stage mini-game">
      <div class="spell-head">
        <div>
          <span class="stage-label">第 ${state.index + 1} 关</span>
          <h2>${escapeHtml(modeTitle)}</h2>
        </div>
        <div class="choice-score">本模式 ${stats.total || 0} 题 · 正确 ${stats.correct || 0}</div>
      </div>
      <div class="combo-line">${state.streak >= 2 ? `连击 x${state.streak}` : "选出正确答案，解锁记忆卡"}</div>
      <div class="practice-prompt">${escapeHtml(question.prompt)}</div>
      <div class="practice-options">
        ${question.options.map((option) => renderInlineChoiceOption(option)).join("")}
      </div>
      <div class="feedback ${state.choiceAnswered ? (question.options.find((item) => item.id === state.choiceSelected)?.correct ? "ok" : "bad") : ""}" id="choiceFeedback">
        ${state.choiceAnswered ? renderPracticeFeedback(question, state.choiceSelected) : "请选择一个答案。"}
      </div>
      <div class="practice-controls">
        <button id="prevBtn" class="secondary-btn" type="button">上一个</button>
        <button class="primary" id="nextBtn" type="button" ${state.choiceAnswered ? "" : "disabled"}>下一个</button>
      </div>
      <div class="shortcut-hints">键盘：1-4 选择答案 · Enter 下一题 · Shift+Enter 上一题</div>
    </div>
  `;
}

function renderInlineChoiceOption(option) {
  const selected = state.choiceSelected === option.id;
  const showResult = state.choiceAnswered;
  const className = [
    "practice-option",
    selected ? "selected" : "",
    showResult && option.correct ? "correct" : "",
    showResult && selected && !option.correct ? "wrong" : "",
  ].filter(Boolean).join(" ");
  return `
    <button class="${className}" data-choice-option="${escapeAttr(option.id)}" type="button" ${showResult ? "disabled" : ""}>
      ${escapeHtml(option.label)}
    </button>
  `;
}

function renderExamples(word, revealed) {
  return (word.examples || []).map((example) => `
    <div class="example-row">
      <button type="button" title="${escapeAttr(example.en)}" ${revealed ? `data-speak="${escapeAttr(example.en)}"` : "disabled"}>${escapeHtml(revealed ? example.en : maskExample(example.en, word))}</button>
      <span title="${escapeAttr(example.cn)}">${escapeHtml(example.cn)}</span>
    </div>
  `).join("");
}

function renderExamplesPanel(word) {
  if (state.mode !== "spelling") {
    if (state.revealed) {
      return `
        <div class="examples" id="examplesMount">
          ${renderExamples(word, true)}
        </div>
      `;
    }
    return `
      <div class="examples examples-guard" id="examplesMount">
        <div class="anti-cheat-note">
          <strong>例句已隐藏</strong>
          <span>本模式作答后会展示完整例句，避免提前看到答案。</span>
        </div>
      </div>
    `;
  }
  return `
    <div class="examples ${state.revealed ? "" : "examples-masked"}" id="examplesMount">
      ${renderExamples(word, state.revealed)}
    </div>
  `;
}

function formatPosLabel(word) {
  const cn = (word.pos_cn || []).filter(Boolean).join(" / ");
  const en = (word.pos || []).map((pos) => POS_EN_LABELS[pos] || pos).filter(Boolean).join(" / ");
  if (cn && en) return `${cn} · ${en}`;
  return cn || word.pos_raw || en || "";
}

function bindEvents() {
  document.querySelector("#resetBtn")?.addEventListener("click", () => {
    resetCurrentModeProgress();
    render();
  });
  document.querySelector("#hintBtn")?.addEventListener("click", useHint);
  document.querySelector("#undoBtn")?.addEventListener("click", undoLetter);
  document.querySelector("#clearBtn")?.addEventListener("click", clearLetters);
  document.querySelector("#prevBtn")?.addEventListener("click", prevWord);
  document.querySelector("#nextBtn")?.addEventListener("click", nextWord);
  document.querySelector("#settingsBtn")?.addEventListener("click", openSettingsModal);
  document.querySelector("#wrongListTopBtn")?.addEventListener("click", startWrongReview);
  document.querySelector("#userBtn")?.addEventListener("click", openUserModal);
  document.querySelector("#primaryMenuBtn")?.addEventListener("click", () => openTypeMenu("primary"));
  document.querySelector("#juniorMenuBtn")?.addEventListener("click", () => openTypeMenu("junior"));
  document.querySelector("#modeSpellingBtn")?.addEventListener("click", () => switchMode("spelling"));
  document.querySelector("#practiceEnCnBtn")?.addEventListener("click", () => switchMode("en-cn"));
  document.querySelector("#practiceCnEnBtn")?.addEventListener("click", () => switchMode("cn-en"));
  document.querySelector("#wordListBtn")?.addEventListener("click", () => openWordList(1));
  document.querySelector("#wrongListBtn")?.addEventListener("click", startWrongReview);
  document.querySelector("#dailyLogBtn")?.addEventListener("click", () => openDailyLog());
  document.querySelector("#toggleMeaningsBtn")?.addEventListener("click", () => toggleMeanings(true));
  document.querySelector("#collapseMeaningsBtn")?.addEventListener("click", () => toggleMeanings(false));
  document.querySelectorAll("[data-choice-option]").forEach((button) => {
    button.addEventListener("click", () => answerInlineChoice(button.dataset.choiceOption));
  });
  document.querySelectorAll(".letter-card").forEach((button) => {
    button.addEventListener("click", () => toggleLetter(button));
  });
  bindSpeakButtons();
  if (state.revealed) {
    document.querySelector("#nextBtn").disabled = false;
  }
  installKeyboardControls();
  installSpeakDelegation();
}

function bindSpeakButtons() {
  document.querySelectorAll("[data-speak]").forEach((button) => {
    if (button.dataset.boundSpeak === "1") return;
    button.dataset.boundSpeak = "1";
    button.addEventListener("click", () => speak(button.dataset.speak, button));
  });
}

async function switchMode(mode) {
  if (state.mode === mode) return;
  saveProgress();
  if (state.wrongReview?.active) state.wrongReview = null;
  state.mode = mode;
  localStorage.setItem(MODE_KEY, mode);
  state.activeCategory = localStorage.getItem(categoryStorageKey(PROFILE, state.mode)) || "";
  state.entries = filterEntriesByCategory(state.allEntries, state.activeCategory);
  if (state.activeCategory && !state.entries.length) {
    state.activeCategory = "";
    state.entries = state.allEntries;
    localStorage.removeItem(categoryStorageKey(PROFILE, state.mode));
  }
  state.learnedIds = loadLearned();
  state.wrongIds = loadWrong();
  state.index = clamp(Number(localStorage.getItem(progressKey()) || 0), 0, state.entries.length - 1);
  state.choiceQuestion = null;
  state.choiceAnswered = false;
  state.choiceSelected = "";
  state.meaningsExpanded = false;
  state.lastReward = "";
  if (state.user && state.serverReady) await loadUserProgress();
  render();
}

function shouldAutoSpeakCurrentWord() {
  if (state.mode === "spelling") return true;
  if (state.mode === "en-cn") return !state.choiceAnswered;
  return false;
}

function toggleMeanings(expanded) {
  state.meaningsExpanded = expanded;
  const mount = document.querySelector("#studyPanelMount");
  if (mount) mount.innerHTML = renderStudyPanel(currentWord(), state.learnedIds.has(currentWord().id));
  document.querySelector("#toggleMeaningsBtn")?.addEventListener("click", () => toggleMeanings(true));
  document.querySelector("#collapseMeaningsBtn")?.addEventListener("click", () => toggleMeanings(false));
}

function installKeyboardControls() {
  document.onkeydown = handleKeyboard;
}

function installSpeakDelegation() {
  app.onclick = (event) => {
    const button = event.target.closest("[data-speak-word]");
    if (!button || !app.contains(button)) return;
    speak(button.dataset.speakWord, button);
  };
}

function handleKeyboard(event) {
  if (shouldIgnoreShortcut(event)) return;
  const key = event.key;
  if (key === "Enter") {
    event.preventDefault();
    if (event.shiftKey) {
      prevWord();
      return;
    }
    const nextButton = document.querySelector("#nextBtn");
    if (nextButton && !nextButton.disabled) nextWord();
    return;
  }
  if (state.mode === "spelling") handleSpellingKeyboard(event);
  if (isChoicePracticeMode()) handleChoiceKeyboard(event);
}

function shouldIgnoreShortcut(event) {
  if (document.querySelector(".modal-backdrop")) return true;
  if (event.metaKey || event.ctrlKey || event.altKey) return true;
  const target = event.target;
  const tag = target?.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable;
}

function handleSpellingKeyboard(event) {
  const key = event.key.toLowerCase();
  if (/^[a-z]$/.test(key)) {
    event.preventDefault();
    selectLetterByKeyboard(key);
    return;
  }
  if (event.key === "Backspace") {
    event.preventDefault();
    undoLetter();
    return;
  }
  if (event.key === "Delete") {
    event.preventDefault();
    clearLetters();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    clearLetters();
  }
}

function handleChoiceKeyboard(event) {
  if (/^[1-4]$/.test(event.key) && !state.choiceAnswered) {
    const index = Number(event.key) - 1;
    const button = document.querySelectorAll("[data-choice-option]")[index];
    if (button) {
      event.preventDefault();
      answerInlineChoice(button.dataset.choiceOption);
    }
  }
}

function selectLetterByKeyboard(letter) {
  const buttons = [...document.querySelectorAll(".letter-card:not(.selected):not(:disabled)")];
  const button = buttons.find((item) => item.textContent.trim().toLowerCase() === letter);
  if (!button) {
    playSound("bad");
    document.querySelector(".spell-area")?.classList.add("soft-shake");
    window.setTimeout(() => document.querySelector(".spell-area")?.classList.remove("soft-shake"), 220);
    return;
  }
  playSound("click");
  selectLetter(button);
}

function prepareChoiceQuestion(word) {
  if (!isChoicePracticeMode()) {
    state.choiceQuestion = null;
    state.choiceAnswered = false;
    state.choiceSelected = "";
    return;
  }
  if (!state.choiceQuestion || state.choiceQuestion.word.id !== word.id || state.choiceQuestion.mode !== state.mode) {
    state.choiceQuestion = { ...buildPracticeQuestion(word, state.mode, state.entries), mode: state.mode };
    state.choiceAnswered = false;
    state.choiceSelected = "";
  }
}

function answerInlineChoice(optionId) {
  if (state.choiceAnswered || !state.choiceQuestion) return;
  playSound("click");
  const selected = state.choiceQuestion.options.find((option) => option.id === optionId);
  if (!selected) return;
  state.choiceAnswered = true;
  state.choiceSelected = optionId;
  const ok = selected.correct;
  recordPracticeResult(state.mode, state.choiceQuestion.word, selected, ok);
  if (ok) {
    state.streak += 1;
    playSound("ok");
    const wasLearned = state.learnedIds.has(state.choiceQuestion.word.id);
    state.learnedIds.add(state.choiceQuestion.word.id);
    saveLearned();
    const removedFromWrong = removeWrongAfterCorrect(state.choiceQuestion.word);
    recordDaily("learned", state.choiceQuestion.word);
    render();
    speak(state.choiceQuestion.word.word);
    flashReward(removedFromWrong ? "答对了，已移出错题" : (!wasLearned ? (state.streak >= 3 ? `连击 x${state.streak} · 已掌握 +1` : "已掌握 +1") : "答对了"));
  } else {
    state.streak = 0;
    playSound("bad");
    state.wrongIds.add(state.choiceQuestion.word.id);
    saveWrong();
    recordDaily("wrong", state.choiceQuestion.word);
    render();
  }
}

function renderChoiceResult() {
  const feedback = document.querySelector("#choiceFeedback");
  if (feedback && state.choiceQuestion) {
    const selected = state.choiceQuestion.options.find((item) => item.id === state.choiceSelected);
    feedback.innerHTML = renderPracticeFeedback(state.choiceQuestion, state.choiceSelected);
    feedback.className = `feedback ${selected?.correct ? "ok" : "bad"}`;
  }
  document.querySelectorAll("[data-choice-option]").forEach((button) => {
    const option = state.choiceQuestion.options.find((item) => item.id === button.dataset.choiceOption);
    button.disabled = true;
    button.classList.toggle("selected", button.dataset.choiceOption === state.choiceSelected);
    button.classList.toggle("correct", Boolean(option?.correct));
    button.classList.toggle("wrong", button.dataset.choiceOption === state.choiceSelected && !option?.correct);
  });
  const nextButton = document.querySelector("#nextBtn");
  if (nextButton) nextButton.disabled = false;
}

function toggleLetter(button) {
  playSound("click");
  if (button.classList.contains("selected")) {
    unselectLetter(button.dataset.id);
    return;
  }
  selectLetter(button);
}

function selectLetter(button) {
  const target = currentChallengeTarget();
  if (state.revealed) resetCurrentPractice();
  if (button.disabled || state.selected.length >= target.length) return;
  const item = state.bank.find((letter) => letter.id === button.dataset.id);
  const position = state.selected.length;
  state.selected.push({ ...item, hinted: false });
  button.classList.add("selected");
  button.classList.toggle("letter-hit", item.letter === target[position]);
  button.classList.toggle("letter-miss", item.letter !== target[position]);
  if (item.letter === target[position]) {
    const feedback = document.querySelector("#feedback");
    if (feedback) {
      feedback.textContent = "命中一个字母！";
      feedback.className = "feedback ok";
    }
  } else {
    button.classList.add("shake");
    window.setTimeout(() => button.classList.remove("shake"), 260);
  }
  renderSlots();
  if (state.selected.length === target.length) checkAnswer();
}

function unselectLetter(id) {
  if (state.revealed) resetCurrentPractice();
  const index = state.selected.findIndex((item) => item.id === id);
  if (index === -1) return;
  if (state.selected[index].hinted) return;
  state.selected.splice(index, 1);
  const button = document.querySelector(`[data-id="${id}"]`);
  if (button) button.classList.remove("selected", "letter-hit", "letter-miss");
  renderSlots();
}

function renderSlots() {
  const slots = [...document.querySelectorAll(".slot")];
  slots.forEach((slot, index) => {
    const value = state.selected[index]?.letter || "";
    slot.textContent = value;
    slot.classList.toggle("filled", Boolean(value));
    slot.classList.toggle("hinted", Boolean(state.selected[index]?.hinted));
  });
}

function checkAnswer() {
  const answer = state.selected.map((item) => item.letter).join("").toLowerCase();
  const target = currentChallengeTarget();
  const ok = answer === target;
  const feedback = document.querySelector("#feedback");
  feedback.textContent = ok ? "拼对了，真棒！" : "这次不对，再试一次。";
  feedback.className = `feedback ${ok ? "ok" : "bad"}`;
  playSound(ok ? "ok" : "bad");
  if (ok) {
    state.streak += 1;
    const removedFromWrong = removeWrongAfterCorrect(currentWord());
    revealWord();
    flashReward(removedFromWrong ? "答对了，已移出错题" : (state.streak >= 3 ? `连击 x${state.streak} · 已掌握 +1` : "星星奖励 +1"));
    document.querySelector("#nextBtn").disabled = false;
  } else {
    state.streak = 0;
    document.querySelector(".spell-area")?.classList.add("soft-shake");
    window.setTimeout(() => document.querySelector(".spell-area")?.classList.remove("soft-shake"), 260);
  }
}

function useHint() {
  if (state.revealed) return;
  const word = currentWord();
  const target = currentChallengeTarget(word);
  if (state.hintCount > 0 || target.length <= 1) {
    revealAsWrong();
    return;
  }
  const hintSize = Math.min(target.length - 1, Math.max(1, Math.ceil(target.length / 3)));
  state.hintCount = 1;
  state.selected = [];
  document.querySelectorAll(".letter-card").forEach((button) => {
    button.disabled = false;
    button.classList.remove("selected", "hint-locked", "letter-hit", "letter-miss");
  });
  for (let index = 0; index < hintSize; index += 1) {
    const item = findAvailableBankLetter(target[index]);
    if (!item) continue;
    state.selected.push({ ...item, hinted: true });
    const button = document.querySelector(`[data-id="${item.id}"]`);
    if (button) {
      button.classList.add("selected", "hint-locked");
      button.disabled = true;
    }
  }
  renderSlots();
  const feedback = document.querySelector("#feedback");
  feedback.textContent = `已提示前 ${state.selected.length} 个字母，再点提示会显示答案并加入错词。`;
  feedback.className = "feedback hint";
}

function revealAsWrong() {
  const word = currentWord();
  const target = currentChallengeTarget(word);
  state.wrongIds.add(word.id);
  saveWrong();
  recordDaily("wrong", word);
  const wrongButton = document.querySelector("#wrongListBtn");
  if (wrongButton) wrongButton.textContent = `错词练习 ${state.wrongIds.size}`;
  const wrongTop = document.querySelector("#wrongListTopBtn strong");
  if (wrongTop) wrongTop.textContent = String(state.wrongIds.size);
  state.hintCount = 2;
  state.selected = [];
  document.querySelectorAll(".letter-card").forEach((button) => {
    button.disabled = false;
    button.classList.remove("selected", "hint-locked", "letter-hit", "letter-miss");
  });
  for (const letter of target) {
    const item = findAvailableBankLetter(letter);
    if (!item) continue;
    state.selected.push({ ...item, hinted: true });
    const button = document.querySelector(`[data-id="${item.id}"]`);
    if (button) {
      button.classList.add("selected", "hint-locked");
      button.disabled = true;
    }
  }
  renderSlots();
  revealWord(false);
  document.querySelector("#nextBtn").disabled = false;
  const feedback = document.querySelector("#feedback");
  feedback.textContent = "已显示答案，并加入错词练习。";
  feedback.className = "feedback bad";
}

function findAvailableBankLetter(letter) {
  const used = new Set(state.selected.map((item) => item.id));
  return state.bank.find((item) => item.letter === letter && !used.has(item.id));
}

function findLastEditableSelectionIndex() {
  for (let index = state.selected.length - 1; index >= 0; index -= 1) {
    if (!state.selected[index].hinted) return index;
  }
  return -1;
}

function undoLetter() {
  if (state.revealed) {
    resetCurrentPractice();
    return;
  }
  const index = findLastEditableSelectionIndex();
  if (index === -1) return;
  const item = state.selected.splice(index, 1)[0];
  const button = document.querySelector(`[data-id="${item.id}"]`);
  if (button) {
    button.classList.remove("selected", "letter-hit", "letter-miss");
  }
  renderSlots();
}

function clearLetters() {
  if (state.revealed) {
    resetCurrentPractice();
    return;
  }
  const hinted = state.selected.filter((item) => item.hinted);
  state.selected = hinted;
  document.querySelectorAll(".letter-card").forEach((button) => {
    if (!button.classList.contains("hint-locked")) button.classList.remove("selected", "letter-hit", "letter-miss");
  });
  renderSlots();
  document.querySelector("#feedback").textContent = "";
}

function resetCurrentPractice() {
  state.revealed = false;
  state.selected = [];
  state.hintCount = 0;
  const examplesMount = document.querySelector("#examplesMount");
  if (examplesMount) {
    examplesMount.className = "examples examples-masked";
    examplesMount.innerHTML = renderExamples(currentWord(), false);
  }
  document.querySelector("#revealMount").innerHTML = renderHiddenMemory();
  document.querySelectorAll(".letter-card").forEach((button) => {
    button.disabled = false;
    button.classList.remove("selected", "letter-hit", "letter-miss");
    button.classList.remove("hint-locked");
  });
  document.querySelector("#nextBtn").disabled = true;
  document.querySelector("#feedback").textContent = "";
  renderSlots();
}

function nextWord() {
  if (state.wrongReview?.active) {
    moveWrongReview(1);
    return;
  }
  state.index = Math.min(state.entries.length - 1, state.index + 1);
  state.choiceQuestion = null;
  state.choiceAnswered = false;
  state.choiceSelected = "";
  state.meaningsExpanded = false;
  state.lastReward = "";
  saveProgress();
  render();
}

function prevWord() {
  if (state.wrongReview?.active) {
    moveWrongReview(-1);
    return;
  }
  state.index = Math.max(0, state.index - 1);
  state.choiceQuestion = null;
  state.choiceAnswered = false;
  state.choiceSelected = "";
  state.meaningsExpanded = false;
  state.lastReward = "";
  saveProgress();
  render();
}

function openSettingsModal() {
  document.querySelector("#modalMount").innerHTML = `
    <div class="modal-backdrop">
      <section class="modal panel settings-modal">
        <div class="modal-head">
          <h2>学习设置</h2>
          <button id="closeModalBtn" type="button">关闭</button>
        </div>
        <div class="settings-grid">
          <section class="settings-group">
            <h3>版本切换</h3>
            <button id="primaryMenuBtn" type="button">小学版</button>
            <button id="juniorMenuBtn" type="button">中学版</button>
          </section>
          <section class="settings-group">
            <h3>练习模式</h3>
            <button id="modeSpellingBtn" class="${state.mode === "spelling" ? "active" : ""}" type="button">拼写</button>
            <button id="practiceEnCnBtn" class="${state.mode === "en-cn" ? "active" : ""}" type="button">英文选中文</button>
            <button id="practiceCnEnBtn" class="${state.mode === "cn-en" ? "active" : ""}" type="button">中文选英文</button>
            <a class="settings-link" href="/sentence?from=${PROFILE}">进入句子练习</a>
          </section>
          <section class="settings-group">
            <h3>管理功能</h3>
            <button id="wordListBtn" type="button">查看全部词表</button>
            <button id="dailyLogBtn" type="button">学习记录</button>
            <button id="resetBtn" type="button">重置进度</button>
          </section>
          <section class="settings-group">
            <h3>学习者</h3>
            <button id="userBtn" type="button">${state.user ? "切换用户" : "输入名字"}</button>
          </section>
        </div>
      </section>
    </div>
  `;
  document.querySelector("#closeModalBtn").addEventListener("click", closeWordList);
  bindEvents();
}

async function openUserModal() {
  const users = await loadAvailableUsers();
  document.querySelector("#modalMount").innerHTML = `
    <div class="modal-backdrop">
      <section class="modal panel user-modal">
        <div class="modal-head">
          <h2>学习用户</h2>
          <button id="closeModalBtn" type="button">关闭</button>
        </div>
        <p class="muted">${state.serverReady ? "输入新名字会检查是否重名；选择已有用户会从服务端文件读取学习记录。" : "当前没有连接 Node 服务端，会先使用浏览器本地用户；上线时请运行 server.mjs 保存到服务端。"}</p>
        <div class="user-create-row">
          <input id="userNameInput" maxlength="20" placeholder="输入学习者名字" />
          <button class="primary" id="createUserBtn" type="button">${state.serverReady ? "创建用户" : "本地创建"}</button>
        </div>
        <div class="feedback" id="userFeedback"></div>
        <div class="user-list">
          ${users.length
            ? users.map((user) => `
              <button class="user-choice ${state.user?.id === user.id ? "active" : ""}" data-user-id="${escapeAttr(user.id)}" type="button">
                <strong>${escapeHtml(user.name)}</strong>
                <span>${escapeHtml(user.updatedAt ? `更新：${formatDateTime(user.updatedAt)}` : "未开始")}</span>
              </button>
            `).join("")
            : `<div class="empty-state">还没有用户，请先创建。</div>`}
        </div>
      </section>
    </div>
  `;
  document.querySelector("#closeModalBtn").addEventListener("click", closeWordList);
  document.querySelector("#createUserBtn")?.addEventListener("click", createUserFromModal);
  document.querySelectorAll("[data-user-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      await selectUserFromModal(button.dataset.userId || "", users);
    });
  });
}

async function createUserFromModal() {
  const input = document.querySelector("#userNameInput");
  const feedback = document.querySelector("#userFeedback");
  const name = input.value.trim();
  if (!name) {
    feedback.textContent = "请输入名字。";
    feedback.className = "feedback bad";
    return;
  }
  try {
    const user = state.serverReady ? await apiCreateUser(name) : createLocalUser(name);
    state.user = user;
    saveUserSession(user);
    if (state.serverReady) await flushUserProgressSync();
    closeWordList();
    render();
  } catch (error) {
    feedback.textContent = error.message || "创建失败。";
    feedback.className = "feedback bad";
    playSound("bad");
  }
}

async function selectUserFromModal(userId, users) {
  const localUser = users.find((item) => item.id === userId);
  if (!localUser) return;
  state.user = localUser;
  saveUserSession(localUser);
  if (state.serverReady) {
    await loadUserProgress();
  }
  closeWordList();
  render();
}

function startPractice(mode) {
  state.practice = buildPractice(mode);
  renderPractice();
}

function buildPractice(mode) {
  const words = shuffle([...state.entries]);
  return {
    mode,
    words,
    index: 0,
    answered: false,
    selected: "",
    current: buildPracticeQuestion(words[0], mode, words),
  };
}

function buildPracticeQuestion(word, mode, sourceWords) {
  const correct = practiceAnswer(word, mode);
  const optionWords = shuffle(sourceWords.filter((item) => item.id !== word.id)).slice(0, 3);
  const options = shuffle([word, ...optionWords]).map((item) => ({
    id: item.id,
    label: practiceAnswer(item, mode),
    word: item.word,
    correct: item.id === word.id,
  }));
  return {
    word,
    prompt: mode === "en-cn" ? word.word : formatMeanings(word),
    answer: correct,
    options,
  };
}

function renderPractice() {
  const practice = state.practice;
  const question = practice.current;
  const stats = loadPracticeStats(practice.mode);
  document.querySelector("#modalMount").innerHTML = `
    <div class="modal-backdrop">
      <section class="modal panel practice-modal">
        <div class="modal-head">
          <div>
            <h2>${practice.mode === "en-cn" ? "英文选中文" : "中文选英文"}</h2>
            <div class="muted">第 ${practice.index + 1} / ${practice.words.length} 题 · 本模式 ${stats.total} 题，正确 ${stats.correct}</div>
          </div>
          <button id="closeModalBtn" type="button">关闭</button>
        </div>
        <div class="practice-card">
          <div class="practice-prompt">${escapeHtml(question.prompt)}</div>
          <div class="practice-options">
            ${question.options.map((option) => renderPracticeOption(option, practice)).join("")}
          </div>
          <div class="feedback ${practice.answered ? (question.options.find((item) => item.id === practice.selected)?.correct ? "ok" : "bad") : ""}" id="practiceFeedback">
            ${practice.answered ? renderPracticeFeedback(question, practice.selected) : "请选择答案。"}
          </div>
          <div class="tag-row">
            <button id="practicePrevBtn" type="button" ${practice.index <= 0 ? "disabled" : ""}>上一题</button>
            <button class="primary" id="practiceNextBtn" type="button" ${practice.answered ? "" : "disabled"}>${practice.index >= practice.words.length - 1 ? "重新开始" : "下一题"}</button>
          </div>
        </div>
      </section>
    </div>
  `;
  document.querySelector("#closeModalBtn").addEventListener("click", closeWordList);
  document.querySelector("#practicePrevBtn").addEventListener("click", prevPracticeQuestion);
  document.querySelector("#practiceNextBtn").addEventListener("click", nextPracticeQuestion);
  document.querySelectorAll("[data-practice-option]").forEach((button) => {
    button.addEventListener("click", () => answerPractice(button.dataset.practiceOption));
  });
}

function renderPracticeOption(option, practice) {
  const selected = practice.selected === option.id;
  const showResult = practice.answered;
  const className = [
    "practice-option",
    selected ? "selected" : "",
    showResult && option.correct ? "correct" : "",
    showResult && selected && !option.correct ? "wrong" : "",
  ].filter(Boolean).join(" ");
  return `
    <button class="${className}" data-practice-option="${escapeAttr(option.id)}" type="button" ${showResult ? "disabled" : ""}>
      ${escapeHtml(option.label)}
    </button>
  `;
}

function answerPractice(optionId) {
  const practice = state.practice;
  if (!practice || practice.answered) return;
  playSound("click");
  const question = practice.current;
  const selected = question.options.find((option) => option.id === optionId);
  if (!selected) return;
  practice.answered = true;
  practice.selected = optionId;
  const ok = selected.correct;
  playSound(ok ? "ok" : "bad");
  recordPracticeResult(practice.mode, question.word, selected, ok);
  renderPractice();
}

function renderPracticeFeedback(question, selectedId) {
  const selected = question.options.find((option) => option.id === selectedId);
  if (selected?.correct) return "选对了，真棒！";
  return `这次不对。正确答案：${escapeHtml(question.answer)}`;
}

function nextPracticeQuestion() {
  const practice = state.practice;
  if (!practice) return;
  if (practice.index >= practice.words.length - 1) {
    state.practice = buildPractice(practice.mode);
    renderPractice();
    return;
  }
  practice.index += 1;
  practice.answered = false;
  practice.selected = "";
  practice.current = buildPracticeQuestion(practice.words[practice.index], practice.mode, practice.words);
  renderPractice();
}

function prevPracticeQuestion() {
  const practice = state.practice;
  if (!practice || practice.index <= 0) return;
  practice.index -= 1;
  practice.answered = false;
  practice.selected = "";
  practice.current = buildPracticeQuestion(practice.words[practice.index], practice.mode, practice.words);
  renderPractice();
}

function openWordList(page = 1) {
  state.listPage = clamp(page, 1, Math.ceil(state.entries.length / PAGE_SIZE));
  const start = (state.listPage - 1) * PAGE_SIZE;
  const words = state.entries.slice(start, start + PAGE_SIZE);
  const title = state.activeCategory ? `${state.activeCategory}词表` : "全部词表";
  document.querySelector("#modalMount").innerHTML = `
    <div class="modal-backdrop">
      <section class="modal panel">
        <div class="modal-head">
          <h2>${escapeHtml(title)}</h2>
          <button id="closeModalBtn" type="button">关闭</button>
        </div>
        <div class="word-table">
          ${words.map((word, offset) => renderWordListItem(word, start + offset)).join("")}
        </div>
        <div class="pager">
          <button id="pagePrevBtn" type="button" ${state.listPage <= 1 ? "disabled" : ""}>上一页</button>
          <span>第 ${state.listPage} / ${Math.ceil(state.entries.length / PAGE_SIZE)} 页</span>
          <button id="pageNextBtn" type="button" ${state.listPage >= Math.ceil(state.entries.length / PAGE_SIZE) ? "disabled" : ""}>下一页</button>
        </div>
      </section>
    </div>
  `;
  document.querySelector("#closeModalBtn").addEventListener("click", closeWordList);
  document.querySelector("#pagePrevBtn").addEventListener("click", () => openWordList(state.listPage - 1));
  document.querySelector("#pageNextBtn").addEventListener("click", () => openWordList(state.listPage + 1));
  document.querySelectorAll("[data-jump-index]").forEach((button) => {
    button.addEventListener("click", () => {
      state.index = Number(button.dataset.jumpIndex);
      saveProgress();
      closeWordList();
      render();
    });
  });
}

async function openTypeMenu(profile) {
  const data = profile === PROFILE
    ? { entries: state.allEntries }
    : await loadJson(DATA_URLS[profile]);
  const categories = countCategories(data.entries || []);
  const page = PROFILE_PAGE[profile];
  const allProgress = typeProgress(profile, data.entries || [], "");
  document.querySelector("#modalMount").innerHTML = `
    <div class="modal-backdrop">
      <section class="modal panel type-menu-modal">
        <div class="modal-head">
          <h2>${escapeHtml(LABELS[profile])} · 按类型学习</h2>
          <button id="closeModalBtn" type="button">关闭</button>
        </div>
        <div class="type-menu-grid">
          ${renderTypeMenuItem(page, "", data.entries.length, profile === PROFILE && !state.activeCategory, allProgress)}
          ${categories.map(([category, count]) => renderTypeMenuItem(page, category, count, profile === PROFILE && category === state.activeCategory, typeProgress(profile, data.entries || [], category))).join("")}
        </div>
      </section>
    </div>
  `;
  document.querySelector("#closeModalBtn").addEventListener("click", closeWordList);
}

function renderTypeMenuItem(page, category, count, active, progress) {
  const label = category || "全部单词";
  const href = category ? `./${page}?category=${encodeURIComponent(category)}` : `./${page}?category=`;
  return `
    <a class="type-menu-item ${active ? "active" : ""}" href="${escapeAttr(href)}">
      <strong>${escapeHtml(label)}</strong>
      <span>${count} 个词</span>
      <em>已学 ${progress.learned}/${progress.total} · 进度 ${progress.current}/${progress.total}</em>
    </a>
  `;
}

function countCategories(entries) {
  const counts = new Map();
  for (const entry of entries) counts.set(entry.category || "未分类", (counts.get(entry.category || "未分类") || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function typeProgress(profile, entries, category) {
  const scoped = filterEntriesByCategory(entries, category);
  const total = Math.max(1, scoped.length);
  const learnedIds = loadLearnedForProfile(profile, state.mode);
  const learned = scoped.filter((entry) => learnedIds.has(entry.id)).length;
  const storedIndex = Number(localStorage.getItem(progressStorageKey(profile, category, state.mode)));
  const current = Number.isFinite(storedIndex) ? clamp(storedIndex + 1, 1, total) : 1;
  return { learned, current, total };
}

function openWrongList() {
  startWrongReview();
}

function startWrongReview() {
  const wrongEntries = getWrongReviewEntries();
  if (!wrongEntries.length) {
    flashReward("当前模式没有错题");
    return;
  }
  if (!state.wrongReview?.active) {
    state.wrongReview = {
      active: true,
      returnCategory: state.activeCategory,
      returnIndex: state.index,
    };
  }
  state.entries = wrongEntries;
  state.index = 0;
  resetQuestionState();
  closeWordList();
  render();
}

function getWrongReviewEntries() {
  return state.allEntries.filter((word) => state.wrongIds.has(word.id));
}

function moveWrongReview(direction) {
  const currentId = currentWord()?.id;
  const wrongEntries = getWrongReviewEntries();
  if (!wrongEntries.length) {
    finishWrongReview("错题清空了");
    return;
  }

  const currentStillWrong = currentId && state.wrongIds.has(currentId);
  const currentWrongIndex = wrongEntries.findIndex((word) => word.id === currentId);
  let nextIndex = currentStillWrong && currentWrongIndex >= 0
    ? currentWrongIndex + direction
    : state.index + (direction < 0 ? -1 : 0);

  if (nextIndex >= wrongEntries.length) nextIndex = 0;
  if (nextIndex < 0) nextIndex = wrongEntries.length - 1;

  state.entries = wrongEntries;
  state.index = clamp(nextIndex, 0, wrongEntries.length - 1);
  resetQuestionState();
  render();
}

function finishWrongReview(message = "") {
  const review = state.wrongReview;
  state.wrongReview = null;
  state.activeCategory = review?.returnCategory || state.activeCategory || "";
  state.entries = filterEntriesByCategory(state.allEntries, state.activeCategory);
  state.index = clamp(review?.returnIndex || 0, 0, state.entries.length - 1);
  resetQuestionState();
  render();
  if (message) flashReward(message);
}

function removeWrongAfterCorrect(word) {
  if (!word?.id || !state.wrongIds.has(word.id)) return false;
  state.wrongIds.delete(word.id);
  saveWrong();
  const wrongTop = document.querySelector("#wrongListTopBtn strong");
  if (wrongTop) wrongTop.textContent = String(state.wrongIds.size);
  return true;
}

function resetQuestionState() {
  state.selected = [];
  state.bank = [];
  state.revealed = false;
  state.choiceQuestion = null;
  state.choiceAnswered = false;
  state.choiceSelected = "";
  state.meaningsExpanded = false;
  state.lastReward = "";
  state.hintCount = 0;
}

function openDailyLog() {
  const log = loadDailyLog();
  const dates = Object.keys(log).sort((a, b) => b.localeCompare(a));
  document.querySelector("#modalMount").innerHTML = `
    <div class="modal-backdrop">
      <section class="modal panel">
        <div class="modal-head">
          <h2>学习记录</h2>
          <button id="closeModalBtn" type="button">关闭</button>
        </div>
        <div class="daily-log">
          ${dates.length
            ? dates.map((date) => renderDailyLogDay(date, log[date])).join("")
            : `<div class="empty-state">还没有学习记录。打开单词后会自动按天记录。</div>`}
        </div>
      </section>
    </div>
  `;
  document.querySelector("#closeModalBtn").addEventListener("click", closeWordList);
  document.querySelectorAll("[data-daily-index]").forEach((button) => {
    button.addEventListener("click", () => {
      state.index = Number(button.dataset.dailyIndex);
      saveProgress();
      closeWordList();
      render();
    });
  });
}

function renderDailyLogDay(date, day) {
  const viewed = day.viewed || [];
  const learned = new Set(day.learned || []);
  const wrong = new Set(day.wrong || []);
  return `
    <section class="daily-card">
      <div class="daily-head">
        <strong>${escapeHtml(date)}</strong>
        <span>看过 ${viewed.length} · 拼对 ${learned.size} · 错词 ${wrong.size}</span>
      </div>
      <div class="daily-words">
        ${viewed.map((id) => renderDailyWordChip(id, learned, wrong)).join("")}
      </div>
    </section>
  `;
}

function renderDailyWordChip(id, learned, wrong) {
  const index = state.entries.findIndex((word) => word.id === id);
  const word = state.entries[index];
  if (!word) return "";
  const status = wrong.has(id) ? "wrong" : learned.has(id) ? "learned" : "viewed";
  const label = wrong.has(id) ? "错" : learned.has(id) ? "对" : "看";
  return `
    <button class="daily-word ${status}" data-daily-index="${index}" type="button" title="${escapeAttr(word.meanings.join("；"))}">
      <span>${label}</span>${escapeHtml(word.word)}
    </button>
  `;
}

function renderWrongListItem(word, index) {
  const example = word.examples?.[0];
  return `
    <article class="word-list-item wrong">
      <div>
        <strong>${index + 1}. ${escapeHtml(word.word)}</strong>
        <span class="muted">${escapeHtml(formatPosLabel(word))}</span>
      </div>
      <p>${escapeHtml(word.meanings.join("；"))}</p>
      ${example ? `<p><span class="muted">例句：</span>${escapeHtml(example.en)}<br><span class="muted">释义：</span>${escapeHtml(example.cn)}</p>` : ""}
      <button data-wrong-index="${index}" type="button">练习这个词</button>
    </article>
  `;
}

function renderWordListItem(word, index) {
  const example = word.examples?.[0];
  const learned = state.learnedIds.has(word.id);
  return `
    <article class="word-list-item ${learned ? "learned" : ""}">
      <div>
        <strong>${index + 1}. ${learned ? "✓ " : ""}${escapeHtml(word.word)}</strong>
        <span class="muted">${escapeHtml(formatPosLabel(word))}</span>
      </div>
      <p>${escapeHtml(word.meanings.join("；"))}</p>
      ${word.phrases?.length ? `<p><span class="muted">搭配：</span>${escapeHtml(word.phrases.slice(0, 3).map((item) => `${item.phrase}：${item.translation}`).join("；"))}</p>` : ""}
      ${example ? `<p><span class="muted">例句：</span>${escapeHtml(example.en)}<br><span class="muted">释义：</span>${escapeHtml(example.cn)}</p>` : ""}
      <button data-jump-index="${index}" type="button">学习这个词</button>
    </article>
  `;
}

function closeWordList() {
  document.querySelector("#modalMount").innerHTML = "";
}

function currentWord() {
  return state.entries[state.index];
}

function filterEntriesByCategory(entries, category) {
  return category ? entries.filter((entry) => entry.category === category) : entries;
}

function saveProgress() {
  if (state.wrongReview?.active) return;
  localStorage.setItem(progressKey(), String(state.index));
  syncUserProgress();
}

function migrateLegacyLocalStorage(profile) {
  const marker = `enstudy.simple.${profile}.migration.modeScopedProgress.v2`;
  if (localStorage.getItem(marker) === "done") return;

  const legacyCategory = localStorage.getItem(`enstudy.simple.${profile}.category.v1`);
  if (legacyCategory) {
    for (const mode of LEARNING_MODES) {
      copyLocalValueIfMissing(`enstudy.simple.${profile}.${mode}.category.v1`, legacyCategory);
    }
  }

  migrateLegacyProgressKeys(profile);
  migrateLegacyJsonValue(profile, "learned", []);
  migrateLegacyJsonValue(profile, "wrong", []);
  migrateLegacyJsonValue(profile, "daily", {});
  migrateLegacyPracticeStats(profile);
  localStorage.setItem(marker, "done");
}

function migrateLegacyProgressKeys(profile) {
  const oldBase = `enstudy.simple.${profile}.progress`;
  const progressKeys = Object.keys(localStorage)
    .filter((key) => key === `${oldBase}.v1` || key.startsWith(`${oldBase}.category.`));
  for (const oldKey of progressKeys) {
    const suffix = oldKey === `${oldBase}.v1` ? ".v1" : oldKey.slice(oldBase.length);
    const value = localStorage.getItem(oldKey);
    for (const mode of LEARNING_MODES) {
      copyLocalValueIfMissing(`enstudy.simple.${profile}.${mode}.progress${suffix}`, value);
    }
  }
}

function migrateLegacyJsonValue(profile, segment, fallback) {
  const raw = localStorage.getItem(`enstudy.simple.${profile}.${segment}.v1`);
  if (raw == null) return;
  let parsed = fallback;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = fallback;
  }
  for (const mode of LEARNING_MODES) {
    const targetKey = `enstudy.simple.${profile}.${mode}.${segment}.v1`;
    if (localStorage.getItem(targetKey) == null) {
      localStorage.setItem(targetKey, JSON.stringify(parsed));
    }
  }
}

function migrateLegacyPracticeStats(profile) {
  const oldPrefix = `enstudy.simple.${profile}.practice.`;
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith(oldPrefix) || !key.endsWith(".v1")) continue;
    for (const mode of LEARNING_MODES) {
      const oldModeSuffix = `.${mode}.v1`;
      if (!key.endsWith(oldModeSuffix)) continue;
      const category = key.slice(oldPrefix.length, -oldModeSuffix.length) || "all";
      copyLocalValueIfMissing(`enstudy.simple.${profile}.${mode}.practice.${category}.v1`, localStorage.getItem(key));
    }
  }
}

function copyLocalValueIfMissing(targetKey, value) {
  if (value == null) return;
  if (localStorage.getItem(targetKey) == null) localStorage.setItem(targetKey, value);
}

function resetCurrentModeProgress() {
  const mode = state.mode;
  const prefix = modeStoragePrefix(PROFILE, mode);
  for (const key of Object.keys(localStorage)) {
    const isCurrentModeProgress = key.startsWith(`${prefix}.progress`);
    const isCurrentModePractice = key.startsWith(`${prefix}.practice.`);
    const isCurrentModeState = key === learnedStorageKey(PROFILE, mode)
      || key === wrongStorageKey(PROFILE, mode)
      || key === dailyStorageKey(PROFILE, mode);
    const isLegacyPractice = key.startsWith(`enstudy.simple.${PROFILE}.practice.`) && key.endsWith(`.${mode}.v1`);
    if (isCurrentModeProgress || isCurrentModePractice || isCurrentModeState || isLegacyPractice) {
      localStorage.removeItem(key);
    }
  }
  state.index = 0;
  state.learnedIds = new Set();
  state.wrongIds = new Set();
  state.streak = 0;
  state.lastReward = "";
  state.choiceQuestion = null;
  state.choiceAnswered = false;
  state.choiceSelected = "";
  state.meaningsExpanded = false;
  localStorage.setItem(progressKey(), "0");
  localStorage.setItem(learnedStorageKey(), JSON.stringify([]));
  localStorage.setItem(wrongStorageKey(), JSON.stringify([]));
  localStorage.setItem(dailyStorageKey(), JSON.stringify({}));
  syncUserProgress({ resetMode: true });
}

function progressKey() {
  return progressStorageKey(PROFILE, state.activeCategory, state.mode);
}

function modeStoragePrefix(profile = PROFILE, mode = state.mode) {
  return `enstudy.simple.${profile}.${mode || "spelling"}`;
}

function profileModeKey(profile = PROFILE, mode = state.mode) {
  return `${profile}:${mode || "spelling"}`;
}

function categoryStorageKey(profile = PROFILE, mode = state.mode) {
  return `${modeStoragePrefix(profile, mode)}.category.v1`;
}

function progressStorageKey(profile, category = "", mode = state.mode) {
  const base = `${modeStoragePrefix(profile, mode)}.progress`;
  return category ? `${base}.category.${slugify(category)}.v1` : `${base}.v1`;
}

function learnedStorageKey(profile = PROFILE, mode = state.mode) {
  return `${modeStoragePrefix(profile, mode)}.learned.v1`;
}

function wrongStorageKey(profile = PROFILE, mode = state.mode) {
  return `${modeStoragePrefix(profile, mode)}.wrong.v1`;
}

function dailyStorageKey(profile = PROFILE, mode = state.mode) {
  return `${modeStoragePrefix(profile, mode)}.daily.v1`;
}

function loadLearned() {
  try {
    return loadLearnedForProfile(PROFILE, state.mode);
  } catch {
    return new Set();
  }
}

function loadLearnedForProfile(profile, mode = state.mode) {
  try {
    return new Set(JSON.parse(localStorage.getItem(learnedStorageKey(profile, mode))) || []);
  } catch {
    return new Set();
  }
}

function saveLearned() {
  localStorage.setItem(learnedStorageKey(), JSON.stringify([...state.learnedIds]));
  syncUserProgress();
}

function loadWrong() {
  try {
    return new Set(JSON.parse(localStorage.getItem(wrongStorageKey())) || []);
  } catch {
    return new Set();
  }
}

function saveWrong() {
  localStorage.setItem(wrongStorageKey(), JSON.stringify([...state.wrongIds]));
  syncUserProgress();
}

function recordDaily(type, word) {
  if (!word?.id) return;
  const date = todayKey();
  const log = loadDailyLog();
  const day = log[date] || { viewed: [], learned: [], wrong: [] };
  day.viewed = addUnique(day.viewed, word.id);
  if (type === "learned") day.learned = addUnique(day.learned, word.id);
  if (type === "wrong") day.wrong = addUnique(day.wrong, word.id);
  log[date] = day;
  saveDailyLog(log);
}

function consecutiveDays() {
  const log = loadDailyLog();
  let count = 0;
  const date = new Date();
  for (;;) {
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    if (!log[key]) break;
    count += 1;
    date.setDate(date.getDate() - 1);
  }
  return Math.max(count, Object.keys(log).length ? 1 : 0);
}

function flashReward(text) {
  state.lastReward = text;
  document.querySelector(".reward-pop")?.remove();
  const node = document.createElement("div");
  node.className = "reward-pop";
  node.textContent = text;
  document.body.appendChild(node);
  window.clearTimeout(flashReward.timer);
  flashReward.timer = window.setTimeout(() => {
    state.lastReward = "";
    document.querySelector(".reward-pop")?.remove();
  }, 1400);
}

function loadDailyLog() {
  try {
    return JSON.parse(localStorage.getItem(dailyStorageKey())) || {};
  } catch {
    return {};
  }
}

function saveDailyLog(log) {
  localStorage.setItem(dailyStorageKey(), JSON.stringify(log));
  syncUserProgress();
}

async function checkServerReady() {
  try {
    const response = await fetch(`${API_BASE}/health`, { cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

async function loadUserProgress() {
  if (!state.user || !state.serverReady) return;
  try {
    const response = await fetch(`${API_BASE}/users/${encodeURIComponent(state.user.id)}/progress`, { cache: "no-store" });
    if (!response.ok) throw new Error("读取服务端学习记录失败");
    const data = await response.json();
    const user = data.user;
    state.user = { id: user.id, name: user.name, createdAt: user.createdAt, updatedAt: user.updatedAt };
    saveUserSession(state.user);

    const serverIndex = user.progress?.[progressKey()];
    state.index = Number.isFinite(Number(serverIndex)) ? clamp(Number(serverIndex), 0, state.entries.length - 1) : 0;
    localStorage.setItem(progressKey(), String(state.index));

    const scopedKey = profileModeKey();
    state.learnedIds = new Set(Array.isArray(user.learned?.[scopedKey]) ? user.learned[scopedKey] : []);
    state.wrongIds = new Set(Array.isArray(user.wrong?.[scopedKey]) ? user.wrong[scopedKey] : []);
    localStorage.setItem(learnedStorageKey(), JSON.stringify([...state.learnedIds]));
    localStorage.setItem(wrongStorageKey(), JSON.stringify([...state.wrongIds]));
    localStorage.setItem(dailyStorageKey(), JSON.stringify(user.daily?.[scopedKey] || {}));
    state.serverUserLoaded = true;
  } catch {
    state.serverReady = false;
  }
}

let syncTimer = 0;
let pendingSyncResets = [];
function syncUserProgress(options = {}) {
  if (!state.user || !state.serverReady) return;
  if (options.resetMode) pendingSyncResets.push({ profile: PROFILE, mode: state.mode });
  window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => {
    const resets = pendingSyncResets;
    pendingSyncResets = [];
    fetch(`${API_BASE}/users/${encodeURIComponent(state.user.id)}/progress`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildUserProgressPayload({ resets })),
    })
      .then((response) => {
        if (!response.ok) throw new Error("sync_failed");
        return response.json();
      })
      .then((data) => {
        if (data.user) {
          state.user = { id: data.user.id, name: data.user.name, createdAt: data.user.createdAt, updatedAt: data.user.updatedAt };
          saveUserSession(state.user);
        }
      })
      .catch(() => {
        state.serverMessage = "服务端同步失败，已保留本地记录";
      });
  }, 180);
}

async function flushUserProgressSync(options = {}) {
  if (!state.user || !state.serverReady) return;
  if (options.resetMode) pendingSyncResets.push({ profile: PROFILE, mode: state.mode });
  window.clearTimeout(syncTimer);
  const resets = pendingSyncResets;
  pendingSyncResets = [];
  const response = await fetch(`${API_BASE}/users/${encodeURIComponent(state.user.id)}/progress`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildUserProgressPayload({ resets })),
  });
  if (!response.ok) throw new Error("保存用户学习记录失败");
  const data = await response.json();
  if (data.user) {
    state.user = { id: data.user.id, name: data.user.name, createdAt: data.user.createdAt, updatedAt: data.user.updatedAt };
    saveUserSession(state.user);
  }
}

function buildUserProgressPayload({ resets = [] } = {}) {
  const scopedKey = profileModeKey();
  const progressIndex = state.wrongReview?.active ? (state.wrongReview.returnIndex || 0) : state.index;
  return {
    resets,
    progress: { [progressKey()]: progressIndex },
    learned: { [scopedKey]: [...state.learnedIds] },
    wrong: { [scopedKey]: [...state.wrongIds] },
    daily: { [scopedKey]: loadDailyLog() },
  };
}

async function apiGetUsers() {
  const response = await fetch(`${API_BASE}/users`, { cache: "no-store" });
  if (!response.ok) throw new Error("读取用户失败");
  const data = await response.json();
  return data.users || [];
}

async function loadAvailableUsers() {
  const localUsers = loadLocalUsers();
  if (!state.serverReady) return localUsers;
  try {
    const serverUsers = await apiGetUsers();
    return mergeUsers(serverUsers, localUsers);
  } catch {
    state.serverReady = false;
    return localUsers;
  }
}

async function apiCreateUser(name) {
  const response = await fetch(`${API_BASE}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "创建用户失败");
  return data.user;
}

function loadUserSession() {
  try {
    return JSON.parse(localStorage.getItem(USER_SESSION_KEY)) || null;
  } catch {
    return null;
  }
}

function saveUserSession(user) {
  localStorage.setItem(USER_SESSION_KEY, JSON.stringify({ id: user.id, name: user.name, createdAt: user.createdAt, updatedAt: user.updatedAt }));
}

function migrateSharedLocalUsers() {
  const users = mergeUsers(readUsersFromStorage(LOCAL_USERS_KEY), readUsersFromStorage(LEGACY_SENTENCE_LOCAL_USERS_KEY));
  if (users.length) localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
}

function loadLocalUsers() {
  return readUsersFromStorage(LOCAL_USERS_KEY);
}

function readUsersFromStorage(key) {
  try {
    const users = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(users) ? users.filter((user) => user?.id && user?.name) : [];
  } catch {
    return [];
  }
}

function saveLocalUsers(users) {
  localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(mergeUsers(users)));
}

function createLocalUser(name) {
  const users = loadLocalUsers();
  if (users.some((user) => user.name.toLowerCase() === name.toLowerCase())) {
    throw new Error("名字已存在，请换一个名字");
  }
  const now = new Date().toISOString();
  const user = { id: `${encodeURIComponent(name)}-${Date.now().toString(36)}`, name, createdAt: now, updatedAt: now };
  saveLocalUsers([...users, user]);
  return user;
}

function mergeUsers(...groups) {
  const map = new Map();
  for (const user of groups.flat()) {
    if (!user?.id || !user?.name) continue;
    const previous = map.get(user.id);
    if (!previous || String(user.updatedAt || user.createdAt || "").localeCompare(String(previous.updatedAt || previous.createdAt || "")) > 0) {
      map.set(user.id, user);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

function practiceStorageKey(mode) {
  const category = state.activeCategory ? slugify(state.activeCategory) : "all";
  return `${modeStoragePrefix(PROFILE, mode)}.practice.${category}.v1`;
}

function loadPracticeStats(mode) {
  try {
    return JSON.parse(localStorage.getItem(practiceStorageKey(mode))) || { total: 0, correct: 0, wrong: 0, records: [] };
  } catch {
    return { total: 0, correct: 0, wrong: 0, records: [] };
  }
}

function savePracticeStats(mode, stats) {
  localStorage.setItem(practiceStorageKey(mode), JSON.stringify({ ...stats, records: (stats.records || []).slice(-200) }));
}

function recordPracticeResult(mode, word, selected, ok) {
  const record = {
    profile: PROFILE,
    category: state.activeCategory || "",
    mode,
    wordId: word.id,
    word: word.word,
    selected: selected.label,
    answer: practiceAnswer(word, mode),
    correct: ok,
    createdAt: new Date().toISOString(),
  };
  const stats = loadPracticeStats(mode);
  stats.total = (stats.total || 0) + 1;
  stats.correct = (stats.correct || 0) + (ok ? 1 : 0);
  stats.wrong = (stats.wrong || 0) + (ok ? 0 : 1);
  stats.records = [...(stats.records || []), record].slice(-200);
  savePracticeStats(mode, stats);
  if (state.user && state.serverReady) {
    fetch(`${API_BASE}/users/${encodeURIComponent(state.user.id)}/practice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
    }).catch(() => {});
  }
}

function practiceAnswer(word, mode) {
  return mode === "en-cn" ? formatMeanings(word) : word.word;
}

function currentChallengeTarget(word = currentWord()) {
  return spellingTarget(word.word);
}

function formatMeanings(word) {
  return (word.meanings || []).slice(0, 3).join("；");
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function todayKey() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addUnique(list = [], value) {
  return list.includes(value) ? list : [...list, value];
}

function slugify(value) {
  return encodeURIComponent(String(value || "").trim()).replace(/%/g, "_");
}

function buildLetterBank(word) {
  const letters = spellingTarget(word).split("");
  const distractorCount = Math.max(2, Math.ceil(letters.length / 2));
  const distractors = [];
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  while (distractors.length < distractorCount) {
    const letter = alphabet[Math.floor(Math.random() * alphabet.length)];
    if (!letters.includes(letter) || Math.random() > 0.5) distractors.push(letter);
  }
  return shuffle([...letters, ...distractors].map((letter, index) => ({ id: `${letter}-${index}-${Math.random()}`, letter })));
}

function spellingTarget(word) {
  return String(word).toLowerCase().replace(/[^a-z]/g, "");
}

function maskExample(sentence, word) {
  const masks = buildMaskWords(word).sort((a, b) => b.length - a.length);
  let masked = sentence;
  for (const item of masks) {
    masked = masked.replace(new RegExp(`\\b${escapeRegExp(item)}\\b`, "gi"), "____");
  }
  return masked;
}

function buildMaskWords(word) {
  const values = [word.word, word.display];
  if (word.forms?.verb) values.push(...Object.values(word.forms.verb));
  if (word.forms?.noun) values.push(...Object.values(word.forms.noun));
  if (word.forms?.adjective) values.push(...Object.values(word.forms.adjective));
  if (word.forms?.variants) values.push(...word.forms.variants);
  return [...new Set(values
    .flatMap((value) => String(value).split("/"))
    .map((value) => value.toLowerCase().replace(/[^a-z]/g, ""))
    .filter(Boolean))];
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function playSound(kind) {
  const url = SOUND_URLS[kind];
  if (!url) return;
  try {
    const audio = getSound(kind).cloneNode();
    audio.volume = kind === "click" ? 0.45 : 0.75;
    audio.play().catch(() => {});
  } catch {
    // Sound feedback should never block spelling practice.
  }
}

function getSound(kind) {
  if (!soundPool[kind]) {
    const audio = new Audio(SOUND_URLS[kind]);
    audio.preload = "auto";
    soundPool[kind] = audio;
  }
  return soundPool[kind];
}

function speak(text, sourceButton = null) {
  if (!text) return;
  autoSpeakToken += 1;
  cancelVoice();
  setSpeakingButtonState(sourceButton, true);
  playYoudaoVoice(text)
    .catch(() => speakWithBrowser(text))
    .finally(() => setSpeakingButtonState(sourceButton, false));
}

function setSpeakingButtonState(button, active) {
  if (!button) return;
  if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
  button.textContent = active ? "播放中..." : button.dataset.originalText;
  button.classList.toggle("speaking", active);
}

function autoSpeakWord(text) {
  if (!text) return;
  const token = ++autoSpeakToken;
  cancelVoice();
  speakRepeatedly(text, AUTO_SPEAK_TIMES, token);
}

async function speakRepeatedly(text, count, token) {
  if (token !== autoSpeakToken || count <= 0) return;
  try {
    await playYoudaoVoice(text);
  } catch {
    await speakWithBrowser(text);
  }
  if (token !== autoSpeakToken) return;
  window.setTimeout(() => speakRepeatedly(text, count - 1, token), 260);
}

function playYoudaoVoice(text) {
  return new Promise((resolve, reject) => {
    const audio = new Audio(`https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&type=2`);
    const timer = window.setTimeout(() => reject(new Error("voice_timeout")), 4500);
    activeVoiceAudio = audio;
    audio.preload = "auto";
    audio.onended = () => {
      window.clearTimeout(timer);
      resolve();
    };
    audio.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("voice_error"));
    };
    audio.play().catch(reject);
  });
}

function speakWithBrowser(text) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window) || !text) {
      resolve();
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 0.82;
    utterance.onend = resolve;
    utterance.onerror = resolve;
    window.speechSynthesis.speak(utterance);
  });
}

function cancelVoice() {
  if (activeVoiceAudio) {
    activeVoiceAudio.pause();
    activeVoiceAudio.src = "";
    activeVoiceAudio = null;
  }
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

function shuffle(items) {
  const arr = [...items];
  for (let index = arr.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [arr[index], arr[swap]] = [arr[swap], arr[index]];
  }
  return arr;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

function trimLong(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}
