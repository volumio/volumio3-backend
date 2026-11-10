'use strict';

var assert = require('assert');
var EventEmitter = require('events').EventEmitter;
var libQ = require('kew');
var libMpd = require('../app/plugins/music_service/mpd/lib/mpd.js');
var ControllerMpd = require('../app/plugins/music_service/mpd/index.js');

// A client as lib/mpd.js hands it out: an emitter with a socket
function fakeClient () {
  var client = new EventEmitter();
  client.socket = {destroyed: false, destroy: function () { client.socket.destroyed = true; }};
  client.sendCommand = function (command, callback) { callback(null, ''); };
  return client;
}

describe('mpd reconnect', function () {
  var realSetTimeout = global.setTimeout;
  var realClearTimeout = global.clearTimeout;
  var realConnect = libMpd.connect;
  var timers;
  var cleared;
  var clients;
  var mpd;

  beforeEach(function () {
    timers = [];
    cleared = [];
    clients = [];
    global.setTimeout = function (fn, delay) {
      var id = {fn: fn, delay: delay};
      timers.push(id);
      return id;
    };
    global.clearTimeout = function (id) { cleared.push(id); };
    libMpd.connect = function () {
      var client = fakeClient();
      clients.push(client);
      return client;
    };

    mpd = Object.create(ControllerMpd.prototype);
    mpd.context = {coreCommand: {pushConsoleMessage: function () {}}};
    mpd.logger = {info: function () {}, error: function () {}, verbose: function () {}};
    mpd.config = {get: function () { return undefined; }};
    mpd.updateQueue = function () {};
    mpd.pushed = [];
    mpd.getState = function () { return libQ.resolve({status: 'stop', updatedb: false}); };
    mpd.pushState = function (state) { mpd.pushed.push(state); return libQ.resolve(); };
  });

  afterEach(function () {
    global.setTimeout = realSetTimeout;
    global.clearTimeout = realClearTimeout;
    libMpd.connect = realConnect;
  });

  function settle (fn) {
    return new Promise(function (resolve) { setImmediate(resolve); }).then(fn);
  }

  it('reconnects once after a clean close, retires the old client and syncs state', function () {
    mpd.mpdEstablish();
    var first = clients[0];
    first.emit('ready');
    var startupTimers = timers.length;

    first.emit('end');
    first.emit('end');
    first.emit('error', Object.assign(new Error('read ECONNRESET'), {code: 'ECONNRESET'}));
    assert.strictEqual(timers.length, startupTimers + 1, 'one reconnect timer for three loss events');
    var timer = timers[timers.length - 1];
    assert.strictEqual(timer.delay, 5000);

    timer.fn();
    assert.strictEqual(clients.length, 2, 'a new client');
    assert.strictEqual(mpd.clientMpd, clients[1]);
    assert.strictEqual(first.socket.destroyed, true, 'the old socket is destroyed');
    assert.deepStrictEqual(first.eventNames(), ['error'], 'only the no-op error listener is left on the old client');
    first.emit('error', new Error('late'));

    clients[1].emit('ready');
    return settle(function () {
      assert.strictEqual(mpd.pushed.length, 1, 'state pushed once after the lost connection came back');
      assert.strictEqual(mpd.pushed[0].updatedb, false);
    });
  });

  it('reconnects on connection error codes and only logs the rest', function () {
    mpd.mpdEstablish();
    var client = clients[0];
    client.emit('ready');
    var before = timers.length;

    client.emit('error', Object.assign(new Error('nope'), {code: 'EACCES'}));
    client.emit('error', 'The expression evaluated to a falsy value');
    assert.strictEqual(timers.length, before, 'no reconnect for an unrelated error');

    client.emit('error', Object.assign(new Error('connect ECONNREFUSED'), {code: 'ECONNREFUSED'}));
    assert.strictEqual(timers.length, before + 1);
    assert.strictEqual(timers[timers.length - 1].delay, 5000);
  });

  it('drops the pending reconnect when restartMpd establishes first, and does not sync state then', function () {
    mpd.mpdEstablish();
    var client = clients[0];
    client.emit('ready');

    client.emit('end');
    var timer = timers[timers.length - 1];
    assert.strictEqual(timer.delay, 5000);

    mpd.mpdEstablish();
    assert.deepStrictEqual(cleared, [timer], 'the pending reconnect was cancelled');
    assert.strictEqual(clients.length, 2);
    assert.strictEqual(client.socket.destroyed, true);

    clients[1].emit('ready');
    return settle(function () {
      assert.strictEqual(mpd.pushed.length, 0, 'an explicit restart handles its own state');
    });
  });
});
