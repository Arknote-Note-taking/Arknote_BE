const { OpenAI } = require('openai');

const openai = process.env.OPENAI_API_KEY ? new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
}) : null;

// Helper to mock when no API Key is present
const useMock = !openai;

const extractMetadata = async (text) => {
  if (useMock) {
    return {
      title: "Sample Document Title",
      subject: "Khác",
      tags: ["AI", "Parsing", "Mocked"]
    };
  }

  const response = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [
      { role: 'system', content: 'Extract the title, main subject, and 3-5 tags from this text. Return strictly in JSON format: {"title": "", "subject": "", "tags": []}' },
      { role: 'user', content: text.substring(0, 3000) } // Send a chunk to limit tokens
    ]
  });

  try {
    return JSON.parse(response.choices[0].message.content);
  } catch (err) {
    return { title: 'Unknown', subject: 'Khác', tags: [] };
  }
};

const summarizeDocument = async (text) => {
  if (useMock) {
    return "- This is a mocked generated summary.\n- Since there is no OpenAI API key provided, we supply this fallback.\n- Please update your .env to experience AI features.";
  }

  const response = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [
      { role: 'system', content: 'Summarize the following document into concise bullet points.' },
      { role: 'user', content: text.substring(0, 4000) }
    ]
  });

  return response.choices[0].message.content;
};

const answerQuestion = async (text, question) => {
  if (useMock) {
    return "This is a fallback mocked answer directly drawn from the system because no OpenAI API key was detected.";
  }

  const response = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [
      { role: 'system', content: 'Answer the user\'s question strictly based on the provided document context.' },
      { role: 'user', content: `Context: ${text.substring(0, 4000)}\n\nQuestion: ${question}` }
    ]
  });

  return response.choices[0].message.content;
};

module.exports = { extractMetadata, summarizeDocument, answerQuestion };
