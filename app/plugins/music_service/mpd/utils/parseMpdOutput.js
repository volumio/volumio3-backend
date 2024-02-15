
const FIELDS = {
  Album: 'album',
  AlbumArtist: 'albumartist',
  Artist: 'artist',
  Date: 'year',
  Genre: 'genre',
  Pos: 'position',
  Time: 'duration',
  Title: 'title',
  Track: 'tracknumber',
};

function parseMpdOutput (lines, startFrom, {tracknumbers}) {
  const res = Object.values(FIELDS).reduce((acc, key) => {
    acc[key] = '';
    return acc;
  }, {});
  res.path = lines[startFrom].slice(6).trim();
  const filename = res.path.split('/').pop();
  for (let i = startFrom + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {
      continue;
    }
    const key = line.split(':')[0];
    if (!key) {
      continue;
    }
    if (['file', 'directory'].includes(key)) {
      break;
    }
    const value = line.substr(line.indexOf(':') + 1, line.length).trim();
    res[FIELDS[key]] = value;
  }
  if (tracknumbers) {
    if (res.tracknumber && res.title) {
      res.title = res.tracknumber.padStart(2, '0') + ' - ' + res.title;
    }
  }
  res.duration = res.duration ? parseInt(res.duration) : 0;
  res.tracknumber = res.tracknumber ? parseInt(res.tracknumber) : 0;
  if (!res.title) {
    res.title = filename;
  }
  res.albumartistOrArtist = res.albumartist || res.artist;
  return res;
}

module.exports = {parseMpdOutput};
