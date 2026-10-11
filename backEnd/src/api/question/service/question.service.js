import crypto from "crypto";
import { safeExecute } from "../../../../schema/db.config.js";
import {
  findSimilarQuestionsByQuestionId,
  findSimilarQuestionsByText,
  generateQuestionEmbedding,
  getVectorConfig,
  normalizeQuestionText,
  storeQuestionVector,
} from "./vector.service.js";
import {
  getQuestionTag,
  warmQuestionTagEmbeddings,
} from "./question-tagging.service.js";
import {
  BadRequestError,
  NotFoundError,
} from "../../../utility/errors/errors.js";

const generateQuestionHash = () => crypto.randomBytes(8).toString("hex");
// ---- T-10a ---added---
const buildQuestionFilters = (filters) => {
  const conditions = [];
  const params = [];

  if (filters.search) {
    conditions.push("(q.title LIKE ? OR q.content LIKE ?)");
    const searchTerm = `%${filters.search}%`;
    params.push(searchTerm, searchTerm);
  }

  if (filters.mine && filters.userId) {
    conditions.push("q.user_id = ?");
    params.push(filters.userId);
  }

  if (filters.tag) {
    conditions.push("q.tag = ?");
    params.push(filters.tag);
  }

  if (conditions.length === 0) {
    return { whereClause: "", params };
  }

  return {
    whereClause: `WHERE ${conditions.join(" AND ")}`,
    params,
  };
};
const getQuestionsService = async (filters) => {
  const normalizedLimit = 100; // Fixed max 100 records
  const sortColumn = "q.created_at";
  const normalizedSortOrder = "DESC";

  const { whereClause, params } = buildQuestionFilters(filters);

  const listSql = `
    SELECT
      q.question_id AS id,
      q.question_hash AS questionHash,
      q.title,
      q.content,
      q.tag,
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
    ${whereClause}
    GROUP BY q.question_id, u.user_id
    ORDER BY ${sortColumn} ${normalizedSortOrder}
    LIMIT ${normalizedLimit}
  `;

  const rows = await safeExecute(listSql, params);

  return {
    data: rows.map((question) => ({
      id: question.id,
      questionHash: question.questionHash,
      title: question.title,
      content: question.content,
      tag: question.tag,
      answerCount: question.answerCount,
      createdAt: question.createdAt,
      updatedAt: question.updatedAt,
      author: {
        id: question.userId,
        firstName: question.firstName,
        lastName: question.lastName,
        avatar: question.avatar ?? null,
      },
    })),
    meta: {
      limit: normalizedLimit,
      total: rows.length,
      sortBy: "newest",
      sortOrder: normalizedSortOrder,
    },
  };
};

// ---- T-10b ----
const getSingleQuestionService = async ({ questionHash }) => {
  const normalizedAnswerLimit = 100; // Fixed max 100 records

  const questionSql = `
    SELECT
      q.question_id AS id,
      q.question_hash AS questionHash,
      q.title,
      q.content,
      q.tag,
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
    WHERE q.question_hash = ?
    GROUP BY q.question_id, u.user_id
  `;
  const questionRows = await safeExecute(questionSql, [questionHash]);

  if (questionRows.length === 0) {
    throw new NotFoundError("Question not found");
  }

  const question = questionRows[0];
  const questionId = question.id;

  const answersSql = `
    SELECT
      a.answer_id AS id,
      a.content,
      a.created_at AS createdAt,
      a.updated_at AS updatedAt,
      au.user_id AS userId,
      au.first_name AS firstName,
      au.last_name AS lastName,
      au.avatar AS avatar
    FROM answers a
    JOIN users au ON au.user_id = a.user_id
    WHERE a.question_id = ?
    ORDER BY a.created_at DESC
    LIMIT ${normalizedAnswerLimit}
  `;
  const answers = await safeExecute(answersSql, [questionId]);

  return {
    question: {
      id: question.id,
      questionHash: question.questionHash,
      title: question.title,
      content: question.content,
      tag: question.tag,
      answerCount: question.answerCount,
      createdAt: question.createdAt,
      updatedAt: question.updatedAt,
      author: {
        id: question.userId,
        firstName: question.firstName,
        lastName: question.lastName,
        avatar: question.avatar ?? null,
      },
    },
    answers: answers.map((answer) => ({
      id: answer.id,
      content: answer.content,
      createdAt: answer.createdAt,
      updatedAt: answer.updatedAt,
      author: {
        id: answer.userId,
        firstName: answer.firstName,
        lastName: answer.lastName,
        avatar: answer.avatar ?? null,
      },
    })),
    answersMeta: {
      limit: normalizedAnswerLimit,
      total: answers.length,
    },
  };
};
/**
 * Creates a new question and stores its vector embedding for semantic search.
 * @param {Object} payload - The question data
 * @param {string} payload.userId - ID of the user creating the question
 * @param {string} payload.title - Title of the question
 * @param {string} payload.content - Content/body of the question
 * @returns {Promise<Object>} Object containing the created question
 */
