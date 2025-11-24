# Habitica MCP Server

_中文文档请阅读 **[README.zh-CN.md](README.zh-CN.md)**_

A Model Context Protocol (MCP) server that lets AI assistants seamlessly interact with the Habitica API – create tasks, track habits, raise pets and enjoy gamified productivity.

## ✨ Features

### 🎮 Core Gameplay Features
- 📋 **Smart task management** – create / view / update / delete all task types
- ✅ **Checklist management** – add, update, delete and score checklist items within tasks
- 🎯 **Habit tracking** – record habit completions and build healthy routines
- 🐾 **Pet raising** – hatch and feed pets, watch them grow
- 🏇 **Mount collection** – manage and equip all kinds of mounts
- 🛍️ **Shop & rewards** – browse and buy in-game items
- ⚡ **Skill system** – cast class skills to enhance gameplay

### 📊 Data-oriented Features
- 👤 **User profile** – fetch detailed user information and stats
- 🏷️ **Tag management** – create and manage tags for better organisation
- 📬 **Notification centre** – read and manage system notifications
- 📦 **Inventory** – list every item and piece of equipment you own

### 🤖 AI Integration Highlights
- 🧠 **Natural-language control** – operate Habitica via conversation
- 📝 **Task suggestions** – AI can create tasks on demand
- 📈 **Progress reporting** – automatically track and summarise progress
- 🎨 **Personalised experience** – tailored recommendations based on your habits

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- npm or yarn
- A valid Habitica account

### Installation

1. **Clone the repo**
```bash
git clone https://github.com/ibreaker/habitica-mcp-server.git
cd habitica-mcp-server
```

2. **Install dependencies**
```bash
npm install
```

3. **Set API credentials and security configuration**

Create a `.env` file (copy from `.env.example`):
```bash
cp .env.example .env
```

Edit `.env` with your credentials:
```env
# Habitica API credentials (required)
HABITICA_USER_ID=your_habitica_user_id_here
HABITICA_API_TOKEN=your_habitica_api_token_here

# Security configuration (highly recommended)
MCP_API_KEY=your_secret_api_key_here
ALLOWED_IPS=127.0.0.1,::1
RATE_LIMIT_MAX=100
REQUIRE_AUTHENTICATION=true
```

**🔒 Security Note**: To protect your Habitica account, it's **strongly recommended** to set:
- `MCP_API_KEY`: Requires clients to provide this key in `X-MCP-API-Key` header
- `ALLOWED_IPS`: Comma-separated list of allowed IP addresses (supports CIDR)
- `RATE_LIMIT_MAX`: Maximum requests per hour per IP
- `REQUIRE_AUTHENTICATION`: Whether to enforce authentication on all endpoints

