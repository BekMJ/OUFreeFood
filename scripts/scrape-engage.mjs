import fetch from 'node-fetch';
import { load as loadHtml } from 'cheerio';
import { writeFile, mkdir } from 'fs/promises';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT = resolve(__dirname, '..');
const DATA_DIR = resolve(ROOT, 'data');
const OUTPUT = resolve(DATA_DIR, 'engage.json');

// Simple keyword list to classify free-food-ish events
const KEYWORDS = [
  'free food','pizza','snack','snacks','coffee','donut','bagel','lunch','dinner','breakfast','refreshments','ice cream','pantry','meal','meals','cookies','drinks','boba','tea'
];

async function main() {
  const base = 'https://ou.campuslabs.com/engage/';
  const listUrl = new URL('events', base).toString();
  const res = await fetch(listUrl, { headers: { 'accept': 'text/html' } });
  if (!res.ok) throw new Error(`Failed to fetch list: ${res.status}`);
  const html = await res.text();
  const $ = loadHtml(html);

  // Heuristic: find links that look like event detail routes
  const links = new Set();
  $('a').each((_, a) => {
    const href = $(a).attr('href') || '';
    if (/\/event\//i.test(href)) {
      const url = new URL(href, base).toString();
      links.add(url);
    }
  });

  const events = [];
  for (const url of links) {
    try {
      const ev = await parseEvent(url);
      if (!ev) continue;
      const text = `${ev.title} ${ev.description}`.toLowerCase();
      if (!KEYWORDS.some(k => text.includes(k))) continue;
      events.push(ev);
    } catch (e) {
      // Best-effort; continue
    }
  }

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(OUTPUT, JSON.stringify(events, null, 2));
  console.log(`Wrote ${events.length} events to ${OUTPUT}`);
}

async function parseEvent(url) {
  const res = await fetch(url, { headers: { 'accept': 'text/html' } });
  if (!res.ok) return null;
  const html = await res.text();
  const $ = loadHtml(html);

  // Try to read JSON-LD if present (common on event pages)
  let data = null;
  $('script[type="application/ld+json"]').each((_, s) => {
    try {
      const j = JSON.parse($(s).contents().text());
      if (Array.isArray(j)) {
        for (const item of j) {
          if ((item['@type'] || '').toLowerCase().includes('event')) data = item;
        }
      } else if ((j['@type'] || '').toLowerCase().includes('event')) {
        data = j;
      }
    } catch {}
  });

  const title = data?.name || $('h1, h2').first().text().trim();
  if (!title) return null;
  const description = (data?.description || $('[data-testid="description"]').text() || $('meta[name="description"]').attr('content') || '').trim();
  const start = data?.startDate || guessDate($, 'start');
  const end = data?.endDate || guessDate($, 'end');
  const location = data?.location?.name || $('[data-testid="location"], .location, [aria-label*="Location"]').first().text().trim();
  const org = $('[data-testid="organization"], [href*="organization"], .organization').first().text().trim();

  return {
    id: `engage-${hash(url)}`,
    title,
    host: org,
    campus: inferCampusFromLocation(location),
    location: location || '',
    description,
    category: 'Giveaway',
    dietary: '',
    link: url,
    start: start ? new Date(start).toISOString() : null,
    end: end ? new Date(end).toISOString() : null,
    createdAt: new Date().toISOString()
  };
}

function guessDate($, which) {
  // Heuristic: look for time elements or labels
  const timeEl = $('time').first().attr('datetime');
  if (timeEl) return timeEl;
  const text = $('body').text();
  const m = text.match(/(\w{3,9} \d{1,2}, \d{4} .*?\d{1,2}:\d{2}\s?(AM|PM)?)/i);
  return m ? m[0] : null;
}

function hash(s) {
  let h = 0; for (let i = 0; i < s.length; i++) { h = (h*31 + s.charCodeAt(i))|0; }
  return Math.abs(h).toString(36);
}

function inferCampusFromLocation(location = '') {
  const s = location.toLowerCase();
  if (s.includes('tulsa')) return 'Tulsa';
  if (s.includes('oklahoma city') || s.includes('okc') || s.includes('health')) return 'OUHSC';
  if (s.includes('norman') || s.includes('devon') || s.includes('sarkeys') || s.includes('bizzell')) return 'Norman';
  return '';
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});


