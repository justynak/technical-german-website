/* Tests for the data layer and content validation.  Run:  node tests.js
 *
 * No dependencies — plain node. Worth running after every change
 * to lessons.js (content validation) and after every change to state.js.
 */
"use strict";
const fs = require("fs");
const path = require("path");

// --- minimal browser environment --------------------------------------------
const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => {
    store[k] = String(v);
  },
  removeItem: (k) => {
    delete store[k];
  },
};
global.Blob = class Blob {
  constructor(parts) {
    this.parts = parts;
  }
};
global.window = global;

const here = (f) => path.join(__dirname, f);
eval(fs.readFileSync(here("lessons.js"), "utf8"));
eval(fs.readFileSync(here("taxonomy.js"), "utf8"));
eval(fs.readFileSync(here("schedule.js"), "utf8"));
eval(fs.readFileSync(here("state.js"), "utf8"));
const S = window.WD.state;
const SCH = window.WD.schedule;
const TAX = window.WD.taxonomy;

// --- micro test runner -------------------------------------------------------
let pass = 0;
const fails = [];
function test(name, fn) {
  try {
    fn();
    pass++;
  } catch (e) {
    fails.push(name + "\n    " + e.message);
  }
}
function ok(cond, msg) {
  if (!cond) throw new Error(msg || "expected truthy value");
}
function eq(a, b, msg) {
  const x = JSON.stringify(a);
  const y = JSON.stringify(b);
  if (x !== y) throw new Error((msg ? msg + ": " : "") + x + " != " + y);
}

// --- content validation -------------------------------------------------------
test("lessons.js passes validation", () => {
  eq(S.validateLessons(window.LESSONS), [], "problems found");
});

test("validation catches correct out of range", () => {
  const bad = JSON.parse(JSON.stringify(window.LESSONS));
  bad[0].correct = 3; // there are only 3 answers (0..2)
  const p = S.validateLessons(bad);
  ok(p.length === 1 && /correct = 3/.test(p[0]), "not detected: " + JSON.stringify(p));
});

test("validation catches duplicate lesson id", () => {
  const bad = JSON.parse(JSON.stringify(window.LESSONS));
  bad[1].id = bad[0].id;
  ok(S.validateLessons(bad).some((x) => /id powtarza się/.test(x)));
});

test("validation catches the same vocab id with two different meanings", () => {
  const bad = JSON.parse(JSON.stringify(window.LESSONS));
  bad[1].vocab[0].id = "die-leckage"; // id from lesson 1, but different content
  ok(S.validateLessons(bad).some((x) => /dwa różne znaczenia/.test(x)));
});

test("validation catches a missing field", () => {
  const bad = JSON.parse(JSON.stringify(window.LESSONS));
  delete bad[2].situation;
  ok(S.validateLessons(bad).some((x) => /situation/.test(x)));
});

// --- migration from v1 -------------------------------------------------------
const V1 = {
  current: 2,
  completed: [0, 2, 5],
  attempts: { 0: "Die Presse ist kaputt.", 3: "Vorsicht!" },
  vocab: [
    { id: "die leckage|nieszczelność", de: "die Leckage", pl: "nieszczelność", learned: true },
    { id: "własne|moje", de: "die Störung", pl: "awaria", example: "x", learned: false },
  ],
};

test("migration maps indexes to stable lesson ids", () => {
  const m = S.migrateV1(V1);
  ok(m.lessons["awaria-prasy-hydraulicznej"].completed, "index 0");
  ok(m.lessons["zamowienie-czesci-zamiennych"].completed, "index 2");
  ok(m.lessons["raport-serwisowy"].completed, "index 5");
  // index 3 has a recorded answer but was not completed
  ok(!(m.lessons["zgloszenie-zagrozenia-bhp"] || {}).completed, "index 3 was not completed");
  eq(m.current, "zamowienie-czesci-zamiennych");
});

test("migration moves recorded answers into the log under the right lessons", () => {
  const m = S.migrateV1(V1);
  const byLesson = {};
  m.attemptLog.forEach((r) => (byLesson[r.lessonId] = r.text));
  eq(byLesson["awaria-prasy-hydraulicznej"], "Die Presse ist kaputt.");
  eq(byLesson["zgloszenie-zagrozenia-bhp"], "Vorsicht!");
  eq(m.attemptLog.length, 2);
});

test("migration recovers a stable vocab id from its content", () => {
  const m = S.migrateV1(V1);
  ok(m.vocab["die-leckage"], "die Leckage was not matched");
  ok(m.vocab["die-leckage"].learned, "learned status was lost");
  ok(!m.vocab["die-leckage"].custom, "this word is from a lesson, not custom");
});

test("migration keeps custom phrases marked as custom", () => {
  const m = S.migrateV1(V1);
  const own = Object.keys(m.vocab).filter((k) => m.vocab[k].custom);
  eq(own.length, 1);
  eq(m.vocab[own[0]].de, "die Störung");
});

test("migration ignores indexes outside the frozen list", () => {
  const m = S.migrateV1({ completed: [0, 99], attempts: { 42: "x" }, vocab: [] });
  eq(Object.keys(m.lessons), ["awaria-prasy-hydraulicznej"]);
});

