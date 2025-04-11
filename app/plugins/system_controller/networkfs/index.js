'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;
var config = new (require('v-conf'))();
var mountutil = require('linux-mountutils');
var udev = require('udev');
var S = require('string');
var _ = require('underscore');
var removableMountPoint = '/mnt/';
var mountPointFile = '/data/configuration/mountPoints';
const { v4: uuidv4 } = require('uuid');

var ignoreDeviceAction = false;

// Define the ControllerNetworkfs class
module.exports = ControllerNetworkfs;

function ControllerNetworkfs (context) {
  var self = this;

  // Save a reference to the parent commandRouter
  self.context = context;
  self.commandRouter = self.context.coreCommand;
  self.logger = self.commandRouter.logger;
  self.configManager = self.context.configManager;
}

ControllerNetworkfs.prototype.getConfigurationFiles = function () {
  var self = this;

  return ['config.json'];
};

ControllerNetworkfs.prototype.onVolumioStart = function () {
  var self = this;

  var configFile = self.commandRouter.pluginManager.getConfigurationFile(self.context, 'config.json');
  config.loadFile(configFile);

  var promise = self.initShares();
  if (process.env.NODE_MOUNT_HANDLER === 'true') {
    self.initUdevWatcher();
  }
  var boundMethod = self.onPlayerNameChanged.bind(self);
  self.commandRouter.executeOnPlugin('system_controller', 'system', 'registerCallback', boundMethod);

  return promise;
};

ControllerNetworkfs.prototype.languageCallback = function (data) {
  var self = this;
};

ControllerNetworkfs.prototype.onStop = function () {
  var self = this;
  // Perform startup tasks here
};

ControllerNetworkfs.prototype.onRestart = function () {
  var self = this;
  // Perform startup tasks here
};

ControllerNetworkfs.prototype.onInstall = function () {
  var self = this;
  // Perform your installation tasks here
};

ControllerNetworkfs.prototype.onUninstall = function () {
  var self = this;
  // Perform your installation tasks here
};

ControllerNetworkfs.prototype.getUIConfig = function () {
  var self = this;

  var lang_code = self.commandRouter.sharedVars.get('language_code');

  var defer = libQ.defer();
  self.commandRouter.i18nJson(__dirname + '/../../../i18n/strings_' + lang_code + '.json',
    __dirname + '/../../../i18n/strings_en.json',
    __dirname + '/UIConfig.json')
    .then(function (uiconf) {
      var enableweb = self.getAdditionalConf('miscellanea', 'albumart', 'enableweb', true);
      self.configManager.setUIConfigParam(uiconf, 'sections[2].content[0].value', enableweb);
      self.configManager.setUIConfigParam(uiconf, 'sections[2].content[0].value.label', self.getLabelForSelect(self.configManager.getValue(uiconf, 'sections[2].content[0].options'), enableweb));

      var websize = self.getAdditionalConf('miscellanea', 'albumart', 'defaultwebsize', 'large');
      self.configManager.setUIConfigParam(uiconf, 'sections[2].content[1].value.value', websize);
      self.configManager.setUIConfigParam(uiconf, 'sections[2].content[1].value.label', self.getLabelForSelect(self.configManager.getValue(uiconf, 'sections[2].content[1].options'), websize));

      var metadataimage = self.getAdditionalConf('miscellanea', 'albumart', 'metadataimage', false);
      self.configManager.setUIConfigParam(uiconf, 'sections[2].content[2].value', metadataimage);
      self.configManager.setUIConfigParam(uiconf, 'sections[2].content[2].value.label', self.getLabelForSelect(self.configManager.getValue(uiconf, 'sections[2].content[2].options'), metadataimage));

      var tracknumbersConf = self.getAdditionalConf('music_service', 'mpd', 'tracknumbers', false);
      self.configManager.setUIConfigParam(uiconf, 'sections[3].content[0].value', tracknumbersConf);

      var compilationConf = self.getAdditionalConf('music_service', 'mpd', 'compilation', 'Various,various,Various Artists,various artists,VA,va');
      self.configManager.setUIConfigParam(uiconf, 'sections[3].content[1].value', compilationConf);

      var artistsortConf = self.getAdditionalConf('music_service', 'mpd', 'artistsort', true);
      if (artistsortConf) {
        self.configManager.setUIConfigParam(uiconf, 'sections[3].content[2].value.value', true);
        self.configManager.setUIConfigParam(uiconf, 'sections[3].content[2].value.label', 'albumartist');
      } else {
        self.configManager.setUIConfigParam(uiconf, 'sections[3].content[2].value.value', false);
        self.configManager.setUIConfigParam(uiconf, 'sections[3].content[2].value.label', 'artist');
      }

      var ffmpeg = self.getAdditionalConf('music_service', 'mpd', 'ffmpegenable', false);
      self.configManager.setUIConfigParam(uiconf, 'sections[3].content[3].value', ffmpeg);

      defer.resolve(uiconf);
    })
    .fail(function () {
      defer.reject(new Error());
    });

  return defer.promise;
};

ControllerNetworkfs.prototype.setUIConfig = function (data) {
  var self = this;

  var uiconf = fs.readJsonSync(__dirname + '/UIConfig.json');
};

ControllerNetworkfs.prototype.getConf = function (varName) {
  var self = this;

  return self.config.get(varName);
};

ControllerNetworkfs.prototype.setConf = function (varName, varValue) {
  var self = this;

  self.config.set(varName, varValue);
};

// Optional functions exposed for making development easier and more clear
ControllerNetworkfs.prototype.getSystemConf = function (pluginName, varName) {
  var self = this;
  // Perform your installation tasks here
};

ControllerNetworkfs.prototype.setSystemConf = function (pluginName, varName) {
  var self = this;
  // Perform your installation tasks here
};

