const { Worker } = require('bullmq');
const supabase = require('../config/supabaseClient');
const { generateFlashcards, generateQuiz } = require('../services/aiService');
const { retrieveRelevantChunks } = require('../services/ragService');
const { getConnection } = require('../services/jobQueue');
const crypto = require('crypto');

const getDeckHash = (description) => {
  if (!description) return null;
  const match = description.match(/\|\|\|hash:([a-f0-9]{32})/);
  return match ? match[1] : null;
};

const cleanDeckDescription = (deck) => {
  if (deck && deck.description) {
    deck.description = deck.description.replace(/\|\|\|hash:[a-f0-9]{32}/g, '').trim();
  }
  return deck;
};

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

let workerInstance = null;

const startWorker = (io) => {
  const connection = getConnection();
  if (!connection) {
    console.warn('[Worker] Redis not available — AI Worker not started. Falling back to synchronous mode.');
    return null;
  }

  if (workerInstance) return workerInstance;

  workerInstance = new Worker('ai-jobs', async (job) => {
    const { type, data } = { type: job.name, data: job.data };
    console.log(`[Worker] Processing job: ${job.id} (${type})`);

    // ---------- GENERATE FLASHCARDS ----------
    if (type === 'generate_flashcards') {
      const { documentId, userId, cardCount, isPro, deckTitle, forceRegenerate, mode, currentHash } = data;

      // Check cache first
      const { data: existingDecks } = await supabase
        .from('flashcard_decks')
        .select('*')
        .eq('user_id', userId)
        .eq('document_id', documentId);

      const existingDeck = existingDecks?.[0];

      if (existingDeck && !forceRegenerate) {
        const { data: existingCards } = await supabase
          .from('flashcards')
          .select('*')
          .eq('deck_id', existingDeck.id);

        if (existingCards && existingCards.length > 0) {
          io?.emit(`job_done:${job.id}`, {
            type: 'flashcards',
            deck: cleanDeckDescription(existingDeck),
            cards: existingCards,
            cached: true
          });
          return { deck: cleanDeckDescription(existingDeck), cards: existingCards, cached: true };
        }
      }

      // Fetch document content
      const { data: doc } = await supabase
        .from('documents')
        .select('content, title')
        .eq('id', documentId)
        .single();

      if (!doc) throw new Error('Document not found');

      // RAG retrieval
      const ragContext = await retrieveRelevantChunks(documentId, 'Tạo bộ flashcard ôn tập kiến thức từ tài liệu này');
      const content = ragContext || doc.content;

      await job.updateProgress(30);

      const flashcardsData = await generateFlashcards(content, isPro, cardCount || 8);
      await job.updateProgress(80);

      let deck = existingDeck;
      if (deck) {
        if (mode === 'overwrite') {
          // Overwrite mode: delete all existing cards first
          await supabase.from('flashcards').delete().eq('deck_id', deck.id);
        }
        
        const newDesc = ((deck.description || 'Tạo tự động bằng AI từ tài liệu').replace(/\|\|\|hash:[a-f0-9]{32}/g, '').trim() + ' |||hash:' + currentHash).trim();
        const { data: updatedDeck, error: deckUpdateErr } = await supabase
          .from('flashcard_decks')
          .update({ description: newDesc })
          .eq('id', deck.id)
          .select()
          .single();
        
        if (deckUpdateErr) throw deckUpdateErr;
        deck = updatedDeck;
      } else {
        // Create new deck
        const { data: newDeck, error: deckErr } = await supabase
          .from('flashcard_decks')
          .insert([{
            user_id: userId,
            document_id: documentId,
            title: deckTitle || doc.title,
            description: `Tạo tự động bằng AI từ tài liệu |||hash:${currentHash}`
          }])
          .select()
          .single();

        if (deckErr) throw deckErr;
        deck = newDeck;
      }

      // Prepare cards
      let cardsToInsert = flashcardsData.map(c => ({
        deck_id: deck.id,
        front_text: c.front_text,
        back_text: c.back_text
      }));

      if (mode === 'merge') {
        const { data: existingCards } = await supabase
          .from('flashcards')
          .select('front_text')
          .eq('deck_id', deck.id);
        
        if (existingCards && existingCards.length > 0) {
          const existingFronts = new Set(existingCards.map(c => c.front_text.toLowerCase().trim().replace(/[.,/#!$%^&*;:{}=\-_`~()?]/g,"")));
          cardsToInsert = cardsToInsert.filter(c => {
            const normalizedFront = c.front_text.toLowerCase().trim().replace(/[.,/#!$%^&*;:{}=\-_`~()?]/g,"");
            return !existingFronts.has(normalizedFront);
          });
        }
      }

      let insertedCards = [];
      if (cardsToInsert.length > 0) {
        const { data: newCards, error: cardsErr } = await supabase
          .from('flashcards')
          .insert(cardsToInsert)
          .select();

        if (cardsErr) throw cardsErr;
        insertedCards = newCards;
      } else if (mode === 'merge') {
        const { data: existingCards } = await supabase
          .from('flashcards')
          .select('*')
          .eq('deck_id', deck.id);
        insertedCards = existingCards || [];
      }

      await job.updateProgress(100);

      // Notify frontend via Socket.IO
      io?.emit(`job_done:${job.id}`, { type: 'flashcards', deck: cleanDeckDescription(deck), cards: insertedCards });
      io?.emit(`job_done:user:${userId}`, { type: 'flashcards', jobId: job.id, deck: cleanDeckDescription(deck), cards: insertedCards });

      return { deck: cleanDeckDescription(deck), cards: insertedCards };
    }

    // ---------- GENERATE QUIZ ----------
    if (type === 'generate_quiz') {
      const { documentId, userId, count, isPro, quizTitle, forceRegenerate, mode, currentHash } = data;

      // Check cache first
      const { data: existingQuizzes } = await supabase
        .from('quizzes')
        .select('*')
        .eq('user_id', userId)
        .eq('document_id', documentId)
        .eq('title', quizTitle);

      const existingQuiz = existingQuizzes?.[0];

      if (existingQuiz && !forceRegenerate) {
        if (existingQuiz.questions && existingQuiz.questions.length > 0) {
          io?.emit(`job_done:${job.id}`, { type: 'quiz', quiz: cleanQuizQuestions(existingQuiz), cached: true });
          return { quiz: cleanQuizQuestions(existingQuiz), cached: true };
        }
      }

      // Fetch document
      const { data: doc } = await supabase
        .from('documents')
        .select('content, title')
        .eq('id', documentId)
        .single();

      if (!doc) throw new Error('Document not found');

      // RAG retrieval
      const ragContext = await retrieveRelevantChunks(documentId, 'Tạo bộ câu hỏi trắc nghiệm kiểm tra kiến thức từ tài liệu này');
      const content = ragContext || doc.content;

      await job.updateProgress(30);

      const generatedQuestions = await generateQuiz(content, isPro, count || 5);
      await job.updateProgress(80);

      let finalQuestions = [];
      if (existingQuiz && mode === 'merge') {
        const oldQuestions = existingQuiz.questions.filter(q => !q.isMetadata);
        const existingTexts = new Set(oldQuestions.map(q => q.question.toLowerCase().trim().replace(/[.,/#!$%^&*;:{}=\-_`~()?]/g,"")));
        
        const uniqueNewQuestions = generatedQuestions.filter(q => {
          const normalizedText = q.question.toLowerCase().trim().replace(/[.,/#!$%^&*;:{}=\-_`~()?]/g,"");
          return !existingTexts.has(normalizedText);
        });
        finalQuestions = [{ isMetadata: true, hash: currentHash }, ...oldQuestions, ...uniqueNewQuestions];
      } else {
        finalQuestions = [{ isMetadata: true, hash: currentHash }, ...generatedQuestions];
      }

      let targetQuiz;
      if (existingQuiz) {
        const { data: updatedQuiz, error: updateErr } = await supabase
          .from('quizzes')
          .update({ questions: finalQuestions })
          .eq('id', existingQuiz.id)
          .select()
          .single();
        if (updateErr) throw updateErr;
        targetQuiz = updatedQuiz;

        if (mode === 'overwrite') {
          await supabase
            .from('quiz_attempts')
            .delete()
            .eq('quiz_id', targetQuiz.id)
            .eq('user_id', userId);
        }
      } else {
        const { data: newQuiz, error: insertErr } = await supabase
          .from('quizzes')
          .insert([{ user_id: userId, document_id: documentId, title: quizTitle, questions: finalQuestions }])
          .select()
          .single();
        if (insertErr) throw insertErr;
        targetQuiz = newQuiz;
      }

      await job.updateProgress(100);

      io?.emit(`job_done:${job.id}`, { type: 'quiz', quiz: cleanQuizQuestions(targetQuiz) });
      io?.emit(`job_done:user:${userId}`, { type: 'quiz', jobId: job.id, quiz: cleanQuizQuestions(targetQuiz) });

      return { quiz: cleanQuizQuestions(targetQuiz) };
    }

    throw new Error(`Unknown job type: ${type}`);
  }, {
    connection,
    concurrency: 3
  });

  workerInstance.on('completed', (job, result) => {
    console.log(`[Worker] Job completed: ${job.id}`);
  });

  workerInstance.on('failed', (job, err) => {
    console.error(`[Worker] Job failed: ${job?.id} — ${err.message}`);
    if (job && job.data) {
      const userId = job.data.userId;
      io?.emit(`job_failed:${job.id}`, { error: err.message });
      io?.emit(`job_failed:user:${userId}`, { jobId: job.id, error: err.message });
    }
  });

  console.log('[Worker] AI Worker started and listening for jobs');
  return workerInstance;
};

module.exports = { startWorker };
