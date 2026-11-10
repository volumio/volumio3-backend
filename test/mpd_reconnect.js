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
  var stateMachine;
  var events;

  beforeEach(function () {
    timers = [];
    cleared = [];
    clients = [];
    events = [];
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

    // The state machine as the plugin sees it: nothing playing, empty queue
    stateMachine = {
      isVolatile: false,
      isConsume: false,
      consumeUpdateService: undefined,
      currentStatus: 'stop',
      currentPosition: 0,
      track: undefined,
      getTrack: function () { return stateMachine.track; }
    };

    mpd = Object.create(ControllerMpd.prototype);
    mpd.context = {coreCommand: {
      pushConsoleMessage: function () {},
      stateMachine: stateMachine,
      volumioStop: function () {
        events.push('stop');
        stateMachine.currentStatus = 'stop';
        return libQ.resolve();
      }
    }};
    mpd.logger = {info: function () {}, error: function () {}, verbose: function () {}};
    mpd.config = {get: function () { return undefined; }};
    mpd.updateQueue = function () {};
    mpd.mpdState = {status: 'stop', updatedb: false};
    mpd.stateReads = 0;
    mpd.getState = function () { mpd.stateReads++; return libQ.resolve(mpd.mpdState); };
    mpd.pushState = function (state) { events.push('push ' + state.status); return libQ.resolve(); };
  });

  afterEach(function () {
    global.setTimeout = realSetTimeout;
    global.clearTimeout = realClearTimeout;
    libMpd.connect = realConnect;
  });

  function settle (fn) {
    return new Promise(function (resolve) { setImmediate(resolve); }).then(fn);
  }

  // Establish, lose the connection, let the reconnect timer fire, ready again
  function loseAndRecover () {
    mpd.mpdEstablish();
    clients[0].emit('ready');
    clients[0].emit('end');
    timers[timers.length - 1].fn();
    clients[1].emit('ready');
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
      assert.deepStrictEqual(events, ['push stop'], 'state pushed once, nothing stopped');
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
      assert.deepStrictEqual(events, [], 'an explicit restart handles its own state');
    });
  });

  it('stops the state machine before pushing a stopped MPD that was playing an MPD track', function () {
    stateMachine.currentStatus = 'play';
    stateMachine.track = {service: 'mpd'};
    mpd.mpdState = {status: 'stop', updatedb: false};

    loseAndRecover();
    return settle(function () {
      assert.deepStrictEqual(events, ['stop', 'push stop'], 'stopped first, so the push is not an end of track');
    });
  });

  it('does the same for a service that plays through MPD in consume mode', function () {
    stateMachine.currentStatus = 'play';
    stateMachine.isConsume = true;
    stateMachine.consumeUpdateService = 'mpd';
    stateMachine.track = {service: 'tidal'};

    loseAndRecover();
    return settle(function () {
      assert.deepStrictEqual(events, ['stop', 'push stop']);
    });
  });

  it('does not stop anything when MPD comes back still playing', function () {
    stateMachine.currentStatus = 'play';
    stateMachine.track = {service: 'mpd'};
    mpd.mpdState = {status: 'play', updatedb: false};

    loseAndRecover();
    return settle(function () {
      assert.deepStrictEqual(events, ['push play']);
    });
  });

  it('does not stop the state machine for a track of another service', function () {
    stateMachine.currentStatus = 'play';
    stateMachine.track = {service: 'spop'};

    loseAndRecover();
    return settle(function () {
      assert.deepStrictEqual(events, ['push stop'], 'the state machine ignores a push from a service that is not playing');
    });
  });

  it('leaves a volatile service alone', function () {
    stateMachine.isVolatile = true;
    stateMachine.currentStatus = 'play';

    loseAndRecover();
    return settle(function () {
      assert.strictEqual(mpd.stateReads, 0, 'MPD was not even asked');
      assert.deepStrictEqual(events, []);
    });
  });

  it('rejects what waited on a client that was replaced before it was ready', function () {
    mpd.mpdEstablish();
    var waited = mpd.mpdReady;
    var first = clients[0];

    mpd.mpdEstablish();
    assert.deepStrictEqual(first.eventNames(), ['error']);
    return waited.then(function () {
      throw new Error('the ready promise of the replaced connection should reject');
    }, function (err) {
      assert.strictEqual(err.message, 'MPD connection replaced before it was ready');
    });
  });

  it('tells MPD tracks and consume services through MPD from the rest', function () {
    mpd.commandRouter = mpd.context.coreCommand;
    assert.strictEqual(mpd.mpdIsThePlayer(), false, 'empty queue');
    stateMachine.track = {service: 'mpd'};
    assert.strictEqual(mpd.mpdIsThePlayer(), true, 'an MPD track');
    stateMachine.track = {service: 'spop'};
    assert.strictEqual(mpd.mpdIsThePlayer(), false, 'another service');
    stateMachine.isConsume = true;
    stateMachine.consumeUpdateService = 'mpd';
    assert.strictEqual(mpd.mpdIsThePlayer(), true, 'a consume service through MPD');
    stateMachine.isVolatile = true;
    assert.strictEqual(mpd.mpdIsThePlayer(), false, 'volatile wins');
  });
});
