import { keccak256, toUtf8Bytes } from 'ethers';

// Compute topic0 hash for event signatures
const events = [
  'OrderCreated(uint40,address,uint96,uint32,bool)',
  'Trade(uint40,address,bool,uint256,uint96,address,address,uint96)',
  'OrdersCanceled(uint40[],address)',
  'FlipOrderCreated(uint40,uint40,address,uint96,uint32,uint32,bool)',
  'FlipOrderUpdated(uint40,uint96)',
  'FlipOrdersCanceled(uint40[],address)',
  'FlippedOrderCreated(uint40,uint40,address,uint96,uint32,uint32,bool)',
  'Deposit(address,address,uint256)',
  'Withdrawal(address,address,uint256)',
  'OwnershipHandoverCanceled(address)',
  'OwnershipHandoverRequested(address)',
  'Upgraded(address)',
  'Initialized(uint64)',
];

console.log('Kuru Event Hashes:\n');
for (const sig of events) {
  const hash = keccak256(toUtf8Bytes(sig));
  console.log(`  // ${sig}`);
  console.log(`  '${hash}': {`);
  console.log(`    name: '${sig.split('(')[0]}',`);
  console.log(`    signature: '${sig}',`);
  console.log(`    standard: 'Kuru',`);
  console.log(`  },\n`);
}
