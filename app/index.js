'use strict';

var libQ = require('kew');
var libFast = require('fast.js');
var fs = require('fs-extra');
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;
var winston = require('winston');
var vconf = require('v-conf');

class CoreCommandRouter {
  constructor(server) {
    metrics.time('CommandRouter');

    this.logger = winston.createLogger({
      format: winston.format.simple(),
      transports: [
        new (winston.transports.Console)({level: 'verbose'})
      ]
    });

    this.callbacks = [];
    this.pluginsRestEndpoints = [];
    this.standByHandler = {};
    this.dspSignalPathElements = [];
    this.sharedVars = new vconf();
    this.sharedVars.registerCallback('language_code', this.loadI18nStrings.bind(this));
    this.sharedVars.addConfigValue('selective_search', 'boolean', true);

    this.logger.info('-------------------------------------------');
    this.logger.info('-----            Volumio3              ----');
    this.logger.info('-------------------------------------------');
    this.logger.info('-----          System startup          ----');
    this.logger.info('-------------------------------------------');

    // Checking for system updates
    this.checkAndPerformSystemUpdates();
    // Start the music library
    this.musicLibrary = new (require('./musiclibrary.js'))(this);

    // Start plugins
    this.pluginManager = new (require(__dirname + '/pluginmanager.js'))(this, server);
    this.pluginManager.checkIndex();
    this.pluginManager.pluginFolderCleanup();
    this.configManager = new (require(__dirname + '/configManager.js'))(this.logger);

    var pluginPromise = this.pluginManager.startPlugins();

    this.loadI18nStrings();
    this.musicLibrary.updateBrowseSourcesLang();

    // Start the state machine
    this.stateMachine = new (require('./statemachine.js'))(this);

    // Start the volume controller
    this.volumeControl = new (require('./volumecontrol.js'))(this);

    // Start the playListManager.playPlaylistlist FS
    // self.playlistFS = new (require('./playlistfs.js'))(self);

    this.playListManager = new (require('./playlistManager.js'))(this);

    this.platformspecific = new (require(__dirname + '/platformSpecific.js'))(this);

    // Wait for plugin startup to complete before playing the startup sound as the
    // plugins may need to be fully active before sound can play properly 
    pluginPromise.then(() => {	  
        this.pushConsoleMessage('BOOT COMPLETED');
        metrics.log('CommandRouter');
        this.setStartupVolume();
        this.startupSound();
        this.closeModals();
    });
  }

  volumioPause() {
    this.pushConsoleMessage('CoreCommandRouter::volumioPause');
    return this.stateMachine.pause();
  }

  volumioStop() {
    this.pushConsoleMessage('CoreCommandRouter::volumioStop');
    return this.stateMachine.stop();
  }

  volumioPrevious() {
    this.pushConsoleMessage('CoreCommandRouter::volumioPrevious');
    return this.stateMachine.previous();
  }

  volumioNext() {
    this.pushConsoleMessage('CoreCommandRouter::volumioNext');
    return this.stateMachine.next();
  }

  volumioGetState() {
    this.pushConsoleMessage('CoreCommandRouter::volumioGetState');
    return this.stateMachine.getState();
  }

  volumioGetQueue() {
    this.pushConsoleMessage('CoreCommandRouter::volumioGetQueue');
    return this.stateMachine.getQueue();
  }

  volumioRemoveQueueItem(nIndex) {
    this.pushConsoleMessage('CoreCommandRouter::volumioRemoveQueueItem');
    return this.stateMachine.removeQueueItem(nIndex);
  }

  volumioClearQueue() {
    this.pushConsoleMessage('CoreCommandRouter::volumioClearQueue');
    return this.stateMachine.clearQueue();
  }

  volumiosetvolume(VolumeInteger) {
    var self = this;
    this.callCallback('volumiosetvolume', VolumeInteger);

    var volSet = this.volumeControl.alsavolume(VolumeInteger);
    volSet.then(function (result) {
           return self.volumioupdatevolume(result);
    });
  }

  volumioupdatevolume(vol) {
    this.callCallback('volumioupdatevolume', vol);
    this.writeVolumeStatusFiles(vol);
    return this.stateMachine.updateVolume(vol);
  }

  volumioretrievevolume() {
    this.pushConsoleMessage('CoreCommandRouter::volumioRetrievevolume');
    return this.volumeControl.retrievevolume();
  }

  volumioUpdateVolumeSettings(vol) {
    this.pushConsoleMessage('CoreCommandRouter::volumioUpdateVolumeSettings');
    if (this.volumeControl) {
      return this.volumeControl.updateVolumeSettings(vol);
    }
  }

  updateVolumeScripts(data) {
    this.pushConsoleMessage('CoreCommandRouter::volumioUpdateVolumeScripts');
    if (this.volumeControl) {
      return this.volumeControl.updateVolumeScript(data);
    }
  }

  retrieveVolumeLevels() {
    this.pushConsoleMessage('CoreCommandRouter::volumioRetrieveVolumeLevels');
    return this.stateMachine.getcurrentVolume();
  }

  setStartupVolume() {
    this.pushConsoleMessage('CoreCommandRouter::volumiosetStartupVolume');
    if (this.volumeControl) {
      return this.volumeControl.setStartupVolume();
    }
  }

  writeVolumeStatusFiles(vol) {
    if (vol.mute !== undefined && vol.mute === true) {
      this.executeWriteVolumeStatusFiles(0);
    } else if (vol && vol.vol && typeof vol.vol === 'number') {
      this.executeWriteVolumeStatusFiles(vol.vol);
    } else {
      this.executeWriteVolumeStatusFiles(100);
    }
  }

  executeWriteVolumeStatusFiles(value) {
    fs.writeFile('/tmp/volume', value.toString(), function (err) {
      if (err) {
              this.logger.error('Could not save Volume value to status file: ' + err);
      }
    });
  }

  addCallback(name, callback) {
    if (this.callbacks[name] == undefined) {
      this.callbacks[name] = [];
    }
    this.callbacks[name].push(callback);
    // this.logger.debug("Total " + callbacks[name].length + " callbacks for " + name);
  }

  callCallback(name, data) {
    var self = this;
    var calls = this.callbacks[name];
    if (calls != undefined) {
      var nCalls = calls.length;
      for (var i = 0; i < nCalls; i++) {
        var func = this.callbacks[name][i];
        try {
          func(data);
        } catch (e) {
          self.logger.error('Help! Some callbacks for ' + name + ' are crashing!');
          self.logger.error(e);
        }
      }
    } else {
      self.logger.debug('No callbacks for ' + name);
    }
  }

  volumioAddQueueUids(arrayUids) {
    this.pushConsoleMessage('CoreCommandRouter::volumioAddQueueUids');
    return this.musicLibrary.addQueueUids(arrayUids);
  }

  volumioGetLibraryFilters(sUid) {
    this.pushConsoleMessage('CoreCommandRouter::volumioGetLibraryFilters');
    return this.musicLibrary.getIndex(sUid);
  }

  volumioGetLibraryListing(sUid, objOptions) {
    this.pushConsoleMessage('CoreCommandRouter::volumioGetLibraryListing');
    return this.musicLibrary.getListing(sUid, objOptions);
  }

  volumioGetBrowseSources() {
    this.pushConsoleMessage('CoreCommandRouter::volumioGetBrowseSources');
    return this.musicLibrary.getBrowseSources();
  }

  volumioGetVisibleBrowseSources() {
    this.pushConsoleMessage('CoreCommandRouter::volumioGetVisibleSources');
    return this.musicLibrary.getVisibleBrowseSources();
  }

  volumioAddToBrowseSources(data) {
    this.pushConsoleMessage('CoreCommandRouter::volumioAddToBrowseSources' + data);
    return this.musicLibrary.addToBrowseSources(data);
  }

  volumioRemoveToBrowseSources(data) {
    this.pushConsoleMessage('CoreCommandRouter::volumioRemoveToBrowseSources' + data);
    return this.musicLibrary.removeBrowseSource(data);
  }

  volumioUpdateToBrowseSources(name, data) {
    this.pushConsoleMessage('CoreCommandRouter::volumioUpdateToBrowseSources');
    return this.musicLibrary.updateBrowseSources(name, data);
  }

