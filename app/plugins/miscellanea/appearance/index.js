'use strict';

var fs = require('fs-extra');
var config = new (require('v-conf'))();
var libQ = require('kew');
var path = require('path');
var Jimp = require('jimp');
var execSync = require('child_process').execSync;
var exec = require('child_process').exec;
var crypto = require('crypto');

var backgroundPath = '/data/backgrounds';

// Define the volumioAppearance class
module.exports = volumioAppearance;

function volumioAppearance (context) {
  var self = this;

  // Save a reference to the parent commandRouter
  self.context = context;
  self.commandRouter = self.context.coreCommand;
  self.configManager = self.context.configManager;

  self.logger = self.context.logger;
}

volumioAppearance.prototype.getConfigurationFiles = function () {
  var self = this;

  return ['config.json'];
};

volumioAppearance.prototype.onVolumioStart = function () {
  var self = this;
  // Perform startup tasks here
  self.configFile = self.commandRouter.pluginManager.getConfigurationFile(self.context, 'config.json');
  config.loadFile(self.configFile);

  this.commandRouter.sharedVars.addConfigValue('language_code', 'string', config.get('language_code', 'en'));
  return self.createThumbnailPath();
};

volumioAppearance.prototype.onStart = function () {
  var self = this;
  return libQ.resolve();
};

volumioAppearance.prototype.onStop = function () {
  var self = this;
  // Perform startup tasks here
};

volumioAppearance.prototype.onRestart = function () {
  var self = this;
  // Perform startup tasks here
};

volumioAppearance.prototype.onInstall = function () {
  var self = this;
  // Perform your installation tasks here
};

volumioAppearance.prototype.onUninstall = function () {
  var self = this;
  // Perform your installation tasks here
};

volumioAppearance.prototype.setUIConfig = function (data) {
  var self = this;

  var uiconf = fs.readJsonSync(__dirname + '/UIConfig.json');
};

volumioAppearance.prototype.getConf = function () {
  var self = this;
  var conf = [];
  try {
    var conf = JSON.parse(fs.readJsonSync(self.configFile));
  } catch (e) {}

  return conf;
};

// Optional functions exposed for making development easier and more clear
volumioAppearance.prototype.getSystemConf = function (pluginName, varName) {
  var self = this;
  // Perform your installation tasks here
};

volumioAppearance.prototype.setSystemConf = function (pluginName, varName) {
  var self = this;
  // Perform your installation tasks here
};

volumioAppearance.prototype.getAdditionalConf = function (type, controller, data, def) {
  var self = this;
  var setting = self.commandRouter.executeOnPlugin(type, controller, 'getConfigParam', data);

  if (setting == undefined) {
    setting = def;
  }
  return setting;
};

volumioAppearance.prototype.setAdditionalConf = function () {
  var self = this;
  // Perform your installation tasks here
};

volumioAppearance.prototype.getUIConfig = function () {
  var self = this;

  var defer = libQ.defer();
  self.commandRouter.i18nJson(__dirname + '/../../../i18n/strings_' + config.get('language_code') + '.json',
    __dirname + '/../../../i18n/strings_en.json',
    __dirname + '/UIConfig.json')
    .then(function (uiconf) {
      var languagesdata = fs.readJsonSync(('/volumio/app/plugins/miscellanea/appearance/languages.json'), 'utf8', {throws: false});
      var language = config.get('language');
      var language_code = config.get('language_code');

      self.configManager.setUIConfigParam(uiconf, 'sections[0].content[0].value', {
        value: language_code,
        label: language
      });
      for (var n = 0; n < languagesdata.languages.length; n++) {
        self.configManager.pushUIConfigParam(uiconf, 'sections[0].content[0].options', {
          value: languagesdata.languages[n].code,
          label: languagesdata.languages[n].name
        });
      }

      try {
        var sysVariant = execSync("cat /etc/os-release | grep ^VOLUMIO_VARIANT | tr -d 'VOLUMIO_VARIANT=\"'").toString().replace('\n', '');
      } catch (e) {
        self.logger.error(e);
      }

      if (fs.existsSync('/volumio/http/www') && fs.existsSync('/volumio/http/www3')) {
        self.configManager.setUIConfigParam(uiconf, 'sections[2].hidden', false);
      }


      defer.resolve(uiconf);
    })
    .fail(function (e) {
      self.logger.error('Error getting Configuration page: ' + e);
      defer.reject(new Error());
    });

  /* var uiconf = fs.readJsonSync(__dirname + '/UIConfig.json');
     */
  return defer.promise;
};

