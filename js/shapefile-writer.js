/* Minimal ESRI Shapefile writer (SHP/SHX/DBF/PRJ/CPG) for WGS84 GeoJSON features. */
(function (global) {
  'use strict';

  const PRJ_WGS84 =
    'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]],' +
    'PRIMEM["Greenwich",0],UNIT["Degree",0.0174532925199433]]';

  const SHP = { POINT: 1, POLYLINE: 3, POLYGON: 5, MULTIPOINT: 8 };
  const encoder = new TextEncoder();

  function family(type) {
    if (type === 'Point' || type === 'MultiPoint') return 'point';
    if (type === 'LineString' || type === 'MultiLineString') return 'line';
    if (type === 'Polygon' || type === 'MultiPolygon') return 'polygon';
    return null;
  }

  function ringArea(ring) {
    let s = 0;
    for (let i = 0; i < ring.length - 1; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    return s / 2;
  }

  function closeRing(ring) {
    const f = ring[0];
    const l = ring[ring.length - 1];
    return f[0] === l[0] && f[1] === l[1] ? ring : ring.concat([f]);
  }

  // Shapefile polygons: outer rings clockwise, holes counter-clockwise.
  function orient(ring, clockwise) {
    const isCw = ringArea(ring) < 0;
    return isCw === clockwise ? ring : ring.slice().reverse();
  }

  function validRing(r) {
    if (!r || r.length < 3) return null;
    const closed = closeRing(r);
    return closed.length >= 4 ? closed : null;
  }

  function polygonParts(rings) {
    const outer = validRing(rings[0]);
    if (!outer) return [];
    const out = [orient(outer, true)];
    rings.slice(1).forEach((r) => {
      const hole = validRing(r);
      if (hole) out.push(orient(hole, false));
    });
    return out;
  }

  // Returns the list of point arrays that make up the shape, or [] if the geometry is unusable.
  function partsOf(geom) {
    const c = geom.coordinates;
    switch (geom.type) {
      case 'Point': return [[c]];
      case 'MultiPoint': return c.length ? [c] : [];
      case 'LineString': return c.length >= 2 ? [c] : [];
      case 'MultiLineString': return c.filter((l) => l.length >= 2);
      case 'Polygon': return polygonParts(c);
      case 'MultiPolygon': return c.reduce((acc, p) => acc.concat(polygonParts(p)), []);
      default: return [];
    }
  }

  function buildShpShx(shapes, shapeType) {
    let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
    const sizes = shapes.map((parts) => {
      const npts = parts.reduce((n, p) => n + p.length, 0);
      parts.forEach((p) => p.forEach((pt) => {
        if (pt[0] < xmin) xmin = pt[0];
        if (pt[0] > xmax) xmax = pt[0];
        if (pt[1] < ymin) ymin = pt[1];
        if (pt[1] > ymax) ymax = pt[1];
      }));
      if (shapeType === SHP.POINT) return 20;
      if (shapeType === SHP.MULTIPOINT) return 40 + 16 * npts;
      return 44 + 4 * parts.length + 16 * npts;
    });
    const shpLen = 100 + sizes.reduce((a, s) => a + 8 + s, 0);
    const shxLen = 100 + 8 * shapes.length;
    const shp = new DataView(new ArrayBuffer(shpLen));
    const shx = new DataView(new ArrayBuffer(shxLen));

    [[shp, shpLen], [shx, shxLen]].forEach(([dv, len]) => {
      dv.setInt32(0, 9994, false);
      dv.setInt32(24, len / 2, false);
      dv.setInt32(28, 1000, true);
      dv.setInt32(32, shapeType, true);
      dv.setFloat64(36, xmin, true);
      dv.setFloat64(44, ymin, true);
      dv.setFloat64(52, xmax, true);
      dv.setFloat64(60, ymax, true);
    });

    let off = 100;
    shapes.forEach((parts, i) => {
      const size = sizes[i];
      shx.setInt32(100 + i * 8, off / 2, false);
      shx.setInt32(104 + i * 8, size / 2, false);
      shp.setInt32(off, i + 1, false);
      shp.setInt32(off + 4, size / 2, false);
      let p = off + 8;
      shp.setInt32(p, shapeType, true);
      p += 4;
      if (shapeType === SHP.POINT) {
        shp.setFloat64(p, parts[0][0][0], true);
        shp.setFloat64(p + 8, parts[0][0][1], true);
      } else {
        let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
        parts.forEach((pt) => pt.forEach((c) => {
          bx0 = Math.min(bx0, c[0]); bx1 = Math.max(bx1, c[0]);
          by0 = Math.min(by0, c[1]); by1 = Math.max(by1, c[1]);
        }));
        shp.setFloat64(p, bx0, true);
        shp.setFloat64(p + 8, by0, true);
        shp.setFloat64(p + 16, bx1, true);
        shp.setFloat64(p + 24, by1, true);
        p += 32;
        const npts = parts.reduce((n, q) => n + q.length, 0);
        if (shapeType === SHP.MULTIPOINT) {
          shp.setInt32(p, npts, true);
          p += 4;
        } else {
          shp.setInt32(p, parts.length, true);
          shp.setInt32(p + 4, npts, true);
          p += 8;
          let idx = 0;
          parts.forEach((q) => { shp.setInt32(p, idx, true); p += 4; idx += q.length; });
        }
        parts.forEach((q) => q.forEach((c) => {
          shp.setFloat64(p, c[0], true);
          shp.setFloat64(p + 8, c[1], true);
          p += 16;
        }));
      }
      off += 8 + size;
    });
    return { shp: new Uint8Array(shp.buffer), shx: new Uint8Array(shx.buffer) };
  }

  function dbfFieldNames(fields, warnings) {
    const used = new Set();
    return fields.map((f) => {
      const base = String(f).replace(/[^A-Za-z0-9_]/g, '_').slice(0, 10) || 'FIELD';
      let name = base;
      let n = 1;
      while (used.has(name.toUpperCase())) {
        const suffix = '_' + n++;
        name = base.slice(0, 10 - suffix.length) + suffix;
      }
      used.add(name.toUpperCase());
      if (name !== f) warnings.push(`Field "${f}" was written as "${name}" (DBF names are limited to 10 ASCII characters).`);
      return name;
    });
  }

  function decimals(v) {
    const s = String(v);
    if (/e/i.test(s)) return 10;
    const i = s.indexOf('.');
    return i < 0 ? 0 : s.length - i - 1;
  }

  function planField(values, declared) {
    const present = values.filter((v) => v !== null && v !== undefined && v !== '');
    const allNum = present.length > 0 && present.every((v) => typeof v === 'number' && isFinite(v) && Math.abs(v) < 1e18);
    if (allNum) {
      const dec = Math.min(15, present.reduce((m, v) => Math.max(m, decimals(v)), 0));
      const len = Math.min(255, Math.max(1, ...present.map((v) => v.toFixed(dec).length)));
      return { type: 'N', len, dec };
    }
    if (!present.length && declared === 'number') return { type: 'N', len: 10, dec: 0 };
    if (present.length > 0 && present.every((v) => typeof v === 'boolean')) return { type: 'L', len: 1, dec: 0 };
    if (!present.length && declared === 'boolean') return { type: 'L', len: 1, dec: 0 };
    const len = Math.min(254, Math.max(1, ...present.map((v) => encoder.encode(String(v)).length)));
    return { type: 'C', len, dec: 0 };
  }

  function buildDbf(rows, fields, declaredTypes, warnings) {
    let cols = fields.map((f) => ({ key: f, spec: planField(rows.map((r) => r[f]), declaredTypes[f]) }));
    let names = dbfFieldNames(fields, warnings);
    if (!cols.length) {
      cols = [{ key: null, spec: { type: 'N', len: 10, dec: 0 } }];
      names = ['ID'];
    }
    const recLen = 1 + cols.reduce((n, c) => n + c.spec.len, 0);
    const headLen = 32 + 32 * cols.length + 1;
    const buf = new Uint8Array(headLen + recLen * rows.length + 1);
    const dv = new DataView(buf.buffer);
    const now = new Date();
    buf[0] = 3;
    buf[1] = now.getFullYear() - 1900;
    buf[2] = now.getMonth() + 1;
    buf[3] = now.getDate();
    dv.setUint32(4, rows.length, true);
    dv.setUint16(8, headLen, true);
    dv.setUint16(10, recLen, true);
    cols.forEach((c, i) => {
      const o = 32 + i * 32;
      buf.set(encoder.encode(names[i]), o);
      buf[o + 11] = c.spec.type.charCodeAt(0);
      buf[o + 16] = c.spec.len;
      buf[o + 17] = c.spec.dec;
    });
    buf[32 + 32 * cols.length] = 0x0d;

    let p = headLen;
    rows.forEach((row, ri) => {
      buf[p++] = 0x20;
      cols.forEach((c) => {
        const { type, len, dec } = c.spec;
        const v = c.key === null ? ri + 1 : row[c.key];
        const empty = v === null || v === undefined || v === '';
        let bytes;
        if (type === 'L') bytes = encoder.encode(empty ? '?' : v ? 'T' : 'F');
        else if (type === 'N') bytes = encoder.encode((empty ? '' : Number(v).toFixed(dec)).padStart(len, ' '));
        else bytes = empty ? new Uint8Array(0) : encoder.encode(String(v));
        buf.fill(0x20, p, p + len);
        buf.set(bytes.length > len ? bytes.slice(0, len) : bytes, p);
        p += len;
      });
    });
    buf[p] = 0x1a;
    return { data: buf, columns: cols.map((c, i) => ({ ...c, name: names[i] })) };
  }

  const xmlEsc = (s) => String(s).replace(/[<>&"'\r\n\t]/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
    '\r': '&#13;', '\n': '&#10;', '\t': '&#9;',
  }[c]));

  const legendCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  const emptyLegendValue = (value) => value === null || value === undefined || value === '';
  function compareLegendValues(a, b, numeric) {
    if (numeric) {
      const first = Number(a);
      const second = Number(b);
      return first === second ? 0 : first < second ? -1 : 1;
    }
    return legendCollator.compare(String(a), String(b));
  }

  function qgisCategoryStyle(dbf, field, fam, rows, legendSort, declaredTypes) {
    const index = dbf.columns.findIndex((c) => c.key === field);
    const column = dbf.columns[index];
    const dv = new DataView(dbf.data.buffer);
    const headerLength = dv.getUint16(8, true);
    const recordLength = dv.getUint16(10, true);
    const offset = 1 + dbf.columns.slice(0, index).reduce((sum, c) => sum + c.spec.len, 0);
    const decoder = new TextDecoder('utf-8');
    const values = new Map();
    const sortType = legendSort && declaredTypes[legendSort.field];
    const numericSort = legendSort && (sortType === 'number' || (!sortType && rows.every((row) => emptyLegendValue(row[legendSort.field]) || typeof row[legendSort.field] === 'number')));
    const compareSort = (a, b) => compareLegendValues(a, b, numericSort);
    // Categorize the values actually written to DBF, including rounding and text truncation.
    for (let i = 0; i < rows.length; i++) {
      const start = headerLength + i * recordLength + offset;
      const raw = decoder.decode(dbf.data.subarray(start, start + column.spec.len)).replace(/ +$/, '');
      let value = raw;
      let type = 'string';
      const empty = column.spec.type === 'C' ? !raw : !raw.trim() || raw === '?';
      if (empty) { value = 'NULL'; type = 'NULL'; }
      if (type !== 'NULL' && column.spec.type === 'N') {
        value = String(Number(raw));
        type = 'double';
      }
      if (type !== 'NULL' && column.spec.type === 'L') value = raw === 'T' ? 'true' : 'false';
      const key = JSON.stringify([type, value]);
      let entry = values.get(key);
      if (!entry) {
        entry = { type, value, index: values.size, sortValue: null };
        values.set(key, entry);
      }
      if (legendSort) {
        const sortValue = rows[i][legendSort.field];
        if (!emptyLegendValue(sortValue) && ((numericSort && !Number.isFinite(Number(sortValue))) || (typeof sortValue === 'number' && !Number.isFinite(sortValue)))) throw new Error(`Invalid numeric value in legend sort column "${legendSort.field}".`);
        if (!emptyLegendValue(sortValue) && (emptyLegendValue(entry.sortValue) || compareSort(sortValue, entry.sortValue) < 0)) {
          entry.sortValue = sortValue;
        }
      }
    }
    let attribute = column.name;
    if (column.spec.type === 'L') {
      // GDAL versions expose logical DBF fields as either booleans or T/F strings.
      const ref = `"${column.name}"`;
      attribute = `CASE WHEN lower(to_string(${ref})) IN ('true', 't', '1') THEN 'true' WHEN lower(to_string(${ref})) IN ('false', 'f', '0') THEN 'false' ELSE NULL END`;
    }
    const categories = [];
    const symbols = [];
    const entries = [...values.values()];
    if (legendSort) {
      entries.sort((a, b) => {
        const aEmpty = emptyLegendValue(a.sortValue);
        const bEmpty = emptyLegendValue(b.sortValue);
        if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
        const compared = aEmpty ? 0 : compareSort(a.sortValue, b.sortValue);
        return (legendSort.direction === 'desc' ? -compared : compared) || a.index - b.index;
      });
    }
    entries.forEach(({ type, value, index: i }) => {
      const label = type === 'NULL' ? '(empty / other values)' : value;
      categories.push(`<category value="${xmlEsc(value)}" type="${type}" symbol="${i}" label="${xmlEsc(label)}" render="true" uuid="${i}"/>`);
      symbols.push(QgisStyle.symbolXml(fam, i, i));
    });
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      `<qgis version="3.40.0" styleCategories="Symbology"><renderer-v2 type="categorizedSymbol" attr="${xmlEsc(attribute)}" symbollevels="0" enableorderby="0">` +
      `<categories>${categories.join('')}</categories><symbols>${symbols.join('')}</symbols></renderer-v2></qgis>`;
  }

  /**
   * features: [{ geometry, properties }] (WGS84). Returns { files: [{name, data}], warnings }.
   * Features are split into one shapefile per geometry family when a layer is mixed.
   * options.categoryField adds categorized QML; includeStyle adds single-symbol QML.
   * options.styles maps geometry families to edited QML symbol styles.
   * options.styleOnly prepares QML previews without generating SHP/SHX output.
   * options.legendSort { field, direction: 'asc' | 'desc' } orders legend categories only.
   */
  function writeShapefiles(baseName, features, fields, declaredTypes, { categoryField = null, includeStyle = false, styles = {}, styleOnly = false, legendSort = null } = {}) {
    if (categoryField !== null && !fields.includes(categoryField)) {
      throw new Error('The QGIS category column must be included in the exported fields.');
    }
    if (legendSort !== null) {
      if (categoryField === null) throw new Error('Choose a category column before sorting legend symbols.');
      if (!['asc', 'desc'].includes(legendSort.direction) || typeof legendSort.field !== 'string') {
        throw new Error('Choose a valid legend sort column and ascending or descending order.');
      }
      if (!Object.prototype.hasOwnProperty.call(declaredTypes, legendSort.field) && !features.some((feature) => feature.properties && Object.prototype.hasOwnProperty.call(feature.properties, legendSort.field))) {
        throw new Error(`Unknown legend sort column "${legendSort.field}".`);
      }
    }
    const warnings = [];
    const groups = { point: [], line: [], polygon: [] };
    let skipped = 0;
    features.forEach((f) => {
      const fam = f.geometry && family(f.geometry.type);
      if (fam && f.geometry.type === 'MultiPoint') {
        f.geometry.coordinates.forEach((c) => groups.point.push({ parts: [[c]], props: f.properties || {} }));
        return;
      }
      const parts = fam ? partsOf(f.geometry) : [];
      if (!parts.length) { skipped++; return; }
      groups[fam].push({ parts, props: f.properties || {} });
    });
    if (skipped) warnings.push(`${skipped} ${skipped === 1 ? 'feature with empty or invalid geometry was' : 'features with empty or invalid geometry were'} skipped.`);

    const used = Object.keys(groups).filter((k) => groups[k].length);
    const suffix = { point: '_points', line: '_lines', polygon: '_polygons' };
    const files = [];
    used.forEach((fam) => {
      const items = groups[fam];
      const name = used.length > 1 ? baseName + suffix[fam] : baseName;
      const type = fam === 'point' ? SHP.POINT : fam === 'line' ? SHP.POLYLINE : SHP.POLYGON;
      const rows = items.map((i) => i.props);
      const dbf = buildDbf(rows, fields, declaredTypes, warnings);
      if (!styleOnly) {
        const { shp, shx } = buildShpShx(items.map((i) => i.parts), type);
        files.push(
          { name: name + '.shp', data: shp },
          { name: name + '.shx', data: shx },
          { name: name + '.dbf', data: dbf.data },
          { name: name + '.prj', data: encoder.encode(PRJ_WGS84) },
          { name: name + '.cpg', data: encoder.encode('UTF-8') }
        );
      }
      if (categoryField !== null || includeStyle || styles[fam]) {
        let qml = categoryField !== null ? qgisCategoryStyle(dbf, categoryField, fam, rows, legendSort, declaredTypes) : QgisStyle.singleStyle(fam);
        if (styles[fam]) qml = QgisStyle.merge(qml, styles[fam], categoryField);
        files.push({ name: name + '.qml', data: encoder.encode(qml) });
      }
    });
    return { files, warnings: Array.from(new Set(warnings)) };
  }

  global.ShapefileWriter = { writeShapefiles };
})(window);
