import React from 'react';
import { ProfileOutlined, FormOutlined, ExperimentOutlined } from '@ant-design/icons';
import TestIntro from './index';

// Fixed-prop wrappers so each variant can be registered as its own EMBED key
// in ModuleScaffold (which renders embeds with no props). Same 5 test types
// as the reference nav's Basic/Major/Micro Test entries.
export const BasicTest = () => (
  <TestIntro testType="BASIC" icon={<ProfileOutlined />} eyebrow="Foundational Assessment" title="Basic Test" description="Multiple-choice, output-based, and short programming questions covering core fundamentals." />
);

export const MajorTestPythonSql = () => (
  <TestIntro testType="MAJOR" icon={<FormOutlined />} eyebrow="Comprehensive Assessment" title="Python Programming Foundations & SQL Basics" description="In-depth, advanced-level questions administered under full proctoring." />
);

export const MajorTestNlp = () => (
  <TestIntro testType="NLP_MAJOR" icon={<FormOutlined />} eyebrow="Comprehensive Assessment" title="NLP Fundamentals & Introduction to LLMs" description="Text preprocessing, POS tagging & NER, TF-IDF/YAKE keyword extraction, embeddings, sentiment analysis, and LLM fundamentals." />
);

export const MicroTestSqlDb = () => (
  <TestIntro testType="MICRO" icon={<ExperimentOutlined />} eyebrow="Applied Project" title="Micro Test — SQL-Backed Keyword Database" description="Design and query a SQL-backed keyword database." />
);

export const MicroTestNlpSerp = () => (
  <TestIntro testType="NLP_MICRO" icon={<ExperimentOutlined />} eyebrow="Applied Project" title="Micro Test — NLP on a SERP Dataset" description="Given 20 scraped article titles: extract keywords, classify intent, output ranked report." />
);
