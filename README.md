# Geo Editor

**Version 1.0 | October 2026**

A browser-based editor for geospatial files. Load shapefiles, KML, KMZ or GeoJSON, edit shapes and attribute data on a map, then export the result — including QGIS-ready shapefiles with customisable, toggleable symbol styles.

Imported files and edits are processed locally in your browser, not uploaded to a server. There is no build step. Basemap tiles and the Doto heading font are fetched from external services.

See [FLOWCHART.md](./FLOWCHART.md) for diagrams of how the app works.

## Features

### Import
- Zipped shapefiles (`.zip`), loose `.shp` / `.shx` / `.dbf` / `.prj` / `.cpg` files, `.kml`, `.kmz`, `.geojson` and `.json`.
- Choose **New layer → Upload layer**, click or tap the empty map's import prompt, or drag and drop files anywhere on the page.
- Multiple files and multiple layers per file are supported.
- Large files (at least 1 MB), or imports taking more than one second, show a dotted loading bar with a file count ("1 file" or "1 of 2 files") and the current filename. Features are added in batches so the browser can repaint progress. **Cancel** stops the remaining files in that import and removes layers from the unfinished file, while keeping existing layers and files already completed. Active file reads are aborted and background workers are terminated; fallback processing stops at its next cancellation checkpoint.
- When served over HTTP/HTTPS, large files, ZIP/KMZ archives and loose shapefile components use one background Web Worker for reading, decompression, GeoJSON/shapefile parsing, coordinate projection and feature preparation. Transfers are limited to 1,000 features at a time. Geometry is built in 100-feature batches, yielding after roughly 8 milliseconds or each transferred batch. Full display sampling and editing-group setup wait until construction finishes, avoiding repeated scans of a growing layer. KML XML conversion, Leaflet geometry construction and editing remain on the main thread. Small plain files and browsers without worker support use the existing import path.
- Multi-part geometry collections are split into separate features; features without geometry are skipped, with a notice.
- Coordinates must be longitude/latitude (WGS84). A shapefile in a projected CRS needs its `.prj` file included.
- KML/KMZ folders appear as nested, collapsible groups under their imported layer, with feature counts, visibility checkboxes and zoom controls. Nested, duplicate-name and empty folders are retained; hiding a folder does not delete its editable features.
- Named KML point placemarks display permanent text labels, including letters and numbers over polygons. Single-character polygon names and polygons with an explicit label style also display labels. KML label colour, opacity and scale are honoured; zero-scale labels stay hidden. Single-character point labels and zero-scale icons use text rather than a replacement dot. Labels follow geometry edits.
- Single-character letters and numbers appear only at zoom 10 or closer, when their polygon (or a nearby displayed polygon in the same layer) is at least 48 screen pixels across. Point labels must be inside or within 24 screen pixels of the polygon's bounds. These labels use regular-weight text capped at 12 pixels and 18% of the polygon's smaller dimension; unreadably small labels remain hidden.
- Four-character site names use consistent 14-pixel regular text with a thin black outline on the letters and a transparent background. Labels try positions above, right, left and below their small site dot, avoiding other site names and the sidebar/table area. Unchanged label content is reused, and measurements are batched before placement updates to reduce layout work. Crowded names are temporarily suppressed rather than overlapped; selecting a site gives its label priority. All site features remain editable and exportable.

### Map and layers
- Leaflet map with OpenStreetMap, satellite and blank basemaps.
- Automatic WebGL rendering through PixiJS for layer points, lines and polygons, with retained geometry between updates. Canvas is used automatically if WebGL is unavailable; Leaflet's native SVG guides preserve drawing-tool interactions.
- Large layers have per-layer display limits: 1,000 features at zoom 0-5, 2,000 at 6-8, 10,000 at 9-14, and 20,000 above 14. Layers exceeding the current limit show a deterministic sample within the map viewport, refreshed after panning or zooming. Selected and actively dragged features take priority within the same budget; remaining slots go to polygons before lines and points. KML labels follow their displayed features, and folder visibility is respected. All features remain in the attribute table and exports; these limits do not delete data.
- Site-style KML/KMZ layers with four-character site-code folders preserve complete sector-polygon groups around isolated sites first, when those groups fit the remaining display budget. A site is isolated when no other visible site is within 96 screen pixels, so prioritisation adapts with zoom. Dense areas use the remaining slots; generic layers keep their usual sampling. Geometry and export data are unchanged.
- The initial view frames Australia in the uncovered map area. Layer, feature and import zooms account for the sidebar and table panel too.
- Layer list with show/hide, colour, rename, zoom-to-layer, per-layer download and delete.
- Collapse or expand the Layers panel to make more room for the map. Resize the attribute table with the divider above it.
- Draw points, lines, rectangles and polygons, and edit, drag, cut or remove shapes with the toolbar.
- New shapes go into the active layer. Choose **New layer → Blank layer** to set a name, geometry type and starting fields.
- On mobile, hold the current drawing or editing tool to reveal the other tools in its group. Pinch to zoom; the desktop zoom buttons are hidden.
- The map scale moves to suit the uncovered area and stays readable over either theme.

