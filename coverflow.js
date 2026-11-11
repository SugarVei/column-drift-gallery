(() => {
  'use strict';

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const wrap = (value, length) => ((value % length) + length) % length;
  function createFlow(viewport, mode, photos, {side = '', start = 0} = {}) {
    const helix = mode === 'helix';
    const autoResumeDelay = helix ? 1000 : 4200;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const events = new AbortController();
    const options = {signal: events.signal};
    const layout = document.createElement('div');
    layout.className = `flow-layout flow-${mode}`;
    const stage = document.createElement('div');
    stage.className = 'flow-stage';
    stage.tabIndex = 0;
    stage.setAttribute('role', 'region');
    stage.setAttribute('aria-label', helix ? `${side}双螺旋照片，拖动或用方向键浏览` : '速度折叠照片，横向拖动或用方向键浏览');
    layout.append(stage);

    let position = start;
    let target = 0;
    let velocity = 0;
    let bend = 0;
    let drag = null;
    let suppressClick = false;
    let lastFrame = 0;
    let resumeAt = performance.now() + autoResumeDelay;
    let lastWheel = -Infinity;
    let frame = 0;
    let destroyed = false;
    let cardWidth = 1;
    let pitch = 1;
    let radius = 1;
    let visible = 0;
    let cards = [];
    let captionIndex = -1;

    const caption = document.createElement('span');
    if (!helix) {
      const nav = document.createElement('div');
      nav.className = 'flow-navigation';
      caption.className = 'flow-caption';
      nav.append(makeArrow(-1), caption, makeArrow(1));
      layout.append(nav);
    }
    viewport.replaceChildren(layout);

    function makeArrow(direction) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button flow-arrow';
      button.dataset.direction = direction < 0 ? 'previous' : 'next';
      button.setAttribute('aria-label', direction < 0 ? '上一张照片' : '下一张照片');
      const mark = document.createElement('span');
      mark.setAttribute('aria-hidden', 'true');
      button.append(mark);
      button.addEventListener('click', () => step(direction), options);
      return button;
    }

    function makeCard() {
      const element = document.createElement(helix ? 'div' : 'button');
      element.className = 'flow-card';
      if (!helix) {
        element.type = 'button';
        element.tabIndex = -1;
      }
      const image = new Image();
      image.alt = '';
      image.draggable = false;
      image.decoding = 'async';
      element.append(image);
      return {element, image, photoId: null};
    }

    function setPhoto(card, number, slot) {
      const index = wrap(number, photos.length);
      const photo = photos[index];
      if (!helix) card.element.dataset.slot = slot;
      if (card.photoId === photo.id) return;
      card.photoId = photo.id;
      card.image.src = photo.src;
      card.image.style.objectPosition = photo.focus || '50% 50%';
      if (!helix) card.element.setAttribute('aria-label', `查看第 ${index + 1} 张照片`);
    }

    function measure() {
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      if (!width || !height) return;
      if (helix) {
        cardWidth = clamp(width * 0.20, 48, 136);
        pitch = cardWidth * 0.8;
        radius = Math.min(width * 0.31, 218);
        visible = Math.ceil(height / (2 * pitch)) + 2;
      } else {
        const widthRatio = width < 640 ? 0.35 : 0.17;
        cardWidth = Math.min(clamp(width * widthRatio, 110, 244), height * 0.66);
        pitch = cardWidth * 1.1;
        visible = Math.ceil(width / (2 * pitch)) + 2;
      }
      stage.style.setProperty('--photo-width', `${cardWidth}px`);
      const count = (visible * 2 + 1) * (helix ? 2 : 1);
      if (count !== cards.length) {
        cards = Array.from({length: count}, makeCard);
        stage.replaceChildren(...cards.map(card => card.element));
      }
      render();
    }

    function render() {
      if (!cards.length) return;
      const center = Math.floor(position);
      const span = visible * 2 + 1;
      for (let slot = center - visible; slot <= center + visible; slot++) {
        const relative = slot - position;
        if (helix) {
          for (let strand = 0; strand < 2; strand++) {
            const card = cards[wrap(slot, span) * 2 + strand];
            const angle = relative * Math.PI / 6 + strand * Math.PI;
            const sine = Math.sin(angle);
            const depth = Math.cos(angle);
            setPhoto(card, slot + strand * Math.ceil(photos.length / 2), slot);
            card.element.style.transform = `translate3d(${sine * radius}px, ${relative * pitch}px, ${depth * radius}px) translate(-50%, -50%) rotateZ(${-sine * 10}deg) rotateY(${sine * 38}deg)`;
            card.element.style.opacity = 0.42 + 0.58 * (depth + 1) / 2;
            card.element.style.zIndex = Math.round((depth + 1) * 100);
          }
        } else {
          const card = cards[wrap(slot, span)];
          const distance = Math.abs(relative);
          const arch = Math.max(0, 1 - distance / 4) ** 2;
          const fold = wrap(slot, 2) === 0 ? 1 : -1;
          const depth = bend * cardWidth * (arch * 0.86 - Math.min(distance, 4) * 0.055);
          const rotation = bend * (-clamp(relative, -3, 3) * 13 + fold * 13);
          setPhoto(card, slot, slot);
          card.element.style.transform = `translate3d(${relative * pitch * (1 - bend * 0.12)}px, ${-arch * bend * 9}px, ${depth}px) translate(-50%, -50%) rotateY(${rotation}deg)`;
          card.element.style.zIndex = Math.round(100 - distance * 5);
        }
      }
      if (!helix) {
        const index = wrap(Math.round(position), photos.length);
        if (index !== captionIndex) {
          captionIndex = index;
          caption.textContent = `第 ${index + 1} 张 / ${photos.length}`;
        }
      }
    }

    function deferAuto(now = performance.now()) {
      resumeAt = now + autoResumeDelay;
    }

    function step(direction) {
      deferAuto();
      if (helix && !reducedMotion.matches) {
        velocity = clamp(velocity + direction * 5, -15, 15);
        return;
      }
      target = Math.round(helix ? position : target) + direction;
      if (reducedMotion.matches) {
        position = target;
        velocity = 0;
        render();
      }
    }

    function tick(now) {
      const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.04) : 0;
      lastFrame = now;
      const previous = position;
      const previousBend = bend;
      if (helix) {
        if (!drag) {
          position += velocity * dt;
          velocity *= Math.exp(-5 * dt);
          if (Math.abs(velocity) < 0.01) velocity = 0;
          if (now >= resumeAt && !reducedMotion.matches) position += 0.62 * dt;
        }
      } else {
        if (drag && now - drag.time > 90) velocity = 0;
        if (!drag && now >= resumeAt && !reducedMotion.matches) {
          target = Math.round(target) + 1;
          deferAuto(now);
        }
        if (!drag) {
          velocity += ((target - position) * 74 - velocity * 15) * dt;
          position += velocity * dt;
          if (Math.abs(target - position) < 0.001 && Math.abs(velocity) < 0.01) {
            position = target;
            velocity = 0;
          }
        }
        const desired = reducedMotion.matches ? 0 : Math.min(1, Math.abs(velocity) / 5);
        bend += (desired - bend) * (1 - Math.exp(-12 * dt));
        if (bend < 0.001 && desired === 0) bend = 0;
      }
      if (position !== previous || bend !== previousBend) render();
      frame = requestAnimationFrame(tick);
    }

    stage.addEventListener('pointerdown', event => {
      if (event.button !== 0 || drag) return;
      const vertical = helix && event.pointerType !== 'touch';
      const coordinate = vertical ? event.clientY : event.clientX;
      drag = {id: event.pointerId, vertical, coordinate, start: coordinate, time: performance.now(), moved: false};
      velocity = 0;
      suppressClick = false;
      deferAuto();
    }, options);

    window.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.id) return;
      const coordinate = drag.vertical ? event.clientY : event.clientX;
      if (!drag.moved && Math.abs(coordinate - drag.start) < 5) return;
      if (!drag.moved) {
        drag.moved = true;
        stage.setPointerCapture(event.pointerId);
        stage.classList.add('is-dragging');
      }
      const now = performance.now();
      const delta = (drag.coordinate - coordinate) / pitch;
      position += delta;
      velocity = clamp(delta * 1000 / Math.max(10, now - drag.time), -18, 18);
      drag.coordinate = coordinate;
      drag.time = now;
      render();
    }, options);

    function release(event) {
      if (!drag || event.pointerId !== drag.id) return;
      suppressClick = drag.moved;
      if (!drag.moved || performance.now() - drag.time > 100 || event.type === 'pointercancel') velocity = 0;
      drag = null;
      stage.classList.remove('is-dragging');
      deferAuto();
      if (!helix) {
        target = Math.round(position + clamp(velocity * 0.19, -3, 3));
        if (reducedMotion.matches) {
          position = target;
          velocity = 0;
          render();
        }
      }
    }

    window.addEventListener('pointerup', release, options);
    window.addEventListener('pointercancel', release, options);
    stage.addEventListener('wheel', event => {
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!delta) return;
      event.preventDefault();
      const now = performance.now();
      if (now - lastWheel < 120) return;
      lastWheel = now;
      step(Math.sign(delta));
    }, {...options, passive: false});

    stage.addEventListener('click', event => {
      if (helix || suppressClick) { suppressClick = false; return; }
      const card = event.target.closest('.flow-card');
      if (!card) return;
      target = Number(card.dataset.slot);
      deferAuto();
      if (reducedMotion.matches) {
        position = target;
        velocity = 0;
        render();
      }
    }, options);

    layout.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        step(-1);
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        step(1);
      }
    }, options);

    const resize = new ResizeObserver(measure);
    resize.observe(stage);
    measure();
    const ready = Promise.allSettled(cards.map(card => card.image.decode())).then(() => {
      if (destroyed) return;
      // The helix starts climbing immediately after its first photos are ready.
      if (helix) resumeAt = performance.now();
      else deferAuto();
      frame = requestAnimationFrame(tick);
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

  window.createPhotoCoverflow = function createPhotoCoverflow(viewport, mode, photos) {
    if (mode !== 'helix') return createFlow(viewport, mode, photos);

    const pair = document.createElement('div');
    pair.className = 'helix-pair';
    const lanes = [document.createElement('div'), document.createElement('div')];
    pair.append(...lanes);
    viewport.replaceChildren(pair);

    const midpoint = Math.ceil(photos.length / 2);
    const left = createFlow(lanes[0], mode, photos.slice(0, midpoint), {side: '左侧'});
    const rightPhotos = photos.slice(midpoint);
    const right = createFlow(lanes[1], mode, rightPhotos.length ? rightPhotos : photos, {
      side: '右侧',
      start: 2.5,
    });
    return {
      ready: Promise.all([left.ready, right.ready]),
      destroy() {
        left.destroy();
        right.destroy();
      },
    };
  };
})();
