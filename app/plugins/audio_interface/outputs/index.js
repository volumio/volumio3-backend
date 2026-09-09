'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var config = new (require('v-conf'))();
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;
var unirest = require('unirest');

module.exports = outputs;
function outputs (context) {
  var self = this;

  this.context = context;
  this.commandRouter = this.context.coreCommand;
  this.logger = this.context.logger;
  this.configManager = this.context.configManager;

  this.output = {'availableOutputs': []};
  this.current_output = {};
}

outputs.prototype.onVolumioStart = function () {
  var self = this;
  var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
  this.config = new (require('v-conf'))();
  this.config.loadFile(configFile);

  return libQ.resolve();
};

outputs.prototype.onStart = function () {
  var self = this;
  var defer = libQ.defer();

  // Once the Plugin has successfull started resolve the promise
  defer.resolve();

  return defer.promise;
};

outputs.prototype.onStop = function () {
  var self = this;
  var defer = libQ.defer();

  // Once the Plugin has successfull stopped resolve the promise
  defer.resolve();

  return libQ.resolve();
};

outputs.prototype.onRestart = function () {
  var self = this;
  // Optional, use if you need it
};

// Configuration Methods -----------------------------------------------------------------------------

outputs.prototype.getUIConfig = function () {
  var defer = libQ.defer();
  var self = this;

  var lang_code = this.commandRouter.sharedVars.get('language_code');

  self.commandRouter.i18nJson(__dirname + '/i18n/strings_' + lang_code + '.json',
    __dirname + '/i18n/strings_en.json',
    __dirname + '/UIConfig.json')
    .then(function (uiconf) {
      defer.resolve(uiconf);
    })
    .fail(function () {
      defer.reject(new Error());
    });

  return defer.promise;
};

outputs.prototype.setUIConfig = function (data) {
  var self = this;
  // Perform your installation tasks here
};

outputs.prototype.getConf = function (varName) {
  var self = this;
  // Perform your installation tasks here
};

outputs.prototype.setConf = function (varName, varValue) {
  var self = this;
  // Perform your installation tasks here
};

/**
 * This function adds an output to the list, checking whether it's already there
 * notifies the system via broadcast
 * @param data: a json containing the new output parameters
 */
outputs.prototype.addAudioOutput = function (data) {
  let self = this;

  let new_output = JSON.parse(JSON.stringify(data));

  self.logger.info('Adding audio output: ', new_output.id);

  if (new_output.id && new_output.name && new_output.type) {
    // Without a "<category>/<plugin>" path there is nobody to enable, disable
    // or set the volume of this output: every one of those methods resolves
    // the owner through it. Refusing here keeps an unusable entry out of the
    // list instead of letting it sit there as a trap for the frontends.
    if (!self.parsePluginPath(new_output.plugin)) {
      self.logger.error("Audio Outputs: can't add new output " + new_output.id +
        ', because its plugin field is missing or malformed: ' + new_output.plugin);
      return;
    }

    let i = self.checkElement(new_output.id);

    if (i < 0) {
      self.output.availableOutputs.push(new_output);

      self.pushAudioOutputs(self.output);
    } else {
      self.logger.error("Can't add: ", new_output.id, ' output is already in list');
    }
  } else {
    self.logger.error("Audio Outputs: can't add new output, because of " +
			'missing parameters');
  }
};

/**
 * This function updates an output already in the list with new parameters,
 * notifies the system via broadcast
 * @param data: a json containing the new parameters
 */
outputs.prototype.updateAudioOutput = function (data) {
  let self = this;

  // self.logger.info("\nUPDATEAUDIOOUTPUT - OUTPUTS\n");
  // self.logger.info(data, "\n\n\n");
  // self.logger.info(JSON.stringify(self.output.availableOutputs));

  let new_output = JSON.parse(JSON.stringify(data));

  if (new_output.id && new_output.name && new_output.type) {
    let i = self.checkElement(new_output.id);

    if (i >= 0) {
      new_output.plugin = self.output.availableOutputs[i - 1].plugin;

      self.output.availableOutputs[i - 1] = new_output;

      self.pushAudioOutputs(self.output);
    }
  } else {
    self.logger.error("Audio Outputs: can't add new output, because of " +
			'missing parameters');
  }
};

/**
 * This function removes an output from the list, checking whether present,
 * notifies the system via broadcast
 * @param data: the id of the output to be removed
 */
outputs.prototype.removeAudioOutput = function (data) {
  let self = this;

  self.logger.info('Removing audio output: ', data.id);

  let i = self.checkElement(data.id);

  if (i >= 0) {
    self.output.availableOutputs.splice(i - 1, 1);

    self.pushAudioOutputs(self.output);
  }
};

