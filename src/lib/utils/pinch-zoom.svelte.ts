const MAX_SCALE = 5;

export function createPinchZoom() {
  let scale = $state(1);
  let tx = $state(0);
  let ty = $state(0);

  // Layout center and size of the zoomed element — captured at touch start,
  // used throughout the gesture (getBoundingClientRect reflects visual/post-transform
  // position which breaks the focal-point formula).
  let _cx = 0;
  let _cy = 0;
  let _lw = 0;
  let _lh = 0;

  let _pinching = false;
  let _panning = false;
  let _prevDist = 0;
  let _prevFocalX = 0;
  let _prevFocalY = 0;
  let _prevScale = 1;
  let _prevTx = 0;
  let _prevTy = 0;

  function _dist(a: Touch, b: Touch) {
    return Math.sqrt((b.clientX - a.clientX) ** 2 + (b.clientY - a.clientY) ** 2);
  }

  function _clamp(s: number, ntx: number, nty: number) {
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;
    const hw = (_lw * s) / 2;
    const hh = (_lh * s) / 2;
    // lo/hi covers both cases: image larger than viewport (pan bounds) and
    // image smaller than viewport (keep within viewport). tx=0 is always valid
    // when the image is naturally visible, so no jump on pinch start.
    const loX = Math.min(hw - _cx, vpW - hw - _cx);
    const hiX = Math.max(hw - _cx, vpW - hw - _cx);
    const loY = Math.min(hh - _cy, vpH - hh - _cy);
    const hiY = Math.max(hh - _cy, vpH - hh - _cy);
    return {
      tx: Math.max(loX, Math.min(hiX, ntx)),
      ty: Math.max(loY, Math.min(hiY, nty))
    };
  }

  type LayoutRect = { left: number; top: number; width: number; height: number };

  function onTouchStart(e: TouchEvent, layoutRect: LayoutRect): boolean {
    _cx = layoutRect.left + layoutRect.width / 2;
    _cy = layoutRect.top + layoutRect.height / 2;
    _lw = layoutRect.width;
    _lh = layoutRect.height;

    if (e.touches.length >= 2) {
      _pinching = true;
      _panning = false;
      _prevDist = _dist(e.touches[0], e.touches[1]);
      _prevFocalX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      _prevFocalY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      _prevScale = scale;
      _prevTx = tx;
      _prevTy = ty;
      e.preventDefault();
      return true;
    }
    if (e.touches.length === 1 && scale > 1.01) {
      _panning = true;
      _pinching = false;
      _prevFocalX = e.touches[0].clientX;
      _prevFocalY = e.touches[0].clientY;
      _prevTx = tx;
      _prevTy = ty;
      return true;
    }
    return false;
  }

  function onTouchMove(e: TouchEvent): boolean {
    if (e.touches.length >= 2 && _pinching) {
      const newDist = _dist(e.touches[0], e.touches[1]);
      const focalX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const focalY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const newScale = Math.max(1, Math.min(MAX_SCALE, _prevScale * (newDist / _prevDist)));
      const ratio = newScale / _prevScale;

      // _cx/_cy are layout-space constants — correct for focal math
      const newTx = (_prevFocalX - _cx) * (1 - ratio) + _prevTx * ratio + (focalX - _prevFocalX);
      const newTy = (_prevFocalY - _cy) * (1 - ratio) + _prevTy * ratio + (focalY - _prevFocalY);
      const c = _clamp(newScale, newTx, newTy);

      scale = newScale;
      tx = c.tx;
      ty = c.ty;
      _prevDist = newDist;
      _prevFocalX = focalX;
      _prevFocalY = focalY;
      _prevScale = newScale;
      _prevTx = c.tx;
      _prevTy = c.ty;
      e.preventDefault();
      return true;
    }
    if (e.touches.length === 1 && _panning && scale > 1.01) {
      const dx = e.touches[0].clientX - _prevFocalX;
      const dy = e.touches[0].clientY - _prevFocalY;
      const c = _clamp(scale, _prevTx + dx, _prevTy + dy);
      tx = c.tx;
      ty = c.ty;
      _prevFocalX = e.touches[0].clientX;
      _prevFocalY = e.touches[0].clientY;
      _prevTx = tx;
      _prevTy = ty;
      e.preventDefault();
      return true;
    }
    return false;
  }

  function onTouchEnd(e: TouchEvent): boolean {
    if (e.touches.length < 2) _pinching = false;
    if (e.touches.length === 0) {
      _panning = false;
      return scale > 1.01;
    }
    if (e.touches.length === 1 && scale > 1.01) {
      _panning = true;
      _pinching = false;
      _prevFocalX = e.touches[0].clientX;
      _prevFocalY = e.touches[0].clientY;
      _prevTx = tx;
      _prevTy = ty;
      return true;
    }
    return scale > 1.01;
  }

  function reset() {
    scale = 1;
    tx = 0;
    ty = 0;
    _pinching = false;
    _panning = false;
    _prevScale = 1;
    _prevTx = 0;
    _prevTy = 0;
  }

  return {
    get scale() {
      return scale;
    },
    get tx() {
      return tx;
    },
    get ty() {
      return ty;
    },
    get active() {
      return scale > 1.01;
    },
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    reset
  };
}
