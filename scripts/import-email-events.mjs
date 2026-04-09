import { load as loadHtml } from 'cheerio';
import { mkdir, readFile, readdir, writeFile } from 'fs/promises';
import { extname, resolve, basename } from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT = resolve(__dirname, '..');
const RAW_DIR = resolve(ROOT, 'data', 'email-raw');
const OUTPUT = resolve(ROOT, 'data', 'email-events.json');
const META_OUTPUT = resolve(ROOT, 'data', 'email-meta.json');
const IMPORTER_VERSION = 2;

const FOOD_SIGNALS = {
  free: [
    'free food', 'free lunch', 'free dinner', 'free breakfast', 'free snacks', 'free pizza',
    'free coffee', 'free donuts', 'free meal', 'free meals', 'free refreshments', 'free popcorn'
  ],
  pizza: ['pizza', 'pepperoni'],
  breakfast: ['breakfast', 'bagel', 'bagels', 'donut', 'donuts', 'coffee'],
  lunch: ['lunch', 'bbq', 'barbecue', 'cookout'],
  dinner: ['dinner', 'supper'],
  snacks: ['snack', 'snacks', 'cookies', 'cookie', 'refreshments', 'boba', 'tea', 'drinks', 'popcorn', 'ice cream'],
  pantry: ['pantry', 'groceries', 'food pantry'],
  general: ['meal', 'meals', 'food', 'catering']
};

