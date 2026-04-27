import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import JsBarcode from 'jsbarcode';

const COOLDOWN_SECONDS = 30;

const initialResult = {
  found_count: 0,
  recommendations: [],
  no_result_reason: '',
};

function BaseModal({ children, onClose }) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <AnimatePresence>
      <motion.div
        className="modal-backdrop"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="modal-card"
          onClick={(event) => event.stopPropagation()}
          initial={{ opacity: 0, y: 20, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.96 }}
          transition={{ duration: 0.22 }}
        >
          {children}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function BarcodeModal({ book, onClose }) {
  const svgRef = useRef(null);

  useEffect(() => {
    if (!book || !svgRef.current) return;

    try {
      JsBarcode(svgRef.current, book.barcode_value, {
        format: book.barcode_format === 'EAN13' ? 'EAN13' : 'CODE128',
        displayValue: true,
        fontSize: 18,
        height: 72,
        margin: 10,
      });
    } catch (error) {
      console.error('Barcode render failed:', error);
    }
  }, [book]);

  if (!book) return null;

  return (
    <BaseModal onClose={onClose}>
      <div className="modal-header">
        <div>
          <div className="modal-eyebrow">馆藏识别码</div>
          <h3>{book.title}</h3>
        </div>
        <button className="ghost-button" onClick={onClose} aria-label="关闭弹窗">
          ✕
        </button>
      </div>

      <div className="barcode-box">
        <svg ref={svgRef} />
      </div>

      <div className="barcode-meta">
        <div>
          <span>条码值</span>
          <strong>{book.barcode_value}</strong>
        </div>
        <div>
          <span>编码格式</span>
          <strong>{book.barcode_format}</strong>
        </div>
      </div>

      <p className="modal-note">请联系图书室值班人员以获得更多信息</p>
    </BaseModal>
  );
}

function DescriptionModal({ book, onClose }) {
  if (!book) return null;

  return (
    <BaseModal onClose={onClose}>
      <div className="modal-header">
        <div>
          <div className="modal-eyebrow">书籍简介</div>
          <h3>{book.title}</h3>
        </div>
        <button className="ghost-button" onClick={onClose} aria-label="关闭弹窗">
          ✕
        </button>
      </div>

      <div className="description-modal-content">
        <div className="detail-row">
          <span>作者</span>
          <strong>{book.author || '未填写'}</strong>
        </div>
        <div className="detail-row">
          <span>出版社</span>
          <strong>{book.publisher || '未填写'}</strong>
        </div>
        <div className="detail-row">
          <span>索书号</span>
          <strong>{book.call_number || '未填写'}</strong>
        </div>
        <div className="detail-row details-description">
          <span>简介</span>
          <p>{book.description || '暂无简介'}</p>
        </div>
      </div>
    </BaseModal>
  );
}

function BookCard({ book, index, onInterested, onShowDetails }) {
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <motion.article
      className="book-card"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.36 }}
    >
      <div className="cover-shell">
        {!imageFailed ? (
          <img
            src={book.image_url}
            alt={`${book.title} 封面`}
            className="cover-image"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className="cover-fallback">
            <span>暂无封面</span>
          </div>
        )}
      </div>

      <div className="book-content">
        <div className="book-top">
          <span className="meta-tag">Call Number</span>
          <strong className="call-number">{book.call_number || '未填写'}</strong>
        </div>

        <h3 className="book-title">{book.title}</h3>
        <p className="book-reason">{book.reason}</p>

        <div className="book-actions">
          <button className="primary-button" onClick={() => onInterested(book)}>
            我感兴趣
          </button>
          <button className="secondary-button" onClick={() => onShowDetails(book)}>
            查看简介
          </button>
        </div>
      </div>
    </motion.article>
  );
}

function SearchBar({
  query,
  setQuery,
  onSubmit,
  isLoading,
  isListening,
  onToggleVoice,
  voiceSupported,
  voiceError,
  cooldownRemaining,
}) {
  const blocked = isLoading || cooldownRemaining > 0;
  const canSubmit = !blocked && query.trim();

  return (
    <div className="search-dock">
      <div className="search-shell">
        <form className="search-form" onSubmit={onSubmit}>
          <button
            type="button"
            className={`voice-button ${isListening ? 'listening' : ''}`}
            onClick={onToggleVoice}
            title={voiceSupported ? '语音输入' : '当前浏览器不支持语音输入'}
            disabled={!voiceSupported || blocked}
          >
            {isListening ? '◉' : '🎤'}
          </button>

          <input
            className="search-input"
            placeholder="例如：想找适合初信者阅读的婚姻辅导书籍"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            disabled={isLoading}
          />

          <button className="submit-button" type="submit" disabled={!canSubmit}>
            {isLoading ? '推荐中...' : cooldownRemaining > 0 ? `${cooldownRemaining}s` : '开始推荐'}
          </button>
        </form>

        <div className="search-hints">
          <span>
            {cooldownRemaining > 0
              ? `请等待 ${cooldownRemaining} 秒后再提问`
              : isListening
                ? '正在识别语音，请继续说话…'
                : '可以输入主题、年龄层、服事方向、作者偏好等需求'}
          </span>
          {voiceError ? <span className="error-inline">{voiceError}</span> : null}
        </div>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <motion.div
      className="loading-panel"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="loading-spinner" />
      <h3>正在整理馆藏推荐</h3>
      <p>系统正在阅读数据库并生成适合的书单，请稍候。</p>
    </motion.div>
  );
}

