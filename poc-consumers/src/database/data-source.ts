import "reflect-metadata";
import { DataSource } from "typeorm";
import env from "@/config/env";

const sslConfig = env.DB.SSL
  ? {
      ssl: {
        rejectUnauthorized: false,
      },
      extra: {
        ssl: {
          rejectUnauthorized: false,
        },
      },
    }
  : {};

// Determine if we're running from compiled code or source
const isCompiledCode = __filename.includes("dist");
const entityPath = isCompiledCode
  ? "dist/models/**/*.js"
  : "src/models/**/*.ts";
const migrationPath = isCompiledCode
  ? "dist/database/migrations/**/*.js"
  : "src/database/migrations/**/*.ts";
const subscriberPath = isCompiledCode
  ? "dist/database/subscribers/**/*.js"
  : "src/database/subscribers/**/*.ts";

export const AppDataSource = new DataSource({
  type: "postgres",
  host: env.DB.HOST,
  port: env.DB.PORT,
  username: env.DB.USERNAME,
  password: env.DB.PASSWORD,
  database: env.DB.NAME,
  logging: env.DB.LOGGING,
  synchronize: true,
  entities: [entityPath],
  migrations: [migrationPath],
  subscribers: [subscriberPath],
  ...sslConfig,
});

export const initializeDatabase = async (): Promise<DataSource> => {
  try {
    if (!AppDataSource.isInitialized) {
      return await AppDataSource.initialize();
    }
    return AppDataSource;
  } catch (error) {
    console.error("Error initializing database:", error);
    throw error;
  }
};

export default AppDataSource;
