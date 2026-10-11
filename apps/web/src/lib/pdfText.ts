/**
 * jsPDF's built-in Helvetica covers WinAnsi and nothing else: a character
 * outside it is not an error, it just comes out as the wrong glyph. The
 * app's own strings are written for the screen and use a few such characters
 * freely, so every string bound for the PDF goes through here first.
 */
const REPLACEMENTS: Record<string, string> = {
  '≤': '<=',
  '≥': '>=',
  '→': '->',
  'θ': 'theta',
  '′': "'",
  '−': '-',
};

export function pdfSafe(text: string): string {
  return text.replace(/[≤≥→θ′−]/g, (ch) => REPLACEMENTS[ch] ?? ch);
}
