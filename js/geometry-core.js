(() => {
  'use strict';

  async function analyze(features, { signal, onProgress } = {}) {
    const report = { featureCount: features.length, validFeatures: 0, invalidFeatures: 0, emptyFeatures: 0,
      geometryTypes: {}, areaSquareMetres: 0, lineLengthMetres: 0, bounds: null, numericFields: [], issues: [], issuesTruncated: false };
    const fields = new Map();
    const bounds = [Infinity, Infinity, -Infinity, -Infinity];
    let started = performance.now();
    for (const [index, feature] of features.entries()) {
      signal?.throwIfAborted();
      Object.entries(feature?.properties || {}).forEach(([name, value]) => {
        if (typeof value !== 'number' || !Number.isFinite(value)) return;
        if (!fields.has(name)) fields.set(name, { name, count: 0, min: value, max: value, mean: 0 });
        const field = fields.get(name);
        field.count++;
        field.min = Math.min(field.min, value);
        field.max = Math.max(field.max, value);
        field.mean += (value - field.mean) / field.count;
      });
      try {
        if (!feature?.geometry) { report.emptyFeatures++; throw new Error('Missing geometry'); }
        const type = feature.geometry.type;
        report.geometryTypes[type] = (report.geometryTypes[type] || 0) + 1;
        let coordinates = 0;
        turf.coordEach(feature, coordinate => {
          if (coordinate.length < 2 || !coordinate.every(Number.isFinite) || Math.abs(coordinate[0]) > 180 || Math.abs(coordinate[1]) > 90) throw new Error('Invalid longitude/latitude coordinates');
          coordinates++;
          bounds[0] = Math.min(bounds[0], coordinate[0]);
          bounds[1] = Math.min(bounds[1], coordinate[1]);
          bounds[2] = Math.max(bounds[2], coordinate[0]);
          bounds[3] = Math.max(bounds[3], coordinate[1]);
        });
        if (!coordinates) { report.emptyFeatures++; throw new Error('Empty geometry'); }
        let area = 0;
        let length = 0;
        turf.geomEach(feature, geometry => {
          if (!geometry || !turf.booleanValid(turf.feature(geometry))) throw new Error('Invalid geometry structure or topology');
          if (/Polygon$/.test(geometry.type)) {
            if (turf.kinks(turf.feature(geometry)).features.length) throw new Error('Self-intersecting polygon');
            area += turf.area(turf.feature(geometry));
          } else if (/LineString$/.test(geometry.type)) length += turf.length(turf.feature(geometry), { units: 'kilometers' }) * 1000;
        });
        report.areaSquareMetres += area;
        report.lineLengthMetres += length;
        report.validFeatures++;
      } catch (error) {
        report.invalidFeatures++;
        if (report.issues.length < 1000) report.issues.push({ feature: index + 1, message: error.message });
        else report.issuesTruncated = true;
      }
      if (performance.now() - started >= 8 || index + 1 === features.length) {
        onProgress?.(index + 1);
        await new Promise(resolve => setTimeout(resolve, 0));
        started = performance.now();
      }
    }
    report.bounds = bounds.every(Number.isFinite) ? bounds : null;
    report.numericFields = [...fields.values()];
    return report;
  }

  globalThis.GeometryCore = { analyze };
})();