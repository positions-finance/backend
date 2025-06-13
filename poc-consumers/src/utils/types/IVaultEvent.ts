export interface IVaultEvent {
  block_number: number;
  timestamp: Date;
  transaction_hash: string;
  sender: string;
  asset: string;
  vault: string;
  chainId: number;
  amount: number;
  token_id?: number;
  requestId?: string;
  type: "deposit" | "withdraw_request" | "withdraw";
}
