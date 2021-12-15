'use strict';

var fs = require('fs-extra');
var config = new (require('v-conf'))();
var foundVolumioInstances = new (require('v-conf'))();
var mdns = require('mdns');
var HashMap = require('hashmap');
var io = require('socket.io-client');
var exec = require('child_process').exec;
var libQ = require('kew');
var unirest = require('unirest');
var ifconfig = require('/volumio/app/plugins/system_controller/network/lib/ifconfig.js');

// Define the ControllerVolumioDiscovery class

var registeredUUIDs = [];

// Define the ControllerVolumioDiscovery class
module.exports = ControllerVolumioDiscovery;

function ControllerVolumioDiscovery (context) {
  var self = this;

  self.remoteConnections = new HashMap();

  // Save a reference to the parent commandRouter
  self.context = context;
  self.logger = self.context.logger;
  self.commandRouter = self.context.coreCommand;

  self.callbacks = [];
}

ControllerVolumioDiscovery.prototype.getConfigurationFiles = function () {
  var self = this;

  return ['config.json'];
};

ControllerVolumioDiscovery.prototype.onPlayerNameChanged = function (name) {
  var self = this;

  self.logger.info('Discovery: Restarting Advertising due to device name change');
  var bound = self.startAdvertisement.bind(self);
  try {
    self.ad.stop();
  } catch (e) {}

  self.forceRename = true;
  setTimeout(bound, 5000);
};

ControllerVolumioDiscovery.prototype.onVolumioStart = function () {
  var self = this;

  var configFile = self.commandRouter.pluginManager.getConfigurationFile(self.context, 'config.json');
  config.loadFile(configFile);

  self.startAdvertisement();
  self.startMDNSBrowse();

  var boundMethod = self.onPlayerNameChanged.bind(self);
  self.commandRouter.executeOnPlugin('system_controller', 'system', 'registerCallback', boundMethod);

  return libQ.resolve();
};

ControllerVolumioDiscovery.prototype.getNewName = function (curName, i) {
  var self = this;
  var keys = foundVolumioInstances.getKeys();
  var collides = false;

  var nameToCheck;
  if (i == 0) { nameToCheck = curName; } else nameToCheck = curName + i;

  self.context.coreCommand.pushConsoleMessage(keys);
  for (var k in keys) {
    var key = keys[k];
    var ithName = foundVolumioInstances.get(key + '.name');

    self.context.coreCommand.pushConsoleMessage('Checking name ' + ithName + ' against ' + nameToCheck);
    if (ithName == nameToCheck) { collides = true; }
  }

  var newi = parseInt(i + 1);
  if (collides == true) { return self.getNewName(curName, newi); } else return nameToCheck;
};

ControllerVolumioDiscovery.prototype.startAdvertisement = function () {
  var self = this;
  var forceRename = self.forceRename;
  self.forceRename = undefined;

  try {
    var name = self.commandRouter.sharedVars.get('system.name');
    var uuid = self.commandRouter.sharedVars.get('system.uuid');
    var serviceName = config.get('service');
    var servicePort = config.get('port');

    var txt_record = {
      volumioName: name,
      UUID: uuid
    };

    self.logger.info('Discovery: Started advertising with name: ' + name);

    self.ad = mdns.createAdvertisement(mdns.tcp(serviceName), servicePort, {txtRecord: txt_record}, function (error, service) {
      if (error) {
        self.logger.error('MDNS Advertisement error: ' + error);
      }
    });
    self.ad.on('error', function (error) {
      self.logger.error('Discovery: advertisement error: ' + error);
      self.context.coreCommand.pushConsoleMessage('mDNS Advertisement raised the following error ' + error);
      setTimeout(function () {
        self.startAdvertisement();
      }, 5000);
    });
    self.ad.start();
  } catch (ecc) {
    if (ecc == 'Error: dns service error: name conflict') {
      self.logger.error('Name conflict due to Shairport Sync, discarding error');
    } else {
      setTimeout(function () {
        self.logger.error('Discovery: Generic error: ' + ecc);
        self.forceRename = false;
        self.startAdvertisement();
      }, 5000);
    }
  }
};

