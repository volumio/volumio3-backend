'use strict';

var Q = require('kew');
var url = require('url');
var S = require('string');
var fs = require('fs-extra');
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;
var apiKey = '4cb074e4b8ec4ee9ad3eb37d6f7eb240';
var diskCache = true;
var variant = 'none';
var allowedExtensions = ['jpg', 'jpeg', 'png', 'webp', 'avif'];
const { v4: uuidv4 } = require('uuid');

var winston = require('winston');
var logger = winston.createLogger({
  format: winston.format.simple(),
  transports: [
    new (winston.transports.Console)(),
    new (winston.transports.File)({
      filename: '/var/log/albumart.log',
      json: false
    })
  ]
});

try {
  variant = execSync("cat /etc/os-release | grep ^VOLUMIO_VARIANT | tr -d 'VOLUMIO_VARIANT=\"'").toString().replace('\n', '');
} catch (e) {
  variant = 'none';
}

var albumArtRootFolder = '/data/albumart/web';
var mountAlbumartFolder = '/data/albumart/folder';
var mountMetadataFolder = '/data/albumart/metadata';
var mountPersonalFolder = '/data/albumart/personal';

var setFolder = function (newFolder) {
  // logger.info("Setting folder " + newFolder);
  albumArtRootFolder = S(newFolder).ensureRight('/').s + 'web/';
  fs.ensureDirSync(albumArtRootFolder);

  mountAlbumartFolder = S(newFolder).ensureRight('/').s + 'folder/';
  fs.ensureDirSync(mountAlbumartFolder);

  mountMetadataFolder = S(newFolder).ensureRight('/').s + 'metadata/';
  fs.ensureDirSync(mountMetadataFolder);

  mountPersonalFolder = S(newFolder).ensureRight('/').s + 'personal/';
  fs.ensureDirSync(mountPersonalFolder);
};

var searchOnline = function (defer, web) {
  /**
	 * If we arrive to this point the file albumart has not been passed or doesn't exists
	 */

  var artist, album, resolution, wiki;

  if (web != undefined) {
    var splitted = web.split('/');

    if (splitted.length < 3) {
      defer.reject(new Error('The web link ' + web + ' is malformed'));
      return defer.promise;
    }

    if (splitted.length == 3) {
      artist = splitted[0];
      album = splitted[1];
      resolution = splitted[2];
    } else if (splitted.length == 4) {
      artist = splitted[1];
      album = splitted[2];
      resolution = splitted[3];
    }
  } else {
    defer.reject(new Error('No parameters defined'));
    return defer.promise;
  }

  /**
	 * Loading album art from network
	 */
  var folder;
  var personalFolder;

  if (album) {
    folder = albumArtRootFolder + artist + '/' + album + '/';
    personalFolder = mountPersonalFolder + 'album/' + artist + '/' + album + '/';
  } else {
    folder = albumArtRootFolder + artist + '/';
    personalFolder = mountPersonalFolder + 'artist/' + artist + '/';
  }

  try {
    var personalFiles = fs.readdirSync(personalFolder);
    var extension = personalFiles[0].split('.').pop().toLowerCase();
    if (allowedExtensions.indexOf(extension) > -1) {
      return defer.resolve(personalFolder + personalFiles[0]);
    }
  } catch (e) {
	    // console.log(e);
  }

  var fileName = resolution;
  try {
    fs.ensureDirSync(folder);
  } catch (e) {
    defer.reject(new Error(e));
            	return defer.promise;
  }
  var infoPath = folder + 'info.json';

  var infoJson = {};

  if (fs.existsSync(infoPath) == false) {
    fs.ensureFileSync(infoPath);
    try {
      fs.writeJsonSync(infoPath, infoJson);
    } catch (e) {
      console.log('Error in writing albumart JSON file: ' + e);
    }
  }

  var stats = fs.statSync(infoPath);
  var fileSizeInBytes = stats['size'];

  if (fileSizeInBytes > 0) {
    try {
      infoJson = fs.readJsonSync(infoPath, {throws: true});
    } catch (e) {
      // console.log("Invalid JSON " + infoPath);
      defer.reject(new Error(err));
      return defer.promise;
    }
  }

  if (infoJson[resolution] == undefined) {
    try {
      var decodedArtist = decodeURIComponent(artist);
      var decodedAlbum = decodeURIComponent(album);
      var decodedResolution = decodeURIComponent(resolution);
    } catch (e) {
      // console.log("ERROR getting albumart info from JSON file: " + e);
      defer.reject(new Error(err));
      return defer.promise;
    }

    if (decodedAlbum === '') {
      decodedAlbum = decodedAlbum || null;
    }

    retrieveAlbumart(decodedArtist, decodedAlbum, decodedResolution, function (err, url, wiki) {
      if (err) {
        // console.log("ERROR getting albumart: " + err + " for Infopath '" + infoPath + "'");
        defer.reject(new Error(err));
        return defer.promise;
      } else {
        if (url != undefined && url != '') {
          var splitted = url.split('.');
          var fileExtension = splitted[splitted.length - 1];
          var diskFileName = uuidv4() + '.' + fileExtension;
          var fileName = folder + diskFileName;

          // console.log("URL: " + url);
          download(url, fileName, function (err) {
            if (err) {
              defer.reject(new Error(err));
            } else {
              setTimeout(function () {
                defer.resolve(folder + diskFileName);
              }, 500);
            }
          });

          infoJson[resolution] = diskFileName;
        } else {
          defer.reject(new Error('No albumart URL'));
          return defer.promise;
        }
        if(wiki != undefined && wiki != '') {
          infoJson['wiki'] = wiki;
        }
      }
      try {
        fs.writeJsonSync(infoPath, infoJson);
      } catch (e) {
        console.log('Error in writing albumart JSON file: ' + e);
      }
    });
  } else {
    defer.resolve(folder + infoJson[resolution]);
  }
};

