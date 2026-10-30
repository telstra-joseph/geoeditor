(() => {
  'use strict';

  const xmlEsc = value => String(value).replace(/[<>&"']/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[character]));

  function csv(layer) {
    const cell = value => {
      const text = value == null ? '' : String(value);
      return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const rows = [layer.fields.map(cell).join(',')];
    layer.features.forEach(feature => rows.push(layer.fields.map(field => cell(feature.properties[field])).join(',')));
    return '\uFEFF' + rows.join('\r\n');
  }

  function kmlColor(hex, opacity) {
    const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    const color = match ? match[1] : '2563eb';
    const alpha = Math.round(255 * Math.min(1, Math.max(0, isNaN(Number(opacity)) ? 1 : Number(opacity)))).toString(16).padStart(2, '0');
    return alpha + color.slice(4, 6) + color.slice(2, 4) + color.slice(0, 2);
  }

  const kmlCoords = coordinates => coordinates.map(point => point.slice(0, 3).join(',')).join(' ');
  const kmlPolygon = rings => '<Polygon>' + rings.map((ring, index) => `<${index ? 'inner' : 'outer'}BoundaryIs><LinearRing><coordinates>${kmlCoords(ring)}</coordinates></LinearRing></${index ? 'inner' : 'outer'}BoundaryIs>`).join('') + '</Polygon>';

  function kmlGeometry(geometry) {
    switch (geometry.type) {
      case 'Point': return `<Point><coordinates>${geometry.coordinates.slice(0, 3).join(',')}</coordinates></Point>`;
      case 'LineString': return `<LineString><coordinates>${kmlCoords(geometry.coordinates)}</coordinates></LineString>`;
      case 'Polygon': return kmlPolygon(geometry.coordinates);
      case 'MultiLineString': return '<MultiGeometry>' + geometry.coordinates.map(line => kmlGeometry({ type: 'LineString', coordinates: line })).join('') + '</MultiGeometry>';
      case 'MultiPolygon': return '<MultiGeometry>' + geometry.coordinates.map(polygon => kmlPolygon(polygon)).join('') + '</MultiGeometry>';
      default: return '';
    }
  }

  function kml(layer) {
    const styles = new Map();
    const placemarks = layer.features.map(feature => {
      const style = feature.style || {};
      const appearance = { stroke: layer.color, fill: layer.color, ...style, 'marker-color': style['marker-color'] || style['icon-color'] || layer.color };
      let styleXml;
      if (feature.geometry.type === 'Point') {
        const offset = style['icon-offset'];
        const units = style['icon-offset-units'] || ['fraction', 'fraction'];
        const hotSpot = Array.isArray(offset) ? `<hotSpot x="${xmlEsc(offset[0])}" y="${xmlEsc(offset[1])}" xunits="${xmlEsc(units[0])}" yunits="${xmlEsc(units[1])}"/>` : '';
        styleXml = `<IconStyle><color>${kmlColor(appearance['marker-color'], style['icon-opacity'] ?? 1)}</color><scale>${xmlEsc(style['icon-scale'] ?? 1)}</scale><Icon><href>${xmlEsc(style.icon || 'http://maps.google.com/mapfiles/kml/pushpin/wht-pushpin.png')}</href></Icon>${hotSpot}</IconStyle>`;
      } else {
        styleXml = `<LineStyle><color>${kmlColor(appearance.stroke, appearance['stroke-opacity'])}</color><width>${Number(appearance['stroke-width'] ?? 2)}</width></LineStyle>`;
        if (/Polygon/.test(feature.geometry.type)) styleXml += `<PolyStyle><color>${kmlColor(appearance.fill, appearance['fill-opacity'] === undefined ? 0.4 : appearance['fill-opacity'])}</color></PolyStyle>`;
      }
      if (['label-color', 'label-opacity', 'label-scale'].some(key => key in style)) {
        styleXml += `<LabelStyle><color>${kmlColor(style['label-color'] || '#ffffff', style['label-opacity'] ?? 1)}</color><scale>${xmlEsc(style['label-scale'] ?? 1)}</scale></LabelStyle>`;
      }
      if (!styles.has(styleXml)) styles.set(styleXml, 's' + (styles.size + 1));
      const value = field => feature.properties[field] == null ? '' : String(feature.properties[field]);
      const extra = layer.fields.filter(field => field !== 'name' && field !== 'description' && value(field) !== '');
      return '<Placemark>' +
        (value('name') ? `<name>${xmlEsc(value('name'))}</name>` : '') +
        (value('description') ? `<description>${xmlEsc(value('description'))}</description>` : '') +
        ('visibility' in style ? `<visibility>${style.visibility === false || String(style.visibility) === '0' ? 0 : 1}</visibility>` : '') +
        `<styleUrl>#${styles.get(styleXml)}</styleUrl>` +
        (extra.length ? '<ExtendedData>' + extra.map(field => `<Data name="${xmlEsc(field)}"><value>${xmlEsc(value(field))}</value></Data>`).join('') + '</ExtendedData>' : '') +
        kmlGeometry(feature.geometry) + '</Placemark>';
    });
    const folders = new Map((layer.kmlFolders || []).map(folder => [folder.id, { folder, children: [], placemarks: [] }]));
    const roots = [];
    folders.forEach(node => {
      const parent = folders.get(node.folder.parentId);
      (parent ? parent.children : roots).push(node);
    });
    const ungrouped = [];
    placemarks.forEach((placemark, index) => {
      const folderId = [...(layer.features[index].kml?.folderIds || [])].reverse().find(id => folders.has(id));
      (folders.get(folderId)?.placemarks || ungrouped).push(placemark);
    });
    const content = [...ungrouped];
    const pending = roots.slice().reverse();
    while (pending.length) {
      const node = pending.pop();
      if (typeof node === 'string') { content.push(node); continue; }
      content.push(`<Folder><name>${xmlEsc(node.folder.name)}</name><visibility>${node.folder.visible === false ? 0 : 1}</visibility><open>${node.folder.expanded ? 1 : 0}</open>`);
      node.placemarks.forEach(placemark => content.push(placemark));
      pending.push('</Folder>');
      for (let index = node.children.length - 1; index >= 0; index--) pending.push(node.children[index]);
    }
    const styleXml = [...styles].map(([xml, id]) => `<Style id="${id}">${xml}</Style>`).join('');
    return '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>' +
      `<name>${xmlEsc(layer.name)}</name>${styleXml}${content.join('')}</Document></kml>`;
  }

  async function pack(files) {
    const zip = new JSZip();
    files.forEach(file => zip.file(file.name, file.data));
    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  }

  async function generate({ layer, format, base, options }) {
    const warnings = [];
    if (format === 'shp') {
      if (!layer.features.length) return { files: [], warnings: [`\u201c${layer.name}\u201d has no features, so no shapefile was written.`] };
      const output = ShapefileWriter.writeShapefiles(base, layer.features, options ? options.fields : layer.fields, layer.types, {
        categoryField: options ? options.categoryField : null,
        includeStyle: options ? options.includeStyle : false,
        legendSort: options ? options.legendSort : null,
      });
      return { files: output.files, warnings: output.warnings.map(warning => `${layer.name}: ${warning}`) };
    }
    if (format === 'kml') return { files: [{ name: base + '.kml', data: kml(layer) }], warnings };
    if (format === 'kmz') return { files: [{ name: base + '.kmz', data: await pack([{ name: 'doc.kml', data: kml(layer) }]) }], warnings };
    if (format === 'csv') return { files: [{ name: base + '.csv', data: csv(layer) }], warnings };
    const collection = { type: 'FeatureCollection', features: layer.features.map(({ type, properties, geometry }) => ({ type, properties, geometry })) };
    return { files: [{ name: base + '.geojson', data: JSON.stringify(collection, null, 2) }], warnings };
  }

  globalThis.ExportCore = { generate, pack };
})();