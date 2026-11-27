'use strict';

var assert = require('assert');
var ControllerMpd = require('../app/plugins/music_service/mpd/index.js');

// `count` songs, `perAlbum` to an album, each album by its own artist
function makeSongs (count, perAlbum, prefix) {
  var songs = [];
  for (var i = 0; i < count; i++) {
    var album = Math.floor(i / perAlbum);
    songs.push({
      file: prefix + '/album' + album + '/track' + i + '.flac',
      album: prefix + ' album ' + album,
      artist: prefix + ' artist ' + album
    });
  }
  return songs;
}

// A fake MPD client that answers 'search album "" window START:END' from
// `songs`, one tick later as the real one does. `onReply(n)` runs just before
// the reply to the n-th command is delivered. The `mute`-th command is never
// answered, as if the connection had gone; its callback is kept in `pending`
// and `onMute()` runs when that happens.
function fakeClient (songs) {
  var client = {songs: songs, commands: [], pending: [], onReply: null, mute: 0, onMute: null};
  client.sendCommand = function (command, callback) {
    var text = String(command).trim();
    var m = text.match(/window (\d+):(\d+)$/);
    client.commands.push(text);
    if (client.commands.length === client.mute) {
      client.pending.push(callback);
      if (client.onMute) {
        client.onMute();
      }
      return;
    }
    var reply = client.songs.slice(Number(m[1]), Number(m[2])).map(function (s) {
      return 'file: ' + s.file + '\nAlbum: ' + s.album + '\nAlbumArtist: ' + s.artist + '\nDate: 2001\n';
    }).join('');
    setImmediate(function () {
      if (client.onReply) {
        client.onReply(client.commands.length);
      }
      callback(null, reply);
    });
  };
  return client;
}

function albumsOf (songs) {
  var seen = {};
  songs.forEach(function (s) { seen[s.album] = true; });
  return Object.keys(seen).sort();
}

function titlesOf (response) {
  return response.navigation.lists[0].items.map(function (item) { return item.title; }).sort();
}

