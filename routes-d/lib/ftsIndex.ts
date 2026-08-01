/**
 * Full-Text Search Index
 * 
 * Provides tokenization, indexing, and ranking for full-text search over documents.
 * Supports stop-word handling and configurable scoring functions.
 */

export interface Document {
  id: string;
  fields: Record<string, string>;
}

export interface SearchOptions {
  limit?: number;
  minScore?: number;
}

export interface SearchResult {
  document: Document;
  score: number;
  matchedFields: string[];
}

/**
 * Common English stop words to filter out during tokenization
 */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
  'to', 'was', 'were', 'will', 'with', 'the', 'this', 'but', 'they',
  'have', 'had', 'what', 'when', 'where', 'who', 'which', 'why', 'how',
  'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some',
  'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too',
  'very', 'can', 'just', 'should', 'now', 'i', 'you', 'your', 'we', 'our',
  'their', 'them', 'his', 'her', 'she', 'him', 'me', 'my', 'us', 'am',
  'do', 'does', 'did', 'doing', 'or', 'if', 'because', 'until', 'while',
  'about', 'against', 'between', 'into', 'through', 'during', 'before',
  'after', 'above', 'below', 'up', 'down', 'out', 'off', 'over', 'under',
  'again', 'further', 'then', 'once', 'here', 'there', 'any', 'being',
]);

/**
 * Tokenize text into individual terms, removing stop words and normalizing case
 * 
 * @param text - Text to tokenize
 * @returns Array of normalized tokens
 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  
  // Convert to lowercase and split on non-word characters
  const tokens = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0 && !STOP_WORDS.has(token));
  
  return tokens;
}

/**
 * Calculate term frequency (TF) for a term in a document
 * 
 * @param term - The term to calculate frequency for
 * @param documentTokens - Array of tokens from the document
 * @returns Term frequency (normalized)
 */
function calculateTermFrequency(term: string, documentTokens: string[]): number {
  const count = documentTokens.filter((t) => t === term).length;
  return count / documentTokens.length;
}

/**
 * Calculate inverse document frequency (IDF) for a term across all documents
 * 
 * @param term - The term to calculate IDF for
 * @param allDocuments - Array of all document token arrays
 * @returns Inverse document frequency
 */
function calculateInverseDocumentFrequency(
  term: string,
  allDocuments: string[][]
): number {
  const documentCount = allDocuments.length;
  const documentsWithTerm = allDocuments.filter((tokens) =>
    tokens.includes(term)
  ).length;
  
  if (documentsWithTerm === 0) return 0;
  
  return Math.log(documentCount / documentsWithTerm);
}

/**
 * Calculate TF-IDF score for a term in a document
 * 
 * @param term - The term to score
 * @param documentTokens - Tokens from the document
 * @param allDocuments - All document token arrays
 * @returns TF-IDF score
 */
function calculateTFIDF(
  term: string,
  documentTokens: string[],
  allDocuments: string[][]
): number {
  const tf = calculateTermFrequency(term, documentTokens);
  const idf = calculateInverseDocumentFrequency(term, allDocuments);
  return tf * idf;
}

/**
 * Calculate BM25-style relevance score
 * BM25 is a ranking function used by search engines to estimate relevance
 * 
 * Formula: IDF * (tf * (k + 1)) / (tf + k * (1 - b + b * (|D| / avgDL)))
 * 
 * @param termFrequency - Frequency of term in document
 * @param documentLength - Length of document in tokens
 * @param averageDocumentLength - Average document length across corpus
 * @param totalDocuments - Total number of documents
 * @param documentsWithTerm - Number of documents containing the term
 * @param k - Term saturation parameter (default 1.2)
 * @param b - Length normalization parameter (default 0.75)
 * @returns BM25 score
 */
export function calculateBM25(
  termFrequency: number,
  documentLength: number,
  averageDocumentLength: number,
  totalDocuments: number,
  documentsWithTerm: number,
  k: number = 1.2,
  b: number = 0.75
): number {
  if (termFrequency === 0) return 0;
  if (documentsWithTerm === 0) return 0;
  
  const idf = Math.log((totalDocuments - documentsWithTerm + 0.5) / (documentsWithTerm + 0.5) + 1);
  const numerator = termFrequency * (k + 1);
  const denominator = termFrequency + k * (1 - b + b * (documentLength / averageDocumentLength));
  
  return idf * (numerator / denominator);
}

/**
 * Full-Text Search Index class
 */
export class FTSIndex {
  private documents: Map<string, Document> = new Map();
  private tokenizedDocuments: Map<string, string[]> = new Map();
  private invertedIndex: Map<string, Set<string>> = new Map();
  private averageDocumentLength: number = 0;

