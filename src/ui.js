// Screen wiring: reads the setup form, drives the match loop, draws the podium.
// Tournament and owner rules live in bracket.js / owners.js — this file only
// renders and listens.

import {
  createTournament,
  currentMatch,
  resolveMatch,
  entryById,
  getMatch,
  podium,
  remainingMatches,
  roundName,
} from './bracket.js';
import { buildEntries, bracketShape, parseEntryLines, peopleFor } from './setup.js';
import { championsFor, applyStandIn, randomStandIn, creditFor } from './owners.js';

const $ = (id) => document.getElementById(id);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const el = {
  body: document.body,
  form: $('setup-form'),
  category: $('category'),
  entries: $('entries'),
  preview: $('bracket-preview'),
  ownerNote: $('owner-note'),
  peopleField: $('people-field'),
  people: $('people'),
  championField: $('champion-field'),
  championNote: $('champion-note'),
  timerOn: $('timer-on'),
  timerSetup: $('timer-setup'),
  timerSeconds: $('timer-seconds'),
  setupError: $('setup-error'),
  demoFill: $('demo-fill'),

  arena: $('arena'),
  cards: [$('card-0'), $('card-1')],
  roundLabel: $('round-label'),
  categoryLabel: $('category-label'),
  progressLabel: $('progress-label'),
  quitBtn: $('quit-btn'),
  timerChip: $('timer-chip'),
  timerDigits: $('timer-digits'),
  timerReset: $('timer-reset'),

  standin: $('standin'),
  standinPerson: $('standin-person'),
  standinEntry: $('standin-entry'),
  standinOptions: $('standin-options'),

  liveWrap: $('livebracket'),
  liveToggle: $('live-toggle'),
  liveScroll: $('live-scroll'),
  liveBracket: $('live-bracket'),

  podium: $('podium'),
  podiumCategory: $('podium-category'),
  confetti: $('confetti'),
  bracket: $('bracket'),
  bracketWrap: $('bracket-wrap'),
  bracketToggle: $('bracket-toggle'),
  againBtn: $('again-btn'),
  newBtn: $('new-btn'),
};

let game = null;
let lastConfig = null;
let resolving = false;
let awaitingStandIn = null; // the clash blocking the current match
let justAdvancedId = null; // match tile to flash after a winner moves up
let lastRoundLabel = '';

const OWNER_NOTES = {
  none: 'Entries run without owners.',
  entry: 'Add an owner after a comma: “Broccoli, Ada”.',
  pool: 'Entries are shared out randomly and evenly.',
};

const CHAMPION_NOTES = {
  fixed:
    'The owner argues for their entry all tournament. Nobody has to argue against themselves — ' +
    'the draw avoids it, and a stand-in steps in when the bracket forces it.',
  rotate:
    'Every match gets a fresh champion: nobody argues the same entry twice while someone else ' +
    'is free, and never both sides of a match.',
};

/** Restart a CSS animation that may already have run on this element. */
function replay(node, className) {
  node.classList.remove(className);
  void node.offsetWidth;
  node.classList.add(className);
}

/* ─────────────────────────── setup screen ─────────────────────────── */

function ownerMode() {
  const picked = el.form.querySelector('input[name="ownerMode"]:checked');
  return picked ? picked.value : 'none';
}

function championMode() {
  const picked = el.form.querySelector('input[name="champions"]:checked');
  return picked ? picked.value : 'fixed';
}

function updateSetupUi() {
  const mode = ownerMode();
  el.peopleField.hidden = mode !== 'pool';
  el.championField.hidden = mode === 'none';
  el.ownerNote.textContent = OWNER_NOTES[mode];
  el.championNote.textContent = CHAMPION_NOTES[championMode()];
  el.timerSetup.hidden = !el.timerOn.checked;

  const shape = bracketShape(parseEntryLines(el.entries.value, mode === 'entry').length);
  if (!shape) {
    el.preview.textContent = 'Add at least 2 entries.';
    return;
  }
  const byes = shape.byes === 1 ? '1 bye' : `${shape.byes} byes`;
  el.preview.textContent =
    `${shape.count} entries → ${shape.size}-slot bracket · ` +
    `${shape.byes ? `${byes} · ` : ''}${shape.rounds} round${shape.rounds > 1 ? 's' : ''}`;
}

function showSetupError(message) {
  el.setupError.textContent = message;
  el.setupError.hidden = !message;
}

