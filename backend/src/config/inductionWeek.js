// The fixed 5-day induction every new batch starts with, before any
// curriculum module begins.
//
// These five classes are the same for every batch and deliberately do NOT
// deliver syllabus: they are orientation, environment setup and a conceptual
// tour of the whole programme. recurrence.js stamps the first five generated
// sessions with these titles and sets countsTowardSyllabus:false on them, so
//
//   - the curriculum mapping (services/lms/chapterProgress.js) skips them
//     entirely and starts handing out chapter hours at class 6, which is
//     where "S1 — Python Setup & Environment" actually belongs;
//   - each recording is named for the induction day it really is, instead of
//     borrowing the next curriculum topic.
//
// Before this existed, a batch doing orientation still consumed five
// curriculum slots, so its recordings were labelled with Python topics
// nobody had taught yet and every later class was five slots out of step.
//
// Only applies to batches generated from here on. Existing batches keep the
// schedule they already have — changing them would renumber classes that
// have already been taught and recorded.
const INDUCTION_WEEK = [
  {
    day: 1,
    title: 'Day 1 — Program Orientation, AI Landscape & End-to-End Roadmap',
    description: [
      'Roadmap & AI landscape — the path: Python/SQL -> NLP/LLMs -> APIs and Prompt Engineering -> ML/Probability -> Agents -> SEO/domain engineering -> Productionisation -> Capstone. Distinguish traditional programming, automation, chatbot, LLM application and autonomous agent.',
      'Core building blocks — data, APIs, databases, models, prompts, embeddings, vector databases, tools, memory, dashboards, deployment, monitoring. Draw the flow: goal -> data/API -> processing -> model/retrieval -> action/output -> monitoring.',
      'Learning method & Capstone preview — plain-English concept -> example -> guided practice -> assessment/project. Introduce the Capstone as the longer-term integrated outcome; no final project decision required yet.',
    ].join('\n\n'),
  },
  {
    day: 2,
    title: 'Day 2 — Python, Data, SQL & Environment Readiness',
    description: [
      'Environment setup — Python, VS Code, pip, virtual environments, Jupyter/JupyterLab. Confirm what is installed and what still needs setup; how to verify the environment and report setup errors.',
      'Python fundamentals — variables and basic types; strings; lists, tuples, sets, dictionaries; operators; conditions and loops; functions; modules; files/errors; basic OOP awareness.',
      'Structured data & SQL awareness — JSON, CSV, Pandas/DataFrames awareness, tables, rows/columns, primary keys, SQLite concept. Why JSON matters for API/tool communication; how a table differs from a JSON object or CSV.',
    ].join('\n\n'),
  },
  {
    day: 3,
    title: 'Day 3 — NLP, LLM Fundamentals & Prompt Engineering',
    description: [
      'NLP pipeline — text cleaning, lowercasing, punctuation handling, tokenisation, stopwords, stemming/lemmatisation, POS tagging, NER, keywords, sentiment, classification.',
      'Meaning & search intent — embeddings as numerical representations of meaning; similarity; TF-IDF/YAKE awareness; informational, transactional and navigational search intent.',
      'LLMs & prompting — LLM and transformer concepts at a high level; tokens, context window, temperature, top-p; clear instructions, roles, constraints, zero-shot/few-shot prompts. Show a weak prompt and an improved one.',
    ].join('\n\n'),
  },
  {
    day: 4,
    title: 'Day 4 — APIs, Structured Outputs, RAG, Vector Search & ML Preview',
    description: [
      'APIs & tool interaction — API basics, authentication, requests/responses, model selection, streaming awareness, structured JSON output, function/tool calling. OpenAI/Anthropic/Gemini as named examples.',
      'Frameworks, RAG & vector search — LangChain and LlamaIndex awareness; RAG flow: documents -> chunking -> embeddings -> vector index -> retrieval -> grounded answer; FAISS, Pinecone, ChromaDB awareness; keyword vs semantic search.',
      'ML & probability — probability, uncertainty, confidence; supervised vs unsupervised learning; rules vs ML vs LLMs. No mathematical derivations in Week 1.',
    ].join('\n\n'),
  },
  {
    day: 5,
    title: 'Day 5 — AI Agents, SEO, Productionisation & Capstone',
    description: [
      'Agent architecture — agent vs chatbot vs automation; Perception -> Reasoning -> Action -> Memory; ReAct, planning, Plan-and-Execute; tools and short-/long-term memory.',
      'Agent frameworks & reliability — LangGraph concepts: state, nodes, edges, conditions, loops, checkpoints; sequential, parallel and supervisor/worker multi-agent patterns; CrewAI awareness; tracing/logging, tool failure, hallucinations, reliability.',
      'SEO/domain engineering — search engine/SERP basics, keyword research, content generation and optimisation, technical SEO, rank tracking, CMS publishing, reporting and monitoring. Why publishing needs review/approval safeguards.',
      'Productionisation — build -> test -> package -> deploy -> monitor; Docker, FastAPI, cloud deployment, GitHub Actions/CI, guardrails, Streamlit, monitoring and alerts (awareness only).',
      'Capstone orientation — how Python, NLP, LLMs, ML, agents, APIs, automation, dashboarding and deployment combine into an autonomous system; what makes a project scope realistic.',
    ].join('\n\n'),
  },
];

const INDUCTION_DAYS = INDUCTION_WEEK.length;

// The induction entry for a 1-based class index, or null once the induction
// week is over and the curriculum takes over.
function inductionForIndex(index) {
  return INDUCTION_WEEK[index - 1] || null;
}

module.exports = { INDUCTION_WEEK, INDUCTION_DAYS, inductionForIndex };