  setSourceActive(data) {
    this.pushConsoleMessage('CoreCommandRouter::volumiosetSourceActive' + data);
    return this.musicLibrary.setSourceActive(data);
  }

  volumioGetPlaylistIndex(sUid) {
    this.pushConsoleMessage('CoreCommandRouter::volumioGetPlaylistIndex');
    return this.playlistFS.getIndex(sUid);
  }

  serviceUpdateTracklist(sService) {
    this.pushConsoleMessage('CoreCommandRouter::serviceUpdateTracklist');
    var thisPlugin = this.pluginManager.getPlugin('music_service', sService);
    return thisPlugin.rebuildTracklist();
  }

  volumiowirelessscan() {
    this.pushConsoleMessage('CoreCommandRouter::StartWirelessScan');
    var thisPlugin = this.pluginManager.getPlugin('music_service', sService);
    return thisPlugin.scanWirelessNetworks();
  }

  volumiopushwirelessnetworks(results) {
    this.pushConsoleMessage(results);
  }

  volumioImportServicePlaylists() {
    this.pushConsoleMessage('CoreCommandRouter::volumioImportServicePlaylists');
    return this.playlistFS.importServicePlaylists();
  }

  volumioSearch(data) {
    this.pushConsoleMessage('CoreCommandRouter::Search ' + data);
    var asd = this.musicLibrary.search(data);

    return this.musicLibrary.search(data);
  }

  volumioPushState(state) {
    this.pushConsoleMessage('CoreCommandRouter::volumioPushState');

    // Announce new player state to each client interface
    var self = this;
    var res = libQ.all(
      libFast.map(this.pluginManager.getPluginNames('user_interface'), function (sInterface) {
        var thisInterface = self.pluginManager.getPlugin('user_interface', sInterface);
        if (typeof thisInterface.pushState === 'function') { return thisInterface.pushState(state); }
      })
    );
    self.callCallback('volumioPushState', state);
    return res;
  }

  volumioResetState() {
    this.pushConsoleMessage('CoreCommandRouter::volumioResetState');
    return this.stateMachine.resetVolumioState();
  }

  volumioPushQueue(queue) {
    this.pushConsoleMessage('CoreCommandRouter::volumioPushQueue');

    // Announce new player queue to each client interface
    var self = this;
    return libQ.all(
      libFast.map(this.pluginManager.getPluginNames('user_interface'), function (sInterface) {
        var thisInterface = self.pluginManager.getPlugin('user_interface', sInterface);
        if (typeof thisInterface.pushQueue === 'function') { return thisInterface.pushQueue(queue); }
      })
    );
  }

  serviceClearAddPlayTracks(arrayTrackIds, sService) {
    this.pushConsoleMessage('CoreCommandRouter::serviceClearAddPlayTracks');
    if (sService != undefined) {
      var thisPlugin = this.pluginManager.getPlugin('music_service', sService);

      if (thisPlugin != undefined && typeof thisPlugin.clearAddPlayTracks === 'function') {
        return thisPlugin.clearAddPlayTracks(arrayTrackIds);
      } else {
        this.logger.error('WARNING: No clearAddPlayTracks method for service ' + sService);
      }
    }
  }

  serviceStop(sService) {
    if (sService != undefined) {
      this.pushConsoleMessage('CoreCommandRouter::serviceStop');
      var thisPlugin = this.getMusicPlugin(sService);
      if (thisPlugin != undefined && typeof thisPlugin.stop === 'function') {
        return thisPlugin.stop();
      } else {
        this.logger.error('WARNING: No stop method for service ' + sService);
      }
    } else {
      this.pushConsoleMessage('Received STOP, but no service to execute it');
      return libQ.resolve('');
    }
  }

  servicePause(sService) {
    this.pushConsoleMessage('CoreCommandRouter::servicePause');

    var thisPlugin = this.getMusicPlugin(sService);
    if (thisPlugin != undefined && typeof thisPlugin.pause === 'function') {
      return thisPlugin.pause();
    } else {
      this.logger.error('WARNING: No pause method for service ' + sService);
    }
  }

  serviceResume(sService) {
    this.pushConsoleMessage('CoreCommandRouter::serviceResume');

    var thisPlugin = this.getMusicPlugin(sService);
    var state = this.stateMachine.getState();

    if (state === 'stop') {
      if (thisPlugin != undefined && typeof thisPlugin.clearAddPlayTracks === 'function') {
        thisPlugin.clearAddPlayTracks();
      }
    }
    if (thisPlugin != undefined && typeof thisPlugin.resume === 'function') {
      return thisPlugin.resume();
    }
  }

  servicePushState(state, sService) {
    this.pushConsoleMessage('CoreCommandRouter::servicePushState');
    return this.stateMachine.syncState(state, sService);
  }

  getMusicPlugin(sService) {
    // Check first if its a music service
    var thisPlugin = this.pluginManager.getPlugin('music_service', sService);
    if (!thisPlugin) {
      // check if its a audio interface
      thisPlugin = this.pluginManager.getPlugin('audio_interface', sService);
    }

    return thisPlugin;
  }

  getAllTracklists() {
    this.pushConsoleMessage('CoreCommandRouter::getAllTracklists');

    // This is the synchronous way to get libraries, which waits for each controller to return its tracklist before continuing
    var self = this;
    return libQ.all(
      libFast.map(this.pluginManager.getPluginNames('music_service'), function (sService) {
        var thisService = self.pluginManager.getPlugin('music_service', sService);
        return thisService.getTracklist();
      })
    );
  }

  addQueueItems(arrayItems) {
    this.pushConsoleMessage('CoreCommandRouter::volumioAddQueueItems');

    return this.stateMachine.addQueueItems(arrayItems);
  }

  preLoadItems(items) {
    try {
      this.stateMachine.preLoadItems(items);
    } catch (error) {
      this.logger.error("Preload failed: " + error);
    }
  }

  preLoadItemsStop() {
      this.stateMachine.preLoadItemsStop();
  }

  addPlay(data) {
      var self = this;

      self.addQueueItems(data)
          .then(function (e) {
              return self.volumioPlay(e.firstItemIndex);
          });
  }

  playItemsList(data) {
    var self = this;

    if (process.env.PLAYBACK_MODE === 'single' && data.item) {
      return self.addPlay(data.item);
    } else {
      return self.replaceAndPlay(data);
    }
  }

  replaceAndPlay(data) {
    var self = this;
    var defer = libQ.defer();

    this.pushConsoleMessage('CoreCommandRouter::volumioReplaceandPlayItems');

    this.stateMachine.clearQueue(false);

    if (data.uri != undefined) {
          if (data.uri.indexOf('playlists/') >= 0 && data.uri.indexOf('://') == -1) {
        this.playPlaylist(data.title);
        defer.resolve();
      } else {
        this.stateMachine.addQueueItems(data)
          .then((e) => {
            this.volumioPlay(e.firstItemIndex);
                  defer.resolve();
              });
      }
    } else if (data.list && data.index !== undefined) {
      this.stateMachine.addQueueItems(data.list)
        .then(() => {
          this.volumioPlay(data.index);
                  defer.resolve();
        });
    } else if (data.item != undefined && data.item.uri != undefined) {
      this.stateMachine.addQueueItems(data.item)
        .then((e) => {
          this.volumioPlay(e.firstItemIndex);
                  defer.resolve();
        });
    } else {
          self.logger.error('Could not Replace and Play Item');
      defer.reject('Could not Replace and Play Item');
    }

    return defer.promise;
  }

  replaceAndPlayCue(arrayItems) {
    this.pushConsoleMessage('CoreCommandRouter::volumioReplaceandPlayCue');
    this.stateMachine.clearQueue(false);

    if (arrayItems.uri != undefined && arrayItems.uri.indexOf('playlists/') >= 0) {
      return this.playPlaylist(arrayItems.title);
    } else {
      return this.stateMachine.addQueueItems(arrayItems);
    }
  }

  checkFavourites(data) {
    var self = this;
    // self.pushConsoleMessage('CoreCommandRouter::volumioAddQueueItems');

    return self.stateMachine.checkFavourites(data);
  }

  emitFavourites(msg) {
    var plugin = this.pluginManager.getPlugin('user_interface', 'websocket');
    plugin.emitFavourites(msg);
  }

  playPlaylist(data) {
    var self = this;
    return self.playListManager.playPlaylist(data);
  }

