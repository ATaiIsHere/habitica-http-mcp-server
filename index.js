#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import { z } from 'zod';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { setLanguage, t } from './i18n.js';

// Habitica API 基础配置
const HABITICA_API_BASE = 'https://habitica.com/api/v3';

// 驗證相關環境變數
const HABITICA_USER_ID = process.env.HABITICA_USER_ID;
const HABITICA_API_TOKEN = process.env.HABITICA_API_TOKEN;
const MCP_API_KEY = process.env.MCP_API_KEY; // MCP 服務器的 API 密鑰
const ALLOWED_IPS = process.env.ALLOWED_IPS ? process.env.ALLOWED_IPS.split(',').map(ip => ip.trim()) : []; // IP 白名單
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX) || 100; // 每小時的請求数量限制
const REQUIRE_AUTHENTICATION = process.env.REQUIRE_AUTHENTICATION !== 'false'; // 是否強制驗證

// Detect language (default EN)
setLanguage(process.env.MCP_LANG || process.env.LANG || 'en');

if (!HABITICA_USER_ID || !HABITICA_API_TOKEN) {
  console.error(t('Error: Please set HABITICA_USER_ID and HABITICA_API_TOKEN environment variables', '错误: 请设置 HABITICA_USER_ID 和 HABITICA_API_TOKEN 环境变量'));
  process.exit(1);
}

// 创建 Habitica API 客户端
const habiticaClient = axios.create({
  baseURL: HABITICA_API_BASE,
  headers: {
    'x-api-user': HABITICA_USER_ID,
    'x-api-key': HABITICA_API_TOKEN,
    'Content-Type': 'application/json',
  },
});

// 速率限制儲存（簡單內存實現）
const rateLimitStore = new Map();

// 清理過期的速率限制記錄
setInterval(() => {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  for (const [key, data] of rateLimitStore.entries()) {
    if (now - data.resetTime > oneHour) {
      rateLimitStore.delete(key);
    }
  }
}, 15 * 60 * 1000); // 每 15 分鐘清理一次

