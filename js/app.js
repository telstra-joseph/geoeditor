(() => {
  'use strict';
  lucide.createIcons();

  /* ---------- constants & state ---------- */
  const PALETTE = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#db2777', '#65a30d'];
  const PAGE_SIZE = 200;
  const columnWidths = new WeakMap();
  const MIN_COLUMN_WIDTH = 120;
  const GEOM_LABEL = { Mixed: 'Mixed', Point: 'Points', Line: 'Lines', Polygon: 'Polygons' };

  const state = {
    layers: [],
    active: null,
    selected: null,
    page: 0,
    filter: '',
    sort: null,
    undo: [],
    nextId: 1,
    colorIdx: 0,
  };

  const $ = (id) => document.getElementById(id);

  const tooltip = document.createElement('div');
  tooltip.id = 'appTooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.setAttribute('popover', 'manual');
  if (!tooltip.showPopover) tooltip.hidden = true;
  document.body.appendChild(tooltip);
  let tooltipTarget = null;
  let tooltipTimer;
  let tooltipDescription = null;
  function hideTooltip() {
    clearTimeout(tooltipTimer);
    if (tooltipTarget) {
      if (!tooltipTarget.hasAttribute('title')) tooltipTarget.title = tooltipTarget.dataset.tooltipTitle;
      delete tooltipTarget.dataset.tooltipTitle;
      if (tooltipDescription === null) tooltipTarget.removeAttribute('aria-describedby');
      else tooltipTarget.setAttribute('aria-describedby', tooltipDescription);
      tooltipTarget = null;
    }
    if (tooltip.hidePopover) {
      if (tooltip.matches(':popover-open')) tooltip.hidePopover();
    } else tooltip.hidden = true;
  }
  function prepareTooltip(event) {
    if (event.pointerType === 'touch') return;
    const target = event.target.closest('[title], [data-tooltip-title]');
    if (target === tooltipTarget) return;
    hideTooltip();
    if (!target || !target.getAttribute('title')) return;
    tooltipTarget = target;
    tooltipDescription = target.getAttribute('aria-describedby');
    target.dataset.tooltipTitle = target.title;
    target.removeAttribute('title');
    tooltipTimer = setTimeout(() => {
      if (!target.isConnected) { hideTooltip(); return; }
      tooltip.textContent = target.dataset.tooltipTitle;
      target.setAttribute('aria-describedby', [tooltipDescription, tooltip.id].filter(Boolean).join(' '));
      if (tooltip.showPopover) tooltip.showPopover();
      else tooltip.hidden = false;
      const rect = target.getBoundingClientRect();
      const size = tooltip.getBoundingClientRect();
      const left = Math.max(8, Math.min(innerWidth - size.width - 8, rect.left + (rect.width - size.width) / 2));
      const top = rect.top >= size.height + 16 ? rect.top - size.height - 8 : rect.bottom + 8;
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${Math.max(8, Math.min(innerHeight - size.height - 8, top))}px`;
    }, event.type === 'focusin' ? 0 : 200);
  }
  document.addEventListener('pointerover', prepareTooltip);
  document.addEventListener('focusin', prepareTooltip);
  ['pointerout', 'focusout'].forEach(type => document.addEventListener(type, (event) => {
    if (tooltipTarget && !tooltipTarget.contains(event.relatedTarget)) hideTooltip();
  }));
  document.addEventListener('pointerdown', hideTooltip, true);
  document.addEventListener('click', hideTooltip, true);
  document.addEventListener('scroll', hideTooltip, true);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') hideTooltip(); });
  window.addEventListener('resize', hideTooltip);

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const dark = theme === 'dark';
    const button = $('btnTheme');
    button.replaceChildren(actionIcon(dark ? 'Sun' : 'Moon'));
    button.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-pressed', String(dark));
  }

  applyTheme(document.documentElement.dataset.theme);
  $('btnTheme').addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(theme);
    try { localStorage.setItem('geoeditor-theme', theme); } catch {}
  });

  /* ---------- helpers ---------- */
  function toast(msg, kind = '', ms = 5000) {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = msg;
    $('toasts').appendChild(el);
    setTimeout(() => {
      el.classList.add('leaving');
      Promise.allSettled(el.getAnimations().map(animation => animation.finished)).then(() => el.remove());
    }, ms);
  }

  function safeName(s) {
    return String(s || 'layer').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'layer';
  }

  function baseName(filename) {
    return filename.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '');
  }

  function saveBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  function recordUndo(label, undo) {
    state.undo.push({ label, undo });
    if (state.undo.length > 100) state.undo.shift();
    const button = $('btnUndo');
    button.disabled = false;
    button.title = `Undo ${label}`;
  }

  function undoLastTableEdit() {
    const entry = state.undo.pop();
    if (!entry) return;
    entry.undo();
    map.closePopup();
    renderTable();
    const button = $('btnUndo');
    button.disabled = state.undo.length === 0;
    button.title = state.undo.length ? `Undo ${state.undo[state.undo.length - 1].label}` : 'Undo last table edit';
  }

  function askForm(title, fields, { message = '', okLabel = 'OK', destructive = false, compact = false } = {}) {
    return new Promise((resolve) => {
      const dlg = $('dlg');
      dlg.classList.toggle('compact', compact);
      $('dlgTitle').textContent = title;
      $('dlgMsg').textContent = message;
      $('dlgMsg').style.display = message ? '' : 'none';
      $('dlgOk').textContent = okLabel;
      $('dlgOk').classList.toggle('destructive', destructive);
      const body = $('dlgBody');
      body.replaceChildren();
      const inputs = {};
      fields.forEach((f) => {
        if (f.type === 'radio') {
          const group = document.createElement('fieldset');
          group.className = 'radio-options';
          group.setAttribute('aria-label', f.label);
          f.options.forEach(([value, text]) => {
            const choice = document.createElement('label');
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = f.key;
            radio.value = value;
            radio.checked = value === f.value;
            choice.append(radio, text);
            group.appendChild(choice);
          });
          body.appendChild(group);
          inputs[f.key] = group;
          return;
        }
        const label = document.createElement('label');
        if (!f.hideLabel) label.append(f.label);
        let input;
        if (f.type === 'select') {
          input = document.createElement('select');
          f.options.forEach(([value, text]) => {
            const o = document.createElement('option');
            o.value = value;
            o.textContent = text;
            input.appendChild(o);
          });
          input.value = f.value;
        } else {
          input = document.createElement('input');
          input.type = 'text';
          input.value = f.value || '';
          if (f.required) input.required = true;
          if (f.placeholder) input.placeholder = f.placeholder;
        }
        if (f.hideLabel) input.setAttribute('aria-label', f.label);
        label.appendChild(input);
        if (f.hint) {
          const small = document.createElement('small');
          small.textContent = f.hint;
          label.appendChild(small);
        }
        body.appendChild(label);
        inputs[f.key] = input;
        if (f.clearable) {
          const clear = document.createElement('button');
          clear.type = 'button';
          clear.className = 'clear-filter';
          clear.append(actionIcon('X'), 'Clear filter');
          const updateClear = () => {
            clear.disabled = !input.value && !f.value;
            clear.hidden = clear.disabled;
          };
          input.addEventListener('input', updateClear);
          updateClear();
          clear.addEventListener('click', () => {
            input.value = '';
            dlg.close('ok');
          });
          body.appendChild(clear);
        }
      });
      dlg.addEventListener('close', function onClose() {
        dlg.removeEventListener('close', onClose);
        if (dlg.returnValue !== 'ok') return resolve(null);
        const out = {};
        Object.keys(inputs).forEach((k) => {
          out[k] = inputs[k] instanceof HTMLFieldSetElement ? inputs[k].querySelector('input:checked').value : inputs[k].value;
        });
        resolve(out);
      });
      dlg.returnValue = 'cancel';
      dlg.showModal();
      const field = Object.values(inputs)[0];
      const first = field?.querySelector('input:checked') || field;
      if (first) { first.focus(); if (first.select) first.select(); }
    });
  }

  const confirmBox = async (title, message, okLabel = 'Delete', destructive = false) => !!(await askForm(title, [], { message, okLabel, destructive }));

  /* ---------- map ---------- */
  const vectorRenderer = new L.GpuCanvas({ padding: 0.2 });
  const map = L.map('map', { zoomSnap: 0.5 }).setView([-25, 134], 4);
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);
  const imagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, attribution: 'Tiles &copy; Esri',
  });
  const basemapControl = L.control.layers({ OpenStreetMap: osm, Satellite: imagery, Blank: L.layerGroup() }, null, { position: 'topright' }).addTo(map);
  const basemapToggle = basemapControl.getContainer().querySelector('.leaflet-control-layers-toggle');
  basemapToggle.replaceChildren(actionIcon('Layers'));
  basemapToggle.title = 'Choose basemap';
  basemapToggle.setAttribute('aria-label', 'Choose basemap');
  const scaleControl = L.control.scale().addTo(map);

  map.pm.addControls({
    position: 'topleft',
    drawMarker: false,
    drawCircleMarker: true,
    drawPolyline: true,
    drawRectangle: true,
    drawPolygon: true,
    drawCircle: false,
    drawText: false,
    editMode: true,
    dragMode: true,
    cutPolygon: true,
    removalMode: true,
    rotateMode: false,
  });
  map.pm.setGlobalOptions({ snappable: true, allowSelfIntersection: true });
  map.pm.setLang('en');

  const mapIcons = {
    polyline: 'Route', rectangle: 'RectangleHorizontal', polygon: 'Pentagon',
    'circle-marker': 'Circle', edit: 'SquarePen', drag: 'Move', cut: 'Scissors', delete: 'Trash2'
  };
  Object.entries(mapIcons).forEach(([tool, icon]) => {
    const container = map.getContainer().querySelector(`.leaflet-pm-icon-${tool}`);
    if (!container) return;
    container.replaceChildren(actionIcon(icon));
    const button = container.closest('a');
    button.setAttribute('aria-label', button.parentElement.title);
  });
  map.getContainer().querySelector('.leaflet-control-zoom-in').replaceChildren(actionIcon('Plus'));
  map.getContainer().querySelector('.leaflet-control-zoom-out').replaceChildren(actionIcon('Minus'));

  const mobileControls = window.matchMedia('(max-width: 760px)');
  map.getContainer().querySelectorAll('.leaflet-pm-toolbar').forEach((toolbar) => {
    const tools = [...toolbar.children];
    let current = tools[0];
    let holdTimer;
    let pointerStart;
    let heldButton;
    let suppressUntil = 0;
    current.classList.add('mobile-tool-current');
    const closeTools = () => {
      heldButton = null;
      suppressUntil = 0;
      toolbar.classList.remove('mobile-tools-open');
      tools.forEach(tool => tool.querySelector('.leaflet-buttons-control-button').removeAttribute('aria-expanded'));
      if (mobileControls.matches) current.querySelector('.leaflet-buttons-control-button').setAttribute('aria-expanded', 'false');
    };
    const cancelHold = () => {
      clearTimeout(holdTimer);
      pointerStart = null;
    };
    const openTools = () => {
      toolbar.classList.add('mobile-tools-open');
      current.querySelector('.leaflet-buttons-control-button').setAttribute('aria-expanded', 'true');
    };
    toolbar.addEventListener('pointerdown', (event) => {
      if (!mobileControls.matches || event.button !== 0) return;
      const button = event.target.closest('.leaflet-buttons-control-button');
      if (!button || !current.contains(button)) return;
      cancelHold();
      pointerStart = { x: event.clientX, y: event.clientY };
      holdTimer = setTimeout(() => {
        openTools();
        heldButton = button;
        suppressUntil = Infinity;
      }, 450);
    });
    toolbar.addEventListener('pointermove', (event) => {
      if (pointerStart && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 10) cancelHold();
    });
    toolbar.addEventListener('pointerup', () => {
      if (heldButton) suppressUntil = performance.now() + 700;
      cancelHold();
    });
    toolbar.addEventListener('pointerleave', cancelHold);
    toolbar.addEventListener('pointercancel', () => { cancelHold(); closeTools(); });
    toolbar.addEventListener('contextmenu', (event) => {
      if (mobileControls.matches) event.preventDefault();
    });
    toolbar.addEventListener('click', (event) => {
      if (!mobileControls.matches) return;
      const button = event.target.closest('.leaflet-buttons-control-button');
      if (!button) return;
      if (button === heldButton && performance.now() < suppressUntil) {
        heldButton = null;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      heldButton = null;
      current.classList.remove('mobile-tool-current');
      current = button.closest('.button-container');
      current.classList.add('mobile-tool-current');
      closeTools();
    }, true);
    toolbar.addEventListener('keydown', (event) => {
      if (!mobileControls.matches) return;
      const button = event.target.closest('.leaflet-buttons-control-button');
      if (!button) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        openTools();
        tools.find(tool => tool !== current)?.querySelector('.leaflet-buttons-control-button').focus();
      } else if (event.key === 'Escape') {
        closeTools();
        current.querySelector('.leaflet-buttons-control-button').focus();
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        button.click();
      }
    });
    document.addEventListener('pointerdown', (event) => {
      if (!toolbar.contains(event.target)) { cancelHold(); closeTools(); }
    }, true);
    mobileControls.addEventListener('change', () => { cancelHold(); closeTools(); });
    closeTools();
  });

  const pmBusy = () => ['globalEditModeEnabled', 'globalDragModeEnabled', 'globalRemovalModeEnabled', 'globalDrawModeEnabled', 'globalCutModeEnabled']
    .some((fn) => typeof map.pm[fn] === 'function' && map.pm[fn]());

  /* ---------- feature / layer model ---------- */
  const isPointLeaf = (leaf) => leaf instanceof L.CircleMarker && !(leaf instanceof L.Circle);

  function familyOf(leaf) {
    if (isPointLeaf(leaf) || leaf instanceof L.Marker) return 'Point';
    if (leaf instanceof L.Polygon) return 'Polygon';
    return 'Line';
  }

  function kmlLabelOnly(leaf) {
    return Boolean(leaf.feature?.kml && isPointLeaf(leaf) &&
      (/^[a-z0-9]$/i.test(String(leaf.feature.properties.name ?? '').trim()) || Number(leaf.feature.style?.['icon-scale']) === 0));
  }

  function pointRadius(leaf) {
    const name = String(leaf.feature?.properties?.name ?? '').trim();
    if (!leaf.feature?.kml || [...name].length !== 4) return 3;
    return Math.max(1, Math.min(2, (map.getZoom() + 4) / 10));
  }

  function singleCharacterLabel(leaf) {
    return Boolean(leaf.feature?.kml && (isPointLeaf(leaf) || leaf instanceof L.Polygon) &&
      /^[a-z0-9]$/i.test(String(leaf.feature.properties.name ?? '').trim()));
  }

  function polygonLabelSize(leaf, nearby) {
    if (map.getZoom() < 10) return 0;
    const point = isPointLeaf(leaf) ? map.latLngToContainerPoint(leaf.getLatLng()) : null;
    let best = null;
    let bestDistance = Infinity;
    const polygons = leaf instanceof L.Polygon ? [leaf] : nearby.get(`${Math.floor(point.x / 128)},${Math.floor(point.y / 128)}`) || [];
    polygons.forEach(polygon => {
      const bounds = polygon.getBounds();
      const start = map.latLngToContainerPoint(bounds.getNorthWest());
      const end = map.latLngToContainerPoint(bounds.getSouthEast());
      const distance = point ? Math.hypot(Math.max(start.x - point.x, 0, point.x - end.x), Math.max(start.y - point.y, 0, point.y - end.y)) : 0;
      const size = Math.min(end.x - start.x, end.y - start.y);
      if (distance <= 24 && (distance < bestDistance || (distance === bestDistance && size < best))) {
        best = size;
        bestDistance = distance;
      }
    });
    if (best < 48) return 0;
    const scale = Number(leaf.feature.style?.['label-scale'] ?? 1);
    const size = Math.min(12, 12 * (Number.isFinite(scale) ? scale : 1), best * .18);
    return size >= 8 ? size : 0;
  }

  function polygonLabelIndex(polygons) {
    const nearby = new Map();
    if (map.getZoom() < 10) return nearby;
    const viewport = map.getSize();
    polygons.forEach(polygon => {
      const bounds = polygon.getBounds();
      const start = map.latLngToContainerPoint(bounds.getNorthWest());
      const end = map.latLngToContainerPoint(bounds.getSouthEast());
      const left = Math.floor(Math.max(-128, start.x - 24) / 128);
      const right = Math.floor(Math.min(viewport.x + 128, end.x + 24) / 128);
      const top = Math.floor(Math.max(-128, start.y - 24) / 128);
      const bottom = Math.floor(Math.min(viewport.y + 128, end.y + 24) / 128);
      for (let column = left; column <= right; column++) {
        for (let row = top; row <= bottom; row++) {
          const key = `${column},${row}`;
          if (!nearby.has(key)) nearby.set(key, []);
          nearby.get(key).push(polygon);
        }
      }
    });
    return nearby;
  }

  function updateKmlLabel(leaf) {
    if (!leaf.feature?.kml) return;
    const name = String(leaf.feature.properties.name ?? '').trim();
    const style = leaf.feature.style || {};
    if (!isPointLeaf(leaf) && (!(leaf instanceof L.Polygon) ||
      (!/^[a-z0-9]$/i.test(name) && !['label-color', 'label-scale', 'label-opacity'].some(key => key in style)))) {
      leaf.unbindTooltip();
      return;
    }
    const scale = Number(style['label-scale'] ?? 1);
    const opacity = Number(style['label-opacity'] ?? 1);
    const single = singleCharacterLabel(leaf);
    const site = isPointLeaf(leaf) && [...name].length === 4;
    if (!name || scale <= 0 || opacity <= 0 || (single && !leaf._kmlLabelSize)) { leaf.unbindTooltip(); return; }
    const fontSize = site ? 14 : single ? leaf._kmlLabelSize : Math.min(256, 16 * (Number.isFinite(scale) ? scale : 1));
    const centered = !site && (!isPointLeaf(leaf) || kmlLabelOnly(leaf));
    const alpha = Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1;
    const labelKey = JSON.stringify([name, style['label-color'] || '#ffffff', fontSize, centered, site, alpha]);
    if (leaf._kmlLabelKey === labelKey && leaf.getTooltip()) return;
    leaf._kmlLabelKey = labelKey;
    const text = document.createElement('span');
    text.textContent = name;
    if ([...name].length === 4) text.className = 'kml-label-outlined';
    text.style.color = style['label-color'] || '#ffffff';
    text.style.fontSize = `${fontSize}px`;
    const options = {
      permanent: true, interactive: false, className: site ? 'kml-map-label kml-site-label' : 'kml-map-label',
      direction: site ? 'top' : centered ? 'center' : 'right', offset: site ? L.point(0, -4) : L.point(centered ? 0 : 8, 0),
      opacity: alpha,
    };
    if (!leaf.getTooltip()) leaf.bindTooltip(text, options);
    else {
      Object.assign(leaf.getTooltip().options, options);
      leaf.getTooltip().getElement()?.classList.toggle('kml-site-label', site);
      leaf.setTooltipContent(text);
      leaf.getTooltip().setOpacity(options.opacity);
    }
  }

  function placeSiteLabels(lyr) {
    const mapRect = map.getContainer().getBoundingClientRect();
    const workspace = $('workspace').getBoundingClientRect();
    const area = {
      left: Math.max(0, workspace.left - mapRect.left) + 8,
      top: Math.max(0, workspace.top - mapRect.top) + 8,
      right: mapRect.width - 8,
      bottom: Math.min(mapRect.height, $('splitter').getBoundingClientRect().top - mapRect.top) - 8,
    };
    const occupied = new Map();
    const cells = rectangle => {
      const keys = [];
      for (let column = Math.floor(rectangle.left / 64); column <= Math.floor(rectangle.right / 64); column++) {
        for (let row = Math.floor(rectangle.top / 64); row <= Math.floor(rectangle.bottom / 64); row++) keys.push(`${column},${row}`);
      }
      return keys;
    };
    const sites = [...lyr.displayed].filter(leaf => isPointLeaf(leaf) && leaf.getTooltip()?.options.className.includes('kml-site-label'));
    sites.sort((first, second) => Number(second === state.selected) - Number(first === state.selected));
    const measured = sites.map(leaf => {
      const tooltip = leaf.getTooltip();
      const element = tooltip.getElement();
      if (!element || !map.hasLayer(tooltip)) return null;
      return { leaf, tooltip, element, point: map.latLngToContainerPoint(leaf.getLatLng()), width: element.offsetWidth, height: element.offsetHeight };
    }).filter(Boolean);
    measured.forEach(({ leaf, tooltip, element, point, width, height }) => {
      const choices = [
        { direction: 'top', offset: [0, -4], left: point.x - width / 2, top: point.y - height - 10 },
        { direction: 'right', offset: [4, 0], left: point.x + 10, top: point.y - height / 2 },
        { direction: 'left', offset: [-4, 0], left: point.x - width - 10, top: point.y - height / 2 },
        { direction: 'bottom', offset: [0, 4], left: point.x - width / 2, top: point.y + 10 },
      ];
      const placement = choices.find(choice => {
        const rectangle = { left: choice.left - 2, top: choice.top - 2, right: choice.left + width + 2, bottom: choice.top + height + 2 };
        if (rectangle.left < area.left || rectangle.right > area.right || rectangle.top < area.top || rectangle.bottom > area.bottom) return false;
        return cells(rectangle).every(key => (occupied.get(key) || []).every(other =>
          rectangle.right <= other.left || rectangle.left >= other.right || rectangle.bottom <= other.top || rectangle.top >= other.bottom));
      }) || (leaf === state.selected ? choices[0] : null);
      const visibility = placement ? '' : 'hidden';
      if (element.style.visibility !== visibility) element.style.visibility = visibility;
      if (!placement) return;
      const offset = L.point(placement.offset);
      if (tooltip.options.direction !== placement.direction || !tooltip.options.offset.equals(offset)) {
        tooltip.options.direction = placement.direction;
        tooltip.options.offset = offset;
        tooltip.update();
      }
      const rectangle = { left: placement.left - 2, top: placement.top - 2, right: placement.left + width + 2, bottom: placement.top + height + 2 };
      cells(rectangle).forEach(key => {
        if (!occupied.has(key)) occupied.set(key, []);
        occupied.get(key).push(rectangle);
      });
    });
  }

  function kmlLeafVisible(lyr, leaf) {
    return lyr.visible && String(leaf.feature?.style?.visibility ?? '1') !== '0' &&
      (leaf.feature?.kml?.folderIds || []).every(id => lyr.kmlFolderMap.get(id)?.visible !== false);
  }

  function displayLimit() {
    const zoom = map.getZoom();
    return zoom <= 5 ? 1000 : zoom <= 8 ? 2000 : zoom <= 11 ? 10000 : zoom <= 14 ? 10000 : 20000;
  }

  function sitePolygonIndex(lyr) {
    if (lyr.format !== 'kml' && lyr.format !== 'kmz') return null;
    if (lyr.sitePolygons) return lyr.sitePolygons;
    const sites = new Map();
    const polygons = new Map();
    const all = leavesOf(lyr);
    all.forEach(leaf => {
      if (!isPointLeaf(leaf)) return;
      const name = String(leaf.feature?.properties?.name ?? '').trim();
      if ([...name].length !== 4) return;
      const id = (leaf.feature.kml?.folderIds || []).find(folderId => lyr.kmlFolderMap.get(folderId)?.name.trim() === name);
      if (id && !sites.has(id)) sites.set(id, { leaf, id });
    });
    all.forEach(leaf => {
      if (!(leaf instanceof L.Polygon)) return;
      const id = (leaf.feature?.kml?.folderIds || []).find(folderId => sites.has(folderId));
      if (id) polygons.set(leaf, sites.get(id));
    });
    lyr.sitePolygons = { sites, polygons };
    return lyr.sitePolygons;
  }

  function isolatedSitePolygons(lyr, candidates, budget) {
    const index = sitePolygonIndex(lyr);
    if (!index?.sites.size) return [];
    const groups = new Map();
    candidates.forEach(polygon => {
      const site = index.polygons.get(polygon);
      if (!site) return;
      if (!groups.has(site)) groups.set(site, { site, polygons: [], point: map.latLngToContainerPoint(site.leaf.getLatLng()) });
      groups.get(site).polygons.push(polygon);
    });
    const cells = new Map();
    index.sites.forEach(site => {
      if (!groups.has(site) && !kmlLeafVisible(lyr, site.leaf)) return;
      const point = groups.get(site)?.point || map.latLngToContainerPoint(site.leaf.getLatLng());
      const key = `${Math.floor(point.x / 96)},${Math.floor(point.y / 96)}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push({ site, point });
    });
    const isolated = [...groups.values()].filter(group => {
      const column = Math.floor(group.point.x / 96);
      const row = Math.floor(group.point.y / 96);
      for (let horizontal = column - 1; horizontal <= column + 1; horizontal++) {
        for (let vertical = row - 1; vertical <= row + 1; vertical++) {
          if ((cells.get(`${horizontal},${vertical}`) || []).some(other => other.site !== group.site && group.point.distanceTo(other.point) <= 96)) return false;
        }
      }
      return true;
    }).sort((first, second) => first.polygons.length - second.polygons.length);
    const preferred = [];
    isolated.forEach(group => {
      if (group.polygons.length <= budget - preferred.length) preferred.push(...group.polygons);
    });
    return preferred;
  }

  function syncLayerDisplay(lyr) {
    if (!map.hasLayer(lyr.group) || lyr.importing) return;
    const all = leavesOf(lyr);
    const limit = displayLimit();
    const limited = all.length > limit;
    const bounds = map.getBounds().pad(.1);
    const pinned = [];
    const candidates = [[], [], []];
    all.forEach(leaf => {
      if (!kmlLeafVisible(lyr, leaf)) return;
      if (leaf === state.selected || leaf._displayEditing) { pinned.push(leaf); return; }
      if (!limited || (leaf.getBounds ? bounds.intersects(leaf.getBounds()) : bounds.contains(leaf.getLatLng()))) {
        candidates[leaf instanceof L.Polygon ? 0 : isPointLeaf(leaf) ? 2 : 1].push(leaf);
      }
    });
    const desired = new Set(pinned.slice(0, limit));
    if (candidates[0].length > limit - desired.size) {
      isolatedSitePolygons(lyr, candidates[0], limit - desired.size).forEach(leaf => desired.add(leaf));
    }
    candidates.slice(0, 2).forEach(items => {
      const remaining = items.filter(leaf => !desired.has(leaf));
      const count = Math.min(limit - desired.size, remaining.length);
      for (let index = 0; index < count; index++) desired.add(remaining[Math.floor(index * remaining.length / count)]);
    });
    const needsNearby = pinned.some(leaf => isPointLeaf(leaf) && singleCharacterLabel(leaf)) ||
      (desired.size < limit && candidates[2].some(singleCharacterLabel));
    const nearby = needsNearby ? polygonLabelIndex([...desired].filter(leaf => leaf instanceof L.Polygon)) : new Map();
    const points = candidates[2].filter(leaf => {
      if (!singleCharacterLabel(leaf)) return true;
      leaf._kmlLabelSize = polygonLabelSize(leaf, nearby);
      return leaf._kmlLabelSize > 0;
    });
    const pointCount = Math.min(limit - desired.size, points.length);
    for (let index = 0; index < pointCount; index++) desired.add(points[Math.floor(index * points.length / pointCount)]);
    desired.forEach(leaf => {
      if (isPointLeaf(leaf) && leaf !== state.selected && leaf.options.radius !== pointRadius(leaf)) restyle(leaf);
      if (singleCharacterLabel(leaf)) {
        leaf._kmlLabelSize = polygonLabelSize(leaf, nearby);
        updateKmlLabel(leaf);
      }
    });
    lyr.displayed.forEach(leaf => {
      if (!desired.has(leaf)) { map.removeLayer(leaf); lyr.displayed.delete(leaf); }
    });
    desired.forEach(leaf => {
      if (!lyr.displayed.has(leaf)) { lyr.displayed.add(leaf); map.addLayer(leaf); }
    });
    placeSiteLabels(lyr);
  }

  let displayRefreshTimer = null;
  function scheduleMapDisplay() {
    if (displayRefreshTimer !== null) return;
    displayRefreshTimer = setTimeout(() => {
      displayRefreshTimer = null;
      state.layers.forEach(syncLayerDisplay);
    }, 32);
  }
  map.on('moveend zoomend resize', scheduleMapDisplay);

  function configureLayerDisplay(lyr) {
    const group = lyr.group;
    group.onAdd = () => syncLayerDisplay(lyr);
    group.onRemove = () => {
      lyr.displayed.forEach(leaf => map.removeLayer(leaf));
      lyr.displayed.clear();
    };
    group.addLayer = function(leaf) {
      if (this.hasLayer(leaf)) return this;
      lyr.sitePolygons = null;
      leaf.addEventParent(this);
      this._layers[L.stamp(leaf)] = leaf;
      this.fire('layeradd', { layer: leaf });
      if (this._map && lyr.displayed.size < displayLimit() && kmlLeafVisible(lyr, leaf) && !singleCharacterLabel(leaf)) {
        lyr.displayed.add(leaf);
        map.addLayer(leaf);
      }
      if (!lyr.importing) scheduleMapDisplay();
      return this;
    };
    const removeLayer = group.removeLayer;
    group.removeLayer = function(leaf) {
      lyr.sitePolygons = null;
      lyr.displayed.delete(typeof leaf === 'number' ? this.getLayer(leaf) : leaf);
      const result = removeLayer.call(this, leaf);
      scheduleMapDisplay();
      return result;
    };
  }

  function syncKmlVisibility(lyr) {
    if (state.selected?._glayer === lyr && !kmlLeafVisible(lyr, state.selected)) {
      const previous = state.selected;
      state.selected = null;
      restyle(previous);
      map.closePopup();
      renderTable();
    }
    syncLayerDisplay(lyr);
  }

  function restyle(leaf) {
    const lyr = leaf._glayer;
    if (!lyr || !leaf.setStyle) return;
    const st = (leaf.feature && leaf.feature.style) || {};
    const selected = state.selected === leaf;
    const point = isPointLeaf(leaf);
    const num = (v, d) => (v === undefined || v === null || v === '' || isNaN(Number(v)) ? d : Number(v));
    let style;
    if (point) {
      const radius = pointRadius(leaf);
      style = {
        radius: selected ? 9 : radius, color: selected ? '#facc15' : '#ffffff', weight: selected ? 3 : radius / 4,
        fillColor: st['marker-color'] || st['icon-color'] || lyr.color, fillOpacity: 0.95, opacity: 1, fill: true,
      };
    } else if (leaf instanceof L.Polygon) {
      style = {
        color: selected ? '#facc15' : st.stroke || lyr.color, weight: selected ? 4 : num(st['stroke-width'], 2),
        opacity: num(st['stroke-opacity'], 1), fill: true, fillColor: st.fill || lyr.color,
        fillOpacity: num(st['fill-opacity'], 0.25),
      };
    } else {
      style = {
        color: selected ? '#facc15' : st.stroke || lyr.color, weight: selected ? 5 : num(st['stroke-width'], 3),
        opacity: num(st['stroke-opacity'], 1), fill: false,
      };
    }
    if (point && kmlLabelOnly(leaf)) {
      style.fillOpacity = 0;
      style.opacity = selected ? 1 : 0;
      style.weight = selected ? 3 : 0;
    }
    leaf.setStyle(style);
    updateKmlLabel(leaf);
  }

  function wireLeaf(lyr, leaf) {
    leaf._glayer = lyr;
    if (!leaf.feature) leaf.feature = { type: 'Feature', properties: {}, geometry: null };
    if (!leaf.feature.properties) leaf.feature.properties = {};
    leaf.on('click', (ev) => {
      L.DomEvent.stopPropagation(ev);
      selectLeaf(leaf, { fromMap: true });
      if (!pmBusy()) openPopup(leaf, ev.latlng);
    });
    restyle(leaf);
    leaf.on('pm:markerdragstart pm:dragstart', () => { leaf._displayEditing = true; });
    leaf.on('pm:markerdragend pm:dragend', () => { leaf._displayEditing = false; scheduleMapDisplay(); });
    if (leaf.feature.kml) leaf.on('add', () => {
      if (!kmlLeafVisible(lyr, leaf)) map.removeLayer(leaf);
    });
  }

  function createLayer({ name, features = [], fields = [], types = {}, geomType = 'Mixed', format = 'shp', kmlFolders = [], importing = false }) {
    const lyr = {
      id: state.nextId++,
      name,
      color: PALETTE[state.colorIdx++ % PALETTE.length],
      geomType,
      fields: fields.slice(),
      types: { ...types },
      format,
      visible: true,
      importing,
      kmlFolders: kmlFolders.map(folder => ({ ...folder })),
      displayed: new Set(),
      group: null,
    };
    lyr.kmlFolderMap = new Map(lyr.kmlFolders.map(folder => [folder.id, folder]));
    lyr.group = L.geoJSON({ type: 'FeatureCollection', features }, {
      renderer: vectorRenderer,
      pmIgnore: importing,
      pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 3, renderer: vectorRenderer }),
    });
    configureLayerDisplay(lyr);
    lyr.group.eachLayer((leaf) => wireLeaf(lyr, leaf));
    lyr.group.addTo(map);
    state.layers.push(lyr);
    return lyr;
  }

  function leavesOf(lyr) { return lyr.group.getLayers(); }

  function setActive(lyr) {
    state.active = lyr;
    state.page = 0;
    state.filter = '';
    state.sort = null;
    $('filter').value = '';
    if (lyr) $('fmt').value = lyr.format;
    renderAll();
  }

  async function deleteLayer(lyr) {
    if (!(await confirmBox('Delete layer', `Delete “${lyr.name}” and its ${leavesOf(lyr).length} feature(s)? Download it first if you need it.`, 'Delete', true))) return;
    map.removeLayer(lyr.group);
    state.layers = state.layers.filter((l) => l !== lyr);
    if (state.selected && state.selected._glayer === lyr) state.selected = null;
    if (state.active === lyr) state.active = state.layers[state.layers.length - 1] || null;
    renderAll();
  }

  function zoomToLayer(lyr) {
    fitVisibleBounds(lyr.group.getBounds());
  }

  function fitVisibleBounds(bounds, maxZoom = 17) {
    if (!bounds.isValid()) return;
    map.invalidateSize({ pan: false });
    const mapRect = map.getContainer().getBoundingClientRect();
    const workspace = $('workspace').getBoundingClientRect();
    const splitter = $('splitter').getBoundingClientRect();
    map.fitBounds(bounds, {
      maxZoom,
      paddingTopLeft: [Math.max(0, workspace.left - mapRect.left) + 20, Math.max(0, workspace.top - mapRect.top) + 20],
      paddingBottomRight: [Math.max(0, mapRect.right - workspace.right) + 20, Math.max(0, mapRect.bottom - splitter.top) + 20],
    });
  }

  /* ---------- values ---------- */
  function parseValue(type, text) {
    if (text === '') return { ok: true, v: null };
    if (type === 'number') {
      const n = Number(text);
      return isFinite(n) ? { ok: true, v: n } : { ok: false };
    }
    if (type === 'boolean') {
      const t = text.trim().toLowerCase();
      if (['true', 't', 'yes', 'y', '1'].includes(t)) return { ok: true, v: true };
      if (['false', 'f', 'no', 'n', '0'].includes(t)) return { ok: true, v: false };
      return { ok: false };
    }
    return { ok: true, v: text };
  }

  const display = (v) => (v === null || v === undefined ? '' : String(v));

  function setValue(lyr, leaf, field, text) {
    const r = parseValue(lyr.types[field] || 'string', text);
    if (!r.ok) {
      toast(`“${text}” is not a valid ${lyr.types[field]} for field “${field}”.`, 'error');
      return false;
    }
    const properties = leaf.feature.properties;
    const hadValue = Object.prototype.hasOwnProperty.call(properties, field);
    const previousValue = properties[field];
    if (!Object.is(previousValue, r.v)) {
      recordUndo(`cell edit in ${field}`, () => {
        const currentProperties = leaf.feature.properties;
        if (hadValue) currentProperties[field] = previousValue;
        else delete currentProperties[field];
        restyle(leaf);
      });
    }
    properties[field] = r.v;
    restyle(leaf);
    return true;
  }

  /* ---------- selection & popup ---------- */
  function selectLeaf(leaf, { fromMap = false, fromTable = false, pan = false } = {}) {
    const prev = state.selected;
    state.selected = leaf;
    if (prev && prev !== leaf) restyle(prev);
    if (prev && prev._glayer !== leaf._glayer) syncLayerDisplay(prev._glayer);
    syncLayerDisplay(leaf._glayer);
    restyle(leaf);
    if (leaf.bringToFront) leaf.bringToFront();
    if (leaf._glayer !== state.active) {
      state.active = leaf._glayer;
      $('fmt').value = state.active.format;
      state.page = 0;
      state.filter = '';
      state.sort = null;
      $('filter').value = '';
      renderLayers();
      renderTable();
    } else if (fromMap) {
      const idx = filteredLeaves(state.active).indexOf(leaf);
      if (idx >= 0) state.page = Math.floor(idx / PAGE_SIZE);
      renderTable();
    } else if (fromTable) {
      markSelectedRow();
    }
    if (pan) {
      if (isPointLeaf(leaf)) fitVisibleBounds(L.latLngBounds([leaf.getLatLng()]), Math.max(map.getZoom(), 14));
      else if (leaf.getBounds) fitVisibleBounds(leaf.getBounds());
    }
    if (fromMap || pan) scrollToSelectedRow();
  }

  function openPopup(leaf, latlng) {
    const lyr = leaf._glayer;
    const form = document.createElement('div');
    form.className = 'popup-form';
    const h = document.createElement('h4');
    h.textContent = lyr.name;
    form.appendChild(h);
    if (!lyr.fields.length) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'No attribute fields. Add one with “＋ Field”.';
      form.appendChild(p);
    }
    lyr.fields.forEach((f) => {
      const label = document.createElement('label');
      label.append(f);
      const input = document.createElement('input');
      input.value = display(leaf.feature.properties[f]);
      input.addEventListener('change', () => {
        if (!setValue(lyr, leaf, f, input.value)) input.value = display(leaf.feature.properties[f]);
        else renderTable();
      });
      label.appendChild(input);
      form.appendChild(label);
    });
    L.popup({ maxWidth: 320 }).setLatLng(latlng || (leaf.getLatLng ? leaf.getLatLng() : leaf.getBounds().getCenter())).setContent(form).openOn(map);
  }

  /* ---------- drawing ---------- */
  map.on('pm:create', (e) => {
    const leaf = e.layer;
    map.removeLayer(leaf);
    leaf.options.renderer = vectorRenderer;
    let lyr = state.active;
    if (!lyr) {
      lyr = createLayer({ name: 'New layer', fields: ['name'], types: { name: 'string' }, format: 'shp' });
      state.active = lyr;
    }
    const fam = familyOf(leaf);
    if (lyr.geomType !== 'Mixed' && lyr.geomType !== fam) {
      toast(`The active layer “${lyr.name}” only holds ${GEOM_LABEL[lyr.geomType].toLowerCase()}. Select or create a different layer to draw ${GEOM_LABEL[fam].toLowerCase()}.`, 'warn', 7000);
      renderAll();
      return;
    }
    if (leaf instanceof L.CircleMarker) leaf.options.radius = 3;
    const props = {};
    lyr.fields.forEach((f) => { props[f] = null; });
    leaf.feature = { type: 'Feature', properties: props, geometry: null, style: {} };
    lyr.group.addLayer(leaf);
    wireLeaf(lyr, leaf);
    state.selected = null;
    selectLeaf(leaf, { fromMap: true });
  });

  map.on('pm:remove', (e) => {
    const leaf = e.layer;
    const lyr = leaf && leaf._glayer;
    if (!lyr) return;
    lyr.group.removeLayer(leaf);
    if (state.selected === leaf) state.selected = null;
    renderLayers();
    renderTable();
  });

  map.on('pm:cut', () => { renderLayers(); renderTable(); });

  function deleteFeature(lyr, leaf) {
    lyr.group.removeLayer(leaf);
    if (state.selected === leaf) state.selected = null;
    renderLayers();
    renderTable();
  }

  async function bulkDeleteRows() {
    const lyr = state.active;
    if (!lyr || !lyr.fields.length || !leavesOf(lyr).length) {
      return toast('Select a layer with features and attribute columns first.', 'warn');
    }
    const dlg = $('bulkDeleteDlg');
    const form = $('bulkDeleteForm');
    form.reset();
    $('bulkDeleteField').replaceChildren(...lyr.fields.map((field) => {
      const option = document.createElement('option');
      option.value = field;
      option.textContent = field;
      return option;
    }));
    $('bulkDeleteScope').textContent = `All ${leavesOf(lyr).length} features in "${lyr.name}", across all pages. The table search filter is ignored.`;
    let matches = [];
    const updatePreview = () => {
      const field = $('bulkDeleteField').value;
      const op = $('bulkDeleteOperator').value;
      const needsValues = op !== 'empty' && op !== 'not-empty';
      const membership = op === 'in' || op === 'not-in';
      $('bulkDeleteValuesLabel').hidden = !needsValues;
      $('bulkDeleteValues').disabled = !needsValues;
      const lines = $('bulkDeleteValues').value.split(/\r?\n/).map((v) => v.trim()).filter(Boolean);
      const values = [];
      let error = needsValues && !lines.length ? 'Enter at least one value, one per line.' : '';
      if (needsValues) {
        for (const line of lines) {
          const parsed = membership ? parseValue(lyr.types[field] || 'string', line) : { ok: true, v: line };
          if (!parsed.ok) {
            error = `"${line}" is not a valid ${lyr.types[field]} for "${field}".`;
            break;
          }
          values.push(parsed.v);
        }
      }
      matches = error ? [] : leavesOf(lyr).filter((leaf) => {
        const value = leaf.feature.properties[field];
        const empty = value === null || value === undefined || value === '';
        if (op === 'empty') return empty;
        if (op === 'not-empty') return !empty;
        const matched = !empty && (membership ? values.includes(value) : values.some((v) => display(value).includes(v)));
        return op === 'not-in' || op === 'not-contains' ? !matched : matched;
      });
      $('bulkDeletePreview').textContent = error || `${matches.length} features will be deleted; ${leavesOf(lyr).length - matches.length} will remain.`;
      $('bulkDeleteReview').disabled = !!error || !matches.length;
    };
    form.addEventListener('input', updatePreview);
    form.addEventListener('change', updatePreview);
    updatePreview();
    const review = await new Promise((resolve) => {
      dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
      dlg.returnValue = 'cancel';
      dlg.showModal();
      $('bulkDeleteField').focus();
    });
    form.removeEventListener('input', updatePreview);
    form.removeEventListener('change', updatePreview);
    if (!review || !matches.length) return;
    if (!(await confirmBox('Confirm bulk deletion', `Delete ${matches.length} features from "${lyr.name}"? ${leavesOf(lyr).length - matches.length} will remain. This cannot be undone.`, `Delete ${matches.length} features`, true))) return;
    matches.forEach((leaf) => {
      if (state.selected === leaf) {
        state.selected = null;
        map.closePopup();
      }
      lyr.group.removeLayer(leaf);
    });
    state.page = 0;
    renderLayers();
    renderTable();
    toast(`Deleted ${matches.length} features from "${lyr.name}".`);
  }

  /* ---------- fields ---------- */
  async function addField() {
    const lyr = state.active;
    if (!lyr) return toast('Select or create a layer first.', 'warn');
    const r = await askForm('Add attribute field', [
      { key: 'name', label: 'Field name', required: true },
      { key: 'type', label: 'Type', type: 'select', value: 'string', options: [['string', 'Text'], ['number', 'Number'], ['boolean', 'True / False']] },
      { key: 'value', label: 'Default value for existing features', hint: 'Optional' },
    ], { okLabel: 'Add field' });
    if (!r) return;
    const name = r.name.trim();
    if (!name) return;
    if (lyr.fields.includes(name)) return toast(`Field “${name}” already exists.`, 'error');
    const parsed = parseValue(r.type, r.value);
    if (!parsed.ok) return toast(`“${r.value}” is not a valid ${r.type}.`, 'error');
    lyr.fields.push(name);
    lyr.types[name] = r.type;
    leavesOf(lyr).forEach((leaf) => { leaf.feature.properties[name] = parsed.v; });
    recordUndo(`add field ${name}`, () => {
      lyr.fields = lyr.fields.filter((field) => field !== name);
      delete lyr.types[name];
      leavesOf(lyr).forEach((leaf) => { delete leaf.feature.properties[name]; });
    });
    renderTable();
  }

  async function editField(lyr, field) {
    const r = await askForm('Edit field', [
      { key: 'name', label: 'Field name', value: field, required: true },
      { key: 'type', label: 'Type', type: 'select', value: lyr.types[field] || 'string', options: [['string', 'Text'], ['number', 'Number'], ['boolean', 'True / False']] },
    ], { okLabel: 'Save' });
    if (!r) return;
    const name = r.name.trim();
    if (!name) return;
    if (name !== field && lyr.fields.includes(name)) return toast(`Field “${name}” already exists.`, 'error');
    const oldType = lyr.types[field] || 'string';
    const leaves = leavesOf(lyr);
    let converted = null;
    if (r.type !== oldType) {
      converted = [];
      for (const leaf of leaves) {
        const v = leaf.feature.properties[field];
        const p = v === null || v === undefined ? { ok: true, v: null } : parseValue(r.type, String(v));
        if (!p.ok) return toast(`Cannot convert “${v}” to ${r.type}. Fix or clear those values first.`, 'error');
        converted.push(p.v);
      }
    }
    const previous = {
      fields: [...lyr.fields],
      types: { ...lyr.types },
      properties: new Map(leaves.map((leaf) => [leaf, { ...leaf.feature.properties }])),
    };
    leaves.forEach((leaf, i) => {
      const props = leaf.feature.properties;
      const value = converted ? converted[i] : props[field];
      if (name !== field) {
        // Preserve column order by rebuilding the property object.
        const rebuilt = {};
        Object.keys(props).forEach((k) => { rebuilt[k === field ? name : k] = k === field ? value : props[k]; });
        leaf.feature.properties = rebuilt;
      } else {
        props[field] = value;
      }
    });
    const idx = lyr.fields.indexOf(field);
    lyr.fields[idx] = name;
    delete lyr.types[field];
    lyr.types[name] = r.type;
    recordUndo(`edit field ${field}`, () => {
      leavesOf(lyr).forEach((leaf) => {
        const saved = previous.properties.get(leaf);
        if (saved) {
          leaf.feature.properties = { ...saved };
          return;
        }
        const properties = {};
        previous.fields.forEach((previousField) => {
          const currentField = previousField === field ? name : previousField;
          properties[previousField] = leaf.feature.properties[currentField] ?? null;
        });
        leaf.feature.properties = properties;
      });
      lyr.fields.splice(0, lyr.fields.length, ...previous.fields);
      lyr.types = { ...previous.types };
    });
    renderTable();
  }

  async function deleteField(lyr, field) {
    if (!(await confirmBox('Delete field', `Delete the field “${field}” from every feature in “${lyr.name}”?`))) return;
    const index = lyr.fields.indexOf(field);
    const fieldType = lyr.types[field];
    const properties = new Map(leavesOf(lyr).map((leaf) => [leaf, { ...leaf.feature.properties }]));
    lyr.fields = lyr.fields.filter((f) => f !== field);
    delete lyr.types[field];
    leavesOf(lyr).forEach((leaf) => { delete leaf.feature.properties[field]; });
    recordUndo(`delete field ${field}`, () => {
      lyr.fields.splice(index, 0, field);
      if (fieldType !== undefined) lyr.types[field] = fieldType;
      leavesOf(lyr).forEach((leaf) => {
        leaf.feature.properties = { ...(properties.get(leaf) || leaf.feature.properties) };
        if (!Object.prototype.hasOwnProperty.call(leaf.feature.properties, field)) leaf.feature.properties[field] = null;
      });
    });
    renderTable();
  }

  /* ---------- rendering ---------- */
  function renderAll() {
    renderLayers();
    renderTable();
    $('btnDownload').disabled = state.layers.length === 0;
    $('emptyState').classList.toggle('hidden', state.layers.length > 0);
    $('layerHint').style.display = state.layers.length ? 'none' : '';
  }

  function iconButton(icon, title, onClick) {
    const b = document.createElement('button');
    b.appendChild(actionIcon(icon));
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return b;
  }

  function actionIcon(name) {
    const icon = lucide.createElement(lucide.icons[name]);
    icon.setAttribute('class', 'action-icon');
    icon.setAttribute('width', '14');
    icon.setAttribute('height', '14');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
    return icon;
  }

  function geometryPreview(leaf) {
    const geometry = leaf.toGeoJSON(6).geometry;
    const paths = [];
    const points = [];
    const addPath = (coordinates, closed = false) => {
      if (!coordinates.length || paths.length >= 24) return;
      const maxPoints = 40;
      const sampled = coordinates.length <= maxPoints
        ? coordinates
        : Array.from({ length: maxPoints }, (_, i) => coordinates[Math.round(i * (coordinates.length - 1) / (maxPoints - 1))]);
      paths.push({ coordinates: sampled, closed });
    };
    const collect = (shape) => {
      if (!shape) return;
      if (shape.type === 'GeometryCollection') return shape.geometries.forEach(collect);
      const coordinates = shape.coordinates;
      if (shape.type === 'Point') points.push(coordinates);
      else if (shape.type === 'MultiPoint') points.push(...coordinates.slice(0, 40));
      else if (shape.type === 'LineString') addPath(coordinates);
      else if (shape.type === 'MultiLineString') coordinates.forEach((line) => addPath(line));
      else if (shape.type === 'Polygon') coordinates.forEach((ring) => addPath(ring, true));
      else if (shape.type === 'MultiPolygon') coordinates.forEach((polygon) => polygon.forEach((ring) => addPath(ring, true)));
    };
    collect(geometry);

    const allCoordinates = [...points, ...paths.flatMap((path) => path.coordinates)];
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'geometry-preview');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('aria-hidden', 'true');
    if (!allCoordinates.length) return svg;

    const xs = allCoordinates.map((coordinate) => coordinate[0]);
    const ys = allCoordinates.map((coordinate) => coordinate[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const extent = Math.max(maxX - minX, maxY - minY) || 1;
    const scale = 20 / extent;
    const offsetX = (24 - (maxX - minX) * scale) / 2;
    const offsetY = (24 - (maxY - minY) * scale) / 2;
    const project = ([x, y]) => [offsetX + (x - minX) * scale, 24 - offsetY - (y - minY) * scale];
    const style = leaf.options || {};
    const stroke = style.color || '#2563eb';
    const fill = style.fillColor || stroke;
    const fillOpacity = style.fillOpacity === undefined ? 0.25 : style.fillOpacity;

    paths.forEach(({ coordinates, closed }) => {
      const projected = coordinates.map(project);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', projected.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ') + (closed ? ' Z' : ''));
      path.setAttribute('fill', closed ? fill : 'none');
      path.setAttribute('fill-opacity', String(fillOpacity));
      path.setAttribute('fill-rule', 'evenodd');
      path.setAttribute('stroke', stroke);
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(path);
    });
    points.slice(0, 40).forEach((coordinate) => {
      const [cx, cy] = project(coordinate);
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', cx.toFixed(2));
      circle.setAttribute('cy', cy.toFixed(2));
      circle.setAttribute('r', '2.5');
      circle.setAttribute('fill', fill);
      circle.setAttribute('fill-opacity', String(fillOpacity));
      circle.setAttribute('stroke', stroke);
      circle.setAttribute('stroke-width', '1');
      svg.appendChild(circle);
    });
    return svg;
  }

  function renderLayers() {
    const ul = $('layerList');
    ul.replaceChildren();
    state.layers.forEach((lyr) => {
      syncLayerDisplay(lyr);
      const li = document.createElement('li');
      if (lyr === state.active) li.classList.add('active');
      li.addEventListener('click', () => setActive(lyr));

      const vis = document.createElement('input');
      vis.type = 'checkbox';
      vis.checked = lyr.visible;
      vis.title = 'Show / hide';
      vis.addEventListener('click', (e) => e.stopPropagation());
      vis.addEventListener('change', () => {
        lyr.visible = vis.checked;
        if (lyr.visible) lyr.group.addTo(map); else map.removeLayer(lyr.group);
        syncKmlVisibility(lyr);
      });

      const color = document.createElement('input');
      color.type = 'color';
      color.value = lyr.color;
      color.title = 'Layer colour (also exported to KML/KMZ)';
      color.addEventListener('click', (e) => e.stopPropagation());
      color.addEventListener('input', () => {
        lyr.color = color.value;
        leavesOf(lyr).forEach((leaf) => {
          leaf.feature.style = { ...(leaf.feature.style || {}), stroke: color.value, fill: color.value, 'marker-color': color.value };
          restyle(leaf);
        });
      });

      const name = document.createElement('span');
      name.className = 'lname';
      name.textContent = lyr.name;
      name.title = lyr.name;

      const meta = document.createElement('div');
      meta.className = 'lmeta';
      const info = document.createElement('span');
      const featureCount = leavesOf(lyr).length;
      info.textContent = `${featureCount} ${featureCount === 1 ? 'feature' : 'features'} · ${GEOM_LABEL[lyr.geomType]}`;
      const sp = document.createElement('span');
      sp.className = 'spacer';
      const downloadButton = iconButton('Download', 'Download this layer', () => downloadLayers([lyr]));
      meta.append(
        info, sp,
        iconButton('Pencil', 'Rename layer', async () => {
          const r = await askForm('Rename layer', [{ key: 'name', label: 'Layer name', value: lyr.name, required: true }], { okLabel: 'Rename' });
          if (r && r.name.trim()) { lyr.name = r.name.trim(); renderLayers(); renderTable(); }
        }),
        iconButton('Search', 'Zoom to layer', () => zoomToLayer(lyr)),
        downloadButton,
        iconButton('Trash2', 'Delete layer', () => deleteLayer(lyr))
      );
      li.append(vis, color, name, meta);
      if (lyr.kmlFolders.length) li.appendChild(renderKmlFolders(lyr));
      ul.appendChild(li);
    });
  }

  function renderKmlFolders(lyr) {
    const tree = document.createElement('div');
    tree.className = 'kml-folder-tree';
    tree.setAttribute('role', 'group');
    tree.setAttribute('aria-label', `${lyr.name} folders`);
    tree.addEventListener('click', event => event.stopPropagation());
    const members = new Map(lyr.kmlFolders.map(folder => [folder.id, []]));
    leavesOf(lyr).forEach(leaf => (leaf.feature?.kml?.folderIds || []).forEach(id => members.get(id)?.push(leaf)));
    function appendFolders(parent, parentId) {
      lyr.kmlFolders.filter(folder => folder.parentId === parentId).forEach(folder => {
        const branch = document.createElement('div');
        branch.className = 'kml-folder-branch';
        const row = document.createElement('div');
        row.className = 'kml-folder-row';
        const children = document.createElement('div');
        children.className = 'kml-folder-children';
        children.id = `kml-${lyr.id}-${folder.id}`;
        children.hidden = !folder.expanded;
        const disclosureTitle = () => `${folder.expanded ? 'Collapse' : 'Expand'} folder ${folder.name}`;
        const disclosure = iconButton(folder.expanded ? 'ChevronDown' : 'ChevronRight', disclosureTitle(), () => {
          folder.expanded = !folder.expanded;
          children.hidden = !folder.expanded;
          disclosure.replaceChildren(actionIcon(folder.expanded ? 'ChevronDown' : 'ChevronRight'));
          disclosure.title = disclosureTitle();
          disclosure.setAttribute('aria-label', disclosureTitle());
          disclosure.setAttribute('aria-expanded', String(folder.expanded));
        });
        disclosure.setAttribute('aria-expanded', String(folder.expanded));
        disclosure.setAttribute('aria-controls', children.id);
        const visible = document.createElement('input');
        visible.type = 'checkbox';
        visible.checked = folder.visible;
        visible.title = `Show / hide folder ${folder.name}`;
        visible.setAttribute('aria-label', visible.title);
        visible.addEventListener('change', () => {
          folder.visible = visible.checked;
          syncKmlVisibility(lyr);
        });
        const name = document.createElement('span');
        name.className = 'kml-folder-name';
        name.textContent = folder.name;
        name.title = folder.name;
        const count = document.createElement('span');
        count.className = 'kml-folder-count';
        count.textContent = members.get(folder.id).length;
        const zoom = iconButton('Search', `Zoom to folder ${folder.name}`, () => {
          const bounds = L.latLngBounds([]);
          members.get(folder.id).forEach(leaf => bounds.extend(leaf.getBounds ? leaf.getBounds() : leaf.getLatLng()));
          fitVisibleBounds(bounds);
        });
        zoom.disabled = !members.get(folder.id).length;
        row.append(disclosure, visible, name, count, zoom);
        appendFolders(children, folder.id);
        branch.append(row, children);
        parent.appendChild(branch);
      });
    }
    appendFolders(tree, null);
    return tree;
  }

  function filteredLeaves(lyr) {
    const all = leavesOf(lyr);
    const q = state.filter.trim().toLowerCase();
    if (!q) return all;
    return all.filter((leaf) => lyr.fields.some((f) => display(leaf.feature.properties[f]).toLowerCase().includes(q)));
  }

  function sortedLeaves(lyr) {
    const items = filteredLeaves(lyr);
    if (!state.sort || !lyr.fields.includes(state.sort.field)) return items;
    const { field, direction } = state.sort;
    const type = lyr.types[field] || 'string';
    return items.map((leaf, index) => ({ leaf, index })).sort((a, b) => {
      const aValue = a.leaf.feature.properties[field];
      const bValue = b.leaf.feature.properties[field];
      const aEmpty = aValue === null || aValue === undefined || aValue === '';
      const bEmpty = bValue === null || bValue === undefined || bValue === '';
      if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
      if (aEmpty) return a.index - b.index;
      let result;
      if (type === 'number') result = Number(aValue) - Number(bValue);
      else if (type === 'boolean') result = Number(Boolean(aValue)) - Number(Boolean(bValue));
      else result = String(aValue).localeCompare(String(bValue), undefined, { numeric: true, sensitivity: 'base' });
      return result ? result * (direction === 'asc' ? 1 : -1) : a.index - b.index;
    }).map(({ leaf }) => leaf);
  }

  function renderTable() {
    const lyr = state.active;
    const wrap = $('tableWrap');
    wrap.replaceChildren();
    $('btnAddField').disabled = !lyr;
    $('btnBulkDelete').disabled = !lyr || !lyr.fields.length || !leavesOf(lyr).length;
    $('filter').disabled = !lyr;
    $('btnFilter').disabled = !lyr;
    $('btnFilter').setAttribute('aria-pressed', String(Boolean(state.filter)));
    $('btnFilter').title = state.filter ? `Filter rows: ${state.filter}` : 'Filter rows';
    if (!lyr) {
      $('tableTitle').textContent = 'Attribute table';
      $('tableCount').textContent = '';
      $('pager').style.display = 'none';
      const d = document.createElement('div');
      d.className = 'empty';
      d.textContent = 'Select a layer to view and edit its attributes.';
      wrap.appendChild(d);
      return;
    }
    const items = sortedLeaves(lyr);
    const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages - 1);
    $('tableTitle').textContent = lyr.name;
    $('tableCount').textContent = `${items.length}${items.length !== leavesOf(lyr).length ? ' of ' + leavesOf(lyr).length : ''} ${leavesOf(lyr).length === 1 ? 'feature' : 'features'}`;
    $('pager').style.display = pages > 1 ? '' : 'none';
    $('pgInfo').textContent = `Page ${state.page + 1} / ${pages}`;
    $('pgPrev').disabled = state.page === 0;
    $('pgNext').disabled = state.page >= pages - 1;

    if (!items.length) {
      const d = document.createElement('div');
      d.className = 'empty';
      d.textContent = leavesOf(lyr).length ? 'No rows match the filter.' : 'This layer has no features yet. Use the drawing tools on the map to add some.';
      wrap.appendChild(d);
      if (!lyr.fields.length) return;
    }

    const table = document.createElement('table');
    table.className = 'attrs';
    const savedWidths = columnWidths.get(lyr) || new Map();
    columnWidths.set(lyr, savedWidths);
    const colgroup = document.createElement('colgroup');
    const columns = Array.from({ length: lyr.fields.length + 2 }, () => document.createElement('col'));
    colgroup.append(...columns);
    table.appendChild(colgroup);
    let sizes;
    const resizeColumn = (index, width) => {
      sizes[index] = Math.max(MIN_COLUMN_WIDTH, Math.round(width));
      columns[index].style.width = `${sizes[index]}px`;
      table.style.width = `${sizes.reduce((total, size) => total + size, 0)}px`;
      savedWidths.set(lyr.fields[index - 2], sizes[index]);
      table.tHead.rows[0].cells[index].querySelector('.column-resizer').setAttribute('aria-valuenow', sizes[index]);
    };
    const thead = table.createTHead().insertRow();
    const previewHeader = document.createElement('th');
    previewHeader.className = 'geometry-cell';
    previewHeader.setAttribute('aria-label', 'Geometry preview and feature actions');
    previewHeader.title = 'Geometry preview and feature actions';
    thead.appendChild(previewHeader);
    const th0 = document.createElement('th');
    th0.className = 'rn';
    th0.textContent = '#';
    thead.appendChild(th0);
    lyr.fields.forEach((f, fieldIndex) => {
      const th = document.createElement('th');
      const box = document.createElement('div');
      box.className = 'th';
      const nameBtn = document.createElement('button');
      nameBtn.className = 'fname';
      const label = document.createElement('span');
      label.textContent = f;
      nameBtn.appendChild(label);
      nameBtn.title = 'Rename field / change type';
      nameBtn.addEventListener('click', () => editField(lyr, f));
      const sortBtn = document.createElement('button');
      sortBtn.className = 'sort';
      const isSorted = state.sort && state.sort.field === f;
      sortBtn.appendChild(actionIcon(isSorted ? (state.sort.direction === 'asc' ? 'ArrowUp' : 'ArrowDown') : 'ArrowUpDown'));
      sortBtn.title = isSorted ? `Sorted ${state.sort.direction === 'asc' ? 'ascending' : 'descending'}; click to reverse` : `Sort by ${f} ascending`;
      sortBtn.setAttribute('aria-label', sortBtn.title);
      sortBtn.addEventListener('click', () => {
        state.sort = { field: f, direction: isSorted && state.sort.direction === 'asc' ? 'desc' : 'asc' };
        state.page = 0;
        renderTable();
      });
      const x = document.createElement('button');
      x.className = 'x';
      x.appendChild(actionIcon('X'));
      x.title = 'Delete field';
      x.setAttribute('aria-label', `Delete field ${f}`);
      x.addEventListener('click', () => deleteField(lyr, f));
      box.append(nameBtn, sortBtn, x);
      const resizer = document.createElement('span');
      resizer.className = 'column-resizer';
      resizer.tabIndex = 0;
      resizer.title = `Resize column ${f}`;
      resizer.setAttribute('role', 'separator');
      resizer.setAttribute('aria-label', resizer.title);
      resizer.setAttribute('aria-orientation', 'vertical');
      resizer.setAttribute('aria-valuemin', MIN_COLUMN_WIDTH);
      resizer.title = `Resize column ${f}; double-click to fit`;
      const fitColumn = async () => {
        await document.fonts.ready;
        if (!table.isConnected) return;
        const context = document.createElement('canvas').getContext('2d');
        if (!context) return;
        const nameStyle = getComputedStyle(nameBtn);
        context.font = nameStyle.font;
        let width = context.measureText(f).width + box.getBoundingClientRect().width - nameBtn.getBoundingClientRect().width
          + parseFloat(nameStyle.paddingLeft) + parseFloat(nameStyle.paddingRight) + resizer.offsetWidth;
        const input = table.querySelector('tbody input');
        const valueStyle = getComputedStyle(input || table);
        context.font = valueStyle.font;
        const padding = input ? parseFloat(valueStyle.paddingLeft) + parseFloat(valueStyle.paddingRight) : 16;
        leavesOf(lyr).forEach(leaf => {
          width = Math.max(width, context.measureText(display(leaf.feature.properties[f])).width + padding);
        });
        resizeColumn(fieldIndex + 2, Math.ceil(width + parseFloat(getComputedStyle(th).borderRightWidth) + 2));
      };
      resizer.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
        fitColumn();
      });
      let drag;
      resizer.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        drag = { startX: event.clientX, width: sizes[fieldIndex + 2] };
        resizer.setPointerCapture(event.pointerId);
        table.classList.add('resizing');
        [...table.rows].forEach(row => row.cells[fieldIndex + 2].classList.add('resizing-column'));
      });
      resizer.addEventListener('pointermove', (event) => {
        if (drag) resizeColumn(fieldIndex + 2, drag.width + event.clientX - drag.startX);
      });
      resizer.addEventListener('lostpointercapture', () => {
        drag = null;
        table.classList.remove('resizing');
        table.querySelectorAll('.resizing-column').forEach(cell => cell.classList.remove('resizing-column'));
      });
      resizer.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          fitColumn();
          return;
        }
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const step = event.shiftKey ? 50 : 10;
        resizeColumn(fieldIndex + 2, sizes[fieldIndex + 2] + (event.key === 'ArrowRight' ? step : -step));
      });
      th.append(box, resizer);
      thead.appendChild(th);
    });

    const tbody = table.createTBody();
    const start = state.page * PAGE_SIZE;
    items.slice(start, start + PAGE_SIZE).forEach((leaf, i) => {
      const tr = tbody.insertRow();
      tr._leaf = leaf;
      if (leaf === state.selected) tr.classList.add('sel');
      const preview = tr.insertCell();
      preview.className = 'geometry-cell';
      const previewContent = document.createElement('div');
      previewContent.className = 'preview-content';
      preview.appendChild(previewContent);
      const rn = tr.insertCell();
      rn.className = 'rn';
      const rnContent = document.createElement('div');
      rnContent.className = 'rn-content';
      const rowNumber = document.createElement('span');
      rowNumber.textContent = String(start + i + 1);
      const rowActions = document.createElement('span');
      rowActions.className = 'rn-actions';
      rowActions.append(
        iconButton('Search', 'Zoom to feature', () => selectLeaf(leaf, { fromTable: true, pan: true })),
        iconButton('Download', 'Download this feature', () => downloadFeature(lyr, leaf)),
        iconButton('Trash2', 'Delete feature', () => deleteFeature(lyr, leaf))
      );
      previewContent.append(geometryPreview(leaf), rowActions);
      rnContent.appendChild(rowNumber);
      rn.appendChild(rnContent);
      lyr.fields.forEach((f) => {
        const td = tr.insertCell();
        const input = document.createElement('input');
        input.value = display(leaf.feature.properties[f]);
        input.addEventListener('focus', () => selectLeaf(leaf, { fromTable: true }));
        input.addEventListener('change', () => {
          if (!setValue(lyr, leaf, f, input.value)) input.value = display(leaf.feature.properties[f]);
        });
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { input.blur(); }
          if (e.key === 'Escape') { input.value = display(leaf.feature.properties[f]); input.blur(); }
        });
        td.appendChild(input);
      });
    });
    wrap.appendChild(table);
    sizes = [...thead.cells].map((cell, index) => index === 0 ? 112 : index === 1
      ? Math.max(40, String(items.length).length * 10 + 16)
      : savedWidths.get(lyr.fields[index - 2]) || Math.max(MIN_COLUMN_WIDTH, cell.getBoundingClientRect().width));
    columns.forEach((column, index) => { column.style.width = `${sizes[index]}px`; });
    table.style.tableLayout = 'fixed';
    table.style.width = `${sizes.reduce((total, size) => total + size, 0)}px`;
    lyr.fields.forEach((field, index) => {
      savedWidths.set(field, sizes[index + 2]);
      thead.cells[index + 2].querySelector('.column-resizer').setAttribute('aria-valuenow', sizes[index + 2]);
    });
  }

  function markSelectedRow() {
    document.querySelectorAll('#tableWrap tr.sel').forEach((r) => r.classList.remove('sel'));
    document.querySelectorAll('#tableWrap tbody tr').forEach((r) => {
      if (r._leaf === state.selected) r.classList.add('sel');
    });
  }

  function scrollToSelectedRow() {
    const row = [...document.querySelectorAll('#tableWrap tbody tr')].find((r) => r._leaf === state.selected);
    if (row) row.scrollIntoView({ block: 'nearest' });
  }

  /* ---------- import ---------- */
  let importQueue = Promise.resolve();
  let importWorkersEnabled = typeof Worker === 'function' && /^https?:$/.test(location.protocol);
  const paintImport = async (signal) => {
    signal.throwIfAborted();
    await new Promise(resolve => setTimeout(resolve, 0));
    signal.throwIfAborted();
  };

  async function importStep(work, signal) {
    signal.throwIfAborted();
    let abort;
    const cancelled = new Promise((resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
    });
    try { return await Promise.race([work(), cancelled]); }
    finally { signal.removeEventListener('abort', abort); }
  }

  function startImportProgress(files) {
    const controller = new AbortController();
    const button = $('btnCancelImport');
    const cancel = () => controller.abort();
    button.disabled = false;
    button.addEventListener('click', cancel);
    let completed = 0;
    let currentProgress = 0;
    let percent = 0;
    let columns = 1;
    const track = $('importProgressTrack');
    const revealColumns = () => {
      track.style.setProperty('--import-reveal', `${Math.floor(percent * columns / 100) / columns * 100}%`);
    };
    const columnObserver = new ResizeObserver(([entry]) => {
      columns = Math.max(1, Math.round(entry.contentRect.width / 6));
      revealColumns();
    });
    columnObserver.observe(track);
    revealColumns();
    const show = () => {
      $('importProgress').hidden = false;
      $('mapWrap').classList.add('importing');
    };
    const timer = setTimeout(show, 1000);
    $('mapWrap').setAttribute('aria-busy', 'true');
    if (files.some(file => file.size >= 1024 * 1024)) show();
    return {
      signal: controller.signal,
      update(index, name, fraction, stage, count = 1) {
        controller.signal.throwIfAborted();
        if (index !== completed) { completed = index; currentProgress = 0; }
        currentProgress = Math.max(currentProgress, fraction);
        percent = Math.floor((index + currentProgress * count) / files.length * 100);
        revealColumns();
        const label = files.length === 1 ? '1 file' : `${index + 1} of ${files.length} files`;
        $('importProgressBar').value = percent;
        $('importProgressBar').setAttribute('aria-valuetext', `${percent}% - ${label}`);
        $('importProgressStatus').textContent = `${percent}% - ${label}`;
        $('importProgressFile').textContent = name;
        $('importProgressFile').title = name;
      },
      close() {
        clearTimeout(timer);
        columnObserver.disconnect();
        button.removeEventListener('click', cancel);
        $('importProgress').hidden = true;
        $('mapWrap').classList.remove('importing');
        $('mapWrap').removeAttribute('aria-busy');
      },
    };
  }

  function readImportFile(file, binary, report, signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      const abort = () => reader.abort();
      signal.addEventListener('abort', abort, { once: true });
      reader.onloadend = () => signal.removeEventListener('abort', abort);
      reader.onprogress = event => {
        if (!signal.aborted && event.lengthComputable) report(event.loaded / Math.max(1, event.total) * .2, 'Reading file');
      };
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Could not read the file.'));
      reader.onabort = () => reject(signal.reason || new Error('File reading was interrupted.'));
      if (binary) reader.readAsArrayBuffer(file);
      else reader.readAsText(file);
    });
  }

  async function appendImportFeatures(lyr, features, report, context) {
    let sliceStart = performance.now();
    for (let offset = 0; offset < features.length; offset += 100) {
      context.signal.throwIfAborted();
      const batch = L.geoJSON(features.slice(offset, offset + 100), {
        renderer: vectorRenderer, pointToLayer: lyr.group.options.pointToLayer,
      });
      batch.eachLayer(leaf => { wireLeaf(lyr, leaf); lyr.group.addLayer(leaf); });
      report(Math.min(offset + 100, features.length) / features.length);
      if (performance.now() - sliceStart >= 8 || offset + 100 >= features.length) {
        await paintImport(context.signal);
        sliceStart = performance.now();
      }
    }
  }

  function finishImportedLayer(lyr, prep) {
    lyr.importing = false;
    lyr.group.options.pmIgnore = false;
    L.PM.reInitLayer(lyr.group);
    scheduleMapDisplay();
    const notes = [];
    if (prep.split) notes.push(`${prep.split} multi-part geometry collection(s) were split into separate features`);
    if (prep.skipped) notes.push(`${prep.skipped} feature(s) without geometry were skipped`);
    const count = prep.count ?? prep.features.length;
    toast(`Loaded “${lyr.name}” (${count} features)` + (notes.length ? ' – ' + notes.join('; ') : ''));
  }

  function parseKmlCollection(text, fallbackName) {
    const dom = new DOMParser().parseFromString(text, 'text/xml');
    if (dom.querySelector('parsererror')) throw new Error('Not a valid KML document.');
    const collection = ImportCore.fromKml(dom, toGeoJSON);
    const docName = dom.querySelector('Document > name');
    return { collection, name: (docName && docName.textContent.trim()) || fallbackName };
  }

  function loadImportWorker(job, report, context) {
    if (!importWorkersEnabled) return Promise.resolve(null);
    let worker;
    try { worker = new Worker(new URL('js/import-worker.js', document.baseURI)); }
    catch { importWorkersEnabled = false; return Promise.resolve(null); }
    return new Promise((resolve, reject) => {
      let ready = false;
      let settled = false;
      let current = null;
      let metadata = null;
      let last = null;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(startupTimer);
        context.signal.removeEventListener('abort', abort);
        worker.terminate();
        if (error && current) {
          map.removeLayer(current.group);
          state.layers = state.layers.filter(layer => layer !== current);
        }
        if (error) reject(error);
        else resolve(result);
      };
      const abort = () => finish(context.signal.reason);
      const startupTimer = setTimeout(() => {
        if (!ready) { importWorkersEnabled = false; finish(null, null); }
      }, 5000);
      context.signal.addEventListener('abort', abort, { once: true });
      worker.onerror = event => {
        event.preventDefault();
        if (!ready) { importWorkersEnabled = false; finish(null, null); }
        else finish(new Error(event.message || 'Background import failed.'));
      };
      worker.onmessageerror = () => finish(new Error('Could not receive background import data.'));
      worker.onmessage = async event => {
        if (settled) return;
        try {
          context.signal.throwIfAborted();
          const data = event.data;
          let value;
          if (data.type === 'ready') {
            ready = true;
            clearTimeout(startupTimer);
            worker.postMessage({ ...job, type: 'import' });
            return;
          }
          if (data.type === 'progress') { report(data.fraction, 'Processing file'); return; }
          if (data.type === 'warning') { toast(data.message, data.kind, 9000); return; }
          if (data.type === 'error') { finish(new Error(data.message)); return; }
          if (data.type === 'done') { finish(null, { layer: last }); return; }
          if (data.type === 'kml') {
            await paintImport(context.signal);
            value = parseKmlCollection(data.text, data.name);
          } else if (data.type === 'layer') {
            metadata = data.metadata;
            current = createLayer({ name: data.name, format: data.format, ...metadata, importing: true });
            context.layers.add(current);
          } else if (data.type === 'features') {
            await appendImportFeatures(current, data.features,
              fraction => report(data.start + (data.end - data.start) * fraction, 'Building layer'), context);
          } else if (data.type === 'layer-end') {
            finishImportedLayer(current, metadata);
            last = current;
            current = null;
          }
          if (!settled) worker.postMessage({ type: 'ack', value });
        } catch (error) { finish(error); }
      };
      if (context.signal.aborted) abort();
    });
  }

  async function addFromFeatureCollection(fc, name, format, report, context) {
    report(.55, 'Preparing features');
    await paintImport(context.signal);
    const prep = ImportCore.prepare(fc, format);
    if (!prep.features.length) { toast(`“${name}” contains no features with geometry.`, 'warn'); return null; }
    if (!ImportCore.lonLatLooksValid(prep.features)) {
      toast(`“${name}”: coordinates are not longitude/latitude. A shapefile in a projected CRS needs its .prj file included.`, 'error', 9000);
      return null;
    }
    const lyr = createLayer({ name, fields: prep.fields, types: prep.types, geomType: prep.geomType, format, kmlFolders: prep.kmlFolders, importing: true });
    context.layers.add(lyr);
    try {
      await appendImportFeatures(lyr, prep.features, fraction => report(.6 + .35 * fraction, 'Building layer'), context);
    } catch (error) {
      map.removeLayer(lyr.group);
      state.layers = state.layers.filter(layer => layer !== lyr);
      throw error;
    }
    finishImportedLayer(lyr, prep);
    return lyr;
  }

  async function loadKmlText(text, fallbackName, format, report, context) {
    report(.35, 'Parsing KML');
    await paintImport(context.signal);
    const converted = parseKmlCollection(text, fallbackName);
    return addFromFeatureCollection(converted.collection, converted.name, format, report, context);
  }

  async function loadShapefileBuffer(buf, fallbackName, report, context) {
    report(.35, 'Parsing shapefile');
    await paintImport(context.signal);
    const result = await importStep(() => shp(buf), context.signal);
    const collections = [].concat(result);
    let last = null;
    for (const [index, fc] of collections.entries()) {
      const name = collections.length > 1 && fc.fileName ? baseName(fc.fileName) : fallbackName;
      last = (await addFromFeatureCollection(fc, name, 'shp', (fraction, stage) => report(.5 + .45 * (index + fraction) / collections.length, stage), context)) || last;
    }
    return last;
  }

  async function loadFile(file, report, context) {
    const signal = context.signal;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const name = baseName(file.name);
    if (file.size >= 1024 * 1024 || ext === 'zip' || ext === 'kmz') {
      const threaded = await loadImportWorker({ file }, report, context);
      if (threaded) return threaded.layer;
    }
    if (ext === 'kml') return loadKmlText(await readImportFile(file, false, report, signal), name, 'kml', report, context);
    if (ext === 'geojson' || ext === 'json') {
      const text = await readImportFile(file, false, report, signal);
      report(.3, 'Parsing GeoJSON');
      await paintImport(signal);
      const gj = JSON.parse(text);
      const fc = gj.type === 'FeatureCollection' ? gj : gj.type === 'Feature' ? { features: [gj] } : { features: [{ type: 'Feature', properties: {}, geometry: gj }] };
      return addFromFeatureCollection(fc, name, 'geojson', report, context);
    }
    if (ext === 'kmz' || ext === 'zip') {
      const buf = await readImportFile(file, true, report, signal);
      report(.25, 'Opening archive');
      await paintImport(signal);
      const zip = await importStep(() => JSZip.loadAsync(buf), signal);
      const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir && !/(^|\/)__MACOSX\//.test(n));
      if (ext === 'zip' && names.some((n) => /\.shp$/i.test(n))) return loadShapefileBuffer(buf, name, report, context);
      const kmlName = names.find((n) => /(^|\/)doc\.kml$/i.test(n)) || names.find((n) => /\.kml$/i.test(n));
      if (kmlName) return loadKmlText(await importStep(() => zip.files[kmlName].async('string', meta => {
        if (!signal.aborted) report(.3 + .2 * meta.percent / 100, 'Extracting KML');
      }), signal), name, ext === 'kmz' ? 'kmz' : 'kml', report, context);
      throw new Error(ext === 'kmz' ? 'No .kml found inside the KMZ.' : 'No .shp (shapefile) or .kml found inside the zip.');
    }
    throw new Error(`Unsupported file type “.${ext}”.`);
  }

  function handleFiles(fileList) {
    const files = [...fileList];
    const pending = importQueue.then(() => importFiles(files));
    importQueue = pending.catch(() => {});
    return pending;
  }

  async function importFiles(files) {
    if (!files.length) return;
    const loose = files.filter((f) => /\.(shp|shx|dbf|prj|cpg)$/i.test(f.name));
    const rest = files.filter((f) => !loose.includes(f));
    const progress = startImportProgress(files);
    const context = { signal: progress.signal, layers: new Set() };
    let lastLayer = null;
    try {
      for (const [index, file] of rest.entries()) {
        context.signal.throwIfAborted();
        context.layers.clear();
        const report = (fraction, stage) => progress.update(index, file.name, fraction, stage);
        report(0, 'Reading file');
        await paintImport(context.signal);
        try { lastLayer = (await loadFile(file, report, context)) || lastLayer; } catch (err) {
          if (context.signal.aborted) throw err;
          toast(`${file.name}: ${err.message || err}`, 'error', 9000);
        }
        report(1, 'File processed');
      }
      if (loose.length) {
        context.signal.throwIfAborted();
        context.layers.clear();
        const shpFile = loose.find(file => /\.shp$/i.test(file.name));
        const report = (fraction, stage) => {
          progress.update(rest.length, `${shpFile ? shpFile.name : 'Shapefile parts'} (+${loose.length - 1} supporting files)`, fraction, stage, loose.length);
        };
        report(0, 'Packing shapefile parts');
        await paintImport(context.signal);
        try {
          if (!shpFile) throw new Error('Select the .shp file together with its .dbf and .prj, or upload a zip.');
          const threaded = await loadImportWorker({ files: loose }, report, context);
          if (threaded) lastLayer = threaded.layer || lastLayer;
          else {
            const zip = new JSZip();
            loose.forEach((file) => zip.file(file.name, file));
            const buf = await importStep(() => zip.generateAsync({ type: 'arraybuffer' }, meta => {
              if (!context.signal.aborted) report(.2 * meta.percent / 100, 'Packing shapefile parts');
            }), context.signal);
            lastLayer = (await loadShapefileBuffer(buf, baseName(shpFile.name), report, context)) || lastLayer;
          }
        } catch (err) {
          if (context.signal.aborted) throw err;
          toast(`Shapefile parts: ${err.message || err}`, 'error', 9000);
        }
        report(1, 'Files processed');
      }
      context.signal.throwIfAborted();
      $('btnCancelImport').disabled = true;
      if (lastLayer) {
        setActive(lastLayer);
        const b = L.featureGroup(state.layers.map((l) => l.group)).getBounds();
        fitVisibleBounds(b);
      }
      if (!$('importProgress').hidden) await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      if (!context.signal.aborted) throw error;
      context.layers.forEach(layer => map.removeLayer(layer.group));
      state.layers = state.layers.filter(layer => !context.layers.has(layer));
      if (context.layers.has(state.selected?._glayer)) state.selected = null;
      if (context.layers.has(state.active)) state.active = null;
      if (lastLayer && state.layers.includes(lastLayer)) setActive(lastLayer);
      else renderAll();
      toast('Import cancelled. The unfinished file was removed.', 'warn');
    } finally {
      progress.close();
    }
  }

  /* ---------- export ---------- */
  function askShapefileOptions(lyr, exportBase, featureOnly = false) {
    return new Promise((resolve) => {
      const dlg = $('shapefileExportDlg');
      $('shapefileExportLayer').textContent = featureOnly
        ? `Layer: "${lyr.name}". Only this feature will be exported.`
        : `Layer: "${lyr.name}". All features are exported, regardless of the table search filter.`;
      const category = $('shapefileCategoryField');
      category.replaceChildren();
      const none = document.createElement('option');
      none.value = '';
      none.textContent = 'None (one symbol per geometry type)';
      category.appendChild(none);
      lyr.fields.forEach((field, i) => {
        const option = document.createElement('option');
        option.value = String(i);
        option.textContent = field;
        category.appendChild(option);
      });
      category.disabled = !lyr.fields.length;
      const legendOrder = $('shapefileLegendOrder');
      const legendField = $('shapefileLegendField');
      legendOrder.value = 'original';
      legendField.replaceChildren(...[...category.options].slice(1).map((option) => option.cloneNode(true)));
      const columns = $('shapefileExportColumns');
      columns.replaceChildren();
      const checkboxes = lyr.fields.map((field) => {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = true;
        label.append(input, field);
        columns.appendChild(label);
        return input;
      });
      const features = cleanFeatures(lyr);
      const includeStyle = $('shapefileIncludeStyle');
      const stylePanel = $('shapefileStylePanel');
      const styleInput = $('shapefileImportStyle');
      const styleStatus = $('shapefileStyleStatus');
      const form = $('shapefileExportForm');
      let models = [];
      let previousField = null;
      let revision = 0;
      let importing = false;
      let styleError = false;
      let closed = false;
      includeStyle.checked = true;
      styleInput.value = '';
      const selectedField = () => category.value === '' ? null : lyr.fields[Number(category.value)];
      const selectedFields = () => lyr.fields.filter((field, i) => checkboxes[i].checked);
      const selectedLegendSort = () => category.value !== '' && legendOrder.value !== 'original' ? {
        field: lyr.fields[Number(legendField.value)],
        direction: legendOrder.value,
      } : null;
      const renderStyles = () => QgisStyle.renderEditor($('shapefileStyleEditor'), models, (model) => {
        if (form.reportValidity()) saveBlob(new Blob([QgisStyle.serialize(model)], { type: 'application/xml' }), model.fileName);
      });
      const updateStyleVisibility = () => {
        if (category.value !== '') includeStyle.checked = true;
        includeStyle.disabled = category.value !== '';
        stylePanel.hidden = !includeStyle.checked;
        stylePanel.querySelectorAll('input, select, button').forEach((input) => { input.disabled = !includeStyle.checked; });
        $('shapefileLegendSortPanel').hidden = category.value === '';
        legendOrder.disabled = !includeStyle.checked || category.value === '';
        legendField.disabled = legendOrder.disabled || legendOrder.value === 'original';
      };
      const update = () => {
        checkboxes.forEach((input, i) => {
          input.disabled = category.value === String(i);
          if (input.disabled) input.checked = true;
        });
        $('shapefileExportSummary').textContent = `${checkboxes.filter((input) => input.checked).length} of ${lyr.fields.length} attribute columns selected.`;
        revision++;
        const field = selectedField();
        try {
          const output = ShapefileWriter.writeShapefiles(exportBase, features, selectedFields(), lyr.types, {
            categoryField: field, includeStyle: true, styleOnly: true, legendSort: selectedLegendSort(),
          });
          const previous = previousField === field ? models : [];
          models = output.files.filter((file) => file.name.endsWith('.qml')).map((file) => {
            let xml = new TextDecoder().decode(file.data);
            const template = QgisStyle.read(xml);
            const old = previous.find((model) => model.family === template.family);
            if (old) xml = QgisStyle.merge(xml, QgisStyle.serialize(old), old.renderer.getAttribute('attr'));
            const model = QgisStyle.read(xml);
            model.fileName = file.name;
            return model;
          });
          previousField = field;
          styleError = false;
          styleStatus.className = '';
          styleStatus.textContent = models.length ? 'Edit styles below, or import a matching QML file. Existing edits are kept when changing exported columns or legend order.' : 'No valid geometries to style.';
          renderStyles();
        } catch (error) {
          styleError = true;
          styleStatus.className = 'error';
          styleStatus.textContent = `Cannot prepare styles: ${error.message || error}`;
          toast(styleStatus.textContent, 'error', 9000);
        }
        $('shapefileExportSubmit').disabled = styleError || importing;
        updateStyleVisibility();
      };
      category.onchange = () => {
        if (category.value !== '') legendField.value = category.value;
        update();
      };
      legendOrder.onchange = update;
      legendField.onchange = update;
      columns.onchange = update;
      $('shapefileSelectAll').onclick = () => {
        checkboxes.forEach((input) => { input.checked = true; });
        update();
      };
      $('shapefileSelectNone').onclick = () => {
        checkboxes.forEach((input) => { input.checked = false; });
        update();
      };
      includeStyle.onchange = updateStyleVisibility;
      styleInput.onchange = async () => {
        const file = styleInput.files[0];
        if (!file) return;
        const currentRevision = revision;
        importing = true;
        $('shapefileExportSubmit').disabled = true;
        styleStatus.className = '';
        styleStatus.textContent = `Reading "${file.name}"...`;
        try {
          const xml = await file.text();
          if (closed) return;
          if (revision !== currentRevision) throw new Error('Export options changed during import. Please import the style again.');
          const imported = QgisStyle.read(xml);
          const index = models.findIndex((model) => model.family === imported.family);
          if (index < 0) throw new Error('The style geometry does not match any geometry in this layer.');
          const old = models[index];
          const model = QgisStyle.read(QgisStyle.merge(QgisStyle.serialize(old), xml, selectedField()));
          model.fileName = old.fileName;
          models[index] = model;
          renderStyles();
          styleStatus.className = '';
          styleStatus.textContent = `Imported symbol appearance from "${file.name}" for ${model.entries.length} categories. Other geometry styles are unchanged; extra imported categories and non-symbol layer settings are not copied.`;
          updateStyleVisibility();
        } catch (error) {
          if (!closed) {
            styleStatus.className = 'error';
            styleStatus.textContent = `Style not imported: ${error.message || error} Previous styles are unchanged.`;
            toast(styleStatus.textContent, 'error', 9000);
          }
        } finally {
          if (!closed) {
            importing = false;
            styleInput.value = '';
            $('shapefileExportSubmit').disabled = styleError;
          }
        }
      };
      form.onsubmit = (event) => { if (styleError || importing) event.preventDefault(); };
      update();
      dlg.addEventListener('close', () => {
        closed = true;
        const options = dlg.returnValue === 'ok' ? {
          fields: selectedFields(),
          categoryField: selectedField(),
          includeStyle: includeStyle.checked,
          legendSort: selectedLegendSort(),
          styles: includeStyle.checked ? Object.fromEntries(models.map((model) => [model.family, QgisStyle.serialize(model)])) : {},
        } : null;
        category.onchange = null;
        legendOrder.onchange = null;
        legendField.onchange = null;
        columns.onchange = null;
        $('shapefileSelectAll').onclick = null;
        $('shapefileSelectNone').onclick = null;
        includeStyle.onchange = null;
        styleInput.onchange = null;
        form.onsubmit = null;
        resolve(options);
      }, { once: true });
      dlg.returnValue = 'cancel';
      dlg.showModal();
      category.focus();
    });
  }

  function cleanFeatures(lyr) {
    return leavesOf(lyr).map((leaf) => {
      const geometry = leaf.toGeoJSON(9).geometry;
      const props = {};
      lyr.fields.forEach((f) => {
        const v = leaf.feature.properties[f];
        props[f] = v === undefined ? null : v;
      });
      return { type: 'Feature', properties: props, geometry, style: leaf.feature.style || {} };
    });
  }

  function layerToCsv(lyr) {
    const cell = (value) => {
      const text = value === null || value === undefined ? '' : String(value);
      return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const rows = [lyr.fields.map(cell).join(',')];
    leavesOf(lyr).forEach((leaf) => {
      rows.push(lyr.fields.map((field) => cell(leaf.feature.properties[field])).join(','));
    });
    return '\uFEFF' + rows.join('\r\n');
  }

  const xmlEsc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

  // KML colours are aabbggrr.
  function kmlColor(hex, opacity) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    const h = m ? m[1] : '2563eb';
    const a = Math.round(255 * Math.min(1, Math.max(0, isNaN(Number(opacity)) ? 1 : Number(opacity)))).toString(16).padStart(2, '0');
    return a + h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2);
  }

  const kmlCoords = (c) => c.map((p) => p.slice(0, 3).join(',')).join(' ');
  const kmlPolygon = (rings) =>
    '<Polygon>' + rings.map((r, i) => `<${i ? 'inner' : 'outer'}BoundaryIs><LinearRing><coordinates>${kmlCoords(r)}</coordinates></LinearRing></${i ? 'inner' : 'outer'}BoundaryIs>`).join('') + '</Polygon>';

  function kmlGeometry(g) {
    switch (g.type) {
      case 'Point': return `<Point><coordinates>${g.coordinates.slice(0, 3).join(',')}</coordinates></Point>`;
      case 'LineString': return `<LineString><coordinates>${kmlCoords(g.coordinates)}</coordinates></LineString>`;
      case 'Polygon': return kmlPolygon(g.coordinates);
      case 'MultiLineString': return '<MultiGeometry>' + g.coordinates.map((l) => kmlGeometry({ type: 'LineString', coordinates: l })).join('') + '</MultiGeometry>';
      case 'MultiPolygon': return '<MultiGeometry>' + g.coordinates.map((p) => kmlPolygon(p)).join('') + '</MultiGeometry>';
      default: return '';
    }
  }

  function layerToKml(lyr) {
    const styles = new Map();
    const placemarks = cleanFeatures(lyr).map((f) => {
      const st = { stroke: lyr.color, fill: lyr.color, ...f.style, 'marker-color': f.style['marker-color'] || f.style['icon-color'] || lyr.color };
      let styleXml;
      if (f.geometry.type === 'Point') {
        styleXml = `<IconStyle><color>${kmlColor(st['marker-color'], 1)}</color><scale>1</scale><Icon><href>http://maps.google.com/mapfiles/kml/pushpin/wht-pushpin.png</href></Icon></IconStyle>`;
      } else {
        styleXml = `<LineStyle><color>${kmlColor(st.stroke, st['stroke-opacity'])}</color><width>${Number(st['stroke-width']) || 2}</width></LineStyle>`;
        if (/Polygon/.test(f.geometry.type)) styleXml += `<PolyStyle><color>${kmlColor(st.fill, st['fill-opacity'] === undefined ? 0.4 : st['fill-opacity'])}</color></PolyStyle>`;
      }
      if (!styles.has(styleXml)) styles.set(styleXml, 's' + (styles.size + 1));
      const val = (k) => (f.properties[k] === null || f.properties[k] === undefined ? '' : String(f.properties[k]));
      const extra = lyr.fields.filter((k) => k !== 'name' && k !== 'description' && val(k) !== '');
      return '<Placemark>' +
        (val('name') ? `<name>${xmlEsc(val('name'))}</name>` : '') +
        (val('description') ? `<description>${xmlEsc(val('description'))}</description>` : '') +
        `<styleUrl>#${styles.get(styleXml)}</styleUrl>` +
        (extra.length ? '<ExtendedData>' + extra.map((k) => `<Data name="${xmlEsc(k)}"><value>${xmlEsc(val(k))}</value></Data>`).join('') + '</ExtendedData>' : '') +
        kmlGeometry(f.geometry) + '</Placemark>';
    });
    const styleXml = [...styles].map(([xml, id]) => `<Style id="${id}">${xml}</Style>`).join('');
    return '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>' +
      `<name>${xmlEsc(lyr.name)}</name>${styleXml}${placemarks.join('')}</Document></kml>`;
  }


  async function exportLayerFiles(lyr, fmt, base, shapefileOptions) {
    const warnings = [];
    if (fmt === 'shp') {
      const feats = cleanFeatures(lyr);
      if (!feats.length) { warnings.push(`“${lyr.name}” has no features, so no shapefile was written.`); return { files: [], warnings }; }
      const fields = shapefileOptions ? shapefileOptions.fields : lyr.fields;
      const out = ShapefileWriter.writeShapefiles(base, feats, fields, lyr.types, {
        categoryField: shapefileOptions ? shapefileOptions.categoryField : null,
        includeStyle: shapefileOptions ? shapefileOptions.includeStyle : false,
        styles: shapefileOptions ? shapefileOptions.styles : {},
        legendSort: shapefileOptions ? shapefileOptions.legendSort : null,
      });
      return { files: out.files, warnings: out.warnings.map((w) => `${lyr.name}: ${w}`) };
    }
    if (fmt === 'kml') return { files: [{ name: base + '.kml', data: layerToKml(lyr) }], warnings };
    if (fmt === 'kmz') {
      const zip = new JSZip();
      zip.file('doc.kml', layerToKml(lyr));
      const data = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
      return { files: [{ name: base + '.kmz', data }], warnings };
    }
    if (fmt === 'csv') return { files: [{ name: base + '.csv', data: layerToCsv(lyr) }], warnings };
    const fc = { type: 'FeatureCollection', features: cleanFeatures(lyr).map(({ type, properties, geometry }) => ({ type, properties, geometry })) };
    return { files: [{ name: base + '.geojson', data: JSON.stringify(fc, null, 2) }], warnings };
  }

  async function exportBaseName(lyr, feature = null) {
    const base = safeName(lyr.name);
    const selected = feature || (state.selected && state.selected._glayer === lyr ? state.selected : null);
    if (!selected || !lyr.fields.length) return base;
    const options = [['', 'Use layer name'], ...lyr.fields.map((field) => {
      const value = display(selected.feature.properties[field]).replace(/\s+/g, ' ').trim();
      return [field, `${field}: ${value || '(empty)'}`];
    })];
    const choice = await askForm('Export filename', [
      { key: 'field', label: 'Name from selected row', type: 'select', value: '', options },
    ], { message: `Choose an attribute from the selected feature in “${lyr.name}”.` });
    if (!choice) return null;
    if (!choice.field) return base;
    const value = display(selected.feature.properties[choice.field]).trim();
    if (!value) {
      toast(`The selected row has no value in “${choice.field}”; using the layer name.`, 'warn');
      return base;
    }
    return safeName(value);
  }

  function downloadFeature(lyr, leaf) {
    const featureLayer = { ...lyr, group: { getLayers: () => [leaf] } };
    return downloadLayers([featureLayer], leaf);
  }

  async function downloadLayers(layers, feature = null) {
    if (!layers.length) return toast('There is nothing to download yet.', 'warn');
    const fmt = $('fmt').value;
    const used = new Set();
    const exports = [];
    for (const lyr of layers) {
      let base = await exportBaseName(lyr, feature);
      if (base === null) return;
      let n = 2;
      const root = base;
      while (used.has(base.toLowerCase())) base = `${root}_${n++}`;
      used.add(base.toLowerCase());
      exports.push({ lyr, base });
    }
    const shapefileOptions = new Map();
    if (fmt === 'shp') {
      for (const { lyr, base } of exports) {
        if (!leavesOf(lyr).length) continue;
        const options = await askShapefileOptions(lyr, base, !!feature);
        if (!options) return;
        shapefileOptions.set(lyr, options);
      }
    }
    const files = [];
    const warnings = [];
    for (const { lyr, base } of exports) {
      const out = await exportLayerFiles(lyr, fmt, base, shapefileOptions.get(lyr));
      files.push(...out.files);
      warnings.push(...out.warnings);
    }
    warnings.forEach((w) => toast(w, 'warn', 9000));
    if (!files.length) return;
    const stamp = layers.length === 1 ? exports[0].base : 'geo-editor-export';
    if (fmt !== 'shp' && files.length === 1) {
      const f = files[0];
      const type = fmt === 'csv' ? 'text/csv;charset=utf-8' : 'application/octet-stream';
      return saveBlob(new Blob([f.data], { type }), f.name);
    }
    const zip = new JSZip();
    files.forEach((f) => zip.file(f.name, f.data));
    saveBlob(await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), stamp + '.zip');
    toast(`Downloaded ${stamp}.zip`);
  }

  /* ---------- UI wiring ---------- */
  $('btnAbout').addEventListener('click', () => {
    $('aboutDlg').showModal();
    $('aboutTitle').focus({ preventScroll: true });
  });
  $('aboutDlg').addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      $('aboutDlg').close();
    }
  });
  const openFilePicker = () => $('fileInput').click();
  $('btnUpload').addEventListener('click', openFilePicker);
  $('emptyUpload').addEventListener('click', openFilePicker);
  $('fileInput').addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });

  $('btnNewLayer').addEventListener('click', async () => {
    const source = await askForm('New layer', [
      { key: 'source', label: 'New layer', hideLabel: true, type: 'radio', value: 'blank', options: [['blank', 'Blank layer'], ['upload', 'Upload layer']] },
    ], { okLabel: 'Continue', compact: true });
    if (!source) return;
    if (source.source === 'upload') { openFilePicker(); return; }
    const r = await askForm('New layer', [
      { key: 'name', label: 'Layer name', value: 'New layer', required: true },
      { key: 'geom', label: 'Geometry type', type: 'select', value: 'Polygon', options: [['Point', 'Points'], ['Line', 'Lines'], ['Polygon', 'Polygons'], ['Mixed', 'Mixed (KML / GeoJSON style)']] },
      { key: 'fields', label: 'Attribute fields', value: 'name, description', hint: 'Comma-separated text fields. You can add more later.' },
    ], { okLabel: 'Create' });
    if (!r) return;
    const fields = [...new Set(r.fields.split(',').map((s) => s.trim()).filter(Boolean))];
    const types = {};
    fields.forEach((f) => { types[f] = 'string'; });
    const lyr = createLayer({ name: r.name.trim(), fields, types, geomType: r.geom, format: r.geom === 'Mixed' ? 'kml' : 'shp' });
    setActive(lyr);
    toast('Layer created. Use the drawing tools on the map to add features.');
  });

  $('btnUndo').addEventListener('click', undoLastTableEdit);
  $('btnToggleLayers').addEventListener('click', () => {
    const sidebar = $('sidebar');
    const previousHeight = sidebar.getBoundingClientRect().height;
    if (mobileControls.matches) sidebar.getAnimations().forEach(animation => animation.cancel());
    const collapsed = sidebar.classList.toggle('collapsed');
    $('sidebarContent').hidden = collapsed;
    const button = $('btnToggleLayers');
    const label = `${collapsed ? 'Expand' : 'Collapse'} Layers panel`;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-expanded', String(!collapsed));
    button.replaceChildren(actionIcon(collapsed ? 'PanelLeftOpen' : 'PanelLeftClose'));
    if (mobileControls.matches && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const height = sidebar.getBoundingClientRect().height;
      if (height !== previousHeight) sidebar.animate([
        { height: `${previousHeight}px`, overflow: 'hidden' },
        { height: `${height}px`, overflow: 'hidden' },
      ], { duration: 320, easing: 'cubic-bezier(.22, 1, .36, 1)' });
    }
  });
  $('btnAddField').addEventListener('click', addField);
  $('btnFilter').addEventListener('click', async () => {
    const layer = state.active;
    if (!layer) return;
    const result = await askForm('Filter rows', [{ key: 'filter', label: 'Filter rows', hideLabel: true, value: state.filter, clearable: true }], { okLabel: 'Apply' });
    if (!result || state.active !== layer) return;
    state.filter = result.filter;
    state.page = 0;
    $('filter').value = state.filter;
    renderTable();
  });
  const editHelp = document.querySelector('#sidebar details.help');
  $('btnEditHelp').addEventListener('click', () => {
    $('editHelpContent').replaceChildren(editHelp.querySelector('ul').cloneNode(true));
    $('editHelpDlg').showModal();
  });
  $('btnBulkDelete').addEventListener('click', bulkDeleteRows);
  $('btnDlLayer').addEventListener('click', () => (state.active ? downloadLayers([state.active]) : toast('Select a layer first.', 'warn')));
  $('btnDlAll').addEventListener('click', () => downloadLayers(state.layers));
  $('btnDownload').addEventListener('click', async () => {
    if (!state.layers.length) { toast('No layers to download.', 'warn'); return; }
    const scope = await askForm('Download', [
      { key: 'scope', label: 'Download', hideLabel: true, type: 'radio', value: state.active ? 'active' : 'all', options: [['active', 'Active layer'], ['all', 'All layers']] },
    ], { okLabel: 'Continue', compact: true });
    if (!scope) return;
    const layers = scope.scope === 'all' ? [...state.layers] : state.active ? [state.active] : [];
    if (!layers.length) { toast('Select a layer first.', 'warn'); return; }
    const format = await askForm('Download format', [
      { key: 'format', label: 'File type', type: 'select', value: $('fmt').value, options: [...$('fmt').options].map(option => [option.value, option.textContent]) },
    ], { okLabel: 'Continue', compact: true });
    if (!format) return;
    $('fmt').value = format.format;
    await downloadLayers(layers);
  });
  $('filter').addEventListener('input', (e) => { state.filter = e.target.value; state.page = 0; renderTable(); });
  $('pgPrev').addEventListener('click', () => { state.page--; renderTable(); });
  $('pgNext').addEventListener('click', () => { state.page++; renderTable(); });

  // Drag & drop upload
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragDepth++; $('dropOverlay').classList.add('on'); } });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('dropOverlay').classList.remove('on'); } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    $('dropOverlay').classList.remove('on');
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });

  // Resizable table panel
  let initialMapViewPending = true;
  const panelObserver = new ResizeObserver(() => {
    const main = $('main').getBoundingClientRect();
    const sidebar = $('sidebar').getBoundingClientRect();
    const table = $('tablePanel').getBoundingClientRect();
    const stacked = sidebar.width >= main.width - 1;
    $('main').style.setProperty('--panel-left', `${stacked ? 0 : sidebar.width}px`);
    $('main').style.setProperty('--panel-top', `${stacked ? sidebar.height : 0}px`);
    $('main').style.setProperty('--panel-bottom', `${main.bottom - table.top + 6}px`);
    const visibleWidth = main.width - (stacked ? 0 : sidebar.width);
    const visibleHeight = table.top - main.top - (stacked ? sidebar.height : 0) - 6;
    const scalePosition = visibleWidth < 800 || visibleHeight < 440 ? 'bottomright' : 'bottomleft';
    if (scaleControl.getPosition() !== scalePosition) scaleControl.setPosition(scalePosition);
    if (initialMapViewPending) {
      initialMapViewPending = false;
      if (!state.layers.length) fitVisibleBounds(L.latLngBounds([[-44, 112], [-10, 154]]));
    }
  });
  [$('main'), $('sidebar'), $('tablePanel')].forEach(panel => panelObserver.observe(panel));

  $('splitter').addEventListener('mousedown', (e) => {
    e.preventDefault();
    const total = $('workspace').getBoundingClientRect();
    const move = (ev) => {
      const h = Math.min(total.height - 140, Math.max(80, total.bottom - ev.clientY));
      $('tablePanel').style.flexBasis = h + 'px';
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });

  window.addEventListener('beforeunload', (e) => {
    if (state.layers.length) { e.preventDefault(); e.returnValue = ''; }
  });

  renderAll();

  // Exposed for debugging / automated tests.
  window.__geoEditor = { state, map, handleFiles, createLayer, downloadLayers };
})();
