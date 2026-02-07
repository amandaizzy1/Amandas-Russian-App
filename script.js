// Russian Sentence Trainer — script.js (v4)
// UI: hidden Data section, big Duolingo-style level at top, adjustable daily goal.
// Motivation: streak, daily XP, session XP, ring + bars, level-up toast.
// Mastery: new/seen/learned/mastered.

const LS_KEY = "ru_sentence_trainer_v4";

// XP tuning
const XP = { perfect: 12, good: 10, hard: 8, miss: 0 };

// Levels based on learned count (learned + mastered) — includes A0 start.
const LEVELS = [
  { name: "A0", learned: 0 },
  { name: "A1", learned: 250 },
  { name: "B1", learned: 1000 },
  { name: "B2", learned: 10000 },
  { name: "C1", learned: 20000 },
  { name: "C2", learned: 40000 }
];

function nowMs() { return Date.now(); }
function daysToMs(d) { return Math.floor(d * 86400000); }
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

function ymdLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function ymdToDate(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function dayDiff(aYmd, bYmd) {
  const a = ymdToDate(aYmd);
  const b = ymdToDate(bYmd);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function normalizeRuForMatch(s) {
  return s
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[.,!?;:()"“”«»]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function splitTokensRu(rawRu) {
  const cleaned = normalizeRuForMatch(rawRu);
  if (!cleaned) return [];
  return cleaned.split(" ");
}

function parseLine(line) {
  let s = line.trim();
  if (!s) return null;
  s = s.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

  const eqIndex = s.indexOf("=");
  if (eqIndex === -1) return null;

  let left = s.slice(0, eqIndex).trim();
  let right = s.slice(eqIndex + 1).trim();

  left = left.replace(/^\d+\s+/, "").trim();
  if (!left || !right) return null;
  return { en: left, ru: right };
}

function stableId(en, ru) {
  const x = `${en}||${ru}`;
  let h = 2166136261;
  for (let i = 0; i < x.length; i++) {
    h ^= x.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `s_${(h >>> 0).toString(16)}`;
}

function defaultProgress() {
  return {
    ease: 2.2,
    intervalDays: 0,
    reps: 0,
    lapses: 0,
    dueAt: 0,
    lastSeenAt: 0,

    correctStreak: 0,
    bestStreak: 0,
    lastAttemptWasCorrect: false
  };
}

function defaultMeta() {
  return {
    importedAt: 0,

    // motivation
    streak: 0,
    lastStudyYmd: "",
    dailyXP: 0,
    dailyXPDate: "",
    dailyGoalXP: 80,
    totalXP: 0,
    lastLevel: "A0",

    // session
    sessionXP: 0,
    sessionGoalXP: 40
  };
}

function loadState() {
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return { items: {}, order: [], meta: defaultMeta() };
  try {
    const s = JSON.parse(raw);
    if (!s.meta) s.meta = defaultMeta();

    const d = defaultMeta();
    for (const k of Object.keys(d)) {
      if (s.meta[k] === undefined) s.meta[k] = d[k];
    }
    return s;
  } catch {
    return { items: {}, order: [], meta: defaultMeta() };
  }
}

function saveState(state) {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}

function buildItem(en, ru) {
  const id = stableId(en, ru);
  return { id, en, ru, ruTokens: splitTokensRu(ru), progress: defaultProgress() };
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function chooseLessonItems(state, lessonSize, newPerLesson) {
  const allIds = state.order.slice();
  const allItems = allIds.map(id => state.items[id]).filter(Boolean);

  const dueItems = allItems
    .filter(x => x.progress.dueAt > 0 && x.progress.dueAt <= nowMs())
    .sort((a, b) => a.progress.dueAt - b.progress.dueAt);

  const newItems = allItems.filter(x => x.progress.reps === 0);

  const dueCap = Math.max(0, lessonSize - newPerLesson);
  const chosenDue = dueItems.slice(0, dueCap);
  const chosenNew = newItems.slice(0, Math.min(newPerLesson, lessonSize - chosenDue.length));

  const remaining = lessonSize - chosenDue.length - chosenNew.length;
  let nearDue = [];
  if (remaining > 0) {
    nearDue = allItems
      .filter(x => x.progress.reps > 0 && x.progress.dueAt > nowMs())
      .sort((a, b) => a.progress.dueAt - b.progress.dueAt)
      .slice(0, remaining);
  }

  return shuffle([...chosenDue, ...chosenNew, ...nearDue]).slice(0, lessonSize);
}

const PREPOSITIONS = new Set([
  "в","на","с","со","к","ко","из","у","по","о","об","обо","за","для","про","при",
  "без","над","под","перед","после","до","от","через","между"
]);

function buildWordBank(requiredTiles, globalDistractors, maxDistractors) {
  const requiredSet = new Set(requiredTiles);
  const pool = globalDistractors.filter(x => !requiredSet.has(x));
  const distractors = shuffle(pool).slice(0, maxDistractors);
  return shuffle([...requiredTiles, ...distractors]);
}

// grading: same words, flexible order
function gradeOrderFlexible(userTiles, canonicalTokens) {
  const user = userTiles.slice();
  const canon = canonicalTokens.slice();

  if (user.length !== canon.length) return { ok: false, reason: "Wrong number of words." };

  const countMap = (arr) => {
    const m = new Map();
    for (const x of arr) m.set(x, (m.get(x) || 0) + 1);
    return m;
  };

  const u = countMap(user);
  const c = countMap(canon);
  if (u.size !== c.size) return { ok: false, reason: "Wrong words used." };
  for (const [k, v] of c.entries()) {
    if ((u.get(k) || 0) !== v) return { ok: false, reason: "Wrong words used." };
  }

  const canonStr = canon.join(" ");
  const userStr = user.join(" ");
  if (userStr === canonStr) return { ok: true, quality: "perfect", note: "Exact order." };

  const allowMove = new Set(["вообще-то","действительно","просто","уже","ещё","всегда","никогда","сейчас","потом","теперь"]);
  const userNoMove = user.filter(x => !allowMove.has(x));
  const canonNoMove = canon.filter(x => !allowMove.has(x));
  if (userNoMove.join(" ") === canonNoMove.join(" ")) {
    return { ok: true, quality: "good", note: "Order ok (only adverbs moved)." };
  }

  // adjacency nudge
  const adjacencyPairs = [];
  for (let i = 0; i < canon.length - 1; i++) {
    const a = canon[i], b = canon[i + 1];
    if (a === "не") adjacencyPairs.push([a, b]);
    if (PREPOSITIONS.has(a)) adjacencyPairs.push([a, b]);
    if (a === "только" && b === "что") adjacencyPairs.push([a, b]);
  }
  for (const [a, b] of adjacencyPairs) {
    let okPair = false;
    for (let i = 0; i < user.length - 1; i++) {
      if (user[i] === a && user[i + 1] === b) { okPair = true; break; }
    }
    if (!okPair) return { ok: true, quality: "hard", note: `Correct, but keep "${a} ${b}" together.` };
  }

  return { ok: true, quality: "hard", note: "Correct (different order accepted)." };
}

function updateSrs(progress, resultQuality) {
  progress.lastSeenAt = nowMs();

  if (resultQuality === "perfect") {
    progress.ease = Math.min(3.0, progress.ease + 0.03);
    progress.reps += 1;
    progress.correctStreak += 1;
    progress.bestStreak = Math.max(progress.bestStreak, progress.correctStreak);
    progress.lastAttemptWasCorrect = true;

    progress.intervalDays = progress.intervalDays === 0
      ? 1
      : Math.max(1, Math.round(progress.intervalDays * 2.6 * progress.ease / 2.2));
    progress.dueAt = nowMs() + daysToMs(progress.intervalDays);
    return;
  }

  if (resultQuality === "good") {
    progress.reps += 1;
    progress.correctStreak += 1;
    progress.bestStreak = Math.max(progress.bestStreak, progress.correctStreak);
    progress.lastAttemptWasCorrect = true;

    progress.intervalDays = progress.intervalDays === 0
      ? 1
      : Math.max(1, Math.round(progress.intervalDays * 2.2));
    progress.dueAt = nowMs() + daysToMs(progress.intervalDays);
    return;
  }

  if (resultQuality === "hard") {
    progress.ease = Math.max(1.3, progress.ease - 0.05);
    progress.reps += 1;
    progress.correctStreak += 1;
    progress.bestStreak = Math.max(progress.bestStreak, progress.correctStreak);
    progress.lastAttemptWasCorrect = true;

    progress.intervalDays = progress.intervalDays === 0
      ? 1
      : Math.max(1, Math.round(progress.intervalDays * 1.3));
    progress.dueAt = nowMs() + daysToMs(progress.intervalDays);
    return;
  }

  // miss
  progress.lapses += 1;
  progress.ease = Math.max(1.3, progress.ease - 0.2);
  progress.reps += 1;
  progress.correctStreak = 0;
  progress.lastAttemptWasCorrect = false;
  progress.intervalDays = 1;
  progress.dueAt = nowMs() + daysToMs(1);
}

function speakRu(text) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ru-RU";
  u.rate = 0.95;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

// sound effects (oscillator beeps)
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
}
function beep(freq, durationMs, type = "sine", gainVal = 0.035) {
  try {
    ensureAudio();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = gainVal;
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + durationMs / 1000);
  } catch {}
}
function sfx(kind) {
  if (kind === "tap") { beep(520, 35, "triangle", 0.02); return; }
  if (kind === "good") { beep(660, 60, "sine", 0.03); setTimeout(()=>beep(880, 80, "sine", 0.03), 60); return; }
  if (kind === "bad") { beep(220, 110, "sawtooth", 0.025); return; }
  if (kind === "level") { beep(523, 70, "sine", 0.03); setTimeout(()=>beep(659, 80, "sine", 0.03), 80); setTimeout(()=>beep(784, 120, "sine", 0.03), 170); return; }
}

// mastery + stats
function masteryState(p) {
  if (p.reps === 0) return "new";
  if (p.correctStreak >= 3) return "mastered";
  if (p.correctStreak >= 1) return "learned";
  return "seen";
}

function statsFromState(state) {
  const all = Object.values(state.items);
  const total = all.length;

  let due = 0, newCount = 0, seenCount = 0, learnedCount = 0, masteredCount = 0;
  for (const it of all) {
    const p = it.progress || defaultProgress();
    if (p.dueAt > 0 && p.dueAt <= nowMs()) due += 1;

    const ms = masteryState(p);
    if (ms === "new") newCount += 1;
    else if (ms === "seen") seenCount += 1;
    else if (ms === "learned") learnedCount += 1;
    else masteredCount += 1;
  }

  const learnedTotal = learnedCount + masteredCount;
  const learnedPct = total ? Math.round((learnedTotal / total) * 100) : 0;
  const masteredPct = total ? Math.round((masteredCount / total) * 100) : 0;

  return { total, due, newCount, seenCount, learnedCount, masteredCount, learnedTotal, learnedPct, masteredPct };
}

function currentLevel(learnedTotal) {
  let lvl = LEVELS[0];
  for (const l of LEVELS) if (learnedTotal >= l.learned) lvl = l;
  return lvl;
}
function nextLevel(learnedTotal) {
  for (const l of LEVELS) if (learnedTotal < l.learned) return l;
  return null;
}

// UI helpers
function toast(text, big = false) {
  const t = document.createElement("div");
  t.className = "toast" + (big ? " big" : "");
  t.textContent = text;
  document.body.appendChild(t);

  setTimeout(() => {
    t.style.opacity = "0";
    t.style.transform = "translateX(-50%) translateY(10px)";
    t.style.transition = "opacity 220ms ease, transform 220ms ease";
  }, big ? 1400 : 950);

  setTimeout(() => t.remove(), big ? 1800 : 1300);
}

function progressBar(pct, extraClass = "") {
  const outer = document.createElement("div");
  outer.className = "progressBar " + extraClass;
  const inner = document.createElement("div");
  inner.style.width = `${clamp(pct, 0, 100)}%`;
  outer.appendChild(inner);
  return outer;
}

function ringSvg(pct, labelTop, labelBottom) {
  const size = 72;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = clamp(pct, 0, 100);
  const dash = (p / 100) * c;

  const wrap = document.createElement("div");
  wrap.className = "ringWrap";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);

  const bg = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  bg.setAttribute("cx", String(size / 2));
  bg.setAttribute("cy", String(size / 2));
  bg.setAttribute("r", String(r));
  bg.setAttribute("fill", "none");
  bg.setAttribute("stroke", "rgba(255,255,255,.10)");
  bg.setAttribute("stroke-width", String(stroke));

  const fg = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  fg.setAttribute("cx", String(size / 2));
  fg.setAttribute("cy", String(size / 2));
  fg.setAttribute("r", String(r));
  fg.setAttribute("fill", "none");
  fg.setAttribute("stroke", "rgba(56,189,248,.95)");
  fg.setAttribute("stroke-width", String(stroke));
  fg.setAttribute("stroke-linecap", "round");
  fg.setAttribute("transform", `rotate(-90 ${size / 2} ${size / 2})`);
  fg.setAttribute("stroke-dasharray", `${dash} ${c - dash}`);

  const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
  txt.setAttribute("x", String(size / 2));
  txt.setAttribute("y", String(size / 2 + 5));
  txt.setAttribute("text-anchor", "middle");
  txt.setAttribute("font-size", "16");
  txt.setAttribute("fill", "rgba(226,232,240,.95)");
  txt.textContent = `${p}%`;

  svg.appendChild(bg);
  svg.appendChild(fg);
  svg.appendChild(txt);

  const labels = document.createElement("div");
  labels.innerHTML = `<div class="ringLabel">${labelTop}</div><div><b>${labelBottom}</b></div>`;
  labels.style.display = "flex";
  labels.style.flexDirection = "column";
  labels.style.gap = "2px";

  wrap.appendChild(svg);
  wrap.appendChild(labels);
  return wrap;
}

// motivation bookkeeping
function resetDailyIfNeeded() {
  const today = ymdLocal();
  if (state.meta.dailyXPDate !== today) {
    state.meta.dailyXPDate = today;
    state.meta.dailyXP = 0;
  }
}

function bumpStreakIfNeeded() {
  const today = ymdLocal();

  if (!state.meta.lastStudyYmd) {
    state.meta.streak = 1;
    state.meta.lastStudyYmd = today;
    return { changed: true, broke: false };
  }
  if (state.meta.lastStudyYmd === today) return { changed: false, broke: false };

  const diff = dayDiff(state.meta.lastStudyYmd, today);
  if (diff === 1) {
    state.meta.streak += 1;
    state.meta.lastStudyYmd = today;
    return { changed: true, broke: false };
  }

  state.meta.streak = 1;
  state.meta.lastStudyYmd = today;
  return { changed: true, broke: true };
}

function awardXP(amount) {
  resetDailyIfNeeded();
  state.meta.sessionXP += amount;
  state.meta.dailyXP += amount;
  state.meta.totalXP += amount;

  if (state.meta.sessionGoalXP < 40) state.meta.sessionGoalXP = 40;
  if (state.meta.sessionXP > state.meta.sessionGoalXP) {
    state.meta.sessionGoalXP = Math.ceil(state.meta.sessionXP / 20) * 20;
  }
}

function maybeLevelUp(learnedTotal) {
  const cur = currentLevel(learnedTotal);
  if (state.meta.lastLevel !== cur.name) {
    state.meta.lastLevel = cur.name;
    // Only toast on real progress beyond A0
    if (cur.name !== "A0") return cur.name;
  }
  return "";
}

// DOM
const el = {
  // data import (hidden)
  dataInput: document.getElementById("dataInput"),
  btnImport: document.getElementById("btnImport"),
  importStatus: document.getElementById("importStatus"),
  btnReset: document.getElementById("btnReset"),
  btnLoadSample: document.getElementById("btnLoadSample"),

  // lesson
  lessonSize: document.getElementById("lessonSize"),
  newPerLesson: document.getElementById("newPerLesson"),
  btnStart: document.getElementById("btnStart"),
  lessonStatus: document.getElementById("lessonStatus"),

  promptArea: document.getElementById("promptArea"),
  promptEn: document.getElementById("promptEn"),
  answerLine: document.getElementById("answerLine"),
  bank: document.getElementById("bank"),
  feedback: document.getElementById("feedback"),
  btnUndo: document.getElementById("btnUndo"),
  btnClear: document.getElementById("btnClear"),
  btnSubmit: document.getElementById("btnSubmit"),
  btnNext: document.getElementById("btnNext"),
  btnSpeak: document.getElementById("btnSpeak"),

  // stats
  stats: document.getElementById("stats"),

  // HUD
  hudLevel: document.getElementById("hudLevel"),
  hudSub: document.getElementById("hudSub"),
  hudStreak: document.getElementById("hudStreak"),
  hudDailyXP: document.getElementById("hudDailyXP"),
  hudDailyGoal: document.getElementById("hudDailyGoal"),
  hudTotalXP: document.getElementById("hudTotalXP"),
  hudDue: document.getElementById("hudDue"),
  ringHolder: document.getElementById("dailyRingHolder"),

  // goal control
  dailyGoalInput: document.getElementById("dailyGoalInput"),
  btnSetGoal: document.getElementById("btnSetGoal")
};

let state = loadState();

let lesson = {
  items: [],
  idx: 0,
  current: null,
  bankTiles: [],
  requiredTiles: [],
  chosen: [],
  submitted: false
};

function setFeedback(text, tone = "muted") {
  el.feedback.classList.remove("good", "bad", "warn", "shake");
  if (tone === "good") el.feedback.classList.add("good");
  if (tone === "bad") el.feedback.classList.add("bad");
  if (tone === "warn") el.feedback.classList.add("warn");
  el.feedback.textContent = text;
}

function renderHUD() {
  resetDailyIfNeeded();

  const st = statsFromState(state);
  const cur = currentLevel(st.learnedTotal);

  el.hudLevel.textContent = cur.name;
  el.hudSub.textContent = `${st.learnedTotal} learned • ${st.masteredCount} mastered`;

  el.hudStreak.textContent = String(state.meta.streak || 0);
  el.hudDailyXP.textContent = String(state.meta.dailyXP || 0);
  el.hudDailyGoal.textContent = String(state.meta.dailyGoalXP ?? 80);
  el.hudTotalXP.textContent = String(state.meta.totalXP || 0);
  el.hudDue.textContent = String(st.due);

  // goal input should reflect current saved goal
  el.dailyGoalInput.value = String(state.meta.dailyGoalXP ?? 80);

  // ring
  el.ringHolder.innerHTML = "";
  const goal = Number(state.meta.dailyGoalXP || 0);

  if (goal > 0) {
    const pct = Math.round((state.meta.dailyXP / goal) * 100);
    const ring = ringSvg(
      pct,
      "Daily goal",
      pct >= 100 ? "Goal complete" : `${Math.max(0, goal - state.meta.dailyXP)} XP to go`
    );
    el.ringHolder.appendChild(ring);
  } else {
    // no ring when goal == 0
    const div = document.createElement("div");
    div.className = "muted";
    div.textContent = "Daily goal off";
    el.ringHolder.appendChild(div);
  }
}

function renderStats() {
  const st = statsFromState(state);
  const cur = currentLevel(st.learnedTotal);
  const next = nextLevel(st.learnedTotal);

  el.stats.innerHTML = "";

  const grid = document.createElement("div");
  grid.className = "statsGrid";

  const line1 = document.createElement("div");
  line1.className = "muted";
  line1.textContent = `New: ${st.newCount} — Seen: ${st.seenCount} — Learned: ${st.learnedCount} — Mastered: ${st.masteredCount}`;

  const line2 = document.createElement("div");
  line2.className = "muted";
  line2.textContent = `Progress: ${st.learnedPct}% learned • ${st.masteredPct}% mastered`;

  const learnedBar = progressBar(st.learnedPct);
  const masteredBar = progressBar(st.masteredPct);

  const sessPct = state.meta.sessionGoalXP > 0
    ? Math.round((state.meta.sessionXP / state.meta.sessionGoalXP) * 100)
    : 0;

  const sessLine = document.createElement("div");
  sessLine.className = "muted";
  sessLine.textContent = `Session XP: ${state.meta.sessionXP} / ${state.meta.sessionGoalXP}`;

  const sessionBar = progressBar(sessPct, "sessionBar");

  const lvlLine = document.createElement("div");
  lvlLine.className = "muted";
  if (!next) {
    lvlLine.innerHTML = `Level: <b>${cur.name}</b> (max) — Learned: <b>${st.learnedTotal}</b>`;
  } else {
    const toGo = next.learned - st.learnedTotal;
    const pctToNext = Math.round((st.learnedTotal / next.learned) * 100);
    lvlLine.innerHTML = `Level: <b>${cur.name}</b> → Next: <b>${next.name}</b> in <b>${toGo}</b> learned (${pctToNext}% of target)`;
  }

  grid.appendChild(line1);
  grid.appendChild(line2);
  grid.appendChild(learnedBar);
  grid.appendChild(masteredBar);
  grid.appendChild(sessLine);
  grid.appendChild(sessionBar);
  grid.appendChild(lvlLine);

  el.stats.appendChild(grid);
}

function importFromTextarea(text) {
  const lines = text.split("\n");
  const items = [];
  for (const line of lines) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    items.push(buildItem(parsed.en, parsed.ru));
  }
  if (items.length === 0) return { ok: false, msg: "No valid lines found." };

  for (const it of items) {
    if (!state.items[it.id]) {
      state.items[it.id] = it;
      state.order.push(it.id);
    } else {
      state.items[it.id].en = it.en;
      state.items[it.id].ru = it.ru;
      state.items[it.id].ruTokens = it.ruTokens;
      if (!state.items[it.id].progress) state.items[it.id].progress = defaultProgress();
    }
  }

  state.meta.importedAt = nowMs();
  saveState(state);
  return { ok: true, msg: `Imported ${items.length} lines.` };
}

function globalDistractorPool() {
  const all = Object.values(state.items);
  const set = new Set();
  for (const it of all) for (const t of it.ruTokens) if (t) set.add(t);
  return Array.from(set);
}

function startLesson() {
  const lessonSize = clamp(Number(el.lessonSize.value || 20), 5, 50);
  const newPerLesson = clamp(Number(el.newPerLesson.value || 10), 0, lessonSize);

  const chosen = chooseLessonItems(state, lessonSize, newPerLesson);
  if (chosen.length === 0) {
    el.lessonStatus.textContent = "No items available. Import sentences first.";
    el.promptArea.classList.add("hidden");
    return;
  }

  // new session
  state.meta.sessionXP = 0;
  state.meta.sessionGoalXP = 40;
  saveState(state);

  lesson.items = chosen;
  lesson.idx = 0;

  el.promptArea.classList.remove("hidden");
  el.lessonStatus.textContent = `Lesson items: ${chosen.length}`;
  loadCurrentPrompt();
  renderStats();
  renderHUD();
}

function loadCurrentPrompt() {
  lesson.current = lesson.items[lesson.idx];
  lesson.submitted = false;
  lesson.chosen = [];
  setFeedback("");

  el.promptEn.textContent = lesson.current.en;

  lesson.requiredTiles = lesson.current.ruTokens.slice();
  lesson.bankTiles = buildWordBank(lesson.requiredTiles, globalDistractorPool(), 6);

  renderBank();
  renderAnswerLine();
}

function renderBank() {
  el.bank.innerHTML = "";

  const usedCounts = new Map();
  for (const t of lesson.chosen) usedCounts.set(t, (usedCounts.get(t) || 0) + 1);

  const reqCounts = new Map();
  for (const t of lesson.requiredTiles) reqCounts.set(t, (reqCounts.get(t) || 0) + 1);

  for (const t of lesson.bankTiles) {
    const requiredCount = reqCounts.get(t) || 0;
    const currentUsed = usedCounts.get(t) || 0;
    const usedUp = requiredCount > 0 && currentUsed >= requiredCount;

    const tile = document.createElement("div");
    tile.className = "tile" + (usedUp ? " used" : "");
    tile.textContent = t;

    tile.addEventListener("click", () => {
      if (lesson.submitted) return;
      sfx("tap");

      const requiredCountNow = reqCounts.get(t) || 0;
      const currentUsedNow = usedCounts.get(t) || 0;

      if (requiredCountNow > 0) {
        if (currentUsedNow >= requiredCountNow) return;
        lesson.chosen.push(t);
      } else {
        lesson.chosen.push(t);
      }
      renderBank();
      renderAnswerLine();
    });

    el.bank.appendChild(tile);
  }
}

function renderAnswerLine() {
  el.answerLine.innerHTML = "";
  for (let i = 0; i < lesson.chosen.length; i++) {
    const t = lesson.chosen[i];
    const tile = document.createElement("div");
    tile.className = "tile";
    tile.textContent = t;

    tile.addEventListener("click", () => {
      if (lesson.submitted) return;
      sfx("tap");
      lesson.chosen.splice(i, 1);
      renderBank();
      renderAnswerLine();
    });

    el.answerLine.appendChild(tile);
  }
}

function submitAnswer() {
  if (lesson.submitted) return;
  lesson.submitted = true;

  const p = lesson.current.progress || defaultProgress();
  const beforeLevel = currentLevel(statsFromState(state).learnedTotal).name;
  const beforeMastery = masteryState(p);

  const result = gradeOrderFlexible(lesson.chosen, lesson.current.ruTokens);

  if (!result.ok) {
    updateSrs(p, "miss");
    lesson.current.progress = p;

    sfx("bad");
    el.feedback.classList.add("shake");
    setFeedback(`❌ Incorrect — ${result.reason}\nCorrect: ${lesson.current.ru}`, "bad");

    saveState(state);
    renderStats();
    renderHUD();
    return;
  }

  const xpEarned = XP[result.quality] ?? 8;
  awardXP(xpEarned);

  const streakChange = bumpStreakIfNeeded();
  updateSrs(p, result.quality);
  lesson.current.progress = p;

  const st = statsFromState(state);
  const levelToast = maybeLevelUp(st.learnedTotal);

  const afterMastery = masteryState(p);

  const lines = [];
  lines.push(`✅ Correct — ${result.note}`);
  lines.push(`+${xpEarned} XP`);
  lines.push(`Canonical: ${lesson.current.ru}`);

  if (beforeMastery !== "learned" && afterMastery === "learned") lines.push("✨ Sentence moved to Learned.");
  if (beforeMastery !== "mastered" && afterMastery === "mastered") lines.push("🏆 Sentence Mastered!");

  if (streakChange.changed) {
    lines.push(streakChange.broke ? `🔥 Streak restarted: ${state.meta.streak}` : `🔥 Streak: ${state.meta.streak}`);
  }

  if (levelToast) {
    sfx("level");
    toast(`🎉 Level up — ${levelToast}!`, true);
    el.stats.classList.add("levelPop");
    setTimeout(() => el.stats.classList.remove("levelPop"), 700);
  } else {
    sfx("good");
  }

  setFeedback(lines.join("\n"), result.quality === "hard" ? "warn" : "good");

  saveState(state);
  speakRu(lesson.current.ru);

  renderStats();
  renderHUD();

  // daily goal completion toast (only when goal > 0)
  if ((state.meta.dailyGoalXP || 0) > 0) {
    const prevPct = Math.round(((state.meta.dailyXP - xpEarned) / state.meta.dailyGoalXP) * 100);
    const pct = Math.round((state.meta.dailyXP / state.meta.dailyGoalXP) * 100);
    if (prevPct < 100 && pct >= 100) toast("✨ Daily goal complete!", true);
  }

  // if you crossed a level boundary (visual check)
  const afterLevel = currentLevel(st.learnedTotal).name;
  if (afterLevel !== beforeLevel) {
    el.hudLevel.textContent = afterLevel;
  }
}

function nextPrompt() {
  if (lesson.idx + 1 >= lesson.items.length) {
    el.lessonStatus.textContent = "Lesson complete.";
    el.promptArea.classList.add("hidden");
    renderStats();
    renderHUD();
    return;
  }
  lesson.idx += 1;
  loadCurrentPrompt();
  renderStats();
  renderHUD();
}

// events
el.btnImport.addEventListener("click", () => {
  const res = importFromTextarea(el.dataInput.value);
  el.importStatus.textContent = res.msg;
  renderStats();
  renderHUD();
});

el.btnStart.addEventListener("click", startLesson);

el.btnUndo.addEventListener("click", () => {
  if (lesson.submitted) return;
  sfx("tap");
  lesson.chosen.pop();
  renderBank();
  renderAnswerLine();
});

el.btnClear.addEventListener("click", () => {
  if (lesson.submitted) return;
  sfx("tap");
  lesson.chosen = [];
  renderBank();
  renderAnswerLine();
});

el.btnSubmit.addEventListener("click", submitAnswer);
el.btnNext.addEventListener("click", nextPrompt);

el.btnSpeak.addEventListener("click", () => {
  if (!lesson.current) return;
  speakRu(lesson.current.ru);
});

el.btnReset.addEventListener("click", () => {
  localStorage.removeItem(LS_KEY);
  state = loadState();
  el.importStatus.textContent = "Progress reset.";
  el.lessonStatus.textContent = "";
  el.promptArea.classList.add("hidden");
  renderStats();
  renderHUD();
});

el.btnLoadSample.addEventListener("click", () => {
  el.dataInput.value =
`1\tI actually don't know where Tom lives. = Вообще-то, я не знаю, где Том живёт.
2\tI admit that I’m the one that did it. = Я признаю, что это я сделала.
3\tI admit that there are a few problems. = Я признаю, что есть несколько проблем.
4\tI agree with Tom one hundred percent. = Я согласна с Томом на сто процентов.
5\tI agree with everything you just said. = Я согласна со всем, что ты только что сказала.
6\tI agree with your opinion about… = Я согласна с твоим мнением о…
7\tI already have plans for this weekend. = У меня уже есть планы на эти выходные.
8\tI already told you that it won't work. = Я уже сказала тебе, что это не сработает.
9\tI always carry a bottle of water with me. = Я всегда ношу с собой бутылку воды.
10\tI always get those two names confused. = Я всегда путаю эти два имени.
11\tI really want to live here forever. = Я действительно хочу жить здесь вечно.
12\tWhat is your favorite color? = Какой твой любимый цвет?
13\tMy favorite color is black. = Мой любимый цвет чёрный.
14\tYou found me (masc.) = Ты нашёл меня
15\tI found you = Я нашла тебя
16\tWhy are you learning Russian? = Почему ты учишь русский?
17\tI’m learning Russian because… = Я учу русский потому что…
18\tI have no idea = Я понятия не имею.
19\tI don't know how to say that in Russian. = Я не знаю, как сказать это по русски.
20\tI love that song. = Я люблю эту песню.
21\tCan I ask you a question? = Могу я задать тебе вопрос?
22\tI hate this city. = Я ненавижу этот город.
23\tI hated high school. College is so much better for me. = Я ненавидела среднюю школу. Колледж для меня намного лучше.
24\tWhat university do you study at? = В каком университете ты учишься?
25\tMy birthday is in August. = Мой день рождения в августе.
26\tI was born in Atlanta, but now I live in Los Angeles. = Я родилась в Атланте, но сейчас живу в Лос Анджелесе.
27\tI sound like a robot. = Я говорю как робот.
28\tI go to university here. = Я учусь здесь в университете.
29\tI think Russian women are especially beautiful. = Я думаю, что русские женщины особенно красивы.
30\tThat's all about me. = Это всё обо мне
31\tWhat's your major? = Какая у тебя специальность?
32\tI miss you. = Я скучаю по тебе.
33\tI'll pay for everything. = Я заплачу за все.
34\tI don’t agree that = Я не согласна, что…
35\tI feel so good = Мне так хорошо.
36\tI want to go home = Я хочу домой.
37\tI’m sorry I’m late (frm.) = Извините, я опоздала.
38\tI can’t hear you = Я тебя не слышу.
39\tHold on = Подожди.
40\tI can’t find my package. = Я не могу найти свою посылку.`;
  el.importStatus.textContent = "Sample set loaded. Click Import Sentences.";
});

// daily goal set
el.btnSetGoal.addEventListener("click", () => {
  const val = Number(el.dailyGoalInput.value);
  const goal = Number.isFinite(val) ? Math.max(0, Math.floor(val)) : 0;
  state.meta.dailyGoalXP = goal;
  saveState(state);
  toast(goal === 0 ? "Daily goal turned off." : `Daily goal set to ${goal} XP.`, true);
  renderHUD();
  renderStats();
});

// initial render
renderStats();
renderHUD();
