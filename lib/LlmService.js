/**
 * LlmService.js
 * Interfaces with LLM providers (OpenAI, Gemini, Ollama) or generates a smart simulated response
 * using native fetch streaming.
 */

const { EventEmitter } = require("events");

class LlmService {
  /**
   * Main entrypoint for streaming LLM responses
   * @param {string} provider 'mock' | 'openai' | 'gemini' | 'ollama'
   * @param {string} query The user query
   * @param {Array<Object>} contextChunks Retrieved context chunks
   * @param {Object} apiConfig API keys/urls { openaiKey, geminiKey, ollamaUrl, systemPrompt }
   * @param {Function} onChunkCallback Called with each token/text chunk
   * @param {Function} onCompleteCallback Called when stream finishes, returns full text and usage data
   * @param {Function} onErrorCallback Called on stream failure
   */
  static stream(
    provider,
    query,
    contextChunks,
    apiConfig = {},
    onChunkCallback,
    onCompleteCallback,
    onErrorCallback
  ) {
    const contextText = contextChunks.map(c => `[Doc ID: ${c.id}] ${c.text}`).join("\n\n");
    const systemPrompt = apiConfig.systemPrompt || "You are a helpful assistant. Answer the user question ONLY based on the provided context. If the answer cannot be found in the context, state that you do not know.";
    const fullPrompt = `System: ${systemPrompt}\n\nContext:\n${contextText}\n\nUser Question: ${query}\n\nAnswer:`;

    if (provider === "mock" || !provider) {
      this.streamMock(query, contextChunks, onChunkCallback, onCompleteCallback);
    } else if (provider === "openai") {
      this.streamOpenAi(fullPrompt, apiConfig.openaiKey, onChunkCallback, onCompleteCallback, onErrorCallback);
    } else if (provider === "gemini") {
      this.streamGemini(systemPrompt, contextText, query, apiConfig.geminiKey, onChunkCallback, onCompleteCallback, onErrorCallback);
    } else if (provider === "ollama") {
      this.streamOllama(systemPrompt, contextText, query, apiConfig.ollamaUrl, onChunkCallback, onCompleteCallback, onErrorCallback);
    } else {
      onErrorCallback(new Error(`Unsupported provider: ${provider}`));
    }
  }

  /**
   * Generates a smart simulated response by searching context for query terms
   * and streams it back word-by-word.
   */
  static streamMock(query, contextChunks, onChunk, onComplete) {
    const startTime = Date.now();
    
    // 1. Analyze query terms
    const queryTerms = query.toLowerCase().replace(/[^\w\sñáéíóúü]/g, "").split(/\s+/).filter(t => t.length > 2);
    
    let answerText = "";
    
    if (contextChunks.length === 0) {
      answerText = "I could not retrieve any context documents to answer your query. Please index some documents first in the sandbox.";
    } else {
      // Find sentences in chunks containing query terms
      const sentences = [];
      contextChunks.forEach(chunk => {
        const chunkSentences = chunk.text.split(/(?<=[.!?])\s+/);
        chunkSentences.forEach(s => {
          let score = 0;
          queryTerms.forEach(term => {
            if (s.toLowerCase().includes(term)) score++;
          });
          if (score > 0) {
            sentences.push({ sentence: s.trim(), score, chunkId: chunk.id });
          }
        });
      });

      // Sort sentences by matches
      sentences.sort((a, b) => b.score - a.score);

      if (sentences.length > 0) {
        const topSentences = sentences.slice(0, 3).map(s => s.sentence);
        answerText = `[Simulated LLM Response based on context]\n\nBased on the retrieved context, I found relevant information:\n\n` +
          topSentences.join(" ") + 
          `\n\n(Generated dynamically via client similarity matching with retrieved chunks: ${contextChunks.slice(0, 2).map(c => c.id).join(", ")})`;
      } else {
        answerText = `[Simulated LLM Response]\n\nI retrieved ${contextChunks.length} documents (including ${contextChunks[0].id}), but none of them seem to explicitly contain keywords matching "${query}".\n\nHere is a snippet from the most relevant chunk (${contextChunks[0].id}): "${contextChunks[0].text.substring(0, 100)}..."`;
      }
    }

    // 2. Stream the generated text word by word
    const words = answerText.split(" ");
    let index = 0;
    
    const interval = setInterval(() => {
      if (index < words.length) {
        const chunkWord = words[index] + (index === words.length - 1 ? "" : " ");
        onChunk(chunkWord);
        index++;
      } else {
        clearInterval(interval);
        
        // Estimate token counts (approx 4 chars per token)
        const promptTokens = Math.ceil(query.length / 4) + contextChunks.reduce((acc, c) => acc + Math.ceil(c.text.length / 4), 0);
        const completionTokens = Math.ceil(answerText.length / 4);

        onComplete({
          text: answerText,
          promptTokens,
          completionTokens,
          latency: Date.now() - startTime
        });
      }
    }, 50); // stream ~20 words per second (very responsive)
  }

  /**
   * OpenAI Chat Completion Stream
   */
  static async streamOpenAi(prompt, apiKey, onChunk, onComplete, onError) {
    if (!apiKey) {
      return onError(new Error("OpenAI API key is missing. Please enter it in the settings."));
    }

    const startTime = Date.now();
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini", // Cost-effective default
          messages: [
            { role: "user", content: prompt }
          ],
          stream: true
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let fullText = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop(); // keep partial line in buffer

        for (const line of lines) {
          const cleanedLine = line.trim();
          if (!cleanedLine) continue;
          if (cleanedLine === "data: [DONE]") continue;

          if (cleanedLine.startsWith("data: ")) {
            try {
              const data = JSON.parse(cleanedLine.substring(6));
              const content = data.choices[0]?.delta?.content;
              if (content) {
                fullText += content;
                onChunk(content);
              }
            } catch (err) {
              // Ignore partial JSON parse errors
            }
          }
        }
      }

