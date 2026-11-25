/* eslint-env mocha */
'use strict';

var assert = require('assert');
var wifiCountry = require('../app/plugins/system_controller/network/lib/wifiCountry');
var parseCountries = wifiCountry.parseCountries;
var rankCountries = wifiCountry.rankCountries;
var detectCountry = wifiCountry.detectCountry;
var createDetector = wifiCountry.createDetector;

var SAMPLE = [
  'BSS aa:bb:cc:dd:ee:01(on wlan0)',
  '\tSSID: HomeNet',
  '\tCountry: IT\tEnvironment: Indoor/Outdoor',
  'BSS aa:bb:cc:dd:ee:02(on wlan0)',
  '\tSSID: Neighbour',
  '\tCountry: IT\tEnvironment: Indoor/Outdoor',
  'BSS aa:bb:cc:dd:ee:03(on wlan0)',
  '\tSSID: FactoryDefault',
  '\tCountry: US\tEnvironment: Indoor/Outdoor',
  'BSS aa:bb:cc:dd:ee:04(on wlan0)',
  '\tSSID: NoCountryHere',
  ''
].join('\n');

describe('wifi country', function () {
  describe('parseCountries', function () {
    it('the majority country wins, not the first seen', function () {
      assert.strictEqual(parseCountries(SAMPLE), 'IT');
    });

    it('a lone factory-default AP does not decide it', function () {
      var single = 'BSS a(on wlan0)\n\tCountry: US\nBSS b(on wlan0)\n\tCountry: IT\n\tCountry: IT\n';
      assert.strictEqual(parseCountries(single), 'IT');
    });

    it('no country information yields null rather than a guess', function () {
      assert.strictEqual(parseCountries('BSS a(on wlan0)\n\tSSID: Nothing\n'), null);
      assert.strictEqual(parseCountries(''), null);
      assert.strictEqual(parseCountries(null), null);
    });

    it('a tie between two real countries yields null', function () {
      assert.strictEqual(parseCountries('Country: IT\nCountry: DE\n'), null);
    });

    it('US loses a tie, because it is the usual factory default', function () {
      assert.strictEqual(parseCountries('Country: IT\nCountry: US\n'), 'IT');
    });

    it('US still wins when it is genuinely the majority', function () {
      assert.strictEqual(parseCountries('Country: US\nCountry: US\nCountry: US\nCountry: IT\n'), 'US');
    });

    it('a tie between two real countries is still null even with US present', function () {
      assert.strictEqual(parseCountries('Country: IT\nCountry: DE\nCountry: US\n'), null);
    });

    it('one network with many radios casts one vote', function () {
      var mesh = [
        'BSS 22:23:51:27:b9:c6(on wlan0)', '\tSSID: Office Mesh', '\tCountry: DE',
        'BSS 42:ae:30:8e:5a:c3(on wlan0)', '\tSSID: Office Mesh', '\tCountry: DE',
        'BSS 22:23:51:87:b9:c7(on wlan0)', '\tSSID: Office Mesh', '\tCountry: DE',
        'BSS aa:bb:cc:dd:ee:01(on wlan0)', '\tSSID: Neighbour A', '\tCountry: IT',
        'BSS aa:bb:cc:dd:ee:02(on wlan0)', '\tSSID: Neighbour B', '\tCountry: IT'
      ].join('\n');
      assert.strictEqual(parseCountries(mesh), 'IT');
    });

    it('hidden networks do not vote', function () {
      var hidden = [
        'BSS 20:23:51:47:b9:c6(on wlan0)', '\tSSID: ', '\tCountry: DE',
        'BSS 20:23:51:47:b9:c7(on wlan0)', '\tSSID: ', '\tCountry: DE',
        'BSS aa:bb:cc:dd:ee:01(on wlan0)', '\tSSID: Neighbour', '\tCountry: IT'
      ].join('\n');
      assert.strictEqual(parseCountries(hidden), 'IT');
    });
  });

  describe('rankCountries', function () {
    it('ranks countries by the number of networks', function () {
      assert.deepStrictEqual(
        rankCountries('Country: DE\nCountry: IT\nCountry: IT\nCountry: FR\nCountry: IT\nCountry: DE\n'),
        ['IT', 'DE', 'FR']
      );
    });

    it('puts US last on a tie, first only as a real majority', function () {
      assert.deepStrictEqual(rankCountries('Country: US\nCountry: IT\n'), ['IT', 'US']);
      assert.deepStrictEqual(rankCountries('Country: US\nCountry: US\nCountry: IT\n'), ['US', 'IT']);
    });

    it('gives an empty list when there is nothing to rank', function () {
      assert.deepStrictEqual(rankCountries(''), []);
      assert.deepStrictEqual(rankCountries(null), []);
    });
  });

  describe('detectCountry', function () {
    it('returns the winner and the ranking from what the scan printed', function () {
      return detectCountry(function () { return Promise.resolve(SAMPLE); }).then(function (result) {
        assert.deepStrictEqual(result, { country: 'IT', countries: ['IT', 'US'] });
      });
    });

    it('returns a null country but the ranking on a tie', function () {
      return detectCountry(function () { return Promise.resolve('Country: IT\nCountry: DE\n'); }).then(function (result) {
        assert.strictEqual(result.country, null);
        assert.strictEqual(result.countries.length, 2);
      });
    });

    it('returns an empty result when the scan fails', function () {
      return detectCountry(function () { return Promise.reject(new Error('command not found')); }).then(function (result) {
        assert.deepStrictEqual(result, { country: null, countries: [] });
      });
    });

    it('returns an empty result when the runner throws', function () {
      return detectCountry(function () { throw new Error('boom'); }).then(function (result) {
        assert.deepStrictEqual(result, { country: null, countries: [] });
      });
    });
  });

  describe('createDetector', function () {
    it('shares one scan between concurrent callers and caches a result', function () {
      var scans = 0;
      var detect = createDetector(function () {
        scans++;
        return Promise.resolve(SAMPLE);
      });
      return Promise.all([detect(), detect(), detect()]).then(function (results) {
        assert.strictEqual(scans, 1);
        assert.strictEqual(results[0], results[2]);
        return detect();
      }).then(function (result) {
        assert.strictEqual(scans, 1);
        assert.strictEqual(result.country, 'IT');
      });
    });

    it('scans again once the cache expires', function () {
      var scans = 0;
      var time = 0;
      var detect = createDetector(function () {
        scans++;
        return Promise.resolve(SAMPLE);
      }, 1000, function () { return time; });
      return detect().then(function () {
        time = 999;
        return detect();
      }).then(function () {
        assert.strictEqual(scans, 1);
        time = 1000;
        return detect();
      }).then(function () {
        assert.strictEqual(scans, 2);
      });
    });

    it('does not cache an empty result', function () {
      var scans = 0;
      var detect = createDetector(function () {
        scans++;
        return Promise.reject(new Error('Device or resource busy'));
      });
      return detect().then(function () {
        return detect();
      }).then(function (result) {
        assert.strictEqual(scans, 2);
        assert.deepStrictEqual(result, { country: null, countries: [] });
      });
    });
  });
});