var searchInFolder = function (defer, path, web, meta) {
  var coverFolder = '';
  var splitted = path.split('/');

  for (var k = 1; k < splitted.length; k++) {
    coverFolder = coverFolder + '/' + splitted[k];
  }

  if (fs.existsSync(coverFolder)) {
    // logger.info("Searching in folder " + coverFolder);
    var stats = fs.statSync(coverFolder);

    if (stats.isFile()) {
      var fileSizeInBytes = stats['size'];
      if (fileSizeInBytes > 0) {
        defer.resolve(coverFolder);
        return defer.promise;
      } else {
        defer.reject(new Error('Filesize is zero'));
        return defer.promise;
      }
    }

    /**
		 * Trying to read albumart from file
		 */

    var coverFilename = ['coverart', 'albumart', 'coverart', 'albumart', 'cover', 'folder' ];
    splitted = path.split('/');
    var covers = [];
    for (var ext in allowedExtensions) {
      for (var cn in coverFilename) {
          covers.push(cn + '.' + ext)
      }
    }

    for (var i in covers) {
      var coverFile = coverFolder + '/' + covers[i];
      // console.log("Searching for cover " + coverFile);
      if (fs.existsSync(coverFile)) {
        var size = fs.statSync(coverFile).size;
        var extension = coverFile.split('.').pop();
        // Limit the size of local arts to about 5MB
        if (size < 5000000) {
          if (diskCache) {
            var cacheFile = mountAlbumartFolder + '/' + coverFolder + '/extralarge.' + extension;
            // logger.info('1: Copying file to cache ['+cacheFile+']');
            fs.ensureFileSync(cacheFile);
            fs.copySync(coverFile, cacheFile);
            defer.resolve(cacheFile);
          } else {
            defer.resolve(coverFile);
          }
          return defer.promise;
        }
      }
    }

    var files = fs.readdirSync(coverFolder);
    for (var j in files) {
      var fileName = S(files[j]);
      var cfileName = fileName.toLowerCase();

      if (cfileName.endsWith('.png') || cfileName.endsWith('.jpg') || cfileName.endsWith('.jpeg') || cfileName.endsWith('.webp') || cfileName.endsWith('.avif')) {
        var coverFile = coverFolder + '/' + fileName.s;
        var size = fs.statSync(coverFile).size;
        // Limit the size of local arts to about 5MB
        if (size < 5000000) {
          defer.resolve(coverFile);
          return defer.promise;
        }
      }
    }
  } else {
    // logger.info('Folder ' + coverFolder + ' does not exist');
  }
  // searchOnline(defer, web);
  searchMeta(defer, coverFolder, web, meta);
};

