import { BlockchainMessage } from "./RedisPublisher";

/**
 * Maps a Ponder event to a BlockchainMessage
 * @param event The Ponder event object
 * @param eventName The name of the event
 * @param contractName The name of the contract
 * @param chainId The chain ID
 * @param chainName The chain name
 * @returns A BlockchainMessage object
 */
export function mapEventToBlockchainMessage(
  event: any,
  eventName: string,
  contractName: string,
  chainId: number,
  chainName: string
): BlockchainMessage {
  const block = event.block;
  const log = event.log;
  const transaction = event.transaction;

  const timestampMs = Number(block.timestamp) * 1000;
  const timestamp = Math.floor(timestampMs / 1000);

  const blockNumber = Number(block.number);

  return {
    transaction: {
      hash: transaction.hash,
      blockNumber: blockNumber,
      chainId,
      chainName,
      from: transaction.from,
      to: transaction.to || undefined,
      value: transaction.value.toString(),
      gasUsed: transaction.gasUsed?.toString(),
      gasPrice: transaction.gasPrice?.toString(),
      status: transaction.status?.toString(),
      logs: [log],
      timestamp,
      blockHash: block.hash,
      data: log.data,
      topics: log.topics,
    },
    events: [
      {
        name: eventName,
        contract: contractName,
        args: event.args,
        address: log.address,
      },
    ],
    timestamp,
    metadata: {
      chainId,
      chainName,
      blockNumber: blockNumber,
      transactionHash: transaction.hash,
      timestamp,
    },
  };
}
