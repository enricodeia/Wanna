import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { createEngine, transformShapePoints, shapeCentroid } from './engine/gl.js'
import { EFFECTS, defaultValues } from './effects/index.js'
import ParamControl from './components/ParamControl.jsx'

const GROUPS = ['3D MAPPING', 'INTERACT', 'DISTORT', 'PRINT', 'PATTERN', 'COLOR', 'LIGHT', 'STYLIZE', 'FOCUS', 'GLITCH']

const ASPECTS = [
  { id: '1:1',  w: 1, h: 1 },
  { id: '4:3',  w: 4, h: 3 },
  { id: '3:4',  w: 3, h: 4 },
  { id: '16:9', w: 16, h: 9 },
  { id: '9:16', w: 9, h: 16 }
]

const SAMPLES = [
  { name: 'Boucher · Toilette of Venus', url: '/p1.jpg' },
  { name: 'Fragonard · The Stolen Kiss', url: '/p2.jpg' },
  { name: 'Chardin · Soap Bubbles',      url: '/p3.jpg' },
  { name: 'Tiepolo · Glorification',     url: '/p4.jpg' },
  { name: 'Cranach · Martyrdom',         url: '/p5.jpg' },
  { name: 'Manet · The Monet Family',    url: '/p6.jpg' },
  { name: 'Degas · The Dance Class',     url: '/p7.jpg' },
  { name: 'Cézanne · The Card Players',  url: '/p8.jpg' },
  { name: 'Van Gogh · Wheat Field',      url: '/p9.jpg' },
  { name: 'Labille-Guiard · Self-Portrait', url: '/p10.jpg' },
  { name: 'Romanino · Flagellation',     url: '/p11.jpg' },
  { name: 'Jacometto · Portrait',        url: '/p12.jpg' }
]

const REC_OPTIONS = [5, 10, 15, 30]
const DEFAULT_TRANSFORM = { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 }
const DEFAULT_FOLLOW = { momentum: 0.18, intensityX: 1.0, intensityY: 1.0 }
const DEFAULT_MASK = { on: false, radius: 0.3, softness: 0.3, feather: 0.15, invert: false }
const BLEND_MODES = [
  ['normal', 0], ['multiply', 1], ['screen', 2], ['overlay', 3], ['soft light', 4],
  ['darken', 5], ['lighten', 6], ['difference', 7], ['exclusion', 8],
  ['color dodge', 9], ['color burn', 10], ['add', 11], ['subtract', 12]
]
const BLEND_MAP = ['normal','multiply','screen','overlay','softlight','darken','lighten','difference','exclusion','dodge','burn','add','subtract']

// ============ Shape primitive generators ============
const PRIMITIVES = [
  { id: 'rect',     label: '+ RECT',     icon: '▭' },
  { id: 'circle',   label: '+ CIRCLE',   icon: '○' },
  { id: 'triangle', label: '+ TRIANGLE', icon: '△' },
  { id: 'star',     label: '+ STAR',     icon: '☆' },
  { id: 'hex',      label: '+ HEXAGON',  icon: '⬡' }
]
function generatePrimitive(kind, cx = 0.5, cy = 0.5, size = 0.18){
  const pts = []
  if(kind === 'rect'){
    pts.push(cx - size, cy - size,  cx + size, cy - size,
             cx + size, cy + size,  cx - size, cy + size)
  } else if(kind === 'circle'){
    const N = 32
    for(let i = 0; i < N; i++){
      const a = (i / N) * Math.PI * 2
      pts.push(cx + Math.cos(a) * size, cy + Math.sin(a) * size)
    }
  } else if(kind === 'triangle'){
    pts.push(cx, cy - size,
             cx + size * 0.866, cy + size * 0.5,
             cx - size * 0.866, cy + size * 0.5)
  } else if(kind === 'star'){
    const N = 10
    for(let i = 0; i < N; i++){
      const a = (i / N) * Math.PI * 2 - Math.PI / 2
      const r = (i % 2 === 0) ? size : size * 0.45
      pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
    }
  } else if(kind === 'hex'){
    for(let i = 0; i < 6; i++){
      const a = (i / 6) * Math.PI * 2
      pts.push(cx + Math.cos(a) * size, cy + Math.sin(a) * size)
    }
  }
  return pts
}

