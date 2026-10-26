/** The diagram itself — not an icon of the zoom bar or the legend, which are SVGs too */
function diagramOf(container: HTMLElement): SVGSVGElement | null {
  return container.querySelector<SVGSVGElement>('svg[data-diagram]')
}

export function downloadSvg(container: HTMLElement, filename: string) {
  const svg = diagramOf(container)
  if (!svg) return
  const clone = svg.cloneNode(true) as SVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const xml = new XMLSerializer().serializeToString(clone)
  trigger(
    URL.createObjectURL(new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + xml], { type: 'image/svg+xml' })),
    filename,
  )
}

/**
 * The diagram as a PNG: drawn at its full size (not the on-screen zoom), sharp (2×), on
 * white. Very large processes are scaled down to stay within what browsers can draw.
 */
export function downloadPng(container: HTMLElement, filename: string) {
  const svg = diagramOf(container)
  if (!svg) return
  const box = svg.viewBox?.baseVal
  const w = box && box.width ? box.width : parseFloat(svg.getAttribute('width') || '1200')
  const h = box && box.height ? box.height : parseFloat(svg.getAttribute('height') || '800')
  const MAX_SIDE = 16000
  const MAX_AREA = 120_000_000
  const scale = Math.min(2, MAX_SIDE / w, MAX_SIDE / h, Math.sqrt(MAX_AREA / (w * h)))

  const clone = svg.cloneNode(true) as SVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(w))
  clone.setAttribute('height', String(h))
  // an SVG drawn as an image does not get the page's fonts: name a sans-serif stack
  clone.setAttribute('font-family', "'IBM Plex Sans', 'Noto Sans Bengali', 'Segoe UI', Arial, sans-serif")
  const xml = new XMLSerializer().serializeToString(clone)
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }))
  const img = new Image()
  img.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w * scale)
    canvas.height = Math.round(h * scale)
    const ctx = canvas.getContext('2d')!
    ctx.scale(scale, scale)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    canvas.toBlob((blob) => {
      if (blob) trigger(URL.createObjectURL(blob), filename)
      URL.revokeObjectURL(url)
    }, 'image/png')
  }
  img.onerror = () => URL.revokeObjectURL(url)
  img.src = url
}

export function downloadCsv(columns: string[], rows: string[][], filename: string) {
  const esc = (v: string) => `"${(v ?? '').replace(/"/g, '""')}"`
  const lines = [columns, ...rows].map((r) => r.map(esc).join(','))
  trigger(
    URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })),
    filename,
  )
}

export function downloadText(text: string, filename: string, type = 'application/xml') {
  trigger(URL.createObjectURL(new Blob([text], { type })), filename)
}

function trigger(href: string, filename: string) {
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(href), 5000)
}
