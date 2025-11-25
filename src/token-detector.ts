import { RPCClient } from './rpc-client';
import {
  ERC20_SIGNATURES,
  ERC721_SIGNATURES,
  ERC1155_SIGNATURES,
  INTERFACE_IDS,
} from './config';
import type { ERC20Token, ERC721Token, ERC1155Token } from './types';

export class TokenDetector {
  constructor(private rpc: RPCClient) {}

  async detectTokenType(contractAddress: string): Promise<{
    isErc20: boolean;
    isErc721: boolean;
    isErc1155: boolean;
  }> {
    try {
      // Check ERC165 support first
      const erc165Supported = await this.supportsInterface(contractAddress, INTERFACE_IDS.ERC165);

      let isErc721 = false;
      let isErc1155 = false;
      let isErc20 = false;

      if (erc165Supported) {
        // Check interfaces via ERC165
        const [erc721Check, erc1155Check] = await Promise.all([
          this.supportsInterface(contractAddress, INTERFACE_IDS.ERC721),
          this.supportsInterface(contractAddress, INTERFACE_IDS.ERC1155),
        ]);

        isErc721 = erc721Check;
        isErc1155 = erc1155Check;
      }

      // ERC20 doesn't have ERC165, check via function signatures
      if (!isErc721 && !isErc1155) {
        isErc20 = await this.isERC20(contractAddress);
      }

      return { isErc20, isErc721, isErc1155 };
    } catch (error) {
      return { isErc20: false, isErc721: false, isErc1155: false };
    }
  }

  private async supportsInterface(contractAddress: string, interfaceId: string): Promise<boolean> {
    try {
      // supportsInterface(bytes4)
      const data = '0x01ffc9a7' + interfaceId.slice(2).padStart(64, '0');
      const result = await this.rpc.call(contractAddress, data);
      return result !== '0x' && parseInt(result, 16) === 1;
    } catch {
      return false;
    }
  }

  private async isERC20(contractAddress: string): Promise<boolean> {
    try {
      // Check if contract has totalSupply, decimals, balanceOf
      const calls = [
        { to: contractAddress, data: ERC20_SIGNATURES.totalSupply },
        { to: contractAddress, data: ERC20_SIGNATURES.decimals },
        { to: contractAddress, data: ERC20_SIGNATURES.balanceOf + '0'.repeat(64) },
      ];

      const results = await this.rpc.callBatch(calls);

      // If all calls return data, likely ERC20
      return results.every(r => r !== '0x' && r.length > 2);
    } catch {
      return false;
    }
  }

  async fetchERC20Metadata(contractAddress: string): Promise<ERC20Token> {
    const [name, symbol, decimals, totalSupply] = await Promise.all([
      this.fetchString(contractAddress, ERC20_SIGNATURES.name),
      this.fetchString(contractAddress, ERC20_SIGNATURES.symbol),
      this.fetchUint(contractAddress, ERC20_SIGNATURES.decimals),
      this.fetchUint(contractAddress, ERC20_SIGNATURES.totalSupply),
    ]);

    // Validate decimals - must be reasonable (0-255)
    let validDecimals: number | null = null;
    if (decimals !== null) {
      const decNum = Number(decimals);
      if (decNum >= 0 && decNum <= 255 && Number.isInteger(decNum)) {
        validDecimals = decNum;
      }
    }

    return {
      address: contractAddress,
      name,
      symbol,
      decimals: validDecimals,
      totalSupply: totalSupply !== null ? totalSupply.toString() : null,
    };
  }

  async fetchERC721Metadata(contractAddress: string): Promise<ERC721Token> {
    const [name, symbol, totalSupply] = await Promise.all([
      this.fetchString(contractAddress, ERC721_SIGNATURES.name),
      this.fetchString(contractAddress, ERC721_SIGNATURES.symbol),
      this.fetchUint(contractAddress, ERC20_SIGNATURES.totalSupply), // Some ERC721 have totalSupply
    ]);

    return {
      address: contractAddress,
      name,
      symbol,
      totalSupply: totalSupply !== null ? totalSupply.toString() : null,
    };
  }

  async fetchERC1155Metadata(contractAddress: string): Promise<ERC1155Token> {
    // URI function with token ID 0
    const uri = await this.fetchString(contractAddress, ERC1155_SIGNATURES.uri + '0'.repeat(64));

    return {
      address: contractAddress,
      uri,
    };
  }

  private async fetchString(contractAddress: string, functionSig: string): Promise<string | null> {
    try {
      const result = await this.rpc.call(contractAddress, functionSig);
      if (!result || result === '0x') return null;

      // Decode string from ABI encoding
      const data = result.slice(2);
      if (data.length < 128) return null;

      // String offset is at position 0 (32 bytes)
      // String length is at position 1 (32 bytes)
      const lengthHex = data.slice(64, 128);
      const length = parseInt(lengthHex, 16);

      if (length === 0 || length > 1000) return null;

      // String data starts at position 2
      const stringHex = data.slice(128, 128 + length * 2);
      const decoded = Buffer.from(stringHex, 'hex').toString('utf8');

      // Clean up any null bytes
      return decoded.replace(/\0/g, '').trim() || null;
    } catch {
      return null;
    }
  }

  private async fetchUint(contractAddress: string, functionSig: string): Promise<bigint | null> {
    try {
      const result = await this.rpc.call(contractAddress, functionSig);
      if (!result || result === '0x') return null;

      return BigInt(result);
    } catch {
      return null;
    }
  }

  async batchDetectTokens(
    contractAddresses: string[]
  ): Promise<
    Map<
      string,
      {
        isErc20: boolean;
        isErc721: boolean;
        isErc1155: boolean;
        metadata?: ERC20Token | ERC721Token | ERC1155Token;
      }
    >
  > {
    const results = new Map();

    // Process in chunks to avoid overwhelming RPC and memory
    const chunkSize = 3;  // Reduced from 10 to prevent memory buildup
    for (let i = 0; i < contractAddresses.length; i += chunkSize) {
      const chunk = contractAddresses.slice(i, i + chunkSize);

      await Promise.all(
        chunk.map(async (address) => {
          try {
            const types = await this.detectTokenType(address);
            let metadata;

            if (types.isErc20) {
              metadata = await this.fetchERC20Metadata(address);
            } else if (types.isErc721) {
              metadata = await this.fetchERC721Metadata(address);
            } else if (types.isErc1155) {
              metadata = await this.fetchERC1155Metadata(address);
            }

            results.set(address, { ...types, metadata });
          } catch (error) {
            results.set(address, {
              isErc20: false,
              isErc721: false,
              isErc1155: false,
            });
          }
        })
      );
    }

    return results;
  }
}
