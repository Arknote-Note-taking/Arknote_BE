const { GoogleGenerativeAI } = require('@google/generative-ai');

const apiKey = process.env.GEMINI_API_KEY;
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;
const useMock = !genAI;

const generateWithRetry = async (model, prompt, maxRetries = 5) => {
  let delay = 1000;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await model.generateContent(prompt);
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
        let currentDelay = delay;
        
        // Parse Google API rate limit retry delay if present in errorDetails
        if (err.errorDetails && Array.isArray(err.errorDetails)) {
          const retryInfo = err.errorDetails.find(
            detail => detail['@type'] && detail['@type'].includes('RetryInfo')
          );
          if (retryInfo && retryInfo.retryDelay) {
            const seconds = parseFloat(retryInfo.retryDelay);
            if (!isNaN(seconds)) {
              // Add 1s safety buffer to ensure rate-limit window resets completely
              currentDelay = Math.round((seconds + 1) * 1000);
              console.log(`[Gemini-RateLimit] Detected Google API RetryInfo: Waiting ${seconds}s before retrying...`);
            }
          }
        }
        
        console.warn(`Transient Gemini error (attempt ${i + 1}/${maxRetries}): ${err.message || err}. Retrying in ${currentDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, currentDelay));
        
        // Update exponential backoff delay for subsequent retries if no RetryInfo is sent next time
        delay *= 2;
      } else {
        throw err;
      }
    }
  }
};

const generateContentStreamWithRetry = async (model, prompt, maxRetries = 5) => {
  let delay = 1000;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await model.generateContentStream(prompt);
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
        let currentDelay = delay;
        
        // Parse Google API rate limit retry delay if present in errorDetails
        if (err.errorDetails && Array.isArray(err.errorDetails)) {
          const retryInfo = err.errorDetails.find(
            detail => detail['@type'] && detail['@type'].includes('RetryInfo')
          );
          if (retryInfo && retryInfo.retryDelay) {
            const seconds = parseFloat(retryInfo.retryDelay);
            if (!isNaN(seconds)) {
              currentDelay = Math.round((seconds + 1) * 1000);
              console.log(`[Gemini-RateLimit] Detected Google Stream API RetryInfo: Waiting ${seconds}s before retrying stream...`);
            }
          }
        }
        
        console.warn(`Transient Gemini Stream error (attempt ${i + 1}/${maxRetries}): ${err.message || err}. Retrying stream in ${currentDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, currentDelay));
        delay *= 2;
      } else {
        throw err;
      }
    }
  }
};

const extractMetadata = async (text, isPro = false) => {
  if (useMock) {
    return {
      title: "Sample Document Title (Mocked)",
      subject: "Khác",
      tags: ["Gemini", "AI", "Mocked"],
      summary: "- Đây là bản tóm tắt mẫu từ phân tích AI giả lập."
    };
  }

  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: {
            title: { 
              type: 'string', 
              description: 'Tiêu đề ngắn gọn và chính xác của tài liệu bằng tiếng Việt' 
            },
            subject: { 
              type: 'string',
              enum: ['Nhân sự', 'Hành chính', 'Pháp luật', 'Học tập', 'Khác'],
              description: 'Danh mục chính của tài liệu'
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: '3-5 tag từ khóa ngắn gọn liên quan đến nội dung chính'
            },
            summary: {
              type: 'string',
              description: 'Tóm tắt tài liệu thành các ý chính ngắn gọn dưới dạng gạch đầu dòng bằng tiếng Việt'
            }
          },
          required: ['title', 'subject', 'tags', 'summary']
        },
        maxOutputTokens: 2048
      }
    });

    const limit = isPro ? 80000 : 8000;
    const prompt = `Phân tích đoạn văn bản dưới đây và trích xuất thông tin theo cấu trúc JSON được yêu cầu.
Văn bản:
${text.substring(0, limit)}`;
    
    const result = await generateWithRetry(model, prompt);
    const responseText = result.response.text();
    return JSON.parse(responseText);
  } catch (err) {
    console.error('Error in Gemini extractMetadata:', err);
    return { title: 'Unknown Document', subject: 'Khác', tags: [], summary: '' };
  }
};

const summarizeDocument = async (text, isPro = false) => {
  if (useMock) {
    return "- Đây là bản tóm tắt giả lập.\n- Vui lòng cung cấp GEMINI_API_KEY trong file .env để sử dụng tóm tắt bằng Gemini AI thực tế.\n- Tài liệu của bạn đã được đọc thành công trong hệ thống.";
  }

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
    const limit = isPro ? 80000 : 8000;
    const prompt = `Tóm tắt tài liệu sau thành các ý chính ngắn gọn dưới dạng gạch đầu dòng bằng tiếng Việt:\n\n${text.substring(0, limit)}`;
    
    const result = await generateWithRetry(model, prompt);
    return result.response.text();
  } catch (err) {
    console.error('Error in Gemini summarizeDocument:', err);
    return 'Không thể tạo tóm tắt do lỗi hệ thống AI.';
  }
};

