// Turning free text from the setup screen into entries. Pure functions, no DOM.

import { shuffle, nextPowerOfTwo } from './bracket.js';

const OWNER_SPLIT = /\s*(?:\||\s@\s|\s--\s|\s—\s)\s*/;

/** One entry per line. `Item | Owner` (or `Item @ Owner`) carries an owner. */
export function parseEntryLines(raw) {
  return String(raw || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(OWNER_SPLIT);
      const text = (parts[0] || '').trim();
      const owner = (parts[1] || '').trim();
      return { text, owner };
    })
    .filter((entry) => entry.text.length > 0);
}

/** People can be given one per line or comma separated. */
export function parsePeople(raw) {
  return String(raw || '')
    .split(/[\n,]/)
    .map((name) => name.trim())
    .filter(Boolean);
}

/**
 * Hand entries out to a pool of people as evenly as possible, at random.
 * With 7 entries and 3 people everyone gets 2 and someone gets a third.
 */
export function distributeOwners(entries, people, rng = Math.random) {
  if (!people.length) return entries.map((e) => ({ ...e, owner: '' }));
  const order = shuffle([...entries.keys()], rng);
  const roster = shuffle(people, rng);
  const owners = new Array(entries.length);
  order.forEach((entryIndex, i) => {
    owners[entryIndex] = roster[i % roster.length];
  });
  return entries.map((entry, i) => ({ ...entry, owner: owners[i] }));
}

/**
 * Build the entry list for a given owner mode: 'none', 'entry' or 'pool'.
 */
export function buildEntries({ entriesText, ownerMode, peopleText }, rng = Math.random) {
  const parsed = parseEntryLines(entriesText);
  if (ownerMode === 'pool') {
    return distributeOwners(parsed, parsePeople(peopleText), rng);
  }
  if (ownerMode === 'entry') return parsed;
  return parsed.map((entry) => ({ ...entry, owner: '' }));
}

/** Shape of the bracket a given entry count will produce, for the preview line. */
export function bracketShape(count) {
  if (count < 2) return null;
  const size = nextPowerOfTwo(count);
  return {
    count,
    size,
    byes: size - count,
    rounds: Math.log2(size),
    firstRoundMatches: (count - (size - count)) / 2,
  };
}
