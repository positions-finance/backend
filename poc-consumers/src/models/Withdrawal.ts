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

@Entity("withdrawals")
export class Withdrawal {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "chain_id", type: "integer" })
  @Index()
  chainId: number;

  @Column({ name: "chain_name", length: 50 })
  chainName: string;

  @Column({ name: "transaction_hash", length: 66, nullable: true })
  @Index()
  transactionHash: string;

  @Column({ name: "token_address", length: 42 })
  @Index()
  tokenAddress: string;

  @Column({ name: "token_symbol", length: 20 })
  tokenSymbol: string;

  @Column({ name: "token_decimals", type: "integer" })
  tokenDecimals: number;

  @Column({ name: "amount", type: "varchar", length: 78 })
  amount: string;

  @Column({
    name: "usd_value_at_withdrawal",
    type: "decimal",
    precision: 24,
    scale: 8,
  })
  usdValueAtWithdrawal: number;

  @Column({ name: "block_number", type: "integer", nullable: true })
  blockNumber: number;

  @Column({ name: "status", default: "pending" })
  status: string;

  @Column({ name: "destination_address", length: 42 })
  destinationAddress: string;

  @Column({ name: "request_id", length: 66, nullable: true })
  @Index()
  requestId: string;

  @ManyToOne(() => User, (user) => user.withdrawals)
  @JoinColumn({ name: "user_id" })
  user: User;

  @Column({ name: "log_index", type: "integer", nullable: true })
  logIndex: number;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
