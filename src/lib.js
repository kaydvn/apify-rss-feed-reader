import { domainToASCII } from 'node:url';
import { XMLParser } from 'fast-xml-parser';

export const COMMON_PATHS = ['/feed', '/rss.xml', '/atom.xml', '/index.xml', '/feed.xml', '/rss'];
const SUMMARY_MAX = 1000;

export function normalizeUrl(raw) {
    let s = String(raw ?? '').trim();
    if (!s) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
    try {
        const u = new URL(s);
        if (!/^https?:$/.test(u.protocol) || !domainToASCII(u.hostname)) return null;
        u.hash = '';
        return u.href;
    } catch {
        return null;
    }
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '...', mdash: '-', ndash: '-', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"' };
export function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
        if (e[0] === '#') {
            const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
            return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
        }
        return ENT[e.toLowerCase()] ?? m;
    });
}

/** HTML to plain text. max = 0 means no limit. */
export function stripHtml(html, max = 0) {
    if (html == null) return null;
    let s = String(html)
        .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<\/(p|div|li|h[1-6]|blockquote|tr)>|<br\s*\/?>/gi, '\n')
        .replace(/<[^>]*>/g, ' ');
    s = decodeEntities(s).replace(/[ \t\f\v ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!s) return null;
    if (max && s.length > max) s = `${s.slice(0, max - 3).replace(/\s+\S*$/, '')}...`;
    return s;
}

/** RFC 822 or ISO 8601 date to ISO string (UTC), or null. */
export function parseDate(v) {
    if (v == null) return null;
    let s = String(v).trim();
    if (!s) return null;
    if (/^\d{10,13}$/.test(s)) {
        const n = Number(s);
        s = new Date(s.length === 10 ? n * 1000 : n).toISOString();
    }
    // "2024-01-02 03:04:05" and RFC 822 with numeric zone without colon are handled by Date; fix bare date-time without zone as UTC
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s = `${s.replace(' ', 'T')}Z`;
    s = s.replace(/\s+(UT|UTC)$/i, ' GMT');
    const t = Date.parse(s);
    if (!Number.isFinite(t)) return null;
    const y = new Date(t).getUTCFullYear();
    if (y < 1970 || y > 2100) return null;
    return new Date(t).toISOString();
}

// ---------- XML helpers ----------
const ARRAY_TAGS = new Set(['item', 'entry', 'category', 'link', 'enclosure', 'media:content', 'media:thumbnail', 'dc:subject', 'author', 'dc:creator', 'media:group']);
const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    processEntities: true,
    isArray: (name) => ARRAY_TAGS.has(name),
});

const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
function txt(v) {
    if (v == null) return null;
    if (Array.isArray(v)) return txt(v[0]);
    if (typeof v === 'object') return txt(v['#text']);
    const s = String(v).trim();
    return s || null;
}
const attr = (o, k) => (o && typeof o === 'object' ? o[`@_${k}`] ?? null : null);
const cleanText = (v, max = 0) => stripHtml(txt(v), max);

export function looksLikeFeed(text) {
    const head = String(text).slice(0, 4000).trimStart();
    if (head.startsWith('{')) return /jsonfeed\.org|"items"\s*:/.test(text.slice(0, 20000));
    return /<(rss|feed|rdf:RDF)\b/i.test(head) || (/^<\?xml/i.test(head) && /<(rss|feed|rdf:RDF)\b/i.test(text.slice(0, 20000)));
}

function firstImg(html, base) {
    const m = html && String(html).match(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/i);
    return m ? absUrl(decodeEntities(m[1]), base) : null;
}
function absUrl(u, base) {
    if (!u) return null;
    try { return new URL(u, base).href; } catch { return null; }
}

function xmlImage(it, base, rawHtml) {
    for (const e of arr(it.enclosure)) {
        const type = String(attr(e, 'type') || '');
        const url = attr(e, 'url');
        if (url && (type.startsWith('image/') || /\.(jpe?g|png|gif|webp|avif)(\?|$)/i.test(url))) return absUrl(url, base);
    }
    const groups = arr(it['media:group']);
    const contents = [...arr(it['media:content']), ...groups.flatMap((g) => arr(g['media:content']))];
    for (const c of contents) {
        const medium = attr(c, 'medium');
        const type = String(attr(c, 'type') || '');
        const url = attr(c, 'url');
        if (url && (medium === 'image' || type.startsWith('image/') || (!medium && !type))) return absUrl(url, base);
    }
    const thumbs = [...arr(it['media:thumbnail']), ...groups.flatMap((g) => arr(g['media:thumbnail']))];
    for (const t of thumbs) if (attr(t, 'url')) return absUrl(attr(t, 'url'), base);
    const it_img = attr(it['itunes:image'], 'href');
    if (it_img) return absUrl(it_img, base);
    return firstImg(rawHtml, base);
}

