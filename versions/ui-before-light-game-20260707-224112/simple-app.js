const PROFILE = document.body.dataset.profile || "primary";
const DATA_URLS = {
  primary: "./simple/data/primary_words.json",
  junior: "./simple/data/junior_words.json",
};
const LABELS = {
  primary: "小学英语单词",
  junior: "中学英语单词",
};
const PROFILE_PAGE = {
  primary: "primary.html",
  junior: "junior.html",
};
const STORE_KEY = `enstudy.simple.${PROFILE}.progress.v1`;
const LEARNED_KEY = `enstudy.simple.${PROFILE}.learned.v1`;
const WRONG_KEY = `enstudy.simple.${PROFILE}.wrong.v1`;
const DAILY_KEY = `enstudy.simple.${PROFILE}.daily.v1`;
const PAGE_SIZE = 20;
const AUTO_SPEAK_TIMES = 3;
const USER_SESSION_KEY = "enstudy.simple.activeUser.v1";
const API_BASE = "./api";
const SOUND_URLS = {
  click: "./simple/sounds/click.wav",
  bad: "./simple/sounds/beep.wav",
  ok: "./simple/sounds/correct.mp3",
};

const state = {
  allEntries: [],
  entries: [],
  activeCategory: new URLSearchParams(window.location.search).get("category") || "",
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
  practice: null,
  hintCount: 0,
  listPage: 1,
};

const app = document.querySelector("#app");
let autoSpeakToken = 0;
let activeVoiceAudio = null;
const soundPool = {};

init();

