/* eslint-env mocha */
const assert = require('assert');
const libQ = require('kew');

const CoreMusicLibrary = require('../app/musiclibrary');

// A command router that reports how many searches MPD is holding at once.
function mockRouter (onSearch) {
  return {
    logger: { info: () => {}, error: () => {} },
    calls: [],
    inFlight: 0,
    peakInFlight: 0,
    executeOnPlugin: function (type, name, method, query) {
      this.calls.push(name);
      this.inFlight++;
      this.peakInFlight = Math.max(this.peakInFlight, this.inFlight);
      const defer = libQ.defer();
      onSearch(this, query, (result) => {
        this.inFlight--;
        defer.resolve(result);
      });
      return defer.promise;
    }
  };
}

// kew swallows a throw inside .then(), which would turn a failed assertion into
// a mocha timeout. Run assertions here so the failure is the one you wrote.
function checking (resolve, reject, assertions) {
  return function (value) {
    try {
      assertions(value);
      resolve();
    } catch (e) {
      reject(e);
    }
  };
}

function library (router) {
  const lib = Object.create(CoreMusicLibrary.prototype);
  lib.commandRouter = router;
  lib.logger = router.logger;
  lib.librarySearchGate = libQ.resolve();
  return lib;
}

describe('CoreMusicLibrary search', function () {
  it('sends one library search to MPD at a time', function () {
    // MPD serves commands from a single thread and runs under WatchdogSec=20:
    // a batch of globalUri tracks used to put one library search each on it at
    // once, and systemd killed the daemon mid-playback.
    const held = [];
    const router = mockRouter((r, query, release) => held.push(release));
    const lib = library(router);

    const searches = [];
    for (let i = 0; i < 20; i++) {
      searches.push(lib.searchOnPlugin('music_service', 'mpd', { value: 'q' + i }, 60000));
    }

    return new Promise((resolve, reject) => {
      let released = 0;
      const drain = () => {
        if (held.length) {
          held.shift()();
          released++;
        }
        if (released < 20) return setTimeout(drain, 2);
        libQ.all(searches).then(checking(resolve, reject, () => {
          assert.strictEqual(router.peakInFlight, 1, 'library searches overlapped');
          assert.strictEqual(router.calls.length, 20, 'a library search was lost');
        }));
      };
      setTimeout(drain, 2);
    });
  });

  it('leaves searches on other sources concurrent', function () {
    const held = [];
    const router = mockRouter((r, query, release) => held.push(release));
    const lib = library(router);

    const searches = [];
    for (let i = 0; i < 5; i++) {
      searches.push(lib.searchOnPlugin('music_service', 'qobuz', { value: 'q' }, 60000));
    }

    return new Promise((resolve, reject) => {
      setTimeout(() => {
        while (held.length) held.shift()();
        libQ.all(searches).then(checking(resolve, reject, () => {
          assert.strictEqual(router.peakInFlight, 5, 'streaming searches were serialised');
        }));
      }, 20);
    });
  });

  it('does not send a library search whose caller already timed out', function () {
    const held = [];
    const router = mockRouter((r, query, release) => held.push(release));
    const lib = library(router);

    const first = lib.searchOnPlugin('music_service', 'mpd', { value: 'first' }, 60000);
    const second = lib.searchOnPlugin('music_service', 'mpd', { value: 'second' }, 30);

    return new Promise((resolve, reject) => {
      setTimeout(() => {
        held.shift()(); // first finishes, opening the gate for the timed-out second
        setTimeout(() => {
          libQ.all([first, second]).then(checking(resolve, reject, (results) => {
            assert.strictEqual(router.calls.length, 1, 'an abandoned search reached MPD');
            assert.strictEqual(results[1], null, 'the timed-out caller got no answer');
          }));
        }, 30);
      }, 80);
    });
  });

  it('reopens the gate when a library search fails', function () {
    let call = 0;
    const router = {
      logger: { info: () => {}, error: () => {} },
      executeOnPlugin: function () {
        const defer = libQ.defer();
        if (++call === 1) setTimeout(() => defer.reject(new Error('mpd gone')), 5);
        else setTimeout(() => defer.resolve([{ items: [{ service: 'mpd' }] }]), 5);
        return defer.promise;
      }
    };
    const lib = library(router);

    const first = lib.searchOnPlugin('music_service', 'mpd', { value: 'a' }, 60000);
    const second = lib.searchOnPlugin('music_service', 'mpd', { value: 'b' }, 60000);

    return new Promise((resolve, reject) => {
      libQ.all([first, second]).then(checking(resolve, reject, (results) => {
        assert.strictEqual(results[0], null);
        assert.notStrictEqual(results[1], null, 'the gate stayed shut after a failure');
      }));
    });
  });

  it('resolves a global search whose last source comes back empty', function () {
    const router = {
      logger: { info: () => {}, error: () => {} },
      executeOnPlugin: function (type, name) {
        if (name === 'mpd') return libQ.resolve([{ items: [{ service: 'mpd', uri: 'mpd://a' }] }]);
        return libQ.resolve([{ items: [] }]);
      }
    };
    const lib = library(router);
    lib.getGlobalSearchableBrowseSources = () => [
      { plugin_type: 'music_service', plugin_name: 'mpd', uri: 'music-library' },
      { plugin_type: 'music_service', plugin_name: 'tidal', uri: 'tidal://' }
    ];

    return new Promise((resolve, reject) => {
      const stillPending = setTimeout(
        () => reject(new Error('executeGlobalSearch never resolved')), 1000);
      lib.executeGlobalSearch({ value: 'anything' }).then(checking(resolve, reject, (items) => {
        clearTimeout(stillPending);
        assert.strictEqual(items.length, 1);
        assert.strictEqual(items[0].uri, 'mpd://a');
      }));
    });
  });
});
