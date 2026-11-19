/**
 * Simple logger utility
 */

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL || 'info'];

export const logger = {
  error: (msg, ...args) => {
    if (currentLevel >= LOG_LEVELS.error) {
      console.error(`[ERROR] ${msg}`, ...args);
    }
  },
  
  warn: (msg, ...args) => {
    if (currentLevel >= LOG_LEVELS.warn) {
      console.warn(`[WARN] ${msg}`, ...args);
    }
  },
  
  info: (msg, ...args) => {
    if (currentLevel >= LOG_LEVELS.info) {
      console.log(`[INFO] ${msg}`, ...args);
    }
  },
  
  debug: (msg, ...args) => {
    if (currentLevel >= LOG_LEVELS.debug) {
      console.log(`[DEBUG] ${msg}`, ...args);
    }
  }
};