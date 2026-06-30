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

const safeJsonParse = (str) => {
  if (!str) return null;
  let cleaned = str.trim();

  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/i, '');
    cleaned = cleaned.replace(/\n?```$/, '');
    cleaned = cleaned.trim();
  }

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('Failed to parse raw JSON from Gemini. Raw text was:', str);
    try {
      let regexCleaned = cleaned
        .replace(/,\s*([\]}])/g, '$1') // remove trailing comma before } or ]
        .replace(/[\u200B-\u200D\uFEFF]/g, ''); // remove zero-width spaces/invisible characters
      return JSON.parse(regexCleaned);
    } catch (innerErr) {
      // If it still fails, let's attempt to repair a truncated JSON array of objects
      if (cleaned.startsWith('[')) {
        console.warn('Attempting to repair truncated JSON array...');
        let temp = cleaned;
        let lastCurly = temp.lastIndexOf('}');
        while (lastCurly !== -1) {
          temp = temp.substring(0, lastCurly + 1);
          try {
            let candidate = temp.trim();
            if (candidate.endsWith(',')) {
              candidate = candidate.slice(0, -1).trim();
            }
            candidate += '\n]';
            const parsed = JSON.parse(candidate);
            console.log(`Successfully recovered truncated JSON with ${parsed.length} items.`);
            return parsed;
          } catch (e) {
            temp = temp.substring(0, lastCurly);
            lastCurly = temp.lastIndexOf('}');
          }
        }
      }
      console.error('Inner cleanup parse failed:', innerErr);
      throw err;
    }
  }
};

const generateWithRetry = async (model, prompt, maxRetries = 5) => {
  let delay = 1000;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await model.generateContent(prompt);
    } catch (err) {
      const errMsgStr = (err.message || '').toLowerCase();
      const isDailyOrPermanentQuota = errMsgStr.includes('daily') || 
        errMsgStr.includes('quota exceeded') || 
        errMsgStr.includes('budget');

      const isTransient = !isDailyOrPermanentQuota && (
        err.status === 503 || err.status === 429 ||
        (err.message && (
          err.message.includes('503') ||
          err.message.includes('429') ||
          err.message.includes('high demand') ||
          err.message.includes('overloaded') ||
          err.message.includes('Service Unavailable')
        ))
      );
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
      const errMsgStr = (err.message || '').toLowerCase();
      const isDailyOrPermanentQuota = errMsgStr.includes('daily') || 
        errMsgStr.includes('quota exceeded') || 
        errMsgStr.includes('budget');

      const isTransient = !isDailyOrPermanentQuota && (
        err.status === 503 || err.status === 429 ||
        (err.message && (
          err.message.includes('503') ||
          err.message.includes('429') ||
          err.message.includes('high demand') ||
          err.message.includes('overloaded') ||
          err.message.includes('Service Unavailable')
        ))
      );
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
              question: { 
                type: 'string', 
                description: 'Nội dung câu hỏi trắc nghiệm viết hoàn toàn bằng ngôn ngữ chính của tài liệu (ví dụ: tiếng Nhật). TUYỆT ĐỐI KHÔNG ĐƯỢC chứa bản dịch tiếng Việt, không chứa giải thích hay phiên âm/Romaji.' 
              },
              options: {
                type: 'array',
                items: { 
                  type: 'string',
                  description: 'Một phương án lựa chọn viết HOÀN TOÀN bằng ngôn ngữ gốc của tài liệu (ví dụ: tiếng Nhật). TUYỆT ĐỐI KHÔNG ĐƯỢC chứa bất kỳ nghĩa dịch tiếng Việt, giải thích hay Romaji/phiên âm nào trong chuỗi này.'
                },
                description: '4 đáp án lựa chọn (A, B, C, D) viết hoàn toàn bằng ngôn ngữ chính của tài liệu (ví dụ: tiếng Nhật). TUYỆT ĐỐI KHÔNG ĐƯỢC chứa bản dịch tiếng Việt, không chứa giải thích hay phiên âm/Romaji.'
              },
              answer: { 
                type: 'string', 
                description: 'Đáp án đúng (phải trùng khớp hoàn toàn với một trong bốn chuỗi ký tự trong options, viết hoàn toàn bằng ngôn ngữ chính của tài liệu).' 
              },
              explanation: { 
                type: 'string', 
                description: 'Giải thích chi tiết tại sao đáp án đó đúng bằng tiếng Việt (BẮT BUỘC bao gồm cả bản dịch tiếng Việt, phiên âm/cách phát âm/Romaji của câu hỏi và các đáp án để người học đối chiếu học tập sau khi nộp bài).' 
              }
            },
            required: ['question', 'options', 'answer', 'explanation']
          }
        },
        maxOutputTokens: 8192
      }
    });

    const limit = isPro ? 20000 : 8000;
    const prompt = `Tạo một bộ câu hỏi trắc nghiệm (quiz) gồm đúng ${questionCount} câu hỏi dựa trên nội dung tài liệu sau.
Yêu cầu về tư duy sư phạm và thiết lập câu hỏi linh hoạt:
- KHÔNG TRÍCH XUẤT THỤ ĐỘNG: Không đơn thuần là copy nguyên mẫu từ tài liệu hoặc dịch từng từ thô cứng. Bạn cần xây dựng câu hỏi thông minh, thực tế, kích thích tư duy phản xạ giao tiếp.
- THIẾT LẬP CÂU HỎI VÀ ĐÁP ÁN: Nếu tài liệu chứa các mẫu câu hỏi, hội thoại hoặc cấu trúc giao tiếp (ví dụ: "日本りょうり は どうですか？"), hãy sử dụng câu hỏi đó làm câu hỏi trắc nghiệm, và xây dựng đáp án đúng là một câu phản hồi hợp lý, tự nhiên nhất dựa trên ngữ cảnh tài liệu (ví dụ: "美味しいですが、値段が高いです").
- TẠO ĐÁP ÁN NHIỄU (DISTRACTORS): Ngoài 1 đáp án đúng hoàn toàn nói trên, bạn phải tự suy nghĩ và tạo ra 3 đáp án sai (nhiễu) còn lại. Các đáp án nhiễu này phải là các câu trả lời không phù hợp về mặt ý nghĩa, sai cấu trúc ngữ pháp, hoặc không ăn nhập gì với ngữ cảnh câu hỏi để thử thách khả năng chọn lựa của người học.

Yêu cầu cực kỳ quan trọng về Ngôn ngữ và Dịch nghĩa/Giải thích:
1. Hãy tự động nhận diện ngôn ngữ chính của tài liệu.
2. Nếu tài liệu bằng tiếng nước ngoài hoặc là tài liệu học ngoại ngữ (ví dụ: tiếng Nhật, tiếng Trung, tiếng Hàn, tiếng Anh, v.v.):
   - Câu hỏi (question) và các đáp án lựa chọn (options) BẮT BUỘC phải viết 100% bằng chính ngôn ngữ nước ngoài đó (ví dụ: tiếng Nhật). TUYỆT ĐỐI CẤM dịch nghĩa tiếng Việt, cấm giải thích hay ghi phiên âm/Romaji/cách đọc ở trong trường question và options.
   - Bản dịch tiếng Việt, phiên âm/cách phát âm/Romaji/Furigana, và giải thích chi tiết tại sao đúng/sai BẮT BUỘC chỉ được đưa vào trường giải thích (explanation). Trường explanation sẽ hiển thị sau khi người dùng nộp bài để họ đối chiếu và học tập.

Ví dụ cụ thể về cách định dạng trường dữ liệu:
[ĐÚNG HỢP LỆ]:
- question: "きょうとは どうですか？"
- options: ["きれいです。", "おいしいですが、ねだんがたかいです。", "きれいだし、たかいです。", "きれいだし、ゆうめいです。"] (Chú ý: Tất cả các phương án đều viết bằng tiếng Nhật thuần túy, không có chứa bản dịch tiếng Việt hay phiên âm đính kèm).
- explanation: "きょうとは どうですか？ (Kyoto thế nào?) -> Đáp án đúng: きれいです (Đẹp). Câu này đọc là: Kirei desu. Nghĩa: Đẹp..."

[SAI CẤM SỬ DỤNG]:
- options: ["きれいです。 (Kirei desu) / Đẹp nhưng không yên tĩnh.", "おいしいですが... / Ngon nhưng giá đắt."] (Lỗi vì chứa dịch nghĩa tiếng Việt và cách phát âm ngay trong các đáp án lựa chọn).

3. Nếu tài liệu bằng tiếng Việt: Câu hỏi, các đáp án lựa chọn (options), đáp án đúng (answer) và giải thích (explanation) đều viết bằng tiếng Việt.

Mỗi câu hỏi phải có đúng 4 đáp án lựa chọn (A, B, C, D) và chỉ rõ đáp án đúng (phải trùng khớp hoàn toàn với một trong bốn chuỗi ký tự trong options).

ĐẶC BIỆT LƯU Ý VỀ ĐỊNH DẠNG JSON:
- Phải đảm bảo trả về định dạng JSON hợp lệ tuyệt đối, khớp với schema đã cho.
- Không được chứa các ký tự xuống dòng (newline) trực tiếp trong các chuỗi ký tự JSON. Tất cả các dấu xuống dòng (nếu có) phải được viết dưới dạng \\n.
- Tất cả dấu nháy kép bên trong giá trị chuỗi phải được escape bằng dấu gạch chéo ngược (ví dụ: \\\").

Tài liệu:\n\n${text.substring(0, limit)}`;

    const result = await generateWithRetry(model, prompt);
    const responseText = result.response.text();
    return safeJsonParse(responseText);
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

    const limit = isPro ? 20000 : 8000;
    const prompt = `Tạo một bộ thẻ ghi nhớ (flashcard) gồm đúng ${cardCount} thẻ dựa trên nội dung tài liệu sau.
Yêu cầu về tư duy sư phạm và thiết lập thẻ ghi nhớ linh hoạt:
- KHÔNG TRÍCH XUẤT THỤ ĐỘNG: Đừng chỉ sao chép hoặc dịch nghĩa thô cứng từng từ một.
- TẠO PHẢN XẠ GIAO TIẾP: Đối với các mẫu câu, hội thoại hoặc câu hỏi xuất hiện trong tài liệu (ví dụ: "日本りょうり は どうですか？"):
  + Mặt trước (front_text) phải là câu hỏi hoặc tình huống giao tiếp viết bằng chính ngôn ngữ nước ngoài đó (ví dụ: "日本りょうり は どうですか？").
  + Mặt sau (back_text) phải là câu trả lời giao tiếp hợp lý, tự nhiên nhất bằng ngôn ngữ đó (ví dụ: "美味しいですが、値段が高いです") kèm theo cách phát âm/cách đọc và nghĩa tiếng Việt tương ứng để người học vừa ghi nhớ từ vựng vừa luyện phản xạ giao tiếp.

Yêu cầu về ngôn ngữ và nội dung thẻ ghi nhớ:
1. Hãy tự động nhận diện ngôn ngữ chính của tài liệu.
2. Nếu tài liệu bằng tiếng Việt: Mặt trước (front_text) là câu hỏi ngắn hoặc khái niệm bằng tiếng Việt, mặt sau (back_text) là câu trả lời ngắn gọn hoặc định nghĩa bằng tiếng Việt.
3. Nếu tài liệu bằng tiếng nước ngoài hoặc là tài liệu học ngoại ngữ (ví dụ: tiếng Nhật, tiếng Trung, tiếng Hàn, tiếng Anh, v.v.):
   - Các thẻ ghi nhớ phải được thiết kế để giúp người ôn tập học và luyện tập ngôn ngữ đó. Không dịch toàn bộ câu chữ sang tiếng Việt ở cả hai mặt.
   - Mặt trước (front_text) phải chứa từ vựng, mẫu ngữ pháp, cụm từ, câu ví dụ hoặc câu hỏi giao tiếp viết bằng chính ngôn ngữ nước ngoài đó (ví dụ: tiếng Nhật).
   - Mặt sau (back_text) phải chứa nghĩa tiếng Việt, cách phát âm/phiên âm/cách đọc (như Romaji/Furigana cho tiếng Nhật, Pinyin cho tiếng Trung nếu có), và lời giải nghĩa hoặc câu trả lời tự nhiên bằng ngôn ngữ gốc kèm tiếng Việt để hỗ trợ học tập hiệu quả.

ĐẶC BIỆT LƯU Ý VỀ ĐỊNH DẠNG JSON:
- Phải đảm bảo trả về định dạng JSON hợp lệ tuyệt đối, khớp với schema đã cho.
- Không được chứa các ký tự xuống dòng (newline) trực tiếp trong các chuỗi ký tự JSON. Tất cả các dấu xuống dòng (nếu có) phải được viết dưới dạng \\n.
- Tất cả dấu nháy kép bên trong giá trị chuỗi phải được escape bằng dấu gạch chéo ngược (ví dụ: \\\").

Tài liệu:\n\n${text.substring(0, limit)}`;

    const result = await generateWithRetry(model, prompt);
    const responseText = result.response.text();
    return safeJsonParse(responseText);
  } catch (err) {
    console.error('Error in Gemini generateFlashcards:', err);
    throw new Error(parseAiError(err, 'Không thể tự động tạo bộ flashcard từ tài liệu này.'));
  }
};

module.exports = { extractMetadata, summarizeDocument, answerQuestion, answerQuestionStream, generateContentStreamWithRetry, generateQuiz, generateFlashcards };

