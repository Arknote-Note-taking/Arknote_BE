const { GoogleGenerativeAI } = require('@google/generative-ai');

const apiKey = process.env.GEMINI_API_KEY;
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;
const useMock = !genAI;

const generateWithRetry = async (model, prompt, maxRetries = 3) => {
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
        console.warn(`Transient Gemini error (attempt ${i + 1}/${maxRetries}): ${err.message || err}. Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
      } else {
        throw err;
      }
    }
  }
};

const extractMetadata = async (text) => {
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
      model: 'gemini-flash-latest',
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
        }
      }
    });

    const prompt = `Phân tích đoạn văn bản dưới đây và trích xuất thông tin theo cấu trúc JSON được yêu cầu.
Văn bản:
${text.substring(0, 8000)}`;
    
    const result = await generateWithRetry(model, prompt);
    const responseText = result.response.text();
    return JSON.parse(responseText);
  } catch (err) {
    console.error('Error in Gemini extractMetadata:', err);
    return { title: 'Unknown Document', subject: 'Khác', tags: [], summary: '' };
  }
};

const summarizeDocument = async (text) => {
  if (useMock) {
    return "- Đây là bản tóm tắt giả lập.\n- Vui lòng cung cấp GEMINI_API_KEY trong file .env để sử dụng tóm tắt bằng Gemini AI thực tế.\n- Tài liệu của bạn đã được đọc thành công trong hệ thống.";
  }

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });
    const prompt = `Tóm tắt tài liệu sau thành các ý chính ngắn gọn dưới dạng gạch đầu dòng bằng tiếng Việt:\n\n${text.substring(0, 8000)}`;
    
    const result = await generateWithRetry(model, prompt);
    return result.response.text();
  } catch (err) {
    console.error('Error in Gemini summarizeDocument:', err);
    return 'Không thể tạo tóm tắt do lỗi hệ thống AI.';
  }
};

const answerQuestion = async (text, question) => {
  if (useMock) {
    return "Đây là câu trả lời giả lập. Vui lòng cấu hình GEMINI_API_KEY để AI phân tích tài liệu và trả lời thực tế câu hỏi của bạn.";
  }

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });
    const prompt = `Hãy trả lời câu hỏi của người dùng một cách chính xác dựa trên ngữ cảnh tài liệu được cung cấp dưới đây. Nếu thông tin không có trong tài liệu, hãy trả lời trung thực là tài liệu không đề cập đến thông tin này.

Ngữ cảnh tài liệu:
${text.substring(0, 10000)}

Câu hỏi: ${question}`;

    const result = await generateWithRetry(model, prompt);
    return result.response.text();
  } catch (err) {
    console.error('Error in Gemini answerQuestion:', err);
    return 'Lỗi: Không thể trả lời câu hỏi lúc này do sự cố kết nối với hệ thống AI.';
  }
};

const generateQuiz = async (text) => {
  if (useMock) {
    return [
      {
        question: "Đây là câu hỏi trắc nghiệm giả lập 1 (Chưa cấu hình GEMINI_API_KEY)?",
        options: ["Đáp án A", "Đáp án B", "Đáp án C", "Đáp án D"],
        answer: "Đáp án A",
        explanation: "Đây là đáp án đúng của câu hỏi giả lập."
      },
      {
        question: "Chức năng Quiz hoạt động ở chế độ nào khi thiếu khóa API?",
        options: ["Thử nghiệm giả lập", "Sử dụng Gemini thực tế", "Lỗi crash ứng dụng", "Không hiển thị"],
        answer: "Thử nghiệm giả lập",
        explanation: "Khi thiếu GEMINI_API_KEY, hệ thống kích hoạt fallback trả về bộ quiz mẫu để nhà phát triển xem trước giao diện."
      }
    ];
  }

  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-flash-latest',
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
        }
      }
    });

    const prompt = `Tạo một bộ câu hỏi trắc nghiệm (quiz) gồm 5 câu hỏi dựa trên nội dung tài liệu sau. Mỗi câu hỏi phải có 4 đáp án lựa chọn (A, B, C, D), chỉ rõ đáp án đúng và kèm giải thích chi tiết tại sao đúng bằng tiếng Việt.
Tài liệu:\n\n${text.substring(0, 8000)}`;

    const result = await generateWithRetry(model, prompt);
    const responseText = result.response.text();
    return JSON.parse(responseText);
  } catch (err) {
    console.error('Error in Gemini generateQuiz:', err);
    throw new Error('Không thể tạo quiz tự động từ tài liệu này.');
  }
};

module.exports = { extractMetadata, summarizeDocument, answerQuestion, generateQuiz };
