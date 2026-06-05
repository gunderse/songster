import { musicDir } from "../config.js";
import { initializeDatabase } from "../db.js";
import { scanLibrary } from "../library/scan.js";
import { logger } from "../logger.js";

const db = initializeDatabase();
try {
  logger.info({ musicDir }, "scanning music library");
  const summary = await scanLibrary(db, { musicDir });
  logger.info(summary, "library scan complete");
} finally {
  db.close();
}