/**
 * This function checks the existence of an id in the list, returns the position
 * @param id: the output to find
 * @returns the corresponding index or -1
 */
outputs.prototype.checkElement = function (id) {
  let self = this;
  let i = 0;
  let existing = false;

  while (i < self.output.availableOutputs.length && !existing) {
    if (self.output.availableOutputs[i].id === id) {
      existing = true;
    }
    i += 1;
  }

  if (existing) { return i; } else { return -1; }
};

/**
 * This function splits an output's "<category>/<plugin>" path into the pair
 * executeOnPlugin expects.
 * @param path: the output's plugin field
 * @returns {{type: string, name: string}} or null when the path is unusable
 */
outputs.prototype.parsePluginPath = function (path) {
  if (typeof path !== 'string') { return null; }

  let parts = path.split('/');

  if (parts.length < 2 || parts[0] === '' || parts[1] === '') { return null; }

  return { type: parts[0], name: parts[1] };
};

/**
 * This function finds the plugin owning the output at a given position, as
 * returned by checkElement. Callers must treat null as "cannot act on this
 * output": a plugin can register a malformed entry, and a thrown TypeError in
 * here reaches a socket.io handler uncaught and takes the whole backend down.
 * @param position: the 1-based position returned by checkElement
 * @param action: what the caller was trying to do, for the log line
 * @returns {{type: string, name: string}} or null
 */
outputs.prototype.getOutputPlugin = function (position, action) {
  let self = this;

  let output = self.output.availableOutputs[position - 1];

  let plugin = self.parsePluginPath(output ? output.plugin : undefined);

  if (!plugin) {
    let id = output ? output.id : 'unknown';

    self.logger.error('Could not ' + action + ' audio output: ' + id +
			' was registered without a valid plugin field');

    self.commandRouter.pushToastMessage('error', 'plugin output failure',
      'Could not ' + action + ' audio output: ' + id);
  }

  return plugin;
};

/**
 * This function broadcasts the outputs list
 */
outputs.prototype.pushAudioOutputs = function (data) {
  let self = this;

  // self.logger.info(JSON.stringify(data));
  // self.logger.info(JSON.stringify(self.current_output));

  if (JSON.stringify(data) !== JSON.stringify(self.current_output)) {
    self.commandRouter.broadcastMessage('pushAudioOutputs', data);
    self.current_output = JSON.parse(JSON.stringify(data));
  }
};

/**
 * This function returns the outputs list
 * @returns {"availableOutputs":[any]}
 */
outputs.prototype.getAudioOutputs = function () {
  let self = this;

  return self.output;
};

/**
 * This function enables an audio output, given its ID. Checks its presence in
 * the list, retrieves the plugin that added it and asks that plugin to enable it.
 * It expects a promise.
 * @param data
 */
outputs.prototype.enableAudioOutput = function (data) {
  let self = this;

  if (data && data.id) {
    let i = self.checkElement(data.id);

    if (i >= 0) {
      let plugin = self.getOutputPlugin(i, 'enable');

      if (!plugin) { return; }

      let type = plugin.type;

      let name = plugin.name;

      var enableOutput = self.commandRouter.executeOnPlugin(type, name, 'enableAudioOutput', data);
      if (enableOutput !== undefined) {
          enableOutput.then(function () {
            self.logger.info('Enabled audio output: ' + data.id);
          }).fail(function () {
              self.commandRouter.pushToastMessage('error', 'plugin output failure', 'Failed to enable audio output: ' + data.id);
            });
      } else {
        self.logger.error('Could not enable audio output: Device not found or multiroom not enabled');
        self.commandRouter.pushToastMessage('error', 'plugin output failure', 'Could not enable audio output: Device not found or multiroom not enabled');
      }
    } else {
      self.logger.error('Could not enable audio output: ' + data.id + ' device not found');
    }
  } else {
    self.logger.error('Could not enable audio output: missing data or id field');
  }
};

/**
 * This function disables an audio output, given its ID. Checks its presence in
 * the list, retrieves the plugin that added it and asks that plugin to disable it.
 * It expects a promise.
 * @param data
 */
outputs.prototype.disableAudioOutput = function (data) {
  let self = this;

  if (data && data.id) {
    let i = self.checkElement(data.id);

    if (i >= 0) {
      let plugin = self.getOutputPlugin(i, 'disable');

      if (!plugin) { return; }

      let type = plugin.type;

      let name = plugin.name;

      self.commandRouter.executeOnPlugin(type, name, 'disableAudioOutput', data)
        .then(function () {
        })
        .fail(function () {
          self.commandRouter.pushToastMessage('error',
            'plugin output failure', 'Failed to disable audio output' + data.id);
        });
    } else {
      self.logger.error('Could not disable audio output: ' + data.id +
				' device not found');
    }
  } else {
    self.logger.error('Could not disable audio output: missing data or id field');
  }
};

