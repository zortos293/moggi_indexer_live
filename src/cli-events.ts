import Database from 'better-sqlite3';
import { CONFIG } from './config';
import { KURU_CONTRACTS, UNISWAP_CONTRACTS } from './platform-events';
import { getAllOfficialTokens, getTokensByCategory, TOKEN_LIST_INFO } from './official-tokens';

// CLI for querying events
const db = new Database(CONFIG.DB_PATH, { readonly: true });

const command = process.argv[2];
const arg = process.argv[3];

switch (command) {
  case 'by-name':
    if (arg) {
      showEventsByName(arg, parseInt(process.argv[4]) || 20);
    } else {
      console.log('Usage: npm run events by-name <event_name> [limit]');
    }
    break;
  case 'by-standard':
    if (arg) {
      showEventsByStandard(arg, parseInt(process.argv[4]) || 20);
    } else {
      console.log('Usage: npm run events by-standard <standard> [limit]');
    }
    break;
  case 'by-contract':
    if (arg) {
      showEventsByContract(arg, parseInt(process.argv[4]) || 20);
    } else {
      console.log('Usage: npm run events by-contract <contract_address> [limit]');
    }
    break;
  case 'summary':
    showEventSummary();
    break;
  case 'recent':
    showRecentEvents(parseInt(arg) || 50);
    break;
  case 'transfers':
    showTransferEvents(parseInt(arg) || 20);
    break;
  case 'swaps':
    showSwapEvents(parseInt(arg) || 20);
    break;
  case 'kuru':
    showKuruEvents(parseInt(arg) || 50);
    break;
  case 'kuru-contracts':
    showKuruContracts();
    break;
  case 'official-tokens':
    showOfficialTokens();
    break;
  case 'stablecoins':
    showTokensByCategory('stablecoin');
    break;
  case 'uniswap':
    showUniswapEvents(parseInt(arg) || 50);
    break;
  case 'uniswap-contracts':
    showUniswapContracts();
    break;
  default:
    console.log(`
Event Query CLI

Commands:
  by-name <name> [limit]      - Show events by name (e.g., "Transfer", "Swap")
  by-standard <std> [limit]   - Show events by standard (e.g., "ERC20", "UniswapV2")
  by-contract <addr> [limit]  - Show events for a specific contract
  summary                     - Show event statistics
  recent [limit]             - Show recent decoded events
  transfers [limit]          - Show recent Transfer events
  swaps [limit]              - Show recent Swap events
  kuru [limit]               - Show events from Kuru contracts
  kuru-contracts             - List all Kuru contract addresses
  official-tokens            - List official Monad tokens 🪙
  stablecoins                - List official stablecoins 💵
  uniswap [limit]            - Show events from Uniswap contracts 🦄
  uniswap-contracts          - List all Uniswap addresses 🦄

Examples:
  npm run events by-name Transfer 50
  npm run events by-standard ERC20 30
  npm run events by-contract 0x123... 20
  npm run events summary
    `);
}

function showEventsByName(eventName: string, limit: number) {
  const events = db
    .prepare(`
      SELECT
        l.block_number,
        l.transaction_hash,
        l.address,
        l.event_name,
        l.event_standard,
        l.decoded_params
      FROM logs l
      WHERE l.event_name = ?
      ORDER BY l.block_number DESC, l.log_index DESC
      LIMIT ?
    `)
    .all(eventName, limit);

  console.log(`\n🔥 ${eventName} Events (${events.length})\n`);

  for (const event of events as any[]) {
    console.log(`Block ${event.block_number} | ${event.event_standard}`);
    console.log(`Contract: ${event.address}`);
    console.log(`TX: ${event.transaction_hash}`);
    if (event.decoded_params) {
      console.log('Params:', JSON.parse(event.decoded_params));
    }
    console.log('---');
  }
}

function showEventsByStandard(standard: string, limit: number) {
  const events = db
    .prepare(`
      SELECT
        l.block_number,
        l.transaction_hash,
        l.address,
        l.event_name,
        l.event_standard,
        l.decoded_params
      FROM logs l
      WHERE l.event_standard = ?
      ORDER BY l.block_number DESC, l.log_index DESC
      LIMIT ?
    `)
    .all(standard, limit);

  console.log(`\n📊 ${standard} Events (${events.length})\n`);

  for (const event of events as any[]) {
    console.log(`${event.event_name} | Block ${event.block_number}`);
    console.log(`Contract: ${event.address}`);
    if (event.decoded_params) {
      console.log('Params:', JSON.parse(event.decoded_params));
    }
    console.log('---');
  }
}

