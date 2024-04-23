const cacheManager = require('cache-manager');
const memoryCache = cacheManager.caching({store: 'memory', max: 100, ttl: 0});

const KEY = 'cacheAlbumList';

module.exports = {
  clear: () => {
    memoryCache.del(KEY, () => {});
  },
  get: () => new Promise((resolve, reject) => {
    memoryCache.get(KEY, function (err, cached) {
      if (err) {
        reject(err);
        return;
      }
      if (!Array.isArray(cached)) {
        // treat old cache with whole response as null
        resolve(null);
        return;
      }
      resolve(cached);
    });
  }),
  set: (data) => {
    memoryCache.set(KEY, data);
  }
};
