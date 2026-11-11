(() => {
  'use strict';
  const DURATION = 12;
  const ROWS = 8;
  const DEFAULTS = window.DEFAULT_PHOTOS || [];
  const $ = id => document.getElementById(id);
  const viewport = $('viewport');
  const app = $('app');
  const photoDialog = $('photo-dialog');
  const viewer = window.photoDisplays.createViewer();
  const VERSION = 'interactive-wall-v1';
  const LAYOUT_VERSION = 'five-column-alternating-v1';
  const styles = ['drift', 'helix', 'velocity', 'sphere', 'tilt', 'wall'];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const params = new URLSearchParams(location.search);
  const requestedStyle = params.get('mode');
  let mode = requestedStyle || document.documentElement.dataset.defaultMode;
  if (!styles.includes(mode)) {
    try { mode = localStorage.getItem('column-drift-style'); } catch (_) {}
  }
  if (!styles.includes(mode)) mode = 'drift';
  $('display-style').value = mode;
  let theme = params.get('theme');
  if (theme !== 'light' && theme !== 'dark') {
    try { theme = localStorage.getItem('column-drift-theme'); } catch (_) {}
  }
  theme = theme === 'light' ? 'light' : 'dark';
  applyTheme();
  let columns = 5;
  try {
    if (localStorage.getItem('column-drift-layout-version') === LAYOUT_VERSION) {
      columns = Number(localStorage.getItem('column-drift-columns')) || 5;
    } else {
      localStorage.setItem('column-drift-columns', '5');
      localStorage.setItem('column-drift-layout-version', LAYOUT_VERSION);
    }
  } catch (_) {}
  columns = Math.max(2, Math.min(6, columns));
  $('columns').value = String(columns);
  let personal = [];
  let personalOnly = false;
  try { personalOnly = localStorage.getItem('column-drift-personal-only') === 'true'; } catch (_) {}
  let photos = [...DEFAULTS];
  let group = 0;
  let strips = [];
  let tiltPlayback = [];
  let coverflow = null;
  let grid = viewport;
  let repeatCount = 0;
  let cycle = 1;
  let time = 0;
  let origin = 0;
  let anchor = 0;
  let playing = false;
  let ready = false;
  let raf = 0;
  let buildVersion = 0;
  let noticeTimer;
  let importing = false;
  let database = null;
  let storageAvailable = true;

  function notice(message, long = false) {
    clearTimeout(noticeTimer);
    $('toast').textContent = message;
    $('toast').hidden = false;
    noticeTimer = setTimeout(() => { $('toast').hidden = true; }, long ? 7500 : 4300);
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; reject(new Error('Storage timeout')); }
      }, 2500);
      const request = indexedDB.open('column-drift-personal-photos', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('photos', { keyPath: 'id' });
      request.onsuccess = () => {
        clearTimeout(timer);
        if (settled) { request.result.close(); return; }
        settled = true;
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => {
        clearTimeout(timer);
        if (!settled) { settled = true; reject(request.error || new Error('Storage failed')); }
      };
      request.onblocked = () => {
        clearTimeout(timer);
        if (!settled) { settled = true; reject(new Error('Storage blocked')); }
      };
    });
  }

  function transact(mode, action) {
    return new Promise((resolve, reject) => {
      if (!database) { reject(new Error('Storage unavailable')); return; }
      const transaction = database.transaction('photos', mode);
      let result;
      const request = action(transaction.objectStore('photos'));
      if (request) request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error('Storage failed'));
    });
  }

  function photosPerGroup() {
    if (mode === 'drift') return columns * ROWS;
    if (mode === 'tilt') return 6 * ROWS;
    if (mode === 'sphere') return 96;
    return photos.length;
  }

  function refreshCollection() {
    // Personal additions go first, so a newly added photo appears immediately.
    photos = personalOnly && personal.length ? [...personal] : [...personal, ...DEFAULTS];
    const pages = Math.max(1, Math.ceil(photos.length / photosPerGroup()));
    group = Math.min(group, pages - 1);
    $('photo-count').textContent = `${photos.length} 张回忆`;
    $('group-label').textContent = `${group + 1} / ${pages}`;
    $('next-group').hidden = pages <= 1;
    $('next-group').setAttribute('aria-label', `下一组照片，当前第 ${group + 1} 组，共 ${pages} 组`);
    $('manage-photos').textContent = personal.length ? `我的照片 · ${personal.length}` : '我的照片';
  }

  function loopTime(seconds) {
    return ((seconds % DURATION) + DURATION) % DURATION;
  }

  function paint(seconds) {
    // ONE clock and ONE pixel distance for every column. Only the sign differs.
    // Subtracting a full repeated strip for downward motion keeps the viewport covered.
    const elapsed = loopTime(seconds);
    const distance = elapsed * (cycle / DURATION);
    const up = `translate3d(0, ${-distance}px, 0)`;
    const down = `translate3d(0, ${distance === 0 ? 0 : distance - cycle}px, 0)`;
    for (let index = 0; index < strips.length; index++) {
      const track = tiltPlayback[index];
      if (track) {
        const phase = track.frozen ?? loopTime(seconds - track.offset);
        const offset = phase * (cycle / DURATION);
        const y = index % 2 === 0 ? -offset : (offset === 0 ? 0 : offset - cycle);
        strips[index].style.transform = `translate3d(0, ${y}px, 0)`;
      } else {
        strips[index].style.transform = index % 2 === 0 ? up : down;
      }
    }
  }

  function tick(now) {
    if (!playing) return;
    time = (origin + (now - anchor) / 1000) % DURATION;
    // Nothing except the five strip transforms is updated during animation.
    paint(time);
    raf = requestAnimationFrame(tick);
  }

  function play() {
    if ((mode !== 'drift' && mode !== 'tilt') || playing || !ready) return;
    if (mode === 'tilt' && reducedMotion.matches) return;
    if (time >= DURATION) time = 0;
    origin = time;
    anchor = performance.now();
    playing = true;
    raf = requestAnimationFrame(tick);
  }

  function pause() {
    if (playing) time = (origin + (performance.now() - anchor) / 1000) % DURATION;
    playing = false;
    cancelAnimationFrame(raf);
    paint(time);
  }

  function seek(value) {
    pause();
    time = Math.max(0, Math.min(DURATION, Number(value) || 0));
    paint(time);
  }

  function requiredRepeats() {
    const count = mode === 'tilt' ? 6 : columns;
    const gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
    const width = (grid.clientWidth - (count - 1) * gap) / count;
    const height = mode === 'tilt' ? width * 4 / 3 : width;
    return Math.max(2, Math.ceil(grid.clientHeight / (ROWS * (height + gap))) + 1);
  }

  function measure() {
    if (!strips.length) return;
    const cards = strips[0].children;
    if (cards.length <= ROWS) return;
    // The tilt is a projection. Measure its card spacing in the plane's own coordinates.
    if (mode === 'tilt') {
      const style = getComputedStyle(cards[0]);
      cycle = (parseFloat(style.height) + parseFloat(style.marginBottom)) * ROWS;
    } else {
      cycle = cards[ROWS].getBoundingClientRect().top - cards[0].getBoundingClientRect().top;
    }
    paint(time);
  }

  async function build({ reset = true } = {}) {
    const version = ++buildVersion;
    pause();
    const previousTiltPlayback = reset ? [] : tiltPlayback;
    tiltPlayback = [];
    viewer.close();
    coverflow?.destroy();
    coverflow = null;
    ready = false;
    if (reset) time = 0;
    app.dataset.mode = mode;
    viewport.dataset.mode = mode;
    viewport.setAttribute('aria-hidden', String(mode === 'drift'));
    if (mode === 'wall') viewport.tabIndex = 0;
    else viewport.removeAttribute('tabindex');
    refreshCollection();
    if (mode === 'wall') {
      strips = [];
      coverflow = window.photoDisplays.createWall(viewport, photos, viewer);
      await coverflow.ready;
      if (version !== buildVersion) return;
      $('loading').hidden = true;
      viewport.focus({preventScroll:true});
      ready = true;
      return;
    }
    if (mode !== 'drift' && mode !== 'tilt') {
      strips = [];
      const groupSize = photosPerGroup();
      coverflow = mode === 'sphere'
        ? window.photoDisplays.createSphere(viewport, photos.slice(group * groupSize, (group + 1) * groupSize), viewer)
        : window.createPhotoCoverflow(viewport, mode, photos);
      await coverflow.ready;
      if (version !== buildVersion) return;
      $('loading').hidden = true;
      ready = true;
      return;
    }
    const count = mode === 'tilt' ? 6 : columns;
    grid = viewport;
    if (mode === 'tilt') {
      grid = document.createElement('div');
      grid.className = 'tilted-plane';
      viewport.replaceChildren(grid);
    }
    grid.style.setProperty('--columns', count);
    repeatCount = requiredRepeats();
    const fragment = document.createDocumentFragment();
    const images = [];
    strips = [];
    for (let column = 0; column < count; column++) {
      const wrapper = document.createElement('div');
      wrapper.className = 'column';
      wrapper.dataset.direction = column % 2 === 0 ? 'up' : 'down';
      if (mode === 'tilt') {
        const track = previousTiltPlayback[column] || {offset:0, frozen:null};
        tiltPlayback.push(track);
        wrapper.tabIndex = 0;
        wrapper.setAttribute('role', 'button');
        wrapper.setAttribute('aria-label', `暂停或继续第 ${column + 1} 列`);
        wrapper.setAttribute('aria-pressed', String(track.frozen !== null));
        wrapper.addEventListener('click', () => {
          if (track.frozen === null) track.frozen = loopTime(time - track.offset);
          else {
            track.offset = time - track.frozen;
            track.frozen = null;
          }
          wrapper.setAttribute('aria-pressed', String(track.frozen !== null));
          paint(time);
        });
        wrapper.addEventListener('keydown', event => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          if (!event.repeat) wrapper.click();
        });
      }
      const strip = document.createElement('div');
      strip.className = 'strip';
      for (let repeat = 0; repeat < repeatCount; repeat++) {
        for (let row = 0; row < ROWS; row++) {
          const index = (group * count * ROWS + row * count + column) % photos.length;
          const photo = photos[index];
          const card = document.createElement('div');
          card.className = 'card';
          card.dataset.photoId = photo.id;
          const image = new Image();
          image.alt = '';
          image.draggable = false;
          image.decoding = 'async';
          image.style.objectPosition = photo.focus || '50% 50%';
          image.src = photo.src;
          card.append(image);
          strip.append(card);
          images.push(image);
        }
      }
      wrapper.append(strip);
      fragment.append(wrapper);
      strips.push(strip);
    }
    grid.replaceChildren(fragment);
    measure();
    const results = await Promise.allSettled(images.map(image => image.decode()));
    if (version !== buildVersion) return;
    $('loading').hidden = true;
    if (results.some(result => result.status === 'rejected')) notice('部分照片暂时未能加载，请刷新后重试。');
    ready = true;
    measure();
    play();
  }

  function setImporting(value) {
    importing = value;
    ['add-photos', 'dialog-add', 'restore-defaults'].forEach(id => { $(id).disabled = value; });
    $('add-photos').lastChild.textContent = value ? '正在添加…' : '添加照片';
    $('restore-defaults').disabled = value || !personal.length;
    for (const button of $('personal-grid').querySelectorAll('button')) button.disabled = value;
  }

  async function preparePhoto(file, index, batchTime) {
    if (!/^image\/(jpeg|png|webp|gif|avif|bmp)$/i.test(file.type)) throw new Error('Unsupported image');
    if (file.size > 60 * 1024 * 1024) throw new Error('Image too large');
    const sourceURL = URL.createObjectURL(file);
    const image = new Image();
    image.src = sourceURL;
    try {
      await image.decode();
      const ratio = Math.min(1, 1400 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      const context = canvas.getContext('2d');
      context.fillStyle = '#101014';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.86));
      if (!blob) throw new Error('Image conversion failed');
      return { id: `personal-${crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2)}`,
        name: file.name, createdAt: batchTime, order: index, blob, focus: '50% 50%' };
    } finally {
      URL.revokeObjectURL(sourceURL);
    }
  }

  async function addPhotos(files) {
    if (importing || !files.length) return;
    const selected = [...files].slice(0, 100);
    setImporting(true);
    const additions = [];
    const batchTime = Date.now();
    let failures = files.length - selected.length;
    let saved = true;
    try {
      for (let index = 0; index < selected.length; index++) {
        try {
          const photo = await preparePhoto(selected[index], index, batchTime);
          let persisted = true;
          try { await transact('readwrite', store => store.put(photo)); }
          catch (_) { saved = false; persisted = false; storageAvailable = false; }
          additions.push({ ...photo, persisted, src: URL.createObjectURL(photo.blob) });
        } catch (_) { failures++; }
      }
      if (additions.length) {
        personal = [...additions, ...personal];
        group = 0;
        await build();
        renderPersonalPhotos();
        const note = saved ? '照片仅保存在当前浏览器。' : '浏览器存储不可用或已满，这次新增照片仅在当前页面保留。';
        notice(`已添加 ${additions.length} 张照片。${note}${failures ? ` ${failures} 张未能添加（支持 JPG、PNG、WebP 等常见格式，单次最多 100 张）。` : ''}`, !saved || failures > 0);
      } else notice('未能添加照片。请选择 JPG、PNG、WebP 等常见图片格式，每张不超过 60 MB。', true);
    } finally {
      setImporting(false);
      $('file-input').value = '';
    }
  }

  function renderPersonalPhotos() {
    $('personal-grid').replaceChildren();
    $('personal-only-option').hidden = personal.length === 0;
    $('personal-only').checked = personalOnly;
    $('empty-message').hidden = personal.length > 0;
    $('saved-count').textContent = `${personal.length} 张照片`;
    $('restore-defaults').disabled = importing || !personal.length;
    for (const photo of personal) {
      const item = document.createElement('div');
      item.className = 'personal-item';
      const image = new Image();
      image.src = photo.src;
      image.alt = photo.name || '添加的照片';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `删除照片 ${photo.name || ''}`);
      remove.disabled = importing;
      remove.addEventListener('click', () => removePhoto(photo.id));
      item.append(image, remove);
      $('personal-grid').append(item);
    }
  }

  async function removePhoto(id) {
    if (importing) return;
    const photo = personal.find(item => item.id === id);
    if (!photo) return;
    try { await transact('readwrite', store => store.delete(id)); }
    catch (_) { if (photo.persisted) { notice('无法更新浏览器存储，请稍后重试。'); return; } }
    personal = personal.filter(item => item.id !== id);
    group = 0;
    await build();
    URL.revokeObjectURL(photo.src);
    renderPersonalPhotos();
    notice('已从当前浏览器移除这张照片。');
  }

  function setPageOption(name, value) {
    try {
      const url = new URL(location.href);
      url.searchParams.set(name, value);
      history.replaceState(null, '', url);
    } catch (_) {}
  }

  function applyTheme() {
    const light = theme === 'light';
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content = light ? '#ffffff' : '#101014';
    const label = light ? '切换黑色背景' : '切换白色背景';
    $('theme-toggle').setAttribute('aria-label', label);
    $('theme-toggle').title = label;
    $('theme-label').textContent = light ? '黑底' : '白底';
  }

  $('theme-toggle').addEventListener('click', () => {
    theme = theme === 'light' ? 'dark' : 'light';
    applyTheme();
    try { localStorage.setItem('column-drift-theme', theme); } catch (_) {}
    setPageOption('theme', theme);
  });
  function selectMode(value) {
    mode = value;
    group = 0;
    $('display-style').value = mode;
    if (mode !== 'wall') {
      try { localStorage.setItem('column-drift-style', mode); } catch (_) {}
    }
    build();
  }

  $('display-style').addEventListener('change', event => {
    const next = event.target.value;
    if (next === 'wall') {
      // Keep the previous style as the browser's Back destination.
      setPageOption('mode', mode);
      try {
        const url = new URL(location.href);
        url.searchParams.set('mode', next);
        history.pushState({photoWall:true}, '', url);
      } catch (_) {}
    } else {
      setPageOption('mode', next);
    }
    selectMode(next);
  });
  window.addEventListener('popstate', () => {
    const next = new URLSearchParams(location.search).get('mode');
    if (styles.includes(next) && next !== mode) selectMode(next);
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || mode !== 'wall' || viewer.open || document.fullscreenElement) return;
    if (history.state?.photoWall) history.back();
    else {
      setPageOption('mode', 'drift');
      selectMode('drift');
    }
  });
  $('columns').addEventListener('change', () => {
    columns = Number($('columns').value);
    try { localStorage.setItem('column-drift-columns', String(columns)); } catch (_) {}
    group = 0;
    build();
  });
  $('next-group').addEventListener('click', () => {
    group = (group + 1) % Math.ceil(photos.length / photosPerGroup());
    build();
  });
  $('add-photos').addEventListener('click', () => $('file-input').click());
  $('dialog-add').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', event => addPhotos(event.target.files));
  $('manage-photos').addEventListener('click', () => { renderPersonalPhotos(); photoDialog.showModal(); });
  $('personal-only').addEventListener('change', event => {
    personalOnly = event.target.checked;
    try { localStorage.setItem('column-drift-personal-only', String(personalOnly)); } catch (_) {}
    group = 0;
    build();
  });
  $('close-dialog').addEventListener('click', () => photoDialog.close());
  photoDialog.addEventListener('click', event => {
    const rect = photoDialog.getBoundingClientRect();
    if (event.target === photoDialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) photoDialog.close();
  });
  $('restore-defaults').addEventListener('click', async () => {
    if (importing || !personal.length || !confirm('清除自己添加的全部照片？默认的 40 张照片会保留。')) return;
    try { await transact('readwrite', store => store.clear()); }
    catch (_) { if (personal.some(photo => photo.persisted)) { notice('无法更新浏览器存储，请稍后重试。'); return; } }
    const removed = personal;
    personal = [];
    group = 0;
    await build();
    removed.forEach(photo => URL.revokeObjectURL(photo.src));
    renderPersonalPhotos();
    notice('已恢复默认相册。');
  });
  $('hide-controls').addEventListener('click', () => {
    app.classList.add('controls-hidden'); $('show-controls').hidden = false;
  });
  $('show-controls').addEventListener('click', () => {
    app.classList.remove('controls-hidden'); $('show-controls').hidden = true;
  });
  $('fullscreen').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else notice('当前浏览器不支持全屏按钮；可隐藏控制栏，或使用浏览器的全屏功能。', true);
    } catch (_) { notice('未能进入全屏，可使用浏览器的全屏功能。'); }
  });
  document.addEventListener('fullscreenchange', () => {
    const label = document.fullscreenElement ? '退出全屏' : '进入全屏';
    $('fullscreen').setAttribute('aria-label', label);
    $('fullscreen').title = label;
  });
  new ResizeObserver(() => {
    if ((mode !== 'drift' && mode !== 'tilt') || !strips.length) return;
    if (requiredRepeats() !== repeatCount && ready) build({ reset: false });
    else measure();
  }).observe(viewport);
  reducedMotion.addEventListener('change', () => {
    if (mode !== 'tilt') return;
    if (reducedMotion.matches) pause();
    else play();
  });

  Object.defineProperty(window, 'columnDrift', { value: Object.freeze({
    play, pause, seek,
    get version() { return VERSION; },
    get mode() { return mode; },
    get theme() { return theme; },
    get ready() { return ready; },
    get playing() { return playing; },
    get currentTime() { return time; },
    get duration() { return DURATION; },
    get columns() { return columns; },
    get photoCount() { return photos.length; },
    get personalCount() { return personal.length; },
    get group() { return group; },
    get stepPixels() { return cycle / ROWS; },
    get stepsPerSecond() { return ROWS / DURATION; },
    get pixelsPerSecond() { return cycle / DURATION; },
    get directions() { return Array.from({ length: columns }, (_, i) => i % 2 === 0 ? 'up' : 'down'); },
    get importing() { return importing; }
  }) });

  async function init() {
    try {
      database = await openDatabase();
      const stored = await transact('readonly', store => store.getAll());
      personal = (stored || []).filter(photo => photo.blob instanceof Blob)
        .sort((a, b) => b.createdAt - a.createdAt || (a.order || 0) - (b.order || 0))
        .map(photo => ({ ...photo, persisted: true, src: URL.createObjectURL(photo.blob) }));
    } catch (_) { storageAvailable = false; }
    await build();
  }
  init();
})();
