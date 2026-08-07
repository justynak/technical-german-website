/* Testy warstwy danych i walidacji treści.  Uruchom:  node tests.js
 *
 * Bez żadnych zależności — czysty node. Warto odpalić po każdej zmianie
 * w lessons.js (walidacja treści) i po każdej zmianie w state.js.
 */
"use strict";
const fs = require("fs");
const path = require("path");

// --- minimalne środowisko przeglądarki -------------------------------------
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

// --- mikro-runner -----------------------------------------------------------
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
  if (!cond) throw new Error(msg || "oczekiwano prawdy");
}
function eq(a, b, msg) {
  const x = JSON.stringify(a);
  const y = JSON.stringify(b);
  if (x !== y) throw new Error((msg ? msg + ": " : "") + x + " != " + y);
}

// --- walidacja treści -------------------------------------------------------
test("lessons.js przechodzi walidację", () => {
  eq(S.validateLessons(window.LESSONS), [], "znalezione problemy");
});

test("walidacja łapie correct poza zakresem", () => {
  const bad = JSON.parse(JSON.stringify(window.LESSONS));
  bad[0].correct = 3; // są tylko 3 odpowiedzi (0..2)
  const p = S.validateLessons(bad);
  ok(p.length === 1 && /correct = 3/.test(p[0]), "nie wykryto: " + JSON.stringify(p));
});

test("walidacja łapie powtórzone id lekcji", () => {
  const bad = JSON.parse(JSON.stringify(window.LESSONS));
  bad[1].id = bad[0].id;
  ok(S.validateLessons(bad).some((x) => /id powtarza się/.test(x)));
});

test("walidacja łapie to samo id słówka o dwóch znaczeniach", () => {
  const bad = JSON.parse(JSON.stringify(window.LESSONS));
  bad[1].vocab[0].id = "die-leckage"; // id z lekcji 1, ale inna treść
  ok(S.validateLessons(bad).some((x) => /dwa różne znaczenia/.test(x)));
});

test("walidacja łapie brakujące pole", () => {
  const bad = JSON.parse(JSON.stringify(window.LESSONS));
  delete bad[2].situation;
  ok(S.validateLessons(bad).some((x) => /situation/.test(x)));
});

// --- migracja z v1 ----------------------------------------------------------
const V1 = {
  current: 2,
  completed: [0, 2, 5],
  attempts: { 0: "Die Presse ist kaputt.", 3: "Vorsicht!" },
  vocab: [
    { id: "die leckage|nieszczelność", de: "die Leckage", pl: "nieszczelność", learned: true },
    { id: "własne|moje", de: "die Störung", pl: "awaria", example: "x", learned: false },
  ],
};

test("migracja mapuje indeksy na trwałe id lekcji", () => {
  const m = S.migrateV1(V1);
  ok(m.lessons["awaria-prasy-hydraulicznej"].completed, "indeks 0");
  ok(m.lessons["zamowienie-czesci-zamiennych"].completed, "indeks 2");
  ok(m.lessons["raport-serwisowy"].completed, "indeks 5");
  // indeks 3 ma wpisaną odpowiedź, ale nie był ukończony
  ok(!(m.lessons["zgloszenie-zagrozenia-bhp"] || {}).completed, "indeks 3 nie był ukończony");
  eq(m.current, "zamowienie-czesci-zamiennych");
});

test("migracja przenosi wpisane odpowiedzi do dziennika pod właściwe lekcje", () => {
  const m = S.migrateV1(V1);
  const byLesson = {};
  m.attemptLog.forEach((r) => (byLesson[r.lessonId] = r.text));
  eq(byLesson["awaria-prasy-hydraulicznej"], "Die Presse ist kaputt.");
  eq(byLesson["zgloszenie-zagrozenia-bhp"], "Vorsicht!");
  eq(m.attemptLog.length, 2);
});

test("migracja odzyskuje trwałe id słówka po treści", () => {
  const m = S.migrateV1(V1);
  ok(m.vocab["die-leckage"], "nie dopasowano die Leckage");
  ok(m.vocab["die-leckage"].learned, "zgubiono status opanowania");
  ok(!m.vocab["die-leckage"].custom, "to słówko z lekcji, nie własne");
});

test("migracja zachowuje własne zwroty jako custom", () => {
  const m = S.migrateV1(V1);
  const own = Object.keys(m.vocab).filter((k) => m.vocab[k].custom);
  eq(own.length, 1);
  eq(m.vocab[own[0]].de, "die Störung");
});

test("migracja ignoruje indeksy poza zamrożoną listą", () => {
  const m = S.migrateV1({ completed: [0, 99], attempts: { 42: "x" }, vocab: [] });
  eq(Object.keys(m.lessons), ["awaria-prasy-hydraulicznej"]);
});

test("zmigrowane dane mają znaczniki czasu przegrywające z realnym zapisem", () => {
  const m = S.migrateV1(V1);
  ok(m.lessons["awaria-prasy-hydraulicznej"].completedAt < Date.now() - 1e9);
});

// --- właściwości scalania ---------------------------------------------------
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

