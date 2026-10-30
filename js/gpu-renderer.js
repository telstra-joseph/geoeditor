(() => {
  'use strict';

  const color = (value) => {
    try { return new PIXI.Color(value).toNumber(); }
    catch { return 0x3388ff; }
  };

  const polygonGroups = (latlngs) => {
    if (L.LineUtil.isFlat(latlngs)) return [[latlngs]];
    if (L.LineUtil.isFlat(latlngs[0])) return [latlngs];
    return latlngs.flatMap(polygonGroups);
  };

  function cloneGeometryData(data, offset) {
    const copy = data.clone();
    copy.holes = data.holes.map(hole => cloneGeometryData(hole, offset));
    if (offset.x || offset.y) {
      copy.matrix = copy.matrix?.clone() || new PIXI.Matrix();
      copy.matrix.tx += offset.x;
      copy.matrix.ty += offset.y;
    }
    return copy;
  }

  L.GpuCanvas = L.Canvas.extend({
    options: { geometryCacheSize: 256, geometryCacheVertices: 50000,
      adaptiveResolutionThreshold: 1000, resolutionRestoreDelay: 120,
      geometryBatchThreshold: 128, geometryBatchSize: 32 },

    getEvents() {
      return L.extend({}, L.Canvas.prototype.getEvents.call(this), {
        movestart: this._startInteraction, zoomstart: this._startInteraction,
        moveend: this._endInteraction, zoomend: this._endInteraction,
      });
    },

    _startInteraction() {
      if (!this._gpu) return;
      clearTimeout(this._resolutionTimer);
      if (this._graphics.size < this.options.adaptiveResolutionThreshold) return;
      this._setResolution(Math.min(this._fullResolution, Math.max(.5, Math.min(1, this._fullResolution * .75))));
    },

    _endInteraction(event) {
      L.Canvas.prototype.getEvents.call(this)[event.type]?.call(this, event);
      if (!this._gpu || this._gpu.resolution === this._fullResolution) return;
      clearTimeout(this._resolutionTimer);
      this._resolutionTimer = setTimeout(() => {
        this._resolutionTimer = null;
        if (this._map && this._gpu) this._setResolution(this._fullResolution);
      }, this.options.resolutionRestoreDelay);
    },

    _setResolution(resolution) {
      if (this._gpu.resolution === resolution) return;
      this._gpu.resolution = resolution;
      this._gpu.resize(this._gpu.screen.width, this._gpu.screen.height);
      if (this._drawFirst) this._requestRedraw(this._drawFirst.layer);
    },

    _initContainer() {
      try {
        if (!window.PIXI) throw new Error('WebGL renderer unavailable.');
        this._gpu = new PIXI.Renderer({
          width: 1, height: 1, backgroundAlpha: 0, antialias: true,
          resolution: Math.min(window.devicePixelRatio || 1, 2),
          autoDensity: true, powerPreference: 'high-performance',
        });
      } catch {
        this._gpu = null;
        L.Canvas.prototype._initContainer.call(this);
        this._container.dataset.renderer = 'canvas';
        return;
      }
      this._stage = new PIXI.Container();
      this._fullResolution = this._gpu.resolution;
      this._graphics = new Map();
      this._retained = new Map();
      this._retainedVertices = 0;
      this._polygonRings = new WeakMap();
      this._circleState = new WeakMap();
      this._geometryBatches = new Map();
      this._dirty = new Set();
      this._container = this._gpu.view;
      this._container.dataset.renderer = 'webgl';
      this._container._leaflet_disable_events = true;
      L.DomEvent.on(this._container, 'mousemove', this._onMouseMove, this);
      L.DomEvent.on(this._container, 'click dblclick mousedown mouseup contextmenu', this._onClick, this);
      L.DomEvent.on(this._container, 'mouseout', this._handleMouseOut, this);
      L.DomEvent.on(this._container, 'webglcontextrestored', this._restoreContext, this);
    },

    _restoreContext() {
      if (this._map) this._update();
    },

    _destroyContainer() {
      if (!this._gpu) return L.Canvas.prototype._destroyContainer.call(this);
      clearTimeout(this._resolutionTimer);
      L.Util.cancelAnimFrame(this._redrawRequest);
      L.DomEvent.off(this._container);
      L.DomUtil.remove(this._container);
      this._clearRetained();
      this._clearGeometryBatches();
      this._stage.destroy({ children: true });
      this._graphics.clear();
      this._dirty.clear();
      this._gpu.destroy(true);
      delete this._stage;
      delete this._graphics;
      delete this._polygonRings;
      delete this._circleState;
      delete this._geometryBatches;
      delete this._retained;
      delete this._dirty;
      delete this._gpu;
      delete this._container;
    },

    _update() {
      if (!this._gpu) return L.Canvas.prototype._update.call(this);
      if (this._map._animatingZoom && this._bounds) return;
      L.Renderer.prototype._update.call(this);
      const size = this._bounds.getSize();
      L.DomUtil.setPosition(this._container, this._bounds.min);
      this._gpu.resize(Math.max(1, size.x), Math.max(1, size.y));
      this._stage.position.set(-this._bounds.min.x, -this._bounds.min.y);
      this.fire('update');
    },

    _dropRetained(id) {
      const record = this._retained?.get(id);
      if (!record) return;
      this._retained.delete(id);
      this._retainedVertices -= record.vertices;
      record.graphic.destroy();
    },

    _clearRetained(group = null) {
      if (!this._retained) return;
      for (const [id, record] of this._retained) {
        if (!group || record.layer._glayer === group) this._dropRetained(id);
      }
    },

    _restoreRetained(layer) {
      const id = L.stamp(layer);
      const record = this._retained.get(id);
      if (!record) return;
      if (record.zoom !== this._map.getZoom() || record.coordinates !== layer._latlngs) {
        this._dropRetained(id);
        return;
      }
      this._retained.delete(id);
      this._retainedVertices -= record.vertices;
      const offset = record.origin.subtract(this._map.getPixelOrigin());
      record.graphic.position.set(offset.x, offset.y);
      this._graphics.set(id, record.graphic);
      this._stage.addChild(record.graphic);
      this._polygonRings.set(layer, layer._rings);
    },

    _clear() {
      if (!this._gpu) L.Canvas.prototype._clear.call(this);
    },

    _clearGeometryBatches() {
      for (const batch of this._geometryBatches.values()) batch.graphic.destroy();
      this._geometryBatches.clear();
    },

    _syncGeometryBatches() {
      if (this._graphics.size < this.options.geometryBatchThreshold) {
        for (const graphic of this._graphics.values()) graphic.renderable = true;
        this._clearGeometryBatches();
        return;
      }
      const seen = new Set();
      let members = [];
      let bucket;
      let group;
      let reordered = false;
      const flush = () => {
        if (!members.length) return;
        const key = members.map(member => member.id).join(',');
        const signature = members.map(({ graphic }) => `${graphic._geometryVersion}:${graphic.position.x}:${graphic.position.y}`).join(';');
        let batch = this._geometryBatches.get(key);
        if (!batch) {
          const graphic = new PIXI.Graphics();
          graphic.geometry.isBatchable = () => false;
          batch = { graphic, signature: null };
          this._geometryBatches.set(key, batch);
          this._stage.addChild(graphic);
          reordered = true;
        }
        if (batch.signature !== signature) {
          batch.graphic.clear();
          for (const { graphic } of members) {
            for (const data of graphic.geometry.graphicsData) {
              batch.graphic.geometry.graphicsData.push(cloneGeometryData(data, graphic.position));
            }
          }
          batch.graphic.geometry.invalidate();
          batch.signature = signature;
        }
        const order = members[0].graphic.zIndex;
        if (batch.graphic.zIndex !== order) reordered = true;
        batch.graphic.zIndex = order;
        seen.add(key);
        members = [];
      };
      for (let path = this._drawFirst; path; path = path.next) {
        const layer = path.layer;
        const id = L.stamp(layer);
        const graphic = this._graphics.get(id);
        if (!graphic || !graphic.visible || !graphic.geometry.graphicsData.length) continue;
        if (layer._displayEditing || layer._displaySelected) {
          flush();
          graphic.renderable = true;
          continue;
        }
        const nextBucket = Math.floor(id / this.options.geometryBatchSize);
        if (bucket !== nextBucket || group !== layer._glayer || members.length >= this.options.geometryBatchSize) flush();
        bucket = nextBucket;
        group = layer._glayer;
        graphic.renderable = false;
        members.push({ id, graphic });
      }
      flush();
      for (const [key, batch] of this._geometryBatches) {
        if (!seen.has(key)) {
          batch.graphic.destroy();
          this._geometryBatches.delete(key);
        }
      }
      if (reordered) this._stage.sortChildren();
    },

    _initPath(layer) {
      L.Canvas.prototype._initPath.call(this, layer);
      this._layerOrderDirty = true;
    },

    _sortLayerOrder() {
      if (!this._layerOrderDirty) return;
      const paths = [];
      for (let path = this._drawFirst; path; path = path.next) paths.push(path);
      paths.sort((first, second) => (first.layer._glayer?.order ?? 0) - (second.layer._glayer?.order ?? 0));
      paths.forEach((path, index) => {
        path.prev = paths[index - 1] || null;
        path.next = paths[index + 1] || null;
        const graphic = this._graphics?.get(L.stamp(path.layer));
        if (graphic) graphic.zIndex = index;
      });
      this._drawFirst = paths[0] || null;
      this._drawLast = paths.at(-1) || null;
      this._stage?.sortChildren();
      this._layerOrderDirty = false;
    },

    _draw() {
      if (!this._gpu) {
        this._sortLayerOrder();
        return L.Canvas.prototype._draw.call(this);
      }
      if (this._gpu.context.isLost) return;
      this._drawing = true;
      try {
        for (const layer of this._dirty) layer._updatePath();
        this._dirty.clear();
        this._sortLayerOrder();
        this._syncGeometryBatches();
        this._gpu.render(this._stage);
      } finally {
        this._drawing = false;
      }
    },

    _graphic(layer) {
      const id = L.stamp(layer);
      let graphic = this._graphics.get(id);
      if (!graphic) {
        graphic = new PIXI.Graphics();
        this._graphics.set(id, graphic);
        this._stage.addChild(graphic);
      }
      graphic.position.set(0, 0);
      graphic._geometryVersion = (graphic._geometryVersion || 0) + 1;
      graphic.clear();
      const style = layer.options;
      graphic.lineStyle({
        width: style.stroke === false ? 0 : style.weight,
        color: color(style.color), alpha: style.opacity,
        cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND,
      });
      if (style.fill) graphic.beginFill(color(style.fillColor || style.color), style.fillOpacity);
      return graphic;
    },

    _updatePoly(layer, closed) {
      if (!this._gpu) return L.Canvas.prototype._updatePoly.call(this, layer, closed);
      if (!this._drawing) { this._dirty.add(layer); return; }
      if (closed) this._restoreRetained(layer);
      if (closed && this._polygonRings.get(layer) === layer._rings) {
        const cached = this._graphics.get(L.stamp(layer));
        if (cached) {
          cached.visible = layer._parts.length > 0;
          return;
        }
      }
      const graphic = this._graphic(layer);
      graphic.visible = layer._parts.length > 0;
      if (!graphic.visible) return;
      if (closed) {
        let index = 0;
        for (const polygon of polygonGroups(layer._latlngs)) {
          polygon.forEach((ring, hole) => {
            const points = layer._rings[index++];
            if (hole) graphic.beginHole();
            graphic.drawPolygon(points.flatMap(point => [point.x, point.y]));
            if (hole) graphic.endHole();
          });
        }
      } else {
        for (const part of layer._parts) {
          part.forEach((point, index) => {
            if (index) graphic.lineTo(point.x, point.y);
            else graphic.moveTo(point.x, point.y);
          });
        }
      }
      graphic.endFill();
      if (closed) this._polygonRings.set(layer, layer._rings);
    },

    _updateCircle(layer) {
      if (!this._gpu) return L.Canvas.prototype._updateCircle.call(this, layer);
      if (!this._drawing) { this._dirty.add(layer); return; }
      const state = this._circleState.get(layer);
      const cached = this._graphics.get(L.stamp(layer));
      if (cached && state && state.x === layer._point.x && state.y === layer._point.y &&
        state.radius === layer._radius && state.radiusY === layer._radiusY) {
        cached.visible = !layer._empty();
        return;
      }
      this._circleState.delete(layer);
      const graphic = this._graphic(layer);
      graphic.visible = !layer._empty();
      if (!graphic.visible) return;
      graphic.drawEllipse(layer._point.x, layer._point.y,
        Math.max(Math.round(layer._radius), 1), Math.max(Math.round(layer._radiusY || layer._radius), 1));
      graphic.endFill();
      this._circleState.set(layer, { x: layer._point.x, y: layer._point.y, radius: layer._radius, radiusY: layer._radiusY });
    },

    _updateStyle(layer) {
      this._dropRetained(L.stamp(layer));
      if (!this._layers?.[L.stamp(layer)]) return;
      if (this._gpu) {
        this._polygonRings.delete(layer);
        this._circleState.delete(layer);
        this._dirty.add(layer);
      }
      L.Canvas.prototype._updateStyle.call(this, layer);
    },

    _removePath(layer) {
      if (this._gpu) {
        const id = L.stamp(layer);
        const graphic = this._graphics.get(id);
        const vertices = layer._rings?.reduce((count, ring) => count + ring.length, 0) || 0;
        if (graphic && layer instanceof L.Polygon && this._polygonRings.has(layer) &&
          vertices > 0 && vertices <= this.options.geometryCacheVertices && this.options.geometryCacheSize > 0) {
          this._stage.removeChild(graphic);
          graphic.visible = false;
          this._retained.set(id, { layer, graphic, vertices, coordinates: layer._latlngs,
            zoom: this._map.getZoom(), origin: this._map.getPixelOrigin().add([graphic.position.x, graphic.position.y]) });
          this._retainedVertices += vertices;
          while (this._retained.size > this.options.geometryCacheSize || this._retainedVertices > this.options.geometryCacheVertices) {
            this._dropRetained(this._retained.keys().next().value);
          }
        } else graphic?.destroy();
        this._dirty.delete(layer);
        this._polygonRings.delete(layer);
        this._circleState.delete(layer);
        this._graphics.delete(id);
      }
      L.Canvas.prototype._removePath.call(this, layer);
    },

    _bringToFront(layer) {
      L.Canvas.prototype._bringToFront.call(this, layer);
      this._layerOrderDirty = true;
      const graphic = this._graphics?.get(L.stamp(layer));
      if (graphic) this._stage.setChildIndex(graphic, this._stage.children.length - 1);
    },

    _bringToBack(layer) {
      L.Canvas.prototype._bringToBack.call(this, layer);
      this._layerOrderDirty = true;
      const graphic = this._graphics?.get(L.stamp(layer));
      if (graphic) this._stage.setChildIndex(graphic, 0);
    },
  });
})();