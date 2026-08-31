"use strict";
/* Guided tour shown once, on the first visit.

   Kept in its own file and driven entirely by a declarative step list, so adding or
   reordering steps never means touching positioning code. Two constraints shaped it:

   - the layout has two shapes (table above 900 px, cards below), so a step targets a
     list of selectors and takes the first one actually on screen rather than assuming
     one markup;
   - sections are <details> whose open state is remembered, so a step may need to open
     one before it can point at anything inside it. That is what `before` is for.

   A step whose target cannot be found is skipped rather than shown against nothing:
   the account filter, for instance, does not exist when there is only one account. */

const TOUR_KEY = "tr.tour.v1"; // bump the suffix to re-show the tour after a redesign

const STEPS = [
  {
    centred: true,
    title: "Bienvenue dans TR Tracker",
    text: "Ce tableau de bord suit votre portefeuille Trade Republic en direct. Un tour rapide en six étapes ? Vous pourrez le relancer plus tard depuis le bas de la page.",
    okLabel: "Faire le tour",
    skipLabel: "Non merci",
  },
  {
    sel: ["#heroCard"],
    title: "La synthèse",
    text: "La valeur de vos positions et sa variation du jour, puis vos espèces, vos versements nets, vos plus-values latentes et réalisées, vos dividendes et vos frais.",
  },
  {
    sel: ["#ranges"],
    title: "Les périodes",
    text: "Le graphique se règle sur 1 jour à 3 ans, « Tout », ou une plage de dates personnalisée. Une période que votre historique ne couvre pas n'est pas proposée.",
  },
  {
    sel: ["#acctFilter"],
    title: "Filtrer par compte",
    text: "Vos comptes PEA, CTO et Cryptos se combinent ou s'isolent d'un clic. Le graphique et les totaux suivent la sélection.",
  },
  {
    sel: [".section-fold > summary"],
    title: "Vos comptes",
    text: "Une section par compte, plus les Archives qui regroupent les positions entièrement revendues. Chaque section se replie pour dégager la vue.",
    before: openFirstSection,
  },
  {
    sel: [".pos-row", ".pcard-name"],
    title: "Le détail d'un titre",
    text: "Cliquez sur une ligne pour déplier sa performance propre sur dix périodes, de 1 jour à toute son histoire cotée, avec son graphique.",
    before: openFirstSection,
  },
  {
    sel: ["#bellBtn"],
    title: "Les alertes de prix",
    text: "Définissez jusqu'à six seuils par rapport à votre prix de revient, à votre dernier achat ou à votre dernière vente. Un récapitulatif s'affiche à l'ouverture, et vous pouvez recevoir une notification même application fermée.",
  },
  {
    centred: true,
    title: "C'est tout",
    text: "Vos données restent lues en direct depuis votre Google Sheet, rien n'est stocké ici. Pour revoir ce tour, le lien « Revoir la présentation » est en bas de page.",
    okLabel: "Commencer",
    last: true,
  },
];

function openFirstSection() {
  const fold = document.querySelector(".section-fold");
  if (fold && !fold.open) fold.open = true;
}

const visible = (n) => !!n && n.getBoundingClientRect().height > 0 && getComputedStyle(n).visibility !== "hidden";

function resolve(step) {
  if (step.centred) return null;
  for (const s of step.sel || []) {
    for (const n of document.querySelectorAll(s)) if (visible(n)) return n;
  }
  return undefined; // distinct from null: null means "no target wanted"
}

let ui = null, idx = 0, order = [];

function buildUI() {
  const root = document.createElement("div");
  root.className = "tour-root";
  root.innerHTML = `
    <div class="tour-hole" hidden></div>
    <div class="tour-pop" role="dialog" aria-modal="true" aria-labelledby="tourTitle">
      <div class="tour-step"></div>
      <h2 id="tourTitle"></h2>
      <p class="tour-text"></p>
      <div class="tour-actions">
        <button type="button" class="tour-skip"></button>
        <span class="tour-spacer"></span>
        <button type="button" class="tour-prev" hidden>Précédent</button>
        <button type="button" class="tour-next"></button>
      </div>
    </div>`;
  document.body.append(root);
  ui = {
    root,
    hole: root.querySelector(".tour-hole"),
    pop: root.querySelector(".tour-pop"),
    step: root.querySelector(".tour-step"),
    title: root.querySelector("#tourTitle"),
    text: root.querySelector(".tour-text"),
    skip: root.querySelector(".tour-skip"),
    prev: root.querySelector(".tour-prev"),
    next: root.querySelector(".tour-next"),
  };
  ui.skip.addEventListener("click", finish);
  ui.prev.addEventListener("click", () => go(idx - 1));
  ui.next.addEventListener("click", () => (idx >= order.length - 1 ? finish() : go(idx + 1)));
  root.addEventListener("click", (e) => { if (e.target === root) finish(); });
  document.addEventListener("keydown", onKey);
  addEventListener("resize", reposition, { passive: true });
  addEventListener("scroll", reposition, { passive: true });
}

