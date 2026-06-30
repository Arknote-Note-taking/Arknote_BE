const supabase = require('../config/supabaseClient');
const { createEmbedding, cosineSimilarity } = require('./embeddingService');

const CHUNK_SIZE = 500;       // characters per chunk
const CHUNK_OVERLAP = 80;     // overlap between adjacent chunks
const DEFAULT_TOP_K = 7;      // default number of chunks to retrieve

/**
 * Split a document's text into overlapping chunks.
 */
const splitIntoChunks = (text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) => {
  if (!text || text.length === 0) return [];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    const chunk = text.substring(start, end).trim();
    if (chunk.length > 20) {
      chunks.push(chunk);
    }
    if (end >= text.length) break;
    start += size - overlap;
  }
  return chunks;
};

/**
 * Create and store embedding chunks for a document into Supabase.
 * Deletes existing chunks first to allow regeneration.
 */
const storeChunks = async (documentId, userId, content) => {
  try {
    const chunks = splitIntoChunks(content);
    if (chunks.length === 0) {
      console.log(`[RAG] No chunks to store for document: ${documentId}`);
      return;
    }

    // Delete existing chunks for this document (re-indexing on re-upload)
    await supabase.from('document_chunks').delete().eq('document_id', documentId);

    console.log(`[RAG] Storing ${chunks.length} chunks for document: ${documentId}`);

    const chunksToInsert = [];
    for (let i = 0; i < chunks.length; i++) {
      try {
        const embedding = await createEmbedding(chunks[i]);
        chunksToInsert.push({
          document_id: documentId,
          user_id: userId,
          chunk_index: i,
          content: chunks[i],
          embedding: JSON.stringify(embedding)
        });
      } catch (embErr) {
        console.warn(`[RAG] Failed to embed chunk ${i} for doc ${documentId}:`, embErr.message);
        // Store chunk without embedding as fallback
        chunksToInsert.push({
          document_id: documentId,
          user_id: userId,
          chunk_index: i,
          content: chunks[i],
          embedding: null
        });
      }
    }

    // Batch insert chunks
    const BATCH_SIZE = 20;
    for (let b = 0; b < chunksToInsert.length; b += BATCH_SIZE) {
      const batch = chunksToInsert.slice(b, b + BATCH_SIZE);
      const { error: insertErr } = await supabase.from('document_chunks').insert(batch);
      if (insertErr) {
        console.error(`[RAG] Failed to insert chunk batch for doc ${documentId}:`, insertErr.message);
      }
    }

    console.log(`[RAG] Successfully stored ${chunksToInsert.length} chunks for document: ${documentId}`);
  } catch (err) {
    console.error(`[RAG] storeChunks error for ${documentId}:`, err);
    // Non-fatal — don't throw; RAG failure shouldn't block document upload
  }
};

/**
 * Retrieve the most relevant text chunks for a given query from a document.
 * Uses cosine similarity. Falls back to first N chunks or null.
 */
const retrieveRelevantChunks = async (documentId, queryText, topK = DEFAULT_TOP_K) => {
  try {
    const { data: chunks, error: fetchErr } = await supabase
      .from('document_chunks')
      .select('chunk_index, content, embedding')
      .eq('document_id', documentId)
      .order('chunk_index', { ascending: true });

    if (fetchErr || !chunks || chunks.length === 0) {
      console.warn(`[RAG] No chunks found for document ${documentId}, falling back to full content`);
      return null;
    }

    // If no embeddings stored yet, return first N chunks
    const hasEmbeddings = chunks.some(c => c.embedding !== null);
    if (!hasEmbeddings) {
      console.log(`[RAG] No embeddings available for doc ${documentId}, using first ${topK} chunks`);
      return chunks.slice(0, topK).map(c => c.content).join('\n\n');
    }

    // Generate embedding for the query intent
    const queryEmbedding = await createEmbedding(queryText);

    // Score each chunk by cosine similarity
    const scored = chunks
      .filter(c => c.embedding !== null)
      .map(c => {
        let chunkVec;
        try {
          chunkVec = typeof c.embedding === 'string' ? JSON.parse(c.embedding) : c.embedding;
        } catch {
          return { content: c.content, score: 0, index: c.chunk_index };
        }
        return {
          content: c.content,
          score: cosineSimilarity(queryEmbedding, chunkVec),
          index: c.chunk_index
        };
      });

    // Sort by similarity, take topK, then re-sort by original index (document flow)
    const topChunks = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .sort((a, b) => a.index - b.index);

    const avgScore = topChunks.reduce((s, c) => s + c.score, 0) / topChunks.length;
    console.log(`[RAG] Retrieved ${topChunks.length} chunks for doc ${documentId} (avg similarity: ${avgScore.toFixed(3)})`);

    return topChunks.map(c => c.content).join('\n\n');
  } catch (err) {
    console.error(`[RAG] retrieveRelevantChunks error for ${documentId}:`, err);
    return null;
  }
};

module.exports = { splitIntoChunks, storeChunks, retrieveRelevantChunks };
