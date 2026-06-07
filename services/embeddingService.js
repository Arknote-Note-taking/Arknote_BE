const { GoogleGenerativeAI } = require('@google/generative-ai');

const apiKey = process.env.GEMINI_API_KEY;
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

const createEmbedding = async (text) => {
  if (!genAI) {
    // Generate a random mocked vector of length 768
    return Array.from({ length: 768 }, () => (Math.random() * 2) - 1);
  }

  const maxRetries = 3;
  let delay = 1000;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const model = genAI.getGenerativeModel({ model: 'gemini-embedding-2' });
      const response = await model.embedContent({
        content: { parts: [{ text: text.substring(0, 8000) }] },
        outputDimensionality: 768
      });
      
      return response.embedding.values; // Array of 768 floats
    } catch (err) {
      const isTransient = err.status === 503 || err.status === 429 || 
                          (err.message && (
                            err.message.includes('503') || 
                            err.message.includes('429') || 
                            err.message.includes('high demand') || 
                            err.message.includes('overloaded') ||
                            err.message.includes('Service Unavailable')
                          ));
      if (isTransient && i < maxRetries - 1) {
        console.warn(`Transient Gemini Embedding error (attempt ${i + 1}/${maxRetries}): ${err.message || err}. Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
      } else {
        console.error('Error in Gemini createEmbedding:', err);
        // Return a random mock 768 vector on failure
        return Array.from({ length: 768 }, () => (Math.random() * 2) - 1);
      }
    }
  }
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
