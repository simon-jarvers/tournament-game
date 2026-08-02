// Turning free text from the setup screen into entries. Pure functions, no DOM.

import { shuffle } from './random.js';
import { nextPowerOfTwo } from './bracket.js';
import { distinctPeople } from './owners.js';

// A comma is the separator people actually reach for on a phone keyboard; the
// rest are kept as aliases so older habits still work.
const OWNER_SPLIT = /\s*(?:,|\||\s@\s|\s--\s|\s—\s)\s*/g;

/**
 * Split `Broccoli, Ada` into entry and owner on the *last* separator, so entry
 * text may itself contain commas: `The Good, the Bad and the Ugly, Ada`.
 */
function splitOwner(line) {
  let cut = null;
  for (const match of line.matchAll(OWNER_SPLIT)) {
    cut = { at: match.index, length: match[0].length };
  }
  if (!cut) return { text: line, owner: '' };
  return {
    text: line.slice(0, cut.at).trim(),
    owner: line.slice(cut.at + cut.length).trim(),
  };
}

/**
 * One entry per line. Owners are only pulled out of the line when asked for —
 * otherwise a comma is just part of the entry.
 */
export function parseEntryLines(raw, splitOwners = false) {
  return String(raw || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (splitOwners ? splitOwner(line) : { text: line, owner: '' }))
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
  const parsed = parseEntryLines(entriesText, ownerMode === 'entry');
  if (ownerMode === 'pool') {
    return distributeOwners(parsed, parsePeople(peopleText), rng);
  }
  return parsed;
}

/** The worked example behind the “Fill an example” button. */
export const EXAMPLE = {
  category: 'Best Vegetable',
  entries: [
    ['Broccoli 🥦', 'Bibi'],
    ['Tomato 🍅', 'Pauli'],
    ['Potato 🥔', 'Marli'],
    ['Carrot 🥕', 'Leila'],
    ['Aubergine 🍆', 'Bibi'],
    ['Cucumber 🥒', 'Pauli'],
    ['Corn 🌽', 'Marli'],
    ['Pepper 🫑', 'Leila'],
  ],
};

/**
 * Fill the example to match the owner mode on screen: owners inline for
 * per-entry, a people list for a pool, and neither when owners are off.
 */
export function exampleFor(ownerMode) {
  const withOwners = ownerMode === 'entry';
  return {
    category: EXAMPLE.category,
    entriesText: EXAMPLE.entries
      .map(([text, owner]) => (withOwners ? `${text}, ${owner}` : text))
      .join('\n'),
    peopleText: ownerMode === 'pool'
      ? [...new Set(EXAMPLE.entries.map(([, owner]) => owner))].join(', ')
      : '',
  };
}

/**
 * Everyone who can be called on to argue: the whole pool in people-pool mode
 * (even someone who drew no entries), otherwise whoever owns an entry.
 */
export function peopleFor({ ownerMode, peopleText }, entries) {
  if (ownerMode === 'pool') return parsePeople(peopleText);
  if (ownerMode === 'entry') return distinctPeople(entries);
  return [];
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