function showEventsByContract(address: string, limit: number) {
  const events = db
    .prepare(`
      SELECT
        l.block_number,
        l.transaction_hash,
        l.event_name,
        l.event_standard,
        l.decoded_params
      FROM logs l
      WHERE l.address = ?
      ORDER BY l.block_number DESC, l.log_index DESC
      LIMIT ?
    `)
    .all(address.toLowerCase(), limit);

  console.log(`\n📜 Events for ${address} (${events.length})\n`);

  for (const event of events as any[]) {
    console.log(`${event.event_name || 'Unknown'} | Block ${event.block_number}`);
    if (event.event_standard) {
      console.log(`Standard: ${event.event_standard}`);
    }
    if (event.decoded_params) {
      console.log('Params:', JSON.parse(event.decoded_params));
    }
    console.log('---');
  }
}

function showEventSummary() {
  const total = db.prepare('SELECT COUNT(*) as count FROM logs').get() as any;
  const decoded = db.prepare('SELECT COUNT(*) as count FROM logs WHERE event_name IS NOT NULL').get() as any;

  const byName = db
    .prepare(`
      SELECT event_name, COUNT(*) as count
      FROM logs
      WHERE event_name IS NOT NULL
      GROUP BY event_name
      ORDER BY count DESC
      LIMIT 20
    `)
    .all();

  const byStandard = db
    .prepare(`
      SELECT event_standard, COUNT(*) as count
      FROM logs
      WHERE event_standard IS NOT NULL
      GROUP BY event_standard
      ORDER BY count DESC
    `)
    .all();

  console.log('\n📊 Event Statistics\n');
  console.log(`Total Logs:      ${total.count.toLocaleString()}`);
  console.log(`Decoded Events:  ${decoded.count.toLocaleString()} (${((decoded.count / total.count) * 100).toFixed(1)}%)`);
  console.log();

  console.log('Top Events by Name:');
  console.table(byName);

  console.log('\nEvents by Standard:');
  console.table(byStandard);
}

function showRecentEvents(limit: number) {
  const events = db
    .prepare(`
      SELECT
        l.block_number,
        l.transaction_hash,
        l.address,
        l.event_name,
        l.event_standard,
        l.decoded_params
      FROM logs l
      WHERE l.event_name IS NOT NULL
      ORDER BY l.block_number DESC, l.log_index DESC
      LIMIT ?
    `)
    .all(limit);

  console.log(`\n🔥 Recent Decoded Events (${events.length})\n`);

  for (const event of events as any[]) {
    console.log(`${event.event_name} | Block ${event.block_number} | ${event.event_standard}`);
    console.log(`Contract: ${event.address}`);
    if (event.decoded_params) {
      const params = JSON.parse(event.decoded_params);
      console.log('Params:', params);
    }
    console.log('---');
  }
}

function showTransferEvents(limit: number) {
  const transfers = db
    .prepare(`
      SELECT
        l.block_number,
        l.transaction_hash,
        l.address,
        l.event_standard,
        l.decoded_params
      FROM logs l
      WHERE l.event_name = 'Transfer'
      ORDER BY l.block_number DESC
      LIMIT ?
    `)
    .all(limit);

  console.log(`\n💸 Recent Transfer Events (${transfers.length})\n`);

  for (const transfer of transfers as any[]) {
    const params = transfer.decoded_params ? JSON.parse(transfer.decoded_params) : {};
    console.log(`Block ${transfer.block_number} | ${transfer.event_standard}`);
    console.log(`Token: ${transfer.address}`);
    console.log(`From: ${params.from}`);
    console.log(`To: ${params.to}`);
    console.log(`Value: ${params.value || params.tokenId || 'N/A'}`);
    console.log('---');
  }
}

function showSwapEvents(limit: number) {
  const swaps = db
    .prepare(`
      SELECT
        l.block_number,
        l.transaction_hash,
        l.address,
        l.decoded_params
      FROM logs l
      WHERE l.event_name = 'Swap'
      ORDER BY l.block_number DESC
      LIMIT ?
    `)
    .all(limit);

  console.log(`\n🔄 Recent Swap Events (${swaps.length})\n`);

  for (const swap of swaps as any[]) {
    const params = swap.decoded_params ? JSON.parse(swap.decoded_params) : {};
    console.log(`Block ${swap.block_number}`);
    console.log(`DEX: ${swap.address}`);
    console.log(`Sender: ${params.sender}`);
    console.log(`To: ${params.to}`);
    if (params.amount0In) {
      console.log(`Amount0 In: ${params.amount0In}`);
      console.log(`Amount1 In: ${params.amount1In}`);
      console.log(`Amount0 Out: ${params.amount0Out}`);
      console.log(`Amount1 Out: ${params.amount1Out}`);
    }
    console.log('---');
  }
}