  getId() {
    var self = this;

    var file = fs.readJsonSync('data/configuration/system_controller/system/config.json');

    var name = file.playerName.value;
    var uuid = file.uuid.value;
    var date = new Date();
    var time = date.getDate() + '/' + date.getMonth() + '/' + date.getFullYear() + ' - ' +
              date.getHours() + ':' + date.getMinutes();

    return {'name': name, 'uuid': uuid, 'time': time};
  }

  getPlugConf(category, plugin) {
    var cName = category;
    var name = plugin;
    try {
      var config = fs.readJsonSync(('/data/configuration/' + cName + '/' +
              name + '/' + 'config.json'), 'utf-8',
      {throws: false});
    } catch (e) {
      var config = '';
    }
    return config;
  }

  catPluginsConf(category, array) {
    var self = this;
    var plugins = array;
    var plugConf = [];
    for (var j = 0; j < plugins.length; j++) {
      var name = plugins[j].name;
      var status = plugins[j].enabled;
      var config = self.getPlugConf(category, name);
      plugConf.push({name, status, config});
    }
    return plugConf;
  }

  getPluginsConf() {
    var self = this;
    var paths = self.pluginManager.getPluginsMatrix();
    var confs = [];
    for (var i = 0; i < paths.length; i++) {
      var cName = paths[i].cName;
      var plugins = paths[i].catPlugin;
      var plugConf = self.catPluginsConf(cName, plugins);
      confs.push({cName, plugConf});
    }

    var identification = self.getId();
    return confs;
  }

  writePluginsConf() {
    var self = this;
    var confs = self.getPluginsConf();

    var file = '/data/configuration/generalConfig';
    fs.outputJson(file, confs, function (err) {
      console.log(err);
    });
  }

  restorePluginsConf(request) {
    var self = this;

    var defer = libQ.defer();
    var backup = request;
    var current = self.pluginManager.getPluginsMatrix();
    var usefulConfs = [];

    for (var i = 0; i < current.length; i++) {
      var j = 0;
      while (j < backup.length && current[i].cName != backup[j].cName) {
        j++;
      }
      if (j < backup.length) {
        var availPlugins = current[i].catPlugin;
        var backPlugins = backup[j];
        usefulConfs.push(self.usefulBackupConfs(availPlugins, backPlugins));
      }
    }

    defer.resolve(usefulConfs);
    self.writeConfs(usefulConfs);
    return defer.promise;
  }

  usefulBackupConfs(currArray, backArray) {
    var self = this;
    var availPlugins = currArray;
    var catName = backArray.cName;
    var backPlugins = backArray.plugConf;
    var backNum = backPlugins.length;
    var i = 0;

    var existingPlug = [];
    while (i < availPlugins.length && backNum > 0) {
      var j = 0;
      while (j < backPlugins.length && availPlugins[i].name != backPlugins[j].name) {
        j++;
      }
      if (j < backPlugins.length) {
        existingPlug.push(backPlugins[j]);
        backNum--;
        backPlugins.splice(j, 1);
      }
      i++;
    }
    if (backNum > 0) {
      self.installBackupPlugins(catName, backPlugins);
    }
    return {'cName': catName, 'plugConf': existingPlug};
  }

  writeConfs(data) {
    var self = this;

    var usefulConfs = data;
    for (var i = 0; i < usefulConfs.length; i++) {
      for (var j = 0; j < usefulConfs[i].plugConf.length; j++) {
        if (usefulConfs[i].plugConf[j].config != '') {
          var path = '/data/configuration/' + usefulConfs[i].cName + '/' +
                      usefulConfs[i].plugConf[j].name + '/config.json';
          fs.outputJsonSync(path, usefulConfs[i].plugConf[j].config);
        }
      }
    }
  }

  min(a, b) {
    var self = this;

    if (a < b) { return a; } else { return b; }
  }

  installBackupPlugins(name, array) {
    var self = this;

    var availablePlugins = self.pluginManager.getAvailablePlugins();
    var cat = [];
    availablePlugins.then(function (available) {
      cat = available.categories;
      var plug = [];

      for (var i = 0; i < cat.length; i++) {
        if (cat[i].name == name) {
          plug = cat[i].plugins;
        }
      }

      if (plug.length > 0) {
        for (var j = 0; j < array.length; j++) {
          var k = 0;
          while (k < plug.length && array[j].name != plug[k].name) {
            k++;
          }
          if (k < plug.length) {
            self.logger.info('Backup: installing plugin: ' + plug[k].name);
            self.pluginManager.installPlugin(plug[k].url);
          }
        }
        self.writeConfs([{'cName': name, 'plugConf': array}]);
      }
    });
  }

  loadBackup(request) {
    var self = this;

    var defer = libQ.defer();

    var data = [];

    self.logger.info('Backup: retrieving ' + request.type + ' backup');

    if (request.type == 'playlist') {
      var identification = self.getId();
      data = {'id': identification, 'backup': self.loadPlaylistsBackup()};
      defer.resolve(data);
    } else if (request.type == 'radio-favourites' || request.type == 'favourites' ||
      request.type == 'my-web-radio') {
      var identification = self.getId();
      data = {'id': identification, 'backup': self.loadFavBackup(request.type)};
      defer.resolve(data);
    } else {
      self.logger.info('Backup: request not accepted, unexisting category');
      defer.resolve(undefined);
    }

    return defer.promise;
  }

  loadPlaylistsBackup() {
    var self = this;

    // data=[{"name": "", "content": []}]
    var data = [];
    var playlists = self.playListManager.retrievePlaylists();

    for (var i = 0; i < playlists.length; i++) {
      var name = playlists[i];
      var path = self.playListManager.playlistFolder + name;
      var songs = fs.readJsonSync(path, {throws: false});
      data.push({'name': name, 'content': songs});
    }

    return data;
  }

  loadFavBackup(type) {
    var self = this;

    var path = self.playListManager.favouritesPlaylistFolder;
    var data = [];

    try {
      data = fs.readJsonSync(path + type, {throws: false});
    } catch (e) {
      self.logger.info('No ' + type + ' in favourites folder');
    }

    return data;
  }

  writePlaylistsBackup() {
    var self = this;

    var data = self.loadPlaylistsBackup();

    var file = '/data/configuration/playlists';
    fs.outputJsonSync(file, data);
  }

  writeFavouritesBackup() {
    var self = this;

    var data = self.loadFavBackup('favourites');
    var radio = self.loadFavBackup('radio-favourites');
    var myRadio = self.loadFavBackup('my-web-radio');

    var favourites = {'songs': data, 'radios': radio, 'myRadios': myRadio};

    var file = '/data/configuration/favourites';
    fs.outputJsonSync(file, favourites);
  }

  restorePlaylistBackup() {
    var self = this;
    var check = self.checkBackup('playlists');
    var path = self.playListManager.playlistFolder;
    var isbackup = check[0];

    if (isbackup) {
      self.restorePlaylist({'type': 'playlist', 'backup': check[1]});
    }
  }

  restoreFavouritesBackup(type) {
    var self = this;

    var backup = self.checkBackup('favourites');
    var isbackup = backup[0];
    var path = self.playListManager.favouritesPlaylistFolder;

    if (isbackup) {
      var kind = self.checkFavouritesType(type, backup[1]);
      var file = kind[0];
      var data = kind[1];
      self.restorePlaylist({'type': type, 'path': file, 'backup': data});
    }
  }

  restorePlaylist(req) {
    var self = this;
    var path = '';
    var backup = req.backup;

    if (req.type == 'playlist') {
      path = self.playListManager.playlistFolder;
      self.logger.info('Backup: restoring playlists');
      for (var i = 0; i < backup.length; i++) {
        var name = backup[i].name;
        var songs = backup[i].content;
        fs.outputJsonSync(path + name, songs);
      }
    } else if (req.type == 'favourites' || req.type == 'radio-favourites' ||
          req.type == 'my-web-radio') {
      path = self.playListManager.favouritesPlaylistFolder + req.type;
      try {
        var fav = fs.readJsonSync(path);
        backup = self.mergePlaylists(backup, fav);
      } catch (e) {
        self.logger.info('Backup: no existing playlist for selected category');
      }
      self.logger.info('Backup: restoring ' + req.type + '!');
      fs.outputJsonSync(path, backup);
    } else { self.logger.info('Backup: impossible to restore data'); }
  }

