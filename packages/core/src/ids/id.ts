import { v7 as uuidv7, validate } from 'uuid';
import { z } from 'zod';

/**
 * Every record gets a UUID v7 generated on the device that creates it.
 * Time-ordered ids keep inserts cheap on the server and let an offline phone
 * create a sale with a stable id that survives sync and retries.
 */
export type Id = string;
export const idSchema = z.string().refine(validate, { message: 'Expected a UUID' });

export function newId(): Id {
  return uuidv7();
}
