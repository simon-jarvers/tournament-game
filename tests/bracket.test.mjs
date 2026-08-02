// node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createTournament,
  currentMatch,
  resolveMatch,
  isComplete,
  podium,
  nextPowerOfTwo,
  roundName,
  getMatch,
  entryById,
} from '../src/bracket.js';
import {
  parseEntryLines,
  distributeOwners,
  bracketShape,
  buildEntries,
  exampleFor,
} from '../src/setup.js';
import { championsFor, applyStandIn, randomStandIn, creditFor } from '../src/owners.js';

const makeEntries = (n) =>
  Array.from({ length: n }, (_, i) => ({ text: `Entry ${i + 1}`, owner: `P${i % 3}` }));

/** Deterministic RNG so failures are reproducible. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function playThrough(state, rng) {
  let voted = 0;
  let guard = 0;
  while (!isComplete(state)) {
    if (guard++ > 500) throw new Error('tournament did not terminate');
    const match = currentMatch(state);
    assert.ok(match.slots[0] && match.slots[1], 'a played match has two real entries');
    resolveMatch(state, match.slots[rng() < 0.5 ? 0 : 1]);
    voted++;
  }
  return voted;
}

/* ─────────────────────────── owners ─────────────────────────── */

const ownedEntries = (specs) => specs.map(([text, owner]) => ({ text, owner }));

function championsOf(state, match) {
  return championsFor(state, match, (id) => entryById(state, id));
}

/** Play a whole tournament, resolving stand-ins at random, and log champions. */
function playWithChampions(state, rng, standIn = (clash) => randomStandIn(clash, rng)) {
  const log = [];
  let guard = 0;
  while (!isComplete(state)) {
    if (guard++ > 400) throw new Error('did not terminate');
    const match = currentMatch(state);
    let result = championsOf(state, match);
    if (result.clash) {
      applyStandIn(state, match, (id) => entryById(state, id), result.clash.slot, standIn(result.clash));
      result = championsOf(state, match);
    }
    log.push({
      round: match.round,
      thirdPlace: match.thirdPlace,
      entries: match.slots.map((id) => entryById(state, id).text),
      owners: [...match.owners],
    });
    resolveMatch(state, match.slots[rng() < 0.5 ? 0 : 1]);
  }
  return log;
}

test('the draw avoids pairing an owner against themselves when it can', () => {
  // Two entries each for four people: a clash-free first round always exists.
  const specs = [];
  for (const person of ['Ada', 'Mo', 'Yusuf', 'Kit']) {
    specs.push([`${person} 1`, person], [`${person} 2`, person]);
  }
  for (let seed = 1; seed <= 40; seed++) {
    const state = createTournament({ entries: ownedEntries(specs) }, seeded(seed));
    const clashes = state.byRound[0].filter((m) => {
      const [a, b] = m.slots.map((id) => (id ? entryById(state, id) : null));
      return a && b && a.owner === b.owner;
    });
    assert.equal(clashes.length, 0, `seed ${seed}: first round should be clash-free`);
  }
});

test('fixed owners: an unavoidable clash asks for a stand-in, and takes it', () => {
  // Ada owns three of four entries, so some match must pit Ada against Ada.
  const state = createTournament(
    { entries: ownedEntries([['A', 'Ada'], ['B', 'Ada'], ['C', 'Ada'], ['D', 'Mo']]) },
    seeded(4)
  );
  const clashes = [];
  const log = playWithChampions(state, seeded(9), (clash) => {
    clashes.push(clash);
    return clash.options[0];
  });
  assert.ok(clashes.length >= 1, 'at least one clash should need a stand-in');
  for (const clash of clashes) {
    assert.ok(!clash.options.includes(clash.person), 'the clashing owner is not an option');
    assert.deepEqual(clash.options, ['Mo']);
  }
  for (const match of log) {
    assert.notEqual(match.owners[0], match.owners[1], `${match.entries}: nobody argues both sides`);
  }
});

test('fixed owners: entries keep their owner when there is no clash', () => {
  const state = createTournament(
    { entries: ownedEntries([['A', 'Ada'], ['B', 'Mo'], ['C', 'Yusuf'], ['D', 'Kit']]) },
    seeded(6)
  );
  for (const match of playWithChampions(state, seeded(7))) {
    match.entries.forEach((text, i) => {
      const entry = state.entries.find((e) => e.text === text);
      assert.equal(match.owners[i], entry.owner, `${text} keeps ${entry.owner}`);
    });
  }
});

