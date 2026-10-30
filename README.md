# Geo Editor

**Version 3.0 | October 2026**

A browser-based editor for geospatial files. Load shapefiles, KML, KMZ or GeoJSON, edit shapes and attribute data on a map, then export the result — including QGIS-ready shapefiles with customisable, toggleable symbol styles.

Imported files and edits are processed locally in your browser, not uploaded to a server. There is no build step. Basemap tiles and the Doto heading font are fetched from external services.

See [FLOWCHART.md](./FLOWCHART.md) for diagrams of how the app works.

## Features

### Import
- Zipped shapefiles (`.zip`), loose `.shp` / `.shx` / `.dbf` / `.prj` / `.cpg` files, `.kml`, `.kmz`, `.geojson` and `.json`.
- Choose **New layer → Upload layer**, click or tap the empty map's import prompt, or drag and drop files anywhere on the page.
- Multiple files and multiple layers per file are supported.
- Every upload, including small files selected through **New layer → Upload layer**, immediately shows a dotted loading bar with a file count ("1 file" or "1 of 2 files") and the current filename. Layer construction checks its time budget after each feature and yields about every 8ms so the browser can repaint and handle **Cancel**, rather than waiting for a fixed-size batch. **Cancel** stops the remaining files in that import and removes layers from the unfinished file, while keeping existing layers and files already completed. Active file reads are aborted and background workers are terminated; fallback processing stops at its next cancellation checkpoint. A single complex feature or synchronous parsing step must finish before the browser can handle a click.
- When served over HTTP/HTTPS, large files, all KML files, ZIP/KMZ archives and loose shapefile components use a background Web Worker for reading, decompression, XML/GeoJSON/shapefile parsing, coordinate projection and feature preparation. KML conversion runs entirely in the worker using locally bundled xmldom 0.9.8 and toGeoJSON. Transfers are limited to 1,000 features at a time. Leaflet geometry construction stays on the main thread and checks its 8ms yield budget after each feature. Full display sampling and editing-group setup wait until construction finishes. Small JSON files and browsers without worker support retain the local path. Cancel is visibly disabled during non-interruptible local parsing, preparation and finalization, with a paint opportunity before work starts; it remains available for file reads, worker processing and time-sliced construction.
- Import worker URLs include their protocol version, and startup checks compatibility before sending files. An incompatible cached worker is terminated and the import falls back locally rather than exchanging unsupported messages.
- Multi-part geometry collections are split into separate features; features without geometry are skipped, with a notice.
- Coordinates must be longitude/latitude (WGS84). A shapefile in a projected CRS needs its `.prj` file included.
- KML/KMZ folders appear as nested, collapsible groups under their imported layer, with feature counts, visibility checkboxes and zoom controls. Collapsed descendants load on expansion rather than building every folder control during import. Counts and source visibility are retained, including initially hidden folders. Nested, duplicate-name and empty folders are retained; hiding a folder does not delete its editable features.
- Named KML point placemarks display permanent text labels, including letters and numbers over polygons. Single-character polygon names and polygons with an explicit label style also display labels. KML label colour, opacity and scale are honoured; zero-scale labels stay hidden. Single-character points and zero-scale icons use text rather than a replacement dot, even when an icon is specified. Other explicit icons retain their colour, opacity and scale as point symbols, not external icon images. Labels follow geometry edits.
- Clicking a feature or its map name opens its attributes and a readable description when present. Plain-text line breaks and sanitized HTML formatting, tables and links are supported, including structured KML descriptions. Scripts, embedded content and unsafe links are removed from the display without changing stored data. The description source remains editable in a collapsible multiline field. DOMPurify is bundled locally; no CDN is required.
- At displayed metric scales of 5 km and 10 km, all eligible in-view geometry is retained without display sampling, while individual letter/number labels stay hidden. Explicit KML feature/folder visibility and zero-scale labels/icons are still respected; crowded four-character site names retain collision avoidance.
- Single-character letters and numbers appear at displayed metric scales of 1 km or closer. Explicit KML text points with zero-scale icons retain their source positions without requiring a large polygon; compact text shrinks toward 6 pixels at wider scales while respecting label scale, opacity and intentional hiding. Colliding letters or letters overlapping site names are temporarily suppressed rather than drawn over one another. Other point labels must fit inside the bounds of a displayed polygon in the same layer, with regular-weight text capped at 12 pixels and 18% of the polygon's smaller dimension; labels below 8 pixels, outside the bounds or too close to an edge remain hidden. Undersized overlapping polygons do not suppress a label when a larger nearby polygon qualifies. Folder-grouped labels follow the same scale and visibility rules. Associated dots stay suppressed without changing the source KML style.
- Four-character site names resize with map scale: compact regular text of roughly 7-10 pixels in overview views, increasing to the original 14 pixels in close-up views. Sizes are rounded to tenths of a pixel to avoid rebuilding text for insignificant scale changes during pans. A thin black outline on the letters and a transparent background remain. Labels try positions above, right, left and below their small site dot, avoiding other site names and the sidebar/table area. Unchanged label content is reused, and measurements are batched before placement updates to reduce layout work. Crowded names are temporarily suppressed rather than overlapped; selecting a site gives its label priority. All site features remain editable and exportable.

