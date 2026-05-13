import React, { useEffect, useRef, useState } from 'react'

const rgb2hex = (c) => {
  const t = (x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')
  return '#' + t(c[0]) + t(c[1]) + t(c[2])
}
const hex2rgb = (h) => {
  const s = h.replace('#', '')
  return [parseInt(s.slice(0,2), 16)/255, parseInt(s.slice(2,4), 16)/255, parseInt(s.slice(4,6), 16)/255]
}

const formatVal = (v, step) => {
  if(step >= 1) return String(Math.round(v))
  const decimals = step >= 0.01 ? 2 : step >= 0.001 ? 3 : 4
  return (+v).toFixed(decimals)
}

const clampSnap = (v, p) => {
  v = Math.max(p.min, Math.min(p.max, v))
  if(p.step >= 1) v = Math.round(v)
  return v
}

// Input that lets the user type freely (uncontrolled-while-focused). The displayed
// formatted value only re-syncs when the field is blurred or the external value
// changes while not focused. Commit on Enter / blur / Escape (escape reverts).
function NumField({ value, param, onChange }){
  const [draft, setDraft] = useState(formatVal(value, param.step))
  const focusedRef = useRef(false)
  useEffect(() => {
    if(!focusedRef.current) setDraft(formatVal(value, param.step))
  }, [value, param.step])
  const commit = () => {
    const v = parseFloat(draft)
    if(Number.isNaN(v)){
      setDraft(formatVal(value, param.step))
    } else {
      const c = clampSnap(v, param)
      onChange(c)
      setDraft(formatVal(c, param.step))
    }
  }
  return (
    <input
      className="numinput"
      type="text"
      inputMode="decimal"
      value={draft}
      onFocus={(e) => { focusedRef.current = true; e.target.select() }}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if(e.key === 'Enter'){ e.preventDefault(); e.target.blur() }
        else if(e.key === 'Escape'){ setDraft(formatVal(value, param.step)); e.target.blur() }
        else if(e.key === 'ArrowUp' || e.key === 'ArrowDown'){
          e.preventDefault()
          const dir = e.key === 'ArrowUp' ? 1 : -1
          const mult = e.shiftKey ? 10 : (e.altKey ? 0.1 : 1)
          const next = clampSnap(value + dir * param.step * mult, param)
          onChange(next)
          setDraft(formatVal(next, param.step))
        }
      }}
      onBlur={() => { focusedRef.current = false; commit() }}
    />
  )
}

export default function ParamControl({ param, value, onChange }){
  if(param.type === 'range'){
    const pct = ((value - param.min) / (param.max - param.min)) * 100

    const startScrub = (e) => {
      if(e.button !== 0) return
      // Don't start scrubbing if user is double-clicking on the label to reset
      e.preventDefault()
      const startX = e.clientX
      const startVal = value
      const range = param.max - param.min
      let last = startVal
      const move = (ev) => {
        const dx = ev.clientX - startX
        const sens = ev.shiftKey ? 0.0005 : 0.005
        let v = startVal + dx * range * sens
        v = clampSnap(v, param)
        if(v !== last){ last = v; onChange(v) }
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        document.body.style.cursor = ''
      }
      document.body.style.cursor = 'ew-resize'
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    }

    const onDouble = () => onChange(param.default)

    return (
      <div className="param">
        <div className="param-h">
          <span
            className="label-scrub"
            onPointerDown={startScrub}
            onDoubleClick={onDouble}
            title="drag to scrub · double-click to reset · click box to type"
          >{param.label}</span>
          <NumField value={value} param={param} onChange={onChange} />
        </div>
        <input
          className="range"
          type="range"
          min={param.min}
          max={param.max}
          step={param.step}
          value={value}
          style={{ '--p': pct + '%' }}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          onDoubleClick={onDouble}
        />
      </div>
    )
  }

  if(param.type === 'color'){
    const hex = rgb2hex(value)
    return (
      <div className="param">
        <div className="param-h">
          <span
            className="label-scrub"
            onDoubleClick={() => onChange(param.default)}
            title="double-click to reset"
          >{param.label}</span>
          <span className="v">{hex.toUpperCase()}</span>
        </div>
        <div className="color">
          <input type="color" value={hex} onChange={(e) => onChange(hex2rgb(e.target.value))} />
          <input type="text" value={hex.toUpperCase()} onChange={(e) => {
            const v = e.target.value.trim()
            if(/^#?[0-9a-fA-F]{6}$/.test(v)) onChange(hex2rgb(v.startsWith('#') ? v : '#' + v))
          }} />
        </div>
      </div>
    )
  }

  if(param.type === 'toggle'){
    const on = value === true || value === 1 || value > 0.5
    return (
      <div className="param">
        <div className="toggle">
          <div className={'switch ' + (on ? 'on' : '')} onClick={() => onChange(!on)} />
          <span
            className="label-scrub"
            onDoubleClick={() => onChange(param.default)}
            title="double-click to reset"
          >{param.label}</span>
        </div>
      </div>
    )
  }

  if(param.type === 'select'){
    return (
      <div className="param">
        <div className="param-h">
          <span
            className="label-scrub"
            onDoubleClick={() => onChange(param.default)}
          >{param.label}</span>
        </div>
        <select className="select" value={value} onChange={(e) => onChange(parseFloat(e.target.value))}>
          {param.options.map(([label, v]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </select>
      </div>
    )
  }

  if(param.type === 'text'){
    return (
      <div className="param">
        <div className="param-h">
          <span
            className="label-scrub"
            onDoubleClick={() => onChange(param.default)}
            title="double-click to reset"
          >{param.label}</span>
          {value && <span className="v">{[...String(value)].length} ch</span>}
        </div>
        <input
          className="text-input"
          type="text"
          value={value || ''}
          placeholder={param.placeholder || ''}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
        {param.hint && <div className="param-hint">{param.hint}</div>}
      </div>
    )
  }

  return null
}
