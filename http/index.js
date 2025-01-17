var express = require('express');
var compression = require('compression');
var path = require('path');
var bodyParser = require('body-parser');
var routes = require('./routes.js');
var restapi = require('./restapi.js');
var fs = require('fs-extra');
var io = require('socket.io-client');
const { v4: uuidv4 } = require('uuid');
var availableUis = [];

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
var newWizardDir = '/volumio/http/wizard';
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

if (fs.existsSync('/volumio/http/wizard')) {
  process.env.NEW_WIZARD = 'true';
} else {
  process.env.NEW_WIZARD = 'false';
}

try {
  var availableUIsConf = fs.readJsonSync(path.join('volumio', 'volumioUisList.json'));
  for (var i in availableUIsConf) {
    if (fs.existsSync(availableUIsConf[i].uiPath)) {
      availableUis.push(availableUIsConf[i]);
    }
  }
  process.env.VOLUMIO_ACTIVE_UI_NAME = availableUis[0].uiName;
  process.env.VOLUMIO_ACTIVE_UI_PATH = availableUis[0].uiPath;
  process.env.VOLUMIO_ACTIVE_UI_PRETTY_NAME = availableUis[0].uiPrettyName;
} catch(e) {
  process.env.VOLUMIO_ACTIVE_UI_NAME = 'classic';
  process.env.VOLUMIO_ACTIVE_UI_PATH = '/volumio/http/www';
  process.env.VOLUMIO_ACTIVE_UI_PRETTY_NAME = 'Classic';
}

try {
  var activeUIConf = fs.readJsonSync('/data/active_volumio_ui');
  if (activeUIConf.uiName !== undefined && activeUIConf.uiPath !== undefined && activeUIConf.uiPrettyName !== undefined && fs.existsSync(activeUIConf.uiPath)) {
    process.env.VOLUMIO_ACTIVE_UI_NAME = activeUIConf.uiName;
    process.env.VOLUMIO_ACTIVE_UI_PATH = activeUIConf.uiPath;
    process.env.VOLUMIO_ACTIVE_UI_PRETTY_NAME = activeUIConf.uiPrettyName;
  }
} catch(e) {}

app.use(function (req, res, next) {
  var userAgent = req.get('user-agent');
  if (process.env.SHOW_NEW_WIZARD === 'true') {
    express.static(newWizardDir)(req, res, next);
  } else {
    express.static(process.env.VOLUMIO_ACTIVE_UI_PATH)(req, res, next);
  }
});

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
      let fileData = [];

      req.on('data', chunk => {
        fileData.push(chunk);
      });

      req.on('end', () => {
        const bodyBuffer = Buffer.concat(fileData);
        const boundary = '--' + req.headers['content-type'].split('; ')[1].split('=')[1];
        const parts = bodyBuffer.toString().split(boundary);

        // Find the file data part
        const filePart = parts.find(part => part.includes('Content-Type'));
        if (!filePart) {
          console.log('Plugin Upload No file attached');
          return res.status(500);
        }

        // Extract filename and file content
        const fileNameMatch = filePart.match(/filename="(.+?)"/);
        const fileName = fileNameMatch ? fileNameMatch[1] : null;

        if (!fileName) {
          console.log('Plugin Upload No filename found');
          return res.status(500);
        }

        // Extract binary data
        const fileContentStart = filePart.indexOf('\r\n\r\n') + 4;
        const fileContentEnd = filePart.lastIndexOf('\r\n');
        const fileContent = bodyBuffer.slice(
            bodyBuffer.indexOf(Buffer.from('\r\n\r\n')) + 4,
            bodyBuffer.lastIndexOf(Buffer.from('\r\n' + boundary))
        );

        const uniquename = uuidv4() + '.zip';
        console.log("Created safe filename as '" + uniquename + "'");

        try {
          fs.ensureDirSync(plugindir);
        } catch (err) {
          console.log('Cannot Create Plugin Dir ' + plugindir);
          return res.status(500);
        }

        fs.writeFile(plugindir + '/' + uniquename, fileContent, (err) => {
          if (err) {
            console.log('Plugin upload failed: ' + err);
            return res.status(500);
          }
          var socket = io.connect('http://localhost:3000');
          var pluginurl = 'http://127.0.0.1:3000/plugin-serve/' + uniquename;
          socket.emit('installPlugin', {url: pluginurl});
          res.sendStatus(200);
        });
      });
    });

