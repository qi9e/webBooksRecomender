import csv
import json
import logging
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

load_dotenv()

logging.basicConfig(level=logging.INFO)
LOGGER = logging.getLogger("church-library-recommender")

BASE_DIR = Path(__file__).resolve().parent.parent
CSV_PATH = BASE_DIR / os.getenv("BOOKS_CSV_PATH", "database.csv")
IMAGE_DIR = BASE_DIR / os.getenv("BOOKS_IMAGE_DIR", "image")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3-flash-preview").strip()
PORT = int(os.getenv("PORT", "5000"))
COOLDOWN_SECONDS = int(os.getenv("RECOMMEND_COOLDOWN_SECONDS", "30"))
LAST_REQUEST_AT = 0.0

SYSTEM_PROMPT = """
你是一个基督教会图书室管理员。你的唯一任务是根据馆藏数据库推荐书籍。
你必须遵守以下规则：
1. 只能推荐数据库中真实存在的书籍。
2. 最多推荐 10 本书。
3. 不要回答信仰问答、神学辩论、圣经解释、人生建议或一般知识问答。
4. 如果用户的问题本质上不是在找书，也不要直接回答问题，只根据数据库推荐可能相关的书；如果没有相关书，请明确说明没找到。
5. 返回格式必须是 JSON，且只能输出 JSON，不要输出 Markdown，不要输出解释文字。

返回格式：
{
  "found_count": 整数,
  "recommendations": [
    {
      "isbn": "字符串",
      "title": "字符串",
      "reason": "字符串"
    }
  ],
  "no_result_reason": "字符串"
}
""".strip()


@dataclass
class Book:
    isbn: str
    title: str
    author: str
    publisher: str
    description: str
    image_path: str
    call_number: str

    @property
    def barcode_value(self) -> str:
        return self.isbn.strip()

    @property
    def barcode_format(self) -> str:
        digits_only = re.sub(r"\D", "", self.barcode_value)
        if len(digits_only) == 13 and digits_only == self.barcode_value:
            return "EAN13"
        return "CODE128"

    def resolved_image_path(self) -> str:
        raw = (self.image_path or "").strip()
        if raw:
            normalized = raw.replace("\\", "/").lstrip("./")
            if normalized.startswith("image/"):
                normalized = normalized[len("image/") :]
            return normalized
        return f"{self.isbn}.jpg"

    def to_api_dict(self, reason: str) -> Dict[str, str]:
        return {
            "isbn": self.isbn,
            "title": self.title,
            "author": self.author,
            "publisher": self.publisher,
            "description": self.description,
            "call_number": self.call_number,
            "image_url": f"/api/images/{self.resolved_image_path()}",
            "reason": reason,
            "barcode_value": self.barcode_value,
            "barcode_format": self.barcode_format,
        }


class BookRepository:
    def __init__(self, csv_path: Path):
        self.csv_path = csv_path
        self.books: List[Book] = []
        self.books_by_isbn: Dict[str, Book] = {}
        self.books_by_title: Dict[str, Book] = {}
        self.load()

    def load(self) -> None:
        if not self.csv_path.exists():
            LOGGER.warning("CSV file not found at %s. The API will start, but recommendations will fail until the file exists.", self.csv_path)
            self.books = []
            self.books_by_isbn = {}
            self.books_by_title = {}
            return

        books: List[Book] = []
        with self.csv_path.open("r", encoding="utf-8-sig", newline="") as csv_file:
            reader = csv.DictReader(csv_file)
            for row in reader:
                book = Book(
                    isbn=(row.get("ISBN") or "").strip(),
                    title=(row.get("Title") or "").strip(),
                    author=(row.get("Author") or "").strip(),
                    publisher=(row.get("Publisher") or "").strip(),
                    description=(row.get("Description") or "").strip(),
                    image_path=(row.get("ImagePath") or "").strip(),
                    call_number=(row.get("CallNumber") or "").strip(),
                )
                if not book.isbn and not book.title:
                    continue
                books.append(book)

        self.books = books
        self.books_by_isbn = {book.isbn: book for book in books if book.isbn}
        self.books_by_title = {book.title.casefold(): book for book in books if book.title}
        LOGGER.info("Loaded %s books from %s", len(self.books), self.csv_path)

    def build_prompt_database_text(self) -> str:
        lines = []
        for index, book in enumerate(self.books, start=1):
            line = (
                f"{index}. "
                f"ISBN={book.isbn} | "
                f"Title={book.title} | "
                f"Author={book.author} | "
                f"Publisher={book.publisher} | "
                f"Description={book.description} | "
                f"CallNumber={book.call_number}"
            )
            lines.append(line)
        return "\n".join(lines)

    def find_book(self, isbn: Optional[str], title: Optional[str]) -> Optional[Book]:
        if isbn:
            direct = self.books_by_isbn.get(isbn.strip())
            if direct:
                return direct

        if title:
            direct = self.books_by_title.get(title.strip().casefold())
            if direct:
                return direct

        return None


