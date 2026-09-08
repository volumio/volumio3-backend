'use strict';

var assert = require('assert');
var queueWithPlayNext = require('../app/playqueue-order').queueWithPlayNext;

/** A queue row, reduced to the field play next keys on. */
function row (uri) {
  return { uri: uri };
}

function uris (queue) {
  return queue.map(function (item) { return item.uri; });
}

describe('play next ordering', function () {
  it('inserts the new tracks right after the track playing now', function () {
    var queue = [row('a'), row('b'), row('c')];

    var next = queueWithPlayNext(queue, [row('x'), row('y')], 1);

    assert.deepStrictEqual(uris(next), ['a', 'b', 'x', 'y', 'c']);
  });

  it('leaves the playing row where it is, so the player keeps its position', function () {
    var queue = [row('a'), row('b'), row('c')];

    var next = queueWithPlayNext(queue, [row('x')], 1);

    assert.strictEqual(next[1].uri, 'b');
  });

  it('queues a list that already is the whole queue after the current track', function () {
    // The reported bug: playing a playlist, then asking for it to play next.
    // Every row matches, so a whole-queue de-duplication emptied the queue and
    // refilled it with the same rows in the same order — a pushQueue the
    // client could not tell apart from the one it had.
    var playlist = [row('t1'), row('t2'), row('t3')];
    var queue = playlist.slice();

    var next = queueWithPlayNext(queue, playlist.slice(), 0);

    assert.notDeepStrictEqual(uris(next), uris(queue));
    assert.deepStrictEqual(uris(next), ['t1', 't1', 't2', 't3']);
    assert.strictEqual(next[0].uri, 't1');
  });

  it('moves a block already queued ahead rather than queueing it twice', function () {
    var queue = [row('a'), row('b'), row('c'), row('x'), row('y')];

    var next = queueWithPlayNext(queue, [row('x'), row('y')], 1);

    assert.deepStrictEqual(uris(next), ['a', 'b', 'x', 'y', 'c']);
  });

  it('is idempotent: pressing play next twice queues one copy', function () {
    var queue = [row('a'), row('b'), row('c')];
    var items = [row('x'), row('y')];

    var once = queueWithPlayNext(queue, items, 1);
    var twice = queueWithPlayNext(once, items, 1);

    assert.deepStrictEqual(uris(twice), uris(once));
  });

  it('never deletes rows the listener has already played', function () {
    var queue = [row('a'), row('x'), row('b'), row('c')];

    // 'x' sits behind the current track: keep it, and keep the index of the
    // playing row valid. The old code removed it and then spliced at a stale
    // index, which both dropped history and left currentPosition pointing at
    // a different track than the one playing.
    var next = queueWithPlayNext(queue, [row('x')], 2);

    assert.deepStrictEqual(uris(next), ['a', 'x', 'b', 'x', 'c']);
    assert.strictEqual(next[2].uri, 'b');
  });

  it('appends when nothing is playing yet', function () {
    var next = queueWithPlayNext([], [row('x')], 0);

    assert.deepStrictEqual(uris(next), ['x']);
  });

  it('leaves the queue alone when the uri exploded to nothing', function () {
    var queue = [row('a'), row('b')];

    var next = queueWithPlayNext(queue, [], 0);

    assert.deepStrictEqual(uris(next), ['a', 'b']);
    assert.notStrictEqual(next, queue);
  });
});
