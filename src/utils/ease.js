// Easing functions, all map t∈[0,1] → [0,1]
const c1 = 1.70158, c2 = c1 * 1.525, c3 = c1 + 1
const c4 = (2 * Math.PI) / 3, c5 = (2 * Math.PI) / 4.5

export const EASE = {
  linear:      (t) => t,
  easeIn:      (t) => t * t,
  easeOut:     (t) => 1 - (1 - t) * (1 - t),
  easeInOut:   (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
  cubicIn:     (t) => t * t * t,
  cubicOut:    (t) => 1 - Math.pow(1 - t, 3),
  cubicInOut:  (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  quartIn:     (t) => t * t * t * t,
  quartOut:    (t) => 1 - Math.pow(1 - t, 4),
  quartInOut:  (t) => t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2,
  expoIn:      (t) => t === 0 ? 0 : Math.pow(2, 10 * t - 10),
  expoOut:     (t) => t === 1 ? 1 : 1 - Math.pow(2, -10 * t),
  expoInOut:   (t) => t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2,
  sineIn:      (t) => 1 - Math.cos((t * Math.PI) / 2),
  sineOut:     (t) => Math.sin((t * Math.PI) / 2),
  sineInOut:   (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  backIn:      (t) => c3 * t * t * t - c1 * t * t,
  backOut:     (t) => 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2),
  backInOut:   (t) => t < 0.5
    ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
    : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2,
  elasticIn:   (t) => t === 0 ? 0 : t === 1 ? 1 : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4),
  elasticOut:  (t) => t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1,
  elasticInOut:(t) => {
    if(t === 0) return 0
    if(t === 1) return 1
    return t < 0.5
      ? -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2
      :  (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 + 1
  },
  bounceOut:   (t) => {
    const n1 = 7.5625, d1 = 2.75
    if(t < 1 / d1)      return n1 * t * t
    else if(t < 2 / d1){ t -= 1.5 / d1;   return n1 * t * t + 0.75 }
    else if(t < 2.5 / d1){ t -= 2.25 / d1; return n1 * t * t + 0.9375 }
    else { t -= 2.625 / d1; return n1 * t * t + 0.984375 }
  },
  bounceIn:    (t) => 1 - EASE.bounceOut(1 - t),
  bounceInOut: (t) => t < 0.5 ? (1 - EASE.bounceOut(1 - 2 * t)) / 2 : (1 + EASE.bounceOut(2 * t - 1)) / 2
}

export const EASE_NAMES = Object.keys(EASE)

export function applyEase(name, t){
  const fn = EASE[name] || EASE.linear
  return fn(Math.max(0, Math.min(1, t)))
}

// Interpolate two states. Both objects have the same numeric keys.
export function lerpState(a, b, t){
  const r = {}
  for(const k of Object.keys(a)){
    if(typeof a[k] === 'number' && typeof b[k] === 'number'){
      r[k] = a[k] + (b[k] - a[k]) * t
    } else {
      r[k] = a[k]
    }
  }
  return r
}