volumioAppearance.prototype.getUiSettings = function () {
  var self = this;
  var defer = libQ.defer();

  var language = config.get('language_code');
  var theme = config.get('theme');
  var background_type = config.get('background_type');

  if (background_type === 'background') {
    var background_title = config.get('background_title');
    var background_path = config.get('background_path');
    var UiSettings = {'background': {'title': background_title, 'path': background_path}, 'language': language, 'theme': theme};
  } else {
    var background_color = config.get('background_color');
    var UiSettings = {'color': background_color, 'language': language, 'theme': theme};
  }

  defer.resolve(UiSettings);
  return defer.promise;
};

volumioAppearance.prototype.getBackgrounds = function () {
  var self = this;
  var defer = libQ.defer();

  var backgroundsArray = [];

  fs.readdir(backgroundPath, function (err, files) {
    if (err) {
      self.logger.error('Failed to read Background files: ' + err);
    }
    files.forEach(function (f) {
      if (f.indexOf('thumbnail-') < 0) {
        backgroundsArray.push({'name': f.split('.')[0].capitalize(), 'path': f, 'thumbnail': 'thumbnail-' + f});
      }
    });
    var background_title = config.get('background_title');
    var background_path = config.get('background_path');
    var backgrounds = {'current': {'name': background_title, 'path': background_path}, 'available': backgroundsArray};
    defer.resolve(backgrounds);
  });

  return defer.promise;
};

volumioAppearance.prototype.capitalize = function () {
  return this.charAt(0).toUpperCase() + this.slice(1);
};

volumioAppearance.prototype.generateThumbnails = function () {
  var self = this;

  return libQ.nfcall(fs.readdir, backgroundPath)
    .then((files) => {
      var defers = [];
      var map = {};

      for(var i = 0; i < files.length; i++) {
        map[files[i]] = true;
      }

      for(var i = 0; i < files.length; i++) {
        if(files[i].indexOf('thumbnail-') !== 0 && !map['thumbnail-' + files[i]]) {
          var f = files[i];
          self.logger.info('Creating Thumbnail for file ' + f + ' : ' + backgroundPath + '/thumbnail-' + f);
          let defer = libQ.defer();
          defers.push(defer);
          Jimp.read(backgroundPath + '/' + f)
            .then(function (image) {
              image.resize(300, 200)
              .quality(60)
              .write(backgroundPath + '/thumbnail-' + f);
            })
            .catch(function (err) {
              console.error('Failed to create thumbnail :' + err);
            })
            .then(function() {defer.resolve(); });
        }
      }
      return libQ.all(defers);
    })
    .fail((e) => {self.logger.error('Failed to generate thumbnails: ' + e)})
    .then(() => {
      return 'Ok';
    });
};
volumioAppearance.prototype.setDefaultBackground = function () {
  var self = this;

  var background = config.get('background_title');
  if (background === 'Initial') {
    self.selectRandomBackground();
  }
};

volumioAppearance.prototype.createThumbnailPath = function () {
  var self = this;

  // Node.JS recommends creating a directory and handling the "already exists"
  // rather than doing a stat check.
  return libQ.nfcall(fs.mkdir, backgroundPath)
    .fail(function (e) {
      if(e.code === 'EEXIST') {
        return null;
      } else {
        throw e;
      }
    })
    .then(function() {
      // Only copy backgrounds to the data folder if the backgrounds aren't there
      var pluginFolder = libQ.nfcall(fs.readdir, __dirname + '/backgrounds');
      var dataFolder = libQ.nfcall(fs.readdir, backgroundPath);

      return dataFolder.then(function(dataFiles) {
        pluginFolder.then(function(pluginFiles) {
          if(pluginFiles.every(function(f) { return dataFiles.includes(f); })) {
            return null;
          } else {
            fs.copy(__dirname + '/backgrounds', backgroundPath, function(err) {
              if (err) {
                self.logger.info('Failed to copy background: ' + err);
                return libQ.resolve();
              } else {
                self.setDefaultBackground();
                return libQ.resolve();
              }
            })
          }
        });
      });
    })
    .then(self.generateThumbnails.bind(self))
    .fail(console.error);
};

volumioAppearance.prototype.setBackgrounds = function (data) {
  var self = this;
  var defer = libQ.defer();

  if (data.color) {
    config.set('background_type', 'color');
    config.set('background_color', data.color);
  } else {
    config.set('background_type', 'background');
    config.set('background_title', data.name);
    config.set('background_path', data.path.substring(data.path.lastIndexOf('/') + 1));
  }

  self.commandRouter.pushToastMessage('success', self.commandRouter.getI18nString('APPEARANCE.APPEARANCE'),
    self.commandRouter.getI18nString('APPEARANCE.NEW_BACKGROUND_APPLIED'));
  var data = self.getUiSettings();

  if (data != undefined) {
    data.then(function (settings) {
      self.commandRouter.broadcastMessage('pushUiSettings', settings);
    });
  }

  return ('Done');
};

