(() => {
  'use strict';

  function combine(polygons) {
    if (!polygons.length) throw new Error('The mask has no polygons.');
    const features = polygons.map(feature => turf.feature(structuredClone(feature.geometry)));
    return features.length === 1 ? features[0] : turf.union(turf.featureCollection(features));
  }

  function clipGeometry(geometry, mask, exclude) {
    if (!geometry) return null;
    if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
      const operation = exclude ? turf.difference : turf.intersect;
      return operation(turf.featureCollection([turf.feature(geometry), mask]))?.geometry || null;
    }
    if (geometry.type === 'Point' || geometry.type === 'MultiPoint') {
      const points = geometry.type === 'Point' ? [geometry.coordinates] : geometry.coordinates;
      const inside = points.filter(coordinates => turf.booleanPointInPolygon(turf.point(coordinates), mask) !== exclude);
      if (!inside.length) return null;
      return geometry.type === 'Point' ? { type: 'Point', coordinates: inside[0] } : { type: 'MultiPoint', coordinates: inside };
    }
    if (geometry.type === 'LineString' || geometry.type === 'MultiLineString') {
      const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
      const inside = lines.flatMap(coordinates => {
        const line = turf.lineString(coordinates);
        const split = turf.lineSplit(line, mask).features;
        return (split.length ? split : [line]).filter(segment => {
          const middle = turf.center(turf.lineString(segment.geometry.coordinates.slice(0, 2)));
          return turf.booleanPointInPolygon(middle, mask) !== exclude;
        }).map(segment => segment.geometry.coordinates);
      });
      if (!inside.length) return null;
      return inside.length === 1 && geometry.type === 'LineString' ? { type: 'LineString', coordinates: inside[0] } : { type: 'MultiLineString', coordinates: inside };
    }
    if (geometry.type === 'GeometryCollection') {
      const geometries = geometry.geometries.map(part => clipGeometry(part, mask, exclude)).filter(Boolean);
      return geometries.length ? { type: 'GeometryCollection', geometries } : null;
    }
    throw new Error(`Unsupported geometry: ${geometry.type}`);
  }

  function clip(feature, mask, exclude = false) {
    const geometry = clipGeometry(feature.geometry, mask, exclude);
    if (!geometry) return null;
    const result = structuredClone(feature);
    delete result.bbox;
    return { ...result, geometry };
  }

  globalThis.LayerMask = { combine, clip };
})();