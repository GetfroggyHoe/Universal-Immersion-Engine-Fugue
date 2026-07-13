const BANNED_NAME_ROOTS = [
  "elara", "kael", "vane", "voss", "marcus", "chen", "vale", "vance",
  "eleanor", "beatrice", "sloane", "brenda"
];

const FIRST_NAMES = [
  "Avery", "Rhea", "Dorian", "Imani", "Tobias", "Nadia", "Rowan", "Mina",
  "Cassian", "Priya", "Julian", "Noemi", "Silas", "Amara", "Theo", "Yara",
  "Marlowe", "Iris", "Lucian", "Zuri", "Bastian", "Mae", "Orion", "Talia",
  "Rafael", "Niko", "Samira", "Cleo", "Gideon", "Freya", "Jasper", "Aya"
];

const LAST_NAMES = [
  "Ashford", "Moreno", "Okafor", "Kestrel", "Navarro", "Bellamy", "Hawthorne",
  "Rivers", "Solberg", "Marin", "Calloway", "Ibarra", "Quill", "Dawson",
  "Mercer", "Thorne", "Bishop", "Arden", "Sato", "Reyes", "North", "Aster"
];

function normalize(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z]/g, "");
}

export function isBannedGeneratedName(value) {
  const compact = normalize(value);
  return !compact || BANNED_NAME_ROOTS.some((root) => compact.includes(root));
}

export function generateRandomName({ used = [], firstOnly = false, random = Math.random } = {}) {
  const usedKeys = new Set((used || []).map(normalize).filter(Boolean));
  for (let attempt = 0; attempt < 200; attempt++) {
    const first = FIRST_NAMES[Math.floor(random() * FIRST_NAMES.length)];
    const last = LAST_NAMES[Math.floor(random() * LAST_NAMES.length)];
    const candidate = firstOnly ? first : `${first} ${last}`;
    const key = normalize(candidate);
    if (!isBannedGeneratedName(candidate) && !usedKeys.has(key)) return candidate;
  }
  return `Citizen ${Math.floor(random() * 9000) + 1000}`;
}

export const BANNED_GENERATED_NAMES = Object.freeze([...BANNED_NAME_ROOTS]);

