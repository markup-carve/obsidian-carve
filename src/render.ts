import { carveToHtml } from '@markup-carve/carve'

/** Raw HTML is deliberately disabled for vault content by default. */
export function renderCarve(source: string): string {
  return carveToHtml(source, { allowRawHtml: false })
}
