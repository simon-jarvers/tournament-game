// Who argues for what. Two modes:
//
//   'fixed'  — an entry keeps its owner all tournament. Nobody should have to
//              argue against themselves, so the draw avoids pairing an owner
//              with themselves, and where the bracket forces it anyway a
//              stand-in takes over one side for that match.
//   'rotate' — a fresh champion each round, never the same person twice for
//              the same entry while anyone else is available, and never both
//              sides of one match.
//
// No DOM here: this is rules, not rendering.

import { shuffle, pickOne } from './random.js';

export const FIXED = 'fixed';
export const ROTATE = 'rotate';

export function distinctPeople(entries) {
  const seen = [];
  for (const entry of entries) {
    if (entry.owner && !seen.includes(entry.owner)) seen.push(entry.owner);
  }
  return seen;
}

/** Matches where one person owns both entries. */
export function clashCount(pairs) {
  return pairs.filter(([a, b]) => a && b && a.owner && a.owner === b.owner).length;
}

/**
 * Deal entries into first-round pairs, keeping byes randomly placed and
 * avoiding same-owner matches where the entry list allows it.
 */
export function arrangeFirstRound(entries, matchCount, byeCount, rng = Math.random) {
  const byeSlots = new Set(
    shuffle([...Array(matchCount).keys()], rng).slice(0, byeCount)
  );

  let best = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const pool = shuffle(entries, rng);
    const pairs = [];
    let i = 0;
    for (let m = 0; m < matchCount; m++) {
      const a = pool[i++];
      const b = byeSlots.has(m) ? null : pool[i++];
      pairs.push([a, b]);
    }
    repairClashes(pairs, rng);
    const clashes = clashCount(pairs);
    if (!best || clashes < best.clashes) best = { pairs, clashes };
    if (clashes === 0) break;
  }
  return best.pairs;
}

/** Swap entries between matches to break up same-owner pairings. */
function repairClashes(pairs, rng) {
  for (let index = 0; index < pairs.length; index++) {
    const pair = pairs[index];
    if (!pair[0] || !pair[1] || pair[0].owner !== pair[1].owner || !pair[0].owner) continue;

    const others = shuffle([...pairs.keys()], rng).filter((j) => j !== index);
    for (const j of others) {
      for (const slot of [0, 1]) {
        const candidate = pairs[j][slot];
        if (!candidate) continue;
        const partner = pairs[j][1 - slot];
        // Swapping must fix this match without breaking the other one.
        if (candidate.owner === pair[0].owner) continue;
        if (partner && partner.owner && partner.owner === pair[1].owner) continue;
        pairs[j][slot] = pair[1];
        pair[1] = candidate;
        return repairClashes(pairs, rng);
      }
    }
  }
}

function loadFor(state, person) {
  return state.roundLoad?.counts?.[person] || 0;
}

function noteChampion(state, entry, person, round) {
  if (!person) return;
  if (!state.roundLoad || state.roundLoad.round !== round) {
    state.roundLoad = { round, counts: {} };
  }
  state.roundLoad.counts[person] = loadFor(state, person) + 1;
  entry.ownerHistory.push(person);
}

/**
 * Pick a champion for one entry. Prefers someone who has never had this entry
 * and is carrying the least work this round; when everyone has already had it,
 * falls back to whoever had it longest ago.
 */
function pickChampion(state, entry, taken, round, rng) {
  const people = state.people.filter((person) => person !== taken);
  if (!people.length) return state.people[0] || '';

  // First time out, an entry is argued by whoever it was assigned to.
  if (!entry.ownerHistory.length && entry.owner && people.includes(entry.owner)) {
    return entry.owner;
  }

  const fresh = people.filter((person) => !entry.ownerHistory.includes(person));
  if (fresh.length) {
    const lightest = Math.min(...fresh.map((person) => loadFor(state, person)));
    return pickOne(fresh.filter((person) => loadFor(state, person) === lightest), rng);
  }

  // Everyone has argued for this entry already: reuse the least recent, but
  // never the same person two rounds running.
  const lastUp = entry.ownerHistory[entry.ownerHistory.length - 1];
  const stale = people.filter((person) => person !== lastUp);
  const ranked = (stale.length ? stale : people)
    .map((person) => ({ person, seen: entry.ownerHistory.lastIndexOf(person) }))
    .sort((a, b) => a.seen - b.seen);
  return ranked[0].person;
}

/**
 * Work out who argues each side of a match.
 *
 * Returns `{ owners }` once settled, or `{ clash }` when a fixed owner holds
 * both entries and the room has to nominate a stand-in.
 */
export function championsFor(state, match, entryOf, rng = Math.random) {
  if (match.owners) return { owners: match.owners };

  const entries = match.slots.map((id) => (id ? entryOf(id) : null));
  if (!state.people.length || !entries[0] || !entries[1]) {
    return { owners: settle(state, match, entries.map((e) => (e ? e.owner : ''))) };
  }

  if (state.champions === FIXED) {
    const owners = entries.map((entry) => entry.owner);
    if (owners[0] && owners[0] === owners[1] && state.people.length > 1) {
      return {
        clash: {
          person: owners[0],
          slot: 1,
          entry: entries[1],
          options: state.people.filter((person) => person !== owners[0]),
        },
      };
    }
    return { owners: settle(state, match, owners) };
  }

  return { owners: settle(state, match, assignRotating(state, entries, match.round, rng)) };
}

/** How unwelcome a champion is for this entry: a repeat, or worse, a rerun. */
function repeatCost(entry, person) {
  if (!person) return 0;
  const history = entry.ownerHistory;
  let cost = history.includes(person) ? 4 : 0;
  if (history[history.length - 1] === person) cost += 6;
  return cost;
}

/**
 * Whoever is picked first constrains the other side, so try both orders and
 * keep the pairing with the fewest repeats. With two people this is what lets
 * an entry alternate champions instead of getting the same one twice running.
 */
function assignRotating(state, entries, round, rng) {
  let best = null;
  for (const first of [0, 1]) {
    const second = 1 - first;
    const owners = [];
    owners[first] = pickChampion(state, entries[first], null, round, rng);
    owners[second] = pickChampion(state, entries[second], owners[first], round, rng);
    const cost = repeatCost(entries[0], owners[0]) + repeatCost(entries[1], owners[1]);
    if (!best || cost < best.cost) best = { owners, cost };
    if (cost === 0) break;
  }
  return best.owners;
}

function settle(state, match, owners) {
  match.owners = owners;
  match.slots.forEach((id, slot) => {
    if (!id || !owners[slot]) return;
    noteChampion(state, state.entries.find((e) => e.id === id), owners[slot], match.round);
  });
  return match.owners;
}

/** Record the room's choice of stand-in and settle the match's champions. */
export function applyStandIn(state, match, entryOf, slot, person) {
  const owners = match.slots.map((id) => (id ? entryOf(id).owner : ''));
  owners[slot] = person;
  return settle(state, match, owners);
}

export function randomStandIn(clash, rng = Math.random) {
  return pickOne(clash.options, rng);
}

/** Who is credited on the podium: the owner, or the latest champion. */
export function creditFor(state, entry) {
  if (!entry) return '';
  if (state.champions === FIXED) return entry.owner;
  return entry.ownerHistory[entry.ownerHistory.length - 1] || entry.owner;
}
