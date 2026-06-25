require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const path = require('path');

const authRoutes = require('./routes/auth');
const documentRoutes = require('./routes/documents');
const aiRoutes = require('./routes/ai');
const userRoutes = require('./routes/users');
const paymentRoutes = require('./routes/payment');
const notificationRoutes = require('./routes/notifications');
const quizRoutes = require('./routes/quizzes');
const flashcardRoutes = require('./routes/flashcards');
const shareRoutes = require('./routes/shares');
const annotationRoutes = require('./routes/annotations');

const app = express();
const server = http.createServer(app);

const allowedOrigins = process.env.CORS_ORIGIN && process.env.CORS_ORIGIN !== '*'
  ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
  : '*';

// Sockets Setup
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

// Middleware
app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE']
}));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use((req, res, next) => {
  req.io = io; // Inject socket.io instance into requests
  console.log(req.path, req.method);
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/quizzes', quizRoutes);
app.use('/api/users', userRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/flashcards', flashcardRoutes);
app.use('/api/shares', shareRoutes);
app.use('/api/annotations', annotationRoutes);


// Socket connection
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Multer and general error handler middleware
const multer = require('multer');
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Kích thước tệp quá lớn. Giới hạn là 5MB đối với gói FREE, hoặc 100MB đối với gói PRO.' });
    }
    return res.status(400).json({ error: `Lỗi tải tệp: ${err.message}` });
  }
  if (err) {
    return res.status(400).json({ error: err.message || 'Lỗi không xác định!' });
  }
  next();
});

// Database connection & Server Startup
server.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT} - Connected to Supabase`);
});
