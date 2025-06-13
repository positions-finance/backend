import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { User } from "./User";

@Entity("vault_events")
export class VaultEvent {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "block_number" })
  blockNumber: number;

  @Column({ name: "transaction_hash", length: 66 })
  @Index()
  transactionHash: string;

  @Column({ name: "sender", length: 42 })
  @Index()
  sender: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: "sender", referencedColumnName: "walletAddress" })
  user: User;

  @Column({ name: "asset", length: 42 })
  asset: string;

  @Column({ name: "vault", length: 42 })
  vault: string;

  @Column({ name: "chain_id" })
  chainId: number;

  @Column({
    name: "amount",
    type: "varchar",
    length: 78,
  })
  amount: string;

  @Column({ name: "token_id", nullable: true })
  tokenId: number;

  @Column({ name: "request_id", length: 66, nullable: true })
  @Index()
  requestId: string;

  @Column({
    name: "type",
    type: "enum",
    enum: ["deposit", "withdraw_request", "withdraw"],
  })
  type: string;

  @Column({ name: "usd_value", type: "decimal", precision: 24, scale: 8 })
  usdValue: number;

  @Column({ name: "timestamp", type: "timestamp" })
  timestamp: Date;

  @Column({ name: "log_index", type: "integer", nullable: true })
  logIndex: number;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
