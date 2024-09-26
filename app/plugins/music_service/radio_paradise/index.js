'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var config = new (require('v-conf'))();
var unirest = require('unirest');

var flacUri;
var channelMix;
var metadataUrl;
var audioFormat = "flac";

module.exports = ControllerRadioParadise;

function ControllerRadioParadise(context) {
    var self = this;

    self.context = context;
    self.commandRouter = this.context.coreCommand;
    self.logger = this.context.logger;
    self.configManager = this.context.configManager;

    self.state = {};
    self.timer = null;
};

ControllerRadioParadise.prototype.onVolumioStart = function () {
    var self = this;
    self.configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
    self.getConf(self.configFile);
    self.apiDelay = self.config.get('apiDelay');

    return libQ.resolve();
};

ControllerRadioParadise.prototype.getConfigurationFiles = function () {
    return ['config.json'];
};

ControllerRadioParadise.prototype.onStart = function () {
    var self = this;

    self.mpdPlugin = this.commandRouter.pluginManager.getPlugin('music_service', 'mpd');

    self.addRadioResource();
    self.addToBrowseSources();

    self.serviceName = "radio_paradise";

    // Once the Plugin has successfull started resolve the promise
    return libQ.resolve();
};

ControllerRadioParadise.prototype.onStop = function () {
    var self = this;

    self.removeFromBrowseSources();
    return libQ.resolve();
};

ControllerRadioParadise.prototype.onRestart = function () {
    var self = this;
    // Optional, use if you need it
    return libQ.resolve();
};


// Configuration Methods -----------------------------------------------------------------------------
ControllerRadioParadise.prototype.getUIConfig = function () {
    var defer = libQ.defer();
    var self = this;

    var lang_code = this.commandRouter.sharedVars.get('language_code');

    self.getConf(this.configFile);
    self.commandRouter.i18nJson(__dirname + '/i18n/strings_' + lang_code + '.json',
        __dirname + '/i18n/strings_en.json',
        __dirname + '/UIConfig.json')
        .then(function (uiconf) {
            uiconf.sections[0].content[0].value = self.config.get('apiDelay');
            defer.resolve(uiconf);
        })
        .fail(function () {
            defer.reject(new Error());
        });

    return defer.promise;
};


ControllerRadioParadise.prototype.setUIConfig = function (data) {
    var self = this;
    var uiconf = fs.readJsonSync(__dirname + '/UIConfig.json');

    return libQ.resolve();
};

ControllerRadioParadise.prototype.getConf = function (configFile) {
    var self = this;

    self.config = new (require('v-conf'))();
    self.config.loadFile(configFile);
};

ControllerRadioParadise.prototype.setConf = function (varName, varValue) {
    var self = this;
    fs.writeJsonSync(self.configFile, JSON.stringify(conf));
};

ControllerRadioParadise.prototype.updateConfig = function (data) {
    var self = this;
    var defer = libQ.defer();
    var configUpdated = false;

    if (self.config.get('apiDelay') != data['apiDelay']) {
      self.config.set('apiDelay', data['apiDelay']);
      self.apiDelay = data['apiDelay'];
      configUpdated = true;
    }

    if(configUpdated) {
      var responseData = {
        title: 'Radio Paradise',
        message: 'Configuration Saved',
        size: 'md',
        buttons: [{
          name: 'Close',
          class: 'btn btn-info'
        }]
      };

      self.commandRouter.broadcastMessage("openModal", responseData);
    }

    return defer.promise;
};

// Playback Controls ---------------------------------------------------------------------------------------
ControllerRadioParadise.prototype.addToBrowseSources = function () {
    // Use this function to add your music service plugin to music sources
    var self = this;

    self.commandRouter.volumioAddToBrowseSources({
        name: 'Radio Paradise',
        uri: 'rparadise',
        plugin_type: 'music_service',
        plugin_name: "radio_paradise",
        albumart: '/albumart?sourceicon=music_service/radio_paradise/rp.svg'
    });
};

