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

@Entity("borrows")
export class Borrow {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({
    name: "borrowed_usd_amount",
    type: "decimal",
    precision: 24,
    scale: 8,
  })
  borrowedUsdAmount: number;

  @Column({
    name: "collateral_ratio",
    type: "decimal",
    precision: 10,
    scale: 2,
  })
  collateralRatio: number;

  @Column({ name: "interest_rate", type: "decimal", precision: 10, scale: 4 })
  interestRate: number;

  @Column({ name: "loan_start_date", type: "timestamp" })
  loanStartDate: Date;

  @Column({ name: "loan_end_date", type: "timestamp", nullable: true })
  loanEndDate: Date;

  @Column({ name: "status", default: "active" })
  status: string;

  @Column({ name: "token_sent_address", length: 42, nullable: true })
  tokenSentAddress: string;

  @Column({ name: "token_symbol", length: 20, nullable: true })
  tokenSymbol: string;

  @Column({ name: "token_amount", type: "varchar", length: 78, nullable: true })
  tokenAmount: string;

  @Column({
    name: "repayment_amount",
    type: "decimal",
    precision: 24,
    scale: 8,
    nullable: true,
  })
  repaymentAmount: number;

  @Column({ name: "transaction_hash", length: 66, nullable: true })
  @Index()
  transactionHash: string;

  @ManyToOne(() => User, (user) => user.borrows)
  @JoinColumn({ name: "user_id" })
  user: User;

  @Column({ name: "log_index", type: "integer", nullable: true })
  logIndex: number;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
