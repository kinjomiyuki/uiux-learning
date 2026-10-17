# 設計思考ラボ — UI/UX学習アプリ

UI/UX の考え方をブラウザで学べる学習アプリです。AI チャット機能は Netlify Functions(`netlify/functions/chat.mjs`)経由で Claude API を呼び出します。

**Live:** https://uiux-learning.netlify.app/

## Tech

HTML / CSS / JavaScript、Netlify Functions、Claude API

## Setup

AI チャットを動かすには、Netlify の環境変数に `ANTHROPIC_API_KEY` を設定します。キーはコードに含めていません。

## Development with AI

Claude Code を使って設計・実装しています。
