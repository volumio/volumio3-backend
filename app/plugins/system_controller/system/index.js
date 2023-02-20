'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var config = new (require('v-conf'))();
var execSync = require('child_process').execSync;
var spawn = require('child_process').spawn;
var exec = require('child_process').exec;
var spawn = require('child_process').spawn;
var crypto = require('crypto');
var calltrials = 0;
var additionalSVInfo;
var additionalDeviceVolumioProperties = {};
var hwFwVersion;
var hwVersion;
const { v4: uuidv4 } = require('uuid');
const e = require('express');
var hwUuid;

// Define the ControllerSystem class
module.exports = ControllerSystem;

function ControllerSystem (context) {
  var self = this;

  // Save a reference to the parent commandRouter
  self.context = context;
  self.commandRouter = self.context.coreCommand;
  self.configManager = self.context.configManager;
  self.logger = self.context.logger;
  self.callbacks = [];
}

ControllerSystem.prototype.onVolumioStart = function () {
  var self = this;

  // getting configuration
  var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');

  this.config = new (require('v-conf'))();
  this.config.loadFile(configFile);

  var uuid = this.config.get('uuid');
  if (uuid == undefined) {
    self.logger.info('No id defined. Creating one');
    self.config.addConfigValue('uuid', 'string', uuidv4());
  }

  var autoUpdate = self.config.get('autoUpdate');
  if (autoUpdate == undefined) {
    self.config.addConfigValue('autoUpdate', 'boolean', process.env.AUTO_UPDATE_AUTOMATIC_INSTALL === 'true');
  } else {
    if (autoUpdate) {
      process.env.AUTO_UPDATE_AUTOMATIC_INSTALL = 'true';
    } else {
      process.env.AUTO_UPDATE_AUTOMATIC_INSTALL = 'false';
    }
  }

  this.commandRouter.sharedVars.addConfigValue('system.uuid', 'string', uuid);
  this.commandRouter.sharedVars.addConfigValue('system.name', 'string', self.config.get('playerName'));

  process.env.ADVANCED_SETTINGS_MODE = this.config.get('advanced_settings_mode', true);
  if (fs.existsSync('/volumio/http/wizard')) {
    process.env.NEW_WIZARD = 'true';
  } else {
    process.env.NEW_WIZARD = 'false';
  }

  return libQ.all(self.deviceDetect());
};

ControllerSystem.prototype.onStart = function () {
  var self = this;
  var defer = libQ.defer();

  self.callHome();
  self.initializeFirstStart();
  self.loadDefaultAdditionalDeviceVolumioProperties();
  
  defer.resolve('OK')
  return defer.promise;
};

ControllerSystem.prototype.onStop = function () {
  var self = this;
  // Perform startup tasks here
};

ControllerSystem.prototype.onRestart = function () {
  var self = this;
  // Perform startup tasks here
};

ControllerSystem.prototype.onInstall = function () {
  var self = this;
  // Perform your installation tasks here
};

ControllerSystem.prototype.onUninstall = function () {
  var self = this;
  // Perform your installation tasks here
};

ControllerSystem.prototype.getUIConfig = function () {
  var self = this;
  var defer = libQ.defer();

  var lang_code = self.commandRouter.sharedVars.get('language_code');
  var showLanguageSelector = self.getAdditionalConf('miscellanea', 'appearance', 'language_on_system_page', false);
  var device = self.config.get('device', '');
  var showDiskInstaller = self.config.get('show_disk_installer', true);
  var HDMIEnabled = self.config.get('hdmi_enabled', false);
  self.commandRouter.i18nJson(__dirname + '/../../../i18n/strings_' + lang_code + '.json',
    __dirname + '/../../../i18n/strings_en.json',
    __dirname + '/UIConfig.json')
    .then(function (uiconf) {
      self.configManager.setUIConfigParam(uiconf, 'sections[0].content[0].value', self.config.get('playerName'));
      self.configManager.setUIConfigParam(uiconf, 'sections[0].content[1].value', self.config.get('startupSound'));
      var advancedSettingsStatus = self.getAdvancedSettingsStatus();
      self.configManager.setUIConfigParam(uiconf, 'sections[0].content[3].value.value', advancedSettingsStatus);
      self.configManager.setUIConfigParam(uiconf, 'sections[0].content[3].value.label', self.getLabelForSelect(self.configManager.getValue(uiconf, 'sections[0].content[3].options'), advancedSettingsStatus));
      if (process.env.SHOW_ADVANCED_SETTINGS_MODE_SELECTOR === 'true') {
        self.configManager.setUIConfigParam(uiconf, 'sections[0].content[3].hidden', false);
      }

      self.configManager.setUIConfigParam(uiconf, 'sections[1].content[0].value', HDMIEnabled);

      if (device != undefined && device.length > 0 && (device === 'Tinkerboard' || device === 'x86') && showDiskInstaller) {
        var hwdevice = device;
        var disks = self.getDisks();
        if (disks != undefined) {
          disks.then(function (result) {
            if (result.available.length > 0) {
              uiconf.sections[4].hidden = false;
              var disklist = result.available;
              for (var i in disklist) {
                var device = disklist[i];
                var label = self.commandRouter.getI18nString('SYSTEM.INSTALL_TO_DISK') + ' ' + device.name;
                var description = self.commandRouter.getI18nString('SYSTEM.INSTALL_TO_DISK_DESC') + ': ' + device.name + ' ' + self.commandRouter.getI18nString('SYSTEM.INSTALL_TO_DISK_SIZE') + ': ' + device.size;
                var title = self.commandRouter.getI18nString('SYSTEM.INSTALL_TO_DISK_DESC') + ' ' + device.name;
                var message = self.commandRouter.getI18nString('SYSTEM.INSTALL_TO_DISK_MESSAGE') + ' ' + device.name + ' ' + device.size + '. ' + self.commandRouter.getI18nString('SYSTEM.INSTALL_TO_DISK_MESSAGE_WARNING');
                var onClick = {'type': 'emit', 'message': 'installToDisk', 'data': {'from': result.current, 'target': device.device, 'hwdevice': hwdevice}, 'askForConfirm': {'title': title, 'message': message}};
                var item = {'id': 'install_to_disk' + device.device, 'element': 'button', 'label': label, 'description': description, 'onClick': onClick};
                uiconf.sections[4].content.push(item);
              }
            }
          })
            .fail(function () {
            });
        }
      }
            
      var autoUpdate = self.config.get('autoUpdate', false);
      uiconf.sections[3].content[2].value = autoUpdate;

      self.getAutoUpdateTimes().forEach((time) => {
        self.configManager.pushUIConfigParam(uiconf, 'sections[3].content[3].options', {
          value: time,
          label: time
        });
        self.configManager.pushUIConfigParam(uiconf, 'sections[3].content[4].options', {
          value: time,
          label: time
        });
      })

      var autoUpdateWindowStartTime = self.getAutoUpdateWindowStartTime();

      self.configManager.setUIConfigParam(uiconf, 'sections[3].content[3].value', {
        value: autoUpdateWindowStartTime,
        label: autoUpdateWindowStartTime
      });

      var autoUpdateWindowStopTime = self.getAutoUpdateWindowStopTime();

      self.configManager.setUIConfigParam(uiconf, 'sections[3].content[4].value', {
        value: autoUpdateWindowStopTime,
        label: autoUpdateWindowStopTime
      });

      var allowUiStatistics = self.config.get('allow_ui_statistics', true);
      uiconf.sections[6].content[0].value = allowUiStatistics;

      self.commandRouter.i18nJson(__dirname + '/../../../i18n/strings_' + lang_code + '.json',
        __dirname + '/../../../i18n/strings_en.json',
        __dirname + '/language_selector.json')
        .then(function (languageSelector) {
        var languagesdata = fs.readJsonSync(('/volumio/app/plugins/miscellanea/appearance/languages.json'), 'utf8', {throws: false});
        var language = self.commandRouter.executeOnPlugin('miscellanea', 'appearance', 'getConfigParam', 'language');
        var language_code = self.commandRouter.executeOnPlugin('miscellanea', 'appearance', 'getConfigParam', 'language_code');
        uiconf.sections.unshift(languageSelector);

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
        
        self.getAvailableTimezones().forEach((timeZone) => {
          self.configManager.pushUIConfigParam(uiconf, 'sections[0].content[1].options', {
            value: timeZone,
            label: timeZone
          });
        })

        var currentTimezone = self.getCurrentTimezone();

        self.configManager.setUIConfigParam(uiconf, 'sections[0].content[1].value', {
          value: currentTimezone,
          label: currentTimezone
        });


        var uiValue = "";
        var uiLabel = "";
        if (fs.existsSync('/data/disableManifestUI') === false) {
          uiValue = "MANIFEST";
          uiLabel = self.commandRouter.getI18nString('APPEARANCE.USER_INTERFACE_MANIFEST');
        } else if (process.env.VOLUMIO_3_UI === 'true') {
          uiValue = "CONTEMPORARY";
          uiLabel = self.commandRouter.getI18nString('APPEARANCE.USER_INTERFACE_CONTEMPORARY');
        } else if (fs.existsSync("/data/volumio2ui")) {
          uiValue = "CLASSIC";
          uiLabel = self.commandRouter.getI18nString('APPEARANCE.USER_INTERFACE_CLASSIC');
        } 
        self.configManager.setUIConfigParam(uiconf, 'sections[8].content[0].value.value', uiValue);
        self.configManager.setUIConfigParam(uiconf, 'sections[8].content[0].value.label', uiLabel);

        
        defer.resolve(uiconf);
      });

    })
    .fail(function (error) {
      self.logger.info(error);
      defer.reject(new Error());
    });

  return defer.promise;
};

