(() => {
  'use strict';
  lucide.createIcons();

  /* ---------- constants & state ---------- */
  const PALETTE = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#db2777', '#65a30d'];
  const PAGE_SIZE = 200;
  const columnWidths = new WeakMap();
  const sessionStore = new SessionStore();
  let sessionBusy = false;
  let sessionStartupPending = true;
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

  const modalFocusToggle = $('toggleModalFocus');
  const applyModalFocus = enabled => {
    document.documentElement.dataset.modalFocus = String(enabled);
    modalFocusToggle.checked = enabled;
  };
  let modalFocusEnabled = false;
  try { modalFocusEnabled = localStorage.getItem('geoeditor-modal-focus') === 'true'; } catch {}
  applyModalFocus(modalFocusEnabled);
  modalFocusToggle.addEventListener('change', () => {
    applyModalFocus(modalFocusToggle.checked);
    try { localStorage.setItem('geoeditor-modal-focus', String(modalFocusToggle.checked)); } catch {}
  });

  const colourPopover = document.createElement('div');
  colourPopover.id = 'colourPopover';
  colourPopover.setAttribute('popover', 'manual');
  colourPopover.setAttribute('role', 'dialog');
  colourPopover.setAttribute('aria-label', 'Choose colour');
  colourPopover.hidden = true;
  const colourHeading = document.createElement('div');
  colourHeading.className = 'colour-picker-heading';
  const colourTitle = document.createElement('span');
  colourTitle.textContent = 'Colour';
  const closeColour = document.createElement('button');
  closeColour.type = 'button';
  closeColour.title = 'Close colour selector';
  closeColour.setAttribute('aria-label', closeColour.title);
  closeColour.appendChild(actionIcon('X'));
  colourHeading.append(colourTitle, closeColour);
  const colourPicker = document.createElement('hex-color-picker');
  const hexLabel = document.createElement('label');
  hexLabel.textContent = 'Hex';
  const hexColour = document.createElement('input');
  hexColour.type = 'text';
  hexColour.maxLength = 7;
  hexColour.pattern = '#[0-9a-fA-F]{6}';
  hexColour.spellcheck = false;
  hexColour.setAttribute('aria-label', 'Hex colour');
  hexColour.autocomplete = 'off';
  hexLabel.appendChild(hexColour);
  colourPopover.append(colourHeading, colourPicker, hexLabel);
  let colourInput = null;
  let initialColour = '';
  let colourAnimation = null;
  let colourRevision = 0;
  const colourMotion = () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  async function hideColourPicker(restoreFocus = false) {
    if (!colourInput) return;
    const input = colourInput;
    colourInput = null;
    const revision = ++colourRevision;
    colourAnimation?.cancel();
    input.setAttribute('aria-expanded', 'false');
    colourPopover.inert = true;
    if (input.value !== initialColour) input.dispatchEvent(new Event('change', { bubbles: true }));
    if (restoreFocus && input.isConnected) input.focus({ preventScroll: true });
    if (colourMotion() && colourPopover.isConnected) {
      colourAnimation = colourPopover.animate([
        { opacity: 1, transform: 'translateY(0) scale(1)' },
        { opacity: 0, transform: 'translateY(-4px) scale(.97)' },
      ], { duration: 160, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' });
      await colourAnimation.finished.catch(() => {});
    }
    if (revision !== colourRevision) return;
    if (colourPopover.hidePopover && colourPopover.matches(':popover-open')) colourPopover.hidePopover();
    colourPopover.hidden = true;
    colourAnimation?.cancel();
    colourAnimation = null;
  }
  function showColourPicker(input, keyboard = false) {
    if (colourInput === input) { hideColourPicker(keyboard); return; }
    hideColourPicker();
    ++colourRevision;
    colourAnimation?.cancel();
    colourInput = input;
    initialColour = input.value;
    hexColour.value = input.value;
    colourPicker.setAttribute('color', input.value);
    customElements.whenDefined('hex-color-picker').then(() => {
      if (colourInput === input) colourPicker.color = input.value;
    });
    input.setAttribute('aria-haspopup', 'dialog');
    input.setAttribute('aria-controls', colourPopover.id);
    input.setAttribute('aria-expanded', 'true');
    (input.closest('dialog') || document.body).appendChild(colourPopover);
    colourPopover.inert = false;
    colourPopover.hidden = false;
    if (colourPopover.showPopover && !colourPopover.matches(':popover-open')) colourPopover.showPopover();
    const anchor = input.getBoundingClientRect();
    const bounds = colourPopover.getBoundingClientRect();
    const left = Math.max(8, Math.min(anchor.left, innerWidth - bounds.width - 8));
    const top = anchor.bottom + bounds.height + 8 <= innerHeight ? anchor.bottom + 8 : Math.max(8, anchor.top - bounds.height - 8);
    colourPopover.style.left = `${left}px`;
    colourPopover.style.top = `${top}px`;
    if (colourMotion()) {
      colourAnimation = colourPopover.animate([
        { opacity: 0, transform: 'translateY(-4px) scale(.97)' },
        { opacity: 1, transform: 'translateY(0) scale(1)' },
      ], { duration: 220, easing: 'cubic-bezier(.22, 1, .36, 1)' });
    }
    if (keyboard) hexColour.focus({ preventScroll: true });
  }
  const updateColour = value => {
    if (!colourInput || !/^#[0-9a-f]{6}$/i.test(value)) return;
    const input = colourInput;
    if (input.value.toLowerCase() === value.toLowerCase()) return;
    input.value = value;
    hexColour.value = input.value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  colourPicker.addEventListener('color-changed', event => updateColour(event.detail.value));
  hexColour.addEventListener('input', () => {
    if (!/^#[0-9a-f]{6}$/i.test(hexColour.value)) return;
    updateColour(hexColour.value);
    if (customElements.get('hex-color-picker')) colourPicker.color = hexColour.value;
  });
  closeColour.addEventListener('click', () => hideColourPicker(true));
  document.addEventListener('click', event => {
    const input = event.target.closest('input[type="color"]');
    if (input && !input.disabled) {
      event.preventDefault();
      event.stopPropagation();
      showColourPicker(input);
    } else if (colourInput && !colourPopover.contains(event.target)) hideColourPicker();
  }, true);
  document.addEventListener('keydown', event => {
    const input = event.target.closest('input[type="color"]');
    if (input && !input.disabled && ['Enter', ' ', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showColourPicker(input, true);
    } else if (colourInput && (event.key === 'Escape' || event.key === 'Enter' && colourPopover.contains(event.target))) {
      event.preventDefault();
      event.stopImmediatePropagation();
      hideColourPicker(true);
    }
  }, true);
  document.addEventListener('close', event => {
    if (colourInput && event.target.contains(colourInput)) hideColourPicker();
  }, true);
  window.addEventListener('resize', () => hideColourPicker());
  window.addEventListener('scroll', event => {
    if (colourInput && !colourPopover.contains(event.target)) hideColourPicker();
  }, true);

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
            closeDialog(dlg, 'ok');
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
  const imageryUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const imagery = L.tileLayer(imageryUrl, {
    maxZoom: 19, attribution: 'Tiles &copy; Esri',
  });
  const hybridReferencePane = map.createPane('hybridReference');
  hybridReferencePane.style.zIndex = '250';
  hybridReferencePane.style.pointerEvents = 'none';
  const HybridReference = L.esri.Vector.VectorTileLayer.extend({
    onAdd(map) {
      this._map = map;
      if (this._ready) this._asyncAdd();
      else this.once('ready', this._asyncAdd, this);
    },
    onRemove(map) {
      this.off('ready', this._asyncAdd, this);
      if (this._maplibreGL && map.hasLayer(this._maplibreGL)) L.esri.Vector.VectorTileLayer.prototype.onRemove.call(this, map);
    },
  });
  const hybrid = L.layerGroup([
    L.tileLayer(imageryUrl, { maxZoom: 19, attribution: 'Tiles &copy; Esri' }),
    new HybridReference('0769f07cc0c3453faec703e77dbb3459', {
      pane: 'hybridReference', attribution: 'Map data &copy; OpenStreetMap contributors, Microsoft, Esri',
    }),
  ]);
  const blank = L.layerGroup();
  const basemaps = { Standard: osm, Satellite: imagery, Hybrid: hybrid, Blank: blank };
  const basemapControl = L.control.layers(basemaps, null, { position: 'topright' }).addTo(map);
  const addBasemapItem = basemapControl._addItem;
  basemapControl._addItem = function(entry) {
    const label = addBasemapItem.call(this, entry);
    const preview = document.createElement('span');
    preview.className = 'basemap-preview';
    preview.setAttribute('aria-hidden', 'true');
    const url = entry.layer.options.basemapPreview;
    if (url) {
      const image = document.createElement('img');
      image.src = url;
      image.alt = '';
      image.loading = 'lazy';
      preview.appendChild(image);
    } else preview.classList.add('basemap-preview-blank');
    label.querySelector('span > span').prepend(preview);
    return label;
  };
  osm.options.basemapPreview = 'lib/images/basemap-standard.png';
  imagery.options.basemapPreview = 'lib/images/basemap-satellite.jpg';
  hybrid.options.basemapPreview = 'lib/images/basemap-hybrid.png';
  basemapControl._update();
  const basemapToggle = basemapControl.getContainer().querySelector('.leaflet-control-layers-toggle');
  basemapToggle.replaceChildren(actionIcon('Layers'));
  basemapToggle.title = 'Choose basemap';
  basemapToggle.setAttribute('aria-label', 'Choose basemap');
  const basemapContainer = basemapControl.getContainer();
  const updateBasemapExpanded = () => basemapToggle.setAttribute('aria-expanded', String(basemapContainer.classList.contains('leaflet-control-layers-expanded')));
  L.DomEvent.off(basemapContainer, 'mouseenter', basemapControl._expandSafely, basemapControl);
  L.DomEvent.off(basemapContainer, 'mouseleave', basemapControl.collapse, basemapControl);
  L.DomEvent.off(basemapToggle, 'click keydown');
  const toggleBasemap = event => {
    L.DomEvent.stop(event);
    if (basemapContainer.classList.contains('leaflet-control-layers-expanded')) basemapControl.collapse();
    else basemapControl.expand();
    updateBasemapExpanded();
  };
  basemapToggle.addEventListener('click', toggleBasemap);
  basemapToggle.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') toggleBasemap(event);
  });
  basemapContainer.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    L.DomEvent.stop(event);
    basemapControl.collapse();
    updateBasemapExpanded();
    basemapToggle.focus();
  });
  new MutationObserver(updateBasemapExpanded).observe(basemapContainer, { attributes: true, attributeFilter: ['class'] });
  updateBasemapExpanded();
  const mapContainer = map.getContainer();
  const fullscreenButton = document.createElement('button');
  fullscreenButton.type = 'button';
  fullscreenButton.className = 'map-fullscreen-toggle';
  fullscreenButton.setAttribute('aria-controls', 'map');
  basemapContainer.appendChild(fullscreenButton);
  L.DomEvent.disableClickPropagation(fullscreenButton);
  const panelAnimations = new WeakMap();
  let panelMotionCount = 0;
  const sidebarControlOffsets = () => {
    const sidebar = $('sidebar').getBoundingClientRect();
    const stacked = sidebar.width >= $('main').getBoundingClientRect().width - 1;
    return { left: stacked ? 0 : sidebar.width, top: stacked ? sidebar.height : 0 };
  };
  const applySidebarControlOffsets = offsets => {
    $('main').style.setProperty('--panel-left', `${offsets.left}px`);
    $('main').style.setProperty('--panel-top', `${offsets.top}px`);
  };
  const stopPanelAnimation = panel => {
    const record = panelAnimations.get(panel);
    if (!record) return;
    panelAnimations.delete(panel);
    record.animation.cancel();
    record.companionAnimation?.cancel();
    record.companion?.classList.remove('panel-animating');
    record.controlAnimations?.forEach(({ element, animation }) => {
      animation.cancel();
      element.classList.remove('panel-animating');
    });
    panel.classList.remove('panel-animating');
    panelMotionCount--;
    if (!panelMotionCount) scheduleMapDisplay();
  };
  const animatePanel = (panel, offset, showing, commit = () => {}, hold = false, controls = null) => {
    const previous = panelAnimations.get(panel);
    const style = getComputedStyle(panel);
    const sidebarRailMotion = panel === $('sidebar') && controls;
    const motionProperty = sidebarRailMotion ? 'clipPath' : 'transform';
    const start = { [motionProperty]: sidebarRailMotion && style.clipPath === 'none' ? 'inset(0px 0px 0px 0px)' : style[motionProperty] };
    const sidebarBodyMotion = panel === $('sidebarContent') && mobileControls.matches;
    const companion = panel === $('tablePanel') ? $('splitter') : sidebarBodyMotion ? $('sidebar') : null;
    const companionProperty = sidebarBodyMotion ? 'clipPath' : 'transform';
    const companionStart = companion && previous ? getComputedStyle(companion)[companionProperty] : 'none';
    stopPanelAnimation(panel);
    if (showing) commit();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !panel.getClientRects().length || getComputedStyle(panel).visibility === 'hidden') {
      if (!showing) commit();
      return Promise.resolve();
    }
    const visible = sidebarRailMotion ? { clipPath: 'inset(0px 0px 0px 0px)' } : { transform: 'translate(0, 0)' };
    const hidden = sidebarRailMotion ? { clipPath: `inset(0px ${Math.max(0, panel.getBoundingClientRect().width - controls.collapsed.left)}px 0px 0px)` } : { transform: offset };
    if (!panelMotionCount) {
      if (displayRefreshTimer !== null) {
        clearTimeout(displayRefreshTimer);
        displayRefreshTimer = null;
      }
      state.layers.forEach(layer => {
        layer.spatialRequest = (layer.spatialRequest || 0) + 1;
        cancelLayerDisplay(layer);
      });
    }
    panelMotionCount++;
    panel.classList.add('panel-animating');
    const timing = {
      duration: 360, easing: 'cubic-bezier(.22, 0, .18, 1)', fill: 'both',
    };
    const animation = panel.animate([previous ? start : showing ? hidden : start, showing ? visible : hidden], timing);
    let companionAnimation;
    if (companion) {
      let companionVisible = { transform: 'none' };
      let companionHidden = { transform: `translateY(${panel.getBoundingClientRect().height}px)` };
      if (sidebarBodyMotion) {
        const sidebarStyle = getComputedStyle(companion);
        const headerBottom = $('sidebarHeader').getBoundingClientRect().bottom;
        const retainedBottom = controls ? companion.getBoundingClientRect().top + controls.collapsed.top : headerBottom + parseFloat(sidebarStyle.paddingBottom) + parseFloat(sidebarStyle.borderBottomWidth);
        const travel = Math.max(0, companion.getBoundingClientRect().bottom - retainedBottom);
        companionVisible = { clipPath: 'inset(0px 0px 0px 0px)' };
        companionHidden = { clipPath: `inset(0px 0px ${travel}px 0px)` };
      }
      companion.classList.add('panel-animating');
      companionAnimation = companion.animate([
        previous ? { [companionProperty]: companionStart } : showing ? companionHidden : companionVisible,
        showing ? companionVisible : companionHidden,
      ], timing);
      const startTime = document.timeline.currentTime;
      if (startTime !== null) animation.startTime = companionAnimation.startTime = startTime;
    }
    const controlAnimations = [];
    if (controls) {
      if (sidebarRailMotion) {
        const content = $('sidebarContent');
        content.classList.add('panel-animating');
        controlAnimations.push({ element: content, animation: content.animate([
          { transform: previous ? controls.contentStart : showing ? 'translateX(-100%)' : 'none' },
          { transform: showing ? 'none' : 'translateX(-100%)' },
        ], timing) });
        controls.header.forEach(({ element, before, target }) => {
          const current = element.getBoundingClientRect();
          const position = bounds => bounds.width ? `translate(${bounds.left - current.left}px, ${bounds.top - current.top}px)` : `translateX(-${current.right}px)`;
          element.classList.add('panel-animating');
          controlAnimations.push({ element, animation: element.animate([
            { transform: position(before) }, { transform: position(target) },
          ], timing) });
        });
      }
      const style = getComputedStyle($('main'));
      const base = { left: parseFloat(style.getPropertyValue('--panel-left')) || 0, top: parseFloat(style.getPropertyValue('--panel-top')) || 0 };
      controls.before.forEach(({ element, left, top }) => {
        const bounds = element.getBoundingClientRect();
        const startX = left - bounds.left;
        const startY = top - bounds.top;
        const endX = element.classList.contains('leaflet-left') ? controls.target.left - base.left : 0;
        const endY = element.classList.contains('leaflet-top') ? controls.target.top - base.top : 0;
        if (Math.abs(startX) + Math.abs(startY) + Math.abs(endX) + Math.abs(endY) < .01) return;
        element.classList.add('panel-animating');
        controlAnimations.push({ element, animation: element.animate([
          { transform: `translate(${startX}px, ${startY}px)` },
          { transform: `translate(${endX}px, ${endY}px)` },
        ], timing) });
      });
      if (controls.table.before.height > 0) {
        const table = $('tablePanel');
        const splitter = $('splitter');
        const tableLeft = table.getBoundingClientRect().left;
        const splitterLeft = splitter.getBoundingClientRect().left;
        const frames = bounds => ({
          width: `${bounds.width}px`, flexBasis: `${bounds.height}px`,
          transform: `translateX(${bounds.left - tableLeft}px)`,
        });
        table.classList.add('panel-animating');
        splitter.classList.add('panel-animating');
        controlAnimations.push({ element: table, animation: table.animate([
          frames(controls.table.before), frames(controls.table.target),
        ], timing) });
        controlAnimations.push({ element: splitter, animation: splitter.animate([
          { width: `${controls.table.before.width}px`, transform: `translateX(${controls.table.before.left - splitterLeft}px)` },
          { width: `${controls.table.target.width}px`, transform: `translateX(${controls.table.target.left - splitterLeft}px)` },
        ], timing) });
      }
      const startTime = document.timeline.currentTime;
      if (startTime !== null) {
        animation.startTime = startTime;
        if (companionAnimation) companionAnimation.startTime = startTime;
        controlAnimations.forEach(control => { control.animation.startTime = startTime; });
      }
    }
    panelAnimations.set(panel, { animation, companion, companionAnimation, controlAnimations });
    return animation.finished.then(() => {
      if (panelAnimations.get(panel)?.animation !== animation) return;
      if (!showing) commit();
      if (!hold) stopPanelAnimation(panel);
    }).catch(() => {
      if (panelAnimations.get(panel)?.animation === animation) stopPanelAnimation(panel);
    });
  };
  const editorPanels = [[$('topbar'), 'translateY(-100%)'], [$('sidebar'), 'translateX(-100%)'], [$('sidebarSplitter'), null], [$('tablePanel'), 'translateY(100%)']];
  let fullscreenControlAnimations = [];
  const stopFullscreenControlAnimations = () => {
    const hadAnimations = fullscreenControlAnimations.length > 0;
    const viewport = fullscreenControlAnimations.find(({ element }) => element === mapContainer);
    if (viewport) {
      viewport.animation.cancel();
      if (viewport.inlineStyle === null) mapContainer.removeAttribute('style');
      else mapContainer.setAttribute('style', viewport.inlineStyle);
      map.invalidateSize({ pan: true, animate: false, debounceMoveend: true });
    }
    fullscreenControlAnimations.forEach(({ element, animation, inlineStyle, preserveStyle }) => {
      animation.cancel();
      if (!preserveStyle) {
        if (inlineStyle === null) element.removeAttribute('style');
        else element.setAttribute('style', inlineStyle);
      }
      element.classList.remove('panel-animating', 'fullscreen-controls-animating');
    });
    fullscreenControlAnimations = [];
    if (hadAnimations) updatePanelLayout();
  };
  const fullscreenControlBounds = () => [...mapContainer.querySelectorAll('.leaflet-top, .leaflet-bottom')].map(element => ({ element, bounds: element.getBoundingClientRect() }));
  const animateEditorPanels = (showing, before = fullscreenControlBounds()) => {
    stopFullscreenControlAnimations();
    const jobs = editorPanels.map(([panel, offset]) => animatePanel(panel,
      panel === $('sidebarSplitter') ? `translateX(-${$('sidebar').getBoundingClientRect().width}px)` :
        panel === $('sidebar') && mobileControls.matches ? 'translateY(-100%)' : offset, showing, undefined, !showing));
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const timing = { duration: 360, easing: 'cubic-bezier(.22, 0, .18, 1)', fill: 'both' };
      before.forEach(({ element, bounds }) => {
        const current = element.getBoundingClientRect();
        const edgeLeft = element.classList.contains('leaflet-left') ? 0 : window.innerWidth - current.width;
        const edgeTop = element.classList.contains('leaflet-top') ? 0 : window.innerHeight - current.height;
        const inlineStyle = element.getAttribute('style');
        Object.assign(element.style, {
          position: 'fixed', left: `${current.left}px`, top: `${current.top}px`, right: 'auto', bottom: 'auto',
          width: `${current.width}px`, height: `${current.height}px`,
        });
        element.classList.add('fullscreen-controls-animating');
        const animation = element.animate(showing ? [
          { transform: `translate(${bounds.left - current.left}px, ${bounds.top - current.top}px)` },
          { transform: 'translate(0px, 0px)' },
        ] : [
          { transform: `translate(${bounds.left - current.left}px, ${bounds.top - current.top}px)` },
          { transform: `translate(${edgeLeft - current.left}px, ${edgeTop - current.top}px)` },
        ], timing);
        element.classList.add('panel-animating');
        fullscreenControlAnimations.push({ element, animation, inlineStyle });
      });
      const headerSpace = $('mapWrap').getBoundingClientRect().top;
      const inlineStyle = mapContainer.getAttribute('style');
      const viewportAnimation = mapContainer.animate(showing ? [
        { top: `${-headerSpace}px` }, { top: '0px' },
      ] : [
        { top: '0px' }, { top: `${-headerSpace}px` },
      ], timing);
      fullscreenControlAnimations.push({ element: mapContainer, animation: viewportAnimation, inlineStyle });
      const pane = map.getPane('mapPane');
      const paneAnimation = pane.animate([
        { translate: '0px 0px' }, { translate: `0px ${headerSpace / 2 * (showing ? -1 : 1)}px` },
      ], timing);
      fullscreenControlAnimations.push({ element: pane, animation: paneAnimation, preserveStyle: true });
      const startTime = document.timeline.currentTime;
      if (startTime !== null) {
        editorPanels.forEach(([panel]) => {
          const record = panelAnimations.get(panel);
          if (!record) return;
          record.animation.startTime = startTime;
          if (record.companionAnimation) record.companionAnimation.startTime = startTime;
          record.controlAnimations.forEach(({ animation }) => { animation.startTime = startTime; });
        });
        fullscreenControlAnimations.forEach(({ animation }) => { animation.startTime = startTime; });
      }
      const animations = fullscreenControlAnimations;
      jobs.push(Promise.all(animations.map(({ animation }) => animation.finished.catch(() => {}))).then(() => {
        if (showing && fullscreenControlAnimations === animations) stopFullscreenControlAnimations();
      }));
    }
    return Promise.all(jobs);
  };
  let fullscreenFallback = false;
  const updateMapFullscreen = () => {
    const active = document.fullscreenElement === mapContainer || fullscreenFallback;
    const wasActive = mapContainer.classList.contains('map-fullscreen');
    const before = !active && wasActive ? fullscreenControlBounds() : null;
    mapContainer.classList.toggle('map-fullscreen', active);
    fullscreenButton.title = active ? 'Exit fullscreen' : 'Enter fullscreen';
    fullscreenButton.setAttribute('aria-label', fullscreenButton.title);
    fullscreenButton.setAttribute('aria-pressed', String(active));
    fullscreenButton.replaceChildren(actionIcon(active ? 'Minimize2' : 'Maximize2'));
    if (active === wasActive) return;
    const hadMotion = fullscreenControlAnimations.length > 0;
    if (active) {
      editorPanels.forEach(([panel]) => stopPanelAnimation(panel));
      stopFullscreenControlAnimations();
    } else animateEditorPanels(true, before);
    if (active ? !hadMotion : !fullscreenControlAnimations.length) map.invalidateSize({ pan: true, animate: false, debounceMoveend: true });
    if (wasActive && !active) requestAnimationFrame(() => fullscreenButton.focus());
  };
  fullscreenButton.addEventListener('click', async () => {
    basemapControl.collapse();
    fullscreenButton.disabled = true;
    try {
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) fullscreenButton.animate([
        { transform: 'scale(1)' }, { transform: 'scale(.88)', offset: .3 }, { transform: 'scale(1)' },
      ], { duration: 280, easing: 'cubic-bezier(.22, 1, .36, 1)' });
      if (document.fullscreenElement !== mapContainer && !fullscreenFallback) await animateEditorPanels(false);
      if (document.fullscreenElement === mapContainer) await document.exitFullscreen();
      else if (fullscreenFallback) fullscreenFallback = false;
      else {
        try {
          if (!document.fullscreenEnabled || !mapContainer.requestFullscreen) fullscreenFallback = true;
          else await mapContainer.requestFullscreen();
        } catch {
          fullscreenFallback = true;
        }
      }
    } finally {
      fullscreenButton.disabled = false;
      updateMapFullscreen();
    }
  });
  document.addEventListener('fullscreenchange', updateMapFullscreen);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !fullscreenFallback) return;
    event.preventDefault();
    event.stopPropagation();
    fullscreenFallback = false;
    updateMapFullscreen();
  }, true);
  updateMapFullscreen();
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
  const touchControls = window.matchMedia('(max-width: 1024px)');
  let compactMapControls = touchControls.matches;
  const resetMapToolbars = [];
  map.getContainer().classList.toggle('compact-controls', compactMapControls);
  map.getContainer().querySelectorAll('.leaflet-pm-toolbar').forEach((toolbar) => {
    const tools = [...toolbar.children];
    let current = tools[0];
    let tapTimer;
    current.classList.add('mobile-tool-current');
    const closeTools = () => {
      clearTimeout(tapTimer);
      tapTimer = null;
      toolbar.classList.remove('mobile-tools-open');
      tools.forEach(tool => {
        tool.inert = compactMapControls && tool !== current;
        tool.querySelector('.leaflet-buttons-control-button').removeAttribute('aria-expanded');
      });
      if (compactMapControls) current.querySelector('.leaflet-buttons-control-button').setAttribute('aria-expanded', 'false');
    };
    const openTools = () => {
      tools.forEach(tool => { tool.inert = false; });
      toolbar.classList.add('mobile-tools-open');
      current.querySelector('.leaflet-buttons-control-button').setAttribute('aria-expanded', 'true');
    };
    toolbar.addEventListener('pointercancel', closeTools);
    toolbar.addEventListener('contextmenu', (event) => {
      if (compactMapControls) event.preventDefault();
    });
    toolbar.addEventListener('click', (event) => {
      if (!compactMapControls) return;
      const button = event.target.closest('.leaflet-buttons-control-button');
      if (!button) return;
      if (current.contains(button)) {
        if (event.detail > 0) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (tapTimer) {
            clearTimeout(tapTimer);
            tapTimer = null;
            if (toolbar.classList.contains('mobile-tools-open')) closeTools();
            else openTools();
          } else {
            tapTimer = setTimeout(() => {
              tapTimer = null;
              button.click();
            }, 300);
          }
        }
        return;
      }
      const previousBounds = button.getBoundingClientRect();
      const changed = !current.contains(button);
      current.classList.remove('mobile-tool-current');
      current = button.closest('.button-container');
      current.classList.add('mobile-tool-current');
      closeTools();
      if (changed && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const bounds = button.getBoundingClientRect();
        button.animate([
          { transform: `translate(${previousBounds.left - bounds.left}px, ${previousBounds.top - bounds.top}px)` },
          { transform: 'translate(0, 0)' },
        ], { duration: 220, easing: 'cubic-bezier(.22, 1, .36, 1)' });
      }
    }, true);
    toolbar.addEventListener('dblclick', event => {
      if (!compactMapControls) return;
      event.preventDefault();
      event.stopPropagation();
    });
    toolbar.addEventListener('keydown', (event) => {
      if (!compactMapControls) return;
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
      if (!toolbar.contains(event.target)) closeTools();
    }, true);
    mobileControls.addEventListener('change', closeTools);
    resetMapToolbars.push(closeTools);
    closeTools();
  });

  const pmBusy = () => ['globalEditModeEnabled', 'globalDragModeEnabled', 'globalRemovalModeEnabled', 'globalDrawModeEnabled', 'globalCutModeEnabled']
    .some((fn) => typeof map.pm[fn] === 'function' && map.pm[fn]());
  let mapToolsDisabled;

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
    const radius = !leaf.feature?.kml || [...name].length !== 4 ? 3 : Math.max(1, Math.min(2, (map.getZoom() + 4) / 10));
    const scale = Number(leaf.feature?.style?.['icon-scale'] ?? 1);
    return radius * (Number.isFinite(scale) && scale >= 0 ? scale : 1);
  }

  function singleCharacterLabel(leaf) {
    return Boolean(leaf.feature?.kml && (isPointLeaf(leaf) || leaf instanceof L.Polygon) &&
      /^[a-z0-9]$/i.test(String(leaf.feature.properties.name ?? '').trim()));
  }

  function polygonLabelSize(leaf, nearby) {
    const scale = Number(leaf.feature.style?.['label-scale'] ?? 1);
    const distanceAcrossScale = mapScaleDistance();
    if (distanceAcrossScale >= 2000) return 0;
    const point = isPointLeaf(leaf) ? map.latLngToContainerPoint(leaf.getLatLng()) : null;
    if (point && Number(leaf.feature.style?.['icon-scale']) === 0) {
      const zoomLimit = Math.max(6, Math.min(12, 12 * Math.sqrt(250 / distanceAcrossScale)));
      return Math.min(zoomLimit, 16 * (Number.isFinite(scale) ? scale : 1));
    }
    let best = null;
    let bestFit = 0;
    let bestDistance = Infinity;
    const polygons = leaf instanceof L.Polygon ? [leaf] : nearby.get(`${Math.floor(point.x / 128)},${Math.floor(point.y / 128)}`) || [];
    polygons.forEach(polygon => {
      const bounds = polygon.getBounds();
      const start = map.latLngToContainerPoint(bounds.getNorthWest());
      const end = map.latLngToContainerPoint(bounds.getSouthEast());
      const distance = point ? Math.hypot(Math.max(start.x - point.x, 0, point.x - end.x), Math.max(start.y - point.y, 0, point.y - end.y)) : 0;
      const size = Math.min(end.x - start.x, end.y - start.y);
      if (size < 24) return;
      const clearance = point ? Math.min(point.x - start.x, end.x - point.x, point.y - start.y, end.y - point.y) : Infinity;
      const fit = Math.min(size * .18, clearance * 2 / 1.2);
      if (fit < 8) return;
      if (distance === 0 && (distance < bestDistance || (distance === bestDistance && size < best))) {
        best = size;
        bestFit = fit;
        bestDistance = distance;
      }
    });
    if (best < 24) return 0;
    const zoomLimit = Math.max(8, Math.min(12, 12 * Math.sqrt(250 / distanceAcrossScale)));
    const size = Math.min(zoomLimit, 16 * (Number.isFinite(scale) ? scale : 1), bestFit);
    return size >= 8 ? size : 0;
  }

  const DISPLAY_CHECKPOINT_INTERVAL = 64;
  const DISPLAY_FRAME_BUDGET = 12;

  function* polygonLabelIndex(polygons) {
    const nearby = new Map();
    let checkpoints = 0;
    if (map.getZoom() < 10) return nearby;
    const viewport = map.getSize();
    for (const polygon of polygons) {
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
      if (++checkpoints % DISPLAY_CHECKPOINT_INTERVAL === 0) yield;
    }
    return nearby;
  }

  function siteLabelSize() {
    const size = Math.max(7, Math.min(14, 14 * Math.pow(500 / mapScaleDistance(), .16)));
    return Math.round(size * 10) / 10;
  }

  const kmlLabelDimensions = new Map();
  const KmlMapTooltip = L.Tooltip.extend({
    onAdd(map) {
      this._placementRendered = false;
      if (!this.options.kmlManagedLabel) {
        this._placementRendered = true;
        return L.Tooltip.prototype.onAdd.call(this, map);
      }
      if (!this._container) this._initLayout();
      this._updateContent();
      this._container.style.visibility = 'hidden';
      this._updatePosition();
    },
    onRemove(map) {
      if (this._placementRendered) L.Tooltip.prototype.onRemove.call(this, map);
      this._placementRendered = false;
    },
    _setLabelVisible(visible) {
      if (visible && !this._placementRendered) {
        this._placementRendered = true;
        L.Tooltip.prototype.onAdd.call(this, this._map);
      } else if (!visible && this._placementRendered) {
        L.Tooltip.prototype.onRemove.call(this, this._map);
        this._placementRendered = false;
      }
    },
    _measureLabel() {
      const key = this.options.kmlMeasureKey;
      let size = kmlLabelDimensions.get(key);
      if (!size) {
        const detached = !this._container.isConnected;
        if (detached) this.getPane().appendChild(this._container);
        size = L.point(this._container.offsetWidth, this._container.offsetHeight);
        if (detached) this._container.remove();
        if (size.x && size.y) {
          if (kmlLabelDimensions.size >= 4096) kmlLabelDimensions.delete(kmlLabelDimensions.keys().next().value);
          kmlLabelDimensions.set(key, size);
        }
      }
      return size;
    },
    _setPosition(position) {
      const direction = this.options.direction;
      if (!['top', 'bottom', 'left', 'right', 'center'].includes(direction)) return L.Tooltip.prototype._setPosition.call(this, position);
      const size = this._measureLabel();
      const offset = L.point(direction === 'right' ? 0 : direction === 'left' ? size.x : size.x / 2,
        direction === 'top' ? size.y : direction === 'bottom' ? 0 : size.y / 2);
      const target = position.subtract(offset.round()).add(L.point(this.options.offset)).add(this._getAnchor());
      const element = this._container;
      if (!element.classList.contains(`leaflet-tooltip-${direction}`)) {
        element.classList.remove('leaflet-tooltip-top', 'leaflet-tooltip-bottom', 'leaflet-tooltip-left', 'leaflet-tooltip-right');
        element.classList.add(`leaflet-tooltip-${direction}`);
      }
      if (!L.DomUtil.getPosition(element).equals(target)) L.DomUtil.setPosition(element, target);
    },
  });
  window.addEventListener('resize', () => kmlLabelDimensions.clear());
  document.fonts?.addEventListener('loadingdone', () => kmlLabelDimensions.clear());

  function updateKmlLabel(leaf, siteFontSize = null) {
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
    const fontSize = site ? siteFontSize ?? siteLabelSize() : single ? Math.round(leaf._kmlLabelSize * 10) / 10 : Math.min(256, 16 * (Number.isFinite(scale) ? scale : 1));
    const centered = !site && (!isPointLeaf(leaf) || kmlLabelOnly(leaf));
    const alpha = Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1;
    const labelKey = JSON.stringify([name, style['label-color'] || '#ffffff', fontSize, centered, site, alpha]);
    if (leaf._kmlLabelKey === labelKey && leaf.getTooltip()) return;
    leaf._kmlLabelKey = labelKey;
    const text = document.createElement('span');
    text.textContent = name;
    text.addEventListener('click', (event) => {
      L.DomEvent.stopPropagation(event);
      if (pmBusy()) return;
      selectLeaf(leaf, { fromMap: true });
      openPopup(leaf);
    });
    if ([...name].length === 4) text.className = 'kml-label-outlined';
    text.style.color = style['label-color'] || '#ffffff';
    text.style.fontSize = `${fontSize}px`;
    const options = {
      permanent: true, interactive: true, className: site ? 'kml-map-label kml-site-label' : 'kml-map-label',
      direction: site ? 'top' : centered ? 'center' : 'right', offset: site ? L.point(0, -4) : L.point(centered ? 0 : 8, 0),
      opacity: alpha, kmlMeasureKey: labelKey, kmlManagedLabel: single || site,
    };
    if (!leaf.getTooltip()) leaf.bindTooltip(new KmlMapTooltip(options).setContent(text));
    else {
      Object.assign(leaf.getTooltip().options, options);
      leaf.getTooltip().getElement()?.classList.toggle('kml-site-label', site);
      leaf.setTooltipContent(text);
      leaf.getTooltip().setOpacity(options.opacity);
    }
  }

  function* placeSiteLabels(lyr) {
    let checkpoints = 0;
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
    const sites = [];
    for (const leaf of lyr.displayed) {
      if (isPointLeaf(leaf) && leaf.getTooltip()?.options.className.includes('kml-site-label')) sites.push(leaf);
      if (++checkpoints % DISPLAY_CHECKPOINT_INTERVAL === 0) yield;
    }
    sites.sort((first, second) => Number(second === state.selected) - Number(first === state.selected));
    const measured = [];
    for (const leaf of sites) {
      const tooltip = leaf.getTooltip();
      const element = tooltip.getElement();
      if (element && map.hasLayer(tooltip)) {
        const size = tooltip._measureLabel();
        measured.push({ leaf, tooltip, element, point: map.latLngToContainerPoint(leaf.getLatLng()), width: size.x, height: size.y });
      } else if (element) {
        tooltip._setLabelVisible(false);
      }
      yield true;
    }
    for (const { leaf, tooltip, element, point, width, height } of measured) {
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
      tooltip._setLabelVisible(!!placement);
      const visibility = placement ? '' : 'hidden';
      if (element.style.visibility !== visibility) element.style.visibility = visibility;
      if (!placement) { yield true; continue; }
      const offset = L.point(placement.offset);
      if (tooltip.options.direction !== placement.direction || !tooltip.options.offset.equals(offset)) {
        tooltip.options.direction = placement.direction;
        tooltip.options.offset = offset;
        tooltip._updatePosition();
      }
      const rectangle = { left: placement.left - 2, top: placement.top - 2, right: placement.left + width + 2, bottom: placement.top + height + 2 };
      cells(rectangle).forEach(key => {
        if (!occupied.has(key)) occupied.set(key, []);
        occupied.get(key).push(rectangle);
      });
      yield true;
    }
    const letters = [];
    for (const leaf of lyr.displayed) {
      const tooltip = singleCharacterLabel(leaf) && leaf.getTooltip();
      const element = tooltip && tooltip.getElement();
      if (element) {
        const position = map.layerPointToContainerPoint(L.DomUtil.getPosition(element));
        const size = tooltip._measureLabel();
        letters.push({ tooltip, element, rectangle: { left: position.x - 1, top: position.y - 1,
          right: position.x + size.x + 1, bottom: position.y + size.y + 1 } });
      }
      if (element || ++checkpoints % DISPLAY_CHECKPOINT_INTERVAL === 0) yield !!element;
    }
    for (const { tooltip, element, rectangle } of letters) {
      const visible = rectangle.left >= area.left && rectangle.right <= area.right && rectangle.top >= area.top && rectangle.bottom <= area.bottom &&
        cells(rectangle).every(key => (occupied.get(key) || []).every(other =>
          rectangle.right <= other.left || rectangle.left >= other.right || rectangle.bottom <= other.top || rectangle.top >= other.bottom));
          tooltip._setLabelVisible(visible);
      const visibility = visible ? '' : 'hidden';
      if (element.style.visibility !== visibility) element.style.visibility = visibility;
      if (!visible) { yield true; continue; }
      cells(rectangle).forEach(key => {
        if (!occupied.has(key)) occupied.set(key, []);
        occupied.get(key).push(rectangle);
      });
      yield true;
    }
  }

  function kmlLeafVisible(lyr, leaf) {
    return lyr.visible && leaf.feature?.style?.visibility !== false && String(leaf.feature?.style?.visibility ?? '1') !== '0' &&
      (leaf.feature?.kml?.folderIds || []).every(id => lyr.kmlFolderMap.get(id)?.visible !== false);
  }

  function displayLimit() {
    const zoom = map.getZoom();
    return zoom <= 5 ? 1000 : zoom <= 8 ? 2000 : zoom <= 11 ? 10000 : zoom <= 14 ? 10000 : 20000;
  }

  function mapScaleDistance() {
    const middle = map.getSize().y / 2;
    return map.distance(map.containerPointToLatLng([0, middle]), map.containerPointToLatLng([scaleControl.options.maxWidth, middle]));
  }

  function fullDetailScale() {
    const distance = mapScaleDistance();
    return distance >= 5000 && distance < 20000;
  }

  function uncoveredMapBounds() {
    const mapRect = map.getContainer().getBoundingClientRect();
    const workspace = $('workspace').getBoundingClientRect();
    const splitter = $('splitter').getBoundingClientRect();
    const left = Math.max(mapRect.left, workspace.left);
    const top = Math.max(mapRect.top, workspace.top);
    const right = Math.min(mapRect.right, workspace.right);
    const bottom = Math.min(mapRect.bottom, workspace.bottom, splitter.top);
    if (left >= right || top >= bottom) return null;
    return L.latLngBounds(
      map.containerPointToLatLng([left - mapRect.left, top - mapRect.top]),
      map.containerPointToLatLng([right - mapRect.left, bottom - mapRect.top])
    );
  }

  function leafIntersectsBounds(leaf, bounds) {
    return !!bounds && (leaf.getBounds ? bounds.intersects(leaf.getBounds()) : bounds.contains(leaf.getLatLng()));
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

  function* folderDisplaySelection(lyr, all, limit, bounds) {
    const zoom = map.getZoom();
    const retain = lyr.displaySampleZoom === zoom;
    const featureFolders = lyr.spatialCache?.version === lyr.spatialVersion ? lyr.spatialCache.featureFolders :
      new Set(all.map(leaf => leaf.feature?.kml?.folderIds?.at(-1)).filter(Boolean));
    const groups = new Map();
    let checkpoints = 0;
    for (const leaf of all) {
      if (kmlLeafVisible(lyr, leaf) && leafIntersectsBounds(leaf, bounds)) {
        const folderIds = leaf.feature?.kml?.folderIds || [];
        const key = folderIds.find(id => featureFolders.has(id)) ?? leaf;
        if (!groups.has(key)) groups.set(key, { leaves: [], pinned: false, retained: false });
        const group = groups.get(key);
        group.leaves.push(leaf);
        group.pinned ||= leaf === state.selected || leaf._displayEditing;
        group.retained ||= retain && lyr.displayed.has(leaf);
      }
      if (++checkpoints % DISPLAY_CHECKPOINT_INTERVAL === 0) yield;
    }
    const candidates = [...groups.values()];
    const chosen = new Set(candidates.filter(group => group.pinned).slice(0, limit));
    candidates.filter(group => group.retained && !chosen.has(group)).slice(0, limit - chosen.size).forEach(group => chosen.add(group));
    const remaining = candidates.filter(group => !chosen.has(group));
    const count = Math.min(limit - chosen.size, remaining.length);
    for (let index = 0; index < count; index++) chosen.add(remaining[Math.floor(index * remaining.length / count)]);
    const desired = new Set();
    for (const group of chosen) for (const leaf of group.leaves) {
      desired.add(leaf);
      if (++checkpoints % DISPLAY_CHECKPOINT_INTERVAL === 0) yield;
    }
    return desired;
  }

  async function requestSpatialDisplay(lyr) {
    const request = lyr.spatialRequest = (lyr.spatialRequest || 0) + 1;
    lyr.spatialPending = request;
    const version = lyr.spatialVersion;
    try {
      let cache = lyr.spatialCache;
      if (!cache || cache.version !== version) {
        const leaves = leavesOf(lyr);
        const records = [];
        const featureFolders = new Set();
        let started = performance.now();
        for (const [index, leaf] of leaves.entries()) {
          const folder = leaf.feature?.kml?.folderIds?.at(-1);
          if (folder) featureFolders.add(folder);
          const bounds = leaf.getBounds ? leaf.getBounds() : L.latLngBounds(leaf.getLatLng(), leaf.getLatLng());
          if (bounds.isValid()) records.push({ index, minX: bounds.getWest(), minY: bounds.getSouth(), maxX: bounds.getEast(), maxY: bounds.getNorth() });
          if (performance.now() - started >= 8) {
            await new Promise(resolve => setTimeout(resolve, 0));
            if (request !== lyr.spatialRequest || version !== lyr.spatialVersion || !map.hasLayer(lyr.group)) return;
            started = performance.now();
          }
        }
        cache = { version, leaves, records, featureFolders };
        lyr.spatialCache = cache;
      }
      const bounds = uncoveredMapBounds();
      const reusable = bounds && cache.queryBounds?.contains(bounds);
      const queryBounds = bounds?.pad(.15);
      const indices = !bounds ? [] : reusable ? cache.queryIndices : await SpatialQueries.query(lyr.id, cache.records, {
        minX: queryBounds.getWest(), minY: queryBounds.getSouth(), maxX: queryBounds.getEast(), maxY: queryBounds.getNorth(),
      });
      if (request !== lyr.spatialRequest || version !== lyr.spatialVersion || panelResizeActive || !map.hasLayer(lyr.group) || !state.layers.includes(lyr)) return;
      if (bounds && !reusable) {
        cache.queryBounds = queryBounds;
        cache.queryIndices = indices;
      }
      syncLayerDisplay(lyr, indices.map(index => cache.leaves[index]));
    } catch (error) {
      if (request === lyr.spatialRequest && map.hasLayer(lyr.group)) syncLayerDisplay(lyr, leavesOf(lyr));
    } finally {
      if (lyr.spatialPending === request) lyr.spatialPending = null;
    }
  }

  const pendingLayerDisplays = new Set();
  let layerDisplayFrame = null;

  function cancelLayerDisplay(lyr) {
    pendingLayerDisplays.delete(lyr.displayJob);
    lyr.displayJob = null;
    if (!pendingLayerDisplays.size && layerDisplayFrame !== null) {
      cancelAnimationFrame(layerDisplayFrame);
      layerDisplayFrame = null;
    }
  }

  function flushLayerDisplays() {
    layerDisplayFrame = null;
    const started = performance.now();
    for (const job of pendingLayerDisplays) {
      const { lyr, steps, request, version } = job;
      if (lyr.displayJob !== job || request !== lyr.spatialRequest || version !== lyr.spatialVersion || panelResizeActive || !map.hasLayer(lyr.group)) {
        pendingLayerDisplays.delete(job);
        if (lyr.displayJob === job) lyr.displayJob = null;
        continue;
      }
      let result;
      try {
        do {
          result = steps.next();
          if (result.done) break;
          if (performance.now() - started >= DISPLAY_FRAME_BUDGET) break;
        } while (true);
      } catch (error) {
        cancelLayerDisplay(lyr);
        if (pendingLayerDisplays.size) layerDisplayFrame = requestAnimationFrame(flushLayerDisplays);
        throw error;
      }
      pendingLayerDisplays.delete(job);
      if (result.done) lyr.displayJob = null;
      else pendingLayerDisplays.add(job);
      if (performance.now() - started >= DISPLAY_FRAME_BUDGET) break;
    }
    if (pendingLayerDisplays.size) layerDisplayFrame = requestAnimationFrame(flushLayerDisplays);
  }

  function syncLayerDisplay(lyr, indexed = null) {
    cancelLayerDisplay(lyr);
    if (!map.hasLayer(lyr.group) || lyr.importing) return;
    if (!indexed && lyr.featureCount >= 2000) {
      requestSpatialDisplay(lyr);
      return;
    }
    const all = indexed || leavesOf(lyr);
    const steps = layerDisplaySteps(lyr, all);
    if (Math.max(all.length, lyr.displayed.size) < 2000) {
      while (!steps.next().done) {}
      return;
    }
    const job = { lyr, steps, request: lyr.spatialRequest, version: lyr.spatialVersion };
    lyr.displayJob = job;
    pendingLayerDisplays.add(job);
    if (layerDisplayFrame === null) layerDisplayFrame = requestAnimationFrame(flushLayerDisplays);
  }

  function* layerDisplaySteps(lyr, all) {
    const siteFontSize = siteLabelSize();
    let checkpoints = 0;
    const fullDetail = fullDetailScale();
    const limit = fullDetail ? Infinity : displayLimit();
    const grouped = lyr.kmlFolders.length > 0;
    const bounds = uncoveredMapBounds();
    const pinned = [];
    const candidates = [[], [], []];
    if (!grouped) for (const leaf of all) {
      if (kmlLeafVisible(lyr, leaf) && leafIntersectsBounds(leaf, bounds)) {
        if (leaf === state.selected || leaf._displayEditing) pinned.push(leaf);
        else candidates[leaf instanceof L.Polygon ? 0 : isPointLeaf(leaf) ? 2 : 1].push(leaf);
      }
      if (++checkpoints % DISPLAY_CHECKPOINT_INTERVAL === 0) yield;
    }
    const desired = grouped ? yield* folderDisplaySelection(lyr, all, limit, bounds) : new Set(pinned.slice(0, limit));
    if (!grouped && candidates[0].length > limit - desired.size) {
      isolatedSitePolygons(lyr, candidates[0], limit - desired.size).forEach(leaf => desired.add(leaf));
    }
    if (!grouped) for (const items of candidates.slice(0, 2)) {
      const remaining = items.filter(leaf => !desired.has(leaf));
      const count = Math.min(limit - desired.size, remaining.length);
      for (let index = 0; index < count; index++) {
        desired.add(remaining[Math.floor(index * remaining.length / count)]);
        if (++checkpoints % DISPLAY_CHECKPOINT_INTERVAL === 0) yield;
      }
    }
    const needsNearby = (grouped && [...desired].some(singleCharacterLabel)) || pinned.some(leaf => isPointLeaf(leaf) && singleCharacterLabel(leaf)) ||
      (desired.size < limit && candidates[2].some(singleCharacterLabel));
    const nearby = needsNearby ? yield* polygonLabelIndex([...desired].filter(leaf => leaf instanceof L.Polygon)) : new Map();
    const points = [];
    for (const leaf of candidates[2]) {
      if (singleCharacterLabel(leaf) && kmlLabelOnly(leaf)) {
        leaf._kmlLabelSize = polygonLabelSize(leaf, nearby);
        if (leaf._kmlLabelSize > 0) points.push(leaf);
      } else points.push(leaf);
      if (++checkpoints % DISPLAY_CHECKPOINT_INTERVAL === 0) yield;
    }
    const pointCount = grouped ? 0 : Math.min(limit - desired.size, points.length);
    for (let index = 0; index < pointCount; index++) {
      desired.add(points[Math.floor(index * points.length / pointCount)]);
      if (++checkpoints % DISPLAY_CHECKPOINT_INTERVAL === 0) yield;
    }
    for (const leaf of desired) {
      let changed = false;
      if (isPointLeaf(leaf) && leaf !== state.selected && leaf.options.radius !== pointRadius(leaf)) {
        restyle(leaf);
        changed = true;
      }
      if (singleCharacterLabel(leaf)) {
        changed ||= !!leaf.getTooltip();
        leaf._kmlLabelSize = polygonLabelSize(leaf, nearby);
        updateKmlLabel(leaf);
        changed ||= !!leaf.getTooltip();
        if (kmlLabelOnly(leaf) && !leaf._kmlLabelSize) desired.delete(leaf);
      } else if (isPointLeaf(leaf) && [...String(leaf.feature?.properties?.name ?? '').trim()].length === 4) {
        const previous = leaf._kmlLabelKey;
        updateKmlLabel(leaf, siteFontSize);
        changed ||= previous !== leaf._kmlLabelKey;
      }
      if (changed || ++checkpoints % DISPLAY_CHECKPOINT_INTERVAL === 0) yield changed;
    }
    for (const leaf of lyr.displayed) {
      const removed = !desired.has(leaf);
      if (removed) { map.removeLayer(leaf); lyr.displayed.delete(leaf); }
      if (removed || ++checkpoints % DISPLAY_CHECKPOINT_INTERVAL === 0) yield removed;
    }
    for (const leaf of desired) {
      const added = !lyr.displayed.has(leaf);
      if (added) { lyr.displayed.add(leaf); map.addLayer(leaf); }
      if (added || ++checkpoints % DISPLAY_CHECKPOINT_INTERVAL === 0) yield added;
    }
    yield* placeSiteLabels(lyr);
    for (const leaf of lyr.displayed) {
      const label = leaf.getTooltip()?.getElement();
      if (label) label.style.zIndex = String(lyr.order || 0);
      if (++checkpoints % DISPLAY_CHECKPOINT_INTERVAL === 0) yield;
    }
    lyr.displaySampleZoom = map.getZoom();
  }

  function syncLayerOrder() {
    const displayed = state.layers.filter(lyr => lyr.displayed.size > 0);
    const orderChanged = displayed.some((lyr, index) => index > 0 && displayed[index - 1].order < lyr.order);
    state.layers.forEach((lyr, index) => {
      const order = state.layers.length - index;
      if (lyr.order === order) return;
      lyr.order = order;
      lyr.displayed.forEach(leaf => {
        const label = leaf.getTooltip()?.getElement();
        if (label) label.style.zIndex = String(lyr.order);
      });
    });
    if (!orderChanged) return;
    vectorRenderer._layerOrderDirty = true;
    if (vectorRenderer._map && vectorRenderer._drawFirst) {
      vectorRenderer._redrawBounds = L.bounds(vectorRenderer._bounds.min, vectorRenderer._bounds.max);
      vectorRenderer._requestRedraw(vectorRenderer._drawFirst.layer);
    }
  }

  let displayRefreshTimer = null;
  let panelResizeActive = false;
  function scheduleMapDisplay() {
    if (panelResizeActive || panelMotionCount) return;
    state.layers.forEach(lyr => {
      lyr.spatialRequest = (lyr.spatialRequest || 0) + 1;
      cancelLayerDisplay(lyr);
    });
    if (displayRefreshTimer !== null) return;
    displayRefreshTimer = setTimeout(() => {
      displayRefreshTimer = null;
      state.layers.forEach(lyr => syncLayerDisplay(lyr));
    }, 32);
  }
  map.on('moveend zoomend resize', scheduleMapDisplay);
  map.on('movestart zoomstart', () => state.layers.forEach(lyr => {
    lyr.spatialRequest = (lyr.spatialRequest || 0) + 1;
    cancelLayerDisplay(lyr);
  }));

  function configureLayerDisplay(lyr) {
    const group = lyr.group;
    lyr.featureCount = Object.keys(group._layers).length;
    lyr.spatialVersion = 0;
    group.onAdd = () => syncLayerDisplay(lyr);
    group.onRemove = () => {
      cancelLayerDisplay(lyr);
      lyr.spatialRequest = (lyr.spatialRequest || 0) + 1;
      lyr.spatialPending = null;
      lyr.spatialCache = null;
      SpatialQueries.release(lyr.id);
      lyr.displayed.forEach(leaf => map.removeLayer(leaf));
      lyr.displayed.clear();
      vectorRenderer._clearRetained(lyr);
    };
    group.addLayer = function(leaf) {
      if (this.hasLayer(leaf)) return this;
      lyr.sitePolygons = null;
      lyr.spatialVersion++;
      lyr.featureCount++;
      leaf.addEventParent(this);
      this._layers[L.stamp(leaf)] = leaf;
      this.fire('layeradd', { layer: leaf });
      if (!lyr.importing) scheduleMapDisplay();
      return this;
    };
    const removeLayer = group.removeLayer;
    group.removeLayer = function(leaf) {
      lyr.sitePolygons = null;
      if (this.hasLayer(leaf)) { lyr.spatialVersion++; lyr.featureCount--; }
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
    }
    syncLayerDisplay(lyr);
    if (state.active === lyr) {
      state.page = 0;
      renderTable();
    }
  }

  function restyle(leaf) {
    const lyr = leaf._glayer;
    if (!lyr || !leaf.setStyle) return;
    const st = (leaf.feature && leaf.feature.style) || {};
    const selected = state.selected === leaf;
    leaf._displaySelected = selected;
    const point = isPointLeaf(leaf);
    const num = (v, d) => (v === undefined || v === null || v === '' || isNaN(Number(v)) ? d : Number(v));
    let style;
    if (point) {
      const radius = pointRadius(leaf);
      style = {
        radius: selected ? 9 : radius, color: selected ? '#facc15' : '#ffffff', weight: selected ? 3 : radius / 4,
        fillColor: st['marker-color'] || st['icon-color'] || lyr.color,
        fillOpacity: num(st['icon-opacity'], 0.95), opacity: num(st['icon-opacity'], 1), fill: true,
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
    if (point && leaf.getRadius() !== style.radius) leaf.setRadius(style.radius);
    updateKmlLabel(leaf);
  }

  function wireLeaf(lyr, leaf) {
    leaf._glayer = lyr;
    leaf.on('pm:edit pm:dragend pm:markerdragend move edit', () => {
      lyr.spatialVersion++;
      lyr.sitePolygons = null;
      scheduleMapDisplay();
    });
    if (!leaf.feature) leaf.feature = { type: 'Feature', properties: {}, geometry: null };
    if (!leaf.feature.properties) leaf.feature.properties = {};
    leaf.on('click', (ev) => {
      if (pendingMask) return;
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
    syncLayerOrder();
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
    const count = leavesOf(lyr).length;
    if (!(await confirmBox('Delete layer', `Delete “${lyr.name}” and its ${count} ${count === 1 ? 'feature' : 'features'}? Download it first if you need it.`, 'Delete', true))) return;
    map.removeLayer(lyr.group);
    state.layers = state.layers.filter((l) => l !== lyr);
    if (state.selected && state.selected._glayer === lyr) state.selected = null;
    if (state.active === lyr) state.active = state.layers[state.layers.length - 1] || null;
    renderAll();
  }

  function zoomToLayer(lyr) {
    fitVisibleBounds(lyr.group.getBounds());
  }

  let pendingMask = null;

  async function collectLayerFeatures(lyr, signal) {
    const features = [];
    let started = performance.now();
    for (const leaf of leavesOf(lyr)) {
      signal.throwIfAborted();
      features.push(leaf.toGeoJSON(false));
      if (performance.now() - started >= 8) {
        await paintImport(signal);
        started = performance.now();
      }
    }
    return features;
  }

  let analysisBusy = false;
  async function analyzeLayer(lyr) {
    if (analysisBusy) return;
    analysisBusy = true;
    const dialog = $('analysisDlg');
    const bar = $('analysisProgressBar');
    const status = $('analysisProgressStatus');
    const button = $('btnCancelAnalysis');
    const controller = new AbortController();
    const cancel = event => { event?.preventDefault(); controller.abort(); button.disabled = true; };
    let completed = false;
    dialog.classList.remove('analysis-complete');
    dialog.setAttribute('aria-labelledby', 'analysisProgressTitle');
    $('analysisProgress').hidden = false;
    $('analysisResults').hidden = true;
    bar.max = lyr.featureCount || 1;
    bar.value = 0;
    status.textContent = 'Preparing features';
    button.disabled = false;
    button.addEventListener('click', cancel);
    dialog.addEventListener('cancel', cancel, true);
    const view = bindProgressView(dialog);
    dialog.showModal();
    try {
      await paintImport(controller.signal);
      const features = await collectLayerFeatures(lyr, controller.signal);
      const onProgress = value => { bar.value = value; status.textContent = `${value} of ${features.length} features`; };
      const report = await BackgroundTasks.run('geometry', { features }, {
        signal: controller.signal, onProgress,
        fallback: () => GeometryCore.analyze(features, { signal: controller.signal, onProgress }),
      });
      controller.signal.throwIfAborted();
      const format = value => typeof value === 'number' ? value.toLocaleString(undefined, { maximumFractionDigits: 3 }) : value;
      const summary = $('analysisSummary');
      summary.replaceChildren();
      const metrics = [['Features', report.featureCount], ['Valid', report.validFeatures], ['Invalid', report.invalidFeatures],
        ['Empty', report.emptyFeatures], ['Polygon area (m²)', report.areaSquareMetres], ['Line length (m)', report.lineLengthMetres],
        ...Object.entries(report.geometryTypes)];
      metrics.forEach(([name, value]) => {
        const term = document.createElement('dt');
        const detail = document.createElement('dd');
        term.textContent = name;
        detail.textContent = format(value);
        summary.append(term, detail);
      });
      const body = $('analysisFields').tBodies[0];
      body.replaceChildren();
      report.numericFields.slice(0, 50).forEach(field => {
        const row = body.insertRow();
        [field.name, field.count, field.min, field.max, field.mean].forEach(value => { row.insertCell().textContent = format(value); });
      });
      $('analysisFields').hidden = !report.numericFields.length;
      $('analysisIssues').textContent = report.issues.slice(0, 20).map(issue => `Feature ${issue.feature}: ${issue.message}`).join('\n');
      $('analysisResultTitle').textContent = lyr.name;
      $('btnDownloadAnalysis').onclick = () => saveBlob(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), `${lyr.name}-analysis.json`);
      $('analysisProgress').hidden = true;
      $('analysisResults').hidden = false;
      dialog.classList.add('analysis-complete');
      dialog.setAttribute('aria-labelledby', 'analysisResultTitle');
      $('btnCloseAnalysis').focus();
      completed = true;
    } catch (error) {
      if (!controller.signal.aborted) toast(`Analysis failed: ${error.message}`, 'error');
    } finally {
      view.disconnect();
      button.removeEventListener('click', cancel);
      dialog.removeEventListener('cancel', cancel, true);
      if (!completed) await closeDialog(dialog);
      analysisBusy = false;
    }
  }
  $('btnCloseAnalysis').addEventListener('click', () => closeDialog($('analysisDlg')));

  function maskPolygons(lyr) {
    const polygons = [];
    turf.flattenEach(lyr.group.toGeoJSON(false), feature => {
      if (feature.geometry?.type === 'Polygon') polygons.push(feature);
    });
    return polygons;
  }

  async function applyLayerMask(lyr, polygons, name, exclude = false, preserve = true, scope = 'visible') {
    const dialog = $('maskProgressDlg');
    const progress = $('maskProgressBar');
    const status = $('maskProgressStatus');
    const cancelButton = $('btnCancelMask');
    const controller = new AbortController();
    let cancelled = false;
    const cancel = event => {
      event.preventDefault();
      cancelled = true;
      controller.abort();
      cancelButton.disabled = true;
      status.textContent = 'Cancelling…';
    };
    dialog.addEventListener('cancel', cancel);
    cancelButton.addEventListener('click', cancel);
    cancelButton.disabled = false;
    progress.value = 0;
    progress.max = 1;
    status.textContent = 'Preparing mask…';
    const progressView = bindProgressView(dialog);
    dialog.showModal();
    try {
      await new Promise(resolve => setTimeout(resolve, 0));
      if (cancelled) return null;
      const source = leavesOf(lyr).filter(leaf => scope === 'all' || kmlLeafVisible(lyr, leaf)).map(leaf => leaf.toGeoJSON(false));
      progress.max = source.length || 1;
      const report = count => {
        progress.value = count;
        status.textContent = `${count} / ${source.length} ${source.length === 1 ? 'feature' : 'features'}`;
      };
      const features = await BackgroundTasks.run('mask', { polygons, features: source, exclude, preserve }, {
        signal: controller.signal, onProgress: report,
        fallback: async () => {
          const mask = LayerMask.combine(polygons);
          const result = [];
          let sliceStart = performance.now();
          for (let index = 0; index < source.length; index++) {
            controller.signal.throwIfAborted();
            const clipped = preserve ? LayerMask.filter(source[index], mask, exclude) : LayerMask.clip(source[index], mask, exclude);
            if (clipped) result.push(clipped);
            if (performance.now() - sliceStart >= 8 || index === source.length - 1) {
              report(index + 1);
              await new Promise(resolve => setTimeout(resolve, 0));
              sliceStart = performance.now();
            }
          }
          return result;
        },
      });
      if (cancelled || !state.layers.includes(lyr)) return null;
      if (!features.length) {
        toast(exclude ? 'No features remain outside the mask. No layer was created.' : 'No features intersect the mask. No layer was created.', 'warn');
        return null;
      }
      const folderIds = new Set(features.flatMap(feature => feature.kml?.folderIds || []));
      for (const id of folderIds) {
        const parentId = lyr.kmlFolderMap.get(id)?.parentId;
        if (parentId != null) folderIds.add(parentId);
      }
      const result = createLayer({ name, features, fields: lyr.fields, types: lyr.types,
        geomType: lyr.geomType, format: lyr.format, kmlFolders: lyr.kmlFolders.filter(folder => folderIds.has(folder.id)) });
      result.color = lyr.color;
      leavesOf(result).forEach(leaf => restyle(leaf));
      setActive(result);
      fitVisibleBounds(result.group.getBounds());
      toast(`Created “${name}” with ${features.length} ${features.length === 1 ? 'feature' : 'features'}.`);
      return result;
    } catch (error) {
      if (cancelled) return null;
      toast(`Unable to mask layer: ${error.message}`, 'warn', 8000);
      return null;
    } finally {
      dialog.removeEventListener('cancel', cancel);
      cancelButton.removeEventListener('click', cancel);
      await closeDialog(dialog, cancelled ? 'cancel' : 'ok');
      progressView.disconnect();
    }
  }

  async function maskLayer(lyr) {
    const selected = state.selected instanceof L.Polygon ? state.selected.toGeoJSON(false) : null;
    const sources = state.layers.filter(layer => layer !== lyr && leavesOf(layer).some(leaf => leaf instanceof L.Polygon));
    const options = [['draw', 'Draw a polygon']];
    if (selected) options.push(['selected', 'Selected polygon']);
    sources.forEach(layer => options.push([String(layer.id), `Layer: ${layer.name}`]));
    const values = await askForm('Mask layer', [
      { key: 'source', label: 'Mask polygon', type: 'select', options, value: selected ? 'selected' : 'draw' },
      { key: 'name', label: 'Output layer name', value: `${lyr.name} (masked)`, required: true },
      { key: 'mode', label: 'Mask operation', type: 'select', value: 'retain',
        options: [['retain', 'Retain inside mask'], ['exclude', 'Exclude inside mask']] },
      { key: 'geometry', label: 'Feature geometry', type: 'select', value: 'preserve',
        options: [['preserve', 'Keep whole original features'], ['clip', 'Clip geometry at mask boundary']] },
      { key: 'scope', label: 'Source features', type: 'select', value: 'visible',
        options: [['visible', 'Visible folders and features'], ['all', 'All stored features']] },
    ], { okLabel: 'Continue' });
    if (!values || !values.name.trim()) return;
    const name = values.name.trim();
    const exclude = values.mode === 'exclude';
    const preserve = values.geometry !== 'clip';
    if (values.source === 'draw') {
      map.closePopup();
      map.pm.disableDraw();
      if (map.pm.globalEditModeEnabled()) map.pm.disableGlobalEditMode();
      if (map.pm.globalDragModeEnabled()) map.pm.disableGlobalDragMode();
      if (map.pm.globalRemovalModeEnabled()) map.pm.disableGlobalRemovalMode();
      if (map.pm.globalCutModeEnabled()) map.pm.disableGlobalCutMode();
      pendingMask = { lyr, name, exclude, preserve, scope: values.scope };
      map.pm.enableDraw('Polygon', { snappable: true });
      return;
    }
    const source = sources.find(layer => String(layer.id) === values.source);
    await applyLayerMask(lyr, selected && values.source === 'selected' ? [selected] : maskPolygons(source), name, exclude, preserve, values.scope);
  }

  map.on('pm:drawend', () => { pendingMask = null; });

  function fitVisibleBounds(bounds, maxZoom = 17) {
    if (!bounds.isValid()) return;
    map.invalidateSize({ pan: false });
    const mapRect = map.getContainer().getBoundingClientRect();
    const workspace = $('workspace').getBoundingClientRect();
    const splitter = $('splitter');
    const visibleBottom = splitter.getClientRects().length ? splitter.getBoundingClientRect().top : workspace.bottom;
    map.fitBounds(bounds, {
      maxZoom,
      paddingTopLeft: [Math.max(0, workspace.left - mapRect.left) + 20, Math.max(0, workspace.top - mapRect.top) + 20],
      paddingBottomRight: [Math.max(0, mapRect.right - workspace.right) + 20, Math.max(0, mapRect.bottom - visibleBottom) + 20],
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

  function descriptionText(value) {
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (parsed?.['@type'] === 'html' && typeof parsed.value === 'string') return parsed.value;
      } catch {}
    }
    if (value?.['@type'] === 'html' && typeof value.value === 'string') return value.value;
    return display(value);
  }

  function openPopup(leaf, latlng) {
    const lyr = leaf._glayer;
    const form = document.createElement('div');
    form.className = 'popup-form';
    const h = document.createElement('h4');
    h.textContent = lyr.name;
    form.appendChild(h);
    const properties = leaf.feature.properties;
    const descriptionField = Object.keys(properties).find(field => field.toLowerCase() === 'description');
    const popupWidth = descriptionField ? Math.min(320, Math.max(100, map.getSize().x - 64)) : 320;
    if (descriptionField) {
      form.classList.add('has-description');
      form.style.width = `${popupWidth}px`;
    }
    const description = document.createElement('div');
    description.className = 'feature-description';
    const renderDescription = () => {
      const value = descriptionText(descriptionField ? properties[descriptionField] : leaf.feature.style?.['description-html'] ?? '');
      description.hidden = !value.trim();
      if (globalThis.DOMPurify) {
        description.replaceChildren(DOMPurify.sanitize(value, {
          RETURN_DOM_FRAGMENT: true,
          ALLOWED_TAGS: ['a', 'b', 'strong', 'i', 'em', 'u', 's', 'p', 'br', 'div', 'span', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'hr', 'dl', 'dt', 'dd', 'sub', 'sup'],
          ALLOWED_ATTR: ['href', 'title', 'colspan', 'rowspan'],
          ALLOW_DATA_ATTR: false,
          ALLOW_ARIA_ATTR: false,
        }));
        description.querySelectorAll('a').forEach(link => {
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
        });
      } else description.textContent = value;
      description.classList.toggle('formatted', description.children.length > 0);
    };
    renderDescription();
    form.appendChild(description);
    if (!lyr.fields.length) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'No attribute fields. Add one with “＋ Field”.';
      form.appendChild(p);
    }
    lyr.fields.forEach((f) => {
      const label = document.createElement('label');
      label.append(f);
      const input = document.createElement(f === descriptionField ? 'textarea' : 'input');
      if (f === descriptionField) input.rows = 3;
      input.value = f === descriptionField ? descriptionText(properties[f]) : display(properties[f]);
      input.addEventListener('change', () => {
        if (!setValue(lyr, leaf, f, input.value)) input.value = f === descriptionField ? descriptionText(properties[f]) : display(properties[f]);
        else { renderDescription(); renderTable(); }
      });
      label.appendChild(input);
      if (f === descriptionField) {
        const editor = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = 'Edit description';
        editor.append(summary, label);
        form.appendChild(editor);
      } else form.appendChild(label);
    });
    L.popup({ maxWidth: popupWidth }).setLatLng(latlng || (leaf.getLatLng ? leaf.getLatLng() : leaf.getBounds().getCenter())).setContent(form).openOn(map);
  }

  /* ---------- drawing ---------- */
  map.on('pm:create', (e) => {
    const leaf = e.layer;
    map.removeLayer(leaf);
    if (pendingMask) {
      const { lyr, name, exclude, preserve, scope } = pendingMask;
      pendingMask = null;
      applyLayerMask(lyr, [leaf.toGeoJSON(false)], name, exclude, preserve, scope);
      return;
    }
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
    const total = leavesOf(lyr).length;
    $('bulkDeleteScope').textContent = `${total} ${total === 1 ? 'feature' : 'features'} in "${lyr.name}", across all pages. The table search filter is ignored.`;
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
      $('bulkDeletePreview').textContent = error || `${matches.length} ${matches.length === 1 ? 'feature' : 'features'} will be deleted; ${leavesOf(lyr).length - matches.length} will remain.`;
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
    if (!(await confirmBox('Confirm bulk deletion', `Delete ${matches.length} ${matches.length === 1 ? 'feature' : 'features'} from "${lyr.name}"? ${leavesOf(lyr).length - matches.length} will remain. This cannot be undone.`, `Delete ${matches.length} ${matches.length === 1 ? 'feature' : 'features'}`, true))) return;
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
    toast(`Deleted ${matches.length} ${matches.length === 1 ? 'feature' : 'features'} from "${lyr.name}".`);
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
    const noLayers = state.layers.length === 0;
    $('main').classList.toggle('no-layers', noLayers);
    renderLayers();
    renderTable();
    $('btnDownload').disabled = noLayers;
    $('emptyState').classList.toggle('hidden', !noLayers);
    $('layerHint').style.display = state.layers.length ? 'none' : '';
    if (mapToolsDisabled !== noLayers) {
      mapToolsDisabled = noLayers;
      if (noLayers) {
        map.pm.disableDraw();
        if (map.pm.globalEditModeEnabled()) map.pm.disableGlobalEditMode();
        if (map.pm.globalDragModeEnabled()) map.pm.disableGlobalDragMode();
        if (map.pm.globalRemovalModeEnabled()) map.pm.disableGlobalRemovalMode();
        if (map.pm.globalCutModeEnabled()) map.pm.disableGlobalCutMode();
        resetMapToolbars.forEach(reset => reset());
      }
      Object.keys(map.pm.Toolbar.getButtons()).forEach(name => map.pm.Toolbar.setButtonDisabled(name, noLayers));
      map.getContainer().querySelectorAll('.leaflet-pm-toolbar').forEach(toolbar => {
        toolbar.inert = noLayers;
        toolbar.setAttribute('aria-disabled', String(noLayers));
      });
    }
  }

  async function sessionSnapshot() {
    const center = map.getCenter();
    const selectedLayer = state.layers.indexOf(state.selected?._glayer);
    const layers = [];
    const signal = new AbortController().signal;
    for (const lyr of state.layers) {
      $('sessionProgressStatus').textContent = `Saving “${lyr.name}”…`;
      layers.push({
        name: lyr.name, fields: lyr.fields.slice(), types: { ...lyr.types }, geomType: lyr.geomType,
        format: lyr.format, color: lyr.color, visible: lyr.visible,
        kmlFolders: structuredClone(lyr.kmlFolders), features: await collectLayerFeatures(lyr, signal),
        widths: [...(columnWidths.get(lyr) || new Map())],
      });
    }
    return {
      version: 1, savedAt: new Date().toISOString(),
      layers,
      active: state.layers.indexOf(state.active),
      selected: selectedLayer < 0 ? null : { layer: selectedLayer, feature: leavesOf(state.layers[selectedLayer]).indexOf(state.selected) },
      page: state.page, filter: state.filter, sort: state.sort ? { ...state.sort } : null, colorIdx: state.colorIdx,
      view: {
        center: [center.lat, center.lng], zoom: map.getZoom(),
        basemap: Object.keys(basemaps).find(name => map.hasLayer(basemaps[name])) || 'Standard',
        collapsed: $('sidebar').classList.contains('collapsed'), tableBasis: $('tablePanel').style.flexBasis,
        sidebarWidth: parseFloat($('main').style.getPropertyValue('--sidebar-width')) || 330,
        sidebarFitNames: $('main').classList.contains('sidebar-fit-names'),
        theme: document.documentElement.dataset.theme,
      },
    };
  }

  async function restoreSession(saved) {
    await BackgroundTasks.run('session', { operation: 'validate', session: saved }, { fallback: () => SessionCore.validate(saved) });
    const previous = { ...state, layers: state.layers.slice() };
    const staged = [];
    const signal = new AbortController().signal;
    const progress = $('sessionProgressBar');
    let restored = false;
    try {
      map.closePopup();
      map.pm.disableDraw();
      progress.max = saved.layers.reduce((count, lyr) => count + lyr.features.length, 0) || 1;
      let completed = 0;
      for (const data of saved.layers) {
        const lyr = createLayer({ ...data, features: [], importing: true });
        staged.push(lyr);
        lyr.color = data.color;
        lyr.visible = data.visible !== false;
        columnWidths.set(lyr, new Map(data.widths || []));
        $('sessionProgressStatus').textContent = `Restoring “${lyr.name}”…`;
        await appendImportFeatures(lyr, data.features, fraction => {
          progress.value = completed + fraction * data.features.length;
        }, { signal });
        completed += data.features.length;
      }
      staged.forEach(lyr => {
        if (!lyr.visible) map.removeLayer(lyr.group);
        lyr.importing = false;
        lyr.group.options.pmIgnore = false;
        L.PM.reInitLayer(lyr.group);
      });
      previous.layers.forEach(lyr => map.removeLayer(lyr.group));
      state.layers = staged;
      state.active = staged[saved.active] || staged[0] || null;
      state.selected = saved.selected ? staged[saved.selected.layer]?.group.getLayers()[saved.selected.feature] || null : null;
      state.filter = typeof saved.filter === 'string' ? saved.filter : '';
      state.sort = saved.sort || null;
      state.page = Number.isInteger(saved.page) ? Math.max(0, saved.page) : 0;
      state.colorIdx = Number.isInteger(saved.colorIdx) ? saved.colorIdx : staged.length;
      state.undo = [];
      $('btnUndo').disabled = true;
      $('btnUndo').title = 'Undo last table edit';
      $('filter').value = state.filter;
      if (state.active) $('fmt').value = state.active.format;
      const base = { ...basemaps, OpenStreetMap: osm };
      Object.values(basemaps).forEach(layer => map.removeLayer(layer));
      (base[saved.view.basemap] || osm).addTo(map);
      if (saved.view.theme === 'dark' || saved.view.theme === 'light') applyTheme(saved.view.theme);
      setSidebarWidth(Number.isFinite(saved.view.sidebarWidth) ? saved.view.sidebarWidth : 330, !!saved.view.sidebarFitNames);
      if ($('sidebar').classList.contains('collapsed') !== !!saved.view.collapsed) $('btnToggleLayers').click();
      $('sidebar').getAnimations().forEach(animation => animation.finish());
      $('tablePanel').style.flexBasis = saved.view.tableBasis || '';
      initialMapViewPending = false;
      map.invalidateSize({ pan: false });
      map.setView(saved.view.center, saved.view.zoom, { animate: false });
      syncLayerOrder();
      renderAll();
      if (state.selected) restyle(state.selected);
      restored = true;
    } finally {
      if (!restored) {
        staged.forEach(lyr => map.removeLayer(lyr.group));
        Object.assign(state, previous);
        previous.layers.filter(lyr => lyr.visible).forEach(lyr => lyr.group.addTo(map));
        syncLayerOrder();
        renderAll();
      }
    }
  }

  async function runSessionTask(label, action) {
    if (sessionBusy) return;
    sessionBusy = true;
    $('btnSession').disabled = true;
    const dialog = $('sessionProgressDlg');
    const preventCancel = event => event.preventDefault();
    dialog.addEventListener('cancel', preventCancel, true);
    $('sessionProgressBar').removeAttribute('value');
    $('sessionProgressStatus').textContent = label;
    const progressView = bindProgressView(dialog);
    dialog.showModal();
    try {
      await new Promise(resolve => setTimeout(resolve, 0));
      await action();
      $('sessionProgressBar').value = $('sessionProgressBar').max;
    } catch (error) {
      toast(`Session failed: ${error.message}. Your previous saved copy is unchanged.`, 'warn', 9000);
    } finally {
      dialog.removeEventListener('cancel', preventCancel, true);
      await closeDialog(dialog, 'ok');
      progressView.disconnect();
      sessionBusy = false;
      $('btnSession').disabled = false;
    }
  }

  $('btnSession').addEventListener('click', async () => {
    if (sessionBusy) return;
    if (state.layers.some(lyr => lyr.importing) || $('maskProgressDlg').open) {
      toast('Wait for the current operation to finish before managing the session.', 'warn');
      return;
    }
    try {
      await importQueue;
      const saved = await sessionStore.load();
      const options = [['save', saved ? 'Replace saved session' : 'Save current session']];
      if (saved) options.push(['restore', 'Restore saved session'], ['clear', 'Delete saved session']);
      const result = await askForm('Session', [{ key: 'action', label: 'Session action', type: 'radio', value: 'save', options }], {
        message: saved ? `Saved ${new Date(saved.savedAt).toLocaleString()}` : 'No saved session.', okLabel: 'Continue',
      });
      if (!result) return;
      if (result.action === 'save') {
        await runSessionTask('Saving session…', async () => {
          await importQueue;
          await sessionStore.save(await sessionSnapshot());
          toast('Session saved in this browser.');
        });
      } else if (result.action === 'restore') {
        if (state.layers.length && !await confirmBox('Restore session', 'Replace the current workspace with the saved session? Unsaved edits will be discarded.', 'Restore', true)) return;
        await runSessionTask('Restoring session…', async () => { await importQueue; await restoreSession(saved); });
      } else if (await confirmBox('Delete saved session', 'Delete the saved copy from this browser? The current workspace will not change.', 'Delete', true)) {
        await runSessionTask('Deleting saved session…', async () => { await sessionStore.clear(); toast('Saved session deleted.'); });
      }
    } catch (error) {
      toast(`Session storage is unavailable: ${error.message}`, 'warn', 9000);
    }
  });

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

  function layerRowPositions() {
    return new Map([...$('layerList').children].map(row => [row.dataset.layerId, row.getBoundingClientRect()]));
  }

  function reorderLayer(lyr, target, after, previousPositions = layerRowPositions()) {
    if (lyr === target || !state.layers.includes(lyr) || !state.layers.includes(target)) return;
    state.layers.splice(state.layers.indexOf(lyr), 1);
    state.layers.splice(state.layers.indexOf(target) + (after ? 1 : 0), 0, lyr);
    syncLayerOrder();
    const list = $('layerList');
    const row = list.querySelector(`[data-layer-id="${lyr.id}"]`);
    const next = state.layers[state.layers.indexOf(lyr) + 1];
    list.insertBefore(row, next ? list.querySelector(`[data-layer-id="${next.id}"]`) : null);
    const rows = [...list.children];
    rows.forEach(item => item.getAnimations().forEach(animation => {
      if (animation.id === 'layer-reorder' || animation.transitionProperty === 'transform') animation.cancel();
    }));
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const currentPositions = layerRowPositions();
      rows.forEach(item => {
        const previous = previousPositions.get(item.dataset.layerId);
        if (!previous) return;
        const current = currentPositions.get(item.dataset.layerId);
        const distance = previous.top - current.top;
        if (Math.abs(distance) < 1) return;
        item.animate([
          { transform: `translateY(${distance}px)` },
          { transform: 'translateY(0)' },
        ], { id: 'layer-reorder', duration: 200, easing: 'cubic-bezier(.22, 1, .36, 1)' });
      });
    }
  }

  function layerReorderHandle(lyr, row) {
    const handle = iconButton('GripVertical', `Reorder layer ${lyr.name}`, () => {});
    handle.className = 'layer-reorder';
    handle.title = 'Drag to reorder layer; Arrow Up or Down to move';
    handle.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown');
    let drag = null;
    let dragFrame = null;
    const clearIndicators = () => {
      drag?.indicator?.classList.remove('drop-before', 'drop-after');
      if (drag) drag.indicator = null;
    };
    const cancelDrag = () => {
      if (dragFrame !== null) cancelAnimationFrame(dragFrame);
      dragFrame = null;
      if (!drag) return;
      clearIndicators();
      row.classList.remove('layer-dragging');
      drag.positions.forEach(item => { item.row.style.transform = ''; });
      drag = null;
    };
    const updateDrag = () => {
      dragFrame = null;
      if (!drag?.moved) return;
      const sidebar = $('sidebar');
      const scrollTop = sidebar.scrollTop;
      const scrollOffset = scrollTop - drag.scrollTop;
      const hovered = drag.positions.find(item => drag.clientY >= item.bounds.top - scrollOffset &&
        drag.clientY <= item.bounds.bottom - scrollOffset && drag.clientX >= item.bounds.left && drag.clientX <= item.bounds.right);
      const target = hovered?.row;
      drag.target = hovered?.layer;
      drag.after = Boolean(hovered && drag.clientY > hovered.bounds.top - scrollOffset + hovered.bounds.height / 2);
      const destination = !hovered || target === row ? drag.sourceIndex :
        hovered.index + (drag.after ? 1 : 0) - (drag.sourceIndex < hovered.index ? 1 : 0);
      const indicator = target && target !== row ? target : null;
      const indicatorClass = drag.after ? 'drop-after' : 'drop-before';
      row.classList.add('layer-dragging');
      row.style.transform = `translateY(${drag.clientY - drag.startY + scrollOffset}px)`;
      if (drag.indicator !== indicator || drag.indicatorClass !== indicatorClass) {
        clearIndicators();
        indicator?.classList.add(indicatorClass);
        drag.indicator = indicator;
        drag.indicatorClass = indicatorClass;
      }
      if (destination !== drag.destination) {
        drag.positions.forEach((item, index) => {
          if (item.row === row) return;
          const shift = index > drag.sourceIndex && index <= destination ? -drag.gap :
            index >= destination && index < drag.sourceIndex ? drag.gap : 0;
          item.row.style.transform = shift ? `translateY(${shift}px)` : '';
        });
        drag.destination = destination;
      }
      const direction = drag.clientY < drag.sidebarBounds.top + 32 ? -1 : drag.clientY > drag.sidebarBounds.bottom - 32 ? 1 : 0;
      const nextScroll = Math.min(drag.maxScroll, Math.max(0, scrollTop + direction * 12));
      if (nextScroll !== scrollTop) {
        sidebar.scrollTop = nextScroll;
        dragFrame = requestAnimationFrame(updateDrag);
      }
    };
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary) return;
      event.preventDefault();
      handle.focus();
      const sidebar = $('sidebar');
      const layers = new Map(state.layers.map(layer => [String(layer.id), layer]));
      const positions = [...$('layerList').children].map((item, index) => ({
        row: item, bounds: item.getBoundingClientRect(), layer: layers.get(item.dataset.layerId), index,
      }));
      const sourceIndex = positions.findIndex(item => item.row === row);
      drag = {
        startY: event.clientY, clientX: event.clientX, clientY: event.clientY,
        target: null, after: false, moved: false, sourceIndex, destination: sourceIndex,
        scrollTop: sidebar.scrollTop, sidebarBounds: sidebar.getBoundingClientRect(),
        maxScroll: Math.max(0, sidebar.scrollHeight - sidebar.clientHeight), positions,
        gap: positions[sourceIndex].bounds.height + parseFloat(getComputedStyle(row).marginBottom),
      };
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', event => {
      if (!drag || (!drag.moved && Math.abs(event.clientY - drag.startY) < 5)) return;
      drag.moved = true;
      drag.clientX = event.clientX;
      drag.clientY = event.clientY;
      if (dragFrame === null) dragFrame = requestAnimationFrame(updateDrag);
    });
    handle.addEventListener('pointerup', () => {
      if (dragFrame !== null) {
        cancelAnimationFrame(dragFrame);
        updateDrag();
      }
      const completed = drag;
      const positions = layerRowPositions();
      cancelDrag();
      if (completed?.moved && completed.target) reorderLayer(lyr, completed.target, completed.after, positions);
    });
    handle.addEventListener('pointercancel', cancelDrag);
    handle.addEventListener('lostpointercapture', cancelDrag);
    handle.addEventListener('keydown', event => {
      if (event.key === 'Escape') { cancelDrag(); return; }
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      const direction = event.key === 'ArrowUp' ? -1 : 1;
      const target = state.layers[state.layers.indexOf(lyr) + direction];
      if (!target) return;
      reorderLayer(lyr, target, direction > 0);
      $('layerList').querySelector(`[data-layer-id="${lyr.id}"] .layer-reorder`).focus();
    });
    return handle;
  }

  function renderLayers() {
    const ul = $('layerList');
    ul.replaceChildren();
    state.layers.forEach((lyr) => {
      syncLayerDisplay(lyr);
      const li = document.createElement('li');
      li.dataset.layerId = String(lyr.id);
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
      const renameButton = iconButton('Pencil', 'Rename layer', async () => {
        const r = await askForm('Rename layer', [{ key: 'name', label: 'Layer name', value: lyr.name, required: true }], { okLabel: 'Rename' });
        if (r && r.name.trim()) { lyr.name = r.name.trim(); renderLayers(); renderTable(); }
      });
      renameButton.classList.add('layer-rename');

      const meta = document.createElement('div');
      meta.className = 'lmeta';
      const info = document.createElement('span');
      const featureCount = leavesOf(lyr).length;
      info.textContent = `${featureCount} ${featureCount === 1 ? 'feature' : 'features'} · ${GEOM_LABEL[lyr.geomType]}`;
      const sp = document.createElement('span');
      sp.className = 'spacer';
      const downloadButton = iconButton('Download', 'Download this layer', () => downloadLayers([lyr]));
      const actions = document.createElement('div');
      actions.className = 'layer-actions';
      actions.append(
        iconButton('Search', 'Zoom to layer', () => zoomToLayer(lyr)),
        iconButton('VenetianMask', 'Mask layer', () => maskLayer(lyr)),
        iconButton('ChartNoAxesCombined', 'Analyze layer', () => analyzeLayer(lyr)),
        downloadButton,
        iconButton('Trash2', 'Delete layer', () => deleteLayer(lyr))
      );
      meta.append(info, sp, actions);
      li.append(layerReorderHandle(lyr, li), vis, color, name, renameButton, meta);
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
    const foldersByParent = new Map();
    lyr.kmlFolders.forEach(folder => {
      if (!foldersByParent.has(folder.parentId)) foldersByParent.set(folder.parentId, []);
      foldersByParent.get(folder.parentId).push(folder);
    });
    function appendFolders(parent, parentId) {
      (foldersByParent.get(parentId) || []).forEach(folder => {
        const branch = document.createElement('div');
        branch.className = 'kml-folder-branch';
        const row = document.createElement('div');
        row.className = 'kml-folder-row';
        const children = document.createElement('div');
        children.className = 'kml-folder-children';
        children.id = `kml-${lyr.id}-${folder.id}`;
        children.hidden = !folder.expanded;
        let populated = false;
        const populate = () => {
          if (populated) return;
          populated = true;
          appendFolders(children, folder.id);
        };
        const disclosureTitle = () => `${folder.expanded ? 'Collapse' : 'Expand'} folder ${folder.name}`;
        const disclosure = iconButton(folder.expanded ? 'ChevronDown' : 'ChevronRight', disclosureTitle(), () => {
          folder.expanded = !folder.expanded;
          if (folder.expanded) populate();
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
        if (folder.expanded) populate();
        branch.append(row, children);
        parent.appendChild(branch);
      });
    }
    appendFolders(tree, null);
    return tree;
  }

  function filteredLeaves(lyr) {
    let all = leavesOf(lyr);
    if (lyr.kmlFolders.some(folder => folder.visible)) {
      all = all.filter(leaf => {
        const folderIds = leaf.feature?.kml?.folderIds || [];
        return folderIds.length > 0 && folderIds.every(id => lyr.kmlFolderMap.get(id)?.visible !== false);
      });
    }
    const q = state.filter.trim().toLowerCase();
    if (!q) return all;
    return all.filter((leaf) => lyr.fields.some((f) => display(leaf.feature.properties[f]).toLowerCase().includes(q)));
  }

  let tableController = null;
  let tableRequest = 0;

  function renderTable() {
    const request = ++tableRequest;
    tableController?.abort();
    tableController = null;
    const lyr = state.active;
    const wrap = $('tableWrap');
    wrap.removeAttribute('aria-busy');
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
    const leaves = leavesOf(lyr);
    const job = {
      rows: leaves.map((leaf, index) => ({ index, properties: leaf.feature.properties, folderIds: leaf.feature.kml?.folderIds })),
      fields: lyr.fields, types: lyr.types, filter: state.filter, sort: state.sort,
      folders: lyr.kmlFolders.map(folder => ({ id: folder.id, visible: folder.visible })),
    };
    const background = leaves.length >= 2000 && (state.filter.trim() || state.sort || lyr.kmlFolders.some(folder => folder.visible));
    if (!background) {
      renderTableRows(lyr, TableCore.query(job).map(index => leaves[index]));
      return;
    }
    const controller = new AbortController();
    tableController = controller;
    wrap.setAttribute('aria-busy', 'true');
    $('tableTitle').textContent = lyr.name;
    $('tableCount').textContent = '';
    $('pgPrev').disabled = true;
    $('pgNext').disabled = true;
    const pending = document.createElement('div');
    pending.className = 'empty';
    pending.setAttribute('role', 'status');
    pending.textContent = 'Updating table...';
    wrap.appendChild(pending);
    BackgroundTasks.run('table', job, { signal: controller.signal, fallback: () => TableCore.query(job) }).then(indices => {
      if (controller.signal.aborted || request !== tableRequest || state.active !== lyr) return;
      wrap.replaceChildren();
      renderTableRows(lyr, indices.map(index => leaves[index]));
    }).catch(error => {
      if (controller.signal.aborted || request !== tableRequest || state.active !== lyr) return;
      toast(`Background table processing failed: ${error.message}. Using the local fallback.`, 'warn');
      wrap.replaceChildren();
      renderTableRows(lyr, TableCore.query(job).map(index => leaves[index]));
    }).finally(() => {
      if (request === tableRequest) {
        tableController = null;
        wrap.removeAttribute('aria-busy');
      }
    });
  }

  function renderTableRows(lyr, items) {
    const wrap = $('tableWrap');
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
      table.style.width = `calc(var(--geometry-column-width) + ${sizes.slice(1).reduce((total, size) => total + size, 0)}px)`;
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
    sizes = [...thead.cells].map((cell, index) => index === 0 ? parseFloat(getComputedStyle(previewHeader).minWidth) : index === 1
      ? Math.max(40, String(items.length).length * 10 + 16)
      : savedWidths.get(lyr.fields[index - 2]) || Math.max(MIN_COLUMN_WIDTH, cell.getBoundingClientRect().width));
    columns.forEach((column, index) => { column.style.width = index === 0 ? 'var(--geometry-column-width)' : `${sizes[index]}px`; });
    table.style.tableLayout = 'fixed';
    table.style.width = `calc(var(--geometry-column-width) + ${sizes.slice(1).reduce((total, size) => total + size, 0)}px)`;
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
  const IMPORT_WORKER_PROTOCOL = 2;
  let importWorkersEnabled = typeof Worker === 'function' && /^https?:$/.test(new URL(document.baseURI).protocol);
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

  async function blockingImportStep(work, context) {
    context.setCancellable(false);
    try {
      await new Promise(resolve => {
        let frame;
        const finish = () => {
          clearTimeout(fallback);
          cancelAnimationFrame(frame);
          resolve();
        };
        const fallback = setTimeout(finish, 100);
        frame = requestAnimationFrame(() => setTimeout(finish, 0));
      });
      context.signal.throwIfAborted();
      return work();
    } finally { context.setCancellable(true); }
  }

  function bindProgressView(root) {
    const bar = root.querySelector('progress');
    const track = root.querySelector('.progress-track');
    let columns = 1;
    const reveal = () => {
      const indeterminate = !bar.hasAttribute('value');
      track.classList.toggle('indeterminate', indeterminate);
      const fraction = Math.max(0, Math.min(1, bar.value / bar.max));
      track.style.setProperty('--progress-reveal', `${Math.floor(fraction * columns) / columns * 100}%`);
    };
    const columnObserver = new ResizeObserver(([entry]) => {
      columns = Math.max(1, Math.round(entry.contentRect.width / 6));
      reveal();
    });
    const valueObserver = new MutationObserver(reveal);
    columnObserver.observe(track);
    valueObserver.observe(bar, { attributes: true, attributeFilter: ['value', 'max'] });
    reveal();
    return {
      disconnect() {
        columnObserver.disconnect();
        valueObserver.disconnect();
      },
    };
  }

  function startImportProgress(files) {
    document.querySelector('.import-progress-title').textContent = files.length > 1 ? 'Adding layers' : 'Adding layer';
    const controller = new AbortController();
    const button = $('btnCancelImport');
    const cancel = () => controller.abort();
    button.disabled = false;
    button.title = 'Cancel import';
    button.addEventListener('click', cancel);
    let completed = 0;
    let currentProgress = 0;
    let percent = 0;
    $('importProgressBar').value = 0;
    const progressView = bindProgressView($('importProgress'));
    $('importProgress').hidden = false;
    $('mapWrap').classList.add('importing');
    $('mapWrap').setAttribute('aria-busy', 'true');
    return {
      signal: controller.signal,
      setCancellable(enabled) {
        button.disabled = !enabled;
        button.title = enabled ? 'Cancel import' : 'Cancellation unavailable during this step';
      },
      update(index, name, fraction, stage, count = 1) {
        controller.signal.throwIfAborted();
        if (index !== completed) { completed = index; currentProgress = 0; }
        currentProgress = Math.max(currentProgress, fraction);
        percent = Math.floor((index + currentProgress * count) / files.length * 100);
        const label = files.length === 1 ? '1 file' : `${index + 1} of ${files.length} files`;
        $('importProgressBar').value = percent;
        $('importProgressBar').setAttribute('aria-valuetext', `${percent}% - ${label}`);
        $('importProgressStatus').textContent = `${percent}% - ${label}`;
        $('importProgressFile').textContent = name;
        $('importProgressFile').title = name;
      },
      close() {
        progressView.disconnect();
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
    for (let offset = 0; offset < features.length; offset++) {
      context.signal.throwIfAborted();
      const batch = L.geoJSON(features[offset], {
        renderer: vectorRenderer, pointToLayer: lyr.group.options.pointToLayer,
      });
      batch.eachLayer(leaf => { wireLeaf(lyr, leaf); lyr.group.addLayer(leaf); });
      if (performance.now() - sliceStart >= 8 || offset + 1 >= features.length) {
        report((offset + 1) / features.length);
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
    if (prep.split) notes.push(`${prep.split} multi-part geometry ${prep.split === 1 ? 'collection was' : 'collections were'} split into separate features`);
    if (prep.skipped) notes.push(`${prep.skipped} ${prep.skipped === 1 ? 'feature without geometry was' : 'features without geometry were'} skipped`);
    const count = prep.count ?? prep.features.length;
    toast(`Loaded “${lyr.name}” (${count} ${count === 1 ? 'feature' : 'features'})` + (notes.length ? ' – ' + notes.join('; ') : ''));
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
    try { worker = new Worker(new URL(`js/import-worker.js?protocol=${IMPORT_WORKER_PROTOCOL}`, document.baseURI)); }
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
            if (data.protocol !== IMPORT_WORKER_PROTOCOL) {
              importWorkersEnabled = false;
              finish(null, null);
              return;
            }
            ready = true;
            clearTimeout(startupTimer);
            worker.postMessage({ ...job, type: 'import' });
            return;
          }
          if (data.type === 'progress') { report(data.fraction, 'Processing file'); return; }
          if (data.type === 'warning') { toast(data.message, data.kind, 9000); return; }
          if (data.type === 'error') { finish(new Error(data.message)); return; }
          if (data.type === 'done') { finish(null, { layer: last }); return; }
          if (data.type === 'layer') {
            metadata = data.metadata;
            current = createLayer({ name: data.name, format: data.format, ...metadata, importing: true });
            context.layers.add(current);
          } else if (data.type === 'features') {
            await appendImportFeatures(current, data.features,
              fraction => report(data.start + (data.end - data.start) * fraction, 'Building layer'), context);
          } else if (data.type === 'layer-end') {
            await blockingImportStep(() => finishImportedLayer(current, metadata), context);
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
    const prep = await blockingImportStep(() => ImportCore.prepare(fc, format), context);
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
    await blockingImportStep(() => finishImportedLayer(lyr, prep), context);
    return lyr;
  }

  async function loadKmlText(text, fallbackName, format, report, context) {
    report(.35, 'Parsing KML');
    await paintImport(context.signal);
    const converted = await blockingImportStep(() => parseKmlCollection(text, fallbackName), context);
    return addFromFeatureCollection(converted.collection, converted.name, format, report, context);
  }

  async function loadShapefileBuffer(buf, fallbackName, report, context) {
    report(.35, 'Parsing shapefile');
    await paintImport(context.signal);
    const result = await importStep(() => blockingImportStep(() => shp(buf), context), context.signal);
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
    if (file.size >= 1024 * 1024 || ext === 'zip' || ext === 'kmz' || ext === 'kml') {
      const threaded = await loadImportWorker({ file }, report, context);
      if (threaded) return threaded.layer;
    }
    if (ext === 'kml') return loadKmlText(await readImportFile(file, false, report, signal), name, 'kml', report, context);
    if (ext === 'geojson' || ext === 'json') {
      const text = await readImportFile(file, false, report, signal);
      report(.3, 'Parsing GeoJSON');
      await paintImport(signal);
      const gj = await blockingImportStep(() => JSON.parse(text), context);
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
    if (sessionBusy) {
      toast('Wait for the session operation to finish before importing files.', 'warn');
      return Promise.resolve();
    }
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
    const context = { signal: progress.signal, layers: new Set(), setCancellable: progress.setCancellable };
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
          progress.update(rest.length, `${shpFile ? shpFile.name : 'Shapefile parts'} (+${loose.length - 1} supporting ${loose.length === 2 ? 'file' : 'files'})`, fraction, stage, loose.length);
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
      progress.setCancellable(false);
      await paintImport(context.signal);
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
        $('shapefileExportSummary').textContent = `${checkboxes.filter((input) => input.checked).length} of ${lyr.fields.length} attribute ${lyr.fields.length === 1 ? 'column' : 'columns'} selected.`;
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
          styleStatus.textContent = `Imported symbol appearance from "${file.name}" for ${model.entries.length} ${model.entries.length === 1 ? 'category' : 'categories'}. Other geometry styles are unchanged; extra imported categories and non-symbol layer settings are not copied.`;
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
      const geometry = leaf.toGeoJSON(false).geometry;
      const props = {};
      lyr.fields.forEach((f) => {
        const v = leaf.feature.properties[f];
        props[f] = v === undefined ? null : v;
      });
      return { type: 'Feature', properties: props, geometry, style: leaf.feature.style || {},
        ...(leaf.feature.kml ? { kml: structuredClone(leaf.feature.kml) } : {}) };
    });
  }

  async function exportLayerFiles(lyr, fmt, base, shapefileOptions) {
    const layer = { name: lyr.name, fields: lyr.fields, types: lyr.types, color: lyr.color,
      kmlFolders: structuredClone(lyr.kmlFolders), features: cleanFeatures(lyr) };
    const options = shapefileOptions ? { ...shapefileOptions, styles: undefined } : null;
    const job = { layer, format: fmt, base, options };
    const output = await BackgroundTasks.run('export', job, { fallback: () => ExportCore.generate(job) });
    if (fmt === 'shp' && shapefileOptions?.styles) {
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      output.files.filter(file => file.name.endsWith('.qml')).forEach(file => {
        const xml = decoder.decode(file.data);
        const family = QgisStyle.read(xml).family;
        if (shapefileOptions.styles[family]) file.data = encoder.encode(QgisStyle.merge(xml, shapefileOptions.styles[family], shapefileOptions.categoryField));
      });
    }
    return output;
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
    const archive = await BackgroundTasks.run('export', { operation: 'zip', files }, { fallback: () => ExportCore.pack(files) });
    saveBlob(new Blob([archive], { type: 'application/zip' }), stamp + '.zip');
    toast(`Downloaded ${stamp}.zip`);
  }

  /* ---------- UI wiring ---------- */
  async function closeDialog(dialog, returnValue) {
    if (!dialog.open || dialog.classList.contains('closing')) return;
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      dialog.classList.add('closing');
      await Promise.all(dialog.getAnimations().map(animation => animation.finished.catch(() => {})));
    }
    dialog.classList.remove('closing');
    dialog.close(returnValue);
  }

  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.addEventListener('submit', event => {
      if (event.defaultPrevented || event.target.method !== 'dialog') return;
      event.preventDefault();
      closeDialog(dialog, event.submitter?.value ?? '');
    });
    dialog.addEventListener('cancel', event => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      closeDialog(dialog);
    });
  });

  $('btnAbout').addEventListener('click', () => {
    $('aboutDlg').showModal();
    $('aboutTitle').focus({ preventScroll: true });
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
    const content = $('sidebarContent');
    const button = $('btnToggleLayers');
    const collapsed = button.getAttribute('aria-expanded') === 'true';
    const tableBefore = $('tablePanel').getBoundingClientRect();
    const headerBefore = [...$('sidebarHeader').children].map(element => ({ element, before: element.getBoundingClientRect() }));
    const contentStart = getComputedStyle(content).transform;
    const movingPanel = mobileControls.matches ? content : sidebar;
    panelAnimations.get(movingPanel)?.controlAnimations?.forEach(({ element, animation }) => {
      if (element === $('tablePanel') || element === $('splitter') || sidebar.contains(element)) animation.cancel();
    });
    const before = [...mapContainer.querySelectorAll('.leaflet-top, .leaflet-bottom')].map(element => {
      const bounds = element.getBoundingClientRect();
      return { element, left: bounds.left, top: bounds.top };
    });
    const previousCollapsed = sidebar.classList.contains('collapsed');
    const previousHidden = content.hidden;
    sidebar.classList.add('collapsed');
    content.hidden = true;
    const collapsedOffsets = sidebarControlOffsets();
    sidebar.classList.toggle('collapsed', collapsed);
    content.hidden = collapsed;
    const target = sidebarControlOffsets();
    const tableTarget = $('tablePanel').getBoundingClientRect();
    const header = headerBefore.map(item => ({ ...item, target: item.element.getBoundingClientRect() }));
    sidebar.classList.toggle('collapsed', previousCollapsed);
    content.hidden = previousHidden;
    content.inert = collapsed;
    animatePanel(mobileControls.matches ? content : sidebar, mobileControls.matches ? 'translateY(-100%)' : 'translateX(-100%)', !collapsed, () => {
      sidebar.classList.toggle('collapsed', collapsed);
      content.hidden = collapsed;
      applySidebarControlOffsets(sidebarControlOffsets());
    }, false, { before, target, collapsed: collapsedOffsets, table: { before: tableBefore, target: tableTarget }, header, contentStart });
    const label = `${collapsed ? 'Expand' : 'Collapse'} Layers panel`;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-expanded', String(!collapsed));
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
  const resizableSidebar = window.matchMedia('(min-width: 1200px)');
  const minimumSidebarWidth = 330;
  let sidebarDrag = null;
  let sidebarResizeFrame = null;

  function beginPanelResize() {
    panelResizeActive = true;
    if (displayRefreshTimer !== null) {
      clearTimeout(displayRefreshTimer);
      displayRefreshTimer = null;
    }
  }

  function endPanelResize() {
    panelResizeActive = false;
    scheduleMapDisplay();
  }

  function maximumSidebarWidth() {
    return Math.max(minimumSidebarWidth, $('main').clientWidth - 480);
  }

  function setSidebarWidth(width, fitNames = false) {
    const maximum = maximumSidebarWidth();
    const limit = resizableSidebar.matches ? maximum : Infinity;
    const size = Math.max(minimumSidebarWidth, Math.min(limit, width));
    $('main').style.setProperty('--sidebar-width', `${size}px`);
    $('main').classList.toggle('sidebar-fit-names', fitNames);
    $('sidebarSplitter').max = String(maximum);
    $('sidebarSplitter').value = String(Math.round(size));
    $('sidebarSplitter').setAttribute('aria-valuetext', `${Math.round(size)} pixels`);
  }

  function fitSidebarNames() {
    if (!resizableSidebar.matches || $('sidebar').classList.contains('collapsed')) return;
    const context = document.createElement('canvas').getContext('2d');
    const width = $('sidebar').getBoundingClientRect().width;
    let desired = minimumSidebarWidth;
    document.querySelectorAll('#layerList > li > .lname').forEach(label => {
      const style = getComputedStyle(label);
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      desired = Math.max(desired, Math.ceil(context.measureText(label.textContent).width + width - label.getBoundingClientRect().width + 2));
    });
    setSidebarWidth(desired, true);
  }

  function finishSidebarResize() {
    if (!sidebarDrag) return;
    const pointerId = sidebarDrag.pointerId;
    if (sidebarResizeFrame !== null) {
      cancelAnimationFrame(sidebarResizeFrame);
      sidebarResizeFrame = null;
      setSidebarWidth(sidebarDrag.nextWidth);
      $('sidebar').getBoundingClientRect();
    }
    sidebarDrag = null;
    $('main').classList.remove('resizing-sidebar');
    if ($('sidebarSplitter').hasPointerCapture(pointerId)) $('sidebarSplitter').releasePointerCapture(pointerId);
    endPanelResize();
  }

  $('sidebarSplitter').addEventListener('pointerdown', event => {
    if (event.button !== 0 || !resizableSidebar.matches || $('sidebar').classList.contains('collapsed')) return;
    event.preventDefault();
    sidebarDrag = { pointerId: event.pointerId, start: event.clientX, width: $('sidebar').getBoundingClientRect().width };
    beginPanelResize();
    $('main').classList.add('resizing-sidebar');
    setSidebarWidth(sidebarDrag.width);
    $('sidebarSplitter').setPointerCapture(event.pointerId);
  });
  $('sidebarSplitter').addEventListener('pointermove', event => {
    if (!sidebarDrag || event.pointerId !== sidebarDrag.pointerId) return;
    sidebarDrag.nextWidth = sidebarDrag.width + event.clientX - sidebarDrag.start;
    if (sidebarResizeFrame !== null) return;
    sidebarResizeFrame = requestAnimationFrame(() => {
      sidebarResizeFrame = null;
      if (sidebarDrag) setSidebarWidth(sidebarDrag.nextWidth);
    });
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => $('sidebarSplitter').addEventListener(type, finishSidebarResize));
  $('sidebarSplitter').addEventListener('input', event => setSidebarWidth(Number(event.target.value)));
  $('sidebarSplitter').addEventListener('dblclick', event => { event.preventDefault(); fitSidebarNames(); });
  $('sidebarSplitter').addEventListener('keydown', event => {
    if (!resizableSidebar.matches || $('sidebar').classList.contains('collapsed')) return;
    const step = event.shiftKey ? 64 : 16;
    const width = $('sidebar').getBoundingClientRect().width;
    if (event.key === 'ArrowLeft') setSidebarWidth(width - step);
    else if (event.key === 'ArrowRight') setSidebarWidth(width + step);
    else if (event.key === 'Home') setSidebarWidth(minimumSidebarWidth);
    else if (event.key === 'End') fitSidebarNames();
    else return;
    event.preventDefault();
  });
  resizableSidebar.addEventListener('change', finishSidebarResize);
  window.addEventListener('blur', finishSidebarResize);

  function fitInitialMapView() {
    if (!initialMapViewPending || sessionStartupPending) return;
    initialMapViewPending = false;
    if (!state.layers.length) fitVisibleBounds(L.latLngBounds([[-44, 112], [-10, 154]]));
  }
  function updatePanelLayout() {
    if (fullscreenControlAnimations.length) return;
    const preferredWidth = parseFloat($('main').style.getPropertyValue('--sidebar-width')) || minimumSidebarWidth;
    if (resizableSidebar.matches && preferredWidth > maximumSidebarWidth()) {
      setSidebarWidth(preferredWidth, $('main').classList.contains('sidebar-fit-names'));
    }
    $('sidebarSplitter').max = String(maximumSidebarWidth());
    $('sidebarSplitter').value = String(Math.round(parseFloat($('main').style.getPropertyValue('--sidebar-width')) || minimumSidebarWidth));
    const main = $('main').getBoundingClientRect();
    const sidebar = $('sidebar').getBoundingClientRect();
    const table = $('tablePanel').getBoundingClientRect();
    const tableTop = state.layers.length ? table.top : main.bottom;
    const tableGap = state.layers.length ? 6 : 0;
    const stacked = sidebar.width >= main.width - 1;
    $('main').style.setProperty('--panel-left', `${stacked ? 0 : sidebar.width}px`);
    $('main').style.setProperty('--panel-top', `${stacked ? sidebar.height : 0}px`);
    $('main').style.setProperty('--panel-bottom', `${main.bottom - tableTop + tableGap}px`);
    const visibleWidth = main.width - (stacked ? 0 : sidebar.width);
    const visibleHeight = tableTop - main.top - (stacked ? sidebar.height : 0) - tableGap;
    const controlsHeight = Math.max(32, visibleHeight - 4);
    map.getContainer().style.setProperty('--map-controls-height', `${controlsHeight}px`);
    const topLeft = map.getContainer().querySelector('.leaflet-top.leaflet-left');
    const expandedHeight = [...topLeft.children].reduce((height, control) => height + 10 +
      (control.matches('.leaflet-pm-toolbar') ? control.children.length * 32 + 2 : control.getBoundingClientRect().height), 0);
    const compact = touchControls.matches || expandedHeight + 20 > controlsHeight;
    if (compact !== compactMapControls) {
      compactMapControls = compact;
      map.getContainer().classList.toggle('compact-controls', compact);
      resetMapToolbars.forEach(reset => reset());
    }
    const scalePosition = visibleWidth < 800 || visibleHeight < 440 ? 'bottomright' : 'bottomleft';
    if (scaleControl.getPosition() !== scalePosition) scaleControl.setPosition(scalePosition);
    fitInitialMapView();
    scheduleMapDisplay();
  }
  const panelObserver = new ResizeObserver(updatePanelLayout);
  [$('main'), $('sidebar'), $('tablePanel')].forEach(panel => panelObserver.observe(panel));

  let tableCollapsed = false;
  const setTableCollapsed = (collapsed, animated = false) => {
    tableCollapsed = collapsed;
    const panel = $('tablePanel');
    const commit = () => panel.classList.toggle('table-collapsed', collapsed);
    if (animated) animatePanel(panel, 'translateY(100%)', !collapsed, commit);
    else {
      stopPanelAnimation(panel);
      commit();
    }
    $('tablePanel').inert = collapsed;
    $('splitter').setAttribute('aria-expanded', String(!collapsed));
    $('splitter').title = `Drag to resize; double-press to ${collapsed ? 'expand' : 'collapse'} table`;
  };
  const toggleTableCollapsed = () => setTableCollapsed(!tableCollapsed, true);
  let tableTouchStart;
  let lastTableTap = 0;
  let lastTableTouchToggle = -Infinity;
  $('splitter').addEventListener('dblclick', event => {
    event.preventDefault();
    if (performance.now() - lastTableTouchToggle > 500) toggleTableCollapsed();
  });
  $('splitter').addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch') tableTouchStart = { x: event.clientX, y: event.clientY };
  });
  $('splitter').addEventListener('pointercancel', () => { tableTouchStart = null; lastTableTap = 0; });
  $('splitter').addEventListener('pointerup', event => {
    if (event.pointerType !== 'touch' || !tableTouchStart) return;
    const start = tableTouchStart;
    tableTouchStart = null;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) { lastTableTap = 0; return; }
    const now = performance.now();
    if (lastTableTap && now - lastTableTap < 350) {
      event.preventDefault();
      toggleTableCollapsed();
      lastTableTouchToggle = now;
      lastTableTap = 0;
    } else lastTableTap = now;
  });
  $('splitter').addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggleTableCollapsed();
  });
  $('splitter').addEventListener('mousedown', (e) => {
    e.preventDefault();
    const total = $('workspace').getBoundingClientRect();
    let frame = null;
    let nextHeight;
    beginPanelResize();
    const move = (ev) => {
      nextHeight = Math.min(total.height - 140, Math.max(80, total.bottom - ev.clientY));
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        setTableCollapsed(false);
        $('tablePanel').style.flexBasis = nextHeight + 'px';
      });
    };
    const up = () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
        setTableCollapsed(false);
        $('tablePanel').style.flexBasis = nextHeight + 'px';
      }
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('blur', up);
      endPanelResize();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('blur', up);
  });

  window.addEventListener('beforeunload', (e) => {
    if (state.layers.length) { e.preventDefault(); e.returnValue = ''; }
  });

  renderAll();

  const sessionReady = (async () => {
    try {
      const saved = await sessionStore.load();
      await importQueue;
      if (saved && !state.layers.length && !document.querySelector('dialog[open]')) {
        await runSessionTask('Restoring session…', () => restoreSession(saved));
      }
    } catch (error) {
      toast(`Could not open the saved session: ${error.message}`, 'warn', 9000);
    } finally {
      sessionStartupPending = false;
      fitInitialMapView();
      $('btnSession').disabled = false;
    }
  })();

  // Exposed for debugging / automated tests.
  window.__geoEditor = { state, map, handleFiles, createLayer, downloadLayers, sessionReady };
})();
