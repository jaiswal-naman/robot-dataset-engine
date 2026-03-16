/**
 * Text embedding via Google Gemini text-embedding-004 model.
 * Returns a 768-dimensional embedding vector for the input query.
 * Compatible with DINOv2 768-d visual embeddings for action-label-level search.
 */
export async function embedQuery(query: string): Promise<number[]> {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.warn('[embedQuery] No GOOGLE_API_KEY configured — returning zero vector');
    return Array(768).fill(0.0);
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'models/text-embedding-004',
      content: { parts: [{ text: query }] },
      taskType: 'RETRIEVAL_QUERY',
      outputDimensionality: 768,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`[embedQuery] Gemini API error ${response.status}:`, body);
    // Return zero vector as non-fatal fallback (search will return lowest-ranked results)
    return Array(768).fill(0.0);
  }

  const data = await response.json();
  const embedding = data?.embedding?.values as number[] | undefined;

  if (!embedding || embedding.length === 0) {
    console.error('[embedQuery] Unexpected Gemini response structure:', data);
    return Array(768).fill(0.0);
  }

  // Pad or truncate to exactly 768 dims
  if (embedding.length > 768) return embedding.slice(0, 768);
  if (embedding.length < 768) return [...embedding, ...Array(768 - embedding.length).fill(0.0)];

  return embedding;
}
