import { safeExecute } from "../../../../schema/db.config.js";
import {
  BadRequestError,
  NotFoundError,
} from "../../../utility/errors/errors.js";

const getQuestionOwner = async (questionId) => {
  const rows = await safeExecute(
    "SELECT question_id, user_id FROM questions WHERE question_id = ? LIMIT 1",
    [questionId],
  );
  if (rows.length === 0) {
    throw new NotFoundError("Question not found");
  }
  return rows[0];
};

/**
 * Generates the SQL ORDER BY clause for answers based on the sort criteria.
 * @param {string} sortBy - The sort criteria ('newest' or 'oldest').
 * @returns {string} The SQL ORDER BY string.
 */
const getAnswerSortSql = (sortBy) => {
  if (sortBy === "oldest") {
    return "a.created_at ASC";
  }
  return "a.created_at DESC";
};

const mapAnswer = (row) => ({
  id: row.id,
  questionId: row.questionId,
  content: row.content,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  author: {
    id: row.userId,
    firstName: row.firstName,
    lastName: row.lastName,
    avatar: row.avatar ?? null,
  },
});

const createAnswerService = async ({ questionId, userId, content }) => {
  const question = await getQuestionOwner(questionId);
  if (question.user_id === userId) {
    throw new BadRequestError("You cannot answer your own question");
  }

  const getSingleAnswerService = async (answerId) => {
    const sql = `
    SELECT
      a.answer_id AS id,
      a.question_id AS questionId,
      a.content,
      a.created_at AS createdAt,
      a.updated_at AS updatedAt,
      u.user_id AS userId,
      u.first_name AS firstName,
      u.last_name AS lastName,
      u.avatar AS avatar
    FROM answers a
    JOIN users u ON u.user_id = a.user_id
    WHERE a.answer_id = ?
    LIMIT 1
  `;
    const rows = await safeExecute(sql, [answerId]);
    if (rows.length === 0) {
      throw new NotFoundError("Answer not found");
    }
    return mapAnswer(rows[0]);
  };

  const insertSql =
    "INSERT INTO answers (question_id, user_id, content) VALUES (?, ?, ?)";
  const result = await safeExecute(insertSql, [questionId, userId, content]);

  return getSingleAnswerService(result.insertId);
};

/**
 * Retrieves a list of answers for a specific question.
 * @param {Object} params - The search parameters.
 * @param {number|string} params.questionId - The ID of the question.
 * @param {string} [params.sortBy='newest'] - The sort order ('newest' or 'oldest').
 * @returns {Promise<Object>} An object containing the list of answers and pagination metadata.
 */
const getAnswersService = async ({ questionId, sortBy = "newest" }) => {
  await getQuestionOwner(questionId);

  const normalizedLimit = 100; // Fixed max 100 records
  const sortClause = getAnswerSortSql(sortBy);

  const listSql = `
    SELECT
      a.answer_id AS id,
      a.question_id AS questionId,
      a.content,
      a.created_at AS createdAt,
      a.updated_at AS updatedAt,
      u.user_id AS userId,
      u.first_name AS firstName,
      u.last_name AS lastName,
      u.avatar AS avatar
    FROM answers a
    JOIN users u ON u.user_id = a.user_id
    WHERE a.question_id = ?
    ORDER BY ${sortClause}
    LIMIT ${normalizedLimit}
  `;
  const rows = await safeExecute(listSql, [questionId]);

  return {
    data: rows.map(mapAnswer),
    meta: {
      limit: normalizedLimit,
      total: rows.length,
      sortBy,
    },
  };
};


const updateAnswerService = async ({ answerId, userId, content }) => {
  const result = await safeExecute(
    "UPDATE answers SET content = ? WHERE answer_id = ? AND user_id = ?",
    [content, answerId, userId],
  );
  if (result.affectedRows === 0) {
    throw new NotFoundError("Answer not found");
  }
  return { id: answerId, content };
};

const deleteAnswerService = async ({ answerId, userId }) => {
  const result = await safeExecute(
    "DELETE FROM answers WHERE answer_id = ? AND user_id = ?",
    [answerId, userId],
  );
  if (result.affectedRows === 0) {
    throw new NotFoundError("Answer not found");
  }
};

export {
  createAnswerService,
  getAnswersService,
  updateAnswerService,
  deleteAnswerService,
};
