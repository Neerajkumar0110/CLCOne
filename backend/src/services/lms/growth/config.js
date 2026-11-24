const mongoose = require('mongoose');

// Settings for Learner 360° (Figma 1B) and the engagement tracker (3E), with
// the design's defaults. Cached for 30 s — every report reads it.

const DEFAULTS = {
  weights: { attendance: 15, assessment: 30, coding: 30, project: 25 },
  levels: { jobReady: 80, almost: 60 },
  realtime: true,
  mentorPdf: true,
  batchWeights: [],
  // Figma 3E "Engagement settings"
  engagement: {
    idleTimeoutMin: 3,
    active: { editor: true, lesson: true, video: true, assessment: true, live: true, hiddenTab: false },
    weights: { practiceTime: 35, completion: 30, exercises: 20, streak: 15 },
    levels: { high: 70, moderate: 40 },
    dailyGoalMin: 90,
    reminderHour: 19, // 7 PM IST, learner can change
    quiet: { from: 23, to: 8 },
    streakRisk: true,
    weeklyEmail: true,
    showIn360: true,
    // alert rules (3E table): key → { on, days }
    rules: {
      inactiveMentor: { on: true, days: 3 }, // → assigned mentor · in-app + email
      inactiveSupport: { on: true, days: 5 }, // → support outreach queue (3D) · queue + email
      lowStreak: { on: true, days: 3 }, // Low Engagement N days in a row → mentor · in-app
      missedLive: { on: true, count: 2 }, // missed N live classes in a week → mentor + learner
      streakBroken: { on: true, days: 7 }, // streak of N+ days broken → learner
      readinessLow: { on: false, below: 60 }, // readiness drops below → mentor + admin · email
    },
  },
};

let cache = null;
let cacheAt = 0;

const merge = (base, over) => {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over === undefined || over === null ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over)) {
    if (over[k] === undefined || over[k] === null) continue;
    out[k] = base && typeof base[k] === 'object' && !Array.isArray(base[k]) ? merge(base[k], over[k]) : over[k];
  }
  return out;
};

async function get() {
  if (cache && Date.now() - cacheAt < 30000) return cache;
  const row = await mongoose.model('LmsGrowthConfig').findOne({ key: 'live' }).lean().catch(() => null);
  const clean = row ? JSON.parse(JSON.stringify(row)) : {};
  delete clean._id;
  delete clean.__v;
  cache = merge(DEFAULTS, clean);
  cacheAt = Date.now();
  return cache;
}

function bust() {
  cache = null;
}

async function weightsFor(batch) {
  const c = await get();
  const o = (c.batchWeights || []).find((b) => b.batch && batch && b.batch.toLowerCase() === String(batch).toLowerCase());
  return o && o.weights ? merge(c.weights, o.weights) : c.weights;
}

function levelOf(score, levels) {
  if (score == null) return { key: 'none', label: 'Not enough data', tone: 'mut' };
  if (score >= levels.jobReady) return { key: 'job', label: 'Job Ready', tone: 'ok' };
  if (score >= levels.almost) return { key: 'almost', label: 'Almost Ready', tone: 'wa' };
  return { key: 'needs', label: 'Needs Improvement', tone: 'er' };
}

function engagementLevelOf(score, levels) {
  if (score == null) return { key: 'none', label: 'No activity yet', tone: 'mut' };
  if (score >= levels.high) return { key: 'high', label: 'Highly Engaged', short: 'Highly', tone: 'ok' };
  if (score >= levels.moderate) return { key: 'moderate', label: 'Moderately Engaged', short: 'Moderate', tone: 'wa' };
  return { key: 'low', label: 'Low Engagement', short: 'Low', tone: 'er' };
}

module.exports = { DEFAULTS, get, bust, weightsFor, levelOf, engagementLevelOf, merge };
