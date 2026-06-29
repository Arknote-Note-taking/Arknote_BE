const { GoogleGenerativeAI } = require('@google/generative-ai');

const apiKey = process.env.GEMINI_API_KEY;
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;
const useMock = !genAI;

const parseAiError = (err, defaultMsg) => {
  const errMsg = err?.message || '';
  const errDetails = err?.errorDetails ? JSON.stringify(err.errorDetails) : '';
  const combined = (errMsg + ' ' + errDetails).toLowerCase();

  const isQuota = err?.status === 429 ||
    combined.includes('quota') ||
    combined.includes('429') ||
    combined.includes('limit') ||
    combined.includes('exhausted') ||
    combined.includes('rate_limit') ||
    combined.includes('resource_exhausted');

  if (isQuota) {
    return 'Hết lượt dùng thử / Quota Exceeded. Vui lòng thử lại sau hoặc nâng cấp tài khoản.';
  }

  return `${defaultMsg} Chi tiết lỗi: ${err?.message || err}`;
};

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
      summary: "- Đây là bản tóm tắt mẫu từ phân tích AI giả lập.",
      contract_expiry: "",
      key_details: ""
    };
  }

  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
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
            },
            contract_expiry: {
              type: 'string',
              description: 'Nếu tài liệu là hợp đồng, thỏa thuận, hóa đơn hoặc văn bản có thời hạn: Trích xuất Ngày hết hạn/Thời hạn (ví dụ: "31/12/2026" hoặc "12 tháng"). Nếu không có hoặc không áp dụng, hãy trả về chuỗi rỗng "".'
            },
            key_details: {
              type: 'string',
              description: 'Nếu tài liệu liên quan đến Nhân sự, Hành chính hoặc Hợp đồng: Trích xuất các thông tin nhập liệu quan trọng khác (ví dụ: "Bên A: Công ty X, Bên B: Nguyễn Văn Y, Lương: 15tr"). Nếu không có hoặc không áp dụng, hãy trả về chuỗi rỗng "".'
            }
          },
          required: ['title', 'subject', 'tags', 'summary', 'contract_expiry', 'key_details']
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
    const metadata = JSON.parse(responseText);

    // Format the summary if contract information is extracted
    if ((metadata.contract_expiry && metadata.contract_expiry.trim() !== '') || (metadata.key_details && metadata.key_details.trim() !== '')) {
      let prependText = '=========================================\n';
      prependText += 'THÔNG TIN HỢP ĐỒNG & NHẬP LIỆU AI:\n';
      if (metadata.contract_expiry && metadata.contract_expiry.trim() !== '') {
        prependText += `Hạn hợp đồng / Hạn hiệu lực: ${metadata.contract_expiry.trim()}\n`;
      }
      if (metadata.key_details && metadata.key_details.trim() !== '') {
        prependText += `Chi tiết chính: ${metadata.key_details.trim()}\n`;
      }
      prependText += '=========================================\n\n';
      metadata.summary = prependText + (metadata.summary || '');
    }

    return metadata;
  } catch (err) {
    console.error('Error in Gemini extractMetadata:', err);
    throw new Error(parseAiError(err, 'Không thể phân tích siêu dữ liệu từ tài liệu này.'));
  }
};

const summarizeDocument = async (text, isPro = false) => {
  if (useMock) {
    return "- Đây là bản tóm tắt giả lập.\n- Vui lòng cung cấp GEMINI_API_KEY trong file .env để sử dụng tóm tắt bằng Gemini AI thực tế.\n- Tài liệu của bạn đã được đọc thành công trong hệ thống.";
  }

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const limit = isPro ? 80000 : 8000;
    const prompt = `Tóm tắt tài liệu sau thành các ý chính ngắn gọn dưới dạng gạch đầu dòng bằng tiếng Việt:\n\n${text.substring(0, limit)}`;

    const result = await generateWithRetry(model, prompt);
    return result.response.text();
  } catch (err) {
    console.error('Error in Gemini summarizeDocument:', err);
    throw new Error(parseAiError(err, 'Không thể tạo tóm tắt do lỗi hệ thống AI.'));
  }
};

