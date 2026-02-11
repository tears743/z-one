
export interface MemoryFragment {
  id: string;
  content: string;
  layer: 'execution' | 'control' | 'decision' | 'user';
  source: string; // e.g., 'session', 'file', 'user'
  sessionId: string;
  timestamp: number;
  embedding?: number[];
  tags?: string[];
}

export interface MemorySearchOptions {
  limit?: number;
  minScore?: number;
  layer?: 'execution' | 'control' | 'decision' | 'user';
  sessionId?: string;
  includeEmbedding?: boolean;
}

export interface MemorySearchResult extends MemoryFragment {
  score: number;
}
