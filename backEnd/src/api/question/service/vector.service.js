import { GoogleGenAI } from "@google/genai";
import { safeExecute } from "../../../../schema/db.config.js";
import { ServiceUnavailableError } from "../../../utility/errors/errors.js";

const GEMINI_EMBEDDING_MODEL =
  process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;


const RECOMMEND_THRESHOLD = Number(process.env.RECOMMEND_THRESHOLD) || 0.62;
const RELATED_THRESHOLD = Number(process.env.RELATED_THRESHOLD) || 0.75;
const RECOMMEND_K = Number(process.env.RECOMMEND_K) || 5;

if (!GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY environment variable is required");
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

// Long pasted code adds noise, and the key part of a question is at the top.
const MAX_EMBEDDING_CONTENT_CHARS = 2000;


function normalizeQuestionText({ title, content }) {
  const cleanTitle = normalizeWhitespace(`${title || ""}`.normalize("NFKC"));
  const cleanContent = normalizeWhitespace(
    `${content || ""}`.normalize("NFKC"),
  ).slice(0, MAX_EMBEDDING_CONTENT_CHARS);
  if (!cleanContent) return cleanTitle;
  return `Question title: ${cleanTitle}\n\nQuestion details: ${cleanContent}`;
}

/**
 * Calculate cosine similarity between two embedding vectors.
 * Formula: cos(θ) = (A · B) / (||A|| × ||B||)
 *
 * @param {number[]} vectorA - First embedding vector
 * @param {number[]} vectorB - Second embedding vector
 * @returns {number} Similarity score between -1 and 1 (typically 0 to 1 for embeddings)
 * @throws {Error} If vectors have different lengths
 */
function calculateCosineSimilarity(vectorA, vectorB) {
  // Validate vectors have same length
  if (vectorA.length !== vectorB.length) {
    throw new Error(
      `Vectors must have the same length. Got ${vectorA.length} and ${vectorB.length}`,
    );
  }

  // Calculate dot product (sum of element-wise multiplication)
  let dotProduct = 0;
  for (let i = 0; i < vectorA.length; i++) {
    dotProduct += vectorA[i] * vectorB[i];
  }

  // Calculate magnitude of vectorA (square root of sum of squares)
  let magnitudeA = 0;
  for (let i = 0; i < vectorA.length; i++) {
    magnitudeA += vectorA[i] * vectorA[i];
  }
  magnitudeA = Math.sqrt(magnitudeA);

  // Calculate magnitude of vectorB (square root of sum of squares)
  let magnitudeB = 0;
  for (let i = 0; i < vectorB.length; i++) {
    magnitudeB += vectorB[i] * vectorB[i];
  }
  magnitudeB = Math.sqrt(magnitudeB);

  // Handle edge case: return 0 if either magnitude is 0
  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }

  // Return dot product divided by product of magnitudes
  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * Retrieve all ready embeddings from MySQL question_vectors table.
 * Parses JSON embedding strings to JavaScript arrays and validates them.
 * Invalid embeddings are skipped with a warning logged.
 *
 * @returns {Promise<Array<{questionId: number, embedding: number[]}>>} Array of question embeddings
 */
async function retrieveReadyEmbeddings() {
  // Query question_vectors table with status='ready' filter
  const sql = `
    SELECT question_id, embedding
    FROM question_vectors
    WHERE status = ?
  `;

  try {
    const rows = await safeExecute(sql, ["ready"]);

    // Parse and validate embeddings
    const embeddings = [];
    for (const row of rows) {
      try {
        // The database driver might already parse JSON columns into objects/arrays.
        // If it's already an array, use it directly; otherwise, parse it.
        const embedding =
          typeof row.embedding === "string"
            ? JSON.parse(row.embedding)
            : row.embedding;

        // Add valid embedding to results
        embeddings.push({
          questionId: row.question_id,
          embedding: embedding,
        });
      } catch (parseError) {
        console.warn(
          `Skipping question ${row.question_id}: failed to parse embedding JSON`,
          parseError,
        );
        continue;
      }
    }

    return embeddings;
  } catch (error) {
    console.error("=== MYSQL RETRIEVE EMBEDDINGS ERROR ===");
    console.error("Operation: retrieveReadyEmbeddings");
    console.error("Error:", error);
    console.error("=======================================");
    throw error;
  }
}

/**
 * Find similar questions by generating an embedding for the provided text and searching MySQL.
 * @param {Object} params - Search parameters.
 * @param {string} params.sourceText - The text to search for similar questions.
 * @param {number} [params.threshold] - Minimum similarity score threshold.
 * @param {number} [params.k] - Maximum number of results to return.
 * @returns {Promise<Object>} The generated embedding and similar questions.
 */
async function findSimilarQuestionsByText({ sourceText, threshold, k }) {
  // Normalize parameters
  const normalizedK = k > 0 ? Math.min(k, 20) : RECOMMEND_K;
  const normalizedThreshold =
    threshold >= 0 && threshold <= 1 ? threshold : RECOMMEND_THRESHOLD;

  // Use RETRIEVAL_QUERY task type when searching against stored documents
  let embeddingResult;
  try {
    embeddingResult = await generateQuestionEmbedding(sourceText, {
      taskType: "RETRIEVAL_QUERY",
    });
  } catch (error) {
    console.error("=== GEMINI API ERROR DURING SEARCH ===");
    console.error("Operation: findSimilarQuestionsByText");
    console.error("Search text:", sourceText);
    console.error("Error:", error);
    console.error("======================================");
    throw new ServiceUnavailableError(
      "Failed to generate embedding for search query. Please try again later.",
    );
  }

  const queryEmbedding = embeddingResult.embedding;

  // Retrieve all ready embeddings from MySQL
  let storedEmbeddings;
  try {
    storedEmbeddings = await retrieveReadyEmbeddings();
  } catch (error) {
    console.error("=== DATABASE ERROR DURING SEARCH ===");
    console.error("Operation: findSimilarQuestionsByText");
    console.error("Search text:", sourceText);
    console.error("Error:", error);
    console.error("====================================");
    throw error;
  }

  // Calculate cosine similarity for each stored embedding
  const similarities = [];
  for (const stored of storedEmbeddings) {
    try {
      const score = calculateCosineSimilarity(queryEmbedding, stored.embedding);

      // Filter by threshold
      if (score >= normalizedThreshold) {
        similarities.push({
          questionId: stored.questionId,
          score: score,
        });
      }
    } catch (error) {
      console.warn(
        `Failed to calculate similarity for question ${stored.questionId}:`,
        error.message,
      );
      continue;
    }
  }

  // Sort by score descending
  similarities.sort((a, b) => b.score - a.score);

  // Limit to top k results
  const topResults = similarities.slice(0, normalizedK);

  if (topResults.length === 0) {
    return {
      ...embeddingResult,
      similarQuestions: [],
    };
  }

  // Fetch question details using IN clause
  const questionIds = topResults.map((r) => r.questionId);
  const placeholders = questionIds.map(() => "?").join(",");

  const sql = `
    SELECT
      q.question_id AS questionId,
      q.question_hash AS questionHash,
      q.title,
      q.content,
      q.created_at AS createdAt,
      q.updated_at AS updatedAt,
      u.user_id AS userId,
      u.first_name AS firstName,
      u.last_name AS lastName,
      u.avatar AS avatar,
      COUNT(DISTINCT a.answer_id) AS answerCount
    FROM questions q
    JOIN users u ON u.user_id = q.user_id
    LEFT JOIN answers a ON a.question_id = q.question_id
    WHERE q.question_id IN (${placeholders})
    GROUP BY q.question_id, u.user_id
  `;

  let rows;
  try {
    rows = await safeExecute(sql, questionIds);
  } catch (error) {
    console.error("=== DATABASE ERROR FETCHING QUESTION DETAILS ===");
    console.error("Operation: findSimilarQuestionsByText - fetch details");
    console.error("Question IDs:", questionIds);
    console.error("Error:", error);
    console.error("================================================");
    throw error;
  }

  // Map MySQL results to question objects
  const questionMap = {};
  rows.forEach((row) => {
    questionMap[String(row.questionId)] = {
      id: row.questionId,
      questionHash: row.questionHash,
      title: row.title,
      content: row.content,
      answerCount: row.answerCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      author: {
        id: row.userId,
        firstName: row.firstName,
        lastName: row.lastName,
        avatar: row.avatar ?? null,
      },
    };
  });

  // Return results with scores, preserving sort order
  const similarQuestions = topResults
    .filter((result) => questionMap[String(result.questionId)])
    .map((result) => ({
      score: Number(result.score.toFixed(6)),
      ...questionMap[String(result.questionId)],
    }));

  return {
    ...embeddingResult,
    similarQuestions,
  };
}

/**
 * Find similar questions using the pre-calculated embedding of an existing question from MySQL.
 * @param {Object} params - Search parameters.
 * @param {number|string} params.questionId - The ID of the question to find similarities for.
 * @param {number} [params.threshold] - Minimum similarity score threshold.
 * @param {number} [params.k] - Maximum number of results to return.
 * @returns {Promise<Array<Object>>} A list of similar questions.
 */
async function findSimilarQuestionsByQuestionId({ questionId, threshold, k }) {
  // Normalize parameters
  const normalizedK = k > 0 ? Math.min(k, 20) : RECOMMEND_K;
  const normalizedThreshold =
    threshold >= 0 && threshold <= 1 ? threshold : RECOMMEND_THRESHOLD;

  // Retrieve source question embedding from MySQL
  const sql = `
    SELECT embedding, status
    FROM question_vectors
    WHERE question_id = ?
  `;

  let rows;
  try {
    rows = await safeExecute(sql, [questionId]);

    // Return empty array if no embedding or status != 'ready'
    if (rows.length === 0) {
      return [];
    }

    const row = rows[0];
    if (row.status !== "ready") {
      return [];
    }

    // Parse source embedding
    let sourceEmbedding;
    try {
      sourceEmbedding =
        typeof row.embedding === "string"
          ? JSON.parse(row.embedding)
          : row.embedding;

      // Validate source embedding
      if (!Array.isArray(sourceEmbedding) || sourceEmbedding.length === 0) {
        console.warn(
          `Source question ${questionId} has invalid embedding format`,
        );
        return [];
      }

      if (!sourceEmbedding.every((v) => typeof v === "number" && !isNaN(v))) {
        console.warn(
          `Source question ${questionId} has invalid embedding values`,
        );
        return [];
      }
    } catch (parseError) {
      console.warn(
        `Failed to parse embedding for question ${questionId}:`,
        parseError,
      );
      return [];
    }

    // Retrieve all other ready embeddings from MySQL
    let storedEmbeddings;
    try {
      storedEmbeddings = await retrieveReadyEmbeddings();
    } catch (error) {
      console.error("=== DATABASE ERROR DURING SIMILAR QUESTIONS SEARCH ===");
      console.error(
        "Operation: findSimilarQuestionsByQuestionId - retrieve embeddings",
      );
      console.error("Question ID:", questionId);
      console.error("Error:", error);
      console.error("======================================================");
      throw error;
    }

    // Calculate cosine similarity for each stored embedding
    const similarities = [];
    for (const stored of storedEmbeddings) {
      // Exclude source question from results
      if (String(stored.questionId) === String(questionId)) {
        continue;
      }

      try {
        const score = calculateCosineSimilarity(
          sourceEmbedding,
          stored.embedding,
        );

        // Filter by threshold
        if (score >= normalizedThreshold) {
          similarities.push({
            questionId: stored.questionId,
            score: score,
          });
        }
      } catch (error) {
        console.warn(
          `Failed to calculate similarity for question ${stored.questionId}:`,
          error.message,
        );
        continue;
      }
    }

    // Sort by score descending
    similarities.sort((a, b) => b.score - a.score);

    // Limit to top k results
    const topResults = similarities.slice(0, normalizedK);

    if (topResults.length === 0) {
      return [];
    }

    // Fetch question details using IN clause
    const questionIds = topResults.map((r) => r.questionId);
    const placeholders = questionIds.map(() => "?").join(",");

    const detailsSql = `
      SELECT
        q.question_id AS questionId,
        q.question_hash AS questionHash,
        q.title,
        q.content,
        q.created_at AS createdAt,
        q.updated_at AS updatedAt,
        u.user_id AS userId,
        u.first_name AS firstName,
        u.last_name AS lastName,
        u.avatar AS avatar,
        COUNT(DISTINCT a.answer_id) AS answerCount
      FROM questions q
      JOIN users u ON u.user_id = q.user_id
      LEFT JOIN answers a ON a.question_id = q.question_id
      WHERE q.question_id IN (${placeholders})
      GROUP BY q.question_id, u.user_id
    `;

    let detailsRows;
    try {
      detailsRows = await safeExecute(detailsSql, questionIds);
    } catch (error) {
      console.error("=== DATABASE ERROR FETCHING QUESTION DETAILS ===");
      console.error(
        "Operation: findSimilarQuestionsByQuestionId - fetch details",
      );
      console.error("Source Question ID:", questionId);
      console.error("Target Question IDs:", questionIds);
      console.error("SQL:", detailsSql.trim().replace(/\s+/g, " "));
      console.error("Error:", error);
      console.error("================================================");
      throw error;
    }

    // Map MySQL results to question objects
    const questionMap = {};
    detailsRows.forEach((detailRow) => {
      questionMap[String(detailRow.questionId)] = {
        id: detailRow.questionId,
        questionHash: detailRow.questionHash,
        title: detailRow.title,
        content: detailRow.content,
        answerCount: detailRow.answerCount,
        createdAt: detailRow.createdAt,
        updatedAt: detailRow.updatedAt,
        author: {
          id: detailRow.userId,
          firstName: detailRow.firstName,
          lastName: detailRow.lastName,
          avatar: detailRow.avatar ?? null,
        },
      };
    });

    // Return results with scores, preserving sort order
    return topResults
      .filter((result) => questionMap[String(result.questionId)])
      .map((result) => ({
        score: Number(result.score.toFixed(6)),
        ...questionMap[String(result.questionId)],
      }));
  } catch (error) {
    console.error("=== MYSQL FIND SIMILAR BY QUESTION ID ERROR ===");
    console.error("Operation: findSimilarQuestionsByQuestionId");
    console.error("Question ID:", questionId);
    console.error("SQL:", sql.trim().replace(/\s+/g, " "));
    console.error("Error:", error);
    console.error("===============================================");
    throw error;
  }
}

/**
 * Get the current vector search configuration values from environment variables or defaults.
 * @returns {Object} The current vector configuration values.
 */
function getVectorConfig() {
  return {
    recommendThreshold: RECOMMEND_THRESHOLD,
    relatedThreshold: RELATED_THRESHOLD,
    recommendK: RECOMMEND_K,
  };
}
/**
 * Generate a normalized embedding for the provided question text using the Gemini API.
 *
 * @param {string} sourceText - The text to embed.
 * @param {Object} [options] - Optional parameters to customize the embedding generation.
 * @param {string} [options.taskType='RETRIEVAL_DOCUMENT'] - The specific Gemini task type.
 *                 Use 'RETRIEVAL_QUERY' when generating embeddings for user searches.
 * @returns {Promise<{embedding: Array<number>}>} The normalized embedding vector.
 * @throws {Error} If the embedding response is invalid or missing values.
 *
 */

async function generateQuestionEmbedding(sourceText, options = {}) {
  const { taskType = "RETRIEVAL_DOCUMENT", questionId = null } = options;

  // 10 second time limit, and the SDK's own retry when Gemini is busy
  // (429, 5xx). The SDK does not really retry after a timeout.
  const ai = new GoogleGenAI({
    apiKey: GEMINI_API_KEY,
    httpOptions: { timeout: 10000, retryOptions: { attempts: 3 } },
  });
  try {
    const result = await ai.models.embedContent({
      model: GEMINI_EMBEDDING_MODEL,
      contents: sourceText,
      // taskType must be inside config. Outside it, the SDK drops it silently.
      config: {
        taskType,
        outputDimensionality: 768,
      },
    });

    // console.log(result.embeddings[0].values);

    let values = result?.embeddings[0]?.values;

    if (!Array.isArray(values) || values.length === 0) {
      throw new Error("Gemini embedding response does not contain values");
    }

    return {
      embedding: values,
    };
  } catch (error) {
    console.error("Error:", error);
    console.error("========================");
    throw error;
  }
}

/**
 * Validate that an embedding is a valid array of numbers.
 * @param {*} embedding - The embedding to validate.
 * @throws {Error} If embedding is invalid.
 */
function validateEmbedding(embedding) {
  if (!Array.isArray(embedding)) {
    throw new Error("Embedding must be an array");
  }
  if (embedding.length === 0) {
    throw new Error("Embedding cannot be empty");
  }
  if (!embedding.every((v) => typeof v === "number" && !isNaN(v))) {
    throw new Error("Embedding must contain only valid numbers");
  }
}

/**
 * Store the question vector in the database.
 * @param {Object} payload - The payload containing question and embedding data.
 * @param {number|string} payload.questionId - The ID of the question.
 * @param {string} payload.sourceText - The normalized source text used for embedding.
 * @param {Array<number>} [payload.embedding=[]] - The full-dimensional embedding vector from Gemini.
 * @param {string} [payload.status='ready'] - The status of the vector (e.g., 'ready', 'failed').
 * @returns {Promise<void>}
 */
async function storeQuestionVector({
  questionId,
  sourceText,
  embedding = [],
  status = "ready",
}) {
  // Handle empty embeddings for failed status
  if (status === "failed" || !embedding || embedding.length === 0) {
    const sql = `
    INSERT INTO question_vectors (question_id, source_text, embedding, status)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      source_text = VALUES(source_text),
      embedding = VALUES(embedding),
      status = VALUES(status),
      updated_at = CURRENT_TIMESTAMP
  `;

    await safeExecute(sql, [
      questionId,
      sourceText,
      JSON.stringify([]),
      "failed",
    ]);

    return;
  }

  // Validate embedding before storage
  validateEmbedding(embedding);
  // Store embedding as JSON string using JSON.stringify()
  const embeddingJson = JSON.stringify(embedding);

  // Implement MySQL INSERT ... ON DUPLICATE KEY UPDATE for upsert
  const sql = `
  INSERT INTO question_vectors (question_id, source_text, embedding, status)
  VALUES (?, ?, ?, ?)
  ON DUPLICATE KEY UPDATE
    source_text = VALUES(source_text),
    embedding = VALUES(embedding),
    status = VALUES(status),
    updated_at = CURRENT_TIMESTAMP
`;

  try {
    await safeExecute(sql, [questionId, sourceText, embeddingJson, status]);
  } catch (error) {
    console.error("=== MYSQL UPSERT ERROR ===");
    console.error("Operation: storeQuestionVector");
    console.error(`Question ID: ${questionId}`);
    console.error(`Embedding length: ${embedding.length}`);
    console.error(`Status: ${status}`);
    console.error("SQL:", sql.trim().replace(/\s+/g, " "));
    console.error("Error:", error);
    console.error("==========================");
    throw error;
  }
}

/**
 * Embed many texts in ONE Gemini call (used for PDF chunks).
 * One call per chunk is slow and hits the free rate limit on a big PDF.
 *
 * @param {string[]} texts - The texts to embed, in order.
 * @param {Object} [options]
 * @param {string} [options.taskType='RETRIEVAL_DOCUMENT']
 * @returns {Promise<Array<Array<number>>>} One vector per text, same order.
 * @throws {Error} If Gemini does not return one vector for every text.
 */
async function generateEmbeddingsBatch(texts, options = {}) {
  const { taskType = "RETRIEVAL_DOCUMENT" } = options;

  // Same settings as generateQuestionEmbedding, with a longer time limit
  // because one call carries many texts.
  const ai = new GoogleGenAI({
    apiKey: GEMINI_API_KEY,
    httpOptions: { timeout: 30000, retryOptions: { attempts: 3 } },
  });
  const result = await ai.models.embedContent({
    model: GEMINI_EMBEDDING_MODEL,
    contents: texts,
    config: {
      taskType,
      outputDimensionality: 768,
    },
  });

  const vectors = (result?.embeddings ?? []).map((item) => item?.values);
  const allValid =
    vectors.length === texts.length &&
    vectors.every((values) => Array.isArray(values) && values.length > 0);
  if (!allValid) {
    throw new Error("Gemini did not return one embedding for every text");
  }

  return vectors;
}

export {
  normalizeQuestionText,
  calculateCosineSimilarity,
  retrieveReadyEmbeddings,
  generateQuestionEmbedding,
  storeQuestionVector,
  findSimilarQuestionsByText,
  findSimilarQuestionsByQuestionId,
  getVectorConfig,
  generateEmbeddingsBatch,
};