test('rotating champions: a new champion each round, never repeating an entry', () => {
  const people = ['Ada', 'Mo', 'Yusuf', 'Kit'];
  const entries = Array.from({ length: 16 }, (_, i) => ({
    text: `Item ${i + 1}`,
    owner: people[i % people.length],
  }));
  const state = createTournament({ entries, people, champions: 'rotate' }, seeded(21));
  const log = playWithChampions(state, seeded(22));

  const seenPerEntry = new Map();
  for (const match of log) {
    assert.notEqual(match.owners[0], match.owners[1], 'nobody argues both sides of a match');
    match.entries.forEach((text, i) => {
      const seen = seenPerEntry.get(text) || [];
      if (seen.includes(match.owners[i])) {
        // A repeat is only allowed when there was nobody fresh left to ask:
        // the opponent's champion is off limits for this side.
        const spare = people.filter((p) => !seen.includes(p) && p !== match.owners[1 - i]);
        assert.deepEqual(spare, [], `${text} repeated ${match.owners[i]} with ${spare} free`);
      }
      seen.push(match.owners[i]);
      seenPerEntry.set(text, seen);
    });
  }
  // The entry that went all the way was argued by several different people.
  const deepest = [...seenPerEntry.values()].sort((a, b) => b.length - a.length)[0];
  assert.ok(deepest.length >= 3);
  assert.equal(new Set(deepest).size, deepest.length);
});

test('rotating champions: an entry starts with the person it was assigned to', () => {
  const people = ['Ada', 'Mo'];
  const entries = [
    { text: 'A', owner: 'Ada' }, { text: 'B', owner: 'Mo' },
    { text: 'C', owner: 'Ada' }, { text: 'D', owner: 'Mo' },
  ];
  const state = createTournament({ entries, people, champions: 'rotate' }, seeded(31));
  for (const match of state.byRound[0]) {
    const owners = championsOf(state, match).owners;
    match.slots.forEach((id, i) => {
      assert.equal(owners[i], entryById(state, id).owner, 'round one uses the assigned owner');
    });
  }
});

test('rotating champions: with people exhausted, the least recent comes back', () => {
  // Two people, four rounds: repeats are unavoidable after round two.
  const people = ['Ada', 'Mo'];
  const entries = Array.from({ length: 16 }, (_, i) => ({
    text: `Item ${i + 1}`,
    owner: people[i % 2],
  }));
  const state = createTournament({ entries, people, champions: 'rotate' }, seeded(41));
  const log = playWithChampions(state, seeded(42));
  for (const match of log) {
    assert.notEqual(match.owners[0], match.owners[1], 'still never both sides');
    match.entries.forEach((text, i) => assert.ok(people.includes(match.owners[i])));
  }
  const winner = state.entries.find((e) => e.id === getMatch(state, state.finalId).winner);
  // It reached the final, so it was argued four times by only two people.
  assert.ok(winner.ownerHistory.length >= 4);
  assert.ok(new Set(winner.ownerHistory).size === 2, 'both people got a turn with it');

  // A champion can only come round twice running when the other side has
  // taken the only alternative — with three people that never happens.
  const three = ['Ada', 'Mo', 'Yusuf'];
  const wide = createTournament(
    {
      entries: Array.from({ length: 16 }, (_, i) => ({ text: `X${i}`, owner: three[i % 3] })),
      people: three,
      champions: 'rotate',
    },
    seeded(43)
  );
  playWithChampions(wide, seeded(44));
  for (const entry of wide.entries) {
    entry.ownerHistory.forEach((person, i) => {
      if (i > 0) assert.notEqual(person, entry.ownerHistory[i - 1], `${entry.text} twice running`);
    });
  }
});

test('no owners at all: champions stay empty and nothing clashes', () => {
  const state = createTournament({ entries: makeEntries(8).map((e) => ({ text: e.text })) }, seeded(5));
  assert.deepEqual(state.people, []);
  for (const match of playWithChampions(state, seeded(5))) {
    assert.deepEqual(match.owners, ['', '']);
  }
});

test('podium credit: the owner when fixed, the latest champion when rotating', () => {
  const people = ['Ada', 'Mo', 'Yusuf', 'Kit'];
  const entries = Array.from({ length: 8 }, (_, i) => ({ text: `Item ${i + 1}`, owner: people[i % 4] }));

  const fixed = createTournament({ entries, people }, seeded(51));
  playWithChampions(fixed, seeded(52));
  const goldFixed = podium(fixed).first;
  assert.equal(creditFor(fixed, goldFixed), goldFixed.owner);

  const rotating = createTournament({ entries, people, champions: 'rotate' }, seeded(51));
  playWithChampions(rotating, seeded(52));
  const goldRotating = podium(rotating).first;
  assert.equal(
    creditFor(rotating, goldRotating),
    goldRotating.ownerHistory[goldRotating.ownerHistory.length - 1]
  );
});

