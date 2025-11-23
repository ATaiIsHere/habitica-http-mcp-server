#!/usr/bin/env node

import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { setLanguage, t } from './i18n.js';

// Express 應用初始化
const app = express();
const port = process.env.PORT || 7860;

// 中介軟體
app.use(cors());
app.use(express.json());

// Habitica API 基礎設定
const HABITICA_API_BASE = 'https://habitica.com/api/v3';

// 檢測語言
setLanguage(process.env.MCP_LANG || process.env.LANG || 'en');

// 建立 Habitica API 用戶端函式
function createHabiticaClient(userId, apiToken) {
  return axios.create({
    baseURL: HABITICA_API_BASE,
    headers: {
      'x-api-user': userId,
      'x-api-key': apiToken,
      'Content-Type': 'application/json',
    },
  });
}

// 完整的工具定義
const tools = [
  {
    name: 'get_user_profile',
    description: t('Get user profile', '获取用户档案信息'),
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_tasks',
    description: t('Get tasks list', '获取任务列表'),
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['habits', 'dailys', 'todos', 'rewards'],
          description: t('Task type', '任务类型'),
        },
      },
    },
  },
  {
    name: 'create_task',
    description: t('Create new task', '创建新任务'),
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['habit', 'daily', 'todo', 'reward'],
          description: t('Task type', '任务类型'),
        },
        text: {
          type: 'string',
          description: t('Task title', '任务标题'),
        },
        notes: {
          type: 'string',
          description: t('Task notes', '任务备注'),
        },
        difficulty: {
          type: 'number',
          enum: [0.1, 1, 1.5, 2],
          description: t('Difficulty', '难度'),
        },
      },
      required: ['type', 'text'],
    },
  },
  {
    name: 'score_task',
    description: t('Score task / habit', '完成任务或记录习惯'),
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: t('Task ID', '任务ID') },
        direction: {
          type: 'string',
          enum: ['up', 'down'],
          description: t('Direction', '方向'),
        },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'update_task',
    description: t('Update task', '更新任务'),
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: t('Task ID', '任务ID') },
        text: { type: 'string', description: t('Task title', '任务标题') },
        notes: { type: 'string', description: t('Task notes', '任务备注') },
        completed: { type: 'boolean', description: t('Completed', '完成状态') },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'delete_task',
    description: t('Delete task', '删除任务'),
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: t('Task ID', '任务ID') },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'get_stats',
    description: t('Get user stats', '获取用户统计信息'),
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_inventory',
    description: t('Get inventory', '获取物品清单'),
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_pets',
    description: t('Get pets', '获取宠物列表'),
    inputSchema: { type: 'object', properties: {} },
  },
];

// 工具實作函式
const toolImplementations = {
  async get_user_profile(habiticaClient) {
    const response = await habiticaClient.get('/user');
    return response.data.data;
  },

  async get_tasks(habiticaClient, args) {
    const endpoint = args?.type ? `/tasks/user?type=${args.type}` : '/tasks/user';
    const response = await habiticaClient.get(endpoint);
    return response.data.data;
  },

  async create_task(habiticaClient, args) {
    const response = await habiticaClient.post('/tasks/user', args);
    return response.data.data;
  },

  async score_task(habiticaClient, args) {
    const { taskId, direction = 'up' } = args;
    const response = await habiticaClient.post(`/tasks/${taskId}/score/${direction}`);
    return response.data.data;
  },

  async update_task(habiticaClient, args) {
    const { taskId, ...updates } = args;
    const response = await habiticaClient.put(`/tasks/${taskId}`, updates);
    return response.data.data;
  },

  async delete_task(habiticaClient, args) {
    const { taskId } = args;
    await habiticaClient.delete(`/tasks/${taskId}`);
    return { success: true, message: `Task ${taskId} deleted` };
  },

  async get_stats(habiticaClient) {
    const response = await habiticaClient.get('/user');
    return response.data.data.stats;
  },

  async get_inventory(habiticaClient) {
    const response = await habiticaClient.get('/user');
    return response.data.data.items;
  },

  async get_pets(habiticaClient) {
    const response = await habiticaClient.get('/user');
    return response.data.data.items.pets;
  },
};

