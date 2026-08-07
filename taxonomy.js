/* Zamknięty słownik kategorii błędów.
 *
 * DLACZEGO ZAMKNIĘTY: analiza błędów ma sens tylko wtedy, gdy da się je
 * zliczać. Model językowy pozostawiony sam sobie napisze przy jednym
 * uruchomieniu "article_gender", przy drugim "wrong_article", przy trzecim
 * "zły rodzajnik" — i wtedy „5 błędów w rodzajnikach” jest nieprawdą, bo
 * rozsypało się na trzy różne etykiety. Dlatego lista jest tutaj, w kodzie,
 * a nie w prompcie, a odpowiedzi modelu spoza listy trzeba ODRZUCAĆ, nie
 * dopisywać.
 *
 * DLACZEGO WERSJONOWANY: gdy zmienisz listę kategorii, prompt albo model,
 * rozkład etykiet się zmienia. Bez numeru wersji zapisanego przy KAŻDEJ
 * etykiecie zestawienia z marca i z października zsumują się w jedną liczbę,
 * i wyjdzie, że „pogorszył się w Dativie”, gdy w rzeczywistości poprawiłaś
 * prompt. Wniosek będzie fałszywy, a nic tego nie zasygnalizuje.
 *
 * ZASADA: nie zmieniaj znaczenia istniejącego `id`. Dodawanie nowych kategorii
 * jest bezpieczne (podnieś TAXONOMY_VERSION). Usuwanie i przemianowywanie
 * unieważnia stare dane — wtedy stare etykiety zostaw i tylko przestań ich
 * używać w nowych analizach.
 */
window.WD = window.WD || {};
(function () {
  "use strict";

  var TAXONOMY_VERSION = 1;

  /* group: do grupowania w zestawieniach; label: do pokazania człowiekowi. */
  var CATEGORIES = [
    // --- szyk zdania
    { id: "word_order_main", group: "szyk", label: "Szyk zdania głównego" },
    { id: "word_order_subordinate", group: "szyk", label: "Szyk zdania podrzędnego" },
    { id: "verb_final_position", group: "szyk", label: "Czasownik na końcu" },
    { id: "separable_verb", group: "szyk", label: "Czasownik rozdzielnie złożony" },

    // --- formy czasownika
    { id: "perfekt_auxiliary", group: "czasownik", label: "haben czy sein w Perfekcie" },
    { id: "participle_form", group: "czasownik", label: "Forma Partizip II" },
    { id: "tense_choice", group: "czasownik", label: "Wybór czasu" },
    { id: "passive_voice", group: "czasownik", label: "Strona bierna" },
    { id: "modal_verb", group: "czasownik", label: "Czasownik modalny" },
    { id: "subjunctive_politeness", group: "czasownik", label: "Tryb przypuszczający (könnten)" },

    // --- rzeczownik i przypadki
    { id: "article_gender", group: "rzeczownik", label: "Rodzaj rzeczownika" },
    { id: "case_akkusativ", group: "rzeczownik", label: "Biernik (Akkusativ)" },
    { id: "case_dativ", group: "rzeczownik", label: "Celownik (Dativ)" },
    { id: "case_genitiv", group: "rzeczownik", label: "Dopełniacz (Genitiv)" },
    { id: "plural_form", group: "rzeczownik", label: "Liczba mnoga" },
    { id: "adjective_ending", group: "rzeczownik", label: "Końcówka przymiotnika" },
    { id: "preposition_choice", group: "rzeczownik", label: "Wybór przyimka" },

    // --- słownictwo i rejestr
    { id: "vocabulary_choice", group: "słownictwo", label: "Niewłaściwe słowo" },
    { id: "technical_term", group: "słownictwo", label: "Termin techniczny" },
    { id: "register_too_casual", group: "słownictwo", label: "Za potocznie" },
    { id: "register_too_formal", group: "słownictwo", label: "Za formalnie" },

    // --- pozostałe
    { id: "spelling", group: "inne", label: "Pisownia" },
    { id: "missing_content", group: "inne", label: "Pominięta informacja" },
    { id: "literal_translation", group: "inne", label: "Kalka z polskiego" },
  ];

  var byId = {};
  CATEGORIES.forEach(function (c) {
    byId[c.id] = c;
  });

  var IDS = CATEGORIES.map(function (c) {
    return c.id;
  });

  function isKnown(id) {
    return Object.prototype.hasOwnProperty.call(byId, id);
  }

  function labelOf(id) {
    return byId[id] ? byId[id].label : id;
  }

  function groupOf(id) {
    return byId[id] ? byId[id].group : "inne";
  }

  /* Filtr odpowiedzi modelu. Zwraca to, co znane, i osobno to, co odrzucone —
   * odrzucone warto logować, bo powtarzające się nieznane etykiety to sygnał,
   * że w taksonomii brakuje kategorii, a nie że model się myli. */
  function accept(tags) {
    var known = [];
    var rejected = [];
    (Array.isArray(tags) ? tags : []).forEach(function (t) {
      var id = typeof t === "string" ? t.trim() : "";
      if (!id) return;
      if (isKnown(id)) {
        if (known.indexOf(id) < 0) known.push(id);
      } else if (rejected.indexOf(id) < 0) {
        rejected.push(id);
      }
    });
    return { tags: known, rejected: rejected };
  }

  /* Zliczanie robimy TUTAJ, deterministycznie — nigdy nie prosimy o to modelu.
   * Model etykietuje pojedyncze próby; sumy liczy kod, bo tylko wtedy są
   * prawdziwe i powtarzalne. */
  function summarize(taggedAttempts) {
    var counts = {};
    var examples = {};
    var counted = 0;

    (taggedAttempts || []).forEach(function (a) {
      if (!a || !a.tagging || a.tagging.status !== "done") return;
      counted++;
      (a.tagging.tags || []).forEach(function (id) {
        if (!isKnown(id)) return;
        counts[id] = (counts[id] || 0) + 1;
        if (!examples[id]) examples[id] = [];
        if (examples[id].length < 3 && a.text) examples[id].push(a.text);
      });
    });

    var top = Object.keys(counts)
      .map(function (id) {
        return {
          category: id,
          label: labelOf(id),
          group: groupOf(id),
          count: counts[id],
          examples: examples[id] || [],
        };
      })
      .sort(function (a, b) {
        // remis rozstrzygamy po id, żeby zestawienie było powtarzalne
        return b.count - a.count || (a.category < b.category ? -1 : 1);
      });

    return {
      taxonomyVersion: TAXONOMY_VERSION,
      sourceAttemptCount: counted,
      topCategories: top,
    };
  }

  window.WD.taxonomy = {
    VERSION: TAXONOMY_VERSION,
    CATEGORIES: CATEGORIES,
    IDS: IDS,
    isKnown: isKnown,
    labelOf: labelOf,
    groupOf: groupOf,
    accept: accept,
    summarize: summarize,
  };
})();