test("migrated data carries timestamps that lose to a real save", () => {
  const m = S.migrateV1(V1);
  ok(m.lessons["awaria-prasy-hydraulicznej"].completedAt < Date.now() - 1e9);
});

// --- merge properties ---------------------------------------------------------
const T = 1700000000000;
function mk(over) {
  return Object.assign(
    { schemaVersion: 4, current: null, currentAt: 0, lessons: {}, vocab: {}, review: {}, attemptLog: [], updatedAt: 0 },
    over
  );
}
function word(over) {
  return Object.assign(
    {
      de: "die Leckage",
      pl: "nieszczelność",
      example: "",
      custom: false,
      learned: false,
      learnedAt: 0,
      addedAt: T,
      deleted: false,
      updatedAt: T,
    },
    over
  );
}

test("merge is commutative", () => {
  const a = mk({
    lessons: { l1: { completed: true, completedAt: T, attempt: "a", attemptAt: T + 5 } },
    vocab: { w1: word({ learned: true, learnedAt: T + 9, updatedAt: T + 9 }) },
    current: "l1",
    currentAt: T,
  });
  const b = mk({
    lessons: { l2: { completed: true, completedAt: T + 1, attempt: "b", attemptAt: T + 2 } },
    vocab: { w2: word({ de: "absperren", pl: "odgrodzić" }) },
    current: "l2",
    currentAt: T + 3,
  });
  eq(S.merge(a, b), S.merge(b, a));
});

test("merge is idempotent", () => {
  const a = mk({
    lessons: { l1: { completed: true, completedAt: T, attempt: "a", attemptAt: T } },
    vocab: { w1: word({ learned: true, learnedAt: T }) },
  });
  eq(S.merge(a, a), S.merge(S.merge(a, a), a));
});

test("merge is associative", () => {
  const a = mk({ lessons: { l1: { completed: true, completedAt: T } }, currentAt: 1, current: "l1" });
  const b = mk({ lessons: { l2: { completed: true, completedAt: T } }, currentAt: 2, current: "l2" });
  const c = mk({ vocab: { w1: word({ learned: true, learnedAt: T + 1, updatedAt: T + 1 }) } });
  eq(S.merge(S.merge(a, b), c), S.merge(a, S.merge(b, c)));
});

test("a completed lesson never goes back to uncompleted", () => {
  const done = mk({ lessons: { l1: { completed: true, completedAt: T, attempt: "", attemptAt: 0 } } });
  const stale = mk({ lessons: { l1: { completed: false, completedAt: 0, attempt: "", attemptAt: 0 } } });
  ok(S.merge(stale, done).lessons.l1.completed, "old state erased progress");
  ok(S.merge(done, stale).lessons.l1.completed);
});

test("scenario from the question: an offline phone doesn't erase laptop progress", () => {
  // Monday, laptop: 3 lessons done, "die Leckage" learned
  const laptop = mk({
    lessons: {
      l1: { completed: true, completedAt: T, attempt: "", attemptAt: 0 },
      l2: { completed: true, completedAt: T, attempt: "", attemptAt: 0 },
      l3: { completed: true, completedAt: T, attempt: "", attemptAt: 0 },
    },
    vocab: { leckage: word({ learned: true, learnedAt: T + 100, updatedAt: T + 100 }) },
  });
  // Wednesday, phone: never saw Monday, does l4 and unmarks another word
  const phone = mk({
    lessons: { l4: { completed: true, completedAt: T + 200, attempt: "", attemptAt: 0 } },
    vocab: {
      leckage: word({ learned: false, learnedAt: 0, updatedAt: T }),
      absperren: word({ de: "absperren", pl: "odgrodzić", updatedAt: T + 200, addedAt: T + 200 }),
    },
  });
  const m = S.merge(laptop, phone);
  eq(Object.keys(m.lessons).sort(), ["l1", "l2", "l3", "l4"], "lessons were lost");
  ok(m.vocab.leckage.learned, "the newer learnedAt from the laptop must win");
  ok(m.vocab.absperren, "the word from the phone was lost");
});

test("deleting a word is not revived by merging", () => {
  const withWord = mk({ vocab: { w1: word({ updatedAt: T }) } });
  const deleted = mk({ vocab: { w1: word({ deleted: true, updatedAt: T + 10 }) } });
  ok(S.merge(withWord, deleted).vocab.w1.deleted, "the tombstone lost");
  ok(S.merge(deleted, withWord).vocab.w1.deleted, "the tombstone lost (reverse order)");
});

test("re-adding after deletion wins over the tombstone", () => {
  const deleted = mk({ vocab: { w1: word({ deleted: true, updatedAt: T }) } });
  const readded = mk({ vocab: { w1: word({ deleted: false, updatedAt: T + 10 }) } });
  ok(!S.merge(deleted, readded).vocab.w1.deleted);
});

test("completedAt is the earliest real completion moment", () => {
  const a = mk({ lessons: { l1: { completed: true, completedAt: T + 50, attempt: "", attemptAt: 0 } } });
  const b = mk({ lessons: { l1: { completed: true, completedAt: T, attempt: "", attemptAt: 0 } } });
  eq(S.merge(a, b).lessons.l1.completedAt, T);
});

/* Answers no longer live in `lessons[id].attempt` — so the whole "which
 * version wins" problem is gone. Immutable records in the log just union
 * together with no conflicts to resolve; the log-merging tests below cover that. */

