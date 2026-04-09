## 为什么会“并发重连”
在真实环境里，WebSocket 断开时，不是只触发一次逻辑，而是可能多处同时触发重连：
常见触发点：
```js
onClose → reconnect()
onError → reconnect()
心跳超时 → close() → reconnect()
```
结果：
1. 同一时间多次调用 reconnect()
如果你没有锁，创建多个 WebSocket 连接，每个都在推数据，导致客户端收到 5 份重复消息
```js
reconnect()
reconnect()
reconnect()
```
2. 重连风暴
多个 reconnect 定时器同时存在，网络直接被打爆

所以：同一时间，只允许一个 reconnect 在执行。

## 流程
t0：连接断开
↓
触发 onClose
↓
调用 reconnect()

进入 reconnect
lockReconnect = false
lockReconnect = true   （加锁）
attempts--
当前状态：已加锁，（防止其他地方再触发 reconnect）

setTimeout 触发，定时器执行
this.config.reconnect.lockReconnect = false
this.connection()

如果连接成功
onOpen 触发
onOpen() {
  lockReconnect = false   //（其实已经是 false）
  attempts = maxAttempts  // 重置次数
}

连接重连失败
触发 onError（可能没有 onClose）
但是当前 lockReconnect = false ✅（因为你提前释放了）
所以：onError → reconnect() 可以再次进入！



### 面试
为了防止 WebSocket 在异常情况下触发多次重连，我引入了一个互斥锁 lockReconnect，确保同一时间只有一个重连任务在执行，避免出现多个连接实例、重复消息和重连风暴的问题。



## 指数退避
```js
  getDelay() {
    const n = this.config.reconnect.attemptIndex
    // 指数退避：1s, 2s, 4s, 8s... 最大 10s
    return Math.min(1000 * 2 ** n, 10000)
  }
```

## ACK 机制
- 为什么“收到就立刻 ack”
```js
if (data.ackid) {
  this.connect?.send(`{"event":"ack","ackid":"${data.ackid}"}`)
}
```
- 如果没有 ACK，服务端不知道你有没有收到消息

场景：
服务端 → 发消息 A
↓
客户端 收到
↓
（但还没处理，页面崩了 / 刷新了）

服务端视角：
我发出去了 ✔
（但其实用户没处理 ）

结果：数据丢失（最严重问题）


- 有 ACK 后的流程
服务端 → 发消息 A（带 ackid）
↓
客户端 收到
↓
立刻 ack（告诉服务端“我收到了”）
↓
客户端再慢慢处理


## 去重（LRU cache）
去重（LRU cache）解决的是：同一条消息被服务端重复发送，客户端只处理一次
```js
if (cache.has(data.ackid)) return
```
Step 0：服务端发送消息
{
  "event": "orderCreate",
  "payload": { "orderId": 123 },
  "ackid": "abc-001"
}
服务端内部逻辑：
发出去 → 等 ACK
如果没 ACK → 重发

Step 1：客户端第一次收到
t0：客户端收到消息（ackid = abc-001）
// ① 先 ACK
this.connect.send('ack abc-001')
// ② 再去重判断
if (cache.has('abc-001')) return
// ③ 存入 cache
cache.set('abc-001', true)
// ④ 执行业务
创建订单 UI / 更新数据

但是如果返回 ACK：时因为网络问题，导致 ACK 丢失，服务端会重发消息，客户端会收到重复消息
但是客户端已经处理过了。所以需要去重。

## 离线消息推送
发送消息
↓
用户离线
↓
服务端存储消息（未投递）
↓
用户上线（建立 WS）
↓
服务端补发离线消息
↓
客户端收到 → ACK
↓
服务端标记已消费
↓
ACK 丢失 → 重发
↓
客户端去重（幂等）

## 简历
项目描述
封装通用 WebSocket 通信 SDK，支持自动重连、心跳检测、消息确认（ACK）及幂等处理，并打包为 npm 第三方库，支持 ESModule / UMD 多格式输出，适用于多业务场景复用。

- 封装 WebSocket SDK，实现连接管理、自动重连、心跳检测等基础能力
- 设计指数退避重连策略（Exponential Backoff），避免网络异常时的重连风暴
- 实现 ACK 确认机制，保证消息“至少一次投递”（At-Least-Once）
- 基于 ackid + LRU 缓存实现消息幂等控制，避免重复消费
- 设计心跳检测机制（ping/pong + 超时检测），提升连接稳定性
- 使用锁（lockReconnect）控制并发重连，防止多次重复连接
- 支持事件订阅机制（on/emit），实现业务解耦
- 封装为 npm SDK，支持 ESModule / UMD 格式，适配多种前端环境

## 改造成大屏
https://chatgpt.com/s/t_69d7153688b08191b75696c7577b669a