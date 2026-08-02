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

  podium: $('podium'),
  podiumCategory: $('podium-category'),
  bracket: $('bracket'),
  bracketWrap: $('bracket-wrap'),
  bracketToggle: $('bracket-toggle'),
  againBtn: $('again-btn'),
  newBtn: $('new-btn'),
};

let game = null;
let lastConfig = null;
let resolving = false;

const OWNER_NOTES = {
  none: 'Entries run without owners.',
  entry: 'Add an owner with a pipe: “Broccoli | Ada”.',
  pool: 'Everyone champions a share of the entries.',
};

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

  const shape = bracketShape(parseEntryLines(el.entries.value).length);
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
  el.roundLabel.textContent = match.thirdPlace
    ? 'Third place'
    : roundName(match.round, game.rounds);
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
  });

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
  el.cards[index].classList.add('is-winner');
  el.cards[1 - index].classList.add('is-loser');

  const beat = reducedMotion.matches ? 450 : 1050;
  window.setTimeout(() => {
    resolveMatch(game, winnerId);
    renderMatch();
  }, beat);
}

el.cards.forEach((card, i) => card.addEventListener('click', () => pick(i)));

el.quitBtn.addEventListener('click', () => {
  stopTimer();
  game = null;
  el.body.dataset.screen = 'setup';
});

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
  body.innerHTML = '';
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

function tieSide(entryId, isWinner) {
  const row = document.createElement('div');
  row.className = 'tie__side';
  const entry = entryById(game, entryId);
  const name = document.createElement('span');
  if (!entry) {
    row.classList.add('is-empty');
    name.textContent = 'bye';
  } else {
    name.textContent = entry.text;
    if (isWinner) row.classList.add('is-winner');
    if (entry.owner) {
      const owner = document.createElement('span');
      owner.className = 'tie__owner';
      owner.textContent = entry.owner;
      row.append(name, owner);
      return row;
    }
  }
  row.append(name);
  return row;
}

function tieTile(match) {
  const tile = document.createElement('div');
  tile.className = `tie${match.thirdPlace ? ' tie--third' : ''}`;
  if (match.thirdPlace) {
    const label = document.createElement('div');
    label.className = 'tie__label';
    label.textContent = 'Third place';
    tile.append(label);
  }
  match.slots.forEach((entryId) => {
    tile.append(tieSide(entryId, entryId !== null && entryId === match.winner));
  });
  return tile;
}

function renderBracket() {
  el.bracket.innerHTML = '';
  for (let r = 0; r < game.rounds; r++) {
    const column = document.createElement('div');
    column.className = 'round';
    const name = document.createElement('div');
    name.className = 'round__name';
    name.textContent = roundName(r, game.rounds);
    const list = document.createElement('div');
    list.className = 'round__matches';
    game.byRound[r].forEach((match) => list.append(tieTile(match)));
    if (r === game.rounds - 1 && game.thirdPlaceId) {
      list.append(tieTile(getMatch(game, game.thirdPlaceId)));
    }
    column.append(name, list);
    el.bracket.append(column);
  }
}

function renderPodium() {
  el.body.dataset.screen = 'podium';
  stopTimer();

  const result = podium(game);
  el.podiumCategory.textContent = game.category
    ? `${game.category} — settled.`
    : 'The results are in.';

  el.podium.innerHTML = '';
  [result.first, result.second, result.third].forEach((entry, i) => {
    if (entry) el.podium.append(placeBlock(entry, PLACES[i]));
  });

  renderBracket();
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
  if (lastConfig) startFromConfig(lastConfig);
});

el.newBtn.addEventListener('click', () => {
  game = null;
  el.body.dataset.screen = 'setup';
});

updateSetupUi();
