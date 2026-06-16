import "dotenv/config";
import { migrate } from "drizzle-orm/libsql/migrator";
import { createDb } from "./client.js";

await migrate(createDb(), { migrationsFolder: "./drizzle" });
console.log("migrations applied");
