(() => {
  'use strict';

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

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
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener('close', () => {
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
      show(photo, index, button, sphereDiameter) {
        if (dialog.open) return;
        trigger = button;
        dialog.dataset.scene = sphereDiameter ? 'sphere' : 'wall';
        if (sphereDiameter) {
          const thumb = button.querySelector('img');
          const aspect = thumb.naturalHeight ? thumb.naturalWidth / thumb.naturalHeight : 1;
          dialog.style.setProperty('--preview-width', `${sphereDiameter * 0.94 * Math.min(aspect, 1)}px`);
          dialog.style.setProperty('--preview-aspect', String(aspect));
        }
        image.src = photo.src;
        image.alt = `第 ${index + 1} 张照片`;
        dialog.showModal();
        if (!reducedMotion.matches && image.animate) {
          image.animate([
            {transform:'scale(.91) rotate(-1.5deg)',opacity:0.45},
            {transform:'scale(1.012) rotate(.35deg)',opacity:1,offset:0.78},
            {transform:'scale(1) rotate(0)',opacity:1},
          ], {duration:280,easing:'ease-out'});
        }
      },
    };
  }

  function photoTile(photo, index, viewer, className, lazy = false) {
    const button = document.createElement('button');
    button.className = className;
    button.type = 'button';
    button.setAttribute('aria-label', `打开第 ${index + 1} 张照片`);
    button.dataset.photoId = photo.id;
    const image = new Image();
    image.alt = '';
    image.decoding = 'async';
    image.draggable = false;
    if (lazy) image.loading = 'lazy';
    image.src = photo.src;
    image.style.objectPosition = photo.focus || '50% 50%';
    button.append(image);
    return {button, image, open: diameter => viewer.show(photo, index, button, diameter)};
  }

  function createWall(viewport, photos, viewer) {
    const wall = document.createElement('div');
    wall.className = 'edge-wall';
    viewport.replaceChildren(wall);
    const events = new AbortController();
    const options = {signal:events.signal};
    let columns = 0;
    let maxX = 0;
    let maxY = 0;
    let x = 0;
    let y = 0;
    let drag;
    let suppressClick = false;

    function place(nextX, nextY) {
      x = clamp(nextX, 0, maxX);
      y = clamp(nextY, 0, maxY);
      wall.style.transform = `translate3d(${-x}px, ${-y}px, 0)`;
    }

    function measure() {
      const width = viewport.clientWidth;
      const height = viewport.clientHeight;
      if (!width || !height) return;
      const narrow = width <= 720;
      const nextColumns = Math.min(photos.length, narrow ? 5 : 8);
      const rows = Math.ceil(photos.length / nextColumns);
      // Leave at least one row and two columns outside the opening view when possible.
      const size = Math.ceil(Math.max(width / Math.min(nextColumns, narrow ? 3 : 6), height / Math.max(1, rows - 1)));
      const relativeX = maxX ? x / maxX : 0.5;
      const relativeY = maxY ? y / maxY : 0.5;
      if (columns !== nextColumns) {
        columns = nextColumns;
        const tiles = document.createDocumentFragment();
        for (let slot = 0; slot < columns * rows; slot++) {
          const index = slot % photos.length;
          const tile = photoTile(photos[index], index, viewer, 'wall-tile', slot >= 20);
          tile.button.addEventListener('click', event => {
            if (!suppressClick || event.detail === 0) tile.open();
          }, options);
          tiles.append(tile.button);
        }
        wall.replaceChildren(tiles);
      }
      wall.style.setProperty('--wall-columns', columns);
      wall.style.setProperty('--wall-tile-size', `${size}px`);
      maxX = Math.max(0, columns * size - width);
      maxY = Math.max(0, rows * size - height);
      place(maxX * relativeX, maxY * relativeY);
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
      suppressClick = drag.moved;
      drag = null;
      viewport.classList.remove('wall-dragging');
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
    const ready = Promise.allSettled(firstView.map(image => {
      image.loading = 'eager';
      return image.decode();
    }));
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
      const tile = photoTile(photos[photoIndex], photoIndex, viewer, 'sphere-tile');
      tile.button.tabIndex = -1;
      tile.button.addEventListener('click', event => {
        if (!suppressClick || event.detail === 0) tile.open(radius * 2.06);
      }, options);
      return {...tile,x:Math.cos(angle)*ring,y,z:Math.sin(angle)*ring};
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
        case 'Enter': foremost.open(radius * 2.06); break;
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
