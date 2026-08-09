/**
 * Unit tests for ftsIndex.ts
 */

import {
  tokenize,
  calculateBM25,
  FTSIndex,
  type Document,
  type SearchOptions,
} from '../../lib/ftsIndex.js';

describe('ftsIndex', () => {
  describe('tokenize', () => {
    it('splits text into lowercase tokens', () => {
      const text = 'Hello World Test';
      const tokens = tokenize(text);
      expect(tokens).toEqual(['hello', 'world', 'test']);
    });

    it('removes punctuation', () => {
      const text = 'Hello, world! This is a test.';
      const tokens = tokenize(text);
      expect(tokens).toEqual(['hello', 'world', 'this', 'test']);
    });

    it('filters out stop words', () => {
      const text = 'The quick brown fox jumps over the lazy dog';
      const tokens = tokenize(text);
      expect(tokens).not.toContain('the');
      expect(tokens).not.toContain('over');
      expect(tokens).toContain('quick');
      expect(tokens).toContain('brown');
      expect(tokens).toContain('fox');
    });

    it('handles empty string', () => {
      const tokens = tokenize('');
      expect(tokens).toEqual([]);
    });

    it('handles multiple spaces', () => {
      const text = 'hello    world   test';
      const tokens = tokenize(text);
      expect(tokens).toEqual(['hello', 'world', 'test']);
    });

    it('filters out single character tokens', () => {
      const text = 'a b c hello world';
      const tokens = tokenize(text);
      expect(tokens).toEqual(['hello', 'world']);
    });
  });

  describe('calculateBM25', () => {
    it('calculates BM25 score for term frequency', () => {
      const score = calculateBM25(2, 10, 15, 100, 10);
      expect(score).toBeGreaterThan(0);
    });

    it('returns 0 for zero term frequency', () => {
      const score = calculateBM25(0, 10, 15, 100, 10);
      expect(score).toBe(0);
    });

    it('returns 0 when no documents contain term', () => {
      const score = calculateBM25(5, 10, 15, 100, 0);
      expect(score).toBe(0);
    });

    it('higher term frequency increases score', () => {
      const score1 = calculateBM25(1, 10, 15, 100, 10);
      const score2 = calculateBM25(5, 10, 15, 100, 10);
      expect(score2).toBeGreaterThan(score1);
    });

    it('rare terms get higher scores', () => {
      const scoreRare = calculateBM25(2, 10, 15, 100, 2);
      const scoreCommon = calculateBM25(2, 10, 15, 100, 50);
      expect(scoreRare).toBeGreaterThan(scoreCommon);
    });
  });

  describe('FTSIndex', () => {
    let index: FTSIndex;

    beforeEach(() => {
      index = new FTSIndex();
    });

    describe('addDocument', () => {
      it('adds document to index', () => {
        const doc: Document = {
          id: '1',
          fields: {
            title: 'Test Document',
            content: 'This is a test content',
          },
        };

        index.addDocument(doc);
        expect(index.size()).toBe(1);
      });

      it('indexes multiple fields', () => {
        const doc: Document = {
          id: '1',
          fields: {
            title: 'Hello World',
            description: 'Test Description',
            tags: 'test sample',
          },
        };

        index.addDocument(doc);
        expect(index.size()).toBe(1);

        const stats = index.getStats();
        expect(stats.totalTokens).toBeGreaterThan(0);
      });

      it('handles documents with empty fields', () => {
        const doc: Document = {
          id: '1',
          fields: {
            title: '',
            content: '',
          },
        };

        index.addDocument(doc);
        expect(index.size()).toBe(1);
      });

      it('updates index when adding same document', () => {
        const doc: Document = {
          id: '1',
          fields: {
            title: 'Test',
          },
        };

        index.addDocument(doc);
        const stats1 = index.getStats();
        
        index.addDocument(doc);
        const stats2 = index.getStats();

        expect(index.size()).toBe(1);
        expect(stats2.totalTokens).toBe(stats1.totalTokens * 2);
      });
    });

    describe('removeDocument', () => {
      it('removes document from index', () => {
        const doc: Document = {
          id: '1',
          fields: {
            title: 'Test Document',
          },
        };

        index.addDocument(doc);
        expect(index.size()).toBe(1);

        index.removeDocument('1');
        expect(index.size()).toBe(0);
      });

      it('handles removing non-existent document', () => {
        expect(() => index.removeDocument('nonexistent')).not.toThrow();
        expect(index.size()).toBe(0);
      });

      it('updates inverted index on removal', () => {
        const doc1: Document = {
          id: '1',
          fields: {
            title: 'Unique Term',
          },
        };

        const doc2: Document = {
          id: '2',
          fields: {
            title: 'Another Document',
          },
        };

        index.addDocument(doc1);
        index.addDocument(doc2);
        expect(index.size()).toBe(2);

        index.removeDocument('1');
        expect(index.size()).toBe(1);

        const stats = index.getStats();
        expect(stats.uniqueTerms).toBeGreaterThan(0);
      });
    });

    describe('search - exact match', () => {
      it('finds documents with exact term match', () => {
        const doc: Document = {
          id: '1',
          fields: {
            title: 'Hello World',
            content: 'This is a test',
          },
        };

        index.addDocument(doc);

        const results = index.search('hello');
        expect(results).toHaveLength(1);
        expect(results[0].document.id).toBe('1');
        expect(results[0].score).toBeGreaterThan(0);
      });

      it('finds documents matching multiple terms', () => {
        const doc: Document = {
          id: '1',
          fields: {
            title: 'Hello World Test',
          },
        };

        index.addDocument(doc);

        const results = index.search('hello world');
        expect(results).toHaveLength(1);
        expect(results[0].matchedFields).toContain('title');
      });

      it('returns empty array for no matches', () => {
        const doc: Document = {
          id: '1',
          fields: {
            title: 'Hello World',
          },
        };

        index.addDocument(doc);

        const results = index.search('nonexistent term');
        expect(results).toHaveLength(0);
      });

      it('is case-insensitive', () => {
        const doc: Document = {
          id: '1',
          fields: {
            title: 'Hello World',
          },
        };

        index.addDocument(doc);

        const results = index.search('HELLO');
        expect(results).toHaveLength(1);
      });
    });

    describe('search - partial match', () => {
      it('finds documents with partial term matches', () => {
        const doc: Document = {
          id: '1',
          fields: {
            title: 'Hello World Program',
            content: 'This is a programming test',
          },
        };

        index.addDocument(doc);

        const results = index.search('program');
        expect(results).toHaveLength(1);
        expect(results[0].matchedFields.length).toBeGreaterThan(0);
      });

      it('matches terms across different fields', () => {
        const doc: Document = {
          id: '1',
          fields: {
            title: 'Software Development',
            description: 'Building applications',
          },
        };

        index.addDocument(doc);

        const results = index.search('development applications');
        expect(results).toHaveLength(1);
        expect(results[0].matchedFields).toContain('title');
        expect(results[0].matchedFields).toContain('description');
      });

      it('handles query with stop words', () => {
        const doc: Document = {
          id: '1',
          fields: {
            title: 'The Quick Brown Fox',
          },
        };

        index.addDocument(doc);

        const results = index.search('the quick fox');
        expect(results).toHaveLength(1);
      });
    });

    describe('search - ranking stability', () => {
      it('ranks documents by relevance score', () => {
        const doc1: Document = {
          id: '1',
          fields: {
            title: 'test test test',
          },
        };

        const doc2: Document = {
          id: '2',
          fields: {
            title: 'test',
          },
        };

        index.addDocument(doc1);
        index.addDocument(doc2);

        const results = index.search('test');
        expect(results).toHaveLength(2);
        expect(results[0].document.id).toBe('1'); // Higher frequency = higher score
        expect(results[0].score).toBeGreaterThan(results[1].score);
      });

      it('provides stable ranking across multiple searches', () => {
        const doc1: Document = {
          id: '1',
          fields: {
            title: 'frequent term frequent term',
          },
        };

        const doc2: Document = {
          id: '2',
          fields: {
            title: 'rare term',
          },
        };

        const doc3: Document = {
          id: '3',
          fields: {
            title: 'frequent term',
          },
        };

        index.addDocument(doc1);
        index.addDocument(doc2);
        index.addDocument(doc3);

        const results1 = index.search('frequent term');
        const results2 = index.search('frequent term');

        expect(results1[0].document.id).toBe(results2[0].document.id);
        expect(results1[0].score).toBe(results2[0].score);
      });

      it('rare terms get higher scores than common terms', () => {
        const doc1: Document = {
          id: '1',
          fields: {
            title: 'common common common',
          },
        };

        const doc2: Document = {
          id: '2',
          fields: {
            title: 'rare',
          },
        };

        const doc3: Document = {
          id: '3',
          fields: {
            title: 'common',
          },
        };

        index.addDocument(doc1);
        index.addDocument(doc2);
        index.addDocument(doc3);

        const resultsCommon = index.search('common');
        const resultsRare = index.search('rare');

        // Rare term should have higher relative score
        expect(resultsRare[0].score).toBeGreaterThan(0);
      });
    });

    describe('search - options', () => {
      it('respects limit option', () => {
        for (let i = 1; i <= 5; i++) {
          index.addDocument({
            id: String(i),
            fields: { title: `test document ${i}` },
          });
        }

        const options: SearchOptions = { limit: 3 };
        const results = index.search('test', options);

        expect(results).toHaveLength(3);
      });

      it('respects minScore option', () => {
        const doc1: Document = {
          id: '1',
          fields: {
            title: 'test test test',
          },
        };

        const doc2: Document = {
          id: '2',
          fields: {
            title: 'other',
          },
        };

        index.addDocument(doc1);
        index.addDocument(doc2);

        const options: SearchOptions = { minScore: 1.0 };
        const results = index.search('test', options);

        // Only high-score results should be returned
        expect(results.every((r) => r.score >= 1.0)).toBe(true);
      });

      it('handles limit larger than result set', () => {
        index.addDocument({
          id: '1',
          fields: { title: 'test' },
        });

        const options: SearchOptions = { limit: 100 };
        const results = index.search('test', options);

        expect(results).toHaveLength(1);
      });
    });

    describe('clear', () => {
      it('clears all documents from index', () => {
        index.addDocument({
          id: '1',
          fields: { title: 'test' },
        });
        index.addDocument({
          id: '2',
          fields: { title: 'test2' },
        });

        expect(index.size()).toBe(2);

        index.clear();
        expect(index.size()).toBe(0);
      });
    });

    describe('getStats', () => {
      it('returns index statistics', () => {
        index.addDocument({
          id: '1',
          fields: { title: 'hello world test' },
        });

        const stats = index.getStats();

        expect(stats.documentCount).toBe(1);
        expect(stats.totalTokens).toBeGreaterThan(0);
        expect(stats.uniqueTerms).toBeGreaterThan(0);
        expect(stats.averageDocumentLength).toBeGreaterThan(0);
      });

      it('returns zero stats for empty index', () => {
        const stats = index.getStats();

        expect(stats.documentCount).toBe(0);
        expect(stats.totalTokens).toBe(0);
        expect(stats.uniqueTerms).toBe(0);
        expect(stats.averageDocumentLength).toBe(0);
      });
    });
  });
});
