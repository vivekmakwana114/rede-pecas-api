import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

const requiredEnvVars = [
  'DATABASE_URL',
  'ANTHROPIC_API_KEY',
  'WHATSAPP_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_VERIFY_TOKEN',
  'JWT_SECRET'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Config validation error: environment variable ${envVar} is missing.`);
  }
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),
  appUrl: process.env.APP_URL || 'http://localhost:4000',
  db: {
    url: process.env.DATABASE_URL
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379'
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY
  },
  claudeMessage: {
    enabled: process.env.CLAUDE_MESSAGE_ENABLED === 'true'
  },
  whatsapp: {
    token: process.env.WHATSAPP_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
    graphApiUrl: process.env.WHATSAPP_GRAPH_API_URL || 'https://graph.facebook.com/v19.0'
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    accessExpirationMinutes: parseInt(process.env.JWT_ACCESS_EXPIRATION_MINUTES || '60', 10),
    refreshExpirationDays: parseInt(process.env.JWT_REFRESH_EXPIRATION_DAYS || '30', 10)
  },
  nhtsa: {
    apiUrl: process.env.NHTSA_API_URL || 'https://vpic.nhtsa.dot.gov/api/vehicles/decodevin'
  }
};