### Map and layers
Drag a layer's grip handle to change its drawing order; the top layer in the list draws on top. Focus the handle and use Arrow Up/Down to reorder with the keyboard. Ordering is retained through selection, visibility changes and map refreshes, without changing feature data. Reordering moves existing sidebar rows without rescanning feature collections or rebuilding folder controls. Drag previews use cached geometry and at most one update per animation frame; hidden-layer moves do not redraw the map unless displayed-layer stacking changes.
- Leaflet map with OpenStreetMap, satellite and blank basemaps.
- Press the basemap button to open its options; press it again, press Escape, or click the map to dismiss them. Enter and Space also toggle the options.
- Modal focus indicators are off by default without removing focus or keyboard navigation. Enable **Show modal focus indicators** in About to restore them; the preference is remembered in this browser. Keyboard focus indicators outside dialogs are unchanged.
- Automatic WebGL rendering through PixiJS for layer points, lines and polygons, with retained geometry between updates. Same-zoom pans reuse unchanged projected polygon geometry; zooms, coordinate edits and style changes rebuild it without changing source coordinates. Canvas is used automatically if WebGL is unavailable; Leaflet's native SVG guides preserve drawing-tool interactions.
- Large layers have per-layer display limits: 1,000 units at zoom 0-5, 2,000 at 6-8, 10,000 at 9-14, and 20,000 above 14. For layers with folders, each feature-bearing folder counts as one unit, including its nested contents; container-only folders are traversed to reach their child groups. Polygons, lines and points in a chosen folder that intersect the uncovered map area are rendered together, so folders can contain more features than the numeric limit. Ungrouped features each count as one unit. Layers without folders retain feature-based sampling, prioritizing polygons before lines and points.
- Same-zoom folder sampling retains eligible displayed groups before filling available slots, avoiding wholesale replacement during small pans or spatial-query reordering. Selected and edited groups keep priority; zoom changes choose a fresh sample. The 5 km and 10 km full-detail behavior is unchanged.
- Geometry entirely outside the uncovered map area, including behind the sidebar or attribute table, is deferred even when the layer is below its display limit. Panning, zooming, panel resizing/collapse and viewport changes refresh the display. Partially intersecting geometries remain intact; deferred members appear when uncovered. Selecting or editing an eligible feature prioritizes its folder without forcing covered geometry to render. Folder and feature visibility are respected, and label zoom/collision rules still apply. Sampling does not remove data from the editable layer or exports; the attribute table continues to follow its group and text filters.
- Layers with at least 2,000 features use a retained RBush 3.0.1 spatial index in a background worker for viewport searches. Compact feature bounds are uploaded only when the index changes; pan/zoom queries return ordered feature indices. Small layers retain their immediate local path. Edits invalidate the index, stale results are ignored, and hiding/removing layers releases cached worker data. Folder selection, label placement and Leaflet updates stay on the main thread. Blocked workers use the same local spatial index.
- Large display refreshes share a cooperative 12ms animation-frame budget for candidate preparation, folder selection, label indexing/placement and feature updates. Cheap work yields in batches of 64 steps rather than once per feature; potentially expensive DOM/feature updates retain immediate checkpoints. This reduces scheduling overhead and redraw opportunities while preserving cancellation. The previous displayed count also triggers budgeting when panning into an empty view. Pan/zoom starts, new refreshes, geometry changes and layer hiding cancel obsolete work; small displays remain synchronous. Individual operations can exceed the budget, and geometry drawing itself is not time-sliced.
- The initial view frames Australia in the uncovered map area. Layer, feature and import zooms account for the sidebar and table panel too.
- Layer list with show/hide, colour, rename, zoom-to-layer, analysis, per-layer download and delete. Drag grips, folder chevrons and folder zoom controls remain unboxed on hover, with keyboard focus and mobile hit targets preserved.
- Colour swatches open an animated selector with live updates and a hex input. Press the same swatch again, click outside or press Escape to close it. Animations respect reduced-motion preferences.
- Collapse or expand the Layers panel to make more room for the map. Resize the attribute table with the divider above it.
- Panel drags update size at most once per animation frame. Full geometry sampling and label placement wait until release, cancellation or focus loss, then refresh for the final uncovered map area instead of repeatedly scanning loaded layers during the drag.
- At viewport widths of 1200px and up, drag the Layers panel's right edge to resize it, with a 330px minimum and at least 480px left for the workspace. Double-click the edge to fit the longest layer name; exceptionally long names wrap instead of being clipped. The focused resize edge also supports Left/Right, Home for minimum width, and End for auto-fit. The chosen width is included in saved sessions.
- Folder chevrons and zoom controls are unboxed glyphs, retaining their accessible names, keyboard focus rings and desktop/mobile click targets.
- Draw points, lines, rectangles and polygons, and edit, drag, cut or remove shapes with the toolbar.
- New shapes go into the active layer. Choose **New layer → Blank layer** to set a name, geometry type and starting fields.
- In compact and mobile layouts, double-tap the current drawing or editing tool to open or close its group. A single tap activates the current tool; choosing another tool closes the group and moves that tool into the compact slot. Additional controls slide and fade open, then contract when dismissed. Reduced-motion mode makes these changes immediate. Pinch to zoom; the desktop zoom buttons are hidden.
- The map scale moves to suit the uncovered area and stays readable over either theme.

