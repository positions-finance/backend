import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

@Entity("nft_transfers")
export class NftTransfer {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "chain_id", type: "integer" })
  @Index()
  chainId: number;

  @Column({ name: "chain_name", length: 50 })
  chainName: string;

  @Column({ name: "transaction_hash", length: 66 })
  @Index()
  transactionHash: string;

  @Column({ name: "block_number", type: "integer" })
  @Index()
  blockNumber: number;

  @Column({ name: "block_hash", length: 66 })
  blockHash: string;

  @Column({ name: "token_address", length: 42 })
  @Index()
  tokenAddress: string;

  @Column({ name: "token_id", type: "varchar" })
  @Index()
  tokenId: string;

  @Column({ name: "from_address", length: 42 })
  @Index()
  fromAddress: string;

  @Column({ name: "to_address", length: 42 })
  @Index()
  toAddress: string;

  @Column({ name: "transaction_timestamp", type: "bigint" })
  transactionTimestamp: number;

  @Column({ name: "included_in_merkle", type: "boolean", default: false })
  includedInMerkle: boolean;

  @Column({ name: "merkle_root", length: 66, nullable: true })
  merkleRoot: string;

  @Column({ name: "log_index", type: "integer", nullable: true })
  logIndex: number;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
