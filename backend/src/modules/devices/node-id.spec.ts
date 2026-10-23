import { fromNodeId, isNodeNum, toNodeId } from './node-id';

describe('node id', () => {
  it('round-trips a node number through its id', () => {
    for (const nodeNum of [0n, 0xde000009n, 2763113171n, 0xffffffffn]) {
      expect(fromNodeId(toNodeId(nodeNum))).toBe(nodeNum);
    }
    expect(toNodeId(2763113171n)).toBe('!a4b1c2d3');
    expect(toNodeId(0x9n)).toBe('!00000009');
  });

  it('accepts an upper-case id and refuses anything else', () => {
    expect(fromNodeId('!A4B1C2D3')).toBe(2763113171n);
    for (const bad of ['a4b1c2d3', '!a4b1c2', '!a4b1c2d3e', '!g4b1c2d3', '']) {
      expect(() => fromNodeId(bad)).toThrow(RangeError);
    }
  });

  it('refuses a node number outside unsigned 32 bits', () => {
    expect(isNodeNum(-1n)).toBe(false);
    expect(isNodeNum(0x100000000n)).toBe(false);
    expect(() => toNodeId(0x100000000n)).toThrow(RangeError);
  });
});
