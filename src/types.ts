export interface Block {
  number: number;
  hash: string;
  parentHash: string;
  nonce?: string;
  sha3Uncles: string;
  logsBloom: string;
  transactionsRoot: string;
  stateRoot: string;
  receiptsRoot: string;
  miner: string;
  difficulty: string;
  totalDifficulty: string;
  extraData: string;
  size: number;
  gasLimit: number;
  gasUsed: number;
  timestamp: number;
  baseFeePerGas?: string;
  transactions: string[]; // Transaction hashes
}

export interface Transaction {
  hash: string;
  blockNumber: number;
  blockHash: string;
  transactionIndex: number;
  from: string;
  to: string | null;
  value: string;
  gas: number;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  input: string;
  nonce: number;
  type: number;
  chainId?: number;
  v?: string;
  r?: string;
  s?: string;
  accessList?: Array<{address: string; storageKeys: string[]}>;
}

export interface TransactionReceipt {
  transactionHash: string;
  transactionIndex: number;
  blockHash: string;
  blockNumber: number;
  from: string;
  to: string | null;
  cumulativeGasUsed: number;
  gasUsed: number;
  effectiveGasPrice: string;
  contractAddress: string | null;
  logs: Log[];
  logsBloom: string;
  status: number;
  type: number;
}

export interface Log {
  address: string;
  topics: string[];
  data: string;
  blockNumber: number;
  blockHash: string;
  transactionHash: string;
  transactionIndex: number;
  logIndex: number;
  removed: boolean;
}

export interface Contract {
  address: string;
  creatorAddress: string;
  creationTxHash: string;
  creationBlockNumber: number;
  bytecode: string;
  isErc20: boolean;
  isErc721: boolean;
  isErc1155: boolean;
}

export interface ERC20Token {
  address: string;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply: string | null;
}

export interface ERC721Token {
  address: string;
  name: string | null;
  symbol: string | null;
  totalSupply: string | null;
}

export interface ERC1155Token {
  address: string;
  uri: string | null;
}

export interface Address {
  address: string;
  firstSeenBlock: number;
  firstSeenTx: string;
  isContract: boolean;
  txCount: number;
  balance: string;
}

export interface IndexerState {
  forwardBlock: number;
  backwardBlock: number | null;
  latestBlock: number | null;
  isSynced: boolean;
  lastUpdated: number;
}

export interface BlockProcessingResult {
  block: Block;
  transactions: Transaction[];
  receipts: TransactionReceipt[];
  contracts: Contract[];
  tokens: {
    erc20: ERC20Token[];
    erc721: ERC721Token[];
    erc1155: ERC1155Token[];
  };
}