**Getting your Habitica credentials**:
1. Go to [Habitica Settings > API](https://habitica.com/user/settings/api)
2. Copy your User ID and API Token

4. **Start the server**
```bash
npm start
```

## ⚙️ Configuration

### Get Habitica API credentials
1. Log into [Habitica](https://habitica.com)
2. Click your avatar → **Settings**
3. Open the **API** tab
4. Copy **User ID** and **API Token**

### Environment variables

**Method A: export variables**
```bash
export HABITICA_USER_ID="your-user-id"
export HABITICA_API_TOKEN="your-api-token"
```

**Method B: .env file**
```bash
HABITICA_USER_ID=your-user-id
HABITICA_API_TOKEN=your-api-token
```

> ⚠️ **Security tip:** never commit your API keys to version control.

## 🎯 Usage

### Start the server
```bash
# Production
npm start

# Development (with reload)
npm run dev
```

### MCP client integration

The server follows the MCP spec and works with any AI client that supports MCP. Example Claude Desktop config:
```json
{
  "mcpServers": {
    "habitica-mcp-server": {
      "command": "npx",
      "args": ["-y", "habitica-mcp-server"],
      "env": {
        "HABITICA_USER_ID": "your-id",
        "HABITICA_API_TOKEN": "your-token",
        "MCP_LANG": "en"  // or zh-CN
      }
    }
  }
}
```

### Example dialogue
```
User: "Create a habit for learning Python"
AI:   "Sure, the habit has been created!"

User: "Show me today's tasks"
AI:   "Here is your task list for today…"

User: "Add a checklist item to my project task: 'Review code'"
AI:   "Added checklist item 'Review code' to your project task!"

User: "I finished my workout, please record it"
AI:   "Great job! The workout is logged."
```

## 🛠️ Available Tools

### User Related
- `get_user_profile`: Get user profile information
- `get_stats`: Get user statistics
- `get_inventory`: Get inventory list

### Task Management
- `get_tasks`: Get task list (can specify type: habits, dailys, todos, rewards)
- `create_task`: Create new task
- `update_task`: Update task
- `delete_task`: Delete task
- `score_task`: Complete task or record habit

### Checklist Management
- `get_task_checklist`: Get checklist items for a task
- `add_checklist_item`: Add checklist item to task
- `update_checklist_item`: Update checklist item
- `delete_checklist_item`: Delete checklist item
- `score_checklist_item`: Score checklist item (mark complete/incomplete)

### Tag Management
- `get_tags`: Get tag list
- `create_tag`: Create new tag

### Pets and Mounts
- `get_pets`: Get pet list
- `feed_pet`: Feed pet
- `hatch_pet`: Hatch pet
- `get_mounts`: Get mount list
- `equip_item`: Equip pet, mount or equipment

### Shop and Purchases
- `get_shop`: Get shop item list
- `buy_item`: Buy shop item
- `buy_reward`: Buy reward

### Notification Management
- `get_notifications`: Get notification list
- `read_notification`: Mark notification as read

### Skill System
- `cast_spell`: Cast spell

## 📖 API Usage Examples

### Create Task
```json
{
  "type": "todo",
  "text": "Complete project documentation",
  "notes": "Including API docs and user guide",
  "difficulty": 1.5,
  "priority": 2,
  "checklist": [
    {"text": "Write API documentation", "completed": false},
    {"text": "Create user guide", "completed": false},
    {"text": "Review and proofread", "completed": false}
  ]
}
```

### Complete Task
```json
{
  "taskId": "task-id-here",
  "direction": "up"
}
```

### Get Specific Task Type
```json
{
  "type": "todos"
}
```

### Pet Management
```json
{
  "pet": "Wolf-Base",
  "food": "Meat"
}
```

### Buy Item
```json
{
  "itemKey": "armor_warrior_1",
  "quantity": 1
}
```

### Checklist Management
```json
// Add checklist item
{
  "taskId": "task-id-here",
  "text": "Research requirements"
}

// Update checklist item
{
  "taskId": "task-id-here",
  "itemId": "checklist-item-id",
  "text": "Updated item text",
  "completed": true
}

// Score checklist item (toggle completion)
{
  "taskId": "task-id-here",
  "itemId": "checklist-item-id"
}
```

## Task Types

- `habit`: Habit (can be recorded positively or negatively)
- `daily`: Daily task (resets every day)
- `todo`: To-do item (one-time task)
- `reward`: Reward (can be purchased with gold)

## Difficulty Levels

- `0.1`: Easy
- `1`: Medium
- `1.5`: Hard
- `2`: Extreme

## Priority Levels

- `0.1`: Low
- `1`: Medium
- `1.5`: High
- `2`: Extreme

## 🔧 Troubleshooting

### Common Issues

**Issue**: Server startup failed
```
Solution: 
1. Check Node.js version is 18+
2. Confirm environment variables are set correctly
3. Verify API credentials are valid
```

**Issue**: API call failed
```
Solution:
1. Check network connection
2. Verify Habitica API credentials
3. Confirm API rate limits haven't been exceeded
```

**Issue**: Task or pet not found
```
Solution:
1. Confirm task ID is correct
2. Check if task exists in Habitica
3. Verify user permissions
```

### Debug Mode
```bash
# Enable verbose logging
DEBUG=* npm start
```

### Get Help
- 📚 Check [Habitica API Documentation](https://habitica.com/apidoc/)
- 🐛 Submit [Issues](https://github.com/ibreaker/habitica-mcp-server/issues)

## 🤝 Contributing

We welcome all forms of contributions!

### How to Contribute
1. Fork this project
2. Create feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Create Pull Request

### Development Guidelines
- Follow existing code style
- Add appropriate tests
- Update relevant documentation
- Ensure all tests pass

## 📄 License

This project is open source under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🌟 Acknowledgments

- Thanks to [Habitica](https://habitica.com) for providing an excellent API
- Thanks to [Anthropic](https://anthropic.com) for the MCP protocol
- Thanks to all contributors and users for their support

---

<div align="center">
  <b>Let AI become your Habitica task management assistant!</b>
</div>