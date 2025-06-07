# マルチステージビルド: ビルドステージ
FROM node:18-alpine AS builder

# 作業ディレクトリを設定
WORKDIR /app

# package.jsonとpackage-lock.jsonをコピー
COPY package*.json ./

# 依存関係をインストール（devDependencies含む）
RUN npm ci

# TypeScriptソースコードをコピー
COPY . .

# TypeScriptをビルド
RUN npm run build

# マルチステージビルド: 実行ステージ
FROM node:18-alpine AS runtime

# セキュリティのため非rootユーザーを作成
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# 作業ディレクトリを設定
WORKDIR /app

# package.jsonをコピー
COPY package*.json ./

# 本番依存関係のみインストール
RUN npm ci --only=production && npm cache clean --force

# ビルドステージから成果物をコピー
COPY --from=builder /app/dist ./dist

# 非rootユーザーに切り替え
USER nodejs

# ポート80を公開
EXPOSE 80

# ヘルスチェック
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:80/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# アプリケーションを起動
CMD ["npm", "start"]