const answerQuestion = async (text, question, isPro = false, history = '') => {
  if (useMock) {
    return "Đây là câu trả lời giả lập. Vui lòng cấu hình GEMINI_API_KEY để AI phân tích tài liệu và trả lời thực tế câu hỏi của bạn.";
  }

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const limit = isPro ? 100000 : 10000;
    const prompt = `Bạn là một trợ lý AI thông minh hỗ trợ phân tích và trả lời câu hỏi dựa trên tài liệu.
Hãy tuân thủ các hướng dẫn, kỹ năng và quy tắc phản hồi sau đây:

QUY TRÌNH PHẢN HỒI:
1. Hiểu yêu cầu -> Xác định đúng mục tiêu, ý định của người dùng.
2. Làm rõ (nếu cần) -> Hỏi thêm thông tin nếu yêu cầu mơ hồ hoặc thiếu thông tin, không tự suy diễn nếu có thể dẫn đến trả lời sai.
3. Trả lời trực tiếp -> Đưa ra đáp án chính trước, tránh lan man.
4. Giải thích -> Cung cấp lý do, ví dụ, hoặc hướng dẫn phù hợp với trình độ người dùng.
5. Đề xuất tiếp theo -> Gợi ý các bước hoặc tài nguyên liên quan.

CÁC KỸ NĂNG & QUY TẮC CỐT LÕI:
- Lắng nghe và hiểu ý định (Intent Recognition): Nhận diện đúng mong muốn, hiểu ngữ cảnh, từ viết tắt, và lỗi chính tả.
- Làm rõ khi thông tin chưa đủ (Clarification): Đặt câu hỏi bổ sung/hỏi ngược lại khi thông tin chưa đủ rõ ràng.
- Phản hồi chính xác (Accuracy) & Trung thực: Đưa thông tin có căn cứ dựa trên tài liệu được cung cấp. Nếu thông tin không có trong tài liệu, hãy trả lời trung thực là tài liệu không đề cập đến thông tin này (sử dụng ngôn ngữ phù hợp tương ứng theo quy tắc trên). Thừa nhận khi không biết/không làm được thay vì tự bịa.
- Phản hồi thích ứng (Adaptive Response): Điều chỉnh độ dài ngắn/mức độ chi tiết theo nhu cầu (vd: người dùng muốn "chỉ đáp án" hoặc "giải thích chi tiết").
- Đồng cảm (Empathy) & Giọng điệu (Tone): Thể hiện sự thấu hiểu khi người dùng gặp khó khăn, giữ giọng điệu lịch sự, khách quan, chuyên nghiệp, thân thiện, học thuật hoặc hài hước tùy hoàn cảnh.
- Phản hồi có cấu trúc (Structured Response): Chia thành các tiêu đề, gạch đầu dòng, bảng biểu, danh sách cho dễ theo dõi.
- Tập trung vào giải pháp (Solution-Oriented): Đề xuất cách khắc phục và các bước giải quyết từng bước cụ thể.
- Xử lý phản hồi tiêu cực & Tiếp nhận lỗi (Error Recovery): Cởi mở tiếp nhận góp ý, xin lỗi và cập nhật thông tin chính xác nếu câu trả lời trước chưa đúng.
- Chủ động gợi ý (Proactive Assistance): Đề xuất bước tiếp theo hoặc gợi ý các ví dụ/tài liệu liên quan.
- Tóm tắt (Summarization): Tổng hợp thông tin dài thành các ý chính rõ ràng.
- Giải thích đa cấp độ (Explanation Skills): Phù hợp cho người mới bắt đầu (dùng ví dụ, so sánh) hoặc người có kinh nghiệm.
- An toàn & Đạo đức: Tôn trọng người dùng, không tạo nội dung gây hại hoặc vi phạm pháp luật.

QUY TẮC NGÔN NGỮ:
1. Hãy tự động nhận diện ngôn ngữ của câu hỏi từ người dùng. Nếu người dùng hỏi bằng tiếng Việt, bạn BẮT BUỘC phải trả lời bằng tiếng Việt. Nếu người dùng hỏi bằng tiếng Anh, bạn BẮT BUỘC phải trả lời bằng tiếng Anh.
2. Đồng thời, hãy nhận diện ngôn ngữ của từng tài liệu trong ngữ cảnh được cung cấp bên dưới để hiểu và trích xuất thông tin một cách chính xác nhất theo đúng ngôn ngữ của tài liệu đó.
3. Nếu câu hỏi không chỉ định rõ hoặc trung lập, hãy trả lời bằng ngôn ngữ khớp với ngôn ngữ chính của tài liệu.

Ngữ cảnh tài liệu:
${text.substring(0, limit)}
${history}
Câu hỏi hiện tại của người dùng: ${question}`;

    const result = await generateWithRetry(model, prompt);
    return result.response.text();
  } catch (err) {
    console.error('Error in Gemini answerQuestion:', err);
    throw new Error(parseAiError(err, 'Lỗi: Không thể trả lời câu hỏi lúc này do sự cố kết nối với hệ thống AI.'));
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
      model: 'gemini-2.5-flash',
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
    throw new Error(parseAiError(err, 'Không thể tạo quiz tự động từ tài liệu này.'));
  }
};

