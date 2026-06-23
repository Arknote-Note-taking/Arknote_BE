const supabase = require('../config/supabaseClient');
const { summarizeDocument, answerQuestion, answerQuestionStream, generateContentStreamWithRetry, extractMetadata, generateQuiz } = require('../services/aiService');
const { isUserPro } = require('./userController');

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

    const summary = await summarizeDocument(doc.content);
    
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
    const { documentId, question } = req.body;
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

    // Run streaming content generation
    await answerQuestionStream(doc.content, question, (chunk) => {
      res.write(chunk);
    });
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
    const { message } = req.body;
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
      const result = await generateContentStreamWithRetry(model, message);
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

    const metadata = await extractMetadata(doc.content);

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
    const { folderId, question } = req.body;
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

    // 4. Call answerQuestionStream
    await answerQuestionStream(aggregatedContext, question, (chunk) => {
      res.write(chunk);
    });
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
    const { documentId } = req.body;
    if (!documentId) return res.status(400).json({ error: 'Document ID is required' });

    // Check if user is Pro
    const userPro = isUserPro(req.user.id);
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

    const quiz = await generateQuiz(doc.content);
    res.status(200).json({ quiz });
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