// 請求日誌記錄
function logRequest(ip, userAgent, endpoint, authenticated = false) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] IP: ${ip} | UA: ${userAgent?.substring(0, 50) || 'Unknown'} | ${endpoint} | Auth: ${authenticated}`);
}

// IP 白名單檢查
function isIPAllowed(ip) {
  if (ALLOWED_IPS.length === 0) return true; // 沒有設置白名單則允許所有 IP
  
  // 支援 CIDR 格式和單一 IP
  return ALLOWED_IPS.some(allowedIP => {
    if (allowedIP.includes('/')) {
      // CIDR 格式檢查 (簡化實現)
      const [network, prefixLength] = allowedIP.split('/');
      return ip.startsWith(network.split('.').slice(0, Math.ceil(parseInt(prefixLength) / 8)).join('.'));
    }
    return ip === allowedIP || allowedIP === '*';
  });
}

// 速率限制檢查
function checkRateLimit(ip) {
  const key = `rate_limit_${ip}`;
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  
  let rateLimitData = rateLimitStore.get(key);
  
  if (!rateLimitData || (now - rateLimitData.resetTime) > oneHour) {
    rateLimitData = {
      count: 1,
      resetTime: now
    };
  } else {
    rateLimitData.count++;
  }
  
  rateLimitStore.set(key, rateLimitData);
  
  return {
    allowed: rateLimitData.count <= RATE_LIMIT_MAX,
    count: rateLimitData.count,
    resetTime: rateLimitData.resetTime + oneHour
  };
}

// 驗證中介軟體
function createAuthMiddleware() {
  return (req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || 
                     (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
                     req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
    const userAgent = req.headers['user-agent'];
    const apiKey = req.headers['x-mcp-api-key'] || req.query.apiKey;
    const endpoint = req.path;
    
    // 記錄請求
    logRequest(clientIP, userAgent, endpoint, !!apiKey);
    
    // 如果不強制驗證且是文檔頁面，則允許通過
    if (!REQUIRE_AUTHENTICATION && (endpoint === '/' || endpoint === '/health')) {
      return next();
    }
    
    // IP 白名單檢查
    if (!isIPAllowed(clientIP)) {
      return res.status(403).json({
        error: 'IP 不在允許範圍內',
        message: '您的 IP 位址不在白名單中。',
        ip: clientIP
      });
    }
    
    // 速率限制檢查
    const rateLimit = checkRateLimit(clientIP);
    if (!rateLimit.allowed) {
      const resetDate = new Date(rateLimit.resetTime).toISOString();
      return res.status(429).json({
        error: '請求速率過快',
        message: `您已超出每小時 ${RATE_LIMIT_MAX} 次請求的限制。`,
        resetTime: resetDate,
        currentCount: rateLimit.count
      });
    }
    
    // API 密鑰檢查
    if (MCP_API_KEY && apiKey !== MCP_API_KEY) {
      return res.status(401).json({
        error: '未授權',
        message: '缺少或錯誤的 API 密鑰。請在 X-MCP-API-Key 標頭中提供正確的 API 密鑰。',
        hint: '設置環境變數 MCP_API_KEY 並在請求標頭中加入 X-MCP-API-Key'
      });
    }
    
    // 設置速率限制標頭
    res.set({
      'X-RateLimit-Limit': RATE_LIMIT_MAX,
      'X-RateLimit-Remaining': Math.max(0, RATE_LIMIT_MAX - rateLimit.count),
      'X-RateLimit-Reset': new Date(rateLimit.resetTime).toISOString()
    });
    
    next();
  };
}

// 初始化 MCP 服務器
const mcpServer = new McpServer({
  name: 'habitica-mcp-server',
  version: '0.0.5',
});

// 取得底層 Server 實例用於高級操作
const server = mcpServer.server;

// 工具處理函數的統一入口
async function handleToolCall(name, args) {
  try {
    switch (name) {
      case 'get_user_profile':
        return await getUserProfile();
      
      case 'get_tasks':
        return await getTasks(args.type);
      
      case 'create_task':
        return await createTask(args);
      
      case 'score_task':
        return await scoreTask(args.taskId, args.direction);
      
      case 'update_task':
        return await updateTask(args.taskId, args);
      
      case 'delete_task':
        return await deleteTask(args.taskId);
      
      case 'get_stats':
        return await getStats();
      
      case 'buy_reward':
        return await buyReward(args.key);
      
      case 'get_inventory':
        return await getInventory();
      
      case 'cast_spell':
        return await castSpell(args.spellId, args.targetId);
      
      case 'get_tags':
        return await getTags();
      
      case 'create_tag':
        return await createTag(args.name);
      
      case 'get_pets':
        return await getPets();
      
      case 'feed_pet':
        return await feedPet(args.pet, args.food);
      
      case 'hatch_pet':
        return await hatchPet(args.egg, args.hatchingPotion);
      
      case 'get_mounts':
        return await getMounts();
      
      case 'equip_item':
        return await equipItem(args.type, args.key);
      
      case 'get_notifications':
        return await getNotifications();
      
      case 'read_notification':
        return await readNotification(args.notificationId);
      
      case 'get_shop':
        return await getShop(args.shopType);
      
      case 'buy_item':
        return await buyItem(args.itemKey, args.quantity);
      
      case 'get_task_checklist':
        return await getTaskChecklist(args.taskId);
      
      case 'add_checklist_item':
        return await addChecklistItem(args.taskId, args.text);
      
      case 'update_checklist_item':
        return await updateChecklistItem(args.taskId, args.itemId, args);
      
      case 'delete_checklist_item':
        return await deleteChecklistItem(args.taskId, args.itemId);
      
      case 'score_checklist_item':
        return await scoreChecklistItem(args.taskId, args.itemId);
      
      default:
        throw new McpError(ErrorCode.MethodNotFound, `未知工具: ${name}`);
    }
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }
    
    const errorMessage = error.response?.data?.message || error.message || '未知错误';
    throw new McpError(ErrorCode.InternalError, `Habitica API 错误: ${errorMessage}`);
  }
}

// 工具定义
const tools = [
  {
    name: 'get_user_profile',
    description: t('Get user profile', '获取用户档案信息'),
    inputSchema: {
      type: 'object',
      properties: {},
    },
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
          description: t('Difficulty (0.1=easy, 1=medium, 1.5=hard, 2=very hard)', '难度 (0.1=简单, 1=中等, 1.5=困难, 2=极难)'),
        },
        priority: {
          type: 'number',
          enum: [0.1, 1, 1.5, 2],
          description: t('Priority (0.1=low, 1=med, 1.5=high, 2=urgent)', '优先级 (0.1=低, 1=中, 1.5=高, 2=极高)'),
        },
        checklist: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: {
                type: 'string',
                description: t('Checklist item text', '清单项目文本'),
              },
              completed: {
                type: 'boolean',
                description: t('Completed status', '完成状态'),
                default: false,
              },
            },
            required: ['text'],
          },
          description: t('Checklist items', '清单项目'),
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
        taskId: {
          type: 'string',
          description: t('Task ID', '任务ID'),
        },
        direction: {
          type: 'string',
          enum: ['up', 'down'],
          description: t('Direction (up=positive, down=negative, habits only)', '方向 (up=正向, down=负向，仅适用于习惯)'),
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
        taskId: {
          type: 'string',
          description: t('Task ID', '任务ID'),
        },
        text: {
          type: 'string',
          description: t('Task title', '任务标题'),
        },
        notes: {
          type: 'string',
          description: t('Task notes', '任务备注'),
        },
        completed: {
          type: 'boolean',
          description: t('Completed flag', '是否完成'),
        },
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
        taskId: {
          type: 'string',
          description: t('Task ID', '任务ID'),
        },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'get_stats',
    description: t('Get user stats', '获取用户统计信息'),
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'buy_reward',
    description: t('Buy reward', '购买奖励'),
    inputSchema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: t('Reward key or ID', '奖励的key或ID'),
        },
      },
      required: ['key'],
    },
  },
  {
    name: 'get_inventory',
    description: t('Get inventory', '获取物品清单'),
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'cast_spell',
    description: t('Cast spell', '施放技能'),
    inputSchema: {
      type: 'object',
      properties: {
        spellId: {
          type: 'string',
          description: t('Spell ID', '技能ID'),
        },
        targetId: {
          type: 'string',
          description: t('Target ID (optional)', '目标ID (可选)'),
        },
      },
      required: ['spellId'],
    },
  },
  {
    name: 'get_tags',
    description: t('Get tags list', '获取标签列表'),
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'create_tag',
    description: t('Create tag', '创建新标签'),
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: t('Tag name', '标签名称'),
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'get_pets',
    description: '获取宠物列表',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'feed_pet',
    description: '喂养宠物',
    inputSchema: {
      type: 'object',
      properties: {
        pet: {
          type: 'string',
          description: '宠物key',
        },
        food: {
          type: 'string',
          description: '食物key',
        },
      },
      required: ['pet', 'food'],
    },
  },
  {
    name: 'hatch_pet',
    description: '孵化宠物',
    inputSchema: {
      type: 'object',
      properties: {
        egg: {
          type: 'string',
          description: '蛋的key',
        },
        hatchingPotion: {
          type: 'string',
          description: '孵化药水的key',
        },
      },
      required: ['egg', 'hatchingPotion'],
    },
  },
  {
    name: 'get_mounts',
    description: '获取坐骑列表',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'equip_item',
    description: '装备物品',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['mount', 'pet', 'costume', 'equipped'],
          description: '装备类型',
        },
        key: {
          type: 'string',
          description: '物品key',
        },
      },
      required: ['type', 'key'],
    },
  },
  {
    name: 'get_notifications',
    description: '获取通知列表',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'read_notification',
    description: '标记通知为已读',
    inputSchema: {
      type: 'object',
      properties: {
        notificationId: {
          type: 'string',
          description: '通知ID',
        },
      },
      required: ['notificationId'],
    },
  },
  {
    name: 'get_shop',
    description: '获取商店物品',
    inputSchema: {
      type: 'object',
      properties: {
        shopType: {
          type: 'string',
          enum: ['market', 'questShop', 'timeTravelersShop', 'seasonalShop'],
          description: '商店类型',
        },
      },
    },
  },
  {
    name: 'buy_item',
    description: '购买商店物品',
    inputSchema: {
      type: 'object',
      properties: {
        itemKey: {
          type: 'string',
          description: '物品key',
        },
        quantity: {
          type: 'number',
          description: '购买数量',
          default: 1,
        },
      },
      required: ['itemKey'],
    },
  },
  {
    name: 'add_checklist_item',
    description: t('Add checklist item to task', '向任务添加清单项目'),
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: t('Task ID', '任务ID'),
        },
        text: {
          type: 'string',
          description: t('Checklist item text', '清单项目文本'),
        },
      },
      required: ['taskId', 'text'],
    },
  },
  {
    name: 'update_checklist_item',
    description: t('Update checklist item', '更新清单项目'),
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: t('Task ID', '任务ID'),
        },
        itemId: {
          type: 'string',
          description: t('Checklist item ID', '清单项目ID'),
        },
        text: {
          type: 'string',
          description: t('Checklist item text', '清单项目文本'),
        },
        completed: {
          type: 'boolean',
          description: t('Completed status', '完成状态'),
        },
      },
      required: ['taskId', 'itemId'],
    },
  },
  {
    name: 'delete_checklist_item',
    description: t('Delete checklist item', '删除清单项目'),
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: t('Task ID', '任务ID'),
        },
        itemId: {
          type: 'string',
          description: t('Checklist item ID', '清单项目ID'),
        },
      },
      required: ['taskId', 'itemId'],
    },
  },
  {
    name: 'get_task_checklist',
    description: t('Get task checklist items', '获取任务清单项目'),
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: t('Task ID', '任务ID'),
        },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'score_checklist_item',
    description: t('Score checklist item (mark complete/incomplete)', '为清单项目评分（标记完成/未完成）'),
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: t('Task ID', '任务ID'),
        },
        itemId: {
          type: 'string',
          description: t('Checklist item ID', '清单项目ID'),
        },
      },
      required: ['taskId', 'itemId'],
    },
  },
];

// 註冊工具
tools.forEach(tool => {
  mcpServer.registerTool(tool.name, {
    description: tool.description,
    inputSchema: tool.inputSchema
  }, async (args) => {
    // 使用工具名稱調用相應的處理函數
    return await handleToolCall(tool.name, args);
  });
});

// 工具实现函数
async function getUserProfile() {
  const response = await habiticaClient.get('/user');
  const user = response.data.data;
  
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(user, null, 2),
      },
    ],
  };
}

async function getTasks(type) {
  const endpoint = type ? `/tasks/user?type=${type}` : '/tasks/user';
  const response = await habiticaClient.get(endpoint);
  
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(response.data, null, 2),
      },
    ],
  };
}

async function createTask(taskData) {
  const response = await habiticaClient.post('/tasks/user', taskData);
  const task = response.data.data;
  
  return {
    content: [
      {
        type: 'text',
        text: `成功创建任务: ${task.text} (ID: ${task.id})`,
      },
    ],
  };
}

async function scoreTask(taskId, direction = 'up') {
  const response = await habiticaClient.post(`/tasks/${taskId}/score/${direction}`);
  const result = response.data.data;
  
  let message = `任务完成! `;
  if (result.exp) message += `获得 ${result.exp} 经验值 `;
  if (result.gp) message += `获得 ${result.gp} 金币 `;
  if (result.lvl) message += `升级到 ${result.lvl} 级! `;
  
  return {
    content: [
      {
        type: 'text',
        text: message,
      },
    ],
  };
}

async function updateTask(taskId, updates) {
  const response = await habiticaClient.put(`/tasks/${taskId}`, updates);
  const task = response.data.data;
  
  return {
    content: [
      {
        type: 'text',
        text: `成功更新任务: ${task.text}`,
      },
    ],
  };
}

async function deleteTask(taskId) {
  await habiticaClient.delete(`/tasks/${taskId}`);
  
  return {
    content: [
      {
        type: 'text',
        text: `成功删除任务 (ID: ${taskId})`,
      },
    ],
  };
}

async function getStats() {
  const response = await habiticaClient.get('/user');
  
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(response.data.data.stats, null, 2),
      },
    ],
  };
}

async function buyReward(key) {
  const response = await habiticaClient.post(`/user/buy/${key}`);
  const result = response.data.data;
  
  return {
    content: [
      {
        type: 'text',
        text: `成功购买奖励! 剩余金币: ${result.gp}`,
      },
    ],
  };
}

async function getInventory() {
  const response = await habiticaClient.get('/user');
  
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(response.data.data.items, null, 2),
      },
    ],
  };
}

async function castSpell(spellId, targetId) {
  const endpoint = targetId ? `/user/class/cast/${spellId}?targetId=${targetId}` : `/user/class/cast/${spellId}`;
  const response = await habiticaClient.post(endpoint);
  
  return {
    content: [
      {
        type: 'text',
        text: `成功施放技能: ${spellId}`,
      },
    ],
  };
}

async function getTags() {
  const response = await habiticaClient.get('/tags');
  
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(response.data, null, 2),
      },
    ],
  };
}

async function createTag(name) {
  const response = await habiticaClient.post('/tags', { name });
  const tag = response.data.data;
  
  return {
    content: [
      {
        type: 'text',
        text: `成功创建标签: ${tag.name} (ID: ${tag.id})`,
      },
    ],
  };
}

async function getPets() {
  const response = await habiticaClient.get('/user');
  
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(response.data.data.items.pets, null, 2),
      },
    ],
  };
}

async function feedPet(pet, food) {
  const response = await habiticaClient.post(`/user/feed/${pet}/${food}`);
  const result = response.data.data;
  
  let message = `成功喂养宠物 ${pet}! `;
  if (result.message) {
    message += result.message;
  }
  
  return {
    content: [
      {
        type: 'text',
        text: message,
      },
    ],
  };
}

async function hatchPet(egg, hatchingPotion) {
  const response = await habiticaClient.post(`/user/hatch/${egg}/${hatchingPotion}`);
  const result = response.data.data;
  
  return {
    content: [
      {
        type: 'text',
        text: `成功孵化宠物! 获得了 ${egg}-${hatchingPotion}`,
      },
    ],
  };
}

async function getMounts() {
  const response = await habiticaClient.get('/user');
  
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(response.data.data.items.mounts, null, 2),
      },
    ],
  };
}

async function equipItem(type, key) {
  const response = await habiticaClient.post(`/user/equip/${type}/${key}`);
  
  return {
    content: [
      {
        type: 'text',
        text: `成功装备 ${type}: ${key}`,
      },
    ],
  };
}

async function getNotifications() {
  const response = await habiticaClient.get('/notifications');
  
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(response.data, null, 2),
      },
    ],
  };
}

async function readNotification(notificationId) {
  await habiticaClient.post(`/notifications/${notificationId}/read`);
  
  return {
    content: [
      {
        type: 'text',
        text: `成功标记通知为已读 (ID: ${notificationId})`,
      },
    ],
  };
}

async function getShop(shopType = 'market') {
  const response = await habiticaClient.get(`/shops/${shopType}`);
  
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(response.data, null, 2),
      },
    ],
  };
}

async function buyItem(itemKey, quantity = 1) {
  const response = await habiticaClient.post(`/user/buy/${itemKey}`, { quantity });
  const result = response.data.data;
  
  return {
    content: [
      {
        type: 'text',
        text: `成功购买 ${itemKey} x${quantity}! 剩余金币: ${result.gp}`,
      },
    ],
  };
}

async function getTaskChecklist(taskId) {
  const response = await habiticaClient.get(`/tasks/${taskId}`);
  const task = response.data.data;
  const checklist = task.checklist || [];
  
  return {
    content: [
      {
        type: 'text',
        text: t(`Task: ${task.text}\nChecklist items (${checklist.length}):`, `任务: ${task.text}\n清单项目 (${checklist.length}):`),
      },
      {
        type: 'text',
        text: checklist.length > 0 
          ? checklist.map(item => `${item.completed ? '✓' : '○'} ${item.text} (ID: ${item.id})`).join('\n')
          : t('No checklist items found', '未找到清单项目'),
      },
    ],
  };
}

async function addChecklistItem(taskId, text) {
  const response = await habiticaClient.post(`/tasks/${taskId}/checklist`, { text });
  const item = response.data.data;
  
  return {
    content: [
      {
        type: 'text',
        text: t(`Successfully added checklist item: ${item.text} (ID: ${item.id})`, `成功添加清单项目: ${item.text} (ID: ${item.id})`),
      },
    ],
  };
}

async function updateChecklistItem(taskId, itemId, updates) {
  const response = await habiticaClient.put(`/tasks/${taskId}/checklist/${itemId}`, updates);
  const item = response.data.data;
  
  return {
    content: [
      {
        type: 'text',
        text: t(`Successfully updated checklist item: ${item.text}`, `成功更新清单项目: ${item.text}`),
      },
    ],
  };
}

async function deleteChecklistItem(taskId, itemId) {
  await habiticaClient.delete(`/tasks/${taskId}/checklist/${itemId}`);
  
  return {
    content: [
      {
        type: 'text',
        text: t(`Successfully deleted checklist item (ID: ${itemId})`, `成功删除清单项目 (ID: ${itemId})`),
      },
    ],
  };
}

async function scoreChecklistItem(taskId, itemId) {
  const response = await habiticaClient.post(`/tasks/${taskId}/checklist/${itemId}/score`);
  const item = response.data.data;
  
  return {
    content: [
      {
        type: 'text',
        text: t(`Successfully scored checklist item: ${item.text} (completed: ${item.completed})`, `成功评分清单项目: ${item.text} (完成状态: ${item.completed})`),
      },
    ],
  };
}

// 創建 Express 應用用於網頁文檔
function createWebApp() {
  const app = express();
  
  // 基本中介軟體
  app.use(cors());
  app.use(express.json());
  
  // 設置 IP 信任代理
  app.set('trust proxy', true);
  
  // 驗證中介軟體
  app.use(createAuthMiddleware());
  
  // 主頁面 - 顯示文檔
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
                  ✅ 服務器運行中 | ⚡ MCP StreamableHTTP Server with JSON-RPC 2.0
              </div>
              
              <div class="section">
                  <h2>📚 MCP 端點</h2>
                  <div class="endpoint">JSON-RPC 2.0 over HTTP - 標準 MCP 通信協議</div>
                  <div class="endpoint">StreamableHTTP - 支持流式響應的 HTTP 傳輸</div>
                  <div class="endpoint">GET /tools - 取得可用工具清單 (REST API)</div>
                  <div class="endpoint">GET /health - 健康檢查</div>
              </div>
              
              <div class="section">
                  <h2>🔒 安全配置</h2>
                  <div class="status" style="background: ${MCP_API_KEY ? 'rgba(76, 175, 80, 0.8)' : 'rgba(255, 193, 7, 0.8)'}; color: black;">
                      🔐 API 密鑰: ${MCP_API_KEY ? '✅ 已設置' : '⚠️ 未設置'}<br>
                      🌐 IP 白名單: ${ALLOWED_IPS.length > 0 ? `✅ ${ALLOWED_IPS.length} 個 IP` : '⚠️ 允許所有 IP'}<br>
                      ⚡ 速率限制: ✅ ${RATE_LIMIT_MAX}/小時<br>
                      🔍 驗證模式: ${REQUIRE_AUTHENTICATION ? '✅ 強制驗證' : '⚠️ 部分驗證'}
                  </div>
                  <p>為了保護您的 Habitica 帳戶安全，建議設置以下環境變數：</p>
                  <div class="endpoint">
                      <code>MCP_API_KEY</code>: 設置 API 密鑰以限制存取<br>
                      <code>ALLOWED_IPS</code>: IP 白名單 (以逗號分隔)<br>
                      <code>RATE_LIMIT_MAX</code>: 每小時請求數量限制 (預設: 100)<br>
                      <code>REQUIRE_AUTHENTICATION</code>: 是否強制驗證 (預設: true)
                  </div>
              </div>
              
              <div class="section">
                  <h2>🔧 認證方式</h2>
                  <p>MCP 客戶端需要設置環境變數：</p>
                  <div class="endpoint">
                      <code>HABITICA_USER_ID</code>: 您的 Habitica 使用者 ID<br>
                      <code>HABITICA_API_TOKEN</code>: 您的 Habitica API 權杖<br>
                      <code>MCP_LANG</code>: 語言設置 (可選)
                  </div>
                  ${MCP_API_KEY ? `
                  <p><strong>請求時需要在標頭中包含 API 密鑰：</strong></p>
                  <div class="endpoint">
                      <code>X-MCP-API-Key</code>: 您設置的 MCP API 密鑰
                  </div>
                  ` : ''}
              </div>
              
              <div class="section">
                  <h2>🛠️ 可用工具 (${tools.length} 個)</h2>
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
                      <li>🏆 <strong>獎勵系統</strong>：購買獎勵和商店物品</li>
                      <li>🐲 <strong>寵物系統</strong>：查看和管理您的虛擬寵物</li>
                      <li>📊 <strong>統計資訊</strong>：查看使用者等級、經驗值等資料</li>
                      <li>🎒 <strong>物品管理</strong>：查看背包中的物品和裝備</li>
                      <li>⚡ <strong>MCP 標準</strong>：完全兼容 Model Context Protocol</li>
                      <li>🌊 <strong>流式傳輸</strong>：支援 StreamableHTTP 實時響應</li>
                      <li>🔄 <strong>JSON-RPC 2.0</strong>：標準化的通信協議</li>
                  </ul>
              </div>
              
              <div class="section">
                  <h2>📖 使用範例</h2>
                  <div class="endpoint">
                      # MCP 客戶端配置<br>
                      export HABITICA_USER_ID="YOUR_USER_ID"<br>
                      export HABITICA_API_TOKEN="YOUR_API_TOKEN"<br>
                      ${MCP_API_KEY ? 'export MCP_API_KEY="YOUR_MCP_API_KEY"<br>' : ''}
                      npx @modelcontextprotocol/inspector http://localhost:${req.socket.localPort || 3000}
                  </div>
                  <div class="endpoint">
                      # 直接 JSON-RPC 2.0 調用<br>
                      curl -X POST http://localhost:${req.socket.localPort || 3000} \\<br>
                      &nbsp;&nbsp;-H "Content-Type: application/json" \\<br>
                      ${MCP_API_KEY ? '&nbsp;&nbsp;-H "X-MCP-API-Key: YOUR_MCP_API_KEY" \\<br>' : ''}
                      &nbsp;&nbsp;-d '{"jsonrpc": "2.0", "method": "tools/list", "id": 1}'
                  </div>
                  ${MCP_API_KEY ? `
                  <div class="endpoint">
                      # 使用查詢參數传送 API 密鑰<br>
                      curl "http://localhost:${req.socket.localPort || 3000}/tools?apiKey=YOUR_MCP_API_KEY"
                  </div>
                  ` : ''}
              </div>
              
              <div class="section">
                  <h2>🔗 相關連結</h2>
                  <p>📖 <a href="https://habitica.com/apidoc/" style="color: #FFD700;">Habitica API 文件</a></p>
                  <p>🏠 <a href="https://habitica.com" style="color: #FFD700;">Habitica 官網</a></p>
                  <p>⚙️ <a href="https://habitica.com/user/settings/api" style="color: #FFD700;">取得 API 憑證</a></p>
                  <p>🔧 <a href="https://modelcontextprotocol.io/" style="color: #FFD700;">Model Context Protocol</a></p>
              </div>
          </div>
      </body>
      </html>
    `);
  });
  
  // 工具清單 API
  app.get('/tools', (req, res) => {
    res.json({
      tools: tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      }))
    });
  });
  
  // 健康檢查端點
  app.get('/health', (req, res) => {
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      service: 'habitica-mcp-server',
      version: '0.0.5',
      protocol: 'MCP StreamableHTTP',
      transport: 'JSON-RPC 2.0',
      tools: tools.length,
      security: {
        apiKeyRequired: !!MCP_API_KEY,
        ipWhitelistEnabled: ALLOWED_IPS.length > 0,
        rateLimitEnabled: true,
        rateLimitMax: RATE_LIMIT_MAX,
        requireAuthentication: REQUIRE_AUTHENTICATION,
        clientIP: clientIP
      },
      environment: {
        hasCredentials: !!(HABITICA_USER_ID && HABITICA_API_TOKEN),
        language: process.env.MCP_LANG || process.env.LANG || 'en'
      }
    });
  });
  
  // 404 處理
  app.use((req, res) => {
    res.status(404).json({
      error: '未找到',
      message: '此端點不存在。這是一個 MCP StreamableHTTP 服務器，請使用 MCP 客戶端連接。',
      documentation: '/'
    });
  });
  
  return app;
}

