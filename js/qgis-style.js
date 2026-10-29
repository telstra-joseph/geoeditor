(function (global) {
  'use strict';

  const colors = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#db2777', '#65a30d'];
  const types = { point: 'marker', line: 'line', polygon: 'fill' };
  const classes = { point: 'SimpleMarker', line: 'SimpleLine', polygon: 'SimpleFill' };
  const shapes = ['circle', 'square', 'diamond', 'triangle', 'star', 'cross', 'cross_fill', 'x'];
  const strokes = ['solid', 'dash', 'dot', 'dash dot', 'dash dot dot', 'no'];
  const fills = ['solid', 'no', 'horizontal', 'vertical', 'cross', 'b_diagonal', 'f_diagonal', 'diagonal_x'];
  const escapeXml = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
  const serialize = (model) => new XMLSerializer().serializeToString(model.doc);

  function symbolXml(family, id, index = 0) {
    const color = colors[index % colors.length];
    const props = family === 'line' ? { line_color: color, line_width: '0.5', line_style: 'solid', line_width_unit: 'MM' }
      : family === 'point' ? { name: 'circle', color, size: '2', size_unit: 'MM', outline_color: '#ffffff', outline_width: '0.2', outline_width_unit: 'MM', outline_style: 'solid' }
        : { color, style: 'solid', outline_color: color, outline_style: 'solid', outline_width: '0.26', outline_width_unit: 'MM' };
    const options = Object.entries(props).map(([key, value]) => `<Option name="${key}" value="${escapeXml(value)}" type="QString"/>`).join('');
    return `<symbol name="${id}" type="${types[family]}" alpha="1" clip_to_extent="1"><layer class="${classes[family]}" enabled="1" locked="0"><Option type="Map">${options}</Option></layer></symbol>`;
  }

  function singleStyle(family) {
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      `<qgis version="3.40.0" styleCategories="Symbology"><renderer-v2 type="singleSymbol"><symbols>${symbolXml(family, '0')}</symbols></renderer-v2></qgis>`;
  }

  function properties(layer) {
    const values = {};
    [...layer.children].forEach((node) => {
      if (node.tagName === 'prop') values[node.getAttribute('k')] = node.getAttribute('v');
      if (node.tagName === 'Option' && node.getAttribute('type') === 'Map') {
        [...node.children].forEach((option) => {
          if (option.hasAttribute('name')) values[option.getAttribute('name')] = option.getAttribute('value');
        });
      }
    });
    return values;
  }

  function setProperty(layer, key, value) {
    const legacy = [...layer.children].find((node) => node.tagName === 'prop' && node.getAttribute('k') === key);
    if (legacy) { legacy.setAttribute('v', value); return; }
    let map = [...layer.children].find((node) => node.tagName === 'Option' && node.getAttribute('type') === 'Map');
    if (!map) {
      map = layer.ownerDocument.createElement('Option');
      map.setAttribute('type', 'Map');
      layer.appendChild(map);
    }
    let option = [...map.children].find((node) => node.getAttribute('name') === key);
    if (!option) {
      option = layer.ownerDocument.createElement('Option');
      option.setAttribute('name', key);
      option.setAttribute('type', 'QString');
      map.appendChild(option);
    }
    option.setAttribute('value', value);
  }

  function colorParts(value) {
    if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)) {
      return { hex: value.slice(0, 7), alpha: value.length === 9 ? parseInt(value.slice(7), 16) : 255 };
    }
    const parts = String(value).split(',').slice(0, 4).map(Number);
    if (parts.length >= 3 && parts.every((v) => Number.isFinite(v) && v >= 0 && v <= 255)) {
      return { hex: '#' + parts.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''), alpha: parts.length === 4 ? parts[3] : 255 };
    }
    throw new Error(`Unsupported QGIS colour "${value}". Use RGB or hex colours.`);
  }

  function categoryKey(category) {
    const type = category.getAttribute('type') || 'string';
    const value = category.getAttribute('value');
    if (type === 'NULL') return 'null';
    if (['double', 'long', 'ulong'].includes(type)) return JSON.stringify(['number', Number(value)]);
    return JSON.stringify(['string', value]);
  }

  function read(xml) {
    if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(xml)) throw new Error('QML with XML entity definitions is not supported.');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror') || doc.documentElement.tagName !== 'qgis') throw new Error('This is not a valid QGIS .qml style file.');
    const renderer = [...doc.documentElement.children].find((node) => node.tagName === 'renderer-v2');
    const kind = renderer && renderer.getAttribute('type');
    if (!['singleSymbol', 'categorizedSymbol'].includes(kind)) throw new Error('Only single-symbol and categorized QGIS renderers can be edited here.');
    const symbolsNode = [...renderer.children].find((node) => node.tagName === 'symbols');
    const symbols = symbolsNode ? [...symbolsNode.children].filter((node) => node.tagName === 'symbol') : [];
    if (!symbols.length) throw new Error('The style has no symbols.');
    const family = Object.keys(types).find((key) => types[key] === symbols[0].getAttribute('type'));
    if (!family) throw new Error('Unsupported QGIS symbol geometry type.');
    symbols.forEach((symbol) => {
      const layers = [...symbol.children].filter((node) => node.tagName === 'layer');
      if (symbol.getAttribute('type') !== types[family] || layers.length !== 1 || layers[0].getAttribute('class') !== classes[family]) {
        throw new Error('Only one SimpleMarker, SimpleLine or SimpleFill layer per symbol is supported. SVG, rule-based and multi-layer symbols need QGIS.');
      }
      if (symbol.querySelector('Option[name="active"][value="true"]')) throw new Error('Data-defined symbol properties must be edited in QGIS.');
      const p = properties(layers[0]);
      ['size_unit', 'outline_width_unit', 'line_width_unit'].forEach((key) => {
        if (p[key] && p[key] !== 'MM') throw new Error('Only millimetre symbol sizes and widths can be edited here.');
      });
      if (p.name && family === 'point' && !shapes.includes(p.name)) throw new Error(`Marker shape "${p.name}" is not supported by this editor.`);
      const style = family === 'line' ? p.line_style : p.outline_style;
      if (style && !strokes.includes(style)) throw new Error(`Line style "${style}" is not supported by this editor.`);
      if (family === 'polygon' && p.style && !fills.includes(p.style)) throw new Error(`Fill style "${p.style}" is not supported by this editor.`);
      ['color', 'outline_color', 'line_color'].forEach((key) => { if (p[key]) colorParts(p[key]); });
      ['size', 'outline_width', 'line_width'].forEach((key) => {
        if (p[key] !== undefined && (!p[key].trim() || !Number.isFinite(Number(p[key])) || Number(p[key]) < 0)) throw new Error(`Invalid symbol ${key}.`);
      });
      const alpha = symbol.getAttribute('alpha');
      if (alpha !== null && (!alpha.trim() || !Number.isFinite(Number(alpha)) || Number(alpha) < 0 || Number(alpha) > 1)) throw new Error('Invalid symbol opacity.');
    });
    const symbolMap = new Map(symbols.map((symbol) => [symbol.getAttribute('name'), symbol]));
    if (symbolMap.size !== symbols.length || symbolMap.has(null)) throw new Error('QGIS symbols must have unique names.');
    const categoriesNode = [...renderer.children].find((node) => node.tagName === 'categories');
    const categories = categoriesNode ? [...categoriesNode.children].filter((node) => node.tagName === 'category') : [];
    if (kind === 'categorizedSymbol' && !categories.length) throw new Error('The categorized style has no categories.');
    const entries = kind === 'singleSymbol' ? [{ category: null, symbol: symbols[0], label: 'All features', key: 'all' }] : categories.map((category) => {
      if (!category.hasAttribute('value')) throw new Error('Multi-value categories are not supported by this editor.');
      const symbol = symbolMap.get(category.getAttribute('symbol'));
      if (!symbol) throw new Error('A QGIS category refers to a missing symbol.');
      return { category, symbol, label: category.hasAttribute('label') ? category.getAttribute('label') : category.getAttribute('value'), key: categoryKey(category) };
    });
    if (new Set(entries.map((entry) => entry.key)).size !== entries.length) throw new Error('Duplicate QGIS category values are not supported.');
    return { doc, renderer, kind, family, entries };
  }

  function merge(targetXml, sourceXml, sourceField = null) {
    const target = read(targetXml);
    const source = read(sourceXml);
    if (target.family !== source.family) throw new Error('The imported style geometry does not match this shapefile.');
    if (source.kind === 'categorizedSymbol') {
      if (target.kind !== 'categorizedSymbol') throw new Error('Choose a category column before importing a categorized style.');
      const attr = source.renderer.getAttribute('attr');
      if (attr !== target.renderer.getAttribute('attr') && attr !== sourceField) throw new Error(`Select the category column used by this QML (${attr}) first.`);
    }
    const sourceEntries = new Map(source.entries.map((entry) => [entry.key, entry]));
    target.entries.forEach((entry) => {
      const from = source.kind === 'singleSymbol' ? source.entries[0] : sourceEntries.get(entry.key);
      if (!from) throw new Error(`The imported style has no matching category for "${entry.label}". No styles were changed.`);
      const copy = target.doc.importNode(from.symbol, true);
      copy.setAttribute('name', entry.symbol.getAttribute('name'));
      entry.symbol.replaceWith(copy);
      if (entry.category && from.category) {
        entry.category.setAttribute('label', from.category.hasAttribute('label') ? from.category.getAttribute('label') : entry.label);
        entry.category.setAttribute('render', from.category.getAttribute('render') || 'true');
      }
    });
    return serialize(target);
  }

  let previewId = 0;
  function preview(model, entry) {
    const ns = 'http://www.w3.org/2000/svg';
    const element = (name, attrs) => {
      const node = document.createElementNS(ns, name);
      Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
      return node;
    };
    const svg = element('svg', { viewBox: '0 0 100 60', role: 'img', 'aria-label': 'Schematic symbol preview' });
    const p = properties(entry.symbol.querySelector('layer'));
    const opacity = Number(entry.symbol.getAttribute('alpha') || 1);
    const fill = colorParts(p.color || '#2563eb');
    const stroke = colorParts((model.family === 'line' ? p.line_color : p.outline_color) || '#2563eb');
    const style = model.family === 'line' ? p.line_style || 'solid' : p.outline_style || 'solid';
    const width = Math.min(12, Number((model.family === 'line' ? p.line_width : p.outline_width) || 0) * 3.78);
    const attrs = {
      fill: fill.hex, 'fill-opacity': opacity * fill.alpha / 255, stroke: style === 'no' ? 'none' : stroke.hex,
      'stroke-opacity': opacity * stroke.alpha / 255, 'stroke-width': width,
    };
    const dash = { dash: '8 4', dot: '2 3', 'dash dot': '8 3 2 3', 'dash dot dot': '8 3 2 3 2 3' }[style];
    if (dash) attrs['stroke-dasharray'] = dash;
    if (entry.category && entry.category.getAttribute('render') === 'false') svg.style.opacity = '0.3';
    if (model.family === 'line') svg.appendChild(element('path', { ...attrs, d: 'M 10 30 L 90 30', fill: 'none' }));
    else if (model.family === 'polygon') {
      if (p.style === 'no') attrs.fill = 'none';
      else if (p.style && p.style !== 'solid') {
        const id = 'qml-hatch-' + previewId++;
        const pattern = element('pattern', { id, width: 8, height: 8, patternUnits: 'userSpaceOnUse' });
        const paths = { horizontal: 'M0 4H8', vertical: 'M4 0V8', cross: 'M0 4H8M4 0V8', b_diagonal: 'M0 0L8 8', f_diagonal: 'M0 8L8 0', diagonal_x: 'M0 0L8 8M0 8L8 0' };
        pattern.appendChild(element('path', { d: paths[p.style], stroke: fill.hex, 'stroke-width': 1 }));
        svg.appendChild(pattern);
        attrs.fill = `url(#${id})`;
      }
      svg.appendChild(element('rect', { ...attrs, x: 10, y: 10, width: 80, height: 40 }));
    } else {
      const r = Math.min(24, Number(p.size || 2) * 3.78 / 2);
      const name = p.name || 'circle';
      if (name === 'circle') svg.appendChild(element('circle', { ...attrs, cx: 50, cy: 30, r }));
      else {
        let points = [];
        if (name === 'square') points = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        if (name === 'diamond') points = [[0, -1], [1, 0], [0, 1], [-1, 0]];
        if (name === 'triangle') points = [[0, -1], [1, 1], [-1, 1]];
        if (name === 'star') points = Array.from({ length: 10 }, (_, i) => {
          const a = i * Math.PI / 5 - Math.PI / 2;
          const radius = i % 2 ? 0.4 : 1;
          return [Math.cos(a) * radius, Math.sin(a) * radius];
        });
        if (name === 'cross_fill') points = [[-.3, -1], [.3, -1], [.3, -.3], [1, -.3], [1, .3], [.3, .3], [.3, 1], [-.3, 1], [-.3, .3], [-1, .3], [-1, -.3], [-.3, -.3]];
        if (name === 'cross' || name === 'x') {
          const d = name === 'cross' ? `M${50 - r} 30H${50 + r}M50 ${30 - r}V${30 + r}` : `M${50 - r} ${30 - r}L${50 + r} ${30 + r}M${50 + r} ${30 - r}L${50 - r} ${30 + r}`;
          svg.appendChild(element('path', { ...attrs, d, fill: 'none' }));
        } else svg.appendChild(element('polygon', { ...attrs, points: points.map(([x, y]) => `${50 + x * r},${30 + y * r}`).join(' ') }));
      }
    }
    return svg;
  }

  const palette = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#db2777', '#65a30d', '#0d9488', '#7c3aed', '#ea580c', '#475569'];
  const editableProps = {
    point: { name: 'shape', size: 'number', color: 'colour', outline_color: 'colour', outline_width: 'number', outline_style: 'stroke' },
    line: { line_color: 'colour', line_width: 'number', line_style: 'stroke' },
    polygon: { color: 'colour', style: 'fill', outline_color: 'colour', outline_width: 'number', outline_style: 'stroke' },
  };
  const choiceLists = { shape: shapes, stroke: strokes, fill: fills };
  const isHex = (value) => /^#[0-9a-f]{6}$/i.test(String(value));
  const rgbaValue = (hex, alpha) => [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16)).concat(alpha).join(',');

  function mixColours(from, to, t) {
    return '#' + [1, 3, 5].map((start) => {
      const a = parseInt(from.slice(start, start + 2), 16);
      const b = parseInt(to.slice(start, start + 2), 16);
      return Math.round(a + (b - a) * t).toString(16).padStart(2, '0');
    }).join('');
  }

  function checkBulkValue(kind, key, value) {
    if (kind === 'colour') {
      if (!isHex(value)) throw new Error(`Invalid colour for ${key}.`);
    } else if (kind === 'number') {
      if (String(value).trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0) throw new Error(`Invalid number for ${key}.`);
    } else if (!choiceLists[kind].includes(value)) {
      throw new Error(`Invalid value for ${key}.`);
    }
  }

  function bulkTargets(model, indices) {
    const unique = [...new Set(indices)].sort((a, b) => a - b);
    if (!unique.length) throw new Error('Select at least one category.');
    return unique.map((index) => {
      if (!Number.isInteger(index) || !model.entries[index]) throw new Error('Unknown category.');
      return model.entries[index];
    });
  }

  function snapshot(entry) {
    return {
      entry,
      alpha: entry.symbol.getAttribute('alpha'),
      nodes: [...entry.symbol.childNodes].map((node) => node.cloneNode(true)),
      render: entry.category ? entry.category.getAttribute('render') : null,
    };
  }

  function restore(snap) {
    const { entry } = snap;
    if (snap.alpha === null) entry.symbol.removeAttribute('alpha'); else entry.symbol.setAttribute('alpha', snap.alpha);
    entry.symbol.replaceChildren(...snap.nodes.map((node) => node.cloneNode(true)));
    if (entry.category) {
      if (snap.render === null) entry.category.removeAttribute('render'); else entry.category.setAttribute('render', snap.render);
    }
  }

  const undoer = (snaps) => () => snaps.forEach(restore);

  /**
   * Applies the same edits to several categories at once. Everything is validated before
   * anything changes. spec: { props: {key: value}, colour: {key, mode, value, from, to}, alpha, render }.
   * Returns { count, undo }.
   */
  function applyBulk(model, indices, spec = {}) {
    const targets = bulkTargets(model, indices);
    const allowed = editableProps[model.family];
    const props = Object.entries(spec.props || {});
    props.forEach(([key, value]) => {
      if (!allowed[key]) throw new Error(`"${key}" cannot be edited for ${model.family} symbols.`);
      checkBulkValue(allowed[key], key, value);
    });
    const colour = spec.colour;
    if (colour) {
      if (allowed[colour.key] !== 'colour') throw new Error('Invalid colour property.');
      if (!['single', 'palette', 'gradient'].includes(colour.mode)) throw new Error('Invalid colour mode.');
      if (colour.mode === 'single') checkBulkValue('colour', colour.key, colour.value);
      if (colour.mode === 'gradient') { checkBulkValue('colour', colour.key, colour.from); checkBulkValue('colour', colour.key, colour.to); }
    }
    if (spec.alpha !== undefined && !(Number.isFinite(spec.alpha) && spec.alpha >= 0 && spec.alpha <= 1)) throw new Error('Opacity must be between 0 and 100%.');
    if (spec.render !== undefined && typeof spec.render !== 'boolean') throw new Error('Invalid visibility setting.');
    if (!props.length && !colour && spec.alpha === undefined && spec.render === undefined) throw new Error('Choose at least one property to change.');

    const snaps = targets.map(snapshot);
    const setColour = (layer, key, hex) => {
      const current = properties(layer)[key];
      setProperty(layer, key, rgbaValue(hex, current ? colorParts(current).alpha : 255));
    };
    targets.forEach((entry, i) => {
      const layer = entry.symbol.querySelector('layer');
      props.forEach(([key, value]) => {
        if (allowed[key] === 'colour') setColour(layer, key, value);
        else setProperty(layer, key, allowed[key] === 'number' ? String(Number(value)) : value);
      });
      if (colour) {
        const hex = colour.mode === 'single' ? colour.value
          : colour.mode === 'palette' ? palette[i % palette.length]
            : mixColours(colour.from, colour.to, targets.length > 1 ? i / (targets.length - 1) : 0);
        setColour(layer, colour.key, hex);
      }
      if (spec.alpha !== undefined) entry.symbol.setAttribute('alpha', String(spec.alpha));
      if (spec.render !== undefined && entry.category) entry.category.setAttribute('render', String(spec.render));
    });
    return { count: targets.length, undo: undoer(snaps) };
  }

  /** Copies one category's symbol appearance (not its label or visibility) to others. */
  function copySymbol(model, fromIndex, toIndices) {
    const source = bulkTargets(model, [fromIndex])[0];
    const targets = bulkTargets(model, toIndices).filter((entry) => entry !== source);
    if (!targets.length) throw new Error('Select at least one category other than the source.');
    const nodes = [...source.symbol.childNodes].map((node) => node.cloneNode(true));
    const alpha = source.symbol.getAttribute('alpha');
    const snaps = targets.map(snapshot);
    targets.forEach((entry) => {
      entry.symbol.replaceChildren(...nodes.map((node) => node.cloneNode(true)));
      if (alpha === null) entry.symbol.removeAttribute('alpha'); else entry.symbol.setAttribute('alpha', alpha);
    });
    return { count: targets.length, undo: undoer(snaps) };
  }

  function renderBulk(model, onChanged) {
    const colourKey = model.family === 'line' ? 'line_color' : 'color';
    const el = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const button = (text, onClick) => {
      const node = el('button', '', text);
      node.type = 'button';
      node.onclick = onClick;
      return node;
    };
    const details = el('details', 'qml-bulk');
    details.appendChild(el('summary', '', `Bulk edit categories (${model.entries.length})`));
    const body = el('div', 'qml-bulk-body');
    // Enter must not submit the export form while typing here.
    body.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.target.tagName === 'INPUT') event.preventDefault();
    });
    body.appendChild(el('p', 'muted', 'Tick the categories to change, tick the properties to apply, then press Apply. Properties left unticked are not changed.'));

    const selected = new Set();
    const filter = el('input');
    filter.type = 'search';
    filter.placeholder = 'Filter categories…';
    filter.setAttribute('aria-label', 'Filter categories');
    const count = el('span', 'muted');
    const list = el('div', 'qml-bulk-list');
    const items = model.entries.map((entry, index) => {
      const label = el('label');
      const box = el('input');
      box.type = 'checkbox';
      const text = document.createTextNode(entry.label);
      box.onchange = () => { if (box.checked) selected.add(index); else selected.delete(index); updateState(); };
      label.append(box, text);
      list.appendChild(label);
      return { entry, index, label, box, text };
    });
    filter.oninput = () => {
      const query = filter.value.trim().toLowerCase();
      items.forEach((item) => {
        const names = [item.entry.label, item.entry.category && item.entry.category.getAttribute('value')];
        item.label.hidden = !!query && !names.some((name) => String(name).toLowerCase().includes(query));
      });
    };
    const setBoxes = (visibleOnly, checked) => {
      items.forEach((item) => {
        if (visibleOnly && item.label.hidden) return;
        item.box.checked = checked;
        if (checked) selected.add(item.index); else selected.delete(item.index);
      });
      updateState();
    };
    const picker = el('div', 'qml-bulk-actions');
    picker.append(button('Select shown', () => setBoxes(true, true)), button('Deselect shown', () => setBoxes(true, false)), button('Clear selection', () => setBoxes(false, false)), count);
    body.append(filter, picker, list);

    const rows = el('div', 'qml-bulk-rows');
    const applyRows = [];
    const addRow = (text, controls, collect) => {
      const row = el('div', 'qml-bulk-row');
      const apply = el('input');
      apply.type = 'checkbox';
      apply.setAttribute('aria-label', `Apply ${text}`);
      const label = el('label');
      label.append(text, ...controls);
      const touch = () => { apply.checked = true; updateState(); };
      controls.forEach((control) => { control.addEventListener('input', touch); control.addEventListener('change', touch); });
      apply.onchange = updateState;
      row.append(apply, label);
      rows.appendChild(row);
      applyRows.push({ apply, collect });
    };
    const choice = (values, label) => {
      const select = el('select');
      select.setAttribute('aria-label', label);
      values.forEach((value) => {
        const option = el('option', '', value === 'no' ? 'None' : value.replace(/_/g, ' '));
        option.value = value;
        select.appendChild(option);
      });
      return select;
    };
    const numberInput = (label, value) => {
      const input = el('input');
      input.type = 'number';
      input.step = 'any';
      input.value = value;
      input.setAttribute('aria-label', label);
      return input;
    };
    const colourInput = (label, value) => {
      const input = el('input');
      input.type = 'color';
      input.value = value;
      input.setAttribute('aria-label', label);
      return input;
    };
    const propRow = (text, key, input) => addRow(text, [input], (spec) => { spec.props = { ...spec.props, [key]: input.value }; });

    if (model.family === 'point') {
      propRow('Point shape', 'name', choice(shapes, 'Point shape'));
      propRow('Point size (mm)', 'size', numberInput('Point size', '2'));
    }
    const mode = choice(['single', 'palette', 'gradient'], 'Colour mode');
    [...mode.options].forEach((option) => { option.textContent = { single: 'One colour', palette: 'Distinct colours', gradient: 'Gradient' }[option.value]; });
    const one = colourInput('Colour', '#2563eb');
    const from = colourInput('Gradient start colour', '#2563eb');
    const to = colourInput('Gradient end colour', '#dc2626');
    const syncMode = () => { one.hidden = mode.value !== 'single'; from.hidden = to.hidden = mode.value !== 'gradient'; };
    mode.addEventListener('change', syncMode);
    syncMode();
    addRow(model.family === 'line' ? 'Line colour' : 'Fill colour', [mode, one, from, to], (spec) => {
      spec.colour = { key: colourKey, mode: mode.value, value: one.value, from: from.value, to: to.value };
    });
    if (model.family === 'polygon') propRow('Fill pattern', 'style', choice(fills, 'Fill pattern'));
    if (model.family === 'line') {
      propRow('Line width (mm)', 'line_width', numberInput('Line width', '0.5'));
      propRow('Line style', 'line_style', choice(strokes, 'Line style'));
    } else {
      propRow('Outline colour', 'outline_color', colourInput('Outline colour', '#2563eb'));
      propRow('Outline width (mm)', 'outline_width', numberInput('Outline width', '0.26'));
      propRow('Outline style', 'outline_style', choice(strokes, 'Outline style'));
    }
    const opacity = numberInput('Symbol opacity', '100');
    addRow('Symbol opacity (%)', [opacity], (spec) => { spec.alpha = opacity.value.trim() === '' ? NaN : Number(opacity.value) / 100; });
    const visibility = choice(['show', 'hide'], 'Initial visibility');
    [...visibility.options].forEach((option) => { option.textContent = { show: 'Shown', hide: 'Hidden' }[option.value]; });
    addRow('Show category initially', [visibility], (spec) => { spec.render = visibility.value === 'show'; });
    body.appendChild(rows);

    const status = el('p', '');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const undos = [];
    const finish = (result, message) => {
      undos.push(result.undo);
      status.className = '';
      status.textContent = message;
      updateState();
      onChanged();
    };
    const fail = (error) => {
      status.className = 'error';
      status.textContent = `Nothing changed: ${error.message || error}`;
    };
    const applyButton = button('Apply to selected', () => {
      const spec = {};
      applyRows.forEach((row) => { if (row.apply.checked) row.collect(spec); });
      try {
        const result = applyBulk(model, [...selected], spec);
        finish(result, `Updated ${result.count} ${result.count === 1 ? 'category' : 'categories'}.`);
      } catch (error) { fail(error); }
    });
    applyButton.className = 'primary';
    const undoButton = button('Undo last bulk change', () => {
      const undo = undos.pop();
      if (!undo) return;
      undo();
      status.className = '';
      status.textContent = 'Last bulk change undone.';
      updateState();
      onChanged();
    });
    body.appendChild(el('div', 'qml-bulk-actions')).append(applyButton, undoButton);
    body.appendChild(el('p', 'muted', 'Gradients and distinct colours follow the order of the selected categories in the list above, which is the legend order. Existing colour transparency is kept.'));

    const copyFrom = el('select');
    copyFrom.setAttribute('aria-label', 'Copy style from category');
    const copyButton = button('Copy style to selected', () => {
      try {
        const result = copySymbol(model, Number(copyFrom.value), [...selected]);
        finish(result, `Copied the symbol to ${result.count} ${result.count === 1 ? 'category' : 'categories'}. Labels and visibility are unchanged.`);
      } catch (error) { fail(error); }
    });
    const copyRow = el('div', 'qml-bulk-copy');
    copyRow.append(el('span', '', 'Copy the whole symbol from'), copyFrom, copyButton);
    body.append(copyRow, status);

    function updateState() {
      count.textContent = `${selected.size} of ${items.length} selected`;
      applyButton.disabled = !selected.size || !applyRows.some((row) => row.apply.checked);
      copyButton.disabled = !selected.size;
      undoButton.disabled = !undos.length;
    }
    // Labels can be edited above, so refresh them whenever the panel opens.
    details.addEventListener('toggle', () => {
      if (!details.open) return;
      items.forEach((item) => { item.text.nodeValue = item.entry.label; });
      const previous = copyFrom.value;
      copyFrom.replaceChildren(...model.entries.map((entry, index) => {
        const option = el('option', '', entry.label);
        option.value = String(index);
        return option;
      }));
      if (previous) copyFrom.value = previous;
    });
    copyFrom.replaceChildren(...model.entries.map((entry, index) => {
      const option = el('option', '', entry.label);
      option.value = String(index);
      return option;
    }));
    updateState();
    details.appendChild(body);
    return details;
  }

  function renderEditor(container, models, onDownload) {
    container.replaceChildren();
    models.forEach((model) => {
      const card = document.createElement('fieldset');
      card.className = 'qml-symbol-card';
      const legend = document.createElement('legend');
      legend.textContent = { point: 'Points', line: 'Lines', polygon: 'Polygons' }[model.family];
      const selectLabel = document.createElement('label');
      selectLabel.textContent = 'Category to edit';
      const select = document.createElement('select');
      model.entries.forEach((entry, i) => {
        const option = document.createElement('option');
        option.value = String(i);
        option.textContent = entry.label;
        select.appendChild(option);
      });
      selectLabel.appendChild(select);
      const controls = document.createElement('div');
      const picture = document.createElement('div');
      picture.className = 'qml-symbol-preview';
      const download = document.createElement('button');
      download.type = 'button';
      download.textContent = 'Download ' + model.fileName;
      download.onclick = () => onDownload(model);
      const show = () => {
        controls.replaceChildren();
        const entry = model.entries[Number(select.value)];
        const layer = entry.symbol.querySelector('layer');
        const refresh = () => picture.replaceChildren(preview(model, entry));
        const control = (labelText, key, type, fallback, choices) => {
          const label = document.createElement('label');
          label.textContent = labelText;
          const input = document.createElement(choices ? 'select' : 'input');
          const value = properties(layer)[key] || fallback;
          if (choices) choices.forEach((choice) => {
            const option = document.createElement('option');
            option.value = choice;
            option.textContent = choice === 'no' ? 'None' : choice.replace(/_/g, ' ');
            input.appendChild(option);
          });
          else input.type = type;
          input.value = type === 'color' ? colorParts(value).hex : value;
          if (type === 'number') { input.min = '0'; input.step = 'any'; input.required = true; }
          input.oninput = () => {
            if (!input.checkValidity()) return;
            let next = input.value;
            if (type === 'color') {
              const alpha = colorParts(properties(layer)[key] || fallback).alpha;
              next = [1, 3, 5].map((start) => parseInt(input.value.slice(start, start + 2), 16)).concat(alpha).join(',');
            }
            setProperty(layer, key, next);
            refresh();
          };
          label.appendChild(input);
          controls.appendChild(label);
        };
        if (entry.category) {
          const label = document.createElement('label');
          label.textContent = 'Category label';
          const input = document.createElement('input');
          input.type = 'text';
          input.value = entry.label;
          input.oninput = () => {
            entry.label = input.value;
            entry.category.setAttribute('label', input.value);
            select.selectedOptions[0].textContent = input.value;
          };
          label.appendChild(input);
          controls.appendChild(label);
          const enabled = document.createElement('label');
          enabled.className = 'qml-category-enabled';
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = entry.category.getAttribute('render') !== 'false';
          checkbox.onchange = () => { entry.category.setAttribute('render', String(checkbox.checked)); refresh(); };
          enabled.append(checkbox, 'Show category initially');
          controls.appendChild(enabled);
        }
        if (model.family === 'point') {
          control('Point shape', 'name', 'text', 'circle', shapes);
          control('Point size (mm)', 'size', 'number', '2');
        }
        if (model.family !== 'line') control('Fill colour', 'color', 'color', '#2563eb');
        if (model.family === 'polygon') control('Fill pattern', 'style', 'text', 'solid', fills);
        const line = model.family === 'line';
        control(line ? 'Line colour' : 'Outline colour', line ? 'line_color' : 'outline_color', 'color', '#2563eb');
        control(line ? 'Line width (mm)' : 'Outline width (mm)', line ? 'line_width' : 'outline_width', 'number', line ? '0.5' : '0.26');
        control(line ? 'Line style' : 'Outline style', line ? 'line_style' : 'outline_style', 'text', 'solid', strokes);
        const opacityLabel = document.createElement('label');
        opacityLabel.textContent = 'Symbol opacity (%)';
        const opacity = document.createElement('input');
        opacity.type = 'number';
        opacity.min = '0'; opacity.max = '100'; opacity.step = 'any'; opacity.required = true;
        opacity.value = String(Number(entry.symbol.getAttribute('alpha') || 1) * 100);
        opacity.oninput = () => {
          if (opacity.checkValidity()) { entry.symbol.setAttribute('alpha', String(Number(opacity.value) / 100)); refresh(); }
        };
        opacityLabel.appendChild(opacity);
        controls.appendChild(opacityLabel);
        refresh();
      };
      select.onchange = show;
      const bulk = model.kind === 'categorizedSymbol' && model.entries.length > 1 ? renderBulk(model, show) : null;
      card.append(legend, selectLabel, picture, controls, ...(bulk ? [bulk] : []), download);
      container.appendChild(card);
      show();
    });
  }

  global.QgisStyle = { symbolXml, singleStyle, read, merge, serialize, renderEditor, applyBulk, copySymbol };
})(globalThis);
