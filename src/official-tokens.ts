/**
 * Official Monad Mainnet Token List
 * Source: https://github.com/monad-crypto/token-list
 * Last Updated: 2025-11-13
 */

export interface OfficialToken {
  chainId: number;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  logoURI: string;
  category?: 'stablecoin' | 'wrapped' | 'commodity' | 'other';
}

export const OFFICIAL_TOKENS: Record<string, OfficialToken> = {
  // Stablecoins
  '0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a': {
    chainId: 143,
    address: '0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a',
    name: 'Agora USD',
    symbol: 'AUSD',
    decimals: 6,
    logoURI: 'https://imagedelivery.net/cBNDGgkrsEA-b_ixIp9SkQ/ausd.jpg/public',
    category: 'stablecoin',
  },
  '0x754704Bc059F8C67012fEd69BC8A327a5aafb603': {
    chainId: 143,
    address: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603',
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 6,
    logoURI: 'https://imagedelivery.net/cBNDGgkrsEA-b_ixIp9SkQ/usdc.png/public',
    category: 'stablecoin',
  },
  '0xe7cd86e13AC4309349F30B3435a9d337750fC82D': {
    chainId: 143,
    address: '0xe7cd86e13AC4309349F30B3435a9d337750fC82D',
    name: 'USDT0',
    symbol: 'USDT0',
    decimals: 6,
    logoURI: 'https://2344189142-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FHytE5q346VLLbrVSUNpY%2Fuploads%2FVkLgUdebD73euZnroDeW%2FLogo%20USDT0%20256x256.png?alt=media&token=0ca67be2-d89c-43c8-bdd2-34b552c784dc',
    category: 'stablecoin',
  },
  '0x8BF591Eae535f93a242D5A954d3Cde648b48A5A8': {
    chainId: 143,
    address: '0x8BF591Eae535f93a242D5A954d3Cde648b48A5A8',
    name: 'Sumerian USD',
    symbol: 'suUSD',
    decimals: 18,
    logoURI: 'https://raw.githubusercontent.com/meterio/token-list/master/data/suUSD/logo.png',
    category: 'stablecoin',
  },

  // Wrapped Assets
  '0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242': {
    chainId: 143,
    address: '0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242',
    name: 'Wrapped ETH',
    symbol: 'WETH',
    decimals: 18,
    logoURI: 'https://assets.coingecko.com/coins/images/2518/standard/weth.png?1696503332',
    category: 'wrapped',
  },
  '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A': {
    chainId: 143,
    address: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A',
    name: 'Wrapped MON',
    symbol: 'WMON',
    decimals: 18,
    logoURI: 'https://raw.githubusercontent.com/monad-crypto/token-list/refs/heads/main/assets/monad.svg',
    category: 'wrapped',
  },
  '0xea17E5a9efEBf1477dB45082d67010E2245217f1': {
    chainId: 143,
    address: '0xea17E5a9efEBf1477dB45082d67010E2245217f1',
    name: 'Wrapped SOL',
    symbol: 'WSOL',
    decimals: 9,
    logoURI: 'https://assets.coingecko.com/coins/images/54252/standard/solana.jpg?1738911214',
    category: 'wrapped',
  },

  // Commodity/Specialized
  '0x01bFF41798a0BcF287b996046Ca68b395DbC1071': {
    chainId: 143,
    address: '0x01bFF41798a0BcF287b996046Ca68b395DbC1071',
    name: 'XAUt0',
    symbol: 'XAUt0',
    decimals: 6,
    logoURI: 'https://resources.cryptocompare.com/asset-management/20126/1751464669093.png',
    category: 'commodity',
  },
  '0xe85411C030fB32A9D8b14Bbbc6CB19417391F711': {
    chainId: 143,
    address: '0xe85411C030fB32A9D8b14Bbbc6CB19417391F711',
    name: 'Sumerian BTC',
    symbol: 'suBTC',
    decimals: 18,
    logoURI: 'https://raw.githubusercontent.com/meterio/token-list/master/data/suBTC/logo.png',
    category: 'wrapped',
  },
  '0x1c22531AA9747d76fFF8F0A43b37954ca67d28e0': {
    chainId: 143,
    address: '0x1c22531AA9747d76fFF8F0A43b37954ca67d28e0',
    name: 'Sumerian ETH',
    symbol: 'suETH',
    decimals: 18,
    logoURI: 'https://raw.githubusercontent.com/meterio/token-list/master/data/suETH/logo.png',
    category: 'wrapped',
  },
};

// Helper functions
export function getOfficialToken(address: string): OfficialToken | undefined {
  return OFFICIAL_TOKENS[address.toLowerCase()] ||
         OFFICIAL_TOKENS[Object.keys(OFFICIAL_TOKENS).find(
           addr => addr.toLowerCase() === address.toLowerCase()
         ) || ''];
}

export function isOfficialToken(address: string): boolean {
  return Object.keys(OFFICIAL_TOKENS).some(
    addr => addr.toLowerCase() === address.toLowerCase()
  );
}

export function getTokensByCategory(category: OfficialToken['category']): OfficialToken[] {
  return Object.values(OFFICIAL_TOKENS).filter(token => token.category === category);
}

export function getAllOfficialTokens(): OfficialToken[] {
  return Object.values(OFFICIAL_TOKENS);
}

// Token list metadata
export const TOKEN_LIST_INFO = {
  name: 'Monad Mainnet',
  source: 'https://github.com/monad-crypto/token-list',
  lastUpdated: '2025-11-13',
  version: '0.0.1',
  totalTokens: Object.keys(OFFICIAL_TOKENS).length,
};
