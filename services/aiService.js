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

const isComparisonFlashcardFront = (frontText) => {
  const text = String(frontText || '').trim().toLowerCase();
  const compactText = text.replace(/\s+/g, '');

  return (
    /\bvs\b|ｖｓ|v\.s\./i.test(text) ||
    /so sánh|phan biet|phân biệt|khác nhau|違い|ちがい|使い分け/i.test(text) ||
    /「[^」]+」\s*(?:vs|ｖｓ|v\.s\.|／|\/)\s*「[^」]+」/i.test(text) ||
    /[^\s]+(?:\s+|[「」])(?:vs|ｖｓ|v\.s\.)(?:\s+|[「」])[^\s]+/i.test(text) ||
    /[^\s]+[／/][^\s]+/.test(compactText)
  );
};

const normalizeFlashcardFrontKey = (frontText) => (
  String(frontText || '')
    .toLowerCase()
    .trim()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?[\]"'「」『』（）()、。・\s]/g, '')
);

const hasJapaneseKanji = (text) => /[\u3400-\u9fff]/.test(String(text || ''));

const hasJapaneseReading = (text) => /[ぁ-ゖァ-ヺー]/.test(String(text || ''));

const shouldRequireJapaneseReading = (sourceText, card) => {
  const source = String(sourceText || '');
  const frontText = String(card?.front_text || '');
  const backText = String(card?.back_text || '');
  return hasJapaneseReading(source) || hasJapaneseReading(frontText) || hasJapaneseReading(backText);
};

const isValidGeneratedFlashcard = (card, sourceText = '') => {
  const frontText = String(card?.front_text || '').trim();
  const backText = String(card?.back_text || '').trim();
  if (!frontText || !backText) return false;
  if (isComparisonFlashcardFront(frontText)) return false;
  if (shouldRequireJapaneseReading(sourceText, card) && hasJapaneseKanji(frontText) && !hasJapaneseReading(backText)) return false;
  return true;
};

const sanitizeGeneratedFlashcards = (cards, sourceText = '') => {
  if (!Array.isArray(cards)) return [];

  return cards
    .map((card) => {
      const frontText = String(card?.front_text || '').trim();
      let backText = String(card?.back_text || '').trim();
      if (!frontText || !backText) return null;

      if (isComparisonFlashcardFront(frontText)) return null;

      let cleanFront = frontText;
      const parentheticalReading = frontText.match(/^(.+?)\s*[（(]([ぁ-ゖァ-ヺーa-zA-Z\s・]+)[）)]\s*$/);
      if (parentheticalReading && /[\u3400-\u9fff]/.test(parentheticalReading[1])) {
        cleanFront = parentheticalReading[1].trim();
        const reading = parentheticalReading[2].trim();
        if (reading && !backText.includes(reading)) {
          backText = `Phiên âm / Cách đọc: ${reading}\n${backText}`;
        }
      }

      const normalizedCard = {
        front_text: cleanFront,
        back_text: backText
      };

      if (!isValidGeneratedFlashcard(normalizedCard, sourceText)) return null;

      return normalizedCard;
    })
    .filter(Boolean);
};

