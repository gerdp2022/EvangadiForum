import { safeExecute } from "../../../../schema/db.config.js";
import { ServiceUnavailableError } from "../../../utility/errors/errors.js";
import { generateQuestionEmbedding } from "../../question/service/vector.service.js";
import { normalizeQuestionText } from "../../question/service/vector.service.js";
import { calculateCosineSimilarity } from "../../question/service/vector.service.js";
import { retrieveReadyEmbeddings } from "../../question/service/vector.service.js";
import { answerFromChatSourcesService } from "../../question/service/geminiTextCoach.service.js";

// Minimum cosine score per type. Questions and PDF chunks use the same
// vectors and the same query embedding as search, so they start at the
// measured 0.62.
const THRESHOLDS = {
  question: Number(process.env.CHAT_QUESTION_THRESHOLD) || 0.62,
  document: Number(process.env.CHAT_DOCUMENT_THRESHOLD) || 0.62,
};
const MAX_SOURCES = Number(process.env.CHAT_MAX_SOURCES) || 5; // sent to Gemini
const MAX_SOURCE_CHARS = 1500; // per PDF chunk, in the prompt
// A thread holds the question and ALL its answers, so it gets more room.
const MAX_THREAD_CHARS = 3000;
// Keyword search: at most this many words from the message, each at least
// MIN_KEYWORD_LENGTH letters, and at most this many threads found.
const MAX_KEYWORDS = 5;
const MIN_KEYWORD_LENGTH = 4;
const MAX_KEYWORD_THREADS = 3;
// Common words that would match almost every thread.
const STOP_WORDS = new Set([
  "about",
  "also",
  "does",
  "doing",
  "from",
  "have",
  "help",
  "into",
  "just",
  "know",
  "like",
  "make",
  "need",
  "please",
  "should",
  "some",
  "tell",
  "than",
  "that",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "used",
  "using",
  "want",
  "what",
  "when",
  "where",
  "which",
  "while",
  "with",
  "would",
  "could",
  "your",
  "mean",
  "means",
  "work",
  "works",
  "explain",
]);
const MAX_QUESTION_CHARS = 600;
const MAX_ANSWER_CHARS = 500;

const NOT_FOUND_TEXT =
  "I could not find this in the forum or in your PDFs. You can ask the community, and someone may answer you.";
const RELATED_TEXT =
  "I could not find a clear answer in the forum or in your PDFs. These threads look related:";

// ---------- step 1: small talk ----------
// Short social messages ("hi", "thank you", "who are you?") get a fixed,
// friendly reply with no AI call, like the helpers on professional websites.
// Each kind has a few replies, so the assistant does not repeat itself, and
// a few suggested next questions, shown as buttons in the chat window.
// A message only counts as small talk when it is ALL small talk:
// "thanks, but what is JWT?" is a real question and goes to the search.

const SMALL_TALK = [
  {
    kind: "greeting",
    pattern:
      /^(hi|hii+|hello|hey|hey there|hi there|hello there|selam|salam|good (morning|afternoon|evening))( (assistant|bot|there))?$/,
    replies: [
      (name) =>
        `Hi${name}! 👋 I'm the Evangadi Forum assistant. Ask me anything about the forum's questions or your own PDFs, and I'll show you where my answer comes from.`,
      (name) =>
        `Hello${name}! What are you working on today? I can search the forum threads and your PDFs for you.`,
    ],
    suggestions: [
      "What can you do?",
      "How does JWT login work?",
      "What is RAG?",
    ],
  },
  {
    kind: "howAreYou",
    pattern:
      /^((hi|hello|hey) )?(how are you|how r u|how are u|how is it going|hows it going|how do you do|whats up|what is up|sup)( today)?$/,
    replies: [
      (name) =>
        `I'm doing great, thanks for asking${name}! Ready to help. What would you like to know?`,
      () =>
        "All good here, and ready to dig through the forum for you. What's your question?",
    ],
    suggestions: ["What can you do?", "What is Node.js?"],
  },
  {
    kind: "about",
    pattern:
      /^(who are you|what are you|what can you do|what do you do|how do you work|how can you help( me)?|help|help me|what should i ask( you)?)$/,
    replies: [
      () =>
        "I'm the Evangadi Forum assistant. I answer questions using two things only: the questions and answers in this forum, and the PDFs you uploaded to your Knowledge Base. Every answer shows its sources, so you can check them. If I can't find something, I'll tell you honestly and help you ask the community.",
    ],
    suggestions: [
      "How does JWT login work?",
      "What is RAG?",
      "What is Evangadi Forum?",
    ],
  },
  {
    kind: "thanks",
    pattern:
      /^((ok|okay|great|perfect|nice|cool|awesome) )?(thanks|thank you|thank u|thanks a lot|thank you so much|thanks so much|thx|ty|many thanks|appreciate it|i appreciate it)( (a lot|so much|very much))?( (assistant|bot))?$/,
    replies: [
      (name) => `You're welcome${name}! 😊 Anything else I can help with?`,
      () => "Happy to help! Ask me anything else whenever you need.",
      () => "Anytime! Good luck with your learning.",
    ],
    suggestions: ["What can you do?", "What is RAG?"],
  },
  {
    kind: "acknowledge",
    pattern:
      /^(ok|okay|ok cool|okay cool|cool|great|nice|perfect|awesome|got it|i see|alright|all right|makes sense|understood)$/,
    replies: [
      () => "Great! Is there anything else you'd like to know?",
      () => "👍 Let me know if you have another question.",
    ],
    suggestions: ["What can you do?", "What is Node.js?"],
  },
  {
    kind: "bye",
    pattern:
      /^((ok|okay|thanks|thank you) )?(bye|bye bye|goodbye|good bye|see you|see ya|see you later|good night|have a nice day)$/,
    replies: [
      (name) => `Bye${name}! 👋 Come back anytime you get stuck.`,
      (name) => `See you${name}! Good luck with your project.`,
    ],
    suggestions: [],
  },
];