function showKuruEvents(limit: number) {
  // Get all Kuru contract addresses in lowercase for comparison
  const kuruAddresses = Object.values(KURU_CONTRACTS).map(addr => addr.toLowerCase());

  // Build the SQL query with placeholders for each address
  const placeholders = kuruAddresses.map(() => '?').join(',');

  const events = db
    .prepare(`
      SELECT
        l.block_number,
        l.transaction_hash,
        l.address,
        l.event_name,
        l.event_standard,
        l.decoded_params
      FROM logs l
      WHERE LOWER(l.address) IN (${placeholders})
        AND l.event_name IS NOT NULL
      ORDER BY l.block_number DESC, l.log_index DESC
      LIMIT ?
    `)
    .all(...kuruAddresses, limit);

  console.log(`\n🔷 Kuru Contract Events (${events.length})\n`);

  // Find which Kuru contract each event is from
  for (const event of events as any[]) {
    const contractName = Object.entries(KURU_CONTRACTS).find(
      ([_, addr]) => addr.toLowerCase() === event.address.toLowerCase()
    )?.[0] || 'Unknown';

    console.log(`${event.event_name} | Block ${event.block_number}`);
    console.log(`Contract: ${contractName} (${event.address})`);
    console.log(`Standard: ${event.event_standard}`);
    console.log(`TX: ${event.transaction_hash}`);

    if (event.decoded_params) {
      const params = JSON.parse(event.decoded_params);
      console.log('Params:', params);
    }
    console.log('---');
  }

  if (events.length === 0) {
    console.log('No events found from Kuru contracts yet.');
    console.log('Run the indexer to start collecting events!');
  }
}

function showKuruContracts() {
  console.log('\n🔷 Kuru Mainnet Contract Addresses\n');

  Object.entries(KURU_CONTRACTS).forEach(([name, address]) => {
    console.log(`${name}:`);
    console.log(`  ${address}`);
    console.log();
  });

  console.log('Description:');
  console.log('  - KuruFlowEntryPoint: Entry point of the Kuru Flow aggregator');
  console.log('  - KuruFlowRouter: Kuru Flow router contract');
  console.log('  - Router: Kuru DEX router and market factory');
  console.log('  - MarginAccount: Margin account for all liquidity on Kuru');
  console.log('  - KuruForwarder: Transaction forwarder contract');
  console.log('  - MonadDeployer: One-step token deployment and market bootstrapping');
  console.log();
  console.log('Query events from these contracts with: npm run events kuru [limit]');
}

function showOfficialTokens() {
  const tokens = getAllOfficialTokens();

  console.log('\n🪙 Official Monad Mainnet Tokens\n');
  console.log(`Source: ${TOKEN_LIST_INFO.source}`);
  console.log(`Last Updated: ${TOKEN_LIST_INFO.lastUpdated}`);
  console.log(`Total Tokens: ${TOKEN_LIST_INFO.totalTokens}\n`);

  // Group by category
  const stablecoins = tokens.filter(t => t.category === 'stablecoin');
  const wrapped = tokens.filter(t => t.category === 'wrapped');
  const commodity = tokens.filter(t => t.category === 'commodity');

  console.log('💵 Stablecoins:');
  stablecoins.forEach(token => {
    console.log(`  ${token.symbol.padEnd(8)} - ${token.name}`);
    console.log(`    ${token.address} (${token.decimals} decimals)`);
  });

  console.log('\n🔄 Wrapped Assets:');
  wrapped.forEach(token => {
    console.log(`  ${token.symbol.padEnd(8)} - ${token.name}`);
    console.log(`    ${token.address} (${token.decimals} decimals)`);
  });

  if (commodity.length > 0) {
    console.log('\n🏆 Commodity Tokens:');
    commodity.forEach(token => {
      console.log(`  ${token.symbol.padEnd(8)} - ${token.name}`);
      console.log(`    ${token.address} (${token.decimals} decimals)`);
    });
  }

  console.log('\nQuery token events with:');
  console.log('  npm run events by-contract <token_address> [limit]');
}