// 启动服务器
async function runServer() {
  const port = process.env.PORT || 3000;
  
  // 創建 MCP 服務器傳輸層
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });
  
  await mcpServer.connect(transport);
  
  // 創建 Express 應用
  const webApp = createWebApp();
  
  // 添加 MCP 端點處理
  webApp.post('/mcp', express.json(), async (req, res) => {
    await transport.handleRequest(req, res, req.body);
  });
  
  webApp.get('/mcp', async (req, res) => {
    await transport.handleRequest(req, res);
  });
  
  webApp.delete('/mcp', async (req, res) => {
    await transport.handleRequest(req, res);
  });
  
  // 啟動 HTTP 服務器
  webApp.listen(port, process.env.HOST || '0.0.0.0', () => {
    console.error(`🏰 Habitica MCP HTTP 服務器已啟動`);
    console.error(`📚 文檔界面: http://localhost:${port}`);
    console.error(`🔧 MCP 端點: http://localhost:${port}/mcp`);
    console.error(`📋 工具清單: http://localhost:${port}/tools`);
    console.error(`❤️  健康檢查: http://localhost:${port}/health`);
  });
  console.error(`🏰 Habitica MCP HTTP 服務器已啟動`);
  console.error(`📚 文檔界面: http://localhost:${port}`);
  console.error(`🔧 MCP 端點: http://localhost:${port}`);
  console.error(`📋 工具清單: http://localhost:${port}/tools`);
  console.error(`❤️  健康檢查: http://localhost:${port}/health`);
  console.error(``);
  console.error(`🔒 安全配置:`);
  console.error(`   API 密鑰: ${MCP_API_KEY ? '✅ 已設置' : '⚠️  未設置 (建議設置 MCP_API_KEY)'}`);
  console.error(`   IP 白名單: ${ALLOWED_IPS.length > 0 ? `✅ ${ALLOWED_IPS.join(', ')}` : '⚠️  允許所有 IP (建議設置 ALLOWED_IPS)'}`);
  console.error(`   速率限制: ✅ ${RATE_LIMIT_MAX}/小時`);
  console.error(`   驗證模式: ${REQUIRE_AUTHENTICATION ? '✅ 強制驗證' : '⚠️  部分驗證'}`);
  
  if (!MCP_API_KEY || ALLOWED_IPS.length === 0) {
    console.error(``);
    console.error(`⚠️  安全警告: 為了保護您的 Habitica 帳戶，建議:`);
    if (!MCP_API_KEY) {
      console.error(`   1. 設置 MCP_API_KEY 環境變數`);
    }
    if (ALLOWED_IPS.length === 0) {
      console.error(`   2. 設置 ALLOWED_IPS 環境變數 (例: "127.0.0.1,::1")`);
    }
    console.error(``);
  }
}

runServer().catch((error) => {
  console.error('伺服器啟動失敗:', error);
  process.exit(1);
}); 