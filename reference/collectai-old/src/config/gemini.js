// ============================================
// CollectAI — Gemini AI Client Configuration
// ============================================

const { GoogleGenAI } = require('@google/genai');

let aiClient;

function getGeminiClient() {
  if (aiClient) return aiClient;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your-gemini-api-key-here') {
    console.error('❌ GEMINI_API_KEY is not set or is still the placeholder value.');
    console.error('   Get your key from https://aistudio.google.com/ and set it in .env');
    return null;
  }

  aiClient = new GoogleGenAI({ apiKey });
  console.log('✅ Gemini AI client initialized');
  return aiClient;
}

const GEMINI_MODEL = 'gemini-1.5-flash';

module.exports = { getGeminiClient, GEMINI_MODEL };
