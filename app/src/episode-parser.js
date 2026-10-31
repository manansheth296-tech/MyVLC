/* ---------- Series & Episode Parser ----------
   Detects TV shows, anime, seasons, episode numbers and titles from filenames and folders.
   Used for episode memory, continue watching, smart queues, and the series browser.
*/

window.EpisodeParser = (() => {
  function parse(fullPath) {
    if (!fullPath || /^[a-z]+:\/\//i.test(fullPath)) {
      return { isSeries: false, show: null, season: 1, episode: null, title: '' };
    }

    const norm = fullPath.replace(/\\/g, '/');
    const parts = norm.split('/').filter(Boolean);
    const fileName = parts[parts.length - 1] || '';
    const ext = (fileName.match(/\.[a-z0-9]{2,5}$/i) || [''])[0];
    const base = fileName.slice(0, fileName.length - ext.length);

    // Strip tags like [Erai-raws], [1080p], (2020), etc.
    let clean = base.replace(/\[[^\]]*\]/g, ' ').replace(/\((?!19\d\d|20\d\d)[^\)]*\)/g, ' ');
    clean = clean.replace(/[\._]/g, ' ').replace(/\s+/g, ' ').trim();

    let show = null, season = 1, episode = null, title = '';

    // 1. S01E04 pattern
    const sxxExx = clean.match(/^(.*?)(?:[ \.\-_]+)?s(\d{1,2})[ \.\-_]*e(\d{1,3})(?:[ \.\-_]+(.*?))?$/i);
    if (sxxExx) {
      show = sxxExx[1].trim();
      season = parseInt(sxxExx[2], 10);
      episode = parseInt(sxxExx[3], 10);
      title = cleanTitle(sxxExx[4]);
    }

    // 2. 1x04 pattern
    if (episode === null) {
      const nxn = clean.match(/^(.*?)(?:[ \.\-_]+)?(\d{1,2})x(\d{1,3})(?:[ \.\-_]+(.*?))?$/i);
      if (nxn) {
        show = nxn[1].trim();
        season = parseInt(nxn[2], 10);
        episode = parseInt(nxn[3], 10);
        title = cleanTitle(nxn[4]);
      }
    }

    // 3. Ep 04 / Episode 04 pattern
    if (episode === null) {
      const epMatch = clean.match(/^(.*?)(?:[ \.\-_]+)?(?:ep|episode)[ \.\-_]*(\d{1,4})(?:[ \.\-_]+(.*?))?$/i);
      if (epMatch) {
        show = epMatch[1].trim();
        episode = parseInt(epMatch[2], 10);
        title = cleanTitle(epMatch[3]);
      }
    }

    // 4. Show - 04 - Title pattern
    if (episode === null) {
      const dashMatch = clean.match(/^(.*?)[ \.\-_]+-[ \.\-_]+(\d{1,4})(?:[ \.\-_]+-[ \.\-_]+(.*?))?$/i);
      if (dashMatch) {
        show = dashMatch[1].trim();
        episode = parseInt(dashMatch[2], 10);
        title = cleanTitle(dashMatch[3]);
      }
    }

    // Folder hierarchy inspection
    const parentFolder = parts[parts.length - 2] || '';
    const grandParentFolder = parts[parts.length - 3] || '';

    const seasonFolderMatch = parentFolder.match(/(?:season|s)[ \.\-_]*(\d{1,2})/i);
    if (seasonFolderMatch) {
      season = parseInt(seasonFolderMatch[1], 10);
      if (!show && grandParentFolder && !isGenericFolder(grandParentFolder)) {
        show = grandParentFolder;
      }
    } else if (!show && parentFolder && !isGenericFolder(parentFolder)) {
      show = parentFolder;
    }

    // If episode is still not found, check if filename begins with an episode number (e.g. '03 - The Door of Hope')
    if (episode === null && seasonFolderMatch) {
      const numStart = clean.match(/^(\d{1,3})(?:[ \.\-_]+(.*))?$/);
      if (numStart) {
        episode = parseInt(numStart[1], 10);
        title = cleanTitle(numStart[2]);
      }
    }

    if (episode !== null) {
      if (!show && parentFolder && !isGenericFolder(parentFolder)) show = parentFolder;
      show = (show || 'Unknown Series').replace(/\s+/g, ' ').trim();
      const code = 'S' + String(season).padStart(2, '0') + 'E' + String(episode).padStart(2, '0');
      return {
        isSeries: true,
        show,
        season,
        episode,
        title: title || ('Episode ' + episode),
        code,
      };
    }

    return {
      isSeries: false,
      show: null,
      season: 1,
      episode: null,
      title: base,
      code: '',
    };
  }

  function cleanTitle(raw) {
    if (!raw) return '';
    return raw.replace(/\b(1080p|720p|2160p|4k|bluray|web-dl|webrip|dvdrip|x264|x265|hevc|aac|flac|repack)\b.*/i, '').trim();
  }

  function isGenericFolder(name) {
    const n = name.toLowerCase();
    return ['video', 'videos', 'movie', 'movies', 'download', 'downloads', 'media', 'files'].includes(n);
  }

  return {
    parse,
  };
})();
