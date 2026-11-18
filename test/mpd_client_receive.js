'use strict';

var assert = require('assert');
var MpdClient = require('../app/plugins/music_service/mpd/lib/mpd.js');

// A client with a fake socket: records what would be written to MPD
function fakeClient () {
  var client = new MpdClient();
  client.written = [];
  client.socket = {write: function (data) { client.written.push(data); }};
  client.on('error', function () {});
  return client;
}

// Hand `text` to the client in reads of `size` characters
function feed (client, text, size) {
  for (var i = 0; i < text.length; i += size) {
    client.receive(text.substring(i, i + size));
  }
}

describe('mpd client, reply parsing', function () {
  var banner = 'OK MPD 0.24.6\n';
  var status = 'volume: 100\nrepeat: 0\nstate: play\n';

  it('starts idling once the banner line is complete', function () {
    var client = fakeClient();
    var ready = 0;
    client.on('ready', function () { ready++; });

    client.receive('OK MPD 0.24.6');
    assert.strictEqual(ready, 0, 'not before the newline');
    client.receive('\n');
    assert.strictEqual(ready, 1);
    assert.strictEqual(client.idling, true);
    assert.deepStrictEqual(client.written, ['idle\n']);
  });

  it('delivers the same replies whatever the read boundaries', function () {
    // After the banner the client idles. sendCommand sends noidle (MPD answers
    // the pending idle with OK), the command, then idle again (answered when
    // something changes).
    var rest = 'OK\n' + status + 'OK\n' + 'changed: player\nOK\n';
    [1, 2, 3, 5, 7, 11, 64, 1000].forEach(function (size) {
      var client = fakeClient();
      var got = [];
      client.on('system', function (name) { got.push('system ' + name); });

      feed(client, banner, size);
      client.sendCommand(MpdClient.cmd('status', []), function (err, msg) { got.push([err, msg]); });
      feed(client, rest, size);

      assert.deepStrictEqual(got, [[null, status], 'system player'], 'read size ' + size);
      assert.deepStrictEqual(client.written, ['idle\n', 'noidle\n', 'status \n', 'idle\n', 'idle\n']);
      assert.strictEqual(client.tail, '');
      assert.deepStrictEqual(client.parts, []);
    });
  });

  it('turns an ACK line into an error, also when the line arrives in two reads', function () {
    var client = fakeClient();
    feed(client, banner, 1000);
    var got = [];
    client.sendCommand(MpdClient.cmd('status', []), function (err, msg) { got.push([err, msg]); });

    client.receive('OK\nACK [5@0] {status} some');
    assert.strictEqual(got.length, 0, 'the ACK line is not complete yet');
    client.receive(' error\n');
    assert.strictEqual(got.length, 1);
    assert.ok(got[0][0] instanceof Error);
    assert.strictEqual(got[0][0].message, ' [5@0] {status} some error');
  });

  it('keeps a key whose value starts with OK as part of the reply', function () {
    var client = fakeClient();
    feed(client, banner, 1000);
    var got = [];
    client.sendCommand(MpdClient.cmd('currentsong', []), function (err, msg) { got.push(msg); });

    client.receive('OK\nfile: a.flac\nTitle: OK Computer\nAlbum: OK\nOK\n');
    assert.deepStrictEqual(got, ['file: a.flac\nTitle: OK Computer\nAlbum: OK\n']);
  });

  it('reassembles a large reply from many reads', function () {
    var client = fakeClient();
    feed(client, banner, 1000);
    var songs = [];
    for (var i = 0; i < 20000; i++) {
      songs.push('file: music/artist ' + i + '/album/track ' + i + '.flac\nLast-Modified: 2026-01-01T00:00:00Z\nFormat: 44100:16:2\nArtist: artist ' + i + '\nAlbum: album ' + (i % 500) + '\nTitle: track ' + i + '\nTrack: ' + (i % 12) + '\nDate: 2001\nTime: 231\nduration: 231.040\n');
    }
    var reply = songs.join('');
    var got = [];
    client.sendCommand(MpdClient.cmd('search album ""', []), function (err, msg) { got.push([err, msg]); });

    feed(client, 'OK\n' + reply + 'OK\n', 65536);
    assert.strictEqual(got.length, 1);
    assert.strictEqual(got[0][0], null);
    assert.strictEqual(got[0][1].length, reply.length);
    assert.strictEqual(got[0][1], reply);
  });
});
