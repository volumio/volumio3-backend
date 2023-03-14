'use strict';

var HashMap = require('hashmap');

class PluginContext {
  constructor(ccommand, server, configManager) {
    var self = this;

    self.coreCommand = ccommand;
    self.websocketServer = server;
    self.configManager = configManager;
    self.logger = ccommand.logger;

    self.env = new HashMap();

    // TODO: add environment variables here
  }

  getEnvVariable(key) {
    var self = this;

    return self.env.get(key);
  }

  setEnvVariable(key, value) {
    var self = this;

    return self.env.set(key, value);
  }
}

module.exports = PluginContext;