// --- resilience against garbage input -----------------------------------------
test("normalize rejects garbage without crashing", () => {
  eq(S.normalize(null).lessons, {});
  eq(S.normalize("nonsense").vocab, {});
  eq(S.normalize({ lessons: "not-an-object", vocab: [1, 2] }).lessons, {});
  eq(S.normalize({ lessons: { l1: null }, vocab: { w1: { de: 42 } } }).vocab, {});
  eq(S.normalize({ currentAt: -5, updatedAt: "x" }).currentAt, 0);
});

test("normalize lets a valid lesson entry through", () => {
  const n = S.normalize({ lessons: { l1: { completed: 1, completedAt: T, attempt: "x", attemptAt: T } } });
  // `attempt` from v3 is deliberately not carried back — attemptLog is the sole source of truth
  eq(n.lessons.l1, { completed: true, completedAt: T });
});

// --- import/export -------------------------------------------------------------
test("import merges, it doesn't overwrite", () => {
  S.reset();
  S.markCompleted("raport-serwisowy");
  const dump = {
    schemaVersion: 2,
    current: null,
    currentAt: 0,
    updatedAt: T,
    lessons: { "awaria-prasy-hydraulicznej": { completed: true, completedAt: T, attempt: "", attemptAt: 0 } },
    vocab: {},
  };
  const r = S.importJSON(JSON.stringify(dump));
  ok(r.ok, "import failed: " + r.error);
  ok(S.get().lessons["raport-serwisowy"].completed, "import erased existing progress");
  ok(S.get().lessons["awaria-prasy-hydraulicznej"].completed, "import was not loaded");
  eq(S.countDone(), 2);
});

test("importing the same file twice changes nothing", () => {
  S.reset();
  S.markCompleted("raport-serwisowy");
  S.addVocab("die-leckage", "die Leckage", "nieszczelność", "", false);
  const dump = JSON.stringify(S.get());
  S.importJSON(dump);
  const once = JSON.parse(JSON.stringify(S.get()));
  S.importJSON(dump);
  const twice = S.get();
  eq(Object.keys(once.lessons), Object.keys(twice.lessons));
  eq(once.vocab["die-leckage"].learned, twice.vocab["die-leckage"].learned);
});

test("import rejects garbage with a message", () => {
  ok(!S.importJSON("{not json").ok);
  ok(!S.importJSON('{"a":1}').ok);
  ok(!S.importJSON(JSON.stringify({ schemaVersion: 99, lessons: {}, vocab: {} })).ok);
});

test("importing an old v1 file also works", () => {
  S.reset();
  const r = S.importJSON(JSON.stringify(V1));
  ok(r.ok, r.error);
  ok(S.get().lessons["awaria-prasy-hydraulicznej"].completed);
});

// --- localStorage read path -----------------------------------------------------
test("load() migrates the old key and leaves it as a copy", () => {
  delete store["werkdeutsch-state"];
  store["werkdeutsch-state-v1"] = JSON.stringify(V1);
  const s = S.load();
  ok(s.lessons["awaria-prasy-hydraulicznej"].completed, "not migrated");
  ok(store["werkdeutsch-state"], "the new key was not saved");
  ok(store["werkdeutsch-state-v1"], "the old key must remain as a backup");
  eq(JSON.parse(store["werkdeutsch-state"]).schemaVersion, S.SCHEMA_VERSION);
});

test("load() does not migrate a second time when the new key exists", () => {
  store["werkdeutsch-state-v1"] = JSON.stringify(V1);
  store["werkdeutsch-state"] = JSON.stringify(
    mk({ lessons: { "raport-serwisowy": { completed: true, completedAt: T, attempt: "", attemptAt: 0 } } })
  );
  const s = S.load();
  ok(!s.lessons["awaria-prasy-hydraulicznej"], "old data overwrote new data");
  ok(s.lessons["raport-serwisowy"].completed);
});

test("data from a newer version blocks saving (old code from cache)", () => {
  store["werkdeutsch-state"] = JSON.stringify(mk({ schemaVersion: 99 }));
  S.load();
  ok(S.isReadOnly(), "should be read-only");
  eq(S.save(), false, "saving must be blocked");
  ok(/Odśwież/.test(S.takeWarning()), "missing warning for the user");
});

// --- progress tracked by id, not by position -----------------------------------
test("progress survives lessons being reordered", () => {
  store["werkdeutsch-state"] = "";
  delete store["werkdeutsch-state"];
  delete store["werkdeutsch-state-v1"];
  S.reset();
  S.markCompleted("raport-serwisowy");
  S.recordWrite("awaria-prasy-hydraulicznej", "moja odpowiedź", "natural", 1);

  // simulation: prepend a lesson and shuffle the rest
  const shuffled = [{ id: "nowa-lekcja" }].concat(window.LESSONS.slice().reverse());
  const done = shuffled.filter((l) => (S.get().lessons[l.id] || {}).completed).map((l) => l.id);
  eq(done, ["raport-serwisowy"], "progress stuck to the wrong lesson");
  eq(S.latestAttempt("awaria-prasy-hydraulicznej").text, "moja odpowiedź");
});

// --- review schedule (schedule.js) ----------------------------------------------
const DAY = 86400000;
const NOON = SCH.startOfDay(T) + 12 * 3600000; // noon, so day boundaries are visible

