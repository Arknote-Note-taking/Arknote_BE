const express = require('express');
const { registerUser, loginUser, forgotPassword, resetPassword, googleLogin, setPassword } = require('../controllers/authController');
const { requireAuth } = require('../middlewares/auth');

const router = express.Router();

router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/google-login', googleLogin);
router.post('/set-password', setPassword);

module.exports = router;