var searchMeta = function (defer, coverFolder, web, meta) {
  if (meta === true && coverFolder != undefined) {
    try {
      var files = fs.readdirSync(coverFolder);
    } catch (e) {
      return searchOnline(defer, web);
    }

    var middleFileIndex = Math.floor(files.length / 2);
    var fileName = coverFolder + '/' + S(files[middleFileIndex]);

    fs.stat(fileName, function (err, stats) {
      if (err) {
        return searchOnline(defer, web);
      } else {
        if (stats.isFile() && (fileName.endsWith('.mp3') || fileName.endsWith('.flac') || fileName.endsWith('.aif'))) {
          var cmd = '/usr/bin/exiftool "' + fileName + '" | grep Picture';
          exec(cmd, {uid: 1000, gid: 1000}, function (error, stdout, stderr) {
            if (error) {
              return searchOnline(defer, web);
            } else {
              if (stdout.length > 0) {
                var metaCacheFile = mountMetadataFolder + '/' + coverFolder + '/metadata.jpeg';
                var extract = '/usr/bin/exiftool -b -Picture "' + fileName + '" > "' + metaCacheFile + '"';

                try {
                  fs.ensureFileSync(metaCacheFile);
                } catch (e) {
                  console.log('ERROR: Cannot create metadata albumart folder: ' + e);
                }

                exec(extract, {uid: 1000, gid: 1000, encoding: 'utf8'}, function (error, stdout, stderr) {
                  if (error) {
                    return searchOnline(defer, web);
                  } else {
                    console.log('Extracted metadata : ' + metaCacheFile);
                    defer.resolve(metaCacheFile);
                    return defer.promise;
                  }
                });
              } else {
                return searchOnline(defer, web);
              }
            }
          });
        } else {
          return searchOnline(defer, web);
        }
      }
    });
  } else {
    searchOnline(defer, web);
  }
};

/**
 *    This method searches for the album art, downloads it if needed
 *    and returns its file path. The return value is a promise
 **/
var processRequest = function (web, path, meta) {
  var defer = Q.defer();

  if (web == undefined && path == undefined) {
    defer.reject(new Error(''));
    return defer.promise;
  }

  if (path != undefined) {
    path = decodeURIComponent(path);

    path = sanitizeUri(path);

    if (path.startsWith('/')) {
        	if (path.startsWith('/tmp/')) {

      } else {
        path = '/mnt' + path;
      }
    } else {
      path = '/mnt/' + path;
    }

    if (fs.existsSync(path)) {
      var stats = fs.statSync(path);
      var isFolder = false;
      var imageSize = 'extralarge';

      /**
             * Trying to hit the disk cache
             *
             */
      var coverFolder = '';

      if (stats.isDirectory()) {
        coverFolder = path;
        isFolder = true;
      } else {
        var splitted = path.split('/');

        for (var k = 0; k < splitted.length - 1; k++) {
          coverFolder = coverFolder + '/' + splitted[k];
        }
      }

      fs.ensureDirSync(coverFolder);
      var cacheFilePath = mountAlbumartFolder + coverFolder + '/' + imageSize + '.jpeg';
      var metaFilePath = mountMetadataFolder + coverFolder + '/metadata.jpeg';
      // logger.info(cacheFilePath);

      if (fs.existsSync(cacheFilePath)) {
        defer.resolve(cacheFilePath);
      } else if (fs.existsSync(metaFilePath)) {
        defer.resolve(metaFilePath);
      } else {
        if (isFolder) {
          searchInFolder(defer, path, web, meta);
        } else {
          var starttime = Date.now();
          searchInFolder(defer, path, web, meta);
        }
      }
    } else {
      // logger.info('File' + path + ' doesnt exist');
      searchInFolder(defer, path, web, meta);
    }
  } else {
    searchOnline(defer, web);
  }
  return defer.promise;
};

