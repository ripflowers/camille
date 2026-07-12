const STORE_KEY = "enstudy.mvp.progress.v1";

export function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || createEmptyProgress();
  } catch {
    return createEmptyProgress();
  }
}

export function saveProgress(progress) {
  localStorage.setItem(STORE_KEY, JSON.stringify(progress));
}

export function createEmptyProgress() {
  return {
    selectedProfile: "grade1",
    profiles: {
      grade1: createProfileProgress(),
      grade7: createProfileProgress(),
    },
  };
}

export function createProfileProgress() {
  return {
    completedDays: 0,
    daily: {},
    wordStats: {},
  };
}

export function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export function ensureDaily(progress, profile, dayNumber) {
  const profileProgress = progress.profiles[profile];
  const key = `${todayKey()}::day-${dayNumber}`;
  if (!profileProgress.daily[key]) {
    profileProgress.daily[key] = {
      date: todayKey(),
      day: dayNumber,
      completedWordIds: [],
      gameResults: [],
      speakScores: [],
      wrongWordIds: [],
      bossDone: false,
    };
  }
  return profileProgress.daily[key];
}

export function recordResult(progress, profile, dayNumber, result) {
  const daily = ensureDaily(progress, profile, dayNumber);
  daily.gameResults.push({ at: Date.now(), ...result });
  if (result.wordId) {
    const stat = progress.profiles[profile].wordStats[result.wordId] || {
      seen: 0,
      correct: 0,
      wrong: 0,
      speakScores: [],
    };
    stat.seen += 1;
    if (result.correct) stat.correct += 1;
    if (result.correct === false) {
      stat.wrong += 1;
      if (!daily.wrongWordIds.includes(result.wordId)) daily.wrongWordIds.push(result.wordId);
    }
    if (typeof result.speakScore === "number") {
      stat.speakScores.push(result.speakScore);
      daily.speakScores.push(result.speakScore);
    }
    progress.profiles[profile].wordStats[result.wordId] = stat;
  }
  saveProgress(progress);
}

export function markWordsCompleted(progress, profile, dayNumber, wordIds) {
  const daily = ensureDaily(progress, profile, dayNumber);
  for (const id of wordIds) {
    if (!daily.completedWordIds.includes(id)) daily.completedWordIds.push(id);
  }
  saveProgress(progress);
}

export function markBossDone(progress, profile, dayNumber) {
  const daily = ensureDaily(progress, profile, dayNumber);
  daily.bossDone = true;
  const profileProgress = progress.profiles[profile];
  profileProgress.completedDays = Math.max(profileProgress.completedDays, dayNumber);
  saveProgress(progress);
}

export function resetToday(progress, profile, dayNumber) {
  const key = `${todayKey()}::day-${dayNumber}`;
  delete progress.profiles[profile].daily[key];
  saveProgress(progress);
}
