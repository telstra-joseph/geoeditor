(() => {
  'use strict';

  class SessionStore {
    constructor(name = 'geoeditor-sessions') {
      this.name = name;
    }

    transact(mode, action) {
      return new Promise((resolve, reject) => {
        const opening = indexedDB.open(this.name, 1);
        opening.onupgradeneeded = () => opening.result.createObjectStore('sessions');
        opening.onerror = () => reject(opening.error);
        opening.onblocked = () => reject(new Error('Session storage is blocked by another tab.'));
        opening.onsuccess = () => {
          const database = opening.result;
          database.onversionchange = () => database.close();
          try {
            const transaction = database.transaction('sessions', mode);
            const request = action(transaction.objectStore('sessions'));
            transaction.oncomplete = () => {
              database.close();
              resolve(request.result ?? null);
            };
            transaction.onabort = () => {
              database.close();
              reject(transaction.error || request.error || new Error('Session storage was interrupted.'));
            };
          } catch (error) {
            database.close();
            reject(error);
          }
        };
      });
    }

    async save(session) {
      const packed = await BackgroundTasks.run('session', { operation: 'pack', session }, { fallback: () => SessionCore.pack(session) });
      return this.transact('readwrite', store => store.put(packed, 'current'));
    }

    async load() {
      const stored = await this.transact('readonly', store => store.get('current'));
      if (stored?.geoEditorEncoding !== 'zip-v1') return stored;
      return BackgroundTasks.run('session', { operation: 'unpack', stored }, { fallback: () => SessionCore.unpack(stored) });
    }

    clear() {
      return this.transact('readwrite', store => store.delete('current'));
    }
  }

  window.SessionStore = SessionStore;
})();