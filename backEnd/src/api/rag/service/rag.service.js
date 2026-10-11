
import fs from "node:fs/promises";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import { safeExecute } from "../../../../schema/db.config.js";
import { BadRequestError } from "../../../utility/errors/errors.js";
import { NotFoundError } from "../../../utility/errors/errors.js";
import { ServiceUnavailableError } from "../../../utility/errors/errors.js";
import { calculateCosineSimilarity } from "../../question/service/vector.service.js";
import { generateEmbeddingsBatch } from "../../question/service/vector.service.js";
import { generateQuestionEmbedding } from "../../question/service/vector.service.js";
import { answerFromRagChunksService } from "../../question/service/geminiTextCoach.service.js";
import { RAG_UPLOAD_DIR } from "../config/rag.upload.config.js";

// ---- T-24b (Haymanot Y.): assertOwnedDocument (shared by 5 tasks), getDocumentMetaService ----
/**
 * Fetch a document and prove the caller owns it. A document that belongs to
 * someone else is reported as 404, not 403: the caller should not learn that
 * the id exists at all. Shared by T-24c, T-24d, T-23a and T-23b.
 */
export const assertOwnedDocument = async (documentId, userId) => {
  const rows = await safeExecute(
    `SELECT document_id, title, mime_type, byte_size, status, error_message,
            created_at, updated_at, user_id, storage_path
       FROM documents
      WHERE document_id = ? AND user_id = ?
      LIMIT 1`,
    [documentId, userId],
  );

  if (rows.length === 0) throw new NotFoundError("Document not found");

  return rows[0];
};

export const getDocumentMetaService = async ({ documentId, userId }) => {
  const row = await assertOwnedDocument(documentId, userId);
  // byte_size is BIGINT in MySQL, so make sure the JSON holds a number.
  return { ...row, byte_size: Number(row.byte_size) };
};
// ---- end T-24b ----

// ---- T-22 (Yabets): extractPdfText, chunkTextWithOverlap, embedChunks, createDocumentFromUploadService ----
const CHUNK_CHARS = Number(process.env.RAG_CHUNK_CHARS) || 1000;
const CHUNK_OVERLAP = Number(process.env.RAG_CHUNK_OVERLAP) || 150;
const MAX_CHUNKS_PER_DOC = Number(process.env.RAG_MAX_CHUNKS_PER_DOC) || 1000;
const MAX_PDFS_PER_USER = Number(process.env.RAG_MAX_PDFS_PER_USER) || 20;
const MIN_TEXT_CHARS = Number(process.env.RAG_MIN_TEXT_CHARS) || 50;
// How many chunks go to Gemini in one embedding call.
const EMBED_BATCH_SIZE = 20;

const cleanText = (text) =>
  text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();

/** Read the PDF and return its pages: [{ num, text }]. */
export const extractPdfText = async (absolutePath) => {
  const parser = new PDFParse({ data: await fs.readFile(absolutePath) });

  try {
    const result = await parser.getText();
    return { pages: result.pages ?? [] };
  } catch (error) {
    // A file that is not really a PDF, is corrupt, or is password protected is
    // the caller's problem, not a server fault: report it as 400, not 500.
    throw new BadRequestError(
      `Could not read this PDF (${error?.message ?? "unknown error"}). It may be corrupted or password protected.`,
    );
  } finally {
    await parser.destroy().catch(() => {});
  }
};

/**
 * Build the document text from the pages, and remember where each page starts
 * and ends in that text. pdf-parse's own full text has "-- 1 of 4 --" markers
 * between pages: they would land inside chunks and shift every page offset.
 * The pages are cleaned the same way chunkTextWithOverlap cleans, so offsets
 * stay equal.
 */
const buildDocumentText = (pages) => {
  const parts = [];
  const pageIndex = [];
  let offset = 0;

  for (const page of pages ?? []) {
    const text = cleanText(page.text ?? "");
    if (!text) continue;
    pageIndex.push({ num: page.num, start: offset, end: offset + text.length });
    parts.push(text);
    offset += text.length + 1; // +1 for the newline joining pages
  }

  return { text: parts.join("\n"), pageIndex };
};

