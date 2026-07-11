// Thin wrapper around the `qrcode` package, scoped to the one shape this app
// needs: inline SVG markup for a join link. Rendering as inline SVG (instead
// of an <img src="data:..."> pointed at a hosted image) means no external
// request and no extra CSP allowance — the QR is just DOM the browser
// already trusts.
import QRCode from 'qrcode'

export async function toSvgMarkup(text: string): Promise<string> {
  return QRCode.toString(text, { type: 'svg', margin: 1 })
}