/**
 * This function changes an audio output's volume, given its ID. Checks its
 * presence in the list, retrieves the plugin that added it and asks that plugin
 * to change the volume/mute.
 * It expects a promise.
 * @param data
 */
outputs.prototype.setAudioOutputVolume = function (data) {
  let self = this;

  if (data && data.id && parseInt(data.volume) * 0 === 0 && typeof data.mute === 'boolean') {
    data.volume = parseInt(data.volume);

    if (data.type === 'device' && data.host !== undefined) {
      self.commandRouter.executeOnPlugin('system_controller', 'volumiodiscovery', 'setRemoteDeviceVolume', data);
    } else {
      let i = self.checkElement(data.id);

      if (i >= 0) {
        let plugin = self.getOutputPlugin(i, 'set the volume of');

        if (!plugin) { return; }

        let type = plugin.type;

        let name = plugin.name;

        self.commandRouter.executeOnPlugin(type, name, 'setAudioOutputVolume', data)
          .then(function () {
          })
          .fail(function () {
            self.commandRouter.pushToastMessage('error', 'plugin output failure', 'Failed to set audio output volume of ' + data.id);
          });
      } else {
        self.logger.error('Could not set audio output volume: ' + data.id + ' device not found');
      }
    }
  } else {
    self.logger.error('Could not set audio output volume: missing data, id, volume or mute fields');
  }
};

/**
 * This function plays an audio output, given its ID. Checks its
 * presence in the list, retrieves the plugin that added it and asks that plugin
 * to play.
 * @param data
 */
outputs.prototype.audioOutputPlay = function (data) {
  let self = this;

  if (data.type === 'device' && data.host !== undefined) {
    if(data.id === self.commandRouter.getHwuuid()) {
      self.logger.info('Playing Local Device: ' + data.host);
      self.commandRouter.volumioPlay();
    } else {
      self.logger.info('Playing Remote Device: ' + data.host);

      let url = data.host + ':3000/api/v1/commands/?cmd=play';

      unirest.get(url)
        .timeout(3000)
        .end(function (response) {
          if (response && response.status === 200) {
            self.logger.info('Done playing: ', data.host);
          } else {
            self.logger.error('Cannot play Remote Device: ' + data.host );
          }
        });
    }
  } else {
      let i = self.checkElement(data.id);

    if (i >= 0) {
      let plugin = self.getOutputPlugin(i, 'play');

      if (!plugin) { return; }

      let type = plugin.type;

      let name = plugin.name;

      self.commandRouter.executeOnPlugin(type, name, 'audioOutputPlay', data)
        .then(function () {
        })
        .fail(function () {
          self.commandRouter.pushToastMessage('error', 'plugin output failure', 'Failed to play audio output ' + data.id);
        });
    } else {
      self.logger.error('Could not play audio output: ' + data.id + ' device not found');
    }
  }
};

/**
 * This function pauses an audio output, given its ID. Checks its
 * presence in the list, retrieves the plugin that added it and asks that plugin
 * to play.
 * @param data
 */
outputs.prototype.audioOutputPause = function (data) {
  let self = this;

  if (data.type === 'device' && data.host !== undefined) {
    if(data.id === self.commandRouter.getHwuuid()) {
      self.logger.info('Pausing Local Device: ' + data.host);
      self.commandRouter.volumioPause();
    } else {
      self.logger.info('Pausing Remote Device: ' + data.host);

      let url = data.host + ':3000/api/v1/commands/?cmd=pause';

      unirest.get(url)
        .timeout(3000)
        .end(function (response) {
          if (response && response.status === 200) {
            self.logger.info('Done pausing: ', data.host);
          } else {
            self.logger.error('Cannot pause Remote Device: ' + data.host );
          }
        });
    }
  } else {
    let i = self.checkElement(data.id);

    if (i >= 0) {
      let plugin = self.getOutputPlugin(i, 'pause');

      if (!plugin) { return; }

      let type = plugin.type;

      let name = plugin.name;

      self.commandRouter.executeOnPlugin(type, name, 'audioOutputPause', data)
        .then(function () {
        })
        .fail(function () {
          self.commandRouter.pushToastMessage('error', 'plugin output failure', 'Failed to pause audio output ' + data.id);
        });
    } else {
      self.logger.error('Could not pause audio output: ' + data.id + ' device not found');
    }
  }
};
