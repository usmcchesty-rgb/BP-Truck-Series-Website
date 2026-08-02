/**
 * Race research package diagnostics (no article generation).
 *
 * Usage:
 *   npm run diagnose:race15-research-package -- --status
 *   npm run diagnose:race15-research-package -- 15 --sync
 *   npm run diagnose:race15-research-package -- --compare-extractors --allow-ai
 */
import { parseDiagnoseArgs, runDiagnoseModes } from '../api/_race-research-diagnose.js';

const parsed = parseDiagnoseArgs(process.argv);

try {
  const result = await runDiagnoseModes(parsed);
  if (parsed.modes.has('quality') || parsed.modes.has('full')) {
    for (const r of result.results || []) {
      if (r.report) {
        console.log('\n' + r.report + '\n');
      }
    }
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({ error: error.message }, null, 2));
  process.exit(1);
}
