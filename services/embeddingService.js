const { OpenAI } = require('openai');

const openai = process.env.OPENAI_API_KEY ? new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
}) : null;

const createEmbedding = async (text) => {
  if (!openai) {
    // Generate a random mocked vector of length 1536
    return Array.from({ length: 1536 }, () => (Math.random() * 2) - 1);
  }

  const response = await openai.embeddings.create({
    model: 'text-embedding-ada-002',
    input: text.substring(0, 8000),
  });

  return response.data[0].embedding;
};

const cosineSimilarity = (vecA, vecB) => {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
};

module.exports = { createEmbedding, cosineSimilarity };