ControllerRadioParadise.prototype.removeFromBrowseSources = function () {
    // Use this function to add your music service plugin to music sources
    var self = this;

    self.commandRouter.volumioRemoveToBrowseSources('Radio Paradise');
};

ControllerRadioParadise.prototype.handleBrowseUri = function (curUri) {
    var self = this;
    var response;
    if (curUri.startsWith('rparadise')) {
        response = self.getRadioContent('rparadise');
    }
    return response
        .fail(function (e) {
            self.logger.info('[' + Date.now() + '] ' + '[RadioParadise] handleBrowseUri failed');
            libQ.reject(new Error());
        });
};

ControllerRadioParadise.prototype.getRadioContent = function (station) {
    var self = this;
    var response;
    var radioStation;
    var defer = libQ.defer();

    radioStation = self.radioStations.rparadise;

    response = self.radioNavigation;
    response.navigation.lists[0].items = [];
    for (var i in radioStation) {
        var channel = {
            service: self.serviceName,
            type: 'mywebradio',
            title: radioStation[i].title,
            artist: '',
            album: '',
            icon: 'fa fa-music',
            uri: radioStation[i].uri
        };
        response.navigation.lists[0].items.push(channel);
    }
    defer.resolve(response);

    return defer.promise;
};

// Define a method to clear, add, and play an array of tracks
ControllerRadioParadise.prototype.clearAddPlayTrack = function (track) {
    var self = this;
    if (self.timer) {
        self.timer.clear();
    }

    if (!track.uri.includes("flac")) {
        // normal radio streams
        return self.mpdPlugin.sendMpdCommand('stop', [])
            .then(function () {
                return self.mpdPlugin.sendMpdCommand('clear', []);
            })
            .then(function () {
                return self.mpdPlugin.sendMpdCommand('add "' + track.uri + '"', []);
            })
            .then(function () {
                self.commandRouter.pushToastMessage('info',
                    'Radio Paradise',
                    'Wait for Radio Channel');
                return self.mpdPlugin.sendMpdCommand('play', []).then(function () {
                    self.commandRouter.stateMachine.setConsumeUpdateService('mpd');
                    return libQ.resolve();
                })
            });
    } else {
        // Advanced stream via API
        flacUri = track.uri;

        channelMix = "Main";
        metadataUrl = "https://api.radioparadise.com/api/now_playing?chan=0";
        if (track.uri.includes("mellow")) {
            channelMix = "Mellow";
            metadataUrl = "https://api.radioparadise.com/api/now_playing?chan=1";
        } else if (track.uri.includes("rock")) {
            channelMix = "Rock";
            metadataUrl = "https://api.radioparadise.com/api/now_playing?chan=2";
        } else if (track.uri.includes("world")) {
            channelMix = "World/Etc";
            metadataUrl = "https://api.radioparadise.com/api/now_playing?chan=3";
        }

        var songs;
        return self.mpdPlugin.sendMpdCommand('stop', [])
            .then(function () {
                return self.mpdPlugin.sendMpdCommand('clear', []);
            })
            .then(function () {
                return self.mpdPlugin.sendMpdCommand('consume 1', []);
            })
            .then(function () {
                self.logger.info('[' + Date.now() + '] ' + '[RadioParadise] set to consume mode, adding url: ' + flacUri);
                return self.mpdPlugin.sendMpdCommand('add "' + flacUri + '"', []);
            })
            .then(function () {
                self.commandRouter.pushToastMessage('info',
                    'Radio Paradise',
                    'Wait for Radio Channel');

                return self.mpdPlugin.sendMpdCommand('play', []);
            }).then(function () {
                return self.setMetadata(metadataUrl);
            })
            .fail(function (e) {
                return libQ.reject(new Error());
            });
    }
};

ControllerRadioParadise.prototype.seek = function (position) {
    var self = this;
    this.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + '[RadioParadise] seek to ' + position);
    return libQ.resolve();
    //return self.mpdPlugin.seek(position);
};

