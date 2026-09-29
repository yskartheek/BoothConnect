import { type ExistingNode, planMasterData, readMasterCsv } from './master-data';

const existing: ExistingNode[] = [
  { id: 's1', level: 'state', code: 'S1', name: 'One', reservation: null, key: 'S1' },
  { id: 'p1', level: 'pc', code: '1', name: 'PC', reservation: 'GEN', key: 'S1/1' },
];
const plan = (csv: string, canAddState = true) =>
  planMasterData(readMasterCsv(`level,code,name,reservation,parent_code,state_code\n${csv}`), {
    existing,
    canEdit: () => true,
    canAddUnder: () => true,
    canAddState,
  }).map((r) => [r.action, r.key, r.errors.join('; ')]);

describe('readMasterCsv', () => {
  it('reads rows with their line numbers, trimmed, blanks as null', () => {
    expect(readMasterCsv('Level,CODE,name,parent_code\n AC , 40 ,"Name, with comma",6\n')).toEqual([
      {
        line: 2,
        level: 'ac',
        code: '40',
        name: 'Name, with comma',
        reservation: null,
        parentCode: '6',
        stateCode: null,
      },
    ]);
  });

  it('rejects a file with missing or unknown columns, or no rows', () => {
    expect(() => readMasterCsv('')).toThrow('The file is empty');
    expect(() => readMasterCsv('level,code')).toThrow('Missing column(s): name, parent_code');
    expect(() => readMasterCsv('level,code,name,parent_code,x')).toThrow('Unknown column(s): x');
    expect(() => readMasterCsv('level,code,name,parent_code')).toThrow('The file has no rows');
  });
});

describe('planMasterData', () => {
  it('plans parents before children, whatever the file order', () => {
    expect(plan('ac,5,AC,,2,\npc,2,PC two,,S1,\nstate,S1,One,,,')).toEqual([
      ['create', 'S1/2/5', ''],
      ['create', 'S1/2', ''],
      ['unchanged', 'S1', ''],
    ]);
  });

  it('a child of a row with errors is an error too', () => {
    expect(plan('state,S2,,,,\npc,1,PC,,S2,')).toEqual([
      ['error', null, 'name is required'],
      ['error', null, 'Its State (line 2) has errors'],
    ]);
  });

  it('a new State needs canAddState', () => {
    expect(plan('state,S2,Two,,,\npc,1,PC,,S2,', false)).toEqual([
      ['error', 'S2', 'Outside your area'],
      ['error', null, 'Its State (line 2) has errors'],
    ]);
  });

  it('a State has no parent_code; a PC or AC needs one', () => {
    expect(plan('state,S2,Two,,S1,\nac,9,AC,,,')).toEqual([
      ['error', null, 'a State has no parent_code'],
      ['error', null, 'parent_code is required for an AC'],
    ]);
  });
});
