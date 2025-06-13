import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { User } from "./User";

@Entity("poc_nfts")
export class PocNft {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "token_id", type: "varchar" })
  @Index()
  tokenId: string;

  @Column({ name: "token_address", length: 42 })
  @Index()
  tokenAddress: string;

  @Column({ name: "chain_id", type: "integer" })
  chainId: number;

  @Column({ name: "chain_name", length: 50 })
  chainName: string;

  @Column({ name: "metadata", type: "jsonb", nullable: true })
  metadata: Record<string, any>;

  @Column({ name: "acquisition_date", type: "timestamp", nullable: true })
  acquisitionDate: Date;

  @OneToOne(() => User, (user) => user.pocNft)
  @JoinColumn({ name: "user_id" })
  user: User;

  @Column({ name: "log_index", type: "integer", nullable: true })
  logIndex: number;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