  getPath(type) {
    if (type == 'songs') { return 'favourites'; } else if (type == 'radios') { return 'radio-favourites'; } else if (type == 'myRadios') { return 'my-web-radio'; }
    return '';
  }

  checkBackup(backup) {
    var self = this;
    var isbackup = false;
    var file = [];
    var path = '/data/configuration/' + backup;

    try {
      file = fs.readJsonSync(path);
      isbackup = true;
    } catch (e) {
      self.logger.info('Backup: no ' + backup + ' backup available');
    }

    return [isbackup, file];
  }

  checkFavouritesType(type, backup) {
    var self = this;
    var data = [];
    var file = '';

    if (type == 'songs') {
      data = backup.songs;
      file = 'favourites';
    } else if (type == 'radios') {
      data = backup.radios;
      file = 'radio-favourites';
    } else if (type == 'myRadios') {
      data = backup.myRadios;
      file = 'my-web-radio';
    } else { self.logger.info('Error: category non existent'); }

    return [file, data];
  }

  mergePlaylists(recent, old) {
    var self = this;
    var backup = recent;
    var current = old;

    for (var i = 0; i < current.length; i++) {
      var isthere = false;
      for (var j = 0; j < backup.length; j++) {
        if (current[i].uri == backup[j].uri) {
          isthere = true;
        }
      }
      if (!isthere) {
        backup.push(current[i]);
      }
    }

    return backup;
  }

  managePlaylists(value) {
    var self = this;

    var defer = libQ.defer();

    if (value == 0) {
      setTimeout(function () {
        self.writePlaylistsBackup();
        defer.resolve();
      }, 10000);
    } else {
      setTimeout(function () {
        self.restorePlaylistBackup();
        defer.resolve();
      }, 10000);
    }

    return defer.promise;
  }

  manageFavourites(value) {
    var self = this;

    var defer = libQ.defer();

    if (value == 0) {
      setTimeout(function () {
        self.writeFavouritesBackup();
        defer.resolve();
      }, 10000);
    } else {
      setTimeout(function () {
        self.restoreFavouritesBackup('songs');
      }, 10000);
      setTimeout(function () {
        self.restoreFavouritesBackup('radios');
      }, 10000);
      setTimeout(function () {
        self.restoreFavouritesBackup('myRadios');
        defer.resolve();
      }, 10000);
    }

    return defer.promise;
  }

  executeOnPlugin(type, name, method, data) {
    this.pushConsoleMessage('CoreCommandRouter::executeOnPlugin: ' + name + ' , ' + method);

    var thisPlugin = this.pluginManager.getPlugin(type, name);

    if (thisPlugin != undefined) {
      if (thisPlugin[method]) {
        return thisPlugin[method](data);
      } else {
        this.pushConsoleMessage('Error : CoreCommandRouter::executeOnPlugin: No method [' + method + '] in plugin ' + name);
      }
    } else return undefined;
  }

  getUIConfigOnPlugin(type, name, data) {
    var self = this;
    this.pushConsoleMessage('CoreCommandRouter::getUIConfigOnPlugin');
    var noConf = {'page': {'label': self.getI18nString('PLUGINS.NO_CONFIGURATION_AVAILABLE')}, 'sections': []};

    var defer = libQ.defer();

    var thisPlugin = this.pluginManager.getPlugin(type, name);

    try {
      thisPlugin.getUIConfig(data)
        .then(function (uiconf) {
          var filePath = __dirname + '/plugins/' + type + '/' + name + '/override.json';

          self.overrideUIConfig(uiconf, filePath)
            .then(function () {
              defer.resolve(uiconf);
            })
            .fail(function () {
              defer.reject(new Error());
            });
        })
        .fail(function () {
          defer.reject(new Error('Error retrieving UIConfig from plugin ' + name));
        });
    } catch (e) {
      defer.resolve(noConf);
    }

    return defer.promise;
  }

  writePlayerControls(config) {
    var self = this;
    var pCtrlFile = '/data/playerstate/playback-controls.json';

    this.pushConsoleMessage('CoreCommandRouter::writePlayerControls');

    var state = self.stateMachine.getState();

    var data = Object.assign({
      random: state.random,
      repeat: state.repeat
    }, config);

    fs.writeFile(pCtrlFile, JSON.stringify(data, null, 4), function (err) {
      if (err) self.pushConsoleMessage('Failed setting player state in CoreCommandRouter::initPlayerState');
    });
  }

  initPlayerControls() {
    var pCtrlFile = '/data/playerstate/playback-controls.json';
    var self = this;

    this.pushConsoleMessage('CoreCommandRouter::initPlayerControls');

    function handleError() {
      self.pushConsoleMessage('Failed setting player state in CoreCommandRouter::initPlayerControls');
    }

    fs.ensureFile(pCtrlFile, function (err) {
      if (err) handleError();

      fs.readFile(pCtrlFile, function (err, data) {
        if (err) handleError();

        try {
          var config = JSON.parse(data.toString());
          self.stateMachine.setRepeat(config.repeat);
          self.stateMachine.setRandom(config.random);
        } catch (e) {
          var state = self.stateMachine.getState();
          var config = {
            random: state.random,
            repeat: state.repeat
          };

          fs.writeFile(pCtrlFile, JSON.stringify(config, null, 4), function (err) {
            if (err) handleError();
          });
        }
      });
    });
  }

  pushDebugConsoleMessage(sMessage) {
    this.logger.debug(sMessage);
  }

  pushErrorConsoleMessage(sMessage) {
    this.logger.error(sMessage);
  }

  pushConsoleMessage(sMessage) {
    // Uncomment for more logging
    this.logger.info(sMessage);
  }

  pushToastMessage(type, title, message) {
    var self = this;
    return libQ.all(
      libFast.map(this.pluginManager.getPluginNames('user_interface'), function (sInterface) {
        var thisInterface = self.pluginManager.getPlugin('user_interface', sInterface);
        if (typeof thisInterface.printToastMessage === 'function') { return thisInterface.printToastMessage(type, title, message); }
      })
    );
  }

  broadcastToastMessage(type, title, message) {
    var self = this;
    return libQ.all(
      libFast.map(this.pluginManager.getPluginNames('user_interface'), function (sInterface) {
        var thisInterface = self.pluginManager.getPlugin('user_interface', sInterface);
        if (typeof thisInterface.broadcastToastMessage === 'function') { return thisInterface.broadcastToastMessage(type, title, message); }
      })
    );
  }

  broadcastMessage(msg, value) {
    var self = this;
    this.pushConsoleMessage('CoreCommandRouter::BroadCastMessage ' + msg);

    return libQ.all(

      libFast.map(this.pluginManager.getPluginNames('user_interface'), function (sInterface) {
        var emit = {msg: msg, value: value};
        var thisInterface = self.pluginManager.getPlugin('user_interface', sInterface);
        if (typeof thisInterface.broadcastMessage === 'function') { return thisInterface.broadcastMessage(emit); }
      })
    );
  }

  pushMultiroomDevices(data) {
    var self = this;

    var audioOutputPlugin = this.pluginManager.getPlugin('audio_interface', 'multiroom');
    if (audioOutputPlugin != undefined && typeof audioOutputPlugin.pushOutputsState === 'function') {
      audioOutputPlugin.pushOutputsState(data);
    }
    return libQ.all(
      libFast.map(this.pluginManager.getPluginNames('user_interface'), function (sInterface) {
        var thisInterface = self.pluginManager.getPlugin('user_interface', sInterface);
        if (typeof thisInterface.pushMultiroomDevices === 'function') { return thisInterface.pushMultiroomDevices(data); }
      })
    );
  }

  updateMultiroomSyncOutput(data) {
    // Send this to all plugins that require this information
    var self = this;
    var audioOutputPlugin = this.pluginManager.getPlugin('audio_interface', 'multiroom');
    if (audioOutputPlugin != undefined && typeof audioOutputPlugin.updateMultiroomSyncOutput === 'function') {
      audioOutputPlugin.updateMultiroomSyncOutput(data);
    }
  }

