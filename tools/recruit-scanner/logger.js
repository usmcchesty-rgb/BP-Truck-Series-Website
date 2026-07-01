const defaultLogger = {
  log: (message) => console.log(message),
  error: (message) => console.error(message),
};

let activeLogger = defaultLogger;

export function setLogger(logger = {}) {
  activeLogger = {
    log: logger.log || defaultLogger.log,
    error: logger.error || defaultLogger.error,
  };
}

export function resetLogger() {
  activeLogger = defaultLogger;
}

export function logMessage(message) {
  activeLogger.log(String(message));
}

export function logError(message) {
  activeLogger.error(String(message));
}
