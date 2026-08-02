# Bracket Battle

A browser party game where anything can compete. Drop in a list of entries — vegetables,
films, cities, whatever the room agrees on — and the app seeds them into a knockout
bracket. Players pitch their entry, everyone taps the winner, and it plays down to a
gold / silver / bronze podium.

One device, one screen. Works round a table or shared over a call. No accounts, no
backend, no network — the game lives in memory for the session.

## Playing

1. **Setup** — a category (optional), your entries one per line, optional owners, and a
   pitch timer.
2. **Match** — two cards, one tap. The timer is a visual aid for the spoken pitch; nothing
   is enforced.
3. **Podium** — first, second and third, with the full bracket showing who beat whom.

Owners work two ways: write them per entry after a comma (`Broccoli, Ada` — `|`, `@` and
`—` also work), or hand the app a pool of people and it shares the entries out randomly
and evenly. The split takes the *last* comma on the line, so entry text can contain one:
`The Good, the Bad and the Ugly, Ada`. With owners off, the whole line is the entry.

The bracket sits under the current match as you play, so the room can see where the
tournament stands without leaving the battle.

## Who argues each match

Two ways to run it, chosen at setup.

**Owner sticks.** An entry keeps its owner all the way. Nobody should have to argue
against themselves, so the first-round draw is built to avoid pairing an owner with their
own entry. Deeper in the bracket that can become unavoidable — if Ada's two entries meet
in the semifinal, the match screen stops and asks the room who argues the other side,
with a chip per person and a Random button. The stand-in is marked on the card and holds
for that match only; the entry still belongs to Ada on the podium.

**Shuffle each round.** Every match draws a fresh champion. An entry starts with whoever
it was assigned to, and after that nobody argues the same entry twice while someone else
is still free — and never both sides of one match. When an entry outlives the guest list
(four people, five rounds) the least recent champion comes back rather than the game
stalling. The podium credits whoever argued the entry last.

Keyboard on the match screen: <kbd>1</kbd> / <kbd>2</kbd> (or the arrow keys) pick a
winner, <kbd>Space</kbd> starts and pauses the timer.

## The bracket

Any number of entries from 2 upward — no need for a power of two. The list is shuffled,
padded up to the next power of two, and the difference is handed out as **byes**: at most
one per first-round match, assigned at random, so nobody meets an empty chair.

> 14 entries → a 16-slot bracket → 2 byes and 6 first-round matches.

Before the final, the two beaten semifinalists play a third-place match. When a
semifinal was itself a bye there is only one real loser, and they take third without a
playoff.

## Running it

It is plain static HTML, CSS and ES modules — no build step. Because it uses ES modules,
open it through a server rather than `file://`:

```sh
npm start          # then visit http://localhost:8080
```

Tests cover the bracket rules (every entry count from 2 to 40, bye placement, the
third-place path, owner distribution):

```sh
npm test
```

## Deploying to GitHub Pages

The repository root *is* the site. In **Settings → Pages**, serve from a branch and pick
`/ (root)`. For a custom subdomain, add a `CNAME` file containing the host (for example
`play.example.org`) and point a DNS `CNAME` record at `<user>.github.io`.

## Layout

| Path | What it holds |
| --- | --- |
| `index.html` | The three screens: setup, match, podium |
| `styles.css` | Neo-brutalist styling — flat colour, thick borders, hard shadows |
| `src/bracket.js` | Tournament rules: seeding, byes, progression, podium. No DOM |
| `src/owners.js` | Who argues what: clash-free draws, stand-ins, rotation. No DOM |
| `src/setup.js` | Parsing entries, owners and people pools. No DOM |
| `src/random.js` | Shuffling, with an injectable rng so games can be replayed |
| `src/ui.js` | Rendering and input handling |
| `tests/` | Node test-runner tests for the logic modules |

Game state and rules are kept clear of the DOM on purpose: a future version where people
vote from their own devices can drive the same state machine from a server without a
rewrite.