const createQuestionWithVectorService = async (payload) => {
  // Extract required fields from the payload
  const { userId, title, content } = payload;

  // Prepare the SQL statement for inserting a new question
  const insertQuestionSql =
    "INSERT INTO questions (question_hash, user_id, title, content, tag) VALUES (?, ?, ?, ?, NULL)";

  // Generate a unique hash for the question
  const questionHash = generateQuestionHash();

  let questionResult;

  try {
    // Execute the insertion query safely
    questionResult = await safeExecute(insertQuestionSql, [
      questionHash,
      userId,
      title,
      content,
    ]);
  } catch (error) {
    // Handle specific foreign key constraint error for non-existent user
    if (error?.code === "ER_NO_REFERENCED_ROW_2") {
      throw new BadRequestError("User does not exist.");
    }

    throw error;
  }

  // Retrieve the auto-generated ID of the newly inserted question
  const questionId = questionResult.insertId;

  // Construct the result object representing the created question
  const creationResult = {
    id: questionId,
    questionHash,
    title,
    content,
    userId,
    tag: null,
  };

  // Normalize the question text (title and content) to prepare it for vector embedding
  const sourceText = normalizeQuestionText({
    title: payload.title,
    content: payload.content,
  });

  let questionEmbedding;
  try {
    // Generate the vector embedding for the normalized question text
    const embeddingResult = await generateQuestionEmbedding(sourceText, {
      questionId: creationResult.id,
    });

    // Validate that a valid embedding was returned from the API
    if (
      !embeddingResult ||
      !embeddingResult.embedding ||
      embeddingResult.embedding.length === 0
    ) {
      throw new Error("Gemini API returned an empty or invalid embedding");
    }

    questionEmbedding = embeddingResult.embedding;

    // Store the generated vector embedding in the database with a 'ready' status
    await storeQuestionVector({
      questionId: creationResult.id,
      sourceText,
      embedding: embeddingResult.embedding,
      status: "ready",
    });
  } catch (error) {
    // Log detailed error information if vector generation or storage fails
    console.error("=== FAILED TO STORE VECTOR FOR QUESTION ===");
    console.error("Question ID:", creationResult.id);
    console.error("Operation: question creation");
    console.error("Error:", error);
    console.error("===========================================");

    // Explicitly record the failure state in the database so it can be retried or tracked later
    await storeQuestionVector({
      questionId: creationResult.id,
      sourceText,
      embedding: [],
      status: "failed",
    }).catch((e) => console.error("Failed to save failed status", e));
  }

  if (questionEmbedding) {
    try {
      const tag = getQuestionTag(questionEmbedding);
      await safeExecute("UPDATE questions SET tag = ? WHERE question_id = ?", [
        tag,
        questionId,
      ]);
      creationResult.tag = tag;
    } catch (error) {
      console.error("Failed to tag question", questionId, error);
      warmQuestionTagEmbeddings();
      try {
        await safeExecute(
          "UPDATE questions SET tag = NULL WHERE question_id = ?",
          [questionId],
        );
      } catch (updateError) {
        console.error(
          "Failed to clear question tag after tagging error",
          questionId,
          updateError,
        );
      }
    }
  }

  // Return the created question object
  return {
    question: creationResult,
  };
};

/**
 * Performs semantic search on questions using vector similarity.
 * @param {Object} params - Search parameters
 * @param {string} params.query - The search query text
 * @param {number} [params.k=5] - Maximum number of similar questions to return
 * @param {number} [params.threshold] - Similarity threshold (uses config default if not provided)
 * @returns {Promise<Object>} Object containing similar questions and search metadata
 */
