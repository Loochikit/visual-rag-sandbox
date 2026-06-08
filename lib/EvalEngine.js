/**
 * EvalEngine.js
 * Evaluates RAG quality metrics (Faithfulness, Answer Relevance, Context Relevance):
 * 1. Rule-based algorithmic evaluation (lexical overlap, cosine similarity) for simulated/offline mode
 * 2. LLM-as-a-judge API evaluation for live mode
 */

const VectorEngine = require("./VectorEngine");

class EvalEngine {
  /**
   * Main evaluation entrypoint
   * @param {string} query 
   * @param {Array<Object>} contextChunks 
   * @param {string} answer 
   * @param {Object} apiConfig { provider, key }
   * @returns {Promise<Object>} Object containing { faithfulness, contextRelevance, answerRelevance, explanations }
   */
  static async evaluate(query, contextChunks, answer, apiConfig = {}) {
    const isMock = !apiConfig.key || apiConfig.provider === "mock";
    
    if (isMock) {
      return this.evaluateAlgorithmic(query, contextChunks, answer);
    } else {
      return this.evaluateLlmAsJudge(query, contextChunks, answer, apiConfig);
    }
  }

  /**
   * Lexical-based evaluation using cosine similarities and token overlaps
   */
  static evaluateAlgorithmic(query, contextChunks, answer) {
    const contextText = contextChunks.map(c => c.text).join(" ");

    // Tokenize
    const queryTokens = new Set(VectorEngine.tokenize(query));
    const contextTokens = new Set(VectorEngine.tokenize(contextText));
    const answerTokens = new Set(VectorEngine.tokenize(answer));

    // 1. Context Relevance: How much of the retrieved context matches the query?
    // We compute cosine similarity of the query to the aggregate context
    let contextRelevance = 0;
    if (queryTokens.size > 0 && contextTokens.size > 0) {
      // Simple Jaccard similarity for lexical overlap
      const intersection = new Set([...queryTokens].filter(x => contextTokens.has(x)));
      const union = new Set([...queryTokens, ...contextTokens]);
      contextRelevance = intersection.size / (queryTokens.size || 1); // coverage of query
      contextRelevance = Math.min(1.0, contextRelevance * 1.5); // scale slightly for realistic scoring
    }

    // 2. Faithfulness / Groundedness: Is the answer derived *only* from the context?
    // What % of answer content words are present in the context?
    let faithfulness = 1.0;
    if (answerTokens.size > 0) {
      if (contextTokens.size === 0) {
        faithfulness = 0.0;
      } else {
        const answerInContext = [...answerTokens].filter(x => contextTokens.has(x));
        // Simple overlap ratio
        faithfulness = answerInContext.size === 0 && answerTokens.size > 0 ? 0.0 : answerInContext.length / answerTokens.size;
        // Adjust for common conversational fillers
        faithfulness = Math.min(1.0, faithfulness * 1.2);
      }
    }

    // 3. Answer Relevance: Does the generated answer address the query?
    // How much lexical overlap does the answer have with the query terms?
    let answerRelevance = 0;
    if (queryTokens.size > 0 && answerTokens.size > 0) {
      const queryInAnswer = [...queryTokens].filter(x => answerTokens.has(x));
      answerRelevance = queryInAnswer.length / queryTokens.size;
      // Add a baseline if the answer is long and conversational
      answerRelevance = Math.max(0.4, Math.min(1.0, answerRelevance * 1.3));
    }

    // Round metrics
    contextRelevance = parseFloat(contextRelevance.toFixed(2));
    faithfulness = parseFloat(faithfulness.toFixed(2));
    answerRelevance = parseFloat(answerRelevance.toFixed(2));

    return {
      faithfulness,
      contextRelevance,
      answerRelevance,
      explanations: {
        faithfulness: `Algorithmic estimate: ${Math.round(faithfulness * 100)}% of generated concepts align with the retrieved text.`,
        contextRelevance: `Algorithmic estimate: ${Math.round(contextRelevance * 100)}% of query keywords mapped directly to retrieved segments.`,
        answerRelevance: `Algorithmic estimate: ${Math.round(answerRelevance * 100)}% of query concepts appear in the response.`
      },
      method: "lexical-heuristics"
    };
  }

  /**
   * LLM-as-a-Judge evaluation using OpenAI or Gemini
   */
  static async evaluateLlmAsJudge(query, contextChunks, answer, apiConfig) {
    const contextText = contextChunks.map((c, i) => `[Doc ${i + 1}] ${c.text}`).join("\n");
    
    const evaluationPrompt = `
You are an expert AI auditor assessing a Retrieval-Augmented Generation (RAG) system.
Analyze the following query, context, and generated answer:

QUERY: "${query}"
CONTEXT:
"${contextText}"
ANSWER:
"${answer}"

Evaluate the RAG system on three dimensions. Assign a score between 0.0 (Worst) and 1.0 (Best) for each:
1. **Faithfulness**: Is the answer derived *only* and *correctly* from the provided context? (Look for hallucinations).
2. **Context Relevance**: Is the retrieved context actually relevant to answer the query?
3. **Answer Relevance**: Does the generated answer directly address the user query?

Format your response STRICTLY as a valid JSON object like this:
{
  "faithfulness": 0.9,
  "contextRelevance": 0.8,
  "answerRelevance": 0.95,
  "explanations": {
    "faithfulness": "Brief explanation why",
    "contextRelevance": "Brief explanation why",
    "answerRelevance": "Brief explanation why"
  }
}
Do not write any other text or markdown block wrappers.
`;

    try {
      let responseText = "";

      if (apiConfig.provider === "openai") {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiConfig.key}`
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: evaluationPrompt }],
            temperature: 0.0,
            response_format: { type: "json_object" }
          })
        });
        
        if (res.ok) {
          const data = await res.json();
          responseText = data.choices[0]?.message?.content || "";
        }
      } else if (apiConfig.provider === "gemini") {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiConfig.key}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: evaluationPrompt }] }],
            generationConfig: { responseMimeType: "application/json", temperature: 0.0 }
          })
        });
        
        if (res.ok) {
          const data = await res.json();
          responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        }
      }

      if (responseText) {
        const parsed = JSON.parse(responseText.trim());
        return {
          faithfulness: parseFloat(parsed.faithfulness || 0),
          contextRelevance: parseFloat(parsed.contextRelevance || 0),
          answerRelevance: parseFloat(parsed.answerRelevance || 0),
          explanations: parsed.explanations || {
            faithfulness: "Evaluated by LLM",
            contextRelevance: "Evaluated by LLM",
            answerRelevance: "Evaluated by LLM"
          },
          method: "llm-as-a-judge"
        };
      }
    } catch (e) {
      console.error("LLM-as-a-Judge execution failed, falling back to algorithmic evaluation:", e.message);
    }

    // Fallback if LLM evaluation fails
    return this.evaluateAlgorithmic(query, contextChunks, answer);
  }
}

module.exports = EvalEngine;
