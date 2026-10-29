(() => {
  'use strict';

  const entries = new Map();
  const pending = new Map();
  let worker = null;
  let startup = null;
  let rejectStartup = null;
  let startupTimer = null;
  let unavailable = false;
  let sequence = 0;

  function stop(error) {
    clearTimeout(startupTimer);
    startupTimer = null;
    rejectStartup?.(error);
    rejectStartup = null;
    worker?.terminate();
    worker = null;
    startup = null;
    entries.forEach(entry => { entry.sent = false; });
    pending.forEach(request => request.reject(error));
    pending.clear();
  }

  function connect() {
    if (startup) return startup;
    startup = new Promise((resolve, reject) => {
      rejectStartup = reject;
      let ready = false;
      const fail = error => {
        clearTimeout(startupTimer);
        unavailable = true;
        reject(error);
        stop(error);
      };
      try {
        worker = new Worker(new URL('js/spatial-worker.js', document.baseURI));
        startupTimer = setTimeout(() => fail(new Error('Spatial worker startup timed out.')), 5000);
        worker.onerror = event => { event.preventDefault(); fail(new Error(event.message || 'Spatial worker failed.')); };
        worker.onmessageerror = () => fail(new Error('Invalid spatial worker response.'));
        worker.onmessage = event => {
          if (event.data.ready && !ready) {
            ready = true;
            rejectStartup = null;
            clearTimeout(startupTimer);
            startupTimer = null;
            resolve();
            return;
          }
          const request = pending.get(event.data.id);
          if (!request) return;
          pending.delete(event.data.id);
          if (event.data.error) request.reject(new Error(event.data.error));
          else request.resolve(event.data.value);
        };
      } catch (error) { fail(error); }
    });
    return startup;
  }

  async function query(key, records, bounds) {
    let entry = entries.get(key);
    if (!entry || entry.records !== records) {
      entry = { records, sent: false, local: null };
      entries.set(key, entry);
    }
    if (!unavailable && typeof Worker === 'function' && /^https?:$/.test(new URL(document.baseURI).protocol)) {
      try {
        await connect();
        if (entries.get(key) !== entry) return [];
        return await new Promise((resolve, reject) => {
          const id = ++sequence;
          pending.set(id, { resolve, reject, key });
          try {
            worker.postMessage({ id, key, records: entry.sent ? undefined : records, bounds });
            entry.sent = true;
          } catch (error) { pending.delete(id); reject(error); }
        });
      } catch (error) {
        if (error.name === 'AbortError' || entries.get(key) !== entry) return [];
        unavailable = true;
        stop(error);
      }
    }
    entry.local ||= SpatialCore.create(records);
    return SpatialCore.query(entry.local, bounds);
  }

  function release(key) {
    entries.delete(key);
    worker?.postMessage({ key, remove: true });
    pending.forEach((request, id) => {
      if (request.key !== key) return;
      request.resolve([]);
      pending.delete(id);
    });
    if (!entries.size) stop(new DOMException('Spatial indexes released.', 'AbortError'));
  }

  window.SpatialQueries = { query, release };
})();