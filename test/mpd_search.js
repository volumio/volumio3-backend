/* eslint-env mocha */
const assert = require('assert');
const libQ = require('kew');

const ControllerMpd = require('../app/plugins/music_service/mpd/index.js');

const RESPONSE = [
  'file: a/so-what.flac', 'Artist: Miles Davis', 'AlbumArtist: Miles Davis',
  'Album: Kind of Blue', 'Title: So What', 'Track: 1',
  'file: a/blue-in-green.flac', 'Artist: Miles Davis', 'AlbumArtist: Miles Davis',
  'Album: Kind of Blue', 'Title: Blue in Green', 'Track: 3',
  'file: b/solea.flac', 'Artist: Miles Davis', 'AlbumArtist: Miles Davis',
  'Album: Sketches of Spain', 'Title: Solea', 'Track: 5'
].join('\n');

function controller (sent) {
  const self = Object.create(ControllerMpd.prototype);
  self.mpdReady = libQ.resolve();
  self.clientMpd = {
    sendCommand: function (command, callback) {
      sent.push(command && command.name ? command.name : String(command));
      setTimeout(function () { callback(null, RESPONSE); }, 1);
    }
  };
  self.commandRouter = { getI18nString: (key) => key };
  self.getAlbumArt = () => '';
  self.getParentFolder = () => '';
  return self;
}

describe('ControllerMpd.search', function () {
  it('scans the library once per search, not twice', function () {
    const sent = [];
    return ControllerMpd.prototype.search.call(controller(sent), { value: 'miles davis' })
      .then(() => {
        const scans = sent.filter((c) => c.indexOf('search any') === 0);
        assert.strictEqual(scans.length, 1, 'full-library scans sent: ' + sent.join(' | '));
        assert.strictEqual(sent.length, 2, 'commands sent: ' + sent.join(' | '));
      });
  });

  it('still returns the artist, album and song lists', function () {
    const sent = [];
    return ControllerMpd.prototype.search.call(controller(sent), { value: 'miles davis' })
      .then((lists) => {
        assert.strictEqual(lists.length, 3, 'expected three result lists');
        assert.deepStrictEqual(lists.map((l) => l.items.length), [1, 2, 3],
          'artist/album/song counts changed');
        assert.strictEqual(lists[2].items[0].uri, 'music-library/a/so-what.flac');
        assert.strictEqual(lists[1].items[0].uri,
          'albums://' + encodeURIComponent('Miles Davis') + '/' + encodeURIComponent('Kind of Blue'));
      });
  });
});
