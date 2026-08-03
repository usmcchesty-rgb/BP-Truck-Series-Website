import {
  ARTICLE_DEPTH_WORD_RANGES,
  normalizeArticleDepth,
} from '../server/config/race-research-config.js';
import { NEWS_WRITER_PLANNER_VERSION } from './_news-writer-config.js';

function storyById(plan, storyId) {
  return (plan.stories || []).find((s) => s.storyId === storyId && !s.empty);
}

function sectionTemplate(depth, storyPlan) {
  const sections = [
    { sectionId: 'introduction', sectionType: 'introduction', title: 'Introduction', storyIds: ['lead_story'], required: true },
    { sectionId: 'race_summary', sectionType: 'race_summary', title: 'Race Summary', storyIds: ['lead_story', 'secondary_story'], required: true },
  ];

  if (depth !== 'short') {
    sections.push({
      sectionId: 'battle_for_win',
      sectionType: 'battle_for_win',
      title: 'Battle for the Win',
      storyIds: ['secondary_story', 'lead_story'],
      required: false,
    });
  }

  if (storyById(storyPlan, 'strategy_story')) {
    sections.push({
      sectionId: 'strategy',
      sectionType: 'strategy',
      title: 'Strategy',
      storyIds: ['strategy_story', 'technical_story'],
      required: depth === 'in-depth',
    });
  }

  sections.push({
    sectionId: 'key_incidents',
    sectionType: 'key_incidents',
    title: 'Key Incidents',
    storyIds: ['controversy_story', 'secondary_story'],
    required: false,
  });

  if (depth !== 'short') {
    sections.push({
      sectionId: 'driver_stories',
      sectionType: 'driver_stories',
      title: 'Driver Stories',
      storyIds: ['human_story', 'hidden_story', 'feature_story'],
      required: false,
    });
    sections.push({
      sectionId: 'championship_picture',
      sectionType: 'championship_picture',
      title: 'Championship Picture',
      storyIds: ['championship_story', 'momentum_story'],
      required: false,
    });
  }

  if (storyById(storyPlan, 'controversy_story') && depth === 'in-depth') {
    sections.push({
      sectionId: 'controversy',
      sectionType: 'controversy',
      title: 'Controversy',
      storyIds: ['controversy_story'],
      required: false,
    });
  }

  if (depth !== 'short') {
    sections.push({
      sectionId: 'looking_ahead',
      sectionType: 'looking_ahead',
      title: 'Looking Ahead',
      storyIds: ['championship_story', 'momentum_story'],
      required: true,
    });
  }

  return sections;
}

function collectFactIdsForStories(storyPlan, storyIds) {
  const ids = [];
  const drivers = new Set();
  const canonical = new Set();
  for (const sid of storyIds) {
    const story = storyById(storyPlan, sid);
    if (!story) continue;
    for (const fid of story.factIds) ids.push(fid);
    for (const d of story.driverIds) drivers.add(d);
    for (const c of story.canonicalFactIds) canonical.add(c);
  }
  return {
    factIds: [...new Set(ids)],
    driverIds: [...drivers],
    canonicalFactIds: [...canonical],
  };
}

export function buildArticleOutline({ storyPlan, articleType, articleDepth }) {
  const depth = normalizeArticleDepth(articleDepth);
  const wordRange = ARTICLE_DEPTH_WORD_RANGES[depth];
  const templates = sectionTemplate(depth, storyPlan);
  const midWord = Math.round((wordRange.minimum + wordRange.maximum) / 2);
  const perSection = Math.max(80, Math.round(midWord / Math.max(1, templates.length)));

  const sections = templates.map((tpl, index) => {
    const evidence = collectFactIdsForStories(storyPlan, tpl.storyIds);
    const mustMention = (storyPlan.readerTakeaways || [])
      .filter((t) => t.priority <= (depth === 'in-depth' ? 2 : 1))
      .map((t) => t.takeawayId);

    return {
      sectionId: tpl.sectionId,
      sectionType: tpl.sectionType,
      title: tpl.title,
      purpose: `Develop ${tpl.title.toLowerCase()} using verified evidence only.`,
      priority: index + 1,
      targetWords: perSection,
      required: tpl.required,
      evidence: {
        factIds: evidence.factIds,
        quoteIds: [],
        driverIds: evidence.driverIds,
        canonicalFactIds: evidence.canonicalFactIds,
      },
      writingBrief: {
        mustMention,
        mustAvoid: [],
        voice: depth === 'short' ? 'newsroom' : depth === 'in-depth' ? 'feature' : 'newsroom',
        raceTemperaturePrimary: storyPlan.raceTemperature?.primary || 'routine',
      },
    };
  });

  const usedFactIds = new Set(sections.flatMap((s) => s.evidence.factIds));
  const omitted = (storyPlan.stories || [])
    .filter((s) => !s.empty && !s.factIds.some((id) => usedFactIds.has(id)))
    .map((s) => s.storyId);

  return {
    operationId: storyPlan.operationId,
    storyPlanFingerprint: storyPlan.packageFingerprint,
    outlineVersion: NEWS_WRITER_PLANNER_VERSION,
    articleType,
    articleDepth: depth,
    targetWordRange: wordRange,
    totalTargetWords: midWord,
    sections,
    omittedSectionTypes: omitted,
    raceTemperature: storyPlan.raceTemperature,
    readerTakeaways: storyPlan.readerTakeaways,
  };
}
