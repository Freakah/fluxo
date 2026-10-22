// Prints a new random 32-byte key for DATA_ENCRYPTION_KEY.
import { randomBytes } from 'node:crypto';

console.log(randomBytes(32).toString('base64'));
