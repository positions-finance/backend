import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { User } from "./User";

@Entity("relayer_events")
export class RelayerEvent {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "block_number", type: "integer", nullable: true })
  blockNumber: number;

  @Column({ name: "transaction_hash", length: 66, nullable: true })
  @Index()
  transactionHash: string;

  @Column({ name: "process_transaction_hash", length: 66, nullable: true })
  @Index()
  processTransactionHash: string;

  @Column({ name: "request_id", length: 66 })
  @Index()
  requestId: string;

  @Column({ name: "token_id", type: "integer", nullable: true })
  tokenId: number;

  @Column({ name: "protocol", length: 42, nullable: true })
  protocol: string;

  @Column({ name: "asset", length: 42, nullable: true })
  asset: string;

  @Column({ name: "sender", length: 42, nullable: true })
  @Index()
  sender: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: "sender", referencedColumnName: "walletAddress" })
  user: User;

  @Column({ name: "amount", type: "varchar", length: 78, nullable: true })
  amount: string;

  @Column({ name: "deadline", type: "bigint", nullable: true })
  deadline: number;

  @Column({ name: "data", type: "text", nullable: true })
  data: string;

  @Column({ name: "signature", type: "text", nullable: true })
  signature: string;

  @Column({ name: "status", type: "integer", default: 1 })
  status: number;

  @Column({ name: "error_data", type: "text", nullable: true })
  errorData: string;

  @Column({ name: "chain_id", type: "integer", nullable: true })
  chainId: number;

  @Column({
    name: "type",
    type: "enum",
    enum: ["collateral_request", "collateral_process"],
  })
  type: string;

  @Column({ name: "timestamp", type: "timestamp", nullable: true })
  timestamp: Date;

  @Column({ name: "log_index", type: "integer", nullable: true })
  logIndex: number;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