function onKey(e) {
  if (!ui) return;
  if (e.key === "Escape") { e.preventDefault(); finish(); }
  else if (e.key === "ArrowRight") { e.preventDefault(); idx >= order.length - 1 ? finish() : go(idx + 1); }
  else if (e.key === "ArrowLeft" && idx > 0) { e.preventDefault(); go(idx - 1); }
}

let current = null;

function place(target) {
  const pop = ui.pop;
  pop.style.maxWidth = Math.min(360, innerWidth - 24) + "px";
  const pw = pop.offsetWidth, ph = pop.offsetHeight, M = 12;

  if (!target) { // welcome / closing panels sit in the middle, over a plain dim
    ui.hole.hidden = true;
    ui.root.classList.add("centred");
    pop.style.left = Math.round((innerWidth - pw) / 2) + "px";
    pop.style.top = Math.round((innerHeight - ph) / 2) + "px";
    return;
  }
  const r = target.getBoundingClientRect();
  ui.hole.hidden = false;
  ui.root.classList.remove("centred");
  ui.hole.style.left = (r.left - 6) + "px";
  ui.hole.style.top = (r.top - 6) + "px";
  ui.hole.style.width = (r.width + 12) + "px";
  ui.hole.style.height = (r.height + 12) + "px";

  // below the target when it fits, above otherwise, and clamped to the viewport so the
  // bubble is never half off-screen next to an element sitting near an edge
  let top = r.bottom + M;
  if (top + ph > innerHeight - M) top = r.top - ph - M;
  if (top < M) top = Math.min(innerHeight - ph - M, Math.max(M, r.bottom + M));
  let left = r.left + r.width / 2 - pw / 2;
  left = Math.max(M, Math.min(left, innerWidth - pw - M));
  pop.style.left = Math.round(left) + "px";
  pop.style.top = Math.round(Math.max(M, top)) + "px";
}

function reposition() { if (ui && current !== undefined) place(current); }

async function go(i) {
  idx = i;
  const step = order[i];
  if (step.before) { try { step.before(); } catch { /* a step must never break the page */ } }

  let target = resolve(step);
  if (target === undefined) { // vanished since the order was computed
    return i >= order.length - 1 ? finish() : go(i + 1);
  }
  if (target) {
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    await new Promise((r) => setTimeout(r, 320)); // let the smooth scroll settle
  }
  current = target;

  ui.step.textContent = step.centred && i === 0 ? "" : `Étape ${i + 1} sur ${order.length}`;
  ui.title.textContent = step.title;
  ui.text.textContent = step.text;
  ui.skip.textContent = step.skipLabel || "Passer";
  ui.skip.hidden = !!step.last;
  ui.prev.hidden = i === 0;
  ui.next.textContent = step.okLabel || "Suivant";
  ui.root.classList.add("on");
  place(target);
  ui.next.focus({ preventScroll: true });
}

function finish() {
  try { localStorage.setItem(TOUR_KEY, "1"); } catch { /* private mode: just don't persist */ }
  document.removeEventListener("keydown", onKey);
  removeEventListener("resize", reposition);
  removeEventListener("scroll", reposition);
  ui?.root.remove();
  ui = null;
  current = null;
}

function start() {
  if (ui) return;
  // steps are filtered once at the start so "Étape 3 sur 6" counts what will be shown
  order = STEPS.filter((s) => {
    if (s.before) { try { s.before(); } catch { /* ignore */ } }
    return resolve(s) !== undefined;
  });
  if (!order.length) return;
  buildUI();
  go(0);
}

function startIfFirstVisit() {
  let seen = "1";
  try { seen = localStorage.getItem(TOUR_KEY); } catch { /* private mode: skip the tour */ }
  if (seen) return;
  start();
}

window.tour = { start, startIfFirstVisit };