// Stop
ControllerRadioParadise.prototype.stop = function () {
    var self = this;
    if (self.timer) {
        self.timer.clear();
    }
    self.commandRouter.pushToastMessage(
        'info',
        'Radio Paradise',
        'Stop Radio Channel'
    );

    return self.mpdPlugin.stop()
        .then(function () {
            self.state.status = 'stop';
            self.commandRouter.servicePushState(self.state, self.serviceName);
        });
};

// Pause
ControllerRadioParadise.prototype.pause = function () {
    var self = this;

    // stop timer
    if (self.timer) {
        self.timer.clear();
    }

    // pause the song
    return self.mpdPlugin.sendMpdCommand('pause', [1])
    .then(function () {
        var vState = self.commandRouter.stateMachine.getState();
        self.state.status = 'pause';
        self.state.seek = vState.seek;
        self.commandRouter.servicePushState(self.state, self.serviceName);
    });
};

// Resume
ControllerRadioParadise.prototype.resume = function () {
    var self = this;

    return self.mpdPlugin.sendMpdCommand('play', [])
        .then(function () {
            // adapt play status and update state machine
            self.state.status = 'play';
            self.commandRouter.servicePushState(self.state, self.serviceName);
            return self.setMetadata(metadataUrl);
    });
};

ControllerRadioParadise.prototype.explodeUri = function (uri) {
    var self = this;
    var defer = libQ.defer();
    var response = [];

    var uris = uri.split("/");
    var channel = parseInt(uris[1]);
    var query;
    var station;

    station = uris[0].substring(3);

    switch (uris[0]) {
        case 'webrp':
            if (self.timer) {
                self.timer.clear();
            }
            if (channel === 0) {
                // FLAC option chosen
                response.push({
                    service: self.serviceName,
                    type: 'track',
                    trackType: audioFormat,
                    radioType: station,
                    albumart: '/albumart?sourceicon=music_service/radio_paradise/rp-cover-black.png',
                    uri: self.radioStations.rparadise[channel].url,
                    name: self.radioStations.rparadise[channel].title,
                    duration: 1000
                });
                defer.resolve(response);
            } else {
                // non flac webradio chosen
                response.push({
                    service: self.serviceName,
                    type: 'track',
                    trackType: 'Radio Paradise',
                    radioType: station,
                    albumart: '/albumart?sourceicon=music_service/radio_paradise/rp-cover-black.png',
                    uri: self.radioStations.rparadise[channel].url,
                    name: self.radioStations.rparadise[channel].title
                });
                defer.resolve(response);
            }
            break;
        default:
            defer.resolve();
    }
    return defer.promise;
};

ControllerRadioParadise.prototype.getAlbumArt = function (data, path) {

    var artist, album;

    if (data != undefined && data.path != undefined) {
        path = data.path;
    }

    var web;

    if (data != undefined && data.artist != undefined) {
        artist = data.artist;
        if (data.album != undefined)
            album = data.album;
        else album = data.artist;

        web = '?web=' + nodetools.urlEncode(artist) + '/' + nodetools.urlEncode(album) + '/large'
    }

    var url = '/albumart';

    if (web != undefined)
        url = url + web;

    if (web != undefined && path != undefined)
        url = url + '&';
    else if (path != undefined)
        url = url + '?';

    if (path != undefined)
        url = url + 'path=' + nodetools.urlEncode(path);

    return url;
};

ControllerRadioParadise.prototype.addRadioResource = function () {
    var self = this;

    var radioResource = fs.readJsonSync(__dirname + '/radio_stations.json');
    var baseNavigation = radioResource.baseNavigation;

    self.radioStations = radioResource.stations;
    self.rootNavigation = JSON.parse(JSON.stringify(baseNavigation));
    self.radioNavigation = JSON.parse(JSON.stringify(baseNavigation));
};

