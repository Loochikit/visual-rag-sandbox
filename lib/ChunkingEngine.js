/**
 * ChunkingEngine.js
 * Implements text splitting algorithms for RAG ingestion:
 * 1. Simple Character Splitter
 * 2. Recursive Character Splitter (mimics LangChain's algorithm using tiered delimiters)
 */

class ChunkingEngine {
  /**
   * Splits text using a simple character-count method with overlap
   * @param {string} text 
   * @param {number} chunkSize 
   * @param {number} chunkOverlap 
   * @returns {Array<Object>} List of chunks
   */
  static splitByCharacter(text, chunkSize, chunkOverlap) {
    if (!text) return [];
    if (chunkSize <= 0) chunkSize = 500;
    if (chunkOverlap >= chunkSize) chunkOverlap = Math.floor(chunkSize / 2);

    const chunks = [];
    let start = 0;
    let index = 0;

    while (start < text.length) {
      const end = Math.min(start + chunkSize, text.length);
      const chunkText = text.slice(start, end);
      
      chunks.push({
        id: `chunk_${index++}`,
        text: chunkText,
        startIndex: start,
        endIndex: end,
        length: chunkText.length
      });

      if (end === text.length) break;
      start += (chunkSize - chunkOverlap);
    }

    return chunks;
  }

  /**
   * Splits text recursively using a list of separators
   * @param {string} text 
   * @param {number} chunkSize 
   * @param {number} chunkOverlap 
   * @param {Array<string>} separators Delimiters, from largest structural boundary to smallest
   * @returns {Array<Object>} List of chunks
   */
  static splitRecursively(text, chunkSize, chunkOverlap, separators = ["\n\n", "\n", " ", ""]) {
    if (!text) return [];
    if (chunkSize <= 0) chunkSize = 500;
    if (chunkOverlap >= chunkSize) chunkOverlap = Math.floor(chunkSize / 2);

    const finalChunks = [];
    let chunkIndex = 0;

    // Helper function to perform recursive splitting
    function split(textBlock, offset, separatorIndex) {
      if (textBlock.length <= chunkSize) {
        if (textBlock.trim().length > 0) {
          finalChunks.push({
            id: `chunk_${chunkIndex++}`,
            text: textBlock,
            startIndex: offset,
            endIndex: offset + textBlock.length,
            length: textBlock.length
          });
        }
        return;
      }

      // If we are out of separators, force split by character
      if (separatorIndex >= separators.length) {
        const charChunks = ChunkingEngine.splitByCharacter(textBlock, chunkSize, chunkOverlap);
        charChunks.forEach(c => {
          finalChunks.push({
            id: `chunk_${chunkIndex++}`,
            text: c.text,
            startIndex: offset + c.startIndex,
            endIndex: offset + c.endIndex,
            length: c.length
          });
        });
        return;
      }

      const separator = separators[separatorIndex];
      const splits = textBlock.split(separator);
      
      let currentDoc = "";
      let currentOffset = offset;

      for (let i = 0; i < splits.length; i++) {
        const part = splits[i];
        
        // Handle separator addition logic
        let partWithSeparator = part;
        if (i < splits.length - 1) {
          partWithSeparator += separator;
        }

        // If part alone is bigger than chunk size, split it with the next separator
        if (partWithSeparator.length > chunkSize) {
          // Process current accumulated doc first
          if (currentDoc.length > 0) {
            split(currentDoc, currentOffset, separatorIndex + 1);
            currentDoc = "";
          }
          // Recursively split the oversized part
          split(partWithSeparator, currentOffset + (part === "" ? 0 : textBlock.indexOf(part, currentDoc.length)), separatorIndex + 1);
          currentOffset += partWithSeparator.length;
          continue;
        }

        // If adding this part exceeds max size, flush current doc and prepare next
        if (currentDoc.length + partWithSeparator.length > chunkSize) {
          if (currentDoc.length > 0) {
            split(currentDoc, currentOffset, separatorIndex + 1);
          }

          // Retain overlap: take last characters from current doc
          if (chunkOverlap > 0 && currentDoc.length > 0) {
            // Simple heuristic to overlap: find overlap starting point from end of currentDoc
            const overlapStart = Math.max(0, currentDoc.length - chunkOverlap);
            currentDoc = currentDoc.slice(overlapStart);
            currentOffset += overlapStart;
          } else {
            currentOffset += currentDoc.length;
            currentDoc = "";
          }
        }

        currentDoc += partWithSeparator;
      }

      // Flush remaining
      if (currentDoc.length > 0) {
        split(currentDoc, currentOffset, separatorIndex + 1);
      }
    }

    split(text, 0, 0);
    return finalChunks;
  }
}

module.exports = ChunkingEngine;
