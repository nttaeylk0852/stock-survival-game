import { initDb, runMigrations, ensureSystemAccounts } from './index';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const dbPath = process.env.DB_PATH ?? './data/game.db';
initDb(dbPath);
runMigrations();
ensureSystemAccounts();

console.log(`Database migrated at ${dbPath}`);
