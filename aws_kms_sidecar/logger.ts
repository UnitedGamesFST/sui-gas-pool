import pinoImport from "pino";
const pino = (pinoImport as any).default ?? pinoImport;

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: {
    paths: ["req.headers.authorization", "AWS_SECRET_ACCESS_KEY", "AWS_ACCESS_KEY_ID"],
    censor: "[REDACTED]",
  },
});

export default logger; 