// "Thank you!!" -> "thank you", "Hi, there 😊" -> "hi there".
function normalizeSmallTalk(message) {
  return message
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const pickOne = (list) => list[Math.floor(Math.random() * list.length)];

/**
 * A fixed reply for small talk, or null for a real question.
 * @param {string} message
 * @param {string} [firstName]
 * @returns {{ kind: string; text: string; suggestions: string[] } | null}
 */
function smallTalkReply(message, firstName) {
  const text = normalizeSmallTalk(message);
  const match = SMALL_TALK.find((entry) => entry.pattern.test(text));
  if (!match) return null;
  const name = firstName ? ` ${firstName}` : "";
  return {
    kind: match.kind,
    text: pickOne(match.replies)(name),
    suggestions: match.suggestions,
  };
}

// ---------- step 3: score the vectors stored in MySQL ----------

// Cosine score of one stored vector against the query vector.
// MySQL gives a JSON column back as an array or as a string. A vector that
// cannot be read or has the wrong size returns null and is skipped.
function scoreVector(queryVector, stored) {
  let vector = stored;
  if (typeof vector === "string") {
    try {
      vector = JSON.parse(vector);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(vector) || vector.length !== queryVector.length) {
    return null;
  }
  return calculateCosineSimilarity(queryVector, vector);
}

// Every ready question vector. Questions are public, so no user filter.
async function searchQuestionVectors(queryVector) {
  const rows = await retrieveReadyEmbeddings();
  const candidates = [];
  for (const row of rows) {
    const score = scoreVector(queryVector, row.embedding);
    if (score !== null && score >= THRESHOLDS.question) {
      candidates.push({ kind: "thread", questionId: row.questionId, score });
    }
  }
  return candidates;
}

// First lock: only the ready chunks of THIS user's ready PDFs are read.
// Another user's vectors never leave MySQL.
async function searchChunkVectors(queryVector, userId) {
  const rows = await safeExecute(
    `SELECT c.chunk_id, v.embedding
     FROM document_chunk_vectors v
     JOIN document_chunks c ON c.chunk_id = v.chunk_id
     JOIN documents d ON d.document_id = c.document_id
     WHERE d.user_id = ? AND d.status = 'ready' AND v.status = 'ready'`,
    [userId],
  );
  const candidates = [];
  for (const row of rows) {
    const score = scoreVector(queryVector, row.embedding);
    if (score !== null && score >= THRESHOLDS.document) {
      candidates.push({ kind: "document", chunkId: row.chunk_id, score });
    }
  }
  return candidates;
}

// The useful words of the message: lower case, letters and digits only,
// no short words, no common words, no repeats.
function extractKeywords(message) {
  const words = message.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const keywords = words.filter(
    (word) => word.length >= MIN_KEYWORD_LENGTH && !STOP_WORDS.has(word),
  );
  return [...new Set(keywords)].slice(0, MAX_KEYWORDS);
}

// Finds threads whose question OR answers contain the message's keywords.
// This catches words that only appear in an answer (answers have no vector).
// A thread ranks higher when it contains more of the keywords. When the
// message has 2+ keywords, a thread must contain at least 2 of them.
// The keywords hold only letters and digits, so LIKE needs no escaping.
async function searchKeywordThreads(message) {
  const keywords = extractKeywords(message);
  if (keywords.length === 0) return [];
  const patterns = keywords.map((keyword) => `%${keyword}%`);
  const anyOf = (column) => keywords.map(() => `${column} LIKE ?`).join(" OR ");

  const rows = await safeExecute(
    `SELECT question_id, CONCAT(title, ' ', content) AS text
     FROM questions
     WHERE ${anyOf("title")} OR ${anyOf("content")}
     UNION ALL
     SELECT question_id, content AS text
     FROM answers
     WHERE ${anyOf("content")}
     LIMIT 200`,
    [...patterns, ...patterns, ...patterns],
  );

  // question_id -> the keywords found anywhere in that thread
  const found = new Map();
  for (const row of rows) {
    const text = `${row.text || ""}`.toLowerCase();
    const words = found.get(row.question_id) ?? new Set();
    for (const keyword of keywords) {
      if (text.includes(keyword)) words.add(keyword);
    }
    found.set(row.question_id, words);
  }

  const minHits = Math.min(2, keywords.length);
  return [...found]
    .filter(([, words]) => words.size >= minHits)
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, MAX_KEYWORD_THREADS)
    .map(([questionId]) => ({ kind: "thread", questionId, score: null }));
}

// Questions and PDF chunks compete in one list. Best score first.
function pickBestCandidates(threads, chunks) {
  return [...threads, ...chunks]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SOURCES);
}

