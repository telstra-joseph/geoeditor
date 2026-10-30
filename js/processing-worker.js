'use strict';

const task = new URL(self.location.href).searchParams.get('task');
if (task === 'mask') importScripts('../lib/turf.min.js', 'layer-mask.js?revision=2');
else if (task === 'export') importScripts('../lib/jszip.js', 'qgis-style.js', 'shapefile-writer.js', 'export-core.js?revision=2');
else if (task === 'table') importScripts('table-core.js');
else if (task === 'geometry') importScripts('../lib/turf.min.js', 'geometry-core.js');
else if (task === 'session') importScripts('../lib/jszip.js', 'session-core.js');
else throw new Error('Unsupported background task.');

self.onmessage = async event => {
  if (event.data.type !== 'run') return;
  try {
    if (task === 'session') {
      const value = await SessionCore.process(event.data.data, { onProgress: value => postMessage({ type: 'progress', value }) });
      if (value?.data instanceof ArrayBuffer) postMessage({ type: 'result', value }, [value.data]);
      else postMessage({ type: 'result', value });
      return;
    }
    if (task === 'geometry') {
      const value = await GeometryCore.analyze(event.data.data.features, { onProgress: value => postMessage({ type: 'progress', value }) });
      postMessage({ type: 'result', value });
      return;
    }
    if (task === 'table') {
      postMessage({ type: 'result', value: TableCore.query(event.data.data) });
      return;
    }
    if (task === 'export') {
      const data = event.data.data;
      const value = data.operation === 'zip' ? await ExportCore.pack(data.files) : await ExportCore.generate(data);
      const files = value.files || [{ data: value }];
      const buffers = [...new Set(files.map(file => file.data instanceof ArrayBuffer ? file.data : ArrayBuffer.isView(file.data) ? file.data.buffer : null).filter(Boolean))];
      postMessage({ type: 'result', value }, buffers);
      return;
    }
    const { polygons, features, exclude, preserve } = event.data.data;
    const mask = LayerMask.combine(polygons);
    const result = [];
    let reported = performance.now();
    features.forEach((feature, index) => {
      const clipped = preserve ? LayerMask.filter(feature, mask, exclude) : LayerMask.clip(feature, mask, exclude);
      if (clipped) result.push(clipped);
      if (performance.now() - reported >= 50 || index === features.length - 1) {
        postMessage({ type: 'progress', value: index + 1 });
        reported = performance.now();
      }
    });
    postMessage({ type: 'result', value: result });
  } catch (error) {
    postMessage({ type: 'error', message: error.message || String(error) });
  }
};

postMessage({ type: 'ready' });