app.route('/backgrounds-upload')
    .post(function (req, res, next) {
      let fileData = [];

      req.on('data', chunk => {
        fileData.push(chunk);
      });

      req.on('end', () => {
        const bodyBuffer = Buffer.concat(fileData);
        const boundary = '--' + req.headers['content-type'].split('; ')[1].split('=')[1];
        const parts = bodyBuffer.toString().split(boundary);

        // Find the file data part
        const filePart = parts.find(part => part.includes('Content-Type'));
        if (!filePart) {
          console.log('Background upload No file attached');
          return res.status(500);
        }

        // Extract filename and file content
        const fileNameMatch = filePart.match(/filename="(.+?)"/);
        const fileName = fileNameMatch ? fileNameMatch[1] : null;

        if (!fileName) {
          console.log('Background upload No filename found');
          return res.status(500);
        }

        // Extract binary data
        const fileContentStart = filePart.indexOf('\r\n\r\n') + 4;
        const fileContentEnd = filePart.lastIndexOf('\r\n');
        const fileContent = bodyBuffer.slice(
            bodyBuffer.indexOf(Buffer.from('\r\n\r\n')) + 4,
            bodyBuffer.lastIndexOf(Buffer.from('\r\n' + boundary))
        );

        if (fileContent.length > 3000000) {
          console.log('Background upload size exceeds 3 MB, aborting');
          var socket = io.connect('http://localhost:3000');
          socket.emit('callMethod', {'endpoint': 'miscellanea/appearance', 'method': 'sendSizeErrorToasMessage', 'data': '3'});
          return res.status(500);
        }

        const extension = fileName.split('.').pop().toLowerCase();
        const allowedExtensions = ['jpg', 'jpeg', 'png'];

        if (allowedExtensions.indexOf(extension) > -1) {
          console.log('Uploading: ' + fileName);
          try {
            fs.ensureDirSync(backgrounddir);
          } catch (err) {
            console.log('Cannot Create Background DIR ');
            return res.status(500);
          }

          const properfilename = fileName.replace(/ /g, '-');
          const bgFileName = '/data/backgrounds/' + properfilename;

          fs.writeFile(bgFileName, fileContent, (err) => {
            if (err) {
              console.log('Error Saving Custom Albumart: ' + err);
              return res.status(500);
            }
            console.log('Background Successfully Uploaded');
            var socket = io.connect('http://localhost:3000');
            socket.emit('regenerateThumbnails', '');
            res.sendStatus(201);
          });
        }
      });
    });

app.route('/albumart-upload')
    .post(function (req, res, next) {
      let fileData = [];
      let artist, album, filePath;

      req.on('data', chunk => {
        fileData.push(chunk);
      });

      req.on('end', () => {
        const bodyBuffer = Buffer.concat(fileData);
        const boundary = '--' + req.headers['content-type'].split('; ')[1].split('=')[1];
        const parts = bodyBuffer.toString().split(boundary);

        // Extract form fields
        parts.forEach(part => {
          if (part.includes('name="artist"')) {
            artist = part.split('\r\n\r\n')[1].split('\r\n')[0];
          }
          if (part.includes('name="album"')) {
            album = part.split('\r\n\r\n')[1].split('\r\n')[0];
          }
          if (part.includes('name="filePath"')) {
            filePath = part.split('\r\n\r\n')[1].split('\r\n')[0];
          }
        });

        // Find the file data part
        const filePart = parts.find(part => part.includes('Content-Type'));
        if (!filePart) {
          console.log('Albumart upload No file attached');
          return res.status(500);
        }

        // Extract filename and file content
        const fileNameMatch = filePart.match(/filename="(.+?)"/);
        const fileName = fileNameMatch ? fileNameMatch[1] : null;

        if (!fileName) {
          console.log('Albumart upload No filename found');
          return res.status(500);
        }

        // Extract binary data
        const fileContentStart = filePart.indexOf('\r\n\r\n') + 4;
        const fileContentEnd = filePart.lastIndexOf('\r\n');
        const fileContent = bodyBuffer.slice(
            bodyBuffer.indexOf(Buffer.from('\r\n\r\n')) + 4,
            bodyBuffer.lastIndexOf(Buffer.from('\r\n' + boundary))
        );

        if (fileContent.length > 1000000) {
          console.log('Albumart upload size exceeds 1MB, aborting');
          var socket = io.connect('http://localhost:3000');
          socket.emit('callMethod', {'endpoint': 'miscellanea/appearance', 'method': 'sendSizeErrorToasMessage', 'data': '1'});
          return res.status(500);
        }

        console.log('Uploading albumart: ' + fileName);
        const extension = fileName.split('.').pop().toLowerCase();
        const allowedExtensions = ['jpg', 'jpeg', 'png'];

        if (allowedExtensions.indexOf(extension) > -1) {
          const newFilename = 'cover' + '.' + extension;
          const albumartDir = '/data/albumart';
          const cacheId = Math.floor(Math.random() * 1001);
          let customAlbumartPath, returnAlbumartPath;

          if (filePath !== undefined) {
            customAlbumartPath = encodeURI(path.join(albumartDir, 'personal', 'path', filePath));
            returnAlbumartPath = '/albumart?cacheid=' + cacheId + '&web=' + '/extralarge';
          } else if (artist !== undefined && album !== undefined) {
            customAlbumartPath = encodeURI(path.join(albumartDir, 'personal', 'album', artist, album));
            returnAlbumartPath = '/albumart?cacheid=' + cacheId + '&web=' + encodeURI(artist + '/' + album) + '/extralarge';
          } else if (artist !== undefined) {
            customAlbumartPath = encodeURI(path.join(albumartDir, 'personal', 'artist', artist));
            returnAlbumartPath = '/albumart?cacheid=' + cacheId + '&web=' + encodeURI(artist) + '/extralarge';
          } else {
            console.log('Error: no path, artist or album specified');
            return res.status(500);
          }

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

          const personalCoverPath = path.join(customAlbumartPath, newFilename);

          fs.writeFile(personalCoverPath, fileContent, (err) => {
            if (err) {
              console.log('Error Saving Custom Albumart: ' + err);
              return res.status(500);
            }
            console.log('Custom Albumart Upload Finished');
            var socket = io.connect('http://localhost:3000');
            socket.emit('callMethod', {'endpoint': 'miscellanea/albumart', 'method': 'clearAlbumartCache', 'data': ''});
            res.json({'path': returnAlbumartPath});
          });
        } else {
          console.log('Albumart file format not allowed ' + fileName);
          return res.status(500);
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

