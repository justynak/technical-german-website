/* Closed dictionary of error categories.
 *
 * WHY CLOSED: error analysis only makes sense if the errors can be counted.
 * A language model left to its own devices will write "article_gender" on
 * one run, "wrong_article" on the next, "zły rodzajnik" on a third — and
 * then "5 article errors" is untrue, because it splintered into three
 * different labels. That's why the list lives here, in code, not in the
 * prompt, and model responses outside the list must be REJECTED, not
 * appended.
 *
 * WHY VERSIONED: when you change the category list, the prompt, or the
 * model, the label distribution shifts. Without a version number recorded
 * on EVERY label, a March summary and an October summary would sum into
 * one number, making it look like "Dativ got worse" when in reality you
 * fixed the prompt. The conclusion would be false, and nothing would flag it.
 *
 * RULE: don't change the meaning of an existing `id`. Adding new categories
 * is safe (bump TAXONOMY_VERSION). Removing or renaming invalidates old
 * data — in that case leave the old labels and just stop using them in new
 * analyses.
 */
window.WD = window.WD || {};
(function () {
  "use strict";

  var TAXONOMY_VERSION = 1;

  /* group: for grouping in summaries; label: for showing to a human. */
  var CATEGORIES = [
    // --- word order
    { id: "word_order_main", group: "order", label: "Szyk zdania głównego" },
    { id: "word_order_subordinate", group: "order", label: "Szyk zdania podrzędnego" },
    { id: "verb_final_position", group: "order", label: "Czasownik na końcu" },
    { id: "separable_verb", group: "order", label: "Czasownik rozdzielnie złożony" },

    // --- verb forms
    { id: "perfekt_auxiliary", group: "verb", label: "haben czy sein w Perfekcie" },
    { id: "participle_form", group: "verb", label: "Forma Partizip II" },
    { id: "tense_choice", group: "verb", label: "Wybór czasu" },
    { id: "passive_voice", group: "verb", label: "Strona bierna" },
    { id: "modal_verb", group: "verb", label: "Czasownik modalny" },
    { id: "subjunctive_politeness", group: "verb", label: "Tryb przypuszczający (könnten)" },

    // --- noun and cases
    { id: "article_gender", group: "noun", label: "Rodzaj rzeczownika" },
    { id: "case_akkusativ", group: "noun", label: "Biernik (Akkusativ)" },
    { id: "case_dativ", group: "noun", label: "Celownik (Dativ)" },
    { id: "case_genitiv", group: "noun", label: "Dopełniacz (Genitiv)" },
    { id: "plural_form", group: "noun", label: "Liczba mnoga" },
    { id: "adjective_ending", group: "noun", label: "Końcówka przymiotnika" },
    { id: "preposition_choice", group: "noun", label: "Wybór przyimka" },

    // --- vocabulary and register
    { id: "vocabulary_choice", group: "vocabulary", label: "Niewłaściwe słowo" },
    { id: "technical_term", group: "vocabulary", label: "Termin techniczny" },
    { id: "register_too_casual", group: "vocabulary", label: "Za potocznie" },
    { id: "register_too_formal", group: "vocabulary", label: "Za formalnie" },

    // --- other
    { id: "spelling", group: "other", label: "Pisownia" },
    { id: "missing_content", group: "other", label: "Pominięta informacja" },
    { id: "literal_translation", group: "other", label: "Kalka z polskiego" },
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

  /* Filters model responses. Returns what's known, and separately what's
   * rejected — rejected ones are worth logging, since recurring unknown
   * labels are a signal that the taxonomy is missing a category, not that
   * the model is wrong. */
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

  /* Counting is done HERE, deterministically — we never ask the model to do
   * it. The model tags individual attempts; the code computes the totals,
   * because only then are they accurate and reproducible. */
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
        // ties are broken by id, so the summary is reproducible
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