const answerQuestion = async (text, question, isPro = false) => {
  if (useMock) {
    return "Đây là câu trả lời giả lập. Vui lòng cấu hình GEMINI_API_KEY để AI phân tích tài liệu và trả lời thực tế câu hỏi của bạn.";
  }

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
    const limit = isPro ? 100000 : 10000;
    const prompt = `Hãy trả lời câu hỏi của người dùng một cách chính xác dựa trên ngữ cảnh tài liệu được cung cấp dưới đây. Nếu thông tin không có trong tài liệu, hãy trả lời trung thực là tài liệu không đề cập đến thông tin này.

Ngữ cảnh tài liệu:
${text.substring(0, limit)}

Câu hỏi: ${question}`;

    const result = await generateWithRetry(model, prompt);
    return result.response.text();
  } catch (err) {
    console.error('Error in Gemini answerQuestion:', err);
    return 'Lỗi: Không thể trả lời câu hỏi lúc này do sự cố kết nối với hệ thống AI.';
  }
};

const generateQuiz = async (text, isPro = true, count = 5) => {
  const questionCount = count || 5;

  if (useMock) {
    const mockQuizzes = [];
    for (let i = 1; i <= questionCount; i++) {
      mockQuizzes.push({
        question: `Câu hỏi trắc nghiệm giả lập số ${i}: Trí tuệ nhân tạo hỗ trợ học tập như thế nào?`,
        options: [
          `A. Tự động hóa việc chấm điểm và tạo quiz ôn tập để nâng cao kiến thức học viên`,
          `B. Thay thế hoàn toàn giáo viên đứng lớp`,
          `C. Giảm dung lượng internet khi học trực tuyến`,
          `D. Chỉ cung cấp tính năng trò chuyện giải trí tự động`
        ],
        answer: `A. Tự động hóa việc chấm điểm và tạo quiz ôn tập để nâng cao kiến thức học viên`,
        explanation: `Đây là giải thích giả lập cho câu hỏi số ${i}. Trí tuệ nhân tạo (AI) giúp tạo ra các học liệu cá nhân hóa và các bài kiểm tra trắc nghiệm ôn tập (Quiz) từ tài liệu một cách tự động để người học rèn luyện kiến thức.`
      });
    }
    return mockQuizzes;
  }

  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              question: { type: 'string', description: 'Nội dung câu hỏi trắc nghiệm' },
              options: {
                type: 'array',
                items: { type: 'string' },
                description: '4 đáp án lựa chọn (A, B, C, D)'
              },
              answer: { type: 'string', description: 'Đáp án đúng (phải trùng khớp hoàn toàn với một trong bốn chuỗi ký tự trong options)' },
              explanation: { type: 'string', description: 'Giải thích chi tiết tại sao đáp án đó đúng bằng tiếng Việt' }
            },
            required: ['question', 'options', 'answer', 'explanation']
          }
        },
        maxOutputTokens: 8192
      }
    });

    const limit = isPro ? 80000 : 8000;
    const prompt = `Tạo một bộ câu hỏi trắc nghiệm (quiz) gồm đúng ${questionCount} câu hỏi dựa trên nội dung tài liệu sau. Mỗi câu hỏi phải có 4 đáp án lựa chọn (A, B, C, D), chỉ rõ đáp án đúng và kèm giải thích chi tiết tại sao đúng bằng tiếng Việt.
Tài liệu:\n\n${text.substring(0, limit)}`;

    const result = await generateWithRetry(model, prompt);
    const responseText = result.response.text();
    return JSON.parse(responseText);
  } catch (err) {
    console.error('Error in Gemini generateQuiz:', err);
    throw new Error('Không thể tạo quiz tự động từ tài liệu này.');
  }
};

const answerQuestionStream = async (text, question, onChunk, isPro = false) => {
  if (useMock) {
    const mockResponse = "Đây là câu trả lời giả lập. Vui lòng cấu hình GEMINI_API_KEY để AI phân tích tài liệu và trả lời thực tế câu hỏi của bạn.";
    const words = mockResponse.split(' ');
    for (const word of words) {
      onChunk(word + ' ');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return;
  }

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
    const limit = isPro ? 100000 : 10000;
    const prompt = `Hãy trả lời câu hỏi của người dùng một cách chính xác dựa trên ngữ cảnh tài liệu được cung cấp dưới đây. Nếu thông tin không có trong tài liệu, hãy trả lời trung thực là tài liệu không đề cập đến thông tin này.

Ngữ cảnh tài liệu:
${text.substring(0, limit)}

Câu hỏi: ${question}`;

    const result = await generateContentStreamWithRetry(model, prompt);
    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      if (chunkText) {
        onChunk(chunkText);
      }
    }
  } catch (err) {
    console.error('Error in Gemini answerQuestionStream:', err);
    throw err;
  }
};

module.exports = { extractMetadata, summarizeDocument, answerQuestion, answerQuestionStream, generateContentStreamWithRetry, generateQuiz };