function readConfig() {
  const seconds = Math.min(600, Math.max(5, Number(el.timerSeconds.value) || 20));
  return {
    category: el.category.value,
    entriesText: el.entries.value,
    ownerMode: ownerMode(),
    peopleText: el.people.value,
    champions: championMode(),
    timer: { enabled: el.timerOn.checked, seconds },
  };
}

function startFromConfig(config) {
  const entries = buildEntries(config);
  if (entries.length < 2) {
    showSetupError('Give me at least two entries — one per line.');
    return;
  }
  showSetupError('');
  lastConfig = config;
  game = createTournament({
    category: config.category,
    entries,
    people: peopleFor(config, entries),
    champions: config.champions,
    timer: config.timer,
  });
  renderMatch();
}

el.form.addEventListener('submit', (event) => {
  event.preventDefault();
  startFromConfig(readConfig());
});

el.form.addEventListener('input', updateSetupUi);
el.form.addEventListener('change', updateSetupUi);

el.form.querySelectorAll('.preset').forEach((preset) => {
  preset.addEventListener('click', () => {
    el.form.querySelectorAll('.preset').forEach((p) => p.classList.remove('is-on'));
    preset.classList.add('is-on');
    el.timerSeconds.value = preset.dataset.seconds;
  });
});

el.timerSeconds.addEventListener('input', () => {
  el.form.querySelectorAll('.preset').forEach((p) => {
    p.classList.toggle('is-on', p.dataset.seconds === el.timerSeconds.value);
  });
});

el.demoFill.addEventListener('click', () => {
  el.category.value = 'Best Vegetable';
  el.entries.value = [
    'Broccoli', 'Sweet potato', 'Fennel', 'Leek', 'Aubergine', 'Beetroot',
    'Chard', 'Cauliflower', 'Asparagus', 'Sugar snap peas', 'Pumpkin',
    'Brussels sprout', 'Radicchio', 'Corn on the cob',
  ].join('\n');
  el.form.querySelector('input[value="pool"]').checked = true;
  el.people.value = 'Ada, Mo, Yusuf, Kit';
  updateSetupUi();
});

/* ─────────────────────────── match screen ─────────────────────────── */

/** Shrink an entry's text until it fits its card, so long names stay readable. */
function fitCardText(card) {
  const inner = card.querySelector('.card__inner');
  const text = card.querySelector('.card__text');
  const owner = card.querySelector('.card__owner');
  const width = inner.clientWidth;
  // The text wraps, so height is what actually runs out: measure the rendered
  // block against the room left beside the owner's name.
  const room = inner.clientHeight - (owner.offsetHeight || 0) - 8;
  if (width <= 0 || room <= 0) return;

  // Measure with words kept whole, so the size drops instead of a word
  // snapping in half; only a word too long even at the smallest size breaks.
  text.style.overflowWrap = 'normal';
  let size = Math.min(56, Math.round(width * 0.5));
  text.style.fontSize = `${size}px`;
  while (
    size > 12 &&
    (text.getBoundingClientRect().height > room || text.scrollWidth > width + 1)
  ) {
    size -= 2;
    text.style.fontSize = `${size}px`;
  }
  if (text.scrollWidth > width + 1) text.style.overflowWrap = 'anywhere';
  return size;
}

/** Both entries share the smaller size, so neither looks favoured. */
function fitCards() {
  const size = Math.min(...el.cards.map(fitCardText));
  if (!Number.isFinite(size)) return;
  el.cards.forEach((card) => {
    card.querySelector('.card__text').style.fontSize = `${size}px`;
  });
}

function paintCard(index, entryId, ownerName) {
  const entry = entryById(game, entryId);
  const card = el.cards[index];
  card.classList.remove('is-winner', 'is-loser');
  card.querySelector('.card__text').textContent = entry ? entry.text : '';
  card.querySelector('.card__owner').textContent = ownerName || '';
  card.dataset.entryId = entryId || '';
}

function showStandInPrompt(match, clash) {
  awaitingStandIn = { match, clash };
  el.standin.hidden = false;
  el.arena.classList.add('is-blocked');
  el.standinPerson.textContent = clash.person;
  el.standinEntry.textContent = clash.entry.text;

  el.standinOptions.innerHTML = '';
  clash.options.forEach((person) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'standin__pick';
    button.textContent = person;
    button.addEventListener('click', () => chooseStandIn(person));
    el.standinOptions.append(button);
  });
  const dice = document.createElement('button');
  dice.type = 'button';
  dice.className = 'standin__pick standin__pick--random';
  dice.textContent = '🎲 Random';
  dice.addEventListener('click', () => chooseStandIn(randomStandIn(clash)));
  el.standinOptions.append(dice);
}

