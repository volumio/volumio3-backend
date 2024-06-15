var express = require('express');
var compression = require('compression');
var path = require('path');
var bodyParser = require('body-parser');
var routes = require('./routes.js');
var restapi = require('./restapi.js');
var busboy = require('connect-busboy');
var fs = require('fs-extra');
var io = require('socket.io-client');
const { v4: uuidv4 } = require('uuid');

var app = express();
var dev = express();
var plugin = express();
var background = express();
var stream = express();
var partnerlogo = express();
var status = express();
/* eslint-disable */
var plugindir = '/tmp/plugins';
var backgrounddir = '/data/backgrounds';
var volumio2UIFlagFile = '/data/volumio2ui';
var volumioManifestUIFlagFile = '/data/manifestUI';
var volumioWizardFlagFile = '/data/wizard';
var volumioManifestUIDisabledFile = '/data/disableManifestUI';
var volumio3UIFolderPath = '/volumio/http/www3';
var volumioManifestUIDir = '/volumio/http/www4';
process.env.VOLUMIO_SYSTEM_STATUS = 'starting';

var allowCrossDomain = function (req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With');

  // intercept OPTIONS method
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
};

// view engine setup
dev.set('views', path.join(__dirname, 'dev/views'));
dev.set('view engine', 'ejs');

dev.use(bodyParser.json());
dev.use(bodyParser.urlencoded({ extended: false }));
dev.use(express.static(path.join(__dirname, 'dev')));

dev.use('/', routes);

app.use(compression());

// Serving Volumio3 UI
// Checking if we use Volumio3 UI
if (fs.existsSync(volumio2UIFlagFile) || (fs.existsSync(volumioManifestUIFlagFile) && !fs.existsSync(volumioManifestUIDisabledFile)) || !fs.existsSync(volumio3UIFolderPath)) {
  process.env.VOLUMIO_3_UI = 'false';
} else {
  process.env.VOLUMIO_3_UI = 'true';
}

var staticMiddlewareUI2 = express.static(path.join(__dirname, 'www'));
var staticMiddlewareUI3 = express.static(path.join(__dirname, 'www3'));
var staticMiddlewareManifestUI = express.static(path.join(__dirname, 'www4'));
var staticMiddlewareWizard = express.static(path.join(__dirname, 'wizard'));

app.use(function (req, res, next) {
  var userAgent = req.get('user-agent');
  if (process.env.NEW_WIZARD === 'true' && fs.existsSync(volumioWizardFlagFile)){
    staticMiddlewareWizard(req, res, next);
  } else {
    if (fs.existsSync(volumioManifestUIDir) && !fs.existsSync(volumioManifestUIDisabledFile)){
      staticMiddlewareManifestUI(req, res, next);
    } else {
      if ((userAgent && userAgent.includes('volumiokiosk')) || process.env.VOLUMIO_3_UI === 'false') {
        staticMiddlewareUI2(req, res, next);
      } else {
        staticMiddlewareUI3(req, res, next);
      }
    }
  }
});

app.use(busboy({ immediate: true }));
app.use(allowCrossDomain);

app.use('/dev', dev);
app.use('/api', restapi);
app.use('/plugin-serve', plugin);
app.use('/stream', stream);

stream.use(express.static('/tmp/hls', { maxAge: 0 }));

stream.use(function (req, res, next) {
  res.status(404);
  res.send("Not found");
});

app.use('/partnerlogo', partnerlogo);
partnerlogo.use(express.static('/volumio/partnerlogo.png', { maxAge: 0 }));

partnerlogo.use(function (req, res, next) {
  res.status(404);
  res.send("Not found");
});

// System Status API
app.use('/status', status);

status.use(function (req, res, next) {

  res.send(process.env.VOLUMIO_SYSTEM_STATUS);
});

