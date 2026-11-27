'use strict';

/**
 * Where "play next" puts the tracks it was handed.
 *
 * Kept out of playqueue.js so it can be exercised on its own: it is pure
 * array arithmetic, and the index arithmetic is what used to be wrong.
 *
 * The rule, in order:
 *
 *  1. Everything up to and including the track playing now is left untouched.
 *     Those rows are history — silently deleting them (which is what a
 *     whole-queue de-duplication does) is how "play next" on the playlist you
 *     are already playing became a no-op: every row matched, the queue was
 *     emptied and then refilled with the very same rows, so the client got a
 *     pushQueue identical to the one it had and nothing appeared to happen.
 *
 *  2. The new rows go immediately after the track playing now.
 *
 *  3. Rows *after* that point which the new rows also contain are dropped, so
 *     pressing play next twice moves the block up rather than queueing it
 *     twice. This is the de-duplication the old code was reaching for, applied
 *     only where it cannot move the current track out from under the player.
 *
 * Because nothing at or before `currentPosition` is removed, the caller's
 * notion of which row is playing stays valid and no state has to be patched
 * up afterwards.
 *
 * @param {Array} arrayQueue      the queue as it stands
 * @param {Array} contentArray    the exploded tracks to play next
 * @param {number} currentPosition index of the row playing now
 * @returns {Array} the new queue
 */
function queueWithPlayNext (arrayQueue, contentArray, currentPosition) {
  var queue = Array.isArray(arrayQueue) ? arrayQueue : [];
  var items = Array.isArray(contentArray) ? contentArray : [];

  if (items.length === 0) {
    return queue.slice();
  }

  var position = typeof currentPosition === 'number' && currentPosition >= 0
    ? currentPosition
    : -1;
  var spliceIndex = Math.min(position + 1, queue.length);

  var head = queue.slice(0, spliceIndex);
  var tail = queue.slice(spliceIndex).filter(function (item) {
    return !items.some(function (newItem) {
      return item && newItem && newItem.uri === item.uri;
    });
  });

  return head.concat(items, tail);
}

module.exports = { queueWithPlayNext: queueWithPlayNext };