function showTokensByCategory(category: 'stablecoin' | 'wrapped' | 'commodity') {
  const tokens = getTokensByCategory(category);
  const categoryName = category === 'stablecoin' ? 'Stablecoins' :
                       category === 'wrapped' ? 'Wrapped Assets' :
                       'Commodity Tokens';

  console.log(`\n${categoryName} (${tokens.length})\n`);

  tokens.forEach(token => {
    console.log(`${token.symbol} - ${token.name}`);
    console.log(`  Address: ${token.address}`);
    console.log(`  Decimals: ${token.decimals}`);
    console.log(`  Logo: ${token.logoURI}`);
    console.log();
  });
}

function showUniswapEvents(limit: number) {
  // Get all Uniswap contract addresses in lowercase for comparison
  const uniswapAddresses = Object.values(UNISWAP_CONTRACTS).map(addr => addr.toLowerCase());

  // Build the SQL query with placeholders for each address
  const placeholders = uniswapAddresses.map(() => '?').join(',');

  const events = db
    .prepare(`
      SELECT
        l.block_number,
        l.transaction_hash,
        l.address,
        l.event_name,
        l.event_standard,
        l.decoded_params
      FROM logs l
      WHERE LOWER(l.address) IN (${placeholders})
        AND l.event_name IS NOT NULL
      ORDER BY l.block_number DESC, l.log_index DESC
      LIMIT ?
    `)
    .all(...uniswapAddresses, limit);

  console.log(`\n🦄 Uniswap Contract Events (${events.length})\n`);

  // Find which Uniswap contract each event is from
  for (const event of events as any[]) {
    const contractName = Object.entries(UNISWAP_CONTRACTS).find(
      ([_, addr]) => addr.toLowerCase() === event.address.toLowerCase()
    )?.[0] || 'Unknown';

    console.log(`${event.event_name} | Block ${event.block_number}`);
    console.log(`Contract: ${contractName} (${event.address})`);
    console.log(`Standard: ${event.event_standard}`);
    console.log(`TX: ${event.transaction_hash}`);

    if (event.decoded_params) {
      const params = JSON.parse(event.decoded_params);
      console.log('Params:', params);
    }
    console.log('---');
  }

  if (events.length === 0) {
    console.log('No events found from Uniswap contracts yet.');
    console.log('Run the indexer to start collecting events!');
  }
}

function showUniswapContracts() {
  console.log('\n🦄 Uniswap Mainnet Contract Addresses\n');

  console.log('V2:');
  console.log(`  UniswapV2Factory: ${UNISWAP_CONTRACTS.UniswapV2Factory}`);
  console.log(`  UniswapV2Router02: ${UNISWAP_CONTRACTS.UniswapV2Router02}`);
  console.log();

  console.log('V3 Core:');
  console.log(`  UniswapV3Factory: ${UNISWAP_CONTRACTS.UniswapV3Factory}`);
  console.log(`  NonfungiblePositionManager: ${UNISWAP_CONTRACTS.NonfungiblePositionManager}`);
  console.log(`  SwapRouter: ${UNISWAP_CONTRACTS.SwapRouter}`);
  console.log(`  SwapRouter02: ${UNISWAP_CONTRACTS.SwapRouter02}`);
  console.log(`  V3Migrator: ${UNISWAP_CONTRACTS.V3Migrator}`);
  console.log();

  console.log('V3 Periphery:');
  console.log(`  QuoterV2: ${UNISWAP_CONTRACTS.QuoterV2}`);
  console.log(`  Quoter: ${UNISWAP_CONTRACTS.Quoter}`);
  console.log(`  TickLens: ${UNISWAP_CONTRACTS.TickLens}`);
  console.log(`  MixedRouteQuoterV2: ${UNISWAP_CONTRACTS.MixedRouteQuoterV2}`);
  console.log();

  console.log('V4:');
  console.log(`  PoolManager: ${UNISWAP_CONTRACTS.PoolManager}`);
  console.log(`  PositionManager: ${UNISWAP_CONTRACTS.PositionManager}`);
  console.log(`  PositionDescriptor: ${UNISWAP_CONTRACTS.PositionDescriptor}`);
  console.log(`  V4Quoter: ${UNISWAP_CONTRACTS.V4Quoter}`);
  console.log(`  StateView: ${UNISWAP_CONTRACTS.StateView}`);
  console.log();

  console.log('Universal:');
  console.log(`  UniversalRouter: ${UNISWAP_CONTRACTS.UniversalRouter}`);
  console.log(`  UniswapInterfaceMulticall: ${UNISWAP_CONTRACTS.UniswapInterfaceMulticall}`);
  console.log();

  console.log('Total Contracts: 23');
  console.log();
  console.log('Query events from these contracts with: npm run events uniswap [limit]');
  console.log('Official Docs: https://docs.uniswap.org/');
}

db.close();
