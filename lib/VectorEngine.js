/**
 * VectorEngine.js
 * Implements an in-memory vector database and similarity engine:
 * 1. Local TF-IDF Vectorizer (for offline/simulated mode)
 * 2. Random Projection (dimensionality reduction from N-dim to 2D coordinates for Canvas plotting)
 * 3. Cosine Similarity search calculation
 */

class VectorEngine {
  constructor() {
    this.chunks = [];      // Array of { id, text, vector, x, y, metadata }
    this.vocabulary = [];  // Array of terms in vocabulary
    this.idf = {};         // Term -> IDF mapping
    this.projectionMatrix = null; // Random matrix for 2D projections
  }

  /**
   * Resets the database state
   */
  clear() {
    this.chunks = [];
    this.vocabulary = [];
    this.idf = {};
    this.projectionMatrix = null;
  }

  /**
   * Simple stop words list to clean up TF-IDF
   */
  static get STOP_WORDS() {
    return new Set([
      "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", "arent", "as", "at",
      "be", "because", "been", "before", "being", "below", "between", "both", "but", "by", "cant", "cannot", "could",
      "did", "didnt", "do", "does", "doesnt", "doing", "dont", "down", "during", "each", "few", "for", "from", "further",
      "had", "hadnt", "has", "hasnt", "have", "havent", "having", "he", "hed", "hell", "hes", "her", "here", "heres",
      "hers", "herself", "him", "himself", "his", "how", "hows", "i", "id", "ill", "im", "ive", "if", "in", "into", "is",
      "isnt", "it", "its", "itself", "lets", "me", "more", "most", "mustnt", "my", "myself", "no", "nor", "not", "of",
      "off", "on", "once", "only", "or", "other", "ought", "our", "ours", "ourselves", "out", "over", "own", "same",
      "shant", "she", "shed", "shell", "shes", "should", "shouldnt", "so", "some", "such", "than", "that", "thats",
      "the", "their", "theirs", "them", "themselves", "then", "there", "theres", "these", "they", "theyd", "theyll",
      "theyre", "theyve", "this", "those", "through", "to", "too", "under", "until", "up", "very", "was", "wasnt",
      "we", "wed", "well", "were", "weve", "werent", "what", "whats", "when", "whens", "where", "wheres", "which",
      "while", "who", "whos", "whom", "why", "whys", "with", "wont", "would", "wouldnt", "you", "youd", "youll",
      "youre", "youve", "your", "yours", "yourself", "yourselves",
      // Spanish equivalents for robust local testing
      "el", "la", "los", "las", "un", "una", "unos", "unas", "y", "o", "u", "e", "pero", "para", "por", "de", "del",
      "con", "sin", "en", "que", "es", "son", "un", "este", "esta", "estos", "estas", "como", "mas", "al", "se"
    ]);
  }

  /**
   * Tokenizes text into cleaned lowercase terms
   * @param {string} text 
   * @returns {Array<string>} Cleaned tokens
   */
  static tokenize(text) {
    if (!text) return [];
    return text
      .toLowerCase()
      .replace(/[^\w\sñáéíóúü]/g, " ") // retain Spanish characters
      .split(/\s+/)
      .filter(token => token.length > 1 && !VectorEngine.STOP_WORDS.has(token));
  }

  /**
   * Trains the TF-IDF vocabulary and IDF maps based on document chunks
   * @param {Array<Object>} chunks List of chunks from ChunkingEngine
   */
  trainTfidf(chunks) {
    if (chunks.length === 0) return;

    // 1. Build vocabulary and count document frequency
    const docFrequency = {};
    const totalDocs = chunks.length;

    chunks.forEach(chunk => {
      const tokens = VectorEngine.tokenize(chunk.text);
      const uniqueTokensInDoc = new Set(tokens);
      uniqueTokensInDoc.forEach(token => {
        docFrequency[token] = (docFrequency[token] || 0) + 1;
      });
    });

    // 2. Set vocabulary and calculate IDF
    this.vocabulary = Object.keys(docFrequency);
    this.idf = {};
    this.vocabulary.forEach(term => {
      // Smooth IDF: log(1 + totalDocs / docFrequency) + 1
      this.idf[term] = Math.log(1 + (totalDocs / docFrequency[term])) + 1.0;
    });

    // 3. Initialize Random Projection Matrix (dimensions: 2 x vocabSize)
    // Used to map N-dimensional TF-IDF vectors into a stable 2D coordinate space [x, y]
    const vocabSize = this.vocabulary.length;
    this.projectionMatrix = [
      new Array(vocabSize), // X projection components
      new Array(vocabSize)  // Y projection components
    ];

    // Initialize with random values using Gaussian-like distribution
    for (let d = 0; d < 2; d++) {
      for (let i = 0; i < vocabSize; i++) {
        // Box-Muller transform for normal distribution (mean=0, stdDev=1)
        const u1 = Math.random() || 0.0001;
        const u2 = Math.random() || 0.0001;
        const g = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
        this.projectionMatrix[d][i] = g;
      }
    }
  }

