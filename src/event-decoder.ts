import { Interface, AbiCoder } from 'ethers';
import type { Log } from './types';
import { PLATFORM_EVENTS } from './platform-events';
import { UNISWAP_EVENTS } from './uniswap-events';
import { Pool } from 'pg';

// Common event signatures
export const EVENT_SIGNATURES: Record<string, EventSignature> = {
  // Platform-specific events (Naddotfun, Kuru, etc.)
  ...PLATFORM_EVENTS,
  // Uniswap V2/V3/V4 events
  ...UNISWAP_EVENTS,
  // ERC20 Events
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef': {
    name: 'Transfer',
    signature: 'Transfer(address,address,uint256)',
    standard: 'ERC20/ERC721',
    params: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
  '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925': {
    name: 'Approval',
    signature: 'Approval(address,address,uint256)',
    standard: 'ERC20/ERC721',
    params: [
      { name: 'owner', type: 'address', indexed: true },
      { name: 'spender', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },

  // ERC721 Events
  '0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31': {
    name: 'ApprovalForAll',
    signature: 'ApprovalForAll(address,address,bool)',
    standard: 'ERC721/ERC1155',
    params: [
      { name: 'owner', type: 'address', indexed: true },
      { name: 'operator', type: 'address', indexed: true },
      { name: 'approved', type: 'bool', indexed: false },
    ],
  },

  // ERC1155 Events
  '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62': {
    name: 'TransferSingle',
    signature: 'TransferSingle(address,address,address,uint256,uint256)',
    standard: 'ERC1155',
    params: [
      { name: 'operator', type: 'address', indexed: true },
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'id', type: 'uint256', indexed: false },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
  '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb': {
    name: 'TransferBatch',
    signature: 'TransferBatch(address,address,address,uint256[],uint256[])',
    standard: 'ERC1155',
    params: [
      { name: 'operator', type: 'address', indexed: true },
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'ids', type: 'uint256[]', indexed: false },
      { name: 'values', type: 'uint256[]', indexed: false },
    ],
  },
  '0x6bb7ff708619ba0610cba295a58592e0451dee2622938c8755667688daf3529b': {
    name: 'URI',
    signature: 'URI(string,uint256)',
    standard: 'ERC1155',
    params: [
      { name: 'value', type: 'string', indexed: false },
      { name: 'id', type: 'uint256', indexed: true },
    ],
  },

  // Ownership Events
  '0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0': {
    name: 'OwnershipTransferred',
    signature: 'OwnershipTransferred(address,address)',
    standard: 'Ownable',
    params: [
      { name: 'previousOwner', type: 'address', indexed: true },
      { name: 'newOwner', type: 'address', indexed: true },
    ],
  },

  // Pause Events
  '0x62e78cea01bee320cd4e420270b5ea74000d11b0c9f74754ebdbfc544b05a258': {
    name: 'Paused',
    signature: 'Paused(address)',
    standard: 'Pausable',
    params: [
      { name: 'account', type: 'address', indexed: false },
    ],
  },
  '0x5db9ee0a495bf2e6ff9c91a7834c1ba4fdd244a5e8aa4e537bd38aeae4b073aa': {
    name: 'Unpaused',
    signature: 'Unpaused(address)',
    standard: 'Pausable',
    params: [
      { name: 'account', type: 'address', indexed: false },
    ],
  },

  // Role Events (AccessControl)
  '0x2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d': {
    name: 'RoleGranted',
    signature: 'RoleGranted(bytes32,address,address)',
    standard: 'AccessControl',
    params: [
      { name: 'role', type: 'bytes32', indexed: true },
      { name: 'account', type: 'address', indexed: true },
      { name: 'sender', type: 'address', indexed: true },
    ],
  },
  '0xf6391f5c32d9c69d2a47ea670b442974b53935d1edc7fd64eb21e047a839171b': {
    name: 'RoleRevoked',
    signature: 'RoleRevoked(bytes32,address,address)',
    standard: 'AccessControl',
    params: [
      { name: 'role', type: 'bytes32', indexed: true },
      { name: 'account', type: 'address', indexed: true },
      { name: 'sender', type: 'address', indexed: true },
    ],
  },
};

export interface EventSignature {
  name: string;
  signature: string;
  standard: string;
  params: Array<{
    name: string;
    type: string;
    indexed: boolean;
  }>;
}

export interface DecodedEvent {
  eventName: string;
  eventSignature: string;
  standard: string;
  params: Record<string, any>;
}

export class EventDecoder {
  private abiCoder: AbiCoder;
  private dbSignaturesLoaded: boolean = false;

  constructor() {
    this.abiCoder = AbiCoder.defaultAbiCoder();
  }

  // Load event signatures from database table
  async loadFromDatabase(pool: Pool): Promise<number> {
    try {
      const result = await pool.query(`
        SELECT selector, name, signature, inputs
        FROM function_signatures
        WHERE type = 'event'
      `);

      let loaded = 0;
      for (const row of result.rows) {
        // Skip if already exists (hardcoded takes priority)
        if (EVENT_SIGNATURES[row.selector]) {
          continue;
        }

        // Parse inputs to build params array
        let params: Array<{ name: string; type: string; indexed: boolean }> = [];
        try {
          const inputs = JSON.parse(row.inputs || '[]');
          params = inputs.map((input: any) => ({
            name: input.name || 'param',
            type: input.type || 'bytes32',
            indexed: input.indexed || false,
          }));
        } catch {
          // If parsing fails, create empty params (will only show name/signature)
          params = [];
        }

        EVENT_SIGNATURES[row.selector] = {
          name: row.name,
          signature: row.signature,
          standard: 'Database',
          params,
        };
        loaded++;
      }

      this.dbSignaturesLoaded = true;
      return loaded;
    } catch (error) {
      console.error('Failed to load signatures from database:', error);
      return 0;
    }
  }

  // Check if database signatures are loaded
  isDbLoaded(): boolean {
    return this.dbSignaturesLoaded;
  }

  // Get total number of signatures
  getSignatureCount(): number {
    return Object.keys(EVENT_SIGNATURES).length;
  }

  decodeLog(log: Log): DecodedEvent | null {
    const topic0 = log.topics[0];
    if (!topic0) return null;

    const eventSig = EVENT_SIGNATURES[topic0];
    if (!eventSig) return null;

    try {
      const params: Record<string, any> = {};
      let topicIndex = 1; // topic0 is the event signature
      let dataOffset = 0;

      // Decode indexed parameters from topics
      // Decode non-indexed parameters from data
      for (const param of eventSig.params) {
        if (param.indexed) {
          if (topicIndex < log.topics.length) {
            params[param.name] = this.decodeIndexedParam(
              log.topics[topicIndex],
              param.type
            );
            topicIndex++;
          }
        }
      }

      // Decode non-indexed parameters from data
      const nonIndexedParams = eventSig.params.filter(p => !p.indexed);
      if (nonIndexedParams.length > 0 && log.data && log.data !== '0x') {
        const types = nonIndexedParams.map(p => p.type);
        try {
          const decoded = this.abiCoder.decode(types, log.data);
          nonIndexedParams.forEach((param, i) => {
            params[param.name] = this.formatValue(decoded[i], param.type);
          });
        } catch (error) {
          // If decoding fails, store raw data
          params['_rawData'] = log.data;
        }
      }

      return {
        eventName: eventSig.name,
        eventSignature: eventSig.signature,
        standard: eventSig.standard,
        params,
      };
    } catch (error) {
      console.error('Error decoding log:', error);
      return null;
    }
  }

  private decodeIndexedParam(topic: string, type: string): any {
    try {
      if (type === 'address') {
        return '0x' + topic.slice(-40);
      } else if (type === 'string' || type === 'bytes') {
        // For indexed strings/bytes, the topic is the hash
        return topic;
      } else if (type.startsWith('uint') || type.startsWith('int')) {
        return BigInt(topic).toString();
      } else if (type === 'bool') {
        return BigInt(topic) === 1n;
      } else if (type === 'bytes32') {
        return topic;
      }
      return topic;
    } catch {
      return topic;
    }
  }

  private formatValue(value: any, type: string): any {
    if (typeof value === 'bigint') {
      return value.toString();
    } else if (Array.isArray(value)) {
      return value.map(v => this.formatValue(v, type));
    } else if (typeof value === 'object' && value !== null) {
      // Handle struct-like objects
      const formatted: Record<string, any> = {};
      for (const key in value) {
        formatted[key] = this.formatValue(value[key], 'unknown');
      }
      return formatted;
    }
    return value;
  }

  getEventCategory(topic0: string): string {
    const eventSig = EVENT_SIGNATURES[topic0];
    return eventSig?.standard || 'Unknown';
  }

  getEventName(topic0: string): string {
    const eventSig = EVENT_SIGNATURES[topic0];
    return eventSig?.name || 'Unknown';
  }

  // Add custom event signature
  addEventSignature(topic0: string, signature: EventSignature): void {
    EVENT_SIGNATURES[topic0] = signature;
  }

  // Check if event is known
  isKnownEvent(topic0: string): boolean {
    return topic0 in EVENT_SIGNATURES;
  }
}