class GeminiClient:
    def __init__(self, api_key: str, model_name: str):
        self.api_key = api_key
        self.model_name = model_name
        self.endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model_name}:generateContent"

    def generate_recommendation_json(self, database_text: str, user_query: str) -> Dict:
        if not self.api_key:
            raise RuntimeError("Missing GEMINI_API_KEY. Please set it in backend/.env.")

        prompt_content = f"""
请根据以下书籍数据库回答用户的需求。如果数据库里没有相关书籍，请直接说没找到。

=== 📚 书籍数据库 ===
{database_text}
===================

👤 用户需求: {user_query}
""".strip()

        payload = {
            "systemInstruction": {
                "parts": [{"text": SYSTEM_PROMPT}]
            },
            "contents": [
                {
                    "parts": [{"text": prompt_content}]
                }
            ],
            "generationConfig": {
                "temperature": 0.3,
                "responseMimeType": "application/json"
            }
        }

        response = requests.post(
            self.endpoint,
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": self.api_key,
            },
            json=payload,
            timeout=90,
        )
        response.raise_for_status()
        data = response.json()

        try:
            text = data["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError, TypeError) as exc:
            raise RuntimeError(f"Gemini response format is unexpected: {data}") from exc

        return self._parse_json_response(text)

    @staticmethod
    def _parse_json_response(raw_text: str) -> Dict:
        cleaned = raw_text.strip()
        cleaned = re.sub(r"^```json\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"^```\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)

        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
            if match:
                return json.loads(match.group(0))
            raise


def normalize_ai_response(raw: Dict, repository: BookRepository) -> Dict:
    recommendations = raw.get("recommendations") or []
    normalized_recommendations = []

    for item in recommendations[:10]:
        if not isinstance(item, dict):
            continue

        isbn = str(item.get("isbn") or "").strip()
        title = str(item.get("title") or "").strip()
        reason = str(item.get("reason") or "").strip()
        book = repository.find_book(isbn=isbn, title=title)

        if not book:
            continue

        if not reason:
            reason = "这本书与您的需求较相关。"

        normalized_recommendations.append(book.to_api_dict(reason))

    found_count = len(normalized_recommendations)
    no_result_reason = str(raw.get("no_result_reason") or "").strip()

    if found_count > 0:
        no_result_reason = ""

    if found_count == 0 and not no_result_reason:
        no_result_reason = "馆藏中暂时没有找到符合当前需求的书籍。"

    return {
        "found_count": found_count,
        "recommendations": normalized_recommendations,
        "no_result_reason": no_result_reason,
    }


repository = BookRepository(CSV_PATH)
gemini_client = GeminiClient(GEMINI_API_KEY, GEMINI_MODEL)

app = Flask(__name__)
CORS(app)


@app.route("/api/health", methods=["GET"])
def health_check():
    return jsonify(
        {
            "ok": True,
            "book_count": len(repository.books),
            "csv_path": str(repository.csv_path),
            "image_dir": str(IMAGE_DIR),
            "model": GEMINI_MODEL,
        }
    )


@app.route("/api/reload", methods=["POST"])
def reload_books():
    repository.load()
    return jsonify({"ok": True, "book_count": len(repository.books)})


@app.route("/api/recommend", methods=["POST"])
def recommend_books():
    global LAST_REQUEST_AT

    payload = request.get_json(silent=True) or {}
    user_query = str(payload.get("query") or "").strip()

    if not user_query:
        return jsonify({"error": "请输入想找的书籍需求。"}), 400

    if not repository.books:
        return jsonify({"error": f"数据库为空或未找到文件：{repository.csv_path}"}), 500

    now = time.time()
    elapsed = now - LAST_REQUEST_AT
    if elapsed < COOLDOWN_SECONDS:
        retry_after = int(COOLDOWN_SECONDS - elapsed)
        if retry_after <= 0:
            retry_after = 1
        return jsonify(
            {
                "error": f"每次提问后需要等待 {COOLDOWN_SECONDS} 秒，请稍后再试。",
                "retry_after": retry_after,
            }
        ), 429

    try:
        raw_result = gemini_client.generate_recommendation_json(
            database_text=repository.build_prompt_database_text(),
            user_query=user_query,
        )
        normalized = normalize_ai_response(raw_result, repository)
        LAST_REQUEST_AT = time.time()
        return jsonify(normalized)
    except requests.HTTPError as exc:
        response_text = exc.response.text if exc.response is not None else ""
        LOGGER.exception("Gemini API HTTP error: %s", response_text)
        return jsonify(
            {
                "error": "Gemini API 请求失败，请检查模型名、API Key 或请求内容。",
                "details": response_text,
            }
        ), 502
    except Exception as exc:
        LOGGER.exception("Recommendation failed")
        return jsonify({"error": "推荐失败，请稍后重试。", "details": str(exc)}), 500


@app.route("/api/images/<path:filename>", methods=["GET"])
def serve_image(filename: str):
    safe_path = filename.replace("\\", "/").lstrip("./")
    return send_from_directory(IMAGE_DIR, safe_path)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT, debug=True)