// catch 404 and forward to error handler
dev.use(function (req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handlers

// development error handler
// will print stacktrace
if (dev.get('env') === 'development') {
  dev.use(function (err, req, res, next) {
    res.status(err.status || 500);
    res.render('error', {
      message: err.message,
      error: err
    });
  });
}

// production error handler
// no stacktraces leaked to user
dev.use(function (err, req, res, next) {
  res.status(err.status || 500);
  res.render('error', {
    message: err.message,
    error: {}
  });
});

app.route('/plugin-upload')
  .post(function (req, res, next) {
    this.fileData = null;

    req.busboy.on('file', (fieldname, file, filename) => {
      this.filename = filename;
      file.on('data', (data) => {
        if (this.fileData === null) {
          this.fileData = data;
        } else {
          this.fileData = Buffer.concat([this.fileData, data]);
        }
      });
    });

    req.busboy.on('finish', () => {
      if (!this.filename) {
        console.log('Plugin Upload No file attached');
        return res.status(500);
      }
      if (this.fileData) {
        console.log('Uploading: ' + this.filename);
        this.uniquename = uuidv4() + '.zip';
        console.log("Created safe filename as '" + this.uniquename + "'");
        try {
          fs.ensureDirSync(plugindir);
        } catch (err) {
          console.log('Cannot Create Plugin Dir ' + plugindir);
        }
        fs.writeFile(plugindir + '/' + this.uniquename, this.fileData, (err) => {
          if (err) {
            console.log('Plugin upload failed: ' + err);
          } else {
            var socket = io.connect('http://localhost:3000');
            var pluginurl = 'http://127.0.0.1:3000/plugin-serve/' + this.uniquename;
            socket.emit('installPlugin', {url: pluginurl});
            res.sendStatus(200);
          }
        });
      }
    });
  });

app.route('/backgrounds-upload')
  .post(function (req, res, next) {
    this.fileData = null;

    req.busboy.on('file', (fieldname, file, filename) => {
      this.filename = filename;
      file.on('data', (data) => {
        if (this.fileData === null) {
          this.fileData = data;
        } else {
          this.fileData = Buffer.concat([this.fileData, data]);
        }
      });
    });

    req.busboy.on('finish', () => {
      if (!this.filename) {
        console.log('Background upload No file attached');
        return res.status(500);
      }
      if (this.fileData && this.fileData.length > 3000000) {
        console.log('Background upload size exceeds 3 MB, aborting');
        var socket = io.connect('http://localhost:3000');
        socket.emit('callMethod', {'endpoint': 'miscellanea/appearance', 'method': 'sendSizeErrorToasMessage', 'data': '3'});
        return res.status(500);
      }
      var allowedExtensions = ['jpg', 'jpeg', 'png', 'avif'];
      var extension = this.filename.split('.').pop().toLowerCase();
      if (allowedExtensions.indexOf(extension) > -1) {
        console.log('Uploading: ' + this.filename);
        try {
          fs.ensureDirSync(backgrounddir);
        } catch (err) {
          console.log('Cannot Create Background DIR ');
        }
        var properfilename = this.filename.replace(/ /g, '-');
        var bgFileName = '/data/backgrounds/' + properfilename;
        if (this.fileData) {
          fs.writeFile(bgFileName, this.fileData, (err) => {
            if (err) {
              console.log('Error Saving Custom Albumart: ' + err);
            } else {
              console.log('Background Successfully Uploaded');
              var socket = io.connect('http://localhost:3000');
              socket.emit('regenerateThumbnails', '');
              res.status(201);
            }
          });
        } else {
          console.log('Failed to upload background file: no file received');
        }
      }
    });
  });

app.route('/albumart-upload')
  .post(function (req, res, next) {
    var artist;
    var album;
    var filePath;
    this.fileData = null;

    req.busboy.on('file', (fieldname, file, filename) => {
      this.filename = filename;
      file.on('data', (data) => {
        if (this.fileData === null) {
          this.fileData = data;
        } else {
          this.fileData = Buffer.concat([this.fileData, data]);
        }
      });
    });

    req.busboy.on('field', (fieldName, value) => {
      if (fieldName === 'artist' && value !== undefined) {
        this.artist = value;
      }
      if (fieldName === 'album' && value !== undefined) {
        this.album = value;
      }
      if (fieldName === 'filePath' && value !== undefined) {
        this.filePath = value;
      }
    });

    req.busboy.on('finish', () => {
      if (!this.filename) {
        console.log('Albumart upload No file attached');
        return res.status(500);
      }
      if (this.fileData && this.fileData.length > 1000000) {
        console.log('Albumart upload size exceeds 1MB, aborting');
        var socket = io.connect('http://localhost:3000');
        socket.emit('callMethod', {'endpoint': 'miscellanea/appearance', 'method': 'sendSizeErrorToasMessage', 'data': '1'});
        return res.status(500);
      }
      console.log('Uploading albumart: ' + this.filename);
      extension = this.filename.split('.').pop().toLowerCase();
      var allowedExtensions = ['jpg', 'jpeg', 'png', 'avif'];
      if (allowedExtensions.indexOf(extension) > -1) {
        this.filename = 'cover' + '.' + extension;
        var albumartDir = '/data/albumart';
        var cacheId = Math.floor(Math.random() * 1001);
        if (this.filePath !== undefined) {
          var customAlbumartPath = encodeURI(path.join(albumartDir, 'personal', 'path', this.filePath));
          var returnAlbumartPath = '/albumart?cacheid=' + cacheId + '&web=' + '/extralarge';
        } else if (this.artist !== undefined && this.album !== undefined) {
          var customAlbumartPath = encodeURI(path.join(albumartDir, 'personal', 'album', this.artist, this.album));
          var returnAlbumartPath = '/albumart?cacheid=' + cacheId + '&web=' + encodeURI(this.artist + '/' + this.album) + '/extralarge';
        } else if (this.artist !== undefined) {
          var customAlbumartPath = encodeURI(path.join(albumartDir, 'personal', 'artist', this.artist));
          var returnAlbumartPath = '/albumart?cacheid=' + cacheId + '&web=' + encodeURI(this.artist) + '/extralarge';
        } else {
          console.log('Error: no path, artist or album specified');
          return res.status(500);
        }

        if (this.fileData !== null) {
          try {
            fs.ensureDirSync(customAlbumartPath);
          } catch (err) {
            console.log('Cannot Create Personal Albumart DIR : ' + err);
            return res.status(500);
          }

          try {
            fs.emptyDirSync(customAlbumartPath);
          } catch (e) {
            console.log('Could not clear personal albumart folder: ' + e);
          }

          var personalCoverPath = path.join(customAlbumartPath, this.filename);

          fs.writeFile(personalCoverPath, this.fileData, (err) => {
            if (err) {
              console.log('Error Saving Custom Albumart: ' + err);
            } else {
              console.log('Custom Albumart Upload Finished');
              var socket = io.connect('http://localhost:3000');
              socket.emit('callMethod', {'endpoint': 'miscellanea/albumart', 'method': 'clearAlbumartCache', 'data': ''});
              res.json({'path': returnAlbumartPath});
            }
          });
        }
      } else {
        console.log('Albumart file format not allowed ' + filename);
      }
    });
  });

plugin.use(express.static(path.join(plugindir)));
background.use(express.static(path.join(backgrounddir)));
app.use('/backgrounds', express.static('/data/backgrounds/'));
app.use('/cover-art', express.static('/var/lib/mpd/music/'));
app.use('/music', express.static('/'));


module.exports.app = app;
module.exports.dev = dev;

