/* Polityka powtórek — kiedy dana rzecz ma wrócić do nauki.
 *
 * TO JEST JEDYNE MIEJSCE z regułą „za ile dni znowu”. Cały plik jest czystą
 * funkcją: nie czyta DOM, nie dotyka localStorage, nie wie nic o lekcjach ani
 * o słówkach. Dostaje wpis i ocenę, zwraca nowy wpis.
 *
 * Dlaczego osobny plik: żeby wymiana algorytmu (dziś proste pudełka Leitnera,
 * kiedyś np. SM-2 albo FSRS) była podmianą tego jednego pliku, bez ruszania
 * interfejsu i bez migracji danych. Pola `due` i `interval` są kontraktem —
 * dopóki nowy algorytm je zwraca, reszta aplikacji nie zauważy zmiany.
 *
 * Klucze wpisów mają postać "<typ>:<id>" (dziś "lesson:raport-serwisowy").
 * Dzięki temu, gdyby kiedyś powtarzać też pojedyncze słówka, wystarczy dodać
 * typ "word:" — ten plik nie wymaga wtedy żadnej zmiany.
 */
window.WD = window.WD || {};
(function () {
  "use strict";

  var DAY = 86400000;

  /* Odstępy w dniach. Kolejna udana powtórka przesuwa o jeden stopień w prawo;
   * na ostatnim stopniu zostaje 60 dni. */
  var STEPS = [1, 3, 7, 21, 60];

  var GRADES = ["again", "hard", "good"];

  /* Terminy liczymy na początek dnia, nie na godzinę powtórki. Inaczej powtórka
   * zrobiona o 23:00 z odstępem 1 dnia byłaby „na jutro o 23:00” i przez cały
   * dzień nie pokazałaby się w kolejce. */
  function startOfDay(ms) {
    var d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function stepFor(reps) {
    return STEPS[Math.max(0, Math.min(reps, STEPS.length - 1))];
  }

  /* entry: poprzedni wpis (albo null przy pierwszym razie)
   * grade: "again" | "hard" | "good"
   * now:   znacznik czasu (podawany z zewnątrz, żeby dało się to testować) */
  function next(entry, grade, now) {
    var reps = entry && entry.reps > 0 ? entry.reps : 0;
    var lapses = entry && entry.lapses > 0 ? entry.lapses : 0;
    var interval;

    if (grade === "again") {
      // nie pamięta — wracamy na start i pokazujemy jeszcze dziś
      reps = 0;
      lapses = lapses + 1;
      interval = 0;
    } else if (grade === "hard") {
      /* Było trudne — zostajemy na tym samym stopniu. Po `reps` udanych
       * powtórkach ostatni użyty odstęp to stepFor(reps - 1), więc to znaczy
       * „ten sam odstęp jeszcze raz”: bez awansu, ale i bez cofania do zera. */
      interval = stepFor(Math.max(0, reps - 1));
    } else {
      // umie — awans na kolejny stopień
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

  /* Pierwsze wejście do rotacji — po ukończeniu lekcji. Nie jest to ocena,
   * więc `reps` zostaje 0: pierwsza prawdziwa powtórka dopiero coś wykaże. */
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

  /* Ile dni do terminu: 0 = dziś, liczba dodatnia = w przyszłości.
   * Liczone na granicach dni, żeby „za 1 dzień” znaczyło „jutro”, a nie
   * „za 24 godziny”. */
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
