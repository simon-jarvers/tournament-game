// Screen wiring: reads the setup form, drives the match loop, draws the podium.
// All tournament rules live in bracket.js — this file only renders and listens.

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
import { buildEntries, bracketShape, parseEntryLines } from './setup.js';

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
  timer: $('timer'),
  timerFill: $('timer-fill'),
  timerDigits: $('timer-digits'),
  timerToggle: $('timer-toggle'),
  timerReset: $('timer-reset'),

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
let justAdvancedId = null; // match tile to flash after a winner moves up
let lastRoundLabel = '';

const OWNER_NOTES = {
  none: 'Entries run without owners.',
  entry: 'Add an owner after a comma: “Broccoli, Ada”.',
  pool: 'Everyone champions a share of the entries.',
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

function updateSetupUi() {
  const mode = ownerMode();
  el.peopleField.hidden = mode !== 'pool';
  el.ownerNote.textContent = OWNER_NOTES[mode];
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

function renderMatch() {
  const match = currentMatch(game);
  if (!match) {
    renderPodium();
    return;
  }

  el.body.dataset.screen = 'match';
  resolving = false;
  el.arena.classList.remove('is-resolving');

  const total = game.played + remainingMatches(game);
  const label = match.thirdPlace ? 'Third place' : roundName(match.round, game.rounds);
  el.roundLabel.textContent = label;
  if (label !== lastRoundLabel) {
    replay(el.roundLabel, 'is-new');
    lastRoundLabel = label;
  }
  el.progressLabel.textContent = `Match ${game.played + 1} of ${total}`;
  el.categoryLabel.hidden = !game.category;
  el.categoryLabel.textContent = game.category;

  match.slots.forEach((entryId, i) => {
    const entry = entryById(game, entryId);
    const card = el.cards[i];
    card.classList.remove('is-winner', 'is-loser');
    card.querySelector('.card__text').textContent = entry ? entry.text : '';
    card.querySelector('.card__owner').textContent = entry && entry.owner ? entry.owner : '';
    card.dataset.entryId = entryId || '';
    replay(card, 'is-entering');
  });

  renderBracketInto(el.liveBracket, match.id);
  scrollLiveBracketToCurrent();
  resetTimer();
}

function pick(index) {
  if (resolving) return;
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
  justAdvancedId = null;
  lastRoundLabel = '';
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
  el.timerFill.style.width = `${(clamped / timerLength()) * 100}%`;
  el.timer.classList.toggle('is-out', clamped === 0);
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
  if (!ranOut) remainingMs = Math.max(0, deadline - Date.now());
  else remainingMs = 0;
  el.timerToggle.textContent = remainingMs > 0 ? 'Resume' : 'Start';
}

function toggleTimer() {
  if (!game?.timer?.enabled) return;
  if (timerHandle) {
    stopTimer();
    return;
  }
  if (remainingMs <= 0) remainingMs = timerLength();
  deadline = Date.now() + remainingMs;
  el.timer.classList.remove('is-out');
  el.timerToggle.textContent = 'Pause';
  timerHandle = window.setInterval(tick, 100);
  tick();
}

function resetTimer() {
  stopTimer();
  remainingMs = 0;
  el.timer.hidden = !game?.timer?.enabled;
  el.timer.classList.remove('is-out');
  el.timerToggle.textContent = 'Start';
  paintTimer(timerLength());
}

el.timerToggle.addEventListener('click', toggleTimer);
el.timerReset.addEventListener('click', resetTimer);

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
  if (entry.owner) {
    const owner = document.createElement('div');
    owner.className = 'place__owner';
    owner.textContent = entry.owner;
    body.append(owner);
  }
  wrap.append(rank, body);
  return wrap;
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
  if (entry.owner) {
    const owner = document.createElement('span');
    owner.className = 'tie__owner';
    owner.textContent = entry.owner;
    row.append(owner);
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
});

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