function xmlEnclosure(it, atomLinks, base) {
    const e = arr(it.enclosure).find((x) => attr(x, 'url') && !String(attr(x, 'type') || '').startsWith('image/'))
        ?? arr(it.enclosure).find((x) => attr(x, 'url'));
    if (e) return { url: absUrl(attr(e, 'url'), base), type: attr(e, 'type') || null, length: attr(e, 'length') != null && attr(e, 'length') !== '' ? Number(attr(e, 'length')) || null : null };
    const l = atomLinks.find((x) => attr(x, 'rel') === 'enclosure' && attr(x, 'href'));
    if (l) return { url: absUrl(attr(l, 'href'), base), type: attr(l, 'type') || null, length: attr(l, 'length') ? Number(attr(l, 'length')) || null : null };
    return null;
}

function atomLink(links, base) {
    const alt = links.find((l) => attr(l, 'href') && (!attr(l, 'rel') || attr(l, 'rel') === 'alternate') && (!attr(l, 'type') || /html/.test(attr(l, 'type'))))
        ?? links.find((l) => attr(l, 'href') && (!attr(l, 'rel') || attr(l, 'rel') === 'alternate'));
    return alt ? absUrl(attr(alt, 'href'), base) : null;
}

function cats(list) {
    const out = [];
    for (const c of arr(list)) {
        const t = typeof c === 'object' ? (attr(c, 'term') || attr(c, 'label') || txt(c)) : txt(c);
        if (t && !out.includes(t)) out.push(String(t).trim());
    }
    return out;
}

function personName(a) {
    if (a == null) return null;
    if (Array.isArray(a)) return a.map(personName).filter(Boolean).join(', ') || null;
    if (typeof a === 'object') return txt(a.name) || txt(a['#text']) || null;
    return String(a).trim() || null;
}

function parseXml(text, feedUrl) {
    const doc = parser.parse(text);
    if (doc.rss || doc['rdf:RDF']) {
        const isRdf = !!doc['rdf:RDF'];
        const root = doc.rss || doc['rdf:RDF'];
        const ch = isRdf ? root.channel : root.channel;
        const channel = Array.isArray(ch) ? ch[0] : ch;
        if (!channel) throw new Error('feed has no channel');
        const rawItems = isRdf ? arr(root.item) : arr(channel.item);
        const chLink = arr(channel.link).map((l) => (typeof l === 'object' ? attr(l, 'href') || txt(l) : txt(l))).find((l) => l && !/^\s*$/.test(l));
        const feed = {
            format: isRdf ? 'rss1' : 'rss2',
            title: cleanText(channel.title),
            siteUrl: absUrl(chLink, feedUrl),
            language: txt(channel.language) || txt(channel['dc:language']),
        };
        const items = rawItems.map((it) => {
            const desc = txt(it.description);
            const encoded = txt(it['content:encoded']);
            const link = arr(it.link).map((l) => (typeof l === 'object' ? attr(l, 'href') || txt(l) : txt(l))).find(Boolean);
            const guidRaw = it.guid;
            const guid = txt(guidRaw) || attr(it, 'rdf:about') || null;
            const isPerma = guidRaw && typeof guidRaw === 'object' ? attr(guidRaw, 'isPermaLink') : null;
            const author = personName(arr(it['dc:creator'])[0]) || personName(arr(it.author)[0]) || txt(it['itunes:author']);
            return {
                title: cleanText(it.title),
                link: absUrl(link || (isPerma !== 'false' && /^https?:/.test(guid || '') ? guid : null), feedUrl),
                guid,
                author,
                categories: cats([...arr(it.category), ...arr(it['dc:subject'])]),
                publishedAt: parseDate(txt(it.pubDate) || txt(it['dc:date']) || txt(it.published)),
                updatedAt: parseDate(txt(it['atom:updated']) || txt(it.updated)),
                summary: stripHtml(desc || encoded, SUMMARY_MAX),
                content: stripHtml(encoded || desc),
                imageUrl: xmlImage(it, feedUrl, encoded || desc),
                enclosure: xmlEnclosure(it, [], feedUrl),
                language: txt(it['dc:language']) || feed.language,
            };
        });
        return { feed, items };
    }
    if (doc.feed) {
        const f = doc.feed;
        const feedLinks = arr(f.link);
        const feed = {
            format: 'atom',
            title: cleanText(f.title),
            siteUrl: atomLink(feedLinks, feedUrl),
            language: attr(f, 'xml:lang') || null,
        };
        const items = arr(f.entry).map((e) => {
            const links = arr(e.link);
            const summaryRaw = txt(e.summary);
            const contentRaw = txt(e.content);
            const link = atomLink(links, feedUrl);
            const src = e.source && typeof e.source === 'object' ? e.source : null;
            const authorNode = arr(e.author).length ? e.author : (src ? src.author : null) || f.author;
            return {
                title: cleanText(e.title),
                link,
                guid: txt(e.id) || link,
                author: personName(authorNode),
                categories: cats(e.category),
                publishedAt: parseDate(txt(e.published) || txt(e.updated)),
                updatedAt: parseDate(txt(e.updated)),
                summary: stripHtml(summaryRaw || contentRaw, SUMMARY_MAX),
                content: stripHtml(contentRaw || summaryRaw),
                imageUrl: xmlImage(e, feedUrl, contentRaw || summaryRaw),
                enclosure: xmlEnclosure(e, links, feedUrl),
                language: attr(e, 'xml:lang') || feed.language,
            };
        });
        return { feed, items };
    }
    throw new Error('not an RSS, RDF or Atom feed');
}