ControllerVolumioDiscovery.prototype.startMDNSBrowse = function () {
  var self = this;

  try {
    var serviceName = config.get('service');
    var servicePort = config.get('port');

    var sequence = [
      mdns.rst.DNSServiceResolve(),
			 mdns.rst.getaddrinfo({families: [4] })
    ];
    self.browser = mdns.createBrowser(mdns.tcp(serviceName), {resolverSequence: sequence});

    self.browser.on('error', function (error) {
      self.context.coreCommand.pushConsoleMessage('mDNS Browse raised the following error ' + error);
      // Do not start mdns browser, since it will duplicate its instance
      // Find a way to reinstantiate, if possible
      // self.startMDNSBrowse();
    });
    self.browser.on('serviceUp', function (service) {
      if (registeredUUIDs.indexOf(service.txtRecord.UUID) > -1) {
        self.logger.info('Discovery: this is already registered,  ' + service.txtRecord.UUID);
        foundVolumioInstances.delete(service.txtRecord.UUID + '.name');
        self.remoteConnections.remove(service.txtRecord.UUID + '.name');
      } else {
        registeredUUIDs.push(service.txtRecord.UUID);
        self.logger.info('Discovery: adding ' + service.txtRecord.UUID);
      }

      // console.log(service);
      self.context.coreCommand.pushConsoleMessage('mDNS: Found device ' + service.txtRecord.volumioName);
      foundVolumioInstances.addConfigValue(service.txtRecord.UUID + '.name', 'string', service.txtRecord.volumioName);
      foundVolumioInstances.addConfigValue(service.txtRecord.UUID + '.addresses', 'array', service.addresses);
      foundVolumioInstances.addConfigValue(service.txtRecord.UUID + '.port', 'string', service.port);
      foundVolumioInstances.addConfigValue(service.txtRecord.UUID + '.status', 'string', 'stop');
      foundVolumioInstances.addConfigValue(service.txtRecord.UUID + '.volume', 'number', 0);
      foundVolumioInstances.addConfigValue(service.txtRecord.UUID + '.mute', 'boolean', false);
      foundVolumioInstances.addConfigValue(service.txtRecord.UUID + '.volumeAvailable', 'boolean', true);
      foundVolumioInstances.addConfigValue(service.txtRecord.UUID + '.artist', 'string', '');
      foundVolumioInstances.addConfigValue(service.txtRecord.UUID + '.track', 'string', '');
      foundVolumioInstances.addConfigValue(service.txtRecord.UUID + '.albumart', 'string', '');

      var type = 'device';
      if (service.txtRecord.type) {
        type = service.txtRecord.type;
      }
      foundVolumioInstances.addConfigValue(service.txtRecord.UUID + '.type', 'string', type);

      self.connectToRemoteVolumio(service.txtRecord.UUID, service.addresses[0]);

      var toAdvertise = self.getDevices();
      self.commandRouter.pushMultiroomDevices(toAdvertise);

      for (var i in self.callbacks) {
        var c = self.callbacks[i];

        var callback = c.bind(c.this);
        callback(toAdvertise);
      }
    });
    self.browser.on('serviceDown', function (service) {
      self.context.coreCommand.pushConsoleMessage('mDNS: A device disapperared from network');

      var keys = foundVolumioInstances.getKeys();

      for (var i in keys) {
        var key = keys[i];
        var uuidindex = registeredUUIDs.indexOf(key);

        if (uuidindex !== -1) {
				    registeredUUIDs.splice(uuidindex, 1);
        }

        var osname = foundVolumioInstances.get(key + '.name').toLowerCase();
        if (osname == service.name) {
          self.context.coreCommand.pushConsoleMessage('mDNS: Device ' + service.name + ' disapperared from network');
          foundVolumioInstances.delete(key);

          self.remoteConnections.remove(key);
        }
      }

      var toAdvertise = self.getDevices();
      self.commandRouter.pushMultiroomDevices(toAdvertise);

      for (var i in self.callbacks) {
        var callback = self.callbacks[i];

        callback.call(callback, toAdvertise);
      }
    });
    self.browser.start();
  } catch (error) {
    self.startMDNSBrowse();
  }
};

ControllerVolumioDiscovery.prototype.initSocket = function (data) {
  var self = this;  
  // Wait untill the current connection times out
  setTimeout(() => {
    // If this device is in our mDNS cache and we got this message, then the device was offline and went back online. We reconnect the socketIO.
    var myuuid = self.commandRouter.sharedVars.get('system.uuid');
    if (foundVolumioInstances.get(data.id + '.name') && !self.remoteConnections.has(data.id) && myuuid != data.id) {
      var addresses = foundVolumioInstances.get(data.id + '.addresses');
      if (addresses && addresses[0] && addresses[0].value && addresses[0].value[0].value) {
        self.logger.info("Reconnecting to " + addresses[0].value[0].value + " which is still in the mDNS cache");
        //This device was ungracefully disconnected, but is still in the mdns cache
        self.connectToRemoteVolumio(data.id, addresses[0].value[0].value);        
      }
    }
  }, 15000);  
}

