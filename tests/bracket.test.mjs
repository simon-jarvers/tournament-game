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
} from '../src/bracket.js';
import { parseEntryLines, distributeOwners, bracketShape } from '../src/setup.js';

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

test('entry lines parse text and optional owner', () => {
  const parsed = parseEntryLines('Broccoli | Ada\n  Leek  \n\nFennel @ Mo\nChard — Kit');
  assert.deepEqual(parsed, [
    { text: 'Broccoli', owner: 'Ada' },
    { text: 'Leek', owner: '' },
    { text: 'Fennel', owner: 'Mo' },
    { text: 'Chard', owner: 'Kit' },
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

test('bracket shape drives the setup preview', () => {
  assert.equal(bracketShape(1), null);
  assert.deepEqual(bracketShape(14), {
    count: 14, size: 16, byes: 2, rounds: 4, firstRoundMatches: 6,
  });
});