// A keyword match has no cosine score, so its score is null.
const roundScore = (score) =>
  score === null ? null : Number(score.toFixed(3));

const placeholders = (items) => items.map(() => "?").join(", ");

// ---------- step 6: read the real text from MySQL ----------
async function loadThreads(candidates) {
  const ids = candidates.map((candidate) => candidate.questionId);
  if (ids.length === 0) return new Map();

  const questions = await safeExecute(
    `SELECT question_id, question_hash, title, content
     FROM questions
     WHERE question_id IN (${placeholders(ids)})`,
    ids,
  );
  const answers = await safeExecute(
    `SELECT answer_id, question_id, content
     FROM answers
     WHERE question_id IN (${placeholders(ids)})
     ORDER BY created_at ASC`,
    ids,
  );

  const threads = new Map();
  for (const question of questions) {
    threads.set(question.question_id, { ...question, answers: [] });
  }
  for (const answer of answers) {
    threads.get(answer.question_id)?.answers.push(answer);
  }
  return threads;
}
// returns a map of chunk_id -> { chunk_id, content, page_start, document_id, title }
async function loadChunks(candidates, userId) {
  const ids = candidates.map((candidate) => candidate.chunkId);
  if (ids.length === 0) return new Map();

  // Second lock: even if the search query had a bug, the text of another
  // user's PDF can never leave MySQL, because of "d.user_id = ?".
  const rows = await safeExecute(
    `SELECT c.chunk_id, c.content, c.page_start, d.document_id, d.title
     FROM document_chunks c
     JOIN documents d ON d.document_id = c.document_id
     WHERE d.user_id = ? AND c.chunk_id IN (${placeholders(ids)})`,
    [userId, ...ids],
  );
  return new Map(rows.map((row) => [row.chunk_id, row]));
}

const cut = (text, max) => {
  const clean = `${text || ""}`.trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
};

// The text of one thread for the prompt: the question, then all of its
// answers, oldest first.
function buildThreadText(thread) {
  const lines = [`Question: ${cut(thread.content, MAX_QUESTION_CHARS)}`];
  if (thread.answers.length === 0) {
    lines.push("This question has no answers yet.");
  }
  for (const answer of thread.answers) {
    lines.push(`Answer: ${cut(answer.content, MAX_ANSWER_CHARS)}`);
  }
  return cut(lines.join("\n"), MAX_THREAD_CHARS);
}

