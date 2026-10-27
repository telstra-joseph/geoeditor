# Geo Editor flowcharts

**Version 1.0 | October 2026**

Diagrams of how Geo Editor works. They use [Mermaid](https://mermaid.js.org/), which GitHub and VS Code (with a Mermaid extension) render automatically.

See [README.md](./README.md) for the feature descriptions.

## 1. Overall architecture

Imported files and edits are processed in the browser. External requests fetch basemap tiles and the heading font, not uploaded file contents.

```mermaid
flowchart LR
    User(["User"])

    subgraph Browser["Browser tab"]
        UI["index.html and style.css<br/>responsive toolbar, collapsible sidebar,<br/>map, table, help and About dialogs"]
        App["app.js<br/>layers, import, table, undo,<br/>filtering, bulk delete, export"]
        Writer["shapefile-writer.js<br/>SHP, SHX, DBF, PRJ, CPG, category QML"]
        Style["qgis-style.js<br/>read, validate, merge, edit QML"]
        State[("In-memory layers, selection,<br/>table state and undo history<br/>lost on refresh")]
    end

    Libs["lib/<br/>Leaflet, Geoman, shp.js,<br/>toGeoJSON, JSZip, Lucide"]
    Tiles["Basemap tile servers<br/>OpenStreetMap, Esri"]
    Fonts["Google Fonts<br/>Doto heading font"]
    Files[("Local files")]

    User --> UI
    UI --> App
    App <--> State
    App --> Writer
    App --> Style
    Writer --> Style
    App --> Libs
    Libs -.-> Tiles
    UI -.-> Fonts
    Files -->|"upload or drag and drop"| App
    App -->|"download"| Files
```

## 2. Importing files

```mermaid
flowchart TD
    Start(["New layer"]) --> Source{"Blank or upload?"}
    Source -->|"blank"| Blank["Choose name, geometry type<br/>and starting fields"]
    Blank --> Active["Create and activate an empty layer"]
    Source -->|"upload"| Picker["Choose local files"]
    Import(["Empty-map import prompt<br/>or drag and drop"]) --> Picker
    Picker --> B{"File type?"}

    B -->|".geojson or .json"| C["Parse JSON into features"]
    B -->|".kml"| D["Parse XML and convert with toGeoJSON"]
    B -->|".kmz or .zip"| E["Open archive with JSZip"]
    B -->|"loose .shp .shx .dbf .prj .cpg"| F["Bundle the parts into a zip"]
    B -->|"other"| X["Show unsupported file error"]

    E --> G{"Contains a .shp?"}
    G -->|"yes, .zip"| H["Read shapefile with shp.js"]
    G -->|"no"| I{"Contains a .kml?"}
    I -->|"yes"| D
    I -->|"no"| X2["Show no usable data error"]

    F --> J{"Includes a .shp?"}
    J -->|"yes"| H
    J -->|"no"| X3["Ask for the .shp or a zip"]

    C --> K["Prepare features"]
    D --> K
    H --> K

    K --> L["Split geometry collections<br/>skip features without geometry<br/>detect column types"]
    L --> M{"Coordinates look like<br/>longitude and latitude?"}
    M -->|"no"| X4["Show projected CRS error<br/>include the .prj file"]
    M -->|"yes"| N["Create layer, add to map,<br/>assign colour"]
    N --> O["Make it active, fit all loaded layers<br/>inside the uncovered map area,<br/>show attribute table"]
```

## 3. Editing

```mermaid
flowchart TD
    Layer[("Active layer")]

    subgraph Map["Map tools"]
        Hold["Mobile: hold the current tool<br/>to reveal its group"]
        Draw["Draw point, line,<br/>rectangle, polygon"]
        Edit["Edit, drag, cut,<br/>remove shapes"]
        Click["Click a feature"]
    end

    subgraph Table["Attribute table"]
        Cell["Edit a cell"]
        Cols["Add, rename, retype,<br/>delete columns"]
        Rows["Filter, sort, page, resize columns,<br/>zoom to or select a row"]
        Delete["Delete a feature"]
        Undo["Undo recent cell<br/>and field changes"]
    end

    Hold --> Draw
    Hold --> Edit
    Draw --> Layer
    Edit --> Layer
    Click -->|"selects row and opens popup"| Table
    Cell --> V{"Valid for the<br/>column type?"}
    V -->|"yes"| Layer
    V -->|"no"| E["Show error and restore the old value"]
    Cols --> Layer
    V -->|"yes"| History["Record table undo action"]
    Cols --> History
    History --> Undo
    Undo --> Layer
    Rows --> R
    Rows -->|"select or zoom"| Focus["Highlight map feature<br/>fit into uncovered map area"]
    Delete -->|"cannot undo"| Layer
    Layer --> R["Refresh layer list,<br/>map and table"]
```

## 4. Bulk delete

```mermaid
flowchart TD
    A(["Click Bulk delete"]) --> B["Choose a column"]
    B --> C["Choose a condition<br/>not in, in, contains,<br/>not contains, empty, not empty"]
    C --> NeedsValues{"Condition needs values?"}
    NeedsValues -->|"yes"| D["Enter values, one per line"]
    NeedsValues -->|"empty or not empty"| G
    D --> E{"Values valid for<br/>the column type?"}
    E -->|"no"| F["Show message and<br/>disable Review"]
    F --> D
    E -->|"yes"| G["Preview across the whole layer:<br/>N deleted, M remain"]
    G --> H{"Any matches?"}
    H -->|"no"| F
    H -->|"yes"| I["Click Review deletion"]
    I --> J{"Confirm deleting N features?"}
    J -->|"cancel"| K(["Nothing changes"])
    J -->|"confirm"| L["Remove features from<br/>map and table"]
    L --> M(["Layer counts and table refresh<br/>cannot be undone"])
```

## 5. Shapefile export

```mermaid
flowchart TD
    A(["Choose Shapefile in Download,<br/>or use a layer/feature download icon<br/>with Shapefile as the current format"]) --> B["For each exported layer with features,<br/>open the options dialog"]
    B --> C["Choose columns to export"]
    C --> D{"Category column<br/>selected?"}

    D -->|"no"| E["One symbol per geometry type<br/>optional single style"]
    D -->|"yes"| F["Category column is always exported<br/>one category per unique value"]

    F --> G{"Legend order?"}
    G -->|"original"| H["Keep first seen order"]
    G -->|"ascending or descending"| I["Sort categories by the chosen column<br/>smallest non-empty value per category<br/>empty values last"]

    E --> J["Edit symbols<br/>shape, size, colour, line, fill, opacity,<br/>label, initial visibility"]
    H --> J
    I --> J

    J --> BK{"Change many categories at once?"}
    BK -->|"yes"| BL["Bulk edit panel<br/>filter and tick categories,<br/>tick properties to apply"]
    BL --> BM{"Apply, copy symbol,<br/>or undo?"}
    BM -->|"values invalid"| BN["Show message<br/>nothing changes"]
    BN --> BL
    BM -->|"valid"| BO["Update only the selected categories<br/>one colour, distinct colours or gradient<br/>keeps transparency, labels and visibility"]
    BO --> J
    BK -->|"no"| K{"Import a .qml style?"}
    K -->|"yes"| L{"Supported and matching?"}
    L -->|"no"| M["Show reason<br/>keep current styles"]
    M --> J
    L -->|"yes"| N["Copy symbol appearance<br/>and category labels"]
    N --> J
    K -->|"no"| O{"Export or download style only?"}

    O -->|"download style only"| P(["Save the .qml file"])
    O -->|"export"| Q{"More layers?"}
    Q -->|"yes"| B
    Q -->|"cancel in any dialog"| R(["Nothing is downloaded"])
    Q -->|"no"| S["Write files for each layer"]

    S --> T["Split by geometry type<br/>build DBF, SHP, SHX, PRJ, CPG,<br/>and QML when styled"]
    T --> U["Zip everything with JSZip"]
    U --> V(["Download the ZIP"])
```

## 6. Using the export in QGIS

```mermaid
flowchart LR
    A["Extract the ZIP"] --> B["Keep each .qml beside<br/>its matching .shp"]
    B --> C["Open the .shp in QGIS"]
    C --> D{"Style loaded<br/>automatically?"}
    D -->|"yes"| F
    D -->|"no"| E["Layer Properties, Symbology,<br/>Style, Load Style, choose the .qml"]
    E --> F["Expand the layer in<br/>the Layers panel"]
    F --> G(["Tick or untick categories<br/>to show or hide features"])
```

## 7. Download workflow and other formats

```mermaid
flowchart TD
    A(["Download button<br/>enabled when layers exist"]) --> Scope["Choose Active layer or All layers"]
    Scope --> Format["Choose export format"]
    Format --> Name{"Selected feature<br/>has attributes?"}
    Row(["Feature download icon"]) --> Single["Export only the clicked feature<br/>use the current format"]
    Single --> Name
    Layer(["Layer download icon"]) --> Current["Export that layer<br/>use the current format"]
    Current --> Name
    Name -->|"yes"| Filename["Choose an attribute value<br/>or layer name as filename"]
    Filename --> B{"Format?"}
    Name -->|"no"| B
    B -->|"Shapefile"| C["Options dialog and ZIP export<br/>see Shapefile export"]
    B -->|"KML"| D["Build one KML document<br/>with layer colours"]
    B -->|"KMZ"| E["Build KML and compress as doc.kml"]
    B -->|"GeoJSON"| F["Write a FeatureCollection<br/>with all attributes"]
    B -->|"CSV"| CSV["Write attribute columns<br/>and one row per feature"]
    D --> G{"One file or several?"}
    E --> G
    F --> G
    CSV --> G
    G -->|"one"| H(["Download the file"])
    G -->|"several"| I["Bundle in a ZIP"] --> J(["Download the ZIP"])
```

Cancelling any export dialog stops the download without changing layers or the current selection. Per-feature exports use the clicked feature for filename values; all other features remain untouched.

## 8. Filtering rows

```mermaid
flowchart TD
    Desktop(["Desktop search field"]) --> Apply["Update filter and reset page"]
    Mobile(["Mobile filter button"]) --> Dialog["Filter rows dialog<br/>current filter prefilled"]
    Dialog --> Draft["Edit search text<br/>show Clear filter only when needed"]
    Draft --> Action{"Action?"}
    Action -->|"Apply"| Apply
    Action -->|"Clear filter"| Clear["Clear and apply immediately<br/>close the dialog"]
    Action -->|"Cancel"| Keep(["Keep the existing filter"])
    Apply --> Render["Refresh rows and filtered/total counts<br/>update active-filter indicator"]
    Clear --> Render
    Render --> Note["Filtering does not delete features<br/>bulk deletion still uses the whole layer"]
```

## 9. Responsive interface, help and About

```mermaid
flowchart TD
    Start(["Open Geo Editor"]) --> Map["Frame Australia in the uncovered map area<br/>adjust scale placement to available space"]
    Start --> Layout{"Available space?"}
    Layout -->|"wide"| Wide["Labelled header/table actions<br/>full map toolbars and zoom buttons"]
    Layout -->|"compact or mobile"| Compact["Icon-only actions where needed<br/>mobile tools open with a hold<br/>mobile filter dialog and pinch zoom"]
    Sidebar(["Layers toggle"]) --> Panels["Animate collapse or expansion<br/>keep help accessible"]
    Help(["Question-mark button"]) --> Guide["Short editing guide<br/>warn about deletions and unsaved work"]
    Title(["Geo Editor heading"]) --> About["About dialog<br/>Australia-facing globe and app heading<br/>Imagined by Joseph Malicdem<br/>Version 1.0 / October 2026"]
    About --> Feedback["Send feedback<br/>open email draft to<br/>joseph.malicdem@team.telstra.com<br/>subject: Geo Editor Feedback"]
    About --> Close["Close button or Escape<br/>return focus to heading"]
```

Theme preference is remembered. Tooltips, radio selection, filter-clear reveals and notifications use the current theme and respect reduced-motion preferences where motion is used. Work remains in memory until downloaded; the About dialog does not send email automatically.