function chooseStandIn(person) {
  if (!awaitingStandIn) return;
  const { match, clash } = awaitingStandIn;
  const owners = applyStandIn(game, match, (id) => entryById(game, id), clash.slot, person);
  awaitingStandIn = null;
  el.standin.hidden = true;
  el.arena.classList.remove('is-blocked');
  owners.forEach((owner, i) => paintCard(i, match.slots[i], owner));
  fitCards();
  el.cards[clash.slot].querySelector('.card__owner').classList.add('is-standin');
  replay(el.cards[clash.slot], 'is-entering');
  renderBracketInto(el.liveBracket, match.id);
}

function renderMatch() {
  const match = currentMatch(game);
  if (!match) {
    renderPodium();
    return;
  }

  el.body.dataset.screen = 'match';
  resolving = false;
  awaitingStandIn = null;
  el.standin.hidden = true;
  el.arena.classList.remove('is-resolving', 'is-blocked');
  el.cards.forEach((card) => card.querySelector('.card__owner').classList.remove('is-standin'));

  const total = game.played + remainingMatches(game);
  const label = match.thirdPlace ? 'Third place' : roundName(match.round, game.rounds);
  el.roundLabel.textContent = label;
  if (label !== lastRoundLabel) {
    replay(el.roundLabel, 'is-new');
    lastRoundLabel = label;
  }
  el.progressLabel.textContent = `${game.played + 1}/${total}`;
  el.categoryLabel.hidden = !game.category;
  el.categoryLabel.textContent = game.category;

  const result = championsFor(game, match, (id) => entryById(game, id));
  const owners = result.owners || match.slots.map((id) => (id ? entryById(game, id).owner : ''));
  match.slots.forEach((entryId, i) => {
    paintCard(i, entryId, owners[i]);
    replay(el.cards[i], 'is-entering');
  });
  fitCards();
  if (result.clash) showStandInPrompt(match, result.clash);

  renderBracketInto(el.liveBracket, match.id);
  scrollLiveBracketToCurrent();
  resetTimer();
}

function pick(index) {
  if (resolving || awaitingStandIn) return;
  const match = currentMatch(game);
  if (!match) return;
  const winnerId = match.slots[index];
  if (!winnerId) return;

  resolving = true;
  stopTimer();
  el.arena.classList.add('is-resolving');
  el.cards[index].classList.remove('is-entering');
  el.cards[index].classList.add('is-winner');
  el.cards[1 - index].classList.add('is-loser');

  // Resolve straight away, then let the beat play: mid-beat the bracket redraws
  // so the room sees the winner climb into the next round.
  resolveMatch(game, winnerId);
  justAdvancedId = match.next;
  const slow = !reducedMotion.matches;

  window.setTimeout(() => {
    if (!resolving || !game) return;
    renderBracketInto(el.liveBracket, match.id);
    scrollLiveBracketToCurrent();
  }, slow ? 420 : 0);

  window.setTimeout(() => {
    if (!game) return;
    renderMatch();
  }, slow ? 1150 : 400);
}

el.cards.forEach((card, i) => card.addEventListener('click', () => pick(i)));

function backToSetup() {
  stopTimer();
  game = null;
  resolving = false;
  awaitingStandIn = null;
  justAdvancedId = null;
  lastRoundLabel = '';
  el.standin.hidden = true;
  el.confetti.innerHTML = '';
  el.body.dataset.screen = 'setup';
}

el.quitBtn.addEventListener('click', backToSetup);

document.addEventListener('keydown', (event) => {
  if (el.body.dataset.screen !== 'match') return;
  if (event.key === '1' || event.key === 'ArrowLeft') pick(0);
  if (event.key === '2' || event.key === 'ArrowRight') pick(1);
  if (event.code === 'Space' && !(event.target instanceof HTMLButtonElement)) {
    event.preventDefault();
    toggleTimer();
  }
});

let resizeHandle = null;
window.addEventListener('resize', () => {
  if (el.body.dataset.screen !== 'match') return;
  window.clearTimeout(resizeHandle);
  resizeHandle = window.setTimeout(fitCards, 120);
});

/* ─────────────────────────── pitch timer ─────────────────────────── */

let timerHandle = null;
let deadline = 0;
let remainingMs = 0;

function timerLength() {
  return (game?.timer?.seconds || 20) * 1000;
}

