/* Treść lekcji.
 *
 * To jedyny plik, który edytujesz, dodając nowe scenariusze.
 * Kod aplikacji (app.js) i warstwa zapisu (state.js) są od niego niezależne.
 *
 * ZASADY:
 *  - `id` lekcji nigdy nie zmieniaj po opublikowaniu — postęp jest zapisany
 *    pod tym identyfikatorem. Zmiana id = utrata postępu w tej lekcji.
 *  - `id` słówka też jest trwałe i GLOBALNE. Jeśli to samo słowo pojawia się
 *    w dwóch lekcjach, użyj tego samego id — wtedy notatnik ma jeden wpis.
 *  - Kolejność w tablicy można zmieniać dowolnie. Postęp jej nie używa.
 *  - `correct` to indeks poprawnej odpowiedzi w `choices` (liczony od 0).
 *  - `targetWeaknesses` to kategorie z taxonomy.js — wyłącznie stamtąd.
 *    Nieznana kategoria zatrzyma uruchomienie aplikacji.
 *
 * POLA UZUPEŁNIANE AUTOMATYCZNIE (nie musisz ich pisać):
 *  - `kind: "scenario"`   — rodzaj ćwiczenia. Lekcje typu "sentences"
 *                           (pary polski→niemiecki) to inny rodzaj ćwiczenia
 *                           i mogą istnieć obok scenariuszy.
 *  - `origin: "static"`   — ręcznie napisane. Lekcje z generatora będą miały
 *                           "generated" i muszą podać targetWeaknesses.
 *  - `status: "published"` — lekcje z generatora startują jako "draft",
 *                           dopóki ich nie przejrzysz.
 *  - `contentVersion: 1`  — PODNIEŚ RĘCZNIE, gdy zmienisz treść lekcji tak, że
 *                           dawne odpowiedzi przestają być z nią porównywalne.
 *                           Zapisane próby pamiętają wersję, którą widział;
 *                           bez tego analiza porównywałaby jego odpowiedź
 *                           z wzorcem, którego nigdy nie zobaczył.
 */
