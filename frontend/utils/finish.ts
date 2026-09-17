import { normalizeValue } from './product';

/**
 * CSS backgrounds for the finish names used in this catalog ("Хром",
 * "Матовая бронза", …). Metallics get a two-stop gradient so a chrome chip
 * doesn't read as flat grey next to a matte one.
 */
const FINISH_SWATCHES: { match: RegExp; background: string; border?: string }[] = [
  // Order matters — the first match wins, so compound names ("золотой сатин",
  // "матовая медь") must be listed above the plain colour they contain.
  { match: /золот.*глянц|глянц.*золот/, background: 'linear-gradient(135deg,#f6dfa0 0%,#d4a63c 45%,#f3e2ab 100%)' },
  { match: /золот.*(сатин|браш)|(сатин|браш).*золот|золото браш/, background: 'linear-gradient(135deg,#e7d3a1 0%,#c2a05a 50%,#ddc893 100%)' },
  { match: /натуральная латунь|латунь/, background: 'linear-gradient(135deg,#d8bd7a 0%,#b5913f 50%,#d3b774 100%)' },
  { match: /матовая бронза|бронза.*матов/, background: '#9a7156' },
  { match: /бронза/, background: 'linear-gradient(135deg,#b9825c 0%,#8c5a3c 50%,#ad7852 100%)' },
  { match: /розов.*золот|золот.*розов/, background: 'linear-gradient(135deg,#f0c3b0 0%,#c98468 50%,#eab9a4 100%)' },
  { match: /медь|медн/, background: 'linear-gradient(135deg,#c98a68 0%,#a26242 50%,#b97b58 100%)' },
  { match: /оружейн|нержаве.*сталь|сталь/, background: 'linear-gradient(135deg,#8d949c 0%,#565d66 55%,#7b828a 100%)' },
  { match: /платин/, background: 'linear-gradient(135deg,#f0f1f0 0%,#c2c6c4 50%,#e2e4e3 100%)', border: '#cdd0ce' },
  { match: /сатин|брашир|браш/, background: 'linear-gradient(135deg,#dcdcda 0%,#a9a9a5 50%,#cfcfcb 100%)' },
  { match: /графит/, background: '#4a4f55' },
  { match: /антрацит/, background: '#383c40' },
  { match: /черн.*матов|матов.*черн|^черн/, background: '#1b1b1b' },
  { match: /бел.*матов|матов.*бел|^бел/, background: '#f1f1ee', border: '#dcdcd6' },
  { match: /хром|никель/, background: 'linear-gradient(135deg,#ffffff 0%,#c4cad1 40%,#8e979f 70%,#e8ecef 100%)' },
  { match: /золот/, background: 'linear-gradient(135deg,#f6dfa0 0%,#d4a63c 50%,#f3e2ab 100%)' },
  // Allen Brau's coloured ceramics range.
  { match: /петрол/, background: '#2a5c62' },
  { match: /индиго/, background: '#33406e' },
  { match: /син|голуб/, background: '#33587a' },
  { match: /олив/, background: '#6d7552' },
  { match: /мятн|мента/, background: '#9cc6b4' },
  { match: /бордо|марсал/, background: '#7b2d3b' },
  { match: /терракот|кирпич/, background: '#b5674a' },
  { match: /папирус|айвори|слонов|беж|крем/, background: '#e8dfca', border: '#d6ccb4' },
  { match: /розов|пудр/, background: '#e3b5bb' },
  { match: /коричнев|шоколад/, background: '#6b4a35' },
  { match: /серебр/, background: 'linear-gradient(135deg,#f2f3f4 0%,#b9bfc4 50%,#dde0e2 100%)' },
  { match: /^сер|сер.*матов/, background: '#8d9195' },
  { match: /зелен/, background: '#4e6b56' },
  { match: /красн/, background: '#a33a33' },
  { match: /желт/, background: '#e0b63f' },
];

const FALLBACK = { background: 'linear-gradient(135deg,#e5e7eb 0%,#c9ccd1 100%)', border: '#d8dade' };

export function finishSwatch(name: string) {
  const key = normalizeValue(name || '');
  const hit = FINISH_SWATCHES.find((entry) => entry.match.test(key));
  return hit ? { background: hit.background, border: hit.border } : FALLBACK;
}