ControllerVolumioDiscovery.prototype.connectToRemoteVolumio = function (uuid, ip) {
  var self = this;

  var myuuid = self.commandRouter.sharedVars.get('system.uuid');

  if ((!self.remoteConnections.has(uuid)) && (myuuid != uuid)) {
    var socket = io.connect('http://' + ip + ':3000');
    socket.on('connect', function () {
      socket.emit('initSocket', {id: myuuid});
      socket.emit('getState', '');
      //Synchronise multiroom devices      
      socket.emit('getMultiroomSyncOutput', '');
      self.commandRouter.getMultiroomSyncOutput();
      socket.on('pushState', function (data) {
        self.updateMultiroomDevice(uuid, data);
      });
      socket.on('pushMultiroomSyncOutput', function (data) {
        self.commandRouter.updateMultiroomSyncOutput(data);
      });
      socket.on('enableMultiroomSyncOutput', function (data) {
        self.commandRouter.enableMultiroomSyncOutput(data);
      });
      socket.on('disableMultiroomSyncOutput', function (data) {
        self.commandRouter.disableMultiroomSyncOutput(data);
      });
      socket.on('getMultiroomSyncOutput', function (data) {
        self.commandRouter.getMultiroomSyncOutput(data);
      });
      socket.on('disconnect', function () {        
        self.remoteConnections.remove(uuid);
        socket.close(); 
      });
    });

    self.remoteConnections.set(uuid, socket);
  } else {
    var selfState = self.commandRouter.volumioGetState();
    self.updateMultiroomDevice(uuid, selfState);
  }
};

ControllerVolumioDiscovery.prototype.updateMultiroomDevice = function (uuid, data) {
  var self = this;
  foundVolumioInstances.set(uuid + '.status', data.status);
  if (data.volume === undefined) {
    data.volume = 0;
  }
  foundVolumioInstances.set(uuid + '.volume', data.volume);
  foundVolumioInstances.set(uuid + '.mute', data.mute);
  foundVolumioInstances.set(uuid + '.artist', data.artist);
  foundVolumioInstances.set(uuid + '.track', data.title);
  foundVolumioInstances.set(uuid + '.albumart', data.albumart);
  var volumeAvailable = true;
  if (data.disableVolumeControl) {
    volumeAvailable = false;
  }
  foundVolumioInstances.set(uuid + '.volumeAvailable', volumeAvailable);
  self.pushMultiRoomStatus();
};

ControllerVolumioDiscovery.prototype.pushMultiRoomStatus = function () {
  var self = this;
  var toAdvertise = self.getDevices();
  self.commandRouter.pushMultiroomDevices(toAdvertise);
};

String.prototype.capitalize = function () {
  return this.charAt(0).toUpperCase() + this.slice(1);
};

ControllerVolumioDiscovery.prototype.saveDeviceInfo = function (data) {
  var self = this;
  // console.log("AV: Got saveDeviceInfo: " + JSON.stringify(data,null,4));
  if (data.volume == undefined) data.volume = 0;
  if (data.status == undefined) data.status = '';
  if (data.artist == undefined) data.artist = '';
  if (data.title == undefined) data.title = '';
  if (data.albumart == undefined) data.albumart = '';

  var uuid = data.uuid;

  if (uuid == undefined) {
    uuid = self.commandRouter.sharedVars.get('system.uuid');
    // console.log("Using self UUID");
  }
  foundVolumioInstances.set(uuid + '.status', data.status);
  foundVolumioInstances.set(uuid + '.volume', data.volume > -1 ? data.volume : 0);
  foundVolumioInstances.set(uuid + '.mute', data.mute);
  foundVolumioInstances.set(uuid + '.artist', data.artist);
  foundVolumioInstances.set(uuid + '.track', data.title);
  foundVolumioInstances.set(uuid + '.albumart', data.albumart);
  var volumeAvailable = true;
  if (data.disableVolumeControl) {
    volumeAvailable = false;
  }
  foundVolumioInstances.set(uuid + '.volumeAvailable', volumeAvailable);
};

