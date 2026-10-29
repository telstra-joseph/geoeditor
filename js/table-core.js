(() => {
  'use strict';

  function query({ rows, fields, types, filter, sort, folders }) {
    const visibility = new Map(folders.map(folder => [folder.id, folder.visible]));
    const filterFolders = folders.some(folder => folder.visible);
    const text = filter.trim().toLowerCase();
    const matches = rows.filter(row => {
      const folderIds = row.folderIds || [];
      if (filterFolders && (!folderIds.length || !folderIds.every(id => visibility.get(id) !== false))) return false;
      return !text || fields.some(field => String(row.properties[field] ?? '').toLowerCase().includes(text));
    });
    if (sort && fields.includes(sort.field)) {
      const { field, direction } = sort;
      const type = types[field] || 'string';
      matches.sort((first, second) => {
        const firstValue = first.properties[field];
        const secondValue = second.properties[field];
        const firstEmpty = firstValue == null || firstValue === '';
        const secondEmpty = secondValue == null || secondValue === '';
        if (firstEmpty !== secondEmpty) return firstEmpty ? 1 : -1;
        if (firstEmpty) return first.index - second.index;
        let result;
        if (type === 'number') result = Number(firstValue) - Number(secondValue);
        else if (type === 'boolean') result = Number(Boolean(firstValue)) - Number(Boolean(secondValue));
        else result = String(firstValue).localeCompare(String(secondValue), undefined, { numeric: true, sensitivity: 'base' });
        return result ? result * (direction === 'asc' ? 1 : -1) : first.index - second.index;
      });
    }
    return matches.map(row => row.index);
  }

  globalThis.TableCore = { query };
})();