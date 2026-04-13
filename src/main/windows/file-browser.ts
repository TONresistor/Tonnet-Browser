/**
 * TON Storage file browser page generator.
 * Produces an HTML string for browsing bag contents when no index.html exists.
 */

// Build-time constants: lottie player + loading animation baked by electron-vite
declare const __LOTTIE_PLAYER_JS__: string
declare const __LOADING_ANIMATION_JSON__: object

// --- XSS sanitization ---

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// --- File type detection ---

type FileCategory = 'video' | 'audio' | 'image' | 'document' | 'archive' | 'code' | 'text' | 'folder' | 'other'

const EXT_MAP: Record<string, FileCategory> = {}
const categories: Record<FileCategory, string[]> = {
  video: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'ts'],
  audio: ['mp3', 'flac', 'ogg', 'wav', 'aac', 'wma', 'm4a', 'opus'],
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico'],
  document: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'zst'],
  code: [
    'js',
    'ts',
    'py',
    'go',
    'rs',
    'c',
    'cpp',
    'h',
    'java',
    'html',
    'css',
    'json',
    'xml',
    'yaml',
    'toml',
    'md',
    'sh',
  ],
  text: ['txt', 'log', 'csv', 'ini', 'cfg', 'conf'],
  folder: [],
  other: [],
}
for (const [cat, exts] of Object.entries(categories)) {
  for (const ext of exts) {
    EXT_MAP[ext] = cat as FileCategory
  }
}

function getFileCategory(name: string): FileCategory {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return EXT_MAP[ext] || 'other'
}

// --- Inline SVG icons ---

const ICONS: Record<FileCategory, string> = {
  video:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#708499" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/><line x1="17" y1="17" x2="22" y2="17"/></svg>',
  audio:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#708499" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
  image:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#708499" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
  document:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#708499" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
  archive:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#708499" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
  code: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#708499" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  text: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#708499" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
  folder:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#708499" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  other:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#708499" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>',
}

// --- Page generators ---

/**
 * Generate the loading page shown while resolving storage bag.
 */