function EmptyState({ reason }) {
  return (
    <motion.div
      className="empty-state"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <h3>这次没有找到合适的书</h3>
      <p>{reason || '馆藏中暂时没有找到符合当前需求的书籍。'}</p>
    </motion.div>
  );
}

export default function App() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(initialResult);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedBook, setSelectedBook] = useState(null);
  const [detailBook, setDetailBook] = useState(null);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const recognitionRef = useRef(null);
  const manualStopRef = useRef(false);

  const hasResults = useMemo(
    () => result.recommendations && result.recommendations.length > 0,
    [result],
  );

  useEffect(() => {
    if (cooldownRemaining <= 0) return undefined;

    const timer = window.setInterval(() => {
      setCooldownRemaining((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [cooldownRemaining]);

  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition || null;

    if (!SpeechRecognition) {
      setVoiceSupported(false);
      return undefined;
    }

    setVoiceSupported(true);
    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setVoiceError('');
      setIsListening(true);
    };

    recognition.onresult = (event) => {
      let transcript = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        transcript += event.results[index][0].transcript;
      }
      setQuery(transcript.trim());
    };

    recognition.onerror = (event) => {
      if (event.error === 'not-allowed') {
        setVoiceError('请允许浏览器使用麦克风。');
      } else if (event.error === 'no-speech') {
        setVoiceError('没有识别到语音，请再试一次。');
      } else {
        setVoiceError(`语音输入失败：${event.error}`);
      }
      setIsListening(false);
    };

    recognition.onend = () => {
      if (!manualStopRef.current) {
        setIsListening(false);
      }
      manualStopRef.current = false;
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.stop();
    };
  }, []);

  const handleToggleVoice = () => {
    if (cooldownRemaining > 0 || isLoading) return;

    const recognition = recognitionRef.current;
    if (!recognition) return;

    if (isListening) {
      manualStopRef.current = true;
      recognition.stop();
      setIsListening(false);
      return;
    }

    try {
      setVoiceError('');
      manualStopRef.current = false;
      recognition.start();
    } catch (error) {
      setVoiceError('语音识别暂时无法启动，请稍后重试。');
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!query.trim() || cooldownRemaining > 0) return;

    setIsLoading(true);
    setSelectedBook(null);
    setDetailBook(null);
    setResult(initialResult);
    setVoiceError('');

    try {
      const response = await fetch('/api/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim() }),
      });

      const rawText = await response.text();
      let data = {};

      try {
        data = JSON.parse(rawText);
      } catch {
        throw new Error(`后端返回的不是 JSON：${rawText.slice(0, 200)}`);
      }

      if (!response.ok) {
        if (response.status === 429 && data.retry_after) {
          setCooldownRemaining(Number(data.retry_after) || COOLDOWN_SECONDS);
        }
        throw new Error(data.error || '推荐失败，请稍后再试。');
      }

      setResult({
        found_count: data.found_count || 0,
        recommendations: data.recommendations || [],
        no_result_reason: data.no_result_reason || '',
      });

      setCooldownRemaining(COOLDOWN_SECONDS);
    } catch (error) {
      setResult({
        found_count: 0,
        recommendations: [],
        no_result_reason: error.message || '推荐失败，请稍后再试。',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="page-shell">
      <div className="page-glow glow-left" />
      <div className="page-glow glow-right" />

      <main className="app-shell">
        <section className="hero">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.42 }}
          >
            <span className="hero-badge">Church Library AI</span>
            <h1>教会图书智能推荐</h1>
            <p>
              告诉系统你想找什么主题、服事对象或阅读方向，它会只从现有馆藏中推荐合适的书籍。
            </p>
          </motion.div>
        </section>

        <section className="results-shell">
          <AnimatePresence mode="wait">
            {isLoading ? (
              <LoadingState key="loading" />
            ) : hasResults ? (
              <motion.div
                key="results"
                className="results-group"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div className="results-header">
                  <div>
                    <span className="results-label">推荐结果</span>
                    <h2>共找到 {result.found_count} 本书</h2>
                  </div>
                  <p>点击“我感兴趣”可生成条形码，方便图书室值班人员扫描。</p>
                </div>

                <div className="books-grid">
                  {result.recommendations.map((book, index) => (
                    <BookCard
                      key={`${book.isbn}-${index}`}
                      book={book}
                      index={index}
                      onInterested={setSelectedBook}
                      onShowDetails={setDetailBook}
                    />
                  ))}
                </div>
              </motion.div>
            ) : result.no_result_reason ? (
              <EmptyState key="empty" reason={result.no_result_reason} />
            ) : (
              <motion.div
                key="idle"
                className="intro-panel"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                <h3>开始一次新的推荐</h3>
                <p>
                  你可以直接输入类似“适合小组带领者的陪谈书籍”“关于婚姻经营的入门读物”
                  或“适合青少年查经辅导的资源”。
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        <SearchBar
          query={query}
          setQuery={setQuery}
          onSubmit={handleSubmit}
          isLoading={isLoading}
          isListening={isListening}
          onToggleVoice={handleToggleVoice}
          voiceSupported={voiceSupported}
          voiceError={voiceError}
          cooldownRemaining={cooldownRemaining}
        />
      </main>

      <BarcodeModal book={selectedBook} onClose={() => setSelectedBook(null)} />
      <DescriptionModal book={detailBook} onClose={() => setDetailBook(null)} />
    </div>
  );
}