const supabase = require('../config/supabaseClient');
const { summarizeDocument, answerQuestion, answerQuestionStream, generateContentStreamWithRetry, extractMetadata, generateQuiz } = require('../services/aiService');
const { isUserPro } = require('./userController');
const { retrieveRelevantChunks } = require('../services/ragService');
const { enqueueAiJob } = require('../services/jobQueue');
const crypto = require('crypto');

const getQuizHash = (questions) => {
  if (Array.isArray(questions) && questions.length > 0 && questions[0]?.isMetadata) {
    return questions[0].hash;
  }
  return null;
};

const cleanQuizQuestions = (quiz) => {
  if (quiz && Array.isArray(quiz.questions) && quiz.questions[0]?.isMetadata) {
    quiz.questions = quiz.questions.slice(1);
  }
  return quiz;
};

const getChatHistoryPrompt = async (chatId, userId) => {
  if (!chatId) return '';
  try {
    const { data: chatObj, error: chatErr } = await supabase
      .from('chat_histories')
      .select('messages')
      .eq('id', chatId)
      .eq('user_id', userId)
      .single();
    
    if (!chatErr && chatObj && chatObj.messages) {
      const msgs = typeof chatObj.messages === 'string' ? JSON.parse(chatObj.messages) : chatObj.messages;
      const recentMsgs = msgs.slice(-15);
      if (recentMsgs.length > 0) {
        return `\n[Lịch sử các lượt trò chuyện trước đó trong phiên chat này]:\n` + 
          recentMsgs.map(m => `${m.role === 'user' ? 'Người dùng' : 'Trợ lý AI'}: ${m.text}`).join('\n') + '\n';
      }
    }
  } catch (err) {
    console.error('Error fetching chat history:', err);
  }
  return '';
};