test('nextPowerOfTwo', () => {
  assert.equal(nextPowerOfTwo(2), 2);
  assert.equal(nextPowerOfTwo(3), 4);
  assert.equal(nextPowerOfTwo(14), 16);
  assert.equal(nextPowerOfTwo(16), 16);
  assert.equal(nextPowerOfTwo(17), 32);
});

test('the 14-entry example from the spec', () => {
  const state = createTournament({ entries: makeEntries(14) }, seeded(7));
  assert.equal(state.size, 16);
  assert.equal(state.byes, 2);
  assert.equal(state.rounds, 4);
  const firstRoundPlayed = state.byRound[0].filter((m) => !m.walkover).length;
  assert.equal(firstRoundPlayed, 6);
  assert.equal(state.byRound[0].filter((m) => m.walkover).length, 2);
});

test('every entry count from 2 to 40 produces a sound bracket', () => {
  for (let n = 2; n <= 40; n++) {
    const rng = seeded(n * 101 + 3);
    const state = createTournament({ entries: makeEntries(n) }, rng);
    const size = nextPowerOfTwo(n);

    assert.equal(state.size, size, `size for ${n}`);
    assert.equal(state.byes, size - n, `byes for ${n}`);

    // No first-round match is empty, and none has two byes.
    for (const match of state.byRound[0]) {
      assert.ok(match.slots[0] !== null, `${n}: empty match`);
    }

    // Every entry appears exactly once in round one.
    const seen = state.byRound[0].flatMap((m) => m.slots).filter(Boolean);
    assert.equal(new Set(seen).size, n, `${n}: entries placed once each`);

    const semis = n >= 3 ? state.byRound[state.rounds - 2] : [];
    const votedPlayoff = semis.length === 2 && semis.every((m) => !m.walkover);
    const voted = playThrough(state, rng);
    assert.equal(voted, n - 1 + (votedPlayoff ? 1 : 0), `${n}: matches voted on`);

    const { first, second, third } = podium(state);
    assert.ok(first && second, `${n}: gold and silver`);
    assert.notEqual(first.id, second.id);
    if (n >= 3) {
      assert.ok(third, `${n}: bronze`);
      assert.equal(new Set([first.id, second.id, third.id]).size, 3, `${n}: distinct podium`);
    }
  }
});

test('three entries: one bye, and bronze without a playoff', () => {
  const rng = seeded(11);
  const state = createTournament({ entries: makeEntries(3) }, rng);
  assert.equal(state.byes, 1);
  const semis = state.byRound[0];
  const voted = playThrough(state, rng);
  assert.equal(voted, 2); // one semifinal, then the final — the playoff is a walkover

  const { first, second, third } = podium(state);
  assert.ok(first && second && third);
  // The only semifinalist who actually lost takes third; the bye entry never did.
  const realSemi = semis.find((m) => !m.walkover);
  assert.equal(third.id, realSemi.loser);
  assert.equal(new Set([first.id, second.id, third.id]).size, 3);
});

test('two entries: a single match, no playoff', () => {
  const rng = seeded(5);
  const state = createTournament({ entries: makeEntries(2) }, rng);
  assert.equal(state.rounds, 1);
  assert.equal(state.thirdPlaceId, null);
  assert.equal(playThrough(state, rng), 1);
});

test('the third-place match takes the two semifinal losers, before the final', () => {
  const rng = seeded(42);
  const state = createTournament({ entries: makeEntries(8) }, rng);
  const finalIndex = state.order.indexOf(state.finalId);
  assert.equal(state.order[finalIndex - 1], state.thirdPlaceId);

  while (currentMatch(state).round < state.rounds - 1) {
    const match = currentMatch(state);
    resolveMatch(state, match.slots[0]);
  }
  const semis = state.byRound[state.rounds - 2];
  const playoff = getMatch(state, state.thirdPlaceId);
  assert.deepEqual(playoff.slots, [semis[0].loser, semis[1].loser]);
  assert.equal(currentMatch(state).id, state.thirdPlaceId); // played before the final
});

test('round names count back from the final', () => {
  assert.equal(roundName(3, 4), 'Final');
  assert.equal(roundName(2, 4), 'Semifinal');
  assert.equal(roundName(1, 4), 'Quarterfinal');
  assert.equal(roundName(0, 4), 'Round of 16');
  assert.equal(roundName(0, 5), 'Round of 32');
});

