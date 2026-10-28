import { strFromU8, unzipSync } from "fflate";

/** Opens a .pptx the way PowerPoint must: a zip whose parts are well-formed XML. Returns each slide's text runs. */
export function openPptx(bytes: Uint8Array): { files: string[]; slides: string[][] } {
  const zip = unzipSync(bytes);
  const files = Object.keys(zip);
  for (const [name, data] of Object.entries(zip)) {
    if (!/\.(xml|rels)$/.test(name)) continue;
    const xml = strFromU8(data);
    if (!wellFormed(xml)) throw new Error(`${name} is not well-formed XML`);
  }
  const slideNames = files.filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const slides = slideNames.map((f) => [...strFromU8(zip[f]).matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => unescape(m[1])));
  return { files, slides };
}

/** Every element closes in order; nothing is left open. */
function wellFormed(xml: string): boolean {
  const body = xml.replace(/<\?xml[^>]*\?>/, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  const stack: string[] = [];
  for (const m of body.matchAll(/<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>/g)) {
    const [, close, name, , self] = m;
    if (self) continue;
    if (close) {
      if (stack.pop() !== name) return false;
    } else stack.push(name);
  }
  return stack.length === 0 && body.trim().startsWith("<");
}