      const promptTokens = Math.ceil(prompt.length / 4);
      const completionTokens = Math.ceil(fullText.length / 4);

      onComplete({
        text: fullText,
        promptTokens,
        completionTokens,
        latency: Date.now() - startTime
      });
    } catch (err) {
      onError(err);
    }
  }

  /**
   * Google Gemini Content Stream
   */
  static async streamGemini(systemPrompt, contextText, query, apiKey, onChunk, onComplete, onError) {
    if (!apiKey) {
      return onError(new Error("Gemini API key is missing. Please enter it in the settings."));
    }

    const startTime = Date.now();
    try {
      const model = "gemini-1.5-flash";
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: `System Prompt:\n${systemPrompt}\n\nContext:\n${contextText}\n\nUser Question: ${query}` }
              ]
            }
          ],
          generationConfig: {
            maxOutputTokens: 2048,
            temperature: 0.2
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let fullText = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        
        // Gemini stream splits responses using an outer JSON array wrapper
        // and sends individual JSON chunks in a stream. We'll extract content using regex
        // or parsing if possible. To make stream processing highly resilient:
        let match;
        // Search for all occurrence of "text": "..." in SSE-like chunks
        // Example structure: {"candidates": [{"content": {"parts": [{"text": "hello"}]}}]}
        // We will parse line by line or search for valid JSON blocks
      }

      // To simplify and ensure robust streaming, we will parse the buffer using standard bracket matching
      // or clean line processing.
      // Let's implement robust buffer decoding for Gemini:
      let tempBuffer = buffer;
      let textChunkFound = "";
      
      // A quick and extremely robust parser for stream content:
      // Gemini streams JSON blocks. Sometimes they are separated by commas, as it sends a JSON array: [ {...}, {...} ]
      // We can clean up the brackets and parse single JSON objects.
      let bracketCount = 0;
      let startIdx = -1;
      
      for (let i = 0; i < tempBuffer.length; i++) {
        if (tempBuffer[i] === "{") {
          if (bracketCount === 0) startIdx = i;
          bracketCount++;
        } else if (tempBuffer[i] === "}") {
          bracketCount--;
          if (bracketCount === 0 && startIdx !== -1) {
            const jsonStr = tempBuffer.substring(startIdx, i + 1);
            try {
              const obj = JSON.parse(jsonStr);
              const text = obj.candidates?.[0]?.content?.parts?.[0]?.text;
              if (text) {
                fullText += text;
                onChunk(text);
              }
            } catch (e) {
              // Ignore partial JSON parse errors
            }
            startIdx = -1;
          }
        }
      }
      
      // Slice buffer to retain incomplete JSON
      if (startIdx !== -1) {
        buffer = tempBuffer.substring(startIdx);
      } else {
        buffer = "";
      }

      // Read remaining stream
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        tempBuffer = decoder.decode(value, { stream: true });
        buffer += tempBuffer;

        let bracketCount = 0;
        let startIdx = -1;
        
        for (let i = 0; i < buffer.length; i++) {
          if (buffer[i] === "{") {
            if (bracketCount === 0) startIdx = i;
            bracketCount++;
          } else if (buffer[i] === "}") {
            bracketCount--;
            if (bracketCount === 0 && startIdx !== -1) {
              const jsonStr = buffer.substring(startIdx, i + 1);
              try {
                const obj = JSON.parse(jsonStr);
                const text = obj.candidates?.[0]?.content?.parts?.[0]?.text;
                if (text) {
                  fullText += text;
                  onChunk(text);
                }
              } catch (e) {
                // Ignore errors
              }
              startIdx = -1;
            }
          }
        }

        if (startIdx !== -1) {
          buffer = buffer.substring(startIdx);
        } else {
          buffer = "";
        }
      }

      const promptTokens = Math.ceil((systemPrompt.length + contextText.length + query.length) / 4);
      const completionTokens = Math.ceil(fullText.length / 4);

      onComplete({
        text: fullText,
        promptTokens,
        completionTokens,
        latency: Date.now() - startTime
      });

    } catch (err) {
      onError(err);
    }
  }

  /**
   * Ollama Local Chat Stream
   */
  static async streamOllama(systemPrompt, contextText, query, baseUrl = "http://localhost:11434", onChunk, onComplete, onError) {
    const url = `${baseUrl.replace(/\/$/, "")}/api/chat`;
    const startTime = Date.now();

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "llama3", // default model, user can adjust
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Context:\n${contextText}\n\nQuestion: ${query}` }
          ],
          stream: true
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let fullText = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          const cleanedLine = line.trim();
          if (!cleanedLine) continue;

          try {
            const data = JSON.parse(cleanedLine);
            const content = data.message?.content;
            if (content) {
              fullText += content;
              onChunk(content);
            }
          } catch (err) {
            // Ignore
          }
        }
      }

      const promptTokens = Math.ceil((systemPrompt.length + contextText.length + query.length) / 4);
      const completionTokens = Math.ceil(fullText.length / 4);

      onComplete({
        text: fullText,
        promptTokens,
        completionTokens,
        latency: Date.now() - startTime
      });
    } catch (err) {
      onError(err);
    }
  }
}

module.exports = LlmService;
