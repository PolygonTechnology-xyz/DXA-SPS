/** An icon exported from the Figma file (public/figma). Its shape is used as a mask so it takes the text colour. */
export function FigmaIcon({ name, size }: { name: string; size: number }) {
  const mask = `url(/figma/${name}.svg) center / contain no-repeat`;
  return <span className="ficon" aria-hidden="true" style={{ width: size, height: size, mask, WebkitMask: mask }} />;
}
