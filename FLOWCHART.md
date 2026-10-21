# Geo Editor flowcharts

Diagrams of how Geo Editor works. They use [Mermaid](https://mermaid.js.org/), which GitHub and VS Code (with a Mermaid extension) render automatically.

See [README.md](./README.md) for the feature descriptions.

## 1. Overall architecture

All processing happens in the browser; nothing is sent to a server.

```mermaid
flowchart LR
    User(["User"])

    subgraph Browser["Browser tab"]
        UI["index.html and style.css<br/>toolbar, sidebar, map, table, dialogs"]
        App["app.js<br/>layers, import, table, bulk delete, export"]
        Writer["shapefile-writer.js<br/>SHP, SHX, DBF, PRJ, CPG, category QML"]
        Style["qgis-style.js<br/>read, validate, merge, edit QML"]
        State[("In-memory layers<br/>lost on refresh")]
    end

    Libs["lib/<br/>Leaflet, Geoman, shp.js, toGeoJSON, JSZip"]
    Tiles["Basemap tile servers<br/>OpenStreetMap, Esri"]
    Files[("Local files")]

    User --> UI
    UI --> App
    App <--> State
    App --> Writer
    App --> Style
    Writer --> Style
    App --> Libs
    Libs -.-> Tiles
    Files -->|"upload or drag and drop"| App
    App -->|"download"| Files
```

## 2. Importing files

```mermaid
flowchart TD
    A(["Upload button or drag and drop"]) --> B{"File type?"}

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
    N --> O["Make it active, fit the map,<br/>show attribute table"]
```

## 3. Editing

```mermaid
flowchart TD
    Layer[("Active layer")]

    subgraph Map["Map tools"]
        Draw["Draw point, line,<br/>rectangle, polygon"]
        Edit["Edit, drag, cut,<br/>remove shapes"]
        Click["Click a feature"]
    end

    subgraph Table["Attribute table"]
        Cell["Edit a cell"]
        Cols["Add, rename, retype,<br/>delete columns"]
        Rows["Filter, page, zoom to,<br/>delete a row"]
    end

    Draw --> Layer
    Edit --> Layer
    Click -->|"selects row and opens popup"| Table
    Cell --> V{"Valid for the<br/>column type?"}
    V -->|"yes"| Layer
    V -->|"no"| E["Show error and restore the old value"]
    Cols --> Layer
    Rows --> Layer
    Layer --> R["Refresh layer list,<br/>map and table"]
```

## 4. Bulk delete

```mermaid
flowchart TD
    A(["Click Bulk delete"]) --> B["Choose a column"]
    B --> C["Choose a condition<br/>not in, in, contains,<br/>not contains, empty, not empty"]
    C --> D["Enter values, one per line"]
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
    A(["Download as Shapefile<br/>then Active layer or All layers"]) --> B["For each layer with features,<br/>open the options dialog"]
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

    J --> K{"Import a .qml style?"}
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

## 7. Other export formats

```mermaid
flowchart TD
    A(["Choose a format and download"]) --> B{"Format?"}
    B -->|"Shapefile"| C["Options dialog, see Shapefile export"]
    B -->|"KML"| D["Build one KML document<br/>with layer colours"]
    B -->|"KMZ"| E["Build KML and compress as doc.kml"]
    B -->|"GeoJSON"| F["Write a FeatureCollection<br/>with all attributes"]
    D --> G{"One file or several?"}
    E --> G
    F --> G
    G -->|"one"| H(["Download the file"])
    G -->|"several"| I["Bundle in a ZIP"] --> J(["Download the ZIP"])
```
