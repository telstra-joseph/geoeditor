# Geo Editor

A browser-based editor for geospatial files. Load shapefiles, KML, KMZ or GeoJSON, edit shapes and attribute data on a map, then export the result — including QGIS-ready shapefiles with customisable, toggleable symbol styles.

Everything runs locally in your browser. No data is uploaded to a server, and there is no build step.

See [FLOWCHART.md](./FLOWCHART.md) for diagrams of how the app works.

## Features

### Import
- Zipped shapefiles (`.zip`), loose `.shp` / `.shx` / `.dbf` / `.prj` / `.cpg` files, `.kml`, `.kmz`, `.geojson` and `.json`.
- Upload with the **Upload** button or drag and drop files anywhere on the page.
- Multiple files and multiple layers per file are supported.
- Multi-part geometry collections are split into separate features; features without geometry are skipped, with a notice.
- Coordinates must be longitude/latitude (WGS84). A shapefile in a projected CRS needs its `.prj` file included.

### Map and layers
- Leaflet map with OpenStreetMap, satellite and blank basemaps.
- Layer list with show/hide, colour, rename, zoom-to-layer, per-layer download and delete.
- Draw points, lines, rectangles and polygons, and edit, drag, cut or remove shapes with the toolbar.
- New shapes go into the active layer. Create empty layers with **New layer**.

### Attribute table
- Edit cells directly; edits are validated against each column's type (text, number, true/false).
- Click a column name to rename it or change its type; use the adjacent sort button to sort ascending or descending; add or delete columns. **Undo** reverses recent cell edits and field changes.
- Filter rows, page through large layers (200 rows per page), and zoom to or delete individual features.
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
Choose a format with **Download as**, then download the active layer or all layers.
When a feature is selected in the active layer, choose one of its attribute columns to use its value as the export filename.

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

## Running the app

The app is static HTML, CSS and JavaScript, and all libraries are bundled in `lib/`. Serve the folder with any static web server and open it in a browser. For example, with Python installed:

```powershell
python -m http.server 8765
```

Then open <http://localhost:8765/index.html>.

An internet connection is only needed for the basemap tiles (OpenStreetMap and Esri imagery).

**Important:** layers exist only in the open browser tab. Refreshing or closing the page loses them, so download your work first. The page warns before you leave while layers are loaded.

### Sample data
The [samples/](./samples) folder contains `sample.kml`, `sample.kmz` and `parks.zip` (a shapefile) for trying the app.

## Tests

Open `tests/shapefile-writer.test.html` through the local server. It runs in the browser and lists PASS or FAIL for each check of the shapefile writer, QGIS style generation and editing, style import validation, and legend ordering.

## Project structure

| Path | Purpose |
| --- | --- |
| [index.html](./index.html) | Page layout, dialogs and help text |
| [css/style.css](./css/style.css) | Styling |
| [js/app.js](./js/app.js) | Application logic: layers, map, table, import, bulk delete, export dialog |
| [js/shapefile-writer.js](./js/shapefile-writer.js) | Writes SHP, SHX, DBF, PRJ and CPG files and builds the category `.qml` |
| [js/qgis-style.js](./js/qgis-style.js) | Reads, validates, merges and edits QGIS `.qml` symbol styles |
| [tests/shapefile-writer.test.html](./tests/shapefile-writer.test.html) | Browser-based tests |
| [samples/](./samples) | Example input files |
| [lib/](./lib) | Bundled third-party libraries |

## Libraries
- [Leaflet](https://leafletjs.com/) — map display
- [Leaflet-Geoman](https://geoman.io/leaflet-geoman) — drawing and editing tools
- [shp.js](https://github.com/calvinmetcalf/shapefile-js) — shapefile reading
- [toGeoJSON](https://github.com/mapbox/togeojson) — KML conversion
- [JSZip](https://stuk.github.io/jszip/) — zip reading and writing

## Limitations
- No undo, and no saved projects; work lives only in the open tab.
- Shapefile export is always WGS84 (EPSG:4326).
- Very large files are limited by browser memory.
- The QGIS style output has been checked by the app's tests but not against every QGIS version; if QGIS rejects a style, load it manually or recreate the styling in QGIS.
