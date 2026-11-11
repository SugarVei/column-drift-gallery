(() => {
  'use strict';

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const wrap = (value, length) => ((value % length) + length) % length;

  function createViewer() {
    const dialog = document.createElement('dialog');
    dialog.className = 'image-viewer';
    dialog.setAttribute('aria-label', '照片大图');
    const image = new Image();
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'image-viewer-close';
    close.setAttribute('aria-label', '关闭大图');
    close.textContent = '×';
    close.autofocus = true;
    dialog.append(image, close);
    document.body.append(dialog);

    let trigger;
    let pressedBackdrop = false;
    let previewVersion = 0;
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('pointerdown', event => {
      pressedBackdrop = event.target === dialog;
    });
    dialog.addEventListener('click', event => {
      if (event.target === dialog && pressedBackdrop) dialog.close();
      pressedBackdrop = false;
    });
    dialog.addEventListener('close', () => {
      if (dialog.open) return;
      previewVersion++;
      image.removeAttribute('src');
      if (trigger?.isConnected) {
        const destination = trigger.hidden ? trigger.closest('.sphere-stage') : trigger;
        destination?.focus({preventScroll:true});
      }
      trigger = null;
    });
    return {
      get open() { return dialog.open; },
      close() { if (dialog.open) dialog.close(); },
      show(photo, index, button) {
        if (dialog.open) return;
        const version = ++previewVersion;
        pressedBackdrop = false;
        trigger = button;
        function sizePreview(aspect) {
          dialog.style.setProperty('--preview-size', `${91 * Math.min(aspect, 1)}vmin`);
          dialog.style.setProperty('--preview-aspect', String(aspect));
        }
        const thumb = button.querySelector('img');
        sizePreview(thumb?.naturalHeight ? thumb.naturalWidth / thumb.naturalHeight : 1);
        image.onload = () => sizePreview(image.naturalWidth / image.naturalHeight);
        image.src = photo.thumbnail || photo.src;
        image.alt = `第 ${index + 1} 张照片`;
        dialog.showModal();
        if (photo.thumbnail) {
          const original = new Image();
          original.src = photo.src;
          original.decode().then(() => {
            if (dialog.open && version === previewVersion) image.src = original.src;
          }).catch(() => {
            // Keep the available thumbnail when the original cannot be loaded.
          });
        }
        if (!reducedMotion.matches && image.animate) {
          image.animate([
            {transform:'scale(.94)',opacity:0.5},
            {transform:'scale(1)',opacity:1},
          ], {duration:240,easing:'ease-out'});
        }
      },
    };
  }

  function makeTile(className) {
    const button = document.createElement('button');
    button.className = className;
    button.type = 'button';
    const image = new Image();
    image.alt = '';
    image.decoding = 'async';
    image.draggable = false;
    button.append(image);
    return {button, image, index: -1};
  }

  function setTilePhoto(tile, photo, index) {
    if (tile.index === index) return;
    tile.index = index;
    tile.button.dataset.photoId = photo.id;
    tile.button.setAttribute('aria-label', `打开第 ${index + 1} 张照片`);
    tile.image.src = photo.thumbnail || photo.src;
    tile.image.style.objectPosition = photo.focus || '50% 50%';
  }

  function createWall(viewport, photos, viewer) {
    const wall = document.createElement('div');
    wall.className = 'edge-wall';
    viewport.replaceChildren(wall);
    const events = new AbortController();
    const options = {signal:events.signal};
    let size = 1;
    let sourceColumns = 0;
    let sourceRows = 0;
    let poolColumns = 0;
    let poolRows = 0;
    let firstColumn;
    let firstRow;
    let tiles = [];
    let x = 0;
    let y = 0;
    let drag;
    let suppressClick = false;

    function place(nextX, nextY, force = false) {
      x = nextX;
      y = nextY;
      const column = Math.floor(x / size) - 1;
      const row = Math.floor(y / size) - 1;
      if (force || column !== firstColumn || row !== firstRow) {
        firstColumn = column;
        firstRow = row;
        // Recycle the far edge of the pool as new world cells enter on the opposite side.
        for (let r = 0; r < poolRows; r++) {
          const worldRow = row + r;
          const poolRow = wrap(worldRow, poolRows);
          const sourceRow = wrap(worldRow, sourceRows);
          for (let c = 0; c < poolColumns; c++) {
            const worldColumn = column + c;
            const poolColumn = wrap(worldColumn, poolColumns);
            const tile = tiles[poolRow * poolColumns + poolColumn];
            const index = (sourceRow * sourceColumns + wrap(worldColumn, sourceColumns)) % photos.length;
            setTilePhoto(tile, photos[index], index);
            tile.button.style.left = `${c * size}px`;
            tile.button.style.top = `${r * size}px`;
            tile.button.tabIndex = r > 0 && r < poolRows - 1 && c > 0 && c < poolColumns - 1 ? 0 : -1;
          }
        }
      }
      wall.style.transform = `translate3d(${column * size - x}px, ${row * size - y}px, 0)`;
    }

    function measure() {
      const width = viewport.clientWidth;
      const height = viewport.clientHeight;
      if (!width || !height) return;
      const previousSize = size;
      const visibleColumns = width <= 560 ? 3 : width <= 900 ? 4 : width >= 1680 ? 8 : 6;
      size = Math.ceil(width / visibleColumns);
      sourceColumns = Math.min(photos.length, width <= 720 ? 5 : 8);
      sourceRows = Math.ceil(photos.length / sourceColumns);
      const nextColumns = Math.ceil(width / size) + 2;
      const nextRows = Math.ceil(height / size) + 2;
      if (poolColumns !== nextColumns || poolRows !== nextRows) {
        poolColumns = nextColumns;
        poolRows = nextRows;
        tiles = Array.from({length: poolColumns * poolRows}, () => {
          const tile = makeTile('wall-tile');
          tile.button.addEventListener('click', event => {
            if (!suppressClick || event.detail === 0) viewer.show(photos[tile.index], tile.index, tile.button);
          }, options);
          return tile;
        });
        wall.replaceChildren(...tiles.map(tile => tile.button));
      }
      wall.style.setProperty('--wall-tile-size', `${size}px`);
      place(x / previousSize * size, y / previousSize * size, true);
    }

    viewport.addEventListener('pointerdown', event => {
      if (event.button !== 0 || drag) return;
      drag = {id:event.pointerId,startX:event.clientX,startY:event.clientY,x,y,moved:false};
      suppressClick = false;
    }, options);
    window.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      if (!drag.moved) {
        drag.moved = true;
        viewport.setPointerCapture(event.pointerId);
        viewport.classList.add('wall-dragging');
      }
      place(drag.x - dx, drag.y - dy);
    }, options);
    function release(event) {
      if (!drag || event.pointerId !== drag.id) return;
      const tapped = event.type === 'pointerup' && event.pointerType === 'touch' && !drag.moved
        ? event.target.closest('.wall-tile')
        : null;
      suppressClick = drag.moved;
      drag = null;
      viewport.classList.remove('wall-dragging');
      // A touch browser can suppress the native click on a tile that just moved.
      tapped?.click();
    }
    window.addEventListener('pointerup', release, options);
    window.addEventListener('pointercancel', release, options);
    viewport.addEventListener('lostpointercapture', event => {
      if (event.target === viewport) release(event);
    }, options);

    const resize = new ResizeObserver(measure);
    resize.observe(viewport);
    measure();
    const bounds = viewport.getBoundingClientRect();
    const firstView = [...wall.querySelectorAll('img')].filter(image => {
      const rect = image.getBoundingClientRect();
      return rect.right > bounds.left && rect.left < bounds.right && rect.bottom > bounds.top && rect.top < bounds.bottom;
    });
    const ready = Promise.allSettled(firstView.map(image => image.decode()));
    return {
      ready,
      destroy() {
        events.abort();
        resize.disconnect();
        viewport.classList.remove('wall-dragging');
      },
    };
  }

  function createSphere(viewport, photos, viewer) {
    const stage = document.createElement('div');
    stage.className = 'sphere-stage';
    stage.tabIndex = 0;
    stage.setAttribute('role', 'region');
    stage.setAttribute('aria-label', '照片球。拖动或用方向键旋转，按 Enter 查看最前面的照片。');
    const events = new AbortController();
    const options = {signal:events.signal};
    const count = Math.max(64, Math.min(96, photos.length));
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const tiles = Array.from({length:count}, (_, index) => {
      const y = 1 - 2 * (index + 0.5) / count;
      const ring = Math.sqrt(1 - y * y);
      const angle = index * goldenAngle;
      const photoIndex = index % photos.length;
      const tile = makeTile('sphere-tile');
      setTilePhoto(tile, photos[photoIndex], photoIndex);
      const open = () => viewer.show(photos[photoIndex], photoIndex, tile.button);
      tile.button.tabIndex = -1;
      tile.button.addEventListener('click', event => {
        if (!suppressClick || event.detail === 0) open();
      }, options);
      return {...tile,open,x:Math.cos(angle)*ring,y,z:Math.sin(angle)*ring};
    });
    stage.append(...tiles.map(tile => tile.button));
    viewport.replaceChildren(stage);

    let radius = 1;
    let yaw = 0.32;
    let pitch = -0.15;
    let yawSpeed = 0;
    let pitchSpeed = 0;
    let lastFrame = 0;
    let resumeAt = 0;
    let frame = 0;
    let drag;
    let suppressClick = false;
    let destroyed = false;
    let foremost = tiles[0];

    function render() {
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      let highestDepth = -1;
      for (const tile of tiles) {
        const x = tile.x * cy + tile.z * sy;
        const back = -tile.x * sy + tile.z * cy;
        const y = tile.y * cp - back * sp;
        const z = tile.y * sp + back * cp;
        const hidden = z <= 0.20;
        if (tile.button.hidden !== hidden) tile.button.hidden = hidden;
        if (hidden) continue;
        const rotateY = Math.atan2(x, z);
        const rotateX = -Math.asin(clamp(y, -1, 1));
        tile.button.style.transform = `translate3d(${x*radius}px, ${y*radius}px, ${z*radius}px) translate(-50%, -50%) rotateY(${rotateY}rad) rotateX(${rotateX}rad)`;
        tile.button.style.zIndex = Math.round(z * 1000);
        if (z > highestDepth) { highestDepth = z; foremost = tile; }
      }
    }

    function measure() {
      radius = Math.min(stage.clientWidth, stage.clientHeight) * 0.47;
      stage.style.perspective = `${radius * 4.3}px`;
      stage.style.setProperty('--sphere-tile-width', `${radius * 0.31 * Math.sqrt(64 / count)}px`);
      render();
    }

    function tick(now) {
      const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.04) : 0;
      lastFrame = now;
      if (!drag && !reducedMotion.matches) {
        const auto = now >= resumeAt ? (viewer.open ? 0.11 : 0.17) : 0;
        if (auto || Math.abs(yawSpeed) + Math.abs(pitchSpeed) > 0.01) {
          yaw += (yawSpeed + auto) * dt;
          pitch = clamp(pitch + pitchSpeed * dt, -1.05, 1.05);
          yawSpeed *= Math.exp(-5 * dt);
          pitchSpeed *= Math.exp(-5 * dt);
          render();
        }
      }
      frame = requestAnimationFrame(tick);
    }

    stage.addEventListener('pointerdown', event => {
      if (event.button !== 0 || drag) return;
      drag = {id:event.pointerId,x:event.clientX,y:event.clientY,time:performance.now(),moved:false};
      yawSpeed = pitchSpeed = 0;
      suppressClick = false;
    }, options);

    window.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      if (!drag.moved) {
        drag.moved = true;
        stage.setPointerCapture(event.pointerId);
        stage.classList.add('is-dragging');
      }
      const now = performance.now();
      const duration = Math.max(12, now - drag.time) / 1000;
      const sensitivity = 1.6 / Math.max(100, radius);
      yaw += dx * sensitivity;
      pitch = clamp(pitch - dy * sensitivity, -1.05, 1.05);
      yawSpeed = clamp(dx * sensitivity / duration, -7, 7);
      pitchSpeed = clamp(-dy * sensitivity / duration, -7, 7);
      drag.x = event.clientX;
      drag.y = event.clientY;
      drag.time = now;
      render();
    }, options);

    function release(event) {
      if (!drag || event.pointerId !== drag.id) return;
      const now = performance.now();
      suppressClick = drag.moved;
      if (!drag.moved || now - drag.time > 100 || event.type === 'pointercancel') yawSpeed = pitchSpeed = 0;
      drag = null;
      stage.classList.remove('is-dragging');
      resumeAt = now + 1000;
    }
    window.addEventListener('pointerup', release, options);
    window.addEventListener('pointercancel', release, options);
    stage.addEventListener('keydown', event => {
      switch (event.key) {
        case 'ArrowLeft': yaw -= 0.22; break;
        case 'ArrowRight': yaw += 0.22; break;
        case 'ArrowUp': pitch = clamp(pitch + 0.18, -1.05, 1.05); break;
        case 'ArrowDown': pitch = clamp(pitch - 0.18, -1.05, 1.05); break;
        case 'Enter': foremost.open(); break;
        default: return;
      }
      event.preventDefault();
      resumeAt = performance.now() + 1000;
      render();
    }, options);

    const resize = new ResizeObserver(measure);
    resize.observe(stage);
    measure();
    const ready = Promise.allSettled(tiles.map(tile => tile.image.decode())).then(() => {
      if (!destroyed) frame = requestAnimationFrame(tick);
    });
    return {
      ready,
      destroy() {
        destroyed = true;
        cancelAnimationFrame(frame);
        events.abort();
        resize.disconnect();
      },
    };
  }

  window.photoDisplays = {createViewer, createWall, createSphere};
})();
