var assert = require('assert');
var CoreCommandRouter = require('../app/index.js');

function makeSelf(calls) {
  return {
    logger: { info: function () {}, error: function () {} },
    playListManager: {
      playlistFolder: '/data/playlist/',
      favouritesPlaylistFolder: '/data/favourites/',
      saveJSONFile: function (folder, name, data) {
        calls.push({ folder: folder, name: name, data: data });
        return Promise.resolve();
      }
    },
    mergePlaylists: function (backup) { return backup; }
  };
}

describe('restorePlaylist cloud-aware routing', function () {
  it('routes playlist restore through saveJSONFile (not a raw fs write)', function () {
    var calls = [];
    var self = makeSelf(calls);
    CoreCommandRouter.prototype.restorePlaylist.call(self, {
      type: 'playlist',
      backup: [{ name: 'rock', content: [{ uri: 'a' }] }]
    });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].folder, '/data/playlist/');
    assert.strictEqual(calls[0].name, 'rock');
    assert.deepStrictEqual(calls[0].data, [{ uri: 'a' }]);
  });

  it('routes radio-favourites restore through saveJSONFile', function () {
    var calls = [];
    var self = makeSelf(calls);
    CoreCommandRouter.prototype.restorePlaylist.call(self, {
      type: 'radio-favourites',
      backup: [{ title: 'r1' }]
    });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].folder, '/data/favourites/');
    assert.strictEqual(calls[0].name, 'radio-favourites');
  });
});
