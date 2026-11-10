'use strict';

var assert = require('assert');
var MpdClient = require('../app/plugins/music_service/mpd/lib/mpd.js');

// A client with a fake socket: records what would be written to MPD
function fakeClient () {
  var client = new MpdClient();
  client.written = [];
  client.socket = {write: function (data) { client.written.push(data); }};
  return client;
}

describe('mpd client, connection loss', function () {
  it('calls back with an error when a command is sent before the connection is ready', function (done) {
    var client = fakeClient();
    var errors = [];
    client.on('error', function (err) { errors.push(err); });

    client.sendCommand(MpdClient.cmd('status', []), function (err, msg) {
      assert.ok(err instanceof Error);
      assert.strictEqual(msg, undefined);
      assert.strictEqual(errors.length, 1, 'the error is also emitted once');
      assert.strictEqual(client.written.length, 0, 'nothing is written to the socket');
      done();
    });
  });

  it('emits the error once when a command without callback is sent before ready', function () {
    var client = fakeClient();
    var errors = [];
    client.on('error', function (err) { errors.push(err); });

    client.sendCommand(MpdClient.cmd('status', []));
    assert.strictEqual(errors.length, 1);
  });

  it('fails every pending command when the connection drops', function () {
    var client = fakeClient();
    var errors = [];
    client.on('error', function (err) { errors.push(err); });

    client.receive('OK MPD 0.24.6\n');
    assert.strictEqual(client.idling, true, 'the client idles after the banner');

    var results = [];
    client.sendCommand(MpdClient.cmd('status', []), function (err, msg) { results.push([err, msg]); });
    client.sendCommand(MpdClient.cmd('stats', []), function (err, msg) { results.push([err, msg]); });
    assert.strictEqual(results.length, 0, 'no reply yet');

    client.failPending(new Error('MPD connection closed'));

    assert.strictEqual(results.length, 2, 'both commands were called back');
    results.forEach(function (r) {
      assert.ok(r[0] instanceof Error);
      assert.strictEqual(r[0].message, 'MPD connection closed');
      assert.strictEqual(r[1], undefined);
    });
    assert.strictEqual(client.msgHandlerQueue.length, 0, 'nothing is left waiting');
    assert.ok(errors.length >= 1, 'the idle loop reports the loss on the error event');
  });

  it('rejects commands sent after the connection dropped', function (done) {
    var client = fakeClient();
    client.on('error', function () {});
    client.receive('OK MPD 0.24.6\n');

    client.idling = false;
    client.failPending(new Error('MPD connection closed'));
    client.sendCommand(MpdClient.cmd('status', []), function (err) {
      assert.ok(err instanceof Error);
      done();
    });
  });
});