  getMultiroomSyncOutput(data) {
    // Send this to all plugins that require this information
    var self = this;
    var audioOutputPlugin = this.pluginManager.getPlugin('audio_interface', 'multiroom');
    if (audioOutputPlugin != undefined && typeof audioOutputPlugin.getMultiroomSyncOutput === 'function') {
      audioOutputPlugin.getMultiroomSyncOutput(data);
    }
  }

  enableMultiroomSyncOutput(data) {
    // Send this to all plugins that require this information
    var self = this;
    var audioOutputPlugin = this.pluginManager.getPlugin('audio_interface', 'multiroom');
    if (audioOutputPlugin != undefined && typeof audioOutputPlugin.enableMultiroomSyncOutput === 'function') {
      audioOutputPlugin.enableMultiroomSyncOutput(data);
    }
  }

  disableMultiroomSyncOutput(data) {
    // Send this to all plugins that require this information
    var self = this;
    var audioOutputPlugin = this.pluginManager.getPlugin('audio_interface', 'multiroom');
    if (audioOutputPlugin != undefined && typeof audioOutputPlugin.disableMultiroomSyncOutput === 'function') {
      audioOutputPlugin.disableMultiroomSyncOutput(data);
    }
  }

  pushMultiroom(data) {
    var self = this;
    return libQ.all(
      libFast.map(this.pluginManager.getPluginNames('user_interface'), function (sInterface) {
        var thisInterface = self.pluginManager.getPlugin('user_interface', sInterface);
        if (typeof thisInterface.pushMultiroom === 'function') { return thisInterface.pushMultiroom(data); }
      })

    );
  }

  pushAirplay(data) {
    var self = this;
    return libQ.all(
      libFast.map(this.pluginManager.getPluginNames('user_interface'), function (sInterface) {
        var thisInterface = self.pluginManager.getPlugin('user_interface', sInterface);
        if (typeof thisInterface.pushAirplay === 'function') { return thisInterface.pushAirplay(data); }
      })
    );
  }

  shutdown() {
    var self = this;

    if (self.standByHandler && self.standByHandler.category && self.standByHandler.name && self.standByHandler.method) {
      self.logger.info('Executing Standby mode with handler plugin ' + self.standByHandler.name);
      self.executeOnPlugin(self.standByHandler.category, self.standByHandler.name, self.standByHandler.method, '');
    } else {
      self.pluginManager.onVolumioShutdown().then(function () {
        self.platformspecific.shutdown();
      }).fail(function (e) {
        self.logger.info('Error in onVolumioShutdown Plugin Promise handling: ' + e);
        self.platformspecific.shutdown();
      });
    }
  }

  reboot() {
    var self = this;

    self.pluginManager.onVolumioReboot().then(function () {
           self.platformspecific.reboot();
    }).fail(function (e) {
      self.logger.info('Error in onVolumioReboot Plugin Promise handling: ' + e);
      self.platformspecific.reboot();
    });
  }

  networkRestart() {
    this.platformspecific.networkRestart();
    this.executeOnPlugin('system_controller', 'volumiodiscovery', 'onNetworkingRestart', '');
  }

  wirelessRestart() {
    this.platformspecific.wirelessRestart();
    this.executeOnPlugin('system_controller', 'volumiodiscovery', 'onNetworkingRestart', '');
  }

  startupSound() {
    this.platformspecific.startupSound();
  }

  fileUpdate(data) {
    this.platformspecific.fileUpdate(data);
  }

  explodeUriFromService(service, uri) {
    var promise = libQ.defer();
    this.logger.info('Exploding uri ' + uri + ' in service ' + service);

    var thisPlugin = this.pluginManager.getPlugin('music_service', service);
    if (thisPlugin != undefined && thisPlugin.explodeUri != undefined) {
      thisPlugin.explodeUri(uri).then((explodedUri)=>{
        promise.resolve(explodedUri);
      }).fail((error)=>{
        // If explodeUri Fails we resolve an empty promise, in order not to lock the playback progression
        this.logger.error('Commandrouter: Cannot explode uri ' + uri + ' from service ' + service + ': ' + error);
        promise.resolve();
      });
    } else {
      promise.resolve({
        uri: uri,
        service: service
      });
    }
    return promise.promise;
  }

  volumioPlay(N) {
    this.pushConsoleMessage('CoreCommandRouter::volumioPlay');

    this.stateMachine.unSetVolatile();

    if (N === undefined) { return this.stateMachine.play(); } else {
      return this.stateMachine.play(N);
    }
  }

  volumioVolatilePlay() {
    this.pushConsoleMessage('CoreCommandRouter::volumioVolatilePlay');

    return this.stateMachine.volatilePlay();
  }

  volumioToggle() {
    this.pushConsoleMessage('CoreCommandRouter::volumioToggle');

    var state = this.stateMachine.getState();

    if (state.status != undefined) {
      if (state.status === 'stop' || state.status === 'pause') {
        if (state.volatile === true) {
          return this.volumioVolatilePlay();
        } else {
          return this.stateMachine.play();
        }
      } else {
        if (state.trackType == 'webradio') {
          return this.stateMachine.stop();
        } else {
          return this.stateMachine.pause();
        }
      }
    }
  }

  volumioSeek(position) {
    this.pushConsoleMessage('CoreCommandRouter::volumioSeek');
    return this.stateMachine.seek(position);
  }

  installPlugin(uri) {
    var self = this;
    var defer = libQ.defer();

    this.pluginManager.installPlugin(uri).then(function () {
      defer.resolve();
    }).fail(function (e) {
      self.logger.info('Error: ' + e);
      defer.reject(new Error('Cannot install plugin. Error: ' + e));
    });

    return defer.promise;
  }

  updatePlugin(data) {
    var self = this;
    var defer = libQ.defer();

    this.pluginManager.updatePlugin(data).then(function () {
      defer.resolve();
    }).fail(function (e) {
      self.logger.info('Error: ' + e);
      self.logger.info('Error: ' + e);
      defer.reject(new Error('Cannot Update plugin. Error: ' + e));
    });

    return defer.promise;
  }

  unInstallPlugin(data) {
    var self = this;
    var defer = libQ.defer();

    self.logger.info('Starting Uninstall of plugin ' + data.category + ' - ' + data.name);

    this.pluginManager.unInstallPlugin(data.category, data.name).then(function () {
      defer.resolve();
    }).fail(function () {
      defer.reject(new Error('Cannot uninstall plugin'));
    });

    return defer.promise;
  }

  enablePlugin(data) {
    var defer = libQ.defer();

    this.pluginManager.enablePlugin(data.category, data.plugin).then(function () {
      defer.resolve();
    }).fail(function () {
      defer.reject(new Error('Cannot enable plugin'));
    });

    return defer.promise;
  }

  disablePlugin(data) {
    var defer = libQ.defer();

    this.pluginManager.disablePlugin(data.category, data.plugin).then(function () {
      defer.resolve();
    }).fail(function () {
      defer.reject(new Error('Cannot disable plugin'));
    });

    return defer.promise;
  }

  modifyPluginStatus(data) {
    var defer = libQ.defer();

    this.pluginManager.modifyPluginStatus(data.category, data.plugin, data.status).then(function () {
      defer.resolve();
    }).fail(function () {
      defer.reject(new Error('Cannot update plugin status'));
    });

    return defer.promise;
  }

  broadcastMessage(emit, payload) {
    var self = this;
    return libQ.all(
      libFast.map(this.pluginManager.getPluginNames('user_interface'), function (sInterface) {
        var thisInterface = self.pluginManager.getPlugin('user_interface', sInterface);
        if (typeof thisInterface.broadcastMessage === 'function') { return thisInterface.broadcastMessage(emit, payload); }
      })
    );
  }

  getInstalledPlugins() {
    return this.pluginManager.getInstalledPlugins();
  }

  getAvailablePlugins() {
    return this.pluginManager.getAvailablePlugins();
  }

  getPluginDetails(data) {
    return this.pluginManager.getPluginDetails(data);
  }

  enableAndStartPlugin(category, name) {
    return this.pluginManager.enableAndStartPlugin(category, name);
  }

  disableAndStopPlugin(category, name) {
    return this.pluginManager.disableAndStopPlugin(category, name);
  }

  volumioRandom(data) {
    this.pushConsoleMessage('CoreCommandRouter::volumioRandom');

    this.writePlayerControls({
      random: data
    });

    return this.stateMachine.setRandom(data);
  }

