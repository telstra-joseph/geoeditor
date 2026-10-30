(() => {
  'use strict';

  function run(task, data, { signal, onProgress, fallback } = {}) {
    signal?.throwIfAborted();
    if (typeof Worker !== 'function' || !/^https?:$/.test(new URL(document.baseURI).protocol)) {
      return Promise.resolve().then(fallback);
    }
    let worker;
    try {
      const url = new URL('js/processing-worker.js', document.baseURI);
      url.searchParams.set('task', task);
      if (task === 'mask' || task === 'export') url.searchParams.set('revision', '2');
      worker = new Worker(url);
    } catch { return Promise.resolve().then(fallback); }
    return new Promise((resolve, reject) => {
      let ready = false;
      let settled = false;
      const finish = (error, value, useFallback = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        worker.terminate();
        if (error) reject(error);
        else if (useFallback) Promise.resolve().then(() => {
          signal?.throwIfAborted();
          return fallback();
        }).then(resolve, reject);
        else resolve(value);
      };
      const abort = () => finish(signal.reason);
      const timer = setTimeout(() => { if (!ready) finish(null, null, true); }, 5000);
      signal?.addEventListener('abort', abort, { once: true });
      worker.onerror = event => {
        event.preventDefault();
        finish(ready ? new Error(event.message || 'Background processing failed.') : null, null, !ready);
      };
      worker.onmessageerror = () => finish(new Error('Could not receive background processing data.'));
      worker.onmessage = event => {
        if (settled) return;
        const message = event.data;
        try {
          if (message.type === 'ready') {
            ready = true;
            clearTimeout(timer);
            signal?.throwIfAborted();
            worker.postMessage({ type: 'run', data });
          } else if (message.type === 'progress') onProgress?.(message.value);
          else if (message.type === 'result') finish(null, message.value);
          else if (message.type === 'error') finish(new Error(message.message));
        } catch (error) { finish(error); }
      };
      if (signal?.aborted) abort();
    });
  }

  window.BackgroundTasks = { run };
})();