test('"good" progresses through the 1-3-7-21-60 intervals', () => {
  let e = null;
  const got = [];
  for (let i = 0; i < 6; i++) {
    e = SCH.next(e, "good", NOON);
    got.push(e.interval);
  }
  eq(got, [1, 3, 7, 21, 60, 60], "interval progression");
  eq(e.reps, 6);
  eq(e.lapses, 0);
});

test('"again" resets progress and bumps the lapse counter', () => {
  let e = SCH.next(null, "good", NOON);
  e = SCH.next(e, "good", NOON);
  eq(e.reps, 2);
  e = SCH.next(e, "again", NOON);
  eq(e.reps, 0, "reps must go back to zero");
  eq(e.lapses, 1);
  eq(e.interval, 0, "should come back later today");
  eq(e.due, NOON, "due = now");
  ok(SCH.isDue(e, NOON), "should be due for review immediately");
});

test('"hard" repeats the same interval: no advance and no reset', () => {
  let e = SCH.next(null, "good", NOON); // interval 1, reps 1
  e = SCH.next(e, "good", NOON); // interval 3, reps 2
  const before = e.reps;
  const lastInterval = e.interval;
  e = SCH.next(e, "hard", NOON);
  eq(e.reps, before, "reps must not change");
  eq(e.interval, lastInterval, "same interval as last time");
  eq(e.lapses, 0, '"hard" is not a lapse');
  // and the next "good" advances further, not from scratch
  eq(SCH.next(e, "good", NOON).interval, 7);
});

test("due dates land on the start of the day, not the review hour", () => {
  const late = SCH.startOfDay(T) + 23 * 3600000; // 23:00
  const e = SCH.next(null, "good", late);
  eq(e.due, SCH.startOfDay(late + DAY), "the due date is not aligned to the day");
  ok(e.due < late + DAY, "a review at 23:00 can't wait until 23:00 the next day");
  ok(!SCH.isDue(e, late), "must not be due immediately");
  ok(SCH.isDue(e, e.due), "must be due starting at midnight");
});

test("daysUntil and daysSince count at day boundaries", () => {
  eq(SCH.daysUntil(NOON, NOON), 0);
  eq(SCH.daysUntil(NOON + DAY, NOON), 1);
  eq(SCH.daysUntil(NOON - 2 * DAY, NOON), -2, "overdue values are negative");
  eq(SCH.daysSince(NOON - 3 * DAY, NOON), 3);
  eq(SCH.daysSince(0, NOON), null, "no date = no answer");
});

test("first() schedules the first review for tomorrow, with no grade", () => {
  const e = SCH.first(NOON);
  eq(e.interval, 1);
  eq(e.reps, 0, "completing a lesson is not yet a successful review");
  eq(e.lastGrade, "");
  ok(!SCH.isDue(e, NOON), "must not be due immediately");
});

test("isDue rejects empty and unscheduled entries", () => {
  ok(!SCH.isDue(null, NOON));
  ok(!SCH.isDue({ due: 0 }, NOON));
});

// --- reviews in state ------------------------------------------------------------
test("completing a lesson enters it into the review rotation", () => {
  S.reset();
  ok(!S.reviewOf("raport-serwisowy"), "no schedule before completion");
  S.markCompleted("raport-serwisowy");
  const e = S.reviewOf("raport-serwisowy");
  ok(e, "missing schedule entry");
  eq(e.interval, 1);
  ok(!SCH.isDue(e, Date.now()), "must not be due the same day");
});

test("the schedule is keyed by type and id, not by id alone", () => {
  S.reset();
  S.markCompleted("raport-serwisowy");
  eq(Object.keys(S.get().review), ["lesson:raport-serwisowy"]);
});

test("completing a lesson again does not erase the existing schedule", () => {
  S.reset();
  S.markCompleted("raport-serwisowy");
  S.gradeLesson("raport-serwisowy", "good");
  const before = S.reviewOf("raport-serwisowy").interval;
  S.markCompleted("raport-serwisowy");
  eq(S.reviewOf("raport-serwisowy").interval, before, "the schedule was reset");
});

test("gradeLesson rejects an unknown grade", () => {
  S.reset();
  S.markCompleted("raport-serwisowy");
  eq(S.gradeLesson("raport-serwisowy", "swietnie"), null);
});

test("dueLessons returns only overdue ones, oldest first", () => {
  S.reset();
  const ids = window.LESSONS.map((l) => l.id);
  S.markCompleted(ids[0]);
  S.markCompleted(ids[1]);
  S.markCompleted(ids[2]);
  const now = Date.now();
  eq(S.dueLessons(ids, now), [], "freshly completed ones are not due yet");

  // move the clock 2 days ahead and vary the due dates
  const later = now + 2 * DAY;
  S.get().review["lesson:" + ids[1]].due = now - 5 * DAY; // the most overdue
  S.get().review["lesson:" + ids[0]].due = now - 1 * DAY;
  eq(S.dueLessons(ids, later), [ids[1], ids[0], ids[2]]);
});

test("dueLessons ignores lessons removed from the content", () => {
  S.reset();
  S.markCompleted("raport-serwisowy");
  S.get().review["lesson:juz-nie-istnieje"] = SCH.first(1);
  eq(S.dueLessons(["raport-serwisowy"], Date.now() + 5 * DAY), ["raport-serwisowy"]);
});

