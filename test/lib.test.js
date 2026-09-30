import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverFeeds, looksLikeFeed, normalizeUrl, parseDate, parseFeed, parseSince, selectItems, stripHtml } from '../src/lib.js';

const RSS2 = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
<channel><title>Acme Blog</title><link>https://acme.com/</link><language>en-us</language>
<item><title>Big &amp; bold launch</title><link>https://acme.com/p/1</link><guid isPermaLink="false">acme-1</guid>
<pubDate>Tue, 02 Jan 2024 10:00:00 +0200</pubDate><dc:creator>Ann</dc:creator><category>News</category><category><![CDATA[Product]]></category>
<description><![CDATA[<p>Hello <b>world</b> &amp; friends</p>]]></description>
<content:encoded><![CDATA[<p>Full <i>body</i> text</p><img src="/img/a.png">]]></content:encoded>
<media:thumbnail url="https://cdn.acme.com/t.jpg"/></item>
<item><title>Episode 5: Rust</title><link>https://acme.com/p/2</link><guid>https://acme.com/p/2</guid><pubDate>Mon, 01 Jan 2024 08:00:00 GMT</pubDate>
<description>Talk about rust</description><enclosure url="https://cdn.acme.com/e5.mp3" type="audio/mpeg" length="12345"/><itunes:image href="https://cdn.acme.com/cover.jpg"/></item>
<item><title>No date</title><link>https://acme.com/p/3</link></item>
</channel></rss>`;

const RDF = `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel rdf:about="http://old.org/rss"><title>Old Site</title><link>http://old.org/</link><dc:language>de</dc:language></channel>
<item rdf:about="http://old.org/a"><title>Alt</title><link>http://old.org/a</link><description>Beschreibung</description><dc:date>2023-05-06T07:08:09Z</dc:date><dc:creator>Bob</dc:creator><dc:subject>Misc</dc:subject></item></rdf:RDF>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom" xml:lang="fr"><title>Atom Blog</title>
<link rel="self" href="https://at.org/feed.atom"/><link rel="alternate" type="text/html" href="https://at.org/"/><author><name>Feed Author</name></author>
<entry><title type="html">Salut &lt;b&gt;monde&lt;/b&gt;</title><link href="/posts/1"/><link rel="enclosure" type="audio/ogg" length="99" href="/a.ogg"/>
<id>tag:at.org,2024:1</id><published>2024-03-01T12:00:00+01:00</published><updated>2024-03-02T00:00:00Z</updated>
<category term="tech"/><summary>Short sum</summary><content type="html">&lt;p&gt;Long &lt;em&gt;content&lt;/em&gt;&lt;/p&gt;</content><author><name>Zoe</name></author></entry>
<entry><title>Second</title><link rel="alternate" href="https://at.org/posts/2"/><id>tag:at.org,2024:2</id><updated>2024-02-01T00:00:00Z</updated></entry></feed>`;

const JSONF = JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1', title: 'JSON Blog', home_page_url: 'https://j.io/', language: 'en',
    authors: [{ name: 'Jay' }],
    items: [{ id: 'j1', url: 'https://j.io/1', title: 'First', content_html: '<p>Hi <a href="x">there</a></p>', summary: 'Sum', date_published: '2024-04-01T00:00:00Z', tags: ['a', 'b'], image: '/i.png', attachments: [{ url: 'https://j.io/a.mp3', mime_type: 'audio/mpeg', size_in_bytes: 5 }] },
        { id: 2, external_url: 'https://other.com/2', content_text: 'plain only', date_modified: '2024-01-01T00:00:00Z' }],
});

test('normalizeUrl', () => {
    assert.equal(normalizeUrl('example.com/a#x'), 'https://example.com/a');
    assert.equal(normalizeUrl('ftp://x.com'), null);
    assert.equal(normalizeUrl('not a url'), null);
});

test('parseDate handles RFC 822, ISO and junk', () => {
    assert.equal(parseDate('Tue, 02 Jan 2024 10:00:00 +0200'), '2024-01-02T08:00:00.000Z');
    assert.equal(parseDate('Mon, 01 Jan 2024 08:00:00 GMT'), '2024-01-01T08:00:00.000Z');
    assert.equal(parseDate('Mon, 01 Jan 2024 08:00:00 EST'), '2024-01-01T13:00:00.000Z');
    assert.equal(parseDate('2024-03-01T12:00:00+01:00'), '2024-03-01T11:00:00.000Z');
    assert.equal(parseDate('2024-03-01'), '2024-03-01T00:00:00.000Z');
    assert.equal(parseDate('2024-03-01 10:00:00'), '2024-03-01T10:00:00.000Z');
    assert.equal(parseDate('1704096000'), '2024-01-01T08:00:00.000Z');
    assert.equal(parseDate('yesterday'), null);
    assert.equal(parseDate(''), null);
    assert.equal(parseDate(null), null);
});

test('stripHtml', () => {
    assert.equal(stripHtml('<p>a &amp; b</p><script>x</script><p>c</p>'), 'a & b\nc');
    assert.equal(stripHtml('   '), null);
    const long = stripHtml('word '.repeat(500), 1000);
    assert.ok(long.length <= 1000 && long.endsWith('...'));
});

test('RSS 2.0', () => {
    const { feed, items } = parseFeed(RSS2, 'https://acme.com/feed');
    assert.equal(feed.format, 'rss2');
    assert.equal(feed.title, 'Acme Blog');
    assert.equal(feed.siteUrl, 'https://acme.com/');
    assert.equal(items.length, 3);
    const a = items[0];
    assert.equal(a.title, 'Big & bold launch');
    assert.equal(a.guid, 'acme-1');
    assert.equal(a.author, 'Ann');
    assert.deepEqual(a.categories, ['News', 'Product']);
    assert.equal(a.publishedAt, '2024-01-02T08:00:00.000Z');
    assert.equal(a.summary, 'Hello world & friends');
    assert.equal(a.content, 'Full body text');
    assert.equal(a.imageUrl, 'https://cdn.acme.com/t.jpg');
    assert.equal(a.language, 'en-us');
    assert.equal(a.enclosure, null);
    const b = items[1];
    assert.deepEqual(b.enclosure, { url: 'https://cdn.acme.com/e5.mp3', type: 'audio/mpeg', length: 12345 });
    assert.equal(b.imageUrl, 'https://cdn.acme.com/cover.jpg');
    assert.equal(items[2].publishedAt, null);
});

test('RSS 2.0 first img fallback', () => {
    const x = `<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>t</title><item><title>i</title><link>https://a.com/1</link><content:encoded><![CDATA[<img src="/pic.png">]]></content:encoded></item></channel></rss>`;
    assert.equal(parseFeed(x, 'https://a.com/rss').items[0].imageUrl, 'https://a.com/pic.png');
});

