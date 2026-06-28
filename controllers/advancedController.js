const supabase = require('../config/supabaseClient');
const { createEmbedding, cosineSimilarity } = require('../services/embeddingService');

const searchDocuments = async (req, res) => {
  try {
    const { q, type } = req.query; // type: 'basic' | 'semantic'
    if (!q) return res.status(400).json({ error: 'Search query required' });

    let query = supabase.from('documents').select('id, title, subject, tags, summary, content, embedding, is_deleted, user_id, created_at').eq('is_deleted', false);
    
    if (req.user.role !== 'admin') {
      query = query.eq('user_id', req.user.id);
    }

    if (type === 'basic' || !type) {
      // Basic Search on title, subject, content
      // Supabase ilike search. (For tags array, we might need a separate filter or do it in application memory to simplify)
      const { data: allDocs, error } = await query;
      if (error) throw error;
      
      const regex = new RegExp(q, 'i');
      const filtered = allDocs.filter(doc => 
        regex.test(doc.title) || 
        regex.test(doc.subject) || 
        regex.test(doc.content) || 
        (doc.tags && doc.tags.some(tag => regex.test(tag)))
      ).map(d => {
        const { embedding, content, ...safeDoc } = d;
        safeDoc._id = safeDoc.id; // Map for FE
        return safeDoc;
      });

      return res.status(200).json(filtered);
    } 
    
    if (type === 'semantic') {
      // Semantic Search via embeddings calculation
      const queryEmbedding = await createEmbedding(q);
      const { data: allDocs, error } = await query;
      if (error) throw error;
      
      // Calculate distances mapping
      const results = allDocs.map(doc => {
        let docEmbedding = doc.embedding;
        if (typeof docEmbedding === 'string') {
          docEmbedding = JSON.parse(docEmbedding);
        }
        const sim = cosineSimilarity(queryEmbedding, docEmbedding);
        return { doc, sim };
      })
      .filter(item => item.sim > 0.70) // threshold 0.70 similarity
      .sort((a, b) => b.sim - a.sim)
      .map(item => {
        const safeDoc = { ...item.doc, _id: item.doc.id };
        delete safeDoc.embedding; // Remove large payload
        delete safeDoc.content;
        return safeDoc;
      });

      return res.status(200).json(results);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getKnowledgeGraph = async (req, res) => {
  try {
    let query = supabase.from('documents').select('id, title, subject, tags, embedding').eq('is_deleted', false);
    
    if (req.user.role !== 'admin') {
      query = query.eq('user_id', req.user.id);
    }

    const { data: docs, error } = await query;
    if (error) throw error;
    
    const nodes = [];
    const edges = [];
    
    docs.forEach(doc => {
      nodes.push({ id: doc.id, title: doc.title, subject: doc.subject, tags: doc.tags || [] });
    });

    // Create Edges by matching semantic similarity or shared metadata (tags, subject)
    for (let i = 0; i < docs.length; i++) {
      let embI = docs[i].embedding;
      if (typeof embI === 'string') embI = JSON.parse(embI);
      const tagsI = docs[i].tags || [];
      const subI = docs[i].subject;
      
      for (let j = i + 1; j < docs.length; j++) {
        let embJ = docs[j].embedding;
        if (typeof embJ === 'string') embJ = JSON.parse(embJ);
        const tagsJ = docs[j].tags || [];
        const subJ = docs[j].subject;
        
        let sim = 0;
        let isConnected = false;
        
        if (embI && embJ && embI.length > 0 && embJ.length > 0) {
          sim = cosineSimilarity(embI, embJ);
          if (sim > 0.75) { // Heightened threshold for accurate semantic similarity
            isConnected = true;
          }
        }
        
        // Fallback 1: Connect if they share at least 2 tags (strong metadata connection)
        if (!isConnected && tagsI.length > 0 && tagsJ.length > 0) {
          const commonTags = tagsI.filter(t => tagsJ.some(tj => tj.toLowerCase().trim() === t.toLowerCase().trim()));
          if (commonTags.length >= 2) {
            isConnected = true;
            sim = 0.5 + (0.1 * Math.min(commonTags.length, 3)); // Weight proportional to shared tags
          }
        }

        if (isConnected) {
          edges.push({
            source: docs[i].id,
            target: docs[j].id,
            weight: sim
          });
        }
      }
    }

    res.status(200).json({ nodes, edges });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getRelatedDocuments = async (req, res) => {
  try {
    const docId = req.params.id;
    const { data: targetDoc, error: err1 } = await supabase.from('documents').select('embedding').eq('id', docId).single();
    if (err1 || !targetDoc) return res.status(404).json({ error: 'Source document not found' });

    let query = supabase.from('documents').select('id, title, created_at, subject, embedding').eq('is_deleted', false).neq('id', docId);
    if (req.user.role !== 'admin') {
      query = query.eq('user_id', req.user.id);
    }

    const { data: allDocs, error: err2 } = await query;
    if (err2) throw err2;

    let targetEmbedding = targetDoc.embedding;
    if (typeof targetEmbedding === 'string') targetEmbedding = JSON.parse(targetEmbedding);

    if (!targetEmbedding || targetEmbedding.length === 0) {
      return res.status(200).json([]); // Cannot relate if no embedding exists
    }

    // Sort by vector similarity
    const relatedDocs = allDocs.map(doc => {
      let emb = doc.embedding;
      if (typeof emb === 'string') emb = JSON.parse(emb);
      const sim = cosineSimilarity(targetEmbedding, emb);
      return { doc, sim };
    })
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 3) // Top 3
    .map(item => {
      return {
        _id: item.doc.id,
        _title: item.doc.title,
        _date: item.doc.created_at.split('T')[0],
        _subject: item.doc.subject,
        sim: item.sim
      };
    });

    res.status(200).json(relatedDocs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = { searchDocuments, getKnowledgeGraph, getRelatedDocuments };