test('fewer than two entries is rejected', () => {
  assert.throws(() => createTournament({ entries: makeEntries(1) }), /at least 2/);
});

test('entry lines split on a comma when owners are asked for', () => {
  const parsed = parseEntryLines('Broccoli, Ada\n  Leek  \n\nFennel | Mo\nChard @ Kit', true);
  assert.deepEqual(parsed, [
    { text: 'Broccoli', owner: 'Ada' },
    { text: 'Leek', owner: '' },
    { text: 'Fennel', owner: 'Mo' },
    { text: 'Chard', owner: 'Kit' },
  ]);
});

test('entry text may itself contain commas — the owner is after the last one', () => {
  assert.deepEqual(parseEntryLines('The Good, the Bad and the Ugly, Ada', true), [
    { text: 'The Good, the Bad and the Ugly', owner: 'Ada' },
  ]);
});

test('without per-entry owners a comma is just part of the entry', () => {
  assert.deepEqual(parseEntryLines('The Good, the Bad and the Ugly\nBroccoli', false), [
    { text: 'The Good, the Bad and the Ugly', owner: '' },
    { text: 'Broccoli', owner: '' },
  ]);
});

test('owner modes decide whether entries are split', () => {
  const entriesText = 'Corn, buttered, Ada\nLeek, Mo';
  assert.deepEqual(buildEntries({ entriesText, ownerMode: 'entry' }), [
    { text: 'Corn, buttered', owner: 'Ada' },
    { text: 'Leek', owner: 'Mo' },
  ]);
  assert.deepEqual(buildEntries({ entriesText, ownerMode: 'none' }), [
    { text: 'Corn, buttered, Ada', owner: '' },
    { text: 'Leek, Mo', owner: '' },
  ]);
  const pooled = buildEntries(
    { entriesText, ownerMode: 'pool', peopleText: 'Kit' },
    seeded(2)
  );
  assert.deepEqual(pooled, [
    { text: 'Corn, buttered, Ada', owner: 'Kit' },
    { text: 'Leek, Mo', owner: 'Kit' },
  ]);
});

test('a people pool splits entries as evenly as possible', () => {
  const entries = makeEntries(7).map((e) => ({ text: e.text }));
  const owned = distributeOwners(entries, ['Ada', 'Mo', 'Yusuf'], seeded(3));
  const counts = new Map();
  for (const entry of owned) counts.set(entry.owner, (counts.get(entry.owner) || 0) + 1);
  assert.equal(counts.size, 3);
  assert.deepEqual([...counts.values()].sort(), [2, 2, 3]);
});

test('the example fills to match the owner mode on screen', () => {
  const perEntry = exampleFor('entry');
  assert.equal(perEntry.peopleText, '');
  assert.equal(perEntry.entriesText.split('\n')[0], 'Broccoli 🥦, Bibi');
  const owned = buildEntries({ entriesText: perEntry.entriesText, ownerMode: 'entry' });
  assert.equal(owned.length, 8);
  assert.deepEqual(owned.slice(0, 4), [
    { text: 'Broccoli 🥦', owner: 'Bibi' },
    { text: 'Tomato 🍅', owner: 'Pauli' },
    { text: 'Potato 🥔', owner: 'Marli' },
    { text: 'Carrot 🥕', owner: 'Leila' },
  ]);

  const pool = exampleFor('pool');
  assert.equal(pool.peopleText, 'Bibi, Pauli, Marli, Leila');
  assert.equal(pool.entriesText.split('\n')[0], 'Broccoli 🥦');
  const shared = buildEntries(
    { entriesText: pool.entriesText, ownerMode: 'pool', peopleText: pool.peopleText },
    seeded(2)
  );
  const counts = new Map();
  for (const entry of shared) counts.set(entry.owner, (counts.get(entry.owner) || 0) + 1);
  assert.deepEqual([...counts.values()], [2, 2, 2, 2], 'two entries each');

  const none = exampleFor('none');
  assert.equal(none.peopleText, '');
  assert.equal(none.entriesText.includes(','), false, 'no owners inline');
  assert.deepEqual(
    buildEntries({ entriesText: none.entriesText, ownerMode: 'none' })[0],
    { text: 'Broccoli 🥦', owner: '' }
  );
});

test('bracket shape drives the setup preview', () => {
  assert.equal(bracketShape(1), null);
  assert.deepEqual(bracketShape(14), {
    count: 14, size: 16, byes: 2, rounds: 4, firstRoundMatches: 6,
  });
});