test('RSS 1.0 / RDF', () => {
    const { feed, items } = parseFeed(RDF, 'http://old.org/rss');
    assert.equal(feed.format, 'rss1');
    assert.equal(feed.title, 'Old Site');
    assert.equal(feed.language, 'de');
    assert.equal(items.length, 1);
    assert.equal(items[0].link, 'http://old.org/a');
    assert.equal(items[0].guid, 'http://old.org/a');
    assert.equal(items[0].publishedAt, '2023-05-06T07:08:09.000Z');
    assert.equal(items[0].author, 'Bob');
    assert.deepEqual(items[0].categories, ['Misc']);
});

test('Atom 1.0', () => {
    const { feed, items } = parseFeed(ATOM, 'https://at.org/feed.atom');
    assert.equal(feed.format, 'atom');
    assert.equal(feed.siteUrl, 'https://at.org/');
    assert.equal(feed.language, 'fr');
    const a = items[0];
    assert.equal(a.title, 'Salut monde');
    assert.equal(a.link, 'https://at.org/posts/1');
    assert.equal(a.guid, 'tag:at.org,2024:1');
    assert.equal(a.author, 'Zoe');
    assert.deepEqual(a.categories, ['tech']);
    assert.equal(a.publishedAt, '2024-03-01T11:00:00.000Z');
    assert.equal(a.updatedAt, '2024-03-02T00:00:00.000Z');
    assert.equal(a.summary, 'Short sum');
    assert.equal(a.content, 'Long content');
    assert.deepEqual(a.enclosure, { url: 'https://at.org/a.ogg', type: 'audio/ogg', length: 99 });
    assert.equal(items[1].link, 'https://at.org/posts/2');
    assert.equal(items[1].publishedAt, '2024-02-01T00:00:00.000Z');
    assert.equal(items[1].author, 'Feed Author');
});

