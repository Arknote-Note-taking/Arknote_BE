const supabase = require('../config/supabaseClient');
const jwt = require('jsonwebtoken');

const requireAuth = async (req, res, next) => {
  const { authorization } = req.headers;

  if (!authorization) {
    return res.status(401).json({ error: 'Authorization token required' });
  }

  const token = authorization.split(' ')[1];

  try {
    let userId;
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'ai-tagging-secret-key-123!');
      userId = decoded.id;
    } catch (jwtErr) {
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        throw new Error(authError?.message || 'Invalid token');
      }
      userId = user.id;
    }

    const { data: dbUser, error: dbError } = await supabase
      .from('users')
      .select('id, role, email')
      .eq('id', userId)
      .single();

    if (dbError || !dbUser) {
      console.error('requireAuth Error: User not found in DB', dbError);
      return res.status(401).json({ error: 'User does not exist in database' });
    }

    // Remap id to _id for backward compatibility within backend if any code still uses it,
    // though we should ideally use id directly. For now, ensure we populate a standard user object.
    req.user = dbUser;
    req.user._id = dbUser.id; // Map for controllers that haven't been fully migrated
    
    next();
  } catch (error) {
    console.error('requireAuth Exception:', error);
    res.status(401).json({ error: 'Request is not authorized' });
  }
};

const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access forbidden: Insufficient role' });
    }
    next();
  };
};

module.exports = { requireAuth, requireRole };