ControllerSystem.prototype.capitalize = function () {
  return this.charAt(0).toUpperCase() + this.slice(1);
};

ControllerSystem.prototype.setUIConfig = function (data) {
  var self = this;

  var uiconf = fs.readJsonSync(__dirname + '/UIConfig.json');
};

ControllerSystem.prototype.getConf = function (varName) {
  var self = this;

  return self.config.get(varName);
};

ControllerSystem.prototype.setConf = function (varName, varValue) {
  var self = this;

  var defer = libQ.defer();

  self.config.set(varName, varValue);
  if (varName === 'player_name') {
    var player_name = varValue;

    for (var i in self.callbacks) {
      var callback = self.callbacks[i];

      callback.call(callback, player_name);
    }
    return defer.promise;
  }
};

ControllerSystem.prototype.getConfigurationFiles = function () {
  var self = this;

  return ['config.json'];
};

// Optional functions exposed for making development easier and more clear
ControllerSystem.prototype.getSystemConf = function (pluginName, varName) {
  var self = this;
  // Perform your installation tasks here
};

ControllerSystem.prototype.setSystemConf = function (pluginName, varName) {
  var self = this;
  // Perform your installation tasks here
};

ControllerSystem.prototype.getAdditionalConf = function () {
  var self = this;
  // Perform your installation tasks here
};

ControllerSystem.prototype.setAdditionalConf = function () {
  var self = this;
  // Perform your installation tasks here
};

ControllerSystem.prototype.getConfigParam = function (key) {
  return this.config.get(key);
};

ControllerSystem.prototype.saveGeneralSettings = function (data) {
  var self = this;

  var defer = libQ.defer();

  if (data['startup_sound'] != undefined) {
    self.config.set('startupSound', data['startup_sound']);
  }

  if (data['advanced_settings'] !== undefined && data['advanced_settings'].value !== undefined) {
    self.config.set('advanced_settings_mode', data['advanced_settings'].value);
    process.env.ADVANCED_SETTINGS_MODE = data['advanced_settings'].value;
  }

  var oldPlayerName = self.config.get('playerName');
  var player_name = data['player_name'];
  if (player_name && player_name !== oldPlayerName) {
    var hostname = data['player_name'].split(' ').join('-');
    self.config.set('playerName', player_name);
    self.commandRouter.pushToastMessage('success', self.commandRouter.getI18nString('SYSTEM.SYSTEM_CONFIGURATION_UPDATE'), self.commandRouter.getI18nString('SYSTEM.SYSTEM_CONFIGURATION_UPDATE_SUCCESS'));
    self.setHostname(player_name);
    self.commandRouter.sharedVars.set('system.name', player_name);
    defer.resolve({});

    for (var i in self.callbacks) {
      var callback = self.callbacks[i];

      callback.call(callback, player_name);
    }
  } else {
    defer.resolve({});
  }

  return defer.promise;
};

ControllerSystem.prototype.saveSoundQuality = function (data) {
  var self = this;

  var defer = libQ.defer();

  var kernel_profile_value = data['kernel_profile'].value;
  var kernel_profile_label = data['kernel_profile'].label;

  self.config.set('kernelSettingValue', kernel_profile_value);
  self.config.set('kernelSettingLabel', kernel_profile_label);

  self.commandRouter.pushToastMessage('success', self.commandRouter.getI18nString('SYSTEM.SYSTEM_CONFIGURATION_UPDATE'), self.commandRouter.getI18nString('SYSTEM.SYSTEM_CONFIGURATION_UPDATE_SUCCESS'));

  defer.resolve({});
  return defer.promise;
};

ControllerSystem.prototype.getData = function (data, key) {
  var self = this;

  for (var i in data) {
    var ithdata = data[i];

    if (ithdata[key] != undefined) { return ithdata[key]; }
  }

  return null;
};

ControllerSystem.prototype.setHostname = function (hostname) {
  var self = this;
  var newhostname = hostname.toLowerCase().replace(/ /g, '-');

  fs.writeFile('/etc/hostname', newhostname, function (err) {
    if (err) {
      self.logger.error('Failed to set hostname: ' + err);
      self.commandRouter.pushToastMessage('alert', self.commandRouter.getI18nString('SYSTEM.SYSTEM_NAME'), self.commandRouter.getI18nString('SYSTEM.SYSTEM_NAME_ERROR'));
    } else {
      exec('/usr/bin/sudo /bin/chmod 777 /etc/hosts', {uid: 1000, gid: 1000}, function (error, stdout, stderr) {
        if (error !== null) {
          self.logger.error('Cannot set permissions for /etc/hosts: ' + error);
        } else {
          self.logger.info('Permissions for /etc/hosts set');
          exec('/usr/bin/sudo /bin/hostname ' + newhostname, {uid: 1000, gid: 1000}, function (error, stdout, stderr) {
            if (error !== null) {
              self.logger.error('Cannot set new hostname: ' + error);
            } else {
              self.logger.info('New hostname set');
            }
          });
        }

        fs.writeFile('/etc/hosts', '127.0.0.1       localhost ' + newhostname, function (err) {
          if (err) {
            self.logger.error('Failed to write hosts file: ' + err);
          } else {
            self.commandRouter.pushToastMessage('success', self.commandRouter.getI18nString('SYSTEM.SYSTEM_NAME'), self.commandRouter.getI18nString('SYSTEM.SYSTEM_NAME_NOW') + ' ' + hostname);
            self.logger.info('Hostname now is ' + newhostname);
            var avahiconf = '<?xml version="1.0" standalone="no"?><service-group><name replace-wildcards="yes">' + hostname + '</name><service><type>_http._tcp</type><port>80</port></service></service-group>';
            exec('/usr/bin/sudo /bin/chmod -R 777 /etc/avahi/services/', {uid: 1000, gid: 1000}, function (error, stdout, stderr) {
              if (error !== null) {
                self.logger.error('Cannot set permissions for /etc/avahi/services/: ' + error);
              } else {
                self.logger.info('Permissions for /etc/avahi/services/volumio.service');
                fs.writeFile('/etc/avahi/services/volumio.service', avahiconf, function (err) {
                  if (err) {
                    self.logger.error(err);
                  } else {
                    self.logger.info('Avahi name changed to ' + newhostname);
                  }
                });
              }
            });
            setTimeout(function () {
              // Restarting AVAHI results in system crashing
              // self.restartAvahi();
            }, 10000);
          }
        });
      });
    }
  });
};

ControllerSystem.prototype.restartAvahi = function () {
  var self = this;

  exec('/usr/bin/sudo /bin/systemctl restart avahi-daemon.service', {
    uid: 1000,
    gid: 1000
  }, function (error, stdout, stderr) {
    if (error !== null) {
      self.logger.error('Failed to restart Avahi: ' + error);
      self.commandRouter.pushToastMessage('alert', self.commandRouter.getI18nString('SYSTEM.SYSTEM_NAME'), self.commandRouter.getI18nString('SYSTEM.SYSTEM_NAME_ERROR'));
    } else {
      self.logger.info('Avahi Daemon Restarted');
    }
  });
};

ControllerSystem.prototype.registerCallback = function (callback) {
  var self = this;

  self.callbacks.push(callback);
};

