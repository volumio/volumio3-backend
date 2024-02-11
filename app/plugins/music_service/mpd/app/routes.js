function parseUri (uri) {
  if (uri.startsWith('music-library')) {
    return ['LIB', {uri}];
  }
  if (uri === 'playlists') {
    return ['PLAYLISTS_ROOT'];
  }
  if (uri.startsWith('playlists')) {
    const name = uri.split('/')[1];
    return ['PLAYLIST_CONTENT', {name}];
  }
  if (uri === 'albums://') {
    return ['ALBUMS_ROOT'];
  }
  if (uri === 'artists://') {
    return ['ARTISTS_ROOT'];
  }
  if (uri === 'genres://') {
    return ['GENRES_ROOT'];
  }

  const parts = uri.split('/');
  if (uri.startsWith('albums://')) {
    const artist = decodeURIComponent(parts[2]);
    const album = parts[3] && decodeURIComponent(parts[3]);
    return ['ALBUM_CONTENT', {uri, artist, album, isOrphanAlbum: uri === 'albums://*/', previous: 'albums://'}];
  }

  if (uri.startsWith('artists://')) {
    const artist = decodeURIComponent(parts[2]);
    if (parts.length === 3) {
      return ['ARTIST_CONTENT', {uri, artist, previous: 'artists://', uriBegin: 'artists://'}];
    }

    const album = parts[3] && decodeURIComponent(parts[3]);
    return ['ALBUM_CONTENT', {uri, artist, album, previous: `artists://${parts[2]}`}];
  }

  if (uri.startsWith('genres://')) {
    var genre = decodeURIComponent(parts[2]);
    var artist = parts[3] && decodeURIComponent(parts[3]);
    var album = parts[4] && decodeURIComponent(parts[4]);
    switch (parts.length) {
    case 3:
      return ['GENRE_CONTENT', {genre}];
    case 4:
      return ['ARTIST_CONTENT', {uri, artist, genre, previous: `genres://${parts[2]}`, uriBegin: 'genres://'}];
    case 5:
      return ['ALBUM_CONTENT', {uri, artist, album, genre, previous: `genres://${parts[2]}`}];
    case 6:
      // not used?
      return ['ALBUM_CONTENT', {uri, artist, album, genre, previous: `genres://${parts[4]}/${parts[5]}`}];
    default:
      throw new Error(`Unknown uri: ${uri}`);
    }
  }
}

module.exports = {
  parseUri
};