function paintTimer(ms) {
  const clamped = Math.max(0, ms);
  const seconds = Math.ceil(clamped / 1000);
  el.timerDigits.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  el.timerChip.style.setProperty('--pct', `${(clamped / timerLength()) * 100}%`);
  el.timerChip.classList.toggle('is-out', clamped === 0);
  el.timerReset.hidden = !game?.timer?.enabled || clamped === timerLength();
}

function tick() {
  const left = deadline - Date.now();
  paintTimer(left);
  if (left <= 0) stopTimer(true);
}

function stopTimer(ranOut = false) {
  if (timerHandle) {
    window.clearInterval(timerHandle);
    timerHandle = null;
  }
  remainingMs = ranOut ? 0 : Math.max(0, deadline - Date.now());
  el.timerChip.classList.toggle('is-running', false);
}

function toggleTimer() {
  if (!game?.timer?.enabled || awaitingStandIn) return;
  if (timerHandle) {
    stopTimer();
    return;
  }
  if (remainingMs <= 0) remainingMs = timerLength();
  deadline = Date.now() + remainingMs;
  el.timerChip.classList.remove('is-out');
  el.timerChip.classList.add('is-running');
  timerHandle = window.setInterval(tick, 100);
  tick();
}

function resetTimer() {
  stopTimer();
  remainingMs = 0;
  el.timerChip.hidden = !game?.timer?.enabled;
  el.timerChip.classList.remove('is-out');
  paintTimer(timerLength());
}

el.timerChip.addEventListener('click', toggleTimer);
el.timerReset.addEventListener('click', resetTimer);

/* ─────────────────────────── bracket drawing ─────────────────────────── */

/** The name shown beside an entry in the bracket, once it is known. */
function championIn(match, slot, entry) {
  if (!entry) return '';
  if (match.owners && match.owners[slot]) return match.owners[slot];
  return game.champions === 'rotate' ? '' : entry.owner;
}

function tieSide(match, slot) {
  const entryId = match.slots[slot];
  const row = document.createElement('div');
  row.className = 'tie__side';
  const entry = entryById(game, entryId);
  const name = document.createElement('span');

  if (!entry) {
    row.classList.add('is-empty');
    // A settled empty slot is a bye; an unsettled one is simply not known yet.
    name.textContent = match.ready[slot] ? 'bye' : '—';
    row.append(name);
    return row;
  }

  name.textContent = entry.text;
  if (entryId === match.winner) row.classList.add('is-winner');
  row.append(name);
  const owner = championIn(match, slot, entry);
  if (owner) {
    const tag = document.createElement('span');
    tag.className = 'tie__owner';
    tag.textContent = owner;
    row.append(tag);
  }
  return row;
}

function tieTile(match, liveMatchId) {
  const tile = document.createElement('div');
  tile.className = 'tie';
  if (match.thirdPlace) tile.classList.add('tie--third');
  if (match.id === liveMatchId) {
    tile.classList.add('tie--live');
    tile.dataset.live = 'true';
  }
  if (match.id === justAdvancedId) tile.classList.add('tie--advanced');

  if (match.thirdPlace) {
    const label = document.createElement('div');
    label.className = 'tie__label';
    label.textContent = 'Third place';
    tile.append(label);
  }
  tile.append(tieSide(match, 0), tieSide(match, 1));
  return tile;
}

/**
 * Draw the whole tree. `liveMatchId` marks the match being played, which the
 * match screen uses and the podium leaves out.
 */
function renderBracketInto(container, liveMatchId = null) {
  container.innerHTML = '';
  for (let r = 0; r < game.rounds; r++) {
    const column = document.createElement('div');
    column.className = 'round';
    const name = document.createElement('div');
    name.className = 'round__name';
    name.textContent = roundName(r, game.rounds);
    const list = document.createElement('div');
    list.className = 'round__matches';
    game.byRound[r].forEach((match) => list.append(tieTile(match, liveMatchId)));
    if (r === game.rounds - 1 && game.thirdPlaceId) {
      list.append(tieTile(getMatch(game, game.thirdPlaceId), liveMatchId));
    }
    column.append(name, list);
    container.append(column);
  }
  justAdvancedId = null;
}

