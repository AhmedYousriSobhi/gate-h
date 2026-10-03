/* eslint-disable @typescript-eslint/explicit-function-return-type -- plain JS, nothing to annotate */
/* Places numbered captions beside the mockup and draws highlight boxes + arrows to the elements
   they point at. A caption is `<div class="cap" data-for="element-id" data-side="r|l">`; the
   badge number is its order in the document. Runs once fonts are loaded. */
const NS = 'http://www.w3.org/2000/svg'
const GAP = 64

function el(name, attrs) {
  const node = document.createElementNS(NS, name)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  return node
}

function layout() {
  const stage = document.querySelector('.stage')
  const sRect = stage.getBoundingClientRect()
  const mRect = stage.querySelector('.mock').getBoundingClientRect()
  const svg = el('svg', { class: 'ann' })
  svg.innerHTML =
    '<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#578dfa"/></marker></defs>'
  stage.appendChild(svg)

  const caps = [...stage.querySelectorAll('.cap')]
  const rel = (r) => ({
    l: r.left - sRect.left,
    r: r.right - sRect.left,
    t: r.top - sRect.top,
    b: r.bottom - sRect.top
  })
  const items = caps.map((cap, i) => {
    const target = document.getElementById(cap.dataset.for)
    if (!target) throw new Error(`no element #${cap.dataset.for}`)
    const side = cap.dataset.side || 'r'
    const badge = document.createElement('span')
    badge.className = 'badge'
    badge.textContent = String(i + 1)
    cap.prepend(badge)
    return { cap, side, pt: cap.dataset.pt, rect: rel(target.getBoundingClientRect()), n: i + 1 }
  })

  const mL = mRect.left - sRect.left
  const mR = mRect.right - sRect.left
  let bottom = 0
  for (const side of ['l', 'r']) {
    const col = items.filter((it) => it.side === side)
    const x = side === 'r' ? mR + GAP : 0
    const w = side === 'r' ? sRect.width - x : mL - GAP
    const key = (it) =>
      it.pt === 'b' ? it.rect.b + 40 : it.pt === 't' ? it.rect.t - 12 : (it.rect.t + it.rect.b) / 2
    col.sort((a, b) => key(a) - key(b))
    let prev = -Infinity
    for (const it of col) {
      it.cap.style.left = `${x}px`
      it.cap.style.width = `${w}px`
      const h = it.cap.offsetHeight
      const wanted = key(it) - 14
      const top = Math.max(wanted, prev + 18)
      it.cap.style.top = `${top}px`
      prev = top + h
      bottom = Math.max(bottom, prev)
    }
  }
  for (const it of items) {
    const pad = 3
    const { l, r, t, b } = it.rect
    svg.appendChild(
      el('rect', {
        class: 'hl',
        x: l - pad,
        y: t - pad,
        width: r - l + pad * 2,
        height: b - t + pad * 2,
        rx: 8
      })
    )
    if (it.cap.dataset.lead === 'none') {
      // Dense toolbars: a badge on the target itself instead of a leader line.
      svg.appendChild(
        el('circle', {
          cx: l - pad,
          cy: t - pad,
          r: 12,
          fill: '#3b7cf6',
          stroke: '#0a0a0c',
          'stroke-width': 3
        })
      )
      svg.appendChild(
        el('text', {
          x: l - pad,
          y: t - pad + 5,
          'text-anchor': 'middle',
          fill: '#fff',
          'font-size': 13,
          'font-weight': 700
        })
      ).textContent = String(it.n)
      continue
    }
    const ct = it.cap.offsetTop + 14
    const startX =
      it.side === 'r' ? it.cap.offsetLeft - 2 : it.cap.offsetLeft + it.cap.offsetWidth + 2
    let d
    if (it.pt === 't') {
      // Run along the clear strip above the target, then drop onto its top edge.
      const gx = it.side === 'r' ? mR + GAP * 0.4 : mL - GAP * 0.4
      const tx = (l + r) / 2
      const yt = t - pad - 12
      d = `M ${startX} ${ct} L ${gx} ${yt} L ${tx} ${yt} L ${tx} ${t - pad - 2}`
    } else if (it.pt === 'b') {
      // Attach to the bottom edge, for a target whose side is blocked by a neighbouring control.
      const tx = (l + r) / 2
      const ty = b + pad + 2
      d = `M ${startX} ${ct} C ${startX + (it.side === 'r' ? -120 : 120)} ${ct}, ${tx + 20} ${ty + 70}, ${tx} ${ty}`
    } else {
      const ty = Math.min(Math.max(ct, t), b)
      const tx = it.side === 'r' ? r + pad : l - pad
      // Horizontal leader off the target, then a short slant in the gutter to the caption badge.
      const gx = it.side === 'r' ? mR + GAP * 0.4 : mL - GAP * 0.4
      d = `M ${startX} ${ct} L ${gx} ${ty} L ${tx + (it.side === 'r' ? 3 : -3)} ${ty}`
    }
    svg.appendChild(el('path', { class: 'ln', d, 'marker-end': 'url(#ah)' }))
  }
  stage.style.minHeight = `${bottom}px`
}

// Called by scripts/render-annotated.mjs once the lucide icons are in place.
window.annotate = () => document.fonts.ready.then(layout)
