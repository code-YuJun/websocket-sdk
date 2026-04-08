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
