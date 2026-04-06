# WebSocket SDK

一个功能完善的 WebSocket SDK 封装，提供自动重连、心跳机制、事件处理等功能。

## 功能特性

- 自动重连机制，支持指数退避策略
- 心跳机制，保持连接活跃
- 事件处理系统，支持自定义事件
- 消息缓存，避免重复处理
- 简洁的 API 设计

## 安装

```bash
npm install websocket-sdk
```

## 基本使用

```javascript
import WsSocket from 'websocket-sdk';

// 创建 WebSocket 实例
const ws = new WsSocket(
  // URL 回调函数，每次连接时会调用
  () => 'ws://example.com/ws',
  // 事件配置
  {
    onOpen: (evt) => console.log('连接已打开', evt),
    onClose: (evt) => console.log('连接已关闭', evt),
    onError: (evt) => console.error('连接错误', evt)
  }
);

// 绑定自定义事件
ws.on('message', (payload, rawData) => {
  console.log('收到消息:', payload);
});

// 建立连接
ws.connection();

// 发送消息
ws.send('Hello WebSocket!');

// 发送自定义事件
ws.emit('chat', { message: 'Hello World' });

// 关闭连接
// ws.close();
```

## API 文档

### 构造函数

```javascript
new WsSocket(urlCallBack, events)
```

- `urlCallBack`: 函数，返回 WebSocket 连接 URL
- `events`: 对象，包含以下事件处理函数：
  - `onOpen`: 连接打开时触发
  - `onClose`: 连接关闭时触发
  - `onError`: 连接错误时触发

### 方法

#### connection()
建立 WebSocket 连接

#### send(message)
发送消息
- `message`: 字符串或对象

#### emit(event, payload)
发送自定义事件
- `event`: 事件名称
- `payload`: 事件数据

#### on(event, callback)
绑定自定义事件回调
- `event`: 事件名称
- `callback`: 回调函数，接收 `payload` 和 `rawData` 参数

#### close()
主动关闭连接

## 配置选项

### 心跳配置

```javascript
// 默认配置
heartbeat: {
  setInterval: null,
  pingInterval: 20000, // 心跳间隔（毫秒）
  pingTimeout: 60000   // 心跳超时（毫秒）
}
```

### 重连配置

```javascript
// 默认配置
reconnect: {
  lockReconnect: false,
  setTimeout: null,
  interval: [2000, 2500, 3000, 3000, 5000, 8000], // 重连间隔（毫秒）
  attempts: 100 // 最大重连次数
}
```

## 消息格式

### 发送消息

```json
{
  "event": "事件名称",
  "payload": "消息内容"
}
```

### 接收消息

```json
{
  "event": "事件名称",
  "payload": "消息内容",
  "ackid": "消息ID" // 可选，用于确认消息
}
```

## 注意事项

1. 当服务器返回带有 `ackid` 的消息时，SDK 会自动发送确认消息
2. 相同 `ackid` 的消息会被缓存，避免重复处理
3. 重连机制会在连接意外关闭时自动触发
4. 心跳机制会定期发送 ping 消息以保持连接活跃

## 构建

```bash
npm run build
```

构建产物将输出到 `dist` 目录，包含 ESM 和 UMD 两种格式。

## 依赖

- [lru-cache](https://www.npmjs.com/package/lru-cache): 用于消息缓存

## 许可证

MIT
