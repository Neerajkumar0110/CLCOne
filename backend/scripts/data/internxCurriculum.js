// Transcribed from "InternX-AI Curriculum for Foundation and Elite.pdf" (2026 edition).
// Used only by scripts/seedInternXCourses.cjs — not imported by the running app.

const FOUNDATION_UNITS = [
  {
    title: 'Unit 01 — Python Programming Foundations & SQL Basics',
    weeks: '01-06',
    sessions: 28,
    hours: 42,
    overview:
      'Build a strong foundation in Python programming and SQL. Learn to write practical Python scripts, work with data, and use SQLite for storing, retrieving, and querying information.',
    chapters: [
      { sessionLabel: 'S1', title: 'Python Setup & Environment', hours: 1.5, points: [
        'Installing Python, VS Code, and pip',
        'Running your first script; interactive mode vs file mode',
        'Virtual environments — keeping project tools separate from others',
      ] },
      { sessionLabel: 'S2-3', title: 'Variables, Data Types & Operators', hours: 3, points: [
        'int, float, str, bool, None — the kinds of data Python understands',
        'Arithmetic, comparison, logical operators',
        'Type casting — converting one type to another (e.g. "5" to 5)',
      ] },
      { sessionLabel: 'S4', title: 'Strings & String Methods', hours: 1.5, points: [
        'Indexing, slicing, f-strings (filling in blanks)',
        '.split(), .join(), .strip(), .replace() — editing text programmatically',
        'Formatting text to create AI prompts dynamically',
      ] },
      { sessionLabel: 'S5', title: 'Lists, Tuples & Sets', hours: 1.5, points: [
        'CRUD operations on lists; list comprehensions',
        'When to use tuples (fixed data) vs sets (unique items)',
      ] },
      { sessionLabel: 'S6', title: 'Dictionaries & JSON', hours: 1.5, points: [
        'Key-value pairs; nested dicts — like a labelled filing cabinet',
        'json module: loads() to read JSON, dumps() to create JSON',
        'Reading/writing JSON files — format AI tools use to send/receive data',
      ] },
      { sessionLabel: 'S7', title: 'Control Flow — if/elif/else & Loops', hours: 1.5, points: [
        'Conditional logic: IF this is true, do this; OTHERWISE do that',
        'For loops, while loops, and loop control (break, continue, pass)',
        'Applying control flow in real-world tasks',
      ] },
      { sessionLabel: 'S8-9', title: 'Functions & Scope', hours: 3, points: [
        'def, return, and function calling',
        'Default arguments, *args, **kwargs',
        'Lambda functions for quick tasks',
        'Local vs global scope',
      ] },
      { sessionLabel: 'S10', title: 'Modules, Packages & pip', hours: 1.5, points: [
        'import keyword and modules',
        'Creating your own modules',
        'Built-in Python packages (random, math, datetime, etc.)',
        'pip install & managing external packages',
      ] },
      { sessionLabel: 'S11', title: 'File I/O & Error Handling', hours: 1.5, points: [
        'open(), read(), write(), close()',
        'with statement for safe file handling',
        'try, except, else, finally',
        'Common errors and how to fix them',
      ] },
      { sessionLabel: 'S12', title: 'OOP — Part 1', hours: 1.5, points: [
        'Classes, init, self; attributes and methods',
        'Building an Agent class skeleton — your first AI agent structure',
      ] },
      { sessionLabel: 'S13-14', title: 'OOP — Part 2', hours: 3, points: [
        'Inheritance, super(); encapsulation, dunder methods',
        'Polymorphism for tool plugins — different tools, same interface',
      ] },
      { sessionLabel: 'S15-16', title: 'Working with APIs & Web Scraping', hours: 3, points: [
        'HTTP methods: GET, POST; headers, params, status codes',
        'requests + BeautifulSoup; CSS selectors, find(), find_all()',
        'Ethical scraping & robots.txt',
      ] },
      { sessionLabel: 'S17', title: 'Data Manipulation with Pandas', hours: 1.5, points: [
        'DataFrame, Series basics; filtering, groupby, merge',
        'Exporting to CSV/JSON for agents to consume',
      ] },
      { sessionLabel: 'S18', title: 'Introduction to Databases & SQL', hours: 1.5, points: [
        'Relational databases — tables, rows, columns, primary keys',
        "SQL vs NoSQL; where databases fit alongside JSON files and APIs",
        "Setting up SQLite — Python's built-in, file-based database",
      ] },
      { sessionLabel: 'S19', title: 'Aggregations — GROUP BY, COUNT, SUM, AVG', hours: 1.5, points: [
        'Aggregate functions: COUNT(), SUM(), AVG(), MIN(), MAX()',
        'Grouping rows with GROUP BY; filtering groups with HAVING',
      ] },
      { sessionLabel: 'S20', title: 'Joining Tables — INNER & LEFT JOIN', hours: 1.5, points: [
        'Why data is split across multiple tables; foreign keys',
        'INNER JOIN vs LEFT JOIN — combining rows from two tables',
        'Practical: joining a keywords table with a rankings table',
      ] },
      { sessionLabel: 'S21', title: 'SQL in Python — sqlite3 & Pandas Integration', hours: 1.5, points: [
        'sqlite3 module: connect(), cursor(), execute(), commit()',
        'Running SQL queries directly from a Python script',
        'pandas.read_sql() and DataFrame.to_sql()',
      ] },
      { sessionLabel: 'S22', title: 'Micro Test — SQL-Backed Keyword Database', hours: 1.5, points: [
        'Create a SQLite database with a keywords table (keyword, volume, difficulty, date_added)',
        'Write a Python script that inserts scraped keyword data into the database',
        'Write 3 SQL queries: top-10 keywords by volume, average difficulty by month, duplicate check',
      ] },
      { sessionLabel: 'S23', title: 'Regular Expressions & Async Basics', hours: 1.5, points: [
        're.search(), re.findall(), re.sub() — pattern-based text matching',
        'asyncio, async def, await — doing multiple things at once',
      ] },
      { sessionLabel: 'S24', title: 'Micro Test — CLI Web Scraper', hours: 1.5, points: [
        'Build a command-line web scraper that saves results to JSON',
      ] },
      { sessionLabel: 'S25-28', title: 'Jupyter Notebooks & Data Exploration', hours: 6, points: [
        'Installing and running Jupyter Lab — your interactive coding canvas',
        'Markdown cells for notes; code cells for experiments',
        'Exploring a CSV dataset: load, inspect, visualise with matplotlib',
        'Micro Test S24: build a command-line web scraper that saves results to JSON',
      ] },
    ],
    assessment: {
      title: 'Unit 1 Assessment — Practical Coding: Data Fetcher Tool',
      duration: '90 min',
      passMark: '90%',
      weight: '10% of final grade',
      details: [
        'Students build a command-line Python tool that:',
        '1. Accepts a keyword as input',
        '2. Scrapes first 5 Google results via SerpAPI',
        '3. Extracts titles + URLs',
        '4. Stores results in a JSON file with timestamp',
        'Graded on: code quality, error handling, output correctness.',
      ],
    },
  },
  {
    title: 'Unit 02 — NLP Fundamentals & Introduction to LLMs',
    weeks: '07-09',
    sessions: 12,
    hours: 18,
    overview:
      'NLP is how computers understand human language. Learn how text is cleaned, analysed, and fed into AI models — the building blocks that power ChatGPT — plus a conceptual and practical introduction to how Large Language Models work.',
    chapters: [
      { sessionLabel: 'S29', title: 'Text Preprocessing', hours: 1.5, points: [
        'Tokenisation, lowercasing, punctuation removal',
        'Stop words removal; stemming vs lemmatisation (root word finding)',
      ] },
      { sessionLabel: 'S30', title: 'POS Tagging & Named Entity Recognition', hours: 1.5, points: [
        'spaCy pipeline; .pos_, .ent_type_',
        'Extracting brands, products, locations from web copy automatically',
      ] },
      { sessionLabel: 'S31', title: 'Keyword Extraction — TF-IDF & YAKE', hours: 1.5, points: [
        'TfidfVectorizer from sklearn; YAKE unsupervised extraction',
        'SEO keyword density analysis in practice',
      ] },
      { sessionLabel: 'S32', title: 'Text Embeddings & Semantic Similarity', hours: 1.5, points: [
        'sentence-transformers library; cosine similarity for content gap analysis',
        'Comparing two pieces of content numerically — finding what competitors cover that you don’t',
      ] },
      { sessionLabel: 'S33', title: 'Sentiment Analysis & Text Classification', hours: 1.5, points: [
        "VADER, TextBlob; Hugging Face pipeline('sentiment-analysis')",
        'Classifying search intent: informational / transactional / navigational',
      ] },
      { sessionLabel: 'Micro Test', title: 'NLP on a SERP Dataset (assessment only)', hours: null, points: [
        'Given 20 scraped article titles: extract keywords, classify intent, output ranked report',
      ] },
      { sessionLabel: 'S34-S39', title: 'Introduction to Large Language Models (LLMs)', hours: 9, points: [
        'Transformer architecture — conceptual overview, no maths required',
        'Tokens, context window, temperature, top-p — the settings that control LLM output',
        'Zero-shot, few-shot, chain-of-thought prompting — ways to get better results',
        'Hands-on: call OpenAI API with different temperature/top-p settings and compare outputs',
        'Summarisation & topic modelling: extractive vs abstractive, LDA with gensim',
        'LLM evaluation basics: BLEU, ROUGE — how to measure output quality',
        '(S34 is a Micro Test and is not counted in the session total; S34–S39 is a 6-session, 9hr module.)',
      ] },
    ],
    assessment: {
      title: 'Unit 2 Assessment — NLP Pipeline: SEO Keyword Analyser',
      duration: '90 min',
      passMark: '90%',
      weight: '10% of final grade',
      details: [
        'Complete NLP pipeline: competitor page URL → scrape text → clean text → extract keywords via TF-IDF → classify intent → generate 10-line summary → export JSON report.',
      ],
    },
  },
  {
    title: 'Unit 03 — LLM APIs & Prompt Engineering',
    weeks: '10-13',
    sessions: 18,
    hours: 27,
    overview:
      'Learn how to connect and interact with powerful AI services like ChatGPT, Claude, and Gemini using Python. Master prompt engineering, chain multiple AI steps together, and build RAG systems that search your own documents before answering.',
    chapters: [
      { sessionLabel: 'S40-41', title: 'OpenAI & Anthropic APIs', hours: 3, points: [
        'Authentication, models, parameters; Chat Completions API structure',
        'Streaming responses; Claude API differences and when to use each provider',
      ] },
      { sessionLabel: 'S42-44', title: 'Advanced Prompt Engineering', hours: 4.5, points: [
        'Instruction clarity, role assignment, output constraints',
        'Chain-of-thought & step-by-step reasoning prompting',
        'Structured JSON output prompting; prompt templates with variables',
      ] },
      { sessionLabel: 'Micro Test', title: 'Prompt Engineering (assessment only)', hours: 1.5, points: [
        'Write 3 prompts from raw SERP dataset: keyword intent classifier, meta description generator, content outline creator',
        'Evaluated on output quality and token efficiency',
      ] },
      { sessionLabel: 'S46-47', title: 'Structured Output & Function Calling', hours: 3, points: [
        'JSON mode / response_format; structured output from LLMs',
        'OpenAI function calling / tool_use; defining tools',
        'Parsing and validating LLM output with Pydantic',
      ] },
      { sessionLabel: 'S48-49', title: 'LangChain Fundamentals', hours: 3, points: [
        'LLMChain, PromptTemplate, OutputParser — building AI pipelines step by step',
        'Memory: ConversationBufferMemory',
        'Building a multi-step SEO chain (keyword → intent → outline → summary)',
      ] },
      { sessionLabel: 'S50-51', title: 'LlamaIndex & RAG Basics Dataset', hours: 3, points: [
        'Document loading: PDF, TXT, CSV, URLs, Notion',
        'Text splitting / chunking strategies (size, overlap)',
        'Embeddings with OpenAI/Hugging Face',
        'VectorStoreIndex, query engine — RAG for an SEO knowledge base',
      ] },
      { sessionLabel: 'S52-57', title: 'Vector Databases & Semantic Search', hours: 9, points: [
        'Vector DBs overview: Pinecone, Weaviate, Qdrant — pros & cons',
        'Storing embeddings and metadata',
        'Similarity search: cosine similarity, top-k results, filters',
        'Hybrid search: keyword + vector search',
        'Building a production-ready semantic search for your SEO tool',
      ] },
    ],
    assessment: {
      title: 'Unit 3 Assessment — RAG-Powered SEO Research Tool',
      duration: '2 hr take-home',
      passMark: '90%',
      weight: '10% of final grade',
      details: [
        'Build a RAG system that: (1) ingests 10 competitor blog posts into ChromaDB, (2) answers natural language SEO questions against this knowledge base, (3) generates a content gap report with ranked keyword opportunities.',
      ],
    },
  },
  {
    title: 'Unit 04 — ML & Probability Basics for Agent Builders',
    weeks: '14-17',
    sessions: 18,
    hours: 27,
    overview:
      'Machine Learning is how computers learn patterns from data without being explicitly told every rule. Before training models, build basic intuition for probability — the maths language every ML prediction speaks. Everything is hands-on in Jupyter notebooks with minimal code.',
    chapters: [
      { sessionLabel: 'S58', title: 'What Is Machine Learning? (Conceptual)', hours: 1.5, points: [
        'ML vs traditional programming vs LLMs — key differences with visual diagrams',
        'Supervised learning (learning from labelled examples) vs unsupervised (finding patterns)',
        'Real-world ML examples: spam filters, Netflix recommendations, Google autocomplete',
      ] },
      { sessionLabel: 'S59', title: 'What Is Probability? (Conceptual)', hours: 1.5, points: [
        'Probability as a measure of uncertainty: 0 = impossible, 1 = certain',
        'Events and sample space with simple examples: coin flips, dice rolls, search clicks',
        'Why probability is the language underneath every ML prediction',
      ] },
      { sessionLabel: 'S60', title: 'Calculating Basic Probabilities in Python', hours: 1.5, points: [
        "Simulating coin flips and dice rolls with Python's random module",
        'Estimating probability from simulation vs calculating it exactly',
        'Visualising outcomes with matplotlib histograms',
      ] },
      { sessionLabel: 'S61', title: 'Independent vs Dependent Events & Conditional Probability', hours: 1.5, points: [
        'Independent events: P(A and B) = P(A) × P(B) with examples',
        'Dependent events: P(A and B) = P(A|B) × P(B) explained simply',
        'Conditional probability: P(A|B) explained with real-life cases',
        'Practice problems using Python',
      ] },
      { sessionLabel: 'S62', title: "Bayes' Theorem — Plain English Introduction", hours: 1.5, points: [
        "Bayes' theorem concept with a story example",
        'Prior, likelihood, evidence, and posterior — what they mean',
        'Spam filter example step-by-step',
        "When and why Bayes' theorem is useful",
      ] },
      { sessionLabel: 'S63', title: 'Probability Distributions — Normal & Uniform', hours: 1.5, points: [
        'What is a probability distribution?',
        'Normal (Gaussian) distribution: mean, std deviation, bell curve',
        'Uniform distribution: all outcomes equally likely',
        'Visualising distributions in Python with matplotlib & seaborn',
      ] },
      { sessionLabel: 'S64', title: 'Probability & ML — Confidence Scores', hours: 1.5, points: [
        'What are confidence scores in ML models?',
        'Converting model outputs to probabilities',
        'Interpreting probability outputs in classification',
        'Calibration concept (very simple intro)',
      ] },
      { sessionLabel: 'S65', title: 'Your First ML Model in a Notebook', hours: 1.5, points: [
        'Building a simple classification model using scikit-learn',
        'Dataset overview: what features and labels mean',
        'Training the model in a Jupyter notebook',
        'Making predictions on new data',
      ] },
      { sessionLabel: 'S66', title: 'Understanding What the Model Learned', hours: 1.5, points: [
        'Confusion matrix explained simply',
        'Accuracy, precision, recall, F1-score — what they mean',
        'Feature importance: which factors matter most',
        'Interpreting model results in plain English',
      ] },
      { sessionLabel: 'S67', title: 'Train/Test Split & Cross-Validation', hours: 1.5, points: [
        'Why we split data into train and test sets',
        'Overfitting vs underfitting — simple explanations',
        'Cross-validation: k-fold explained with examples',
        'Improving model generalisation',
      ] },
      { sessionLabel: 'S68', title: 'Three Key Algorithms — Intuition & Hands-On', hours: 1.5, points: [
        'Linear Regression — prediction as a straight line',
        'Logistic Regression — predicting yes/no outcomes',
        'Decision Trees — decisions like a flowchart',
        'When to use each algorithm',
      ] },
      { sessionLabel: 'S69', title: 'Feature Engineering — Teaching the Model What Matters', hours: 1.5, points: [
        'Features = columns of data the model learns from; labels = what you want to predict',
        'Choosing useful features; handling missing values and categorical data (encoding)',
        'Normalisation / standardisation — why scale matters for some algorithms',
        'Hands-on: build a feature table from a small keyword dataset (word count, DA, backlinks)',
      ] },
      { sessionLabel: 'S70', title: 'SEO Use Case — Keyword Difficulty Predictor', hours: 1.5, points: [
        'Load a sample dataset of 200 keywords with known difficulty scores (0–100)',
        'Features: search volume, word count, avg DA of top-10, SERP features present',
        'Train a Random Forest Regressor to predict difficulty score for new keywords',
        'Evaluate with Mean Absolute Error (MAE); predict difficulty for 10 new keywords',
      ] },
      { sessionLabel: 'S71', title: 'Feature Importance & Model Explainability', hours: 1.5, points: [
        'feature_importances_ in Random Forest — which input signals matter most?',
        "Bar chart of feature importance: 'search volume contributed 40% to the prediction'",
        'SHAP values — plain-English: why did the model predict this score for this keyword?',
      ] },
      { sessionLabel: 'S72', title: 'Unsupervised Learning — Clustering Keywords', hours: 1.5, points: [
        'K-Means clustering: grouping similar keywords without labelled data',
        'Choosing K: elbow method visualised',
        'Hands-on: cluster 50 keywords by TF-IDF vectors; inspect each cluster manually',
        'Use case: auto-group keywords by topic for content silo planning',
      ] },
      { sessionLabel: 'S73', title: 'When to Use ML vs LLM vs Rules in Agent Design', hours: 1.5, points: [
        'Decision framework: structured/numeric data → ML; language tasks → LLM; deterministic logic → rules',
        'Examples: keyword difficulty scoring = ML; article writing = LLM; publish if score > 75 = rule',
        'Latency & cost: ML models are microseconds and free at inference; LLMs are seconds and cost tokens',
        'Combining all three in one agent pipeline — the real-world hybrid approach',
      ] },
      { sessionLabel: 'S74', title: 'Saving, Loading & Using Models in Python Code', hours: 1.5, points: [
        'joblib.dump() / joblib.load() — save your trained model to disk',
        'Load the model inside a Python function; call it as an agent tool',
        'Wrapping the keyword difficulty predictor as a callable agent tool',
        'Error handling: what if the model receives unexpected input?',
      ] },
      { sessionLabel: 'S75', title: 'Micro Test + Unit Review', hours: 1.5, points: [
        '30-minute notebook task: train a classifier, evaluate it, produce a feature importance chart, identify top-5 easiest-to-rank keywords',
        'Group debrief: common mistakes, questions, areas to reinforce before Unit 5',
      ] },
    ],
    assessment: {
      title: 'Unit 4 Assessment — Keyword Intelligence Tool (Jupyter Notebook)',
      duration: 'Take-home (48 hrs)',
      passMark: '65%',
      weight: '10% of final grade',
      details: [
        'Students submit a Jupyter notebook that: (1) loads a provided keyword dataset (100 rows), (2) engineers at least 4 features with reasoning, (3) trains a Random Forest model with train/test split, (4) evaluates with accuracy + MAE + confusion matrix, (5) produces a feature importance chart, (6) predicts difficulty for 10 unseen keywords, (7) includes a markdown cell explaining in plain English what the model learned.',
      ],
    },
  },
  {
    title: 'Unit 05 — AI Agent Architecture & Design Patterns',
    weeks: '18-22',
    sessions: 24,
    hours: 36,
    overview:
      'An AI agent is a programme that can plan, decide, use tools, and remember things — working autonomously to complete a goal. Build your first real AI agent that can research keywords, scrape websites, and write reports by itself. Unit 4’s ML basics are used as agent tools here.',
    chapters: [
      { sessionLabel: 'S76-77', title: 'What is an AI Agent?', hours: 3, points: [
        'Agent vs chatbot vs automation — the key difference',
        'PEAS model: Performance, Environment, Actuators, Sensors',
        'Taxonomy: reactive, deliberative, hybrid agents',
      ] },
      { sessionLabel: 'S78-79', title: 'ReAct & Planning Patterns', hours: 3, points: [
        'Reason + Act (ReAct) framework — think step-by-step before acting',
        'Plan-and-Execute agents',
        'Tree-of-Thoughts for complex multi-step tasks',
      ] },
      { sessionLabel: 'S80-82', title: 'Tool Use & Function Calling', hours: 4.5, points: [
        'Designing tools: search, scrape, write, publish, predict (ML model)',
        'Tool schemas with Pydantic; tool chaining and error recovery',
        'Integrating the Unit 4 keyword difficulty ML model as an agent tool',
      ] },
      { sessionLabel: 'S83', title: 'Micro Test — Tool Builder', hours: 1.5, points: [
        'Build 3 agent tools: SERP fetcher, content word-count checker, ML difficulty scorer',
        'Wire them to an LLM that decides which tool to call for a given query',
      ] },
      { sessionLabel: 'S84-86', title: 'Agent Memory Systems', hours: 4.5, points: [
        'Short-term: in-context memory; long-term: vector + entity memory',
        'Episodic memory with Redis/SQLite',
        'Memory compression strategies',
      ] },
      { sessionLabel: 'S87-89', title: 'LangGraph — Stateful Agent Workflows', hours: 4.5, points: [
        'State graphs, nodes, edges, conditions — agent decision trees',
        'Cycles and loops for autonomous retrying; checkpointing',
        'Building a multi-step SEO workflow graph that can recover from failures',
      ] },
      { sessionLabel: 'S90-92', title: 'Multi-Agent Systems', hours: 4.5, points: [
        'Sequential, parallel, and Supervisor/worker patterns',
        'CrewAI framework introduction',
        'SEO pipeline: Research Agent → ML Scoring Agent → Writing Agent → Publisher',
      ] },
      { sessionLabel: 'S93-95', title: 'Agent Observability, Debugging & Mini-Project', hours: 4.5, points: [
        'LangSmith tracing; logging agent steps; handling hallucinations and tool failures',
        'Mini-Project: Autonomous SEO Research Agent v1 with 4 tools including ML scorer',
        'ReAct loop; memory in vector DB; output: structured JSON + markdown report',
      ] },
      { sessionLabel: 'S96-99', title: 'Unit 5 Extended Practice & Assessment Prep', hours: 6, points: [
        'Extend the mini project: add LangGraph stateful graph and error recovery',
        'Code review sessions; debugging common agent failure patterns',
        'Assessment preparation: final checklist and Q&A',
      ] },
    ],
    assessment: {
      title: 'Unit 5 Assessment — Autonomous SEO Research Agent',
      duration: 'Take-home (48 hrs)',
      passMark: '65%',
      weight: '15% of final grade',
      details: [
        'Agent must autonomously: research a given keyword, analyse top-10 SERP results, score each keyword using the ML difficulty model (Unit 4), identify content gaps, produce a ranked keyword brief with recommended headings.',
        'Must use: LangGraph stateful graph, minimum 4 tools including the ML scorer, vector memory.',
      ],
    },
  },
  {
    title: 'Unit 06 — SEO Domain Knowledge & Agent Feature Engineering',
    weeks: '23-30',
    sessions: 36,
    hours: 54,
    overview:
      'Master SEO domain knowledge and build intelligent features that power autonomous SEO agents — real-world SEO APIs, automated keyword research, optimised content generation, and end-to-end SEO tasks with accuracy and scale.',
    chapters: [
      { sessionLabel: 'S100-101', title: 'SEO Fundamentals for Developers', hours: 3, points: [
        'How search engines work: crawling, indexing, ranking',
        'On-page vs off-page vs technical SEO',
        'Keywords, search intent, SERP features',
        'SEO metrics: impressions, clicks, CTR, bounce rate, rankings',
      ] },
      { sessionLabel: 'S102-103', title: 'SEO APIs Integration', hours: 3, points: [
        'Overview of popular SEO APIs: Google API, Ahrefs, SEMrush APIs',
        'Fetching keyword data, SERP, backlinks, domain metrics',
        'Parsing and storing API data for agent use',
        'Micro Test S103: API Data Fetcher',
      ] },
      { sessionLabel: 'S104-106', title: 'Keyword Research Automation', hours: 4.5, points: [
        'Keyword idea generation using APIs',
        'Keyword clustering and grouping using NLP',
        'Search intent classification',
        'Prioritisation using ML model (difficulty + volume + intent)',
        'Micro Test S106: Keyword Clusterer',
      ] },
      { sessionLabel: 'S107-109', title: 'Content Generation & Optimisation', hours: 4.5, points: [
        'Content brief to article using LLMs',
        'SEO content structure: headings, keywords, readability',
        'On-page optimisation suggestions (title, meta, internal links, schema)',
        'Content quality scoring using NLP metrics',
      ] },
      { sessionLabel: 'S110-111', title: 'Technical SEO Automation', hours: 3, points: [
        'Website crawl automation (sitemap, robots.txt, redirects)',
        'Broken links, canonical issues, duplicate content detection',
        'Page speed & Core Web Vitals monitoring',
        'Automated technical SEO reports',
      ] },
      { sessionLabel: 'S112-113', title: 'SERP Monitoring & Rank Tracking', hours: 3, points: [
        'Track keyword rankings automatically',
        'SERP feature tracking (Featured Snippets, PAA, etc.)',
        'Competitor monitoring and alerts',
        'Visual dashboards for rank movements',
      ] },
      { sessionLabel: 'S114', title: 'Micro Test — SEO Content Audit', hours: 1.5, points: [
        'Perform automated SEO audit on a given website',
        'Identify and report key on-page, technical, and content issues',
        'Generate actionable recommendations report',
      ] },
      { sessionLabel: 'S115-119', title: 'CMS Integration & Publishing Automation', hours: 7.5, points: [
        'WordPress REST API: create/update posts; Webflow CMS API',
        'Notion as a content database; automated image alt-text generation',
        'Publish pipeline: draft → ML quality check → review → publish',
      ] },
      { sessionLabel: 'S120-123', title: 'Integrations: Slack, Email & Reporting', hours: 6, points: [
        'Slack Bolt for agent notifications; email reports with smtplib/SendGrid',
        'Automated PDF report generation',
        'Dashboard basics with Streamlit',
      ] },
      { sessionLabel: 'S124-135', title: 'Full SEO Agent Integration Sprint', hours: 18, points: [
        'Combining all modules — Python, NLP, LLM APIs, ML model, agent architecture — into one unified system',
        'Task queue with Celery; configuration management (dotenv, YAML)',
        'Code review and refactoring; assessment preparation',
      ] },
    ],
    assessment: {
      title: 'Unit 6 Assessment — End-to-End SEO Agent Prototype',
      duration: '72 hr take-home',
      passMark: '70%',
      weight: '20% of final grade',
      details: [
        'Build a working SEO agent that: accepts a niche and target keyword, autonomously researches SERP, uses the ML difficulty model to score and prioritise keywords, generates a content brief, produces a 600-word optimised article draft, sends a Slack summary — all steps autonomous, no human intervention.',
      ],
    },
  },
  {
    title: 'Unit 07 — Agent Productionisation & Capstone Project',
    weeks: '31-37',
    sessions: 48,
    hours: 72,
    overview:
      "Transform your AI agents from functional prototypes into robust, production-ready systems. Containerise, build scalable backends, deploy on the cloud, add safety guardrails, create intelligent dashboards, and finally build a complete, autonomous AI management system in your chosen domain as a capstone project.",
    chapters: [
      { sessionLabel: 'S136-139', title: 'Containerisation with Docker', hours: 6, points: [
        'Introduction to Docker and containers',
        'Dockerfile for AI agent applications',
        'Docker Compose for multi-service setup',
        'Running agents in isolated environments',
      ] },
      { sessionLabel: 'S140-143', title: 'FastAPI Backend for Agent', hours: 6, points: [
        'Building REST APIs with FastAPI',
        'Authentication & API security basics',
        'Connecting agent modules via APIs',
        'Testing APIs with Swagger UI',
      ] },
      { sessionLabel: 'S144-147', title: 'Basic Cloud Deployment', hours: 6, points: [
        'Introduction to cloud platforms (AWS/GCP/Azure)',
        'Deploying Docker containers on cloud',
        'Environment variables & secrets management',
        'Domain, HTTPS & basic CI/CD setup',
      ] },
      { sessionLabel: 'S148-149', title: 'Agent Safety & Guardrails', hours: 3, points: [
        'Input validation and sanitisation for AI agents',
        'Prompt injection detection and prevention',
        'Content filtering and moderation',
        'Safe execution of tools and external APIs',
        'Rate limiting, quotas, and abuse prevention',
        'Logging, auditing, and compliance basics',
      ] },
      { sessionLabel: 'S150-153', title: 'Streamlit Dashboard for AI Agent', hours: 6, points: [
        'Introduction to Streamlit for rapid dashboards',
        'Building interactive UI components (charts, tables, metrics, forms)',
        'Connecting dashboard with agent APIs',
        'Real-time logs, status, and health monitoring',
        'User authentication basics; deploying Streamlit apps',
      ] },
      {
        sessionLabel: 'S154-183',
        title: 'Capstone Project — Full Build Sprint',
        hours: 45,
        points: [
          'Students integrate all modules and build a complete, end-to-end AI agent system in their chosen domain: integrate all components (NLP, ML, LLM, APIs, automation, dashboards), database design and management, end-to-end testing and debugging, CI/CD pipeline and production deployment, documentation and code quality, performance optimisation and scaling.',
          '',
          'CAPSTONE — CHOICE-BASED AUTONOMOUS SYSTEM PROJECT: in Week 1 the student discusses with their mentor and chooses one Autonomous System Project based on their background (degree subject, work experience, or domain of interest). All 15 options are built on the same core AI agent architecture taught in Units 1-7 — only the domain knowledge and data sources differ:',
          '01. Marketing Management System — autonomous campaign research, competitor analysis, content creation, SEO optimisation, performance reporting. Ideal for: Marketing, Communications, Business graduates.',
          '02. Sales Management System — autonomous lead scoring, CRM data enrichment, outreach email generation, sales pipeline analysis, revenue forecasting. Ideal for: Business, Economics, Sales professionals.',
          '03. HR Management System — autonomous CV screening, job description generation, interview scheduling, onboarding document creation, workforce analytics. Ideal for: HR, Psychology, Management graduates.',
          '04. Admin Management System — autonomous document processing, task routing, meeting scheduling, correspondence drafting, workflow orchestration. Ideal for: Business Administration, Operations professionals.',
          '05. Finance Management System — autonomous financial data extraction, report generation, anomaly detection, budget tracking, regulatory compliance checking. Ideal for: Finance, Accounting, Economics graduates.',
          '06. Quality Management System — autonomous quality audit scheduling, defect detection from reports, compliance checklist generation, QA dashboard updates. Ideal for: Engineering, Quality Assurance professionals.',
          '07. Reporting & Data Management System — autonomous data ingestion, cleaning, multi-source report generation, KPI tracking, executive dashboard creation. Ideal for: Data Analytics, Business Intelligence backgrounds.',
          '08. Cloud Management System — autonomous cloud resource monitoring, cost optimisation alerts, infrastructure health checks, incident reporting. Ideal for: IT, Computer Science, Cloud Computing students.',
          '09. Testing Management System — autonomous test case generation, bug report summarisation, regression test scheduling, quality metrics reporting. Ideal for: Software Testing, QA Engineering professionals.',
          '10. R&D Management System — autonomous research paper summarisation, patent landscape analysis, competitor innovation tracking, project ideation. Ideal for: Science, Engineering, Research backgrounds.',
          '11. Support Management System — autonomous ticket triage, first-response drafting, FAQ generation, escalation routing, customer sentiment analysis. Ideal for: Customer Service, IT Support professionals.',
          '12. IT Management System — autonomous system health monitoring, incident detection, runbook generation, patch management tracking, IT asset reporting. Ideal for: IT, Networking, Computer Science graduates.',
          '13. Operations Management System — autonomous supply chain monitoring, process bottleneck detection, SOP generation, vendor communication, KPI dashboards. Ideal for: Operations, Logistics, Industrial Engineering.',
          '14. Project Management System — autonomous project status reporting, risk identification, task dependency analysis, Gantt chart generation, stakeholder update drafting. Ideal for: Project Management, Business Analysis.',
          '15. Security Management System — autonomous threat intelligence summarisation, security alert triage, compliance report generation, vulnerability tracking, incident response drafting. Ideal for: Cybersecurity, IT Risk professionals.',
          '',
          'FOUNDATION CAPSTONE FINAL PROJECT (Track A1) — the chosen system is built as a production-grade, fully autonomous AI agent system with: (1) Intelligent Agent Core — ReAct/LangGraph loop with domain-specific tools + memory, (2) ML Intelligence Module — trained classification model as an agent tool (from Unit 4), (3) Data Ingestion Module — autonomous collection from domain APIs/databases/web, (4) Analysis & Processing Module — NLP + ML-powered analysis of domain documents, (5) Content/Output Generation — LLM-generated domain-specific documents/reports/emails, (6) Quality Scoring Module — ML-assisted quality check and confidence scoring, (7) Automation & Delivery — auto-delivery to domain system (CRM/CMS/HR tool/finance platform) via API, (8) Monitoring & Alerting — scheduled monitoring with Slack/email alerts, (9) Streamlit Dashboard — web UI for domain overview, agent control, ML predictions, plus cloud deployment (Dockerised, HTTPS), full documentation (README, architecture diagram, API docs, user guide), and a 15-minute live demonstration to a panel of industry experts.',
        ],
      },
    ],
    assessment: null,
    capstoneNote: 'This unit’s capstone (S154-S183) is the Foundation Capstone Final Project — weight 35% of final grade, Bloom’s Create (Level 6), 30 sessions across weeks 31-37.',
  },
];

