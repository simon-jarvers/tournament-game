// Shared randomness. Every function takes an rng so games can be reproduced.

export function shuffle(list, rng = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pickOne(list, rng = Math.random) {
  return list.length ? list[Math.floor(rng() * list.length)] : null;
}