const triggerSummarize = async (req, res) => {
  try {
    const { data: doc, error: err1 } = await supabase.from('documents').select('*').eq('id', req.body.documentId).single();
    if (err1 || !doc || doc.is_deleted) return res.status(404).json({ error: 'Document not found' });
    
    if (req.user.role !== 'admin' && doc.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access forbidden' });
    }

    if (doc.summary) {
      return res.status(200).json({ summary: doc.summary }); // already summarized
    }

    const isPro = (await isUserPro(req.user.id)) || req.user.role === 'admin';
    const summary = await summarizeDocument(doc.content, isPro);
    
    const { data: updatedDoc, error: err2 } = await supabase
      .from('documents')
      .update({ summary })
      .eq('id', doc.id)
      .select()
      .single();
      
    if (err2) throw err2;

    req.io.emit('document_updated', { ...updatedDoc, _id: updatedDoc.id });
    res.status(200).json({ summary });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const triggerQnA = async (req, res) => {
  try {
    const { documentId, question, chatId } = req.body;
    const { data: doc, error: err1 } = await supabase.from('documents').select('id, user_id, is_deleted, content').eq('id', documentId).single();
    if (err1 || !doc || doc.is_deleted) return res.status(404).json({ error: 'Document not found' });
    
    if (req.user.role !== 'admin' && doc.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access forbidden' });
    }

    // Set streaming headers
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const isPro = (await isUserPro(req.user.id)) || req.user.role === 'admin';
    const historyPrompt = await getChatHistoryPrompt(chatId, req.user.id);
    // Run streaming content generation
    await answerQuestionStream(doc.content, question, (chunk) => {
      res.write(chunk);
    }, isPro, historyPrompt);
    res.end();
  } catch (error) {
    if (res.headersSent) {
      res.write(`\n[ERROR]: ${error.message}`);
      res.end();
    } else {
      res.status(500).json({ error: error.message });
    }
  }
};

const triggerChat = async (req, res) => {
  try {
    const { message, chatId } = req.body;
    if (!message) return res.status(400).json({ error: 'Message cannot be empty' });
    
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const apiKey = process.env.GEMINI_API_KEY;
    const genAIObj = apiKey ? new (require('@google/generative-ai').GoogleGenerativeAI)(apiKey) : null;
    const useMockVal = !genAIObj;

    if (!useMockVal) {
      const model = genAIObj.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const historyPrompt = await getChatHistoryPrompt(chatId, req.user.id);
      const prompt = `Bạn là một trợ lý AI thông minh.
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
- Phản hồi chính xác (Accuracy) & Trung thực: Đưa thông tin có căn cứ, thừa nhận khi không biết/không làm được thay vì tự bịa.
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
- Tự động nhận diện ngôn ngữ của tin nhắn/câu hỏi từ người dùng. Nếu người dùng nhắn/hỏi bằng tiếng Việt, bạn BẮT BUỘC phải trả lời bằng tiếng Việt. Nếu người dùng nhắn/hỏi bằng tiếng Anh, bạn BẮT BUỘC phải trả lời bằng tiếng Anh.

${historyPrompt}
Tin nhắn hiện tại của người dùng: ${message}`;
      const result = await generateContentStreamWithRetry(model, prompt);
      for await (const chunk of result.stream) {
        res.write(chunk.text());
      }
    } else {
      const mockResponse = `Tôi đã nhận được yêu cầu "${message}".\nHệ thống đang lọc các tài liệu có liên đới thuộc cơ sở dữ liệu của bạn, bao gồm các chính sách Nhân sự và Luật pháp.\n\nCó tài liệu nào cụ thể mảng này bạn muốn tôi đào sâu không?`;
      const words = mockResponse.split(' ');
      for (const word of words) {
        res.write(word + ' ');
        await new Promise(r => setTimeout(r, 60));
      }
    }
    res.end();
  } catch (error) {
    if (res.headersSent) {
      res.write(`\n[ERROR]: ${error.message}`);
      res.end();
    } else {
      res.status(500).json({ error: error.message });
    }
  }
};

const triggerReanalyze = async (req, res) => {
  try {
    const { documentId } = req.body;
    const { data: doc, error: err1 } = await supabase.from('documents').select('*').eq('id', documentId).single();
    if (err1 || !doc || doc.is_deleted) return res.status(404).json({ error: 'Document not found' });
    
    if (req.user.role !== 'admin' && doc.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access forbidden' });
    }

    const isPro = (await isUserPro(req.user.id)) || req.user.role === 'admin';
    const metadata = await extractMetadata(doc.content, isPro);

    res.status(200).json({
      title: metadata.title || doc.title,
      subject: metadata.subject || doc.subject,
      summary: metadata.summary || doc.summary
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const triggerFolderChat = async (req, res) => {
  try {
    const { folderId, question, chatId } = req.body;
    if (!folderId) return res.status(400).json({ error: 'Folder ID is required' });
    if (!question) return res.status(400).json({ error: 'Question is required' });

    // 1. Check folder
    const { data: folder, error: folderErr } = await supabase
      .from('folders')
      .select('*')
      .eq('id', folderId)
      .single();

    if (folderErr || !folder) return res.status(404).json({ error: 'Folder not found' });
    if (folder.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access forbidden' });
    }

    // 2. Fetch all documents in folder
    const { data: docs, error: docsErr } = await supabase
      .from('documents')
      .select('title, content')
      .eq('folder_id', folderId)
      .eq('is_deleted', false);

    if (docsErr) throw docsErr;
    
    // Set streaming headers
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    if (!docs || docs.length === 0) {
      res.write('Không tìm thấy tài liệu nào trong thư mục này để phân tích.');
      res.end();
      return;
    }

    // 3. Concatenate content
    let aggregatedContext = '';
    docs.forEach((doc, idx) => {
      aggregatedContext += `--- Tài liệu ${idx + 1}: ${doc.title} ---\nNội dung:\n${doc.content || ''}\n\n`;
    });

    const isPro = (await isUserPro(req.user.id)) || req.user.role === 'admin';
    const historyPrompt = await getChatHistoryPrompt(chatId, req.user.id);
    // 4. Call answerQuestionStream
    await answerQuestionStream(aggregatedContext, question, (chunk) => {
      res.write(chunk);
    }, isPro, historyPrompt);
    res.end();
  } catch (error) {
    if (res.headersSent) {
      res.write(`\n[ERROR]: ${error.message}`);
      res.end();
    } else {
      res.status(500).json({ error: error.message });
    }
  }
};

const triggerQuiz = async (req, res) => {
  try {
    const { documentId, count } = req.body;
    if (!documentId) return res.status(400).json({ error: 'Document ID is required' });

    // Check if user is Pro
    const userPro = await isUserPro(req.user.id);
    if (!userPro && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Tính năng tạo Quiz trắc nghiệm chỉ dành riêng cho tài khoản Pro. Vui lòng nâng cấp tài khoản!' });
    }

    const { data: doc, error: err1 } = await supabase
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .single();

    if (err1 || !doc || doc.is_deleted) {
      return res.status(404).json({ error: 'Document not found' });
    }

    if (req.user.role !== 'admin' && doc.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access forbidden' });
    }

    const isPro = userPro || req.user.role === 'admin';
    const quizTitle = doc.title;

    // Check cache: if quiz already exists and contains questions, return it directly unless forceRegenerate is requested
    const { data: existingQuizzes, error: selectErr } = await supabase
      .from('quizzes')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('document_id', documentId)
      .eq('title', quizTitle);

    const existingQuiz = !selectErr && existingQuizzes && existingQuizzes.length > 0 ? existingQuizzes[0] : null;
    const currentHash = crypto.createHash('md5').update(doc.content || '').digest('hex');

    if (existingQuiz) {
      const oldHash = getQuizHash(existingQuiz.questions);
      if (req.body.forceRegenerate) {
        if (currentHash === oldHash && req.body.ignoreHashCheck !== true) {
          return res.status(409).json({ error: 'content_not_changed', message: 'Tài liệu không có thay đổi nội dung mới.' });
        }
        if (!req.body.mode) {
          return res.status(200).json({ status: 'confirm_mode', message: 'Bạn muốn ghi đè bài trắc nghiệm cũ hay gộp thêm câu hỏi mới?' });
        }
      } else {
        if (existingQuiz.questions && existingQuiz.questions.length > 0) {
          return res.status(200).json({ quiz: cleanQuizQuestions(existingQuiz) });
        }
      }
    }

    // Attempt to enqueue job (async mode via BullMQ + Upstash)
    const jobResult = await enqueueAiJob('generate_quiz', {
      documentId,
      userId: req.user.id,
      count: count ? parseInt(count, 10) : 5,
      isPro,
      quizTitle,
      forceRegenerate: !!req.body.forceRegenerate,
      mode: req.body.mode,
      ignoreHashCheck: !!req.body.ignoreHashCheck,
      currentHash
    });

    if (jobResult) {
      // Queue available — respond immediately with jobId
      return res.status(202).json({ jobId: jobResult.jobId, status: 'queued' });
    }

    // ---- Fallback: synchronous execution (no Redis) ----
    // Use RAG to retrieve the most relevant chunks for quiz generation; fall back to full content
    const ragContext = await retrieveRelevantChunks(documentId, 'Tạo bộ câu hỏi trắc nghiệm kiểm tra kiến thức từ tài liệu này');
    const contentForQuiz = ragContext || doc.content;
    console.log(`[Quiz] Using ${ragContext ? 'RAG context' : 'full doc content'} for document: ${documentId}`);

    const generatedQuestions = await generateQuiz(contentForQuiz, isPro, count ? parseInt(count, 10) : 5);

    let finalQuestions = [];
    if (existingQuiz && req.body.mode === 'merge') {
      const oldQuestions = existingQuiz.questions.filter(q => !q.isMetadata);
      const existingTexts = new Set(oldQuestions.map(q => q.question.toLowerCase().trim().replace(/[.,/#!$%^&*;:{}=\-_`~()?]/g,"")));
      
      const uniqueNewQuestions = generatedQuestions.filter(q => {
        const normalizedText = q.question.toLowerCase().trim().replace(/[.,/#!$%^&*;:{}=\-_`~()?]/g,"");
        return !existingTexts.has(normalizedText);
      });
      finalQuestions = [{ isMetadata: true, hash: currentHash }, ...oldQuestions, ...uniqueNewQuestions];
    } else {
      // Overwrite mode or brand new quiz
      finalQuestions = [{ isMetadata: true, hash: currentHash }, ...generatedQuestions];
    }

    let targetQuiz = null;

    if (existingQuiz) {
      targetQuiz = existingQuiz;
      const { data: updatedQuiz, error: updateErr } = await supabase
        .from('quizzes')
        .update({
          questions: finalQuestions
        })
        .eq('id', targetQuiz.id)
        .select()
        .single();

      if (updateErr) throw updateErr;
      targetQuiz = updatedQuiz;

      // Delete any previous attempts for this quiz and user to reset progress if overwriting
      if (req.body.mode === 'overwrite') {
        const { error: deleteErr } = await supabase
          .from('quiz_attempts')
          .delete()
          .eq('quiz_id', targetQuiz.id)
          .eq('user_id', req.user.id);

        if (deleteErr) throw deleteErr;
      }
    } else {
      const { data: newQuiz, error: insertError } = await supabase
        .from('quizzes')
        .insert([{
          user_id: req.user.id,
          document_id: documentId,
          title: quizTitle,
          questions: finalQuestions
        }])
        .select()
        .single();

      if (insertError) throw insertError;
      targetQuiz = newQuiz;
    }

    res.status(200).json({ quiz: cleanQuizQuestions(targetQuiz) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getChatHistories = async (req, res) => {
  try {
    const { data: chats, error } = await supabase
      .from('chat_histories')
      .select('*')
      .eq('user_id', req.user.id)
      .order('updated_at', { ascending: false });

    if (error) throw error;
    res.status(200).json(chats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const createChatHistory = async (req, res) => {
  const { title, context_doc_id, context_folder_id } = req.body;
  try {
    const defaultMessages = [
      {
        role: 'ai',
        text: 'Xin chào! Tôi là AI trợ lý phân tích tài liệu. Bạn có thể:\n- Chọn hoặc tải lên tài liệu / thư mục để phân tích\n- Hỏi về nội dung tài liệu / thư mục\n- Yêu cầu tóm tắt nội dung\n- Tìm kiếm thông tin cốt lõi'
      }
    ];

    const { data: chat, error } = await supabase
      .from('chat_histories')
      .insert([{
        user_id: req.user.id,
        title: title || 'Cuộc trò chuyện mới',
        messages: JSON.stringify(defaultMessages),
        context_doc_id: context_doc_id || null,
        context_folder_id: context_folder_id || null
      }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(chat);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const updateChatHistory = async (req, res) => {
  const { id } = req.params;
  const { title, messages, context_doc_id, context_folder_id } = req.body;
  try {
    const updateData = { updated_at: new Date().toISOString() };
    if (title !== undefined) updateData.title = title;
    if (messages !== undefined) {
      updateData.messages = typeof messages === 'string' ? messages : JSON.stringify(messages);
    }
    if (context_doc_id !== undefined) updateData.context_doc_id = context_doc_id;
    if (context_folder_id !== undefined) updateData.context_folder_id = context_folder_id;

    const { data: chat, error } = await supabase
      .from('chat_histories')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', req.user.id)
      .select()
      .single();

    if (error) throw error;
    res.status(200).json(chat);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const deleteChatHistory = async (req, res) => {
  const { id } = req.params;
  try {
    const { error } = await supabase
      .from('chat_histories')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.id);

    if (error) throw error;
    res.status(200).json({ success: true, message: 'Deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = { 
  triggerSummarize, 
  triggerQnA, 
  triggerChat, 
  triggerReanalyze, 
  triggerFolderChat, 
  triggerQuiz,
  getChatHistories,
  createChatHistory,
  updateChatHistory,
  deleteChatHistory
};
