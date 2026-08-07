/* Warstwa danych: zapis postępu, migracja starych danych, scalanie, eksport/import.
 *
 * Dwie zasady, na których opiera się cały ten plik:
 *
 * 1. TOŻSAMOŚĆ, NIE POZYCJA. Postęp jest kluczowany identyfikatorem lekcji
 *    (`lessons["raport-serwisowy"]`), nie indeksem w tablicy. Dzięki temu można
 *    dodawać, usuwać i przestawiać lekcje bez psucia zapisanego postępu.
 *
 * 2. DANE SĄ MONOTONICZNE. Każda zmienna wartość nosi własny znacznik czasu,
 *    a usuwanie zostawia „nagrobek” (deleted: true) zamiast wycinać wpis.
 *    Dzięki temu scalanie dwóch kopii jest łączeniem zbiorów: wynik nie zależy
 *    od kolejności scalania i nigdy nie gubi postępu. To jest fundament pod
 *    ewentualną synchronizację między urządzeniami — merge() poniżej jest już
 *    całą potrzebną logiką.
 */
window.WD = window.WD || {};
(function () {
  "use strict";

  var KEY = "werkdeutsch-state";
  var LEGACY_KEY = "werkdeutsch-state-v1";

  /* v3 dodało mapę `review` (harmonogram powtórek).
   * v4 zamieniło jedną nadpisywaną odpowiedź na lekcję (`lessons[id].attempt`)
   *    na dopisywany dziennik prób (`attemptLog`).
   *
   * Numer podnosimy przy każdej zmianie kształtu, także przy samym dodaniu
   * pola: kod starszej wersji nie zna nowych pól, więc jego zapis by je wyciął.
   * Podniesiony numer sprawia, że stara karta przechodzi w tryb
   * tylko-do-czytania zamiast niszczyć dane. */
  var SCHEMA_VERSION = 4;

  /* Kolejność lekcji w wersji v1 — ZAMROŻONA NA ZAWSZE.
   *
   * Stare dane zapisywały postęp jako indeksy ([0, 2, 5]). Indeks 2 znaczy
   * „trzecia lekcja w tablicy w chwili, gdy dane były zapisywane” — a nie
   * „trzecia lekcja dzisiaj”. Odtworzyć to można wyłącznie z zamrożonej listy.
   * Dlatego ta tablica nie może być generowana z lessons.js i nie wolno jej
   * zmieniać, nawet jeśli kolejność lekcji w lessons.js się zmieni.
   */
  var V1_ORDER = [
    "awaria-prasy-hydraulicznej",
    "wyjasnienie-naprawy-czujnika",
    "zamowienie-czesci-zamiennych",
    "zgloszenie-zagrozenia-bhp",
    "diagnoza-pytania-do-operatora",
    "raport-serwisowy",
  ];

  var now = function () {
    return Date.now();
  };

  /* Dane po migracji nie mają prawdziwych znaczników czasu — nie wiemy, kiedy
   * powstały. Dajemy im 1 (prawie epoka), żeby każdy późniejszy realny zapis
   * z dowolnego urządzenia wygrał przy scalaniu. */
  var MIGRATED_AT = 1;

  function emptyState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      current: null,
      currentAt: 0,
      lessons: {},
      vocab: {},
      /* Harmonogram powtórek. Klucz to "<typ>:<id>" — dziś tylko
       * "lesson:<id>", ale format jest gotowy na inne typy pozycji
       * (np. "word:<id>") bez zmiany schematu i bez migracji. */
      review: {},
      /* Dziennik prób: DOPISYWANY, nigdy nie nadpisywany.
       *
       * Wcześniej była tu jedna odpowiedź na lekcję, nadpisywana przy każdym
       * podejściu. To wygodne dla pola tekstowego i bezużyteczne dla analizy —
       * historia błędów była niszczona w chwili powstania. Bez historii nie da
       * się nic policzyć ani niczego wygenerować na podstawie błędów.
       *
       * Rekordy są niezmienne, więc scalanie to suma zbiorów po `id` —
       * najprostszy możliwy przypadek, bez konfliktów. Jedyne mutowalne pole to
       * `tagging`, rozstrzygane własnym znacznikiem czasu.
       *
       * Rozmiar: ~300 bajtów na rekord, więc 2000 prób ≈ 600 kB. Przy limicie
       * localStorage rzędu 5 MB nie ma potrzeby przycinania; gdyby kiedyś była,
       * przycinaj po `at` i pamiętaj, że scalanie może wskrzesić usunięte. */
      attemptLog: [],
      updatedAt: 0,
    };
  }

  function reviewKey(type, id) {
    return type + ":" + id;
  }

  /* Identyfikator urządzenia trzymamy POZA scalanym stanem — jest lokalny i nie
   * ma go po co przenosić między urządzeniami. Służy tylko do tego, żeby id prób
   * z dwóch urządzeń nigdy się nie zderzyły. */
  var DEVICE_KEY = "werkdeutsch-device";
  var deviceId = "";

  function getDeviceId() {
    if (deviceId) return deviceId;
    try {
      deviceId = localStorage.getItem(DEVICE_KEY) || "";
    } catch (e) {
      deviceId = "";
    }
    if (!deviceId) {
      deviceId = Math.random().toString(36).slice(2, 8);
      try {
        localStorage.setItem(DEVICE_KEY, deviceId);
      } catch (e) {
        /* tryb prywatny — id zostanie tylko na czas sesji */
      }
    }
    return deviceId;
  }

  function attemptId(at) {
    return "a" + at.toString(36) + "-" + getDeviceId() + "-" + Math.random().toString(36).slice(2, 6);
  }

  /* Stan etykietowania jest JAWNY, a nie „null dopóki nie przeleci nocny job”.
   * Pole `null` nie umie odróżnić: jeszcze nieprzetworzone / przetworzone i bez
   * błędów / etykietowanie padło / padło pięć razy i trzeba odpuścić. Bez tego
   * rozróżnienia po pierwszej awarii nie wiadomo, co ponowić. */
  function emptyTagging() {
    return {
      status: "pending", // pending | done | failed | skipped
      tags: [],
      rejected: [], // etykiety spoza taksonomii — sygnał, że jej brakuje
      taggerVersion: "", // model + wersja promptu, które to wyprodukowały
      taxonomyVersion: 0, // wersja słownika kategorii z chwili etykietowania
      at: 0,
      tries: 0,
      error: "",
    };
  }

  // ---------------------------------------------------------------- migracja

  function migrateV1(old) {
    var s = emptyState();
    var i;

    if (Array.isArray(old.completed)) {
      for (i = 0; i < old.completed.length; i++) {
        var id = V1_ORDER[old.completed[i]];
        if (!id) continue; // indeks poza zamrożoną listą — nie da się odtworzyć
        s.lessons[id] = s.lessons[id] || {};
        s.lessons[id].completed = true;
        s.lessons[id].completedAt = MIGRATED_AT;
      }
    }

    if (old.attempts && typeof old.attempts === "object") {
      Object.keys(old.attempts).forEach(function (k) {
        var id = V1_ORDER[Number(k)];
        var text = old.attempts[k];
        if (!id || !text) return;
        s.attemptLog.push(writeRecord(id, String(text), "natural", MIGRATED_AT, 1));
      });
    }

    /* Stare id słówka było wyliczane z treści ("die leckage|nieszczelność").
     * Dopasowujemy po treści do słówek z lessons.js, żeby odzyskać nowe,
     * trwałe id. Czego nie da się dopasować, ląduje jako własny zwrot. */
    var byText = {};
    (window.LESSONS || []).forEach(function (lesson) {
      lesson.vocab.forEach(function (w) {
        byText[textKey(w.de, w.pl)] = w.id;
      });
    });

    if (Array.isArray(old.vocab)) {
      for (i = 0; i < old.vocab.length; i++) {
        var v = old.vocab[i];
        if (!v || !v.de) continue;
        var vid = byText[textKey(v.de, v.pl)] || customId(v.de, v.pl);
        s.vocab[vid] = {
          de: String(v.de),
          pl: String(v.pl || ""),
          example: v.example ? String(v.example) : "",
          custom: !byText[textKey(v.de, v.pl)],
          learned: !!v.learned,
          learnedAt: v.learned ? MIGRATED_AT : 0,
          addedAt: MIGRATED_AT,
          deleted: false,
          updatedAt: MIGRATED_AT,
        };
      }
    }

    if (typeof old.current === "number" && V1_ORDER[old.current]) {
      s.current = V1_ORDER[old.current];
      s.currentAt = MIGRATED_AT;
    }

    s.updatedAt = MIGRATED_AT;
    return s;
  }

  /* v3 → v4: jedna nadpisywana odpowiedź na lekcję staje się jednym rekordem
   * w dzienniku. Historii nie da się odtworzyć — została nadpisana jeszcze
   * zanim ten kod powstał. Ratujemy to, co zostało: ostatnią próbę. */
  function migrateToV4(raw) {
    var s = normalize(raw);
    if (raw && raw.lessons && typeof raw.lessons === "object") {
      Object.keys(raw.lessons).forEach(function (id) {
        var l = raw.lessons[id];
        if (!l || typeof l.attempt !== "string" || !l.attempt.trim()) return;
        s.attemptLog.push(
          writeRecord(id, l.attempt, "natural", num(l.attemptAt) || MIGRATED_AT, 1)
        );
      });
    }
    sortLog(s.attemptLog);
    return s;
  }

  function writeRecord(lessonId, text, shownRegister, at, contentVersion) {
    return {
      id: attemptId(at),
      lessonId: lessonId,
      contentVersion: contentVersion || 1,
      mode: "write",
      at: at,
      text: text,
      shownRegister: shownRegister || "natural",
      choiceIndex: -1,
      correctIndex: -1,
      /* Dla swobodnego tekstu poprawność NIE JEST rozstrzygalna automatycznie:
       * lekcja ma trzy poprawne wzorce o różnym rejestrze. `null` znaczy tu
       * „nieocenione”, a nie „błędne” — inaczej każda statystyka byłaby fikcją. */
      isCorrect: null,
      tagging: emptyTagging(),
    };
  }

  function choiceRecord(lessonId, choiceIndex, correctIndex, at, contentVersion) {
    return {
      id: attemptId(at),
      lessonId: lessonId,
      contentVersion: contentVersion || 1,
      mode: "choose",
      at: at,
      text: "",
      shownRegister: "",
      choiceIndex: choiceIndex,
      correctIndex: correctIndex,
      /* Tu poprawność jest rozstrzygalna bez żadnego modelu — i właśnie dlatego
       * test wielokrotnego wyboru jest najtańszym źródłem danych o słabościach. */
      isCorrect: choiceIndex === correctIndex,
      tagging: emptyTagging(),
    };
  }

  function sortLog(log) {
    log.sort(function (a, b) {
      return a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
    return log;
  }

  function textKey(de, pl) {
    return (String(de) + "|" + String(pl || "")).toLocaleLowerCase("de").trim();
  }

  function customId(de, pl) {
    return "custom:" + textKey(de, pl).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  // ------------------------------------------------------------- normalizacja

  /* Nie ufamy niczemu, co przychodzi z localStorage ani z importowanego pliku.
   * Zła zawartość ma zostać odrzucona tutaj, a nie wysypać render(). */
  function normalize(raw) {
    var s = emptyState();
    if (!raw || typeof raw !== "object") return s;

    s.current = typeof raw.current === "string" ? raw.current : null;
    s.currentAt = num(raw.currentAt);
    s.updatedAt = num(raw.updatedAt);

    if (raw.lessons && typeof raw.lessons === "object") {
      Object.keys(raw.lessons).forEach(function (id) {
        var l = raw.lessons[id];
        if (!l || typeof l !== "object") return;
        /* `attempt`/`attemptAt` z v3 celowo NIE trafiają tu z powrotem —
         * jedynym źródłem prawdy o próbach jest teraz attemptLog. Odczytuje je
         * wyłącznie migrateToV4, z surowych danych. */
        s.lessons[id] = {
          completed: !!l.completed,
          completedAt: num(l.completedAt),
        };
      });
    }

    if (raw.vocab && typeof raw.vocab === "object") {
      Object.keys(raw.vocab).forEach(function (id) {
        var v = raw.vocab[id];
        if (!v || typeof v !== "object" || typeof v.de !== "string") return;
        s.vocab[id] = {
          de: v.de,
          pl: typeof v.pl === "string" ? v.pl : "",
          example: typeof v.example === "string" ? v.example : "",
          custom: !!v.custom,
          learned: !!v.learned,
          learnedAt: num(v.learnedAt),
          addedAt: num(v.addedAt),
          deleted: !!v.deleted,
          updatedAt: num(v.updatedAt),
        };
      });
    }

    if (raw.review && typeof raw.review === "object") {
      Object.keys(raw.review).forEach(function (key) {
        var r = raw.review[key];
        if (!r || typeof r !== "object" || key.indexOf(":") < 0) return;
        s.review[key] = {
          due: num(r.due),
          interval: num(r.interval),
          reps: num(r.reps),
          lapses: num(r.lapses),
          lastGrade: typeof r.lastGrade === "string" ? r.lastGrade : "",
          lastReviewAt: num(r.lastReviewAt),
          updatedAt: num(r.updatedAt),
        };
      });
    }

    if (Array.isArray(raw.attemptLog)) {
      var seen = {};
      raw.attemptLog.forEach(function (r) {
        if (!r || typeof r !== "object") return;
        if (typeof r.id !== "string" || !r.id) return;
        if (typeof r.lessonId !== "string" || !r.lessonId) return;
        if (seen[r.id]) return; // dziennik musi mieć unikalne id
        seen[r.id] = 1;
        s.attemptLog.push({
          id: r.id,
          lessonId: r.lessonId,
          contentVersion: num(r.contentVersion) || 1,
          mode: r.mode === "choose" ? "choose" : "write",
          at: num(r.at),
          text: typeof r.text === "string" ? r.text : "",
          shownRegister: typeof r.shownRegister === "string" ? r.shownRegister : "",
          choiceIndex: typeof r.choiceIndex === "number" ? r.choiceIndex : -1,
          correctIndex: typeof r.correctIndex === "number" ? r.correctIndex : -1,
          isCorrect: typeof r.isCorrect === "boolean" ? r.isCorrect : null,
          tagging: normalizeTagging(r.tagging),
        });
      });
      sortLog(s.attemptLog);
    }
    return s;
  }

  var TAGGING_STATUSES = ["pending", "done", "failed", "skipped"];

  function normalizeTagging(t) {
    var out = emptyTagging();
    if (!t || typeof t !== "object") return out;
    if (TAGGING_STATUSES.indexOf(t.status) >= 0) out.status = t.status;
    var tax = window.WD.taxonomy;
    /* Etykiety spoza taksonomii odsiewamy już przy wczytywaniu, nie dopiero
     * przy zliczaniu — inaczej nieznana etykieta rozjeżdżałaby statystyki
     * w każdym miejscu, które o niej nie wie. */
    if (Array.isArray(t.tags) && tax) out.tags = tax.accept(t.tags).tags;
    if (Array.isArray(t.rejected)) {
      out.rejected = t.rejected.filter(function (x) {
        return typeof x === "string";
      });
    }
    out.taggerVersion = typeof t.taggerVersion === "string" ? t.taggerVersion : "";
    out.taxonomyVersion = num(t.taxonomyVersion);
    out.at = num(t.at);
    out.tries = num(t.tries);
    out.error = typeof t.error === "string" ? t.error : "";
    return out;
  }

  function num(x) {
    return typeof x === "number" && isFinite(x) && x >= 0 ? x : 0;
  }

  // ----------------------------------------------------------------- scalanie

  /* Scala dwie kopie stanu. Własności, na których to stoi:
   *   - łączne (idempotentne i przemienne): merge(a,b) == merge(b,a),
   *     merge(a,a) == a. Kolejność i liczba scaleń nie ma znaczenia.
   *   - nic nie ginie: `completed` tylko rośnie (logiczne OR), a usunięcia są
   *     nagrobkami ze znacznikiem czasu, więc też są rozstrzygalne.
   *
   * Kluczowy szczegół: `learned` rozstrzyga własny learnedAt, a nie updatedAt
   * całego wpisu ani znacznik całej paczki danych. Gdyby znacznik siedział na
   * całej paczce, edycja jednego słówka na telefonie unieważniałaby wszystkie
   * pozostałe zmiany z laptopa.
   */
  var EMPTY_LESSON = { completed: false, completedAt: 0, attempt: "", attemptAt: 0 };

  /* Wybiera „świeższą” z dwóch wersji po wskazanym znaczniku czasu.
   *
   * Remis rozstrzygamy treścią, nie kolejnością argumentów. Bez tego
   * merge(a, b) i merge(b, a) mogłyby dać różny wynik, gdy oba urządzenia
   * zapisały zmianę w tej samej milisekundzie — a wtedy cała własność
   * „kolejność scalania nie ma znaczenia” przestaje obowiązywać. */
  function fresher(x, y, stampKey) {
    if ((x[stampKey] || 0) !== (y[stampKey] || 0)) {
      return (x[stampKey] || 0) > (y[stampKey] || 0) ? x : y;
    }
    return JSON.stringify(x) <= JSON.stringify(y) ? x : y;
  }

  function merge(a, b) {
    a = normalize(a);
    b = normalize(b);
    var out = emptyState();

    out.currentAt = Math.max(a.currentAt, b.currentAt);
    out.current = fresher(
      { current: a.current, currentAt: a.currentAt },
      { current: b.current, currentAt: b.currentAt },
      "currentAt"
    ).current;
    out.updatedAt = Math.max(a.updatedAt, b.updatedAt);

    keysOf(a.lessons, b.lessons).forEach(function (id) {
      /* Brakującą stronę zastępujemy pustym wpisem z zerowymi znacznikami.
       * Wcześniej było tu `|| {}`, co dawało undefined w porównaniu — a każde
       * porównanie z undefined jest fałszywe, więc lekcja obecna tylko w jednej
       * kopii gubiła wpisaną odpowiedź. */
      var x = a.lessons[id] || EMPTY_LESSON;
      var y = b.lessons[id] || EMPTY_LESSON;
      var done = x.completed || y.completed;
      var stamps = [x.completed && x.completedAt, y.completed && y.completedAt].filter(Boolean);
      var att = fresher(x, y, "attemptAt");
      out.lessons[id] = {
        completed: done,
        // najwcześniejszy prawdziwy moment ukończenia — wtedy naprawdę to zrobił
        completedAt: done && stamps.length ? Math.min.apply(null, stamps) : 0,
        attempt: att.attempt || "",
        attemptAt: Math.max(x.attemptAt, y.attemptAt),
      };
    });

    keysOf(a.vocab, b.vocab).forEach(function (id) {
      var x = a.vocab[id];
      var y = b.vocab[id];
      if (!x || !y) {
        out.vocab[id] = x || y;
        return;
      }
      var newer = fresher(x, y, "updatedAt");
      var older = newer === x ? y : x;
      var lrn = fresher(x, y, "learnedAt");
      out.vocab[id] = {
        de: newer.de,
        pl: newer.pl,
        example: newer.example || older.example,
        custom: x.custom || y.custom,
        learned: lrn.learned,
        learnedAt: Math.max(x.learnedAt, y.learnedAt),
        addedAt: Math.min(x.addedAt || y.addedAt, y.addedAt || x.addedAt),
        deleted: newer.deleted,
        updatedAt: Math.max(x.updatedAt, y.updatedAt),
      };
    });

    keysOf(a.review, b.review).forEach(function (key) {
      var x = a.review[key];
      var y = b.review[key];
      if (!x || !y) {
        out.review[key] = x || y;
        return;
      }
      /* Harmonogram bierzemy z NAJNOWSZEJ prawdziwej powtórki — ona wie
       * najwięcej o tym, co on dziś pamięta.
       *
       * Liczniki scalamy przez maksimum, nie przez sumę. Suma nie jest
       * idempotentna: to samo scalenie wykonane dwa razy podbiłoby reps
       * dwukrotnie i sztucznie wydłużyło odstępy. Maksimum daje ten sam wynik
       * niezależnie od tego, ile razy scalamy.
       *
       * ŚWIADOME OGRANICZENIE: jeśli powtórzy tę samą lekcję na dwóch
       * urządzeniach przed synchronizacją, jedna z ocen zostanie pominięta.
       * Bez rejestru zdarzeń nie da się tego rozstrzygnąć, a dla jednej osoby
       * nie jest to warte tej złożoności. */
      var newer = fresher(x, y, "lastReviewAt");
      out.review[key] = {
        due: newer.due,
        interval: newer.interval,
        reps: Math.max(x.reps, y.reps),
        lapses: Math.max(x.lapses, y.lapses),
        lastGrade: newer.lastGrade,
        lastReviewAt: Math.max(x.lastReviewAt, y.lastReviewAt),
        updatedAt: Math.max(x.updatedAt, y.updatedAt),
      };
    });

    /* Dziennik prób to najprostszy przypadek scalania, jaki istnieje: rekordy
     * są niezmienne i mają unikalne id, więc wystarczy suma zbiorów. Żadnych
     * konfliktów, bo nic nigdy nie zmienia treści rekordu.
     *
     * Jedyny wyjątek to `tagging`, które dopisuje później analiza — i to
     * rozstrzygamy własnym znacznikiem czasu, tak samo jak `learned` przy
     * słówkach. */
    var byId = {};
    a.attemptLog.concat(b.attemptLog).forEach(function (r) {
      var prev = byId[r.id];
      if (!prev) {
        byId[r.id] = r;
        return;
      }
      byId[r.id] = Object.assign({}, prev, {
        tagging: fresher(prev.tagging, r.tagging, "at"),
      });
    });
    out.attemptLog = sortLog(
      Object.keys(byId).map(function (id) {
        return byId[id];
      })
    );

    return out;
  }

  /* Klucze posortowane: wynik scalania jest wtedy identyczny bajt w bajt
   * niezależnie od kolejności argumentów, a plik eksportu ma stabilny układ. */
  function keysOf(x, y) {
    var seen = {};
    Object.keys(x).concat(Object.keys(y)).forEach(function (k) {
      seen[k] = 1;
    });
    return Object.keys(seen).sort();
  }

  // ------------------------------------------------------------- odczyt/zapis

  var state = emptyState();
  var readOnly = false; // true, gdy w przeglądarce leżą dane NOWSZE niż ten kod
  var warning = "";

  function load() {
    /* Wyliczamy od nowa przy każdym wczytaniu. Bez tego raz ustawiony tryb
     * tylko-do-czytania zostawał na zawsze, nawet po wczytaniu poprawnych
     * danych — i wszystkie kolejne zapisy cicho przepadały. */
    readOnly = false;
    var stored = null;
    try {
      stored = JSON.parse(localStorage.getItem(KEY) || "null");
    } catch (e) {
      stored = null;
    }

    if (stored && num(stored.schemaVersion) > SCHEMA_VERSION) {
      /* Ta karta ma stary kod (np. z pamięci CDN), a dane są z nowszej wersji.
       * Zapis by je uszkodził, więc go blokujemy. */
      readOnly = true;
      warning =
        "Ta strona jest w starszej wersji niż Twoje dane. Odśwież stronę (Ctrl+Shift+R). " +
        "Do tego czasu postęp nie będzie zapisywany.";
      state = normalize(stored);
      return state;
    }

    if (stored) {
      state = num(stored.schemaVersion) < 4 ? migrateToV4(stored) : normalize(stored);
      if (num(stored.schemaVersion) < 4) save();
      return state;
    }

    var legacy = null;
    try {
      legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null");
    } catch (e) {
      legacy = null;
    }

    if (legacy) {
      state = migrateV1(legacy);
      save(); // stary klucz zostaje nietknięty jako kopia zapasowa
      return state;
    }

    state = emptyState();
    return state;
  }

  function save() {
    if (readOnly) return false;
    state.schemaVersion = SCHEMA_VERSION;
    state.updatedAt = now();
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      warning = "Nie udało się zapisać postępu (brak miejsca lub tryb prywatny).";
      return false;
    }
  }

  // ------------------------------------------------------------------ mutacje

  function lesson(id) {
    if (!state.lessons[id]) {
      state.lessons[id] = { completed: false, completedAt: 0 };
    }
    return state.lessons[id];
  }

  function setCurrent(id) {
    state.current = id;
    state.currentAt = now();
    save();
  }

  // ------------------------------------------------------------- dziennik prób

  /* Każde podejście to NOWY rekord. Nic nie nadpisujemy — to jedyny sposób,
   * żeby analiza błędów miała w ogóle na czym pracować. */
  function recordWrite(lessonId, text, shownRegister, contentVersion) {
    if (!text || !String(text).trim()) return null;
    var r = writeRecord(lessonId, String(text).trim(), shownRegister, now(), contentVersion);
    state.attemptLog.push(r);
    save();
    return r;
  }

  function recordChoice(lessonId, choiceIndex, correctIndex, contentVersion) {
    var r = choiceRecord(lessonId, choiceIndex, correctIndex, now(), contentVersion);
    state.attemptLog.push(r);
    save();
    return r;
  }

  /* Ostatnia próba dla lekcji — wyłącznie do wypełnienia pola tekstowego.
   * Wyliczana z dziennika, żeby nie było drugiego źródła prawdy. */
  function latestAttempt(lessonId) {
    var best = null;
    for (var i = 0; i < state.attemptLog.length; i++) {
      var r = state.attemptLog[i];
      if (r.lessonId !== lessonId || r.mode !== "write") continue;
      if (!best || r.at >= best.at) best = r;
    }
    return best;
  }

  function attemptsSince(sinceMs) {
    return state.attemptLog.filter(function (r) {
      return r.at >= sinceMs;
    });
  }

  function attemptCount() {
    return state.attemptLog.length;
  }

  /* Zapis wyniku etykietowania. Pisane przez przyszły potok analizy; tutaj
   * istnieje, żeby kształt danych był ustalony od początku i żeby dopisanie
   * potoku nie wymagało kolejnej migracji. */
  function setTagging(attemptId, result) {
    var tax = window.WD.taxonomy;
    for (var i = 0; i < state.attemptLog.length; i++) {
      if (state.attemptLog[i].id !== attemptId) continue;
      var prev = state.attemptLog[i].tagging;
      var checked = tax ? tax.accept(result && result.tags) : { tags: [], rejected: [] };
      state.attemptLog[i].tagging = {
        status: TAGGING_STATUSES.indexOf(result && result.status) >= 0 ? result.status : "done",
        tags: checked.tags,
        rejected: checked.rejected,
        taggerVersion: (result && String(result.taggerVersion || "")) || "",
        taxonomyVersion: tax ? tax.VERSION : 0,
        at: now(),
        tries: prev.tries + 1,
        error: (result && String(result.error || "")) || "",
      };
      save();
      return state.attemptLog[i];
    }
    return null;
  }

  function pendingTagging(limit) {
    var out = state.attemptLog.filter(function (r) {
      return r.tagging.status === "pending" && r.mode === "write";
    });
    return limit ? out.slice(0, limit) : out;
  }

  /* Ukończenie lekcji wprowadza ją do rotacji powtórek. To jedyne wejście —
   * dzięki temu nie ma stanu „ukończona, ale nigdy nie zaplanowana”. */
  function markCompleted(id) {
    var l = lesson(id);
    if (l.completed) return;
    var t = now();
    l.completed = true;
    l.completedAt = t;
    var key = reviewKey("lesson", id);
    if (!state.review[key]) {
      var entry = window.WD.schedule.first(t);
      entry.updatedAt = t;
      state.review[key] = entry;
    }
    save();
  }

  // ------------------------------------------------------------------ powtórki

  function reviewOf(id) {
    return state.review[reviewKey("lesson", id)] || null;
  }

  /* Zapisuje ocenę powtórki. Sam odstęp wylicza schedule.js — tutaj nie ma
   * żadnej reguły „za ile dni”, żeby wymiana algorytmu nie dotykała zapisu. */
  function gradeLesson(id, grade) {
    if (window.WD.schedule.GRADES.indexOf(grade) < 0) return null;
    var key = reviewKey("lesson", id);
    var t = now();
    var entry = window.WD.schedule.next(state.review[key], grade, t);
    entry.updatedAt = t;
    state.review[key] = entry;
    save();
    return entry;
  }

  /* Lekcje do powtórki z podanej listy id, najbardziej zaległe pierwsze.
   * Kolejność ustalamy po `due`, a remisy po id — inaczej kolejka
   * przeskakiwałaby przy każdym renderowaniu. */
  function dueLessons(ids, at) {
    var t = at || now();
    var sched = window.WD.schedule;
    return ids
      .filter(function (id) {
        return sched.isDue(reviewOf(id), t);
      })
      .sort(function (a, b) {
        var d = reviewOf(a).due - reviewOf(b).due;
        return d !== 0 ? d : a < b ? -1 : 1;
      });
  }

  function reviewStats(ids, at) {
    var t = at || now();
    var sched = window.WD.schedule;
    var scheduled = ids.filter(function (id) {
      return !!reviewOf(id);
    });
    var upcoming = scheduled
      .filter(function (id) {
        return !sched.isDue(reviewOf(id), t);
      })
      .map(function (id) {
        return reviewOf(id).due;
      })
      .sort(function (a, b) {
        return a - b;
      });
    return {
      due: dueLessons(ids, t).length,
      scheduled: scheduled.length,
      nextDue: upcoming.length ? upcoming[0] : null,
    };
  }

  /* Aktywne słówka: bez nagrobków, najnowsze pierwsze. */
  function vocabList() {
    return Object.keys(state.vocab)
      .filter(function (id) {
        return !state.vocab[id].deleted;
      })
      .map(function (id) {
        var v = state.vocab[id];
        return {
          id: id,
          de: v.de,
          pl: v.pl,
          example: v.example,
          learned: v.learned,
          addedAt: v.addedAt,
        };
      })
      .sort(function (a, b) {
        return b.addedAt - a.addedAt;
      });
  }

  function hasVocab(id) {
    return !!state.vocab[id] && !state.vocab[id].deleted;
  }

  function addVocab(id, de, pl, example, isCustom) {
    var t = now();
    var prev = state.vocab[id];
    state.vocab[id] = {
      de: de,
      pl: pl,
      example: example || "",
      custom: !!isCustom,
      // ponowne dodanie nie kasuje historii: „opanowane” zostaje
      learned: prev ? prev.learned : false,
      learnedAt: prev ? prev.learnedAt : 0,
      addedAt: prev && prev.addedAt ? prev.addedAt : t,
      deleted: false,
      updatedAt: t,
    };
    save();
  }

  /* Usunięcie = nagrobek. Wpis zostaje, żeby scalanie nie wskrzesiło słówka,
   * które celowo wyrzucił. */
  function removeVocab(id) {
    var v = state.vocab[id];
    if (!v) return;
    v.deleted = true;
    v.updatedAt = now();
    save();
  }

  function setLearned(id, learned) {
    var v = state.vocab[id];
    if (!v) return;
    v.learned = !!learned;
    v.learnedAt = now(); // własny znacznik — patrz komentarz przy merge()
    v.updatedAt = v.learnedAt;
    save();
  }

  function reset() {
    state = emptyState();
    save();
  }

  // ------------------------------------------------------------ eksport/import

  function exportFilename() {
    return "werkdeutsch-postep-" + new Date().toISOString().slice(0, 10) + ".json";
  }

  /* Eksport do analizy błędów — kroczące okno N dni.
   *
   * To jest cały pomost do przyszłego potoku „analiza → nowe lekcje”, i można
   * z niego korzystać JUŻ TERAZ, lokalnym skryptem, bez żadnego backendu.
   * Zanim zbudujesz AppSync, DynamoDB i nocne zadania, warto na prawdziwych
   * danych sprawdzić, czy generowany niemiecki jest dość dobry. Jeśli nie —
   * koszt tej wiedzy będzie zerowy.
   *
   * `resolveLesson(id)` jest opcjonalne. Dostarczone, dokłada kontekst lekcji
   * (polecenie i wzorcowe odpowiedzi), żeby paczka była samowystarczalna dla
   * etykietującego. `contentVersion` przy każdej próbie pozwala wykryć, że
   * treść lekcji zmieniła się PO tym, jak próba została zapisana — bez tego
   * porównywałabyś odpowiedź z wzorcem, którego on nigdy nie widział. */
  function exportAttempts(windowDays, resolveLesson) {
    var days = windowDays > 0 ? windowDays : 7;
    var since = now() - days * 86400000;
    var tax = window.WD.taxonomy;

    var attempts = attemptsSince(since).map(function (r) {
      var out = {
        id: r.id,
        lessonId: r.lessonId,
        contentVersion: r.contentVersion,
        mode: r.mode,
        at: r.at,
        timestamp: new Date(r.at).toISOString(),
        userAnswer: r.text,
        shownRegister: r.shownRegister,
        choiceIndex: r.choiceIndex,
        correctIndex: r.correctIndex,
        isCorrect: r.isCorrect,
        tagging: r.tagging,
      };
      var l = resolveLesson ? resolveLesson(r.lessonId) : null;
      if (l) {
        out.lesson = {
          title: l.title,
          category: l.category,
          situation: l.situation,
          contentVersion: l.contentVersion || 1,
          // wszystkie trzy rejestry, bo „poprawność” zależy od tego, który wzorzec
          references: l.answers,
          targetWeaknesses: l.targetWeaknesses || [],
        };
        out.contentDrift = (l.contentVersion || 1) !== r.contentVersion;
      }
      return out;
    });

    return {
      schemaVersion: SCHEMA_VERSION,
      taxonomyVersion: tax ? tax.VERSION : 0,
      knownCategories: tax ? tax.IDS : [],
      exportedAt: new Date().toISOString(),
      periodDays: days,
      since: new Date(since).toISOString(),
      sourceAttemptCount: attempts.length,
      attempts: attempts,
    };
  }

  function exportAttemptsBlob(windowDays, resolveLesson) {
    return new Blob([JSON.stringify(exportAttempts(windowDays, resolveLesson), null, 2)], {
      type: "application/json",
    });
  }

  function exportAttemptsFilename(windowDays) {
    return (
      "werkdeutsch-proby-" +
      (windowDays > 0 ? windowDays : 7) +
      "dni-" +
      new Date().toISOString().slice(0, 10) +
      ".json"
    );
  }

  function exportBlob() {
    return new Blob([JSON.stringify(state, null, 2)], {
      type: "application/json",
    });
  }

  /* Import SCALA, nie nadpisuje. Wgranie starszego pliku nie może skasować
   * nowszego postępu — dlatego przechodzi przez merge(), tę samą funkcję,
   * której użyje kiedyś synchronizacja. */
  function importJSON(text) {
    var incoming;
    try {
      incoming = JSON.parse(text);
    } catch (e) {
      return { ok: false, error: "To nie jest poprawny plik JSON." };
    }
    if (!incoming || typeof incoming !== "object") {
      return { ok: false, error: "Plik nie wygląda na kopię postępu WerkDeutsch." };
    }
    if (num(incoming.schemaVersion) > SCHEMA_VERSION) {
      return { ok: false, error: "Plik pochodzi z nowszej wersji aplikacji. Odśwież stronę." };
    }

    var isCurrent = incoming.lessons && incoming.vocab && typeof incoming.lessons === "object";
    // stary format: postęp jako tablica indeksów, słówka jako tablica
    var isLegacy = Array.isArray(incoming.completed) || Array.isArray(incoming.vocab);
    if (!isCurrent && !isLegacy) {
      return { ok: false, error: "Plik nie wygląda na kopię postępu WerkDeutsch." };
    }

    var before = countDone();
    state = merge(state, isCurrent ? incoming : migrateV1(incoming));
    save();
    return { ok: true, added: countDone() - before };
  }

  function countDone() {
    return Object.keys(state.lessons).filter(function (id) {
      return state.lessons[id].completed;
    }).length;
  }

  // ---------------------------------------------------------------- walidacja

  var LESSON_KINDS = ["scenario", "sentences"];
  var LESSON_ORIGINS = ["static", "generated"];
  var LESSON_STATUSES = ["published", "draft"];

  /* Domyślne wartości pól „pochodzeniowych” wypełniamy TUTAJ, a nie w treści.
   *
   * Dzięki temu dodanie nowego pola nie wymaga dopisywania go do pięćdziesięciu
   * istniejących lekcji. Ręcznie pisane lekcje są `static` + `published`
   * + `kind: "scenario"`; lekcje z generatora będą dostarczać te pola same.
   *
   * `kind` jest przygotowane pod to, o czym mówi Twój schemat: lekcje typu
   * `sentences` (pary polski→niemiecki) to INNY rodzaj ćwiczenia niż obecne
   * scenariusze, a nie ich wariant. Rozdzielenie ich teraz jest darmowe.
   *
   * `contentVersion` podnoś RĘCZNIE, gdy zmienisz treść lekcji tak, że stare
   * próby przestają być z nią porównywalne. Bez tego analiza porównywałaby
   * odpowiedź z wzorcem, którego on nigdy nie widział. */
  function applyLessonDefaults(lessons) {
    return (Array.isArray(lessons) ? lessons : []).map(function (l) {
      if (!l || typeof l !== "object") return l;
      return Object.assign(
        {
          kind: "scenario",
          origin: "static",
          status: "published",
          contentVersion: 1,
          targetWeaknesses: [],
        },
        l
      );
    });
  }

  /* Sprawdza treść z lessons.js przy starcie. Przy 6 lekcjach błąd widać od
   * razu; przy 50 pisanych przez miesiące — już nie. Lepiej krzyknąć głośno. */
  function validateLessons(lessons) {
    var problems = [];
    var seenLesson = {};
    var seenVocab = {};
    var required = ["id", "icon", "category", "short", "title", "situation"];

    if (!Array.isArray(lessons) || !lessons.length) {
      return ["lessons.js nie zawiera żadnych lekcji."];
    }

    lessons.forEach(function (l, i) {
      var where = "lekcja #" + (i + 1) + " (" + (l && l.id ? l.id : "bez id") + ")";

      required.forEach(function (k) {
        if (!l || typeof l[k] !== "string" || !l[k].trim()) {
          problems.push(where + ": brakuje pola „" + k + "”");
        }
      });
      if (!l || typeof l.id !== "string") return;

      if (seenLesson[l.id]) problems.push(where + ": id powtarza się");
      seenLesson[l.id] = 1;

      if (l.kind !== undefined && LESSON_KINDS.indexOf(l.kind) < 0) {
        problems.push(where + ': nieznany kind "' + l.kind + '" (dozwolone: ' + LESSON_KINDS.join(", ") + ")");
      }
      if (l.origin !== undefined && LESSON_ORIGINS.indexOf(l.origin) < 0) {
        problems.push(where + ': nieznany origin "' + l.origin + '"');
      }
      if (l.status !== undefined && LESSON_STATUSES.indexOf(l.status) < 0) {
        problems.push(where + ': nieznany status "' + l.status + '"');
      }
      if (l.contentVersion !== undefined && !(l.contentVersion > 0 && l.contentVersion % 1 === 0)) {
        problems.push(where + ": contentVersion musi być liczbą całkowitą > 0");
      }

      /* Lekcja z generatora bez wskazanej słabości jest podejrzana: nie wiadomo,
       * po co powstała, i nie da się później sprawdzić, czy pomogła. */
      if (l.origin === "generated" && (!Array.isArray(l.targetWeaknesses) || !l.targetWeaknesses.length)) {
        problems.push(where + ": lekcja generowana musi mieć targetWeaknesses");
      }

      if (l.targetWeaknesses !== undefined) {
        if (!Array.isArray(l.targetWeaknesses)) {
          problems.push(where + ": targetWeaknesses musi być tablicą");
        } else {
          var tax = window.WD.taxonomy;
          l.targetWeaknesses.forEach(function (tag) {
            if (tax && !tax.isKnown(tag)) {
              problems.push(
                where + ': targetWeaknesses ma nieznaną kategorię "' + tag + '" — dodaj ją do taxonomy.js'
              );
            }
          });
        }
      }

      ["simple", "natural", "professional"].forEach(function (k) {
        if (!l.answers || typeof l.answers[k] !== "string" || !l.answers[k].trim()) {
          problems.push(where + ": brakuje answers." + k);
        }
      });
      ["grammar", "phrase"].forEach(function (k) {
        if (!l[k] || typeof l[k].title !== "string" || typeof l[k].text !== "string") {
          problems.push(where + ": " + k + " musi mieć title i text");
        }
      });

      if (!Array.isArray(l.choices) || l.choices.length < 2) {
        problems.push(where + ": choices musi mieć co najmniej 2 pozycje");
      } else if (
        typeof l.correct !== "number" ||
        l.correct < 0 ||
        l.correct >= l.choices.length ||
        l.correct % 1 !== 0
      ) {
        problems.push(
          where + ": correct = " + l.correct + " nie wskazuje na żadną z " + l.choices.length + " odpowiedzi"
        );
      }

      if (!Array.isArray(l.vocab) || !l.vocab.length) {
        problems.push(where + ": brak słownictwa (vocab)");
        return;
      }
      l.vocab.forEach(function (w, j) {
        var wv = where + ", słówko #" + (j + 1);
        if (!w || typeof w.id !== "string" || !w.id.trim()) {
          problems.push(wv + ": brakuje id");
          return;
        }
        if (typeof w.de !== "string" || !w.de.trim() || typeof w.pl !== "string" || !w.pl.trim()) {
          problems.push(wv + " (" + w.id + "): brakuje de lub pl");
          return;
        }
        var prev = seenVocab[w.id];
        // to samo id może wystąpić w wielu lekcjach, ale musi znaczyć to samo
        if (prev && (prev.de !== w.de || prev.pl !== w.pl)) {
          problems.push(
            'słówko "' + w.id + '" ma dwa różne znaczenia: „' + prev.de + " = " + prev.pl +
              "” (" + prev.where + ") vs „" + w.de + " = " + w.pl + "” (" + where + ")"
          );
        }
        seenVocab[w.id] = { de: w.de, pl: w.pl, where: where };
      });
    });

    return problems;
  }

  window.WD.state = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    load: load,
    save: save,
    merge: merge,
    normalize: normalize,
    migrateV1: migrateV1,
    validateLessons: validateLessons,
    applyLessonDefaults: applyLessonDefaults,
    get: function () {
      return state;
    },
    isReadOnly: function () {
      return readOnly;
    },
    takeWarning: function () {
      var w = warning;
      warning = "";
      return w;
    },
    lesson: lesson,
    setCurrent: setCurrent,
    recordWrite: recordWrite,
    recordChoice: recordChoice,
    latestAttempt: latestAttempt,
    attemptsSince: attemptsSince,
    attemptCount: attemptCount,
    setTagging: setTagging,
    pendingTagging: pendingTagging,
    exportAttempts: exportAttempts,
    exportAttemptsBlob: exportAttemptsBlob,
    exportAttemptsFilename: exportAttemptsFilename,
    markCompleted: markCompleted,
    countDone: countDone,
    reviewOf: reviewOf,
    gradeLesson: gradeLesson,
    dueLessons: dueLessons,
    reviewStats: reviewStats,
    vocabList: vocabList,
    hasVocab: hasVocab,
    addVocab: addVocab,
    removeVocab: removeVocab,
    setLearned: setLearned,
    customId: customId,
    reset: reset,
    exportBlob: exportBlob,
    exportFilename: exportFilename,
    importJSON: importJSON,
  };
})();
