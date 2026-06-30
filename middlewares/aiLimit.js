const supabase = require('../config/supabaseClient');

// In-memory map tracking number of active AI requests per user
// Format: { [userId]: count }
const activeAiRequests = new Map();

const MAX_CONCURRENT_PER_USER = 2;

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

    if (user.ai_credits_remaining <= 0) {
      // Log quota exceeded event
      await supabase.from('ai_usage_logs').insert([{
        user_id: req.user.id,
        feature_type: 'quota_exceeded',
        credits_deducted: 0
      }]).catch(() => {});

      return res.status(403).json({
        error: isPro
          ? 'Bạn đã hết lượt sử dụng AI trong ngày hôm nay. Tài khoản PRO giới hạn 100 lượt/ngày. Vui lòng quay lại vào ngày mai!'
          : 'Bạn đã hết lượt sử dụng AI trong ngày hôm nay. Vui lòng nâng cấp tài khoản PRO để có 100 lượt sử dụng/ngày!'
      });
    }

    // Concurrent request guard — prevent flooding the AI API
    const currentActive = activeAiRequests.get(req.user.id) || 0;
    if (currentActive >= MAX_CONCURRENT_PER_USER) {
      return res.status(429).json({
        error: `Bạn đang có ${currentActive} yêu cầu AI đang xử lý. Vui lòng chờ yêu cầu hiện tại hoàn thành trước khi tạo mới.`
      });
    }

    // Increment concurrent counter; decrement when response finishes
    activeAiRequests.set(req.user.id, currentActive + 1);
    const releaseSlot = () => {
      const current = activeAiRequests.get(req.user.id) || 1;
      if (current <= 1) {
        activeAiRequests.delete(req.user.id);
      } else {
        activeAiRequests.set(req.user.id, current - 1);
      }
    };
    res.on('finish', releaseSlot);
    res.on('close', releaseSlot);

    // Decrement credit count for all users
    const newCredits = user.ai_credits_remaining - 1;
    const { error: updateError } = await supabase
      .from('users')
      .update({ ai_credits_remaining: newCredits })
      .eq('id', req.user.id);

    if (updateError) throw updateError;

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
    // Make sure to release slot on error too
    const current = activeAiRequests.get(req.user.id) || 1;
    if (current <= 1) activeAiRequests.delete(req.user.id);
    else activeAiRequests.set(req.user.id, current - 1);

    res.status(500).json({ error: 'Lỗi kiểm tra hạn mức sử dụng AI' });
  }
};

module.exports = { checkAiLimit };
