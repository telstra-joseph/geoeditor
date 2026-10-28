(() => {
  'use strict';

  const KML_STYLE_KEYS = new Set([
    'stroke', 'stroke-width', 'stroke-opacity', 'fill', 'fill-opacity',
    'marker-color', 'marker-size', 'marker-symbol', 'styleUrl', 'styleHash',
    'styleMapHash', 'icon', 'visibility', 'drawOrder', 'description-html',
    'icon-color', 'icon-opacity', 'icon-scale', 'icon-offset', 'icon-offset-units', 'label-color', 'label-opacity', 'label-scale',
  ]);

  function normalizeValue(value) {
    if (value === undefined) return null;
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    return JSON.stringify(value);
  }

  function explodeGeometry(geometry, out) {
    if (!geometry) return;
    if (geometry.type === 'GeometryCollection') geometry.geometries.forEach(item => explodeGeometry(item, out));
    else if (geometry.type === 'MultiPoint') geometry.coordinates.forEach(coordinates => out.push({ type: 'Point', coordinates }));
    else out.push(geometry);
  }

  function inferType(values) {
    const present = values.filter(value => value !== null && value !== '');
    if (!present.length) return 'string';
    if (present.every(value => typeof value === 'number')) return 'number';
    if (present.every(value => typeof value === 'boolean')) return 'boolean';
    return 'string';
  }

  function fromKml(dom, converter) {
    const features = [];
    const kmlFolders = [];
    function visit(node, folderIds) {
      if (node.type === 'Feature') {
        features.push({ ...node, kml: { folderIds: folderIds.slice() } });
        return;
      }
      if (node.type === 'folder') {
        const id = `folder-${kmlFolders.length}`;
        kmlFolders.push({
          id, parentId: folderIds.at(-1) || null,
          name: node.meta?.name || 'Untitled folder',
          visible: String(node.meta?.visibility ?? '1') !== '0',
          expanded: false,
        });
        folderIds = [...folderIds, id];
      }
      (node.children || []).forEach(child => visit(child, folderIds));
    }
    visit(converter.kmlWithFolders(dom), []);
    return { type: 'FeatureCollection', features, kmlFolders };
  }

  function prepare(collection, format) {
    const isKml = format === 'kml' || format === 'kmz';
    const features = [];
    const order = [];
    const seen = new Set();
    let skipped = 0;
    let split = 0;
    (collection.features || []).forEach(feature => {
      if (!feature || !feature.geometry) { skipped++; return; }
      const geometries = [];
      explodeGeometry(feature.geometry, geometries);
      if (!geometries.length) { skipped++; return; }
      if (geometries.length > 1) split++;
      geometries.forEach(geometry => {
        const properties = {};
        const style = {};
        Object.entries(feature.properties || {}).forEach(([key, value]) => {
          if (isKml && KML_STYLE_KEYS.has(key)) { style[key] = value; return; }
          properties[key] = normalizeValue(value);
          if (!seen.has(key)) { seen.add(key); order.push(key); }
        });
        const prepared = { type: 'Feature', properties, geometry, style };
        if (isKml && Array.isArray(feature.kml?.folderIds)) prepared.kml = { ...feature.kml, folderIds: [...feature.kml.folderIds] };
        features.push(prepared);
      });
    });
    const types = {};
    order.forEach(key => { types[key] = inferType(features.map(feature => feature.properties[key])); });
    const families = new Set(features.map(feature => /Point/.test(feature.geometry.type) ? 'Point' : /Line/.test(feature.geometry.type) ? 'Line' : 'Polygon'));
    const geomType = format === 'shp' && families.size === 1 ? [...families][0] : 'Mixed';
    return { features, fields: order, types, geomType, skipped, split, kmlFolders: isKml ? collection.kmlFolders || [] : [] };
  }

  function lonLatLooksValid(features) {
    let bad = false;
    const check = coordinates => {
      if (typeof coordinates[0] === 'number') {
        if (Math.abs(coordinates[0]) > 180 || Math.abs(coordinates[1]) > 90) bad = true;
      } else coordinates.forEach(check);
    };
    for (const feature of features) { check(feature.geometry.coordinates); if (bad) return false; }
    return true;
  }

  globalThis.ImportCore = { prepare, lonLatLooksValid, fromKml };
})();