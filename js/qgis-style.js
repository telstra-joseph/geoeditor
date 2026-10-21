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
      card.append(legend, selectLabel, picture, controls, download);
      container.appendChild(card);
      show();
    });
  }

  global.QgisStyle = { symbolXml, singleStyle, read, merge, serialize, renderEditor };
})(window);
