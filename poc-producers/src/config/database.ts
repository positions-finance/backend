import { DataSource } from "typeorm";
import config from "./env";
import { ProcessedBlock } from "../entities/processed-blocks.entity";
import { UnprocessedBlock } from "../entities/UnprocessedBlock.entity";

export const AppDataSource = new DataSource({
  type: "postgres",
  host: config.database.host,
  port: config.database.port,
  username: config.database.username,
  password: config.database.password,
  database: config.database.name,
  synchronize: true,
  logging: config.database.logging,
  entities: [ProcessedBlock, UnprocessedBlock],
  migrations: [
    process.env.NODE_ENV === "production"
      ? "dist/migrations/*.js"
      : "src/migrations/*.ts",
  ],
  subscribers: [],
  ssl: {
    rejectUnauthorized: false,
  },
});

export const initializeDatabase = async () => {
  try {
    await AppDataSource.initialize();
    console.log("Database connection initialized successfully");
  } catch (error) {
    console.error("Error initializing database connection:", error);
    throw error;
  }
};
