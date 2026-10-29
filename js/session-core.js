(() => {
  'use strict';

  function geometryValid(geometry) {
    if (!geometry || typeof geometry !== 'object') return false;
    if (geometry.type === 'GeometryCollection') return Array.isArray(geometry.geometries) && geometry.geometries.every(geometryValid);
    if (!['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'].includes(geometry.type)) return false;
    const depths = { Point: 0, MultiPoint: 1, LineString: 1, MultiLineString: 2, Polygon: 2, MultiPolygon: 3 };
    const stack = [[geometry.coordinates, depths[geometry.type]]];
    while (stack.length) {
      const [coordinates, depth] = stack.pop();
      if (!Array.isArray(coordinates) || !coordinates.length) return false;
      if (depth === 0) {
        if (coordinates.length < 2 || !coordinates.every(Number.isFinite)) return false;
      } else coordinates.forEach(value => stack.push([value, depth - 1]));
    }
    return true;
  }

  async function validate(session, { signal, onProgress } = {}) {
    if (session?.version !== 1 || !Array.isArray(session.layers) ||
        !Array.isArray(session.view?.center) || session.view.center.length !== 2 || !session.view.center.every(Number.isFinite) ||
        !Number.isFinite(session.view.zoom)) throw new Error('The saved session is invalid or uses an unsupported version.');
    let featureCount = 0;
    let started = performance.now();
    for (const layer of session.layers) {
      if (!layer || !Array.isArray(layer.features) || !Array.isArray(layer.fields) ||
          !layer.fields.every(field => typeof field === 'string') || !['Point', 'Line', 'Polygon', 'Mixed'].includes(layer.geomType) ||
          typeof layer.name !== 'string' || (layer.kmlFolders && !Array.isArray(layer.kmlFolders))) throw new Error('The saved session contains an invalid layer.');
      for (const feature of layer.features) {
        signal?.throwIfAborted();
        if (feature?.type !== 'Feature' || !geometryValid(feature.geometry)) throw new Error(`The saved layer "${layer.name}" contains invalid geometry.`);
        featureCount++;
        if (performance.now() - started >= 8) {
          onProgress?.(featureCount);
          await new Promise(resolve => setTimeout(resolve, 0));
          started = performance.now();
        }
      }
    }
    return { layerCount: session.layers.length, featureCount };
  }

  async function pack(session) {
    const text = JSON.stringify(structuredClone(session));
    const zip = new JSZip();
    zip.file('session.json', text);
    const data = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE', compressionOptions: { level: 1 } });
    return { geoEditorEncoding: 'zip-v1', data };
  }

  async function unpack(stored) {
    if (stored?.geoEditorEncoding !== 'zip-v1') return stored;
    const zip = await JSZip.loadAsync(stored.data, { checkCRC32: true });
    const file = zip.file('session.json');
    if (!file) throw new Error('The saved session archive is invalid.');
    return JSON.parse(await file.async('string'));
  }

  async function process(data, options) {
    if (data.operation === 'pack') return pack(data.session);
    if (data.operation === 'unpack') return unpack(data.stored);
    if (data.operation === 'validate') return validate(data.session, options);
    throw new Error('Unsupported session operation.');
  }

  globalThis.SessionCore = { pack, unpack, validate, process };
})();