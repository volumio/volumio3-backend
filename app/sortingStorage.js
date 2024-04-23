const storage = {};

class SortingStorage {
  get (key, fallback) {
    return storage[key] || fallback;
  }

  set (key, value) {
    storage[key] = value;
  }
}

module.exports = SortingStorage;
