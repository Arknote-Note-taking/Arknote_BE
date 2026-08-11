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
    let user = null;
    let { data: userData, error } = await supabase
      .from('users')
      .select('ai_credits_remaining, is_pro, last_credit_reset_at')
      .eq('id', req.user.id)
      .single();

    if (error && (error.code === '42703' || error.message?.includes('last_credit_reset_at'))) {
      // Column last_credit_reset_at does not exist in DB yet, query without it
      const fallback = await supabase
        .from('users')
        .select('ai_credits_remaining, is_pro')
        .eq('id', req.user.id)
        .single();
      userData = fallback.data;
      error = fallback.error;
    }

    if (error || !userData) {
      console.error('[checkAiLimit] Error fetching user from DB:', req.user?.id, error);
      return res.status(404).json({ error: 'Không tìm thấy người dùng trong hệ thống' });
    }

    user = userData;
    const isPro = !!user.is_pro;
    const todayStr = new Date().toISOString().slice(0, 10);
    const lastResetStr = user.last_credit_reset_at ? new Date(user.last_credit_reset_at).toISOString().slice(0, 10) : '';

    // Check if new day: reset daily credits (30 for Free, 100 for Pro)
    if (user.last_credit_reset_at !== undefined && lastResetStr !== todayStr) {
      const resetCredits = isPro ? 100 : 30;
      const nowIso = new Date().toISOString();
      await supabase
        .from('users')
        .update({
          ai_credits_remaining: resetCredits,
          last_credit_reset_at: nowIso
        })
        .eq('id', req.user.id)
        .catch(async () => {
          // Fallback if update last_credit_reset_at fails
          await supabase
            .from('users')
            .update({ ai_credits_remaining: resetCredits })
            .eq('id', req.user.id);
        });

      user.ai_credits_remaining = resetCredits;
    }

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