### Polygon masks
- Choose the mask-glyph **Mask layer** action on the target layer. Draw a polygon, use the currently selected polygon, or choose another layer; all polygons in that layer are combined into one mask, including hidden features.
- Enter an output layer name. Drawing a mask does not add it to the target layer; cancel the drawing tool to abandon it.
- **Retain inside mask** with **Keep whole original features** is the default: features intersecting or touching the mask are copied without changing their geometry, attributes, styles or folder membership. **Exclude inside mask** instead keeps whole features disjoint from the mask. The original target and mask layers are unchanged.
- **Visible folders and features** is the default source scope, so checking only the NSW root folder processes its visible descendants without including other regions. This includes eligible features outside the current map viewport or display sample; table text filters are not applied. Choose **All stored features** to include hidden folders and features too.
- Choose **Clip geometry at mask boundary** explicitly to trim lines/polygons or filter multipart geometry instead of retaining whole features. Polygon holes and boundary geometry are supported.
- Attributes, field types, styles and KML folder membership are retained. Only folders containing surviving elements and their ancestor folders are kept, preserving hierarchy and folder settings. KML and KMZ exports retain that nested structure, folder names/visibility, supported icon/label styles and full coordinate precision; GeoJSON and tabular formats do not represent KML folders.
- Processing shows progress and supports cancellation before creating the copy. An empty intersection creates no layer. Filtering and clipping use locally bundled Turf.js 7.2.0 and require no external geometry service.
- Over HTTP/HTTPS, mask union, filtering and clipping run in a background worker. Cancel terminates the worker without creating a partial output layer. Browsers without worker support retain the time-sliced main-thread path.

### Layer analysis
- Choose **Analyze layer** to check every stored feature, including hidden and unsampled geometry. A cancellable worker computes coordinate/geometry validity, polygon self-intersections, geometry counts, polygon area in square metres, line length in metres, bounds, and numeric attribute counts/minimums/maximums/means. Source data is not changed or repaired.
- The results dialog previews the summary, the first 50 numeric fields and the first 20 issues. **Download report** includes all numeric fields and up to 1,000 issues; the report flags truncation. These checks use Turf.js and are not a full GIS topology certification.
- Cancellation terminates the worker. If workers cannot start, the same analysis runs locally with time-sliced progress; an individual complex geometry calculation can still block briefly in fallback mode.

