// Pure tournament logic. No DOM, no globals — so a future networked version
// can drive the same state machine from a server.

import { shuffle } from './random.js';
import { FIXED, distinctPeople, arrangeFirstRound } from './owners.js';

export { shuffle };

export function nextPowerOfTwo(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** Human name for a round, counting back from the final. */
export function roundName(round, totalRounds) {
  const remaining = totalRounds - round;
  if (remaining === 1) return 'Final';
  if (remaining === 2) return 'Semifinal';
  if (remaining === 3) return 'Quarterfinal';
  return `Round of ${2 ** remaining}`;
}

function makeMatch(id, round, order, ready) {
  return {
    id,
    round,
    order,
    slots: [null, null],
    ready: [ready, ready],
    winner: null,
    loser: null,
    decided: false,
    walkover: false,
    thirdPlace: false,
    owners: null, // who argues each side, decided when the match comes up
    next: null,
    nextSlot: null,
    loserTo: null,
    loserSlot: null,
  };
}

/**
 * Build a full knockout tournament from a list of entries.
 *
 * Entries are shuffled, the bracket is padded up to the next power of two, and
 * the padding is handed out as byes — at most one per first-round match, so no
 * match is ever empty. The whole tree (including the third-place playoff) is
 * generated up front.
 *
 * @param {{category?: string, entries: {text: string, owner?: string}[], timer?: object}} config
 */
export function createTournament(config, rng = Math.random) {
  const source = config.entries || [];
  if (source.length < 2) throw new Error('Need at least 2 entries to run a tournament.');

  const entries = shuffle(source, rng).map((e, i) => ({
    id: `e${i}`,
    text: e.text,
    owner: e.owner || '',
    ownerHistory: [],
  }));

  const count = entries.length;
  const size = nextPowerOfTwo(count);
  const byes = size - count;
  const rounds = Math.log2(size);

  const matches = [];
  const byRound = [];
  for (let r = 0; r < rounds; r++) {
    const row = [];
    for (let i = 0; i < size / 2 ** (r + 1); i++) {
      const match = makeMatch(`m${r}-${i}`, r, i, r === 0);
      row.push(match);
      matches.push(match);
    }
    byRound.push(row);
  }

  // Wire winners forward.
  for (let r = 0; r < rounds - 1; r++) {
    byRound[r].forEach((match, i) => {
      match.next = byRound[r + 1][Math.floor(i / 2)].id;
      match.nextSlot = i % 2;
    });
  }

  // Third-place playoff: fed by the two semifinal losers, played before the final.
  let thirdPlaceId = null;
  if (rounds >= 2) {
    const playoff = makeMatch('m-third', rounds - 1, 1, false);
    playoff.thirdPlace = true;
    matches.push(playoff);
    thirdPlaceId = playoff.id;
    byRound[rounds - 2].forEach((semi, i) => {
      semi.loserTo = playoff.id;
      semi.loserSlot = i;
    });
  }

  // Deal entries into round one: byes land at random, and the draw avoids
  // pairing someone against their own entry where it can.
  const pairs = arrangeFirstRound(entries, size / 2, byes, rng);
  byRound[0].forEach((match, i) => {
    match.slots[0] = pairs[i][0] ? pairs[i][0].id : null;
    match.slots[1] = pairs[i][1] ? pairs[i][1].id : null;
  });

  // Play order: round by round, with the third-place match slotted in just
  // before the final.
  const order = [];
  for (let r = 0; r < rounds; r++) {
    if (r === rounds - 1 && thirdPlaceId) order.push(thirdPlaceId);
    byRound[r].forEach((match) => order.push(match.id));
  }

  const state = {
    category: (config.category || '').trim(),
    timer: config.timer || { enabled: true, seconds: 20 },
    champions: config.champions === 'rotate' ? 'rotate' : FIXED,
    people: config.people && config.people.length ? [...config.people] : distinctPeople(entries),
    tally: {}, // how many matches each person has argued
    entries,
    size,
    byes,
    rounds,
    matches,
    byRound,
    order,
    index: 0,
    played: 0,
    thirdPlaceId,
    finalId: byRound[rounds - 1][0].id,
  };

  settle(state);
  return state;
}

export function getMatch(state, id) {
  return state.matches.find((m) => m.id === id) || null;
}

export function entryById(state, id) {
  return state.entries.find((e) => e.id === id) || null;
}

function decide(state, match, winnerId) {
  match.winner = winnerId;
  match.loser = match.slots[0] === winnerId ? match.slots[1] : match.slots[0];
  match.decided = true;
  match.walkover = match.slots[0] === null || match.slots[1] === null;

  if (match.next) {
    const target = getMatch(state, match.next);
    target.slots[match.nextSlot] = winnerId;
    target.ready[match.nextSlot] = true;
  }
  if (match.loserTo) {
    const target = getMatch(state, match.loserTo);
    target.slots[match.loserSlot] = match.loser;
    target.ready[match.loserSlot] = true;
  }
}

/** Auto-resolve everything that needs no vote: byes and walkovers. */
function settle(state) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const match of state.matches) {
      if (match.decided || !match.ready[0] || !match.ready[1]) continue;
      if (match.slots[0] === null || match.slots[1] === null) {
        decide(state, match, match.slots[0] ?? match.slots[1]);
        changed = true;
      }
    }
  }
}

/** The match awaiting a vote, or null when the tournament is over. */
export function currentMatch(state) {
  while (state.index < state.order.length) {
    const match = getMatch(state, state.order[state.index]);
    if (!match.decided) return match;
    state.index++;
  }
  return null;
}

/** Record a winner for the current match and move on. */
export function resolveMatch(state, winnerId) {
  const match = currentMatch(state);
  if (!match) return null;
  if (!match.slots.includes(winnerId)) {
    throw new Error('That entry is not in the current match.');
  }
  decide(state, match, winnerId);
  state.played++;
  settle(state);
  return currentMatch(state);
}

/** Matches still to be voted on, including the one on screen. */
export function remainingMatches(state) {
  return state.matches.filter((m) => !m.decided).length;
}

export function isComplete(state) {
  return currentMatch(state) === null;
}

/** Gold / silver / bronze once the tournament is done. */
export function podium(state) {
  const final = getMatch(state, state.finalId);
  const playoff = state.thirdPlaceId ? getMatch(state, state.thirdPlaceId) : null;
  return {
    first: entryById(state, final.winner),
    second: entryById(state, final.loser),
    third: playoff ? entryById(state, playoff.winner) : null,
  };
}
