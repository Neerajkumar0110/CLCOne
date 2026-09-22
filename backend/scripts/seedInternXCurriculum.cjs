#!/usr/bin/env node
/**
 * Seeds the real InternX-AI curriculum ("InternX-AI Curriculum for Foundation
 * and Elite", 2026 Edition, Career Lab Consulting) into Course -> CourseModule
 * -> Chapter -> Lesson, exactly as spec'd in the source PDF — 13 units, every
 * session group, every "what's covered" bullet, plus each unit's assessment
 * brief as its own chapter/lesson.
 *
 * Idempotent: re-running upserts by (course title), (course+module title),
 * (module+chapter sessionLabel) — safe to run again after editing this file.
 *
 * Usage:
 *   cd backend
 *   node scripts/seedInternXCurriculum.cjs
 *
 * Needs DATABASE (Mongo URI) in backend/.env, same as the server.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

const mongoose = require('mongoose');

const missing = ['DATABASE'].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing env var(s): ${missing.join(', ')} — add to backend/.env`);
  process.exit(1);
}

// ── curriculum data, transcribed from the PDF ──────────────────────────────
// Two catalog entries (matching the PDF's own "FOUNDATION | ELITE" badges on
// its cover page): Foundation = Units 1-7 only; Elite = the full 13-unit
// program (its own summary table lists Units 01-07 as its first row too —
// Elite is Foundation plus 6 more units, not a standalone track).
const OLD_COMBINED_TITLE = 'InternX-AI — AI Agent Engineering (Foundation & Elite)'; // superseded, cleaned up below

const FOUNDATION_COURSE = {
  title: 'InternX-AI — Foundation Plan (6 Month)',
  category: 'Technical', level: 'Intermediate', mode: 'Cohort', language: 'English',
  status: 'Draft', durationHours: 6, // months, per this app's Course.durationHours convention
  instructor: '',
  outcomes: 'Build and deploy autonomous AI agents end-to-end: Python/SQL, NLP, LLM APIs & prompt engineering, ML for agent tooling, agent architecture (ReAct/LangGraph/multi-agent), SEO domain automation, and containerised cloud deployment — culminating in a personalised autonomous-system capstone.',
  description: 'Career Lab Consulting / InternX-AI curriculum, 2026 Edition — Foundation Plan: 7 units, 37 weeks, 184 sessions, 276 hours. Curriculum designed by AI Engineer Sandeep Yadav.',
};
const ELITE_COURSE = {
  title: 'InternX-AI — Elite Plan (12 Month)',
  category: 'Technical', level: 'Advanced', mode: 'Cohort', language: 'English',
  status: 'Draft', durationHours: 12,
  instructor: '',
  outcomes: 'Everything in the Foundation Plan, plus advanced ML engineering (fine-tuning, RL), system design for AI agent systems, cloud deployment/MLOps/DevOps, AI research skills, and turning an agent into a pitched, monetised product — culminating in an enterprise multi-agent capstone platform.',
  description: 'Career Lab Consulting / InternX-AI curriculum, 2026 Edition — Elite Plan: 13 units, 62 weeks, 328 sessions, 492 hours (includes the full Foundation Plan as Units 01-07). Grading: Tests 40% · Capstone 30% · Projects 20% · Research 10%. Curriculum designed by AI Engineer Sandeep Yadav.',
};

// Each unit: order, title, track, weeks, sessions/hours label (as printed —
// not recomputed), overview, learningGoals, chapters[], assessment.
// chapter: { sessionLabel, title, hours, covered: [bullets] }
const UNITS = [
  {
    order: 1,
    title: 'Unit 01 — Python Programming Foundations & SQL Basics',
    track: 'Foundation', weeks: '01–06', sessions: 28, hours: 42,
    overview: 'Build a strong foundation in Python programming and SQL. Learn to write practical Python scripts, work with data, and use SQLite for storing, retrieving, and querying information.',
    learningGoals: [
      'Learn Python syntax, data types, functions, and control flow.',
      'Write Python scripts for practical data tasks.',
      'Store, retrieve, and query data using SQL and SQLite.',
    ],
    chapters: [
      { sessionLabel: 'S1', title: 'Python Setup & Environment', hours: 1.5, covered: ['Installing Python, VS Code, and pip', 'Running your first script; interactive mode vs file mode', 'Virtual environments — keeping project tools separate from others'] },
      { sessionLabel: 'S2–3', title: 'Variables, Data Types & Operators', hours: 3, covered: ['int, float, str, bool, None — the kinds of data Python understands', 'Arithmetic, comparison, logical operators', 'Type casting — converting one type to another (e.g. "5" to 5)'] },
      { sessionLabel: 'S4', title: 'Strings & String Methods', hours: 1.5, covered: ['Indexing, slicing, f-strings (filling in blanks)', '.split(), .join(), .strip(), .replace() — editing text programmatically', 'Formatting text to create AI prompts dynamically'] },
      { sessionLabel: 'S5', title: 'Lists, Tuples & Sets', hours: 1.5, covered: ['CRUD operations on lists; list comprehensions', 'When to use tuples (fixed data) vs sets (unique items)'] },
      { sessionLabel: 'S6', title: 'Dictionaries & JSON', hours: 1.5, covered: ['Key-value pairs; nested dicts — like a labelled filing cabinet', 'json module: loads() to read JSON, dumps() to create JSON', 'Reading/writing JSON files — format AI tools use to send/receive data'] },
      { sessionLabel: 'S7', title: 'Control Flow — if/elif/else & Loops', hours: 1.5, covered: ['Conditional logic: IF this is true, do this; OTHERWISE do that', 'For loops, while loops, and loop control (break, continue, pass)', 'Applying control flow in real-world tasks'] },
      { sessionLabel: 'S8–9', title: 'Functions & Scope', hours: 3, covered: ['def, return, and function calling', 'Default arguments, *args, **kwargs', 'Lambda functions for quick tasks', 'Local vs global scope'] },
      { sessionLabel: 'S10', title: 'Modules, Packages & pip', hours: 1.5, covered: ['import keyword and modules', 'Creating your own modules', 'Built-in Python packages (random, math, datetime, etc.)', 'pip install & managing external packages'] },
      { sessionLabel: 'S11', title: 'File I/O & Error Handling', hours: 1.5, covered: ['open(), read(), write(), close()', 'with statement for safe file handling', 'try, except, else, finally', 'Common errors and how to fix them'] },
      { sessionLabel: 'S12', title: 'OOP — Part 1', hours: 1.5, covered: ['Classes, __init__, self; attributes and methods', 'Building an Agent class skeleton — your first AI agent structure'] },
      { sessionLabel: 'S13–14', title: 'OOP — Part 2', hours: 3, covered: ['Inheritance, super(); encapsulation, dunder methods', 'Polymorphism for tool plugins — different tools, same interface'] },
      { sessionLabel: 'S15–16', title: 'Working with APIs & Web Scraping', hours: 3, covered: ['HTTP methods: GET, POST; headers, params, status codes', 'requests + BeautifulSoup; CSS selectors, find(), find_all()', 'Ethical scraping & robots.txt'] },
      { sessionLabel: 'S17', title: 'Data Manipulation with Pandas', hours: 1.5, covered: ['DataFrame, Series basics; filtering, groupby, merge', 'Exporting to CSV/JSON for agents to consume'] },
      { sessionLabel: 'S18', title: 'Introduction to Databases & SQL', hours: 1.5, covered: ['Relational databases — tables, rows, columns, primary keys', 'SQL vs NoSQL; where databases fit alongside JSON files and APIs', "Setting up SQLite — python's built-in, file-based database"] },
      { sessionLabel: 'S19', title: 'Aggregations — GROUP BY, COUNT, SUM, AVG', hours: 1.5, covered: ['Aggregate functions: COUNT(), SUM(), AVG(), MIN(), MAX()', 'Grouping rows with GROUP BY; filtering groups with HAVING'] },
      { sessionLabel: 'S20', title: 'Joining Tables — INNER & LEFT JOIN', hours: 1.5, covered: ['Why data is split across multiple tables; foreign keys', 'INNER JOIN vs LEFT JOIN — combining rows from two tables', 'Practical: joining a keywords table with a rankings table'] },
      { sessionLabel: 'S21', title: 'SQL in Python — sqlite3 & Pandas Integration', hours: 1.5, covered: ['sqlite3 module: connect(), cursor(), execute(), commit()', 'Running SQL queries directly from a Python script', 'pandas.read_sql() and DataFrame.to_sql()'] },
      { sessionLabel: 'S22', title: 'Micro Test — SQL-Backed Keyword Database', hours: 1.5, covered: ['Create a SQLite database with a keywords table (keyword, volume, difficulty, date_added)', 'Write a Python script that inserts scraped keyword data into the database', 'Write 3 SQL queries: top-10 keywords by volume, average difficulty by month, duplicate check'] },
      { sessionLabel: 'S23', title: 'Regular Expressions & Async Basics', hours: 1.5, covered: ['re.search(), re.findall(), re.sub() — pattern-based text matching', 'asyncio, async def, await — doing multiple things at once'] },
      { sessionLabel: 'S24', title: 'Micro Test — CLI Web Scraper', hours: 1.5, covered: ['Build a command-line web scraper that saves results to JSON'] },
      { sessionLabel: 'S25–28', title: 'Jupyter Notebooks & Data Exploration', hours: 6, covered: ['Installing and running Jupyter Lab — your interactive coding canvas', 'Markdown cells for notes; code cells for experiments', 'Exploring a CSV dataset: load, inspect, visualise with matplotlib', 'Micro Test S24 recap: build a command-line web scraper that saves results to JSON'] },
    ],
    assessment: {
      title: 'Unit 1 Assessment — Data Fetcher Tool (Practical Coding)',
      duration: '90 min', passMark: '90%', weight: '10% of final grade',
      brief: [
        'Students build a command-line Python tool that:',
        '1. Accepts a keyword as input',
        '2. Scrapes first 5 Google results via SerpAPI',
        '3. Extracts titles + URLs',
        '4. Stores results in a JSON file with timestamp',
        'Graded on: Code Quality, Error Handling, Output Correctness.',
      ],
    },
  },
  {
    order: 2,
    title: 'Unit 02 — NLP Fundamentals & Introduction to LLMs',
    track: 'Foundation', weeks: '07–09', sessions: 12, hours: 18,
    overview: 'NLP is how computers understand human language. You will learn how text is cleaned, analysed, and fed into AI models — the building blocks that power ChatGPT. You will also get a conceptual and practical introduction to how Large Language Models work, including the settings that control their output.',
    learningGoals: [
      'Define NLP pipeline stages: tokenisation, POS tagging, NER, embeddings.',
      'Apply spaCy and NLTK to clean and analyse SEO-relevant text.',
      'Analyse keyword relevance using TF-IDF and semantic similarity.',
      'Explain how LLMs process text: tokens, context window, temperature.',
    ],
    chapters: [
      { sessionLabel: 'S29', title: 'Text Preprocessing', hours: 1.5, covered: ['Tokenisation, lowercasing, punctuation removal', 'Stop words removal; stemming vs lemmatisation (root word finding)'] },
      { sessionLabel: 'S30', title: 'POS Tagging & Named Entity Recognition', hours: 1.5, covered: ['spaCy pipeline; .pos_, .ent_type_', 'Extracting brands, products, locations from web copy automatically'] },
      { sessionLabel: 'S31', title: 'Keyword Extraction — TF-IDF & YAKE', hours: 1.5, covered: ['TfidfVectorizer from sklearn; YAKE unsupervised extraction', 'SEO keyword density analysis in practice'] },
      { sessionLabel: 'S32', title: 'Text Embeddings & Semantic Similarity', hours: 1.5, covered: ['sentence-transformers library; cosine similarity for content gap analysis', "Comparing two pieces of content numerically — finding what competitors cover that you don't"] },
      { sessionLabel: 'S33', title: 'Sentiment Analysis & Text Classification', hours: 1.5, covered: ["VADER, TextBlob; Hugging Face pipeline('sentiment-analysis')", 'Classifying search intent: informational / transactional / navigational'] },
      { sessionLabel: 'Micro Test', title: 'NLP on a SERP Dataset', hours: 0, covered: ['Given 20 scraped article titles: extract keywords, classify intent, output ranked report', '(Not counted in session total)'] },
      { sessionLabel: 'S34–S39', title: 'Introduction to Large Language Models (LLMs)', hours: 9, covered: ['Transformer architecture — conceptual overview, no maths required', 'Tokens, context window, temperature, top-p — the settings that control LLM output', 'Zero-shot, few-shot, chain-of-thought prompting — ways to get better results', 'Hands-on: call OpenAI API with different temperature/top-p settings and compare outputs', 'Summarisation & topic modelling: extractive vs abstractive, LDA with gensim', 'LLM evaluation basics: BLEU, ROUGE — how to measure output quality', 'Note: S34 is a Micro Test and is not counted in the session total. S34–S39 is a 6-session module (9 hr).'] },
    ],
    assessment: {
      title: 'Unit 2 Assessment — NLP Pipeline: SEO Keyword Analyser',
      duration: '90 min', passMark: '90%', weight: '10% of final grade',
      brief: [
        'Complete NLP pipeline: Competitor page URL → Scrape text → Clean text → Extract keywords via TF-IDF → Classify intent → Generate 10-line summary → Export JSON report.',
      ],
    },
  },
  {
    order: 3,
    title: 'Unit 03 — LLM APIs & Prompt Engineering',
    track: 'Foundation', weeks: '10–13', sessions: 18, hours: 27,
    overview: 'In this unit, you will learn how to connect and interact with powerful AI services like ChatGPT, Claude, and Gemini using Python. You will master prompt engineering to get structured and reliable results, chain multiple AI steps together, and build RAG systems that search your own documents intelligently before generating answers.',
    learningGoals: [
      'Understand how LLM APIs (OpenAI, Anthropic, Gemini) work and their pricing model.',
      'Apply prompt engineering techniques to get structured output from LLMs.',
      'Build multi-step LLM chains with LangChain.',
      'Create a RAG system that searches your own documents before answering.',
    ],
    chapters: [
      { sessionLabel: 'S40–S41', title: 'OpenAI & Anthropic APIs', hours: 3, covered: ['Authentication, models, parameters; Chat Completions API structure', 'Streaming responses; Claude API differences and when to use each provider'] },
      { sessionLabel: 'S42–S44', title: 'Advanced Prompt Engineering', hours: 4.5, covered: ['Instruction clarity, role assignment, output constraints', 'Chain-of-thought & step-by-step reasoning prompting', 'Structured JSON output prompting; prompt templates with variables'] },
      { sessionLabel: 'Micro Test', title: 'Prompt Engineering', hours: 1.5, covered: ['Write 3 prompts from raw SERP dataset: (1) Keyword intent classifier (2) Meta description generator (3) Content outline creator', 'Evaluated on output quality and token efficiency', 'Assessment only — not counted in session count'] },
      { sessionLabel: 'S46–S47', title: 'Structured Output & Function Calling', hours: 3, covered: ['JSON mode / response_format; structured output from LLMs', 'OpenAI function calling / tool_use; defining tools', 'Parsing and validating LLM output with Pydantic'] },
      { sessionLabel: 'S48–S49', title: 'LangChain Fundamentals', hours: 3, covered: ['LLMChain, PromptTemplate, OutputParser — building AI pipelines step by step', 'Memory: ConversationBufferMemory', 'Building a multi-step SEO chain (keyword → intent → outline → summary)'] },
      { sessionLabel: 'S50–S51', title: 'LlamaIndex & RAG Basics Dataset', hours: 3, covered: ['Document loading: PDF, TXT, CSV, URLs, Notion', 'Text splitting / chunking strategies (size, overlap)', 'Embeddings with OpenAI / Hugging Face', 'VectorStoreIndex, query engine — RAG for SEO knowledge base'] },
      { sessionLabel: 'S52–S57', title: 'Vector Databases & Semantic Search', hours: 9, covered: ['Vector DBs overview: Pinecone, Weaviate, Qdrant — pros & cons', 'Storing embeddings and metadata', 'Similarity search: cosine similarity, top-k results, filters', 'Hybrid search: keyword + vector search', 'Building a production-ready semantic search for your SEO tool'] },
    ],
    assessment: {
      title: 'Unit 3 Assessment — RAG-Powered SEO Research Tool',
      duration: '2 hr take-home', passMark: '90%', weight: '10% of final grade',
      brief: [
        'Build a RAG system that:',
        '1. Ingests 10 competitor blog posts into ChromaDB',
        '2. Answers natural language SEO questions against this knowledge base',
        '3. Generates a content gap report with ranked keyword opportunities',
      ],
    },
  },
  {
    order: 4,
    title: 'Unit 04 — ML & Probability Basics for Agent Builders',
    track: 'Foundation', weeks: '14–17', sessions: 18, hours: 27,
    overview: 'Machine Learning is how computers learn patterns from data without being explicitly told every rule. Before training models, you will build basic intuition for probability — the maths language every ML prediction speaks. Everything is hands-on in Jupyter notebooks with minimal code. This unit is designed to be adjusted or expanded based on cohort progress.',
    learningGoals: [
      "Explain basic probability concepts: events, independence, conditional probability, and Bayes' theorem in plain English.",
      'Explain the difference between ML, rules-based programming, and LLMs in plain terms.',
      'Train and evaluate a simple classification model using sklearn in a Jupyter notebook.',
      'Build a basic keyword difficulty predictor using real SEO data.',
      'Interpret model outputs: confidence scores, feature importance, confusion matrix.',
      'Recognise when to use ML vs when to use an LLM in agent design.',
    ],
    chapters: [
      { sessionLabel: 'S58', title: 'What Is Machine Learning? (Conceptual)', hours: 1.5, covered: ['ML vs traditional programming vs LLMs — key differences with visual diagrams', 'Supervised learning (learning from labelled examples) vs unsupervised (finding patterns)', 'Real-world ML examples: spam filters, Netflix recommendations, Google autocomplete'] },
      { sessionLabel: 'S59', title: 'What Is Probability? (Conceptual)', hours: 1.5, covered: ['Probability as a measure of uncertainty: 0 = impossible, 1 = certain', 'Events and sample space with simple examples: coin flips, dice rolls, search clicks', 'Why probability is the language underneath every ML prediction'] },
      { sessionLabel: 'S60', title: 'Calculating Basic Probabilities in Python', hours: 1.5, covered: ["Simulating coin flips and dice rolls with Python's random module", 'Estimating probability from simulation vs calculating it exactly', 'Visualising outcomes with matplotlib histograms'] },
      { sessionLabel: 'S61', title: 'Independent vs Dependent Events & Conditional Probability', hours: 1.5, covered: ['Independent events: P(A and B) = P(A) × P(B) with examples', 'Dependent events: P(A and B) = P(A|B) × P(B) explained simply', 'Conditional probability: P(A|B) explained with real-life cases', 'Practice problems using Python'] },
      { sessionLabel: 'S62', title: "Bayes' Theorem — Plain English Introduction", hours: 1.5, covered: ["Bayes' theorem concept with a story example", 'Prior, likelihood, evidence, and posterior — what they mean', 'Spam filter example step-by-step', "When and why Bayes' theorem is useful"] },
      { sessionLabel: 'S63', title: 'Probability Distributions — Normal & Uniform', hours: 1.5, covered: ['What is a probability distribution?', 'Normal (Gaussian) distribution: mean, std deviation, bell curve', 'Uniform distribution: all outcomes equally likely', 'Visualising distributions in Python with matplotlib & seaborn'] },
      { sessionLabel: 'S64', title: 'Probability & ML — Confidence Scores', hours: 1.5, covered: ['What are confidence scores in ML models?', 'Converting model outputs to probabilities', 'Interpreting probability outputs in classification', 'Calibration concept (very simple intro)'] },
      { sessionLabel: 'S65', title: 'Your First ML Model in a Notebook', hours: 1.5, covered: ['Building a simple classification model using scikit-learn', 'Dataset overview: what features and labels mean', 'Training the model in a Jupyter notebook', 'Making predictions on new data'] },
      { sessionLabel: 'S66', title: 'Understanding What the Model Learned', hours: 1.5, covered: ['Confusion matrix explained simply', 'Accuracy, precision, recall, F1-score — what they mean', 'Feature importance: which factors matter most', 'Interpreting model results in plain English'] },
      { sessionLabel: 'S67', title: 'Train/Test Split & Cross-Validation', hours: 1.5, covered: ['Why we split data into train and test sets', 'Overfitting vs underfitting — simple explanations', 'Cross-validation: k-fold explained with examples', 'Improving model generalisation'] },
      { sessionLabel: 'S68', title: 'Three Key Algorithms — Intuition & Hands-On', hours: 1.5, covered: ['Linear Regression — prediction as a straight line', 'Logistic Regression — predicting yes/no outcomes', 'Decision Trees — decisions like a flowchart', 'When to use each algorithm'] },
      { sessionLabel: 'S69', title: 'Feature Engineering — Teaching the Model What Matters', hours: 1.5, covered: ['Features = columns of data the model learns from; labels = what you want to predict', 'Choosing useful features; handling missing values and categorical data (encoding)', 'Normalisation / standardisation — why scale matters for some algorithms', 'Hands-on: build a feature table from a small keyword dataset (word count, DA, backlinks)'] },
      { sessionLabel: 'S70', title: 'SEO Use Case — Keyword Difficulty Predictor', hours: 1.5, covered: ['Load a sample dataset of 200 keywords with known difficulty scores (0–100)', 'Features: search volume, word count, avg DA of top-10, SERP features present', 'Train a Random Forest Regressor to predict difficulty score for new keywords', 'Evaluate with Mean Absolute Error (MAE); predict difficulty for 10 new keywords'] },
      { sessionLabel: 'S71', title: 'Feature Importance & Model Explainability', hours: 1.5, covered: ['feature_importances_ in Random Forest — which input signals matter most', "Bar chart of feature importance: 'search volume contributed 40% to the prediction'", 'SHAP values — plain-English: why did the model predict this score for this keyword?'] },
      { sessionLabel: 'S72', title: 'Unsupervised Learning — Clustering Keywords', hours: 1.5, covered: ['K-Means clustering: grouping similar keywords without labelled data', 'Choosing K: elbow method visualised', 'Hands-on: cluster 50 keywords by TF-IDF vectors; inspect each cluster manually', 'Use case: auto-group keywords by topic for content silo planning'] },
      { sessionLabel: 'S73', title: 'When to Use ML vs LLM vs Rules in Agent Design', hours: 1.5, covered: ['Decision framework: structured/numeric data → ML; language tasks → LLM; deterministic logic → rules', 'Examples: keyword difficulty scoring = ML; article writing = LLM; publish if score > 75 = rule', 'Latency & cost: ML models are microseconds and free at inference; LLMs are seconds and cost tokens', 'Combining all three in one agent pipeline — the real-world hybrid approach'] },
      { sessionLabel: 'S74', title: 'Saving, Loading & Using Models in Python Code', hours: 1.5, covered: ['joblib.dump() / joblib.load() — save your trained model to disk', 'Load the model inside a Python function; call it as an agent tool', 'Wrapping the keyword difficulty predictor as a callable agent tool', 'Error handling: what if the model receives unexpected input?'] },
      { sessionLabel: 'S75', title: 'Micro Test + Unit Review', hours: 1.5, covered: ['30-minute notebook task: train a classifier, evaluate it, produce a feature importance chart, identify top-5 easiest-to-rank keywords', 'Group debrief: common mistakes, questions, areas to reinforce before Unit 5'] },
    ],
    assessment: {
      title: 'Unit 4 Assessment — Keyword Intelligence Tool (Jupyter Notebook)',
      duration: 'Take-home (48 hrs)', passMark: '65%', weight: '10% of final grade',
      brief: [
        'Students submit a Jupyter notebook that:',
        '1. Loads a provided keyword dataset (100 rows)',
        '2. Engineers at least 4 features with reasoning',
        '3. Trains a Random Forest model with train/test split',
        '4. Evaluates with accuracy + MAE + confusion matrix',
        '5. Produces a feature importance chart',
        '6. Predicts difficulty for 10 unseen keywords',
        '7. Includes a markdown cell explaining in plain English what the model learned.',
      ],
    },
  },
  {
    order: 5,
    title: 'Unit 05 — AI Agent Architecture & Design Patterns',
    track: 'Foundation', weeks: '18–22', sessions: 24, hours: 36,
    overview: 'An AI agent is a programme that can plan, decide, use tools, and remember things — working autonomously to complete a goal. You will build your first real AI agent that can research keywords, scrape websites, and write reports by itself. Your ML basics from Unit 4 will be used as agent tools here.',
    learningGoals: [
      'Explain the Perception → Reasoning → Action → Memory loop of autonomous agents.',
      'Build tool-calling agents using LangChain/LangGraph and OpenAI function calling.',
      'Analyse multi-agent collaboration patterns: sequential, parallel, hierarchical.',
      'Evaluate agent reliability using tracing and observability tools.',
      'Integrate the ML keyword difficulty model from Unit 4 as an agent tool.',
    ],
    chapters: [
      { sessionLabel: 'S76–S77', title: 'What is an AI Agent?', hours: 3, covered: ['Agent vs chatbot vs automation — the key difference', 'PEAS model: Performance, Environment, Actuators, Sensors', 'Taxonomy: reactive, deliberative, hybrid agents'] },
      { sessionLabel: 'S78–S79', title: 'ReAct & Planning Patterns', hours: 3, covered: ['Reason + Act (ReAct) framework — think step-by-step before acting', 'Plan-and-Execute agents', 'Tree-of-Thoughts for complex multi-step tasks'] },
      { sessionLabel: 'S80–S82', title: 'Tool Use & Function Calling', hours: 4.5, covered: ['Designing tools: search, scrape, write, publish, predict (ML model)', 'Tool schemas with Pydantic; tool chaining and error recovery', 'Integrating the Unit 4 keyword difficulty ML model as an agent tool'] },
      { sessionLabel: 'S83', title: 'Micro Test — Tool Builder', hours: 1.5, covered: ['Build 3 agent tools: SERP fetcher, content word-count checker, ML difficulty scorer', 'Wire them to an LLM that decides which tool to call for a given query'] },
      { sessionLabel: 'S84–S86', title: 'Agent Memory Systems', hours: 4.5, covered: ['Short-term: in-context memory; long-term: vector + entity memory', 'Episodic memory with Redis/SQLite', 'Memory compression strategies'] },
      { sessionLabel: 'S87–S89', title: 'LangGraph — Stateful Agent Workflows', hours: 4.5, covered: ['State graphs, nodes, edges, conditions — agent decision trees', 'Cycles and loops for autonomous retrying; checkpointing', 'Building a multi-step SEO workflow graph that can recover from failures'] },
      { sessionLabel: 'S90–S92', title: 'Multi-Agent Systems', hours: 4.5, covered: ['Sequential, parallel, and Supervisor/worker patterns', 'CrewAI framework introduction', 'SEO pipeline: Research Agent → ML Scoring Agent → Writing Agent → Publisher'] },
      { sessionLabel: 'S93–S95', title: 'Agent Observability, Debugging & Mini-Project', hours: 4.5, covered: ['LangSmith tracing; logging agent steps; handling hallucinations and tool failures', 'Mini-Project: Autonomous SEO Research Agent v1 with 4 tools including ML scorer', 'ReAct loop; memory in vector DB; output: structured JSON + markdown Report'] },
      { sessionLabel: 'S96–S99', title: 'Unit 5 Extended Practice & Assessment Prep', hours: 6, covered: ['Extend the mini project: add LangGraph stateful graph and error recovery', 'Code review sessions; debugging common agent failure patterns', 'Assessment preparation: final checklist and Q&A'] },
    ],
    assessment: {
      title: 'Unit 5 Assessment — Autonomous SEO Research Agent',
      duration: '48 hrs take-home', passMark: '65%', weight: '15% of final grade',
      brief: [
        'Agent must autonomously: research a given keyword; analyse top-10 SERP results; score each keyword using the ML difficulty model (Unit 4); identify content gaps; produce a ranked keyword brief with recommended headings.',
        'Must use: LangGraph stateful graph; minimum 4 tools including the ML scorer; vector memory.',
      ],
    },
  },
  {
    order: 6,
    title: 'Unit 06 — SEO Domain Knowledge & Agent Feature Engineering',
    track: 'Foundation', weeks: '23–30', sessions: 36, hours: 54,
    overview: 'In this unit, you will master SEO domain knowledge and build intelligent features that power autonomous SEO agents. You will integrate real-world SEO APIs, automate keyword research, generate optimised content, and prepare your agent to execute end-to-end SEO tasks with accuracy and scale.',
    learningGoals: [
      'Understand core SEO concepts and how search engines work.',
      'Integrate SEO APIs to fetch real-time data for automation.',
      'Automate keyword research and clustering using ML + NLP techniques.',
      'Generate SEO-optimised content outlines and drafts using LLMs.',
      'Design features that enhance SEO agent accuracy, relevance, and performance.',
    ],
    chapters: [
      { sessionLabel: 'S100–S101', title: 'SEO Fundamentals for Developers', hours: 3, covered: ['How search engines work: crawling, indexing, ranking', 'On-page vs off-page vs technical SEO', 'Keywords, search intent, SERP features', 'SEO metrics: impressions, clicks, CTR, bounce rate, rankings'] },
      { sessionLabel: 'S102–S103', title: 'SEO APIs Integration', hours: 3, covered: ['Overview of popular SEO APIs: Google API, Ahrefs, SEMrush APIs', 'Fetching keyword data, SERP, backlinks, domain metrics', 'Parsing and storing API data for agent use', '★ Micro Test S103: API Data Fetcher'] },
      { sessionLabel: 'S104–S106', title: 'Keyword Research Automation', hours: 4.5, covered: ['Keyword idea generation using APIs', 'Keyword clustering and grouping using NLP', 'Search intent classification', 'Prioritisation using ML model (difficulty + volume + intent)', '★ Micro Test S106: Keyword Clusterer'] },
      { sessionLabel: 'S107–S109', title: 'Content Generation & Optimisation', hours: 4.5, covered: ['Content brief to article using LLMs', 'SEO content structure: headings, keywords, readability', 'On-page optimisation suggestions (title, meta, internal links, schema)', 'Content quality scoring using NLP metrics'] },
      { sessionLabel: 'S110–S111', title: 'Technical SEO Automation', hours: 3, covered: ['Website crawl automation (Sitemap, robots.txt, redirects)', 'Broken links, canonical issues, duplicate content detection', 'Page speed & Core Web Vitals monitoring', 'Automated technical SEO reports'] },
      { sessionLabel: 'S112–S113', title: 'SERP Monitoring & Rank Tracking', hours: 3, covered: ['Track keyword rankings automatically', 'SERP feature tracking (Featured Snippets, PAA, etc.)', 'Competitor monitoring and alerts', 'Visual dashboards for rank movements'] },
      { sessionLabel: 'S114', title: 'Micro Test — SEO Content Audit', hours: 1.5, covered: ['Perform automated SEO audit on a given website', 'Identify and report key on-page, technical, and content issues', 'Generate actionable recommendations report'] },
      { sessionLabel: 'S115–S119', title: 'CMS Integration & Publishing Automation', hours: 7.5, covered: ['WordPress REST API: create/update posts; Webflow CMS API', 'Notion as a content database; automated image alt-text generation', 'Publish pipeline: draft → ML quality check → review → publish'] },
      { sessionLabel: 'S120–S123', title: 'Integrations: Slack, Email & Reporting', hours: 6, covered: ['Slack Bolt for agent notifications; email reports with smtplib/SendGrid', 'Automated PDF report generation', 'Dashboard basics with Streamlit'] },
      { sessionLabel: 'S124–S135', title: 'Full SEO Agent Integration Sprint', hours: 18, covered: ['Combining all modules — Python, NLP, LLM APIs, ML model, agent architecture — into one unified system', 'Task queue with Celery; configuration management (dotenv, YAML)', 'Code review and refactoring; assessment preparation'] },
    ],
    assessment: {
      title: 'Unit 6 Assessment — End-to-End SEO Agent Prototype',
      duration: '72 hr take-home', passMark: '70%', weight: '20% of final grade',
      brief: [
        'Build a working SEO agent that: accepts a niche and target keyword; autonomously researches SERP; uses the ML difficulty model to score and prioritise keywords; generates a content brief; produces a 600-word optimised article draft; sends a Slack summary.',
        'All steps autonomous, no human intervention.',
      ],
    },
  },
  {
    order: 7,
    title: 'Unit 07 — Agent Productionisation & Capstone Project',
    track: 'Foundation', weeks: '31–37', sessions: 48, hours: 72,
    overview: 'In this unit, you will transform your AI agents from functional prototypes into robust, production-ready systems. You will containerise, build scalable backends, deploy on the cloud, add safety guardrails, and create intelligent dashboards. Finally, you will build a complete, autonomous AI management system in your chosen domain as a capstone project.',
    learningGoals: [
      'Containerise and deploy AI agents using Docker.',
      'Build scalable APIs with FastAPI.',
      'Deploy applications on cloud platforms.',
      'Implement safety, guardrails, and responsible AI practices.',
      'Build real-time dashboards for monitoring and managing AI agents.',
      'Build a complete, autonomous AI system as a capstone project.',
    ],
    chapters: [
      { sessionLabel: 'S136–S139', title: 'Containerisation with Docker', hours: 6, covered: ['Introduction to Docker and containers', 'Dockerfile for AI agent applications', 'Docker Compose for multi-service setup', 'Running agents in isolated environments'] },
      { sessionLabel: 'S140–S143', title: 'FastAPI Backend for Agent', hours: 6, covered: ['Building REST APIs with FastAPI', 'Authentication & API security basics', 'Connecting agent modules via APIs', 'Testing APIs with Swagger UI'] },
      { sessionLabel: 'S144–S147', title: 'Basic Cloud Deployment', hours: 6, covered: ['Introduction to cloud platforms (AWS/GCP/Azure)', 'Deploying Docker containers on cloud', 'Environment variables & secrets management', 'Domain, HTTPS & basic CI/CD setup'] },
      { sessionLabel: 'S148–S149', title: 'Agent Safety & Guardrails', hours: 3, covered: ['Input validation and sanitisation for AI agents', 'Prompt injection detection and prevention', 'Content filtering and moderation', 'Safe execution of tools and external APIs', 'Rate limiting, quotas, and abuse prevention', 'Logging, auditing, and compliance basics'] },
      { sessionLabel: 'S150–S153', title: 'Streamlit Dashboard for AI Agent', hours: 6, covered: ['Introduction to Streamlit for rapid dashboards', 'Building interactive UI components (charts, tables, metrics, forms)', 'Connecting dashboard with agent APIs', 'Real-time logs, status, and health monitoring', 'User authentication basics', 'Deploying Streamlit apps'] },
      {
        sessionLabel: 'S154–S183', title: 'Capstone Project — Full Build Sprint', hours: 45,
        covered: [
          'Students integrate all modules and build a complete, end-to-end AI agent system in their chosen domain.',
          'Integrating all components (NLP, ML, LLM, APIs, Automation, Dashboards)',
          'Database design and management; end-to-end testing and debugging',
          'CI/CD pipeline and production deployment; documentation and code quality',
          'Performance optimisation and scaling',
          '— Foundation Capstone Final Project ("Fully Autonomous AI Management System — Personalised to Your Domain") —',
          '01 Intelligent Agent Core: ReAct/LangGraph agent loop with domain-specific tool set and memory systems',
          '02 ML Intelligence Module: trained Random Forest or classification model integrated as an agent tool (built in Unit 4)',
          '03 Data Ingestion Module: autonomous data collection from domain-relevant APIs, databases, or web sources',
          '04 Analysis & Processing Module: NLP + ML-powered analysis of domain documents, reports, or datasets',
          '05 Content/Output Generation: LLM-generated domain-specific documents, reports, emails, or recommendations',
          '06 Quality Scoring Module: ML-assisted quality check and confidence scoring before output delivery',
          '07 Automation & Delivery Module: auto-delivery to domain system (CRM, CMS, HR tool, finance platform, etc.) via API',
          '08 Monitoring & Alerting Module: scheduled monitoring with Slack/email alerts on key metric changes or anomalies',
          '09 Streamlit Dashboard: web UI for domain overview, agent control, and ML model predictions',
          'Plus: Cloud Deployment (Dockerised, HTTPS), Documentation (README, architecture diagram, API docs, user guide), Live Demonstration (15-minute presentation to a panel of industry experts)',
          'Weight: 35% of final grade · Bloom\'s: Create (Level 6) · Duration: 30 sessions, Weeks 31–37',
          'Students choose ONE domain from 15 Autonomous System Project options (Week 1, with mentor): Marketing, Sales, HR, Admin, Finance, Quality, Reporting & Data, Cloud, Testing, R&D, Support, IT, Operations, Project, or Security Management System — all built on the same core AI agent architecture from Units 1–7; only domain knowledge and data sources differ.',
        ],
      },
    ],
    assessment: null, // the capstone itself is the unit's assessment (folded into the last chapter above)
  },

  // ── ELITE PLAN — units 08-13, continues from Foundation Unit 7 ──────────
  {
    order: 8,
    title: 'Unit 08 — Machine Learning Engineering (Advanced)',
    track: 'Elite', weeks: '38–41', sessions: 24, hours: 36,
    overview: 'You will build AI models that learn from data, fine-tune language models on your own domain data, and use reinforcement learning concepts in agent design.',
    learningGoals: [],
    chapters: [
      { sessionLabel: 'S157–S160', title: 'ML Fundamentals — Supervised Learning', hours: 6, covered: ['Regression (Linear, Polynomial, Ridge, Lasso)', 'Classification (Logistic, Decision Tree)', 'Model evaluation: Accuracy, Precision, Recall, F1, ROC-AUC', 'Cross validation & hyperparameter tuning (GridSearchCV)'] },
      { sessionLabel: 'S161–S163', title: 'Feature Engineering for SEO', hours: 6, covered: ['Extracting keyword features (volume, CPC, competition)', 'Text features (TF-IDF, embeddings)', 'Domain features (SERP features, backlinks, intent signals)', 'Feature scaling, encoding, and selection', 'Correlation analysis and feature importance'] },
      { sessionLabel: 'S164–S166', title: 'LLM Fine Tuning with LoRA/QLoRA', hours: 6, covered: ['Introduction to LoRA and QLoRA', 'Preparing your domain dataset', 'Fine-tuning Llama/Mistral models', 'Evaluation: Perplexity, ROUGE, human feedback', 'Export and inference with fine-tuned model'] },
      { sessionLabel: 'S167–S168', title: 'Micro Test — ML Pipeline', hours: 3, covered: ['Build and evaluate a keyword ranking probability model', 'Output: ranked list of 50 keywords by estimated difficulty with SHAP explanation'] },
      { sessionLabel: 'S169–S171', title: 'Model Deployment with FastAPI + HuggingFace', hours: 6, covered: ['Serving ML models as REST endpoints; model versioning', 'Integrating custom ML model into the SEO agent as a callable tool'] },
      { sessionLabel: 'S172–S180', title: 'Reinforcement Learning for Agents (Intro)', hours: 6, covered: ['Markov Decision Processes (conceptual — no heavy maths); reward shaping for agent behaviour', 'RLHF basics and Constitutional AI; bandit algorithms for A/B content testing', 'Implementing a simple Q-learning agent'] },
    ],
    assessment: {
      title: 'Unit 08 Assessment — ML-Enhanced SEO Agent Tool',
      duration: '72 hr', passMark: null, weight: '8% of final grade',
      brief: [
        'Add an ML-powered keyword prioritisation tool to the existing SEO agent. The tool must:',
        '1. Score 100 keywords by predicted ranking difficulty using a trained model.',
        '2. Cluster by intent.',
        '3. Return top-20 priority keywords with SHAP feature explanations.',
      ],
    },
  },
  {
    order: 9,
    title: 'Unit 09 — System Design for AI Agent Systems',
    track: 'Elite', weeks: '42–46', sessions: 30, hours: 45,
    overview: 'When your agent needs to handle thousands of users simultaneously, you need to design it properly. This unit teaches you how to architect large-scale systems — the kind used by companies like Netflix and Airbnb.',
    learningGoals: [],
    chapters: [
      { sessionLabel: 'S181–S184', title: 'Scalable System Design Principles', hours: 6, covered: ['CAP theorem, eventual consistency — fundamental rules of distributed systems', 'Horizontal vs vertical scaling; load balancing', 'Database selection: SQL vs NoSQL vs vector DB'] },
      { sessionLabel: 'S185–S188', title: 'Message Queues & Event-Driven Architecture', hours: 6, covered: ['RabbitMQ / Redis Streams / Kafka basics — queuing systems for agent tasks', 'Async agent task dispatch', 'Dead-letter queues and retry strategies'] },
      { sessionLabel: 'S189–S192', title: 'Microservices for Multi Agent Systems', hours: 6, covered: ['Service decomposition: keyword, content, publish services — separate mini apps', 'Inter-service communication: REST vs gRPC; API Gateway; Docker Compose multi-service setup'] },
      { sessionLabel: 'S193–S194', title: 'Micro Test — System Design Interview', hours: 3, covered: ['30-min whiteboard: "Design a scalable AI agent system handling 1,000 concurrent jobs"', 'Evaluated on components chosen, trade-offs stated, bottlenecks identified'] },
      { sessionLabel: 'S195–S198', title: 'Caching, Rate Limiting & Cost Control', hours: 6, covered: ['Redis caching for LLM responses; semantic caching with embeddings — saving repeated API calls', 'Token budget management across agents; cost dashboards'] },
      { sessionLabel: 'S199–S202', title: 'Security for AI Agent Systems', hours: 6, covered: ['Prompt injection attacks and defences; secrets management (Vault, AWS Secrets Manager)', 'Data privacy: PII detection; OAuth2 for CMS integrations'] },
      { sessionLabel: 'S203–S210', title: 'System Design Case Studies & Group Project', hours: 6, covered: ['Netflix, Airbnb, Twitter system design analysis — learning from real systems', 'Group design challenge: full AI agent platform for an enterprise; architecture document deliverable'] },
    ],
    assessment: {
      title: 'Unit 09 Assessment — System Design Document: Enterprise AI Platform',
      duration: '1-week deliverable', passMark: null, weight: '8% of final grade',
      brief: [
        'Full system design document (8+ pages) for an enterprise-grade autonomous AI platform capable of handling 100 simultaneous campaigns.',
        'Must include: architecture diagram, component descriptions, scaling strategy, database schema, API contracts, cost estimate.',
      ],
    },
  },
  {
    order: 10,
    title: 'Unit 10 — Cloud Deployment, MLOps & DevOps',
    track: 'Elite', weeks: '47–52', sessions: 36, hours: 54,
    overview: 'MLOps is how professional teams deploy, monitor, and maintain AI systems. You will learn to use cloud platforms (AWS/GCP), automate deployments, and track model performance over time.',
    learningGoals: [],
    chapters: [
      { sessionLabel: 'S211–S214', title: 'AWS/GCP Core Services', hours: 6, covered: ['EC2, S3, RDS, Lambda, ECS; VPC, Security Groups, IAM roles', 'Managed AI services: Bedrock (AWS), Vertex AI (GCP)'] },
      { sessionLabel: 'S215–S218', title: 'Kubernetes for AI Agents', hours: 6, covered: ['Pods, Services, Deployments, ConfigMaps; Horizontal Pod Autoscaling; Helm charts', 'GPU node pools for inference'] },
      { sessionLabel: 'S219–S221', title: 'CI/CD Pipelines', hours: 6, covered: ['GitHub Actions: test → build → push → deploy — fully automated code release', 'Docker image optimisation; automated agent testing in CI'] },
      { sessionLabel: 'S222–S224', title: 'Observability Stack', hours: 3, covered: ['Prometheus metrics; Grafana dashboards; Loki for log aggregation', 'LangSmith + custom tracing integration'] },
      { sessionLabel: 'S225–S226', title: 'Micro Test — Deploy to Cloud', hours: 6, covered: ['Deploy the SEO agent on AWS ECS with load balancer; environment secrets from AWS Secrets Manager', 'Grafana dashboard showing request latency and LLM token usage'] },
      { sessionLabel: 'S227–S230', title: 'MLOps Fundamentals', hours: 6, covered: ['Experiment tracking with MLflow / Weights & Biases; model registry and versioning; data versioning with DVC', 'Drift detection and model retraining triggers'] },
      { sessionLabel: 'S231–S234', title: 'Infrastructure as Code (IaC) & Security Best Practices', hours: 6, covered: ['Terraform / CloudFormation for reproducible infra', 'Secrets management, least-privilege access, backup and disaster recovery'] },
      { sessionLabel: 'S235–S240', title: 'Production Readiness Sprint', hours: 6, covered: ['Health checks, graceful shutdown; chaos engineering basics — testing failure scenarios', 'Runbook creation for agent failures; cost optimisation review'] },
    ],
    assessment: {
      title: 'Unit 10 Assessment — Production Cloud Deployment',
      duration: '1 week', passMark: null, weight: '8% of final grade',
      brief: [
        'Deploy the full AI agent system: Kubernetes cluster on AWS/GCP, CI/CD pipeline, monitoring with Grafana, secrets managed via cloud vault, Terraform-provisioned infrastructure.',
        'Deliverables: Deployment URL, Architecture diagram, Terraform code repo, Grafana screenshot.',
      ],
    },
  },
  {
    order: 11,
    title: 'Unit 11 — AI Research Skills & Staying Current',
    track: 'Elite', weeks: '53–56', sessions: 24, hours: 36,
    overview: 'The AI field moves extremely fast. This unit teaches you how to read research papers (without needing a PhD), evaluate new tools, implement techniques from papers, and write about your own work professionally.',
    learningGoals: [],
    chapters: [
      { sessionLabel: 'S241–S244', title: 'How to Read AI Research Papers', hours: 6, covered: ['Paper structure: abstract, methods, results, limitations — what to read first', 'Skimming vs deep reading strategy; Arxiv, Papers With Code, Semantic Scholar', "Critical reading: identifying assumptions and gaps in a paper's argument"] },
      { sessionLabel: 'S245–S248', title: 'Key Agent Papers Deep Dive', hours: 6, covered: ['ReAct (Yao et al., 2023); Toolformer (Schick et al., 2023)', 'AutoGPT architecture analysis; agentBench evaluation framework'] },
      { sessionLabel: 'S249–S252', title: 'Emerging Agent Frameworks', hours: 6, covered: ['AutoGen, CrewAI, MetaGPT comparison — when to use each', 'OpenAI Swarm / Assistants API; evaluating frameworks: adopting vs building custom'] },
      { sessionLabel: 'S253–S255', title: 'Benchmarking & Evaluation Research', hours: 3, covered: ['GAIA, WebArena, SWE bench benchmarks — industry-standard tests for AI agents', 'Designing custom evaluation suites; statistical significance in ML evaluations'] },
      { sessionLabel: 'S256–S258', title: 'Research Paper Implementation Lab', hours: 6, covered: ['Each student selects a recent agent paper; implements the core technique in Python', 'Presents findings and working code to cohort'] },
      { sessionLabel: 'S259–S264', title: 'Technical Writing & Documentation', hours: 6, covered: ['Writing technical blog posts and READMEs; API documentation with OpenAPI/Swagger', 'Architecture Decision Records (ADR); contributing to open-source AI projects'] },
    ],
    assessment: {
      title: 'Unit 11 Assessment — Paper-to-Code Implementation + Blog Post',
      duration: '2 weeks', passMark: null, weight: '8% of final grade',
      brief: [
        'Implement a concept from a paper published in the last 6 months that improves an aspect of the AI agent.',
        'Deliverables: (1) Working code integrated into agent (2) 800-word technical blog post explaining the implementation.',
      ],
    },
  },
  {
    order: 12,
    title: 'Unit 12 — Product Development & Business of AI Agents',
    track: 'Elite', weeks: '57–59', sessions: 18, hours: 27,
    overview: 'Technical skill alone is not enough — you need to understand how to turn your AI agent into a product people pay for. This unit covers product thinking, pricing models, legal compliance, and pitching to investors.',
    learningGoals: [],
    chapters: [
      { sessionLabel: 'S265–S268', title: 'Product Thinking for AI Tools', hours: 6, covered: ['User research, jobs-to-be-done framework; MVP scoping for AI products', 'Product-market fit signals — how to know if people actually want your product'] },
      { sessionLabel: 'S269–S272', title: 'Monetisation & SaaS Architecture', hours: 6, covered: ['Subscription vs usage based pricing for AI — which model fits your product', 'Multi-tenant agent architecture; Stripe integration for agent SaaS'] },
      { sessionLabel: 'S273–S276', title: 'AI Ethics, Compliance & Legal', hours: 6, covered: ['AI Act compliance basics; copyright in AI-generated content', 'GDPR for agent data handling; responsible AI deployment'] },
      { sessionLabel: 'S277–S288', title: 'Startup Sprint — Build, Launch, Pitch', hours: 18, covered: ['12 sessions: extend your AI agent into a micro-SaaS MVP with landing page and pricing', 'Pitch deck preparation (10 slides) + mock investor pitch to panel'] },
    ],
    assessment: {
      title: 'Unit 12 Assessment — Pitch Deck + Working MVP',
      duration: 'Ongoing (Weeks 58–59)', passMark: null, weight: 'Built into Advanced Capstone',
      brief: [
        'Present a 10-slide investor pitch deck for your AI agent product with a working demo URL.',
        'Includes: Market sizing, Pricing model, Architecture diagram, 3-minute live demo.',
      ],
    },
  },
  {
    order: 13,
    title: 'Unit 13 — Advanced Capstone: Enterprise AI Agent Platform',
    track: 'Elite', weeks: '60–64', sessions: 24, hours: 36,
    overview: 'The Elite Plan capstone extends the student\'s chosen Autonomous System (from the 15 options) into an Enterprise-Grade, Multi-Agent AI Platform with production-level architecture, MLOps, and business components. This is a comprehensive 36-hour build sprint culminating in a live panel demonstration.',
    learningGoals: [],
    chapters: [
      {
        sessionLabel: 'S289+', title: 'Enterprise AI Agent Platform — Capstone Components', hours: 36,
        covered: [
          '01 Multi-Agent System: Supervisor agent coordinating domain-specialist sub-agents — Research, Analysis, Generation, Publishing, Monitoring',
          '02 Advanced ML Components: Custom difficulty/quality models, content scorer, prediction model — trained, deployed, and version-controlled via MLflow',
          '03 Cloud Architecture: Kubernetes on AWS/GCP, Terraform IaC, auto-scaling, multi-region failover',
          '04 CI/CD Pipeline: Full GitHub Actions pipeline with automated agent testing, staging, and production deployment',
          '05 Observability: Prometheus + Grafana + LangSmith full tracing; cost dashboards; drift detection alerts',
          '06 Multi-Tenancy: Isolated environments per client, usage-based billing, Stripe integration',
          '07 React Dashboard: Frontend dashboard with real-time agent status, campaign/project reports, and ML prediction charts',
          '08 Research Component: One implemented research paper technique integrated into the production agent',
          '09 Documentation: Full system design doc, API docs, Architecture Decision Records, operational runbook',
          '10 Business Component: 10-slide investor pitch deck + live 20-minute panel demo to industry experts',
        ],
      },
    ],
    assessment: {
      title: 'Advanced Capstone — Final Panel Demonstration',
      duration: '24 sessions (36 hr), Weeks 60–64 (5 weeks)', passMark: null, weight: '30% of final grade · Bloom\'s: Create (Level 6)',
      brief: [
        'Completion of the InternX-AI Elite Plan program: a comprehensive, industry-aligned, hands-on learning journey to build fully autonomous AI systems.',
        'Grading (whole Elite program): Tests 40% · Capstone 30% · Projects 20% · Research 10%.',
        'Curriculum designed & developed by AI Engineer Sandeep Yadav — 2026 Edition.',
      ],
    },
  },
];

// ── seed logic ──────────────────────────────────────────────────────────
function bulletsToHtml(bullets) {
  return `<ul>${bullets.map((b) => `<li>${String(b).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</li>`).join('')}</ul>`;
}

async function upsertCourse(courseMeta) {
  const Course = mongoose.model('Course');
  const doc = await Course.findOneAndUpdate(
    { title: courseMeta.title, removed: false },
    { $set: { ...courseMeta, updated: new Date() }, $setOnInsert: { created: new Date() } },
    { upsert: true, new: true }
  );
  return doc;
}

// One-time cleanup: the first run of this script created a single combined
// course before the Foundation/Elite split was decided — soft-remove it so
// the Courses list doesn't show three rows.
async function archiveOldCombinedCourse() {
  const Course = mongoose.model('Course');
  const old = await Course.findOneAndUpdate(
    { title: OLD_COMBINED_TITLE, removed: false },
    { $set: { removed: true, updated: new Date() } }
  );
  if (old) console.log(`Archived superseded course: "${OLD_COMBINED_TITLE}"`);
}

async function upsertModule(courseId, unit) {
  const CourseModule = mongoose.model('CourseModule');
  const description = [unit.overview, ...(unit.learningGoals || []).map((g) => `• ${g}`)].filter(Boolean).join('\n');
  return CourseModule.findOneAndUpdate(
    { course: courseId, title: unit.title, removed: false },
    {
      $set: {
        description: `[${unit.track} · Weeks ${unit.weeks} · ${unit.sessions} sessions · ${unit.hours} hr]\n${description}`,
        hours: unit.hours,
        order: unit.order * 10,
        updated: new Date(),
      },
      $setOnInsert: { course: courseId, created: new Date() },
    },
    { upsert: true, new: true }
  );
}

async function upsertChapter(courseId, moduleId, order, ch) {
  const Chapter = mongoose.model('Chapter');
  const chapter = await Chapter.findOneAndUpdate(
    { module: moduleId, title: ch.title, removed: false },
    {
      $set: {
        description: `Session ${ch.sessionLabel}${ch.hours ? ` · ${ch.hours} hr` : ''}`,
        sessionLabel: ch.sessionLabel,
        hours: ch.hours,
        order,
        updated: new Date(),
      },
      $setOnInsert: { course: courseId, module: moduleId, created: new Date() },
    },
    { upsert: true, new: true }
  );

  const Lesson = mongoose.model('Lesson');
  const existing = await Lesson.findOne({ chapter: chapter._id, removed: false }).sort({ order: 1 });
  const content = bulletsToHtml(ch.covered || []);
  if (existing) {
    existing.title = ch.title;
    existing.content = content;
    existing.type = 'text';
    existing.updated = new Date();
    await existing.save();
  } else {
    await Lesson.create({
      course: courseId, module: moduleId, chapter: chapter._id,
      title: ch.title, type: 'text', content, order: 0, published: true,
    });
  }
  return chapter;
}

async function upsertAssessmentChapter(courseId, moduleId, order, unit) {
  if (!unit.assessment) return;
  const meta = [
    unit.assessment.duration ? `Duration: ${unit.assessment.duration}` : null,
    unit.assessment.passMark ? `Pass mark: ${unit.assessment.passMark}` : null,
    unit.assessment.weight ? `Weight: ${unit.assessment.weight}` : null,
  ].filter(Boolean).join(' · ');
  await upsertChapter(courseId, moduleId, order, {
    sessionLabel: 'Assessment',
    title: unit.assessment.title,
    hours: null,
    covered: [meta, ...unit.assessment.brief].filter(Boolean),
  });
}

async function seedCourse(courseMeta, units) {
  const course = await upsertCourse(courseMeta);
  console.log(`\nCourse: ${course.title} (${course._id})`);

  let totalChapters = 0;
  for (const unit of units) {
    const mod = await upsertModule(course._id, unit);
    let order = 10;
    for (const ch of unit.chapters) {
      await upsertChapter(course._id, mod._id, order, ch);
      order += 10;
      totalChapters += 1;
    }
    if (unit.assessment) {
      await upsertAssessmentChapter(course._id, mod._id, order, unit);
      totalChapters += 1;
    }
    console.log(`  ${unit.title} — ${unit.chapters.length} sessions${unit.assessment ? ' + assessment' : ''}`);
  }

  // keep Course.modules/lessons counters roughly in sync for the CRM list view
  const CourseModule = mongoose.model('CourseModule');
  const modCount = await CourseModule.countDocuments({ course: course._id, removed: false });
  const Course = mongoose.model('Course');
  await Course.updateOne({ _id: course._id }, { $set: { modules: modCount, lessons: totalChapters } });

  console.log(`Done — ${modCount} modules, ${totalChapters} sessions/chapters under "${course.title}".`);
  return course;
}

async function main() {
  mongoose.connect(process.env.DATABASE);
  require('../src/config/multiDb').installMultiDbRouting();

  // Register only the models this script touches (avoids globbing the whole
  // app, and avoids the "not in DB_MAP" guard tripping on unrelated models).
  require('../src/models/appModels/lms/Course');
  require('../src/models/appModels/lms/CourseModule');
  require('../src/models/appModels/lms/Chapter');
  require('../src/models/appModels/lms/Lesson');

  await new Promise((resolve, reject) => {
    mongoose.connection.once('open', resolve);
    mongoose.connection.once('error', reject);
  });
  console.log('Connected. Seeding InternX-AI curriculum (Foundation + Elite as separate courses)...');

  await archiveOldCombinedCourse();

  const foundationUnits = UNITS.filter((u) => u.track === 'Foundation');
  await seedCourse(FOUNDATION_COURSE, foundationUnits);
  await seedCourse(ELITE_COURSE, UNITS); // Elite = all 13 units, incl. Foundation's 1-7

  console.log('\nCourse status is "Draft" on both — publish from the CRM (LMS → Courses) when ready for students.');
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error('Seed failed:', e);
  process.exit(1);
});
