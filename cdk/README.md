# Snakashima Infrastructure Training

このリポジトリは、AWS CDK(TypeScript)を用いて、学習用のシンプルな Web アプリケーション基盤を自動構築するためのものです。

## 構成される AWS リソース

- **VPC (2AZ, Public/Private Subnet)**
- **Application Load Balancer (ALB)**
- **ECS Fargate (nginx コンテナ)**
- **RDS (PostgreSQL 17, SecretsManager 連携)**
- **ElastiCache (Redis)**
- **CloudWatch Logs**
- **セキュリティグループ/サブネットグループ**

## アーキテクチャ概要

```
[Internet]
    |
[ALB] --- (Public Subnet)
    |
[ECS Fargate: nginx] --- (Public Subnet, パブリックIP付与)
    |         |
    |         +---> [RDS: PostgreSQL] (Private Subnet)
    |         +---> [ElastiCache: Redis] (Private Subnet)
```

- ECS タスクは nginx イメージを起動し、ALB 経由で外部公開されます。
- DB/Redis の接続情報は環境変数で ECS タスクに渡されます。
- コスト削減のため NAT Gateway は使いません。

## デプロイ手順

### 1. 前提条件

- AWS アカウント
- Node.js (v18 以上推奨)
- AWS CLI (認証済み)
- AWS CDK v2 (`npm install -g aws-cdk`)

### 2. 依存パッケージのインストール

```
npm install
```

### 3. デプロイ

```
cdk deploy
```

### 4. 削除（リソース破棄）

```
cdk destroy
```

## 主な出力値（Outputs）

- **LoadBalancerDNS**: ALB の DNS 名（Web アクセス用 URL）
- **DatabaseEndpoint**: RDS PostgreSQL のエンドポイント
- **RedisEndpoint**: ElastiCache Redis のエンドポイント
- **AccessURL**: アプリケーションへのアクセス URL

## 注意事項

- 本スタックは学習・検証用です。本番利用には十分なセキュリティ設計・コスト検討が必要です。
- RDS/Redis は Private Subnet に配置され、ECS タスクからのみアクセス可能です。
- ECS タスクはパブリック IP を持ちます。
- データベースの認証情報は SecretsManager に自動生成されます。

## 参考

- [AWS CDK 公式ドキュメント](https://docs.aws.amazon.com/cdk/latest/guide/home.html)
- [ECS on Fargate](https://docs.aws.amazon.com/ja_jp/AmazonECS/latest/developerguide/AWS_Fargate.html)
