'use strict';
/* eslint-env mocha */

const assert = require('assert');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

const ControllerAlsa = require('../app/plugins/audio_interface/alsa_controller/index.js');
const CoreStateMachine = require('../app/statemachine.js');

// Minimal context: hasAudioOutput only needs a logger.
function makeController () {
  const logged = [];
  const controller = new ControllerAlsa({
    coreCommand: {},
    logger: {
      warn: (msg) => logged.push(msg),
      info: () => {},
      error: () => {}
    },
    configManager: {}
  });
  controller.testLog = logged;
  return controller;
}

function writeFixture (name, contents) {
  const file = path.join(os.tmpdir(), 'volumio-test-asound-' + name + '-' + process.pid);
  fs.writeFileSync(file, contents);
  return file;
}

describe('ControllerAlsa::hasAudioOutput', function () {
  const fixtures = [];

  after(function () {
    fixtures.forEach((f) => fs.removeSync(f));
  });

  it('reports an output when /proc/asound/cards lists a card', function () {
    // Verbatim shape of /proc/asound/cards on a Pi with an I2S DAC attached.
    const file = writeFixture('with-card',
      ' 0 [sndrpihifiberry]: snd_rpi_hifiberry - snd_rpi_hifiberry_dacplus\n' +
      '                      snd_rpi_hifiberry_dacplus\n');
    fixtures.push(file);

    assert.strictEqual(makeController().hasAudioOutput(file), true);
  });

  it('reports an output when the card index is double digit', function () {
    const file = writeFixture('card-ten',
      '10 [Headphones     ]: bcm2835_headpho - bcm2835 Headphones\n' +
      '                      bcm2835 Headphones\n');
    fixtures.push(file);

    assert.strictEqual(makeController().hasAudioOutput(file), true);
  });

  it('reports no output when the kernel registered no soundcard', function () {
    // Verbatim content on a Raspberry Pi 5 with nothing attached.
    const file = writeFixture('no-cards', '--- no soundcards ---\n');
    fixtures.push(file);

    assert.strictEqual(makeController().hasAudioOutput(file), false);
  });

  it('fails open when the cards file cannot be read', function () {
    const controller = makeController();
    const missing = path.join(os.tmpdir(), 'volumio-test-asound-absent-' + process.pid);

    // A broken probe must never stop a working device from playing.
    assert.strictEqual(controller.hasAudioOutput(missing), true);
    assert.strictEqual(controller.testLog.length, 1);
  });
});

describe('ControllerAlsa::usbAudioAttach', function () {
  // A DAC on ALSA card 5, the index Volumio reserves for USB audio.
  const USB_CARD = { id: '5', alsacard: 'Device', name: 'USB Audio Device' };

  function makeAttachController (options) {
    const controller = makeController();
    const settings = options.settings || {};

    controller.saved = [];
    controller.toasts = [];
    controller.noAudioOutputDetected = options.noAudioOutputDetected || false;
    controller.config = { get: (key, fallback) => (key in settings ? settings[key] : fallback) };
    controller.getAlsaCards = () => (options.cards || []);
    controller.saveAlsaOptions = (data) => controller.saved.push(data);
    controller.commandRouter = {
      pushToastMessage: (type, title, message) => controller.toasts.push([type, title, message]),
      getI18nString: (key) => key,
      closeModals: () => {},
      executeOnPlugin: () => undefined
    };
    return controller;
  }

  it('adopts a DAC plugged into a unit that had no output at all', function () {
    const controller = makeAttachController({
      settings: { outputdevice: '0' }, // never touched since the unit had nothing
      cards: [USB_CARD],
      noAudioOutputDetected: true
    });

    controller.usbAudioAttach();

    assert.strictEqual(controller.saved.length, 1);
    assert.strictEqual(controller.saved[0].output_device.value, '5');
    assert.strictEqual(controller.saved[0].output_device.label, 'USB Audio Device');
    assert.strictEqual(controller.toasts.length, 1);
    // Adopted: a second attach must not override a deliberate later choice.
    assert.strictEqual(controller.noAudioOutputDetected, false);
  });

  it('still adopts a DAC when USB is already the configured output', function () {
    const controller = makeAttachController({
      settings: { outputdevice: '5' },
      cards: [USB_CARD]
    });

    controller.usbAudioAttach();

    assert.strictEqual(controller.saved.length, 1);
  });

  it('leaves a configured non-USB output alone', function () {
    const controller = makeAttachController({
      settings: { outputdevice: '0' }, // a working I2S/HDMI card the user chose
      cards: [{ id: '0', alsacard: 'sndrpihifiberry', name: 'HifiBerry DAC+' }, USB_CARD]
    });

    controller.usbAudioAttach();

    assert.strictEqual(controller.saved.length, 0);
    assert.strictEqual(controller.toasts.length, 0);
  });

  it('does nothing when usb hotplug is switched off', function () {
    const controller = makeAttachController({
      settings: { outputdevice: '0', usb_hotplug: false },
      cards: [USB_CARD],
      noAudioOutputDetected: true
    });

    controller.usbAudioAttach();

    assert.strictEqual(controller.saved.length, 0);
  });

  it('does not throw when the attach fires but no card 5 is present', function () {
    const controller = makeAttachController({
      settings: { outputdevice: '5' },
      cards: [] // attach/detach race, or a capture-only device
    });

    assert.doesNotThrow(() => controller.usbAudioAttach());
    assert.strictEqual(controller.saved.length, 0);
  });
});

