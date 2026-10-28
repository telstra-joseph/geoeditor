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

  L.GpuCanvas = L.Canvas.extend({
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
      this._graphics = new Map();
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
      L.Util.cancelAnimFrame(this._redrawRequest);
      L.DomEvent.off(this._container);
      L.DomUtil.remove(this._container);
      this._stage.destroy({ children: true });
      this._graphics.clear();
      this._dirty.clear();
      this._gpu.destroy(true);
      delete this._stage;
      delete this._graphics;
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

    _clear() {
      if (!this._gpu) L.Canvas.prototype._clear.call(this);
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
    },

    _updateCircle(layer) {
      if (!this._gpu) return L.Canvas.prototype._updateCircle.call(this, layer);
      if (!this._drawing) { this._dirty.add(layer); return; }
      const graphic = this._graphic(layer);
      graphic.visible = !layer._empty();
      if (!graphic.visible) return;
      graphic.drawEllipse(layer._point.x, layer._point.y,
        Math.max(Math.round(layer._radius), 1), Math.max(Math.round(layer._radiusY || layer._radius), 1));
      graphic.endFill();
    },

    _updateStyle(layer) {
      if (!this._layers?.[L.stamp(layer)]) return;
      if (this._gpu) this._dirty.add(layer);
      L.Canvas.prototype._updateStyle.call(this, layer);
    },

    _removePath(layer) {
      if (this._gpu) {
        this._dirty.delete(layer);
        this._graphics.get(L.stamp(layer))?.destroy();
        this._graphics.delete(L.stamp(layer));
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