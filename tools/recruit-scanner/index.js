import { createScannerService } from './scanner-service.js';

const scanner = createScannerService();

async function shutdown() {
  await scanner.shutdown();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown();
});

process.on('SIGTERM', () => {
  void shutdown();
});

scanner
  .start({ prepareSession: true, blockingLogin: true })
  .catch(async (err) => {
    scanner.error(`Scanner failed to start: ${err.message}`);
    await scanner.shutdown();
    process.exit(1);
  });
