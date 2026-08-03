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
    {
      sectionId: 'introduction',
      sectionType: 'introduction',
      title: 'Introduction',
      storyIds: ['lead_story'],
      required: true,
      baseWeight: 0.09,
    },
    {
      sectionId: 'race_summary',
      sectionType: 'race_summary',
      title: 'Race Summary',
      storyIds: ['lead_story', 'secondary_story'],
      required: true,
      baseWeight: 0.14,
    },
  ];

  if (depth !== 'short') {
    sections.push({
      sectionId: 'battle_for_win',
      sectionType: 'battle_for_win',
      title: 'Battle for the Win',
      storyIds: ['secondary_story', 'lead_story', 'hidden_story'],
      required: false,
      baseWeight: 0.22,
    });
  }

  if (storyById(storyPlan, 'strategy_story')) {
    sections.push({
      sectionId: 'strategy',
      sectionType: 'strategy',
      title: 'Strategy',
      storyIds: ['strategy_story', 'technical_story'],
      required: depth === 'in-depth',
      baseWeight: 0.12,
    });
  }

  sections.push({
    sectionId: 'key_incidents',
    sectionType: 'key_incidents',
    title: 'Key Incidents',
    storyIds: ['controversy_story', 'secondary_story'],
    required: false,
    baseWeight: 0.13,
  });

  if (depth !== 'short') {
    sections.push({
      sectionId: 'driver_stories',
      sectionType: 'driver_stories',
      title: 'Driver Stories',
      storyIds: ['human_story', 'hidden_story', 'feature_story', 'momentum_story'],
      required: false,
      baseWeight: 0.18,
    });
    sections.push({
      sectionId: 'championship_picture',
      sectionType: 'championship_picture',
      title: 'Championship Picture',
      storyIds: ['championship_story', 'momentum_story'],
      required: false,
      baseWeight: 0.14,
    });
  }

  if (storyById(storyPlan, 'controversy_story') && depth === 'in-depth') {
    sections.push({
      sectionId: 'controversy',
      sectionType: 'controversy',
      title: 'Controversy',
      storyIds: ['controversy_story'],
      required: false,
      baseWeight: 0.1,
    });
  }

  if (depth !== 'short') {
    sections.push({
      sectionId: 'looking_ahead',
      sectionType: 'looking_ahead',
      title: 'Looking Ahead',
      storyIds: ['championship_story', 'momentum_story'],
      required: true,
      baseWeight: 0.06,
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

function evidenceWeight(storyPlan, tpl) {
  const evidence = collectFactIdsForStories(storyPlan, tpl.storyIds);
  let w = tpl.baseWeight;
  w += Math.min(0.08, evidence.factIds.length * 0.008);
  if (tpl.sectionId === 'battle_for_win' && storyById(storyPlan, 'lead_story')) w += 0.04;
  if (tpl.sectionId === 'key_incidents') {
    const incidents = (storyPlan.stories || []).flatMap((s) => s.factIds).length;
    w += Math.min(0.06, incidents * 0.002);
  }
  if (tpl.sectionId === 'championship_picture' && storyById(storyPlan, 'championship_story')) {
    w += 0.03;
  }
  return w;
}

function allocateWordTargets(templates, storyPlan, depth) {
  const wordRange = ARTICLE_DEPTH_WORD_RANGES[depth];
  const midWord = Math.round((wordRange.minimum + wordRange.maximum) / 2);
  const weights = templates.map((t) => evidenceWeight(storyPlan, t));
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map((w) => Math.round((w / sum) * midWord));
  const total = raw.reduce((a, b) => a + b, 0);
  const delta = midWord - total;
  if (raw.length && delta !== 0) raw[0] += delta;

  const minBySection = {
    introduction: 80,
    race_summary: 120,
    battle_for_win: 180,
    strategy: 100,
    key_incidents: 120,
    driver_stories: 160,
    championship_picture: 120,
    looking_ahead: 70,
    controversy: 120,
  };
  const maxBySection = {
    introduction: 180,
    race_summary: 280,
    battle_for_win: 380,
    strategy: 260,
    key_incidents: 300,
    driver_stories: 480,
    championship_picture: 320,
    looking_ahead: 160,
    controversy: 280,
  };

  return templates.map((t, i) => {
    const min = minBySection[t.sectionId] || 80;
    const max = maxBySection[t.sectionId] || Math.round(midWord * 0.35);
    return Math.max(min, Math.min(max, raw[i]));
  });
}

export function buildArticleOutline({ storyPlan, articleType, articleDepth }) {
  const depth = normalizeArticleDepth(articleDepth);
  const wordRange = ARTICLE_DEPTH_WORD_RANGES[depth];
  const templates = sectionTemplate(depth, storyPlan);
  const midWord = Math.round((wordRange.minimum + wordRange.maximum) / 2);
  const wordTargets = allocateWordTargets(templates, storyPlan, depth);
  const weightExplain = templates.map((t, i) => ({
    sectionId: t.sectionId,
    baseWeight: t.baseWeight,
    evidenceFactCount: collectFactIdsForStories(storyPlan, t.storyIds).factIds.length,
    targetWords: wordTargets[i],
  }));

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
      targetWords: wordTargets[index],
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
    totalTargetWords: wordTargets.reduce((a, b) => a + b, 0),
    sections,
    omittedSectionTypes: omitted,
    raceTemperature: storyPlan.raceTemperature,
    readerTakeaways: storyPlan.readerTakeaways,
    wordAllocation: weightExplain,
  };
}
