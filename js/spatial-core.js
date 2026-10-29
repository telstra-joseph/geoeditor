(() => {
  'use strict';

  function create(records) {
    return new RBush().load(records);
  }

  function query(index, bounds) {
    if (!bounds) return [];
    return index.search(bounds).map(record => record.index).sort((first, second) => first - second);
  }

  globalThis.SpatialCore = { create, query };
})();