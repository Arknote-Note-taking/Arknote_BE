const mongoose = require('mongoose');
const dotenv = require('dotenv');
const bcrypt = require('bcrypt');
const User = require('./models/User');
const Document = require('./models/Document');
const usersData = require('./data/users');
const docsData = require('./data/documents');

// Load env
dotenv.config();

// Base specific mock clusters for the seed, so cosine similarity actually finds > 0.85 matches for same categories
const subjectClusters = {
  'Nhân sự': Array.from({ length: 1536 }, () => 0.5 + Math.random() * 0.1),
  'Hành chính': Array.from({ length: 1536 }, () => -0.5 + Math.random() * 0.1),
  'Pháp luật': Array.from({ length: 1536 }, () => 0.8 + Math.random() * 0.1),
  'Học tập': Array.from({ length: 1536 }, () => -0.8 + Math.random() * 0.1),
};

const mockEmbedding = (subject) => {
   const base = subjectClusters[subject] || Array.from({ length: 1536 }, () => Math.random());
   // Add tiny noise to base cluster to make them have ~0.95 similarity instead of 1.00
   return base.map(val => val + (Math.random() * 0.05));
}

const seedDatabase = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`[SEED] MongoDB Connected: ${conn.connection.host}`);

    // Clear existing data
    await User.deleteMany();
    await Document.deleteMany();
    console.log('[SEED] Wiped Database Complete.');

    // Insert Users
    const hashedUsers = await Promise.all(usersData.map(async (u) => {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(u.password, salt);
      return { ...u, password: hashedPassword };
    }));

    const createdUsers = await User.insertMany(hashedUsers);
    const adminUser = createdUsers.find(u => u.role === 'admin');
    console.log(`[SEED] Created ${createdUsers.length} Users.`);

    // Map Document mock to have required originalName and embedding
    const docsToInsert = docsData.map(doc => ({
      ...doc,
      originalName: doc.title + '.pdf',
      userId: adminUser._id, 
      embedding: mockEmbedding(doc.subject),
      isDeleted: false
    }));

    const createdDocs = await Document.insertMany(docsToInsert);
    console.log(`[SEED] Created ${createdDocs.length} Mock Documents.`);

    console.log('[SUCCESS] Database has been seeded successfully!');
    process.exit();
  } catch (error) {
    console.error(`[ERROR] Filter Failed: ${error.message}`);
    process.exit(1);
  }
};

seedDatabase();
