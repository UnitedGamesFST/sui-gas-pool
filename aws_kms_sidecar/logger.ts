import pinoImport from "pino";
import prettyImport from "pino-pretty";

// Handle ESM/CJS interop
const pino = (pinoImport as any).default ?? pinoImport;
const pinoPretty = (prettyImport as any).default ?? prettyImport;

const logger = pino(
  {
    level: process.env.LOG_LEVEL || "info",
    redact: {
      paths: [
        "req.headers.authorization",
        "AWS_SECRET_ACCESS_KEY",
        "AWS_ACCESS_KEY_ID",
      ],
      censor: "[REDACTED]",
    },
  },
  pinoPretty({ colorize: true, translateTime: "HH:MM:ss" }),
);

export default logger; 