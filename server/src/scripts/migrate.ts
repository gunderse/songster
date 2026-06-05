import { getDatabasePath, initializeDatabase } from "../db.js";
import { logger } from "../logger.js";

const db = initializeDatabase();
logger.info({ databasePath: getDatabasePath() }, "migrations applied");
db.close();