ControllerNetworkfs.prototype.setAdditionalConf = function () {
  var self = this;
  // Perform your installation tasks here
};

ControllerNetworkfs.prototype.initShares = function () {
  var self = this;
  var deferList = [];

  var keys = config.getKeys('NasMounts');
  for (var i in keys) {
    var key = keys[i];
    if (key !== 'mountedFolders') {
      deferList.push(self.mountShare({init: true, key: key}));
    }
  }
  return libQ.all(deferList);
};

ControllerNetworkfs.prototype.mountShare = function (data) {
  var self = this;

  var defer = libQ.defer();
  var shareid = data.key;
  if (data.trial) {
    trial = data.trial;
  } else {
    var trial = 0;
  }

  var key = 'NasMounts.' + shareid;
  var fstype = config.get(key + '.fstype');
  var options = config.get(key + '.options');
  var path = config.get(key + '.path');
  var mountidraw = config.get(key + '.name');
  // Check we have sane data - operating on undefined values will crash us
  if (fstype === 'undefined' || path === 'undefined') {
    self.logger.error('Unable to retrieve config for share ' + shareid + ', returning early');
    return defer.promise;
  }
  var pointer;
  var fsopts;
  var credentials;
  var responsemessage = {status: ''};
  // The local mountpoint path must not contain these characters, because
  // they get specially encoded in /etc/mtab and cause mount/umount failures.
  // See getmntent(7).
  var mountid = mountidraw.replace(/[\s\n\\]/g, '_');

  if (fstype == 'cifs') {
    pointer = '//' + config.get('NasMounts.' + shareid + '.ip') + '/' + path;
    // Password-protected mount
    if (config.get(key + '.user') !== 'undefined' && config.get(key + '.user') !== '') {
      var u = config.get(key + '.user');
      var p = config.get(key + '.password');
      u = self.properQuote(u);
      p = self.properQuote(p);
      credentials = 'username=' + u + ',' + 'password=' + p + ',';
    } else {
      credentials = 'guest,';
    }
    if (options) {
      options = self.properQuote(options);
      fsopts = credentials + 'ro,dir_mode=0777,file_mode=0666,iocharset=utf8,noauto,soft,' + options;
    } else {
      fsopts = credentials + 'ro,dir_mode=0777,file_mode=0666,iocharset=utf8,noauto,soft';
    }
  } else { // nfs
    pointer = config.get('NasMounts.' + shareid + '.ip') + ':' + path;
    if (options) {
      options = self.properQuote(options);
      fsopts = 'ro,soft,noauto,' + options;
    } else {
      fsopts = 'ro,soft,noauto';
    }
  }

  var mountpoint = '/mnt/NAS/' + mountid;
  var createDir = true;
  if (fs.existsSync(mountpoint)) {
    createDir = false;
  }

  try {
    mountutil.mount(pointer, mountpoint, {'createDir': createDir, 'fstype': fstype, 'fsopts': fsopts}, function (result) {
      if (result.error) {
        if (result.error.indexOf('Permission denied') >= 0) {
          result.error = 'Permission denied';
        } else {
          var splitreason = result.error.split('mount error');
          // if the split does not match, splitreason[1] is undefined
          if (splitreason.length > 1) result.error = splitreason[1];
        }
        responsemessage = {status: 'fail', reason: result.error};
        defer.resolve(responsemessage);
        if (data.init) {
          if (trial < 4) {
            trial++;
            self.logger.info('Cannot mount NAS ' + mountid + ' at system boot, trial number ' + trial + ' ,retrying in 5 seconds');
            setTimeout(function () {
              self.mountShare({init: true, key: data.key, trial: trial});
            }, 5000);
          } else {
            self.logger.info('Cannot mount NAS at system boot, trial number ' + trial + ' ,stopping');
          }
        }
      } else {
        responsemessage = {status: 'success'};
        defer.resolve(responsemessage);
      }
    });
  } catch (e) {
    self.logger.error('Could not mount NAS: ' + e);
    responsemessage = {status: 'fail', reason: e};
    defer.resolve(responsemessage);
  }

  return defer.promise;
};

ControllerNetworkfs.prototype.getConfigurationFiles = function () {
  var self = this;

  return ['config.json'];
};

ControllerNetworkfs.prototype.getShare = function (name, ip, path) {
  var self = this;

  var keys = config.getKeys('NasMounts');
  for (var i in keys) {
    var subKey = 'NasMounts.' + keys[i];
    self.logger.info('Checking key ' + subKey);

    if (config.get(subKey + '.name') == name &&
            config.get(subKey + '.ip') == ip && config.get(subKey + '.path') == path) {
      self.logger.info('Found correspondence in configuration');
      return keys[i];
    }
  }
};

ControllerNetworkfs.prototype.scanDatabase = function () {
  var self = this;

  exec('/usr/bin/mpc update', function (error, stdout, stderr) {
    if (error !== null) {
      self.commandRouter.pushToastMessage('error', self.commandRouter.getI18nString('COMMON.MY_MUSIC'), self.commandRouter.getI18nString('COMMON.SCAN_DB_ERROR') + error);
      self.context.coreCommand.pushConsoleMessage('[' + Date.now() + '] Database scan error: ' + error);
    } else {
      self.context.coreCommand.pushConsoleMessage('[' + Date.now() + '] Database update started');
      self.commandRouter.pushToastMessage('success', self.commandRouter.getI18nString('COMMON.MY_MUSIC'), self.commandRouter.getI18nString('COMMON.SCAN_DB'));
    }
  });
};

ControllerNetworkfs.prototype.listShares = function () {
  var mounts = config.getKeys();
};

/*
 New APIs
 ###############################
 */

/**
 * This method adds a new share into the configuration
 * @param data {
  name:’SHARE’,
  ip:’192.168.10.1’,
  fstype:’’,
  username:’’,
  password:’’,
  options:’’
}

 */