window.LESSONS = [
  {
    id: "awaria-prasy-hydraulicznej",
    icon: "⚙",
    category: "Awaria maszyny",
    short: "Zgłoszenie awarii",
    title: "Zgłaszasz awarię prasy hydraulicznej",
    situation:
      "Prasa hydrauliczna na linii 2 zatrzymała się. Widzisz wyciek oleju przy siłowniku i musisz natychmiast poinformować brygadzistę.",
    answers: {
      simple:
        "Die Hydraulikpresse an Linie 2 ist kaputt. Am Zylinder tritt Öl aus. Die Maschine steht.",
      natural:
        "Die Hydraulikpresse an Linie 2 ist ausgefallen. Am Zylinder tritt Öl aus, deshalb habe ich die Maschine sofort gestoppt.",
      professional:
        "Die Hydraulikpresse an Linie 2 ist aufgrund einer Leckage am Zylinder ausgefallen. Ich habe die Anlage vorsorglich stillgesetzt und den Bereich abgesichert.",
    },
    grammar: {
      title: "Perfekt z czasownikiem „sein”",
      text: "Przy zmianie stanu używamy „ist ausgefallen”. „Deshalb” zajmuje pierwsze miejsce, więc czasownik „habe” stoi zaraz po nim.",
    },
    phrase: {
      title: "eine Maschine stillsetzen",
      text: "To profesjonalne określenie „wyłączyć maszynę z eksploatacji”. W rozmowie codziennej możesz użyć prostszego „stoppen”.",
    },
    targetWeaknesses: ["perfekt_auxiliary", "word_order_main", "technical_term"],
    vocab: [
      { id: "ausfallen", de: "ausfallen", pl: "ulec awarii" },
      { id: "die-leckage", de: "die Leckage", pl: "nieszczelność" },
      { id: "oel-tritt-aus", de: "Öl tritt aus", pl: "olej wycieka" },
      { id: "stillsetzen", de: "stillsetzen", pl: "wyłączyć z eksploatacji" },
    ],
    choices: [
      "Die Presse ist ausgefallen. Am Zylinder tritt Öl aus, deshalb habe ich sie gestoppt.",
      "Die Presse fällt morgen aus und der Zylinder hat Öl.",
      "Ich mache Presse Linie 2, weil Öl ist draußen.",
    ],
    correct: 0,
  },
  {
    id: "wyjasnienie-naprawy-czujnika",
    icon: "⌁",
    category: "Rozmowa z przełożonym",
    short: "Wyjaśnienie naprawy",
    title: "Wyjaśniasz naprawę kierownikowi zmiany",
    situation:
      "Wymieniłeś uszkodzony czujnik zbliżeniowy przy transporterze. Po regulacji i próbie transporter znów działa prawidłowo.",
    answers: {
      simple:
        "Ich habe den kaputten Sensor gewechselt. Danach habe ich ihn eingestellt. Das Förderband funktioniert wieder.",
      natural:
        "Ich habe den defekten Näherungssensor ausgetauscht und anschließend neu eingestellt. Nach einem Probelauf funktioniert das Förderband wieder einwandfrei.",
      professional:
        "Der defekte Näherungssensor wurde ersetzt und fachgerecht justiert. Der anschließende Probelauf verlief ohne Beanstandungen; die Anlage ist wieder betriebsbereit.",
    },
    grammar: {
      title: "Perfekt: haben + Partizip II",
      text: "W rozmowie o wykonanej pracy używamy najczęściej Perfekt: „ich habe … ausgetauscht”. W zdaniu głównym imiesłów stoi na końcu.",
    },
    phrase: {
      title: "einwandfrei funktionieren",
      text: "Znaczy „działać bez zarzutu”. W raporcie technicznym spotkasz też „wieder betriebsbereit sein”.",
    },
    targetWeaknesses: ["perfekt_auxiliary", "participle_form", "verb_final_position"],
    vocab: [
      { id: "austauschen", de: "austauschen", pl: "wymienić" },
      { id: "einstellen", de: "einstellen", pl: "wyregulować" },
      { id: "der-probelauf", de: "der Probelauf", pl: "próba ruchowa" },
      { id: "betriebsbereit", de: "betriebsbereit", pl: "gotowy do pracy" },
    ],
    choices: [
      "Ich habe Sensor neu und Band gut gemacht.",
      "Der Sensor hat sich ausgetauscht und das Band wird gut.",
      "Ich habe den defekten Sensor ausgetauscht. Nach dem Probelauf funktioniert das Band wieder einwandfrei.",
    ],
    correct: 2,
  },
  {
    id: "zamowienie-czesci-zamiennych",
    icon: "▦",
    category: "Magazyn techniczny",
    short: "Części zamienne",
    title: "Prosisz o części zamienne z magazynu",
    situation:
      "Do naprawy pompy potrzebujesz dwóch łożysk 6205-2RS i jednego uszczelnienia mechanicznego. Chcesz też potwierdzić ich dostępność.",
    answers: {
      simple:
        "Ich brauche zwei Lager 6205-2RS und eine Gleitringdichtung für die Pumpe. Sind die Teile auf Lager?",
      natural:
        "Für die Pumpenreparatur benötige ich zwei Lager vom Typ 6205-2RS und eine Gleitringdichtung. Könnten Sie bitte prüfen, ob die Teile auf Lager sind?",
      professional:
        "Für die Instandsetzung der Pumpe benötige ich zwei Rillenkugellager 6205-2RS sowie eine passende Gleitringdichtung. Bitte prüfen Sie die Verfügbarkeit und reservieren Sie die Teile für Auftrag 4712.",
    },
    grammar: {
      title: "Uprzejma prośba z „könnten”",
      text: "„Könnten Sie bitte …?” to uprzejmy tryb przypuszczający. Po czasowniku modalnym bezokolicznik „prüfen” wędruje na koniec.",
    },
    phrase: {
      title: "auf Lager sein",
      text: "Stałe połączenie znaczące „być na stanie”. Pytamy: „Ist das Teil auf Lager?” albo „Wie ist die Verfügbarkeit?”.",
    },
    targetWeaknesses: ["subjunctive_politeness", "modal_verb", "verb_final_position"],
    vocab: [
      { id: "das-ersatzteil", de: "das Ersatzteil", pl: "część zamienna" },
      { id: "das-lager", de: "das Lager", pl: "łożysko" },
      {
        id: "die-gleitringdichtung",
        de: "die Gleitringdichtung",
        pl: "uszczelnienie mechaniczne",
      },
      { id: "die-verfuegbarkeit", de: "die Verfügbarkeit", pl: "dostępność" },
    ],
    choices: [
      "Ich brauche zwei Lager und eine Dichtung. Können Sie bitte die Verfügbarkeit prüfen?",
      "Ich will Lager haben, gib zwei und Dichtung.",
      "Zwei Lager sind gebraucht von mir und Dichtung ist Pumpe.",
    ],
    correct: 0,
  },
  {
    id: "zgloszenie-zagrozenia-bhp",
    icon: "△",
    category: "Bezpieczeństwo",
    short: "Zagrożenie BHP",
    title: "Zgłaszasz zagrożenie bezpieczeństwa",
    situation:
      "Przy szafie sterowniczej leży uszkodzony przewód z odsłoniętą żyłą. Ostrzegasz kolegę i zgłaszasz konieczność odgrodzenia miejsca.",
    answers: {
      simple:
        "Vorsicht! Neben dem Schaltschrank liegt ein beschädigtes Kabel. Bitte nicht anfassen. Wir müssen den Bereich absperren.",
      natural:
        "Vorsicht, neben dem Schaltschrank liegt ein beschädigtes Kabel mit einer freiliegenden Ader. Bitte halten Sie Abstand; der Bereich muss sofort abgesperrt werden.",
      professional:
        "Im Bereich des Schaltschranks wurde eine beschädigte Leitung mit freiliegendem Leiter festgestellt. Es besteht Stromschlaggefahr. Der Gefahrenbereich ist unverzüglich abzusperren und die Leitung spannungsfrei zu schalten.",
    },
    grammar: {
      title: "Strona bierna z „werden”",
      text: "„Der Bereich muss abgesperrt werden” łączy czasownik modalny ze stroną bierną. Na końcu stoją razem „abgesperrt werden”.",
    },
    phrase: {
      title: "Es besteht …gefahr",
      text: "Formalny sposób zgłaszania ryzyka: „Es besteht Stromschlaggefahr” — istnieje ryzyko porażenia prądem.",
    },
    targetWeaknesses: ["passive_voice", "modal_verb", "adjective_ending"],
    vocab: [
      {
        id: "die-freiliegende-ader",
        de: "die freiliegende Ader",
        pl: "odsłonięta żyła",
      },
      { id: "absperren", de: "absperren", pl: "odgrodzić" },
      {
        id: "die-stromschlaggefahr",
        de: "die Stromschlaggefahr",
        pl: "ryzyko porażenia",
      },
      { id: "spannungsfrei", de: "spannungsfrei", pl: "bez napięcia" },
    ],
    choices: [
      "Da ist Kabel schlecht. Du gehst nicht.",
      "Vorsicht, das Kabel ist beschädigt. Wir müssen den Bereich sofort absperren.",
      "Der Kabel beschädigt bei Schrank und muss Abstand.",
    ],
    correct: 1,
  },
  {
    id: "diagnoza-pytania-do-operatora",
    icon: "?",
    category: "Diagnoza usterki",
    short: "Pytania do operatora",
    title: "Pytasz operatora, co się wydarzyło",
    situation:
      "Pakowarka zatrzymała się bez aktywnego alarmu. Pytasz operatora o moment zatrzymania, nietypowe dźwięki i wcześniejsze problemy.",
    answers: {
      simple:
        "Wann ist die Maschine stehen geblieben? Haben Sie vorher ein ungewöhnliches Geräusch gehört? Gab es schon früher Probleme?",
      natural:
        "Können Sie mir bitte genau sagen, wann die Maschine stehen geblieben ist? Haben Sie davor ungewöhnliche Geräusche bemerkt oder eine Fehlermeldung gesehen?",
      professional:
        "Könnten Sie den Ablauf kurz schildern? Mich interessiert, wann die Anlage zum Stillstand kam, ob zuvor Auffälligkeiten aufgetreten sind und welche Bedienhandlungen unmittelbar davor erfolgt sind.",
    },
    grammar: {
      title: "Pytanie zależne z „wann”",
      text: "Po „Können Sie mir sagen, …” szyk się zmienia: odmieniony czasownik idzie na koniec — „wann die Maschine stehen geblieben ist”.",
    },
    phrase: {
      title: "Ist Ihnen etwas aufgefallen?",
      text: "Naturalne pytanie diagnostyczne: „Czy coś zwróciło Pana/Pani uwagę?”. „auffallen” łączy się tu z celownikiem: Ihnen.",
    },
    targetWeaknesses: ["word_order_subordinate", "verb_final_position", "case_dativ"],
    vocab: [
      { id: "stehen-bleiben", de: "stehen bleiben", pl: "zatrzymać się" },
      { id: "auffallen", de: "auffallen", pl: "zwrócić uwagę" },
      { id: "das-geraeusch", de: "das Geräusch", pl: "dźwięk, odgłos" },
      { id: "die-fehlermeldung", de: "die Fehlermeldung", pl: "komunikat błędu" },
    ],
    choices: [
      "Wann ist die Maschine stehen geblieben? Ist Ihnen vorher etwas aufgefallen?",
      "Wann die Maschine ist stehen und was du hast gemacht?",
      "Warum kaputt? Du hörst etwas gestern?",
    ],
    correct: 0,
  },
  {
    id: "raport-serwisowy",
    icon: "✎",
    category: "Dokumentacja",
    short: "Raport serwisowy",
    title: "Piszesz krótki raport z interwencji",
    situation:
      "W raporcie zapisz: 08:20 — zatrzymanie przenośnika; przyczyna — luźny przewód czujnika; działanie — dokręcenie zacisku i test; 08:45 — powrót do pracy.",
    answers: {
      simple:
        "08:20 Uhr: Förderband gestoppt. Ursache: Sensorkabel war locker. Klemme festgezogen und Funktion getestet. Seit 08:45 Uhr läuft die Anlage wieder.",
      natural:
        "08:20 Uhr – Stillstand des Förderbands aufgrund eines losen Sensorkabels. Anschlussklemme nachgezogen und Funktionstest durchgeführt. Anlage seit 08:45 Uhr wieder in Betrieb.",
      professional:
        "Störungsbeginn: 08:20 Uhr. Ursache war eine gelöste Anschlussklemme am Sensorkabel. Klemme fachgerecht nachgezogen und abschließenden Funktionstest ohne Beanstandungen durchgeführt. Produktionsfreigabe um 08:45 Uhr erteilt.",
    },
    grammar: {
      title: "Styl raportowy bez podmiotu",
      text: "W krótkich raportach pomija się „ich habe”. Zostaje imiesłów: „Klemme nachgezogen, Funktionstest durchgeführt”. Tekst jest krótki i rzeczowy.",
    },
    phrase: {
      title: "wieder in Betrieb",
      text: "„Anlage wieder in Betrieb” oznacza „instalacja znów pracuje”. Formalnie można zapisać „Produktionsfreigabe erteilt”.",
    },
    targetWeaknesses: ["participle_form", "case_genitiv", "register_too_casual"],
    vocab: [
      { id: "der-stillstand", de: "der Stillstand", pl: "przestój" },
      { id: "die-ursache", de: "die Ursache", pl: "przyczyna" },
      { id: "nachziehen", de: "nachziehen", pl: "dokręcić" },
      {
        id: "ohne-beanstandungen",
        de: "ohne Beanstandungen",
        pl: "bez zastrzeżeń",
      },
    ],
    choices: [
      "08:20 Band kaputt. Ich Kabel. 08:45 gut.",
      "Förderband hat um 08:20 gestoppt weil Kabel lose sein.",
      "08:20 Uhr: Stillstand wegen eines losen Sensorkabels. Klemme nachgezogen, Funktion geprüft. Seit 08:45 Uhr wieder in Betrieb.",
    ],
    correct: 2,
  },
];