const answerQuestionStream = async (text, question, onChunk, isPro = false, history = '') => {
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
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const limit = isPro ? 100000 : 10000;
    const prompt = `Bạn là một trợ lý AI thông minh hỗ trợ phân tích và trả lời câu hỏi dựa trên tài liệu.
Hãy tuân thủ các hướng dẫn, kỹ năng và quy tắc phản hồi sau đây:

QUY TRÌNH PHẢN HỒI:
1. Hiểu yêu cầu -> Xác định đúng mục tiêu, ý định của người dùng.
2. Làm rõ (nếu cần) -> Hỏi thêm thông tin nếu yêu cầu mơ hồ hoặc thiếu thông tin, không tự suy diễn nếu có thể dẫn đến trả lời sai.
3. Trả lời trực tiếp -> Đưa ra đáp án chính trước, tránh lan man.
4. Giải thích -> Cung cấp lý do, ví dụ, hoặc hướng dẫn phù hợp với trình độ người dùng.
5. Đề xuất tiếp theo -> Gợi ý các bước hoặc tài nguyên liên quan.

CÁC KỸ NĂNG & QUY TẮC CỐT LÕI:
- Lắng nghe và hiểu ý định (Intent Recognition): Nhận diện đúng mong muốn, hiểu ngữ cảnh, từ viết tắt, và lỗi chính tả.
- Làm rõ khi thông tin chưa đủ (Clarification): Đặt câu hỏi bổ sung/hỏi ngược lại khi thông tin chưa đủ rõ ràng.
- Phản hồi chính xác (Accuracy) & Trung thực: Đưa thông tin có căn cứ dựa trên tài liệu được cung cấp. Nếu thông tin không có trong tài liệu, hãy trả lời trung thực là tài liệu không đề cập đến thông tin này (sử dụng ngôn ngữ phù hợp tương ứng theo quy tắc trên). Thừa nhận khi không biết/không làm được thay vì tự bịa.
- Phản hồi thích ứng (Adaptive Response): Điều chỉnh độ dài ngắn/mức độ chi tiết theo nhu cầu (vd: người dùng muốn "chỉ đáp án" hoặc "giải thích chi tiết").
- Đồng cảm (Empathy) & Giọng điệu (Tone): Thể hiện sự thấu hiểu khi người dùng gặp khó khăn, giữ giọng điệu lịch sự, khách quan, chuyên nghiệp, thân thiện, học thuật hoặc hài hước tùy hoàn cảnh.
- Phản hồi có cấu trúc (Structured Response): Chia thành các tiêu đề, gạch đầu dòng, bảng biểu, danh sách cho dễ theo dõi.
- Tập trung vào giải pháp (Solution-Oriented): Đề xuất cách khắc phục và các bước giải quyết từng bước cụ thể.
- Xử lý phản hồi tiêu cực & Tiếp nhận lỗi (Error Recovery): Cởi mở tiếp nhận góp ý, xin lỗi và cập nhật thông tin chính xác nếu câu trả lời trước chưa đúng.
- Chủ động gợi ý (Proactive Assistance): Đề xuất bước tiếp theo hoặc gợi ý các ví dụ/tài liệu liên quan.
- Tóm tắt (Summarization): Tổng hợp thông tin dài thành các ý chính rõ ràng.
- Giải thích đa cấp độ (Explanation Skills): Phù hợp cho người mới bắt đầu (dùng ví dụ, so sánh) hoặc người có kinh nghiệm.
- An toàn & Đạo đức: Tôn trọng người dùng, không tạo nội dung gây hại hoặc vi phạm pháp luật.

QUY TẮC NGÔN NGỮ:
1. Hãy tự động nhận diện ngôn ngữ của câu hỏi từ người dùng. Nếu người dùng hỏi bằng tiếng Việt, bạn BẮT BUỘC phải trả lời bằng tiếng Việt. Nếu người dùng hỏi bằng tiếng Anh, bạn BẮT BUỘC phải trả lời bằng tiếng Anh.
2. Đồng thời, hãy nhận diện ngôn ngữ của từng tài liệu trong ngữ cảnh được cung cấp bên dưới để hiểu và trích xuất thông tin một cách chính xác nhất theo đúng ngôn ngữ của tài liệu đó.
3. Nếu câu hỏi không chỉ định rõ hoặc trung lập, hãy trả lời bằng ngôn ngữ khớp với ngôn ngữ chính của tài liệu.

Ngữ cảnh tài liệu:
${text.substring(0, limit)}
${history}
Câu hỏi hiện tại của người dùng: ${question}`;

    const result = await generateContentStreamWithRetry(model, prompt);
    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      if (chunkText) {
        onChunk(chunkText);
      }
    }
  } catch (err) {
    console.error('Error in Gemini answerQuestionStream:', err);
    throw new Error(parseAiError(err, 'Lỗi khi phát luồng câu trả lời.'));
  }
};

