/* Review policy — when a given item should come back for study.
 *
 * THIS IS THE ONLY PLACE with the "how many days until next" rule. The
 * whole file is a pure function: it doesn't read the DOM, doesn't touch
 * localStorage, knows nothing about lessons or vocab words. It receives an
 * entry and a grade, and returns a new entry.
 *
 * Why a separate file: so that swapping the algorithm (today simple
 * Leitner boxes, someday maybe SM-2 or FSRS) is a swap of this one file,
 * without touching the interface or migrating data. The `due` and
 * `interval` fields are the contract — as long as the new algorithm
 * returns them, the rest of the app won't notice the change.
 *
 * Entry keys look like "<type>:<id>" (today "lesson:raport-serwisowy").
 * That means if individual vocab words ever need reviewing too, it's
 * enough to add a "word:" type — this file needs no change at all.
 */
window.WD = window.WD || {};
(function () {
  "use strict";

  var DAY = 86400000;

  /* Intervals in days. Each successful review moves one step to the right;
   * at the last step it stays at 60 days. */
  var STEPS = [1, 3, 7, 21, 60];

  var GRADES = ["again", "hard", "good"];

  /* Due dates are computed at the start of the day, not the hour of the
   * review. Otherwise a review done at 23:00 with a 1-day interval would be
   * "tomorrow at 23:00" and wouldn't show up in the queue for most of the day. */
  function startOfDay(ms) {
    var d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function stepFor(reps) {
    return STEPS[Math.max(0, Math.min(reps, STEPS.length - 1))];
  }

  /* entry: the previous entry (or null on the first time)
   * grade: "again" | "hard" | "good"
   * now:   timestamp (passed in from outside so this can be tested) */
  function next(entry, grade, now) {
    var reps = entry && entry.reps > 0 ? entry.reps : 0;
    var lapses = entry && entry.lapses > 0 ? entry.lapses : 0;
    var interval;

    if (grade === "again") {
      // doesn't remember — back to the start, shown again today
      reps = 0;
      lapses = lapses + 1;
      interval = 0;
    } else if (grade === "hard") {
      /* It was hard — stay on the same step. After `reps` successful
       * reviews the last interval used was stepFor(reps - 1), so this means
       * "the same interval again": no advance, but no reset to zero either. */
      interval = stepFor(Math.max(0, reps - 1));
    } else {
      // knows it — advance to the next step
      interval = stepFor(reps);
      reps = reps + 1;
    }

    return {
      due: interval === 0 ? now : startOfDay(now + interval * DAY),
      interval: interval,
      reps: reps,
      lapses: lapses,
      lastGrade: grade,
      lastReviewAt: now,
    };
  }

  /* First entry into the rotation — after completing a lesson. This isn't a
   * grade, so `reps` stays 0: only the first real review will show something. */
  function first(now) {
    return {
      due: startOfDay(now + STEPS[0] * DAY),
      interval: STEPS[0],
      reps: 0,
      lapses: 0,
      lastGrade: "",
      lastReviewAt: 0,
    };
  }

  function isDue(entry, now) {
    return !!entry && entry.due > 0 && entry.due <= now;
  }

  /* Days until due: 0 = today, positive number = in the future.
   * Computed at day boundaries, so "in 1 day" means "tomorrow", not
   * "in 24 hours". */
  function daysUntil(due, now) {
    return Math.round((startOfDay(due) - startOfDay(now)) / DAY);
  }

  function daysSince(then, now) {
    if (!then) return null;
    return Math.round((startOfDay(now) - startOfDay(then)) / DAY);
  }

  window.WD.schedule = {
    DAY: DAY,
    STEPS: STEPS,
    GRADES: GRADES,
    next: next,
    first: first,
    isDue: isDue,
    daysUntil: daysUntil,
    daysSince: daysSince,
    startOfDay: startOfDay,
  };
})();
