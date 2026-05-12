import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { createEngine, transformShapePoints, shapeCentroid } from './engine/gl.js'
import { EFFECTS, defaultValues } from './effects/index.js'
import ParamControl from './components/ParamControl.jsx'

const GROUPS = ['INTERACT', 'DISTORT', 'PRINT', 'PATTERN', 'COLOR', 'LIGHT', 'STYLIZE', 'FOCUS', 'GLITCH']

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

// ============ Helpers ============
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

  const [editorState, _setEditorRaw] = useState({ elements: [], stack: [] })
  const elements = editorState.elements
  const stack = editorState.stack

  const [selectedElement, setSelectedElement] = useState(null)
  const [selectedEffect, setSelectedEffect] = useState(null)
  const [drawing, setDrawing] = useState({ active: false, points: [] })
  const [collapsedCats, setCollapsedCats] = useState(() => new Set(GROUPS))

  // Record state
  const [recDuration, setRecDuration] = useState(5)
  const [recording, setRecording] = useState(false)
  const [recCountdown, setRecCountdown] = useState(0)
  const recorderRef = useRef(null)

  const stateRef = useRef({ elements, stack })
  stateRef.current = { elements, stack }
  const bgRef = useRef(bg); bgRef.current = bg
  const mouseTargetRef = useRef({ x: 0.5, y: 0.5 })
  // Per-layer smoothed mouse positions: Map uid -> { x, y }
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
  const setEditor = (updater, opts = {}) => {
    _setEditorRaw(prev => {
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
    _setEditorRaw(prev => {
      const restore = historyRef.current.past.pop()
      historyRef.current.future.unshift(prev)
      setHistoryTick(t => t + 1)
      return restore
    })
  }
  const redo = () => {
    flushPending()
    if(historyRef.current.future.length === 0) return
    _setEditorRaw(prev => {
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
        catch(shaderErr){ console.error(`[press] effect "${id}":`, shaderErr); throw new Error(`effect "${id}": ${shaderErr.message || shaderErr}`) }
      }
    } catch (e){ console.error('[press] engine bootstrap failed:', e); setErr(e.message || String(e)); return }

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
      const st = stateRef.current

      // Update per-layer smoothed positions for any follow-enabled layer
      const target = mouseTargetRef.current
      const updateSmooth = (uid, fSet) => {
        let s = followStateRef.current.get(uid)
        if(!s){ s = { x: 0.5, y: 0.5 }; followStateRef.current.set(uid, s) }
        s.x += (target.x - s.x) * fSet.momentum * fSet.intensityX
        s.y += (target.y - s.y) * fSet.momentum * fSet.intensityY
        return s
      }

      // GLOBAL smoothed mouse (used for shaders without per-layer state) — use default
      let gs = followStateRef.current.get('__global__')
      if(!gs){ gs = { x: 0.5, y: 0.5 }; followStateRef.current.set('__global__', gs) }
      gs.x += (target.x - gs.x) * DEFAULT_FOLLOW.momentum
      gs.y += (target.y - gs.y) * DEFAULT_FOLLOW.momentum

      // Apply follow to elements
      const elementsForRender = st.elements.map(el => {
        if(!el._follow) return el
        const f = el._followCfg || DEFAULT_FOLLOW
        const s = updateSmooth(el.uid, f)
        const cx = s.x, cy = 1 - s.y
        if(el.type === 'shape'){
          const [scX, scY] = shapeCentroid(el.points)
          return { ...el, x: cx - scX, y: cy - scY }
        }
        return { ...el, transform: { ...el.transform, x: cx, y: cy } }
      })
      // Apply follow to effects
      const effectsForRender = st.stack.map(layer => {
        const fx = EFFECTS[layer.id]
        if(!layer._follow || !fx.followCursor) return layer
        const f = layer._followCfg || DEFAULT_FOLLOW
        const s = updateSmooth(layer.uid, f)
        const v = { ...layer.values }
        if(fx.followCursor[0]) v[fx.followCursor[0]] = s.x
        if(fx.followCursor[1]) v[fx.followCursor[1]] = 1 - s.y
        return { ...layer, values: v }
      })
      eng.render({
        elements: elementsForRender,
        effects: effectsForRender,
        time,
        bg: bgRef.current,
        mouse: gs  // global smoothed for cursor-based effects without per-layer follow
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
      setEditor((s) => {
        const idx = s.elements.length
        const t = { ...DEFAULT_TRANSFORM,
          x: idx === 0 ? 0.5 : 0.3 + (idx % 3) * 0.2,
          y: idx === 0 ? 0.5 : 0.3 + Math.floor(idx / 3) * 0.2,
          scale: idx === 0 ? 1 : 0.45
        }
        const layer = {
          uid: crypto.randomUUID(), type: 'image',
          name: name || ('image-' + (idx + 1)),
          tex, imgW: img.naturalWidth, imgH: img.naturalHeight,
          thumbnail,
          visible: true, _follow: false, transform: t
        }
        setSelectedElement(layer.uid)
        return { ...s, elements: [...s.elements, layer] }
      })
    }
    img.onerror = () => console.warn('image load failed', src)
    img.src = src
  }, [])

  const addImageBitmap = (bitmap, name) => {
    if(!engineRef.current) return
    const tex = engineRef.current.uploadTexture(bitmap)
    const thumbnail = generateImageThumb(bitmap)
    setEditor((s) => {
      const idx = s.elements.length
      const t = { ...DEFAULT_TRANSFORM,
        x: idx === 0 ? 0.5 : 0.3 + (idx % 3) * 0.2,
        y: idx === 0 ? 0.5 : 0.3 + Math.floor(idx / 3) * 0.2,
        scale: idx === 0 ? 1 : 0.45
      }
      const layer = {
        uid: crypto.randomUUID(), type: 'image',
        name: name || ('image-' + (idx + 1)),
        tex, imgW: bitmap.width, imgH: bitmap.height,
        thumbnail,
        visible: true, _follow: false, transform: t
      }
      setSelectedElement(layer.uid)
      return { ...s, elements: [...s.elements, layer] }
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
    setEditor((s) => ({ ...s, elements: s.elements.map(l => l.uid === shapeUid ? {
      ...l, imageTex: tex, imgThumbnail: thumb, imgW: w, imgH: h,
      imageFit: l.imageFit || 'cover', tileScale: l.tileScale || 3
    } : l) }))
  }, [])
  const clearShapeImage = (shapeUid) => {
    setEditor((s) => ({ ...s, elements: s.elements.map(l => {
      if(l.uid !== shapeUid) return l
      if(l.imageTex && engineRef.current) engineRef.current.deleteTexture(l.imageTex)
      const { imageTex, imgThumbnail, ...rest } = l
      return rest
    })}))
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

  // ============ Element ops ============
  const removeElement = (uid) => {
    setEditor((s) => {
      const el = s.elements.find(x => x.uid === uid)
      if(el && el.tex && engineRef.current) engineRef.current.deleteTexture(el.tex)
      if(el && el.imageTex && engineRef.current) engineRef.current.deleteTexture(el.imageTex)
      return { ...s, elements: s.elements.filter(x => x.uid !== uid) }
    })
    if(selectedElement === uid) setSelectedElement(null)
    followStateRef.current.delete(uid)
  }
  const duplicateElement = (uid) => {
    setEditor((s) => {
      const i = s.elements.findIndex(x => x.uid === uid)
      if(i < 0) return s
      const src = s.elements[i]
      let dup
      if(src.type === 'shape'){
        dup = { ...src, uid: crypto.randomUUID(), points: [...src.points],
          x: (src.x || 0) + 0.05, y: (src.y || 0) + 0.05 }
      } else {
        dup = { ...src, uid: crypto.randomUUID(),
          transform: { ...src.transform, x: src.transform.x + 0.05, y: src.transform.y + 0.05 } }
      }
      setSelectedElement(dup.uid)
      return { ...s, elements: [...s.elements.slice(0, i + 1), dup, ...s.elements.slice(i + 1)] }
    })
  }
  const moveElementZ = (uid, dir) => {
    setEditor((s) => {
      const i = s.elements.findIndex(x => x.uid === uid)
      const j = i + dir
      if(i < 0 || j < 0 || j >= s.elements.length) return s
      const next = [...s.elements]
      ;[next[i], next[j]] = [next[j], next[i]]
      return { ...s, elements: next }
    })
  }
  const setElementZ = (uid, newIdx) => {
    setEditor((s) => {
      const i = s.elements.findIndex(x => x.uid === uid)
      if(i < 0) return s
      const j = Math.max(0, Math.min(s.elements.length - 1, Math.round(newIdx)))
      if(i === j) return s
      const next = [...s.elements]
      const [item] = next.splice(i, 1)
      next.splice(j, 0, item)
      return { ...s, elements: next }
    })
  }
  const toggleElementVisible = (uid) => {
    setEditor((s) => ({ ...s, elements: s.elements.map(l => l.uid === uid ? { ...l, visible: !l.visible } : l) }))
  }
  const toggleElementFollow = (uid) => {
    setEditor((s) => ({ ...s, elements: s.elements.map(l => l.uid === uid ? {
      ...l, _follow: !l._follow, _followCfg: l._followCfg || { ...DEFAULT_FOLLOW }
    } : l) }))
  }
  const updateElementFollowCfg = (uid, key, value) => {
    setEditor((s) => ({ ...s, elements: s.elements.map(l => l.uid === uid ? {
      ...l, _followCfg: { ...(l._followCfg || DEFAULT_FOLLOW), [key]: value }
    } : l) }))
  }
  const updateImageTransform = (uid, key, value) => {
    setEditor((s) => ({ ...s, elements: s.elements.map(l => l.uid === uid && (l.type === 'image' || l.type === 'text') ? {
      ...l, transform: { ...l.transform, [key]: value }
    } : l) }))
  }
  const updateShapeField = (uid, key, value) => {
    setEditor((s) => ({ ...s, elements: s.elements.map(l => l.uid === uid && l.type === 'shape' ? { ...l, [key]: value } : l) }))
  }
  const updateShapeVertex = (uid, idx, x, y) => {
    setEditor((s) => ({ ...s, elements: s.elements.map(l => {
      if(l.uid !== uid || l.type !== 'shape') return l
      const points = [...l.points]
      points[idx * 2] = x; points[idx * 2 + 1] = y
      return { ...l, points }
    })}))
  }
  const updateText = (uid, key, value) => {
    setEditor((s) => {
      const els = s.elements.map(l => {
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
      })
      return { ...s, elements: els }
    })
  }
  const centerElement = (uid) => {
    setEditor((s) => ({ ...s, elements: s.elements.map(l => {
      if(l.uid !== uid) return l
      if(l.type === 'shape'){
        const [scX, scY] = shapeCentroid(l.points)
        return { ...l, x: 0.5 - scX, y: 0.5 - scY }
      }
      return { ...l, transform: { ...l.transform, x: 0.5, y: 0.5 } }
    })}))
  }
  const resetElement = (uid) => {
    setEditor((s) => ({ ...s, elements: s.elements.map(l => {
      if(l.uid !== uid) return l
      if(l.type === 'shape') return { ...l, x: 0, y: 0, opacity: 1, scale: 1, rotation: 0, cornerRadius: 0 }
      return { ...l, transform: { ...DEFAULT_TRANSFORM } }
    })}))
  }

  // ============ Effect ops ============
  const addEffect = (id) => {
    setEditor((s) => {
      const layer = { uid: crypto.randomUUID(), id, enabled: true, _follow: false, values: defaultValues(id) }
      setSelectedEffect(layer.uid)
      return { ...s, stack: [...s.stack, layer] }
    })
  }
  const removeEffect = (uid) => {
    setEditor((s) => ({ ...s, stack: s.stack.filter(l => l.uid !== uid) }))
    if(selectedEffect === uid) setSelectedEffect(null)
    followStateRef.current.delete(uid)
  }
  const duplicateEffect = (uid) => {
    setEditor((s) => {
      const i = s.stack.findIndex(l => l.uid === uid)
      if(i < 0) return s
      const src = s.stack[i]
      const dup = { ...src, uid: crypto.randomUUID(), values: { ...src.values } }
      setSelectedEffect(dup.uid)
      return { ...s, stack: [...s.stack.slice(0, i + 1), dup, ...s.stack.slice(i + 1)] }
    })
  }
  const resetEffect = (uid) => {
    setEditor((s) => ({ ...s, stack: s.stack.map(l => l.uid === uid ? { ...l, values: defaultValues(l.id) } : l) }))
  }
  const moveEffect = (uid, dir) => {
    setEditor((s) => {
      const i = s.stack.findIndex(l => l.uid === uid)
      const j = i + dir
      if(i < 0 || j < 0 || j >= s.stack.length) return s
      const next = [...s.stack]
      ;[next[i], next[j]] = [next[j], next[i]]
      return { ...s, stack: next }
    })
  }
  const toggleEffect = (uid) => {
    setEditor((s) => ({ ...s, stack: s.stack.map(l => l.uid === uid ? { ...l, enabled: !l.enabled } : l) }))
  }
  const toggleEffectFollow = (uid) => {
    setEditor((s) => ({ ...s, stack: s.stack.map(l => l.uid === uid ? {
      ...l, _follow: !l._follow, _followCfg: l._followCfg || { ...DEFAULT_FOLLOW }
    } : l) }))
  }
  const updateEffectFollowCfg = (uid, key, value) => {
    setEditor((s) => ({ ...s, stack: s.stack.map(l => l.uid === uid ? {
      ...l, _followCfg: { ...(l._followCfg || DEFAULT_FOLLOW), [key]: value }
    } : l) }))
  }
  const updateEffectValue = (key, value) => {
    setEditor((s) => ({ ...s, stack: s.stack.map(l => l.uid === selectedEffect ? { ...l, values: { ...l.values, [key]: value } } : l) }))
  }
  const clearEffects = () => { setEditor((s) => ({ ...s, stack: [] })); setSelectedEffect(null) }

  const randomize = () => {
    const ids = Object.keys(EFFECTS)
    const n = 2 + Math.floor(Math.random() * 3)
    const next = []
    for(let i = 0; i < n; i++){
      const id = ids[Math.floor(Math.random() * ids.length)]
      const vals = defaultValues(id)
      for(const p of EFFECTS[id].params){
        if(p.type === 'range') vals[p.key] = p.min + Math.random() * (p.max - p.min)
        else if(p.type === 'toggle') vals[p.key] = Math.random() < 0.4
      }
      next.push({ uid: crypto.randomUUID(), id, enabled: true, _follow: false, values: vals })
    }
    setEditor((s) => ({ ...s, stack: next }))
    setSelectedEffect(next[next.length - 1].uid)
  }

  // ============ Pen tool ============
  const closeShape = () => {
    if(drawing.points.length < 6) { setDrawing({ active: false, points: [] }); return }
    setEditor((s) => {
      const shape = {
        uid: crypto.randomUUID(), type: 'shape',
        name: `shape · ${drawing.points.length / 2} pt`,
        visible: true, _follow: false,
        points: [...drawing.points],
        fill: [...penColor], opacity: 1,
        x: 0, y: 0, scale: 1, rotation: 0, cornerRadius: 0
      }
      setSelectedElement(shape.uid)
      return { ...s, elements: [...s.elements, shape] }
    })
    setDrawing({ active: false, points: [] })
    setTool('select')
  }
  const cancelDrawing = () => setDrawing({ active: false, points: [] })

  // ============ Text tool ============
  const commitText = () => {
    if(!textDraft || !textDraft.value.trim()){ setTextDraft(null); return }
    if(!engineRef.current) return
    const canvas = renderTextToCanvas(textDraft.value, 'Inter, system-ui, sans-serif', 96, [0, 0, 0])
    const tex = engineRef.current.uploadTexture(canvas)
    setEditor((s) => {
      const layer = {
        uid: crypto.randomUUID(), type: 'text',
        name: textDraft.value.slice(0, 24),
        text: textDraft.value, font: 'Inter, system-ui, sans-serif', size: 96, color: [0, 0, 0],
        tex, imgW: canvas.width, imgH: canvas.height,
        thumbnail: canvas.toDataURL('image/png'),
        visible: true, _follow: false,
        transform: { ...DEFAULT_TRANSFORM, x: textDraft.x, y: textDraft.y, scale: 0.6 }
      }
      setSelectedElement(layer.uid)
      return { ...s, elements: [...s.elements, layer] }
    })
    setTextDraft(null)
    setTool('select')
  }

  // ============ Export ============
  const exportPNG = () => {
    canvasRef.current.toBlob((blob) => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `press-${Date.now()}.png`; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }, 'image/png')
  }

  // ============ Record video ============
  const startRecord = () => {
    if(recording) return
    const canvas = canvasRef.current
    if(!canvas || !canvas.captureStream) return alert('MediaRecorder not supported in this browser')
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
      a.href = url; a.download = `press-${Date.now()}.webm`; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1500)
      setRecording(false)
      setRecCountdown(0)
      recorderRef.current = null
    }
    recorder.start(100)
    setRecording(true)
    setRecCountdown(recDuration)
    const start = performance.now()
    const tickRec = () => {
      const elapsed = (performance.now() - start) / 1000
      const remaining = Math.max(0, Math.ceil(recDuration - elapsed))
      setRecCountdown(remaining)
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
    if(selectedElement){
      const sel = elements.find(e => e.uid === selectedElement)
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
    for(let i = elements.length - 1; i >= 0; i--){
      const l = elements[i]
      if(!l.visible) continue
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
    if(!hit){ setSelectedElement(null); return }
    if(hit.type === 'vertex'){
      dragRef.current = { kind: 'vertex', uid: hit.shape.uid, vertexIdx: hit.vertexIdx }
      e.currentTarget.setPointerCapture?.(e.pointerId)
      return
    }
    const el = hit.el
    setSelectedElement(el.uid)
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
      const sh = elements.find(x => x.uid === d.uid)
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
    setEditor((s) => ({ ...s, elements: s.elements.map(l => {
      if(l.uid !== d.uid) return l
      if(d.kind === 'shape') return { ...l, x: d.startX + (px - d.startPx), y: d.startY + (py - d.startPy) }
      return { ...l, transform: { ...d.startT, x: d.startT.x + (px - d.startPx), y: d.startT.y + (py - d.startPy) } }
    })}))
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

  // Keyboard
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
          if(selectedElement){ e.preventDefault(); removeElement(selectedElement); return }
          if(selectedEffect){ e.preventDefault(); removeEffect(selectedEffect); return }
        }
        if(e.key.toLowerCase() === 'v'){ setTool('select'); return }
        if(e.key.toLowerCase() === 'p'){ setTool('pen'); return }
        if(e.key.toLowerCase() === 't'){ setTool('text'); return }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedElement, selectedEffect, drawing.active, tool, textDraft])

  // Selection overlay
  const selectionBox = useMemo(() => {
    if(!selectedElement) return null
    const l = elements.find(x => x.uid === selectedElement)
    if(!l) return null
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
  }, [selectedElement, elements, resizeTick, aspect])

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

  const selectedFxLayer = stack.find(l => l.uid === selectedEffect)
  const selectedFx = selectedFxLayer ? EFFECTS[selectedFxLayer.id] : null
  const activePass = stack.filter(l => l.enabled).length
  const selEl = elements.find(l => l.uid === selectedElement)

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

  const ElementThumb = ({ el }) => {
    if(el.type === 'shape') return <ShapeThumb shape={el} />
    if(el.thumbnail) return <img className="thumb" src={el.thumbnail} alt="" />
    return <span className="thumb empty" />
  }
  const labelForType = (t) => t === 'image' ? 'IMG' : t === 'shape' ? 'SHP' : t === 'text' ? 'TXT' : '?'

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

  // Renders the per-layer follow controls (when _follow is true)
  const FollowControls = ({ uid, cfg, updateCfg }) => {
    const c = cfg || DEFAULT_FOLLOW
    return (
      <div className="follow-controls">
        <ParamControl param={{ key:'momentum', label:'follow momentum', type:'range', min:0.02, max:0.5, step:0.001, default:0.18 }}
          value={c.momentum} onChange={(v) => updateCfg(uid, 'momentum', v)} />
        <ParamControl param={{ key:'intensityX', label:'follow intensity x', type:'range', min:0, max:1, step:0.01, default:1 }}
          value={c.intensityX} onChange={(v) => updateCfg(uid, 'intensityX', v)} />
        <ParamControl param={{ key:'intensityY', label:'follow intensity y', type:'range', min:0, max:1, step:0.01, default:1 }}
          value={c.intensityY} onChange={(v) => updateCfg(uid, 'intensityY', v)} />
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
          <span className="logo">PRESS</span>
          <span className="sub">collage · {Object.keys(EFFECTS).length} shaders</span>
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
                  <button key={e.id} className="cat-item" onClick={() => addEffect(e.id)}>
                    <span className="cat-item-label">{e.label}</span>
                    <span className="add">+</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        <div className="hint">v select · p pen · t text · drop images</div>
      </div>

      {/* CENTER */}
      <div className="center">
        <div className={'canvas-wrap tool-' + tool} style={aspectStyle}>
          <div className="canvas-tag">{elements.length} el · {activePass} fx{recording ? ` · REC ${recCountdown}s` : ''}</div>
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
        {/* ELEMENTS */}
        <div className="section-bar">
          <span className="section-letter">1</span>
          <span className="section-label">ELEMENTS</span>
          <span className="section-count">{elements.length}</span>
        </div>
        <div className="layer-list">
          {elements.length === 0 && <div className="empty-panel">drop image · sample · pen · text</div>}
          {elements.map((l, i) => (
            <div key={l.uid}
              className={'layer card-layer ' + (l.uid === selectedElement ? 'selected ' : '') + (l.visible ? '' : 'disabled')}
              onClick={() => setSelectedElement(l.uid)}>
              <ElementThumb el={l} />
              <div className="card-meta">
                <span className="card-line">
                  <span className="idx">{String(i + 1).padStart(2, '0')}</span>
                  <span className="type-icon" title={l.type}>{labelForType(l.type)}</span>
                  {l._follow && <span className="follow-badge" title="follows cursor">⊙</span>}
                </span>
                <span className="name">{l.name}</span>
              </div>
              <div className="layer-actions" onClick={(e) => e.stopPropagation()}>
                <button className={'follow-btn ' + (l._follow ? 'on' : '')} title="follow cursor" onClick={() => toggleElementFollow(l.uid)}>⊙</button>
                <button title="visible"   onClick={() => toggleElementVisible(l.uid)}>{l.visible ? '●' : '○'}</button>
                <button title="duplicate" onClick={() => duplicateElement(l.uid)}>+</button>
                <button title="up"        onClick={() => moveElementZ(l.uid, +1)}>↑</button>
                <button title="down"      onClick={() => moveElementZ(l.uid, -1)}>↓</button>
                <button title="delete"    onClick={() => removeElement(l.uid)}>×</button>
              </div>
            </div>
          ))}
        </div>

        {selEl && (
          <>
            <div className="sub-bar">
              <span>{(selEl.name || 'untitled').slice(0, 22)}</span>
              <span className="sub-tag">{(selEl.type || '').toUpperCase()}</span>
            </div>
            <div className="params">
              {selEl.type === 'text' && (
                <div className="param">
                  <div className="param-h"><span>text</span></div>
                  <input className="text-edit" type="text" value={selEl.text}
                    onChange={(e) => updateText(selEl.uid, 'text', e.target.value)} />
                </div>
              )}
              {(selEl.type === 'image' || selEl.type === 'text') && (
                <>
                  <ParamControl param={{ key: 'x', label: 'x', type: 'range', min: -0.5, max: 1.5, step: 0.001, default: 0.5 }}
                    value={selEl.transform.x} onChange={(v) => updateImageTransform(selEl.uid, 'x', v)} />
                  <ParamControl param={{ key: 'y', label: 'y', type: 'range', min: -0.5, max: 1.5, step: 0.001, default: 0.5 }}
                    value={selEl.transform.y} onChange={(v) => updateImageTransform(selEl.uid, 'y', v)} />
                  <ParamControl param={{ key: 'scale', label: 'scale', type: 'range', min: 0.05, max: 3, step: 0.001, default: 1 }}
                    value={selEl.transform.scale} onChange={(v) => updateImageTransform(selEl.uid, 'scale', v)} />
                  <ParamControl param={{ key: 'rotation', label: 'rotation', type: 'range', min: -Math.PI, max: Math.PI, step: 0.001, default: 0 }}
                    value={selEl.transform.rotation} onChange={(v) => updateImageTransform(selEl.uid, 'rotation', v)} />
                  <ParamControl param={{ key: 'opacity', label: 'opacity', type: 'range', min: 0, max: 1, step: 0.01, default: 1 }}
                    value={selEl.transform.opacity} onChange={(v) => updateImageTransform(selEl.uid, 'opacity', v)} />
                </>
              )}
              {selEl.type === 'text' && (
                <>
                  <ParamControl param={{ key: 'size', label: 'font size', type: 'range', min: 16, max: 300, step: 1, default: 96 }}
                    value={selEl.size} onChange={(v) => updateText(selEl.uid, 'size', v)} />
                  <ParamControl param={{ key: 'color', label: 'color', type: 'color', default: [0,0,0] }}
                    value={selEl.color} onChange={(v) => updateText(selEl.uid, 'color', v)} />
                </>
              )}
              {selEl.type === 'shape' && (
                <>
                  <ParamControl param={{ key: 'x', label: 'offset x', type: 'range', min: -1, max: 1, step: 0.001, default: 0 }}
                    value={selEl.x || 0} onChange={(v) => updateShapeField(selEl.uid, 'x', v)} />
                  <ParamControl param={{ key: 'y', label: 'offset y', type: 'range', min: -1, max: 1, step: 0.001, default: 0 }}
                    value={selEl.y || 0} onChange={(v) => updateShapeField(selEl.uid, 'y', v)} />
                  <ParamControl param={{ key: 'scale', label: 'scale', type: 'range', min: 0.1, max: 3, step: 0.001, default: 1 }}
                    value={selEl.scale == null ? 1 : selEl.scale} onChange={(v) => updateShapeField(selEl.uid, 'scale', v)} />
                  <ParamControl param={{ key: 'rotation', label: 'rotation', type: 'range', min: -Math.PI, max: Math.PI, step: 0.001, default: 0 }}
                    value={selEl.rotation || 0} onChange={(v) => updateShapeField(selEl.uid, 'rotation', v)} />
                  <ParamControl param={{ key: 'cornerRadius', label: 'border radius', type: 'range', min: 0, max: 0.5, step: 0.001, default: 0 }}
                    value={selEl.cornerRadius || 0} onChange={(v) => updateShapeField(selEl.uid, 'cornerRadius', v)} />
                  <ParamControl param={{ key: 'opacity', label: 'opacity', type: 'range', min: 0, max: 1, step: 0.01, default: 1 }}
                    value={selEl.opacity == null ? 1 : selEl.opacity}
                    onChange={(v) => updateShapeField(selEl.uid, 'opacity', v)} />
                  {!selEl.imageTex && (
                    <ParamControl param={{ key: 'fill', label: 'fill color', type: 'color', default: [0,0,0] }}
                      value={selEl.fill} onChange={(v) => updateShapeField(selEl.uid, 'fill', v)} />
                  )}
                  <div className="row-btns">
                    {selEl.imageTex
                      ? <button className="mini-btn" onClick={() => clearShapeImage(selEl.uid)}>remove image</button>
                      : <button className="mini-btn" onClick={() => triggerAssignImage(selEl.uid)}>assign image</button>
                    }
                  </div>
                  {selEl.imageTex && (
                    <>
                      <ParamControl param={{ key:'imageFit', label:'image fit', type:'select',
                        options:[['cover',0],['contain',1],['tile',2]],
                        default:0
                      }}
                        value={({cover:0,contain:1,tile:2})[selEl.imageFit ?? 'cover'] ?? 0}
                        onChange={(v) => {
                          const map = ['cover','contain','tile']
                          updateShapeField(selEl.uid, 'imageFit', map[v] || 'cover')
                        }} />
                      {selEl.imageFit === 'tile' && (
                        <ParamControl param={{ key:'tileScale', label:'tile scale', type:'range', min:1, max:20, step:0.1, default:3 }}
                          value={selEl.tileScale || 3}
                          onChange={(v) => updateShapeField(selEl.uid, 'tileScale', v)} />
                      )}
                    </>
                  )}
                </>
              )}
              <ParamControl param={{ key: 'z', label: 'z (depth)', type: 'range', min: 1, max: Math.max(elements.length, 1), step: 1, default: 1 }}
                value={elements.findIndex(e => e.uid === selEl.uid) + 1}
                onChange={(v) => setElementZ(selEl.uid, v - 1)} />
              <div className="row-btns">
                <button className="mini-btn" onClick={() => centerElement(selEl.uid)}>center</button>
                <button className="mini-btn" onClick={() => resetElement(selEl.uid)}>reset</button>
                <button className={'mini-btn ' + (selEl._follow ? 'on' : '')} onClick={() => toggleElementFollow(selEl.uid)}>
                  ⊙ follow cursor
                </button>
              </div>
              {selEl._follow && (
                <FollowControls uid={selEl.uid} cfg={selEl._followCfg} updateCfg={updateElementFollowCfg} />
              )}
            </div>
          </>
        )}

        {/* EFFECTS */}
        <div className="section-bar">
          <span className="section-letter">2</span>
          <span className="section-label">EFFECTS</span>
          <span className="section-count">{stack.length}</span>
          {stack.length > 0 && (
            <button className="section-action" onClick={randomize}>SCRAMBLE</button>
          )}
        </div>
        <div className="layer-list">
          {stack.length === 0 && <div className="empty-panel">click an effect on the left</div>}
          {stack.map((l, i) => {
            const fx = EFFECTS[l.id]
            const followable = !!fx.followCursor
            return (
            <div key={l.uid}
              className={'layer effect-layer ' + (l.uid === selectedEffect ? 'selected ' : '') + (l.enabled ? '' : 'disabled')}
              onClick={() => setSelectedEffect(l.uid)}>
              <span className="idx">{String(i + 1).padStart(2, '0')}</span>
              <span className="name">{fx.label}</span>
              <div className="layer-actions" onClick={(e) => e.stopPropagation()}>
                {followable && <button className={'follow-btn ' + (l._follow ? 'on' : '')} title="follow cursor" onClick={() => toggleEffectFollow(l.uid)}>⊙</button>}
                <button title="toggle"    onClick={() => toggleEffect(l.uid)}>{l.enabled ? '●' : '○'}</button>
                <button title="duplicate" onClick={() => duplicateEffect(l.uid)}>+</button>
                <button title="reset"     onClick={() => resetEffect(l.uid)}>↺</button>
                <button title="up"        onClick={() => moveEffect(l.uid, -1)}>↑</button>
                <button title="down"      onClick={() => moveEffect(l.uid, +1)}>↓</button>
                <button title="delete"    onClick={() => removeEffect(l.uid)}>×</button>
              </div>
            </div>
          )})}
          {stack.length > 0 && (
            <div className="row-btns" style={{ padding: '8px 12px' }}>
              <button className="mini-btn" onClick={clearEffects}>clear all</button>
            </div>
          )}
        </div>

        {selectedFxLayer && selectedFx ? (
          <div className="params-block">
            <div className="sub-bar editing">
              <span>EDITING</span>
              <span className="editing-name">{selectedFx.label}</span>
              <span className="sub-tag">{selectedFx.group}</span>
            </div>
            <div className="params">
              {selectedFx.followCursor && (
                <>
                  <div className="param">
                    <div className="toggle">
                      <div className={'switch ' + (selectedFxLayer._follow ? 'on' : '')}
                        onClick={() => toggleEffectFollow(selectedFxLayer.uid)} />
                      <span>⊙ follow cursor</span>
                    </div>
                  </div>
                  {selectedFxLayer._follow && (
                    <FollowControls uid={selectedFxLayer.uid} cfg={selectedFxLayer._followCfg} updateCfg={updateEffectFollowCfg} />
                  )}
                </>
              )}
              {selectedFx.params.map((p) => (
                <ParamControl key={p.key} param={p}
                  value={selectedFxLayer.values[p.key]}
                  onChange={(v) => updateEffectValue(p.key, v)} />
              ))}
            </div>
          </div>
        ) : (
          stack.length > 0 && <div className="hint">↑ click an effect to edit values</div>
        )}
      </div>

      {/* STATUS BAR */}
      <div className="statusbar">
        <span className="ok">webgl2 · {elements.length} el · {activePass} fx</span>
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
