'use strict';

importScripts('../lib/jszip.js', '../lib/shp.js', 'import-core.js');

let acknowledge = null;
const baseName = name => name.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '');
const progress = fraction => postMessage({ type: 'progress', fraction });
const exchange = message => new Promise(resolve => {
  acknowledge = resolve;
  postMessage(message);
});

async function streamCollection(collection, name, format, index = 0, total = 1) {
  const prepared = ImportCore.prepare(collection, format);
  const { features, ...metadata } = prepared;
  if (!features.length) {
    postMessage({ type: 'warning', message: `"${name}" contains no features with geometry.`, kind: 'warn' });
    return;
  }
  if (!ImportCore.lonLatLooksValid(features)) {
    postMessage({ type: 'warning', message: `"${name}": coordinates are not longitude/latitude. A shapefile in a projected CRS needs its .prj file included.`, kind: 'error' });
    return;
  }
  await exchange({ type: 'layer', name, format, metadata: { ...metadata, count: features.length } });
  for (let offset = 0; offset < features.length; offset += 1000) {
    const end = Math.min(offset + 1000, features.length);
    await exchange({
      type: 'features', features: features.slice(offset, end),
      start: .55 + .4 * (index + offset / features.length) / total,
      end: .55 + .4 * (index + end / features.length) / total,
    });
  }
  await exchange({ type: 'layer-end' });
}

async function readShapefile(buffer, name) {
  progress(.35);
  const collections = [].concat(await shp(buffer));
  for (const [index, collection] of collections.entries()) {
    const layerName = collections.length > 1 && collection.fileName ? baseName(collection.fileName) : name;
    await streamCollection(collection, layerName, 'shp', index, collections.length);
  }
}

async function readKml(text, name, format) {
  const dom = new DOMParser({ onError(level) { if (level !== 'warning') throw new Error('Not a valid KML document.'); } }).parseFromString(text, 'text/xml');
  if (!dom.documentElement || dom.documentElement.localName !== 'kml') throw new Error('Not a valid KML document.');
  const collection = ImportCore.fromKml(dom, toGeoJSON);
  const document = dom.getElementsByTagName('Document')[0];
  const title = document && [...document.childNodes].find(node => node.localName === 'name');
  await streamCollection(collection, title?.textContent.trim() || name, format);
}

async function run(job) {
  if (job.files) {
    const source = job.files.find(file => /\.shp$/i.test(file.name));
    if (!source) throw new Error('Select the .shp file together with its .dbf and .prj, or upload a zip.');
    const zip = new JSZip();
    job.files.forEach(file => zip.file(file.name, file));
    const buffer = await zip.generateAsync({ type: 'arraybuffer' }, metadata => progress(.2 * metadata.percent / 100));
    await readShapefile(buffer, baseName(source.name));
    return;
  }
  const file = job.file;
  const name = baseName(file.name);
  const extension = file.name.split('.').pop().toLowerCase();
  if (extension === 'geojson' || extension === 'json') {
    const text = await file.text();
    progress(.3);
    const data = JSON.parse(text);
    const collection = data.type === 'FeatureCollection' ? data
      : data.type === 'Feature' ? { features: [data] }
        : { features: [{ type: 'Feature', properties: {}, geometry: data }] };
    progress(.5);
    await streamCollection(collection, name, 'geojson');
    return;
  }
  if (extension === 'kml') {
    await readKml(await file.text(), name, 'kml');
    return;
  }
  if (extension === 'kmz' || extension === 'zip') {
    const buffer = await file.arrayBuffer();
    progress(.25);
    const zip = await JSZip.loadAsync(buffer);
    const names = Object.keys(zip.files).filter(entry => !zip.files[entry].dir && !/(^|\/)__MACOSX\//.test(entry));
    if (extension === 'zip' && names.some(entry => /\.shp$/i.test(entry))) {
      await readShapefile(buffer, name);
      return;
    }
    const kmlName = names.find(entry => /(^|\/)doc\.kml$/i.test(entry)) || names.find(entry => /\.kml$/i.test(entry));
    if (!kmlName) throw new Error(extension === 'kmz' ? 'No .kml found inside the KMZ.' : 'No .shp (shapefile) or .kml found inside the zip.');
    const text = await zip.files[kmlName].async('string', metadata => progress(.3 + .2 * metadata.percent / 100));
    await readKml(text, name, extension === 'kmz' ? 'kmz' : 'kml');
    return;
  }
  throw new Error(`Unsupported file type ".${extension}".`);
}

self.onmessage = event => {
  if (event.data.type === 'ack') {
    const resolve = acknowledge;
    acknowledge = null;
    if (resolve) resolve(event.data.value);
  } else if (event.data.type === 'import') {
    run(event.data).then(
      () => postMessage({ type: 'done' }),
      error => postMessage({ type: 'error', message: error.message || String(error) })
    );
  }
};

import('../lib/xmldom.mjs').then(xml => {
  self.DOMParser = xml.DOMParser;
  self.XMLSerializer = xml.XMLSerializer;
  importScripts('../lib/togeojson.js');
  postMessage({ type: 'ready', protocol: 2 });
}).catch(error => { throw error; });