ControllerNetworkfs.prototype.addShare = function (data) {
  var self = this;

  self.logger.info('Adding a new share');

  var defer = libQ.defer();

  var name = data['name'];
  /*
	 * A name is required. In the ui this field is called 'alias'.
	 */
  if (name == undefined) name = '';
  var blankname_regex = /^\s*$/;
  var matches = blankname_regex.exec(name);
  if (matches) {
    self.logger.info('Share alias is blank');
    self.commandRouter.pushToastMessage('warning', self.commandRouter.getI18nString('COMMON.MY_MUSIC'), self.commandRouter.getI18nString('NETWORKFS.ALIAS_DOC'));
    defer.reject(new Error('Shares must have an alias'));
    return defer.promise;
  }

  var nameStr = S(name);

  /**
     * Check special characters
     */
  if (nameStr.contains('/')) {
    self.commandRouter.pushToastMessage('warning', self.commandRouter.getI18nString('COMMON.MY_MUSIC'), self.commandRouter.getI18nString('COMMON.ILLEGAL_CHARACTER_/'));
    defer.reject(new Error('Share names cannot contain /'));
    return defer.promise;
  }

  // Path is required
  if (data['path'] == null) {
    self.commandRouter.pushToastMessage('warning', self.commandRouter.getI18nString('COMMON.MY_MUSIC'), self.commandRouter.getI18nString('NETWORKFS.ERROR_PATH_UNDEFINED'));
    defer.reject(new Error('Share path must be defined'));
    return defer.promise;
  }

  var ip = data['ip'];
  var path = data['path'];
  var fstype = data['fstype'];
  var username = data['username'];
  var password = data['password'];
  var options = data['options'];

  if (username == undefined) username = '';
  if (password == undefined) password = '';
  if (options == undefined) options = '';

  if (fstype == 'cifs') {
    /* when the share is mounted the ip and path are joined with '/'.
		 * mount.cifs can fail if given '//server//path', so let's avoid that.
		 */
    path = path.replace(/\/+/g, '/');
    path = path.replace(/^\//, '');
  }
  if (fstype === 'nfs') {
    /* NFS mounts require an absolute path for the exported directory -
		 * enforce a leading / on the path.
		 */
    path = path.replace(/^\s+/, '');
    if (!path.startsWith('/')) {
      path = '/' + path;
    }
  }

  var uuid = self.getShare(name, ip, path);
  if (uuid != undefined) {
    self.logger.info('Share ' + name + ' has already been configured, with uuid ' + uuid);
    defer.resolve({
      success: false,
      reason: 'This share has already been configured'
    });
    return defer.promise;
  }

  uuid = uuidv4();
  self.logger.info('No correspondence found in configuration for share ' + name + ' on IP ' + ip);

  var res;
  if (fstype == 'cifs') {
    res = self.getSharesPerDevice({host: ip, name: name}).then(function (device) {
      self.logger.info('Detected device ' + device.name + ' with version ' + device.version);
      return device.version;
    });
  } else {
    res = libQ.resolve('');
  }

  res = res.then(function (version) {
    if (!version)
      return;

    if (options.includes('vers=')) {
      self.logger.info('Version ' + version + ' detected, but user has specified version in options');
    } else {
      // https://wiki.sharewiz.net/doku.php?id=ubuntu:samba:smb_protocol_versions
      var versionNum = {
        'SMB3_11': '3.11',
        'SMB3_10': '3.10',
        'SMB3_02': '3.2',
        'SMB3': '3.0',
        'SMB2_24': '2.24',
        'SMB2_22': '2.22',
        'SMB2_10': '2.10',
        'SMB2_02': '2.02',
        'SMB1': '1.0',
        'NT1': '1.0'
      }[version];
      if (versionNum) {
        if (options) options += ','
        options += 'vers=' + versionNum;

        self.logger.info('Set version number ' + versionNum + ' in CIFS options: ' + options);
      } else {
        self.logger.warn('Could not determine version number from ' + version);
      }
    }
  })

  res.then(function () {
    return self.saveShareConf('NasMounts', uuid, name, ip, path, fstype, username, password, options)
  }).then(function () {
    var mountshare = self.mountShare({key: uuid});
    if (mountshare != undefined) {
      mountshare.then(function (data) {
        var responsemessage = {};
        if (data.status == 'success') {
          responsemessage = {emit: 'pushToastMessage', data: { type: 'success', title: 'Success', message: name + ' mounted successfully'}};
          defer.resolve(responsemessage);
          self.scanDatabase();
        } else if (data.status === 'fail') {
          if (data.reason) {
            if (data.reason == 'Permission denied') {
              responsemessage = {emit: 'nasCredentialsCheck', data: { 'id': uuid, 'title': 'Network Drive Authentication', 'message': 'This drive requires password', 'name': name, 'username': username, 'password': password }};
              self.logger.info('Permission denied for ' + name + ' on IP ' + ip);
              defer.resolve(responsemessage);
            } else {
              responsemessage = {emit: 'pushToastMessage', data: { type: 'error', title: 'Error in mounting share ' + name, message: data.reason}};
              self.logger.info('Error mounting  ' + name + ' on IP ' + ip + ' : ' + data.reason);
              defer.resolve(responsemessage);
            }
          } else {
            responsemessage = {emit: 'pushToastMessage', data: { type: 'error', title: 'Error in mounting share ' + name, message: 'Unknown error'}};
            self.logger.info('Unknown error mounting  ' + name + ' on IP ' + ip);
            defer.resolve(responsemessage);
          }
        }
      });
    }
  });

  return defer.promise;
};

ControllerNetworkfs.prototype.saveShareConf = function (parent, uuid, name, ip, path, fstype, username, password, options) {
  var self = this;

  var defer = libQ.defer();
  var key = parent + '.' + uuid;
  config.addConfigValue(key + '.name', 'string', name);
  config.addConfigValue(key + '.ip', 'string', ip);
  config.addConfigValue(key + '.path', 'string', path);
  config.addConfigValue(key + '.fstype', 'string', fstype);
  config.addConfigValue(key + '.user', 'string', username);
  config.addConfigValue(key + '.password', 'string', password);
  config.addConfigValue(key + '.options', 'string', options);

  defer.resolve('ok');
  return defer.promise;
};

ControllerNetworkfs.prototype.deleteShare = function (data) {
  var self = this;

  var defer = libQ.defer();
  var key = 'NasMounts.' + data['id'];

  var responsemessage;

  if (config.has(key)) {
    var mountidraw = config.get(key + '.name');
    var mountid = mountidraw.replace(/[\s\n\\]/g, '_');
    var mountpoint = '/mnt/NAS/' + mountid;
    var mountedshare = mountutil.isMounted(mountpoint, false);
    if (mountedshare.mounted) {
      mountutil.umount(mountpoint, false, {'removeDir': true}, function (result) {
        if (result.error) {
          responsemessage = {emit: 'pushToastMessage', data: { type: 'error', title: self.commandRouter.getI18nString('COMMON.ERROR'), message: self.commandRouter.getI18nString('NETWORKFS.ERROR_UMOUNT')}};
          self.logger.error("Mount point '" + mountpoint + "' cannot be removed. Error: " + result.error);
          defer.resolve(responsemessage);
        } else {
          responsemessage = {emit: 'pushToastMessage', data: { type: 'success', title: self.commandRouter.getI18nString('NETWORKFS.NETWORK_DRIVE'), message: self.commandRouter.getI18nString('NETWORKFS.REMOVED')}};
          self.logger.info('Share ' + mountid + ' successfully unmounted');
          defer.resolve(responsemessage);
          config.delete(key);
        }
      });

      setTimeout(function () {
        self.scanDatabase();
      }, 3000);
    } else {
      exec('rm -rf ' + mountpoint + ' ', {uid: 1000, gid: 1000}, function (error, stdout, stderr) {
        if (error !== null) {
          responsemessage = {emit: 'pushToastMessage', data: { type: 'error', title: self.commandRouter.getI18nString('COMMON.ERROR'), message: self.commandRouter.getI18nString('NETWORKFS.ERROR_UMOUNT')}};
          self.logger.error('Cannot Delete Folder. Error: ' + error);
          defer.resolve(responsemessage);
        } else {
          responsemessage = {emit: 'pushToastMessage', data: { type: 'success', title: self.commandRouter.getI18nString('NETWORKFS.NETWORK_DRIVE'), message: self.commandRouter.getI18nString('NETWORKFS.REMOVED')}};
          defer.resolve(responsemessage);
          config.delete(key);
        }
      });
    }
  } else {
    responsemessage = {emit: 'pushToastMessage', data: { type: 'error', title: self.commandRouter.getI18nString('COMMON.ERROR'), message: self.commandRouter.getI18nString('NETWORKFS.SHARE_NOT_CONFIGURED')}};
    defer.resolve(responsemessage);
  }

  return defer.promise;
};

ControllerNetworkfs.prototype.listShares = function (data) {
  var self = this;

  var response = [];
  var size = '';
  var unity = '';
  var defer = libQ.defer();

  var shares = config.getKeys('NasMounts');
  var nShares = shares.length;

  if (nShares > 0) {
    response = [];

    var promises = [];

    for (var i = 0; i < nShares; i++) {
      promises.push(this.getMountSize(shares[i]));
    }
    libQ.all(promises).then(function (d) {
      defer.resolve(d);
    }).fail(function (e) {
      self.logger.error('Failed getting mounts size', e);
    });
  } else {
    response = [];
    defer.resolve(response);
  }
  return defer.promise;
};

ControllerNetworkfs.prototype.getMountSize = function (share) {
  return new Promise(function (resolve, reject) {
    var key = 'NasMounts.' + share;
    var name = config.get(key + '.name');
    var mountidraw = name;
    var mountid = mountidraw.replace(/[\s\n\\]/g, '_');
    var mountpoint = '/mnt/NAS/' + mountid;
    var mounted = mountutil.isMounted(mountpoint, false);
    var respShare = {
      path: config.get(key + '.path'),
      ip: config.get(key + '.ip'),
      name: config.get(key + '.name'),
      fstype: config.get(key + '.fstype'),
      username: config.get(key + '.user'),
      password: config.get(key + '.password'),
      options: config.get(key + '.options'),
      id: share,
      mounted: mounted.mounted,
      size: ''
    };
    var quotedmount = quotePath(mountpoint);
    // cmd returns size in bytes with no units and no header line
    var cmd = 'df -B1 --output=used ' + quotedmount + ' | tail -1';
    var promise = libQ.ncall(exec, respShare, cmd).then(function (stdout) {
      var splitted = stdout.split('\n');
      var sizeStr = splitted[0];

      var size = parseInt(sizeStr) / 1024 / 1024;
      var unity = 'MB';
      if (size > 1024) {
        size = size / 1024;
        unity = 'GB';
        if (size > 1024) {
          size = size / 1024;
          unity = 'TB';
        }
      }
      respShare.size = size.toFixed(2) + ' ' + unity;
      resolve(respShare);
    }).fail(function (e) {
      reject(respShare);
    });
  });
};

// Properly single-quote a path that will be handed to a shell exec.
var quotePath = function (path) {
  var self = this;
  var output = '';

  var pieces = path.split("'");
  var n = pieces.length;
  for (var i = 0; i < n; i++) {
    output = output + "'" + pieces[i] + "'";
    if (i < (n - 1)) output = output + "\\'";
  }
  return output;
};

/**
 * {
 name:’SHARE su 192.168.10.135’
  path:’SHARE’,
  id:’dsdsd’,
  ip:’192.168.10.1’,
  fstype:’’,
  username:’’,
  password:’’,
  options:’’
}

 * @param data
 * @returns {*}
 */
ControllerNetworkfs.prototype.infoShare = function (data) {
  var self = this;

  var defer = libQ.defer();

  if (config.has('NasMounts.' + data['id'])) {
    var key = 'NasMounts.' + data['id'];
    var response = {
      path: config.get(key + '.path'),
      name: config.get(key + '.name'),
      ip: config.get(key + '.ip'),
      fstype: config.get(key + '.fstype'),
      username: config.get(key + '.user'),
      password: config.get(key + '.password'),
      options: config.get(key + '.options'),
      id: data['id']
    };

    defer.resolve(response);
  } else defer.resolve({});

  return defer.promise;
};

/**
 * {
  id:’fdfdvoeo’,
  name:’SHARE’,
  ip:’192.168.10.1’,
  fstype:’’,
  username:’’,
  password:’’,
  options:’’
}

 * @param data
 * @returns {*}
 */
ControllerNetworkfs.prototype.editShare = function (data) {
  var self = this;

  var responsemessageedit = {};
  var defer = libQ.defer();
  if (data.id) {
    var id = data['id'];
  }
  if (data.name) {
    var name = data['name'];
  }
  if (data.user) {
    var user = data['user'];
  }
  if (data.password) {
    var password = data['password'];
  }

  var key = 'NasMounts.' + data['id'];
  if (config.has(key)) {
    var mountidraw = config.get(key + '.name');
    var mountid = mountidraw.replace(/[\s\n\\]/g, '_');
    var mountpoint = '/mnt/NAS/' + mountid;
    mountutil.umount(mountpoint, false, {'removeDir': true}, function (result) {
      if (result.error) {
        defer.resolve({
          success: false,
          reason: 'Cannot unmount share'
        });
      } else {
        self.logger.info('Share ' + mountidraw + ' successfully unmounted');

        var oldpath = config.get(key + '.path');
        var oldname = config.get(key + '.name');
        var oldip = config.get(key + '.ip');
        var oldfstype = config.get(key + '.fstype');
        var oldusername = config.get(key + '.user');
        var oldpassword = config.get(key + '.password');
        var oldoptions = config.get(key + '.options');

        if (data['name']) {
          config.set(key + '.name', data['name']);
        }
        if (data['path']) {
          config.set(key + '.path', data['path']);
        }
        if (data['ip']) {
          config.set(key + '.ip', data['ip']);
        }
        if (data['fstype']) {
          config.set(key + '.fstype', data['fstype']);
        }
        if (data['username']) {
          config.set(key + '.user', data['username']);
        }
        if (data['password']) {
          config.set(key + '.password', data['password']);
        }
        if (data['options']) {
          config.set(key + '.options', data['options']);
        }

        var mountshare = self.mountShare({key: id});
        if (mountshare != undefined) {
          mountshare.then(function (data) {
            if (data.status == 'success') {
              self.scanDatabase();
              responsemessageedit = {emit: 'pushToastMessage', data: { type: 'success', title: self.commandRouter.getI18nString('NETWORKFS.NETWORK_DRIVE'), message: self.commandRouter.getI18nString('NETWORKFS.SHARE_MOUNT_SUCCESS')}};
              defer.resolve(responsemessageedit);
            } else if (data.status === 'fail') {
              if (data.reason) {
                self.logger.info('An error occurred mounting the new share. Rolling back configuration');
                config.set(key + '.name', oldname);
                config.set(key + '.path', oldpath);
                config.set(key + '.ip', oldip);
                config.set(key + '.fstype', oldfstype);
                config.set(key + '.user', oldusername);
                config.set(key + '.password', oldpassword);
                config.set(key + '.options', oldoptions);
                if (data.reason === 'Permission denied') {
                  responsemessageedit = {emit: 'nasCredentialsCheck', data: { 'id': id, 'name': name, 'username': username, 'password': password }};
                  defer.resolve(responsemessageedit);
                } else {
                  responsemessageedit = {emit: 'pushToastMessage', data: { type: 'warning', title: self.commandRouter.getI18nString('NETWORKFS.MOUNT_SHARE_ERROR'), message: data.reason}};
                  defer.resolve(responsemessageedit);
                }
              }
            }
          });
        }
      }
    });
  } else {
    defer.resolve({
      success: false,
      reason: 'Share not found'
    });
  }

  return defer.promise;
};

ControllerNetworkfs.prototype.discoverShares = function () {
  var self = this;
  var defer = libQ.defer();
  var scannedNasArray = [];
  var systemShare = self.commandRouter.sharedVars.get('system.name').toUpperCase();

  var mdnsNas = self.commandRouter.executeOnPlugin('system_controller', 'volumiodiscovery', 'browseForService', 'smb');
  mdnsNas.then((devicesArray)=>{
    var scanPromises = [];
    for (var i in devicesArray) {
      var device = devicesArray[i];
      if (device && device.name !== systemShare && !scannedNasArray.includes(device.name)) {
        scannedNasArray.push(device.name);
        scanPromises.push(self.getSharesPerDevice(device));
      }
    }
    libQ.all(scanPromises).then(function (nasResults) {
      var nasResponse = { 'nas': nasResults };
      defer.resolve(nasResponse);
    }).fail(function (e) {
      self.logger.error('Failed getting NAS Scan results: ' + e);
      var nasResponse = { 'nas': [] };
      defer.resolve(nasResponse);
    });
  });

  return defer.promise;
};

ControllerNetworkfs.prototype.getSharesPerDevice = function (device) {
  var self = this;
  var defer = libQ.defer();

  exec('echo volumio | smbclient --debuglevel 4 -L ' + device.host, {uid: 1000, gid: 1000}, function (error, stdout, stderr) {
    if (error != null) {
      self.logger.info('Error browsing device  ' + device.name + ' for shares : ' + error);
    } else {
      var shares = self.parseSmbClientResult(stdout);
      var version = self.parseSmbClientNegotiatedVersion(stderr);
      var nasObj = { 'name': device.name, 'version': version, 'shares': shares };
      if (device.addresses && device.addresses[0] && device.addresses[0].length) {
          nasObj.ip = device.addresses[0];
      }
      defer.resolve(nasObj);
    }
  });
  return defer.promise;
};

ControllerNetworkfs.prototype.parseSmbClientNegotiatedVersion = function (data) {
  var self = this;

  var lines = data.split('\n');
  for (var i in lines) {
    if (lines[i].includes('negotiated dialect')) {
      var match = lines[i].match(/dialect\[(.+?)]/);
      if (match) return match[1]
    }
  }
  return '';
};

ControllerNetworkfs.prototype.parseSmbClientResult = function (data) {
  var self = this;
  var resultsArray = [];

  var lines = data.split('\n');
  for (var i in lines) {
    if (lines[i].includes('Disk')) {
      var nameWithSpaces = lines[i].split('Disk')[0];
      var shareName = nameWithSpaces.replace(/^\s+|\s+$/gm,'');
      resultsArray.push({ 'sharename': shareName, 'path': shareName });
    }
  }
  return resultsArray;
};

ControllerNetworkfs.prototype.getAdditionalConf = function (type, controller, data, def) {
  var self = this;
  var setting = self.commandRouter.executeOnPlugin(type, controller, 'getConfigParam', data);

  if (setting == undefined) {
    setting = def;
  }
  return setting;
};

ControllerNetworkfs.prototype.getLabelForSelect = function (options, key) {
  var self = this;
  var n = options.length;
  for (var i = 0; i < n; i++) {
    if (options[i].value == key) { return options[i].label; }
  }

  return 'Error';
};

ControllerNetworkfs.prototype.onPlayerNameChanged = function () {
  var self = this;

  setTimeout(function () {
    return self.writeSMBConf();
  }, 10000);
};

ControllerNetworkfs.prototype.writeSMBConf = function () {
  var self = this;

  var systemController = self.commandRouter.pluginManager.getPlugin('system_controller', 'system');
  var nameraw = systemController.getConf('playerName');
  var name = nameraw.charAt(0).toUpperCase() + nameraw.slice(1);
  var smbConfFile = '/etc/samba/smb.conf';

  exec('/usr/bin/sudo /bin/chmod 777 ' + smbConfFile, {uid: 1000, gid: 1000},
    function (error, stdout, stderr) {
      if (error != null) {
        self.logger.info('Error setting smb.conf file perms: ' + error);
      } else {
        self.logger.info('smb.conf Permissions set');
        fs.readFile(__dirname + '/smb.conf.tmpl', 'utf8', function (err, data) {
          if (err) {
            return self.logger.log('Error reading Samba configuration template file: ' + err);
          }
          var conf = data.replace(/{NAME}/g, name);

          fs.writeFile(smbConfFile, conf, 'utf8', function (err) {
            if (err) {
              self.logger.log('Error writing Samba configuration file: ' + err);
            } else {
              exec('/usr/bin/sudo /bin/systemctl restart nmbd.service && /usr/bin/sudo /bin/systemctl restart smbd.service', {uid: 1000, gid: 1000}, function (error, stdout, stderr) {
                if (error !== null) {
                  self.logger.error('Cannot restart SAMBA');
                } else {
                  self.logger.info('SAMBA Restarted');
                }
              });
            }
          });
        });
      }
    });

  exec('/usr/bin/sudo /bin/chmod 777 /data/INTERNAL', {uid: 1000, gid: 1000}, function (error, stdout, stderr) {
    if (error != null) {
      self.logger.info('Error setting /data/internal perms: ' + error);
    } else {
      self.logger.info('Internal perms successfully set');
    }
  });
};

ControllerNetworkfs.prototype.onVolumioReboot = function () {
  var self = this;

  return self.umountAllShares();
};

ControllerNetworkfs.prototype.onVolumioShutdown = function () {
  var self = this;

  return self.umountAllShares();
};

ControllerNetworkfs.prototype.umountAllShares = function () {
  var self = this;

  var defer = libQ.defer();
  var shares = config.getKeys('NasMounts');
  var nShares = shares.length;

  if (nShares > 0) {
    for (var i in shares) {
      self.umountShare({'id': shares[i]});
    }
  }
  defer.resolve('');

  return defer.promise;
};

// FS AUTOMOUNT

ControllerNetworkfs.prototype.umountShare = function (data) {
  var self = this;

  var defer = libQ.defer();
  var key = 'NasMounts.' + data['id'];

  if (config.has(key)) {
    var mountidraw = config.get(key + '.name');
    var mountid = mountidraw.replace(/[\s\n\\]/g, '_');
    var mountpoint = '/mnt/NAS/' + mountid;
    try {
      execSync('/usr/bin/sudo /bin/umount -f ' + mountpoint, { uid: 1000, gid: 1000, encoding: 'utf8', timeout: 10000 });
    } catch (e) {
      self.logger.error('Cannot umount share ' + mountid + ' : ' + e);
    }
  }
};

ControllerNetworkfs.prototype.enableDeviceActions = function () {
  var self = this;
  ignoreDeviceAction = false;
  self.logger.info('Mount handler: device actions (re-)enabled');
}

ControllerNetworkfs.prototype.disableDeviceActions = function () {
  var self = this;
  ignoreDeviceAction = true;
  self.logger.info('Mount handler: device actions disabled');
}

ControllerNetworkfs.prototype.initUdevWatcher = function () {
  var self = this;

  self.logger.info('Starting Udev Watcher for removable devices');
  var monitor = udev.monitor('block');

  var devices = self.getUdevDevices();
  for (var i in devices) {
    deviceAddAction(devices[i]);
  }

  monitor.on('add', function (device) {
    if (device.DEVTYPE) {
      deviceAddAction(device);
    }
  });

  monitor.on('change', function (device) {
    if (device.DEVTYPE) {
      deviceChangeAction(device);
    }
  });

  monitor.on('remove', function (device) {
    if (device.DEVTYPE) {
      deviceRemoveAction(device);
    }
  });

  function deviceAddAction (device) {
    switch (device.DEVTYPE) {
      case 'partition':
        if (!ignoreDeviceAction) {
          self.mountDevice(device);
        }
        break;
      case 'disk':
        break;
      default:
        break;
    }
  }

  function deviceChangeAction (device) {
    switch (device.DEVTYPE) {
      case 'partition':
        break;
      case 'disk':
        break;
      default:
        break;
    }
  }

  function deviceRemoveAction (device) {
    switch (device.DEVTYPE) {
      case 'partition':
        if (!ignoreDeviceAction) {
          self.logger.info('Partition removed: ' + JSON.stringify(device));
          self.umountDevice(device);
        }
        break;
      case 'disk':
        break;
      default:
        break;
    }
  }
};

ControllerNetworkfs.prototype.getUdevDevices = function () {
  var self = this;

  return udev.list('block');
};

ControllerNetworkfs.prototype.mountDevice = function (device) {
  var self = this;

  var fsLabel = self.getFSLabel(device);
  if (fsLabel && device.DEVNAME && device.ID_FS_TYPE) {
    	if (self.isDeviceToBeMounted(device)) {
    	  self.logger.info('Mounting Device ' + fsLabel);
    	  if (self.checkLabelForInternalDiskToBeMounted(fsLabel)) {
    	    var mountFolder = removableMountPoint + 'INTERNAL/';
    	  } else {
    	    var mountFolder = removableMountPoint + 'USB/' + fsLabel;
    	  }

    	  if (!fs.existsSync(mountFolder)) {
    	    this.createMountFolder(mountFolder);
    	  }
    	  self.mountPartition({'label': fsLabel, 'devName': device.DEVNAME, 'fsType': device.ID_FS_TYPE, 'mountFolder': mountFolder});
    	} else {
    	  self.logger.info('Ignoring mount for partition: ' + fsLabel);
    	}
  }
};

ControllerNetworkfs.prototype.getFSLabel = function (device) {
  var self = this;

  if (device.ID_FS_LABEL) {
    return device.ID_FS_LABEL;
  } else if (device.ID_FS_UUID) {
    return device.ID_FS_UUID;
  } else {
    self.logger.error('Cannot associate FS Label, not mounting');
    return false;
  }
};

ControllerNetworkfs.prototype.isDeviceToBeMounted = function (device) {
  var self = this;

  var fsLabel = self.getFSLabel(device);
  if (fsLabel !== 'boot' && fsLabel !== 'volumio_data' && fsLabel !== 'volumio' && fsLabel !== 'volumioboot' && fsLabel !== 'volumioimg') {
    if (self.isUsbDevice(device)) {
      return true;
    } else {
      if (self.checkLabelForInternalDiskToBeMounted(fsLabel)) {
        return true;
      } else {
        return false;
      }
      // TODO: We need to save internal HDDs partitions that we want to mount. This has to be done in the UI.
      // Here we must check if ther uuid or label is saved by user as mountable and mount it.
      // For now: setting one of the internal label shall do the trick
      return false;
    }
  } else {
    return false;
  }
};

ControllerNetworkfs.prototype.isUsbDevice = function (device) {
  var self = this;

  try {
    var fsRemovable = execSync('/bin/lsblk -rno tran "/dev/$(lsblk -rno PKNAME ' + device.DEVNAME + ')"',{ uid: 1000, gid: 1000, encoding: 'utf8'});
    if (fsRemovable.indexOf('usb') >= 0) {
      return true;
    } else {
      return false;
    }
  } catch(e) {
    self.logger.error('Failed USB identification: ' + e);
    return false;
  }
};

ControllerNetworkfs.prototype.checkLabelForInternalDiskToBeMounted = function (label) {
  var self = this;
  // Those labels if set to an hard drive, will result in it mounting as internal drive
  var internalMemoryAllowedLabelsArray = ['issd', 'ihdd', 'Internal SSD', 'Internal HDD'];

  var internalLabelIndex = internalMemoryAllowedLabelsArray.findIndex(element => {
    return element.toLowerCase() === label.toLowerCase();
  });

  if (internalLabelIndex > -1) {
    return true;
  } else {
    return false;
  }
};

ControllerNetworkfs.prototype.umountDevice = function (device) {
  var self = this;

  if (device.ID_FS_LABEL) {
    var fsLabel = device.ID_FS_LABEL;
  } else if (device.ID_FS_UUID) {
    var fsLabel = device.ID_FS_UUID;
  } else {
    self.logger.error('Cannot associate FS Label, not mounting');
  }

  if (fsLabel && device.DEVNAME && device.ID_FS_TYPE) {
    if (self.checkLabelForInternalDiskToBeMounted(fsLabel)) {
      var mountFolder = removableMountPoint + 'INTERNAL/';
    } else {
      var mountFolder = removableMountPoint + 'USB/' + fsLabel;
    }
    if (fs.existsSync(mountFolder)) {
      self.umountPartition({'label': fsLabel, 'devName': device.DEVNAME, 'mountFolder': mountFolder});
    }
  }
};

ControllerNetworkfs.prototype.createMountFolder = function (mountFolder) {
  var self = this;

  try {
    execSync('/bin/mkdir -m 777 "' + mountFolder + '"', {uid: 1000, gid: 1000});
  } catch (e) {
    self.logger.error('Failed to create folder ' + e);
  }
};

ControllerNetworkfs.prototype.deleteMountFolder = function (mountFolder) {
  var self = this;

  self.logger.info('TEST: Here we shall have deleted mounted folder: ' + mountFolder);

  // This is commented, to validate the assumption that this might unintentionally delete music files on USB
  /*
  try {
    execSync('/bin/rm -rf "' + mountFolder + '"', {uid: 1000, gid: 1000});
  } catch (e) {
    self.logger.error('Failed to delete Folder ' + e);
  }
  */
};

ControllerNetworkfs.prototype.bindInternalMemoryPosition = function () {
  var self = this;

  try {
    	self.logger.info('Binding Internal Memory position');
    execSync('/usr/bin/sudo /bin/mount -o bind /mnt/INTERNAL /data/INTERNAL', {uid: 1000, gid: 1000});
  } catch (e) {
    self.logger.error('Failed to bind internal Position ' + e);
  }
};

ControllerNetworkfs.prototype.mountPartition = function (partitionData) {
  var self = this;

  if (partitionData.fsType === 'vfat' || partitionData.fsType === 'ntfs') {
    var options = 'noatime,dmask=0000,fmask=0000,iocharset=utf8';
  } else {
    var options = 'noatime';
  }
  var mountCMD = '/usr/bin/sudo /bin/mount "' + partitionData.devName + '" "' + partitionData.mountFolder + '" -o ' + options;
  try {
    execSync(mountCMD, {uid: 1000, gid: 1000});
    self.storeMountedFolder(partitionData.mountFolder);
    if (self.checkLabelForInternalDiskToBeMounted(partitionData.label)) {
      self.bindInternalMemoryPosition();
    } else {
      var message = partitionData.label + ' ' + self.commandRouter.getI18nString('COMMON.CONNECTED');
      self.commandRouter.pushToastMessage('success', self.commandRouter.getI18nString('COMMON.MY_MUSIC'), message);
    }
  } catch (e) {
    self.logger.error('Failed to mount ' + partitionData.label + ': ' + e);
  }
};

ControllerNetworkfs.prototype.umountPartition = function (partitionData) {
  var self = this;
  var umountCMD = '/usr/bin/sudo /bin/umount -f "' + partitionData.devName + '"';

  try {
    execSync(umountCMD, {uid: 1000, gid: 1000});
    setTimeout(() => {
      self.deleteMountFolder(partitionData.mountFolder);
        	var message = partitionData.label + ' ' + self.commandRouter.getI18nString('COMMON.DISCONNECTED');
        	self.commandRouter.pushToastMessage('success', self.commandRouter.getI18nString('COMMON.MY_MUSIC'), message);
    	}, 4000);
  } catch (e) {
    self.logger.error('Failed to umount ' + partitionData.label + ': ' + e);
  }
  setTimeout(() => {
    self.deleteMountedFolder(partitionData.mountFolder);
  }, 5000);
};

ControllerNetworkfs.prototype.storeMountedFolder = function (mountFolder) {
  var self = this;

  var mountedFoldersArray = self.retrieveMountedFolder();
  mountedFoldersArray.then((data) => {
    if (!_.contains(data, mountFolder)) {
      data.push(mountFolder);
      self.saveMountedFolder(data);
      var clearFolder = mountFolder.replace('/mnt/', '');
      execSync('/usr/bin/mpc update "' + clearFolder + '"', {uid: 1000, gid: 1000});
      self.logger.info('Scanning new location : ' + '"' + clearFolder + '"');
    }
  });
};

ControllerNetworkfs.prototype.deleteMountedFolder = function (mountFolder) {
  var self = this;

  var mountedFoldersArray = self.retrieveMountedFolder();
  mountedFoldersArray.then((data) => {
    if (_.contains(data, mountFolder)) {
      var mountedFoldersArray = _.without(data, mountFolder);
      self.saveMountedFolder(mountedFoldersArray);
      var clearFolder = mountFolder.replace('/mnt/', '');
      execSync('/usr/bin/mpc update "' + clearFolder + '"', {uid: 1000, gid: 1000});
      self.logger.info('Scanning removed location : ' + '"' + clearFolder + '"');
    }
  });
};

ControllerNetworkfs.prototype.retrieveMountedFolder = function () {
  var self = this;
  var defer = libQ.defer();

  fs.readJson(mountPointFile, function (err, result) {
    if (err) {
      defer.resolve([]);
    } else {
      if (result && result.mountedFolders) {
        defer.resolve(result.mountedFolders);
      } else {
        defer.resolve([]);
      }
    }
  });
  return defer.promise;
};

ControllerNetworkfs.prototype.saveMountedFolder = function (mountedFoldersArray) {
  var self = this;
  var content = {'mountedFolders': mountedFoldersArray};
  fs.writeJson(mountPointFile, content, function (err, result) {
    if (err) {
      self.logger.error('Could Not Save Mounted folders info: ' + err);
    }
  });
};

ControllerNetworkfs.prototype.properQuote = function (str) {
  // returns str as a single-quoted string, safe for exposure to a shell.
  var output = '';

  var quotedquote = "'" + // turn on single quoting
        '"' + // turn on double quoting
        "'" + // so we can quote this single quote
        '"' + // turn off double quoting
        "'"; // turn off single quoting

  var pieces = str.split("'");
  var n = pieces.length;

  for (var i = 0; i < n; i++) {
    output = output + pieces[i];
    if (i < (n - 1)) output = output + quotedquote;
  }

  output = "'" + output + "'";

  return output;
};