describe('ControllerAlsa::checkAudioDeviceAvailable', function () {
  function makeCheckController (cards) {
    const controller = makeController();
    controller.config = { get: () => undefined };
    controller.getAlsaCards = () => cards;
    controller.commandRouter = {
      getI18nString: (key) => key,
      broadcastMessage: () => {},
      executeOnPlugin: () => undefined
    };
    return controller;
  }

  it('remembers that the unit has no output', function () {
    const controller = makeCheckController([]);

    controller.checkAudioDeviceAvailable();

    assert.strictEqual(controller.noAudioOutputDetected, true);
  });

  it('forgets it again once a card is present', function () {
    const controller = makeCheckController([{ id: '5', alsacard: 'Device', name: 'USB Audio Device' }]);
    controller.noAudioOutputDetected = true;

    controller.checkAudioDeviceAvailable();

    assert.strictEqual(controller.noAudioOutputDetected, false);
  });

  it('starts out assuming an output is present', function () {
    assert.strictEqual(makeController().noAudioOutputDetected, false);
  });
});

describe('CoreStateMachine::audioOutputAvailable', function () {
  // The constructor itself calls executeOnPlugin, so build the state machine
  // with a benign stub and only then install the behaviour under test.
  function makeStateMachine (executeOnPlugin) {
    const stateMachine = new CoreStateMachine({
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      pushConsoleMessage: () => {},
      executeOnPlugin: () => undefined,
      initPlayerControls: () => {}
    });
    stateMachine.commandRouter.executeOnPlugin = executeOnPlugin;
    return stateMachine;
  }

  it('reports unavailable only when the plugin explicitly says so', function () {
    assert.strictEqual(makeStateMachine(() => false).audioOutputAvailable(), false);
    assert.strictEqual(makeStateMachine(() => true).audioOutputAvailable(), true);
  });

  it('fails open when alsa_controller is not loaded on this variant', function () {
    // executeOnPlugin returns undefined for a plugin it cannot find.
    assert.strictEqual(makeStateMachine(() => undefined).audioOutputAvailable(), true);
  });

  it('fails open when the plugin call throws', function () {
    const throwing = () => { throw new Error('plugin exploded'); };

    assert.strictEqual(makeStateMachine(throwing).audioOutputAvailable(), true);
  });

  it('asks alsa_controller for hasAudioOutput', function () {
    const calls = [];
    makeStateMachine((type, name, method) => {
      calls.push([type, name, method]);
      return true;
    }).audioOutputAvailable();

    assert.deepStrictEqual(calls, [['audio_interface', 'alsa_controller', 'hasAudioOutput']]);
  });
});
