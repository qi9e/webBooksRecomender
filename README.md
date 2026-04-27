\
# 图书智能推荐（Flask + React）

这是一个本地运行的书本推荐网页项目，后端使用 Flask，前端使用 React。系统会读取 `database.csv`，把整份馆藏交给 Gemini API，再只从数据库中返回不超过 10 本推荐书籍。

## 功能概览

- 读取本地 `database.csv`
- 把整份数据库和用户需求发送给 Gemini
- 只返回数据库中存在的书
- 最多推荐 10 本
- 单轮聊天风格界面，不保留历史消息
- 浏览器原生语音输入，识别文字会实时写入输入框
- 推荐等待动画
- 书籍卡片入场动画
- 两列书籍展示
- 支持封面图、Call Number、作者、出版社、简介
- 点击“我感兴趣”后弹出条形码
- `ISBN` 字段兼容两种情况：
  - 13 位数字时按 `EAN13` 渲染
  - 其他情况按 `CODE128` 渲染

## 目录结构

```text
church-library-recommender/
├─ backend/
│  ├─ app.py
│  ├─ requirements.txt
│  └─ .env.example
├─ frontend/
│  ├─ index.html
│  ├─ package.json
│  ├─ vite.config.js
│  └─ src/
│     ├─ main.jsx
│     ├─ App.jsx
│     └─ App.css
├─ image/
└─ README.md
```

## CSV 格式

文件名默认是项目根目录下的 `database.csv`，列名需要是：

- `ISBN`
- `Title`
- `Author`
- `Publisher`
- `Description`
- `ImagePath`
- `CallNumber`

### 图片规则

- 优先使用 `ImagePath`
- 如果 `ImagePath` 为空，就自动寻找 `image/{ISBN}.jpg`

示例：

```csv
ISBN,Title,Author,Publisher,Description,ImagePath,CallNumber
9781234567890,婚姻辅导入门,张三,恩典出版社,适合初信者阅读的婚姻辅导书,image/9781234567890.jpg,A12.3
54321,团契带领手册,李四,牧养之家,针对小组带领与陪伴的实用馆藏,,B03.8
```

## 后端启动

### 1. 创建虚拟环境并安装依赖

```bash
cd backend
python -m venv .venv
```

Windows:

```bash
.venv\Scripts\activate
pip install -r requirements.txt
```

macOS / Linux:

```bash
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. 配置环境变量

把 `.env.example` 复制为 `.env`，然后填写 Gemini API Key 和模型名：

```bash
cp .env.example .env
```

`.env` 示例：

```env
GEMINI_API_KEY=你的_Gemini_API_Key
GEMINI_MODEL=gemini-3-flash-preview
BOOKS_CSV_PATH=database.csv
BOOKS_IMAGE_DIR=image
PORT=5000
```

### 3. 准备数据

把这两个资源放到项目根目录：

- `database.csv`
- `image/`

也就是和 `backend/`、`frontend/` 同级。

### 4. 启动 Flask

```bash
python app.py
```

默认地址：

```text
http://localhost:5000
```

## 前端启动

需要先安装 Node.js。

```bash
cd frontend
npm install
npm run dev
```

默认地址：

```text
http://localhost:5173
```

Vite 已经把 `/api` 请求代理到 Flask，因此开发时不需要手动改接口地址。

## API 接口

### POST `/api/recommend`

请求体：

```json
{
  "query": "想找适合初信者阅读的婚姻辅导书"
}
```

成功返回：

```json
{
  "found_count": 2,
  "recommendations": [
    {
      "isbn": "9781234567890",
      "title": "婚姻辅导入门",
      "author": "张三",
      "publisher": "恩典出版社",
      "description": "适合初信者阅读的婚姻辅导书",
      "call_number": "A12.3",
      "image_url": "/api/images/9781234567890.jpg",
      "reason": "这本书对初信者比较友好，也聚焦婚姻建立。",
      "barcode_value": "9781234567890",
      "barcode_format": "EAN13"
    }
  ],
  "no_result_reason": ""
}
```

没找到时：

```json
{
  "found_count": 0,
  "recommendations": [],
  "no_result_reason": "馆藏中暂时没有找到符合当前需求的书籍。"
}
```

### GET `/api/health`

查看当前后端状态和加载的图书数量。

### POST `/api/reload`

当你替换了 `database.csv` 之后，可以调用这个接口重新加载书库。


## 常见问题

### 1. 提示找不到 CSV

确认 `database.csv` 放在项目根目录，或者在 `.env` 里修改 `BOOKS_CSV_PATH`。

### 2. 图片加载失败

检查：

- 图片是否放在 `image/`
- `ImagePath` 是否为相对路径
- 文件名是否和 `ISBN.jpg` 一致

### 3. Gemini API 调用失败

检查：

- `GEMINI_API_KEY` 是否正确
- `GEMINI_MODEL` 是否可用
- 网络是否能访问 Gemini API

---

# webBooksRecomender
