import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

@Entity("processed_transactions")
export class ProcessedTransaction {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "chain_id", type: "integer" })
  @Index()
  chainId: number;

  @Column({ name: "chain_name", length: 50 })
  chainName: string;

  @Column({ name: "transaction_hash", length: 66, unique: true })
  @Index()
  transactionHash: string;

  @Column({ name: "block_number", type: "integer" })
  @Index()
  blockNumber: number;

  @Column({ name: "block_hash", length: 66 })
  blockHash: string;

  @Column({ name: "sender_address", length: 66 })
  @Index()
  senderAddress: string;

  @Column({ name: "receiver_address", length: 66, nullable: true })
  @Index()
  receiverAddress: string;

  @Column({
    name: "transaction_value",
    type: "varchar",
    length: 78,
    nullable: true,
  })
  transactionValue: string;

  @Column({ name: "transaction_data", type: "text", nullable: true })
  transactionData: string;

  @Column({ name: "matched_topics", type: "simple-array", nullable: true })
  matchedTopics: string[];

  @Column({ name: "transaction_timestamp", type: "bigint" })
  transactionTimestamp: number;

  @Column({ name: "transaction_details", type: "jsonb", nullable: true })
  transactionDetails: Record<string, any>;

  @Column({ name: "processing_status", default: "processed" })
  processingStatus: string;

  @Column({ name: "log_index", type: "integer", nullable: true })
  logIndex: number;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