  /**
   * Computes a TF-IDF vector for a given string
   * @param {string} text 
   * @returns {Array<number>} Normalized unit vector
   */
  getVector(text) {
    const tokens = VectorEngine.tokenize(text);
    const tf = {};
    tokens.forEach(token => {
      tf[token] = (tf[token] || 0) + 1;
    });

    // Compute raw TF-IDF values
    const vector = new Array(this.vocabulary.length).fill(0);
    let sqSum = 0;

    this.vocabulary.forEach((term, index) => {
      if (tf[term]) {
        // Log TF scaling: 1 + log(tf)
        const tfValue = 1 + Math.log(tf[term]);
        const idfValue = this.idf[term] || 0;
        vector[index] = tfValue * idfValue;
      }
      sqSum += vector[index] * vector[index];
    });

    // Normalize vector to unit length (magnitude = 1)
    const magnitude = Math.sqrt(sqSum);
    if (magnitude > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= magnitude;
      }
    }

    return vector;
  }

  /**
   * Projects an N-dimensional vector to 2D [x, y] space via Random Projection
   * @param {Array<number>} vector N-dimensional vector
   * @returns {Object} 2D Coordinates { x, y } normalized between -0.8 and 0.8
   */
  projectTo2D(vector) {
    if (!this.projectionMatrix || vector.length === 0) {
      return { x: 0, y: 0 };
    }

    let xProj = 0;
    let yProj = 0;

    for (let i = 0; i < vector.length; i++) {
      xProj += vector[i] * this.projectionMatrix[0][i];
      yProj += vector[i] * this.projectionMatrix[1][i];
    }

    // Sigmoid or hyperbolic tangent to clamp projections to bounded circle
    const clamp = (val) => {
      const tanh = Math.tanh(val); // bounds between -1 and 1
      return tanh * 0.8;           // scale down slightly for visual margins
    };

    return {
      x: clamp(xProj),
      y: clamp(yProj)
    };
  }

  /**
   * Ingests chunks, calculates vectors and 2D projections, stores in memory
   * @param {Array<Object>} rawChunks Chunks from Chunker
   */
  ingest(rawChunks) {
    this.clear();
    if (rawChunks.length === 0) return;

    // Train TF-IDF on this corpus
    this.trainTfidf(rawChunks);

    // Compute vectors and project to 2D
    this.chunks = rawChunks.map(chunk => {
      const vector = this.getVector(chunk.text);
      const coords = this.projectTo2D(vector);
      
      return {
        id: chunk.id,
        text: chunk.text,
        vector: vector,
        startIndex: chunk.startIndex,
        endIndex: chunk.endIndex,
        x: coords.x,
        y: coords.y
      };
    });
  }

  /**
   * Computes the Cosine Similarity between two vectors
   * Since vectors are unit-normalized, cosine similarity is simply the dot product!
   * @param {Array<number>} vecA 
   * @param {Array<number>} vecB 
   * @returns {number} Cosine similarity (0 to 1 for TF-IDF)
   */
  static cosineSimilarity(vecA, vecB) {
    if (vecA.length !== vecB.length || vecA.length === 0) return 0;
    
    let dotProduct = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
    }
    return dotProduct;
  }

  /**
   * Performs Semantic Vector Similarity Search against the ingested chunks
   * @param {string} query 
   * @param {number} k Number of top items to return
   * @returns {Array<Object>} Search results with similarities and 2D query projections
   */
  search(query, k = 3) {
    if (this.chunks.length === 0) {
      return {
        queryCoords: { x: 0, y: 0 },
        results: []
      };
    }

    const queryVector = this.getVector(query);
    const queryCoords = this.projectTo2D(queryVector);

    const scoredChunks = this.chunks.map(chunk => {
      const score = VectorEngine.cosineSimilarity(queryVector, chunk.vector);
      return {
        id: chunk.id,
        text: chunk.text,
        score: parseFloat(score.toFixed(4)),
        x: chunk.x,
        y: chunk.y
      };
    });

    // Sort by descending score
    scoredChunks.sort((a, b) => b.score - a.score);

    return {
      queryCoords,
      results: scoredChunks.slice(0, Math.min(k, scoredChunks.length))
    };
  }
}

module.exports = VectorEngine;