/** Map a character offset back to the PDF page it came from. */
const pageAt = (pageIndex, offset) => {
  const hit = pageIndex.find((p) => offset >= p.start && offset <= p.end);
  return hit ? hit.num : null;
};

/**
 * Slice text into overlapping windows. The overlap matters: without it a
 * sentence that sits on a boundary is in neither chunk cleanly and stops
 * being retrievable. Windows start and end on whole words.
 */
export const chunkTextWithOverlap = (text) => {
  const clean = cleanText(text);
  const chunks = [];
  let start = 0;

  while (start < clean.length && chunks.length < MAX_CHUNKS_PER_DOC) {
    let end = Math.min(start + CHUNK_CHARS, clean.length);

    if (end < clean.length) {
      // Prefer to cut at the last space in the window rather than mid-word.
      const lastSpace = clean.lastIndexOf(" ", end);
      if (lastSpace > start + CHUNK_CHARS * 0.5) end = lastSpace;
    }

    const content = clean.slice(start, end).trim();
    if (content) chunks.push({ content, start, end });

    if (end >= clean.length) break;

    // Step back for the overlap, then move forward to the next word start,
    // so a chunk never begins in the middle of a word ("hunking", "er ...").
    let next = Math.max(end - CHUNK_OVERLAP, start + 1);
    const space = clean.indexOf(" ", next);
    if (space !== -1 && space < end) next = space + 1;
    start = next;
  }

  return chunks;
};

/**
 * Embed every chunk as RETRIEVAL_DOCUMENT and return one vector per chunk, in
 * order. The chunks go in batches: one Gemini call for up to 20 chunks. One
 * call per chunk is slow and hits the free rate limit on a big PDF.
 */
export const embedChunks = async (chunks) => {
  const vectors = [];

  for (let first = 0; first < chunks.length; first += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(first, first + EMBED_BATCH_SIZE);
    const embeddings = await generateEmbeddingsBatch(
      batch.map((chunk) => chunk.content),
      { taskType: "RETRIEVAL_DOCUMENT" },
    );
    vectors.push(...embeddings);
  }

  return vectors;
};

/**
 * Upload pipeline: record the document, parse it, chunk it, embed every chunk,
 * then mark it ready. The row is inserted before the slow work so the document
 * is visible as 'processing', and any failure is written back to that row
 * rather than vanishing.
 */
