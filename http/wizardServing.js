'use strict';

// Nova ships its own first-run screen. When Nova is the active UI, the
// Manifest setup wizard is served only if a client explicitly asked for it
// (runFirstConfigWizard). Every other UI keeps the boot-time takeover.

function isNovaUi (uiName) {
  return uiName === 'nova' || (typeof uiName === 'string' && uiName.indexOf('nova-') === 0);
}

function shouldServeWizard (env) {
  if (env.SHOW_NEW_WIZARD !== 'true') {
    return false;
  }
  return env.WIZARD_REQUESTED === 'true' || !isNovaUi(env.VOLUMIO_ACTIVE_UI_NAME);
}

module.exports = {
  isNovaUi: isNovaUi,
  shouldServeWizard: shouldServeWizard
};