async function init() {
  const data = await loadJson(DATA_URLS[PROFILE]);
  state.allEntries = data.entries;
  state.entries = filterEntriesByCategory(state.allEntries, state.activeCategory);
  if (state.activeCategory && !state.entries.length) {
    state.activeCategory = "";
    state.entries = state.allEntries;
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

function render() {
  if (!state.entries.length) {
    state.activeCategory = "";
    state.entries = state.allEntries;
    state.index = 0;
  }
  const word = currentWord();
  const target = spellingTarget(word.word);
  const isLearned = state.learnedIds.has(word.id);
  state.selected = [];
  state.bank = buildLetterBank(target);
  state.revealed = isLearned;
  state.hintCount = 0;
  app.innerHTML = `
    <header class="top">
      <div>
        <h1>${LABELS[PROFILE]}${state.activeCategory ? ` · ${escapeHtml(state.activeCategory)}` : ""}</h1>
        <div class="muted">进度 ${state.index + 1} / ${state.entries.length} · 已学 ${state.learnedIds.size}</div>
      </div>
      <div class="top-actions">
        ${renderLearnedBadge(isLearned)}
        ${renderUserBadge()}
        <button id="userBtn" type="button">${state.user ? "切换用户" : "输入名字"}</button>
        <button id="primaryMenuBtn" type="button">小学版</button>
        <button id="juniorMenuBtn" type="button">中学版</button>
        <button id="practiceEnCnBtn" type="button">英文选中文</button>
        <button id="practiceCnEnBtn" type="button">中文选英文</button>
        <button id="wordListBtn" type="button">查看全部词表</button>
        <button id="wrongListBtn" type="button">错词练习 ${state.wrongIds.size}</button>
        <button id="dailyLogBtn" type="button">学习记录</button>
        <button id="resetBtn" type="button">重置进度</button>
      </div>
    </header>
    <section class="panel word-hero">
      <div class="learn-grid">
        <div class="image-frame">
          <img src="${escapeAttr(word.image.url)}" alt="${escapeAttr(word.word)}" referrerpolicy="no-referrer" />
        </div>
        <div class="info-block">
          <div class="tag-row">
            <span class="tag">${escapeHtml(word.category)}</span>
            <span class="tag">${escapeHtml((word.pos_cn || []).join(" / ") || word.pos_raw || word.pos.join("/"))}</span>
            <span class="tag">${escapeHtml(word.spelling_risk)}</span>
          </div>
          ${renderMeanings(word.meanings)}
          <div class="examples" id="examplesMount">${renderExamples(word, state.revealed)}</div>
        </div>
      </div>
      <div class="practice-grid">
        ${renderSpelling(word, target)}
        <div id="revealMount">${state.revealed ? renderMemory(word) : renderHiddenMemory()}</div>
      </div>
    </section>
    <div id="modalMount"></div>
  `;
  recordDaily("viewed", word);
  bindEvents();
  autoSpeakWord(word.word);
}

function renderMeanings(meanings = []) {
  return `
    <div class="meaning-strip" aria-label="中文释义">
      ${meanings.map((meaning, index) => `
        <div class="meaning-chip" title="${escapeAttr(meaning)}">
          <span>${index + 1}</span>
          <strong>${escapeHtml(meaning)}</strong>
        </div>
      `).join("")}
    </div>
  `;
}

function revealWord(markLearned = true) {
  state.revealed = true;
  const word = currentWord();
  if (markLearned) {
    state.learnedIds.add(word.id);
    saveLearned();
    recordDaily("learned", word);
  }
  const memoryMount = document.querySelector("#revealMount");
  if (memoryMount) memoryMount.innerHTML = renderMemory(word);
  const examplesMount = document.querySelector("#examplesMount");
  if (examplesMount) examplesMount.innerHTML = renderExamples(word, true);
  document.querySelector("#speakWordBtn")?.addEventListener("click", () => speak(word.word));
  bindSpeakButtons();
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
      <p class="muted compact-note">拼对后显示英文单词、词形、搭配和词根词缀。</p>
    </div>
  `;
}

function renderMemory(word) {
  return `
    <div class="memory">
      <div class="reveal-title">
        <h2>${escapeHtml(word.display || word.word)}</h2>
        <button id="speakWordBtn" type="button">播放读音</button>
      </div>
      ${word.memory.form_note ? `<p class="memory-note">${escapeHtml(trimLong(word.memory.form_note, 220))}</p>` : `<p class="muted memory-note">这个词先重点记住释义和拼写。</p>`}
      <div class="forms">${renderForms(word.forms)}</div>
      ${renderAnalysis(word)}
      ${renderPhrases(word.phrases)}
    </div>
  `;
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
    <div class="spell-area">
      <div class="spell-head">
        <h2>拼写练习</h2>
        <button id="speakBeforeBtn" type="button">播放单词读音</button>
      </div>
      <div class="answer-slots" id="answerSlots">
        ${target.split("").map(() => `<div class="slot"></div>`).join("")}
      </div>
      <div class="letter-bank" id="letterBank">
        ${state.bank.map((item) => `<button class="letter-card" data-id="${item.id}" type="button">${escapeHtml(item.letter)}</button>`).join("")}
      </div>
      <div class="feedback" id="feedback"></div>
      <div class="tag-row">
        <button id="hintBtn" type="button">提示</button>
        <button id="undoBtn" type="button">撤回</button>
        <button id="clearBtn" type="button">清空</button>
        <button id="prevBtn" type="button">上一个</button>
        <button class="primary" id="nextBtn" type="button" disabled>下一个</button>
      </div>
    </div>
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

function bindEvents() {
  document.querySelector("#resetBtn").addEventListener("click", () => {
    state.index = 0;
    state.learnedIds = new Set();
    state.wrongIds = new Set();
    saveProgress();
    saveLearned();
    saveWrong();
    saveDailyLog({});
    render();
  });
  document.querySelector("#hintBtn").addEventListener("click", useHint);
  document.querySelector("#undoBtn").addEventListener("click", undoLetter);
  document.querySelector("#clearBtn").addEventListener("click", clearLetters);
  document.querySelector("#prevBtn").addEventListener("click", prevWord);
  document.querySelector("#nextBtn").addEventListener("click", nextWord);
  document.querySelector("#userBtn").addEventListener("click", openUserModal);
  document.querySelector("#primaryMenuBtn").addEventListener("click", () => openTypeMenu("primary"));
  document.querySelector("#juniorMenuBtn").addEventListener("click", () => openTypeMenu("junior"));
  document.querySelector("#practiceEnCnBtn").addEventListener("click", () => startPractice("en-cn"));
  document.querySelector("#practiceCnEnBtn").addEventListener("click", () => startPractice("cn-en"));
  document.querySelector("#wordListBtn").addEventListener("click", () => openWordList(1));
  document.querySelector("#wrongListBtn").addEventListener("click", () => openWrongList());
  document.querySelector("#dailyLogBtn").addEventListener("click", () => openDailyLog());
  document.querySelector("#speakBeforeBtn").addEventListener("click", () => speak(currentWord().word));
  document.querySelectorAll(".letter-card").forEach((button) => {
    button.addEventListener("click", () => toggleLetter(button));
  });
  bindSpeakButtons();
  if (state.revealed) {
    document.querySelector("#nextBtn").disabled = false;
    document.querySelector("#speakWordBtn")?.addEventListener("click", () => speak(currentWord().word));
  }
}

function bindSpeakButtons() {
  document.querySelectorAll("[data-speak]").forEach((button) => {
    if (button.dataset.boundSpeak === "1") return;
    button.dataset.boundSpeak = "1";
    button.addEventListener("click", () => speakSentence(button.dataset.speak));
  });
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
  const target = spellingTarget(currentWord().word);
  if (state.revealed) resetCurrentPractice();
  if (button.disabled || state.selected.length >= target.length) return;
  const item = state.bank.find((letter) => letter.id === button.dataset.id);
  state.selected.push({ ...item, hinted: false });
  button.classList.add("selected");
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
  if (button) button.classList.remove("selected");
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
  const target = spellingTarget(currentWord().word);
  const ok = answer === target;
  const feedback = document.querySelector("#feedback");
  feedback.textContent = ok ? "拼对了，真棒！" : "这次不对，再试一次。";
  feedback.className = `feedback ${ok ? "ok" : "bad"}`;
  playSound(ok ? "ok" : "bad");
  if (ok) {
    revealWord();
    document.querySelector("#nextBtn").disabled = false;
  }
}

function useHint() {
  if (state.revealed) return;
  const word = currentWord();
  const target = spellingTarget(word.word);
  if (state.hintCount > 0 || target.length <= 1) {
    revealAsWrong();
    return;
  }
  const hintSize = Math.min(target.length - 1, Math.max(1, Math.ceil(target.length / 3)));
  state.hintCount = 1;
  state.selected = [];
  document.querySelectorAll(".letter-card").forEach((button) => {
    button.disabled = false;
    button.classList.remove("selected", "hint-locked");
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
  const target = spellingTarget(word.word);
  state.wrongIds.add(word.id);
  saveWrong();
  recordDaily("wrong", word);
  const wrongButton = document.querySelector("#wrongListBtn");
  if (wrongButton) wrongButton.textContent = `错词练习 ${state.wrongIds.size}`;
  state.hintCount = 2;
  state.selected = [];
  document.querySelectorAll(".letter-card").forEach((button) => {
    button.disabled = false;
    button.classList.remove("selected", "hint-locked");
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
    button.classList.remove("selected");
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
    if (!button.classList.contains("hint-locked")) button.classList.remove("selected");
  });
  renderSlots();
  document.querySelector("#feedback").textContent = "";
}

function resetCurrentPractice() {
  state.revealed = false;
  state.selected = [];
  state.hintCount = 0;
  document.querySelector("#examplesMount").innerHTML = renderExamples(currentWord(), false);
  document.querySelector("#revealMount").innerHTML = renderHiddenMemory();
  document.querySelectorAll(".letter-card").forEach((button) => {
    button.disabled = false;
    button.classList.remove("selected");
    button.classList.remove("hint-locked");
  });
  document.querySelector("#nextBtn").disabled = true;
  document.querySelector("#feedback").textContent = "";
  renderSlots();
}

function nextWord() {
  state.index = Math.min(state.entries.length - 1, state.index + 1);
  saveProgress();
  render();
}

function prevWord() {
  state.index = Math.max(0, state.index - 1);
  saveProgress();
  render();
}

async function openUserModal() {
  const users = state.serverReady ? await apiGetUsers().catch(() => []) : [];
  document.querySelector("#modalMount").innerHTML = `
    <div class="modal-backdrop">
      <section class="modal panel user-modal">
        <div class="modal-head">
          <h2>学习用户</h2>
          <button id="closeModalBtn" type="button">关闭</button>
        </div>
        <p class="muted">${state.serverReady ? "输入新名字会检查是否重名；选择已有用户会从服务端文件读取学习记录。" : "当前没有启动 Node 服务端，只能使用浏览器本地记录。"}</p>
        <div class="user-create-row">
          <input id="userNameInput" maxlength="20" placeholder="输入学习者名字" />
          <button class="primary" id="createUserBtn" type="button" ${state.serverReady ? "" : "disabled"}>创建用户</button>
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
            : `<div class="empty-state">${state.serverReady ? "还没有用户，请先创建。" : "启动 node server.mjs 后可保存到服务端文件。"}</div>`}
        </div>
      </section>
    </div>
  `;
  document.querySelector("#closeModalBtn").addEventListener("click", closeWordList);
  document.querySelector("#createUserBtn")?.addEventListener("click", createUserFromModal);
  document.querySelectorAll("[data-user-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const user = users.find((item) => item.id === button.dataset.userId);
      if (!user) return;
      state.user = user;
      saveUserSession(user);
      await loadUserProgress();
      closeWordList();
      render();
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
    const user = await apiCreateUser(name);
    state.user = user;
    saveUserSession(user);
    await syncUserProgress();
    closeWordList();
    render();
  } catch (error) {
    feedback.textContent = error.message || "创建失败。";
    feedback.className = "feedback bad";
    playSound("bad");
  }
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
  document.querySelector("#modalMount").innerHTML = `
    <div class="modal-backdrop">
      <section class="modal panel type-menu-modal">
        <div class="modal-head">
          <h2>${escapeHtml(LABELS[profile])} · 按类型学习</h2>
          <button id="closeModalBtn" type="button">关闭</button>
        </div>
        <div class="type-menu-grid">
          ${renderTypeMenuItem(page, "", data.entries.length, profile === PROFILE && !state.activeCategory)}
          ${categories.map(([category, count]) => renderTypeMenuItem(page, category, count, profile === PROFILE && category === state.activeCategory)).join("")}
        </div>
      </section>
    </div>
  `;
  document.querySelector("#closeModalBtn").addEventListener("click", closeWordList);
}

function renderTypeMenuItem(page, category, count, active) {
  const label = category || "全部单词";
  const href = category ? `./${page}?category=${encodeURIComponent(category)}` : `./${page}`;
  return `
    <a class="type-menu-item ${active ? "active" : ""}" href="${escapeAttr(href)}">
      <strong>${escapeHtml(label)}</strong>
      <span>${count} 个词</span>
    </a>
  `;
}

function countCategories(entries) {
  const counts = new Map();
  for (const entry of entries) counts.set(entry.category || "未分类", (counts.get(entry.category || "未分类") || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function openWrongList() {
  const wrongWords = state.entries
    .map((word, index) => ({ word, index }))
    .filter((item) => state.wrongIds.has(item.word.id));
  document.querySelector("#modalMount").innerHTML = `
    <div class="modal-backdrop">
      <section class="modal panel">
        <div class="modal-head">
          <h2>错词练习</h2>
          <div class="tag-row">
            <button id="clearWrongBtn" type="button" ${wrongWords.length ? "" : "disabled"}>清空错词</button>
            <button id="closeModalBtn" type="button">关闭</button>
          </div>
        </div>
        <div class="word-table">
          ${wrongWords.length
            ? wrongWords.map((item) => renderWrongListItem(item.word, item.index)).join("")
            : `<div class="empty-state">还没有错词。使用提示显示答案后，会自动加入这里。</div>`}
        </div>
      </section>
    </div>
  `;
  document.querySelector("#closeModalBtn").addEventListener("click", closeWordList);
  document.querySelector("#clearWrongBtn")?.addEventListener("click", () => {
    state.wrongIds = new Set();
    saveWrong();
    closeWordList();
    render();
  });
  document.querySelectorAll("[data-wrong-index]").forEach((button) => {
    button.addEventListener("click", () => {
      state.index = Number(button.dataset.wrongIndex);
      saveProgress();
      closeWordList();
      render();
    });
  });
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
        <span class="muted">${escapeHtml((word.pos_cn || []).join(" / "))}</span>
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
        <span class="muted">${escapeHtml((word.pos_cn || []).join(" / "))}</span>
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
  localStorage.setItem(progressKey(), String(state.index));
  syncUserProgress();
}

function progressKey() {
  if (!state.activeCategory) return STORE_KEY;
  return `enstudy.simple.${PROFILE}.progress.category.${slugify(state.activeCategory)}.v1`;
}

function loadLearned() {
  try {
    return new Set(JSON.parse(localStorage.getItem(LEARNED_KEY)) || []);
  } catch {
    return new Set();
  }
}

function saveLearned() {
  localStorage.setItem(LEARNED_KEY, JSON.stringify([...state.learnedIds]));
  syncUserProgress();
}

function loadWrong() {
  try {
    return new Set(JSON.parse(localStorage.getItem(WRONG_KEY)) || []);
  } catch {
    return new Set();
  }
}

function saveWrong() {
  localStorage.setItem(WRONG_KEY, JSON.stringify([...state.wrongIds]));
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

function loadDailyLog() {
  try {
    return JSON.parse(localStorage.getItem(DAILY_KEY)) || {};
  } catch {
    return {};
  }
}

function saveDailyLog(log) {
  localStorage.setItem(DAILY_KEY, JSON.stringify(log));
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
    if (Number.isFinite(Number(serverIndex))) {
      state.index = clamp(Number(serverIndex), 0, state.entries.length - 1);
      localStorage.setItem(progressKey(), String(state.index));
    }
    if (Array.isArray(user.learned?.[PROFILE])) {
      state.learnedIds = new Set(user.learned[PROFILE]);
      localStorage.setItem(LEARNED_KEY, JSON.stringify([...state.learnedIds]));
    }
    if (Array.isArray(user.wrong?.[PROFILE])) {
      state.wrongIds = new Set(user.wrong[PROFILE]);
      localStorage.setItem(WRONG_KEY, JSON.stringify([...state.wrongIds]));
    }
    if (user.daily?.[PROFILE]) {
      localStorage.setItem(DAILY_KEY, JSON.stringify(user.daily[PROFILE]));
    }
    state.serverUserLoaded = true;
  } catch {
    state.serverReady = false;
  }
}

let syncTimer = 0;
function syncUserProgress() {
  if (!state.user || !state.serverReady) return;
  window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => {
    fetch(`${API_BASE}/users/${encodeURIComponent(state.user.id)}/progress`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildUserProgressPayload()),
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

function buildUserProgressPayload() {
  return {
    progress: { [progressKey()]: state.index },
    learned: { [PROFILE]: [...state.learnedIds] },
    wrong: { [PROFILE]: [...state.wrongIds] },
    daily: { [PROFILE]: loadDailyLog() },
  };
}

async function apiGetUsers() {
  const response = await fetch(`${API_BASE}/users`, { cache: "no-store" });
  if (!response.ok) throw new Error("读取用户失败");
  const data = await response.json();
  return data.users || [];
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

function practiceStorageKey(mode) {
  const category = state.activeCategory ? slugify(state.activeCategory) : "all";
  return `enstudy.simple.${PROFILE}.practice.${category}.${mode}.v1`;
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

function speak(text) {
  if (!text) return;
  autoSpeakToken += 1;
  cancelVoice();
  playYoudaoVoice(text).catch(() => speakWithBrowser(text));
}

function speakSentence(text) {
  if (!text) return;
  autoSpeakToken += 1;
  cancelVoice();
  speakWithBrowser(text);
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
    activeVoiceAudio = audio;
    audio.preload = "auto";
    audio.onended = resolve;
    audio.onerror = reject;
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
