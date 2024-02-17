const FALLBACK_SORT = {sortBy: 'name', sortDirection: 'asc'};

function explodeSort (sort, defaultSort) {
  const fallback = defaultSort || FALLBACK_SORT;
  if (!sort) {
    return fallback;
  }
  const SORT_BY_MAP = {
    name: 'name',
    'name-desc': 'name',
    artist: 'artist',
    'artist-desc': 'artist',
    'releaseDate-asc': 'releaseDate',
    releaseDate: 'releaseDate',
    dateAdded: 'dateAdded',
    'dateAdded-desc': 'dateAdded',
  };
  const DIRECTIONS = {
    name: 'asc',
    'name-desc': 'desc',
    artist: 'asc',
    'artist-desc': 'desc',
    'releaseDate-asc': 'asc',
    releaseDate: 'desc',
    dateAdded: 'asc',
    'dateAdded-desc': 'desc',
  };
  const sortBy = SORT_BY_MAP[sort];
  const sortDirection = DIRECTIONS[sort];
  if (!sortBy || !sortDirection) {
    return fallback;
  }
  return {sortBy, sortDirection};
}

module.exports = {
  explodeSort,
  COMPARATORS: {
    asc: (a, b) => a > b ? 1 : a === b ? 0 : -1,
    desc: (a, b) => b > a ? 1 : b === a ? 0 : -1,
  },
  ALBUM_SORTERS: {
    name: (cpr) => (a, b) => cpr(a.title, b.title),
    artist: (cpr) => (a, b) => cpr(a.artist, b.artist),
    releaseDate: (cpr) => (a, b) => cpr(a.year, b.year),
    dateAdded: (cpr) => (a, b) => cpr(a.added, b.added),
  },
  ARTIST_SORTERS: {
    name: (cpr) => (a, b) => cpr(a.title, b.title),
  }
};
