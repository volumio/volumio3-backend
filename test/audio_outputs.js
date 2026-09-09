/*
 * audio_interface/outputs regression tests.
 *
 * The list of audio outputs is filled in by other plugins at runtime, so a
 * single plugin registering a malformed entry used to be enough to take the
 * whole backend down: every method resolved the owning plugin with
 * `availableOutputs[i - 1].plugin.split('/')`, which throws a TypeError when
 * that field is missing. The throw happens inside a socket.io handler, so it
 * is uncaught and systemd restarts volumio.service — from the user's side the
 * UI simply dies mid-interaction.
 *
 * Seen in the wild on Volumio 4.194 (Motivo): myvolumio-plugin registered a
 * legacy `{id: 'browser', type: 'browser'}` output with no `plugin` field, and
 * tapping the resulting "Browser" row in Nova crashed the daemon:
 *
 *   TypeError: Cannot read properties of undefined (reading 'split')
 *       at outputs.enableAudioOutput (audio_interface/outputs/index.js:230:23)
 */

const assert = require('assert');
const Outputs = require('../app/plugins/audio_interface/outputs');

/** Minimal stand-in for the pieces of the command router this plugin touches. */
function mockContext () {
  const calls = { executeOnPlugin: [], toasts: [], errors: [], broadcasts: [] };

  return {
    calls,
    coreCommand: {
      executeOnPlugin: function (type, name, method, data) {
        calls.executeOnPlugin.push({ type: type, name: name, method: method, data: data });
        // Every call site treats the return value as a promise-ish object.
        return { then: function (cb) { cb(); return this; }, fail: function () { return this; } };
      },
      pushToastMessage: function (kind, title, message) {
        calls.toasts.push({ kind: kind, title: title, message: message });
      },
      broadcastMessage: function (name, data) {
        calls.broadcasts.push({ name: name, data: data });
      },
      getHwuuid: function () { return 'test-hwuuid'; }
    },
    logger: {
      info: function () {},
      error: function (message) { calls.errors.push(String(message)); }
    },
    configManager: {}
  };
}

function newOutputs (context) {
  const plugin = new Outputs(context);
  // The constructor only wires the context; the config file is not needed here.
  plugin.logger = context.logger;
  return plugin;
}

/** The shape multiroom-plugin registers: complete, with an owning plugin. */
const WELL_FORMED = {
  id: 'browserPlayback',
  name: 'Browser',
  type: 'browserPlayback',
  plugin: 'audio_interface/multiroom',
  available: true,
  enabled: false
};

/** The shape myvolumio-plugin registered: no `plugin`, so nothing owns it. */
const NO_PLUGIN_FIELD = {
  id: 'browser',
  name: 'Browser',
  type: 'browser',
  available: true,
  enabled: false
};

describe('audio_interface/outputs', function () {
  describe('addAudioOutput', function () {
    it('accepts an output that names its owning plugin', function () {
      const context = mockContext();
      const outputs = newOutputs(context);

      outputs.addAudioOutput(WELL_FORMED);

      assert.strictEqual(outputs.getAudioOutputs().availableOutputs.length, 1);
    });

    it('refuses an output with no plugin field, since nothing could act on it', function () {
      const context = mockContext();
      const outputs = newOutputs(context);

      outputs.addAudioOutput(NO_PLUGIN_FIELD);

      assert.strictEqual(outputs.getAudioOutputs().availableOutputs.length, 0);
      assert.ok(
        context.calls.errors.some(function (message) { return message.indexOf('plugin') >= 0; }),
        'expected the rejection to be logged, got: ' + JSON.stringify(context.calls.errors)
      );
    });
  });

  describe('with an unowned output already in the list', function () {
    /*
     * Outputs registered before this guard existed are still in memory on a
     * running system, and a plugin can be downgraded, so the resolve step has
     * to survive a bad entry rather than only refuse to create one.
     */
    function outputsWithUnownedEntry () {
      const context = mockContext();
      const outputs = newOutputs(context);
      outputs.output.availableOutputs.push(JSON.parse(JSON.stringify(NO_PLUGIN_FIELD)));
      return { context: context, outputs: outputs };
    }

    const methods = [
      { name: 'enableAudioOutput', data: { id: 'browser' } },
      { name: 'disableAudioOutput', data: { id: 'browser' } },
      { name: 'setAudioOutputVolume', data: { id: 'browser', volume: 50, mute: false } },
      { name: 'audioOutputPlay', data: { id: 'browser' } },
      { name: 'audioOutputPause', data: { id: 'browser' } }
    ];

    methods.forEach(function (method) {
      it(method.name + ' reports the failure instead of throwing', function () {
        const fixture = outputsWithUnownedEntry();

        assert.doesNotThrow(function () {
          fixture.outputs[method.name](method.data);
        });

        assert.strictEqual(
          fixture.context.calls.executeOnPlugin.length, 0,
          'no plugin owns the output, so nothing should have been dispatched'
        );
        assert.ok(
          fixture.context.calls.errors.length > 0,
          'expected ' + method.name + ' to log why it gave up'
        );
      });
    });
  });

  describe('with a well-formed output', function () {
    it('enableAudioOutput dispatches to the plugin that registered it', function () {
      const context = mockContext();
      const outputs = newOutputs(context);
      outputs.addAudioOutput(WELL_FORMED);

      outputs.enableAudioOutput({ id: 'browserPlayback' });

      assert.deepStrictEqual(
        context.calls.executeOnPlugin.map(function (call) {
          return [call.type, call.name, call.method];
        }),
        [['audio_interface', 'multiroom', 'enableAudioOutput']]
      );
    });

    it('disableAudioOutput dispatches to the plugin that registered it', function () {
      const context = mockContext();
      const outputs = newOutputs(context);
      outputs.addAudioOutput(WELL_FORMED);

      outputs.disableAudioOutput({ id: 'browserPlayback' });

      assert.deepStrictEqual(
        context.calls.executeOnPlugin.map(function (call) {
          return [call.type, call.name, call.method];
        }),
        [['audio_interface', 'multiroom', 'disableAudioOutput']]
      );
    });
  });
});
