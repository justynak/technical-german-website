/* Data layer: saving progress, migrating old data, merging, export/import.
 *
 * Two principles this whole file rests on:
 *
 * 1. IDENTITY, NOT POSITION. Progress is keyed by lesson id
 *    (`lessons["raport-serwisowy"]`), not array index. This lets lessons be
 *    added, removed, and reordered without breaking saved progress.
 *
 * 2. DATA IS MONOTONIC. Every mutable value carries its own timestamp, and
 *    deletion leaves a "tombstone" (deleted: true) instead of cutting the
 *    entry out. This makes merging two copies a set union: the result
 *    doesn't depend on merge order and never loses progress. This is the
 *    foundation for eventual cross-device sync — merge() below is already
 *    all the logic that's needed.
 */
window.WD = window.WD || {};
(function () {
  "use strict";

  var KEY = "werkdeutsch-state";
  var LEGACY_KEY = "werkdeutsch-state-v1";

  /* v3 added the `review` map (review schedule).
   * v4 replaced a single overwritten answer per lesson (`lessons[id].attempt`)
   *    with an append-only attempt log (`attemptLog`).
   *
   * The number is bumped on every shape change, even just adding a field:
   * older code doesn't know about new fields, so its save would strip them.
   * Bumping the number makes an old tab fall back to read-only mode instead
   * of corrupting data. */
  var SCHEMA_VERSION = 4;

  /* Lesson order from v1 — FROZEN FOREVER.
   *
   * Old data saved progress as indexes ([0, 2, 5]). Index 2 means "the
   * third lesson in the array at the time the data was saved" — not "the
   * third lesson today." This can only be reconstructed from a frozen list.
   * That's why this array must not be generated from lessons.js and must
   * never change, even if the lesson order in lessons.js changes.
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

  /* Migrated data has no real timestamps — we don't know when it was
   * created. We give it 1 (almost epoch), so any later real write from any
   * device wins during merging. */
  var MIGRATED_AT = 1;

  function emptyState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      current: null,
      currentAt: 0,
      lessons: {},
      vocab: {},
      /* Review schedule. The key is "<type>:<id>" — today only
       * "lesson:<id>", but the format is ready for other item types
       * (e.g. "word:<id>") without a schema change or migration. */
      review: {},
      /* Attempt log: APPEND-ONLY, never overwritten.
       *
       * There used to be a single answer per lesson here, overwritten on
       * every attempt. That's convenient for a text field and useless for
       * analysis — the error history was destroyed the moment it was
       * created. Without history, nothing can be computed or generated
       * from the errors.
       *
       * Records are immutable, so merging is a set union by `id` — the
       * simplest possible case, with no conflicts. The only mutable field
       * is `tagging`, resolved by its own timestamp.
       *
       * Size: ~300 bytes per record, so 2000 attempts ≈ 600 kB. Given a
       * localStorage limit around 5 MB, there's no need to trim; if there
       * ever is, trim by `at` and remember that merging can revive deleted ones. */
      attemptLog: [],
      updatedAt: 0,
    };
  }

  function reviewKey(type, id) {
    return type + ":" + id;
  }

  /* The device id is kept OUTSIDE the merged state — it's local and there's
   * no reason to carry it between devices. It only serves to make sure
   * attempt ids from two devices never collide. */
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
        /* private browsing — id will only last for the session */
      }
    }
    return deviceId;
  }

  function attemptId(at) {
    return "a" + at.toString(36) + "-" + getDeviceId() + "-" + Math.random().toString(36).slice(2, 6);
  }

  /* Tagging state is EXPLICIT, not "null until the nightly job runs by".
   * A `null` field can't distinguish: not yet processed / processed with no
   * errors / tagging failed / failed five times and should be given up on.
   * Without this distinction, after the first failure it's unclear what to retry. */
  function emptyTagging() {
    return {
      status: "pending", // pending | done | failed | skipped
      tags: [],
      rejected: [], // tags outside the taxonomy — a signal that it's missing one
      taggerVersion: "", // model + prompt version that produced this
      taxonomyVersion: 0, // category dictionary version at tagging time
      at: 0,
      tries: 0,
      error: "",
    };
  }

  // ---------------------------------------------------------------- migration

  function migrateV1(old) {
    var s = emptyState();
    var i;

    if (Array.isArray(old.completed)) {
      for (i = 0; i < old.completed.length; i++) {
        var id = V1_ORDER[old.completed[i]];
        if (!id) continue; // index outside the frozen list — can't be reconstructed
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

    /* The old vocab id was derived from its content ("die leckage|nieszczelność").
     * We match by content against words in lessons.js to recover the new,
     * stable id. Anything that can't be matched ends up as a custom phrase. */
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

  /* v3 → v4: a single overwritten answer per lesson becomes one record
   * in the log. The history can't be reconstructed — it was overwritten
   * before this code even existed. We salvage what's left: the last attempt. */
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
      /* For free text, correctness is NOT automatically decidable: a lesson
       * has three correct patterns in different registers. `null` here means
       * "ungraded", not "wrong" — otherwise any statistic would be fiction. */
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
      /* Here correctness is decidable without any model — and that's exactly
       * why multiple-choice is the cheapest source of data on weaknesses. */
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

  // ------------------------------------------------------------- normalization

  /* We trust nothing that comes from localStorage or an imported file.
   * Bad content should be rejected here, not crash render(). */
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
        /* `attempt`/`attemptAt` from v3 are deliberately NOT carried back
         * here — attemptLog is now the sole source of truth for attempts.
         * Only migrateToV4 reads them, straight from the raw data. */
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
        if (seen[r.id]) return; // the log must have unique ids
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
    /* Tags outside the taxonomy are filtered out already at load time, not
     * just at counting time — otherwise an unknown tag would skew statistics
     * everywhere that doesn't know about it. */
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

  // ----------------------------------------------------------------- merging

  /* Merges two copies of state. Properties this relies on:
   *   - it's a join (idempotent and commutative): merge(a,b) == merge(b,a),
   *     merge(a,a) == a. The order and number of merges don't matter.
   *   - nothing is lost: `completed` only grows (logical OR), and deletions
   *     are timestamped tombstones, so they're resolvable too.
   *
   * Key detail: `learned` is resolved by its own learnedAt, not the
   * updatedAt of the whole entry or a timestamp on the whole data package.
   * If the timestamp lived on the whole package, editing one word on a
   * phone would invalidate every other change made on a laptop.
   */
  var EMPTY_LESSON = { completed: false, completedAt: 0, attempt: "", attemptAt: 0 };

  /* Picks the "fresher" of two versions by the given timestamp field.
   *
   * Ties are resolved by content, not argument order. Without this,
   * merge(a, b) and merge(b, a) could give different results when both
   * devices saved a change in the same millisecond — and then the whole
   * "merge order doesn't matter" property would stop holding. */
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
      /* The missing side is replaced with an empty entry with zero
       * timestamps. This used to be `|| {}`, which gave undefined in the
       * comparison — and any comparison with undefined is false, so a
       * lesson present in only one copy would lose its written answer. */
      var x = a.lessons[id] || EMPTY_LESSON;
      var y = b.lessons[id] || EMPTY_LESSON;
      var done = x.completed || y.completed;
      var stamps = [x.completed && x.completedAt, y.completed && y.completedAt].filter(Boolean);
      var att = fresher(x, y, "attemptAt");
      out.lessons[id] = {
        completed: done,
        // earliest real completion moment — that's when they actually did it
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
      /* The schedule is taken from the MOST RECENT real review — it knows
       * the most about what they remember today.
       *
       * Counters are merged by maximum, not by sum. Sum isn't idempotent:
       * the same merge run twice would bump reps twice and artificially
       * lengthen intervals. Maximum gives the same result no matter how
       * many times we merge.
       *
       * DELIBERATE LIMITATION: if the same lesson is reviewed on two
       * devices before syncing, one of the grades gets dropped. Without an
       * event log this can't be resolved, and for a single person it's not
       * worth the added complexity. */
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

    /* The attempt log is the simplest merge case there is: records are
     * immutable and have unique ids, so a set union is enough. No
     * conflicts, because nothing ever changes a record's content.
     *
     * The only exception is `tagging`, appended later by analysis — and
     * that's resolved by its own timestamp, the same way as `learned` for
     * vocab words. */
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

  /* Keys are sorted: the merge result is then byte-identical regardless of
   * argument order, and the export file has a stable layout. */
  function keysOf(x, y) {
    var seen = {};
    Object.keys(x).concat(Object.keys(y)).forEach(function (k) {
      seen[k] = 1;
    });
    return Object.keys(seen).sort();
  }

  // ------------------------------------------------------------- read/write

  var state = emptyState();
  var readOnly = false; // true when the browser holds data NEWER than this code
  var warning = "";

  function load() {
    /* Recomputed on every load. Without this, once read-only mode was set
     * it stayed forever, even after loading valid data — and all
     * subsequent saves would silently vanish. */
    readOnly = false;
    var stored = null;
    try {
      stored = JSON.parse(localStorage.getItem(KEY) || "null");
    } catch (e) {
      stored = null;
    }

    if (stored && num(stored.schemaVersion) > SCHEMA_VERSION) {
      /* This tab has old code (e.g. from CDN cache), and the data is from a
       * newer version. Saving would corrupt it, so we block it. */
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
      save(); // the old key is left untouched as a backup
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

  // ------------------------------------------------------------------ mutations

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

  // ------------------------------------------------------------- attempt log

  /* Every attempt is a NEW record. Nothing gets overwritten — that's the
   * only way error analysis has anything to work with at all. */
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

  /* Latest attempt for a lesson — used solely to prefill the text field.
   * Computed from the log so there's no second source of truth. */
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

  /* Saves a tagging result. Written by a future analysis pipeline; it
   * exists here so the data shape is settled from the start and adding the
   * pipeline later won't require another migration. */
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

  /* Completing a lesson enters it into the review rotation. This is the
   * only entry point — so there's no "completed but never scheduled" state. */
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

  // ------------------------------------------------------------------ reviews

  function reviewOf(id) {
    return state.review[reviewKey("lesson", id)] || null;
  }

  /* Saves a review grade. The interval itself is computed by schedule.js —
   * there's no "how many days" rule here, so swapping the algorithm doesn't
   * touch this save. */
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

  /* Lessons due for review from the given id list, most overdue first.
   * Ordered by `due`, with ties broken by id — otherwise the queue would
   * jump around on every render. */
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

  /* Active vocab words: no tombstones, newest first. */
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
      // re-adding doesn't erase history: "learned" is preserved
      learned: prev ? prev.learned : false,
      learnedAt: prev ? prev.learnedAt : 0,
      addedAt: prev && prev.addedAt ? prev.addedAt : t,
      deleted: false,
      updatedAt: t,
    };
    save();
  }

  /* Deletion = tombstone. The entry stays so merging doesn't revive a word
   * they deliberately removed. */
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
    v.learnedAt = now(); // its own timestamp — see the comment at merge()
    v.updatedAt = v.learnedAt;
    save();
  }

  function reset() {
    state = emptyState();
    save();
  }

  // ------------------------------------------------------------ export/import

  function exportFilename() {
    return "werkdeutsch-postep-" + new Date().toISOString().slice(0, 10) + ".json";
  }

  /* Export for error analysis — a rolling N-day window.
   *
   * This is the whole bridge to a future "analysis → new lessons" pipeline,
   * and it can be used RIGHT NOW with a local script, no backend needed.
   * Before building AppSync, DynamoDB, and nightly jobs, it's worth checking
   * on real data whether the generated German is good enough. If not — the
   * cost of finding that out is zero.
   *
   * `resolveLesson(id)` is optional. When provided, it adds lesson context
   * (the prompt and model answers) so the bundle is self-sufficient for
   * whoever tags it. `contentVersion` on each attempt makes it possible to
   * detect that the lesson content changed AFTER the attempt was recorded —
   * without this you'd be comparing an answer to a pattern they never saw. */
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
          // all three registers, because "correctness" depends on which pattern
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

  /* Import MERGES, it doesn't overwrite. Loading an older file must not
   * erase newer progress — so it goes through merge(), the same function
   * that sync will eventually use. */
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
    // old format: progress as an index array, vocab as an array
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

  // ---------------------------------------------------------------- validation

  var LESSON_KINDS = ["scenario", "sentences"];
  var LESSON_ORIGINS = ["static", "generated"];
  var LESSON_STATUSES = ["published", "draft"];

  /* Default values for "provenance" fields are filled in HERE, not in the
   * content.
   *
   * This means adding a new field doesn't require touching fifty existing
   * lessons. Hand-written lessons are `static` + `published`
   * + `kind: "scenario"`; generator-produced lessons will supply these
   * fields themselves.
   *
   * `kind` is set up for what the schema anticipates: `sentences`-type
   * lessons (Polish→German pairs) are a DIFFERENT kind of exercise from the
   * current scenarios, not a variant of them. Separating them now is free.
   *
   * Bump `contentVersion` MANUALLY when you change a lesson's content so
   * that old attempts are no longer comparable to it. Without this,
   * analysis would compare an answer to a pattern they never saw. */
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

  /* Validates the content from lessons.js at startup. With 6 lessons an
   * error is obvious right away; with 50 written over months, it isn't
   * anymore. Better to fail loudly. */
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

      /* A generator-produced lesson without a declared weakness is
       * suspicious: it's unclear why it was created, and there's no way to
       * later check whether it helped. */
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
        // the same id can appear in multiple lessons, but must mean the same thing
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
