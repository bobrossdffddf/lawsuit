'use strict';

/**
 * Drives the "Continue (5)" button on the government-claim wizard down to zero
 * and then enables it.
 *
 * Three things this has to get right:
 *
 *  - It runs detached, because the interaction is already acknowledged and the
 *    caller must not block for five seconds.
 *  - Only ONE countdown may own a given draft. Pressing Continue or Cancel
 *    mid-tick registers a new generation, and the older loop notices and stops
 *    instead of overwriting the newer panel (or resurrecting a cancelled one).
 *  - A transient edit failure must not brick the button. Individual ticks are
 *    allowed to fail; the final "enabled" render is retried, because that is the
 *    one that lets the filer continue at all.
 */

const generations = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Invalidates any countdown currently running for this key. */
function cancelCountdown(key) {
  generations.set(key, (generations.get(key) ?? 0) + 1);
}

/**
 * @param {string|number} key      usually the draft id
 * @param {object} interaction     already-acknowledged interaction
 * @param {(remaining: number) => object} render
 * @param {number} seconds
 */
function startCountdown(key, interaction, render, seconds) {
  const generation = (generations.get(key) ?? 0) + 1;
  generations.set(key, generation);
  const current = () => generations.get(key) === generation;

  void (async () => {
    for (let n = seconds - 1; n >= 1; n -= 1) {
      await sleep(1000);
      if (!current()) return;
      // A dropped tick is cosmetic — keep going so we still reach the unlock.
      await interaction.editReply(render(n)).catch(() => {});
    }

    await sleep(1000);
    if (!current()) return;

    // This render is the one that matters: without it the button stays greyed
    // out forever, so give it a couple of attempts.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!current()) return;
      try {
        await interaction.editReply(render(0));
        return;
      } catch {
        await sleep(750);
      }
    }
  })();
}

module.exports = { startCountdown, cancelCountdown };
