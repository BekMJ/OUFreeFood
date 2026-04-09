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
const META_OUTPUT = resolve(DATA_DIR, 'engage-meta.json');

const CLASSIFIER_VERSION = 4;

const FOOD_SIGNALS = {
  free: [
    'free food', 'free-food', 'free lunch', 'free dinner', 'free breakfast', 'free snacks',
    'free pizza', 'free coffee', 'free donuts', 'free donut', 'free bagels', 'free bagel',
    'free meal', 'free meals', 'free refreshments', 'free popcorn', 'free drinks'
  ],
  pizza: ['pizza', 'slice', 'slices', 'pepperoni'],
  breakfast: ['breakfast', 'bagel', 'bagels', 'donut', 'donuts', 'coffee'],
  lunch: ['lunch', 'boxed lunch', 'boxed lunches', 'bbq', 'barbecue', 'cookout'],
  dinner: ['dinner', 'supper'],
  snacks: ['snack', 'snacks', 'cookies', 'cookie', 'refreshments', 'boba', 'tea', 'drinks', 'ice cream', 'popcorn'],
  pantry: ['pantry', 'groceries', 'grocery', 'food pantry'],
  general: ['meal', 'meals', 'food', 'catering']
};

async function main() {
  const fetchedAt = new Date().toISOString();
  const baseUrl = 'https://ou.campuslabs.com/engage/';
  const feedUrl = new URL('events.rss', baseUrl).toString();
  const res = await fetch(feedUrl, { headers: { accept: 'application/rss+xml, application/xml, text/xml' } });
  if (!res.ok) throw new Error(`Failed to fetch RSS feed: ${res.status}`);
  const xml = await res.text();
  const $ = loadHtml(xml, { xmlMode: true });
  const feedTitle = cleanText($('channel > title').first().text());
  const feedLastBuildDate = cleanText($('channel > lastBuildDate').first().text());
  const items = $('channel > item').toArray();

  const stats = {
    fetchedAt,
    discoveryMode: 'rss-feed',
    baseUrl,
    feedUrl,
    feedItemsFound: items.length,
    parsedItems: 0,
    matchedEvents: 0,
    cancelledSkipped: 0,
    missingStartSkipped: 0,
    dedupedEvents: 0,
    outputEvents: 0
  };

  const events = [];
  const errors = [];

  for (const item of items) {
    try {
      const event = parseFeedItem($, item, fetchedAt);
      if (!event) continue;
      stats.parsedItems += 1;

      if (event.status === 'cancelled') {
        stats.cancelledSkipped += 1;
        continue;
      }

      if (!event.classification?.isFoodRelated) continue;

      if (!event.start) {
        stats.missingStartSkipped += 1;
        continue;
      }

      stats.matchedEvents += 1;
      events.push(event);
    } catch (error) {
      errors.push({
        title: extractItemText($, item, 'title'),
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const dedupedEvents = dedupeEvents(events);
  stats.dedupedEvents = events.length - dedupedEvents.length;
  stats.outputEvents = dedupedEvents.length;

  const metadata = {
    fetchedAt,
    source: {
      name: 'OU Engage',
      feedUrl,
      baseUrl,
      feedTitle,
      feedLastBuildDate
    },
    classifier: {
      version: CLASSIFIER_VERSION,
      buckets: Object.keys(FOOD_SIGNALS)
    },
    crawl: stats,
    errors: errors.slice(0, 25)
  };

  await mkdir(DATA_DIR, { recursive: true });
  await Promise.all([
    writeFile(OUTPUT, JSON.stringify(dedupedEvents, null, 2)),
    writeFile(META_OUTPUT, JSON.stringify(metadata, null, 2))
  ]);

  console.log(`Wrote ${dedupedEvents.length} events to ${OUTPUT}`);
  console.log(`Wrote crawl metadata to ${META_OUTPUT}`);
}

function parseFeedItem($feed, node, fetchedAt) {
  const title = extractItemText($feed, node, 'title');
  if (!title) return null;

  const link = extractItemText($feed, node, 'link') || extractItemText($feed, node, 'guid');
  const descriptionHtml = extractItemText($feed, node, 'description');
  const descriptionData = parseDescriptionHtml(descriptionHtml);
  const hosts = $feed(node).find('host').map((_, el) => cleanText($feed(el).text())).get().filter(Boolean);
  const author = extractItemText($feed, node, 'author');
  const host = cleanText(hosts.join(' / ')) || extractHostFromAuthor(author);
  const status = extractItemText($feed, node, 'status').toLowerCase() || 'confirmed';
  const feedLocation = extractItemText($feed, node, 'location');
  const categories = $feed(node).find('category').map((_, el) => cleanText($feed(el).text())).get().filter(Boolean);

  const start = descriptionData.start || safeToIso(extractItemText($feed, node, 'start'));
  const end = descriptionData.end || safeToIso(extractItemText($feed, node, 'end'));
  const location = descriptionData.location || feedLocation;
  const description = descriptionData.description;
  const campus = inferCampus({ location, title, description });
  const classification = classifyEvent({ title, description, location, org: host });

  return {
    id: `engage-${hash(link || `${title}-${start || fetchedAt}`)}`,
    title,
    host,
    campus,
    location,
    description,
    category: classification.category,
    dietary: '',
    link,
    start,
    end,
    createdAt: fetchedAt,
    source: 'engage-rss',
    status,
    feedCategories: categories,
    classification
  };
}

function parseDescriptionHtml(html = '') {
  if (!html) {
    return {
      description: '',
      location: '',
      start: null,
      end: null
    };
  }

  const $ = loadHtml(html);
  const description = cleanText($('.p-description').text());
  const location = cleanText($('.p-location').first().text());
  const start = safeToIso($('.dt-start').first().attr('datetime'));
  const end = safeToIso($('.dt-end').first().attr('datetime'));

  return { description, location, start, end };
}

function classifyEvent({ title = '', description = '', location = '' } = {}) {
  const text = `${title} ${description} ${location}`.toLowerCase();
  const matches = {
    free: matchTerms(text, FOOD_SIGNALS.free),
    pizza: matchTerms(text, FOOD_SIGNALS.pizza),
    breakfast: matchTerms(text, FOOD_SIGNALS.breakfast),
    lunch: matchTerms(text, FOOD_SIGNALS.lunch),
    dinner: matchTerms(text, FOOD_SIGNALS.dinner),
    snacks: matchTerms(text, FOOD_SIGNALS.snacks),
    pantry: matchTerms(text, FOOD_SIGNALS.pantry),
    general: matchTerms(text, FOOD_SIGNALS.general)
  };

  const score = (
    matches.free.length * 4 +
    matches.pantry.length * 4 +
    matches.pizza.length * 3 +
    matches.breakfast.length * 2 +
    matches.lunch.length * 2 +
    matches.dinner.length * 2 +
    matches.snacks.length * 2 +
    matches.general.length
  );

  const category = inferCategory(matches);
  const uniqueMatches = [...new Set(Object.values(matches).flat())];
  const isFoodRelated = matches.free.length > 0 || score >= 3;
  const confidence = isFoodRelated ? Math.min(1, score / 8) : 0;

  return {
    isFoodRelated,
    category,
    confidence: Number(confidence.toFixed(2)),
    matchedTerms: uniqueMatches
  };
}

function inferCategory(matches) {
  if (matches.pantry.length > 0) return 'Pantry';
  if (matches.pizza.length > 0) return 'Pizza';
  if (matches.breakfast.length > 0) return 'Breakfast';
  if (matches.lunch.length > 0) return 'Lunch';
  if (matches.dinner.length > 0) return 'Dinner';
  if (matches.snacks.length > 0) return 'Snacks';
  return 'Giveaway';
}

function matchTerms(text, terms) {
  return terms.filter((term) => buildTermRegex(term).test(text));
}

function dedupeEvents(events) {
  const seen = new Set();
  const out = [];

  for (const event of events) {
    const key = buildDedupKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
  }

  return out;
}

function buildDedupKey(event) {
  const title = normalizeKeyPart(event.title);
  const start = event.start || '';
  const location = normalizeKeyPart(event.location);
  return [title, start, location].join('|');
}

function normalizeKeyPart(value = '') {
  return String(value).trim().toLowerCase().replace(/\s+/g, ' ');
}

function inferCampus({ location = '', title = '', description = '' } = {}) {
  const text = `${location} ${title} ${description}`.toLowerCase();
  if (text.includes('tulsa')) return 'Tulsa';
  if (text.includes('online') || text.includes('virtual') || text.includes('zoom')) return 'Online';
  if (text.includes('ouhsc') || text.includes('oklahoma city') || text.includes('okc') || text.includes('health sciences')) return 'OUHSC';
  if (text.includes('norman') || text.includes('devon') || text.includes('sarkeys') || text.includes('bizzell') || text.includes('oklahoma memorial union')) return 'Norman';
  return '';
}

function buildTermRegex(term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, 'i');
}

function safeToIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function extractItemText($feed, node, selector) {
  return cleanText($feed(node).find(selector).first().text());
}

function extractHostFromAuthor(author = '') {
  const match = author.match(/\(([^)]+)\)\s*$/);
  return cleanText(match ? match[1] : author);
}

function cleanText(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function hash(value) {
  let result = 0;
  for (let i = 0; i < value.length; i += 1) {
    result = (result * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(result).toString(36);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