/** Keep the match being played centred in the mini bracket. */
function scrollLiveBracketToCurrent() {
  const tile = el.liveBracket.querySelector('[data-live="true"]');
  if (!tile) return;
  const box = el.liveScroll;
  // Measured against the scroll box itself: the tiles have no positioned
  // ancestor, so offsetTop/offsetLeft would be page coordinates.
  const boxRect = box.getBoundingClientRect();
  const tileRect = tile.getBoundingClientRect();
  const left = box.scrollLeft + (tileRect.left - boxRect.left) - (box.clientWidth - tileRect.width) / 2;
  const top = box.scrollTop + (tileRect.top - boxRect.top) - (box.clientHeight - tileRect.height) / 2;
  box.scrollTo({
    left: Math.max(0, left),
    top: Math.max(0, top),
    behavior: reducedMotion.matches ? 'auto' : 'smooth',
  });
}

el.liveToggle.addEventListener('click', () => {
  const open = el.liveWrap.dataset.open === 'true';
  el.liveWrap.dataset.open = String(!open);
  el.liveToggle.setAttribute('aria-expanded', String(!open));
  el.liveToggle.textContent = open ? 'Show' : 'Hide';
  if (!open) scrollLiveBracketToCurrent();
  fitCards();
});

/* ─────────────────────────── podium screen ─────────────────────────── */

const PLACES = [
  { rank: '🥇', label: 'Champion', cls: 'place--1' },
  { rank: '🥈', label: 'Runner-up', cls: 'place--2' },
  { rank: '🥉', label: 'Third', cls: 'place--3' },
];

function placeBlock(entry, spec) {
  const wrap = document.createElement('div');
  wrap.className = `place ${spec.cls}`;
  const rank = document.createElement('div');
  rank.className = 'place__rank';
  rank.textContent = spec.rank;
  const body = document.createElement('div');
  body.className = 'place__body';
  const label = document.createElement('div');
  label.className = 'place__label';
  label.textContent = spec.label;
  const text = document.createElement('div');
  text.className = 'place__text';
  text.textContent = entry.text;
  body.append(label, text);
  const credit = creditFor(game, entry);
  if (credit) {
    const owner = document.createElement('div');
    owner.className = 'place__owner';
    owner.textContent = credit;
    body.append(owner);
  }
  wrap.append(rank, body);
  return wrap;
}

const CONFETTI_COLOURS = ['#ffe14d', '#ff6b6b', '#4ecdc4', '#8ea3ff', '#b8f14a'];

/** A short burst of paper squares over the podium. Purely decorative. */
function burstConfetti() {
  el.confetti.innerHTML = '';
  if (reducedMotion.matches) return;
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < 36; i++) {
    const bit = document.createElement('i');
    bit.className = 'confetti__bit';
    bit.style.left = `${Math.random() * 100}%`;
    bit.style.background = CONFETTI_COLOURS[i % CONFETTI_COLOURS.length];
    bit.style.animationDelay = `${Math.random() * 0.9}s`;
    bit.style.animationDuration = `${2 + Math.random() * 1.4}s`;
    bit.style.setProperty('--drift', `${(Math.random() - 0.5) * 160}px`);
    bit.style.setProperty('--spin', `${540 + Math.random() * 540}deg`);
    fragment.append(bit);
  }
  el.confetti.append(fragment);
  window.setTimeout(() => { el.confetti.innerHTML = ''; }, 4200);
}

function renderPodium() {
  el.body.dataset.screen = 'podium';
  resolving = false;
  stopTimer();

  const result = podium(game);
  el.podiumCategory.textContent = game.category
    ? `${game.category} — settled.`
    : 'The results are in.';

  el.podium.innerHTML = '';
  const winners = [result.first, result.second, result.third].filter(Boolean);
  winners.forEach((entry, i) => {
    const block = placeBlock(entry, PLACES[i]);
    // Reveal from the bottom of the podium upward: bronze, silver, then gold.
    block.style.animationDelay = `${(winners.length - 1 - i) * 0.28}s`;
    el.podium.append(block);
  });
  burstConfetti();

  renderBracketInto(el.bracket);
  el.bracketWrap.dataset.open = 'false';
  el.bracketToggle.setAttribute('aria-expanded', 'false');
  el.bracketToggle.textContent = 'Show full bracket';
}

el.bracketToggle.addEventListener('click', () => {
  const open = el.bracketWrap.dataset.open === 'true';
  el.bracketWrap.dataset.open = String(!open);
  el.bracketToggle.setAttribute('aria-expanded', String(!open));
  el.bracketToggle.textContent = open ? 'Show full bracket' : 'Hide bracket';
});

el.againBtn.addEventListener('click', () => {
  if (!lastConfig) return;
  el.confetti.innerHTML = '';
  lastRoundLabel = '';
  startFromConfig(lastConfig);
});

el.newBtn.addEventListener('click', backToSetup);

updateSetupUi();
