import { QUESTION_TAGS } from "../constants/question-tags.js";
import {
  calculateCosineSimilarity,
  generateEmbeddingsBatch,
} from "./vector.service.js";

let tagEmbeddings = null;
let tagEmbeddingsPromise = null;
let lastWarmAttemptAt = 0;
const TAG_EMBEDDING_RETRY_DELAY_MS = 60_000;

const getTagEmbeddingTexts = () =>
  QUESTION_TAGS.map(
    ({ name, description, examples }) =>
      `${name}: ${description}. Topics: ${examples}`,
  );

const initializeQuestionTagEmbeddings = async () => {
  if (tagEmbeddings) return tagEmbeddings;
  if (!tagEmbeddingsPromise) {

    tagEmbeddingsPromise = generateEmbeddingsBatch(getTagEmbeddingTexts(), {
      taskType: "RETRIEVAL_QUERY",
    })
      .then((embeddings) => {
        tagEmbeddings = embeddings;
        return embeddings;
      })
      .finally(() => {
        tagEmbeddingsPromise = null;
      });
  }
  return tagEmbeddingsPromise;
};

const warmQuestionTagEmbeddings = () => {
  if (tagEmbeddings || tagEmbeddingsPromise) return;
  if (Date.now() - lastWarmAttemptAt < TAG_EMBEDDING_RETRY_DELAY_MS) return;

  lastWarmAttemptAt = Date.now();
  initializeQuestionTagEmbeddings().catch((error) => {
    console.error("Failed to initialize question tag embeddings:", error);
  });
};

const selectQuestionTag = (questionEmbedding, embeddings) => {
  if (
    !Array.isArray(questionEmbedding) ||
    questionEmbedding.length === 0 ||
    !questionEmbedding.every(
      (value) => typeof value === "number" && Number.isFinite(value),
    )
  ) {
    throw new Error("Question embedding is invalid.");
  }
  if (embeddings.length !== QUESTION_TAGS.length) {
    throw new Error("Question tag embeddings are incomplete.");
  }

  let bestIndex = -1;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < embeddings.length; index += 1) {
    const score = calculateCosineSimilarity(
      questionEmbedding,
      embeddings[index],
    );
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  if (bestIndex < 0 || !Number.isFinite(bestScore)) {
    throw new Error("Could not calculate a question tag.");
  }

  return QUESTION_TAGS[bestIndex].name;
};

const getQuestionTag = (questionEmbedding) => {
  if (!tagEmbeddings) {
    throw new Error("Question tag embeddings are not available yet.");
  }
  return selectQuestionTag(questionEmbedding, tagEmbeddings);
};

export {
  getQuestionTag,
  initializeQuestionTagEmbeddings,
  selectQuestionTag,
  warmQuestionTagEmbeddings,
};