test("reviewStats reports overdue, scheduled, and the next due date", () => {
  S.reset();
  const ids = window.LESSONS.map((l) => l.id);
  S.markCompleted(ids[0]);
  S.markCompleted(ids[1]);
  let st = S.reviewStats(ids, Date.now());
  eq(st.due, 0);
  eq(st.scheduled, 2);
  ok(st.nextDue > Date.now(), "missing next due date");

  S.get().review["lesson:" + ids[0]].due = Date.now() - DAY;
  st = S.reviewStats(ids, Date.now());
  eq(st.due, 1);
  eq(st.scheduled, 2);
});

// --- schedule merging --------------------------------------------------------
function logRec(id, lessonId, at) {
  return {
    id: id,
    lessonId: lessonId,
    contentVersion: 1,
    mode: "write",
    at: at,
    text: "tekst " + id,
    shownRegister: "natural",
    choiceIndex: -1,
    correctIndex: -1,
    isCorrect: null,
    tagging: {
      status: "pending",
      tags: [],
      rejected: [],
      taggerVersion: "",
      taxonomyVersion: 0,
      at: 0,
      tries: 0,
      error: "",
    },
  };
}

function rev(over) {
  return Object.assign(
    { due: T + DAY, interval: 1, reps: 0, lapses: 0, lastGrade: "", lastReviewAt: 0, updatedAt: T },
    over
  );
}

test("schedule merging is commutative and idempotent", () => {
  const a = mk({ review: { "lesson:x": rev({ reps: 3, lastReviewAt: T + 10, due: T + 7 * DAY }) } });
  const b = mk({ review: { "lesson:x": rev({ reps: 1, lastReviewAt: T + 5, due: T + DAY }) } });
  eq(S.merge(a, b), S.merge(b, a));
  eq(S.merge(a, b), S.merge(S.merge(a, b), S.merge(a, b)));
});

test("the schedule is taken from the most recent real review", () => {
  const stary = mk({
    review: { "lesson:x": rev({ due: T + 60 * DAY, interval: 60, reps: 5, lastReviewAt: T }) },
  });
  const nowy = mk({
    review: {
      "lesson:x": rev({ due: T + 2 * DAY, interval: 0, reps: 0, lapses: 1, lastGrade: "again", lastReviewAt: T + 999 }),
    },
  });
  const m = S.merge(stary, nowy).review["lesson:x"];
  eq(m.lastGrade, "again", "the newer grade must win");
  eq(m.due, T + 2 * DAY);
  eq(m.lapses, 1);
});

test("counters are merged by maximum, not sum — otherwise merging isn't idempotent", () => {
  const a = mk({ review: { "lesson:x": rev({ reps: 4, lapses: 2, lastReviewAt: T }) } });
  const b = mk({ review: { "lesson:x": rev({ reps: 2, lapses: 1, lastReviewAt: T }) } });
  const once = S.merge(a, b).review["lesson:x"];
  eq(once.reps, 4);
  eq(once.lapses, 2);
  const twice = S.merge(S.merge(a, b), b).review["lesson:x"];
  eq(twice.reps, 4, "merging again bumped the counter");
});

test("an entry present on only one device is not lost", () => {
  const a = mk({ review: { "lesson:x": rev({ reps: 2, lastReviewAt: T }) } });
  const b = mk({ review: { "lesson:y": rev({ reps: 1, lastReviewAt: T }) } });
  eq(Object.keys(S.merge(a, b).review).sort(), ["lesson:x", "lesson:y"]);
});

test("normalize rejects schedule entries without a type in the key", () => {
  const n = S.normalize({ review: { "bez-typu": rev(), "lesson:ok": rev(), zle: null } });
  eq(Object.keys(n.review), ["lesson:ok"]);
});

test("export and import preserve the schedule", () => {
  S.reset();
  S.markCompleted("raport-serwisowy");
  S.gradeLesson("raport-serwisowy", "good");
  const dump = JSON.stringify(S.get());
  const interval = S.reviewOf("raport-serwisowy").interval;
  S.reset();
  ok(S.importJSON(dump).ok);
  eq(S.reviewOf("raport-serwisowy").interval, interval);
});

test("v2 data (without a schedule) loads without error", () => {
  delete store["werkdeutsch-state-v1"];
  store["werkdeutsch-state"] = JSON.stringify({
    schemaVersion: 2,
    current: "raport-serwisowy",
    currentAt: T,
    lessons: { "raport-serwisowy": { completed: true, completedAt: T, attempt: "x", attemptAt: T } },
    vocab: {},
    updatedAt: T,
  });
  const s = S.load();
  eq(s.review, {}, "a missing review map should yield an empty map");
  ok(s.lessons["raport-serwisowy"].completed, "progress from v2 was lost");
  eq(S.latestAttempt("raport-serwisowy").text, "x", "the v2 answer must enter the log");
  S.save();
  eq(JSON.parse(store["werkdeutsch-state"]).schemaVersion, S.SCHEMA_VERSION, "saving should bump the version");
});

test("reset also clears the schedule", () => {
  S.markCompleted("raport-serwisowy");
  S.reset();
  eq(S.get().review, {});
});

