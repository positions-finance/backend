export interface IRelayerEvent {
  block_number: number;
  timestamp: Date;
  transaction_hash: string;
  process_transaction_hash?: string;
  requestId: string;
  token_id: number;
  protocol: string;
  asset: string;
  sender: string;
  amount: number;
  deadline: number;
  data: string;
  signature: string;
  status: number;
  errorData?: string;
  chainId: number;
  type: "collateral_request" | "collateral_process";
}
