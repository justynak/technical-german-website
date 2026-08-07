/* Warstwa widoku: renderowanie i obsługa kliknięć.
 *
 * Nie trzyma stanu — czyta go z WD.state i tam go zapisuje. Wszystko, co
 * dotyczy lekcji, odbywa się przez id (nie przez pozycję w tablicy); indeksy
 * pojawiają się tylko lokalnie, do numeracji i przycisków „poprzedni/następny”.
 */
(function () {
  "use strict";

  var S = window.WD.state;
  var SCH = window.WD.schedule;
  var LESSONS = S.applyLessonDefaults(window.LESSONS || []);
  var ALL_IDS = LESSONS.map(function (l) {
    return l.id;
  });

  /* Polska liczba mnoga: 1 scenariusz, 2–4 scenariusze, 5+ scenariuszy. */
  function plural(n, one, few, many) {
    if (n === 1) return one;
    var r10 = n % 10;
    var r100 = n % 100;
    if (r10 >= 2 && r10 <= 4 && !(r100 >= 12 && r100 <= 14)) return few;
    return many;
  }

  function whenLabel(due) {
    var d = SCH.daysUntil(due, Date.now());
    if (d <= 0) return "dziś";
    if (d === 1) return "jutro";
    return "za " + d + " " + plural(d, "dzień", "dni", "dni");
  }

  function agoLabel(when) {
    var d = SCH.daysSince(when, Date.now());
    if (d === null) return "";
    if (d <= 0) return "dziś";
    if (d === 1) return "wczoraj";
    return d + " " + plural(d, "dzień", "dni", "dni") + " temu";
  }

  var $ = function (id) {
    return document.getElementById(id);
  };
  var esc = function (x) {
    return String(x).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  };

  var toastTimer;
  function toast(text, ms) {
    clearTimeout(toastTimer);
    $("toast").textContent = text;
    $("toast").classList.add("show");
    toastTimer = setTimeout(function () {
      $("toast").classList.remove("show");
    }, ms || 2000);
  }

  // ------------------------------------------------------ walidacja przy starcie

  /* Błąd w treści lekcji ma być widoczny natychmiast, a nie objawiać się
   * pustym polem w interfejsie kilka tygodni później. */
  var problems = S.validateLessons(LESSONS);
  if (problems.length) {
    document.body.innerHTML =
      '<div style="max-width:52rem;margin:3rem auto;padding:1.5rem;font:15px/1.6 ui-monospace,monospace;' +
      'background:#2a1618;color:#ffd9d9;border-radius:12px">' +
      "<h1 style='font:600 20px/1.4 system-ui'>Błąd w treści lekcji (lessons.js)</h1>" +
      "<p>Aplikacja się nie uruchomi, dopóki to nie zostanie naprawione:</p><ul>" +
      problems
        .map(function (p) {
          return "<li>" + esc(p) + "</li>";
        })
        .join("") +
      "</ul></div>";
    return;
  }

  // ------------------------------------------------------------ bieżąca lekcja

  S.load();

  function indexOfId(id) {
    for (var i = 0; i < LESSONS.length; i++) {
      if (LESSONS[i].id === id) return i;
    }
    return -1;
  }

  function lessonById(id) {
    var i = indexOfId(id);
    return i >= 0 ? LESSONS[i] : null;
  }

  /* Zapisane id może już nie istnieć — lekcja mogła zostać usunięta albo
   * przemianowana. Wtedy wracamy na początek, zamiast wysypać render(). */
  var currentIndex = Math.max(0, indexOfId(S.get().current));
  function lesson() {
    return LESSONS[currentIndex];
  }
  function goTo(index) {
    if (index < 0 || index >= LESSONS.length) return;
    currentIndex = index;
    S.setCurrent(lesson().id);
    render();
    scrollTo(0, 0);
  }

  // ------------------------------------------------------------- renderowanie

  function progress() {
    // liczymy tylko lekcje, które nadal istnieją — inaczej postęp przekroczy 100%
    var done = LESSONS.filter(function (l) {
      return (S.get().lessons[l.id] || {}).completed;
    }).length;
    var pct = LESSONS.length ? Math.round((done / LESSONS.length) * 100) : 0;
    $("done-count").textContent = done;
    $("total-count").textContent = LESSONS.length;
    $("progress-pct").textContent = pct + "%";
    $("progress-bar").style.width = pct + "%";
    $("vocab-count").textContent = S.vocabList().length;

    var stats = S.reviewStats(ALL_IDS);
    var hint = $("review-hint");
    if (stats.due > 0) {
      hint.hidden = false;
      hint.textContent =
        stats.due + " " + plural(stats.due, "powtórka", "powtórki", "powtórek") + " na dziś";
    } else if (stats.nextDue) {
      hint.hidden = false;
      hint.textContent = "Następna powtórka " + whenLabel(stats.nextDue);
    } else {
      hint.hidden = true;
      hint.textContent = "";
    }
  }

  /* Kolejka powtórek nad listą scenariuszy. Pokazuje się tylko wtedy, gdy coś
   * jest naprawdę do zrobienia — pusty panel to szum. */
  function renderReview() {
    var due = S.dueLessons(ALL_IDS);
    var panel = $("review-panel");

    if (!due.length) {
      panel.hidden = true;
      $("review-list").innerHTML = "";
      return;
    }

    panel.hidden = false;
    $("review-title").textContent =
      due.length +
      " " +
      plural(due.length, "scenariusz", "scenariusze", "scenariuszy") +
      " " +
      plural(due.length, "czeka", "czekają", "czeka") +
      " na powtórkę";

    $("review-list").innerHTML = due
      .map(function (id) {
        var i = indexOfId(id);
        var l = LESSONS[i];
        var entry = S.reviewOf(id);
        var saved = S.get().lessons[id] || {};
        var last = entry.lastReviewAt || saved.completedAt;
        var overdue = SCH.daysUntil(entry.due, Date.now());
        var meta = last ? "ostatnio: " + agoLabel(last) : "jeszcze nie powtarzane";
        if (overdue < 0) {
          meta += " · zaległe od " + agoLabel(entry.due);
        }
        return (
          '<div class="review-item"><span>' +
          String(i + 1).padStart(2, "0") +
          "</span><div><b>" +
          esc(l.short) +
          "</b><i>" +
          esc(meta) +
          '</i></div><button data-review-id="' +
          esc(id) +
          '">Powtórz →</button></div>'
        );
      })
      .join("");
  }

  function tabs() {
    var now = Date.now();
    $("scenario-tabs").innerHTML = LESSONS.map(function (l, i) {
      var done = (S.get().lessons[l.id] || {}).completed;
      var due = SCH.isDue(S.reviewOf(l.id), now);
      // padStart, nie "0"+n — inaczej lekcja 10 wyświetla się jako „010”
      var no = String(i + 1).padStart(2, "0");
      return (
        '<button class="scenario-tab ' +
        (i === currentIndex ? "active" : "") +
        " " +
        (done ? "done" : "") +
        " " +
        (due ? "due" : "") +
        '" data-lesson-id="' +
        esc(l.id) +
        '"><span>' +
        no +
        "</span><b>" +
        esc(l.short) +
        "</b></button>"
      );
    }).join("");
  }

  function chips() {
    $("vocab-chips").innerHTML = lesson()
      .vocab.map(function (w) {
        var saved = S.hasVocab(w.id);
        return (
          '<span class="chip"><b>' +
          esc(w.de) +
          "</b><i>— " +
          esc(w.pl) +
          '</i><button class="' +
          (saved ? "saved" : "") +
          '" data-vocab-id="' +
          esc(w.id) +
          '">' +
          (saved ? "✓" : "+") +
          "</button></span>"
        );
      })
      .join("");
  }

  function render() {
    var l = lesson();
    var saved = S.get().lessons[l.id] || {};

    $("scenario-icon").textContent = l.icon;
    $("scenario-category").textContent = l.category;
    $("scenario-title").textContent = l.title;
    $("scenario-situation").textContent = l.situation;
    var last = S.latestAttempt(l.id);
    $("user-answer").value = last ? last.text : "";
    $("model-answer").textContent = l.answers.natural;
    $("grammar-title").textContent = l.grammar.title;
    $("grammar-text").textContent = l.grammar.text;
    $("phrase-title").textContent = l.phrase.title;
    $("phrase-text").textContent = l.phrase.text;

    $("choices").innerHTML = l.choices
      .map(function (text, i) {
        return (
          '<button class="choice" data-choice="' +
          i +
          '"><span>' +
          String.fromCharCode(65 + i) +
          "</span>" +
          esc(text) +
          "</button>"
        );
      })
      .join("");
    delete $("choices").dataset.done;

    $("feedback").hidden = true;

    /* Ukończenie jest jednorazowym wejściem do rotacji powtórek. Potem nie ma
     * już czego „oznaczać” — jest tylko ocena, jak poszła powtórka. Dlatego te
     * dwa elementy wykluczają się, a nie stoją obok siebie. */
    var entry = S.reviewOf(l.id);
    $("complete").hidden = !!saved.completed;
    $("complete").classList.toggle("done", !!saved.completed);
    $("complete").textContent = saved.completed ? "Ukończono ✓" : "Oznacz jako ukończone ✓";
    $("grades").hidden = !saved.completed;
    if (saved.completed && entry) {
      $("grades").querySelector("small").textContent = SCH.isDue(entry, Date.now())
        ? "Powtórka — jak Ci poszło?"
        : "Jak Ci poszło? (następna " + whenLabel(entry.due) + ")";
    }

    $("prev").disabled = currentIndex === 0;
    $("next").disabled = currentIndex === LESSONS.length - 1;
    $("position").textContent = currentIndex + 1 + " / " + LESSONS.length;

    document.querySelectorAll("[data-level]").forEach(function (b) {
      b.classList.toggle("active", b.dataset.level === "natural");
    });

    tabs();
    chips();
    renderReview();
    progress();
  }

  function notebook() {
    var query = $("search").value.toLocaleLowerCase("pl");
    var filter = $("filter").value;
    var all = S.vocabList();
    var list = all.filter(function (v) {
      var matches = (v.de + " " + v.pl).toLocaleLowerCase("pl").indexOf(query) >= 0;
      var byState = filter === "all" || (filter === "learned" ? v.learned : !v.learned);
      return matches && byState;
    });

    $("vocab-list").innerHTML = list
      .map(function (v) {
        return (
          '<article class="vocab-row ' +
          (v.learned ? "learned" : "") +
          '" data-id="' +
          esc(v.id) +
          '"><strong>' +
          esc(v.de) +
          "</strong><span>" +
          esc(v.pl) +
          "</span><em>" +
          esc(v.example || "—") +
          '</em><div class="row-actions">' +
          '<button class="learn ' +
          (v.learned ? "active" : "") +
          '" title="Opanowane">✓</button>' +
          '<button class="delete" title="Usuń">×</button></div></article>'
        );
      })
      .join("");

    $("empty").style.display = all.length ? "none" : "block";
    $("stat-all").textContent = all.length;
    $("stat-learned").textContent = all.filter(function (v) {
      return v.learned;
    }).length;
    $("stat-learning").textContent = all.filter(function (v) {
      return !v.learned;
    }).length;
    $("vocab-count").textContent = all.length;
  }

  function view(name) {
    document.querySelectorAll(".view").forEach(function (v) {
      v.classList.toggle("active", v.id === name + "-view");
    });
    document.querySelectorAll(".nav").forEach(function (b) {
      b.classList.toggle("active", b.dataset.view === name);
    });
    if (name === "notebook") notebook();
    scrollTo({ top: 0, behavior: "smooth" });
  }

  // ------------------------------------------------------------------ słownictwo

  function toggleLessonWord(vocabId) {
    var w = null;
    lesson().vocab.forEach(function (x) {
      if (x.id === vocabId) w = x;
    });
    if (!w) return;
    if (S.hasVocab(vocabId)) {
      S.removeVocab(vocabId);
      toast("Usunięto z notatnika");
    } else {
      S.addVocab(vocabId, w.de, w.pl, lesson().answers.simple, false);
      toast("Dodano do notatnika");
    }
    chips();
    progress();
    notebook();
  }

  /* Ocena powtórki. Odstęp wylicza schedule.js — tutaj tylko przekazujemy
   * ocenę i pokazujemy wynik. Zmiana algorytmu nie dotyka tej funkcji. */
  function gradeCurrent(grade) {
    var entry = S.gradeLesson(lesson().id, grade);
    if (!entry) return;
    render();
    scrollTo(0, 0);
    if (entry.interval === 0) {
      toast("Nic straconego — ten scenariusz wróci jeszcze dziś.", 3000);
    } else {
      toast("Zapisane. Następna powtórka " + whenLabel(entry.due) + ".", 3000);
    }
  }

  /* Który wzorzec był widoczny, gdy odpowiadał. Bez tego nie da się później
   * ocenić jego odpowiedzi: "Die Presse ist ausgefallen" jest w porządku wobec
   * rejestru `simple` i niepełne wobec `professional`. */
  function shownRegister() {
    var active = document.querySelector("[data-level].active");
    return active ? active.dataset.level : "natural";
  }

  function reveal() {
    var l = lesson();
    S.recordWrite(l.id, $("user-answer").value, shownRegister(), l.contentVersion);
    $("feedback").hidden = false;
    setTimeout(function () {
      $("feedback").scrollIntoView({ behavior: "smooth" });
    }, 40);
  }

  // -------------------------------------------------------------------- zdarzenia

  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-review-id]");
    if (t) {
      goTo(indexOfId(t.dataset.reviewId));
      return;
    }

    t = e.target.closest("[data-grade]");
    if (t) {
      gradeCurrent(t.dataset.grade);
      return;
    }

    t = e.target.closest("[data-lesson-id]");
    if (t) {
      goTo(indexOfId(t.dataset.lessonId));
      return;
    }

    t = e.target.closest("[data-mode]");
    if (t) {
      document.querySelectorAll("[data-mode]").forEach(function (b) {
        b.classList.toggle("active", b === t);
      });
      $("write-panel").classList.toggle("active", t.dataset.mode === "write");
      $("choose-panel").classList.toggle("active", t.dataset.mode === "choose");
      return;
    }

    t = e.target.closest("[data-level]");
    if (t) {
      document.querySelectorAll("[data-level]").forEach(function (b) {
        b.classList.toggle("active", b === t);
      });
      $("model-answer").textContent = lesson().answers[t.dataset.level];
      return;
    }

    t = e.target.closest(".choice");
    if (t && !t.parentElement.dataset.done) {
      var picked = Number(t.dataset.choice);
      var correct = lesson().correct;
      /* Wybór z listy zapisujemy jako pełnoprawną próbę. Jest rozstrzygalny bez
       * żadnego modelu, więc to najtańsze dostępne źródło danych o słabościach —
       * wcześniej wyrzucaliśmy je do kosza. */
      S.recordChoice(lesson().id, picked, correct, lesson().contentVersion);
      t.parentElement.dataset.done = 1;
      t.classList.add(picked === correct ? "correct" : "wrong");
      t.parentElement.children[correct].classList.add("correct");
      $("feedback").hidden = false;
      toast(picked === correct ? "Dobra odpowiedź!" : "Poprawna wersja jest zaznaczona.");
      return;
    }

    t = e.target.closest(".chip button");
    if (t) {
      toggleLessonWord(t.dataset.vocabId);
      return;
    }

    t = e.target.closest("[data-view]");
    if (t) {
      view(t.dataset.view);
      return;
    }

    t = e.target.closest("[data-view-link]");
    if (t) {
      view(t.dataset.viewLink);
      return;
    }

    var row = e.target.closest(".vocab-row");
    if (row && e.target.closest(".learn")) {
      var entry = S.vocabList().filter(function (v) {
        return v.id === row.dataset.id;
      })[0];
      if (entry) S.setLearned(entry.id, !entry.learned);
      notebook();
      return;
    }
    if (row && e.target.closest(".delete")) {
      S.removeVocab(row.dataset.id);
      notebook();
      chips();
      progress();
      toast("Usunięto z notatnika");
    }
  });

  $("check-written").onclick = reveal;
  $("user-answer").onkeydown = function (e) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) reveal();
  };
  $("try-again").onclick = function () {
    $("feedback").hidden = true;
    $("user-answer").focus();
  };
  $("complete").onclick = function () {
    S.markCompleted(lesson().id);
    var entry = S.reviewOf(lesson().id);
    render();
    toast(
      entry
        ? "Ukończone — dobra robota! Powtórka " + whenLabel(entry.due) + "."
        : "Scenariusz ukończony — dobra robota!",
      3000
    );
  };
  $("prev").onclick = function () {
    goTo(currentIndex - 1);
  };
  $("next").onclick = function () {
    goTo(currentIndex + 1);
  };
  $("quick-notebook").onclick = function () {
    view("notebook");
  };
  $("copy-answer").onclick = function () {
    var text = $("model-answer").textContent;
    if (!navigator.clipboard) {
      toast("Zaznacz tekst i skopiuj ręcznie");
      return;
    }
    navigator.clipboard.writeText(text).then(
      function () {
        toast("Odpowiedź skopiowana");
      },
      function () {
        toast("Zaznacz tekst i skopiuj ręcznie");
      }
    );
  };
  $("search").oninput = notebook;
  $("filter").onchange = notebook;

  // ------------------------------------------------------------ własne zwroty

  $("add-word").onclick = function () {
    $("word-dialog").showModal();
  };
  $("close-dialog").onclick = $("cancel-dialog").onclick = function () {
    $("word-dialog").close();
  };
  $("word-form").onsubmit = function (e) {
    e.preventDefault();
    var de = $("custom-de").value.trim();
    var pl = $("custom-pl").value.trim();
    if (!de || !pl) {
      e.target.reportValidity();
      return;
    }
    var id = S.customId(de, pl);
    if (S.hasVocab(id)) {
      toast("Ten zwrot jest już w notatniku");
    } else {
      S.addVocab(id, de, pl, $("custom-example").value.trim(), true);
      toast("Dodano do notatnika");
    }
    e.target.reset();
    $("word-dialog").close();
    notebook();
    progress();
  };

  // -------------------------------------------------------------- eksport/import

  /* Kopia postępu jako plik. To najprostsza wersja „przeniesienia postępu na
   * inne urządzenie”: bez konta, bez backendu, bez sieci. Import SCALA przez
   * WD.state.merge, więc wgranie starszego pliku nie skasuje nowszego postępu. */
  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  $("export-progress").onclick = function () {
    download(S.exportBlob(), S.exportFilename());
    toast("Zapisano kopię postępu");
  };

  /* Paczka do analizy błędów: kroczące okno 7 dni.
   *
   * Celowo osobno od kopii postępu — to inne dane dla innego odbiorcy.
   * Ten plik można podać skryptowi etykietującemu JUŻ TERAZ, bez backendu,
   * i sprawdzić na prawdziwych danych, czy pomysł działa, zanim powstanie
   * jakakolwiek infrastruktura. */
  var ANALYSIS_WINDOW_DAYS = 7;

  $("export-attempts").onclick = function () {
    var pack = S.exportAttempts(ANALYSIS_WINDOW_DAYS, lessonById);
    if (!pack.sourceAttemptCount) {
      toast("Brak prób z ostatnich " + ANALYSIS_WINDOW_DAYS + " dni — nie ma czego analizować.", 4000);
      return;
    }
    download(
      S.exportAttemptsBlob(ANALYSIS_WINDOW_DAYS, lessonById),
      S.exportAttemptsFilename(ANALYSIS_WINDOW_DAYS)
    );
    toast("Zapisano " + pack.sourceAttemptCount + " " + plural(pack.sourceAttemptCount, "próbę", "próby", "prób"));
  };

  $("import-progress").onclick = function () {
    $("import-file").click();
  };

  $("import-file").onchange = function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var result = S.importJSON(String(reader.result));
      if (!result.ok) {
        toast(result.error, 5000);
      } else {
        currentIndex = Math.max(0, indexOfId(S.get().current));
        render();
        notebook();
        toast(
          result.added > 0
            ? "Postęp scalony: +" + result.added + " ukończonych scenariuszy"
            : "Postęp scalony — nic nowego do dodania"
        );
      }
      e.target.value = ""; // pozwala wgrać ten sam plik ponownie
    };
    reader.onerror = function () {
      toast("Nie udało się odczytać pliku", 4000);
      e.target.value = "";
    };
    reader.readAsText(file);
  };

  $("reset").onclick = function () {
    if (!confirm("Czy na pewno usunąć cały postęp i zapisane słówka?")) return;
    S.reset();
    currentIndex = 0;
    render();
    notebook();
    toast("Dane zostały wyczyszczone");
  };

  // ----------------------------------------------------------------------- start

  render();
  notebook();

  var warning = S.takeWarning();
  if (warning) toast(warning, 10000);
})();