export const createDocumentFromUploadService = async ({ userId, file }) => {
  if (!file) throw new BadRequestError("A PDF file is required.");

  const storagePath = path
    .relative(path.resolve(RAG_UPLOAD_DIR), file.path)
    .replace(/\\/g, "/");

  const [{ count }] = await safeExecute(
    "SELECT COUNT(*) AS count FROM documents WHERE user_id = ?",
    [userId],
  );

  if (count >= MAX_PDFS_PER_USER) {
    await fs.unlink(file.path).catch(() => {});
    throw new BadRequestError(
      `You can keep at most ${MAX_PDFS_PER_USER} documents. Delete one first.`,
    );
  }

  const insert = await safeExecute(
    `INSERT INTO documents (user_id, title, mime_type, storage_path, byte_size, status)
     VALUES (?, ?, ?, ?, ?, 'processing')`,
    [userId, file.originalname, file.mimetype, storagePath, file.size],
  );

  const documentId = insert.insertId;

  try {
    const { pages } = await extractPdfText(file.path);
    const { text, pageIndex } = buildDocumentText(pages);

    if (text.length < MIN_TEXT_CHARS) {
      throw new BadRequestError(
        "No readable text found in this PDF. Scanned images need OCR first.",
      );
    }

    const chunks = chunkTextWithOverlap(text);

    if (chunks.length === 0) {
      throw new BadRequestError("The PDF produced no usable text chunks.");
    }

    // All vectors first, then the rows: if Gemini fails, no half-saved chunks.
    const embeddings = await embedChunks(chunks);

    for (const [chunkIndex, chunk] of chunks.entries()) {
      const chunkRow = await safeExecute(
        `INSERT INTO document_chunks
           (document_id, chunk_index, content, page_start, page_end)
         VALUES (?, ?, ?, ?, ?)`,
        [
          documentId,
          chunkIndex,
          chunk.content,
          pageAt(pageIndex, chunk.start),
          pageAt(pageIndex, chunk.end - 1),
        ],
      );

      await safeExecute(
        `INSERT INTO document_chunk_vectors (chunk_id, source_text, embedding, status)
         VALUES (?, ?, ?, 'ready')`,
        [
          chunkRow.insertId,
          chunk.content,
          JSON.stringify(embeddings[chunkIndex]),
        ],
      );
    }

    await safeExecute(
      "UPDATE documents SET status = 'ready', error_message = NULL WHERE document_id = ?",
      [documentId],
    );

    const [row] = await safeExecute(
      `SELECT document_id, title, mime_type, byte_size, status, error_message,
              created_at, updated_at, user_id, storage_path
         FROM documents WHERE document_id = ?`,
      [documentId],
    );

    return {
      document: { ...row, byte_size: Number(row.byte_size) },
      chunks: chunks.length,
    };
  } catch (error) {
    // Our own errors (bad PDF, no text) carry a statusCode and a message that
    // is safe to show. Anything else is Gemini or the database failing: the
    // user gets a plain "try again" text, the details go to the server log.
    const isOurError = Boolean(error?.statusCode);
    const reason = isOurError
      ? String(error.message).slice(0, 1000)
      : "The AI service did not answer while indexing this PDF. Delete it and upload it again later.";

    // Record why it failed so the row explains itself in the documents list.
    await safeExecute(
      "UPDATE documents SET status = 'failed', error_message = ? WHERE document_id = ?",
      [reason, documentId],
    ).catch(() => {});

    if (isOurError) throw error;
    console.error("createDocumentFromUploadService:", error);
    throw new ServiceUnavailableError(
      "Could not index this PDF right now. Please try again later.",
    );
  }
};
// ---- end T-22 ----

// ---- T-24a (Natinael): listDocumentsForUserService ----
export const listDocumentsForUserService = async (userId) => {
  // No user_id and no storage_path here: the list does not need them.
  const rows = await safeExecute(
    `SELECT document_id, title, mime_type, byte_size, status, error_message,
            created_at, updated_at
       FROM documents
      WHERE user_id = ?
      ORDER BY created_at DESC`,
    [userId],
  );

  // byte_size is BIGINT in MySQL, so make sure the JSON holds a number.
  return rows.map((row) => ({ ...row, byte_size: Number(row.byte_size) }));
};
// ---- end T-24a ----

// ---- T-24c (Wonde): resolveDocumentAbsolutePath (reused by T-24d) ----
/**
 * Absolute path on disk for a storage_path stored in the documents table.
 * Reused by T-24d to delete the file.
 */
export const resolveDocumentAbsolutePath = (storagePath) =>
  path.resolve(process.env.RAG_UPLOAD_DIR || "uploads/rag", storagePath);
// ---- end T-24c ----

// ---- T-23a (Abel): embedQueryText, rankChunksByCosine, searchInDocumentService ----
// Measured with the real Gemini on a real PDF: a phrase that matches scores
// 0.64 to 0.70. Off-topic queries score 0.53 ("pasta recipe") and up to 0.61
// when they sound technical ("how to use bootstrap").
const SEARCH_THRESHOLD = Number(process.env.RAG_SEARCH_THRESHOLD) || 0.62;
const SEARCH_K = Number(process.env.RAG_SEARCH_K) || 10;

/** Turn the search text into a vector. A query uses RETRIEVAL_QUERY. */
export const embedQueryText = async (query) => {
  const { embedding } = await generateQuestionEmbedding(query, {
    taskType: "RETRIEVAL_QUERY",
  });
  return embedding;
};

/**
 * Score every chunk row against the query vector with cosine similarity, keep
 * the ones above the threshold, best first, at most k.
 */