  /**
   * Add a document to the index
   * 
   * @param document - Document to index
   */
  addDocument(document: Document): void {
    this.documents.set(document.id, document);
    
    // Tokenize all fields
    const allTokens: string[] = [];
    for (const [fieldName, fieldValue] of Object.entries(document.fields)) {
      const tokens = tokenize(fieldValue);
      allTokens.push(...tokens);
      
      // Build inverted index
      for (const token of tokens) {
        if (!this.invertedIndex.has(token)) {
          this.invertedIndex.set(token, new Set());
        }
        this.invertedIndex.get(token)!.add(document.id);
      }
    }
    
    this.tokenizedDocuments.set(document.id, allTokens);
    this.recalculateAverageDocumentLength();
  }

  /**
   * Remove a document from the index
   * 
   * @param id - Document ID to remove
   */
  removeDocument(id: string): void {
    const document = this.documents.get(id);
    if (!document) return;
    
    // Remove from inverted index
    for (const [fieldName, fieldValue] of Object.entries(document.fields)) {
      const tokens = tokenize(fieldValue);
      for (const token of tokens) {
        const postings = this.invertedIndex.get(token);
        if (postings) {
          postings.delete(id);
          if (postings.size === 0) {
            this.invertedIndex.delete(token);
          }
        }
      }
    }
    
    this.documents.delete(id);
    this.tokenizedDocuments.delete(id);
    this.recalculateAverageDocumentLength();
  }

  /**
   * Recalculate average document length
   */
  private recalculateAverageDocumentLength(): void {
    if (this.tokenizedDocuments.size === 0) {
      this.averageDocumentLength = 0;
      return;
    }
    
    let totalLength = 0;
    const tokensArray = Array.from(this.tokenizedDocuments.values());
    for (const tokens of tokensArray) {
      totalLength += tokens.length;
    }
    
    this.averageDocumentLength = totalLength / this.tokenizedDocuments.size;
  }

  /**
   * Search for documents matching a query
   * 
   * @param query - Search query string
   * @param options - Search options
   * @returns Array of search results sorted by score
   */
  search(query: string, options: SearchOptions = {}): SearchResult[] {
    const { limit = 10, minScore = 0 } = options;
    
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];
    
    const results = new Map<string, SearchResult>();
    const totalDocuments = this.documents.size;
    
    for (const queryToken of queryTokens) {
      const documentIds = this.invertedIndex.get(queryToken);
      if (!documentIds) continue;
      
      const documentsWithTerm = documentIds.size;
      
      const documentIdArray = Array.from(documentIds);
      for (const documentId of documentIdArray) {
        const document = this.documents.get(documentId);
        const documentTokens = this.tokenizedDocuments.get(documentId);
        
        if (!document || !documentTokens) continue;
        
        const termFrequency = documentTokens.filter((t) => t === queryToken).length;
        const documentLength = documentTokens.length;
        
        const score = calculateBM25(
          termFrequency,
          documentLength,
          this.averageDocumentLength,
          totalDocuments,
          documentsWithTerm
        );
        
        if (score < minScore) continue;
        
        if (!results.has(documentId)) {
          results.set(documentId, {
            document,
            score: 0,
            matchedFields: [],
          });
        }
        
        const result = results.get(documentId)!;
        result.score += score;
        
        // Track which fields matched
        for (const [fieldName, fieldValue] of Object.entries(document.fields)) {
          const fieldTokens = tokenize(fieldValue);
          if (fieldTokens.includes(queryToken) && !result.matchedFields.includes(fieldName)) {
            result.matchedFields.push(fieldName);
          }
        }
      }
    }
    
    // Sort by score descending and apply limit
    return Array.from(results.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Get the number of documents in the index
   */
  size(): number {
    return this.documents.size;
  }

  /**
   * Clear all documents from the index
   */
  clear(): void {
    this.documents.clear();
    this.tokenizedDocuments.clear();
    this.invertedIndex.clear();
    this.averageDocumentLength = 0;
  }

  /**
   * Get statistics about the index
   */
  getStats(): {
    documentCount: number;
    totalTokens: number;
    uniqueTerms: number;
    averageDocumentLength: number;
  } {
    let totalTokens = 0;
    const tokensArray = Array.from(this.tokenizedDocuments.values());
    for (const tokens of tokensArray) {
      totalTokens += tokens.length;
    }
    
    return {
      documentCount: this.documents.size,
      totalTokens,
      uniqueTerms: this.invertedIndex.size,
      averageDocumentLength: this.averageDocumentLength,
    };
  }
}