const generateImageThumb = (img, size = 46) => {
  const c = document.createElement('canvas')
  c.width = size; c.height = size
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#f7f7f7'; ctx.fillRect(0, 0, size, size)
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height
  const ar = w / h
  let cw = size, ch = size, ox = 0, oy = 0
  if(ar > 1){ ch = size / ar; oy = (size - ch) / 2 } else { cw = size * ar; ox = (size - cw) / 2 }
  try { ctx.drawImage(img, ox, oy, cw, ch) } catch(e){}
  return c.toDataURL('image/png')
}
const renderTextToCanvas = (text, font = 'Inter, system-ui, sans-serif', size = 96, color = [0, 0, 0], bold = true) => {
  const c = document.createElement('canvas')
  const tmp = c.getContext('2d')
  tmp.font = `${bold ? '700 ' : ''}${size}px ${font}`
  const m = tmp.measureText(text || ' ')
  const w = Math.max(8, Math.ceil(m.width)) + 24
  const h = Math.ceil(size * 1.5)
  c.width = w; c.height = h
  const ctx = c.getContext('2d')
  ctx.font = `${bold ? '700 ' : ''}${size}px ${font}`
  ctx.fillStyle = `rgb(${Math.round(color[0]*255)}, ${Math.round(color[1]*255)}, ${Math.round(color[2]*255)})`
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 12, h / 2)
  return c
}
const rgb2hex = (c) => '#' + c.map(x => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('')
const hex2rgb = (h) => { const s = h.replace('#', ''); return [parseInt(s.slice(0,2),16)/255, parseInt(s.slice(2,4),16)/255, parseInt(s.slice(4,6),16)/255] }

function ShapeThumb({ shape }){
  const points = shape.points
  if(!points || points.length < 6) return <span className="thumb empty"/>
  let mx = Infinity, my = Infinity, Mx = -Infinity, My = -Infinity
  for(let i = 0; i < points.length; i += 2){
    if(points[i] < mx) mx = points[i]; if(points[i+1] < my) my = points[i+1]
    if(points[i] > Mx) Mx = points[i]; if(points[i+1] > My) My = points[i+1]
  }
  const w = Mx - mx || 1, h = My - my || 1
  const scale = Math.min(36 / w, 36 / h)
  const cx = (Mx + mx) / 2, cy = (My + my) / 2
  let poly = ''
  for(let i = 0; i < points.length; i += 2){
    const x = (points[i] - cx) * scale + 23
    const y = (points[i+1] - cy) * scale + 23
    poly += `${x.toFixed(1)},${y.toFixed(1)} `
  }
  const hex = '#' + shape.fill.map(c => Math.round(Math.max(0, Math.min(1, c))*255).toString(16).padStart(2,'0')).join('')
  return (
    <svg viewBox="0 0 46 46" width="46" height="46" className="thumb">
      <rect x="0" y="0" width="46" height="46" fill="#f7f7f7"/>
      <defs>
        {shape.imageTex && shape.imgThumbnail && (
          <pattern id={`pat-${shape.uid}`} patternUnits="userSpaceOnUse" width="46" height="46">
            <image href={shape.imgThumbnail} x="0" y="0" width="46" height="46" preserveAspectRatio="xMidYMid slice"/>
          </pattern>
        )}
      </defs>
      <polygon points={poly.trim()}
        fill={shape.imageTex && shape.imgThumbnail ? `url(#pat-${shape.uid})` : hex}
        stroke="rgba(0,0,0,0.3)" strokeWidth="0.5"/>
    </svg>
  )
}

function EffectThumb({ layer }){
  const fx = EFFECTS[layer.effectId]
  const initial = fx ? fx.label.charAt(0) : '?'
  return (
    <span className="thumb effect-thumb">
      <span className="effect-thumb-letter">{initial}</span>
      {layer.mask?.on && <span className="effect-thumb-mask">⊙</span>}
    </span>
  )
}

const layerLabel = (l) => {
  if(l.type === 'effect') return EFFECTS[l.effectId]?.label || l.effectId
  return l.name
}
const typeBadge = (l) => {
  if(l.type === 'image') return 'IMG'
  if(l.type === 'shape') return 'SHP'
  if(l.type === 'text')  return 'TXT'
  if(l.type === 'effect') return 'FX'
  return '?'
}

// ============ App ============
export default function App(){
  const canvasRef = useRef(null)
  const engineRef = useRef(null)
  const [err, setErr] = useState(null)

  const [aspect, setAspect] = useState('1:1')
  const [bg] = useState([1, 1, 1])
  const [search, setSearch] = useState('')
  const [tool, setTool] = useState('select')
  const [penColor, setPenColor] = useState([0.05, 0.05, 0.05])
  const [textDraft, setTextDraft] = useState(null)

  // Single unified layer stack — bottom to top
  const [layers, _setLayersRaw] = useState([])
  const [selectedUid, setSelectedUid] = useState(null)
  const [drawing, setDrawing] = useState({ active: false, points: [] })
  const [collapsedCats, setCollapsedCats] = useState(() => new Set(GROUPS))
  // Layer rename state: { uid, value } when actively renaming
  const [renaming, setRenaming] = useState(null)
  // Drag-reorder state: { uid, overUid, position } where position is 'before'/'after'
  const [dragOver, setDragOver] = useState(null)
  const dragUidRef = useRef(null)
  // Drag-from-library: holds the effect id while it's being dragged
  const dragEffectIdRef = useRef(null)
  const [dragEffectOverUid, setDragEffectOverUid] = useState(null)

  const [recDuration, setRecDuration] = useState(5)
  const [recording, setRecording] = useState(false)
  const [recCountdown, setRecCountdown] = useState(0)
  const recorderRef = useRef(null)

  const stateRef = useRef(layers); stateRef.current = layers
  const bgRef = useRef(bg); bgRef.current = bg
  const mouseTargetRef = useRef({ x: 0.5, y: 0.5 })
  const followStateRef = useRef(new Map())

  // ============ History ============
  const historyRef = useRef({ past: [], future: [] })
  const pendingRef = useRef(null)
  const commitTimerRef = useRef(null)
  const [, setHistoryTick] = useState(0)
  const flushPending = () => {
    clearTimeout(commitTimerRef.current)
    if(pendingRef.current !== null){
      historyRef.current.past.push(pendingRef.current)
      if(historyRef.current.past.length > 100) historyRef.current.past.shift()
      historyRef.current.future = []
      pendingRef.current = null
      setHistoryTick(t => t + 1)
    }
  }
  const setLayers = (updater, opts = {}) => {
    _setLayersRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      if(opts.skipHistory) return next
      if(pendingRef.current === null) pendingRef.current = prev
      clearTimeout(commitTimerRef.current)
      commitTimerRef.current = setTimeout(flushPending, 400)
      return next
    })
  }
  const undo = () => {
    flushPending()
    if(historyRef.current.past.length === 0) return
    _setLayersRaw(prev => {
      const restore = historyRef.current.past.pop()
      historyRef.current.future.unshift(prev)
      setHistoryTick(t => t + 1)
      return restore
    })
  }
  const redo = () => {
    flushPending()
    if(historyRef.current.future.length === 0) return
    _setLayersRaw(prev => {
      const next = historyRef.current.future.shift()
      historyRef.current.past.push(prev)
      setHistoryTick(t => t + 1)
      return next
    })
  }

  // ============ Engine bootstrap ============
  useEffect(() => {
    const canvas = canvasRef.current
    let eng
    try {
      eng = createEngine(canvas)
      engineRef.current = eng
      for(const id of Object.keys(EFFECTS)){
        try { eng.registerEffect(id, EFFECTS[id].fs) }
        catch(shaderErr){ console.error(`[bianca] effect "${id}":`, shaderErr); throw new Error(`effect "${id}": ${shaderErr.message || shaderErr}`) }
      }
    } catch (e){ console.error('[bianca] engine bootstrap failed:', e); setErr(e.message || String(e)); return }

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      eng.resize(Math.max(1, Math.floor(rect.width * dpr)), Math.max(1, Math.floor(rect.height * dpr)))
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    let raf
    const tick = (tMs) => {
      const time = tMs * 0.001
      const target = mouseTargetRef.current

      const updateSmooth = (uid, fSet) => {
        let s = followStateRef.current.get(uid)
        if(!s){ s = { x: 0.5, y: 0.5 }; followStateRef.current.set(uid, s) }
        s.x += (target.x - s.x) * fSet.momentum * fSet.intensityX
        s.y += (target.y - s.y) * fSet.momentum * fSet.intensityY
        return s
      }
      let gs = followStateRef.current.get('__global__')
      if(!gs){ gs = { x: 0.5, y: 0.5 }; followStateRef.current.set('__global__', gs) }
      gs.x += (target.x - gs.x) * DEFAULT_FOLLOW.momentum
      gs.y += (target.y - gs.y) * DEFAULT_FOLLOW.momentum

      // Build layers-for-render with follow applied
      const layersForRender = stateRef.current.map(l => {
        if(!l._follow) return l
        const f = l._followCfg || DEFAULT_FOLLOW
        const s = updateSmooth(l.uid, f)
        if(l.type === 'effect'){
          const fx = EFFECTS[l.effectId]
          if(!fx?.followCursor) return l
          const v = { ...l.values }
          if(fx.followCursor[0]) v[fx.followCursor[0]] = s.x
          if(fx.followCursor[1]) v[fx.followCursor[1]] = 1 - s.y
          return { ...l, values: v }
        }
        const cx = s.x, cy = 1 - s.y
        if(l.type === 'shape'){
          const [scX, scY] = shapeCentroid(l.points)
          return { ...l, x: cx - scX, y: cy - scY }
        }
        return { ...l, transform: { ...l.transform, x: cx, y: cy } }
      })

      eng.render({
        layers: layersForRender,
        time,
        bg: bgRef.current,
        mouse: gs
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [])

  const [resizeTick, setResizeTick] = useState(0)
  useEffect(() => {
    const onResize = () => setResizeTick(x => x + 1)
    window.addEventListener('resize', onResize)
    let ro
    if(canvasRef.current?.parentElement){
      ro = new ResizeObserver(onResize)
      ro.observe(canvasRef.current.parentElement)
    }
    return () => { window.removeEventListener('resize', onResize); ro?.disconnect() }
  }, [])

  // ============ Image loading ============
  const addImage = useCallback((src, name) => {
    if(!engineRef.current) return
    const img = new Image()
    img.onload = () => {
      const tex = engineRef.current.uploadTexture(img)
      const thumbnail = generateImageThumb(img)
      setLayers((s) => {
        const idx = s.length
        const t = { ...DEFAULT_TRANSFORM,
          x: idx === 0 ? 0.5 : 0.3 + (idx % 3) * 0.2,
          y: idx === 0 ? 0.5 : 0.3 + Math.floor(idx / 3) * 0.2,
          scale: idx === 0 ? 1 : 0.45
        }
        const layer = {
          uid: crypto.randomUUID(), type: 'image',
          name: name || ('image-' + (idx + 1)),
          tex, imgW: img.naturalWidth, imgH: img.naturalHeight,
          thumbnail, visible: true, _follow: false, transform: t
        }
        setSelectedUid(layer.uid)
        return [...s, layer]
      })
    }
    img.onerror = () => console.warn('image load failed', src)
    img.src = src
  }, [])
  const addImageBitmap = (bitmap, name) => {
    if(!engineRef.current) return
    const tex = engineRef.current.uploadTexture(bitmap)
    const thumbnail = generateImageThumb(bitmap)
    setLayers((s) => {
      const idx = s.length
      const t = { ...DEFAULT_TRANSFORM,
        x: idx === 0 ? 0.5 : 0.3 + (idx % 3) * 0.2,
        y: idx === 0 ? 0.5 : 0.3 + Math.floor(idx / 3) * 0.2,
        scale: idx === 0 ? 1 : 0.45
      }
      const layer = {
        uid: crypto.randomUUID(), type: 'image',
        name: name || ('image-' + (idx + 1)),
        tex, imgW: bitmap.width, imgH: bitmap.height,
        thumbnail, visible: true, _follow: false, transform: t
      }
      setSelectedUid(layer.uid)
      return [...s, layer]
    })
  }
  const onUpload = async (files) => {
    if(!files) return
    for(const file of files){
      if(!file.type.startsWith('image/')) continue
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
        addImageBitmap(bitmap, file.name)
      } catch(e){
        const url = URL.createObjectURL(file)
        addImage(url, file.name)
      }
    }
  }
  const onUploadInput = (e) => onUpload(e.target.files)

  const assignImageToShape = useCallback(async (shapeUid, file) => {
    if(!engineRef.current || !file) return
    let source, w, h, thumb
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      source = bitmap; w = bitmap.width; h = bitmap.height
      thumb = generateImageThumb(bitmap)
    } catch(e){
      await new Promise((res) => {
        const img = new Image()
        img.onload = () => { source = img; w = img.naturalWidth; h = img.naturalHeight; thumb = generateImageThumb(img); res() }
        img.onerror = () => res()
        img.src = URL.createObjectURL(file)
      })
      if(!source) return
    }
    const tex = engineRef.current.uploadTexture(source)
    setLayers((s) => s.map(l => l.uid === shapeUid ? {
      ...l, imageTex: tex, imgThumbnail: thumb, imgW: w, imgH: h,
      imageFit: l.imageFit || 'cover', tileScale: l.tileScale || 3
    } : l))
  }, [])
  const clearShapeImage = (shapeUid) => {
    setLayers((s) => s.map(l => {
      if(l.uid !== shapeUid) return l
      if(l.imageTex && engineRef.current) engineRef.current.deleteTexture(l.imageTex)
      const { imageTex, imgThumbnail, ...rest } = l
      return rest
    }))
  }

  useEffect(() => {
    const onDragOver = (e) => e.preventDefault()
    const onDrop = (e) => { e.preventDefault(); onUpload(e.dataTransfer.files) }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  const initRef = useRef(false)
  useEffect(() => {
    if(initRef.current) return
    initRef.current = true
    addImage('/p1.jpg', 'Boucher · Toilette of Venus')
  }, [addImage])

  // ============ Layer ops ============
  const removeLayer = (uid) => {
    setLayers((s) => {
      const l = s.find(x => x.uid === uid)
      if(l && l.tex && engineRef.current) engineRef.current.deleteTexture(l.tex)
      if(l && l.imageTex && engineRef.current) engineRef.current.deleteTexture(l.imageTex)
      return s.filter(x => x.uid !== uid)
    })
    if(selectedUid === uid) setSelectedUid(null)
    followStateRef.current.delete(uid)
  }
  const duplicateLayer = (uid) => {
    setLayers((s) => {
      const i = s.findIndex(x => x.uid === uid)
      if(i < 0) return s
      const src = s[i]
      let dup
      if(src.type === 'shape'){
        dup = { ...src, uid: crypto.randomUUID(), points: [...src.points],
          x: (src.x || 0) + 0.05, y: (src.y || 0) + 0.05 }
      } else if(src.type === 'effect'){
        dup = { ...src, uid: crypto.randomUUID(), values: { ...src.values },
          mask: src.mask ? { ...src.mask } : { ...DEFAULT_MASK } }
      } else {
        dup = { ...src, uid: crypto.randomUUID(),
          transform: { ...src.transform, x: src.transform.x + 0.05, y: src.transform.y + 0.05 } }
      }
      setSelectedUid(dup.uid)
      return [...s.slice(0, i + 1), dup, ...s.slice(i + 1)]
    })
  }
  const moveLayerZ = (uid, dir) => {
    setLayers((s) => {
      const i = s.findIndex(x => x.uid === uid)
      const j = i + dir
      if(i < 0 || j < 0 || j >= s.length) return s
      const next = [...s]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }
  const setLayerZ = (uid, newIdx) => {
    setLayers((s) => {
      const i = s.findIndex(x => x.uid === uid)
      if(i < 0) return s
      const j = Math.max(0, Math.min(s.length - 1, Math.round(newIdx)))
      if(i === j) return s
      const next = [...s]
      const [item] = next.splice(i, 1)
      next.splice(j, 0, item)
      return next
    })
  }
  const toggleLayerVisible = (uid) => {
    setLayers((s) => s.map(l => l.uid === uid ? { ...l, visible: !l.visible } : l))
  }
  const toggleLayerFollow = (uid) => {
    setLayers((s) => s.map(l => l.uid === uid ? {
      ...l, _follow: !l._follow, _followCfg: l._followCfg || { ...DEFAULT_FOLLOW }
    } : l))
  }
  const updateLayerFollowCfg = (uid, key, value) => {
    setLayers((s) => s.map(l => l.uid === uid ? {
      ...l, _followCfg: { ...(l._followCfg || DEFAULT_FOLLOW), [key]: value }
    } : l))
  }
  const updateImageTransform = (uid, key, value) => {
    setLayers((s) => s.map(l => l.uid === uid && (l.type === 'image' || l.type === 'text') ? {
      ...l, transform: { ...l.transform, [key]: value }
    } : l))
  }
  const updateShapeField = (uid, key, value) => {
    setLayers((s) => s.map(l => l.uid === uid && l.type === 'shape' ? { ...l, [key]: value } : l))
  }
  const updateShapeVertex = (uid, idx, x, y) => {
    setLayers((s) => s.map(l => {
      if(l.uid !== uid || l.type !== 'shape') return l
      const points = [...l.points]
      points[idx * 2] = x; points[idx * 2 + 1] = y
      return { ...l, points }
    }))
  }
  const updateText = (uid, key, value) => {
    setLayers((s) => s.map(l => {
      if(l.uid !== uid || l.type !== 'text') return l
      const updated = { ...l, [key]: value }
      const c = renderTextToCanvas(updated.text, updated.font, updated.size, updated.color)
      if(engineRef.current){
        if(updated.tex) engineRef.current.deleteTexture(updated.tex)
        updated.tex = engineRef.current.uploadTexture(c)
        updated.imgW = c.width; updated.imgH = c.height
        updated.thumbnail = c.toDataURL('image/png')
        updated.name = (updated.text || '').slice(0, 24) || 'text'
      }
      return updated
    }))
  }
  const updateEffectValue = (uid, key, value) => {
    setLayers((s) => s.map(l => l.uid === uid && l.type === 'effect' ? {
      ...l, values: { ...l.values, [key]: value }
    } : l))
  }
  const resetEffect = (uid) => {
    setLayers((s) => s.map(l => l.uid === uid && l.type === 'effect' ? {
      ...l, values: defaultValues(l.effectId)
    } : l))
  }
  const updateMask = (uid, key, value) => {
    setLayers((s) => s.map(l => l.uid === uid && l.type === 'effect' ? {
      ...l, mask: { ...(l.mask || DEFAULT_MASK), [key]: value }
    } : l))
  }
  const toggleMask = (uid) => {
    setLayers((s) => s.map(l => l.uid === uid && l.type === 'effect' ? {
      ...l, mask: { ...(l.mask || DEFAULT_MASK), on: !(l.mask?.on) }
    } : l))
  }
  const centerLayer = (uid) => {
    setLayers((s) => s.map(l => {
      if(l.uid !== uid) return l
      if(l.type === 'shape'){
        const [scX, scY] = shapeCentroid(l.points)
        return { ...l, x: 0.5 - scX, y: 0.5 - scY }
      }
      if(l.type === 'image' || l.type === 'text'){
        return { ...l, transform: { ...l.transform, x: 0.5, y: 0.5 } }
      }
      return l
    }))
  }
  const resetLayer = (uid) => {
    setLayers((s) => s.map(l => {
      if(l.uid !== uid) return l
      if(l.type === 'shape') return { ...l, x: 0, y: 0, opacity: 1, scale: 1, rotation: 0, cornerRadius: 0 }
      if(l.type === 'image' || l.type === 'text') return { ...l, transform: { ...DEFAULT_TRANSFORM } }
      if(l.type === 'effect') return { ...l, values: defaultValues(l.effectId) }
      return l
    }))
  }

  const addPrimitive = (kind) => {
    const points = generatePrimitive(kind)
    setLayers((s) => {
      const shape = {
        uid: crypto.randomUUID(), type: 'shape',
        name: kind,
        visible: true, _follow: false,
        points,
        fill: [...penColor], opacity: 1,
        x: 0, y: 0, scale: 1, rotation: 0, cornerRadius: 0,
        blendMode: 'normal'
      }
      setSelectedUid(shape.uid)
      return [...s, shape]
    })
  }

  const renameLayer = (uid, newName) => {
    setLayers((s) => s.map(l => l.uid === uid ? { ...l, name: newName } : l))
  }
  const setLayerBlendMode = (uid, mode) => {
    setLayers((s) => s.map(l => l.uid === uid ? { ...l, blendMode: mode } : l))
  }

  // Drag-to-reorder. Layers are displayed in REVERSE array order, so we reorder by uid.
  const onLayerDragStart = (e, uid) => {
    dragUidRef.current = uid
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', uid) } catch(_){}
  }
  const onLayerDragOver = (e, overUid, layer) => {
    // Effect-from-library drag: highlight any sprite/shape/text layer card as a drop target.
    if(dragEffectIdRef.current){
      if(layer && layer.type !== 'effect'){
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setDragEffectOverUid(overUid)
      }
      return
    }
    if(!dragUidRef.current || dragUidRef.current === overUid) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = e.currentTarget.getBoundingClientRect()
    const position = (e.clientY - rect.top) < rect.height / 2 ? 'before' : 'after'
    setDragOver({ overUid, position })
  }
  const onLayerDragLeave = () => { setDragOver(null); setDragEffectOverUid(null) }
  const onLayerDrop = (e, overUid, layer) => {
    e.preventDefault()
    // Effect from library dropped onto a sprite/shape/text layer → scope it.
    if(dragEffectIdRef.current){
      const fxId = dragEffectIdRef.current
      dragEffectIdRef.current = null
      setDragEffectOverUid(null)
      if(layer && layer.type !== 'effect' && EFFECTS[fxId]){
        assignEffectToLayer(fxId, overUid)
      }
      return
    }
    const fromUid = dragUidRef.current
    if(!fromUid || !overUid || fromUid === overUid){ dragUidRef.current = null; setDragOver(null); return }
    const dragInfo = dragOver
    setLayers((s) => {
      const fromIdx = s.findIndex(l => l.uid === fromUid)
      const overIdx = s.findIndex(l => l.uid === overUid)
      if(fromIdx < 0 || overIdx < 0) return s
      const next = [...s]
      const [item] = next.splice(fromIdx, 1)
      // After splice, overUid index may have shifted
      let newOverIdx = next.findIndex(l => l.uid === overUid)
      // Display is reversed, so 'before' visually = AFTER in array
      let insertIdx = dragInfo?.position === 'before' ? newOverIdx + 1 : newOverIdx
      insertIdx = Math.max(0, Math.min(next.length, insertIdx))
      next.splice(insertIdx, 0, item)
      return next
    })
    dragUidRef.current = null
    setDragOver(null)
  }
  const onLayerDragEnd = () => {
    dragUidRef.current = null
    dragEffectIdRef.current = null
    setDragOver(null)
    setDragEffectOverUid(null)
  }

  // Library item drag handlers — drag an effect onto an image/shape/text layer.
  const onEffectDragStart = (e, effectId) => {
    dragEffectIdRef.current = effectId
    e.dataTransfer.effectAllowed = 'copy'
    try { e.dataTransfer.setData('text/plain', `fx:${effectId}`) } catch(_){}
  }
  const onEffectDragEnd = () => {
    dragEffectIdRef.current = null
    setDragEffectOverUid(null)
  }
  // Drop an effect anywhere on the canvas to scope it to the layer at that point.
  const onCanvasDragOver = (e) => {
    if(dragEffectIdRef.current){ e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }
  }
  const onCanvasDrop = (e) => {
    if(!dragEffectIdRef.current) return
    e.preventDefault()
    e.stopPropagation()
    const fxId = dragEffectIdRef.current
    dragEffectIdRef.current = null
    setDragEffectOverUid(null)
    const rect = canvasRef.current.getBoundingClientRect()
    const px = (e.clientX - rect.left) / rect.width
    const py = (e.clientY - rect.top) / rect.height
    const hit = hitTest(px, py, rect.width, rect.height)
    if(hit && hit.el && EFFECTS[fxId]) assignEffectToLayer(fxId, hit.el.uid)
    else if(EFFECTS[fxId]) addEffect(fxId) // dropped on empty space → global effect
  }

  const addEffect = (effectId) => {
    setLayers((s) => {
      const layer = {
        uid: crypto.randomUUID(), type: 'effect',
        effectId, visible: true, _follow: false,
        values: defaultValues(effectId),
        mask: { ...DEFAULT_MASK }
      }
      setSelectedUid(layer.uid)
      return [...s, layer]
    })
  }
  // Assign an effect from the library to a specific layer (image / shape / text).
  // The scoped effect is inserted directly after its parent in the stack so it stays
  // grouped with the layer it belongs to.
  const assignEffectToLayer = (effectId, parentUid) => {
    setLayers((s) => {
      const i = s.findIndex(l => l.uid === parentUid)
      if(i < 0) return s
      // Insert after the parent and after any existing scoped effects of the same parent
      let insertAt = i + 1
      while(insertAt < s.length && s[insertAt].type === 'effect' && s[insertAt].scopedTo === parentUid) insertAt++
      const fx = {
        uid: crypto.randomUUID(), type: 'effect',
        effectId, visible: true, _follow: false,
        values: defaultValues(effectId),
        mask: { ...DEFAULT_MASK },
        scopedTo: parentUid
      }
      setSelectedUid(fx.uid)
      return [...s.slice(0, insertAt), fx, ...s.slice(insertAt)]
    })
  }
  const unscopeEffect = (uid) => {
    setLayers((s) => s.map(l => {
      if(l.uid !== uid || l.type !== 'effect') return l
      const { scopedTo, ...rest } = l
      return rest
    }))
  }
  const clearAllLayers = () => { setLayers([]); setSelectedUid(null) }
  const clearAllEffects = () => {
    setLayers((s) => s.filter(l => l.type !== 'effect'))
    if(selectedUid){
      const sel = layers.find(l => l.uid === selectedUid)
      if(sel?.type === 'effect') setSelectedUid(null)
    }
  }
  const scrambleEffects = () => {
    const ids = Object.keys(EFFECTS)
    const n = 2 + Math.floor(Math.random() * 3)
    setLayers((s) => {
      const nonEffects = s.filter(l => l.type !== 'effect')
      const next = [...nonEffects]
      for(let i = 0; i < n; i++){
        const id = ids[Math.floor(Math.random() * ids.length)]
        const vals = defaultValues(id)
        for(const p of EFFECTS[id].params){
          if(p.type === 'range') vals[p.key] = p.min + Math.random() * (p.max - p.min)
          else if(p.type === 'toggle') vals[p.key] = Math.random() < 0.4
        }
        next.push({ uid: crypto.randomUUID(), type: 'effect', effectId: id, visible: true, _follow: false, values: vals, mask: { ...DEFAULT_MASK } })
      }
      return next
    })
  }

  // ============ Pen / Text ============
  const closeShape = () => {
    if(drawing.points.length < 6) { setDrawing({ active: false, points: [] }); return }
    setLayers((s) => {
      const shape = {
        uid: crypto.randomUUID(), type: 'shape',
        name: `shape · ${drawing.points.length / 2} pt`,
        visible: true, _follow: false,
        points: [...drawing.points],
        fill: [...penColor], opacity: 1,
        x: 0, y: 0, scale: 1, rotation: 0, cornerRadius: 0
      }
      setSelectedUid(shape.uid)
      return [...s, shape]
    })
    setDrawing({ active: false, points: [] })
    setTool('select')
  }
  const cancelDrawing = () => setDrawing({ active: false, points: [] })

  const commitText = () => {
    if(!textDraft || !textDraft.value.trim()){ setTextDraft(null); return }
    if(!engineRef.current) return
    const canvas = renderTextToCanvas(textDraft.value, 'Inter, system-ui, sans-serif', 96, [0, 0, 0])
    const tex = engineRef.current.uploadTexture(canvas)
    setLayers((s) => {
      const layer = {
        uid: crypto.randomUUID(), type: 'text',
        name: textDraft.value.slice(0, 24),
        text: textDraft.value, font: 'Inter, system-ui, sans-serif', size: 96, color: [0, 0, 0],
        tex, imgW: canvas.width, imgH: canvas.height,
        thumbnail: canvas.toDataURL('image/png'),
        visible: true, _follow: false,
        transform: { ...DEFAULT_TRANSFORM, x: textDraft.x, y: textDraft.y, scale: 0.6 }
      }
      setSelectedUid(layer.uid)
      return [...s, layer]
    })
    setTextDraft(null)
    setTool('select')
  }

  // ============ Export / Record ============
  const exportPNG = () => {
    canvasRef.current.toBlob((blob) => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `bianca-tool-${Date.now()}.png`; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }, 'image/png')
  }
  const startRecord = () => {
    if(recording) return
    const canvas = canvasRef.current
    if(!canvas || !canvas.captureStream) return alert('MediaRecorder not supported')
    let mimeType = 'video/webm;codecs=vp9'
    if(!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm;codecs=vp8'
    if(!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm'
    const stream = canvas.captureStream(60)
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 })
    recorderRef.current = recorder
    const chunks = []
    recorder.ondataavailable = (e) => { if(e.data && e.data.size > 0) chunks.push(e.data) }
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `bianca-tool-${Date.now()}.webm`; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1500)
      setRecording(false); setRecCountdown(0); recorderRef.current = null
    }
    recorder.start(100)
    setRecording(true); setRecCountdown(recDuration)
    const start = performance.now()
    const tickRec = () => {
      const elapsed = (performance.now() - start) / 1000
      setRecCountdown(Math.max(0, Math.ceil(recDuration - elapsed)))
      if(elapsed < recDuration && recorderRef.current && recorderRef.current.state === 'recording') requestAnimationFrame(tickRec)
      else { try { recorder.stop() } catch(e){} }
    }
    requestAnimationFrame(tickRec)
  }
  const stopRecord = () => {
    if(recorderRef.current && recorderRef.current.state === 'recording'){
      try { recorderRef.current.stop() } catch(e){}
    }
  }

  // ============ Canvas pointer ============
  const dragRef = useRef(null)
  const updateMouse = (e) => {
    const rect = canvasRef.current.getBoundingClientRect()
    const px = (e.clientX - rect.left) / rect.width
    const py = (e.clientY - rect.top) / rect.height
    mouseTargetRef.current = { x: px, y: 1 - py }
    return { px, py, rect }
  }
  const getTransformedPoints = (l) => {
    return transformShapePoints(l.points, {
      x: l.x || 0, y: l.y || 0,
      scale: l.scale == null ? 1 : l.scale,
      rotation: l.rotation || 0,
      cornerRadius: l.cornerRadius || 0
    })
  }
  const VERTEX_HIT_PX = 10
  const hitTest = (px, py, W, H) => {
    const cMin = Math.min(W, H)
    if(selectedUid){
      const sel = layers.find(e => e.uid === selectedUid)
      if(sel && sel.type === 'shape'){
        const tp = getTransformedPoints(sel)
        for(let i = 0; i < tp.length; i += 2){
          const dxPx = (px - tp[i]) * W, dyPx = (py - tp[i+1]) * H
          if(Math.hypot(dxPx, dyPx) < VERTEX_HIT_PX){
            return { type: 'vertex', shape: sel, vertexIdx: i / 2 }
          }
        }
      }
    }
    for(let i = layers.length - 1; i >= 0; i--){
      const l = layers[i]
      if(!l.visible || l.type === 'effect') continue
      if(l.type === 'shape'){
        const tp = getTransformedPoints(l)
        let inside = false
        const n = tp.length / 2
        for(let a = 0, b = n - 1; a < n; b = a++){
          const xi = tp[a*2], yi = tp[a*2+1]
          const xj = tp[b*2], yj = tp[b*2+1]
          if(((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside
        }
        if(inside) return { type: 'shape', el: l }
      } else {
        const t = l.transform
        const dxPx = (px - t.x) * W, dyPx = (py - t.y) * H
        const r = -(t.rotation || 0)
        const cs = Math.cos(r), sn = Math.sin(r)
        const lx = dxPx * cs - dyPx * sn
        const ly = dxPx * sn + dyPx * cs
        const imgMax = Math.max(l.imgW, l.imgH)
        const ps = (t.scale * cMin) / imgMax
        const sw = l.imgW * ps, sh = l.imgH * ps
        if(Math.abs(lx) <= sw / 2 && Math.abs(ly) <= sh / 2) return { type: 'image', el: l }
      }
    }
    return null
  }

  const onCanvasPointerDown = (e) => {
    const { px, py, rect } = updateMouse(e)
    if(tool === 'pen'){
      if(drawing.active && drawing.points.length >= 6){
        const fx = drawing.points[0], fy = drawing.points[1]
        if(Math.hypot(px - fx, py - fy) < 0.025){ closeShape(); return }
      }
      setDrawing(d => ({ active: true, points: [...d.points, px, py] }))
      return
    }
    if(tool === 'text'){
      setTextDraft({ x: px, y: py, value: '' })
      return
    }
    const hit = hitTest(px, py, rect.width, rect.height)
    if(!hit){ setSelectedUid(null); return }
    if(hit.type === 'vertex'){
      dragRef.current = { kind: 'vertex', uid: hit.shape.uid, vertexIdx: hit.vertexIdx }
      e.currentTarget.setPointerCapture?.(e.pointerId)
      return
    }
    const el = hit.el
    setSelectedUid(el.uid)
    if(el.type === 'shape'){
      dragRef.current = { uid: el.uid, kind: 'shape', startPx: px, startPy: py, startX: el.x || 0, startY: el.y || 0 }
    } else {
      dragRef.current = { uid: el.uid, kind: 'image', startPx: px, startPy: py, startT: { ...el.transform } }
    }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onCanvasPointerMove = (e) => {
    const { px, py } = updateMouse(e)
    const d = dragRef.current
    if(!d) return
    if(d.kind === 'vertex'){
      const sh = layers.find(x => x.uid === d.uid)
      if(!sh) return
      const sc = sh.scale == null ? 1 : sh.scale
      const ox = sh.x || 0, oy = sh.y || 0
      const rot = sh.rotation || 0
      const [cx, cy] = shapeCentroid(sh.points)
      const dx = px - ox - cx
      const dy = py - oy - cy
      const cs = Math.cos(-rot), sn = Math.sin(-rot)
      const ix = (dx * cs - dy * sn) / sc + cx
      const iy = (dx * sn + dy * cs) / sc + cy
      updateShapeVertex(d.uid, d.vertexIdx, ix, iy)
      return
    }
    setLayers((s) => s.map(l => {
      if(l.uid !== d.uid) return l
      if(d.kind === 'shape') return { ...l, x: d.startX + (px - d.startPx), y: d.startY + (py - d.startPy) }
      return { ...l, transform: { ...d.startT, x: d.startT.x + (px - d.startPx), y: d.startT.y + (py - d.startPy) } }
    }))
  }
  const onCanvasPointerUp = (e) => {
    dragRef.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }
  const onCanvasPointerLeave = () => {
    mouseTargetRef.current = { x: 0.5, y: 0.5 }
  }
  const onCanvasDoubleClick = (e) => {
    if(tool === 'pen' && drawing.active){ e.preventDefault(); closeShape() }
  }

  useEffect(() => {
    const handler = (e) => {
      const target = e.target
      const inInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      const cmd = e.metaKey || e.ctrlKey
      if(cmd && e.key.toLowerCase() === 'z' && !e.shiftKey){ e.preventDefault(); undo(); return }
      if(cmd && ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y')){ e.preventDefault(); redo(); return }
      if(!inInput){
        if(e.key === 'Escape'){
          if(textDraft) setTextDraft(null)
          else if(drawing.active) cancelDrawing()
          else if(tool !== 'select') setTool('select')
          return
        }
        if(e.key === 'Enter' && tool === 'pen' && drawing.active){ e.preventDefault(); closeShape(); return }
        if(e.key === 'Delete' || e.key === 'Backspace'){
          if(selectedUid){ e.preventDefault(); removeLayer(selectedUid); return }
        }
        if(e.key.toLowerCase() === 'v'){ setTool('select'); return }
        if(e.key.toLowerCase() === 'p'){ setTool('pen'); return }
        if(e.key.toLowerCase() === 't'){ setTool('text'); return }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUid, drawing.active, tool, textDraft])

  const selectionBox = useMemo(() => {
    if(!selectedUid) return null
    const l = layers.find(x => x.uid === selectedUid)
    if(!l || l.type === 'effect') return null
    const wrap = canvasRef.current?.parentElement
    if(!wrap) return null
    const rect = wrap.getBoundingClientRect()
    if(!rect.width || !rect.height) return null
    const W = rect.width, H = rect.height
    if(l.type === 'shape'){
      const tp = getTransformedPoints(l)
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      const verts = []
      for(let i = 0; i < tp.length; i += 2){
        const px = tp[i], py = tp[i+1]
        verts.push({ x: px * W, y: py * H })
        if(px < minX) minX = px; if(px > maxX) maxX = px
        if(py < minY) minY = py; if(py > maxY) maxY = py
      }
      return {
        kind: 'shape',
        left: ((minX + maxX) / 2) * W, top: ((minY + maxY) / 2) * H,
        width: (maxX - minX) * W, height: (maxY - minY) * H,
        rotation: 0, vertices: verts
      }
    }
    const cMin = Math.min(W, H)
    const t = l.transform
    const imgMax = Math.max(l.imgW, l.imgH)
    const ps = (t.scale * cMin) / imgMax
    return { kind: 'image', left: t.x * W, top: t.y * H,
      width: l.imgW * ps, height: l.imgH * ps, rotation: t.rotation || 0 }
  }, [selectedUid, layers, resizeTick, aspect])

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase()
    const g = {}
    for(const id of Object.keys(EFFECTS)){
      const e = EFFECTS[id]
      if(q && !e.label.toLowerCase().includes(q) && !e.group.toLowerCase().includes(q)) continue
      if(!g[e.group]) g[e.group] = []
      g[e.group].push(e)
    }
    return g
  }, [search])

  const sel = layers.find(l => l.uid === selectedUid)
  const selEffect = sel?.type === 'effect' ? EFFECTS[sel.effectId] : null
  const activeEffects = layers.filter(l => l.type === 'effect' && l.visible).length
  const totalElements = layers.filter(l => l.type !== 'effect').length

  const aspectInfo = ASPECTS.find(x => x.id === aspect)
  const aspectStyle = useMemo(() => ({
    '--ratio': `${aspectInfo.w} / ${aspectInfo.h}`,
    '--ar': String(aspectInfo.w / aspectInfo.h)
  }), [aspect])

  const wrap = canvasRef.current?.parentElement
  const wrapRect = wrap?.getBoundingClientRect()
  const penPoints = drawing.points
  const wrapW = wrapRect?.width || 1
  const wrapH = wrapRect?.height || 1

  const canUndo = historyRef.current.past.length > 0 || pendingRef.current !== null
  const canRedo = historyRef.current.future.length > 0

  const toggleCat = (grp) => setCollapsedCats((s) => {
    const next = new Set(s)
    if(next.has(grp)) next.delete(grp); else next.add(grp)
    return next
  })
  const expandAll = () => setCollapsedCats(new Set())
  const collapseAll = () => setCollapsedCats(new Set(GROUPS))

  const LayerThumb = ({ layer }) => {
    if(layer.type === 'shape') return <ShapeThumb shape={layer} />
    if(layer.type === 'effect') return <EffectThumb layer={layer} />
    if(layer.thumbnail) return <img className="thumb" src={layer.thumbnail} alt="" />
    return <span className="thumb empty" />
  }

  const shapeImgInputRef = useRef(null)
  const triggerAssignImage = (uid) => {
    shapeImgInputRef.current.dataset.targetUid = uid
    shapeImgInputRef.current.click()
  }
  const onShapeImgChange = (e) => {
    const uid = shapeImgInputRef.current.dataset.targetUid
    const file = e.target.files?.[0]
    if(file && uid) assignImageToShape(uid, file)
    e.target.value = ''
  }

  const FollowControls = ({ uid, cfg }) => {
    const c = cfg || DEFAULT_FOLLOW
    return (
      <div className="follow-controls">
        <ParamControl param={{ key:'momentum', label:'follow momentum', type:'range', min:0.02, max:0.5, step:0.001, default:0.18 }}
          value={c.momentum} onChange={(v) => updateLayerFollowCfg(uid, 'momentum', v)} />
        <ParamControl param={{ key:'intensityX', label:'follow intensity x', type:'range', min:0, max:1, step:0.01, default:1 }}
          value={c.intensityX} onChange={(v) => updateLayerFollowCfg(uid, 'intensityX', v)} />
        <ParamControl param={{ key:'intensityY', label:'follow intensity y', type:'range', min:0, max:1, step:0.01, default:1 }}
          value={c.intensityY} onChange={(v) => updateLayerFollowCfg(uid, 'intensityY', v)} />
      </div>
    )
  }

  return (
    <div className="app">
      {err && <div className="err-banner">WebGL2 unavailable — {err}</div>}
      <input ref={shapeImgInputRef} type="file" accept="image/*" className="upload-input" onChange={onShapeImgChange} />

      {/* TOP BAR */}
      <div className="topbar">
        <div className="brand">
          <span className="logo">Bianca Tool</span>
        </div>
        <div className="tools">
          <button className={'tool-btn ' + (tool === 'select' ? 'on' : '')} onClick={() => { setTool('select'); cancelDrawing() }} title="Select (V)">SELECT</button>
          <button className={'tool-btn ' + (tool === 'pen' ? 'on' : '')} onClick={() => setTool('pen')} title="Pen (P)">PEN</button>
          <button className={'tool-btn ' + (tool === 'text' ? 'on' : '')} onClick={() => setTool('text')} title="Text (T)">TEXT</button>
          {tool === 'pen' && (
            <input type="color" className="fill-swatch" value={rgb2hex(penColor)}
              onChange={(e) => setPenColor(hex2rgb(e.target.value))} title="Shape fill" />
          )}
        </div>
        <div className="actions">
          <button className="btn" disabled={!canUndo} onClick={undo} title="Undo (⌘Z)">⌘Z</button>
          <button className="btn" disabled={!canRedo} onClick={redo} title="Redo (⌘⇧Z)">⌘⇧Z</button>
          <label className="btn">
            ADD IMAGE
            <input type="file" accept="image/*" multiple className="upload-input" onChange={onUploadInput} />
          </label>
          <button className="btn solid" onClick={exportPNG}>EXPORT PNG</button>
          <div className="rec-group">
            <select className="rec-duration" value={recDuration} onChange={(e) => setRecDuration(parseInt(e.target.value))} disabled={recording}>
              {REC_OPTIONS.map(s => <option key={s} value={s}>{s}s</option>)}
            </select>
            {recording
              ? <button className="btn rec-btn rec-active" onClick={stopRecord}>● REC {recCountdown}s</button>
              : <button className="btn rec-btn" onClick={startRecord}>● RECORD</button>
            }
          </div>
        </div>
      </div>

      {/* LEFT */}
      <div className="left">
        <div className="section-bar">
          <span className="section-letter">S</span>
          <span className="section-label">SAMPLES</span>
          <span className="section-count">{SAMPLES.length}</span>
        </div>
        <div className="sample-grid">
          {SAMPLES.map((s) => (
            <button key={s.url} className="sample-tile" style={{ backgroundImage: `url(${s.url})` }} onClick={() => addImage(s.url, s.name)}>
              <span className="sample-name">{s.name.split('·')[0].trim()}</span>
            </button>
          ))}
        </div>

        <div className="section-bar">
          <span className="section-letter">P</span>
          <span className="section-label">PRIMITIVES</span>
          <span className="section-count">{PRIMITIVES.length}</span>
        </div>
        <div className="primitive-grid">
          {PRIMITIVES.map(p => (
            <button key={p.id} className="primitive-btn" onClick={() => addPrimitive(p.id)} title={p.label}>
              <span className="primitive-icon">{p.icon}</span>
              <span className="primitive-name">{p.id}</span>
            </button>
          ))}
        </div>

        <div className="section-bar">
          <span className="section-letter">F</span>
          <span className="section-label">EFFECTS LIBRARY</span>
          <span className="section-count">{Object.keys(EFFECTS).length}</span>
        </div>
        <div className="cat-bar">
          <button className="cat-mini" onClick={expandAll}>EXPAND ALL</button>
          <button className="cat-mini" onClick={collapseAll}>COLLAPSE ALL</button>
        </div>
        <div className="search">
          <input placeholder="search effects..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        {GROUPS.map((grp) => grouped[grp] && (
          <div className={'cat-group ' + (collapsedCats.has(grp) && !search ? 'collapsed' : 'open')} key={grp}>
            <button className="cat-h" onClick={() => toggleCat(grp)}>
              <span className="disclose">{collapsedCats.has(grp) && !search ? '▸' : '▾'}</span>
              <span className="cat-badge">{grp[0]}</span>
              <span className="cat-name">{grp}</span>
              <span className="cat-count">{grouped[grp].length}</span>
            </button>
            {(!collapsedCats.has(grp) || search) && (
              <div className="cat-list">
                {grouped[grp].map((e) => (
                  <div key={e.id} className="cat-item"
                    role="button"
                    tabIndex={0}
                    draggable="true"
                    onDragStart={(ev) => onEffectDragStart(ev, e.id)}
                    onDragEnd={onEffectDragEnd}
                    onClick={() => addEffect(e.id)}
                    onKeyDown={(ev) => { if(ev.key === 'Enter' || ev.key === ' ') addEffect(e.id) }}
                    title="click to add globally · drag onto a layer to scope it">
                    <span className="cat-item-grip" aria-hidden>⋮⋮</span>
                    <span className="cat-item-label">{e.label}</span>
                    <span className="add">+</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        <div className="hint">v select · p pen · t text · drop images</div>
      </div>

      {/* CENTER */}
      <div className="center">
        <div className={'canvas-wrap tool-' + tool} style={aspectStyle}
          onDragOver={onCanvasDragOver}
          onDrop={onCanvasDrop}>
          <div className="canvas-tag">{layers.length} layers · {activeEffects} fx{recording ? ` · REC ${recCountdown}s` : ''}</div>
          <canvas ref={canvasRef}
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerUp}
            onPointerCancel={onCanvasPointerUp}
            onPointerLeave={onCanvasPointerLeave}
            onDoubleClick={onCanvasDoubleClick} />

          {selectionBox && tool === 'select' && (
            <>
              {selectionBox.kind === 'image' ? (
                <div className="selection-box"
                  style={{ left: selectionBox.left, top: selectionBox.top, width: selectionBox.width, height: selectionBox.height,
                    transform: `translate(-50%, -50%) rotate(${selectionBox.rotation}rad)` }}>
                  <span className="h1" /><span className="h2" />
                </div>
              ) : (
                <>
                  <div className="selection-box-shape"
                    style={{ left: selectionBox.left, top: selectionBox.top, width: selectionBox.width, height: selectionBox.height,
                      transform: `translate(-50%, -50%)` }} />
                  {selectionBox.vertices && selectionBox.vertices.map((v, i) => (
                    <div key={i} className="vertex-handle" style={{ left: v.x, top: v.y }} />
                  ))}
                </>
              )}
            </>
          )}

          {tool === 'pen' && drawing.active && drawing.points.length > 0 && (
            <svg className="pen-overlay" viewBox={`0 0 ${wrapW} ${wrapH}`} preserveAspectRatio="none">
              <polyline points={Array.from({length: penPoints.length / 2}, (_, i) => `${penPoints[i*2] * wrapW},${penPoints[i*2+1] * wrapH}`).join(' ')} />
              {penPoints.length >= 4 && (
                <line className="preview-line"
                  x1={penPoints[penPoints.length - 2] * wrapW} y1={penPoints[penPoints.length - 1] * wrapH}
                  x2={penPoints[0] * wrapW} y2={penPoints[1] * wrapH} />
              )}
              {Array.from({length: penPoints.length / 2}).map((_, i) => (
                <circle key={i} className={'anchor ' + (i === 0 ? 'first' : '')}
                  cx={penPoints[i*2] * wrapW} cy={penPoints[i*2+1] * wrapH} r="3.5" />
              ))}
            </svg>
          )}

          {textDraft && (
            <div className="text-input-overlay" style={{ left: textDraft.x * wrapW, top: textDraft.y * wrapH }}>
              <input autoFocus type="text" value={textDraft.value}
                placeholder="type · enter · esc"
                onChange={(e) => setTextDraft(d => ({...d, value: e.target.value}))}
                onKeyDown={(e) => {
                  if(e.key === 'Enter') { e.preventDefault(); commitText() }
                  if(e.key === 'Escape') { e.preventDefault(); setTextDraft(null) }
                }}
                onBlur={() => { if(textDraft.value.trim()) commitText(); else setTextDraft(null) }} />
            </div>
          )}

          <div className="canvas-coords">{aspect}</div>
          <div className="canvas-aspect">
            {ASPECTS.map((x) => (
              <button key={x.id} className={x.id === aspect ? 'on' : ''} onClick={() => setAspect(x.id)}>{x.id}</button>
            ))}
          </div>
          {tool === 'pen' && (
            <div className="canvas-hint">
              {drawing.active ? `${drawing.points.length / 2} pt · ↵ close · esc cancel` : 'click to start drawing'}
            </div>
          )}
          {tool === 'text' && !textDraft && <div className="canvas-hint">click to add text</div>}
        </div>
      </div>

      {/* RIGHT */}
      <div className="right">
        <div className="section-bar">
          <span className="section-letter">L</span>
          <span className="section-label">LAYERS</span>
          <span className="section-count">{layers.length}</span>
          {layers.length > 0 && (
            <button className="section-action" onClick={scrambleEffects}>SCRAMBLE FX</button>
          )}
        </div>
        <div className="layer-list reverse-list">
          {layers.length === 0 && <div className="empty-panel">drop image · sample · pen · text · primitive · effect</div>}
          {[...layers].map((l, displayIdx) => {
            const i = layers.length - 1 - displayIdx
            const ll = layers[i]
            const fx = ll.type === 'effect' ? EFFECTS[ll.effectId] : null
            const followable = ll.type !== 'effect' || (fx && fx.followCursor)
            const isOver = dragOver?.overUid === ll.uid
            return (
              <div key={ll.uid}
                draggable={renaming?.uid !== ll.uid}
                onDragStart={(e) => onLayerDragStart(e, ll.uid)}
                onDragOver={(e) => onLayerDragOver(e, ll.uid, ll)}
                onDragLeave={onLayerDragLeave}
                onDrop={(e) => onLayerDrop(e, ll.uid, ll)}
                onDragEnd={onLayerDragEnd}
                className={
                  'layer card-layer '
                  + (ll.type === 'effect' ? 'is-effect ' : '')
                  + (ll.scopedTo ? 'scoped-effect ' : '')
                  + (ll.uid === selectedUid ? 'selected ' : '')
                  + (ll.visible ? '' : 'disabled ')
                  + (isOver ? `drop-target drop-${dragOver.position} ` : '')
                  + (dragEffectOverUid === ll.uid ? 'fx-drop-target ' : '')
                }
                onClick={() => setSelectedUid(ll.uid)}>
                <LayerThumb layer={ll} />
                <div className="card-meta">
                  <span className="card-line">
                    <span className="idx">{String(i + 1).padStart(2, '0')}</span>
                    <span className="type-icon">{typeBadge(ll)}</span>
                    {ll._follow && <span className="follow-badge" title="follows cursor">⊙</span>}
                    {ll.type === 'effect' && ll.mask?.on && <span className="mask-badge" title="masked">▣</span>}
                    {ll.type === 'effect' && ll.scopedTo && <span className="scope-badge" title="scoped to layer">↳</span>}
                    {ll.blendMode && ll.blendMode !== 'normal' && <span className="blend-badge" title={`blend: ${ll.blendMode}`}>×</span>}
                  </span>
                  {renaming?.uid === ll.uid ? (
                    <input
                      autoFocus
                      className="layer-rename-input"
                      value={renaming.value}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setRenaming({ uid: ll.uid, value: e.target.value })}
                      onKeyDown={(e) => {
                        if(e.key === 'Enter'){ renameLayer(ll.uid, renaming.value || ll.name); setRenaming(null) }
                        if(e.key === 'Escape'){ setRenaming(null) }
                      }}
                      onBlur={() => { renameLayer(ll.uid, renaming.value || ll.name); setRenaming(null) }}
                    />
                  ) : (
                    <span
                      className="name"
                      onDoubleClick={(e) => { e.stopPropagation(); setRenaming({ uid: ll.uid, value: layerLabel(ll) }) }}
                    >{layerLabel(ll)}</span>
                  )}
                </div>
                <div className="layer-actions" onClick={(e) => e.stopPropagation()}>
                  {followable && <button className={'follow-btn ' + (ll._follow ? 'on' : '')} title="follow cursor" onClick={() => toggleLayerFollow(ll.uid)}>⊙</button>}
                  <button title="visible"   onClick={() => toggleLayerVisible(ll.uid)}>{ll.visible ? '●' : '○'}</button>
                  <button title="duplicate" onClick={() => duplicateLayer(ll.uid)}>+</button>
                  <button title="up"        onClick={() => moveLayerZ(ll.uid, +1)}>↑</button>
                  <button title="down"      onClick={() => moveLayerZ(ll.uid, -1)}>↓</button>
                  <button title="delete"    onClick={() => removeLayer(ll.uid)}>×</button>
                </div>
              </div>
            )
          })}
          {layers.length > 0 && (
            <div className="row-btns" style={{ padding: '8px 12px' }}>
              <button className="mini-btn" onClick={clearAllEffects}>clear fx</button>
              <button className="mini-btn" onClick={clearAllLayers}>clear all</button>
            </div>
          )}
        </div>

        {sel && (
          <div className={sel.type === 'effect' ? 'params-block' : ''}>
            <div className={'sub-bar ' + (sel.type === 'effect' ? 'editing' : '')}>
              {sel.type === 'effect' && <span>EDITING</span>}
              <span className={sel.type === 'effect' ? 'editing-name' : ''}>{layerLabel(sel)}</span>
              <span className="sub-tag">{sel.type === 'effect' ? selEffect.group : sel.type.toUpperCase()}</span>
            </div>
            {sel.type === 'effect' && sel.scopedTo && (() => {
              const parent = layers.find(p => p.uid === sel.scopedTo)
              return (
                <div className="scoped-note">
                  ▸ scoped to <strong>{parent ? layerLabel(parent) : 'unknown'}</strong>
                  <button className="mini-btn" onClick={() => unscopeEffect(sel.uid)}>unscope</button>
                </div>
              )
            })()}
            <div className="params">
              {sel.type === 'effect' && (
                <>
                  <div className="param">
                    <div className="toggle">
                      <div className={'switch ' + (sel.mask?.on ? 'on' : '')} onClick={() => toggleMask(sel.uid)} />
                      <span>▣ mask · cursor circle</span>
                    </div>
                  </div>
                  {sel.mask?.on && (
                    <div className="follow-controls">
                      <ParamControl param={{ key:'radius', label:'mask radius', type:'range', min:0.05, max:1.5, step:0.001, default:0.3 }}
                        value={sel.mask.radius} onChange={(v) => updateMask(sel.uid, 'radius', v)} />
                      <ParamControl param={{ key:'softness', label:'mask softness', type:'range', min:0, max:1, step:0.01, default:0.3 }}
                        value={sel.mask.softness} onChange={(v) => updateMask(sel.uid, 'softness', v)} />
                      <ParamControl param={{ key:'feather', label:'mask feather', type:'range', min:0, max:1, step:0.01, default:0.15 }}
                        value={sel.mask.feather} onChange={(v) => updateMask(sel.uid, 'feather', v)} />
                      <div className="param">
                        <div className="toggle">
                          <div className={'switch ' + (sel.mask.invert ? 'on' : '')} onClick={() => updateMask(sel.uid, 'invert', !sel.mask.invert)} />
                          <span>invert mask</span>
                        </div>
                      </div>
                    </div>
                  )}
                  {selEffect.followCursor && (
                    <div className="param">
                      <div className="toggle">
                        <div className={'switch ' + (sel._follow ? 'on' : '')} onClick={() => toggleLayerFollow(sel.uid)} />
                        <span>⊙ follow cursor</span>
                      </div>
                    </div>
                  )}
                  {sel._follow && <FollowControls uid={sel.uid} cfg={sel._followCfg} />}
                  {selEffect.params.map((p) => (
                    <ParamControl key={p.key} param={p}
                      value={sel.values[p.key]}
                      onChange={(v) => updateEffectValue(sel.uid, p.key, v)} />
                  ))}
                  <div className="row-btns">
                    <button className="mini-btn" onClick={() => resetEffect(sel.uid)}>reset values</button>
                  </div>
                </>
              )}

              {sel.type === 'text' && (
                <div className="param">
                  <div className="param-h"><span>text</span></div>
                  <input className="text-edit" type="text" value={sel.text}
                    onChange={(e) => updateText(sel.uid, 'text', e.target.value)} />
                </div>
              )}
              {(sel.type === 'image' || sel.type === 'text') && (
                <>
                  <ParamControl param={{ key: 'x', label: 'x', type: 'range', min: -0.5, max: 1.5, step: 0.001, default: 0.5 }}
                    value={sel.transform.x} onChange={(v) => updateImageTransform(sel.uid, 'x', v)} />
                  <ParamControl param={{ key: 'y', label: 'y', type: 'range', min: -0.5, max: 1.5, step: 0.001, default: 0.5 }}
                    value={sel.transform.y} onChange={(v) => updateImageTransform(sel.uid, 'y', v)} />
                  <ParamControl param={{ key: 'scale', label: 'scale', type: 'range', min: 0.05, max: 3, step: 0.001, default: 1 }}
                    value={sel.transform.scale} onChange={(v) => updateImageTransform(sel.uid, 'scale', v)} />
                  <ParamControl param={{ key: 'rotation', label: 'rotation', type: 'range', min: -Math.PI, max: Math.PI, step: 0.001, default: 0 }}
                    value={sel.transform.rotation} onChange={(v) => updateImageTransform(sel.uid, 'rotation', v)} />
                  <ParamControl param={{ key: 'opacity', label: 'opacity', type: 'range', min: 0, max: 1, step: 0.01, default: 1 }}
                    value={sel.transform.opacity} onChange={(v) => updateImageTransform(sel.uid, 'opacity', v)} />
                </>
              )}
              {sel.type === 'text' && (
                <>
                  <ParamControl param={{ key: 'size', label: 'font size', type: 'range', min: 16, max: 300, step: 1, default: 96 }}
                    value={sel.size} onChange={(v) => updateText(sel.uid, 'size', v)} />
                  <ParamControl param={{ key: 'color', label: 'color', type: 'color', default: [0,0,0] }}
                    value={sel.color} onChange={(v) => updateText(sel.uid, 'color', v)} />
                </>
              )}
              {sel.type === 'shape' && (
                <>
                  <ParamControl param={{ key: 'x', label: 'offset x', type: 'range', min: -1, max: 1, step: 0.001, default: 0 }}
                    value={sel.x || 0} onChange={(v) => updateShapeField(sel.uid, 'x', v)} />
                  <ParamControl param={{ key: 'y', label: 'offset y', type: 'range', min: -1, max: 1, step: 0.001, default: 0 }}
                    value={sel.y || 0} onChange={(v) => updateShapeField(sel.uid, 'y', v)} />
                  <ParamControl param={{ key: 'scale', label: 'scale', type: 'range', min: 0.1, max: 3, step: 0.001, default: 1 }}
                    value={sel.scale == null ? 1 : sel.scale} onChange={(v) => updateShapeField(sel.uid, 'scale', v)} />
                  <ParamControl param={{ key: 'rotation', label: 'rotation', type: 'range', min: -Math.PI, max: Math.PI, step: 0.001, default: 0 }}
                    value={sel.rotation || 0} onChange={(v) => updateShapeField(sel.uid, 'rotation', v)} />
                  <ParamControl param={{ key: 'cornerRadius', label: 'border radius', type: 'range', min: 0, max: 0.5, step: 0.001, default: 0 }}
                    value={sel.cornerRadius || 0} onChange={(v) => updateShapeField(sel.uid, 'cornerRadius', v)} />
                  <ParamControl param={{ key: 'opacity', label: 'opacity', type: 'range', min: 0, max: 1, step: 0.01, default: 1 }}
                    value={sel.opacity == null ? 1 : sel.opacity}
                    onChange={(v) => updateShapeField(sel.uid, 'opacity', v)} />
                  {!sel.imageTex && (
                    <ParamControl param={{ key: 'fill', label: 'fill color', type: 'color', default: [0,0,0] }}
                      value={sel.fill} onChange={(v) => updateShapeField(sel.uid, 'fill', v)} />
                  )}
                  <div className="row-btns">
                    {sel.imageTex
                      ? <button className="mini-btn" onClick={() => clearShapeImage(sel.uid)}>remove image</button>
                      : <button className="mini-btn" onClick={() => triggerAssignImage(sel.uid)}>assign image</button>
                    }
                  </div>
                  {sel.imageTex && (
                    <>
                      <ParamControl param={{ key:'imageFit', label:'image fit', type:'select',
                        options:[['cover',0],['contain',1],['tile',2]], default:0 }}
                        value={({cover:0,contain:1,tile:2})[sel.imageFit ?? 'cover'] ?? 0}
                        onChange={(v) => {
                          const map = ['cover','contain','tile']
                          updateShapeField(sel.uid, 'imageFit', map[v] || 'cover')
                        }} />
                      {sel.imageFit === 'tile' && (
                        <ParamControl param={{ key:'tileScale', label:'tile scale', type:'range', min:1, max:20, step:0.1, default:3 }}
                          value={sel.tileScale || 3}
                          onChange={(v) => updateShapeField(sel.uid, 'tileScale', v)} />
                      )}
                    </>
                  )}
                </>
              )}
              {sel.type !== 'effect' && (
                <>
                  <ParamControl param={{ key:'blendMode', label:'blend mode', type:'select', options: BLEND_MODES, default: 0 }}
                    value={BLEND_MODES.find(([n]) => n === (sel.blendMode || 'normal'))?.[1] ?? 0}
                    onChange={(v) => setLayerBlendMode(sel.uid, BLEND_MAP[v] || 'normal')} />
                  <ParamControl param={{ key: 'z', label: 'z (depth)', type: 'range', min: 1, max: Math.max(layers.length, 1), step: 1, default: 1 }}
                    value={layers.findIndex(e => e.uid === sel.uid) + 1}
                    onChange={(v) => setLayerZ(sel.uid, v - 1)} />
                  <div className="row-btns">
                    <button className="mini-btn" onClick={() => centerLayer(sel.uid)}>center</button>
                    <button className="mini-btn" onClick={() => resetLayer(sel.uid)}>reset</button>
                    <button className={'mini-btn ' + (sel._follow ? 'on' : '')} onClick={() => toggleLayerFollow(sel.uid)}>
                      ⊙ follow cursor
                    </button>
                  </div>
                  {sel._follow && <FollowControls uid={sel.uid} cfg={sel._followCfg} />}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* STATUS BAR */}
      <div className="statusbar">
        <span className="ok">webgl2 · {totalElements} el · {activeEffects} fx</span>
        <span>{Object.keys(EFFECTS).length} effects</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: '12px' }}>
          <span><kbd>V</kbd> select</span>
          <span><kbd>P</kbd> pen</span>
          <span><kbd>T</kbd> text</span>
          <span><kbd>⌫</kbd> delete</span>
          <span><kbd>⌘Z</kbd> undo</span>
        </span>
      </div>
    </div>
  )
}