test('JSON Feed 1.1', () => {
    const { feed, items } = parseFeed(JSONF, 'https://j.io/feed.json');
    assert.equal(feed.format, 'jsonfeed');
    assert.equal(feed.siteUrl, 'https://j.io/');
    assert.equal(items[0].author, 'Jay');
    assert.equal(items[0].summary, 'Sum');
    assert.equal(items[0].content, 'Hi there');
    assert.equal(items[0].imageUrl, 'https://j.io/i.png');
    assert.deepEqual(items[0].enclosure, { url: 'https://j.io/a.mp3', type: 'audio/mpeg', length: 5 });
    assert.deepEqual(items[0].categories, ['a', 'b']);
    assert.equal(items[1].guid, '2');
    assert.equal(items[1].link, 'https://other.com/2');
    assert.equal(items[1].publishedAt, null);
    assert.equal(items[1].updatedAt, '2024-01-01T00:00:00.000Z');
});

test('parseFeed rejects non-feeds', () => {
    assert.throws(() => parseFeed('<html><body>hi</body></html>', 'https://a.com'));
    assert.throws(() => parseFeed('{"a":1}', 'https://a.com'));
});

test('looksLikeFeed', () => {
    assert.ok(looksLikeFeed(RSS2));
    assert.ok(looksLikeFeed(ATOM));
    assert.ok(looksLikeFeed(RDF));
    assert.ok(looksLikeFeed(JSONF));
    assert.ok(!looksLikeFeed('<!doctype html><html><head></head></html>'));
});

test('discoverFeeds from HTML', () => {
    const html = `<html><head>
<link rel="alternate" type="application/rss+xml" title="RSS" href="/blog/rss">
<link rel='alternate' type='application/atom+xml' href='https://x.com/atom'>
<link rel="alternate" type="application/feed+json" href="feed.json">
<link rel="alternate" hreflang="de" href="/de">
<link rel="stylesheet" href="/a.css"></head></html>`;
    const c = discoverFeeds(html, 'https://x.com/news/');
    assert.deepEqual(c.slice(0, 3), ['https://x.com/blog/rss', 'https://x.com/atom', 'https://x.com/news/feed.json']);
    assert.ok(!c.includes('https://x.com/de'));
    for (const p of ['/feed', '/rss.xml', '/atom.xml', '/index.xml']) assert.ok(c.includes(`https://x.com${p}`));
    assert.equal(new Set(c).size, c.length);
});

test('selectItems: since, keywords, dedupe, limit, content', () => {
    const parsed = parseFeed(RSS2, 'https://acme.com/feed');
    const base = { maxItemsPerFeed: 50 };
    assert.equal(selectItems(parsed, 'u', base).length, 3);
    assert.equal(selectItems(parsed, 'u', { ...base, sinceMs: parseSince('2024-01-01T12:00:00Z') }).length, 1);
    assert.equal(selectItems(parsed, 'u', { ...base, sinceMs: parseSince('2024-01-01') }).length, 2);
    assert.deepEqual(selectItems(parsed, 'u', { ...base, keywords: ['RUST'] }).map((r) => r.guid), ['https://acme.com/p/2']);
    assert.equal(selectItems(parsed, 'u', { ...base, keywords: ['friends'] }).length, 1);
    assert.equal(selectItems(parsed, 'u', { ...base, keywords: ['zzz'] }).length, 0);
    assert.equal(selectItems(parsed, 'u', { maxItemsPerFeed: 2 }).length, 2);
    assert.equal('content' in selectItems(parsed, 'u', base)[0], false);
    const withContent = selectItems(parsed, 'u', { ...base, includeContent: true })[0];
    assert.equal(withContent.content, 'Full body text');
    assert.equal(withContent.feedTitle, 'Acme Blog');
    assert.equal(withContent.feedUrl, 'u');
});

test('selectItems dedupes across feeds via shared set', () => {
    const p = parseFeed(RSS2, 'https://acme.com/feed');
    const seen = new Set();
    assert.equal(selectItems(p, 'f1', { dedupe: true }, seen).length, 3);
    assert.equal(selectItems(p, 'f2', { dedupe: true }, seen).length, 0);
    assert.equal(selectItems(p, 'f3', { dedupe: false }, seen).length, 3);
    // dedupe by link when guid differs
    const a = { feed: {}, items: [{ guid: 'g1', link: 'L' }] };
    const b = { feed: {}, items: [{ guid: 'g1', link: 'L2' }, { guid: null, link: 'L3' }] };
    const s2 = new Set();
    selectItems(a, 'a', {}, s2);
    assert.equal(selectItems(b, 'b', {}, s2).length, 1);
});

test('parseSince', () => {
    assert.equal(parseSince(''), null);
    assert.equal(parseSince(undefined), null);
    assert.ok(Number.isNaN(parseSince('nope')));
    assert.equal(parseSince('2024-01-01'), Date.UTC(2024, 0, 1));
});
