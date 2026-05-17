import path from 'path';
import fs   from 'fs';
import { createLogger, format, transports, Logger } from 'winston';
const LOG_DIR: string = path.join(process.cwd(), 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
const isProduction: boolean = process.env.NODE_ENV === 'production';
const logger: Logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    format.json()
  ),
  defaultMeta: { service: 'vehicle-image-processor' },
  transports: [
    new transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level:    'error',
      maxsize:  5 * 1024 * 1024,
      maxFiles: 3,
    }),
    new transports.File({
      filename: path.join(LOG_DIR, 'combined.log'),
      maxsize:  10 * 1024 * 1024,
      maxFiles: 5,
    }),
  ],
});
if (!isProduction) {
  logger.add(
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.printf(({ timestamp, level, message, ...meta }) => {
          const extra = Object.keys(meta).length
            ? ' ' + JSON.stringify(meta)
            : '';
          return `[${timestamp as string}] ${level}: ${message as string}${extra}`;
        })
      ),
    })
  );
}
export default logger;
