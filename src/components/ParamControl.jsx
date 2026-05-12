import React, { useRef } from 'react'

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

export default function ParamControl({ param, value, onChange }){
  const inputRef = useRef(null)

  if(param.type === 'range'){
    const pct = ((value - param.min) / (param.max - param.min)) * 100
    const display = formatVal(value, param.step)

    const startScrub = (e) => {
      if(e.button !== 0) return
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

    const onNumChange = (e) => {
      const v = parseFloat(e.target.value)
      if(!Number.isNaN(v)) onChange(clampSnap(v, param))
    }

    return (
      <div className="param">
        <div className="param-h">
          <span
            className="label-scrub"
            onPointerDown={startScrub}
            onDoubleClick={onDouble}
            title="drag to scrub · double-click to reset"
          >{param.label}</span>
          <input
            ref={inputRef}
            className="numinput"
            type="text"
            inputMode="decimal"
            value={display}
            onChange={onNumChange}
            onBlur={(e) => { const v = parseFloat(e.target.value); if(!Number.isNaN(v)) onChange(clampSnap(v, param)) }}
          />
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
  return null
}
