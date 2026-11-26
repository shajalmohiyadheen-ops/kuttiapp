import { describe, expect, it } from 'vitest';
import { matchProjects, parseSpokenAmount } from './voice';

describe('parseSpokenAmount', () => {
  const cases: Array<[string, number | null]> = [
    ['2300', 230000],
    ['2,300.50', 230050],
    ['SAR 150', 15000],
    ['it was 85 riyals', 8500],
    ['2 300', 230000],
    ['two thousand three hundred', 230000],
    ['one hundred and fifty', 15000],
    ['fifty five', 5500],
    ['twelve point five', 1250],
    ['fifty riyals and 25 halalas', 5025],
    ['3 thousand', 300000],
    ['١٥٠ ريال', 15000],
    ['ألفين وثلاثمية', 230000],
    ['ألفين و ثلاثمائة ريال', 230000],
    ['خمسة وعشرين', 2500],
    ['ثلاث آلاف وخمسمية', 350000],
    ['مية وخمسين ريال', 15000],
    ['مئتين', 20000],
    ['خمسطعش ريال', 1500],
    ['الف ومية', 110000],
    ['عشرة آلاف', 1000000],
    ['hello', null],
    ['', null],
  ];
  for (const [text, want] of cases) it(`"${text}"`, () => expect(parseSpokenAmount(text)).toBe(want));
});

describe('matchProjects', () => {
  const projects = [
    { id: '1', code: 'P-001', name: 'ABB substation', name_ar: 'محطة اي بي بي' },
    { id: '2', code: 'P-002', name: 'Riyadh villa fit-out', name_ar: 'تشطيب فيلا الرياض' },
    { id: '3', code: 'ADM', name: 'Head office admin', name_ar: 'إدارة المكتب الرئيسي' },
  ];
  const top = (s: string) => matchProjects(s, projects)[0]?.project.id;
  it('matches by name in a sentence', () => expect(top('this is for ABB project')).toBe('1'));
  it('matches spelled-out letters', () => expect(top('a b b')).toBe('1'));
  it('matches by code', () => expect(top('P 002')).toBe('2'));
  it('matches a partial name', () => expect(top('the villa')).toBe('2'));
  it('matches Arabic with the article', () => expect(top('مشروع الرياض')).toBe('2'));
  it('matches Arabic office', () => expect(top('المكتب الرئيسي')).toBe('3'));
  it('tolerates a mis-hearing', () => expect(top('riad villa')).toBe('2'));
  it('returns nothing for noise', () => expect(matchProjects('banana', projects)).toEqual([]));
});
