/**
 * Script to extract events from ABI files and generate event signatures
 *
 * Usage: tsx src/extract-abi-events.ts <path-to-abi.json>
 */

import { readFileSync } from 'fs';
import { Interface } from 'ethers';

function extractEventsFromABI(abiPath: string) {
  const abiContent = readFileSync(abiPath, 'utf8');
  const abi = JSON.parse(abiContent);

  // Handle both direct ABI arrays and objects with 'abi' property
  const abiArray = Array.isArray(abi) ? abi : (abi.abi || []);

  console.log(`\n📋 Extracting events from: ${abiPath}\n`);

  const events: any[] = [];

  for (const item of abiArray) {
    if (item.type === 'event') {
      try {
        // Compute the actual topic hash using ethers.js
        const iface = new Interface([item]);
        const event = iface.getEvent(item.name);

        if (!event) continue;

        const topicHash = event.topicHash;

        // Build signature
        const paramTypes = item.inputs.map((input: any) => input.type).join(',');
        const signature = `${item.name}(${paramTypes})`;

        // Extract parameters
        const params = item.inputs.map((input: any) => ({
          name: input.name || 'param',
          type: input.type,
          indexed: input.indexed || false,
        }));

        events.push({
          name: item.name,
          topicHash,
          signature,
          params,
        });

        console.log(`✅ ${item.name}`);
        console.log(`   Topic: ${topicHash}`);
        console.log(`   Signature: ${signature}`);
        console.log(`   Parameters:`);
        params.forEach((p: any) => {
          console.log(`     - ${p.name}: ${p.type}${p.indexed ? ' (indexed)' : ''}`);
        });
        console.log();
      } catch (error) {
        console.error(`❌ Failed to process event ${item.name}:`, error);
      }
    }
  }

  console.log(`\n📊 Total events extracted: ${events.length}\n`);

  // Generate TypeScript code
  console.log('// Generated event signatures:\n');
  events.forEach(event => {
    console.log(`  '${event.topicHash}': {`);
    console.log(`    name: '${event.name}',`);
    console.log(`    signature: '${event.signature}',`);
    console.log(`    standard: 'Platform', // TODO: Set appropriate standard`);
    console.log(`    params: [`);
    event.params.forEach((p: any) => {
      console.log(`      { name: '${p.name}', type: '${p.type}', indexed: ${p.indexed} },`);
    });
    console.log(`    ],`);
    console.log(`  },\n`);
  });

  return events;
}

// Run if called directly
if (require.main === module) {
  const abiPath = process.argv[2];
  if (!abiPath) {
    console.error('Usage: tsx src/extract-abi-events.ts <path-to-abi.json>');
    process.exit(1);
  }

  try {
    extractEventsFromABI(abiPath);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

export { extractEventsFromABI };
