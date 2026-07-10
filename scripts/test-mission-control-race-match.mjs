import assert from 'node:assert/strict';
import {
  evaluateAutomaticTask,
  getWorkflowNextRaceRef,
  matchesRaceContext,
} from '../api/_mission-control-task-engine.js';

const scheduleRace15 = {
  raceNumber: 17,
  officialPointsRaceNumber: 15,
  scheduleRow: 17,
  track: 'Pocono Raceway',
  date: 'Jul 13, 2025',
};

const workflowCtx = {
  nextRace: {
    raceNumber: 15,
    track: 'Pocono Raceway',
    date: 'Jul 13, 2025',
    race: scheduleRace15,
    raceSource: 'workflow',
  },
  newsArticles: [
    {
      id: 101,
      article_type: 'weekend-preview',
      headline: 'Pocono Raceway Hosts Crucial Showdown in Blazing Pedals Truck Series',
      summary: '',
      race_number: 15,
      published: true,
      published_at: '2025-07-10T18:00:00.000Z',
    },
    {
      id: 202,
      article_type: 'weekend-preview',
      headline: 'Future Race 17 Preview',
      summary: '',
      race_number: 17,
      published: true,
      published_at: '2025-08-01T18:00:00.000Z',
    },
  ],
};

const workflowRace = getWorkflowNextRaceRef(workflowCtx);
assert.equal(workflowRace.raceNumber, 15, 'workflow race must stay on official points race 15');
assert.equal(workflowRace.raceSource, 'workflow');

const raceMatch = matchesRaceContext(workflowCtx.newsArticles[0], workflowRace);
assert.equal(raceMatch.matched, true);
assert.equal(raceMatch.targetRace, 15);

const outlook = evaluateAutomaticTask('fri-post-weekend-outlook', workflowCtx);
assert.equal(outlook.complete, true, 'Race 15 weekend preview should complete Race 15 outlook task');
assert.match(outlook.reason, /Race 15/i);
assert.equal(outlook.reason.includes('Race 17'), false);
assert.equal(outlook.diagnostics?.workflowRaceNumber, 15);
assert.equal(outlook.diagnostics?.evaluatorRaceNumber, 15);
assert.equal(outlook.diagnostics?.matchedArticleRaceNumber, 15);
assert.equal(outlook.diagnostics?.matchedArticleType, 'weekend-preview');

const spotlight = evaluateAutomaticTask('thu-publish-driver-spotlight', {
  ...workflowCtx,
  newsArticles: [
    {
      id: 303,
      article_type: 'driver-spotlight',
      headline: 'Driver Spotlight: Sample Driver',
      race_number: 15,
      published: true,
      published_at: '2025-07-09T18:00:00.000Z',
    },
  ],
});
assert.equal(spotlight.complete, true);
assert.match(spotlight.reason, /Race 15/i);

const futureArticleOnly = evaluateAutomaticTask('fri-post-weekend-outlook', {
  ...workflowCtx,
  newsArticles: [workflowCtx.newsArticles[1]],
});
assert.equal(futureArticleOnly.complete, false);
assert.match(futureArticleOnly.reason, /Race 15/i);
assert.equal(futureArticleOnly.reason.includes('Race 17 week'), false);

console.log('mission-control-race-match: all scenarios passed');