const generateFlashcards = async (text, isPro = true, count = 10) => {
  const cardCount = count || 10;

  if (useMock) {
    const mockFlashcards = [];
    for (let i = 1; i <= cardCount; i++) {
      mockFlashcards.push({
        front_text: `Câu hỏi ôn tập (Flashcard) số ${i} từ tài liệu?`,
        back_text: `Câu trả lời tương ứng số ${i} nhằm ghi nhớ kiến thức cốt lõi.`
      });
    }
    return mockFlashcards;
  }

  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              front_text: { type: 'string', description: 'Nội dung câu hỏi hoặc khái niệm ở mặt trước thẻ' },
              back_text: { type: 'string', description: 'Câu trả lời hoặc giải nghĩa ngắn gọn ở mặt sau thẻ' }
            },
            required: ['front_text', 'back_text']
          }
        },
        maxOutputTokens: 4096
      }
    });

    const limit = isPro ? 80000 : 8000;
    const prompt = `Tạo một bộ thẻ ghi nhớ (flashcard) gồm đúng ${cardCount} thẻ dựa trên nội dung tài liệu sau. Mỗi thẻ gồm mặt trước (front_text) là câu hỏi ngắn hoặc khái niệm, mặt sau (back_text) là câu trả lời ngắn gọn hoặc định nghĩa bằng tiếng Việt.
Tài liệu:\n\n${text.substring(0, limit)}`;

    const result = await generateWithRetry(model, prompt);
    const responseText = result.response.text();
    return JSON.parse(responseText);
  } catch (err) {
    console.error('Error in Gemini generateFlashcards:', err);
    throw new Error(parseAiError(err, 'Không thể tự động tạo bộ flashcard từ tài liệu này.'));
  }
};

module.exports = { extractMetadata, summarizeDocument, answerQuestion, answerQuestionStream, generateContentStreamWithRetry, generateQuiz, generateFlashcards };