ControllerVolumioDiscovery.prototype.getDevices = function () {
  var self = this;

  var myuuid = self.commandRouter.sharedVars.get('system.uuid');

  var response = {
    misc: {debug: true},
    list: []};

  var keys = foundVolumioInstances.getKeys();

  for (var i in keys) {
    var key = keys[i];

    var osname = foundVolumioInstances.get(key + '.name');
    var port = foundVolumioInstances.get(key + '.port');
    var status = foundVolumioInstances.get(key + '.status');
    var volume = foundVolumioInstances.get(key + '.volume');
    var mute = foundVolumioInstances.get(key + '.mute');
    var artist = foundVolumioInstances.get(key + '.artist');
    var track = foundVolumioInstances.get(key + '.track');
    var albumart = foundVolumioInstances.get(key + '.albumart');
    var type = foundVolumioInstances.get(key + '.type');
    var volumeAvailable = foundVolumioInstances.get(key + '.volumeAvailable');

    var isSelf = key == myuuid;

    var addresses = foundVolumioInstances.get(key + '.addresses');

    for (var j in addresses) {
      var address = addresses[j];
      if (isSelf) {
        var iPAddresses = self.commandRouter.getCachedIPAddresses();
        if (iPAddresses && iPAddresses.eth0 && iPAddresses.eth0 != '') {
          address = iPAddresses.eth0;
        } else if (iPAddresses && iPAddresses.wlan0 && iPAddresses.wlan0 != '' && iPAddresses.wlan0 !== '192.168.211.1') {
          address = iPAddresses.wlan0;
        } else {
          address = '127.0.0.1';
        }
      } else {
        if (address.value[0] != undefined && address.value[0].value[0] != undefined) {
          address = address.value[0].value[0];
        }
      }
      if (albumart) {
        var albumartstring = 'http://' + address + albumart;
        if (albumart.indexOf('http') != -1) {
          albumartstring = albumart;
        }
      } else {
        var albumartstring = 'http://' + address + '/albumart';
      }

      // This overwrites the locally selected IP address, and breaks discovery when hotspot is active. Also seems redundant.
      // if (addresses && addresses[0] && addresses[0].value && addresses[0].value[0].value) {
      //   address = addresses[0].value[0].value;
      // }

      var device = {
        id: key,
        host: 'http://' + address.toString(),
        name: osname.capitalize(),
        isSelf: isSelf,
        type: type,
        volumeAvailable: volumeAvailable,
        state: {
          status: status,
          volume: volume,
          mute: mute,
          artist: artist,
          track: track,
          albumart: albumartstring.toString()
        }
      };

      response.list.push(device);
    }
  }
  return response;
};

ControllerVolumioDiscovery.prototype.getThisDevice = function () {
  var self = this;

  self.logger.info('Discovery: Getting this device information');
  var thisDevice = {};
  var thisState = self.commandRouter.volumioGetState();
  var ipAddresses = self.commandRouter.executeOnPlugin('system_controller', 'network', 'getCachedIPAddresses', '');
  thisDevice.id = self.commandRouter.sharedVars.get('system.uuid');
  if (ipAddresses && ipAddresses.eth0 && ipAddresses.eth0 != '') {
    thisDevice.host = 'http://' + ipAddresses.eth0;
  } else if (ipAddresses && ipAddresses.wlan0 && ipAddresses.wlan0 !== '192.168.211.1') {
    thisDevice.host = 'http://' + ipAddresses.wlan0;
  } else {
    thisDevice.host = 'http://127.0.0.1';
  }
  thisDevice.name = self.commandRouter.sharedVars.get('system.name');
  thisDevice.type = config.get('device_type', 'device');
  thisDevice.serviceName = config.get('service');
  var artURL = thisDevice.host + '/albumart';
  if(thisState.albumart !== undefined && thisState.albumart !== null) {
	artURL = (thisState.albumart.startsWith('http://') || thisState.albumart.startsWith('https://')) ? thisState.albumart : thisDevice.host + thisState.albumart;
  }
  
  thisDevice.state = {
    status: thisState.status,
    volume: thisState.volume,
    mute: thisState.mute,
    artist: thisState.artist,
    track: thisState.title,
    albumart: artURL
  };

  return thisDevice;
};