### Saved session
- Choose **Session → Save current session** to save one browser-local snapshot. **Replace saved session** overwrites that same snapshot; there are no additional slots or saved versions.
- Refreshing or reopening the app at the same site address automatically restores the last saved snapshot. **Session → Restore saved session** can also replace the current workspace after confirmation.
- The snapshot retains all layer features, edited geometry and attributes, styles, layer order/visibility, KML folders, active/selected features, table filter/sort/page and column widths, map center/zoom/basemap, theme, and panel layout. Undo history and unfinished drawing operations are not saved.
- **Delete saved session** removes only the stored copy, not the current workspace. Saves are manual; changes made after saving are not included until you replace the snapshot.
- Storage uses IndexedDB on this browser and device, without uploading data. Browser storage limits, private browsing and clearing site data can remove or prevent saved sessions. Failed writes leave the previous snapshot intact. Download exports for portable backups.
- Session serialization, DEFLATE compression, decompression/JSON parsing, and pre-restore schema/geometry checks run in workers. Feature extraction and Leaflet reconstruction are time-sliced on the main thread. New snapshots use a compressed archive in the same single IndexedDB slot; existing uncompressed snapshots still load. Failed compression preserves the previous save, and failed restore validation leaves the open workspace unchanged. Worker startup failures use the shared local implementations.

### Attribute table
- Edit cells directly; edits are validated against each column's type (text, number, true/false).
- Click a column name to rename it or change its type; use the adjacent sort button to sort ascending or descending; add or delete columns. **Undo** reverses recent cell edits and field changes.
- Drag a column edge to resize it, double-click it to fit its contents, or focus the resize handle and use the arrow keys. Widths are remembered per layer for the current session.
- Filter rows with the desktop search field. On mobile, open the filter dialog; **Apply** updates the search, **Cancel** preserves it, and **Clear filter** immediately restores all rows. Clear filter appears only when there is something to clear.
- Layers with at least 2,000 features use a background worker when text filtering, sorting, or folder filtering is active. Only attribute data and folder membership are sent; ordered row indices come back for rendering. New queries and layer changes cancel obsolete work, preventing stale results from replacing the current table. Smaller tables stay synchronous to avoid worker startup overhead.
- Page through large layers (200 rows per page), with feature counts showing the filtered and total number of rows.
- Each row includes a geometry thumbnail and controls to zoom to, download or delete that feature.
- Selecting a row highlights the feature on the map, and clicking a feature selects its row.

### Bulk delete
Delete many features at once using a condition on one column. The dialog previews how many features will be deleted and remain, then asks for confirmation.

Supported conditions:
- is not any of these values (keep listed values)
- is any of these values
- contains / does not contain any of these texts
- is empty / is not empty

Example: to keep only New South Wales and the ACT, choose column `STE_NAME21`, condition *is not any of these values*, and enter `New South Wales` and `Australian Capital Territory` on separate lines.

Notes:
- It applies to the whole active layer, not just the filtered rows or current page.
- Text matching is case-sensitive; numbers and true/false are compared as their column type.
- Deletions **cannot be undone** — download a backup first.

### Export
Choose **Download**, select **Active layer** or **All layers**, then choose a format. Download is unavailable until a layer exists.
When a feature is selected in the active layer, choose one of its attribute columns to use its value as the export filename.
To export just one feature, use its row's download icon. It uses the current format and the clicked feature's filename values, with the usual column and style options for shapefiles. Other features and the current selection are unchanged. The layer-list download icon also reuses the current format.

| Format | Output |
| --- | --- |
| Shapefile (`.zip`) | `.shp`, `.shx`, `.dbf`, `.prj` (WGS84), `.cpg`, plus an optional `.qml` style |
| KML | `.kml` with layer colours |
| KMZ | `.kmz` |
| GeoJSON | `.geojson` |
| CSV | `.csv` with attribute columns and one row per feature |

Shapefile limits: mixed layers are split into one shapefile per geometry type (`_points`, `_lines`, `_polygons`); column names are limited to 10 ASCII characters; text values to 254 bytes.