// --- error taxonomy ------------------------------------------------------------
test("the taxonomy has unique ids and a version", () => {
  ok(TAX.VERSION > 0);
  eq(new Set(TAX.IDS).size, TAX.IDS.length, "duplicate category id");
  TAX.CATEGORIES.forEach((c) => {
    ok(c.group && c.label, "category missing group/label: " + c.id);
  });
});

test("accept lets known labels through and rejects unknown ones", () => {
  const r = TAX.accept(["case_dativ", "wymyslona_kategoria", "case_dativ", "", 42, "spelling"]);
  eq(r.tags, ["case_dativ", "spelling"], "duplicates and garbage should be dropped");
  eq(r.rejected, ["wymyslona_kategoria"]);
});

test("accept tolerates missing data", () => {
  eq(TAX.accept(null).tags, []);
  eq(TAX.accept("not an array").tags, []);
});

test("summarize deterministically counts only entries with status done", () => {
  const attempts = [
    { text: "a", tagging: { status: "done", tags: ["case_dativ", "spelling"] } },
    { text: "b", tagging: { status: "done", tags: ["case_dativ"] } },
    { text: "c", tagging: { status: "pending", tags: ["case_dativ"] } },
    { text: "d", tagging: { status: "failed", tags: ["spelling"] } },
    { text: "e", tagging: { status: "done", tags: ["nieznana"] } },
  ];
  const sum = TAX.summarize(attempts);
  eq(sum.sourceAttemptCount, 3, "only done entries are counted");
  eq(sum.topCategories.length, 2, "an unknown label must not enter the summary");
  eq(sum.topCategories[0].category, "case_dativ");
  eq(sum.topCategories[0].count, 2);
  ok(sum.topCategories[0].label.length > 0, "missing human-readable label");
  eq(sum.taxonomyVersion, TAX.VERSION, "the summary must carry the taxonomy version");
  // the same count on a tie must give a reproducible order
  eq(JSON.stringify(TAX.summarize(attempts)), JSON.stringify(sum));
});

// --- lesson provenance fields ---------------------------------------------------
test("applyLessonDefaults fills in kind/origin/status/contentVersion", () => {
  const [l] = S.applyLessonDefaults([{ id: "x" }]);
  eq(l.kind, "scenario");
  eq(l.origin, "static");
  eq(l.status, "published");
  eq(l.contentVersion, 1);
  eq(l.targetWeaknesses, []);
});

test("applyLessonDefaults does not overwrite values given in the content", () => {
  const [l] = S.applyLessonDefaults([
    { id: "x", kind: "sentences", origin: "generated", status: "draft", contentVersion: 3 },
  ]);
  eq(l.kind, "sentences");
  eq(l.origin, "generated");
  eq(l.status, "draft");
  eq(l.contentVersion, 3);
});

test("all hand-written lessons have targetWeaknesses from the known taxonomy", () => {
  window.LESSONS.forEach((l) => {
    ok(Array.isArray(l.targetWeaknesses) && l.targetWeaknesses.length, l.id + ": missing targetWeaknesses");
    l.targetWeaknesses.forEach((t) => ok(TAX.isKnown(t), l.id + ": unknown category " + t));
  });
});

test("validation rejects an unknown category in targetWeaknesses", () => {
  const bad = JSON.parse(JSON.stringify(window.LESSONS));
  bad[0].targetWeaknesses = ["case_dativ", "zmyslona"];
  ok(S.validateLessons(bad).some((p) => /nieznaną kategorię "zmyslona"/.test(p)));
});

test("validation rejects an unknown kind and status", () => {
  const bad = JSON.parse(JSON.stringify(window.LESSONS));
  bad[0].kind = "quiz";
  bad[1].status = "maybe";
  const p = S.validateLessons(bad);
  ok(p.some((x) => /nieznany kind/.test(x)));
  ok(p.some((x) => /nieznany status/.test(x)));
});

test("a generated lesson without targetWeaknesses is an error", () => {
  const bad = JSON.parse(JSON.stringify(window.LESSONS));
  bad[0].origin = "generated";
  bad[0].targetWeaknesses = [];
  ok(S.validateLessons(bad).some((p) => /generowana musi mieć targetWeaknesses/.test(p)));
});

// --- attempt log -----------------------------------------------------------------
test("every attempt appends a new record, nothing is overwritten", () => {
  S.reset();
  S.recordWrite("raport-serwisowy", "pierwsza wersja", "natural", 1);
  S.recordWrite("raport-serwisowy", "druga wersja", "professional", 1);
  S.recordWrite("raport-serwisowy", "trzecia wersja", "simple", 1);
  eq(S.attemptCount(), 3, "history must remain");
  eq(S.latestAttempt("raport-serwisowy").text, "trzecia wersja");
  eq(S.latestAttempt("raport-serwisowy").shownRegister, "simple");
});

test("an empty attempt does not enter the log", () => {
  S.reset();
  eq(S.recordWrite("raport-serwisowy", "   ", "natural", 1), null);
  eq(S.attemptCount(), 0);
});

test("a record saves which register was shown and the content version", () => {
  S.reset();
  const r = S.recordWrite("raport-serwisowy", "test", "professional", 7);
  eq(r.shownRegister, "professional");
  eq(r.contentVersion, 7);
  eq(r.mode, "write");
});

