/**
 * Normalize a subject name into a slug that matches across systems.
 *
 * Google Classroom and nz.ua name the same subject differently — "Алгебра та
 * початки аналізу" versus "Алгебра", "Українська мова" versus "Укр. мова" — and
 * without this every cross-source merge fails. The dictionary is extensible from
 * Settings so a naming clash never needs a release.
 */

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ж: 'zh', з: 'z',
  и: 'y', і: 'i', ї: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p',
  р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'shch', ь: '', ю: 'iu', я: 'ia', ы: 'y', э: 'e', ъ: '', ё: 'e',
};

/**
 * Canonical slugs, matched against the *transliterated* form — note that Ukrainian
 * `г` becomes `h`, so "Алгебра" folds to "alhebra" and not "algebra".
 *
 * Order matters: the more specific pattern must come first. "Фізична культура"
 * would otherwise be caught by the physics rule.
 */
const CANONICAL: Array<[RegExp, string]> = [
  [/fizychn|physical\s*education|\bpe\b/, 'physical-education'],
  [/istori\w*\s*ukrain|history\s*of\s*ukraine/, 'history-ukraine'],
  [/vsesvitn\w*\s*istori|world\s*history/, 'history-world'],
  [/ukrain\w*\s*literatur|\bukr\w*\s*lit/, 'ukrainian-literature'],
  [/ukrain\w*\s*mov|\bukr\w*\s*mov/, 'ukrainian-language'],
  [/zarubizhn\w*\s*literatur|svitov\w*\s*literatur|world\s*literature/, 'world-literature'],
  [/anhliisk|anhlii|english/, 'english'],
  [/al[hg]ebr|pochatky\s*analizu/, 'algebra'],
  [/heometr|geometr/, 'geometry'],
  [/matematyk|mathematic/, 'mathematics'],
  [/fizyk|physics/, 'physics'],
  [/khimi|chemistr/, 'chemistry'],
  [/biolohi|biology/, 'biology'],
  [/heohrafi|geograph/, 'geography'],
  [/informatyk|computer\s*science/, 'informatics'],
  [/zakhyst\s*ukrain/, 'defence-of-ukraine'],
  [/trudov\w*\s*navchan|tekhnolohi|technolog/, 'technology'],
  [/mystetstv|obrazotvorch/, 'art'],
  [/muzy[ck]|music/, 'music'],
];

function transliterate(input: string): string {
  return [...input].map((ch) => CYRILLIC_TO_LATIN[ch] ?? ch).join('');
}

/**
 * @param aliases user-taught overrides, keyed by the raw name lowercased.
 */
export function normalizeSubject(raw: string, aliases: Record<string, string> = {}): string {
  const trimmed = raw.trim();
  if (!trimmed) return 'unknown';

  const direct = aliases[trimmed.toLowerCase()];
  if (direct) return direct;

  const cleaned = trimmed
    .toLowerCase()
    // NFC, never NFKD: decomposing would split й and ї into a base letter plus a
    // combining mark, and stripping the mark would silently turn them into и and і.
    .normalize('NFC')
    // Apostrophes join rather than separate: "здоров'я" is one word.
    .replace(/['’ʼ`]/g, '')
    // Drop bracketed qualifiers and grade/group suffixes: "Алгебра (10-А)".
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b\d+\s*[-–]?\s*[a-zа-яіїєґ]\b/gi, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ');

  const folded = transliterate(cleaned).replace(/\s+/g, ' ').trim();

  for (const [pattern, slug] of CANONICAL) {
    if (pattern.test(folded)) return slug;
  }

  return folded.replace(/\s+/g, '-') || 'unknown';
}
