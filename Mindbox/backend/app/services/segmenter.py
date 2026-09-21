"""分词服务:中文 jieba + 英文按词。搜索与记忆检索共用,保证全文口径一致。"""
import jieba

jieba.setLogLevel(60)  # 关闭构建词典的日志噪音


def tokenize(text: str) -> list[str]:
    """搜索引擎模式分词,过滤空白。"""
    return [t.strip() for t in jieba.cut_for_search(text) if t.strip()]