test("free-text correctness is null, not false", () => {
  S.reset();
  const r = S.recordWrite("raport-serwisowy", "cokolwiek", "natural", 1);
  eq(r.isCorrect, null, '"ungraded" is not the same as "wrong"');
});

test("a multiple-choice pick is graded without any model", () => {
  S.reset();
  const good = S.recordChoice("raport-serwisowy", 2, 2, 1);
  const bad = S.recordChoice("raport-serwisowy", 0, 2, 1);
  eq(good.isCorrect, true);
  eq(bad.isCorrect, false);
  eq(bad.choiceIndex, 0);
  eq(bad.correctIndex, 2);
  eq(S.attemptCount(), 2);
});

test("attempt ids are unique even when saved in the same millisecond", () => {
  S.reset();
  const ids = new Set();
  for (let i = 0; i < 300; i++) ids.add(S.recordWrite("x", "t" + i, "natural", 1).id);
  eq(ids.size, 300, "id collision");
});

test('tagging state is explicit, not "null until the job runs"', () => {
  S.reset();
  const r = S.recordWrite("raport-serwisowy", "test", "natural", 1);
  eq(r.tagging.status, "pending");
  eq(r.tagging.tries, 0);
  eq(r.tagging.tags, []);
  eq(S.pendingTagging().length, 1);
});

test("setTagging saves the taxonomy version and filters out unknown labels", () => {
  S.reset();
  const r = S.recordWrite("raport-serwisowy", "test", "natural", 1);
  const t = S.setTagging(r.id, {
    status: "done",
    tags: ["case_dativ", "wymyslone"],
    taggerVersion: "claude-x/prompt-v1",
  });
  eq(t.tagging.tags, ["case_dativ"]);
  eq(t.tagging.rejected, ["wymyslone"], "unknown labels need to be visible, not hidden");
  eq(t.tagging.taxonomyVersion, TAX.VERSION);
  eq(t.tagging.taggerVersion, "claude-x/prompt-v1");
  eq(t.tagging.tries, 1);
  eq(S.pendingTagging().length, 0);
});

test("a failed tagging attempt bumps the try counter and keeps the reason", () => {
  S.reset();
  const r = S.recordWrite("raport-serwisowy", "test", "natural", 1);
  S.setTagging(r.id, { status: "failed", error: "timeout" });
  const again = S.setTagging(r.id, { status: "failed", error: "timeout" });
  eq(again.tagging.tries, 2, "without a counter there's no way to know when to give up");
  eq(again.tagging.error, "timeout");
  eq(again.tagging.status, "failed");
});

test("tagging only applies to free text", () => {
  S.reset();
  S.recordChoice("raport-serwisowy", 1, 2, 1);
  eq(S.pendingTagging().length, 0, "a multiple-choice pick doesn't need a model");
});

test("attemptsSince returns a rolling window", () => {
  S.reset();
  const r1 = S.recordWrite("a", "stara", "natural", 1);
  const r2 = S.recordWrite("b", "nowa", "natural", 1);
  S.get().attemptLog.find((x) => x.id === r1.id).at = Date.now() - 30 * DAY;
  eq(S.attemptsSince(Date.now() - 7 * DAY).length, 1);
  eq(S.attemptsSince(0).length, 2);
  eq(S.attemptsSince(Date.now() - 7 * DAY)[0].id, r2.id);
});

// --- attempt log merging -----------------------------------------------------
test("merging the log is a set union — nothing is lost", () => {
  S.reset();
  const laptop = mk({ attemptLog: [logRec("a1", "x", T), logRec("a2", "x", T + 1)] });
  const phone = mk({ attemptLog: [logRec("a3", "y", T + 2)] });
  const m = S.merge(laptop, phone);
  eq(m.attemptLog.map((r) => r.id), ["a1", "a2", "a3"]);
  eq(S.merge(phone, laptop).attemptLog.map((r) => r.id), ["a1", "a2", "a3"], "order must not matter");
});

test("merging the log is idempotent", () => {
  const a = mk({ attemptLog: [logRec("a1", "x", T)] });
  const b = mk({ attemptLog: [logRec("a2", "y", T + 5)] });
  eq(S.merge(S.merge(a, b), b), S.merge(a, b));
});

test('labels tagged on one device win over "pending" from the other', () => {
  const tagged = mk({
    attemptLog: [
      Object.assign(logRec("a1", "x", T), {
        tagging: {
          status: "done",
          tags: ["case_dativ"],
          rejected: [],
          taggerVersion: "v1",
          taxonomyVersion: 1,
          at: T + 100,
          tries: 1,
          error: "",
        },
      }),
    ],
  });
  const untagged = mk({ attemptLog: [logRec("a1", "x", T)] });
  eq(S.merge(untagged, tagged).attemptLog[0].tagging.tags, ["case_dativ"]);
  eq(S.merge(tagged, untagged).attemptLog[0].tagging.tags, ["case_dativ"]);
});

test("normalize rejects records without id or lessonId, and duplicates", () => {
  const n = S.normalize({
    attemptLog: [
      logRec("a1", "x", T),
      logRec("a1", "x", T), // duplicate
      { id: "", lessonId: "x", at: T },
      { id: "a9", at: T },
      "garbage",
    ],
  });
  eq(n.attemptLog.map((r) => r.id), ["a1"]);
});

