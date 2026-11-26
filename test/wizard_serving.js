/* eslint-env mocha */
'use strict';

var assert = require('assert');
var wizardServing = require('../http/wizardServing');
var isNovaUi = wizardServing.isNovaUi;
var shouldServeWizard = wizardServing.shouldServeWizard;

describe('wizard serving', function () {
  describe('isNovaUi', function () {
    it('matches nova and nova-* variants', function () {
      assert.strictEqual(isNovaUi('nova'), true);
      assert.strictEqual(isNovaUi('nova-dev'), true);
    });

    it('does not match other UIs or missing names', function () {
      assert.strictEqual(isNovaUi('manifest'), false);
      assert.strictEqual(isNovaUi('classic'), false);
      assert.strictEqual(isNovaUi('contemporary'), false);
      assert.strictEqual(isNovaUi('novalike'), false);
      assert.strictEqual(isNovaUi(''), false);
      assert.strictEqual(isNovaUi(undefined), false);
    });
  });

  describe('shouldServeWizard', function () {
    it('never serves the wizard when it is not pending', function () {
      assert.strictEqual(shouldServeWizard({ VOLUMIO_ACTIVE_UI_NAME: 'manifest' }), false);
      assert.strictEqual(shouldServeWizard({ SHOW_NEW_WIZARD: 'false', WIZARD_REQUESTED: 'true', VOLUMIO_ACTIVE_UI_NAME: 'nova' }), false);
    });

    it('keeps the boot takeover for non-Nova UIs', function () {
      assert.strictEqual(shouldServeWizard({ SHOW_NEW_WIZARD: 'true', VOLUMIO_ACTIVE_UI_NAME: 'manifest' }), true);
      assert.strictEqual(shouldServeWizard({ SHOW_NEW_WIZARD: 'true', VOLUMIO_ACTIVE_UI_NAME: 'classic' }), true);
      assert.strictEqual(shouldServeWizard({ SHOW_NEW_WIZARD: 'true' }), true);
    });

    it('lets Nova own first run at boot', function () {
      assert.strictEqual(shouldServeWizard({ SHOW_NEW_WIZARD: 'true', VOLUMIO_ACTIVE_UI_NAME: 'nova' }), false);
      assert.strictEqual(shouldServeWizard({ SHOW_NEW_WIZARD: 'true', VOLUMIO_ACTIVE_UI_NAME: 'nova-dev' }), false);
    });

    it('serves the wizard under Nova when it was explicitly requested', function () {
      assert.strictEqual(shouldServeWizard({ SHOW_NEW_WIZARD: 'true', WIZARD_REQUESTED: 'true', VOLUMIO_ACTIVE_UI_NAME: 'nova' }), true);
      assert.strictEqual(shouldServeWizard({ SHOW_NEW_WIZARD: 'true', WIZARD_REQUESTED: 'true', VOLUMIO_ACTIVE_UI_NAME: 'nova-dev' }), true);
    });
  });
});