  randomToggle() {
    var self = this;

    var state = self.stateMachine.getState();

    if (state.random) {
      var random = false;
    } else {
      var random = true;
    }

    this.writePlayerControls({
      random: random
    });

    return self.stateMachine.setRandom(random);
  }

  volumioRepeat(repeat, repeatSingle) {
    this.pushConsoleMessage('CoreCommandRouter::volumioRandom');

    this.writePlayerControls({
      repeat: repeat
    });

    return this.stateMachine.setRepeat(repeat, repeatSingle);
  }

  repeatToggle() {
    var self = this;

    var state = self.stateMachine.getState();

    if (state.repeat) {
      var repeat = false;
    } else {
      var repeat = true;
    }

    this.writePlayerControls({
      repeat: repeat
    });

    return self.stateMachine.setRepeat(repeat, false);
  }

  volumioConsume(data) {
    this.pushConsoleMessage('CoreCommandRouter::volumioConsume');
    return this.stateMachine.setConsume(data);
  }

  volumioFFWDRew(millisecs) {
    this.pushConsoleMessage('CoreCommandRouter::volumioFFWDRew ' + millisecs);

    return this.stateMachine.ffwdRew(millisecs);
  }

  volumioSkipBackwards(data) {
    this.pushConsoleMessage('CoreCommandRouter::volumioSkipBackwards');

    return this.stateMachine.skipBackwards(data);
  }

  volumioSkipForward(data) {
    this.pushConsoleMessage('CoreCommandRouter::volumioSkipForward');

    return this.stateMachine.skipForward(data);
  }

  volumioSaveQueueToPlaylist(name) {
    var self = this;
    this.pushConsoleMessage('CoreCommandRouter::volumioSaveQueueToPlaylist');

    var queueArray = this.stateMachine.getQueue();
    var defer = this.playListManager.commonAddItemsToPlaylist(this.playListManager.playlistFolder, name, queueArray);

    defer.then(function () {
      self.pushToastMessage('success', self.getI18nString('COMMON.SAVE_QUEUE_SUCCESS') + name);
    })
      .fail(function () {
        self.pushToastMessage('success', self.getI18nString('COMMON.SAVE_QUEUE_ERROR') + name);
      });

    return defer;
  }

  volumioMoveQueue(from, to) {
    var defer = libQ.defer();
    this.pushConsoleMessage('CoreCommandRouter::volumioMoveQueue');
    if (from !== undefined && to !== undefined && from >= 0 && to >= 0) {
      return this.stateMachine.moveQueueItem(from, to);
    } else {
      this.logger.error('Cannot move item in queue, from or to parameter missing');
      var queueArray = this.stateMachine.getQueue();
      defer.resolve(queueArray);
      return defer.promise;
    }
  }

  getI18nString(key) {
    var splitted = key.split('.');

    if (this.i18nStrings) {
      if (splitted.length == 1) {
        if (this.i18nStrings[key] !== undefined && this.i18nStrings[key] !== '') { return this.i18nStrings[key]; } else return this.i18nStringsDefaults[key];
      } else {
        if (this.i18nStrings[splitted[0]] !== undefined &&
                  this.i18nStrings[splitted[0]][splitted[1]] !== undefined && this.i18nStrings[splitted[0]][splitted[1]] !== '') { return this.i18nStrings[splitted[0]][splitted[1]]; } else return this.i18nStringsDefaults[splitted[0]][splitted[1]];
      }
    } else {
          var emptyString = '';
          return emptyString;
    }
  }

  loadI18nStrings() {
    var self = this;
    var language_code = this.sharedVars.get('language_code');

    this.i18nStringsDefaults = fs.readJsonSync(__dirname + '/i18n/strings_en.json');

    try {
      this.logger.info('Loading i18n strings for locale ' + language_code);
          this.i18nStrings = fs.readJsonSync(__dirname + '/i18n/strings_' + language_code + '.json');
    } catch (e) {
      this.logger.error('Failed to load i18n strings for locale ' + language_code + ': ' + e);
      this.i18nStrings = this.i18nStringsDefaults;
    }

    var categories = this.pluginManager.getPluginCategories();
    for (var i in categories) {
      var category = categories[i];
      var names = this.pluginManager.getPluginNames(category);
      for (var j in names) {
        var name = names[j];
        var instance = this.pluginManager.getPlugin(category, name);

        if (instance && instance.getI18nFile) {
          var pluginI18NFile = instance.getI18nFile(language_code);
          if (pluginI18NFile && fs.pathExistsSync(pluginI18NFile)) {
            var pluginI18nStrings = fs.readJsonSync(pluginI18NFile);

            for (var locale in pluginI18nStrings) {
              // check if locale does not already exist to avoid that volumio
              // strings get overwritten
              if (!this.i18nStrings[locale]) {
                this.i18nStrings[locale] = pluginI18nStrings[locale];
              } else {
                this.logger.info('Plugin ' + name + ' has duplicated i18n key ' + locale + '. It is ignored.');
              }
            }
          }
        }
      }
    }
  }

  i18nJson(dictionaryFile, defaultDictionaryFile, jsonFile) {
    var self = this;
    var methodDefer = libQ.defer();
    var defers = [];

    try {
      fs.readJsonSync(dictionaryFile);
    } catch (e) {
      dictionaryFile = defaultDictionaryFile;
    }

    defers.push(libQ.nfcall(fs.readJson, dictionaryFile));
    defers.push(libQ.nfcall(fs.readJson, defaultDictionaryFile));
    defers.push(libQ.nfcall(fs.readJson, jsonFile));

    libQ.all(defers)
      .then(function (documents) {
        var dictionary = documents[0];
        var defaultDictionary = documents[1];
        var jsonFile = documents[2];

        self.translateKeys(jsonFile, dictionary, defaultDictionary);

        methodDefer.resolve(jsonFile);
      })
      .fail(function (err) {
        self.logger.info('ERROR LOADING JSON ' + err);

        methodDefer.reject(new Error());
      });

    return methodDefer.promise;
  }

  translateKeys(parent, dictionary, defaultDictionary) {
    var self = this;

    try {
      var keys = Object.keys(parent);

      for (var i in keys) {
        var obj = parent[keys[i]];
        var type = typeof (obj);

        if (type === 'object') {
          self.translateKeys(obj, dictionary, defaultDictionary);
        } else if (type === 'string') {
          if (obj.startsWith('TRANSLATE.')) {
            var replaceKey = obj.slice(10);

            var dotIndex = replaceKey.indexOf('.');

            if (dotIndex == -1) {
              var value = dictionary[replaceKey];
              if (value === undefined) {
                value = defaultDictionary[replaceKey];
              }
              parent[keys[i]] = value;
            } else {
              var category = replaceKey.slice(0, dotIndex);
              var key = replaceKey.slice(dotIndex + 1);

              if (dictionary[category] === undefined || dictionary[category][key] === undefined) {
                var value = defaultDictionary[category][key];
              } else {
                var value = dictionary[category][key];
                if (value === '') {
                  value = defaultDictionary[category][key];
                }
              }
              parent[keys[i]] = value;
            }
          }
        }
      }
    } catch (e) {
          self.logger.error('Cannot translate keys: ' + e);
    }
  }

  overrideUIConfig(uiconfig, overrideFile) {
    var self = this;
    var methodDefer = libQ.defer();

    fs.readJson(overrideFile, function (err, override) {
      if (err) {
        methodDefer.resolve();
      } else {
        for (var i in override) {
          var attr = override[i];

          var attribute_name = attr.attribute_name;
          var attribute_value = attr.value;
          var id = attr.id;

          self.overrideField(uiconfig, id, attribute_name, attribute_value);
        }

        methodDefer.resolve();
      }
    });

    return methodDefer.promise;
  }

  overrideField(parent, id, attribute_name, attribute_value) {
    var self = this;

    if (typeof (parent) === 'object') {
      if (parent.id === id) {
        parent[attribute_name] = attribute_value;
      } else {
        var keys = Object.keys(parent);

        for (var i in keys) {
          var obj = parent[keys[i]];

          self.overrideField(obj, id, attribute_name, attribute_value);
        }
      }
    }
  }

  updateBrowseSourcesLang() {
    var self = this;

    return this.musicLibrary.updateBrowseSourcesLang();
  }