describe('mpd album list in windows', function () {
  var mpd = Object.create(ControllerMpd.prototype);
  mpd.logger = {info: function () {}, error: function () {}, verbose: function () {}};
  mpd.getAlbumArt = function () { return '/albumart'; };
  var lost;

  it('reads the library in windows and lists every album once', function () {
    var songs = makeSongs(25000, 10, 'a');
    mpd.clientMpd = fakeClient(songs);

    return mpd.listAlbums(true).then(function (response) {
      assert.deepStrictEqual(mpd.clientMpd.commands, [
        'search album "" window 0:10000',
        'search album "" window 10000:20000',
        'search album "" window 20000:30000'
      ]);
      assert.strictEqual(response.navigation.lists[0].items.length, 2500);
      assert.deepStrictEqual(titlesOf(response), albumsOf(songs));
      assert.strictEqual(response.navigation.lists[0].items[0].uri, 'albums://a%20artist%200/a%20album%200');
    });
  });

  it('serves the next call from the cache', function () {
    mpd.clientMpd = fakeClient([]);

    return mpd.listAlbums(true).then(function (response) {
      assert.strictEqual(mpd.clientMpd.commands.length, 0, 'MPD was not asked');
      assert.strictEqual(response.navigation.lists[0].items.length, 2500);
    });
  });

  it('lets callers that arrive during a scan share it', function () {
    var songs = makeSongs(15000, 10, 'b');
    mpd.clientMpd = fakeClient(songs);

    mpd.rebuildAlbumCache();
    var first = mpd.listAlbums(true);
    var second = mpd.listAlbums(true);
    return first.then(function (r1) {
      return second.then(function (r2) {
        assert.strictEqual(r1, r2, 'one result for everyone');
        assert.strictEqual(mpd.clientMpd.commands.length, 2, 'one scan of two windows');
        assert.deepStrictEqual(titlesOf(r1), albumsOf(songs));
      });
    });
  });

  it('reads the windows again when the database changed under the scan', function () {
    var songs = makeSongs(25000, 10, 'c');
    var client = fakeClient(songs);
    mpd.clientMpd = client;
    client.onReply = function (n) {
      if (n === 1) {
        // After the first window: the first 15 songs are gone, so the album
        // that was at songs 10000-10009 now sits at 9985-9994, below the next
        // window. MPD reports the change as the database handler would.
        client.songs = songs.slice(15);
        client.onReply = null;
        mpd.rebuildAlbumCache();
      }
    };

    mpd.rebuildAlbumCache();
    return mpd.listAlbums(true).then(function (response) {
      assert.deepStrictEqual(titlesOf(response), albumsOf(songs.slice(15)), 'no album skipped, none kept');
      assert.strictEqual(client.commands.length, 6, 'three windows, then three again');
    });
  });

  it('starts a fresh scan after one failed', function () {
    var client = fakeClient(makeSongs(5, 1, 'd'));
    var answer = client.sendCommand;
    var failOnce = true;
    client.sendCommand = function (command, callback) {
      if (failOnce) {
        failOnce = false;
        setImmediate(function () { callback(new Error('MPD connection closed')); });
      } else {
        answer(command, callback);
      }
    };
    mpd.clientMpd = client;

    mpd.rebuildAlbumCache();
    return mpd.listAlbums(true).then(function () {
      throw new Error('the joined call should fail with the scan');
    }, function (err) {
      assert.strictEqual(err.message, 'Cannot list albums');
      return mpd.listAlbums(true);
    }).then(function (response) {
      assert.strictEqual(response.navigation.lists[0].items.length, 5);
    });
  });

  it('releases a scan whose connection was replaced and reads again on the new one', function () {
    var songs = makeSongs(15000, 10, 'e');
    var before = fakeClient(songs);
    var after = fakeClient(songs.slice(0, 12000));
    lost = before;
    mpd.clientMpd = before;

    return new Promise(function (resolve, reject) {
      var first;
      // The second window is never answered: the connection is gone
      before.mute = 2;
      before.onMute = function () {
        setImmediate(function () {
          // Reconnected: a new client. The next caller finds the old scan on it.
          mpd.clientMpd = after;
          var second = mpd.listAlbums(true);
          first.then(function () {
            reject(new Error('the scan on the lost connection should fail'));
          }, function (err) {
            try {
              assert.strictEqual(err.message, 'MPD connection lost');
            } catch (e) {
              return reject(e);
            }
            second.then(function (response) {
              try {
                assert.deepStrictEqual(titlesOf(response), albumsOf(after.songs));
                assert.strictEqual(before.commands.length, 2, 'the old scan got no further');
                assert.strictEqual(after.commands.length, 2, 'the library was read on the new connection');
                resolve();
              } catch (e) {
                reject(e);
              }
            }, reject);
          });
        });
      };

      mpd.rebuildAlbumCache();
      first = mpd.listAlbums(true);
    });
  });

  it('ignores a late reply from the replaced connection', function () {
    // The window the previous test left unanswered is answered now, to nobody
    var pending = lost.pending[0];
    pending(null, 'file: e/late.flac\nAlbum: late\nAlbumArtist: late\n');

    return mpd.listAlbums(true).then(function (response) {
      assert.strictEqual(response.navigation.lists[0].items.length, 1200, 'the cache holds the new scan');
      assert.strictEqual(lost.commands.length, 2);
    });
  });

  it('does not finish a scan with a reply from a replaced connection', function () {
    var songs = makeSongs(15000, 10, 'f');
    var before = fakeClient(songs);
    var after = fakeClient(songs.slice(0, 11000));
    mpd.clientMpd = before;

    return new Promise(function (resolve, reject) {
      var first;
      before.mute = 2;
      before.onMute = function () {
        setImmediate(function () {
          // Reconnected, nobody has asked for albums yet, and the old
          // connection's reply to the last window turns up: a short one, which
          // would end the scan with the first window's albums only
          mpd.clientMpd = after;
          before.pending[0](null, '');
          first.then(function () {
            reject(new Error('a scan on the old connection should not finish'));
          }, function (err) {
            try {
              assert.strictEqual(err.message, 'MPD connection lost');
            } catch (e) {
              return reject(e);
            }
            mpd.listAlbums(true).then(function (response) {
              try {
                assert.deepStrictEqual(titlesOf(response), albumsOf(after.songs), 'read on the new connection, not cached from the old');
                assert.strictEqual(after.commands.length, 2);
                resolve();
              } catch (e) {
                reject(e);
              }
            }, reject);
          });
        });
      };

      mpd.rebuildAlbumCache();
      first = mpd.listAlbums(true);
    });
  });
});
