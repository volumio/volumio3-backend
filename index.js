var path = require('path');
var fs = require('fs-extra');
var dotenv = require('dotenv').config({ path: path.join(__dirname, '.env')}); // eslint-disable-line
var execSync = require('child_process').execSync;
var expressInstance = require('./http/index.js');
var expressApp = expressInstance.app;

global.metrics = {
  start: {},
  time: (label) => {
    metrics.start[label] = process.hrtime();
  },
  end: {},
  log: (label) => {
    metrics.end[label] = process.hrtime(metrics.start[label]);
    console.log(`\u001b[34m [Metrics] \u001b[39m ${label}: \u001b[31m ${metrics.end[label][0]}s ${(metrics.end[label][1] / 1000000).toFixed(2)}ms \u001b[39m`);
  }
};

// metrics.start.WebUI = process.hrtime();
metrics.time('WebUI');

// Using port 3000 for the debug interface
expressApp.set('port', 3000);

var httpServer = expressApp.listen(expressApp.get('port'), function () {
  console.log('Express server listening on port ' + httpServer.address().port);
  metrics.log('WebUI');
});

var albumart = require(path.join(__dirname, '/app/plugins/miscellanea/albumart/albumart.js'));

albumart.setFolder('/data/albumart');

expressApp.get('/albumart', albumart.processExpressRequest);
expressApp.get('/tinyart/*', albumart.processExpressRequestTinyArt);
expressApp.get('/albumartd', albumart.processExpressRequestDirect);

expressApp.use(function (err, req, res, next) {
  /**
   * Replace with Winston logging
 **/
  console.log('An internal error occurred while serving an albumart. Details: ' + err.stack);

  /**
    * Sending back error code 500
  **/
  res.sendFile(path.join(__dirname, '/app/plugins/miscellanea/albumart/default.png'));
});

var commandRouter = new (require('./app/index.js'))(httpServer); // eslint-disable-line

var volumioManifestUIFlagFile = '/data/manifestUI';
var volumioManifestUIDisabledFile = '/data/disableManifestUI';
var volumioWizardFlagFile = '/data/wizard';

var volumioManifestUIDir = '/volumio/http/www4';

expressApp.get('/?*', function (req, res) {
  var userAgent = req.get('user-agent');
  if (process.env.NEW_WIZARD === 'true' && fs.existsSync(volumioWizardFlagFile)){
    res.sendFile(path.join(__dirname, 'http', 'wizard', 'index.html'));
  } else {
    if (fs.existsSync(volumioManifestUIDir) && !fs.existsSync(volumioManifestUIDisabledFile)) {
      res.sendFile(path.join(__dirname, 'http', 'www4', 'index.html'));
    } else {
      if ((userAgent && userAgent.includes('volumiokiosk')) || process.env.VOLUMIO_3_UI === 'false') {
        res.sendFile(path.join(__dirname, 'http', 'www', 'index.html'));
      } else {
        res.sendFile(path.join(__dirname, 'http', 'www3', 'index.html'));
      }
    }
  }
});

process.on('uncaughtException', (error) => {
  console.log('|||||||||||||||||||||||| WARNING: FATAL ERROR |||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||');
  console.log(error);
  console.log('|||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||');
  var errorMessage;
  if (error.message !== undefined) {
    errorMessage = error.message;
  } else {
    errorMessage = 'Unknown';
  }
  process.env.VOLUMIO_SYSTEM_STATUS = 'error';
  execSync('/usr/bin/node /volumio/crashreport.js "' + errorMessage + '"');
  if (process.env.EXIT_ON_EXCEPTION === 'true') {
    process.exit(1);
  }
});
