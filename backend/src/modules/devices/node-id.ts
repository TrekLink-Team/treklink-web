// A device's radio identity (devices task 1.3, D-035). The firmware names a node `!` plus eight lower-case
// hex digits of its unsigned 32-bit node number (`sender` in the stock JSON, the last topic level).

const NODE_ID = /^![0-9a-f]{8}$/;
const MAX_NODE_NUM = 0xffffffffn;

export const isNodeNum = (value: bigint): boolean => value >= 0n && value <= MAX_NODE_NUM;

export const toNodeId = (nodeNum: bigint): string => {
  if (!isNodeNum(nodeNum))
    throw new RangeError(`node number ${nodeNum} is not an unsigned 32-bit value`);
  return `!${nodeNum.toString(16).padStart(8, '0')}`;
};

export const fromNodeId = (nodeId: string): bigint => {
  const id = nodeId.toLowerCase();
  if (!NODE_ID.test(id)) throw new RangeError(`${nodeId} is not a node id such as !a4b1c2d3`);
  return BigInt(`0x${id.slice(1)}`);
};
