// Weekly learner feedback (design L7 / P7 / S8, spec §9). Question wording
// and the weekly window live here so the form, the Project Manager summary
// and the Feedback centre all read one definition. Changing a question means
// bumping FORM_VERSION — every response stores the version it answered.

const FORM_VERSION = '1.2';

const WEEKLY_QUESTIONS = [
  'Is hafte ki classes kitni useful thi?',
  'Pace theek tha?',
  'Recordings / material time par mile?',
  'Support se help mili (agar maangi)?',
  'Overall is hafte ka experience',
];

// Project Manager categories (D-05) — answered about the batch's PM.
const PM_QUESTIONS = [
  'Availability & responsiveness',
  'Clarity of guidance',
  'Technical / academic support',
  'Review quality & timeliness',
  'Professional conduct & respect',
  'Project planning & follow-through',
  'Overall satisfaction',
];

// Weekly window in IST (D-04): opens Friday 18:00, due Sunday 23:59, and a
// late submission for that week is still accepted until Tuesday 23:59.
const WINDOW = { opensDayOffset: 4, opensHour: 18, dueDayOffset: 6, lateUntilDayOffset: 8 };

// A PM only ever sees a category average once this many learners answered —
// below it a single response could be identified.
const MIN_RESPONSES_FOR_SCORE = 5;

// First feedback week (its Monday, IST). Weeks before it never count as
// "missed" and never open — the form didn't exist yet.
const START_WEEK = '2026-11-02';
const MAX_REMINDERS_PER_WEEK = 2;

module.exports = { FORM_VERSION, WEEKLY_QUESTIONS, PM_QUESTIONS, WINDOW, MIN_RESPONSES_FOR_SCORE, MAX_REMINDERS_PER_WEEK, START_WEEK };