// Elite = Foundation (rolled up as one summary unit) + 6 additional advanced units.
const ELITE_ADDITIONAL_UNITS = [
  {
    title: 'Unit 08 — Machine Learning Engineering (Advanced)',
    weeks: '38-41',
    sessions: 24,
    hours: 36,
    overview: 'Build AI models that learn from data, fine-tune language models on your own domain data, and use reinforcement learning concepts in agent design.',
    chapters: [
      { sessionLabel: 'S157-160', title: 'ML Fundamentals — Supervised Learning', hours: 6, points: [
        'Regression (Linear, Polynomial, Ridge, Lasso)',
        'Classification (Logistic, Decision Tree)',
        'Model evaluation: Accuracy, Precision, Recall, F1, ROC-AUC',
        'Cross validation & hyperparameter tuning (GridSearchCV)',
      ] },
      { sessionLabel: 'S161-163', title: 'Feature Engineering for SEO', hours: 6, points: [
        'Extracting keyword features (volume, CPC, competition)',
        'Text features (TF-IDF, embeddings)',
        'Domain features (SERP features, backlinks, intent signals)',
        'Feature scaling, encoding, and selection',
        'Correlation analysis and feature importance',
      ] },
      { sessionLabel: 'S164-166', title: 'LLM Fine Tuning with LoRA/QLoRA', hours: 6, points: [
        'Introduction to LoRA and QLoRA',
        'Preparing your domain dataset',
        'Fine-tuning Llama/Mistral models',
        'Evaluation: Perplexity, ROUGE, human feedback',
        'Export and inference with fine-tuned model',
      ] },
      { sessionLabel: 'S167-168', title: 'Micro Test — ML Pipeline', hours: 3, points: [
        'Build and evaluate a keyword ranking probability model',
        'Output: ranked list of 50 keywords by estimated difficulty with SHAP explanation',
      ] },
      { sessionLabel: 'S169-171', title: 'Model Deployment with FastAPI + HuggingFace', hours: 6, points: [
        'Serving ML models as REST endpoints; model versioning',
        'Integrating custom ML model into the SEO agent as a callable tool',
      ] },
      { sessionLabel: 'S172-180', title: 'Reinforcement Learning for Agents (Intro)', hours: 6, points: [
        'Markov Decision Processes (conceptual — no heavy maths); reward shaping for agent behaviour',
        'RLHF basics and Constitutional AI; bandit algorithms for A/B content testing',
        'Implementing a simple Q learning agent',
      ] },
    ],
    assessment: {
      title: 'Unit 8 Assessment — ML-Enhanced SEO Agent Tool',
      duration: '72 hr',
      passMark: null,
      weight: '8% of final grade',
      details: [
        'Add an ML-powered keyword prioritisation tool to the existing SEO agent. The tool must: (1) score 100 keywords by predicted ranking difficulty using a trained model, (2) cluster by intent, (3) return top-20 priority keywords with SHAP feature explanations.',
      ],
    },
  },
  {
    title: 'Unit 09 — System Design for AI Agent Systems',
    weeks: '42-46',
    sessions: 30,
    hours: 45,
    overview: 'When your agent needs to handle thousands of users simultaneously, you need to design it properly — architecting large-scale systems the way companies like Netflix and Airbnb do.',
    chapters: [
      { sessionLabel: 'S181-184', title: 'Scalable System Design Principles', hours: 6, points: [
        'CAP theorem, eventual consistency — fundamental rules of distributed systems',
        'Horizontal vs vertical scaling; load balancing',
        'Database selection: SQL vs NoSQL vs vector DB',
      ] },
      { sessionLabel: 'S185-188', title: 'Message Queues & Event-Driven Architecture', hours: 6, points: [
        'RabbitMQ / Redis Streams / Kafka basics — queuing systems for agent tasks',
        'Async agent task dispatch',
        'Dead-letter queues and retry strategies',
      ] },
      { sessionLabel: 'S189-192', title: 'Microservices for Multi Agent Systems', hours: 6, points: [
        'Service decomposition: keyword, content, publish services — separate mini apps',
        'Inter-service communication: REST vs gRPC; API Gateway; Docker Compose multi-service setup',
      ] },
      { sessionLabel: 'S193-194', title: 'Micro Test — System Design Interview', hours: 3, points: [
        '30-min whiteboard: "Design a scalable AI agent system handling 1,000 concurrent jobs"',
        'Evaluated on components chosen, trade-offs stated, bottlenecks identified',
      ] },
      { sessionLabel: 'S195-198', title: 'Caching, Rate Limiting & Cost Control', hours: 6, points: [
        'Redis caching for LLM responses; semantic caching with embeddings — saving repeated API calls',
        'Token budget management across agents; cost dashboards',
      ] },
      { sessionLabel: 'S199-202', title: 'Security for AI Agent Systems', hours: 6, points: [
        'Prompt injection attacks and defences; secrets management (Vault, AWS Secrets Manager)',
        'Data privacy: PII detection; OAuth2 for CMS integrations',
      ] },
      { sessionLabel: 'S203-210', title: 'System Design Case Studies & Group Project', hours: 6, points: [
        'Netflix, Airbnb, Twitter system design analysis — learning from real systems',
        'Group design challenge: full AI agent platform for an enterprise; architecture document deliverable',
      ] },
    ],
    assessment: {
      title: 'Unit 9 Assessment — System Design Document: Enterprise AI Platform',
      duration: '1-week deliverable',
      passMark: null,
      weight: '8% of final grade',
      details: [
        'Full system design document (8+ pages) for an enterprise-grade autonomous AI platform capable of handling 100 simultaneous campaigns. Must include: architecture diagram, component descriptions, scaling strategy, database schema, API contracts, cost estimate.',
      ],
    },
  },
  {
    title: 'Unit 10 — Cloud Deployment, MLOps & DevOps',
    weeks: '47-52',
    sessions: 36,
    hours: 54,
    overview: 'MLOps is how professional teams deploy, monitor, and maintain AI systems — using cloud platforms (AWS/GCP), automating deployments, and tracking model performance over time.',
    chapters: [
      { sessionLabel: 'S211-214', title: 'AWS/GCP Core Services', hours: 6, points: [
        'EC2, S3, RDS, Lambda, ECS; VPC, Security Groups, IAM roles',
        'Managed AI services: Bedrock (AWS), Vertex AI (GCP)',
      ] },
      { sessionLabel: 'S215-218', title: 'Kubernetes for AI Agents', hours: 6, points: [
        'Pods, Services, Deployments, ConfigMaps; Horizontal Pod Autoscaling; Helm charts',
        'GPU node pools for inference',
      ] },
      { sessionLabel: 'S219-221', title: 'CI/CD Pipelines', hours: 6, points: [
        'GitHub Actions: test → build → push → deploy — fully automated code release',
        'Docker image optimisation; automated agent testing in CI',
      ] },
      { sessionLabel: 'S222-224', title: 'Observability Stack', hours: 3, points: [
        'Prometheus metrics; Grafana dashboards; Loki for log aggregation',
        'LangSmith + custom tracing integration',
      ] },
      { sessionLabel: 'S225-226', title: 'Micro Test — Deploy to Cloud', hours: 6, points: [
        'Deploy the SEO agent on AWS ECS with load balancer; environment secrets from AWS Secrets Manager',
        'Grafana dashboard showing request latency and LLM token usage',
      ] },
      { sessionLabel: 'S227-230', title: 'MLOps Fundamentals', hours: 6, points: [
        'Experiment tracking with MLflow / Weights & Biases; model registry and versioning; data versioning with DVC',
        'Drift detection and model retraining triggers',
      ] },
      { sessionLabel: 'S231-234', title: 'Infrastructure as Code (IaC) & Security Best Practices', hours: 6, points: [
        'Terraform / CloudFormation for reproducible infra',
        'Secrets management, least-privilege access, backup and disaster recovery',
      ] },
      { sessionLabel: 'S235-240', title: 'Production Readiness Sprint', hours: 6, points: [
        'Health checks, graceful shutdown; chaos engineering basics — testing failure scenarios',
        'Runbook creation for agent failures; cost optimisation review',
      ] },
    ],
    assessment: {
      title: 'Unit 10 Assessment — Production Cloud Deployment',
      duration: '1 week',
      passMark: null,
      weight: '8% of final grade',
      details: [
        'Deploy the full AI agent system: Kubernetes cluster on AWS/GCP, CI/CD pipeline, monitoring with Grafana, secrets managed via cloud vault, Terraform-provisioned infrastructure.',
        'Deliverables: deployment URL, architecture diagram, Terraform code repo, Grafana screenshot.',
      ],
    },
  },
  {
    title: 'Unit 11 — AI Research Skills & Staying Current',
    weeks: '53-56',
    sessions: 24,
    hours: 36,
    overview: 'The AI field moves extremely fast. Learn how to read research papers (without needing a PhD), evaluate new tools, implement techniques from papers, and write about your own work professionally.',
    chapters: [
      { sessionLabel: 'S241-244', title: 'How to Read AI Research Papers', hours: 6, points: [
        'Paper structure: abstract, methods, results, limitations — what to read first',
        'Skimming vs deep reading strategy; Arxiv, Papers With Code, Semantic Scholar',
        "Critical reading: identifying assumptions and gaps in a paper's argument",
      ] },
      { sessionLabel: 'S245-248', title: 'Key Agent Papers Deep Dive', hours: 6, points: [
        'ReAct (Yao et al., 2023); Toolformer (Schick et al., 2023)',
        'AutoGPT architecture analysis; AgentBench evaluation framework',
      ] },
      { sessionLabel: 'S249-252', title: 'Emerging Agent Frameworks', hours: 6, points: [
        'AutoGen, CrewAI, MetaGPT comparison — when to use each',
        'OpenAI Swarm / Assistants API; evaluating frameworks: adopting vs building custom',
      ] },
      { sessionLabel: 'S253-255', title: 'Benchmarking & Evaluation Research', hours: 3, points: [
        'GAIA, WebArena, SWE-bench benchmarks — industry-standard tests for AI agents',
        'Designing custom evaluation suites; statistical significance in ML evaluations',
      ] },
      { sessionLabel: 'S256-258', title: 'Research Paper Implementation Lab', hours: 6, points: [
        'Each student selects a recent agent paper; implements the core technique in Python',
        'Presents findings and working code to cohort',
      ] },
      { sessionLabel: 'S259-264', title: 'Technical Writing & Documentation', hours: 6, points: [
        'Writing technical blog posts and READMEs; API documentation with OpenAPI/Swagger',
        'Architecture Decision Records (ADR); contributing to open-source AI projects',
      ] },
    ],
    assessment: {
      title: 'Unit 11 Assessment — Paper-to-Code Implementation + Blog Post',
      duration: '2 weeks',
      passMark: null,
      weight: '8% of final grade',
      details: [
        'Implement a concept from a paper published in the last 6 months that improves an aspect of the AI agent. Deliverables: (1) working code integrated into agent, (2) 800-word technical blog post explaining the implementation.',
      ],
    },
  },
  {
    title: 'Unit 12 — Product Development & Business of AI Agents',
    weeks: '57-59',
    sessions: 18,
    hours: 27,
    overview: 'Technical skill alone is not enough — understand how to turn your AI agent into a product people pay for. Product thinking, pricing models, legal compliance, and pitching to investors.',
    chapters: [
      { sessionLabel: 'S265-268', title: 'Product Thinking for AI Tools', hours: 6, points: [
        'User research, jobs-to-be-done framework; MVP scoping for AI products',
        'Product-market fit signals — how to know if people actually want your product',
      ] },
      { sessionLabel: 'S269-272', title: 'Monetisation & SaaS Architecture', hours: 6, points: [
        'Subscription vs usage-based pricing for AI — which model fits your product',
        'Multi-tenant agent architecture; Stripe integration for agent SaaS',
      ] },
      { sessionLabel: 'S273-276', title: 'AI Ethics, Compliance & Legal', hours: 6, points: [
        'AI Act compliance basics; copyright in AI-generated content',
        'GDPR for agent data handling; responsible AI deployment',
      ] },
      { sessionLabel: 'S277-288', title: 'Startup Sprint — Build, Launch, Pitch', hours: 18, points: [
        'Extend your AI agent into a micro-SaaS MVP with landing page and pricing',
        'Pitch deck preparation (10 slides) + mock investor pitch to panel',
      ] },
    ],
    assessment: {
      title: 'Unit 12 Assessment — Pitch Deck + Working MVP',
      duration: 'Ongoing (weeks 58-59)',
      passMark: null,
      weight: 'Built into the Advanced Capstone',
      details: [
        'Present a 10-slide investor pitch deck for your AI agent product with a working demo URL. Includes: market sizing, pricing model, architecture diagram, 3-minute live demo.',
      ],
    },
  },
  {
    title: 'Unit 13 — Advanced Capstone: Enterprise AI Agent Platform',
    weeks: '60-61',
    sessions: 12,
    hours: 18,
    overview:
      'The Elite capstone extends the student’s chosen Autonomous System (from the 15 options in Unit 7) into an Enterprise-Grade, Multi-Agent AI Platform with production-level architecture, MLOps, and business components — a comprehensive build sprint culminating in a live panel demonstration. (Detailed breakdown spans weeks 60-64, 24 sessions / 36 hr.)',
    chapters: [
      { sessionLabel: '01', title: 'Multi-Agent System', hours: null, points: [
        'Supervisor agent coordinating domain-specialist sub-agents',
        'Research, Analysis, Generation, Publishing, Monitoring',
      ] },
      { sessionLabel: '02', title: 'Advanced ML Components', hours: null, points: [
        'Custom difficulty/quality models; content scorer; prediction model',
        'Trained, deployed, and version-controlled via MLflow',
      ] },
      { sessionLabel: '03', title: 'Cloud Architecture', hours: null, points: [
        'Kubernetes on AWS/GCP, Terraform IaC, auto-scaling, multi-region failover',
      ] },
      { sessionLabel: '04', title: 'CI/CD Pipeline', hours: null, points: [
        'Full GitHub Actions pipeline with automated agent testing, staging, and production deployment',
      ] },
      { sessionLabel: '05', title: 'Observability', hours: null, points: [
        'Prometheus + Grafana + LangSmith full tracing; cost dashboards; drift detection alerts',
      ] },
      { sessionLabel: '06', title: 'Multi-Tenancy', hours: null, points: [
        'Isolated environments per client, usage-based billing, Stripe integration',
      ] },
      { sessionLabel: '07', title: 'React Dashboard', hours: null, points: [
        'Frontend dashboard with real-time agent status, campaign/project reports, and ML prediction charts',
      ] },
      { sessionLabel: '08', title: 'Research Component', hours: null, points: [
        'One implemented research paper technique integrated into the production agent',
      ] },
      { sessionLabel: '09', title: 'Documentation', hours: null, points: [
        'Full system design doc, API docs, Architecture Decision Records, operational runbook',
      ] },
      { sessionLabel: '10', title: 'Business Component', hours: null, points: [
        '10-slide investor pitch deck + live 20-minute panel demo to industry experts',
      ] },
    ],
    assessment: {
      title: 'Advanced Capstone Final Project — Enterprise AI Agent Platform',
      duration: '24 sessions (36 hr), weeks 60-64 (5 weeks)',
      passMark: null,
      weight: '30% of final grade',
      details: ['Bloom’s level: Create (Level 6).'],
    },
  },
];

const FOUNDATION_TOTALS = { weeks: 37, sessions: 184, hours: 276 };
const ELITE_TOTALS = { weeks: 62, sessions: 328, hours: 492 };

module.exports = { FOUNDATION_UNITS, ELITE_ADDITIONAL_UNITS, FOUNDATION_TOTALS, ELITE_TOTALS };