ControllerVolumioDiscovery.prototype.onStop = function () {
  var self = this;
  // Perform startup tasks here
};

ControllerVolumioDiscovery.prototype.onRestart = function () {
  var self = this;
  // Perform startup tasks here
};

ControllerVolumioDiscovery.prototype.onInstall = function () {
  var self = this;
  // Perform your installation tasks here
};

ControllerVolumioDiscovery.prototype.onUninstall = function () {
  var self = this;
  // Perform your installation tasks here
};

ControllerVolumioDiscovery.prototype.getUIConfig = function () {
  var self = this;

  return uiconf;
};

ControllerVolumioDiscovery.prototype.setUIConfig = function (data) {
  var self = this;

  var uiconf = fs.readJsonSync(__dirname + '/UIConfig.json');
};

ControllerVolumioDiscovery.prototype.getConf = function (varName) {
  var self = this;

  return self.config.get(varName);
};

ControllerVolumioDiscovery.prototype.setConf = function (varName, varValue) {
  var self = this;

  self.config.set(varName, varValue);
};

// Optional functions exposed for making development easier and more clear
ControllerVolumioDiscovery.prototype.getSystemConf = function (pluginName, varName) {
  var self = this;
  // Perform your installation tasks here
};

ControllerVolumioDiscovery.prototype.setSystemConf = function (pluginName, varName) {
  var self = this;
  // Perform your installation tasks here
};

ControllerVolumioDiscovery.prototype.getAdditionalConf = function () {
  var self = this;
  // Perform your installation tasks here
};

ControllerVolumioDiscovery.prototype.setAdditionalConf = function () {
  var self = this;
  // Perform your installation tasks here
};

/**
 * Registers a callback that is called when a device appears or disappears
 * @param callback
 */
ControllerVolumioDiscovery.prototype.registerCallback = function (callback) {
  var self = this;

  self.callbacks.push(callback);
};

/**
 * Receives updates for an host about its only information
 * @param info
 */
ControllerVolumioDiscovery.prototype.receiveMultiroomDeviceUpdate = function (info) {
  var self = this;

  // self.logger.info("receiveMultiroomDeviceUpdate: "+JSON.stringify(info));
};

// ControllerVolumioDiscovery.prototype.saveDeviceInfo=function(data)
// {
// 	var self=this;

// 	var systemController = self.commandRouter.pluginManager.getPlugin('system_controller', 'system');
// 	var uuid = systemController.getConf('uuid');
// 	foundVolumioInstances.set(uuid+'.status',data.status);
// 	foundVolumioInstances.set(uuid+'.volume',data.volume > -1 ? data.volume : 0);
// 	foundVolumioInstances.set(uuid+'.mute',data.mute);
// 	foundVolumioInstances.set(uuid+'.artist',data.artist);
// 	foundVolumioInstances.set(uuid+'.track',data.title);
// 	foundVolumioInstances.set(uuid+'.albumart',data.albumart);
// 	for(var i in self.callbacks)
// 			{
// 				var c=self.callbacks[i];

// 				var callback= c.bind(c.this);
// 				callback(toAdvertise);
// 			}
// }

ControllerVolumioDiscovery.prototype.setRemoteDeviceVolume = function (data) {
  let self = this;

  self.logger.info('Setting Remote Device Volume: ' + data.host);
  if (data && data.isSelf === true ) {
    data.host = 'http://127.0.0.1:3000';
  }
  let url = data.host + '/api/v1/commands/?cmd=volume&volume=' + data.volume;

  unirest.get(url)
    .timeout(3000)
    .end(function (response) {
      if (response && response.status === 200) {
        self.logger.info('Done setting volume on: ', data.host);
      } else {
        self.logger.error('Cannot set Remote Device Volume');
      }
    });
};

ControllerVolumioDiscovery.prototype.handleUngracefulDeviceDisappear = function (uuid) {
  var self = this;

  if (foundVolumioInstances.get(uuid + '.name')) {
    try {
      self.logger.info('mDNS: Device ' + foundVolumioInstances.get(uuid + '.name') + ' disapperared ungracefully from network');
      foundVolumioInstances.delete(uuid);
      self.remoteConnections.remove(uuid);
      var toAdvertise = self.getDevices();
      self.commandRouter.pushMultiroomDevices(toAdvertise);
    } catch (e) {
      self.logger.error('mDNS: Failed to remove ungraceful device: ' + e);
    }
  }
};