Export workers generate shapefile binaries, category styles, CSV, KML and GeoJSON, and compress KMZ/ZIP archives. Binary results are transferred back without another buffer copy. Options, Leaflet geometry snapshots, edited QGIS XML merging and the final browser download remain on the main thread. Unsupported or startup-blocked workers fall back to local processing. Workers are created on demand and terminated after completion, cancellation or failure, rather than kept in a permanent pool.

### Shapefile export options
Choosing **Shapefile (.zip)** opens an options dialog for each exported layer:

- **Columns to export** — tick the attribute columns to include. With none selected, a generated `ID` column is written.
- **QGIS toggle categories by column** — pick a column (such as `STE_NAME21`) and the export includes a QGIS `.qml` style with one category per unique value. In QGIS, expand the layer in the Layers panel to switch each category on or off.
- **Symbol styles** — edit each category's symbol: point shape and size, line style and width, polygon fill pattern, outline, colours, opacity, plus its legend label and whether it is shown initially. Previews are schematic and sizes are in millimetres.
- **Bulk style editing** — change many categories at once from the **Bulk edit categories** panel (shown when a category column is selected and there is more than one category):
  1. Filter the list (for example `Canberra`) and tick categories, or use **Select shown** / **Clear selection**.
  2. Tick the properties to change. Only ticked properties are applied. Changing a control ticks its property automatically.
  3. Press **Apply to selected**.

  Editable in bulk: point shape and size, fill colour, fill pattern, outline colour, width and style, line colour, width and style, symbol opacity, and whether the category is shown initially. Fill/line colour can be **one colour**, **distinct colours** (a palette cycled across the selected categories) or a **gradient** between two colours. Gradients and distinct colours follow the selected categories' order in the list, which is the legend order, so sort the legend first if you want an ordered gradient. Existing colour transparency is kept.

  **Copy the whole symbol from** a chosen category copies its full appearance to the selected categories, without changing their labels or visibility. **Undo last bulk change** reverses the most recent bulk change; it can be pressed repeatedly. All values are checked before anything changes, so an invalid value changes nothing and shows a message.
- **Import a `.qml` style** — reuse the symbols from an existing QGIS style, or download the edited style on its own.
- **Legend order** — sort the categories in the QGIS legend ascending or descending by any column, for example `SA2_NAME21`. The sort column does not need to be exported.

Style editing covers simple single-symbol and categorized renderers with one simple marker, line or fill layer per symbol, in millimetres. Rule-based renderers, SVG or multi-layer symbols, data-defined properties and other layer settings (such as labelling) are not edited or imported; the app explains when it rejects a style.

Legend ordering changes only the legend. It does not change the map's drawing order or the order of records in the shapefile.

#### Using the export in QGIS
1. Extract the downloaded ZIP.
2. Keep each `.qml` beside its matching `.shp`.
3. Open the `.shp` in QGIS. The style loads automatically when the files share a name.
4. If it does not, open **Layer Properties → Symbology → Style → Load Style** and select the `.qml`.
5. Expand the layer in the Layers panel and tick or untick categories.

### Interface and help
- Light and dark themes with a remembered preference, compact tooltips, and responsive icon-only controls when space is limited.
- Import, masking and session progress share the same dotted bar, typography and theme-aware styling. Session operations show indeterminate progress until a total is known; import and mask cancellation remain available. Reduced motion stops the indeterminate animation, and forced-colors mode uses native progress bars.
- Animated panel changes, radio selection and notifications respect reduced-motion preferences. Radio buttons and layer checkboxes retain native controls in forced-colors mode.
- Delete actions use red states; the help button uses a yellow hover state. Enabled header, Layers and table-bar buttons have a subtle shadow in light mode or glow in dark mode.
- Open **How to edit** with the Layers panel's question-mark button for a short guide to the main tasks.
- The browser tab uses the title **Geo Editor** and an Australia-facing globe as its favicon.

## Running the app

The app is static HTML, CSS and JavaScript, with its JavaScript libraries bundled in `lib/`. Open [index.html](./index.html) directly in a modern browser, or serve the folder with any static web server. For example, with Python installed:

```powershell
python -m http.server 8765
```

Then open <http://localhost:8765/index.html>.

