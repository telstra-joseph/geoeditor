'use strict';

importScripts('../lib/rbush.js', 'spatial-core.js');
const indexes = new Map();
self.onmessage = event => {
  const { id, key, records, bounds, remove } = event.data;
  if (remove) { indexes.delete(key); return; }
  try {
    if (records) indexes.set(key, SpatialCore.create(records));
    const index = indexes.get(key);
    if (!index) throw new Error('Spatial index is unavailable.');
    postMessage({ id, value: SpatialCore.query(index, bounds) });
  } catch (error) { postMessage({ id, error: error.message }); }
};
postMessage({ ready: true });