volumioAppearance.prototype.setLanguage = function (data) {
  var self = this;
  var defer = libQ.defer();

  if (data.language) {
    config.set('language', data.language.label);
    config.set('language_code', data.language.value);
    this.commandRouter.sharedVars.set('language_code', data.language.value);

    var menu = self.commandRouter.getMenuItems();
    if (menu != undefined) {
      menu.then(function (menu) {
        self.commandRouter.broadcastMessage('pushMenuItems', menu);
        self.commandRouter.updateBrowseSourcesLang();
      });
    }
  }

  if (!data.disallowReload) {
    self.commandRouter.pushToastMessage('success', self.commandRouter.getI18nString('APPEARANCE.APPEARANCE'),
      self.commandRouter.getI18nString('APPEARANCE.NEW_LANGUAGE_SET'));

    var data = self.getUiSettings();
    if (data != undefined) {
      data.then(function (data) {
        self.commandRouter.broadcastMessage('pushUiSettings', data);
      });
    }
  }

  return ('Done');
};

volumioAppearance.prototype.deleteBackgrounds = function (data) {
  var self = this;
  var defer = libQ.defer();
  var splitted = data.path.split('/').pop();
  var thumbpathdel = backgroundPath + '/thumbnail-' + splitted;
  var imgpathdel = backgroundPath + '/' + splitted;

  self.deleteFile(imgpathdel);
  var deleted = self.deleteFile(thumbpathdel);

  if (deleted != undefined) {
    deleted.then(function (data) {
      var backgrounds = self.getBackgrounds();
      if (backgrounds != undefined) {
        backgrounds.then(function (data) {
          defer.resolve(data);
        });
      }
    });
  }

  return defer.promise;
};

volumioAppearance.prototype.deleteFile = function (filepath) {
  var self = this;

  var defer = libQ.defer();
  fs.stat(filepath, function (err, stats) {
    if (err) {
      self.logger.error('Failed to read file: ' + err);
    } else {
      fs.unlink(filepath, function (err) {
        if (err) {
          self.logger.error('Failed to delete file: ' + err);
        } else {
          if (filepath.indexOf('thumbnail-') < 0) {
            self.commandRouter.pushToastMessage('success', self.commandRouter.getI18nString('APPEARANCE.APPEARANCE'),
              self.commandRouter.getI18nString('APPEARANCE.BACKGROUND_DELETED'));
          } defer.resolve('Done');
        }
      });
    }
  });

  return defer.promise;
};

volumioAppearance.prototype.selectRandomBackground = function () {
  var self = this;

  var backgrounds = self.getBackgrounds();
  if (backgrounds != undefined) {
    backgrounds.then(function (result) {
      var max = result.available.length - 1;
      var random = Math.floor(Math.random() * (max - 0 + 1) + 0);
      var randomBackground = result.available[random];
      var setting = {'name': randomBackground.name, 'path': randomBackground.path};

      return self.setBackgrounds(setting);
    })
      .fail(function () {
      });
  }
};

volumioAppearance.prototype.getAvailableLanguages = function () {
  var languagesdata = fs.readJsonSync(('/volumio/app/plugins/miscellanea/appearance/languages.json'), 'utf8', {throws: false});
  var defer = libQ.defer();

  var available = [];
  for (var n = 0; n < languagesdata.languages.length; n++) {
    var language = {'language': languagesdata.languages[n].name, 'code': languagesdata.languages[n].code };
    available.push(language);
  }
  var languagearray = {'defaultLanguage': {'language': 'English', 'code': 'en'}, 'available': available};
  defer.resolve(languagearray);
  return defer.promise;
};

volumioAppearance.prototype.getConfigParam = function (key) {
  var self = this;
  return config.get(key);
};

volumioAppearance.prototype.setVolumio3UI = function (data) {
  var self = this;

  var activeUiJson = {
    "uiPrettyName": "Manifest",
    "uiName": "manifest",
    "uiPath": "/volumio/http/www4"
  }

  if (data && data.volumio3_ui.value === "contemporary") {
    activeUiJson = {
      "uiPrettyName": "Comtemporary",
      "uiName": "contemporary",
      "uiPath": "/volumio/http/www3"
    };
  } else if (data && data.volumio3_ui.value === "manifest") {
    activeUiJson = {
      "uiPrettyName": "Manifest",
      "uiName": "manifest",
      "uiPath": "/volumio/http/www4"
    };
  } else if (data && data.volumio3_ui.value === "classic") {
    activeUiJson = {
      "uiPrettyName": "Classic",
      "uiName": "classic",
      "uiPath": "/volumio/http/www"
    };
  } else {
    // TODO: This is a provision for third party UIs
    self.logger.error('Failed to save UI: ' + data.volumio3_ui.value);
    return self.commandRouter.pushToastMessage('error', self.commandRouter.getI18nString('COMMON.ERROR'), self.commandRouter.getI18nString('APPEARANCE.FAILED_TO_SELECT_USER_INTERFACE'));
  }

  self.logger.info('Setting active UI to: ' + JSON.stringify(activeUiJson));


  self.saveActiveUIFile(activeUiJson);
  setTimeout(()=> {
    self.commandRouter.reloadUi();
  }, 1000);
};

