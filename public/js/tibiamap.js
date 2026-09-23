/* TibiaMaps-style canvas map viewer using real Tibia automap tiles from tibiamaps.github.io */
(function () {
  'use strict';
  const TILE_BASE = 'https://tibiamaps.github.io/tibia-map-data/mapper/';
  const MIN_X = 31744, MAX_X = 34304, MIN_Y = 30976, MAX_Y = 33024;
  const ZOOMS = [1, 2, 4, 7, 14, 25];

  window.TibiaMap = function (container, opts) {
    opts = opts || {};
    const canvas = document.createElement('canvas');
    canvas.width = container.clientWidth || 800;
    canvas.height = container.clientHeight || 600;
    container.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    let cx = opts.x || 32369, cy = opts.y || 32241, floor = opts.z !== undefined ? opts.z : 7;
    let zi = opts.zoom || 2, scale = ZOOMS[zi];
    let tileCache = new Map();
    let tileErrors = 0, tileLoads = 0;
    let markers = []; let cities = [];
    let showSpots = true, showCities = true;
    let dragging = false, dragMoved = false, lastX = 0, lastY = 0;
    let hoverMarker = null;
    const labelEl = document.createElement('div');
    labelEl.className = 'map-marker-label';
    labelEl.style.display = 'none';
    container.appendChild(labelEl);

    const floorLabel = (f) => f === 7 ? '0' : (f < 7 ? '+' + (7 - f) : '-' + (f - 7));

    function tileKey(tx, ty) { return tx + '_' + ty + '_' + floor; }
    function loadTile(tx, ty) {
      const k = tileKey(tx, ty);
      if (tileCache.has(k)) return tileCache.get(k);
      const img = new Image();
      img.onload = () => { tileLoads++; draw(); };
      img.onerror = () => { tileErrors++; if (tileErrors > 6 && tileLoads === 0) draw(); };
      img.src = TILE_BASE + 'Minimap_Color_' + k + '.png';
      tileCache.set(k, img);
      return img;
    }
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

    function draw() {
      const w = canvas.width, h = canvas.height;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      const left = cx - w / 2 / scale, top = cy - h / 2 / scale;
      if (tileErrors > 6 && tileLoads === 0) {
        // offline fallback: grid + notice (tiles need internet)
        ctx.strokeStyle = '#1c1c2c';
        for (let gx = 0; gx < w; gx += 32) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke(); }
        for (let gy = 0; gy < h; gy += 32) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke(); }
        ctx.fillStyle = '#8b8ba0';
        ctx.font = '13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Kafelki mapy wymagają połączenia z internetem (tibiamaps.io).', w / 2, 24);
        ctx.fillText('Znaczniki poniżej działają nadal — kliknij je, aby otworzyć spoty.', w / 2, 42);
        ctx.textAlign = 'left';
      }
      const tx0 = Math.floor(clamp(left, MIN_X, MAX_X) / 256);
      const tx1 = Math.floor(clamp(left + w / scale, MIN_X, MAX_X) / 256);
      const ty0 = Math.floor(clamp(top, MIN_Y, MAX_Y) / 256);
      const ty1 = Math.floor(clamp(top + h / scale, MIN_Y, MAX_Y) / 256);
      for (let tx = tx0; tx <= tx1; tx++) {
        for (let ty = ty0; ty <= ty1; ty++) {
          const img = loadTile(tx * 256, ty * 256);
          if (img.complete && img.naturalWidth) {
            ctx.drawImage(img, Math.round((tx * 256 - left) * scale), Math.round((ty * 256 - top) * scale), Math.ceil(256 * scale), Math.ceil(256 * scale));
          }
        }
      }
      // markers
      if (showCities) for (const c of cities) drawCity(c, left, top);
      if (showSpots) for (const m of markers) drawMarker(m, left, top);
      // coords
      if (opts.onCoords) opts.onCoords(Math.floor(cx), Math.floor(cy), floor);
    }

    function px(x, left) { return Math.round((x - left) * scale); }
    function py(y, top) { return Math.round((y - top) * scale); }

    function drawMarker(m, left, top) {
      if (m.z !== floor) return;
      const x = px(m.x + 0.5, left), y = py(m.y + 0.5, top);
      if (x < -20 || y < -20 || x > canvas.width + 20 || y > canvas.height + 20) return;
      const r = m === hoverMarker ? 8 : 6;
      const col = m.approx ? '#e0a252' : '#e05252';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = col; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
      if (scale >= 7 || m === hoverMarker) {
        ctx.font = '11px sans-serif';
        ctx.fillStyle = 'rgba(0,0,0,.75)';
        const tw = ctx.measureText(m.name).width;
        ctx.fillRect(x - tw / 2 - 3, y - r - 18, tw + 6, 14);
        ctx.fillStyle = '#f0cd6e';
        ctx.textAlign = 'center';
        ctx.fillText(m.name, x, y - r - 7);
        ctx.textAlign = 'left';
      }
    }
    function drawCity(c, left, top) {
      if (c.z !== floor) return;
      const x = px(c.x + 0.5, left), y = py(c.y + 0.5, top);
      if (x < -20 || y < -20 || x > canvas.width + 20 || y > canvas.height + 20) return;
      ctx.fillStyle = '#d4a941';
      ctx.strokeStyle = '#000';
      ctx.beginPath();
      ctx.moveTo(x, y - 7); ctx.lineTo(x + 6, y); ctx.lineTo(x, y + 7); ctx.lineTo(x - 6, y); ctx.closePath();
      ctx.fill(); ctx.stroke();
      if (scale >= 4) {
        ctx.font = 'bold 12px sans-serif';
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.lineWidth = 3;
        ctx.textAlign = 'center';
        ctx.strokeText(c.name, x, y - 12);
        ctx.fillText(c.name, x, y - 12);
        ctx.textAlign = 'left';
      }
    }

    function pick(mx, my) {
      const left = cx - canvas.width / 2 / scale, top = cy - canvas.height / 2 / scale;
      let best = null, bd = 12;
      const test = (m, r) => {
        if (m.z !== floor) return;
        const d = Math.hypot(px(m.x + 0.5, left) - mx, py(m.y + 0.5, top) - my);
        if (d < bd) { bd = d; best = Object.assign({ kind: r }, m); }
      };
      if (showSpots) for (const m of markers) test(m, 'spot');
      if (showCities) for (const c of cities) test(c, 'city');
      return best;
    }

    canvas.addEventListener('mousedown', e => { dragging = true; dragMoved = false; lastX = e.clientX; lastY = e.clientY; canvas.style.cursor = 'grabbing'; });
    window.addEventListener('mouseup', () => { dragging = false; canvas.style.cursor = 'grab'; });
    canvas.addEventListener('mousemove', e => {
      if (dragging) {
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved = true;
        cx = clamp(cx - dx / scale, MIN_X + 100, MAX_X - 100);
        cy = clamp(cy - dy / scale, MIN_Y + 100, MAX_Y - 100);
        lastX = e.clientX; lastY = e.clientY;
        draw();
      } else {
        const r = canvas.getBoundingClientRect();
        const m = pick(e.clientX - r.left, e.clientY - r.top);
        hoverMarker = m && m.kind === 'spot' ? m : null;
        labelEl.style.display = m ? 'block' : 'none';
        if (m) { labelEl.textContent = m.name + (m.kind === 'city' ? ' (miasto)' : ' · lv ' + (m.recLevel || '')); labelEl.style.left = (e.clientX - r.left) + 'px'; labelEl.style.top = (e.clientY - r.top) + 'px'; }
        canvas.style.cursor = m ? 'pointer' : 'grab';
        draw();
      }
    });
    canvas.addEventListener('mouseleave', () => { hoverMarker = null; labelEl.style.display = 'none'; draw(); });
    canvas.addEventListener('click', e => {
      if (dragMoved) return;
      const r = canvas.getBoundingClientRect();
      const m = pick(e.clientX - r.left, e.clientY - r.top);
      if (m && opts.onSelect) opts.onSelect(m);
    });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      zi = clamp(zi + (e.deltaY < 0 ? 1 : -1), 0, ZOOMS.length - 1);
      scale = ZOOMS[zi];
      draw();
    }, { passive: false });
    // touch
    let touchDist = 0;
    canvas.addEventListener('touchstart', e => {
      if (e.touches.length === 1) { dragging = true; dragMoved = false; lastX = e.touches[0].clientX; lastY = e.touches[0].clientY; }
      if (e.touches.length === 2) touchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    }, { passive: true });
    canvas.addEventListener('touchmove', e => {
      e.preventDefault();
      if (e.touches.length === 1 && dragging) {
        const dx = e.touches[0].clientX - lastX, dy = e.touches[0].clientY - lastY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved = true;
        cx = clamp(cx - dx / scale, MIN_X, MAX_X); cy = clamp(cy - dy / scale, MIN_Y, MAX_Y);
        lastX = e.touches[0].clientX; lastY = e.touches[0].clientY; draw();
      } else if (e.touches.length === 2) {
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        if (Math.abs(d - touchDist) > 30) { zi = clamp(zi + (d > touchDist ? 1 : -1), 0, ZOOMS.length - 1); scale = ZOOMS[zi]; touchDist = d; draw(); }
      }
    }, { passive: false });
    canvas.addEventListener('touchend', e => {
      dragging = false;
      if (!dragMoved && e.changedTouches.length === 1) {
        const r = canvas.getBoundingClientRect();
        const t = e.changedTouches[0];
        const m = pick(t.clientX - r.left, t.clientY - r.top);
        if (m && opts.onSelect) opts.onSelect(m);
      }
    });

    function resize() {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      draw();
    }
    window.addEventListener('resize', resize);

    return {
      setMarkers: (m) => { markers = m; draw(); },
      setCities: (c) => { cities = c; draw(); },
      centerOn: (x, y, z, zoomIdx) => { cx = x + 0.5; cy = y + 0.5; if (z !== undefined) floor = z; if (zoomIdx !== undefined) { zi = zoomIdx; scale = ZOOMS[zi]; } tileCache.clear(); draw(); },
      zoom: (dir) => { zi = clamp(zi + dir, 0, ZOOMS.length - 1); scale = ZOOMS[zi]; draw(); },
      floorUp: () => { if (floor > 0) { floor--; tileCache.clear(); draw(); } return floor; },
      floorDown: () => { if (floor < 15) { floor++; tileCache.clear(); draw(); } return floor; },
      setFloor: (f) => { floor = clamp(f, 0, 15); tileCache.clear(); draw(); return floor; },
      setShowSpots: v => { showSpots = v; draw(); },
      setShowCities: v => { showCities = v; draw(); },
      resize, draw
    };
  };
})();
