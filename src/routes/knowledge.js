import express from 'express';
import {
  getAllFaqs,
  createFaq,
  updateFaq,
  deleteFaq
} from '../data/database.js';
import {
  getKnowledgeDataAsync,
  invalidateKnowledgeCache
} from '../data/gym-data.js';
import { requireSuperAdmin } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/knowledge/faqs
 * Mengambil seluruh daftar FAQ dari database
 */
router.get('/faqs', async (req, res) => {
  try {
    const faqs = await getAllFaqs();
    return res.json({
      success: true,
      count: faqs.length,
      data: faqs
    });
  } catch (err) {
    console.error('[FAQ Route Error]:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Gagal mengambil data FAQ dari database.'
    });
  }
});

/**
 * POST /api/knowledge/faqs
 * Menambahkan FAQ baru ke knowledge base (Khusus Super Admin)
 */
router.post('/faqs', requireSuperAdmin, async (req, res) => {
  try {
    const { category, question, answer } = req.body || {};

    if (!question || typeof question !== 'string' || question.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Pertanyaan (question) wajib diisi.'
      });
    }

    if (!answer || typeof answer !== 'string' || answer.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Jawaban (answer) wajib diisi.'
      });
    }

    const newFaq = await createFaq({
      category: category?.trim() || 'Umum',
      question: question.trim(),
      answer: answer.trim()
    });

    // Invalidate memory cache agar Fifi langsung mendapatkan FAQ baru
    invalidateKnowledgeCache();

    return res.status(201).json({
      success: true,
      message: 'FAQ berhasil ditambahkan ke knowledge base.',
      data: newFaq
    });
  } catch (err) {
    console.error('[Create FAQ Error]:', err.message);
    return res.status(500).json({
      success: false,
      error: err.message || 'Gagal menyimpan FAQ baru.'
    });
  }
});

/**
 * PUT /api/knowledge/faqs/:id
 * Memperbarui FAQ yang sudah ada (Khusus Super Admin)
 */
router.put('/faqs/:id', requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { category, question, answer, is_active } = req.body || {};

    if (!id || isNaN(Number(id))) {
      return res.status(400).json({
        success: false,
        error: 'ID FAQ tidak valid.'
      });
    }

    const updated = await updateFaq(Number(id), {
      category: category?.trim(),
      question: question?.trim(),
      answer: answer?.trim(),
      is_active: is_active !== undefined ? (Boolean(is_active) ? 1 : 0) : 1
    });

    invalidateKnowledgeCache();

    return res.json({
      success: true,
      message: 'FAQ berhasil diperbarui.',
      data: updated
    });
  } catch (err) {
    console.error('[Update FAQ Error]:', err.message);
    return res.status(500).json({
      success: false,
      error: err.message || 'Gagal memperbarui FAQ.'
    });
  }
});

/**
 * DELETE /api/knowledge/faqs/:id
 * Menghapus FAQ dari knowledge base (Khusus Super Admin)
 */
router.delete('/faqs/:id', requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || isNaN(Number(id))) {
      return res.status(400).json({
        success: false,
        error: 'ID FAQ tidak valid.'
      });
    }

    await deleteFaq(Number(id));
    invalidateKnowledgeCache();

    return res.json({
      success: true,
      message: 'FAQ berhasil dihapus dari database.'
    });
  } catch (err) {
    console.error('[Delete FAQ Error]:', err.message);
    return res.status(500).json({
      success: false,
      error: err.message || 'Gagal menghapus FAQ.'
    });
  }
});

/**
 * GET /api/knowledge/full
 * Mengambil snapshot penuh knowledge base gym dari database
 */
router.get('/full', async (req, res) => {
  try {
    const data = await getKnowledgeDataAsync();
    return res.json({
      success: true,
      data
    });
  } catch (err) {
    console.error('[Full Knowledge Error]:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Gagal memuat knowledge base penuh.'
    });
  }
});

export default router;