export const rankChunksByCosine = (queryVector, rows, k) => {
  const scored = [];

  for (const row of rows) {
    const stored =
      typeof row.embedding === "string"
        ? JSON.parse(row.embedding)
        : row.embedding;

    if (!Array.isArray(stored) || stored.length !== queryVector.length)
      continue;

    const score = calculateCosineSimilarity(queryVector, stored);
    if (score >= SEARCH_THRESHOLD) {
      scored.push({
        chunkId: row.chunk_id,
        chunkIndex: row.chunk_index,
        pageStart: row.page_start,
        pageEnd: row.page_end,
        score: Number(score.toFixed(6)),
        excerpt: row.content,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, Math.min(k, SEARCH_K));
};

/**
 * Rank this document's chunks against a query. Same maths as forum semantic
 * search, scoped to one document's vectors.
 */
export const searchInDocumentService = async ({
  documentId,
  userId,
  query,
  k = 5,
}) => {
  const document = await assertOwnedDocument(documentId, userId);

  if (document.status !== "ready") {
    throw new BadRequestError(
      `This document is '${document.status}', so it cannot be searched yet.`,
    );
  }

  const queryVector = await embedQueryText(query);

  const rows = await safeExecute(
    `SELECT c.chunk_id, c.chunk_index, c.content, c.page_start, c.page_end,
            v.embedding
       FROM document_chunks c
       JOIN document_chunk_vectors v ON v.chunk_id = c.chunk_id
      WHERE c.document_id = ? AND v.status = 'ready'`,
    [documentId],
  );

  return { query, results: rankChunksByCosine(queryVector, rows, k) };
};
// ---- end T-23a ----

// ---- T-23b (Desalew): queryDocumentService ----
/**
 * Retrieval-augmented answer: find the best chunks, then let Gemini answer
 * using only those. The cited chunks come back as citations so the answer can
 * be checked against the source.
 */
export const queryDocumentService = async ({ documentId, userId, query }) => {
  const { results } = await searchInDocumentService({
    documentId,
    userId,
    query,
    k: 5,
  });

  // Nothing close enough: say so, and do not spend a Gemini call.
  if (results.length === 0) {
    return {
      answer:
        "I could not find anything in this document that answers that question.",
      citations: [],
      chunksUsed: [],
    };
  }

  const { answer } = await answerFromRagChunksService({
    query,
    chunks: results.map((hit, index) => ({
      ref: index + 1,
      text: hit.excerpt,
    })),
  });

  // Honest sources: list only the chunks the answer really cites as [n].
  const citedRefs = new Set(
    [...answer.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1])),
  );
  const cited = results
    .map((hit, index) => ({ ref: index + 1, hit }))
    .filter(({ ref }) => citedRefs.has(ref));

  return {
    answer,
    citations: cited.map(({ ref, hit }) => ({
      ref,
      chunkIndex: hit.chunkIndex,
      pageStart: hit.pageStart,
    })),
    chunksUsed: cited.map(({ hit }) => hit.chunkId),
  };
};
// ---- end T-23b ----

// ---- T-24d (Haymanot B.): removeDocumentFileFromDisk, deleteDocumentService ----
/** Remove the PDF from disk. A file that is already gone is not an error. */
export const removeDocumentFileFromDisk = async (storagePath) => {
  try {
    await fs.unlink(resolveDocumentAbsolutePath(storagePath));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.error("removeDocumentFileFromDisk: could not remove file", error);
    }
  }
};

export const deleteDocumentService = async ({ documentId, userId }) => {
  const document = await assertOwnedDocument(documentId, userId);

  // Remove the file first; a missing file should not block the row deletion.
  await removeDocumentFileFromDisk(document.storage_path);

  // document_chunks and document_chunk_vectors cascade from the foreign keys.
  await safeExecute(
    "DELETE FROM documents WHERE document_id = ? AND user_id = ?",
    [documentId, userId],
  );

  return { id: documentId };
};
// ---- end T-24d ----