ControllerSystem.prototype.getSystemVersion = function () {
  var self = this;
  var defer = libQ.defer();
  var file = fs.readFileSync('/etc/os-release').toString().split('\n');
  var releaseinfo = {
    'systemversion': null,
    'builddate': null,
    'variant': null,
    'hardware': null
  };

  var nLines = file.length;
  var str;
  for (var l = 0; l < nLines; l++) {
    if (file[l].match(/VOLUMIO_VERSION/i)) {
      str = file[l].split('=');
      releaseinfo.systemversion = str[1].replace(/\"/gi, '');
    }
    if (file[l].match(/VOLUMIO_BUILD_DATE/i)) {
      str = file[l].split('=');
      releaseinfo.builddate = str[1].replace(/\"/gi, '');
    }
    if (file[l].match(/VOLUMIO_VARIANT/i)) {
      str = file[l].split('=');
      releaseinfo.variant = str[1].replace(/\"/gi, '');
    }
    if (file[l].match(/VOLUMIO_HARDWARE/i)) {
      str = file[l].split('=');
      releaseinfo.hardware = str[1].replace(/\"/gi, '');
    }
  }

  if (additionalSVInfo) {
    releaseinfo.additionalSVInfo = additionalSVInfo;
  }

  if (hwFwVersion) {
    releaseinfo.hwFwVersion = hwFwVersion;
  }

  if (hwVersion) {
    releaseinfo.hwVersion = hwVersion;
  }

  defer.resolve(releaseinfo);

  return defer.promise;
};

ControllerSystem.prototype.getSystemInfo = function () {
  var self = this;
  var defer = libQ.defer();

  var thisDeviceStatus = self.commandRouter.executeOnPlugin('system_controller', 'volumiodiscovery', 'getThisDevice', '');
  var hwUuid = self.getHwuuid();
  var thisDeviceVolumioProperties = self.getThisDeviceVolumioProperties();
  var systemVersion = self.getSystemVersion()
  systemVersion.then((systemInfoObj)=>{
    var systemInfoObj = {
      ...thisDeviceStatus,
      ...systemInfoObj,
      ...thisDeviceVolumioProperties,
      hwUuid
    };
    defer.resolve(systemInfoObj)
  })

  return defer.promise;
};

ControllerSystem.prototype.setTestSystem = function (data) {
  var self = this;

  if (data == 'true') {
    fs.writeFile('/data/test', ' ', function (err) {
      if (err) {
        self.logger.info('Cannot set as test device:' + err);
      }
      self.logger.info('Device is now in test mode');
    });
  } else if (data == 'false') {
    fs.exists('/data/test', function (exists) {
      exec('rm /data/test', function (error, stdout, stderr) {
        if (error !== null) {
          self.logger.error('Cannot delete test file: ' + error);
        } else {
          self.logger.info('Test File deleted');
        }
      });
    });
  }

  self.commandRouter.executeOnPlugin('system_controller', 'updater_comm', 'checkUpdates');
};

ControllerSystem.prototype.setTestPlugins = function (data) {
  var self = this;

  if (data == 'true') {
    fs.writeFile('/data/testplugins', ' ', function (err) {
      if (err) {
        self.logger.info('Cannot set as plugins test device:' + err);
      }
      self.logger.info('Plugins store is now in test mode');
    });
  } else if (data == 'false') {
    fs.exists('/data/testplugins', function (exists) {
      exec('rm /data/testplugins', function (error, stdout, stderr) {
        if (error !== null) {
          self.logger.error('Cannot delete plugins test file: ' + error);
        } else {
          self.logger.info('Plugins Test File deleted');
        }
      });
    });
  }
};

ControllerSystem.prototype.sendBugReport = function (message) {
  var self = this;

  if (message == undefined || message.text == undefined || message.text.length < 1) {
    message.text = 'No info available';
  }
  // Must single-quote the message or the shell may interpret it and crash.
  // single-quotes already within the message need to be escaped.
  // The resulting string always starts and ends with single quotes.
  var description = '';
  var pieces = message.text.split("'");
  var n = pieces.length;
  for (var i = 0; i < n; i++) {
    description = description + "'" + pieces[i] + "'";
    if (i < (n - 1)) description = description + "\\'";
  }

  exec('/usr/bin/node /volumio/logsubmit.js ' + description, {uid: 1000, gid: 1000}, function (error, stdout, stderr) {
    if (error !== null) {
      self.logger.info('Cannot send bug report: ' + error);
    } else {
      self.logger.info('Log sent successfully, reply: ' + stdout);
      // if (stdout != undefined && stdout.status != undefined && stdout.status == 'OK' && stdout.link != undefined ) {
      return self.commandRouter.broadcastMessage('pushSendBugReport', stdout);
      // }
    }
  });
};

ControllerSystem.prototype.deleteUserData = function () {
  var self = this;

  fs.writeFile('/boot/user_data', ' ', function (err) {
    if (err) {
      self.logger.info('Cannot User Data delete file');
    } else {
      self.logger.info('Created User Data delete file, rebooting');
      self.commandRouter.reboot();
    }
  });
};

ControllerSystem.prototype.factoryReset = function () {
  var self = this;

  fs.writeFile('/boot/factory_reset', ' ', function (err) {
    if (err) {
      self.logger.info('Cannot Initiate factory reset');
    } else {
      self.logger.info('Created Factory Reset file, rebooting');
      self.commandRouter.reboot();
    }
  });
};

ControllerSystem.prototype.deviceDetect = function (data) {
  var self = this;
  var defer = libQ.defer();
  var device = '';

  var info = self.getSystemVersion();
  info.then(function (infos) {
    if (infos != undefined && infos.hardware != undefined && (infos.hardware === 'x86' || infos.hardware === 'x86_amd64' || infos.hardware === 'x86_i386')) {
      device = 'x86';
      self.deviceCheck(device);
      defer.resolve(device);
    } else {
      exec('cat /proc/cpuinfo | grep Hardware', {uid: 1000, gid: 1000}, function (error, stdout, stderr) {
        if (error !== null) {
          self.logger.info('Cannot read proc/cpuinfo: ' + error);
          defer.resolve('unknown');
        } else {
          var hardwareLine = stdout.split(':');
          var cpuidparam = hardwareLine[1].replace(/\s/g, '');
          var deviceslist = fs.readJson(('/volumio/app/plugins/system_controller/system/devices.json'),
          { encoding: 'utf8', throws: false },
          function (err, deviceslist) {
            if(deviceslist && deviceslist.devices) {
              for (var i = 0; i < deviceslist.devices.length; i++) {
                if (deviceslist.devices[i].cpuid == cpuidparam) {
                  device = deviceslist.devices[i].name;
                  self.deviceCheck(device);
                  defer.resolve(device);
                  return;
                }
              }
              defer.resolve('unknown');
            } else {
              defer.resolve('unknown');
            }
          });
          // self.logger.info('CPU ID ::'+cpuidparam+'::');
        }
      });
    }
  });

  return defer.promise;
};

ControllerSystem.prototype.deviceCheck = function (data) {
  var self = this;

  var device = config.get('device');

  if (device == undefined) {
    self.logger.info('Setting Device type: ' + data);
    self.config.set('device', data);
  } else if (device != data) {
    self.logger.info('Device has changed, setting Device type: ' + data);
    self.config.set('device', data);
  }
};

ControllerSystem.prototype.callHome = function () {
  var self = this;

  try {
    var macaddr = fs.readFileSync('/sys/class/net/eth0/address', 'utf8');
    var anonid = macaddr.toString().replace(':', '');
  } catch (e) {
    var anonid = self.config.get('uuid');
  }
  var md5 = crypto.createHash('md5').update(anonid).digest('hex');
  var info = self.getSystemVersion();
  info.then(function (infos) {
    if ((infos.variant) && (infos.systemversion) && (infos.hardware) && (md5)) {
      self.logger.info('Volumio Calling Home');
      exec('/usr/bin/curl -X POST --data-binary "device=' + infos.hardware + '&variante=' + infos.variant + '&version=' + infos.systemversion + '&uuid=' + md5 + '" http://updates.volumio.org/downloader-v1/track-device',
        function (error, stdout, stderr) {
          if (error !== null) {
            if (calltrials < 3) {
              setTimeout(function () {
                self.logger.info('Cannot call home: ' + error + ' retrying in 5 seconds, trial ' + calltrials);
                calltrials++;
                self.callHome();
              }, 10000);
            }
          } else self.logger.info('Volumio called home');
        });
    } else {
      self.logger.info('Cannot retrieve data for calling home');
    }
  });
};

ControllerSystem.prototype.enableSSH = function (data) {
  var self = this;

  var action = 'enable';
  var immediate = 'start';
  if (data == 'false') {
    action = 'disable';
    immediate = 'stop';
  }

  exec('/usr/bin/sudo /bin/systemctl ' + immediate + ' ssh.service && /usr/bin/sudo /bin/systemctl ' + action + ' ssh.service', {uid: 1000, gid: 1000}, function (error, stdout, stderr) {
    if (error !== null) {
      self.logger.error('Cannot ' + action + ' SSH service: ' + error);
    } else {
      self.logger.info(action + ' SSH service success');
    }
  });
};

ControllerSystem.prototype.checkPassword = function (data) {
  var self = this;
  var defer = libQ.defer();

  var currentpass = self.config.get('system_password', 'volumio');

  if (data.password === currentpass) {
    defer.resolve(true);
  } else {
    defer.resolve(false);
  }

  return defer.promise;
};

ControllerSystem.prototype.getDisks = function () {
  var self = this;
  var defer = libQ.defer();
  var availablearray = [];

  var currentdiskRaw = execSync('/bin/mount | grep "/imgpart" | head -n 1 | cut -d " " -f 1', { uid: 1000, gid: 1000, encoding: 'utf8'});
  var currentdisk = currentdiskRaw.replace(/[0-9]/g, '').replace('/dev/', '').replace(/\n/, '');

  var disksraw = execSync('/bin/lsblk -P -o KNAME,SIZE,MODEL -d', { uid: 1000, gid: 1000, encoding: 'utf8'});
  var disks = disksraw.split('\n');

  if (currentdisk === 'mmcblkp' || currentdisk === 'nvmenp') {
    currentdiskRaw = execSync('/bin/mount | grep "/imgpart" | head -n 1 | cut -d " " -f 1 | cut -d "/" -f 3 | cut -d "p" -f 1', { uid: 1000, gid: 1000, encoding: 'utf8'});
    currentdisk = currentdiskRaw.replace(/\n/, '');
  }

  for (var i = 0; i < disks.length; i++) {
    if ((disks[i].indexOf(currentdisk) >= 0) || (disks[i].indexOf('loop') >= 0) || (disks[i].indexOf('rpmb') >= 0) || (disks[i].indexOf('boot') >= 0)) {

    } else {
      var disksarray = disks[i].split(' ');

      var diskinfo = {'device': '', 'name': '', 'size': ''};
      var count = 0;
      for (var a = 0; a < disksarray.length; a++) {
        count++;
        if (disksarray[a].indexOf('KNAME') >= 0) {
          diskinfo.device = disksarray[a].replace('KNAME=', '').replace(/"/g, '');
        }
        if (disksarray[a].indexOf('SIZE') >= 0) {
          diskinfo.size = disksarray[a].replace('SIZE=', '').replace(/"/g, '');
        }
        if (disksarray[a].indexOf('MODEL') >= 0) {
          diskinfo.name = disksarray[a].replace('MODEL=', '').replace(/"/g, '');
        }
        if (diskinfo.device.indexOf('mmcblk') >= 0) {
				   diskinfo.name = 'eMMC/SD';
        }
        if (diskinfo.device.indexOf('nvme') >= 0) {
          diskinfo.name = 'NVMe';
        }

        if (count === 3) {
          if (diskinfo.device && diskinfo.size) {
            availablearray.push(diskinfo);
            diskinfo = {'device': '', 'name': '', 'size': ''};
          }
          count = 0;
        }
      }
    }
  }
  var final = {'current': currentdisk, 'available': availablearray};
  defer.resolve(final);

  return defer.promise;
};

ControllerSystem.prototype.installToDisk = function () {
  var self = this;
  var defer = libQ.defer();
  var copymessage = self.commandRouter.getI18nString('SYSTEM.COPYING_TO_DISK_MESSAGE');
  var modaltitle = self.commandRouter.getI18nString('SYSTEM.INSTALLING_TO_DISK');

  self.startInstall()
    .then(self.pushMessage.bind(self, 'installPluginStatus', {
      'progress': 5,
      'message': copymessage,
      'title': modaltitle
    }))
    .then(self.ddToDisk.bind(self))
    .then(function (e) {
      currentMessage = 'Unpacking plugin';
      advancedlog = advancedlog + '<br>' + currentMessage;
      self.pushMessage('installPluginStatus', {'progress': 40, 'message': currentMessage, 'title': modaltitle, 'advancedLog': advancedlog});
      return e;
    });

  return defer.promise;
};

ControllerSystem.prototype.startInstall = function () {
  var self = this;
  var defer = libQ.defer();
  var time = 0;
  var currentMessage = self.commandRouter.getI18nString('SYSTEM.INSTALLING_TO_DISK_MESSAGE');
  var modaltitle = self.commandRouter.getI18nString('SYSTEM.INSTALLING_TO_DISK');

  self.pushMessage('volumioInstallStatus', {'progress': 1, 'message': currentMessage, 'title': modaltitle});
  setTimeout(function () {
    defer.resolve();
  }, 5000);

  return defer.promise;
};

ControllerSystem.prototype.pushMessage = function (emit, payload) {
  var self = this;
  var defer = libQ.defer();

  self.coreCommand.broadcastMessage(emit, payload);

  defer.resolve();
  return defer.promise;
};

ControllerSystem.prototype.getAdditionalConf = function (type, controller, data, def) {
  var self = this;
  var setting = self.commandRouter.executeOnPlugin(type, controller, 'getConfigParam', data);

  if (setting == undefined) {
    setting = def;
  }
  return setting;
};

ControllerSystem.prototype.getShowWizard = function () {
  var self = this;

  var show = self.config.get('show_wizard', false);

  return show;
};

ControllerSystem.prototype.setShowWizard = function (data) {
  var self = this;

  self.config.set('show_wizard', data);
};

ControllerSystem.prototype.installToDisk = function (data) {
  var self = this;

  var ddsize = '';
  var error = false;
  if (data.from != undefined) {
    	var source = '/dev/' + data.from;
  }

  if (data.target != undefined) {
    	var target = '/dev/' + data.target;
  }

  var hwdevice = data.hwdevice;

  if (hwdevice !== 'x86') {
    // Tinker processing
    self.notifyInstallToDiskStatus({'progress': 0, 'status': 'started'});
    var ddsizeRaw = execSync('/bin/lsblk -b | grep -w ' + data.from + " | awk '{print $4}' | head -n1", { uid: 1000, gid: 1000, encoding: 'utf8'});
    ddsize = Math.ceil(ddsizeRaw / 1024 / 1024);
    var ddsizeRawDest = execSync('/bin/lsblk -b | grep -w ' + data.target + " | awk '{print $4}' | head -n1", { uid: 1000, gid: 1000, encoding: 'utf8'});

    if (Number(ddsizeRaw) > Number(ddsizeRawDest)) {
      error = true;
      var sizeError = self.commandRouter.getI18nString('SYSTEM.INSTALLING_TO_DISK_ERROR_TARGET_SIZE');
      self.notifyInstallToDiskStatus({'progress': 0, 'status': 'error', 'error': sizeError});
    } else {
      try {
        var copy = exec('/usr/bin/sudo /usr/bin/dcfldd if=' + source + ' of=' + target + ' bs=1M status=on sizeprobe=if statusinterval=10 >> /tmp/install_progress 2>&1', {uid: 1000, gid: 1000, encoding: 'utf8'});
      } catch (e) {
        error = true;
        self.notifyInstallToDiskStatus({'progress': 0, 'status': 'error', 'error': 'Cannot install on new Disk'});
      }

      var copyProgress = exec('usr/bin/tail -f /tmp/install_progress');

      copyProgress.stdout.on('data', function (data) {
        self.logger.info('Data: ' + data);
        if (data.indexOf('%') >= 0) {
          var progressRaw = data.split('(')[1].split('Mb)')[0];
          var progress = Math.ceil((100 * progressRaw) / ddsize);
          if (progress <= 100) {
            if (progress >= 95) {
              progress = 95;
            }
            self.notifyInstallToDiskStatus({'progress': progress, 'status': 'progress'});
          }
        }
      });

      copy.on('close', function (code) {
        if (code === 0) {
          self.logger.info('Successfully cloned system');

          try {
            fs.unlinkSync('/tmp/boot');
            fs.unlinkSync('/tmp/imgpart');
          } catch (e) {}

          try {
            if (target === '/dev/mmcblk0' || target === '/dev/mmcblk1') {
              target = target + 'p';
            }
            execSync('mkdir /tmp/boot', { uid: 1000, gid: 1000, encoding: 'utf8'});
            execSync('/usr/bin/sudo /bin/mount ' + target + '1 /tmp/boot -o rw,uid=1000,gid=1000', { uid: 1000, gid: 1000, encoding: 'utf8'});
            execSync('/bin/touch /tmp/boot/resize-volumio-datapart', { uid: 1000, gid: 1000, encoding: 'utf8'});
            execSync('/bin/sync', { uid: 1000, gid: 1000, encoding: 'utf8'});
            execSync('/usr/bin/sudo /bin/umount ' + target + '1', { uid: 1000, gid: 1000, encoding: 'utf8'});
            execSync('rm -rf /tmp/boot', { uid: 1000, gid: 1000, encoding: 'utf8'});
            self.logger.info('Successfully prepared system for resize');
          } catch (e) {
            self.logger.error('Cannot prepare system for resize');
            error = true;
            self.notifyInstallToDiskStatus({'progress': 0, 'status': 'error', 'error': 'Cannot prepare system for resize'});
          }

          if (!error) {
            self.notifyInstallToDiskStatus({'progress': 100, 'status': 'done'});
          }
        } else {
          self.notifyInstallToDiskStatus({'progress': 0, 'status': 'error'});
        }
      });
    }
  } else {

    self.commandRouter.executeOnPlugin('system_controller', 'networkfs', 'disableDeviceActions', '');

    var sep = '';
    if ((target.indexOf('mmcblk') >= 0) || (target.indexOf('nvme') >= 0)) {
      sep = 'p';
    }
    var boot_part = target + sep + '1';
    var volumio_part = target + sep + '2';
    var data_part = target + sep + '3';

    var partarr = fs.readFileSync('/boot/partconfig.json', 'utf8');
    var partparams = JSON.parse(partarr);
    var boot_start = partparams.params.find(item => item.name === 'boot_start').value;
    var boot_end = partparams.params.find(item => item.name === 'boot_end').value;
    var volumio_end = partparams.params.find(item => item.name === 'volumio_end').value;
    var boot_type = partparams.params.find(item => item.name === 'boot_type').value;

    self.notifyInstallToDiskStatus({'progress': 0, 'status': 'started'});
    execSync('/bin/echo "0" > /tmp/install_progress', { uid: 1000, gid: 1000, encoding: 'utf8'});

    try {
      var fastinstall = exec('/usr/bin/sudo /usr/local/bin/x86Installer.sh ' + target + ' ' + boot_type + ' ' + boot_start + ' ' + boot_end + ' ' + volumio_end + ' ' + boot_part + ' ' + volumio_part + ' ' + data_part, { uid: 1000, gid: 1000, encoding: 'utf8'});
    } catch (e) {
        error = true;
        self.logger.info('Install to disk failed');
        self.notifyInstallToDiskStatus({'progress': 0, 'status': 'error', 'error': 'Cannot install on new Disk'});
    }

    var installProgress = exec('usr/bin/tail -f /tmp/install_progress');

    installProgress.stdout.on('data', function (data) {
      self.logger.info('Progress: ' + data);
      self.notifyInstallToDiskStatus({'progress': data, 'status': 'progress'});
    });

    fastinstall.on('close', function (code) {
      if (code === 0) {
        self.logger.info('Successfully installed x86 factory copy to disk' + target);
        self.notifyInstallToDiskStatus({'progress': 100, 'status': 'done'});
      } else {
        self.notifyInstallToDiskStatus({'progress': 0, 'status': 'error'});
      }
      self.commandRouter.executeOnPlugin('system_controller', 'networkfs', 'enableDeviceActions', '');
    });
  }
};

ControllerSystem.prototype.notifyInstallToDiskStatus = function (data) {
  var self = this;
  var progress = data.progress;
  var status = data.status;
  var title = self.commandRouter.getI18nString('SYSTEM.INSTALLING_TO_DISK');
  var message = self.commandRouter.getI18nString('SYSTEM.INSTALLING_TO_DISK_MESSAGE');
  var emit = '';

  var responseData = {
    progress: true,
    progressNumber: progress,
    title: title,
    message: message,
    size: 'lg',
    buttons: [
      {
        name: self.commandRouter.getI18nString('COMMON.GOT_IT'),
        class: 'btn btn-info ng-scope',
        emit: '',
        payload: ''
      }
    ]
  };

  if (status === 'started') {
    	emit = 'openModal';
  } else if (status === 'progress') {
    	emit = 'modalProgress';
  } else if (status === 'done') {
    	emit = 'modalDone';
    responseData.title = self.commandRouter.getI18nString('SYSTEM.INSTALLING_TO_DISK_SUCCESS_TITLE');
    responseData.message = self.commandRouter.getI18nString('SYSTEM.INSTALLING_TO_DISK_SUCCESS_MESSAGE');
    var restartButton = {
      name: self.commandRouter.getI18nString('COMMON.RESTART'),
      class: 'btn btn-warning ng-scope',
      emit: 'reboot',
      payload: ''
    };
    responseData.buttons.push(restartButton);
  } else if (status === 'error') {
    emit = 'modalDone';
    responseData.message = self.commandRouter.getI18nString('SYSTEM.INSTALLING_TO_DISK_ERROR_MESSAGE') + ': ' + data.error;
  }
  self.commandRouter.broadcastMessage(emit, responseData);
};

ControllerSystem.prototype.saveHDMISettings = function (data) {
  var self = this;

  var currentConf = self.config.get('hdmi_enabled', false);
  if (currentConf |= data['hdmi_enabled']) {
    self.config.set('hdmi_enabled', data['hdmi_enabled']);

    var action = 'enable';
    var immediate = 'start';
    if (!data['hdmi_enabled']) {
      action = 'disable';
      immediate = 'stop';
    }

    exec('/usr/bin/sudo /bin/systemctl ' + immediate + ' volumio-kiosk.service && /usr/bin/sudo /bin/systemctl ' + action + ' volumio-kiosk.service', {uid: 1000, gid: 1000}, function (error, stdout, stderr) {
      if (error !== null) {
        self.logger.error('Cannot ' + action + ' volumio-kiosk service: ' + error);
      } else {
        self.logger.info(action + ' volumio-kiosk service success');
        self.commandRouter.pushToastMessage('success', self.commandRouter.getI18nString('SYSTEM.HDMI_UI'), self.commandRouter.getI18nString('SYSTEM.SYSTEM_CONFIGURATION_UPDATE_SUCCESS'));
      }
    });
  }
};

ControllerSystem.prototype.saveUpdateSettings = function (data) {
  var self = this;
  self.config.set('autoUpdate', data['automatic_updates']);
  self.config.set('autoUpdateWindowStartTime', data['automatic_updates_start_time'].value);
  self.config.set('autoUpdateWindowStopTime', data['automatic_updates_stop_time'].value);

  if (data['automatic_updates']) {
    process.env.AUTO_UPDATE_AUTOMATIC_INSTALL = 'true';
  } else {
    process.env.AUTO_UPDATE_AUTOMATIC_INSTALL = 'false';
  }

  self.commandRouter.executeOnPlugin('system_controller', 'updater_comm', 'clearUpdateSchedule');
};

ControllerSystem.prototype.getAutoUpdateEnabled = function () {
  var self = this;
  return self.config.get('autoUpdate', false);
};


ControllerSystem.prototype.getAutoUpdateWindowStartTime = function () {
  var self = this;
  return self.config.get('autoUpdateWindowStartTime', "3");
};

ControllerSystem.prototype.getAutoUpdateWindowStopTime = function () {
  var self = this;
  return self.config.get('autoUpdateWindowStopTime', "6");
};

ControllerSystem.prototype.versionChangeDetect = function () {
  var self = this;

  var info = self.getSystemVersion();
  info.then(function (infos) {
    if (infos != undefined && infos.systemversion != undefined) {
        	var systemVersion = self.config.get('system_version', 'none');
        	if (systemVersion !== infos.systemversion) {
        		self.config.set('system_version', infos.systemversion);
        		self.logger.info('Version has changed, forcing UI Reload');
        		return self.commandRouter.reloadUi();
      }
    }
  });
};

ControllerSystem.prototype.getMainDiskUsage = function () {
  var self = this;
  var defer = libQ.defer();
  var unity = ' MB';
  var mainDiskUsageObj = {'size': '', 'used': '', 'free': '', 'usedPercentage': '', 'freePercentage': ''};

  exec('/bin/df -h -m | grep overlay', {uid: 1000, gid: 1000}, function (error, stdout, stderr) {
    if (error !== null) {
      defer.reject({'error': error});
    } else {
        	try {
        var mainDiskArray = stdout.toString().split(' ').filter(item => item.trim() !== '');
        mainDiskUsageObj.size = mainDiskArray[1] + unity;
        mainDiskUsageObj.used = mainDiskArray[2] + unity;
        mainDiskUsageObj.free = mainDiskArray[3] + unity;
        mainDiskUsageObj.usedPercentage = parseInt(mainDiskArray[4].replace('%', ''));
        mainDiskUsageObj.freePercentage = 100 - mainDiskUsageObj.usedPercentage;
        defer.resolve(mainDiskUsageObj);
      } catch (e) {
        		self.logger.error('Error in parsing main disk data: ' + e);
        defer.reject({'error': error});
      }
    }
  });
  return defer.promise;
};

ControllerSystem.prototype.setAdditionalSVInfo = function (data) {
  var self = this;
  self.logger.info('Setting Additional System Software info: ' + data);
  additionalSVInfo = data;
};

ControllerSystem.prototype.setHwFwVersion = function (data) {
  var self = this;
  self.logger.info('Setting HW Firmware info: ' + data);
  hwFwVersion = data;
};

ControllerSystem.prototype.setHwVersion = function (data) {
  var self = this;
  self.logger.info('Setting HW Version info: ' + data);
  hwVersion = data;
};

ControllerSystem.prototype.getAdvancedSettingsStatus = function () {
  var self = this;
  if (process.env.ADVANCED_SETTINGS_MODE === 'true') {
    	return true;
  } else {
    	return false;
  }
};

ControllerSystem.prototype.getExperienceAdvancedSettings = function () {
  var self = this;

  var simpleSettingsString = self.commandRouter.getI18nString('SYSTEM.SIMPLE_SETTINGS_SET_EXTENDED');
  var fullSettingsString = self.commandRouter.getI18nString('SYSTEM.FULL_SETTINGS_SET_EXTENDED');
  var advancedSettingsStatus = self.getAdvancedSettingsStatus();
  var advancedSettingsStatusObject = {id: false, label: simpleSettingsString};
  if (advancedSettingsStatus) {
    advancedSettingsStatusObject = {id: true, label: fullSettingsString};
  }
  var responseObject = {
    'options': [{id: false, label: simpleSettingsString}, {id: true, label: fullSettingsString}],
    'status': advancedSettingsStatusObject
  };

  return responseObject;
};

ControllerSystem.prototype.setExperienceAdvancedSettings = function (data) {
  var self = this;

  self.logger.info('Saving Experience Advanced Settings');
  if (data !== undefined) {
    self.config.set('advanced_settings_mode', data);
    process.env.ADVANCED_SETTINGS_MODE = data;
  }
};

ControllerSystem.prototype.getLabelForSelect = function (options, key) {
  var self = this;

  var n = options.length;
  for (var i = 0; i < n; i++) {
    if (options[i].value == key) { return options[i].label; }
  }

  return 'Error';
};

ControllerSystem.prototype.getHwuuid = function () {
  var self = this;
  var defer = libQ.defer();

  if (hwUuid) {
    return hwUuid;
  } else {
    var ethHwUuuid = self.getHwuuidEth();
    var wlanHwUuuid = self.getHwuuidWlan();
    if (ethHwUuuid || wlanHwUuuid) {
      var hwUuidRaw = ethHwUuuid || wlanHwUuuid;
      hwUuid = crypto.createHash('md5').update(hwUuidRaw).digest('hex');
      return hwUuid;
    } else {
      var anonid = this.config.get('uuid');
      hwUuid = crypto.createHash('md5').update(anonid).digest('hex');
      return hwUuid;
    }
  }
};

ControllerSystem.prototype.getPrivacySettings = function () {
  var self = this;
  var defer = libQ.defer();

  var allowUIStatistics = self.config.get('allow_ui_statistics', true);
  var privacySettings = {
    allowUIStatistics: allowUIStatistics
  };
  defer.resolve(privacySettings);

  return defer.promise;
};

ControllerSystem.prototype.savePrivacySettings = function (data) {
  var self = this;
  var defer = libQ.defer();

  if (data && data.allow_ui_statistics !== undefined) {
    self.config.set('allow_ui_statistics', data.allow_ui_statistics);
  }
  return self.commandRouter.reloadUi();
};

ControllerSystem.prototype.getCPUCoresNumber = function () {
    var self = this;

    try {
      var cores = parseInt(execSync('/usr/bin/nproc --all').toString().replace(/\n/g, ''));
      return cores;
    } catch(e) {
      self.logger.error('Could not retrieve CPU Cores: ' + e);
      return 1
    }
};

ControllerSystem.prototype.enableLiveLog = function (data) {
  if (data === 'true') {
    try {
      this.logger.info('Launching a new LiveLog session');
      const format = 'cat'; // json is also an option for more serious logging/filtering
      const args = ['--output', format, '-f'];
      const defaults = {
        cwd: undefined,
        env: process.env
      };
      const liveLogData = {
        message: 'Starting Live Log...\n'
      };
      this.commandRouter.broadcastMessage('LLogOpen', liveLogData);

      if (this.livelogchild) {
        this.logger.info('Killing previous LiveLog session');
        this.livelogchild.kill();
      }
      this.livelogchild = spawn('/bin/journalctl',args, defaults);

      this.livelogchild.on('error', (d) => {
        this.logger.info('Error spawning LiveLog session');
        liveLogData.message = d.toString();
        this.commandRouter.broadcastMessage('LLogProgress', liveLogData);
      });

      this.livelogchild.stdout.on('data', (d) => {
        liveLogData.message = d.toString();
        this.commandRouter.broadcastMessage('LLogProgress', liveLogData);
      });

      this.livelogchild.stderr.on('data', (d) => {
        liveLogData.message = d.toString();
        this.commandRouter.broadcastMessage('LLogProgress', liveLogData);
      });

      this.livelogchild.on('close', (code) => {
        this.logger.info(`Live Log process terminated: ${code}`);
        liveLogData.message = `process exited with code ${code}`;
        this.commandRouter.broadcastMessage('LLogDone', liveLogData);
      });
    } catch (e) {
      // The irony is deep.
      this.logger.error('Error launching debugging sessions.', e);
    }
  } else if (data === 'false') {
    this.logger.info('Launching a new LiveLog session');
    if (this.livelogchild) {
      this.livelogchild.kill();
      this.livelogchild = undefined;
    }
  }
};

ControllerSystem.prototype.getHwuuidEth = function () {
  var self = this;

  var anonid = undefined;
  try {
    var macaddr = fs.readFileSync('/sys/class/net/eth0/address', 'utf8');
    anonid = macaddr.toString().replace(':', '');
  } catch (e) {}
  return anonid;
};

ControllerSystem.prototype.getHwuuidWlan = function () {
  var self = this;

  var anonid = undefined;
  try {
    var macaddr = fs.readFileSync('/sys/class/net/wlan0/address', 'utf8');
    anonid = macaddr.toString().replace(':', '');
  } catch (e) {}
  return anonid;
};

ControllerSystem.prototype.initializeFirstStart = function () {
  var self = this;

  // We set default value to false if config not found, so this setting won't affect devices updating from previous versions
  var isFirstStart = self.config.get('first_start', false);
  if (isFirstStart) {
    execSync('/usr/bin/touch /data/wizard');
    var playerName = self.config.get('playerName');
    var sysShortID = self.getHwuuid().toUpperCase().substring(0,5);
    var newPlayerName = playerName + '-' + sysShortID;
    var options = { "player_name": newPlayerName };
    if (process.env.AUTO_RENAME_SYSTEM_TO_UID_ONFIRSTSTART === 'true') {
      self.logger.info('Setting player name on first start: ' + newPlayerName);
      self.saveGeneralSettings(options);
    }

    if (process.env.AUTO_RENAME_HOTSPOT_TO_UID_ONFIRSTSTART === 'true') {
      self.logger.info('Setting Hotspot Unique name on first start: ' + newPlayerName);
      var defaultHotspotName = self.getAdditionalConf('system_controller', 'network', 'hotspot_name', 'Volumio');
      var newPlayerHotspotName = defaultHotspotName + '-' + sysShortID;
      var hotspotOptions = {
        enable_hotspot: true,
        hotspot_fallback: false,
        hotspot_name: newPlayerHotspotName,
        hotspot_protection: false,
        hotspot_channel: {value: 4, label: '4'}
      };
      self.commandRouter.executeOnPlugin(
          'system_controller',
          'network',
          'saveHotspotSettings',
          hotspotOptions
      );
    }
    self.commandRouter.reloadUi();
    self.config.set('first_start', false);
  }
};

ControllerSystem.prototype.setThisDeviceVolumioProperties = function (data) {
    var self = this;
    self.logger.info('Setting Additional Device Volumio Properties: ' + data);
    // expects and object with additional device properties
    additionalDeviceVolumioProperties = data;
};

ControllerSystem.prototype.getThisDeviceVolumioProperties = function () {
    var self = this;

    return additionalDeviceVolumioProperties;
};

ControllerSystem.prototype.setTimezone = function (data) {
  var self = this;

  self.logger.info('Setting timezone to ' + data);

  try {
    execSync('/usr/bin/sudo /usr/bin/unlink /etc/localtime', { uid: 1000, gid: 1000, encoding: 'utf8'});
    execSync('/usr/bin/sudo /bin/ln -s /usr/share/zoneinfo/' + data + ' /etc/localtime', { uid: 1000, gid: 1000, encoding: 'utf8'});
    execSync('/usr/bin/sudo /bin/chmod 777 /etc/localtime', { uid: 1000, gid: 1000, encoding: 'utf8'});
    process.env.TZ = data;    
    self.config.set('timezone', data);
  } catch (e) {
      self.logger.error('Could not set timezone: ' + e);
  }
  try {
    execSync('/usr/bin/sudo /usr/bin/timedatectl set-timezone \'' + data + '\'', { uid: 1000, gid: 1000, encoding: 'utf8'});    
  } catch (e) {
    try {
      self.logger.info('Could not set timezone, retrying');
      setTimeout(() => {
        execSync('/usr/bin/sudo /usr/bin/timedatectl set-timezone \'' + data + '\'', { uid: 1000, gid: 1000, encoding: 'utf8'});
      }, 1000)
    } catch(e) {
      self.logger.error('Could not set timezone: ' + e);
    }
  }
  setTimeout(() => {
    self.commandRouter.executeOnPlugin('system_controller', 'updater_comm', 'clearUpdateSchedule');  
  }, 30000);
}

ControllerSystem.prototype.setLanguageTimezone = function (data) {
  var self = this;
  
  if (data && data.timezone && data.timezone.value) {
    self.setTimezone(data.timezone.value);
  }

  return self.commandRouter.executeOnPlugin(
          'miscellanea',
          'appearance',
          'setLanguage',
          data
      );
}

ControllerSystem.prototype.getCurrentTimezone = function () {
  return this.config.get('timezone', "UTC");  
}
  

ControllerSystem.prototype.getAvailableTimezones = function () {
  return [
    "Africa/Abidjan",
    "Africa/Accra",
    "Africa/Addis_Ababa",
    "Africa/Algiers",
    "Africa/Asmara",
    "Africa/Asmera",
    "Africa/Bamako",
    "Africa/Bangui",
    "Africa/Banjul",
    "Africa/Bissau",
    "Africa/Blantyre",
    "Africa/Brazzaville",
    "Africa/Bujumbura",
    "Africa/Cairo",
    "Africa/Casablanca",
    "Africa/Ceuta",
    "Africa/Conakry",
    "Africa/Dakar",
    "Africa/Dar_es_Salaam",
    "Africa/Djibouti",
    "Africa/Douala",
    "Africa/El_Aaiun",
    "Africa/Freetown",
    "Africa/Gaborone",
    "Africa/Harare",
    "Africa/Johannesburg",
    "Africa/Juba",
    "Africa/Kampala",
    "Africa/Khartoum",
    "Africa/Kigali",
    "Africa/Kinshasa",
    "Africa/Lagos",
    "Africa/Libreville",
    "Africa/Lome",
    "Africa/Luanda",
    "Africa/Lubumbashi",
    "Africa/Lusaka",
    "Africa/Malabo",
    "Africa/Maputo",
    "Africa/Maseru",
    "Africa/Mbabane",
    "Africa/Mogadishu",
    "Africa/Monrovia",
    "Africa/Nairobi",
    "Africa/Ndjamena",
    "Africa/Niamey",
    "Africa/Nouakchott",
    "Africa/Ouagadougou",
    "Africa/Porto-Novo",
    "Africa/Sao_Tome",
    "Africa/Timbuktu",
    "Africa/Tripoli",
    "Africa/Tunis",
    "Africa/Windhoek",
    "America/Adak",
    "America/Anchorage",
    "America/Anguilla",
    "America/Antigua",
    "America/Araguaina",
    "America/Argentina/Buenos_Aires",
    "America/Argentina/Catamarca",
    "America/Argentina/ComodRivadavia",
    "America/Argentina/Cordoba",
    "America/Argentina/Jujuy",
    "America/Argentina/La_Rioja",
    "America/Argentina/Mendoza",
    "America/Argentina/Rio_Gallegos",
    "America/Argentina/Salta",
    "America/Argentina/San_Juan",
    "America/Argentina/San_Luis",
    "America/Argentina/Tucuman",
    "America/Argentina/Ushuaia",
    "America/Aruba",
    "America/Asuncion",
    "America/Atikokan",
    "America/Atka",
    "America/Bahia",
    "America/Bahia_Banderas",
    "America/Barbados",
    "America/Belem",
    "America/Belize",
    "America/Blanc-Sablon",
    "America/Boa_Vista",
    "America/Bogota",
    "America/Boise",
    "America/Buenos_Aires",
    "America/Cambridge_Bay",
    "America/Campo_Grande",
    "America/Cancun",
    "America/Caracas",
    "America/Catamarca",
    "America/Cayenne",
    "America/Cayman",
    "America/Chicago",
    "America/Chihuahua",
    "America/Coral_Harbour",
    "America/Cordoba",
    "America/Costa_Rica",
    "America/Creston",
    "America/Cuiaba",
    "America/Curacao",
    "America/Danmarkshavn",
    "America/Dawson",
    "America/Dawson_Creek",
    "America/Denver",
    "America/Detroit",
    "America/Dominica",
    "America/Edmonton",
    "America/Eirunepe",
    "America/El_Salvador",
    "America/Ensenada",
    "America/Fort_Nelson",
    "America/Fort_Wayne",
    "America/Fortaleza",
    "America/Glace_Bay",
    "America/Godthab",
    "America/Goose_Bay",
    "America/Grand_Turk",
    "America/Grenada",
    "America/Guadeloupe",
    "America/Guatemala",
    "America/Guayaquil",
    "America/Guyana",
    "America/Halifax",
    "America/Havana",
    "America/Hermosillo",
    "America/Indiana/Indianapolis",
    "America/Indiana/Knox",
    "America/Indiana/Marengo",
    "America/Indiana/Petersburg",
    "America/Indiana/Tell_City",
    "America/Indiana/Vevay",
    "America/Indiana/Vincennes",
    "America/Indiana/Winamac",
    "America/Indianapolis",
    "America/Inuvik",
    "America/Iqaluit",
    "America/Jamaica",
    "America/Jujuy",
    "America/Juneau",
    "America/Kentucky/Louisville",
    "America/Kentucky/Monticello",
    "America/Knox_IN",
    "America/Kralendijk",
    "America/La_Paz",
    "America/Lima",
    "America/Los_Angeles",
    "America/Louisville",
    "America/Lower_Princes",
    "America/Maceio",
    "America/Managua",
    "America/Manaus",
    "America/Marigot",
    "America/Martinique",
    "America/Matamoros",
    "America/Mazatlan",
    "America/Mendoza",
    "America/Menominee",
    "America/Merida",
    "America/Metlakatla",
    "America/Mexico_City",
    "America/Miquelon",
    "America/Moncton",
    "America/Monterrey",
    "America/Montevideo",
    "America/Montreal",
    "America/Montserrat",
    "America/Nassau",
    "America/New_York",
    "America/Nipigon",
    "America/Nome",
    "America/Noronha",
    "America/North_Dakota/Beulah",
    "America/North_Dakota/Center",
    "America/North_Dakota/New_Salem",
    "America/Nuuk",
    "America/Ojinaga",
    "America/Panama",
    "America/Pangnirtung",
    "America/Paramaribo",
    "America/Phoenix",
    "America/Port-au-Prince",
    "America/Port_of_Spain",
    "America/Porto_Acre",
    "America/Porto_Velho",
    "America/Puerto_Rico",
    "America/Punta_Arenas",
    "America/Rainy_River",
    "America/Rankin_Inlet",
    "America/Recife",
    "America/Regina",
    "America/Resolute",
    "America/Rio_Branco",
    "America/Rosario",
    "America/Santa_Isabel",
    "America/Santarem",
    "America/Santiago",
    "America/Santo_Domingo",
    "America/Sao_Paulo",
    "America/Scoresbysund",
    "America/Shiprock",
    "America/Sitka",
    "America/St_Barthelemy",
    "America/St_Johns",
    "America/St_Kitts",
    "America/St_Lucia",
    "America/St_Thomas",
    "America/St_Vincent",
    "America/Swift_Current",
    "America/Tegucigalpa",
    "America/Thule",
    "America/Thunder_Bay",
    "America/Tijuana",
    "America/Toronto",
    "America/Tortola",
    "America/Vancouver",
    "America/Virgin",
    "America/Whitehorse",
    "America/Winnipeg",
    "America/Yakutat",
    "America/Yellowknife",
    "Antarctica/Casey",
    "Antarctica/Davis",
    "Antarctica/DumontDUrville",
    "Antarctica/Macquarie",
    "Antarctica/Mawson",
    "Antarctica/McMurdo",
    "Antarctica/Palmer",
    "Antarctica/Rothera",
    "Antarctica/South_Pole",
    "Antarctica/Syowa",
    "Antarctica/Troll",
    "Antarctica/Vostok",
    "Arctic/Longyearbyen",
    "Asia/Aden",
    "Asia/Almaty",
    "Asia/Amman",
    "Asia/Anadyr",
    "Asia/Aqtau",
    "Asia/Aqtobe",
    "Asia/Ashgabat",
    "Asia/Ashkhabad",
    "Asia/Atyrau",
    "Asia/Baghdad",
    "Asia/Bahrain",
    "Asia/Baku",
    "Asia/Bangkok",
    "Asia/Barnaul",
    "Asia/Beirut",
    "Asia/Bishkek",
    "Asia/Brunei",
    "Asia/Calcutta",
    "Asia/Chita",
    "Asia/Choibalsan",
    "Asia/Chongqing",
    "Asia/Chungking",
    "Asia/Colombo",
    "Asia/Dacca",
    "Asia/Damascus",
    "Asia/Dhaka",
    "Asia/Dili",
    "Asia/Dubai",
    "Asia/Dushanbe",
    "Asia/Famagusta",
    "Asia/Gaza",
    "Asia/Harbin",
    "Asia/Hebron",
    "Asia/Ho_Chi_Minh",
    "Asia/Hong_Kong",
    "Asia/Hovd",
    "Asia/Irkutsk",
    "Asia/Istanbul",
    "Asia/Jakarta",
    "Asia/Jayapura",
    "Asia/Jerusalem",
    "Asia/Kabul",
    "Asia/Kamchatka",
    "Asia/Karachi",
    "Asia/Kashgar",
    "Asia/Kathmandu",
    "Asia/Katmandu",
    "Asia/Khandyga",
    "Asia/Kolkata",
    "Asia/Krasnoyarsk",
    "Asia/Kuala_Lumpur",
    "Asia/Kuching",
    "Asia/Kuwait",
    "Asia/Macao",
    "Asia/Macau",
    "Asia/Magadan",
    "Asia/Makassar",
    "Asia/Manila",
    "Asia/Muscat",
    "Asia/Nicosia",
    "Asia/Novokuznetsk",
    "Asia/Novosibirsk",
    "Asia/Omsk",
    "Asia/Oral",
    "Asia/Phnom_Penh",
    "Asia/Pontianak",
    "Asia/Pyongyang",
    "Asia/Qatar",
    "Asia/Qostanay",
    "Asia/Qyzylorda",
    "Asia/Rangoon",
    "Asia/Riyadh",
    "Asia/Saigon",
    "Asia/Sakhalin",
    "Asia/Samarkand",
    "Asia/Seoul",
    "Asia/Shanghai",
    "Asia/Singapore",
    "Asia/Srednekolymsk",
    "Asia/Taipei",
    "Asia/Tashkent",
    "Asia/Tbilisi",
    "Asia/Tehran",
    "Asia/Tel_Aviv",
    "Asia/Thimbu",
    "Asia/Thimphu",
    "Asia/Tokyo",
    "Asia/Tomsk",
    "Asia/Ujung_Pandang",
    "Asia/Ulaanbaatar",
    "Asia/Ulan_Bator",
    "Asia/Urumqi",
    "Asia/Ust-Nera",
    "Asia/Vientiane",
    "Asia/Vladivostok",
    "Asia/Yakutsk",
    "Asia/Yangon",
    "Asia/Yekaterinburg",
    "Asia/Yerevan",
    "Atlantic/Azores",
    "Atlantic/Bermuda",
    "Atlantic/Canary",
    "Atlantic/Cape_Verde",
    "Atlantic/Faeroe",
    "Atlantic/Faroe",
    "Atlantic/Jan_Mayen",
    "Atlantic/Madeira",
    "Atlantic/Reykjavik",
    "Atlantic/South_Georgia",
    "Atlantic/St_Helena",
    "Atlantic/Stanley",
    "Australia/ACT",
    "Australia/Adelaide",
    "Australia/Brisbane",
    "Australia/Broken_Hill",
    "Australia/Canberra",
    "Australia/Currie",
    "Australia/Darwin",
    "Australia/Eucla",
    "Australia/Hobart",
    "Australia/LHI",
    "Australia/Lindeman",
    "Australia/Lord_Howe",
    "Australia/Melbourne",
    "Australia/NSW",
    "Australia/North",
    "Australia/Perth",
    "Australia/Queensland",
    "Australia/South",
    "Australia/Sydney",
    "Australia/Tasmania",
    "Australia/Victoria",
    "Australia/West",
    "Australia/Yancowinna",
    "Brazil/Acre",
    "Brazil/DeNoronha",
    "Brazil/East",
    "Brazil/West",
    "CET",
    "CST6CDT",
    "Canada/Atlantic",
    "Canada/Central",
    "Canada/Eastern",
    "Canada/Mountain",
    "Canada/Newfoundland",
    "Canada/Pacific",
    "Canada/Saskatchewan",
    "Canada/Yukon",
    "Chile/Continental",
    "Chile/EasterIsland",
    "Cuba",
    "EET",
    "EST",
    "EST5EDT",
    "Egypt",
    "Eire",
    "Etc/GMT",
    "Etc/GMT+0",
    "Etc/GMT+1",
    "Etc/GMT+10",
    "Etc/GMT+11",
    "Etc/GMT+12",
    "Etc/GMT+2",
    "Etc/GMT+3",
    "Etc/GMT+4",
    "Etc/GMT+5",
    "Etc/GMT+6",
    "Etc/GMT+7",
    "Etc/GMT+8",
    "Etc/GMT+9",
    "Etc/GMT-0",
    "Etc/GMT-1",
    "Etc/GMT-10",
    "Etc/GMT-11",
    "Etc/GMT-12",
    "Etc/GMT-13",
    "Etc/GMT-14",
    "Etc/GMT-2",
    "Etc/GMT-3",
    "Etc/GMT-4",
    "Etc/GMT-5",
    "Etc/GMT-6",
    "Etc/GMT-7",
    "Etc/GMT-8",
    "Etc/GMT-9",
    "Etc/GMT0",
    "Etc/Greenwich",
    "Etc/UCT",
    "Etc/UTC",
    "Etc/Universal",
    "Etc/Zulu",
    "Europe/Amsterdam",
    "Europe/Andorra",
    "Europe/Astrakhan",
    "Europe/Athens",
    "Europe/Belfast",
    "Europe/Belgrade",
    "Europe/Berlin",
    "Europe/Bratislava",
    "Europe/Brussels",
    "Europe/Bucharest",
    "Europe/Budapest",
    "Europe/Busingen",
    "Europe/Chisinau",
    "Europe/Copenhagen",
    "Europe/Dublin",
    "Europe/Gibraltar",
    "Europe/Guernsey",
    "Europe/Helsinki",
    "Europe/Isle_of_Man",
    "Europe/Istanbul",
    "Europe/Jersey",
    "Europe/Kaliningrad",
    "Europe/Kiev",
    "Europe/Kirov",
    "Europe/Lisbon",
    "Europe/Ljubljana",
    "Europe/London",
    "Europe/Luxembourg",
    "Europe/Madrid",
    "Europe/Malta",
    "Europe/Mariehamn",
    "Europe/Minsk",
    "Europe/Monaco",
    "Europe/Moscow",
    "Europe/Nicosia",
    "Europe/Oslo",
    "Europe/Paris",
    "Europe/Podgorica",
    "Europe/Prague",
    "Europe/Riga",
    "Europe/Rome",
    "Europe/Samara",
    "Europe/San_Marino",
    "Europe/Sarajevo",
    "Europe/Saratov",
    "Europe/Simferopol",
    "Europe/Skopje",
    "Europe/Sofia",
    "Europe/Stockholm",
    "Europe/Tallinn",
    "Europe/Tirane",
    "Europe/Tiraspol",
    "Europe/Ulyanovsk",
    "Europe/Uzhgorod",
    "Europe/Vaduz",
    "Europe/Vatican",
    "Europe/Vienna",
    "Europe/Vilnius",
    "Europe/Volgograd",
    "Europe/Warsaw",
    "Europe/Zagreb",
    "Europe/Zaporozhye",
    "Europe/Zurich",
    "GB",
    "GB-Eire",
    "GMT",
    "GMT+0",
    "GMT-0",
    "GMT0",
    "Greenwich",
    "HST",
    "Hongkong",
    "Iceland",
    "Indian/Antananarivo",
    "Indian/Chagos",
    "Indian/Christmas",
    "Indian/Cocos",
    "Indian/Comoro",
    "Indian/Kerguelen",
    "Indian/Mahe",
    "Indian/Maldives",
    "Indian/Mauritius",
    "Indian/Mayotte",
    "Indian/Reunion",
    "Iran",
    "Israel",
    "Jamaica",
    "Japan",
    "Kwajalein",
    "Libya",
    "MET",
    "MST",
    "MST7MDT",
    "Mexico/BajaNorte",
    "Mexico/BajaSur",
    "Mexico/General",
    "NZ",
    "NZ-CHAT",
    "Navajo",
    "PRC",
    "PST8PDT",
    "Pacific/Apia",
    "Pacific/Auckland",
    "Pacific/Bougainville",
    "Pacific/Chatham",
    "Pacific/Chuuk",
    "Pacific/Easter",
    "Pacific/Efate",
    "Pacific/Enderbury",
    "Pacific/Fakaofo",
    "Pacific/Fiji",
    "Pacific/Funafuti",
    "Pacific/Galapagos",
    "Pacific/Gambier",
    "Pacific/Guadalcanal",
    "Pacific/Guam",
    "Pacific/Honolulu",
    "Pacific/Johnston",
    "Pacific/Kanton",
    "Pacific/Kiritimati",
    "Pacific/Kosrae",
    "Pacific/Kwajalein",
    "Pacific/Majuro",
    "Pacific/Marquesas",
    "Pacific/Midway",
    "Pacific/Nauru",
    "Pacific/Niue",
    "Pacific/Norfolk",
    "Pacific/Noumea",
    "Pacific/Pago_Pago",
    "Pacific/Palau",
    "Pacific/Pitcairn",
    "Pacific/Pohnpei",
    "Pacific/Ponape",
    "Pacific/Port_Moresby",
    "Pacific/Rarotonga",
    "Pacific/Saipan",
    "Pacific/Samoa",
    "Pacific/Tahiti",
    "Pacific/Tarawa",
    "Pacific/Tongatapu",
    "Pacific/Truk",
    "Pacific/Wake",
    "Pacific/Wallis",
    "Pacific/Yap",
    "Poland",
    "Portugal",
    "ROC",
    "ROK",
    "Singapore",
    "Turkey",
    "UCT",
    "US/Alaska",
    "US/Aleutian",
    "US/Arizona",
    "US/Central",
    "US/East-Indiana",
    "US/Eastern",
    "US/Hawaii",
    "US/Indiana-Starke",
    "US/Michigan",
    "US/Mountain",
    "US/Pacific",
    "US/Samoa",
    "UTC",
    "Universal",
    "W-SU",
    "WET",
    "Zulu"
  ]
}

ControllerSystem.prototype.getAutoUpdateTimes = function () {
  return [
    "0",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "11",
    "12",
    "13",
    "14",
    "15",
    "16",
    "17",
    "18",
    "19",
    "20",
    "21",
    "22",
    "23"
  ]
}

ControllerSystem.prototype.loadDefaultAdditionalDeviceVolumioProperties = function () {
  var self = this;

  additionalDeviceVolumioProperties.isPremiumDevice = (process.env.IS_PREMIUM_DEVICE === 'true');
  additionalDeviceVolumioProperties.isVolumioProduct = (process.env.IS_VOLUMIO_PRODUCT === 'true');
  if (process.env.PRODUCT_NAME !== undefined) {
    additionalDeviceVolumioProperties.productName = process.env.PRODUCT_NAME;
  }
};