### Attribute table
- Edit cells directly; edits are validated against each column's type (text, number, true/false).
- Click a column name to rename it or change its type; use the adjacent sort button to sort ascending or descending; add or delete columns. **Undo** reverses recent cell edits and field changes.
- Drag a column edge to resize it, double-click it to fit its contents, or focus the resize handle and use the arrow keys. Widths are remembered per layer for the current session.
- Filter rows with the desktop search field. On mobile, open the filter dialog; **Apply** updates the search, **Cancel** preserves it, and **Clear filter** immediately restores all rows. Clear filter appears only when there is something to clear.
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

### Interface, help and feedback
- Light and dark themes with a remembered preference, compact tooltips, and responsive icon-only controls when space is limited.
- Animated panel changes, radio selection and notifications respect reduced-motion preferences. Radio buttons and layer checkboxes retain native controls in forced-colors mode.
- Delete actions use red states; the help button uses a yellow hover state. Enabled header, Layers and table-bar buttons have a subtle shadow in light mode or glow in dark mode.
- Open **How to edit** with the Layers panel's question-mark button for a short guide to the main tasks.
- Click **Geo Editor** in the header to open About: Australia-facing globe, "Imagineered by Joseph Malicdem", Version 1.0, and October 2026. Close with the top-right button or Escape.
- **Send feedback** opens an email draft to `joseph.malicdem@team.telstra.com` with subject **Geo Editor Feedback**; it does not send automatically.
- The browser tab uses the title **Geo Editor** and the same Australia-facing globe as its favicon.

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

## Project structure

| Path | Purpose |
| --- | --- |
| [index.html](./index.html) | Page layout, dialogs and help text |
| [css/style.css](./css/style.css) | Styling |
| [js/app.js](./js/app.js) | Application logic: layers, map, table, import, bulk delete, export dialog |
| [js/gpu-renderer.js](./js/gpu-renderer.js) | WebGL drawing backend with Leaflet interactions and automatic Canvas fallback |
| [js/import-core.js](./js/import-core.js) | Shared feature normalization, field inference and coordinate validation |
| [js/import-worker.js](./js/import-worker.js) | Background import processing with acknowledged feature batches |
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
- [Doto](https://fonts.google.com/specimen/Doto) - heading font served by Google Fonts; Geist is bundled locally for the interface

## Limitations
- Undo covers table cell and field changes, not drawing, geometry changes or feature/layer deletions. Bulk deletion cannot be undone.
- No saved projects or automatic persistence; work lives only in the open tab.
- Shapefile export is always WGS84 (EPSG:4326).
- Very large files are limited by browser memory. A worker still holds a parsed collection in memory, and every editable feature still needs a Leaflet object on the main thread. This is one background CPU worker, not a multi-core renderer or an unlimited-size streaming parser.
- Zoom limits reduce displayed feature counts, not the vertex count of an individual complex geometry. Features outside the display sample cannot be clicked on the map; select them in the attribute table to reveal them.
- KML text labels use Leaflet overlays rather than WebGL, so very dense label sets can still affect performance. Arbitrary KML image icons and advanced label placement are not reproduced.
- WebGL accelerates drawing, not file parsing, coordinate projection or attribute processing. Hardware acceleration depends on browser settings and graphics-driver support; browsers may use software WebGL. Canvas fallback preserves functionality but not GPU rendering performance.
- The QGIS style output has been checked by the app's tests but not against every QGIS version; if QGIS rejects a style, load it manually or recreate the styling in QGIS.