// Builds the numbered sources. A hit that MySQL no longer has is dropped.
// The server builds every link. The model never writes a link.
async function buildSources({ candidates, userId }) {
  const threads = await loadThreads(
    candidates.filter((candidate) => candidate.kind === "thread"),
  );
  const chunks = await loadChunks(
    candidates.filter((candidate) => candidate.kind === "document"),
    userId,
  );

  const sources = [];
  for (const candidate of candidates) {
    if (candidate.kind === "thread") {
      const thread = threads.get(candidate.questionId);
      if (!thread) continue;
      sources.push({
        ref: sources.length + 1,
        type: "question",
        title: thread.title,
        url: `/questions/${thread.question_hash}`,
        score: roundScore(candidate.score),
        label: `Forum thread: ${thread.title}`,
        text: buildThreadText(thread),
      });
    } else {
      const chunk = chunks.get(candidate.chunkId);
      if (!chunk) continue;
      sources.push({
        ref: sources.length + 1,
        type: "document",
        title: chunk.title,
        url: "/rag-documents",
        documentId: chunk.document_id,
        page: chunk.page_start,
        score: roundScore(candidate.score),
        label: `The user's PDF "${chunk.title}", page ${chunk.page_start ?? "?"}`,
        text: cut(chunk.content, MAX_SOURCE_CHARS),
      });
    }
  }
  return sources;
}

// What the client gets for one source: no prompt text, no label.
// The model never writes a link, so the server builds it.
// sources are numbered in the order they were sent to Gemini, starting at 1.
const toPublicSource = ({ label, text, ...source }) => source;

const reply = (kind, answer, extra = {}) => ({
  kind,
  answer,
  grounded: kind === "answer",
  sources: [],
  related: [],
  ...extra,
});

/**
 * Answers one chat message.
 * @param {{ userId: number; firstName?: string; message: string }} param
 * @returns {Promise<{ kind: string; answer: string; grounded: boolean; sources: Array<Object>; related: Array<Object> }>}
 */
export const chatService = async ({ userId, firstName, message }) => {
  // 1. Small talk: fixed reply, no AI call.
  const smallTalk = smallTalkReply(message, firstName);
  if (smallTalk) {
    return reply("chat", smallTalk.text, {
      suggestions: smallTalk.suggestions,
    });
  }

  // 2. Message -> vector, the same way as semantic search.
  let vector;
  try {
    const { embedding } = await generateQuestionEmbedding(
      normalizeQuestionText({ title: message }),
      { taskType: "RETRIEVAL_QUERY" },
    );
    vector = embedding;
  } catch {
    throw new ServiceUnavailableError(
      "The AI assistant is temporarily unavailable. Please try again later.",
    );
  }

  // 3 + 4. Score the MySQL vectors, keep the best few above the threshold.
  // Keywords are only the safety net, used when the meaning search found
  // nothing close enough.
  let candidates;
  try {
    const [threads, chunks] = await Promise.all([
      searchQuestionVectors(vector),
      searchChunkVectors(vector, userId),
    ]);
    candidates = pickBestCandidates(threads, chunks);
    if (candidates.length === 0) {
      candidates = await searchKeywordThreads(message);
    }
  } catch (error) {
    console.error("chat search:", error);
    throw new ServiceUnavailableError(
      "The AI assistant cannot reach its search index right now. Please try again later.",
    );
  }

  // 5 + 6. Real text from MySQL. Nothing left -> honest "I do not know".
  const sources = await buildSources({ candidates, userId });
  if (sources.length === 0) {
    return reply("notfound", NOT_FOUND_TEXT);
  }

  // 7. Gemini answers from the numbered sources only.
  const { answer } = await answerFromChatSourcesService({
    message,
    sources: sources.map(({ ref, label, text }) => ({ ref, label, text })),
  });

  // 8. Honest sources: only the ones the answer really cites as [n].
  // Gemini writes [1] and sometimes [1, 2]. Both forms are read.
  const citedRefs = new Set(
    [...answer.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)].flatMap((match) =>
      match[1].split(",").map(Number),
    ),
  );
  const cited = sources.filter((source) => citedRefs.has(source.ref));
  if (cited.length > 0) {
    return reply("answer", answer, { sources: cited.map(toPublicSource) });
  }

  // No citation means the model could not answer from the sources.
  // Its text is not shown. Close forum threads are offered instead.
  const related = sources
    .filter((source) => source.type === "question")
    .map(toPublicSource);
  if (related.length > 0) {
    return reply("related", RELATED_TEXT, { related });
  }
  return reply("notfound", NOT_FOUND_TEXT);
};

// Exported for tests.
export {
  scoreVector,
  extractKeywords,
  pickBestCandidates,
  buildThreadText,
  smallTalkReply,
};
