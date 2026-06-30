const { Worker } = require('bullmq');
const supabase = require('../config/supabaseClient');
const { generateFlashcards, generateQuiz } = require('../services/aiService');
const { retrieveRelevantChunks } = require('../services/ragService');
const { getConnection } = require('../services/jobQueue');

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
      const { documentId, userId, cardCount, isPro, deckTitle } = data;

      // Check cache first
      const { data: existingDecks } = await supabase
        .from('flashcard_decks')
        .select('*')
        .eq('user_id', userId)
        .eq('document_id', documentId);

      if (existingDecks && existingDecks.length > 0 && !data.forceRegenerate) {
        const { data: existingCards } = await supabase
          .from('flashcards')
          .select('*')
          .eq('deck_id', existingDecks[0].id);

        if (existingCards && existingCards.length > 0) {
          io?.emit(`job_done:${job.id}`, {
            type: 'flashcards',
            deck: existingDecks[0],
            cards: existingCards,
            cached: true
          });
          return { deck: existingDecks[0], cards: existingCards, cached: true };
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

      // Delete old deck if re-generating
      if (existingDecks && existingDecks.length > 0 && data.forceRegenerate) {
        await supabase.from('flashcard_decks').delete().eq('id', existingDecks[0].id);
      }

      // Create deck
      const { data: deck, error: deckErr } = await supabase
        .from('flashcard_decks')
        .insert([{ user_id: userId, document_id: documentId, title: deckTitle || doc.title }])
        .select()
        .single();

      if (deckErr) throw deckErr;

      // Insert cards
      const cardsToInsert = flashcardsData.map(c => ({
        deck_id: deck.id,
        front_text: c.front_text,
        back_text: c.back_text
      }));

      const { data: cards, error: cardsErr } = await supabase
        .from('flashcards')
        .insert(cardsToInsert)
        .select();

      if (cardsErr) throw cardsErr;

      await job.updateProgress(100);

      // Notify frontend via Socket.IO
      io?.emit(`job_done:${job.id}`, { type: 'flashcards', deck, cards });
      io?.emit(`job_done:user:${userId}`, { type: 'flashcards', jobId: job.id, deck, cards });

      return { deck, cards };
    }

    // ---------- GENERATE QUIZ ----------
    if (type === 'generate_quiz') {
      const { documentId, userId, count, isPro, quizTitle } = data;

      // Check cache first
      const { data: existingQuizzes } = await supabase
        .from('quizzes')
        .select('*')
        .eq('user_id', userId)
        .eq('document_id', documentId)
        .eq('title', quizTitle);

      if (existingQuizzes && existingQuizzes.length > 0 && !data.forceRegenerate) {
        const q = existingQuizzes[0];
        if (q.questions && q.questions.length > 0) {
          io?.emit(`job_done:${job.id}`, { type: 'quiz', quiz: q, cached: true });
          return { quiz: q, cached: true };
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

      const quizQuestions = await generateQuiz(content, isPro, count || 5);
      await job.updateProgress(80);

      let targetQuiz;
      if (existingQuizzes && existingQuizzes.length > 0) {
        const { data: updatedQuiz, error: updateErr } = await supabase
          .from('quizzes')
          .update({ questions: quizQuestions })
          .eq('id', existingQuizzes[0].id)
          .select()
          .single();
        if (updateErr) throw updateErr;
        targetQuiz = updatedQuiz;
      } else {
        const { data: newQuiz, error: insertErr } = await supabase
          .from('quizzes')
          .insert([{ user_id: userId, document_id: documentId, title: quizTitle, questions: quizQuestions }])
          .select()
          .single();
        if (insertErr) throw insertErr;
        targetQuiz = newQuiz;
      }

      await job.updateProgress(100);

      io?.emit(`job_done:${job.id}`, { type: 'quiz', quiz: targetQuiz });
      io?.emit(`job_done:user:${userId}`, { type: 'quiz', jobId: job.id, quiz: targetQuiz });

      return { quiz: targetQuiz };
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