ControllerRadioParadise.prototype.getMetadata = function (url) {
    var self = this;
    self.logger.info('[' + Date.now() + '] ' + '[RadioParadise] getMetadata started with url ' + url);
    var defer = libQ.defer();

    unirest.get(url)
        .end(function (response) {
            if (response.status === 200 && response.body !== undefined) {
                defer.resolve(response.body);
            } else {
                defer.resolve(null);
                self.logger.info('[RadioParadise] getMetadata failed with url ' + url);
            }
        }).catch(function (error) {
                defer.resolve(null);
                self.logger.error('[RadioParadise] getMetadata failed with url ' + url + ' and error ' + error);
        });

    return defer.promise;
};

ControllerRadioParadise.prototype.search = function (query) {
    return libQ.resolve();
};

ControllerRadioParadise.prototype.pushSongState = function (metadata) {
    var self = this;
    var rpState = {
        status: 'play',
        service: self.serviceName,
        type: 'webradio',
        trackType: audioFormat,
        radioType: 'rparadise',
        albumart: metadata.cover,
        uri: flacUri,
        name: metadata.title,
        title: metadata.title,
        artist: metadata.artist,
        album: metadata.album,
        streaming: true,
        disableUiControls: true,
        duration: metadata.time,
        seek: 0,
        samplerate: '44.1 KHz',
        bitdepth: '16 bit',
        channels: 2
    };

    self.state = rpState;

    //workaround to allow state to be pushed when not in a volatile state
    var vState = self.commandRouter.stateMachine.getState();
    var queueItem = self.commandRouter.stateMachine.playQueue.arrayQueue[vState.position];

    queueItem.name =  metadata.title;
    queueItem.artist =  metadata.artist;
    queueItem.album = metadata.album;
    queueItem.albumart = metadata.cover;
    queueItem.trackType = 'Rparadise '+ channelMix;
    queueItem.duration = metadata.time;
    queueItem.samplerate = '44.1 KHz';
    queueItem.bitdepth = '16 bit';
    queueItem.channels = 2;

    //reset volumio internal timer
    self.commandRouter.stateMachine.currentSeek = 0;
    self.commandRouter.stateMachine.playbackStart=Date.now();
    self.commandRouter.stateMachine.currentSongDuration=metadata.time;
    self.commandRouter.stateMachine.askedForPrefetch=false;
    self.commandRouter.stateMachine.prefetchDone=false;
    self.commandRouter.stateMachine.simulateStopStartDone=false;

    //volumio push state
    self.commandRouter.servicePushState(rpState, self.serviceName);
};

ControllerRadioParadise.prototype.setMetadata = function (metadataUrl) {
    var self = this;
    return self.getMetadata(metadataUrl)
    .then(function (eventResponse) {
        if (eventResponse !== null) {
            var result = JSON.parse(eventResponse);
            if (result.time === undefined) {
                self.logger.error('Failed to set RadioParadise Metadata. Received: ' + JSON.stringify(result));
            }
            self.logger.info('[' + Date.now() + '] ' + '[RadioParadise] received new metadata: ' + JSON.stringify(result));
            return result;
        }
    }).then(function(metadata) {
        // show metadata and adjust time of playback and timer
        if(self.apiDelay) {
            metadata.time = parseInt(metadata.time) + parseInt(self.apiDelay);
        }
        var duration = metadata.time * 1000;
        return libQ.resolve(self.pushSongState(metadata))
        .then(function () {
            self.logger.info('[' + Date.now() + '] ' + '[RadioParadise] setting new timer with duration of ' + duration + ' seconds.');
            // TODO: CHECK AND REPLACE THIS FUNCTION
            //self.timer = new RPTimer(self.setMetadata.bind(self), [metadataUrl], duration);
        });
    });
};
/*
function RPTimer(callback, args, delay) {
    var start, remaining = delay;

    var nanoTimer = new NanoTimer();

    RPTimer.prototype.pause = function () {
        nanoTimer.clearTimeout();
        remaining -= new Date() - start;
    };

    RPTimer.prototype.resume = function () {
        start = new Date();
        nanoTimer.clearTimeout();
        nanoTimer.setTimeout(callback, args, remaining + 'm');
    };

    RPTimer.prototype.clear = function () {
        nanoTimer.clearTimeout();
    };

    this.resume();
};


 */
