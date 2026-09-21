/**
 * Mindbox API 客户端。统一走 /api/v1,与后端版本化解耦。
 */
const BASE = "http://127.0.0.1:8765/api/v1";

async function request(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

const get = (url: string) => request(url);
const post = (url: string, body: unknown) =>
  request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export interface TreeNode {
  name: string;
  path: string;
  type: "dir" | "note" | "canvas";
  children?: TreeNode[];
}

export interface GraphNode {
  id: string;
  name: string;
  degree?: number;
  missing?: boolean;
}

export interface GraphLink {
  source: string;
  target: string;
}

export interface NoteData {
  path: string;
  name: string;
  content: string;
  meta: Record<string, unknown>;
}

export interface MemoryItem {
  id: string;
  layer: string;
  category: string;
  content: string;
  confidence: number;
  refs: number;
  success: number;
  fail: number;
}

export interface SearchSnippet {
  line: number;
  text: string;
}

export interface SearchResult {
  path: string;
  name: string;
  count: number;
  score: number;
  snippets: SearchSnippet[];
}

export interface Backlink {
  source: string;
  name: string;
  contexts: string[];
}

export interface Outlink {
  target: string;
  resolved: string | null;
}

export const api = {
  tree: () => get(`${BASE}/vault/tree`) as Promise<TreeNode[]>,
  graph: () => get(`${BASE}/vault/graph`) as Promise<{ nodes: GraphNode[]; links: GraphLink[] }>,
  readNote: (path: string) => get(`${BASE}/notes?path=${encodeURIComponent(path)}`) as Promise<NoteData>,
  createNote: (path: string, content = "") => post(`${BASE}/notes`, { path, content }),
  saveNote: (path: string, content: string) =>
    request(`${BASE}/notes?path=${encodeURIComponent(path)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }),
  resolve: (title: string) => get(`${BASE}/notes/resolve?title=${encodeURIComponent(title)}`) as Promise<{ path: string | null }>,
  rename: (path: string, newPath: string, updateLinks = true) =>
    post(`${BASE}/notes/rename`, { path, new_path: newPath, update_links: updateLinks }),
  backlinks: (path: string) => get(`${BASE}/notes/backlinks?path=${encodeURIComponent(path)}`) as Promise<Backlink[]>,
  outlinks: (path: string) => get(`${BASE}/notes/outlinks?path=${encodeURIComponent(path)}`) as Promise<Outlink[]>,
  createFolder: (path: string) => post(`${BASE}/vault/folder`, { path }),
  copyItem: (src: string, dst: string) => post(`${BASE}/vault/copy`, { src, dst }),
  tags: () => get(`${BASE}/vault/tags`) as Promise<Record<string, number>>,
  search: (q: string) => get(`${BASE}/search?q=${encodeURIComponent(q)}`) as Promise<SearchResult[]>,
  tagNotes: (tag: string) => get(`${BASE}/vault/tag-notes?tag=${encodeURIComponent(tag)}`) as Promise<{ path: string; name: string }[]>,
  saveImage: (name: string, dataB64: string) => post(`${BASE}/vault/image`, { name, data: dataB64 }) as Promise<{ path: string; name: string }>,
  mediaUrl: (target: string) => `${BASE}/vault/media?path=${encodeURIComponent(target)}`,
  snapshots: (path: string) => get(`${BASE}/snapshots?path=${encodeURIComponent(path)}`) as Promise<{ ts: string; mtime: number; size: number }[]>,
  snapshotFiles: () => get(`${BASE}/snapshots/files`) as Promise<{ path: string; exists: boolean; count: number; latest: number }[]>,
  readSnapshot: (path: string, ts: string) =>
    get(`${BASE}/snapshots/read?path=${encodeURIComponent(path)}&ts=${encodeURIComponent(ts)}`) as Promise<{ content: string }>,
  restoreSnapshot: (path: string, ts: string) => post(`${BASE}/snapshots/restore`, { path, ts }),
  memorySummary: () => get(`${BASE}/memory/summary`) as Promise<Record<string, number>>,
  memoryItems: (layer: string) => get(`${BASE}/memory/${layer}`) as Promise<MemoryItem[]>,
  addMemory: (layer: string, category: string, content: string) => post(`${BASE}/memory/${layer}`, { category, content }),
};
