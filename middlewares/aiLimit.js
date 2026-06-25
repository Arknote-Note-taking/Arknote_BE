const supabase = require('../config/supabaseClient');

const checkAiLimit = async (req, res, next) => {
  try {
    if (req.user.role === 'admin') {
      return next();
    }

    // Fetch fresh user credits data from Supabase
    const { data: user, error } = await supabase
      .from('users')
      .select('ai_credits_remaining, is_pro')
      .eq('id', req.user.id)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'Không tìm thấy người dùng trong hệ thống' });
    }

    const isPro = !!user.is_pro;

    if (!isPro && user.ai_credits_remaining <= 0) {
      return res.status(403).json({
        error: 'Bạn đã hết lượt sử dụng AI trong ngày hôm nay. Vui lòng nâng cấp tài khoản PRO để có 500 lượt sử dụng/ngày!'
      });
    }

    // Decrement credit count only for non-PRO users
    if (!isPro) {
      const newCredits = user.ai_credits_remaining - 1;
      const { error: updateError } = await supabase
        .from('users')
        .update({ ai_credits_remaining: newCredits })
        .eq('id', req.user.id);

      if (updateError) throw updateError;
    }

    // Log AI usage
    let featureType = 'qna';
    const requestPath = req.baseUrl + req.path;
    if (requestPath.includes('summarize')) {
      featureType = 'summarize';
    } else if (requestPath.includes('quiz')) {
      featureType = 'quiz';
    } else if (requestPath.includes('flashcard')) {
      featureType = 'flashcards';
    } else if (requestPath.includes('ocr')) {
      featureType = 'ocr';
    }

    await supabase
      .from('ai_usage_logs')
      .insert([{
        user_id: req.user.id,
        feature_type: featureType,
        credits_deducted: isPro ? 0 : 1
      }]);

    next();
  } catch (err) {
    console.error('AI Limit Middleware Error:', err);
    res.status(500).json({ error: 'Lỗi kiểm tra hạn mức sử dụng AI' });
  }
};

module.exports = { checkAiLimit };

