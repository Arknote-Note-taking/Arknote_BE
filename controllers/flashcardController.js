const supabase = require('../config/supabaseClient');
const { generateFlashcards } = require('../services/aiService');
const { isUserPro } = require('./userController');

// 1. Create custom deck
const createDeck = async (req, res) => {
  try {
    const { title, description, documentId } = req.body;
    if (!title) return res.status(400).json({ error: 'Tiêu đề là bắt buộc' });

    const { data: deck, error } = await supabase
      .from('flashcard_decks')
      .insert([{
        user_id: req.user.id,
        document_id: documentId || null,
        title,
        description: description || ''
      }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(deck);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 2. Get all decks for user
const getDecks = async (req, res) => {
  try {
    let query = supabase
      .from('flashcard_decks')
      .select('*, documents(title)');

    if (req.user.role !== 'admin') {
      query = query.eq('user_id', req.user.id);
    }

    const { data: decks, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;

    let responseDecks = decks;
    if (req.user.role === 'admin') {
      const { data: users, error: userErr } = await supabase
        .from('users')
        .select('id, email, name');
      
      if (!userErr && users) {
        const userMap = {};
        users.forEach(u => {
          userMap[u.id] = { email: u.email, name: u.name };
        });
        responseDecks = decks.map(deck => ({
          ...deck,
          users: userMap[deck.user_id] || null
        }));
      }
    }

    res.status(200).json(responseDecks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 3. Get deck and its cards
const getDeckById = async (req, res) => {
  try {
    const { id } = req.params;

    // Fetch deck
    const { data: deck, error: deckErr } = await supabase
      .from('flashcard_decks')
      .select('*, documents(title)')
      .eq('id', id)
      .single();

    if (deckErr || !deck) return res.status(404).json({ error: 'Không tìm thấy bộ Flashcard' });
    if (deck.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access forbidden' });
    }

    // Fetch flashcards and reviews
    const { data: cards, error: cardsErr } = await supabase
      .from('flashcards')
      .select('*, flashcard_reviews(*)')
      .eq('deck_id', id);

    if (cardsErr) throw cardsErr;

    res.status(200).json({ deck, cards });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 4. Generate AI Flashcards
const generateAiFlashcards = async (req, res) => {
  try {
    const { documentId, count } = req.body;
    console.log("SUPABASE_KEY inside controller:", process.env.SUPABASE_KEY ? process.env.SUPABASE_KEY.substring(0, 15) : 'undefined');
    if (!documentId) return res.status(400).json({ error: 'Mã tài liệu là bắt buộc' });

    // Fetch document
    const { data: doc, error: docErr } = await supabase
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .single();

    if (docErr || !doc || doc.is_deleted) return res.status(404).json({ error: 'Document not found' });
    
    let canGenerate = false;
    if (doc.user_id === req.user.id || req.user.role === 'admin') {
      canGenerate = true;
    } else if (doc.folder_id) {
      const { data: share } = await supabase
        .from('folder_shares')
        .select('*')
        .eq('folder_id', doc.folder_id)
        .eq('shared_to_email', req.user.email)
        .eq('permission_role', 'editor')
        .maybeSingle();
      if (share) canGenerate = true;
    }

    if (!canGenerate) {
      return res.status(403).json({ error: 'Bạn không có quyền tạo flashcard cho tài liệu này.' });
    }

    const userPro = await isUserPro(req.user.id);
    const cardCount = count ? parseInt(count, 10) : 8;

    // Call AI service to generate flashcards
    const flashcardsData = await generateFlashcards(doc.content, userPro || req.user.role === 'admin', cardCount);

    // Create flashcard deck
    const { data: deck, error: deckErr } = await supabase
      .from('flashcard_decks')
      .insert([{
        user_id: req.user.id,
        document_id: documentId,
        title: `Flashcard: ${doc.title}`,
      }])
      .select()
      .single();

    if (deckErr) throw deckErr;

    // Prepare cards
    const cardsToInsert = flashcardsData.map(c => ({
      deck_id: deck.id,
      front_text: c.front_text,
      back_text: c.back_text
    }));

    // Insert cards
    const { data: insertedCards, error: cardsErr } = await supabase
      .from('flashcards')
      .insert(cardsToInsert)
      .select();

    if (cardsErr) throw cardsErr;

    res.status(200).json({ deck, cards: insertedCards });
  } catch (error) {
    console.error("AI Flashcard Generation Error:", error);
    res.status(500).json({ error: error.message });
  }
};

// 5. Review Flashcard and calculate SM-2 spaced repetition status
const reviewFlashcard = async (req, res) => {
  try {
    const { cardId, grade } = req.body; // grade must be 0 to 5
    if (grade === undefined || grade < 0 || grade > 5) {
      return res.status(400).json({ error: 'Điểm đánh giá (grade) từ 0 đến 5 là bắt buộc' });
    }

    // Check if card exists and user has access to deck
    const { data: card, error: cardErr } = await supabase
      .from('flashcards')
      .select('*, flashcard_decks(user_id)')
      .eq('id', cardId)
      .single();

    if (cardErr || !card) return res.status(404).json({ error: 'Flashcard không tồn tại' });
    if (card.flashcard_decks.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access forbidden' });
    }

    // Get previous review if any
    const { data: prevReview, error: reviewErr } = await supabase
      .from('flashcard_reviews')
      .select('*')
      .eq('flashcard_id', cardId)
      .eq('user_id', req.user.id)
      .maybeSingle();

    let interval = 1;
    let repetitions = 0;
    let easeFactor = 2.5;

    if (prevReview) {
      interval = prevReview.interval;
      repetitions = prevReview.repetitions;
      easeFactor = Number(prevReview.ease_factor);
    }

    // SuperMemo-2 Spaced Repetition Algorithm
    if (grade < 3) {
      // Repetition failed, restart interval
      interval = 1;
      repetitions = 0;
    } else {
      // Repetition succeeded
      if (repetitions === 0) {
        interval = 1;
      } else if (repetitions === 1) {
        interval = 6;
      } else {
        interval = Math.round(interval * easeFactor);
      }
      repetitions += 1;

      // Update ease factor: EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
      easeFactor = easeFactor + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02));
      if (easeFactor < 1.3) easeFactor = 1.3;
    }

    const nextReviewAt = new Date(Date.now() + interval * 24 * 60 * 60 * 1000).toISOString();

    const { data: updatedReview, error: upsertErr } = await supabase
      .from('flashcard_reviews')
      .upsert({
        flashcard_id: cardId,
        user_id: req.user.id,
        interval,
        repetitions,
        ease_factor: easeFactor,
        next_review_at: nextReviewAt,
        last_reviewed_at: new Date().toISOString()
      }, { onConflict: 'user_id,flashcard_id' })
      .select()
      .single();

    if (upsertErr) throw upsertErr;

    res.status(200).json(updatedReview);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 6. Update deck (title, description)
const updateDeck = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description } = req.body;

    if (!title) return res.status(400).json({ error: 'Tiêu đề là bắt buộc' });

    // Verify ownership
    const { data: deck, error: getErr } = await supabase
      .from('flashcard_decks')
      .select('user_id')
      .eq('id', id)
      .single();

    if (getErr || !deck) return res.status(404).json({ error: 'Không tìm thấy bộ Flashcard' });
    if (deck.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access forbidden: Chỉ chủ sở hữu mới có quyền chỉnh sửa bộ Flashcard này.' });
    }

    const { data: updatedDeck, error } = await supabase
      .from('flashcard_decks')
      .update({ title, description: description || '' })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.status(200).json(updatedDeck);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 7. Delete deck
const deleteDeck = async (req, res) => {
  try {
    const { id } = req.params;

    // Verify ownership
    const { data: deck, error: getErr } = await supabase
      .from('flashcard_decks')
      .select('user_id, title')
      .eq('id', id)
      .single();

    if (getErr || !deck) return res.status(404).json({ error: 'Không tìm thấy bộ Flashcard' });
    if (deck.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access forbidden: Chỉ chủ sở hữu mới có quyền xóa bộ Flashcard này.' });
    }

    const { error } = await supabase
      .from('flashcard_decks')
      .delete()
      .eq('id', id);

    if (error) throw error;

    // Notify user if admin deleted their deck
    if (req.user.role === 'admin' && deck.user_id !== req.user.id) {
      try {
        const { createNotification } = require('../services/notificationService');
        await createNotification(req, {
          recipientId: deck.user_id,
          type: 'deck_deleted_by_admin',
          title: 'Bộ Flashcard bị xóa bởi Admin',
          message: `Bộ Flashcard "${deck.title}" của bạn đã bị Admin xóa.`,
          docId: null
        });
      } catch (notifErr) {
        console.error('[Notification] Failed to send deck deletion notification:', notifErr);
      }
    }

    res.status(200).json({ message: 'Xóa bộ Flashcard thành công' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 8. Create individual flashcard inside deck
const createCard = async (req, res) => {
  try {
    const { deckId } = req.params;
    const { front_text, back_text } = req.body;

    if (!front_text || !back_text) {
      return res.status(400).json({ error: 'Nội dung mặt trước và mặt sau là bắt buộc' });
    }

    // Verify deck ownership
    const { data: deck, error: getErr } = await supabase
      .from('flashcard_decks')
      .select('user_id')
      .eq('id', deckId)
      .single();

    if (getErr || !deck) return res.status(404).json({ error: 'Không tìm thấy bộ Flashcard' });
    if (deck.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access forbidden: Chỉ chủ sở hữu mới có quyền thêm thẻ vào bộ Flashcard này.' });
    }

    const { data: card, error } = await supabase
      .from('flashcards')
      .insert([{
        deck_id: deckId,
        front_text,
        back_text
      }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(card);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 9. Update individual flashcard
const updateCard = async (req, res) => {
  try {
    const { cardId } = req.params;
    const { front_text, back_text } = req.body;

    if (!front_text || !back_text) {
      return res.status(400).json({ error: 'Nội dung mặt trước và mặt sau là bắt buộc' });
    }

    // Verify ownership via card's deck
    const { data: card, error: cardErr } = await supabase
      .from('flashcards')
      .select('*, flashcard_decks(user_id)')
      .eq('id', cardId)
      .single();

    if (cardErr || !card) return res.status(404).json({ error: 'Flashcard không tồn tại' });
    if (card.flashcard_decks.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access forbidden: Chỉ chủ sở hữu mới có quyền chỉnh sửa thẻ ghi nhớ này.' });
    }

    const { data: updatedCard, error } = await supabase
      .from('flashcards')
      .update({ front_text, back_text })
      .eq('id', cardId)
      .select()
      .single();

    if (error) throw error;
    res.status(200).json(updatedCard);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 10. Delete individual flashcard
const deleteCard = async (req, res) => {
  try {
    const { cardId } = req.params;

    // Verify ownership via card's deck
    const { data: card, error: cardErr } = await supabase
      .from('flashcards')
      .select('*, flashcard_decks(user_id, title)')
      .eq('id', cardId)
      .single();

    if (cardErr || !card) return res.status(404).json({ error: 'Flashcard không tồn tại' });
    
    const deckOwnerId = card.flashcard_decks?.user_id;
    if (deckOwnerId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access forbidden: Chỉ chủ sở hữu mới có quyền xóa thẻ ghi nhớ này.' });
    }

    const { error } = await supabase
      .from('flashcards')
      .delete()
      .eq('id', cardId);

    if (error) throw error;

    // Notify user if admin deleted their card
    if (req.user.role === 'admin' && deckOwnerId !== req.user.id) {
      try {
        const { createNotification } = require('../services/notificationService');
        const deckTitle = card.flashcard_decks?.title || 'Bộ thẻ';
        await createNotification(req, {
          recipientId: deckOwnerId,
          type: 'card_deleted_by_admin',
          title: 'Thẻ ghi nhớ bị xóa bởi Admin',
          message: `Thẻ ghi nhớ trong bộ "${deckTitle}" của bạn đã bị Admin xóa.`,
          docId: null
        });
      } catch (notifErr) {
        console.error('[Notification] Failed to send card deletion notification:', notifErr);
      }
    }

    res.status(200).json({ message: 'Xóa Flashcard thành công' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 11. Create a multiple-choice quiz from deck flashcards
const createQuizFromDeck = async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      return res.status(403).json({ error: 'Admin không được phép làm bài Quiz.' });
    }
    const { id } = req.params; // Deck ID

    // 1. Fetch deck
    const { data: deck, error: deckErr } = await supabase
      .from('flashcard_decks')
      .select('*')
      .eq('id', id)
      .single();

    if (deckErr || !deck) return res.status(404).json({ error: 'Không tìm thấy bộ Flashcard' });
    if (deck.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access forbidden' });
    }

    // 2. Fetch all cards in this deck
    const { data: cards, error: cardsErr } = await supabase
      .from('flashcards')
      .select('*')
      .eq('deck_id', id);

    if (cardsErr) throw cardsErr;
    if (!cards || cards.length === 0) {
      return res.status(400).json({ error: 'Bộ thẻ này hiện chưa có thẻ ghi nhớ nào để tạo quiz' });
    }

    // 3. Generate quiz questions
    const genericDistractors = [
      "Không có phương án nào ở trên chính xác",
      "Tất cả các phương án trên đều chưa chính xác",
      "Thông tin không được đề cập trong nội dung ôn tập",
      "Cần xem xét thêm tài liệu tham khảo",
      "Tất cả các đáp án đều sai"
    ];

    const quizQuestions = cards.map((card) => {
      const correctAnswer = card.back_text;

      let otherBacks = cards
        .filter(c => c.id !== card.id)
        .map(c => c.back_text);

      otherBacks = [...new Set(otherBacks)];
      otherBacks.sort(() => Math.random() - 0.5);

      let distractors = otherBacks.slice(0, 3);

      let genericIndex = 0;
      while (distractors.length < 3 && genericIndex < genericDistractors.length) {
        const potential = genericDistractors[genericIndex];
        if (!distractors.includes(potential) && potential !== correctAnswer) {
          distractors.push(potential);
        }
        genericIndex++;
      }

      const options = [correctAnswer, ...distractors];
      options.sort(() => Math.random() - 0.5);

      return {
        question: card.front_text,
        options: options,
        answer: correctAnswer,
        explanation: `Câu trả lời chính xác được thiết lập từ bộ thẻ ôn tập Flashcard: "${correctAnswer}".`
      };
    });

    // 4. Save quiz to Supabase quizzes table (check if it already exists)
    const quizTitle = `Quiz: ${deck.title}`;

    const { data: existingQuizzes, error: selectErr } = await supabase
      .from('quizzes')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('title', quizTitle);

    let targetQuiz = null;

    if (existingQuizzes && existingQuizzes.length > 0) {
      targetQuiz = existingQuizzes[0];
      const { data: updatedQuiz, error: updateErr } = await supabase
        .from('quizzes')
        .update({
          questions: quizQuestions,
          document_id: deck.document_id || targetQuiz.document_id || null
        })
        .eq('id', targetQuiz.id)
        .select()
        .single();

      if (updateErr) throw updateErr;
      targetQuiz = updatedQuiz;

      // Delete any previous attempts for this quiz and user to reset progress
      const { error: deleteErr } = await supabase
        .from('quiz_attempts')
        .delete()
        .eq('quiz_id', targetQuiz.id)
        .eq('user_id', req.user.id);

      if (deleteErr) throw deleteErr;
    } else {
      const { data: newQuiz, error: insertError } = await supabase
        .from('quizzes')
        .insert([{
          user_id: req.user.id,
          document_id: deck.document_id || null,
          title: quizTitle,
          questions: quizQuestions
        }])
        .select()
        .single();

      if (insertError) throw insertError;
      targetQuiz = newQuiz;
    }

    res.status(200).json({ quiz: targetQuiz });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  createDeck,
  getDecks,
  getDeckById,
  generateAiFlashcards,
  reviewFlashcard,
  updateDeck,
  deleteDeck,
  createCard,
  updateCard,
  deleteCard,
  createQuizFromDeck
};