// 路由定義
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="zh">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Habitica MCP Server</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                min-height: 100vh;
                padding: 20px;
            }
            .container {
                max-width: 1000px;
                margin: 0 auto;
                background: rgba(255, 255, 255, 0.1);
                backdrop-filter: blur(10px);
                border-radius: 20px;
                padding: 30px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
            }
            h1 {
                text-align: center;
                margin-bottom: 30px;
                text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
            }
            .status {
                background: rgba(76, 175, 80, 0.8);
                padding: 15px;
                border-radius: 10px;
                text-align: center;
                font-weight: bold;
                margin-bottom: 30px;
            }
            .section {
                background: rgba(255, 255, 255, 0.1);
                padding: 20px;
                border-radius: 10px;
                margin: 20px 0;
            }
            .endpoint {
                background: rgba(0, 0, 0, 0.2);
                padding: 12px;
                border-radius: 8px;
                margin: 10px 0;
                font-family: 'Monaco', 'Menlo', monospace;
                border-left: 4px solid #4CAF50;
            }
            .tools-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
                gap: 15px;
                margin-top: 20px;
            }
            .tool-card {
                background: rgba(255, 255, 255, 0.1);
                padding: 15px;
                border-radius: 10px;
                border-left: 4px solid #2196F3;
            }
            .tool-name {
                font-weight: bold;
                color: #FFD700;
                margin-bottom: 5px;
            }
            .tool-desc {
                font-size: 0.9em;
                opacity: 0.9;
            }
            code {
                background: rgba(0, 0, 0, 0.3);
                padding: 2px 6px;
                border-radius: 4px;
                font-size: 0.9em;
            }
            .features {
                list-style: none;
            }
            .features li {
                background: rgba(255, 255, 255, 0.1);
                margin: 10px 0;
                padding: 15px;
                border-radius: 8px;
                border-left: 4px solid #FF9800;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🏰 Habitica MCP Server</h1>
            
            <div class="status">
                ✅ 伺服器運行中 | 🚀 Powered by Hugging Face Spaces
            </div>
            
            <div class="section">
                <h2>📚 API 端點</h2>
                <div class="endpoint">GET /tools - 取得可用工具清單</div>
                <div class="endpoint">POST /tools/:toolName - 執行特定工具</div>
                <div class="endpoint">POST /mcp/tools - MCP 標準工具清單</div>
                <div class="endpoint">POST /mcp/call - MCP 標準呼叫介面</div>
                <div class="endpoint">GET /health - 健康檢查</div>
            </div>
            
            <div class="section">
                <h2>🔧 認證方式</h2>
                <p>所有 API 呼叫都需要在請求標頭中包含 Habitica 憑證：</p>
                <div class="endpoint">
                    <code>X-Habitica-User-ID</code>: 您的 Habitica 使用者 ID<br>
                    <code>X-Habitica-API-Token</code>: 您的 Habitica API 權杖
                </div>
            </div>
            
            <div class="section">
                <h2>🛠️ 可用工具</h2>
                <div class="tools-grid">
                    ${tools.map(tool => `
                        <div class="tool-card">
                            <div class="tool-name">${tool.name}</div>
                            <div class="tool-desc">${tool.description}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
            
            <div class="section">
                <h2>🚀 功能特性</h2>
                <ul class="features">
                    <li>📋 <strong>任務管理</strong>：建立、更新、完成和刪除任務</li>
                    <li>🎯 <strong>習慣追蹤</strong>：記錄習慣的正向和負向完成</li>
                    <li>🏆 <strong>獰勵系統</strong>：購買獲勵和商店物品</li>
                    <li>🐲 <strong>寵物系統</strong>：查看和管理您的虛擬寵物</li>
                    <li>📊 <strong>統計資訊</strong>：查看使用者等級、經驗值等資料</li>
                    <li>🎒 <strong>物品管理</strong>：查看背包中的物品和裝備</li>
                </ul>
            </div>
            
            <div class="section">
                <h2>📖 使用範例</h2>
                <div class="endpoint">
                    # 取得使用者檔案<br>
                    curl -X POST ${req.get('host') ? `https://${req.get('host')}` : 'http://localhost:7860'}/tools/get_user_profile \\<br>
                    &nbsp;&nbsp;-H "X-Habitica-User-ID: YOUR_USER_ID" \\<br>
                    &nbsp;&nbsp;-H "X-Habitica-API-Token: YOUR_API_TOKEN"
                </div>
                <div class="endpoint">
                    # 建立新任務<br>
                    curl -X POST ${req.get('host') ? `https://${req.get('host')}` : 'http://localhost:7860'}/tools/create_task \\<br>
                    &nbsp;&nbsp;-H "Content-Type: application/json" \\<br>
                    &nbsp;&nbsp;-H "X-Habitica-User-ID: YOUR_USER_ID" \\<br>
                    &nbsp;&nbsp;-H "X-Habitica-API-Token: YOUR_API_TOKEN" \\<br>
                    &nbsp;&nbsp;-d '{"type": "todo", "text": "完成專案部署"}'
                </div>
            </div>
            
            <div class="section">
                <h2>🔗 相關連結</h2>
                <p>📖 <a href="https://habitica.com/apidoc/" style="color: #FFD700;">Habitica API 文件</a></p>
                <p>🏠 <a href="https://habitica.com" style="color: #FFD700;">Habitica 官網</a></p>
                <p>⚙️ <a href="https://habitica.com/user/settings/api" style="color: #FFD700;">取得 API 憑證</a></p>
            </div>
        </div>
    </body>
    </html>
  `);
});

// 取得工具清單
app.get('/tools', (req, res) => {
  res.json({
    tools: tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }))
  });
});

// MCP 標準介面
app.post('/mcp/tools', (req, res) => {
  res.json({ tools });
});

// MCP 呼叫工具介面
app.post('/mcp/call', async (req, res) => {
  await handleToolCall(req, res);
});

// 執行特定工具
app.post('/tools/:toolName', async (req, res) => {
  const { toolName } = req.params;
  req.body = { name: toolName, arguments: req.body };
  await handleToolCall(req, res);
});

// 統一的工具呼叫處理函式
async function handleToolCall(req, res) {
  const { name, arguments: args } = req.body;
  const userId = req.headers['x-habitica-user-id'];
  const apiToken = req.headers['x-habitica-api-token'];

  if (!userId || !apiToken) {
    return res.status(400).json({
      error: '缺少 Habitica 憑證。請在 X-Habitica-User-ID 和 X-Habitica-API-Token 標頭中提供。'
    });
  }

  const habiticaClient = createHabiticaClient(userId, apiToken);

  try {
    const toolName = name || req.params.toolName;
    const implementation = toolImplementations[toolName];
    
    if (!implementation) {
      return res.status(404).json({ error: `Unknown tool: ${toolName}` });
    }

    const result = await implementation(habiticaClient, args || {});

    res.json({
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }
      ]
    });

  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message || '未知錯誤';
    console.error('API Error:', error.response?.data || error.message);
    res.status(500).json({
      error: `Habitica API 錯誤: ${errorMessage}`
    });
  }
}

// 健康檢查端點
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'habitica-mcp-server',
    version: '0.0.5',
    tools: tools.length
  });
});

// 錯誤處理中介軟體
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  res.status(500).json({
    error: '內部伺服器錯誤',
    message: err.message
  });
});

// 404 處理
app.use((req, res) => {
  res.status(404).json({
    error: '未找到',
    message: 'API 端點不存在。請查看 /tools 以瞭解可用的端點。'
  });
});

// 啟動伺服器
app.listen(port, () => {
  console.log(`🏰 Habitica MCP Server 運行在 http://localhost:${port}`);
  console.log(`📚 API 文件: http://localhost:${port}`);
  console.log(`🔧 工具清單: http://localhost:${port}/tools`);
  console.log(`📚 健康檢查: http://localhost:${port}/health`);
});