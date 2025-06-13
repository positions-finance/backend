import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  OneToOne,
  Index,
} from "typeorm";
import { Deposit } from "./Deposit";
import { Withdrawal } from "./Withdrawal";
import { Borrow } from "./Borrow";
import { PocNft } from "./PocNft";

@Entity("users")
export class User {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "wallet_address", length: 42, unique: true })
  @Index()
  walletAddress: string;

  @Column({
    name: "total_usd_balance",
    type: "decimal",
    precision: 24,
    scale: 8,
    default: 0,
  })
  totalUsdBalance: number;

  @Column({
    name: "floating_usd_balance",
    type: "decimal",
    precision: 24,
    scale: 8,
    default: 0,
  })
  floatingUsdBalance: number;

  @Column({
    name: "borrowed_usd_amount",
    type: "decimal",
    precision: 24,
    scale: 8,
    default: 0,
  })
  borrowedUsdAmount: number;

  @OneToMany(() => Deposit, (deposit) => deposit.user)
  deposits: Deposit[];

  @OneToMany(() => Withdrawal, (withdrawal) => withdrawal.user)
  withdrawals: Withdrawal[];

  @OneToMany(() => Borrow, (borrow) => borrow.user)
  borrows: Borrow[];

  @OneToOne(() => PocNft, (pocNft) => pocNft.user)
  pocNft: PocNft;

  @Column({ name: "log_index", type: "integer", nullable: true })
  logIndex: number;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