  checkAndPerformSystemUpdates() {
    // var defer=libQ.defer();
    var self = this;

    var updateFolder = '/volumio/update';
    try {
      var files = fs.readdirSync(updateFolder);
    } catch (e) {
      // Nothing to do
    }

    if (files !== undefined && files.length > 0) {
      self.logger.info('Updating system');

      try {
        for (var i in files) {
          var file = files[i];

          if (file.endsWith('.sh')) {
            var output = execSync('sh ' + updateFolder + '/' + file, { encoding: 'utf8' });
          }
        }

        for (var i in files) {
          var file = files[i];

          fs.unlinkSync(updateFolder + '/' + file);
        }
      } catch (err) {
        self.logger.error('An error occurred when updating Volumio. Details: ' + err);

        // TODO: decide what to do in case of errors when updating
      }
    }
  }

  safeRemoveDrive(data) {
    var self = this;
    var defer = libQ.defer();

    exec('/usr/bin/sudo /bin/umount /mnt/USB/' + data, function (error, stdout, stderr) {
      if (error !== null) {
        self.pushConsoleMessage(error);
        self.pushToastMessage('error', data,
          self.getI18nString('SYSTEM.CANNOT_REMOVE_MEDIA') + ': ' + error);
      } else {
        self.pushToastMessage('success', self.getI18nString('SYSTEM.MEDIA_REMOVED_SUCCESSFULLY'),
          self.getI18nString('SYSTEM.MEDIA_REMOVED_SUCCESSFULLY'));
        self.executeOnPlugin('music_service', 'mpd', 'updateMpdDB', '/USB/');
        execSync('/usr/bin/mpc update', { uid: 1000, gid: 1000, encoding: 'utf8' });
        exec('/usr/bin/mpc idle update', {uid: 1000, gid: 1000, timeout: 10000}, function (error, stdout, stderr) {
          if (error !== null) {
          } else {
            var response = self.musicLibrary.executeBrowseSource('music-library/USB');
            if (response != undefined) {
              response.then(function (result) {
                defer.resolve(result);
              })
                .fail(function () {
                  defer.reject();
                });
            }
          }
        });
      }
    });
    return defer.promise;
  }

  closeModals() {
    var self = this;
    this.pushConsoleMessage('CoreCommandRouter::Close All Modals sent');

    return self.broadcastMessage('closeAllModals', '');
  }

  getMyVolumioToken() {
    var self = this;
    var defer = libQ.defer();

    var response = self.executeOnPlugin('system_controller', 'my_volumio', 'getMyVolumioToken', '');

    if (response != undefined) {
      response.then(function (result) {
        defer.resolve(result);
      })
        .fail(function () {
          var jsonobject = {'tokenAvailable': false};
          defer.resolve(jsonobject);
        });
    }

    return defer.promise;
  }

  setMyVolumioToken(data) {
    var self = this;
    var defer = libQ.defer();

    var response = self.executeOnPlugin('system_controller', 'my_volumio', 'setMyVolumioToken', data);

    if (response != undefined) {
      response.then(function (result) {
        defer.resolve(result);
      })
        .fail(function () {
          defer.resolve('');
        });
    }

    return defer.promise;
  }

  getMyVolumioStatus() {
    var self = this;
    var defer = libQ.defer();
    var notLoggedInResponseObject = {'loggedIn': false};

    var response = self.executeOnPlugin('system_controller', 'my_volumio', 'getMyVolumioStatus', '');
    if (response != undefined) {
      response.then(function (result) {
        defer.resolve(result);
      }).fail(function () {
        defer.resolve(notLoggedInResponseObject);
      });
    } else {
          // MyVolumio plugin not loaded
      defer.resolve(notLoggedInResponseObject);
    }

    return defer.promise;
  }

  myVolumioLogout() {
    var self = this;
    var defer = libQ.defer();

    return self.executeOnPlugin('system_controller', 'my_volumio', 'myVolumioLogout', '');
  }

  enableMyVolumioDevice(device) {
    var self = this;
    var defer = libQ.defer();

    return self.executeOnPlugin('system_controller', 'my_volumio', 'enableMyVolumioDevice', device);
  }

  disableMyVolumioDevice(device) {
    var self = this;
    var defer = libQ.defer();

    return self.executeOnPlugin('system_controller', 'my_volumio', 'disableMyVolumioDevice', device);
  }

  deleteMyVolumioDevice(device) {
    var self = this;
    var defer = libQ.defer();

    return self.executeOnPlugin('system_controller', 'my_volumio', 'deleteMyVolumioDevice', device);
  }

  reloadUi() {
    var self = this;
    this.pushConsoleMessage('CoreCommandRouter::Reload Ui');

    return self.broadcastMessage('reloadUi', '');
  }

  getMenuItems() {
    var self = this;
    var defer = libQ.defer();
    var lang_code = self.sharedVars.get('language_code');

    self.i18nJson(__dirname + '/i18n/strings_' + lang_code + '.json',
      __dirname + '/i18n/strings_en.json',
      __dirname + '/mainmenu.json')
      .then(function (menuItemsJson) {
        if (fs.existsSync('/myvolumio/')) {
          var menuItems = [{'id': 'my-volumio'}];
          menuItems = menuItems.concat(menuItemsJson.menuItems);
        } else {
          var menuItems = menuItemsJson['menuItems'];
        }
        defer.resolve(menuItems);
      });
    return defer.promise;
  }

  usbAudioAttach() {
    var self = this;
    var defer = libQ.defer();

    if (typeof self.platformspecific.usbAudioAttach === 'function') {
      self.platformspecific.usbAudioAttach();
    } else {
      defer.resolve();
    }
    return defer.promise;
  }

  usbAudioDetach() {
    var self = this;
    var defer = libQ.defer();

    if (typeof self.platformspecific.usbAudioDetach === 'function') {
      self.platformspecific.usbAudioDetach();
    } else {
      defer.resolve();
    }
    return defer.promise;
  }

  getMyMusicPlugins() {
    var self = this;

    return this.pluginManager.getMyMusicPlugins();
  }

  enableDisableMyMusicPlugin(data) {
    var self = this;

    return this.pluginManager.enableDisableMyMusicPlugin(data);
  }

  addPluginRestEndpoint(data) {
    var self = this;
    var updated = false;

    if (data.endpoint && data.type && data.name && data.method) {
      if (self.pluginsRestEndpoints.length) {
        for (var i in self.pluginsRestEndpoints) {
          var endpoint = self.pluginsRestEndpoints[i];
          if (endpoint.endpoint === data.endpoint) {
            updated = true;
            endpoint = data;
            return self.logger.info('Updating ' + data.endpoint + ' REST Endpoint for plugin: ' + data.type + '/' + data.name);
          }
        }
        if (!updated) {
          self.logger.info('Adding ' + data.endpoint + ' REST Endpoint for plugin: ' + data.type + '/' + data.name);
          self.pluginsRestEndpoints.push(data);
        }
      } else {
        self.logger.info('Adding ' + data.endpoint + ' REST Endpoint for plugin: ' + data.type + '/' + data.name);
        self.pluginsRestEndpoints.push(data);
      }
    } else {
      self.logger.error('Not Adding plugin to REST Endpoints, missing parameters');
    }
  }

  removePluginRestEndpoint(data) {
      var self = this;
      var updated = false;

      if (data && data.endpoint) {
          if (self.pluginsRestEndpoints.length) {
              for (var i in self.pluginsRestEndpoints) {
                  var endpoint = self.pluginsRestEndpoints[i];
                  if (endpoint.endpoint === data.endpoint) {
                      self.logger.info('Removing ' + data.endpoint + ' REST Endpoint');
                      self.pluginsRestEndpoints.splice(i, 1);
                  }
              }
          }
      }
  }

  getPluginsRestEndpoints() {
    var self = this;

    return self.pluginsRestEndpoints;
  }

  getPluginEnabled(category, pluginName) {
    var self = this;

    return this.pluginManager.isEnabled(category, pluginName);
  }

  getSystemVersion() {
    var self = this;

    return this.executeOnPlugin('system_controller', 'system', 'getSystemVersion', '');
  }

  getAdvancedSettingsStatus() {
    var self = this;

    return this.executeOnPlugin('system_controller', 'system', 'getAdvancedSettingsStatus', '');
  }