async function main() {
  const generatedAt = new Date().toISOString();
  await mkdir(RAW_DIR, { recursive: true });

  const filenames = (await readdir(RAW_DIR))
    .filter((name) => ['.txt', '.md', '.eml'].includes(extname(name).toLowerCase()))
    .sort();

  const stats = {
    generatedAt,
    importerVersion: IMPORTER_VERSION,
    filesFound: filenames.length,
    parsedFiles: 0,
    matchedEvents: 0,
    skippedNonFood: 0,
    skippedMissingStart: 0,
    dedupedEvents: 0,
    outputEvents: 0
  };

  const errors = [];
  const events = [];

  for (const filename of filenames) {
    const filepath = resolve(RAW_DIR, filename);
    try {
      const raw = await readFile(filepath, 'utf8');
      const event = parseEmailFile(raw, filename, generatedAt);
      stats.parsedFiles += 1;

      if (!event.classification.isFoodRelated) {
        stats.skippedNonFood += 1;
        continue;
      }

      if (!event.start) {
        stats.skippedMissingStart += 1;
        continue;
      }

      stats.matchedEvents += 1;
      events.push(event);
    } catch (error) {
      errors.push({
        file: filename,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const deduped = dedupeEvents(events);
  stats.dedupedEvents = events.length - deduped.length;
  stats.outputEvents = deduped.length;

  const metadata = {
    generatedAt,
    source: 'local-email-drop',
    inputDirectory: RAW_DIR,
    importerVersion: IMPORTER_VERSION,
    crawl: stats,
    errors: errors.slice(0, 25)
  };

  await Promise.all([
    writeFile(OUTPUT, JSON.stringify(deduped, null, 2)),
    writeFile(META_OUTPUT, JSON.stringify(metadata, null, 2))
  ]);

  console.log(`Read ${filenames.length} email file(s) from ${RAW_DIR}`);
  console.log(`Wrote ${deduped.length} event(s) to ${OUTPUT}`);
  console.log(`Wrote metadata to ${META_OUTPUT}`);
}

function parseEmailFile(raw, filename, generatedAt) {
  const normalizedRaw = normalizeEmailText(raw);
  const { headers, body } = splitHeadersAndBody(normalizedRaw);
  const forwardedHeaders = parseForwardedHeaders(body);
  const calendar = parseCalendarFields(normalizedRaw);
  const subject = cleanText(
    sanitizeSubject(
      headers.subject ||
      forwardedHeaders.subject ||
      calendar.summary ||
      inferSubjectFromBody(body) ||
      basename(filename, extname(filename))
    )
  );
  const host = cleanText(extractHost(headers.from || forwardedHeaders.from || calendar.organizer, body));
  const location = cleanText(extractLocation(body, calendar.location));
  const link = extractFirstUrl(`${body}\n${normalizedRaw}`);
  const { start, end } = extractDateInfo(body, calendar);
  const description = cleanText(extractDescription(body, calendar.description));
  const classification = classifyEvent({ title: subject, description, location });
  const campus = inferCampus({ title: subject, description, location });
  const createdAt = safeToIso(headers.date || forwardedHeaders.date) || generatedAt;

  return {
    id: `email-${hash(`${filename}|${subject}|${start || generatedAt}`)}`,
    title: subject || 'Untitled',
    host,
    campus,
    location,
    description,
    category: classification.category,
    dietary: '',
    link,
    start,
    end,
    createdAt,
    source: 'email',
    sourceFile: filename,
    classification
  };
}

function splitHeadersAndBody(raw) {
  const normalized = raw.replace(/\r\n/g, '\n');
  const separator = normalized.indexOf('\n\n');
  const headerText = separator >= 0 ? normalized.slice(0, separator) : '';
  const body = separator >= 0 ? normalized.slice(separator + 2) : normalized;

  const headers = {};
  if (headerText && /^[A-Za-z-]+:/m.test(headerText)) {
    let currentHeader = null;
    for (const line of headerText.split('\n')) {
      if (/^\s/.test(line) && currentHeader) {
        headers[currentHeader] = `${headers[currentHeader]} ${line.trim()}`.trim();
        continue;
      }
      const match = line.match(/^([A-Za-z-]+):\s*(.*)$/);
      if (!match) continue;
      currentHeader = match[1].toLowerCase();
      headers[currentHeader] = match[2].trim();
    }
  }

  return { headers, body };
}

function normalizeEmailText(raw = '') {
  const normalized = raw.replace(/\r\n/g, '\n');
  const decoded = decodeQuotedPrintable(normalized);
  const withoutMimeNoise = decoded
    .replace(/^--[-A-Za-z0-9_=]+$/gm, '')
    .replace(/^Content-(Type|Transfer-Encoding|Disposition):.*$/gim, '')
    .replace(/^MIME-Version:.*$/gim, '');

  if (/<(html|body|div|p|br|table|tr|td|span|a)\b/i.test(withoutMimeNoise)) {
    return htmlToText(withoutMimeNoise);
  }

  return withoutMimeNoise;
}

function decodeQuotedPrintable(value = '') {
  const hasQuotedPrintableHeader = /Content-Transfer-Encoding:\s*quoted-printable/i.test(value);
  const hasSoftBreaks = /=\r?\n/.test(value);
  if (!hasQuotedPrintableHeader && !hasSoftBreaks) {
    return value;
  }
  return value
    .replace(/=\n/g, '')
    .replace(/=([A-Fa-f0-9]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function htmlToText(html = '') {
  const $ = loadHtml(html);
  $('br').replaceWith('\n');
  $('p, div, li, tr, table, h1, h2, h3, h4, h5, h6').each((_, el) => {
    $(el).append('\n');
  });
  $('a').each((_, el) => {
    const href = $(el).attr('href');
    if (href) {
      $(el).append(` ${href}`);
    }
  });
  return $.root().text();
}

function parseForwardedHeaders(body = '') {
  return {
    from: matchLabel(body, ['From']),
    date: matchLabel(body, ['Date', 'Sent']),
    subject: matchLabel(body, ['Subject']),
    when: matchLabel(body, ['When']),
    where: matchLabel(body, ['Where', 'Location'])
  };
}

function parseCalendarFields(raw = '') {
  const summary = matchCalendarField(raw, 'SUMMARY');
  const location = matchCalendarField(raw, 'LOCATION');
  const description = matchCalendarField(raw, 'DESCRIPTION');
  const organizer = extractCalendarOrganizer(raw);
  const start = parseCalendarDate(matchCalendarField(raw, 'DTSTART'));
  const end = parseCalendarDate(matchCalendarField(raw, 'DTEND'));

  return { summary, location, description, organizer, start, end };
}

function matchCalendarField(raw = '', fieldName) {
  const regex = new RegExp(`^${fieldName}(?:;[^:]*)?:(.+)$`, 'gim');
  const match = raw.match(regex);
  if (!match || match.length === 0) return '';
  const value = match[0].replace(new RegExp(`^${fieldName}(?:;[^:]*)?:`, 'i'), '');
  return cleanText(unescapeCalendarText(value));
}

function extractCalendarOrganizer(raw = '') {
  const match = raw.match(/^ORGANIZER(?:;[^:]*)?:(.+)$/gim);
  if (!match || match.length === 0) return '';
  const line = match[0];
  const cnMatch = line.match(/CN=([^;:]+)/i);
  if (cnMatch) return cleanText(unescapeCalendarText(cnMatch[1]));
  return cleanText(unescapeCalendarText(line.split(':').slice(1).join(':')));
}

function parseCalendarDate(value = '') {
  if (!value) return null;
  const trimmed = cleanText(value);
  const utcMatch = trimmed.match(/^(\d{8})T(\d{6})Z$/);
  if (utcMatch) {
    const [, ymd, hms] = utcMatch;
    return safeToIso(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T${hms.slice(0, 2)}:${hms.slice(2, 4)}:${hms.slice(4, 6)}Z`);
  }
  const localMatch = trimmed.match(/^(\d{8})T(\d{6})$/);
  if (localMatch) {
    const [, ymd, hms] = localMatch;
    return safeToIso(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T${hms.slice(0, 2)}:${hms.slice(2, 4)}:${hms.slice(4, 6)}`);
  }
  const dayMatch = trimmed.match(/^(\d{8})$/);
  if (dayMatch) {
    const [, ymd] = dayMatch;
    return safeToIso(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T00:00:00`);
  }
  return safeToIso(trimmed);
}

function unescapeCalendarText(value = '') {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function inferSubjectFromBody(body) {
  const lines = body
    .split('\n')
    .map((line) => cleanText(line))
    .filter(Boolean)
    .filter((line) => !/^(from|sent|to|subject|date|when|where|location|time):/i.test(line))
    .filter((line) => !/^https?:\/\//i.test(line))
    .filter((line) => !/^(hi|hello|dear)\b/i.test(line));
  return lines.find((line) => line.length >= 6 && line.length <= 120) || '';
}

function sanitizeSubject(value = '') {
  return cleanText(value).replace(/^(re|fw|fwd)\s*:\s*/gi, '');
}

function extractHost(fromHeader = '', body = '') {
  const fromName = extractDisplayName(fromHeader);
  if (fromName) return fromName;

  const labeled = matchLabel(body, ['Host', 'Hosted by', 'Organizer', 'Organization', 'Presented by']);
  if (labeled) return labeled;

  return '';
}

function extractDisplayName(fromHeader = '') {
  const parenMatch = fromHeader.match(/\(([^)]+)\)/);
  if (parenMatch) return cleanText(parenMatch[1]);

  const angleMatch = fromHeader.match(/^(.+?)\s*<[^>]+>$/);
  if (angleMatch) return cleanText(angleMatch[1].replace(/^"|"$/g, ''));

  return cleanText(fromHeader.replace(/<[^>]+>/g, ''));
}

function extractLocation(body = '', calendarLocation = '') {
  const labeled = matchLabel(body, ['Location', 'Where', 'Venue', 'Room', 'Place']);
  if (labeled) return labeled;

  if (calendarLocation) return cleanText(calendarLocation);

  const atMatch = body.match(/\bat\s+([A-Z0-9][^\n.]{3,120})/i);
  if (atMatch) return cleanText(atMatch[1]);

  return '';
}

function extractDescription(body = '', calendarDescription = '') {
  const source = cleanText(calendarDescription) || body;
  const lines = source
    .replace(/\u00a0/g, ' ')
    .replace(/https?:\/\/\S+/g, '')
    .split('\n')
    .map((line) => cleanText(line))
    .filter(Boolean)
    .filter((line) => !/^(from|sent|to|subject|date|when|where|location|time|begin|end|organizer|summary|dtstart|dtend|description)(;[^:]*)?:/i.test(line));

  return cleanText((lines.join(' ') || source).slice(0, 2400));
}

function extractFirstUrl(text = '') {
  const match = text.match(/https?:\/\/[^\s)>"]+/i);
  return match ? match[0] : '';
}

function extractDateInfo(body = '', calendar = {}) {
  if (calendar.start || calendar.end) {
    return { start: calendar.start || null, end: calendar.end || null };
  }

  const labeledWhen = matchLabel(body, ['When', 'Starts', 'Start']);
  const labeledDate = matchLabel(body, ['Date']);
  const labeledTime = matchLabel(body, ['Time']);
  const labeledEnd = matchLabel(body, ['Ends', 'End']);

  const combined = extractDateRange(labeledWhen || '');
  if (combined.start) return combined;

  const genericCombined = extractDateRange(body);
  if (genericCombined.start) return genericCombined;

  if (labeledDate && labeledTime) {
    const combinedDateTime = extractDateRange(`${labeledDate} ${labeledTime}`);
    if (combinedDateTime.start) return combinedDateTime;
  }

  const candidates = [
    labeledDate,
    labeledWhen,
    ...extractDateLikeMatches(body)
  ].filter(Boolean);
  for (const candidate of candidates) {
    const iso = safeToIso(normalizeDateCandidate(candidate));
    if (iso) {
      const end = labeledEnd ? safeToIso(normalizeDateCandidate(labeledEnd, new Date(iso))) : null;
      return { start: iso, end };
    }
  }

  return { start: null, end: null };
}

function extractDateLikeMatches(body = '') {
  const patterns = [
    /\b(?:Mon|Monday|Tue|Tuesday|Wed|Wednesday|Thu|Thursday|Fri|Friday|Sat|Saturday|Sun|Sunday)?(?:,)?\s*(?:Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|Sept|September|Oct|October|Nov|November|Dec|December)\s+\d{1,2}(?:,\s*\d{4})?(?:\s+(?:at\s+)?)?\d{1,2}(?::\d{2})?\s?(?:AM|PM)?/gi,
    /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?(?:\s+\d{1,2}:\d{2}\s?(?:AM|PM)?)?/gi
  ];

  return patterns.flatMap((pattern) => [...body.matchAll(pattern)].map((match) => match[0]));
}

function extractDateRange(text = '') {
  const cleaned = normalizeDateCandidate(text);
  if (!cleaned) return { start: null, end: null };

  const dateRangeRegex = /((?:mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday)?(?:,)?\s*(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\s+\d{1,2}(?:,\s*\d{4})?)\s+(?:from\s+)?(\d{1,2}(?::\d{2})?\s?(?:AM|PM))\s*(?:-|–|to)\s*(\d{1,2}(?::\d{2})?\s?(?:AM|PM))/i;
  const shortDateRangeRegex = /((?:\d{1,2}\/\d{1,2}(?:\/\d{2,4})?))\s+(?:from\s+)?(\d{1,2}(?::\d{2})?\s?(?:AM|PM))\s*(?:-|–|to)\s*(\d{1,2}(?::\d{2})?\s?(?:AM|PM))/i;

  for (const regex of [dateRangeRegex, shortDateRangeRegex]) {
    const match = cleaned.match(regex);
    if (match) {
      const [, day, startTime, endTime] = match;
      return {
        start: safeToIso(normalizeDateCandidate(`${day} ${startTime}`)),
        end: safeToIso(normalizeDateCandidate(`${day} ${endTime}`))
      };
    }
  }

  const timeRangeRegex = /\b(\d{1,2}(?::\d{2})?\s?(?:AM|PM))\s*(?:-|–|to)\s*(\d{1,2}(?::\d{2})?\s?(?:AM|PM))/i;
  const dayOnly = cleaned.match(/((?:mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday)?(?:,)?\s*(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\s+\d{1,2}(?:,\s*\d{4})?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i);
  const timeRange = cleaned.match(timeRangeRegex);
  if (dayOnly && timeRange) {
    return {
      start: safeToIso(normalizeDateCandidate(`${dayOnly[1]} ${timeRange[1]}`)),
      end: safeToIso(normalizeDateCandidate(`${dayOnly[1]} ${timeRange[2]}`))
    };
  }

  return { start: null, end: null };
}

function normalizeDateCandidate(candidate, baseDay = null) {
  const value = cleanText(candidate)
    .replace(/\s+at\s+/i, ' ')
    .replace(/\s*\((?:utc|gmt)[^)]+\)/ig, '')
    .replace(/\b(?:central time|eastern time|mountain time|pacific time|CDT|CST|EDT|EST|MDT|MST|PDT|PST)\b/g, '')
    .trim();
  if (!value) return '';
  if (baseDay && /^\d{1,2}(?::\d{2})?\s?(?:AM|PM)$/i.test(value)) {
    return `${baseDay.toDateString()} ${value}`;
  }
  if (!/\b\d{4}\b/.test(value)) {
    return `${value} ${new Date().getFullYear()}`;
  }
  return value;
}

function matchLabel(body, labels) {
  for (const label of labels) {
    const regex = new RegExp(`(?:^|\\n)\\s*${escapeRegex(label)}\\s*[:.-]\\s*(.+)`, 'i');
    const match = body.match(regex);
    if (match) return cleanText(match[1]);
  }
  return '';
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

  return {
    isFoodRelated: matches.free.length > 0 || score >= 3,
    category: inferCategory(matches),
    confidence: Number(Math.min(1, score / 8).toFixed(2)),
    matchedTerms: [...new Set(Object.values(matches).flat())]
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

function inferCampus({ title = '', description = '', location = '' } = {}) {
  const text = `${title} ${description} ${location}`.toLowerCase();
  if (text.includes('tulsa')) return 'Tulsa';
  if (text.includes('online') || text.includes('virtual') || text.includes('zoom')) return 'Online';
  if (text.includes('ouhsc') || text.includes('oklahoma city') || text.includes('okc') || text.includes('health sciences')) return 'OUHSC';
  if (text.includes('norman') || text.includes('devon') || text.includes('sarkeys') || text.includes('bizzell') || text.includes('oklahoma memorial union')) return 'Norman';
  return '';
}

function dedupeEvents(events) {
  const seen = new Set();
  const output = [];

  for (const event of events) {
    const key = buildDedupKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(event);
  }

  return output;
}

function buildDedupKey(event) {
  return [
    normalizeKeyPart(event.title),
    event.start || '',
    normalizeKeyPart(event.location)
  ].join('|');
}

function normalizeKeyPart(value = '') {
  return String(value).trim().toLowerCase().replace(/\s+/g, ' ');
}

function safeToIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function cleanText(value = '') {
  return String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildTermRegex(term) {
  const escaped = escapeRegex(term);
  return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, 'i');
}

function escapeRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
