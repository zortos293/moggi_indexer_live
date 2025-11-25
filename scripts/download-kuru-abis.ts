/**
 * Download all Kuru SDK ABIs from GitHub
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import https from 'https';

const REPO_OWNER = 'Kuru-Labs';
const REPO_NAME = 'kuru-sdk';
const BRANCH = 'main';
const ABI_PATH = 'abi';

const ABI_FILES = [
  'ActiveVault.json',
  'IERC20.json',
  'KuruAMMVault.json',
  'KuruUtils.json',
  'MarginAccount.json',
  'MonadDeployer.json',
  'OrderBook.json',
  'RewardVault.json',
  'Router.json',
  'Vault.json',
  'WMon.json',
];

async function fetchFile(filename: string): Promise<string> {
  const url = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${ABI_PATH}/${filename}`;

  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to fetch ${filename}: ${res.statusCode}`));
        return;
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  const outputDir = './abi';

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  console.log('Downloading Kuru SDK ABIs...\n');

  let success = 0;
  let failed = 0;

  for (const file of ABI_FILES) {
    process.stdout.write(`  ${file}... `);
    try {
      const content = await fetchFile(file);
      writeFileSync(`${outputDir}/${file}`, content);
      console.log('✓');
      success++;
    } catch (error) {
      console.log('✗', (error as Error).message);
      failed++;
    }
  }

  console.log(`\nDone! ${success} downloaded, ${failed} failed.`);
  console.log(`\nABIs saved to: ${outputDir}/`);
}

main().catch(console.error);
