'use strict';

var assert = require('assert');
var libQ = require('kew');
var PluginManager = require('../app/pluginmanager');

// The install pipeline works on fixed shared paths, so two installs running
// together delete each other's files: queueInstallTask must run one at a time,
// and one failing install must not block the ones queued behind it.
describe('plugin install queue', function () {
  it('runs queued installs one at a time, a failed one does not block the next', function (done) {
    var manager = Object.create(PluginManager.prototype);
    manager.logger = {info: function () {}};
    manager.coreCommand = {getI18nString: function (key) { return key; }};

    var running = 0;
    var started = [];
    var queuedMessages = [];

    manager.pushMessage = function (event, data) {
      queuedMessages.push(event + ' ' + data.progress + ' ' + data.message);
    };

    function task (i, shouldFail) {
      return function () {
        running++;
        assert.strictEqual(running, 1, 'install ' + i + ' started while another one was running');
        started.push(i);
        var defer = libQ.defer();
        process.nextTick(function () {
          running--;
          if (shouldFail) defer.reject(new Error('install ' + i + ' failed'));
          else defer.resolve(i);
        });
        return defer.promise;
      };
    }

    var first = manager.queueInstallTask(task(0, true));
    manager.queueInstallTask(task(1));
    var last = manager.queueInstallTask(task(2));

    first.then(function () {
      done(new Error('a failed install must reject the caller'));
    }, function () {});

    last.then(function () {
      assert.deepStrictEqual(started, [0, 1, 2]);
      assert.strictEqual(running, 0);
      // the two installs that had to wait told the user so, the first did not
      assert.strictEqual(queuedMessages.length, 2);
      // the queue is empty again, so the next install must not report a wait
      manager.queueInstallTask(task(3)).then(function () {
        assert.strictEqual(queuedMessages.length, 2);
        done();
      }, done);
    }, done);
  });
});