export function generateLoadingPage(domain: string): string {
  const safeDomain = escapeHtml(domain)
  const animJson = JSON.stringify(__LOADING_ANIMATION_JSON__)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Loading ${safeDomain}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: #17212b;
      color: #f5f5f5;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px;
    }
    .container {
      max-width: 480px;
      text-align: center;
      background: rgba(255, 255, 255, 0.07);
      backdrop-filter: blur(12px) saturate(1.4);
      -webkit-backdrop-filter: blur(12px) saturate(1.4);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 20px;
      padding: 40px 32px 32px;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.08);
    }
    .lottie-wrapper {
      width: 180px;
      height: 180px;
      margin: 0 auto 24px;
    }
    h1 {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 8px;
      color: #f5f5f5;
    }
    .subtitle {
      font-size: 14px;
      color: #708499;
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <div class="container">
    <div id="lottie" class="lottie-wrapper"></div>
    <h1>Loading ${safeDomain}</h1>
    <p class="subtitle">Resolving storage bag from the TON network...</p>
  </div>
  <script>${__LOTTIE_PLAYER_JS__}</script>
  <script>
    try {
      lottie.loadAnimation({
        container: document.getElementById('lottie'),
        renderer: 'svg',
        loop: true,
        autoplay: true,
        animationData: ${animJson}
      });
    } catch(e) {}
  </script>
</body>
</html>`
}

/**
 * Generate a file browser page for a TON Storage bag.
 */
export function generateFileBrowserPage(
  domain: string,
  bagId: string,
  files: Array<{ name: string; size: number }>,
  currentPath: string = '/',
  basePath?: string
): string {
  const safeDomain = escapeHtml(domain)
  const safeBagId = escapeHtml(bagId)
  const truncatedBag =
    bagId.length > 16 ? `${escapeHtml(bagId.slice(0, 8))}...${escapeHtml(bagId.slice(-8))}` : safeBagId

  // Build folder structure: detect virtual directories from file paths
  // Serialize files and icons as JSON for the client-side JS to render
  const filesJson = JSON.stringify(
    files.map((f) => ({
      name: f.name,
      size: f.size,
      category: getFileCategory(f.name),
    }))
  )

  const iconsJson = JSON.stringify(ICONS)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeDomain} - File Browser</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: #17212b;
      color: #f5f5f5;
      min-height: 100vh;
      padding: 24px;
    }
    .card {
      max-width: 860px;
      margin: 0 auto;
      background: rgba(255, 255, 255, 0.07);
      backdrop-filter: blur(12px) saturate(1.4);
      -webkit-backdrop-filter: blur(12px) saturate(1.4);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 20px;
      padding: 28px 24px 20px;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.08);
    }
    .header {
      margin-bottom: 20px;
    }
    .header h1 {
      font-size: 20px;
      font-weight: 600;
      color: #f5f5f5;
      margin-bottom: 4px;
    }
    .header .meta {
      font-size: 12px;
      color: #708499;
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
    }
    .header .meta .bag-id {
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 11px;
      background: rgba(255, 255, 255, 0.06);
      padding: 2px 8px;
      border-radius: 6px;
    }
    .breadcrumb {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 13px;
      margin-bottom: 14px;
      flex-wrap: wrap;
    }
    .breadcrumb a {
      color: #0098ea;
      text-decoration: none;
      cursor: pointer;
    }
    .breadcrumb a:hover { text-decoration: underline; }
    .breadcrumb .sep { color: #708499; }
    .breadcrumb .current { color: #f5f5f5; }
    .file-table {
      width: 100%;
      border-collapse: collapse;
    }
    .file-table th {
      text-align: left;
      font-size: 11px;
      font-weight: 500;
      color: #708499;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 8px 10px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
    }
    .file-table th:hover { color: #f5f5f5; }
    .file-table th .sort-indicator { margin-left: 4px; font-size: 10px; }
    .file-table td {
      padding: 8px 10px;
      font-size: 13px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      vertical-align: middle;
    }
    .file-table tr:hover td {
      background: rgba(255, 255, 255, 0.04);
    }
    .file-table .col-icon { width: 36px; text-align: center; }
    .file-table .col-size {
      width: 90px;
      text-align: right;
      color: #708499;
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 12px;
    }
    .file-table .col-name a {
      color: #f5f5f5;
      text-decoration: none;
    }
    .file-table .col-name a:hover {
      color: #0098ea;
      text-decoration: underline;
    }
    .file-table .col-name .folder-link {
      color: #0098ea;
      cursor: pointer;
    }
    .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: #708499;
      font-size: 14px;
    }
    @media (max-width: 600px) {
      body { padding: 12px; }
      .card { padding: 16px 14px 14px; border-radius: 14px; }
      .header h1 { font-size: 17px; }
      .file-table td, .file-table th { padding: 6px 6px; }
      .file-table .col-size { font-size: 11px; width: 70px; }
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>${safeDomain}</h1>
      <div class="meta">
        <span id="stats"></span>
        <span class="bag-id">${truncatedBag}</span>
      </div>
    </div>
    <div id="breadcrumb" class="breadcrumb"></div>
    <table class="file-table">
      <thead>
        <tr>
          <th class="col-icon"></th>
          <th class="col-name" id="sort-name">Name <span class="sort-indicator" id="ind-name"></span></th>
          <th class="col-size" id="sort-size">Size <span class="sort-indicator" id="ind-size"></span></th>
        </tr>
      </thead>
      <tbody id="file-list"></tbody>
    </table>
    <div id="empty" class="empty-state" style="display:none">No files in this directory</div>
  </div>
  <script>
  (function() {
    var domain = ${JSON.stringify(domain)};
    var basePath = ${JSON.stringify(basePath || '')};
    var allFiles = ${filesJson};
    var icons = ${iconsJson};
    var currentPath = ${JSON.stringify(currentPath)};
    var sortField = 'name';
    var sortAsc = true;

    function escapeH(s) {
      var d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }

    function fmtSize(b) {
      if (b < 1024) return b + ' B';
      if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
      if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
      return (b / 1073741824).toFixed(2) + ' GB';
    }

    function normPath(p) {
      if (p === '/') return '/';
      return '/' + p.replace(/^\\/+/, '').replace(/\\/+$/, '') + '/';
    }

    function getEntries(path) {
      var prefix = path === '/' ? '' : path.replace(/^\\//, '');
      var seen = {};
      var entries = [];

      for (var i = 0; i < allFiles.length; i++) {
        var f = allFiles[i];
        var name = f.name;
        if (prefix && name.indexOf(prefix) !== 0) continue;
        var rest = prefix ? name.slice(prefix.length) : name;
        if (!rest) continue;

        var slashIdx = rest.indexOf('/');
        if (slashIdx >= 0) {
          // It's a folder
          var folderName = rest.slice(0, slashIdx);
          if (!seen[folderName]) {
            seen[folderName] = { name: folderName, size: 0, count: 0, isFolder: true };
            entries.push(seen[folderName]);
          }
          seen[folderName].size += f.size;
          seen[folderName].count++;
        } else {
          // It's a file
          entries.push({
            name: rest,
            fullPath: f.name,
            size: f.size,
            category: f.category,
            isFolder: false
          });
        }
      }
      return entries;
    }

    function renderBreadcrumb(path) {
      var bc = document.getElementById('breadcrumb');
      if (path === '/') {
        bc.innerHTML = '<span class="current">/</span>';
        return;
      }
      var parts = path.replace(/^\\//, '').replace(/\\/$/, '').split('/');
      var html = '<a onclick="window.__fb_nav(\\'/\\')">root</a>';
      var built = '/';
      for (var i = 0; i < parts.length; i++) {
        built += parts[i] + '/';
        html += '<span class="sep">/</span>';
        if (i === parts.length - 1) {
          html += '<span class="current">' + escapeH(parts[i]) + '</span>';
        } else {
          html += '<a onclick="window.__fb_nav(\\'' + built.replace(/'/g, "\\\\'") + '\\')">' + escapeH(parts[i]) + '</a>';
        }
      }
      bc.innerHTML = html;
    }

    function renderStats(entries) {
      var fileCount = 0;
      var totalSz = 0;
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].isFolder) { fileCount++; totalSz += entries[i].size; }
        else { totalSz += entries[i].size; fileCount += entries[i].count; }
      }
      document.getElementById('stats').textContent = fileCount + ' files, ' + fmtSize(totalSz);
    }

    function sortEntries(entries) {
      var folders = [];
      var files = [];
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isFolder) folders.push(entries[i]);
        else files.push(entries[i]);
      }

      var cmp;
      if (sortField === 'size') {
        cmp = function(a, b) { return sortAsc ? a.size - b.size : b.size - a.size; };
      } else {
        cmp = function(a, b) {
          var r = a.name.localeCompare(b.name);
          return sortAsc ? r : -r;
        };
      }
      folders.sort(cmp);
      files.sort(cmp);
      return folders.concat(files);
    }

    function render() {
      var path = normPath(currentPath);
      renderBreadcrumb(path);

      var entries = getEntries(path);
      entries = sortEntries(entries);
      renderStats(entries);

      // Update sort indicators
      document.getElementById('ind-name').textContent = sortField === 'name' ? (sortAsc ? '\\u25B2' : '\\u25BC') : '';
      document.getElementById('ind-size').textContent = sortField === 'size' ? (sortAsc ? '\\u25B2' : '\\u25BC') : '';

      var tbody = document.getElementById('file-list');
      var empty = document.getElementById('empty');

      if (entries.length === 0) {
        tbody.innerHTML = '';
        empty.style.display = 'block';
        return;
      }
      empty.style.display = 'none';

      var html = '';
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        html += '<tr>';
        if (e.isFolder) {
          html += '<td class="col-icon">' + icons.folder + '</td>';
          html += '<td class="col-name"><a class="folder-link" onclick="window.__fb_nav(\\'' + normPath(currentPath + '/' + e.name).replace(/'/g, "\\\\'") + '\\')">' + escapeH(e.name) + '/</a></td>';
          html += '<td class="col-size">' + fmtSize(e.size) + '</td>';
        } else {
          var cat = e.category || 'other';
          var icon = icons[cat] || icons.other;
          var href = basePath
            ? 'bagfile://' + encodeURIComponent(basePath) + '/' + e.fullPath.split('/').map(encodeURIComponent).join('/')
            : 'http://' + encodeURIComponent(domain).replace(/%2E/g, '.') + '/' + e.fullPath.split('/').map(encodeURIComponent).join('/');
          html += '<td class="col-icon">' + icon + '</td>';
          html += '<td class="col-name"><a href="' + escapeH(href) + '">' + escapeH(e.name) + '</a></td>';
          html += '<td class="col-size">' + fmtSize(e.size) + '</td>';
        }
        html += '</tr>';
      }
      tbody.innerHTML = html;
    }

    window.__fb_nav = function(path) {
      currentPath = path;
      render();
    };

    document.getElementById('sort-name').addEventListener('click', function() {
      if (sortField === 'name') sortAsc = !sortAsc;
      else { sortField = 'name'; sortAsc = true; }
      render();
    });

    document.getElementById('sort-size').addEventListener('click', function() {
      if (sortField === 'size') sortAsc = !sortAsc;
      else { sortField = 'size'; sortAsc = true; }
      render();
    });

    render();
  })();
  </script>
</body>
</html>`
}