const mergeUniqueFlashcards = (currentCards, nextCards, targetCount, sourceText = '') => {
  const seen = new Set(currentCards.map(card => normalizeFlashcardFrontKey(card.front_text)));
  const merged = [...currentCards];

  for (const card of nextCards) {
    if (!isValidGeneratedFlashcard(card, sourceText)) continue;
    const key = normalizeFlashcardFrontKey(card.front_text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(card);
    if (merged.length >= targetCount) break;
  }

  return merged;
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
        maxOutputTokens: 16384
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

    const generateAndParse = async (promptText) => {
      const result = await generateWithRetry(model, promptText);
      const responseText = result.response.text();
      return safeJsonParse(responseText);
    };

    let parsedFlashcards = await generateAndParse(prompt);
    if (hasRequestedCount && Array.isArray(parsedFlashcards) && parsedFlashcards.length !== cardCount) {
      const retryPrompt = `${prompt}

Lần trả lời trước tạo ${parsedFlashcards.length} thẻ, sai số lượng người dùng yêu cầu.
Hãy tạo lại JSON array với ĐÚNG CHÍNH XÁC ${cardCount} object flashcard.
Không được trả ít hơn hoặc nhiều hơn ${cardCount} object.`;
      parsedFlashcards = await generateAndParse(retryPrompt);
    }

    if (hasRequestedCount && (!Array.isArray(parsedFlashcards) || parsedFlashcards.length !== cardCount)) {
      const actualCount = Array.isArray(parsedFlashcards) ? parsedFlashcards.length : 0;
      throw new Error(`AI chỉ tạo được ${actualCount}/${cardCount} thẻ theo yêu cầu. Hệ thống không lưu kết quả sai số lượng, vui lòng thử lại.`);
    }

    return parsedFlashcards;
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

const generateFlashcards = async (text, isPro = true, count = null) => {
  const defaultCount = isPro ? 40 : 20;
  const cardCount = count ? parseInt(count, 10) : defaultCount;

  if (useMock) {
    throw new Error('Chưa cấu hình GEMINI_API_KEY nên không thể tạo flashcard từ dữ liệu thật.');
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
        maxOutputTokens: 16384
      }
    });

    const limit = isPro ? 25000 : 10000;
    const hasRequestedCount = count !== null && count !== undefined && !Number.isNaN(cardCount);
    const promptCountText = hasRequestedCount
      ? `ĐÚNG CHÍNH XÁC ${cardCount} thẻ ghi nhớ, không ít hơn và không nhiều hơn`
      : isPro
      ? 'tất cả các từ vựng, thuật ngữ, mẫu ngữ pháp và nội dung cốt lõi có trong tài liệu'
      : `đúng ${cardCount} thẻ ghi nhớ`;

    const prompt = `Bạn là một chuyên gia sư phạm & AI thiết kế flashcard học tập.
Hãy đọc kỹ nội dung tài liệu dưới đây để tạo ${promptCountText} từ dữ liệu thật trong tài liệu.

================================================================================
QUY TẮC BẮT BUỘC CHO MẶT TRƯỚC (front_text) VÀ MẶT SAU (back_text)
================================================================================

1. Mặt trước (front_text):
   - Chỉ chứa MỘT từ vựng, thuật ngữ, cụm từ, mẫu câu ngắn hoặc ý trọng tâm lấy trực tiếp từ tài liệu.
   - Nếu tài liệu là tiếng Nhật và từ là Kanji, front_text chỉ ghi Kanji/từ gốc. KHÔNG thêm Hiragana/Furigana/Romaji/phiên âm ở mặt trước.
   - Không lấy thuật ngữ từ ví dụ bên ngoài. Chỉ lấy front_text từ chính nội dung tài liệu được cung cấp.
   - Không đặt front_text dưới dạng câu hỏi chung chung hoặc ghép nhiều thuật ngữ vào cùng một thẻ.
   - KHÔNG tạo thẻ dạng so sánh từ, phân biệt từ, "A vs B", hoặc ghép 2 từ trên cùng một mặt trước. Mỗi flashcard chỉ học một từ/khái niệm.
   - Nếu tài liệu có đoạn so sánh/phân biệt nhiều từ, hãy TÁCH thành nhiều flashcard riêng: mỗi từ là một thẻ độc lập. Không đặt chữ "vs", "khác nhau", "phân biệt", "違い", "使い分け" ở front_text.

2. Mặt sau (back_text):
   - Mặt sau mới hiển thị phiên âm/cách đọc nếu có, ví dụ Hiragana/Furigana/Romaji/Pinyin/IPA.
   - Nếu tài liệu là tiếng Nhật và front_text có Kanji, back_text BẮT BUỘC có dòng "Phiên âm: <cách đọc bằng Hiragana/Katakana>". Với tài liệu không phải tiếng Nhật, không tự thêm Hiragana/Katakana.
   - Mặt sau giải thích nghĩa tiếng Việt rõ ràng, loại từ nếu nhận diện được, sắc thái sử dụng nếu cần, và 1 câu ví dụ lấy theo ngữ cảnh tài liệu hoặc sát nội dung tài liệu.
   - Trình bày bằng các dòng ngắn, dùng ký tự xuống dòng \\n trong chuỗi JSON.

================================================================================
ĐỊNH DẠNG NỘI DUNG THẺ
================================================================================

Với từ vựng/thuật ngữ:
- front_text: <chỉ từ gốc, không phiên âm nếu từ là Kanji>
- back_text:
Phiên âm: <Hiragana/Furigana/Romaji/Pinyin/IPA nếu có>
Nghĩa tiếng Việt: <nghĩa chính xác>
Giải thích: <giải thích ngắn, dễ hiểu>
Ví dụ: <câu ví dụ bằng ngôn ngữ gốc>
Dịch ví dụ: <bản dịch tiếng Việt>

Với ngữ pháp/mẫu câu/ý chính:
- front_text: <mẫu câu hoặc cụm trọng tâm ngắn>
- back_text:
Nghĩa tiếng Việt: <dịch nghĩa>
Giải thích: <cách dùng hoặc ý chính>
Ví dụ: <ví dụ minh họa>
Dịch ví dụ: <bản dịch tiếng Việt>

--- ĐỊNH DẠNG JSON ---
- Trả về đúng định dạng JSON array chứa { "front_text": "...", "back_text": "..." }.
- Tất cả các dấu xuống dòng bên trong chuỗi JSON BẮT BUỘC phải viết dưới dạng \\n.
- Không dùng dữ liệu mẫu, không tự bịa từ ngoài tài liệu. Chỉ tạo thẻ từ nội dung thật của tài liệu.
- Nếu yêu cầu số lượng cụ thể, JSON array BẮT BUỘC có đúng số object tương ứng.

Tài liệu:\n\n${text.substring(0, limit)}`;

    const generateAndSanitize = async (promptText) => {
      const result = await generateWithRetry(model, promptText);
      const responseText = result.response.text();
      return sanitizeGeneratedFlashcards(safeJsonParse(responseText), text);
    };

    let flashcards = await generateAndSanitize(prompt);
    if (hasRequestedCount && flashcards.length !== cardCount) {
      const maxCompletionAttempts = 4;

      for (let attempt = 1; attempt <= maxCompletionAttempts && flashcards.length < cardCount; attempt += 1) {
        const missingCount = cardCount - flashcards.length;
        const existingFronts = flashcards
          .map(card => `- ${card.front_text}`)
          .join('\n') || '- Chưa có thẻ hợp lệ nào';

        const retryPrompt = `${prompt}

Hệ thống đã kiểm tra và hiện mới có ${flashcards.length}/${cardCount} thẻ hợp lệ.
Hãy tạo THÊM ĐÚNG ${missingCount} object flashcard mới, chỉ từ nội dung thật của tài liệu, không lặp các mặt trước đã có.

Các front_text đã có, KHÔNG được lặp:
${existingFronts}

Nhắc lại:
- Không dùng dữ liệu mẫu, không tự bịa ngoài tài liệu.
- Mặt trước không được chứa Hiragana/Furigana/Romaji nếu từ là Kanji tiếng Nhật.
- Mặt trước không được là dạng so sánh "A vs B" hoặc phân biệt từ.
- Nếu nguồn có so sánh từ, hãy tách từng từ thành từng thẻ riêng.
- Nếu tài liệu là tiếng Nhật và front_text có Kanji, back_text bắt buộc có phiên âm Hiragana/Katakana.
- Mỗi object chỉ là một từ vựng/khái niệm/ý chính riêng.`;

        const nextFlashcards = await generateAndSanitize(retryPrompt);
        flashcards = mergeUniqueFlashcards(flashcards, nextFlashcards, cardCount, text);
      }
    }

    if (hasRequestedCount && flashcards.length !== cardCount) {
      throw new Error(`AI chỉ tạo được ${flashcards.length}/${cardCount} thẻ hợp lệ theo yêu cầu. Hệ thống không lưu kết quả sai định dạng hoặc sai số lượng, vui lòng thử lại.`);
    }

    return flashcards;
  } catch (err) {
    console.error('Error in Gemini generateFlashcards:', err);
    throw new Error(parseAiError(err, 'Không thể tự động tạo bộ flashcard từ tài liệu này.'));
  }
};

module.exports = { extractMetadata, summarizeDocument, answerQuestion, answerQuestionStream, generateContentStreamWithRetry, generateQuiz, generateFlashcards, isValidGeneratedFlashcard };