/**
 *    This method processes incoming request from express.
 *    The following variables are needed to be in req.params
 *   artist
 *    album
 *    resolution
 *
 *    To achieve this assign this function to a path like /:artist/:album/:resolution
 **/
var processExpressRequest = function (req, res) {
  var rawQuery = req._parsedUrl.query;

  var web = req.query.web;
  var path = req.query.path;
  var icon = req.query.icon;
  var sourceicon = req.query.sourceicon;
  var sectionimage = req.query.sectionimage;
  var maxage = 2628000; // 30d 10h
  var meta = false;
  if (req.query.metadata != undefined && req.query.metadata === 'true') {
    meta = true;
  }

  if (rawQuery !== undefined && rawQuery !== null) {
    var splitted = rawQuery.split('&');
    for (var i in splitted) {
      var itemSplitted = splitted[i].split('=');
      if (itemSplitted[0] === 'web') { web = itemSplitted[1]; } else if (itemSplitted[0] === 'path') { path = itemSplitted[1]; } else if (itemSplitted[0] === 'icon') { icon = itemSplitted[1]; }
    }
  }

  // var starttime=Date.now();
  var promise = processRequest(web, path, meta);
  promise.then(function (filePath, maxage) {
    // logger.info('Sending file ' + filePath);

    // var stoptime=Date.now();
    // logger.info('Serving request took '+(stoptime-starttime)+' milliseconds');
    res.setHeader('Cache-Control', 'public, max-age=' + maxage);
    res.sendFile(filePath);
  })
    .fail(function () {
      res.setHeader('Cache-Control', 'public, max-age=' + maxage);
      if (icon !== undefined) {
        res.sendFile(__dirname + '/icons/' + icon + '.svg');
      } else if (sectionimage !== undefined) {
        var pluginPaths = ['/volumio/app/plugins/', '/data/plugins/', '/myvolumio/plugins/', '/data/myvolumio/plugins/'];
        try {
          for (i = 0; i < pluginPaths.length; i++) {
            var sectionimageFile = pluginPaths[i] + sectionimage;
            if (fs.existsSync(sectionimageFile)) {
              return res.sendFile(sectionimageFile);
            }
          }
        } catch (e) {
          return sendDefaultAlbumart(req, res);
        }
      } else if (sourceicon !== undefined) {
        var pluginPaths = ['/volumio/app/plugins/', '/data/plugins/', '/myvolumio/plugins/', '/data/myvolumio/plugins/'];
        try {
          var iconFound = false;
          for (i = 0; i < pluginPaths.length; i++) {
            var pluginIcon = pluginPaths[i] + sourceicon;
            if (fs.existsSync(pluginIcon)) {
              iconFound = true;
              return res.sendFile(pluginIcon);
            }
          }
          if (!iconFound) {
            return sendDefaultAlbumart(req, res);
          }
        } catch (e) {
          return sendDefaultAlbumart(req, res);
        }
      } else {
        res.setHeader('Cache-Control', 'public, max-age=' + maxage);
        return sendDefaultAlbumart(req, res);
      }
    });
};

