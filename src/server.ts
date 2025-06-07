import express, { Request, Response } from "express";

const app = express();
const PORT: number = parseInt(process.env.PORT || "80", 10);

interface Health {
  status: string;
  timestamp: string;
}

app.get("/", (req: Request, res: Response): void => {
  const now = new Date().toLocaleString("ja-JP");

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Snakashima App</title>
      <style>
        body { 
          font-family: Arial, sans-serif; 
          text-align: center; 
          padding: 50px;
          background: #f0f0f0;
        }
        .container { 
          background: white; 
          padding: 30px; 
          border-radius: 10px; 
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          max-width: 500px;
          margin: 0 auto;
        }
        .success { color: green; font-weight: bold; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🎉 Hello Snakashima!</h1>
        <p class="success">✅ TypeScript アプリ動作中</p>
        <p class="success">✅ AWS ECS で実行中</p>
        <p><strong>時刻:</strong> ${now}</p>
        <p><strong>Node.js:</strong> ${process.version}</p>
        <p>🚀 Simple TypeScript App</p>
      </div>
    </body>
    </html>
  `);
});

// ヘルスチェック（ALB用）
app.get("/health", (req: Request, res: Response): void => {
  const health: Health = {
    status: "OK",
    timestamp: new Date().toISOString(),
  };

  res.json(health);
});

// サーバー起動
app.listen(PORT, (): void => {
  console.log(`🚀 App running on port ${PORT}`);
  console.log(`📅 Started: ${new Date().toLocaleString("ja-JP")}`);
});