  getExperienceAdvancedSettings() {
    var self = this;

    return this.executeOnPlugin('system_controller', 'system', 'getExperienceAdvancedSettings', '');
  }

  broadcastUiSettings() {
    var self = this;
    var returnedData = self.executeOnPlugin('miscellanea', 'appearance', 'getUiSettings', '');

    if (returnedData != undefined) {
      returnedData.then(function (data) {
        self.broadcastMessage('pushUiSettings', data);
      });
    }
  }

  addAudioOutput(data) {
    var self = this;

    var audioOutputPlugin = this.pluginManager.getPlugin('audio_interface', 'outputs');
    if (audioOutputPlugin != undefined && typeof audioOutputPlugin.addAudioOutput === 'function') {
      return audioOutputPlugin.addAudioOutput(data);
    } else {
      this.logger.error('WARNING: No Audio Output plugin found');
    }
  }

  updateAudioOutput(data) {
    var self = this;

    var audioOutputPlugin = this.pluginManager.getPlugin('audio_interface', 'outputs');
    if (audioOutputPlugin != undefined && typeof audioOutputPlugin.updateAudioOutput === 'function') {
      return audioOutputPlugin.updateAudioOutput(data);
    } else {
      this.logger.error('WARNING: No Audio Output plugin found');
    }
  }

  removeAudioOutput(id) {
    var self = this;

    var audioOutputPlugin = this.pluginManager.getPlugin('audio_interface', 'outputs');
    if (audioOutputPlugin != undefined && typeof audioOutputPlugin.removeAudioOutput === 'function') {
      return audioOutputPlugin.removeAudioOutput(id);
    } else {
      this.logger.error('WARNING: No Audio Output plugin found');
    }
  }

  getAudioOutputs() {
    var self = this;

    var audioOutputPlugin = this.pluginManager.getPlugin('audio_interface', 'outputs');
    if (audioOutputPlugin != undefined && typeof audioOutputPlugin.getAudioOutputs === 'function') {
      return audioOutputPlugin.getAudioOutputs();
    } else {
      this.logger.error('WARNING: No Audio Output plugin found');
    }
  }

  enableAudioOutput(data) {
    var self = this;

    var audioOutputPlugin = this.pluginManager.getPlugin('audio_interface', 'outputs');
    if (audioOutputPlugin != undefined && typeof audioOutputPlugin.enableAudioOutput === 'function') {
      return audioOutputPlugin.enableAudioOutput(data);
    } else {
      this.logger.error('WARNING: No Audio Output plugin found');
    }
  }

  disableAudioOutput(id) {
    var self = this;

    var audioOutputPlugin = this.pluginManager.getPlugin('audio_interface', 'outputs');
    if (audioOutputPlugin != undefined && typeof audioOutputPlugin.disableAudioOutput === 'function') {
      return audioOutputPlugin.disableAudioOutput(id);
    } else {
      this.logger.error('WARNING: No Audio Output plugin found');
    }
  }

  setAudioOutputVolume(data) {
    var self = this;

    var audioOutputPlugin = this.pluginManager.getPlugin('audio_interface', 'outputs');
    if (audioOutputPlugin != undefined && typeof audioOutputPlugin.setAudioOutputVolume === 'function') {
      return audioOutputPlugin.setAudioOutputVolume(data);
    } else {
      this.logger.error('WARNING: No Audio Output plugin found');
    }
  }

  audioOutputPlay(data) {
    var self = this;

    var audioOutputPlugin = this.pluginManager.getPlugin('audio_interface', 'outputs');
    if (audioOutputPlugin != undefined && typeof audioOutputPlugin.audioOutputPlay === 'function') {
      return audioOutputPlugin.audioOutputPlay(data);
    } else {
      this.logger.error('WARNING: No Audio Output plugin found');
    }
  }

  audioOutputPause(data) {
    var self = this;

    var audioOutputPlugin = this.pluginManager.getPlugin('audio_interface', 'outputs');
    if (audioOutputPlugin != undefined && typeof audioOutputPlugin.audioOutputPause === 'function') {
      return audioOutputPlugin.audioOutputPause(data);
    } else {
      this.logger.error('WARNING: No Audio Output plugin found');
    }
  }

  getHwuuid() {
    var self = this;

    return self.executeOnPlugin('system_controller', 'system', 'getHwuuid', '');
  }

  setOauthData(data) {
    var self = this;

    var pluginCategory = data.plugin.split('/')[0];
    var pluginName = data.plugin.split('/')[1];

    var thisPlugin = this.pluginManager.getPlugin(pluginCategory, pluginName);
    if (thisPlugin != undefined && typeof thisPlugin.oauthLogin === 'function') {
      return thisPlugin.oauthLogin(data);
    } else {
      self.logger.error('Could not execute OAUTH Login: no function for plugin ' + pluginCategory + ' ' + pluginName);
    }
  }

  getCurrentIPAddresses() {
    var self = this;

    var networkPlugin = this.pluginManager.getPlugin('system_controller', 'network');
    return networkPlugin.getCurrentIPAddresses();
  }

  getCachedIPAddresses() {
    var self = this;

    var networkPlugin = this.pluginManager.getPlugin('system_controller', 'network');
    return networkPlugin.getCachedIPAddresses();
  }

  refreshCachedPAddresses() {
    var self = this;

    var networkPlugin = this.pluginManager.getPlugin('system_controller', 'network');
    return networkPlugin.refreshCachedPAddresses();
  }

  rebuildALSAConfiguration() {
    var self = this;
      
    if (process.env.MODULAR_ALSA_PIPELINE === 'true') {
      var alsaPlugin = this.pluginManager.getPlugin('audio_interface', 'alsa_controller');
      return alsaPlugin.updateALSAConfigFile();
    } else {
      self.logger.error('Modular ALSA configuration is disabled and so cannot be rebuilt');
      return libQ.resolve();
    }
  }

  registerStandByHandler(data) {
    var self = this;

    if (data && data.category && data.name && data.method) {
      self.standByHandler = data;
    } else {
      self.logger.erorr('Failed to register Standby handler, missing data');
    }
  }

  addDSPSignalPathElement(data) {
    var self = this;
    /*
    This is a function to set signal path elements, useful to report the signal path to utilities requesting it
    mandatory values are:
    { "id": "fusiondspeq", "sub_type": "dsp_plugin", "preset": "FusionDSP", "quality": "enhanced" }
     */

    // TODO
    // ADD Other infos such as plugin name, type, function to enable and disable and select presets

    self.logger.info('Adding Signal Path Element ' + data);

    var updated = false;

    if (data.id && data.sub_type && data.preset && data.quality) {
      if (self.dspSignalPathElements.length) {
        for (var i in self.dspSignalPathElements) {
          var element = self.dspSignalPathElements[i];
          if (element.id === data.id) {
            updated = true;
            element = data;
            self.logger.info('Updating ' + data.id + ' DSP Signal Path Element');
          }
        }
        self.callCallback('volumioPushDSPSignalPathElements', self.dspSignalPathElements);
        if (!updated) {
          self.logger.info('Adding ' + data.id + ' DSP Signal Path Element');
          self.dspSignalPathElements.push(data);
          self.callCallback('volumioPushDSPSignalPathElements', self.dspSignalPathElements);
        }
      } else {
        self.logger.info('Adding ' + data.id + ' DSP Signal Path Element');
        self.dspSignalPathElements.push(data);
        self.callCallback('volumioPushDSPSignalPathElements', self.dspSignalPathElements);
      }
    } else {
      self.logger.error('Not Adding DSP Signal Path Element, missing parameters');
    }
  }

  removeDSPSignalPathElement(data) {
    var self = this;

    /*
    This is a function to remove signal path elements
    mandatory values are:
    {"id": "fusiondspeq"}
     */
    if (data && data.id) {
      if (self.dspSignalPathElements.length) {
        for (var i in self.dspSignalPathElements) {
          var element = self.dspSignalPathElements[i];
          if (element.id === data.id) {
            self.logger.info('Removing ' + data.id + ' DSP Signal Path Element');
            self.dspSignalPathElements.splice(i, 1);
            self.callCallback('volumioPushDSPSignalPathElements', self.dspSignalPathElements);
          }
        }
      }
    }
  }

  getDSPSignalPathElements() {
    var self = this;

    return self.dspSignalPathElements;
  }
}

module.exports = CoreCommandRouter;
