import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { groundedAction, groundMotifs } from '../src/director/grounding';

interface FixtureCase {
  id: string;
  language: string;
  text: string;
  expectedKinds: string[];
  expectedAction: string | null;
  normalization?: string;
}

interface Fixture {
  version: number;
  description: string;
  cases: FixtureCase[];
}

const fixturePath = process.argv.find((arg) => arg.endsWith('.json')) ?? 'scripts/grounding-fixture.json';
const fixture = JSON.parse(readFileSync(resolve(process.cwd(), fixturePath), 'utf8')) as Fixture;

function inputText(item: FixtureCase): string {
  return item.normalization === 'NFKC' ? item.text.normalize('NFKC') : item.text;
}

const rows = fixture.cases.map((item) => {
  const text = inputText(item);
  const actualKinds = groundMotifs(text, item.language, 1, item.id, 'lyrics')
    .filter((motif) => motif.kind !== 'symbol')
    .map((motif) => motif.kind);
  const actualAction = groundedAction(text, item.language);
  const expected = new Set(item.expectedKinds);
  const actual = new Set(actualKinds);
  const trueKinds = [...actual].filter((kind) => expected.has(kind)).length;
  const falseKinds = [...actual].filter((kind) => !expected.has(kind)).length;
  const actionExpected = item.expectedAction !== null;
  const actionCorrect = actualAction === item.expectedAction;
  const falseAction = !actionExpected && actualAction !== null;
  return {
    id: item.id,
    expectedKinds: [...expected],
    actualKinds,
    expectedAction: item.expectedAction,
    actualAction,
    pass: trueKinds === expected.size && falseKinds === 0 && actionCorrect,
    trueKinds,
    expectedKindsCount: expected.size,
    falseKinds,
    actionExpected,
    actionCorrect,
    falseAction,
  };
});

const expectedCueCount = rows.reduce((sum, row) => sum + row.expectedKindsCount + (row.actionExpected ? 1 : 0), 0);
const trueCueCount = rows.reduce((sum, row) => sum + row.trueKinds + (row.actionCorrect && row.actionExpected ? 1 : 0), 0);
const predictedCueCount = rows.reduce((sum, row) => sum + row.actualKinds.length + (row.actualAction ? 1 : 0), 0);
const falsePromotionCount = rows.reduce((sum, row) => sum + row.falseKinds + (row.falseAction ? 1 : 0), 0);
const result = {
  fixtureVersion: fixture.version,
  fixturePath,
  cases: rows.length,
  passingCases: rows.filter((row) => row.pass).length,
  cueRecall: expectedCueCount === 0 ? 1 : trueCueCount / expectedCueCount,
  cuePrecision: predictedCueCount === 0 ? 1 : trueCueCount / predictedCueCount,
  falsePromotionCount,
  byLanguage: Object.fromEntries([...new Set(fixture.cases.map((item) => item.language))].map((language) => {
    const languageRows = rows.filter((row) => fixture.cases.find((item) => item.id === row.id)?.language === language);
    return [language, {
      cases: languageRows.length,
      passingCases: languageRows.filter((row) => row.pass).length,
      falsePromotions: languageRows.reduce((sum, row) => sum + row.falseKinds + (row.falseAction ? 1 : 0), 0),
    }];
  })),
  rows,
};

const json = process.argv.includes('--json');
const reportOnly = process.argv.includes('--report-only');
console.log(json ? JSON.stringify(result, null, 2) : [
  `Grounding fixture v${result.fixtureVersion}: ${result.passingCases}/${result.cases} cases pass`,
  `Cue recall: ${(result.cueRecall * 100).toFixed(1)}%`,
  `Cue precision: ${(result.cuePrecision * 100).toFixed(1)}%`,
  `False literal promotions: ${result.falsePromotionCount}`,
  `By language: ${Object.entries(result.byLanguage).map(([language, summary]) => `${language} ${summary.passingCases}/${summary.cases}, false=${summary.falsePromotions}`).join('; ')}`,
  ...rows.filter((row) => !row.pass).map((row) => `FAIL ${row.id}: expected ${JSON.stringify(row.expectedKinds)}/${row.expectedAction}, got ${JSON.stringify(row.actualKinds)}/${row.actualAction}`),
].join('\n'));

if (!reportOnly && (result.passingCases !== result.cases || result.falsePromotionCount !== 0)) process.exitCode = 1;
