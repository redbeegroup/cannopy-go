import type { Db } from '../db/client.js';

/**
 * A database handle for service functions: the pool-backed database for
 * reads, or a transaction for anything that writes. Writes always run inside
 * `db.transaction` so a failed posting leaves nothing half done.
 */
export type Tx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];