var processExpressRequestDirect = function (req, res) {
  var rawQuery = req._parsedUrl.query;

  var web = req.query.web;
  var path = req.query.path;
  var icon = req.query.icon;
  var sourceicon = req.query.sourceicon;
  var sectionimage = req.query.sectionimage;
  var meta = false;
  if (req.query.metadata != undefined && req.query.metadata === 'true') {
    meta = true;
  }

  if (rawQuery !== undefined && rawQuery !== null) {
    var splitted = rawQuery.split('&');
    for (var i in splitted) {
      var itemSplitted = splitted[i].split('=');
      if (itemSplitted[0] === 'web') { web = itemSplitted[1]; } else if (itemSplitted[0] === 'path') { path = itemSplitted[1]; } else if (itemSplitted[0] === 'icon') { icon = itemSplitted[1]; }
    }
  }

  // var starttime=Date.now();
  var promise = processRequest(web, path, meta);
  promise.then(function (filePath) {
    // logger.info('Sending file ' + filePath);

    // var stoptime=Date.now();
    // logger.info('Serving request took '+(stoptime-starttime)+' milliseconds');
    res.setHeader('Cache-Control', 'public, max-age=2628000');
    return sendTinyArt(req, res, filePath);
  })
    .fail(function () {
      res.setHeader('Cache-Control', 'public, max-age=2628000');
      if (icon !== undefined) {
        return sendTinyArt(req, res, __dirname + '/icons/' + icon + '.jpg');
      } else if (sectionimage !== undefined) {
        var pluginPaths = ['/volumio/app/plugins/', '/data/plugins/', '/myvolumio/plugins/', '/data/myvolumio/plugins/'];
        try {
          for (i = 0; i < pluginPaths.length; i++) {
            var sectionimageFile = pluginPaths[i] + sectionimage;
            if (fs.existsSync(sectionimageFile)) {
              return sendTinyArt(req, res, sectionimageFile);
            }
          }
        } catch (e) {
          return sendDefaultAlbumart(req, res);
        }
      } else if (sourceicon !== undefined) {
        var pluginPaths = ['/volumio/app/plugins/', '/data/plugins/', '/myvolumio/plugins/', '/data/myvolumio/plugins/'];
        try {
          for (i = 0; i < pluginPaths.length; i++) {
            var pluginIcon = pluginPaths[i] + sourceicon;
            if (fs.existsSync(pluginIcon)) {
              return sendTinyArt(req, res, pluginIcon);
            }
          }
        } catch (e) {
          return sendDefaultAlbumart(req, res);
        }
      } else {
        res.setHeader('Cache-Control', 'public, max-age=2628000');
        return sendDefaultAlbumart(req, res);
      }
    });
};

/**
 *    This method processes incoming request from express, for the tinyart function that provides a simpler url for arts, and only online fetching
 *
 *    To achieve this assign this function to a path like /:artist/:album/:resolution
 **/
var processExpressRequestTinyArt = function (req, res) {
  var rawQuery = req.url;
  var splitted = rawQuery.replace(/_/g, ' ').replace('/tinyart/', '').split('/').filter(function (el) { return el; });

  if (splitted.length < 2) {
    console.log('Error in tinart request: missing fields');
  } else if (req.query.sourceicon) {
    var sourceicon = req.query.sourceicon;
  } else if (splitted.length === 2) {
    // Tiny art for artists
    var icon = 'users';
    var web = encodeURIComponent(splitted[0]) + '//' + splitted[1];
  } else if (splitted.length === 3) {
    // Tiny art for albums
    var icon = 'dot-circle-o';
    var web = encodeURIComponent(splitted[0]) + '/' + encodeURIComponent(splitted[1]) + '/' + splitted[2];
  }
  var promise = processRequest(web, '', false);
  promise.then(function (filePath) {
    return sendTinyArt(req, res, filePath);
  })
    .fail(function (e) {
      if (icon !== undefined) {
        return sendTinyArt(req, res, __dirname + '/icons/' + icon + '.jpg');
      } else if (sourceicon !== undefined) {
        var pluginPaths = ['/volumio/app/plugins/', '/data/plugins/', '/myvolumio/plugins/', '/data/myvolumio/plugins/'];
        try {
          var iconFound = false;
          for (i = 0; i < pluginPaths.length; i++) {
            var pluginIcon = pluginPaths[i] + sourceicon;
            if (fs.existsSync(pluginIcon)) {
              iconFound = true;
              return sendTinyArt(req, res, pluginIcon);
            }
          }
          if (!iconFound) {
            return sendDefaultAlbumart(req, res);
          }
        } catch (e) {
          return sendDefaultAlbumart(req, res);
        }
      } else {
        return sendDefaultAlbumart(req, res);
      }
    });
};

var sendTinyArt = function (req, res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      console.log('Error Reading Tinyart path: ' + err);
    } else {
      res.removeHeader('Transfer-Encoding');
      res.removeHeader('Access-Control-Allow-Headers');
      res.removeHeader('Access-Control-Allow-Methods');
      res.removeHeader('Access-Control-Allow-Origin');
      res.removeHeader('Cache-Control');
      res.removeHeader('Content-Type');
      res.removeHeader('X-Powered-By');
      res.setHeader('Connection', 'Keep-Alive');
      res.setHeader('Keep-Alive', 'timeout=15, max=767');
      res.end(data, 'binary');
    }
  });
};