function parseJsonFeed(text, feedUrl) {
    const j = JSON.parse(text);
    if (!j || !Array.isArray(j.items)) throw new Error('not a JSON Feed');
    const feed = { format: 'jsonfeed', title: j.title || null, siteUrl: absUrl(j.home_page_url, feedUrl), language: j.language || null };
    const items = j.items.map((it) => {
        const authors = [...(it.authors || []), ...(it.author ? [it.author] : []), ...(j.authors || [])];
        const att = (it.attachments || []).find((a) => a.url && !String(a.mime_type || '').startsWith('image/'));
        const link = absUrl(it.url || it.external_url, feedUrl);
        const html = it.content_html || it.content_text;
        return {
            title: it.title ? stripHtml(it.title) : null,
            link,
            guid: it.id != null ? String(it.id) : link,
            author: authors.map((a) => a?.name).filter(Boolean)[0] ?? null,
            categories: cats(it.tags || []),
            publishedAt: parseDate(it.date_published),
            updatedAt: parseDate(it.date_modified),
            summary: stripHtml(it.summary || html, SUMMARY_MAX),
            content: it.content_html ? stripHtml(it.content_html) : it.content_text ? String(it.content_text).trim() : null,
            imageUrl: absUrl(it.image || it.banner_image, feedUrl) || firstImg(it.content_html, feedUrl),
            enclosure: att ? { url: absUrl(att.url, feedUrl), type: att.mime_type || null, length: att.size_in_bytes ?? null } : null,
            language: it.language || feed.language,
        };
    });
    return { feed, items };
}

/** Parse any supported feed text. Throws on unsupported input. */
export function parseFeed(text, feedUrl) {
    const t = String(text).replace(/^﻿/, '');
    return t.trimStart().startsWith('{') ? parseJsonFeed(t, feedUrl) : parseXml(t, feedUrl);
}

/** Candidate feed URLs from an HTML page: link rel=alternate tags first, then common paths. */
export function discoverFeeds(html, pageUrl) {
    const out = [];
    const add = (u) => { const n = u && absUrl(u, pageUrl); if (n && !out.includes(n)) out.push(n); };
    for (const m of String(html).matchAll(/<link\b[^>]*>/gi)) {
        const a = {};
        for (const p of m[0].matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) a[p[1].toLowerCase()] = decodeEntities(p[2] ?? p[3] ?? p[4] ?? '');
        if (!/\balternate\b/i.test(a.rel || '')) continue;
        if (/(rss|atom)\+xml|feed\+json|application\/(json|xml)|text\/xml/i.test(a.type || '') && /rss|atom|feed|xml|json/i.test(`${a.type} ${a.href}`)) add(a.href);
    }
    let origin;
    try { origin = new URL(pageUrl).origin; } catch { origin = null; }
    if (origin) for (const p of COMMON_PATHS) add(origin + p);
    return out;
}

// ---------- filtering ----------
export function normalizeKeywords(k) {
    return (Array.isArray(k) ? k : typeof k === 'string' ? k.split(/[\n,]+/) : []).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
}

export function parseSince(v) {
    if (v == null || String(v).trim() === '') return null;
    const iso = parseDate(v);
    return iso ? Date.parse(iso) : NaN;
}

export function matchesKeywords(item, keywords) {
    if (!keywords.length) return true;
    const hay = `${item.title ?? ''}\n${item.summary ?? ''}`.toLowerCase();
    return keywords.some((k) => hay.includes(k));
}

export function isAfter(item, sinceMs) {
    if (sinceMs == null) return true;
    const iso = item.publishedAt || item.updatedAt;
    return !!iso && Date.parse(iso) > sinceMs;
}

export function dedupeKey(item) {
    const k = item.guid || item.link;
    return k ? String(k).trim() : null;
}

/**
 * Apply since, keywords, dedupe (shared `seen` Set across feeds) and the per-feed limit.
 * Returns final rows (with feed fields added).
 */
export function selectItems(parsed, feedUrl, opts, seen = new Set()) {
    const { feed, items } = parsed;
    const kw = normalizeKeywords(opts.keywords);
    const since = opts.sinceMs ?? null;
    const max = opts.maxItemsPerFeed ?? 50;
    const rows = [];
    for (const it of items) {
        if (rows.length >= max) break;
        if (!isAfter(it, since) || !matchesKeywords(it, kw)) continue;
        if (opts.dedupe !== false) {
            const key = dedupeKey(it);
            if (key) {
                if (seen.has(key)) continue;
                seen.add(key);
            }
        }
        const { content, ...rest } = it;
        rows.push({
            feedUrl,
            feedTitle: feed.title,
            siteUrl: feed.siteUrl,
            ...rest,
            ...(opts.includeContent ? { content } : {}),
        });
    }
    return rows;
}
