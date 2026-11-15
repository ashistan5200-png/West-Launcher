/**
 * Küçük, bağımlılıksız Markdown → güvenli HTML dönüştürücü (Modrinth açıklamaları
 * ve sürüm notları için). Modrinth metinleri bazen ham HTML de içerir; çıktı her
 * durumda izin listesiyle temizlenir (betik, iframe, olay öznitelikleri atılır).
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function inline(s: string): string {
  // Kod parçaları önce korunur
  const codes: string[] = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(esc(c)) - 1}\u0000`);
  s = s
    .replace(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, '<img alt="$1" src="$2">')
    .replace(/\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, '<a href="$2">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2">$2</a>')
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<strong>${a ?? b}</strong>`)
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
}

export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  const isBlockStart = (l: string) => /^(#{1,6}\s|>|\s*[-*+]\s|\s*\d+[.)]\s|```|\s*(?:-{3,}|\*{3,}|_{3,})\s*$|\|)/.test(l) || /^\s*</.test(l);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    // Kod bloğu
    if (line.startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*$/);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push("<hr>"); i++; continue; }
    if (line.startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) buf.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote>${markdownToHtml(buf.join("\n"))}</blockquote>`);
      continue;
    }
    // Tablo
    if (line.trim().startsWith("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim()));
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++]));
      out.push(`<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    // Liste (iç içe girinti basitçe düzleştirilir)
    const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      const ordered = /\d/.test(li[2]);
      const items: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (m) { items.push(inline(m[3])); i++; continue; }
        if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) { items[items.length - 1] += " " + inline(lines[i].trim()); i++; continue; }
        break;
      }
      out.push(`<${ordered ? "ol" : "ul"}>${items.map((t) => `<li>${t}</li>`).join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }
    // Ham HTML bloğu: olduğu gibi (aşağıda temizlenir)
    if (/^\s*</.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim()) buf.push(lines[i++]);
      out.push(buf.map((l) => (/^\s*</.test(l) ? l : inline(l))).join("\n"));
      continue;
    }
    // Paragraf
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !(buf.length && isBlockStart(lines[i]))) buf.push(lines[i++]);
    out.push(`<p>${buf.map(inline).join("<br>")}</p>`);
  }
  return sanitizeHtml(out.join("\n"));
}

const ALLOWED = new Set(["P", "BR", "HR", "H1", "H2", "H3", "H4", "H5", "H6", "STRONG", "B", "EM", "I", "U", "DEL", "S", "CODE", "PRE", "BLOCKQUOTE", "UL", "OL", "LI", "A", "IMG", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "DETAILS", "SUMMARY", "SPAN", "DIV", "CENTER", "SUP", "SUB", "SMALL", "KBD", "MARK", "FIGURE", "FIGCAPTION", "PICTURE", "SOURCE", "VIDEO"]);
const ATTRS: Record<string, string[]> = { A: ["href", "title"], IMG: ["src", "alt", "title", "width", "height"], SOURCE: ["srcset", "type"], VIDEO: ["src", "poster", "controls", "muted", "loop"], TD: ["colspan", "rowspan"], TH: ["colspan", "rowspan"] };

/** İzin listesi temizleyici; dış bağlantılar `data-external` ile işaretlenir. */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      if (!ALLOWED.has(child.tagName)) {
        if (["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "FORM", "LINK", "META", "INPUT", "BUTTON", "TEXTAREA", "SELECT"].includes(child.tagName)) child.remove();
        else child.replaceWith(...child.childNodes);
        continue;
      }
      const allowed = ATTRS[child.tagName] ?? [];
      for (const a of [...child.attributes]) {
        if (!allowed.includes(a.name) && !(a.name === "align")) child.removeAttribute(a.name);
      }
      for (const name of ["href", "src", "poster"]) {
        const v = child.getAttribute(name);
        if (v !== null && !/^https?:\/\//i.test(v.trim())) child.removeAttribute(name);
      }
      if (child.tagName === "A") {
        child.setAttribute("data-external", child.getAttribute("href") ?? "");
        child.removeAttribute("href");
        child.setAttribute("href", "#");
      }
      if (child.tagName === "IMG") {
        child.setAttribute("loading", "lazy");
        child.setAttribute("referrerpolicy", "no-referrer");
      }
      walk(child);
    }
  };
  const root = doc.body.firstElementChild!;
  walk(root);
  return root.innerHTML;
}