var sanitizeUri = function (uri) {
  return uri.replace('music-library/', '').replace('mnt/', '');
};

// Included this code as an effort to reduce dependencies
// Original code at https://github.com/lacymorrow/album-art/tree/66755c918ece5093cf32d49f6263144f6669d695
// Copyright MIT © Lacy Morrow https://lacymorrow.github.io/

var retrieveAlbumart = function (artist, album, size, cb) {
  if (typeof artist !== 'string') {
    return cb('No valid artist supplied', '');
  }
  if (typeof album === 'function') {
    cb = album;
    album = size = null;
  } else if (typeof size === 'function') {
    cb = size;
    size = null;
  }

  if (album === null) {
    var data = '';
    var https = require('https');
    var artist = artist.replace('&', 'and');
    var url = 'https://meta.volumio.org' + encodeURI('/metas/v1/getDatas?mode=artistArt&artist=' + artist + '&variant=' + variant);
    https.get(url, function (resp) {
      resp.on('data', function (chunk) {
        data += chunk;
      });
      resp.on('end', function () {
        try {
          var json = JSON.parse(data);
        } catch (e) {
          return cb('JSON Error: ' + e, '');
        }

        if (json.success && json.data && json.data.length) {
          cb(null, json.data);
        } else {
          // No image art found
          cb('Error: No image found.', '');
        }
      });
    }).on('error', function (e) {
      return cb('Got error: ' + e.message);
    });
  } else {
    var data = '';
    var sizes = ['small', 'medium', 'large', 'extralarge', 'mega'];
    var method = (album === null) ? 'artist' : 'album';
    var http = require('http');
    var artist = artist.replace('&', 'and');
    var options = {
      host: 'ws.audioscrobbler.com',
      port: 80,
      path: encodeURI('/2.0/?format=json&api_key=' + apiKey + '&method=' + method + '.getinfo&artist=' + artist + '&album=' + album)
    };
    http.get(options, function (resp) {
      resp.on('data', function (chunk) {
        data += chunk;
      });
      resp.on('end', function () {
        try {
          var json = JSON.parse(data);
        } catch (e) {
          return cb('JSON Error: ' + e, '');
        }

        if (typeof (json.error) !== 'undefined') {
          // Error
          return cb('JSON Error: ' + json.message, '');
        } else if (sizes.indexOf(size) !== -1 && json[method] && json[method].image) {

          // Return image in specific size
          json[method].image.forEach(function (e, i) {
            if (e.size === size) {
              cb(null, e['#text'], json[method].wiki );
            }
          });
        } else if (json[method] && json[method].image) {
          // Return largest image
          var i = json[method].image.length - 2;
          cb(null, json[method].image[i]['#text'], json[method].wiki );
        } else {
          // No image art found
          cb('Error: No image found.', '');
        }
      });
    }).on('error', function (e) {
      return cb('Got error: ' + e.message);
    });
  }
};

var download = function (uri, dest, cb) {
  var url = require('url');
  var protocol = url.parse(uri).protocol.slice(0, -1);

  var request = require(protocol).get(uri, function (response) {
    if (response.statusCode >= 200 && response.statusCode < 300) {
      var file = fs.createWriteStream(dest);
      response.pipe(file);
      file.on('finish', function () {
        file.close(cb);
      });
    } else if (response.headers.location) {
      download(response.headers.location, dest, cb);
    } else {
      cb(response.statusMessage);
    }
  });
};

var sendDefaultAlbumart = function (req, res) {

  try {
    sendTinyArt(req, res, __dirname + '/default.webp');
  } catch (e) {
    sendTinyArt(req, res, __dirname + '/default.jpg');
  }
};

module.exports.processExpressRequest = processExpressRequest;
module.exports.processExpressRequestTinyArt = processExpressRequestTinyArt;
module.exports.processExpressRequestDirect = processExpressRequestDirect;
module.exports.processRequest = processRequest;
module.exports.setFolder = setFolder;