volumioAppearance.prototype.saveActiveUIFile = function (activeUiJson) {
  var self = this;

  var uiFlagFile = '/data/active_volumio_ui';

  if (fs.existsSync(activeUiJson.uiPath)) {
    try {
      fs.stat(uiFlagFile, function(err, stat) {
        if (err == null) {
          execSync('/usr/bin/sudo /bin/chmod 777 ' + uiFlagFile, { uid: 1000, gid: 1000, encoding: 'utf8'});
        }
        fs.writeJsonSync(uiFlagFile, activeUiJson);
      });
      process.env.VOLUMIO_ACTIVE_UI_NAME = activeUiJson.uiName;
      process.env.VOLUMIO_ACTIVE_UI_PATH = activeUiJson.uiPath;
      process.env.VOLUMIO_ACTIVE_UI_PRETTY_NAME = activeUiJson.uiPrettyName;
      self.commandRouter.pushToastMessage('success', self.commandRouter.getI18nString('APPEARANCE.USER_INTERFACE_SETTINGS'), self.commandRouter.getI18nString('APPEARANCE.USER_INTERFACE_SUCCESSFULLY_SET_TO') + ' ' + activeUiJson.uiPrettyName);
    } catch(e) {
      self.logger.error('Failed to write ' + uiFlagFile + ': ' + e);
      self.commandRouter.pushToastMessage('error', self.commandRouter.getI18nString('COMMON.ERROR'), self.commandRouter.getI18nString('APPEARANCE.FAILED_TO_SELECT_USER_INTERFACE'));
    }
  } else {
    self.logger.error('Cannot find UI path: ' + activeUiJson.uiPath);
    return self.commandRouter.pushToastMessage('error', self.commandRouter.getI18nString('COMMON.ERROR'), self.commandRouter.getI18nString('APPEARANCE.FAILED_TO_SELECT_USER_INTERFACE'));
  }
};

volumioAppearance.prototype.sendSizeErrorToasMessage = function (size) {
  var self = this;
  return self.commandRouter.pushToastMessage('error', self.commandRouter.getI18nString('APPEARANCE.UPLOAD_FAILED'), self.commandRouter.getI18nString('APPEARANCE.IMAGE_MUST_BE_LESS_THAN') + ' ' + size + ' MB');
};

volumioAppearance.prototype.setTOSAccepted = function () {
  var self = this;
  var defer = libQ.defer();

  self.getRemoteTOSHash().then((hashToSave)=>{
    config.set('tos_accepted_hash', hashToSave);
    config.set('tos_accepted', true);
    defer.resolve(true);
  }).fail((e) => {
    self.logger.error('Failed save TOS status: ' + e)
  });

  return defer.promise;
};

volumioAppearance.prototype.getRemoteTOSHash = function () {
  var self = this;
  var defer = libQ.defer();

  exec('curl https://volumio.github.io/volumio-tos/ --output /tmp/tos', function (error, stdout, stderr) {
    if (error !== null) {
      defer.resolve('default');
    } else {
      self.getFileHash('/tmp/tos').then((hashedFile)=>{
        defer.resolve(hashedFile);
      })
    }
  });
  return defer.promise;
};

volumioAppearance.prototype.getFileHash = function (filePath) {
  var self = this;
  var defer = libQ.defer();

  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      defer.resolve('');
    } else {
      var ashedResult = crypto.createHash('md5').update(data).digest("hex");
      defer.resolve(ashedResult);
    }
  });

  return defer.promise;
};

volumioAppearance.prototype.isLatestTOSAccepted = function () {
  var self = this;
  var defer = libQ.defer();

  if (config.get('tos_accepted', false)) {
    if (process.env.REQUIRE_LATEST_TOS_ACCEPTANCE === 'true') {
      self.getRemoteTOSHash().then((remoteTOSHash)=>{
        var acceptedTOSHash = config.get('tos_accepted_hash', '');
        if (acceptedTOSHash === remoteTOSHash) {
          defer.resolve(true);
        } else {
          defer.resolve(false);
        }
      })
    } else {
      defer.resolve(true);
    }
  } else {
    defer.resolve(false);
  }

  return defer.promise;
};
