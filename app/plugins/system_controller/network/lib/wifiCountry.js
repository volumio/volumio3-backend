'use strict';

// Guess the country the device is in from the country codes (802.11d)
// that nearby access points advertise in their beacons.
// Ported from the Rivo Ultra screen plugin.

var execFile = require('child_process').execFile;

var SCAN_CMD = '/usr/bin/sudo';
var SCAN_ARGS = ['/sbin/iw', 'dev', 'wlan0', 'scan', 'ap-force'];
var SCAN_TIMEOUT_MS = 20000;
var SCAN_MAX_BUFFER = 4 * 1024 * 1024;
var CACHE_TTL_MS = 10 * 60 * 1000;
// Many access points ship with US and are never changed: US loses ties.
var FACTORY_DEFAULT = 'US';

// One vote per network and country: a mesh with many radios counts once,
// hidden networks (empty SSID) do not vote.
function countVotes (output) {
  var counts = {};
  var voted = {};
  var bssid = null;
  var ssid;
  var loose = 0;
  var lines = output.split('\n');

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var bss = line.match(/^BSS ([0-9a-f:]+)/i);
    if (bss) {
      bssid = bss[1];
      ssid = undefined;
      continue;
    }
    var name = line.match(/^\s*SSID:(.*)$/);
    if (name) {
      ssid = name[1].trim();
      continue;
    }
    var country = line.match(/Country:\s*([A-Z]{2})/);
    if (!country) continue;

    if (ssid === '') continue;

    var cc = country[1];
    var network = ssid || bssid || 'line-' + loose++;
    var vote = network + '|' + cc;
    if (voted[vote]) continue;
    voted[vote] = true;
    counts[cc] = (counts[cc] || 0) + 1;
  }

  return counts;
}

// Country codes ordered by number of networks, US last on a tie.
function rankCountries (output) {
  if (typeof output !== 'string' || output.length === 0) return [];

  var counts = countVotes(output);
  return Object.keys(counts).sort(function (a, b) {
    var diff = counts[b] - counts[a];
    if (diff !== 0) return diff;
    return (a === FACTORY_DEFAULT) - (b === FACTORY_DEFAULT);
  });
}

// The clear winner, or null when nothing advertises a country or two
// countries tie (US drops out of a tie at the top).
function parseCountries (output) {
  if (typeof output !== 'string' || output.length === 0) return null;

  var counts = countVotes(output);
  var codes = Object.keys(counts);

  if (codes.length === 0) return null;

  if (codes.length > 1 && counts[FACTORY_DEFAULT]) {
    var top = 0;
    codes.forEach(function (cc) {
      if (counts[cc] > top) top = counts[cc];
    });
    var tiedAtTop = codes.filter(function (cc) {
      return counts[cc] === top;
    });
    if (tiedAtTop.length > 1 && tiedAtTop.indexOf(FACTORY_DEFAULT) !== -1) {
      delete counts[FACTORY_DEFAULT];
      codes = Object.keys(counts);
    }
  }

  var best = null;
  var bestCount = 0;
  var tied = false;

  codes.forEach(function (cc) {
    if (counts[cc] > bestCount) {
      best = cc;
      bestCount = counts[cc];
      tied = false;
    } else if (counts[cc] === bestCount) {
      tied = true;
    }
  });

  return tied ? null : best;
}

function runScan () {
  return new Promise(function (resolve, reject) {
    execFile(SCAN_CMD, SCAN_ARGS, {
      encoding: 'utf8',
      timeout: SCAN_TIMEOUT_MS,
      maxBuffer: SCAN_MAX_BUFFER
    }, function (err, stdout) {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

// Scan once and build the result. Never rejects: any failure (no wlan0,
// no iw, scan busy or timed out) gives an empty result.
function detectCountry (runner) {
  var run = runner || runScan;

  return Promise.resolve()
    .then(run)
    .then(function (stdout) {
      return {
        country: parseCountries(stdout),
        countries: rankCountries(stdout)
      };
    })
    .catch(function () {
      return { country: null, countries: [] };
    });
}

// Returns a function that scans at most once at a time (concurrent callers
// share the scan) and remembers a non-empty result for ttlMs.
function createDetector (runner, ttlMs, now) {
  var ttl = ttlMs || CACHE_TTL_MS;
  var clock = now || Date.now;
  var cached = null;
  var cachedAt = 0;
  var inFlight = null;

  return function () {
    if (cached && clock() - cachedAt < ttl) return Promise.resolve(cached);
    if (inFlight) return inFlight;

    inFlight = detectCountry(runner).then(function (result) {
      inFlight = null;
      if (result.countries.length > 0) {
        cached = result;
        cachedAt = clock();
      }
      return result;
    });
    return inFlight;
  };
}

module.exports = {
  parseCountries: parseCountries,
  rankCountries: rankCountries,
  detectCountry: detectCountry,
  createDetector: createDetector
};