Use the local server or an HTTP/HTTPS deployment to enable background import workers. Opening the HTML directly with `file://`, or a worker startup failure, automatically uses main-thread imports instead.

An internet connection is needed for basemap tiles (OpenStreetMap and Esri imagery) and the Doto heading font from Google Fonts. The app uses a bundled fallback font if Doto is unavailable. The blank basemap does not request map tiles.

**Important:** layers exist only in the open browser tab. Refreshing or closing the page loses them, so download your work first. The page warns before you leave while layers are loaded.

### Sample data
The [samples/](./samples) folder contains `sample.kml`, `sample.kmz` and `parks.zip` (a shapefile) for trying the app.

## Tests

Open `tests/shapefile-writer.test.html` through the local server. It runs in the browser and lists PASS or FAIL for each check of the shapefile writer, QGIS style generation and editing, style import validation, and legend ordering.

Open [tests/gpu-renderer.test.html](./tests/gpu-renderer.test.html) for rendering checks: visible pixels, polygon holes, multi-polygons, geometry caching, style and coordinate updates, undisplayed-feature cleanup, draw order, batched additions, zoom/pan, Canvas fallback and drawing-tool click handling. GPU-only checks are marked SKIP when WebGL is unavailable.

Open [tests/import-worker.test.html](./tests/import-worker.test.html) through the local server for import and display checks: preparation parity, bounded transfers and acknowledgment, GeoJSON, KML styles and text labels, nested folder controls and visibility, zoom-level display caps, viewport sampling, selection, full export counts, KMZ, zipped/loose shapefiles, multiple collections and invalid input.

The same suite also checks masking/export/table worker output parity, actual downloads with edited QGIS symbols, archive filenames, missing or blocked worker fallback, error cleanup, cancellation, and stale large-table query rejection. Additional checks cover worker-side KML conversion, lazy expansion of large folder trees, cached spatial queries and index cleanup, geometry analysis reports and downloads, compressed and legacy sessions, validation failures, and shared progress states. Label assertions bring their target geometry into the viewport before checking its rendered tooltip.

### Rendering measurements

Measured on 2026-10-30 in the integrated Chromium browser with a 1024 x 768 viewport, WebGL, the original 126,586-feature NSW/ACT KML and NSW folders enabled. After warming each Sydney view, five alternating 24-pixel horizontal pans were measured with temporary function timers. Import and initial spatial-index construction were excluded. These are median instrumented CPU times per pan, not GPU completion times, FPS or end-to-end interaction latency; nested stages must not be added together.

| Metric | Before | Geometry reuse and stable folder sampling |
| --- | ---: | ---: |
| Renderer, 500 m | 82 ms | 28 ms |
| Renderer, 1 km | 142 ms | 49 ms |
| Renderer, 10 km | 508 ms | 146 ms |
| Renderer, 20 km | 445 ms | 51 ms |
| Display refresh, 20 km | 615 ms | 81 ms |

The 500 m, 1 km and 10 km views retained the same displayed feature counts. At 20 km, stable sampling reduced median per-pan feature additions/removals from thousands to zero in this sequence. These measurements precede the frame-budgeting pass below. Timings depend on hardware, viewport, geometry and pan distance. Profiling instrumentation is not included in the application.

The subsequent frame-budgeting pass was checked with the same file, viewport and five short pans at 20 km. The median longest display-work slice was 9.2ms (11.4ms worst observed), compared with the earlier approximately 81ms monolithic refresh. Median total display CPU increased to 167ms across 21 slices. This trades throughput and completion latency for more opportunities to process input between chunks; it is not an FPS or total-latency improvement. Large initial label population can still be slow, and GPU draws remain outside this budget. Geometry batching is the next overview-rendering priority; label layout remains relevant in dense close-up views.

A later throughput comparison used the same original file at the browser's actual 2032 x 1249 viewport, 20 km scale and five alternating 24-pixel pans. Batched checkpoints and the 12ms budget reduced median settled completion time from 401ms to 316ms (21%), slices from 15 to 9, display CPU from 115ms to 106ms and renderer CPU from 43ms to 31ms. Both versions displayed 10,000 features. Settled completion includes an identical 80ms idle confirmation, not just drawing. Median longest slices increased from 8.5ms to 12.1ms; the largest updated slice observed was 12.3ms. This is a hardware-dependent throughput/responsiveness balance, not an FPS guarantee.

