import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';

// Initialize clients
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

interface Chunk {
  text: string;
  title: string;
  date: string;
  embedding: number[];
}

let chunks: Chunk[] = [];
let isInitialized = false;

const CACHE_PATH = path.join(process.cwd(), 'src', 'data', 'embeddings_cache.json');

// Improved chunking - splits by logical sections
function splitIntoChunks(content: string): Omit<Chunk, 'embedding'>[] {
  const result: Omit<Chunk, 'embedding'>[] = [];
  
  const datePattern = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}/gi;
  const rawNewsletters = content.split(/(?=(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4})/gi)
    .filter(p => p.trim().length > 200);

  for (const nl of rawNewsletters) {
    const dateMatch = nl.match(datePattern);
    const date = dateMatch ? dateMatch[0] : 'Unknown';
    
    // Split by double newlines (paragraphs)
    const paragraphs = nl.split(/\n\s*\n/).filter(p => p.trim().length > 50);
    
    let buffer = '';
    let currentTitle = date;
    
    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i].trim();
      
      // Detect headers (short lines, often before longer content)
      if (para.length < 80 && !para.endsWith('.') && para.length > 5) {
        if (buffer.length > 200) {
          result.push({ text: buffer.trim(), title: currentTitle, date });
          buffer = '';
        }
        currentTitle = para;
        continue;
      }
      
      buffer += para + '\n\n';
      
      // Chunk when buffer exceeds ~800 chars
      if (buffer.length > 800) {
        result.push({ text: buffer.trim(), title: currentTitle, date });
        buffer = '';
      }
    }
    
    if (buffer.length > 100) {
      result.push({ text: buffer.trim(), title: currentTitle, date });
    }
  }
  
  return result;
}

// Cosine similarity
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Get embeddings via Gemini
async function getEmbedding(text: string): Promise<number[]> {
  if (!genAI) throw new Error('Gemini not configured');
  const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
  const result = await model.embedContent(text.slice(0, 2000));
  return result.embedding.values;
}

// Load or generate embeddings (WITH CACHING)
async function initializeChunks() {
  if (isInitialized) return;
  
  // Try loading from cache first
  if (fs.existsSync(CACHE_PATH)) {
    try {
      const cached = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
      if (cached.length > 0 && cached[0].embedding) {
        chunks = cached;
        isInitialized = true;
        console.log(`Loaded ${chunks.length} chunks from cache (instant!)`);
        return;
      }
    } catch (e) {
      console.log('Cache invalid, regenerating...');
    }
  }

  // Generate fresh embeddings
  console.log('Generating embeddings (one-time operation)...');
  const contentPath = path.join(process.cwd(), 'src', 'data', 'newsletters.txt');
  const content = fs.readFileSync(contentPath, 'utf-8');
  const rawChunks = splitIntoChunks(content);
  
  console.log(`Processing ${rawChunks.length} chunks...`);
  
  const embeddedChunks: Chunk[] = [];
  for (let i = 0; i < rawChunks.length; i++) {
    try {
      const embedding = await getEmbedding(rawChunks[i].text);
      embeddedChunks.push({ ...rawChunks[i], embedding });
      
      // Rate limit: 60 requests per minute for free tier
      if (i % 10 === 0) {
        console.log(`Embedded ${i}/${rawChunks.length}...`);
        await new Promise(r => setTimeout(r, 1000));
      }
    } catch (e) {
      console.error(`Failed chunk ${i}:`, e);
    }
  }
  
  chunks = embeddedChunks;
  
  // Save to cache
  fs.writeFileSync(CACHE_PATH, JSON.stringify(chunks));
  console.log(`Saved ${chunks.length} embeddings to cache.`);
  
  isInitialized = true;
}

// Semantic search
async function findRelevantChunks(query: string, topK: number = 4): Promise<Chunk[]> {
  await initializeChunks();
  
  const queryEmb = await getEmbedding(query);
  
  return chunks
    .map(c => ({ chunk: c, score: cosineSimilarity(queryEmb, c.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(s => s.chunk);
}

// Generate answer - OpenRouter PRIMARY (more reliable)
async function generateAnswer(query: string, context: string): Promise<string> {
  const systemPrompt = `You are a search tool for Andrew Wilkinson's newsletter archive. Your ONLY job is to find and quote what Andrew has written.

CRITICAL RULES - FOLLOW EXACTLY:
1. You can ONLY share information that is DIRECTLY STATED in the context below.
2. When answering, you MUST quote or closely paraphrase Andrew's exact words.
3. Start each answer with something like "In my [newsletter topic], I wrote..." or "I discussed this in my newsletter about [topic]..."
4. If the question is about something NOT covered in the context (identity questions, personal questions, topics not mentioned), respond EXACTLY: "That's not something I've covered in the newsletters you're searching. Try asking about entrepreneurship, Tiny, ADHD, relationships, or my experiences with divorce, investing, or building companies."
5. NEVER make up quotes, facts, experiences, or details.
6. NEVER generate generic advice that sounds like Andrew but isn't from the context.
7. The context contains excerpts from real newsletters - only use what's there.

META QUESTIONS:
- "Who are you?" → "I'm a search tool for Andrew Wilkinson's newsletter archive. I can help you find what Andrew has written about various topics. Try asking about his thoughts on business, investing, or life."
- "What have you done in life?" → This requires the full newsletter archive. Ask specific questions like "What's your view on divorce?" or "How do you evaluate businesses?"

NEWSLETTER EXCERPTS TO SEARCH:
${context}`;

  // PRIMARY: OpenRouter (reliable, auto-routes to best model)
  if (process.env.OPENROUTER_API_KEY) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://ask-andrew.vercel.app',
        },
        body: JSON.stringify({
          model: 'openrouter/auto', // Auto-routes to best available model
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: query }
          ],
          max_tokens: 800,
        })
      });
      
      const data = await res.json();
      if (data.choices?.[0]?.message?.content) {
        return data.choices[0].message.content;
      }
      console.log('OpenRouter response:', JSON.stringify(data).slice(0, 500));
    } catch (e: any) {
      console.error('OpenRouter failed:', e.message);
    }
  }

  // FALLBACK: Direct Gemini
  if (genAI) {
    try {
      // Use the latest stable model name
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash-latest' });
      const result = await model.generateContent(`${systemPrompt}\n\nQuestion: ${query}`);
      return result.response.text();
    } catch (e: any) {
      console.error('Gemini direct failed:', e.message);
    }
  }

  return "I'm currently unavailable. Please check API configuration.";
}

export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json();
    if (!query) return NextResponse.json({ error: 'Query required' }, { status: 400 });
    
    const relevant = await findRelevantChunks(query, 4);
    const context = relevant.map(c => `[${c.title}]\n${c.text}`).join('\n\n---\n\n');
    
    const answer = await generateAnswer(query, context);
    const sources = [...new Set(relevant.map(c => c.title))];
    
    return NextResponse.json({ answer, sources });
  } catch (error: any) {
    console.error('API Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
