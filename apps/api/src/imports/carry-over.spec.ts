import { previousRecords } from './carry-over';

describe('previousRecords', () => {
  const previous = [
    { id: 'a', sourceVoterId: 'EPIC1' },
    { id: 'b', sourceVoterId: 'EPIC2' },
    { id: 'c', sourceVoterId: 'TWICE' },
    { id: 'd', sourceVoterId: 'TWICE' },
    { id: 'e', sourceVoterId: null },
    { id: 'f', sourceVoterId: 'GONE' },
  ];

  it('links the same EPIC; new and dropped EPICs have no link', () => {
    expect(previousRecords(previous, ['EPIC1', 'EPIC2', 'NEW'])).toEqual(
      new Map([
        ['EPIC1', 'a'],
        ['EPIC2', 'b'],
      ]),
    );
  });

  it('an EPIC printed twice in either revision is ambiguous, so not linked', () => {
    expect(previousRecords(previous, ['TWICE', 'EPIC1', 'EPIC1'])).toEqual(new Map());
  });
});
