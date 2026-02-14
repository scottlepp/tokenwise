import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL ?? "postgresql://claude:claude@localhost:5432/claude_proxy";

const client = postgres(connectionString);
export const db = drizzle(client, { schema });