test("merge jest przemienny", () => {
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

test("merge jest idempotentny", () => {
  const a = mk({
    lessons: { l1: { completed: true, completedAt: T, attempt: "a", attemptAt: T } },
    vocab: { w1: word({ learned: true, learnedAt: T }) },
  });
  eq(S.merge(a, a), S.merge(S.merge(a, a), a));
});

test("merge jest łączny", () => {
  const a = mk({ lessons: { l1: { completed: true, completedAt: T } }, currentAt: 1, current: "l1" });
  const b = mk({ lessons: { l2: { completed: true, completedAt: T } }, currentAt: 2, current: "l2" });
  const c = mk({ vocab: { w1: word({ learned: true, learnedAt: T + 1, updatedAt: T + 1 }) } });
  eq(S.merge(S.merge(a, b), c), S.merge(a, S.merge(b, c)));
});

test("ukończona lekcja nigdy nie wraca do nieukończonej", () => {
  const done = mk({ lessons: { l1: { completed: true, completedAt: T, attempt: "", attemptAt: 0 } } });
  const stale = mk({ lessons: { l1: { completed: false, completedAt: 0, attempt: "", attemptAt: 0 } } });
  ok(S.merge(stale, done).lessons.l1.completed, "stary stan skasował postęp");
  ok(S.merge(done, stale).lessons.l1.completed);
});

test("scenariusz z pytania: telefon offline nie kasuje postępu z laptopa", () => {
  // Poniedziałek, laptop: 3 lekcje zrobione, „die Leckage” opanowana
  const laptop = mk({
    lessons: {
      l1: { completed: true, completedAt: T, attempt: "", attemptAt: 0 },
      l2: { completed: true, completedAt: T, attempt: "", attemptAt: 0 },
      l3: { completed: true, completedAt: T, attempt: "", attemptAt: 0 },
    },
    vocab: { leckage: word({ learned: true, learnedAt: T + 100, updatedAt: T + 100 }) },
  });
  // Środa, telefon: nigdy nie widział poniedziałku, robi l4 i odznacza inne słówko
  const phone = mk({
    lessons: { l4: { completed: true, completedAt: T + 200, attempt: "", attemptAt: 0 } },
    vocab: {
      leckage: word({ learned: false, learnedAt: 0, updatedAt: T }),
      absperren: word({ de: "absperren", pl: "odgrodzić", updatedAt: T + 200, addedAt: T + 200 }),
    },
  });
  const m = S.merge(laptop, phone);
  eq(Object.keys(m.lessons).sort(), ["l1", "l2", "l3", "l4"], "zgubiono lekcje");
  ok(m.vocab.leckage.learned, "nowszy learnedAt z laptopa musi wygrać");
  ok(m.vocab.absperren, "zgubiono słówko z telefonu");
});

test("usunięcie słówka nie jest wskrzeszane przez scalanie", () => {
  const withWord = mk({ vocab: { w1: word({ updatedAt: T }) } });
  const deleted = mk({ vocab: { w1: word({ deleted: true, updatedAt: T + 10 }) } });
  ok(S.merge(withWord, deleted).vocab.w1.deleted, "nagrobek przegrał");
  ok(S.merge(deleted, withWord).vocab.w1.deleted, "nagrobek przegrał (odwrotna kolejność)");
});

test("ponowne dodanie po usunięciu wygrywa z nagrobkiem", () => {
  const deleted = mk({ vocab: { w1: word({ deleted: true, updatedAt: T }) } });
  const readded = mk({ vocab: { w1: word({ deleted: false, updatedAt: T + 10 }) } });
  ok(!S.merge(deleted, readded).vocab.w1.deleted);
});

test("completedAt to najwcześniejszy prawdziwy moment ukończenia", () => {
  const a = mk({ lessons: { l1: { completed: true, completedAt: T + 50, attempt: "", attemptAt: 0 } } });
  const b = mk({ lessons: { l1: { completed: true, completedAt: T, attempt: "", attemptAt: 0 } } });
  eq(S.merge(a, b).lessons.l1.completedAt, T);
});

/* Odpowiedzi nie mieszkają już w `lessons[id].attempt` — zniknął więc cały
 * problem „która wersja wygrywa”. Niezmienne rekordy w dzienniku sumują się
 * bez rozstrzygania konfliktów; pokrywają to testy scalania dziennika niżej. */

// --- odporność na śmieci ----------------------------------------------------
test("normalize odrzuca śmieci bez wysypywania się", () => {
  eq(S.normalize(null).lessons, {});
  eq(S.normalize("nonsens").vocab, {});
  eq(S.normalize({ lessons: "nie-obiekt", vocab: [1, 2] }).lessons, {});
  eq(S.normalize({ lessons: { l1: null }, vocab: { w1: { de: 42 } } }).vocab, {});
  eq(S.normalize({ currentAt: -5, updatedAt: "x" }).currentAt, 0);
});

test("normalize przepuszcza poprawny wpis lekcji", () => {
  const n = S.normalize({ lessons: { l1: { completed: 1, completedAt: T, attempt: "x", attemptAt: T } } });
  // `attempt` z v3 celowo nie wraca — jedynym źródłem prawdy jest attemptLog
  eq(n.lessons.l1, { completed: true, completedAt: T });
});

// --- import/eksport ---------------------------------------------------------
test("import scala, a nie nadpisuje", () => {
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
  ok(r.ok, "import się nie udał: " + r.error);
  ok(S.get().lessons["raport-serwisowy"].completed, "import skasował istniejący postęp");
  ok(S.get().lessons["awaria-prasy-hydraulicznej"].completed, "nie wczytano importu");
  eq(S.countDone(), 2);
});

test("import tego samego pliku dwa razy nic nie zmienia", () => {
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

test("import odrzuca śmieci z komunikatem", () => {
  ok(!S.importJSON("{nie json").ok);
  ok(!S.importJSON('{"a":1}').ok);
  ok(!S.importJSON(JSON.stringify({ schemaVersion: 99, lessons: {}, vocab: {} })).ok);
});

test("import starego pliku v1 też działa", () => {
  S.reset();
  const r = S.importJSON(JSON.stringify(V1));
  ok(r.ok, r.error);
  ok(S.get().lessons["awaria-prasy-hydraulicznej"].completed);
});

// --- ścieżka odczytu z localStorage ----------------------------------------
test("load() migruje stary klucz i zostawia go jako kopię", () => {
  delete store["werkdeutsch-state"];
  store["werkdeutsch-state-v1"] = JSON.stringify(V1);
  const s = S.load();
  ok(s.lessons["awaria-prasy-hydraulicznej"].completed, "nie zmigrowano");
  ok(store["werkdeutsch-state"], "nie zapisano nowego klucza");
  ok(store["werkdeutsch-state-v1"], "stary klucz musi zostać jako backup");
  eq(JSON.parse(store["werkdeutsch-state"]).schemaVersion, S.SCHEMA_VERSION);
});

test("load() nie migruje drugi raz, gdy nowy klucz istnieje", () => {
  store["werkdeutsch-state-v1"] = JSON.stringify(V1);
  store["werkdeutsch-state"] = JSON.stringify(
    mk({ lessons: { "raport-serwisowy": { completed: true, completedAt: T, attempt: "", attemptAt: 0 } } })
  );
  const s = S.load();
  ok(!s.lessons["awaria-prasy-hydraulicznej"], "stare dane nadpisały nowe");
  ok(s.lessons["raport-serwisowy"].completed);
});

test("dane z nowszej wersji blokują zapis (stary kod z cache)", () => {
  store["werkdeutsch-state"] = JSON.stringify(mk({ schemaVersion: 99 }));
  S.load();
  ok(S.isReadOnly(), "powinno być read-only");
  eq(S.save(), false, "zapis musi być zablokowany");
  ok(/Odśwież/.test(S.takeWarning()), "brak ostrzeżenia dla użytkownika");
});

// --- postęp liczony po id, nie po pozycji ----------------------------------
test("postęp przeżywa przestawienie kolejności lekcji", () => {
  store["werkdeutsch-state"] = "";
  delete store["werkdeutsch-state"];
  delete store["werkdeutsch-state-v1"];
  S.reset();
  S.markCompleted("raport-serwisowy");
  S.recordWrite("awaria-prasy-hydraulicznej", "moja odpowiedź", "natural", 1);

  // symulacja: dopisujemy lekcję na początku i tasujemy resztę
  const shuffled = [{ id: "nowa-lekcja" }].concat(window.LESSONS.slice().reverse());
  const done = shuffled.filter((l) => (S.get().lessons[l.id] || {}).completed).map((l) => l.id);
  eq(done, ["raport-serwisowy"], "postęp przyklejił się do złej lekcji");
  eq(S.latestAttempt("awaria-prasy-hydraulicznej").text, "moja odpowiedź");
});

// --- harmonogram powtórek (schedule.js) -------------------------------------
const DAY = 86400000;
const NOON = SCH.startOfDay(T) + 12 * 3600000; // południe, żeby granice dni były widoczne

test("„umiem” przechodzi przez kolejne odstępy 1-3-7-21-60", () => {
  let e = null;
  const got = [];
  for (let i = 0; i < 6; i++) {
    e = SCH.next(e, "good", NOON);
    got.push(e.interval);
  }
  eq(got, [1, 3, 7, 21, 60, 60], "progresja odstępów");
  eq(e.reps, 6);
  eq(e.lapses, 0);
});

test("„nie pamiętam” zeruje postęp i zwiększa licznik wpadek", () => {
  let e = SCH.next(null, "good", NOON);
  e = SCH.next(e, "good", NOON);
  eq(e.reps, 2);
  e = SCH.next(e, "again", NOON);
  eq(e.reps, 0, "reps musi wrócić do zera");
  eq(e.lapses, 1);
  eq(e.interval, 0, "ma wrócić jeszcze dziś");
  eq(e.due, NOON, "termin = teraz");
  ok(SCH.isDue(e, NOON), "powinno być natychmiast do powtórki");
});

test("„trudne” powtarza ten sam odstęp: bez awansu i bez cofania", () => {
  let e = SCH.next(null, "good", NOON); // interval 1, reps 1
  e = SCH.next(e, "good", NOON); // interval 3, reps 2
  const before = e.reps;
  const lastInterval = e.interval;
  e = SCH.next(e, "hard", NOON);
  eq(e.reps, before, "reps nie może się zmienić");
  eq(e.interval, lastInterval, "ten sam odstęp co ostatnio");
  eq(e.lapses, 0, "„trudne” to nie wpadka");
  // a kolejne „umiem” awansuje dalej, nie od nowa
  eq(SCH.next(e, "good", NOON).interval, 7);
});

test("terminy padają na początek dnia, nie na godzinę powtórki", () => {
  const late = SCH.startOfDay(T) + 23 * 3600000; // 23:00
  const e = SCH.next(null, "good", late);
  eq(e.due, SCH.startOfDay(late + DAY), "termin nie jest wyrównany do dnia");
  ok(e.due < late + DAY, "powtórka o 23:00 nie może czekać do 23:00 następnego dnia");
  ok(!SCH.isDue(e, late), "nie może być wymagalne od razu");
  ok(SCH.isDue(e, e.due), "musi być wymagalne od północy");
});

test("daysUntil i daysSince liczą na granicach dni", () => {
  eq(SCH.daysUntil(NOON, NOON), 0);
  eq(SCH.daysUntil(NOON + DAY, NOON), 1);
  eq(SCH.daysUntil(NOON - 2 * DAY, NOON), -2, "zaległe mają wartość ujemną");
  eq(SCH.daysSince(NOON - 3 * DAY, NOON), 3);
  eq(SCH.daysSince(0, NOON), null, "brak daty = brak odpowiedzi");
});

test("first() planuje pierwszą powtórkę na jutro, bez oceny", () => {
  const e = SCH.first(NOON);
  eq(e.interval, 1);
  eq(e.reps, 0, "ukończenie lekcji to jeszcze nie udana powtórka");
  eq(e.lastGrade, "");
  ok(!SCH.isDue(e, NOON), "nie może być do powtórki od razu");
});

test("isDue odrzuca puste i niezaplanowane wpisy", () => {
  ok(!SCH.isDue(null, NOON));
  ok(!SCH.isDue({ due: 0 }, NOON));
});

// --- powtórki w stanie ------------------------------------------------------
test("ukończenie lekcji wprowadza ją do rotacji powtórek", () => {
  S.reset();
  ok(!S.reviewOf("raport-serwisowy"), "przed ukończeniem nie ma harmonogramu");
  S.markCompleted("raport-serwisowy");
  const e = S.reviewOf("raport-serwisowy");
  ok(e, "brak wpisu w harmonogramie");
  eq(e.interval, 1);
  ok(!SCH.isDue(e, Date.now()), "nie może być do powtórki tego samego dnia");
});

test("harmonogram jest kluczowany typem i id, nie samym id", () => {
  S.reset();
  S.markCompleted("raport-serwisowy");
  eq(Object.keys(S.get().review), ["lesson:raport-serwisowy"]);
});

test("ponowne ukończenie nie kasuje istniejącego harmonogramu", () => {
  S.reset();
  S.markCompleted("raport-serwisowy");
  S.gradeLesson("raport-serwisowy", "good");
  const before = S.reviewOf("raport-serwisowy").interval;
  S.markCompleted("raport-serwisowy");
  eq(S.reviewOf("raport-serwisowy").interval, before, "harmonogram został zresetowany");
});

test("gradeLesson odrzuca nieznaną ocenę", () => {
  S.reset();
  S.markCompleted("raport-serwisowy");
  eq(S.gradeLesson("raport-serwisowy", "swietnie"), null);
});

test("dueLessons zwraca tylko zaległe, najstarsze pierwsze", () => {
  S.reset();
  const ids = window.LESSONS.map((l) => l.id);
  S.markCompleted(ids[0]);
  S.markCompleted(ids[1]);
  S.markCompleted(ids[2]);
  const now = Date.now();
  eq(S.dueLessons(ids, now), [], "świeżo ukończone nie są jeszcze do powtórki");

  // przesuwamy zegar o 2 dni i różnicujemy terminy
  const later = now + 2 * DAY;
  S.get().review["lesson:" + ids[1]].due = now - 5 * DAY; // najbardziej zaległa
  S.get().review["lesson:" + ids[0]].due = now - 1 * DAY;
  eq(S.dueLessons(ids, later), [ids[1], ids[0], ids[2]]);
});

test("dueLessons ignoruje lekcje usunięte z treści", () => {
  S.reset();
  S.markCompleted("raport-serwisowy");
  S.get().review["lesson:juz-nie-istnieje"] = SCH.first(1);
  eq(S.dueLessons(["raport-serwisowy"], Date.now() + 5 * DAY), ["raport-serwisowy"]);
});

test("reviewStats podaje zaległe, zaplanowane i najbliższy termin", () => {
  S.reset();
  const ids = window.LESSONS.map((l) => l.id);
  S.markCompleted(ids[0]);
  S.markCompleted(ids[1]);
  let st = S.reviewStats(ids, Date.now());
  eq(st.due, 0);
  eq(st.scheduled, 2);
  ok(st.nextDue > Date.now(), "brak najbliższego terminu");

  S.get().review["lesson:" + ids[0]].due = Date.now() - DAY;
  st = S.reviewStats(ids, Date.now());
  eq(st.due, 1);
  eq(st.scheduled, 2);
});

// --- scalanie harmonogramu --------------------------------------------------
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

test("scalanie harmonogramu jest przemienne i idempotentne", () => {
  const a = mk({ review: { "lesson:x": rev({ reps: 3, lastReviewAt: T + 10, due: T + 7 * DAY }) } });
  const b = mk({ review: { "lesson:x": rev({ reps: 1, lastReviewAt: T + 5, due: T + DAY }) } });
  eq(S.merge(a, b), S.merge(b, a));
  eq(S.merge(a, b), S.merge(S.merge(a, b), S.merge(a, b)));
});

test("harmonogram bierzemy z najnowszej prawdziwej powtórki", () => {
  const stary = mk({
    review: { "lesson:x": rev({ due: T + 60 * DAY, interval: 60, reps: 5, lastReviewAt: T }) },
  });
  const nowy = mk({
    review: {
      "lesson:x": rev({ due: T + 2 * DAY, interval: 0, reps: 0, lapses: 1, lastGrade: "again", lastReviewAt: T + 999 }),
    },
  });
  const m = S.merge(stary, nowy).review["lesson:x"];
  eq(m.lastGrade, "again", "nowsza ocena musi wygrać");
  eq(m.due, T + 2 * DAY);
  eq(m.lapses, 1);
});

test("liczniki scalamy maksimum, nie sumą — inaczej scalanie nie jest idempotentne", () => {
  const a = mk({ review: { "lesson:x": rev({ reps: 4, lapses: 2, lastReviewAt: T }) } });
  const b = mk({ review: { "lesson:x": rev({ reps: 2, lapses: 1, lastReviewAt: T }) } });
  const once = S.merge(a, b).review["lesson:x"];
  eq(once.reps, 4);
  eq(once.lapses, 2);
  const twice = S.merge(S.merge(a, b), b).review["lesson:x"];
  eq(twice.reps, 4, "powtórne scalenie podbiło licznik");
});

test("wpis obecny tylko na jednym urządzeniu nie ginie", () => {
  const a = mk({ review: { "lesson:x": rev({ reps: 2, lastReviewAt: T }) } });
  const b = mk({ review: { "lesson:y": rev({ reps: 1, lastReviewAt: T }) } });
  eq(Object.keys(S.merge(a, b).review).sort(), ["lesson:x", "lesson:y"]);
});

test("normalize odrzuca wpisy harmonogramu bez typu w kluczu", () => {
  const n = S.normalize({ review: { "bez-typu": rev(), "lesson:ok": rev(), zle: null } });
  eq(Object.keys(n.review), ["lesson:ok"]);
});

test("eksport i import zachowują harmonogram", () => {
  S.reset();
  S.markCompleted("raport-serwisowy");
  S.gradeLesson("raport-serwisowy", "good");
  const dump = JSON.stringify(S.get());
  const interval = S.reviewOf("raport-serwisowy").interval;
  S.reset();
  ok(S.importJSON(dump).ok);
  eq(S.reviewOf("raport-serwisowy").interval, interval);
});

test("dane v2 (bez harmonogramu) wczytują się bez błędu", () => {
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
  eq(s.review, {}, "brak mapy powtórek powinien dać pustą mapę");
  ok(s.lessons["raport-serwisowy"].completed, "zgubiono postęp z v2");
  eq(S.latestAttempt("raport-serwisowy").text, "x", "odpowiedź z v2 musi wejść do dziennika");
  S.save();
  eq(JSON.parse(store["werkdeutsch-state"]).schemaVersion, S.SCHEMA_VERSION, "zapis powinien podnieść wersję");
});

test("reset czyści też harmonogram", () => {
  S.markCompleted("raport-serwisowy");
  S.reset();
  eq(S.get().review, {});
});

// --- taksonomia błędów ------------------------------------------------------
test("taksonomia ma unikalne id i wersję", () => {
  ok(TAX.VERSION > 0);
  eq(new Set(TAX.IDS).size, TAX.IDS.length, "powtórzone id kategorii");
  TAX.CATEGORIES.forEach((c) => {
    ok(c.group && c.label, "kategoria bez group/label: " + c.id);
  });
});

test("accept przepuszcza znane etykiety i odrzuca nieznane", () => {
  const r = TAX.accept(["case_dativ", "wymyslona_kategoria", "case_dativ", "", 42, "spelling"]);
  eq(r.tags, ["case_dativ", "spelling"], "duplikaty i śmieci powinny wypaść");
  eq(r.rejected, ["wymyslona_kategoria"]);
});

test("accept znosi brak danych", () => {
  eq(TAX.accept(null).tags, []);
  eq(TAX.accept("nie tablica").tags, []);
});

test("summarize liczy deterministycznie tylko wpisy ze statusem done", () => {
  const attempts = [
    { text: "a", tagging: { status: "done", tags: ["case_dativ", "spelling"] } },
    { text: "b", tagging: { status: "done", tags: ["case_dativ"] } },
    { text: "c", tagging: { status: "pending", tags: ["case_dativ"] } },
    { text: "d", tagging: { status: "failed", tags: ["spelling"] } },
    { text: "e", tagging: { status: "done", tags: ["nieznana"] } },
  ];
  const sum = TAX.summarize(attempts);
  eq(sum.sourceAttemptCount, 3, "liczymy tylko done");
  eq(sum.topCategories.length, 2, "nieznana etykieta nie może wejść do zestawienia");
  eq(sum.topCategories[0].category, "case_dativ");
  eq(sum.topCategories[0].count, 2);
  ok(sum.topCategories[0].label.length > 0, "brak etykiety dla człowieka");
  eq(sum.taxonomyVersion, TAX.VERSION, "zestawienie musi nieść wersję taksonomii");
  // ta sama liczba przy remisie musi dać powtarzalną kolejność
  eq(JSON.stringify(TAX.summarize(attempts)), JSON.stringify(sum));
});

// --- pola pochodzenia lekcji ------------------------------------------------
test("applyLessonDefaults uzupełnia kind/origin/status/contentVersion", () => {
  const [l] = S.applyLessonDefaults([{ id: "x" }]);
  eq(l.kind, "scenario");
  eq(l.origin, "static");
  eq(l.status, "published");
  eq(l.contentVersion, 1);
  eq(l.targetWeaknesses, []);
});

test("applyLessonDefaults nie nadpisuje wartości podanych w treści", () => {
  const [l] = S.applyLessonDefaults([
    { id: "x", kind: "sentences", origin: "generated", status: "draft", contentVersion: 3 },
  ]);
  eq(l.kind, "sentences");
  eq(l.origin, "generated");
  eq(l.status, "draft");
  eq(l.contentVersion, 3);
});

test("wszystkie ręczne lekcje mają targetWeaknesses ze znanej taksonomii", () => {
  window.LESSONS.forEach((l) => {
    ok(Array.isArray(l.targetWeaknesses) && l.targetWeaknesses.length, l.id + ": brak targetWeaknesses");
    l.targetWeaknesses.forEach((t) => ok(TAX.isKnown(t), l.id + ": nieznana kategoria " + t));
  });
});

test("walidacja odrzuca nieznaną kategorię w targetWeaknesses", () => {
  const bad = JSON.parse(JSON.stringify(window.LESSONS));
  bad[0].targetWeaknesses = ["case_dativ", "zmyslona"];
  ok(S.validateLessons(bad).some((p) => /nieznaną kategorię "zmyslona"/.test(p)));
});

test("walidacja odrzuca nieznany kind i status", () => {
  const bad = JSON.parse(JSON.stringify(window.LESSONS));
  bad[0].kind = "quiz";
  bad[1].status = "maybe";
  const p = S.validateLessons(bad);
  ok(p.some((x) => /nieznany kind/.test(x)));
  ok(p.some((x) => /nieznany status/.test(x)));
});

test("lekcja generowana bez targetWeaknesses jest błędem", () => {
  const bad = JSON.parse(JSON.stringify(window.LESSONS));
  bad[0].origin = "generated";
  bad[0].targetWeaknesses = [];
  ok(S.validateLessons(bad).some((p) => /generowana musi mieć targetWeaknesses/.test(p)));
});

// --- dziennik prób ----------------------------------------------------------
test("każde podejście dopisuje nowy rekord, nic nie nadpisuje", () => {
  S.reset();
  S.recordWrite("raport-serwisowy", "pierwsza wersja", "natural", 1);
  S.recordWrite("raport-serwisowy", "druga wersja", "professional", 1);
  S.recordWrite("raport-serwisowy", "trzecia wersja", "simple", 1);
  eq(S.attemptCount(), 3, "historia musi zostać");
  eq(S.latestAttempt("raport-serwisowy").text, "trzecia wersja");
  eq(S.latestAttempt("raport-serwisowy").shownRegister, "simple");
});

test("puste podejście nie trafia do dziennika", () => {
  S.reset();
  eq(S.recordWrite("raport-serwisowy", "   ", "natural", 1), null);
  eq(S.attemptCount(), 0);
});

test("rekord zapisuje, który wzorzec był widoczny i wersję treści", () => {
  S.reset();
  const r = S.recordWrite("raport-serwisowy", "test", "professional", 7);
  eq(r.shownRegister, "professional");
  eq(r.contentVersion, 7);
  eq(r.mode, "write");
});

test("poprawność swobodnego tekstu jest null, a nie false", () => {
  S.reset();
  const r = S.recordWrite("raport-serwisowy", "cokolwiek", "natural", 1);
  eq(r.isCorrect, null, "„nieocenione” to nie to samo co „błędne”");
});

test("wybór z listy jest oceniany bez żadnego modelu", () => {
  S.reset();
  const good = S.recordChoice("raport-serwisowy", 2, 2, 1);
  const bad = S.recordChoice("raport-serwisowy", 0, 2, 1);
  eq(good.isCorrect, true);
  eq(bad.isCorrect, false);
  eq(bad.choiceIndex, 0);
  eq(bad.correctIndex, 2);
  eq(S.attemptCount(), 2);
});

test("id prób są unikalne nawet przy zapisie w tej samej milisekundzie", () => {
  S.reset();
  const ids = new Set();
  for (let i = 0; i < 300; i++) ids.add(S.recordWrite("x", "t" + i, "natural", 1).id);
  eq(ids.size, 300, "kolizja identyfikatorów");
});

test("stan etykietowania jest jawny, nie „null dopóki nie przeleci job”", () => {
  S.reset();
  const r = S.recordWrite("raport-serwisowy", "test", "natural", 1);
  eq(r.tagging.status, "pending");
  eq(r.tagging.tries, 0);
  eq(r.tagging.tags, []);
  eq(S.pendingTagging().length, 1);
});

test("setTagging zapisuje wersję taksonomii i odsiewa nieznane etykiety", () => {
  S.reset();
  const r = S.recordWrite("raport-serwisowy", "test", "natural", 1);
  const t = S.setTagging(r.id, {
    status: "done",
    tags: ["case_dativ", "wymyslone"],
    taggerVersion: "claude-x/prompt-v1",
  });
  eq(t.tagging.tags, ["case_dativ"]);
  eq(t.tagging.rejected, ["wymyslone"], "nieznane etykiety trzeba widzieć, nie chować");
  eq(t.tagging.taxonomyVersion, TAX.VERSION);
  eq(t.tagging.taggerVersion, "claude-x/prompt-v1");
  eq(t.tagging.tries, 1);
  eq(S.pendingTagging().length, 0);
});

test("nieudane etykietowanie zwiększa licznik prób i zostawia powód", () => {
  S.reset();
  const r = S.recordWrite("raport-serwisowy", "test", "natural", 1);
  S.setTagging(r.id, { status: "failed", error: "timeout" });
  const again = S.setTagging(r.id, { status: "failed", error: "timeout" });
  eq(again.tagging.tries, 2, "bez licznika nie wiadomo, kiedy odpuścić");
  eq(again.tagging.error, "timeout");
  eq(again.tagging.status, "failed");
});

test("etykietowanie dotyczy tylko swobodnego tekstu", () => {
  S.reset();
  S.recordChoice("raport-serwisowy", 1, 2, 1);
  eq(S.pendingTagging().length, 0, "wybór z listy nie wymaga modelu");
});

test("attemptsSince zwraca kroczące okno", () => {
  S.reset();
  const r1 = S.recordWrite("a", "stara", "natural", 1);
  const r2 = S.recordWrite("b", "nowa", "natural", 1);
  S.get().attemptLog.find((x) => x.id === r1.id).at = Date.now() - 30 * DAY;
  eq(S.attemptsSince(Date.now() - 7 * DAY).length, 1);
  eq(S.attemptsSince(0).length, 2);
  eq(S.attemptsSince(Date.now() - 7 * DAY)[0].id, r2.id);
});

// --- scalanie dziennika prób ------------------------------------------------
test("scalanie dziennika to suma zbiorów — nic nie ginie", () => {
  S.reset();
  const laptop = mk({ attemptLog: [logRec("a1", "x", T), logRec("a2", "x", T + 1)] });
  const phone = mk({ attemptLog: [logRec("a3", "y", T + 2)] });
  const m = S.merge(laptop, phone);
  eq(m.attemptLog.map((r) => r.id), ["a1", "a2", "a3"]);
  eq(S.merge(phone, laptop).attemptLog.map((r) => r.id), ["a1", "a2", "a3"], "kolejność nie może mieć znaczenia");
});

test("scalanie dziennika jest idempotentne", () => {
  const a = mk({ attemptLog: [logRec("a1", "x", T)] });
  const b = mk({ attemptLog: [logRec("a2", "y", T + 5)] });
  eq(S.merge(S.merge(a, b), b), S.merge(a, b));
});

test("etykiety dopisane na jednym urządzeniu wygrywają z „pending” z drugiego", () => {
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

test("normalize odrzuca rekordy bez id lub bez lessonId i duplikaty", () => {
  const n = S.normalize({
    attemptLog: [
      logRec("a1", "x", T),
      logRec("a1", "x", T), // duplikat
      { id: "", lessonId: "x", at: T },
      { id: "a9", at: T },
      "śmieci",
    ],
  });
  eq(n.attemptLog.map((r) => r.id), ["a1"]);
});

// --- migracja v3 → v4 -------------------------------------------------------
test("migracja v3 ratuje ostatnią odpowiedź do dziennika", () => {
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
  eq(s.attemptLog.length, 1, "puste odpowiedzi nie mają trafiać do dziennika");
  eq(s.attemptLog[0].lessonId, "raport-serwisowy");
  eq(s.attemptLog[0].text, "moja odpowiedź");
  eq(s.attemptLog[0].at, T + 5, "znacznik czasu z v3 musi zostać");
  eq(S.latestAttempt("raport-serwisowy").text, "moja odpowiedź");
  ok(s.lessons["raport-serwisowy"].completed, "postęp z v3 musi zostać");
  eq(JSON.parse(store["werkdeutsch-state"]).schemaVersion, 4, "migracja musi się zapisać");
});

test("po migracji lekcje nie mają już pola attempt (jedno źródło prawdy)", () => {
  eq(S.get().lessons["raport-serwisowy"].attempt, undefined);
});

test("migracja v1 też trafia prosto do dziennika", () => {
  delete store["werkdeutsch-state"];
  store["werkdeutsch-state-v1"] = JSON.stringify(V1);
  const s = S.load();
  eq(s.attemptLog.length, 2);
  eq(S.latestAttempt("awaria-prasy-hydraulicznej").text, "Die Presse ist kaputt.");
  eq(S.latestAttempt("zgloszenie-zagrozenia-bhp").text, "Vorsicht!");
});

// --- eksport do analizy -----------------------------------------------------
test("eksport do analizy zawiera okno, wersje i liczbę prób", () => {
  S.reset();
  S.recordWrite("raport-serwisowy", "Klemme nachgezogen.", "natural", 1);
  S.recordChoice("raport-serwisowy", 0, 2, 1);
  const pack = S.exportAttempts(7);
  eq(pack.periodDays, 7);
  eq(pack.sourceAttemptCount, 2);
  eq(pack.taxonomyVersion, TAX.VERSION);
  eq(pack.schemaVersion, S.SCHEMA_VERSION);
  eq(pack.knownCategories.length, TAX.IDS.length, "etykietujący musi znać dozwolone kategorie");
  ok(pack.since < pack.exportedAt);
});

test("eksport dokłada kontekst lekcji z wszystkimi trzema wzorcami", () => {
  S.reset();
  S.recordWrite("raport-serwisowy", "test", "simple", 1);
  const byId = (id) => window.LESSONS.filter((l) => l.id === id)[0];
  const a = S.exportAttempts(7, byId).attempts[0];
  eq(a.lesson.title, byId("raport-serwisowy").title);
  ok(a.lesson.references.simple && a.lesson.references.natural && a.lesson.references.professional,
    "bez wszystkich rejestrów nie da się ocenić poprawności");
  eq(a.shownRegister, "simple", "trzeba wiedzieć, co widział");
  eq(a.lesson.targetWeaknesses.length, 3);
});

test("eksport wykrywa, że treść lekcji zmieniła się po zapisaniu próby", () => {
  S.reset();
  S.recordWrite("raport-serwisowy", "test", "natural", 1);
  const stale = (id) => Object.assign({}, window.LESSONS.filter((l) => l.id === id)[0], { contentVersion: 2 });
  eq(S.exportAttempts(7, stale).attempts[0].contentDrift, true);
  const fresh = (id) => Object.assign({}, window.LESSONS.filter((l) => l.id === id)[0], { contentVersion: 1 });
  eq(S.exportAttempts(7, fresh).attempts[0].contentDrift, false);
});

test("eksport respektuje kroczące okno", () => {
  S.reset();
  const old = S.recordWrite("a", "stara", "natural", 1);
  S.recordWrite("b", "nowa", "natural", 1);
  S.get().attemptLog.find((x) => x.id === old.id).at = Date.now() - 40 * DAY;
  eq(S.exportAttempts(7).sourceAttemptCount, 1);
  eq(S.exportAttempts(60).sourceAttemptCount, 2);
});

test("kopia postępu przenosi dziennik prób", () => {
  S.reset();
  S.recordWrite("raport-serwisowy", "zapamiętaj mnie", "natural", 1);
  const dump = JSON.stringify(S.get());
  S.reset();
  eq(S.attemptCount(), 0);
  ok(S.importJSON(dump).ok);
  eq(S.attemptCount(), 1);
  eq(S.latestAttempt("raport-serwisowy").text, "zapamiętaj mnie");
});

test("dwukrotny import tego samego pliku nie duplikuje prób", () => {
  S.reset();
  S.recordWrite("raport-serwisowy", "raz", "natural", 1);
  const dump = JSON.stringify(S.get());
  S.importJSON(dump);
  S.importJSON(dump);
  eq(S.attemptCount(), 1, "niezmienne rekordy o unikalnych id nie mogą się dublować");
});

// --- wynik ------------------------------------------------------------------
console.log("");
if (fails.length) {
  console.log("NIEUDANE (" + fails.length + "):");
  fails.forEach((f) => console.log("  ✗ " + f));
}
console.log(pass + " przeszło, " + fails.length + " nieudanych");
process.exit(fails.length ? 1 : 0);
