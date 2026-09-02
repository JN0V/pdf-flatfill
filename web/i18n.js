// Chaînes de l'interface. La langue vient du navigateur, se change dans
// l'interface, et survit dans localStorage. Les .toml, eux, restent neutres :
// seule l'interface est traduite, jamais le format.

export const LANGS = {
  fr: 'Français',
  en: 'English',
  de: 'Deutsch',
  es: 'Español',
  it: 'Italiano',
};

const STORAGE_KEY = 'pdf-flatfill-lang';

export const translations = {
  fr: {
    badge: '100 % local — aucune donnée envoyée',
    title: 'Remplissez un PDF non interactif',
    sub: 'Posez du texte, des coches et des images sur la page, au millimètre. Le formulaire ne quitte jamais votre navigateur.',
    dropTitle: 'Déposez votre PDF ici',
    dropSub: 'ou déposez ensemble le PDF et sa description .toml pour reprendre',
    choose: 'Choisir un fichier',
    step1: 'Ouvrez le formulaire',
    step2: 'Cliquez pour placer vos réponses',
    step3: 'Téléchargez le PDF rempli',
    footerHint: 'Vos réponses sont enregistrées dans un fichier .toml lisible, à garder à côté du PDF.',
    source: 'Code source',
    toolText: 'Texte', toolCheck: 'Coche', toolImage: 'Image',
    exportToml: 'Exporter .toml', generate: 'Générer le PDF',
    entries: 'Entrées', checkEntry: 'Case cochée',
    missingImage: 'image manquante — cliquer pour joindre',
    styleTitle: 'Style par défaut', ink: 'Encre', font: 'Police', size: 'Taille',
    inkBlue: 'Bleu encre', inkBlack: 'Noir',
    newText: 'Nouveau texte', editText: 'Modifier le texte',
    editCheck: 'Modifier la coche', editImage: 'Modifier l’image',
    textPh: 'Texte à poser', notePh: 'Note — ex. « Prénom »', markCustomPh: 'Marque personnalisée',
    fontDefault: 'Police par défaut',
    markX: 'Croix (X)', markCheck: 'Coche ✓', markCross: 'Croix ✗', markBullet: 'Point ●', markCustom: 'Personnalisée…',
    place: 'Placer', save: 'Enregistrer', cancel: 'Annuler', delete: 'Supprimer',
    page: 'Page', prevPage: 'Page précédente', nextPage: 'Page suivante',
    zoomIn: 'Zoom avant', zoomOut: 'Zoom arrière',
    doneTitle: 'Votre PDF est prêt',
    donePdfSub: 'Le formulaire, rempli',
    doneTomlSub: 'Vos réponses, pour reprendre plus tard',
    doneHint: 'Gardez le fichier .toml dans le même dossier que le PDF d’origine : rouvrez les deux ensemble et tout sera déjà en place.',
    doneBack: 'Revenir à l’édition',
    text1: 'texte', textN: 'textes', check1: 'coche', checkN: 'coches',
    image1: 'image', imageN: 'images', page1: 'page', pageN: 'pages', across: 'sur',
    needPdf: 'Il manque le PDF : déposez aussi le formulaire lui-même.',
    badToml: 'Description illisible : {msg}',
    missingList: 'Image(s) manquante(s) : {list}.',
    missingHelp: 'Cliquez sur ces entrées dans le panneau pour joindre les fichiers.',
    empty: 'Rien à poser : placez au moins un texte, une coche ou une image.',
    pageRange: 'Une entrée vise la page {page}, mais le PDF n’en a que {count}.',
  },
  en: {
    badge: '100% local — nothing is uploaded',
    title: 'Fill in a non-interactive PDF',
    sub: 'Lay text, check marks and images onto the page, to the millimetre. The form never leaves your browser.',
    dropTitle: 'Drop your PDF here',
    dropSub: 'or drop the PDF together with its .toml description to resume',
    choose: 'Choose a file',
    step1: 'Open the form',
    step2: 'Click to place your answers',
    step3: 'Download the filled PDF',
    footerHint: 'Your answers are saved in a readable .toml file, to keep next to the PDF.',
    source: 'Source code',
    toolText: 'Text', toolCheck: 'Check', toolImage: 'Image',
    exportToml: 'Export .toml', generate: 'Generate the PDF',
    entries: 'Entries', checkEntry: 'Check mark',
    missingImage: 'missing image — click to attach',
    styleTitle: 'Default style', ink: 'Ink', font: 'Font', size: 'Size',
    inkBlue: 'Ink blue', inkBlack: 'Black',
    newText: 'New text', editText: 'Edit text',
    editCheck: 'Edit check mark', editImage: 'Edit image',
    textPh: 'Text to place', notePh: 'Note — e.g. “First name”', markCustomPh: 'Custom mark',
    fontDefault: 'Default font',
    markX: 'Cross (X)', markCheck: 'Check ✓', markCross: 'Cross ✗', markBullet: 'Dot ●', markCustom: 'Custom…',
    place: 'Place', save: 'Save', cancel: 'Cancel', delete: 'Delete',
    page: 'Page', prevPage: 'Previous page', nextPage: 'Next page',
    zoomIn: 'Zoom in', zoomOut: 'Zoom out',
    doneTitle: 'Your PDF is ready',
    donePdfSub: 'The form, filled in',
    doneTomlSub: 'Your answers, to resume later',
    doneHint: 'Keep the .toml file in the same folder as the original PDF: open both together and everything falls back into place.',
    doneBack: 'Back to editing',
    text1: 'text', textN: 'texts', check1: 'check', checkN: 'checks',
    image1: 'image', imageN: 'images', page1: 'page', pageN: 'pages', across: 'across',
    needPdf: 'The PDF is missing: drop the form itself as well.',
    badToml: 'Unreadable description: {msg}',
    missingList: 'Missing image(s): {list}.',
    missingHelp: 'Click those entries in the panel to attach the files.',
    empty: 'Nothing to place yet: add at least one text, check mark or image.',
    pageRange: 'An entry targets page {page}, but the PDF only has {count}.',
  },
  de: {
    badge: '100 % lokal — nichts wird hochgeladen',
    title: 'Ein nicht interaktives PDF ausfüllen',
    sub: 'Text, Häkchen und Bilder millimetergenau auf der Seite platzieren. Das Formular verlässt nie Ihren Browser.',
    dropTitle: 'PDF hier ablegen',
    dropSub: 'oder PDF zusammen mit seiner .toml-Beschreibung ablegen, um fortzufahren',
    choose: 'Datei wählen',
    step1: 'Formular öffnen',
    step2: 'Klicken, um Antworten zu platzieren',
    step3: 'Ausgefülltes PDF herunterladen',
    footerHint: 'Ihre Antworten werden in einer lesbaren .toml-Datei gespeichert, die neben dem PDF bleibt.',
    source: 'Quellcode',
    toolText: 'Text', toolCheck: 'Häkchen', toolImage: 'Bild',
    exportToml: '.toml exportieren', generate: 'PDF erzeugen',
    entries: 'Einträge', checkEntry: 'Häkchen',
    missingImage: 'Bild fehlt — zum Anhängen klicken',
    styleTitle: 'Standardstil', ink: 'Tinte', font: 'Schrift', size: 'Größe',
    inkBlue: 'Tintenblau', inkBlack: 'Schwarz',
    newText: 'Neuer Text', editText: 'Text bearbeiten',
    editCheck: 'Häkchen bearbeiten', editImage: 'Bild bearbeiten',
    textPh: 'Zu platzierender Text', notePh: 'Notiz — z. B. „Vorname“', markCustomPh: 'Eigenes Zeichen',
    fontDefault: 'Standardschrift',
    markX: 'Kreuz (X)', markCheck: 'Haken ✓', markCross: 'Kreuz ✗', markBullet: 'Punkt ●', markCustom: 'Eigenes…',
    place: 'Platzieren', save: 'Speichern', cancel: 'Abbrechen', delete: 'Löschen',
    page: 'Seite', prevPage: 'Vorherige Seite', nextPage: 'Nächste Seite',
    zoomIn: 'Vergrößern', zoomOut: 'Verkleinern',
    doneTitle: 'Ihr PDF ist fertig',
    donePdfSub: 'Das ausgefüllte Formular',
    doneTomlSub: 'Ihre Antworten, zum späteren Fortsetzen',
    doneHint: 'Bewahren Sie die .toml-Datei im selben Ordner wie das Original-PDF auf: beide zusammen öffnen, und alles ist wieder da.',
    doneBack: 'Zurück zur Bearbeitung',
    text1: 'Text', textN: 'Texte', check1: 'Häkchen', checkN: 'Häkchen',
    image1: 'Bild', imageN: 'Bilder', page1: 'Seite', pageN: 'Seiten', across: 'auf',
    needPdf: 'Das PDF fehlt: Legen Sie auch das Formular selbst ab.',
    badToml: 'Beschreibung unlesbar: {msg}',
    missingList: 'Fehlende Bilder: {list}.',
    missingHelp: 'Klicken Sie diese Einträge im Panel an, um die Dateien anzuhängen.',
    empty: 'Nichts zu platzieren: Fügen Sie mindestens einen Text, ein Häkchen oder ein Bild hinzu.',
    pageRange: 'Ein Eintrag zielt auf Seite {page}, das PDF hat aber nur {count}.',
  },
  es: {
    badge: '100 % local — no se envía nada',
    title: 'Rellena un PDF no interactivo',
    sub: 'Coloca texto, marcas e imágenes sobre la página, al milímetro. El formulario nunca sale de tu navegador.',
    dropTitle: 'Suelta tu PDF aquí',
    dropSub: 'o suelta el PDF junto con su descripción .toml para continuar',
    choose: 'Elegir un archivo',
    step1: 'Abre el formulario',
    step2: 'Haz clic para colocar tus respuestas',
    step3: 'Descarga el PDF relleno',
    footerHint: 'Tus respuestas se guardan en un archivo .toml legible, para conservar junto al PDF.',
    source: 'Código fuente',
    toolText: 'Texto', toolCheck: 'Marca', toolImage: 'Imagen',
    exportToml: 'Exportar .toml', generate: 'Generar el PDF',
    entries: 'Entradas', checkEntry: 'Casilla marcada',
    missingImage: 'imagen ausente — haz clic para adjuntar',
    styleTitle: 'Estilo por defecto', ink: 'Tinta', font: 'Fuente', size: 'Tamaño',
    inkBlue: 'Azul tinta', inkBlack: 'Negro',
    newText: 'Nuevo texto', editText: 'Editar texto',
    editCheck: 'Editar marca', editImage: 'Editar imagen',
    textPh: 'Texto a colocar', notePh: 'Nota — p. ej. «Nombre»', markCustomPh: 'Marca personalizada',
    fontDefault: 'Fuente por defecto',
    markX: 'Cruz (X)', markCheck: 'Marca ✓', markCross: 'Cruz ✗', markBullet: 'Punto ●', markCustom: 'Personalizada…',
    place: 'Colocar', save: 'Guardar', cancel: 'Cancelar', delete: 'Eliminar',
    page: 'Página', prevPage: 'Página anterior', nextPage: 'Página siguiente',
    zoomIn: 'Acercar', zoomOut: 'Alejar',
    doneTitle: 'Tu PDF está listo',
    donePdfSub: 'El formulario, relleno',
    doneTomlSub: 'Tus respuestas, para continuar más tarde',
    doneHint: 'Guarda el archivo .toml en la misma carpeta que el PDF original: ábrelos juntos y todo volverá a su sitio.',
    doneBack: 'Volver a la edición',
    text1: 'texto', textN: 'textos', check1: 'marca', checkN: 'marcas',
    image1: 'imagen', imageN: 'imágenes', page1: 'página', pageN: 'páginas', across: 'en',
    needPdf: 'Falta el PDF: suelta también el propio formulario.',
    badToml: 'Descripción ilegible: {msg}',
    missingList: 'Imágenes ausentes: {list}.',
    missingHelp: 'Haz clic en esas entradas del panel para adjuntar los archivos.',
    empty: 'Nada que colocar: añade al menos un texto, una marca o una imagen.',
    pageRange: 'Una entrada apunta a la página {page}, pero el PDF solo tiene {count}.',
  },
  it: {
    badge: '100 % locale — nulla viene inviato',
    title: 'Compila un PDF non interattivo',
    sub: 'Posiziona testo, spunte e immagini sulla pagina, al millimetro. Il modulo non lascia mai il tuo browser.',
    dropTitle: 'Trascina qui il tuo PDF',
    dropSub: 'oppure trascina il PDF insieme alla sua descrizione .toml per riprendere',
    choose: 'Scegli un file',
    step1: 'Apri il modulo',
    step2: 'Fai clic per posizionare le risposte',
    step3: 'Scarica il PDF compilato',
    footerHint: 'Le tue risposte sono salvate in un file .toml leggibile, da tenere accanto al PDF.',
    source: 'Codice sorgente',
    toolText: 'Testo', toolCheck: 'Spunta', toolImage: 'Immagine',
    exportToml: 'Esporta .toml', generate: 'Genera il PDF',
    entries: 'Voci', checkEntry: 'Casella spuntata',
    missingImage: 'immagine mancante — fai clic per allegare',
    styleTitle: 'Stile predefinito', ink: 'Inchiostro', font: 'Carattere', size: 'Dimensione',
    inkBlue: 'Blu inchiostro', inkBlack: 'Nero',
    newText: 'Nuovo testo', editText: 'Modifica testo',
    editCheck: 'Modifica spunta', editImage: 'Modifica immagine',
    textPh: 'Testo da posizionare', notePh: 'Nota — es. «Nome»', markCustomPh: 'Segno personalizzato',
    fontDefault: 'Carattere predefinito',
    markX: 'Croce (X)', markCheck: 'Spunta ✓', markCross: 'Croce ✗', markBullet: 'Punto ●', markCustom: 'Personalizzato…',
    place: 'Posiziona', save: 'Salva', cancel: 'Annulla', delete: 'Elimina',
    page: 'Pagina', prevPage: 'Pagina precedente', nextPage: 'Pagina successiva',
    zoomIn: 'Ingrandisci', zoomOut: 'Riduci',
    doneTitle: 'Il tuo PDF è pronto',
    donePdfSub: 'Il modulo, compilato',
    doneTomlSub: 'Le tue risposte, per riprendere più tardi',
    doneHint: 'Tieni il file .toml nella stessa cartella del PDF originale: aprili insieme e tutto tornerà al suo posto.',
    doneBack: 'Torna alla modifica',
    text1: 'testo', textN: 'testi', check1: 'spunta', checkN: 'spunte',
    image1: 'immagine', imageN: 'immagini', page1: 'pagina', pageN: 'pagine', across: 'su',
    needPdf: 'Manca il PDF: trascina anche il modulo stesso.',
    badToml: 'Descrizione illeggibile: {msg}',
    missingList: 'Immagini mancanti: {list}.',
    missingHelp: 'Fai clic su quelle voci nel pannello per allegare i file.',
    empty: 'Niente da posizionare: aggiungi almeno un testo, una spunta o un’immagine.',
    pageRange: 'Una voce punta alla pagina {page}, ma il PDF ne ha solo {count}.',
  },
};

export let lang = (() => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && translations[saved]) return saved;
  } catch { /* stockage indisponible : détection seule */ }
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return translations[nav] ? nav : 'en';
})();

export function t(key, vars) {
  let str = translations[lang][key] ?? translations.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) str = str.replace(`{${k}}`, v);
  return str;
}

// n unités, avec le bon pluriel : « 2 textes », "1 check", « 3 Bilder ».
export function tn(n, unit) {
  return `${n} ${t(n > 1 ? `${unit}N` : `${unit}1`)}`;
}

export function setLang(next) {
  if (!translations[next]) return;
  lang = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* tant pis */ }
  applyStatic();
}

// Traduit tout le HTML statique : texte, placeholders, aria-labels.
export function applyStatic() {
  document.documentElement.lang = lang;
  document.title = `pdf-flatfill — ${t('title')}`;
  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of document.querySelectorAll('[data-i18n-ph]')) {
    el.placeholder = t(el.dataset.i18nPh);
  }
  for (const el of document.querySelectorAll('[data-i18n-aria]')) {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  }
  for (const select of document.querySelectorAll('.lang-select')) {
    select.value = lang;
  }
}