// --- v3 → v4 migration -------------------------------------------------------
test("v3 migration salvages the last answer into the log", () => {
  delete store["werkdeutsch-state-v1"];
  store["werkdeutsch-state"] = JSON.stringify({
    schemaVersion: 3,
    current: "raport-serwisowy",
    currentAt: T,
    lessons: {
      "raport-serwisowy": { completed: true, completedAt: T, attempt: "moja odpowiedź", attemptAt: T + 5 },
      "awaria-prasy-hydraulicznej": { completed: false, completedAt: 0, attempt: "", attemptAt: 0 },
    },
    vocab: {},
    review: {},
    updatedAt: T,
  });
  const s = S.load();
  eq(s.attemptLog.length, 1, "empty answers must not enter the log");
  eq(s.attemptLog[0].lessonId, "raport-serwisowy");
  eq(s.attemptLog[0].text, "moja odpowiedź");
  eq(s.attemptLog[0].at, T + 5, "the timestamp from v3 must be kept");
  eq(S.latestAttempt("raport-serwisowy").text, "moja odpowiedź");
  ok(s.lessons["raport-serwisowy"].completed, "progress from v3 must be kept");
  eq(JSON.parse(store["werkdeutsch-state"]).schemaVersion, 4, "the migration must save itself");
});

test("after migration, lessons no longer have an attempt field (single source of truth)", () => {
  eq(S.get().lessons["raport-serwisowy"].attempt, undefined);
});

test("v1 migration also lands straight in the log", () => {
  delete store["werkdeutsch-state"];
  store["werkdeutsch-state-v1"] = JSON.stringify(V1);
  const s = S.load();
  eq(s.attemptLog.length, 2);
  eq(S.latestAttempt("awaria-prasy-hydraulicznej").text, "Die Presse ist kaputt.");
  eq(S.latestAttempt("zgloszenie-zagrozenia-bhp").text, "Vorsicht!");
});

// --- export for analysis -------------------------------------------------------
test("export for analysis contains the window, versions, and attempt count", () => {
  S.reset();
  S.recordWrite("raport-serwisowy", "Klemme nachgezogen.", "natural", 1);
  S.recordChoice("raport-serwisowy", 0, 2, 1);
  const pack = S.exportAttempts(7);
  eq(pack.periodDays, 7);
  eq(pack.sourceAttemptCount, 2);
  eq(pack.taxonomyVersion, TAX.VERSION);
  eq(pack.schemaVersion, S.SCHEMA_VERSION);
  eq(pack.knownCategories.length, TAX.IDS.length, "the tagger must know the allowed categories");
  ok(pack.since < pack.exportedAt);
});

test("export adds lesson context with all three patterns", () => {
  S.reset();
  S.recordWrite("raport-serwisowy", "test", "simple", 1);
  const byId = (id) => window.LESSONS.filter((l) => l.id === id)[0];
  const a = S.exportAttempts(7, byId).attempts[0];
  eq(a.lesson.title, byId("raport-serwisowy").title);
  ok(a.lesson.references.simple && a.lesson.references.natural && a.lesson.references.professional,
    "correctness can't be graded without all registers");
  eq(a.shownRegister, "simple", "need to know what they saw");
  eq(a.lesson.targetWeaknesses.length, 3);
});

test("export detects that lesson content changed after the attempt was saved", () => {
  S.reset();
  S.recordWrite("raport-serwisowy", "test", "natural", 1);
  const stale = (id) => Object.assign({}, window.LESSONS.filter((l) => l.id === id)[0], { contentVersion: 2 });
  eq(S.exportAttempts(7, stale).attempts[0].contentDrift, true);
  const fresh = (id) => Object.assign({}, window.LESSONS.filter((l) => l.id === id)[0], { contentVersion: 1 });
  eq(S.exportAttempts(7, fresh).attempts[0].contentDrift, false);
});

test("export respects the rolling window", () => {
  S.reset();
  const old = S.recordWrite("a", "stara", "natural", 1);
  S.recordWrite("b", "nowa", "natural", 1);
  S.get().attemptLog.find((x) => x.id === old.id).at = Date.now() - 40 * DAY;
  eq(S.exportAttempts(7).sourceAttemptCount, 1);
  eq(S.exportAttempts(60).sourceAttemptCount, 2);
});

test("the progress copy carries the attempt log", () => {
  S.reset();
  S.recordWrite("raport-serwisowy", "zapamiętaj mnie", "natural", 1);
  const dump = JSON.stringify(S.get());
  S.reset();
  eq(S.attemptCount(), 0);
  ok(S.importJSON(dump).ok);
  eq(S.attemptCount(), 1);
  eq(S.latestAttempt("raport-serwisowy").text, "zapamiętaj mnie");
});

test("importing the same file twice does not duplicate attempts", () => {
  S.reset();
  S.recordWrite("raport-serwisowy", "raz", "natural", 1);
  const dump = JSON.stringify(S.get());
  S.importJSON(dump);
  S.importJSON(dump);
  eq(S.attemptCount(), 1, "immutable records with unique ids must not duplicate");
});

// --- result --------------------------------------------------------------------
console.log("");
if (fails.length) {
  console.log("FAILED (" + fails.length + "):");
  fails.forEach((f) => console.log("  ✗ " + f));
}
console.log(pass + " passed, " + fails.length + " failed");
process.exit(fails.length ? 1 : 0);
