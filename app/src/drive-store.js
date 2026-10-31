/* ---------- Drive-Aware Storage for External Drives & Playback Memory ----------
   Maintains playback positions, watched states, and media folder mappings
   using drive fingerprints (volume serial numbers) rather than volatile drive letters.
   When an external drive moves from E: to F: or is unplugged, your memory remains safe.
*/

window.DriveStore = (() => {
  const STORAGE_KEY = 'vlcx-drive-store';
  const api = window.api;

  // Internal state
  const data = {
    volumes: {},    // { [volId]: { id, serial, label, lastRoot, lastSeen } }
    positions: {},  // { [volKey]: { pos, dur, volId, rel, src, name, updated } }
    watched: {},    // { [volKey]: { timestamp } }
    seriesMemory: {}, // { [showKey]: { lastWatchedEpisode, season, episode, timestamp } }
  };

  let onlineVolumes = []; // [{ root, id, serial, label }]
  const listeners = new Set();

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        Object.assign(data.volumes, parsed.volumes || {});
        Object.assign(data.positions, parsed.positions || {});
        Object.assign(data.watched, parsed.watched || {});
        Object.assign(data.seriesMemory, parsed.seriesMemory || {});
      }
    } catch (e) {
      console.warn('DriveStore: failed to load existing data', e);
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('DriveStore: failed to save data', e);
    }
  }

  function normPath(p) {
    if (!p) return '';
    return p.replace(/\\/g, '/');
  }

  // Find which volume an absolute path belongs to
  function matchVolume(absPath) {
    if (!absPath || /^[a-z]+:\/\//i.test(absPath)) return null;
    const clean = normPath(absPath);

    // 1. Try currently online volumes first
    for (const v of onlineVolumes) {
      const vRoot = normPath(v.root).toLowerCase();
      if (clean.toLowerCase().startsWith(vRoot)) {
        return { ...v, isOnline: true };
      }
    }

    // 2. Try known recorded volumes
    for (const id in data.volumes) {
      const v = data.volumes[id];
      if (v.lastRoot) {
        const vRoot = normPath(v.lastRoot).toLowerCase();
        if (clean.toLowerCase().startsWith(vRoot)) {
          const isOnline = onlineVolumes.some(o => o.id === v.id);
          return { ...v, root: v.lastRoot, isOnline };
        }
      }
    }

    // 3. Fallback for Windows drive letter e.g. "E:/"
    const m = /^[a-zA-Z]:[\\/]/.exec(absPath);
    if (m) {
      const letter = m[0][0].toUpperCase();
      const root = letter + ':\\';
      const isOnline = onlineVolumes.some(o => o.root.toUpperCase().startsWith(letter + ':'));
      return { id: 'VOL_DRIVE_' + letter, root, label: 'Drive ' + letter, serial: letter, isOnline };
    }

    return null;
  }

  // Key generator: returns { key, volId, rel, volLabel, isOnline }
  function resolveKey(absPath) {
    if (!absPath) return { key: '', volId: null, rel: '', volLabel: '', isOnline: false };
    const vol = matchVolume(absPath);
    if (vol) {
      const vRootNorm = normPath(vol.root).toLowerCase();
      const pNorm = normPath(absPath);
      let rel = pNorm;
      if (pNorm.toLowerCase().startsWith(vRootNorm)) {
        rel = pNorm.slice(vRootNorm.length).replace(/^\/+/, '');
      }
      return {
        key: vol.id + '::' + rel.toLowerCase(),
        volId: vol.id,
        rel,
        volLabel: vol.label || 'External Disk',
        root: vol.root,
        isOnline: !!vol.isOnline,
      };
    }
    return {
      key: 'LOCAL::' + normPath(absPath).toLowerCase(),
      volId: null,
      rel: absPath,
      volLabel: 'Local',
      root: '',
      isOnline: true,
    };
  }

  // Initialize drive list and listeners
  async function init() {
    load();
    if (api && api.listVolumes) {
      try {
        const vols = await api.listVolumes();
        updateOnlineVolumes(vols);
      } catch (e) {
        console.warn('DriveStore: could not list initial volumes', e);
      }
    }

    if (api && api.onDriveChange) {
      api.onDriveChange(d => {
        if (d && d.volumes) {
          updateOnlineVolumes(d.volumes);
        }
      });
    }

    // Migrate any legacy vlcx-pos or vlcx-watched if present
    migrateLegacy();
  }

  function updateOnlineVolumes(vols) {
    const prevRoots = new Map(onlineVolumes.map(v => [v.id, v.root]));
    onlineVolumes = vols || [];

    const changes = { remapped: [], added: [], removed: [] };

    // Register online volumes into persistent data
    for (const v of onlineVolumes) {
      const existing = data.volumes[v.id];
      if (existing) {
        if (existing.lastRoot && existing.lastRoot.toUpperCase() !== v.root.toUpperCase()) {
          changes.remapped.push({ id: v.id, label: v.label, oldRoot: existing.lastRoot, newRoot: v.root });
        }
        existing.lastRoot = v.root;
        existing.label = v.label;
        existing.lastSeen = Date.now();
      } else {
        data.volumes[v.id] = {
          id: v.id,
          serial: v.serial,
          label: v.label,
          lastRoot: v.root,
          lastSeen: Date.now(),
        };
        changes.added.push(v);
      }
    }

    save();

    if (changes.remapped.length > 0 || changes.added.length > 0) {
      for (const cb of listeners) {
        try { cb(changes); } catch (e) { console.error('DriveStore listener error', e); }
      }
    }
  }

  function migrateLegacy() {
    try {
      const oldPos = localStorage.getItem('vlcx-pos');
      if (oldPos) {
        const parsed = JSON.parse(oldPos);
        for (const src in parsed) {
          const t = parsed[src];
          if (t && typeof t === 'number') {
            const k = resolveKey(src);
            if (!data.positions[k.key]) {
              data.positions[k.key] = {
                pos: t,
                dur: 0,
                volId: k.volId,
                rel: k.rel,
                src,
                name: '',
                updated: Date.now(),
              };
            }
          }
        }
      }
      const oldWatched = localStorage.getItem('vlcx-watched');
      if (oldWatched) {
        const parsed = JSON.parse(oldWatched);
        if (Array.isArray(parsed)) {
          for (const src of parsed) {
            const k = resolveKey(src);
            if (!data.watched[k.key]) {
              data.watched[k.key] = { timestamp: Date.now() };
            }
          }
        }
      }
      save();
    } catch {}
  }

  // Re-map a path if its volume root changed (e.g. E:\... -> F:\...)
  function remapPath(oldPath) {
    if (!oldPath) return oldPath;
    const vol = matchVolume(oldPath);
    if (!vol) return oldPath;

    // Check if the volume is currently online at a different root
    const currentOnline = onlineVolumes.find(o => o.id === vol.id);
    if (currentOnline && currentOnline.root.toLowerCase() !== vol.root.toLowerCase()) {
      const rel = normPath(oldPath).slice(normPath(vol.root).length).replace(/^\/+/, '');
      const sep = currentOnline.root.includes('\\') ? '\\' : '/';
      return normPath(currentOnline.root).replace(/\/+$/, '') + sep + rel.replace(/\//g, sep);
    }
    return oldPath;
  }

  function getPos(absPath) {
    if (!absPath) return 0;
    const k = resolveKey(absPath);
    const rec = data.positions[k.key];
    if (rec && typeof rec.pos === 'number') return rec.pos;

    // Legacy fallback
    try {
      const oldPos = JSON.parse(localStorage.getItem('vlcx-pos') || '{}');
      if (oldPos[absPath]) return oldPos[absPath];
    } catch {}
    return 0;
  }

  function setPos(absPath, pos, dur = 0, name = '') {
    if (!absPath) return;
    const k = resolveKey(absPath);
    if (pos <= 0) {
      delete data.positions[k.key];
    } else {
      data.positions[k.key] = {
        pos: Math.floor(pos),
        dur: Math.floor(dur),
        volId: k.volId,
        rel: k.rel,
        src: absPath,
        name: name || '',
        updated: Date.now(),
      };
    }
    save();

    // Also sync legacy vlcx-pos object for full backward compatibility
    try {
      const legacy = JSON.parse(localStorage.getItem('vlcx-pos') || '{}');
      if (pos > 0) legacy[absPath] = Math.floor(pos);
      else delete legacy[absPath];
      localStorage.setItem('vlcx-pos', JSON.stringify(legacy));
    } catch {}
  }

  function isWatched(absPath) {
    if (!absPath) return false;
    const k = resolveKey(absPath);
    if (data.watched[k.key]) return true;

    // Legacy fallback
    try {
      const list = JSON.parse(localStorage.getItem('vlcx-watched') || '[]');
      if (Array.isArray(list) && list.includes(absPath)) return true;
    } catch {}
    return false;
  }

  function setWatched(absPath, watched = true) {
    if (!absPath) return;
    const k = resolveKey(absPath);
    if (watched) {
      data.watched[k.key] = { timestamp: Date.now() };
    } else {
      delete data.watched[k.key];
    }
    save();

    // Sync legacy
    try {
      let list = JSON.parse(localStorage.getItem('vlcx-watched') || '[]');
      if (!Array.isArray(list)) list = [];
      if (watched) {
        if (!list.includes(absPath)) list.push(absPath);
      } else {
        list = list.filter(s => s !== absPath);
      }
      localStorage.setItem('vlcx-watched', JSON.stringify(list));
    } catch {}
  }

  function isOffline(absPath) {
    if (!absPath || /^[a-z]+:\/\//i.test(absPath)) return false;
    const k = resolveKey(absPath);
    return !k.isOnline;
  }

  function clearAllPositions() {
    data.positions = {};
    save();
    try { localStorage.setItem('vlcx-pos', '{}'); } catch {}
  }

  function addChangeListener(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }

  return {
    init,
    resolveKey,
    getPos,
    setPos,
    isWatched,
    setWatched,
    isOffline,
    remapPath,
    matchVolume,
    clearAllPositions,
    addChangeListener,
    getOnlineVolumes: () => [...onlineVolumes],
    getData: () => data,
  };
})();