const searchQuestionsSemanticService = async ({ query, k = 5, threshold }) => {
  const sourceText = normalizeQuestionText({ title: query });
  const vectorConfig = getVectorConfig();
  const searchThreshold =
    threshold !== undefined ? threshold : vectorConfig.recommendThreshold;
  const result = await findSimilarQuestionsByText({
    sourceText,
    threshold: searchThreshold,
    k,
  });
  return {
    data: result.similarQuestions,
    meta: {
      query,
      k,
      threshold: searchThreshold,
      total: result.similarQuestions.length,
    },
  };
};

const getSimilarQuestionsService = async ({
  questionHash,
  k = 5,
  threshold,
}) => {
  const questionRows = await safeExecute(
    "SELECT question_id AS id FROM questions WHERE question_hash = ? LIMIT 1",
    [questionHash],
  );
  if (questionRows.length === 0) {
    throw new NotFoundError("Question not found");
  }
  const questionId = questionRows[0].id;
  const vectorConfig = getVectorConfig();
  const searchThreshold =
    threshold !== undefined ? threshold : vectorConfig.relatedThreshold;
  const similarQuestions = await findSimilarQuestionsByQuestionId({
    questionId,
    threshold: searchThreshold,
    k,
  });
  return {
    data: similarQuestions,
    meta: {
      questionHash,
      k,
      threshold: searchThreshold,
      total: similarQuestions.length,
    },
  };
};

// A question that does not exist and a question that belongs to someone else
// both report "not found".
const updateQuestionService = async ({
  questionHash,
  userId,
  title,
  content,
}) => {
  const rows = await safeExecute(
    "SELECT question_id AS id, user_id, title, content, tag FROM questions WHERE question_hash = ?",
    [questionHash],
  );
  if (rows.length === 0 || rows[0].user_id !== userId) {
    throw new NotFoundError("Question not found");
  }
  const question = rows[0];

  const contentChanged =
    title !== question.title || content !== question.content;
  let updatedTag = contentChanged ? null : question.tag;
  await safeExecute(
    "UPDATE questions SET title = ?, content = ?, tag = ? WHERE question_id = ?",
    [title, content, contentChanged ? null : question.tag, question.id],
  );


  if (contentChanged) {
    const sourceText = normalizeQuestionText({ title, content });
    let embedding;
    try {
      const result = await generateQuestionEmbedding(sourceText, {
        questionId: question.id,
      });
      embedding = result.embedding;
      await storeQuestionVector({
        questionId: question.id,
        sourceText,
        embedding,
        status: "ready",
      });
    } catch (error) {
      console.error("Failed to refresh question vector", question.id, error);
      await storeQuestionVector({
        questionId: question.id,
        sourceText,
        embedding: [],
        status: "failed",
      }).catch((e) => console.error("Failed to save failed status", e));
    }

    if (embedding) {
      try {
        const tag = getQuestionTag(embedding);
        await safeExecute(
          "UPDATE questions SET tag = ? WHERE question_id = ?",
          [tag, question.id],
        );
        updatedTag = tag;
      } catch (error) {
        console.error("Failed to retag question", question.id, error);
        warmQuestionTagEmbeddings();
        await safeExecute(
          "UPDATE questions SET tag = NULL WHERE question_id = ?",
          [question.id],
        ).catch((updateError) =>
          console.error(
            "Failed to clear tag after retagging error",
            question.id,
            updateError,
          ),
        );
      }
    }
  }

  return {
    questionHash,
    title,
    content,
    tag: updatedTag,
  };
};

// Its answers and its stored vector are removed by ON DELETE CASCADE.
const deleteQuestionService = async ({ questionHash, userId }) => {
  const result = await safeExecute(
    "DELETE FROM questions WHERE question_hash = ? AND user_id = ?",
    [questionHash, userId],
  );
  if (result.affectedRows === 0) {
    throw new NotFoundError("Question not found");
  }
};

export {
  getSingleQuestionService,
  createQuestionWithVectorService,
  getSimilarQuestionsService,
  searchQuestionsSemanticService,
  getQuestionsService,
  updateQuestionService,
  deleteQuestionService,
};
