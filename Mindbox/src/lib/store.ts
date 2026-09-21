/** 书签与最近文件(localStorage 持久化)。 */

const BM_KEY = "mindbox-bookmarks";
const RECENT_KEY = "mindbox-recent";
const RECENT_MAX = 15;

function read(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function write(key: string, v: string[]) {
  localStorage.setItem(key, JSON.stringify(v));
}

export const loadBookmarks = () => read(BM_KEY);

export function toggleBookmark(path: string): string[] {
  const v = read(BM_KEY);
  const i = v.indexOf(path);
  i >= 0 ? v.splice(i, 1) : v.unshift(path);
  write(BM_KEY, v);
  return v;
}

export const isBookmarked = (path: string) => read(BM_KEY).includes(path);

export const loadRecent = () => read(RECENT_KEY);

/** 记录打开(去重置顶,最多 15 条)。 */
export function pushRecent(path: string): string[] {
  const v = read(RECENT_KEY).filter((p) => p !== path);
  v.unshift(path);
  const out = v.slice(0, RECENT_MAX);
  write(RECENT_KEY, out);
  return out;
}
