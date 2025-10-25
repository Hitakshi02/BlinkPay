import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development','test','production']).default('development'),
  PORT: z.string().default('4000'),
  RPC_URL: z.string().min(1, 'RPC_URL required'),
  PRIVATE_KEY: z.string().min(1, 'PRIVATE_KEY required'),
  SESSION_VAULT: z.string().min(1, 'SESSION_VAULT address required'),
  MERCHANT_ADDRESS: z.string().min(1, 'MERCHANT_ADDRESS required')
});

export const ENV = EnvSchema.parse(process.env);