## Project structure

| Path | Purpose |
| --- | --- |
| [index.html](./index.html) | Page layout, dialogs and help text |
| [css/style.css](./css/style.css) | Styling |
| [js/app.js](./js/app.js) | Application logic: layers, map, table, import, bulk delete, export dialog |
| [js/gpu-renderer.js](./js/gpu-renderer.js) | WebGL drawing backend with Leaflet interactions and automatic Canvas fallback |
| [js/import-core.js](./js/import-core.js) | Shared feature normalization, field inference and coordinate validation |
| [js/import-worker.js](./js/import-worker.js) | Background import processing with acknowledged feature batches |
| [js/background-tasks.js](./js/background-tasks.js) | Worker startup, fallback, cancellation and cleanup for processing jobs |
| [js/processing-worker.js](./js/processing-worker.js) | Background masking, export generation/compression, and table queries |
| [js/layer-mask.js](./js/layer-mask.js) | Shared mask union and geometry clipping for workers and local fallback |
| [js/export-core.js](./js/export-core.js) | Shared export serialization, shapefile generation and archive compression |
| [js/table-core.js](./js/table-core.js) | Shared folder/text filtering and stable attribute sorting |
| [js/shapefile-writer.js](./js/shapefile-writer.js) | Writes SHP, SHX, DBF, PRJ and CPG files and builds the category `.qml` |
| [js/qgis-style.js](./js/qgis-style.js) | Reads, validates, merges and edits QGIS `.qml` symbol styles |
| [tests/shapefile-writer.test.html](./tests/shapefile-writer.test.html) | Browser-based tests |
| [tests/gpu-renderer.test.html](./tests/gpu-renderer.test.html) | GPU rendering and fallback regression tests |
| [tests/import-worker.test.html](./tests/import-worker.test.html) | Worker import and batching regression tests |
| [samples/](./samples) | Example input files |
| [lib/](./lib) | Bundled third-party libraries |

## Libraries
- [Leaflet](https://leafletjs.com/) — map display
- [PixiJS 7.4.3](https://pixijs.com/) - bundled WebGL geometry rendering
- [Leaflet-Geoman](https://geoman.io/leaflet-geoman) — drawing and editing tools
- [shp.js](https://github.com/calvinmetcalf/shapefile-js) — shapefile reading
- [toGeoJSON](https://github.com/mapbox/togeojson) — KML conversion
- [JSZip](https://stuk.github.io/jszip/) — zip reading and writing
- [Lucide](https://lucide.dev/) - interface icons
- [vanilla-colorful 0.7.2](https://github.com/web-padawan/vanilla-colorful) - bundled colour selector; [MIT licence](./lib/vanilla-colorful.LICENSE)
- [Doto](https://fonts.google.com/specimen/Doto) - heading font served by Google Fonts; Geist is bundled locally for the interface

## Limitations
- Undo covers table cell and field changes, not drawing, geometry changes or feature/layer deletions. Bulk deletion cannot be undone.
- Session saving is manual and limited to one browser-local snapshot; there are no portable project files or automatic saving of later edits.
- Shapefile export is always WGS84 (EPSG:4326).
- Very large files are limited by browser memory. Import and processing workers still hold data in memory, and transferring geometry or attributes has a cost. Every editable feature still needs a Leaflet object on the main thread; geometry snapshots, layer construction and DOM updates can still take time. Workers offload CPU calculations, not the whole interface or unlimited-size streaming.
- Zoom limits reduce displayed feature counts, not the vertex count of an individual complex geometry. Features outside the display sample cannot be clicked on the map; select them in the attribute table to reveal them.
- KML text labels use Leaflet overlays rather than WebGL, so very dense label sets can still affect performance. Arbitrary KML image icons and advanced label placement are not reproduced.
- WebGL accelerates drawing, not file parsing, coordinate projection or attribute processing. Hardware acceleration depends on browser settings and graphics-driver support; browsers may use software WebGL. Canvas fallback preserves functionality but not GPU rendering performance.
- The QGIS style output has been checked by the app's tests but not against every QGIS version; if QGIS rejects a style, load it manually or recreate the styling in QGIS.
