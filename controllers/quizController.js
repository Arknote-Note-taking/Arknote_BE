const supabase = require('../config/supabaseClient');

// Get all quizzes created by the logged-in user
const getQuizzes = async (req, res) => {
  try {
    let query = supabase
      .from('quizzes')
      .select('id, title, created_at, document_id, questions, user_id, user:users(id, email, name)')
      .order('created_at', { ascending: false });

    if (req.user.role !== 'admin') {
      query = query.eq('user_id', req.user.id);
    }

    const { data: quizzes, error } = await query;

    if (error) throw error;
    res.status(200).json(quizzes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get a specific quiz, checking if there is an active (incomplete) attempt
const getQuizById = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Fetch quiz
    const { data: quiz, error: quizErr } = await supabase
      .from('quizzes')
      .select('*')
      .eq('id', id)
      .single();

    if (quizErr || !quiz) {
      return res.status(404).json({ error: 'Quiz not found' });
    }

    if (req.user.role !== 'admin' && quiz.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access forbidden' });
    }

    // Find any incomplete attempt for this quiz and user
    const { data: attempts, error: attErr } = await supabase
      .from('quiz_attempts')
      .select('*')
      .eq('quiz_id', id)
      .eq('user_id', req.user.id)
      .eq('is_completed', false)
      .order('created_at', { ascending: false });

    const activeAttempt = attempts && attempts.length > 0 ? attempts[0] : null;

    res.status(200).json({
      quiz,
      activeAttempt
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get user's quiz attempts history (only completed attempts)
const getAttempts = async (req, res) => {
  try {
    const { data: attempts, error } = await supabase
      .from('quiz_attempts')
      .select('id, quiz_id, score, is_completed, time_spent, completed_at, created_at, quiz:quizzes(id, title, document_id, questions)')
      .eq('user_id', req.user.id)
      .order('completed_at', { ascending: false });

    if (error) throw error;
    res.status(200).json(attempts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Start a new attempt for a quiz
const startAttempt = async (req, res) => {
  try {
    const { quizId, forceNew } = req.body;
    if (!quizId) return res.status(400).json({ error: 'Quiz ID is required' });

    // Verify quiz exists and belongs to user
    const { data: quiz, error: quizErr } = await supabase
      .from('quizzes')
      .select('id, user_id')
      .eq('id', quizId)
      .single();

    if (quizErr || !quiz) return res.status(404).json({ error: 'Quiz not found' });
    if (quiz.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access forbidden' });
    }

    if (!forceNew) {
      // Check trùng: check if there is an active (incomplete) attempt for this quiz and user
      const { data: activeAttempts, error: attErr } = await supabase
        .from('quiz_attempts')
        .select('*')
        .eq('quiz_id', quizId)
        .eq('user_id', req.user.id)
        .eq('is_completed', false)
        .order('created_at', { ascending: false });

      if (activeAttempts && activeAttempts.length > 0) {
        // Return existing active attempt to prevent duplicates
        return res.status(200).json(activeAttempts[0]);
      }
    }

    // Delete any old attempts for this quiz and user to keep only the newest one
    const { error: deleteErr } = await supabase
      .from('quiz_attempts')
      .delete()
      .eq('quiz_id', quizId)
      .eq('user_id', req.user.id);

    if (deleteErr) throw deleteErr;

    // Insert new attempt (since no active attempt exists)
    const { data: attempt, error } = await supabase
      .from('quiz_attempts')
      .insert([{
        quiz_id: quizId,
        user_id: req.user.id,
        score: 0,
        user_answers: {},
        is_completed: false,
        time_spent: 0,
        current_question_index: 0
      }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(attempt);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Save progress of an ongoing attempt
const updateProgress = async (req, res) => {
  try {
    const { attemptId } = req.params;
    const { userAnswers, timeSpent, currentQuestionIndex } = req.body;

    // Check attempt owner
    const { data: attempt, error: checkErr } = await supabase
      .from('quiz_attempts')
      .select('id, user_id, is_completed')
      .eq('id', attemptId)
      .single();

    if (checkErr || !attempt) return res.status(404).json({ error: 'Attempt not found' });
    if (attempt.user_id !== req.user.id) return res.status(403).json({ error: 'Access forbidden' });
    if (attempt.is_completed) return res.status(400).json({ error: 'Cannot update progress of a completed quiz' });

    const updateData = {};
    if (userAnswers !== undefined) updateData.user_answers = userAnswers;
    if (timeSpent !== undefined) updateData.time_spent = timeSpent;
    if (currentQuestionIndex !== undefined) updateData.current_question_index = currentQuestionIndex;

    const { data: updated, error } = await supabase
      .from('quiz_attempts')
      .update(updateData)
      .eq('id', attemptId)
      .select()
      .single();

    if (error) throw error;
    res.status(200).json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Submit and finalize quiz attempt
const submitAttempt = async (req, res) => {
  try {
    const { attemptId } = req.params;
    const { userAnswers, timeSpent } = req.body;

    // Load attempt and parent quiz
    const { data: attempt, error: attErr } = await supabase
      .from('quiz_attempts')
      .select('*, quiz:quizzes(*)')
      .eq('id', attemptId)
      .single();

    if (attErr || !attempt) return res.status(404).json({ error: 'Attempt not found' });
    if (attempt.user_id !== req.user.id) return res.status(403).json({ error: 'Access forbidden' });
    if (attempt.is_completed) return res.status(200).json(attempt); // Already submitted

    const answersToEvaluate = userAnswers !== undefined ? userAnswers : attempt.user_answers;
    const quiz = attempt.quiz;
    if (!quiz || !quiz.questions) throw new Error('Parent quiz or questions missing');

    // Calculate score
    let score = 0;
    quiz.questions.forEach((q, index) => {
      const selectedOption = answersToEvaluate[index.toString()];
      if (selectedOption === q.answer) {
        score++;
      }
    });

    const finalTimeSpent = timeSpent !== undefined ? timeSpent : attempt.time_spent;

    const { data: completed, error } = await supabase
      .from('quiz_attempts')
      .update({
        score,
        user_answers: answersToEvaluate,
        time_spent: finalTimeSpent,
        is_completed: true,
        completed_at: new Date().toISOString()
      })
      .eq('id', attemptId)
      .select()
      .single();

    if (error) throw error;
    res.status(200).json(completed);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get attempt detail for review
const getAttemptById = async (req, res) => {
  try {
    const { attemptId } = req.params;

    const { data: attempt, error } = await supabase
      .from('quiz_attempts')
      .select('*, quiz:quizzes(*)')
      .eq('id', attemptId)
      .single();

    if (error || !attempt) {
      if (error) {
        console.error(`[Error getAttemptById] Supabase error fetching attempt ${attemptId}:`, error);
      }
      return res.status(404).json({ error: 'Attempt not found' });
    }
    if (attempt.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access forbidden' });
    }

    res.status(200).json(attempt);
  } catch (error) {
    console.error('[Error getAttemptById] Exception fetching attempt:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get all attempts for a specific quiz (Admin only)
const getQuizAttemptsForAdmin = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access forbidden: Admin only' });
    }

    const { id } = req.params;

    const { data: attempts, error } = await supabase
      .from('quiz_attempts')
      .select('id, score, is_completed, time_spent, completed_at, created_at, user:users(id, email, name)')
      .eq('quiz_id', id)
      .order('completed_at', { ascending: false });

    if (error) throw error;
    res.status(200).json(attempts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Delete a quiz (owner or admin)
const deleteQuiz = async (req, res) => {
  try {
    const { id } = req.params;

    // Fetch quiz to check ownership
    const { data: quiz, error: quizErr } = await supabase
      .from('quizzes')
      .select('user_id')
      .eq('id', id)
      .single();

    if (quizErr || !quiz) return res.status(404).json({ error: 'Quiz không tồn tại' });
    if (quiz.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access forbidden' });
    }

    const { error } = await supabase
      .from('quizzes')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.status(200).json({ message: 'Xóa bài Quiz thành công' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Delete a quiz attempt (owner or admin)
const deleteAttempt = async (req, res) => {
  try {
    const { attemptId } = req.params;

    // Check ownership
    const { data: attempt, error: checkErr } = await supabase
      .from('quiz_attempts')
      .select('id, user_id')
      .eq('id', attemptId)
      .single();

    if (checkErr || !attempt) return res.status(404).json({ error: 'Lượt làm bài không tồn tại' });
    if (attempt.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access forbidden' });
    }

    const { error } = await supabase
      .from('quiz_attempts')
      .delete()
      .eq('id', attemptId);

    if (error) throw error;
    res.status(200).json({ message: 'Xóa lịch sử làm bài thành công' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getQuizzes,
  getQuizById,
  getAttempts,
  startAttempt,
  updateProgress,
  submitAttempt,
  getAttemptById,
  getQuizAttemptsForAdmin,
  deleteQuiz,
  deleteAttempt
};
